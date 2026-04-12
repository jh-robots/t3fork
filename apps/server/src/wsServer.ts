/**
 * Server - HTTP/WebSocket server service interface.
 *
 * Owns startup and shutdown lifecycle of the HTTP server, static asset serving,
 * and WebSocket request routing.
 *
 * @module Server
 */
import http from "node:http";
import type { Duplex } from "node:stream";

import Mime from "@effect/platform-node/Mime";
import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ClientOrchestrationCommand,
  type JhComposerPrefillRequest,
  JhComposerPrefillRequest as JhComposerPrefillRequestSchema,
  type JhNotificationTriggerRequest,
  JhNotificationTriggerRequest as JhNotificationTriggerRequestSchema,
  type JhSidebarProjectVisibilityRequest,
  JhSidebarProjectVisibilityRequest as JhSidebarProjectVisibilityRequestSchema,
  type JhSpawnRequest,
  JhSpawnRequest as JhSpawnRequestSchema,
  MessageId,
  type OrchestrationCommand,
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  ProjectId,
  ThreadId,
  WS_CHANNELS,
  WS_METHODS,
  WebSocketRequest,
  type WsResponse as WsResponseMessage,
  WsResponse,
  type WsPushEnvelopeBase,
} from "@t3tools/contracts";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  Cause,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Result,
  Schema,
  Scope,
  ServiceMap,
  Stream,
  Struct,
} from "effect";
import { WebSocketServer, type WebSocket } from "ws";

import { createLogger } from "./logger";
import { GitManager } from "./git/Services/GitManager.ts";
import { tryHandleJhLoopRoute } from "./jhLoopRoute.ts";
import { JhLoopRuntimeService } from "./loops/Services/JhLoopRuntime.ts";
import { TerminalManager } from "./terminal/Services/Manager.ts";
import { Keybindings } from "./keybindings";
import { searchWorkspaceEntries } from "./workspaceEntries";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { OrchestrationReactor } from "./orchestration/Services/OrchestrationReactor";
import { ProviderService } from "./provider/Services/ProviderService";
import { ProviderHealth } from "./provider/Services/ProviderHealth";
import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { clamp } from "effect/Number";
import { Open, resolveAvailableEditors } from "./open";
import { ServerConfig } from "./config";
import { GitCore } from "./git/Services/GitCore.ts";
import { tryHandleProjectFaviconRequest } from "./projectFaviconRoute";
import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths";

import {
  createAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
} from "./attachmentStore.ts";
import { parseBase64DataUrl } from "./imageMime.ts";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService.ts";
import { expandHomePath } from "./os-jank.ts";
import { makeServerPushBus } from "./wsServer/pushBus.ts";
import { makeServerReadiness } from "./wsServer/readiness.ts";
import { decodeJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";
import { loadJhRuntimeFeatureFlags } from "./jhRuntimeFeatureFlags.ts";
import {
  clearJhComposerDraftState,
  readJhComposerDraftState,
  upsertJhComposerDraftState,
} from "./jhComposerPrefillStore.ts";

/**
 * ServerShape - Service API for server lifecycle control.
 */
export interface ServerShape {
  /**
   * Start HTTP and WebSocket listeners.
   */
  readonly start: Effect.Effect<
    http.Server,
    ServerLifecycleError,
    Scope.Scope | ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
  >;

  /**
   * Wait for process shutdown signals.
   */
  readonly stopSignal: Effect.Effect<void, never>;
}

/**
 * Server - Service tag for HTTP/WebSocket lifecycle management.
 */
export class Server extends ServiceMap.Service<Server, ServerShape>()("t3/wsServer/Server") {}

const isServerNotRunningError = (error: Error): boolean => {
  const maybeCode = (error as NodeJS.ErrnoException).code;
  return (
    maybeCode === "ERR_SERVER_NOT_RUNNING" || error.message.toLowerCase().includes("not running")
  );
};

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusCode === 401 ? "Unauthorized" : "Bad Request"}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain\r\n" +
      `Content-Length: ${Buffer.byteLength(message)}\r\n` +
      "\r\n" +
      message,
  );
}

function websocketRawToString(raw: unknown): string | null {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw).toString("utf8");
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw)).toString("utf8");
  }
  if (Array.isArray(raw)) {
    const chunks: string[] = [];
    for (const chunk of raw) {
      if (typeof chunk === "string") {
        chunks.push(chunk);
        continue;
      }
      if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk).toString("utf8"));
        continue;
      }
      if (chunk instanceof ArrayBuffer) {
        chunks.push(Buffer.from(new Uint8Array(chunk)).toString("utf8"));
        continue;
      }
      return null;
    }
    return chunks.join("");
  }
  return null;
}

function toPosixRelativePath(input: string): string {
  return input.replaceAll("\\", "/");
}

const LOCAL_FILE_ROUTE_PATH = "/local-file";
const JH_RUNTIME_CONFIG_ROUTE_PATH = "/jh-runtime-config";
const JH_THREAD_COMPOSER_ROUTE_PATH = "/jh/thread-composer";
const JH_SIDEBAR_PROJECT_ROUTE_PATH = "/jh/sidebar/projects";
const JH_SPAWN_ROUTE_PATH = "/jh/spawn";
const JH_NOTIFY_ROUTE_PATH = "/jh/notify";

function readHttpRequestBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function decodeJhComposerPrefillRequest(raw: string): JhComposerPrefillRequest | null {
  try {
    const parsed = JSON.parse(raw);
    const candidate =
      parsed && typeof parsed === "object"
        ? ({
            ...parsed,
            ...(!("projectId" in parsed) && "project_id" in parsed
              ? { projectId: (parsed as Record<string, unknown>).project_id }
              : {}),
            ...(!("threadId" in parsed) && "thread_id" in parsed
              ? { threadId: (parsed as Record<string, unknown>).thread_id }
              : {}),
            ...(
              "metadata" in parsed &&
              parsed.metadata &&
              typeof parsed.metadata === "object" &&
              !("task_id" in (parsed.metadata as Record<string, unknown>)) &&
              "taskId" in (parsed.metadata as Record<string, unknown>)
                ? {
                    metadata: {
                      ...(parsed.metadata as Record<string, unknown>),
                      task_id: (parsed.metadata as Record<string, unknown>).taskId,
                    },
                  }
                : {}
            ),
          } satisfies Record<string, unknown>)
        : parsed;
    return Schema.decodeUnknownSync(JhComposerPrefillRequestSchema)(candidate);
  } catch {
    return null;
  }
}

function decodeJhNotificationTriggerRequest(raw: string): JhNotificationTriggerRequest | null {
  try {
    return Schema.decodeUnknownSync(JhNotificationTriggerRequestSchema)(JSON.parse(raw));
  } catch {
    return null;
  }
}

function decodeJhSpawnRequest(raw: string): JhSpawnRequest | null {
  try {
    return Schema.decodeUnknownSync(JhSpawnRequestSchema)(JSON.parse(raw));
  } catch {
    return null;
  }
}

function decodeJhSidebarProjectVisibilityRequest(raw: string): JhSidebarProjectVisibilityRequest | null {
  try {
    return Schema.decodeUnknownSync(JhSidebarProjectVisibilityRequestSchema)(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizeRequestedLocalFilePath(input: string): string {
  if (/^\/[A-Za-z]:[\\/]/.test(input)) {
    return input.slice(1);
  }
  return input;
}

function resolveWorkspaceWritePath(params: {
  workspaceRoot: string;
  relativePath: string;
  path: Path.Path;
}): Effect.Effect<{ absolutePath: string; relativePath: string }, RouteRequestError> {
  const normalizedInputPath = params.relativePath.trim();
  if (params.path.isAbsolute(normalizedInputPath)) {
    return Effect.fail(
      new RouteRequestError({
        message: "Workspace file path must be relative to the project root.",
      }),
    );
  }

  const absolutePath = params.path.resolve(params.workspaceRoot, normalizedInputPath);
  const relativeToRoot = toPosixRelativePath(
    params.path.relative(params.workspaceRoot, absolutePath),
  );
  if (
    relativeToRoot.length === 0 ||
    relativeToRoot === "." ||
    relativeToRoot.startsWith("../") ||
    relativeToRoot === ".." ||
    params.path.isAbsolute(relativeToRoot)
  ) {
    return Effect.fail(
      new RouteRequestError({
        message: "Workspace file path must stay within the project root.",
      }),
    );
  }

  return Effect.succeed({
    absolutePath,
    relativePath: relativeToRoot,
  });
}

function stripRequestTag<T extends { _tag: string }>(body: T) {
  return Struct.omit(body, ["_tag"]);
}

const encodeWsResponse = Schema.encodeEffect(Schema.fromJsonString(WsResponse));
const decodeWebSocketRequest = decodeJsonResult(WebSocketRequest);

export type ServerCoreRuntimeServices =
  | OrchestrationEngineService
  | ProjectionSnapshotQuery
  | CheckpointDiffQuery
  | OrchestrationReactor
  | JhLoopRuntimeService
  | ProviderService
  | ProviderHealth;

export type ServerRuntimeServices =
  | ServerCoreRuntimeServices
  | GitManager
  | GitCore
  | TerminalManager
  | Keybindings
  | Open
  | AnalyticsService;

export class ServerLifecycleError extends Schema.TaggedErrorClass<ServerLifecycleError>()(
  "ServerLifecycleError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

class RouteRequestError extends Schema.TaggedErrorClass<RouteRequestError>()("RouteRequestError", {
  message: Schema.String,
}) {}

export const createServer = Effect.fn(function* (): Effect.fn.Return<
  http.Server,
  ServerLifecycleError,
  Scope.Scope | ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
> {
  const serverConfig = yield* ServerConfig;
  const {
    port,
    cwd,
    keybindingsConfigPath,
    staticDir,
    devUrl,
    authToken,
    host,
    logWebSocketEvents,
    autoBootstrapProjectFromCwd,
  } = serverConfig;
  const availableEditors = resolveAvailableEditors();

  const gitManager = yield* GitManager;
  const terminalManager = yield* TerminalManager;
  const keybindingsManager = yield* Keybindings;
  const providerHealth = yield* ProviderHealth;
  const git = yield* GitCore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* keybindingsManager.syncDefaultKeybindingsOnStartup.pipe(
    Effect.catch((error) =>
      Effect.logWarning("failed to sync keybindings defaults on startup", {
        path: error.configPath,
        detail: error.detail,
        cause: error.cause,
      }),
    ),
  );

  const providerStatuses = yield* providerHealth.getStatuses;

  const clients = yield* Ref.make(new Set<WebSocket>());
  const logger = createLogger("ws");
  const readiness = yield* makeServerReadiness;

  function logOutgoingPush(push: WsPushEnvelopeBase, recipients: number) {
    if (!logWebSocketEvents) return;
    logger.event("outgoing push", {
      channel: push.channel,
      sequence: push.sequence,
      recipients,
      payload: push.data,
    });
  }

  const pushBus = yield* makeServerPushBus({
    clients,
    logOutgoingPush,
  });
  yield* readiness.markPushBusReady;
  yield* keybindingsManager.start.pipe(
    Effect.mapError(
      (cause) => new ServerLifecycleError({ operation: "keybindingsRuntimeStart", cause }),
    ),
  );
  yield* readiness.markKeybindingsReady;

  const normalizeProjectWorkspaceRoot = Effect.fnUntraced(function* (workspaceRoot: string) {
    const normalizedWorkspaceRoot = path.resolve(
      yield* expandHomePath(workspaceRoot.trim()).pipe(Effect.provideService(Path.Path, path)),
    );
    const workspaceStat = yield* fileSystem
      .stat(normalizedWorkspaceRoot)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!workspaceStat) {
      return yield* new RouteRequestError({
        message: `Project directory does not exist: ${normalizedWorkspaceRoot}`,
      });
    }
    if (workspaceStat.type !== "Directory") {
      return yield* new RouteRequestError({
        message: `Project path is not a directory: ${normalizedWorkspaceRoot}`,
      });
    }
    return normalizedWorkspaceRoot;
  });

  const normalizeDispatchCommand = Effect.fnUntraced(function* (input: {
    readonly command: ClientOrchestrationCommand;
  }) {
    if (input.command.type === "project.create") {
      return {
        ...input.command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(input.command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (input.command.type === "project.meta.update" && input.command.workspaceRoot !== undefined) {
      return {
        ...input.command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(input.command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (input.command.type !== "thread.turn.start") {
      return input.command as OrchestrationCommand;
    }
    const turnStartCommand = input.command;

    const normalizedAttachments = yield* Effect.forEach(
      turnStartCommand.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          const parsed = parseBase64DataUrl(attachment.dataUrl);
          if (!parsed || !parsed.mimeType.startsWith("image/")) {
            return yield* new RouteRequestError({
              message: `Invalid image attachment payload for '${attachment.name}'.`,
            });
          }

          const bytes = Buffer.from(parsed.base64, "base64");
          if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
            return yield* new RouteRequestError({
              message: `Image attachment '${attachment.name}' is empty or too large.`,
            });
          }

          const attachmentId = createAttachmentId(turnStartCommand.threadId);
          if (!attachmentId) {
            return yield* new RouteRequestError({
              message: "Failed to create a safe attachment id.",
            });
          }

          const persistedAttachment = {
            type: "image" as const,
            id: attachmentId,
            name: attachment.name,
            mimeType: parsed.mimeType.toLowerCase(),
            sizeBytes: bytes.byteLength,
          };

          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment: persistedAttachment,
          });
          if (!attachmentPath) {
            return yield* new RouteRequestError({
              message: `Failed to resolve persisted path for '${attachment.name}'.`,
            });
          }

          yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
            Effect.mapError(
              () =>
                new RouteRequestError({
                  message: `Failed to create attachment directory for '${attachment.name}'.`,
                }),
            ),
          );
          yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
            Effect.mapError(
              () =>
                new RouteRequestError({
                  message: `Failed to persist attachment '${attachment.name}'.`,
                }),
            ),
          );

          return persistedAttachment;
        }),
      { concurrency: 1 },
    );

    return {
      ...turnStartCommand,
      message: {
        ...turnStartCommand.message,
        attachments: normalizedAttachments,
      },
    } satisfies OrchestrationCommand;
  });

  const findActiveProject = Effect.fnUntraced(function* (input: {
    readonly projectId?: ProjectId;
    readonly workspaceRoot?: string;
  }) {
    if (input.projectId === undefined && input.workspaceRoot === undefined) {
      return null;
    }
    const snapshot = yield* projectionReadModelQuery.getSnapshot();
    return (
      snapshot.projects.find(
        (project) =>
          project.deletedAt === null &&
          (input.projectId === undefined || project.id === input.projectId) &&
          (input.workspaceRoot === undefined || project.workspaceRoot === input.workspaceRoot),
      ) ?? null
    );
  });

  const findActiveThread = Effect.fnUntraced(function* (input: {
    readonly threadId: string;
    readonly projectId?: ProjectId;
  }) {
    if (input.threadId.length === 0) {
      return null;
    }
    const snapshot = yield* projectionReadModelQuery.getSnapshot();
    return (
      snapshot.threads.find(
        (thread) =>
          thread.id === input.threadId &&
          thread.deletedAt === null &&
          (input.projectId === undefined || thread.projectId === input.projectId),
      ) ?? null
    );
  });

  const stageJhComposerPrefill = Effect.fnUntraced(function* (
    prefill: JhComposerPrefillRequest,
  ) {
    const entry = yield* upsertJhComposerDraftState({
      stateDir: serverConfig.stateDir,
      fileSystem,
      path,
      prefill,
    });
    yield* pushBus.publishAll(WS_CHANNELS.jhComposerPrefillUpdated, {
      threadId: entry.threadId,
      projectId: entry.projectId,
      draftId: entry.draftId,
      revision: entry.revision,
      cleared: false,
      updatedAt: entry.updatedAt,
    });
    return entry;
  });

  const publishJhSidebarProjectVisibility = Effect.fnUntraced(function* (input: {
    readonly projectId: ProjectId;
    readonly workspaceRoot: string;
    readonly expanded: boolean;
  }) {
    yield* pushBus.publishAll(WS_CHANNELS.jhSidebarProjectVisibilityUpdated, {
      projectId: input.projectId,
      workspaceRoot: input.workspaceRoot,
      expanded: input.expanded,
    });
    return {
      ok: true,
      projectId: input.projectId,
      workspaceRoot: input.workspaceRoot,
      expanded: input.expanded,
    };
  });

  const dispatchClientCommand = Effect.fnUntraced(function* (
    command: ClientOrchestrationCommand,
  ) {
    const normalizedCommand = yield* normalizeDispatchCommand({ command });
    return yield* orchestrationEngine.dispatch(normalizedCommand);
  });

  const performJhSpawn = Effect.fnUntraced(function* (request: JhSpawnRequest) {
    if (request.threads.length === 0) {
      return yield* new RouteRequestError({
        message: "Spawn request must include at least one thread.",
      });
    }

    const normalizedWorkspaceRoot =
      request.project.workspaceRoot !== undefined
        ? yield* normalizeProjectWorkspaceRoot(request.project.workspaceRoot)
        : undefined;

    const existingProjectById =
      request.project.projectId !== undefined
        ? yield* findActiveProject({ projectId: request.project.projectId })
        : null;
    const existingProjectByWorkspace =
      normalizedWorkspaceRoot !== undefined
        ? yield* findActiveProject({ workspaceRoot: normalizedWorkspaceRoot })
        : null;

    if (
      existingProjectById &&
      normalizedWorkspaceRoot !== undefined &&
      existingProjectById.workspaceRoot !== normalizedWorkspaceRoot
    ) {
      return yield* new RouteRequestError({
        message: "Supplied projectId does not match the supplied workspaceRoot.",
      });
    }

    if (
      request.project.projectId !== undefined &&
      !existingProjectById &&
      existingProjectByWorkspace &&
      existingProjectByWorkspace.id !== request.project.projectId
    ) {
      return yield* new RouteRequestError({
        message: "Supplied projectId does not match the existing project for workspaceRoot.",
      });
    }

    if (
      existingProjectById &&
      existingProjectByWorkspace &&
      existingProjectById.id !== existingProjectByWorkspace.id
    ) {
      return yield* new RouteRequestError({
        message: "Supplied projectId and workspaceRoot resolve to different active projects.",
      });
    }

    let resolvedProject = existingProjectById ?? existingProjectByWorkspace;
    let projectCreated = false;

    if (!resolvedProject) {
      if (normalizedWorkspaceRoot === undefined) {
        return yield* new RouteRequestError({
          message: "Spawn request must include workspaceRoot when creating a project.",
        });
      }
      const projectId = request.project.projectId ?? ProjectId.makeUnsafe(crypto.randomUUID());
      const projectTitle =
        request.project.title ?? path.basename(normalizedWorkspaceRoot) ?? "project";
      const createdAt = new Date().toISOString();
      yield* dispatchClientCommand({
        type: "project.create",
        commandId: CommandId.makeUnsafe(crypto.randomUUID()),
        projectId,
        title: projectTitle,
        workspaceRoot: normalizedWorkspaceRoot,
        defaultModel: request.project.defaultModel ?? DEFAULT_MODEL_BY_PROVIDER.codex,
        createdAt,
      });
      resolvedProject = {
        id: projectId,
        title: projectTitle,
        workspaceRoot: normalizedWorkspaceRoot,
        defaultModel: request.project.defaultModel ?? DEFAULT_MODEL_BY_PROVIDER.codex,
        customIndicator: null,
        scripts: [],
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      };
      projectCreated = true;
    }
    if (!resolvedProject) {
      return yield* new RouteRequestError({
        message: "Failed to resolve project for spawn request.",
      });
    }
    const activeProject = resolvedProject;

    const defaultThreadModel =
      request.project.defaultModel ??
      activeProject.defaultModel ??
      DEFAULT_MODEL_BY_PROVIDER.codex;
    const sidebarExpanded = request.project.sidebarExpanded ?? true;

    const threadResults = yield* Effect.forEach(
      request.threads,
      (threadSpec) =>
        Effect.gen(function* () {
          if (threadSpec.draft && threadSpec.firstTurn) {
            return yield* new RouteRequestError({
              message: `Thread '${threadSpec.title}' cannot request both draft and firstTurn in one spawn call.`,
            });
          }

          const threadId = threadSpec.threadId ?? ThreadId.makeUnsafe(crypto.randomUUID());
          const threadModel = threadSpec.model ?? defaultThreadModel;
          const createdAt = new Date().toISOString();

          yield* dispatchClientCommand({
            type: "thread.create",
            commandId: CommandId.makeUnsafe(crypto.randomUUID()),
            threadId,
            projectId: activeProject.id,
            title: threadSpec.title,
            model: threadModel,
            runtimeMode: threadSpec.runtimeMode ?? "full-access",
            interactionMode: threadSpec.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: threadSpec.branch ?? null,
            worktreePath: threadSpec.worktreePath ?? null,
            createdAt,
          });

          let draftRevision: number | undefined;
          if (threadSpec.draft) {
            const entry = yield* stageJhComposerPrefill({
              projectId: activeProject.id,
              threadId,
              text: threadSpec.draft.text,
              ...(threadSpec.draft.mode !== undefined ? { mode: threadSpec.draft.mode } : {}),
              ...(threadSpec.draft.metadata !== undefined
                ? { metadata: threadSpec.draft.metadata }
                : {}),
            });
            draftRevision = entry.revision;
          }

          let firstTurnSent = false;
          if (threadSpec.firstTurn) {
            yield* dispatchClientCommand({
              type: "thread.turn.start",
              commandId: CommandId.makeUnsafe(crypto.randomUUID()),
              threadId,
              message: {
                messageId: MessageId.makeUnsafe(crypto.randomUUID()),
                role: "user",
                text: threadSpec.firstTurn.text,
                attachments: [],
              },
              provider: threadSpec.firstTurn.provider,
              model: threadSpec.firstTurn.model ?? threadModel,
              modelOptions: threadSpec.firstTurn.modelOptions,
              providerOptions: threadSpec.firstTurn.providerOptions,
              assistantDeliveryMode: threadSpec.firstTurn.assistantDeliveryMode,
              runtimeMode: threadSpec.firstTurn.runtimeMode ?? threadSpec.runtimeMode ?? "full-access",
              interactionMode:
                threadSpec.firstTurn.interactionMode ??
                threadSpec.interactionMode ??
                DEFAULT_PROVIDER_INTERACTION_MODE,
              createdAt: new Date().toISOString(),
            });
            firstTurnSent = true;
          }

          return {
            threadId,
            title: threadSpec.title,
            created: true,
            ...(draftRevision !== undefined ? { draftRevision } : {}),
            firstTurnSent,
          };
        }),
      { concurrency: 1 },
    );

    yield* publishJhSidebarProjectVisibility({
      projectId: activeProject.id,
      workspaceRoot: activeProject.workspaceRoot,
      expanded: sidebarExpanded,
    });

    return {
      ok: true,
      project: {
        projectId: activeProject.id,
        title: activeProject.title,
        workspaceRoot: activeProject.workspaceRoot,
        created: projectCreated,
        sidebarExpanded,
      },
      threads: threadResults,
    };
  });

  // HTTP server — serves static files or redirects to Vite dev server
  const httpServer = http.createServer((req, res) => {
    const respond = (
      statusCode: number,
      headers: Record<string, string>,
      body?: string | Uint8Array,
    ) => {
      res.writeHead(statusCode, headers);
      res.end(body);
    };

    void Effect.runPromise(
      Effect.gen(function* () {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        if (tryHandleProjectFaviconRequest(url, res)) {
          return;
        }

        if (url.pathname.startsWith(ATTACHMENTS_ROUTE_PREFIX)) {
          const rawRelativePath = url.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
          const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
          if (!normalizedRelativePath) {
            respond(400, { "Content-Type": "text/plain" }, "Invalid attachment path");
            return;
          }

          const isIdLookup =
            !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
          const filePath = isIdLookup
            ? resolveAttachmentPathById({
                attachmentsDir: serverConfig.attachmentsDir,
                attachmentId: normalizedRelativePath,
              })
            : resolveAttachmentRelativePath({
                attachmentsDir: serverConfig.attachmentsDir,
                relativePath: normalizedRelativePath,
              });
          if (!filePath) {
            respond(
              isIdLookup ? 404 : 400,
              { "Content-Type": "text/plain" },
              isIdLookup ? "Not Found" : "Invalid attachment path",
            );
            return;
          }

          const fileInfo = yield* fileSystem
            .stat(filePath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!fileInfo || fileInfo.type !== "File") {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }

          const contentType = Mime.getType(filePath) ?? "application/octet-stream";
          res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          });
          const streamExit = yield* Stream.runForEach(fileSystem.stream(filePath), (chunk) =>
            Effect.sync(() => {
              if (!res.destroyed) {
                res.write(chunk);
              }
            }),
          ).pipe(Effect.exit);
          if (Exit.isFailure(streamExit)) {
            if (!res.destroyed) {
              res.destroy();
            }
            return;
          }
          if (!res.writableEnded) {
            res.end();
          }
          return;
        }

        if (url.pathname === LOCAL_FILE_ROUTE_PATH) {
          const requestedPath = normalizeRequestedLocalFilePath(
            url.searchParams.get("path")?.trim() ?? "",
          );
          if (requestedPath.length === 0) {
            respond(400, { "Content-Type": "text/plain" }, "Missing local file path");
            return;
          }
          if (!path.isAbsolute(requestedPath)) {
            respond(400, { "Content-Type": "text/plain" }, "Local file path must be absolute");
            return;
          }

          const fileInfo = yield* fileSystem
            .stat(requestedPath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!fileInfo || fileInfo.type !== "File") {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }

          const contentType = Mime.getType(requestedPath) ?? "application/octet-stream";
          if (!contentType.startsWith("image/")) {
            respond(415, { "Content-Type": "text/plain" }, "Local file is not an image");
            return;
          }

          const data = yield* fileSystem
            .readFile(requestedPath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!data) {
            respond(500, { "Content-Type": "text/plain" }, "Internal Server Error");
            return;
          }
          respond(
            200,
            {
              "Content-Type": contentType,
              "Cache-Control": "no-store",
            },
            data,
          );
          return;
        }

        if (url.pathname === JH_RUNTIME_CONFIG_ROUTE_PATH) {
          const jhRuntimeConfig = yield* loadJhRuntimeFeatureFlags();
          respond(
            200,
            {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
              "Access-Control-Allow-Origin": "*",
            },
            JSON.stringify(jhRuntimeConfig),
          );
          return;
        }

        if (url.pathname === JH_THREAD_COMPOSER_ROUTE_PATH) {
          const commonHeaders = {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          };
          if (req.method === "OPTIONS") {
            respond(204, {
              ...commonHeaders,
              "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            });
            return;
          }

          const threadIdParam = url.searchParams.get("thread_id")?.trim() ?? "";

          if (req.method === "GET") {
            if (threadIdParam.length === 0) {
              respond(
                400,
                commonHeaders,
                JSON.stringify({ error: "Missing required thread_id query parameter." }),
              );
              return;
            }
            const normalizedThreadId = ThreadId.makeUnsafe(threadIdParam);
            const existingThread = yield* findActiveThread({ threadId: normalizedThreadId });
            if (!existingThread) {
              respond(404, commonHeaders, JSON.stringify({ error: "Thread not found." }));
              return;
            }
            const state = yield* readJhComposerDraftState({
              stateDir: serverConfig.stateDir,
              fileSystem,
              path,
              threadId: normalizedThreadId,
            });
            respond(200, commonHeaders, JSON.stringify(state));
            return;
          }

          if (req.method === "POST") {
            const requestBodyText = yield* Effect.tryPromise({
              try: () => readHttpRequestBody(req),
              catch: () =>
                new RouteRequestError({
                  message: "Failed to read composer prefill request body.",
                }),
            });
            const parsedRequestBody = decodeJhComposerPrefillRequest(requestBodyText);
            if (!parsedRequestBody) {
              respond(400, commonHeaders, JSON.stringify({ error: "Invalid composer prefill body." }));
              return;
            }
            const existingThread = yield* findActiveThread({
              threadId: parsedRequestBody.threadId,
              projectId: parsedRequestBody.projectId,
            });
            if (!existingThread) {
              respond(
                404,
                commonHeaders,
                JSON.stringify({ error: "Thread not found for the supplied project_id." }),
              );
              return;
            }
            const entry = yield* stageJhComposerPrefill(parsedRequestBody);
            respond(
              200,
              commonHeaders,
              JSON.stringify({
                ok: true,
                draftId: entry.draftId,
                revision: entry.revision,
              }),
            );
            return;
          }

          if (req.method === "DELETE") {
            if (threadIdParam.length === 0) {
              respond(
                400,
                commonHeaders,
                JSON.stringify({ error: "Missing required thread_id query parameter." }),
              );
              return;
            }
            const normalizedThreadId = ThreadId.makeUnsafe(threadIdParam);
            const clearResult = yield* clearJhComposerDraftState({
              stateDir: serverConfig.stateDir,
              fileSystem,
              path,
              threadId: normalizedThreadId,
            });
            yield* pushBus.publishAll(WS_CHANNELS.jhComposerPrefillUpdated, {
              threadId: normalizedThreadId,
              draftId: null,
              revision: clearResult.revision,
              cleared: true,
              updatedAt: clearResult.updatedAt,
            });
            respond(
              200,
              commonHeaders,
              JSON.stringify({
                ok: true,
                revision: clearResult.revision,
              }),
            );
            return;
          }

          respond(405, commonHeaders, JSON.stringify({ error: "Method not allowed." }));
          return;
        }

        if (url.pathname === JH_SPAWN_ROUTE_PATH) {
          const commonHeaders = {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          };
          if (req.method === "OPTIONS") {
            respond(204, {
              ...commonHeaders,
              "Access-Control-Allow-Methods": "POST,OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            });
            return;
          }

          if (req.method !== "POST") {
            respond(405, commonHeaders, JSON.stringify({ error: "Method not allowed." }));
            return;
          }

          const requestBodyText = yield* Effect.tryPromise({
            try: () => readHttpRequestBody(req),
            catch: () =>
              new RouteRequestError({
                message: "Failed to read JH spawn request body.",
              }),
          });
          const parsedRequestBody = decodeJhSpawnRequest(requestBodyText);
          if (!parsedRequestBody) {
            respond(400, commonHeaders, JSON.stringify({ error: "Invalid spawn body." }));
            return;
          }

          const spawnResult = yield* performJhSpawn(parsedRequestBody);
          respond(200, commonHeaders, JSON.stringify(spawnResult));
          return;
        }

        if (url.pathname === JH_SIDEBAR_PROJECT_ROUTE_PATH) {
          const commonHeaders = {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          };
          if (req.method === "OPTIONS") {
            respond(204, {
              ...commonHeaders,
              "Access-Control-Allow-Methods": "POST,OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            });
            return;
          }

          if (req.method !== "POST") {
            respond(405, commonHeaders, JSON.stringify({ error: "Method not allowed." }));
            return;
          }

          const requestBodyText = yield* Effect.tryPromise({
            try: () => readHttpRequestBody(req),
            catch: () =>
              new RouteRequestError({
                message: "Failed to read JH sidebar project request body.",
              }),
          });
          const parsedRequestBody = decodeJhSidebarProjectVisibilityRequest(requestBodyText);
          if (!parsedRequestBody) {
            respond(400, commonHeaders, JSON.stringify({ error: "Invalid sidebar project body." }));
            return;
          }

          const normalizedWorkspaceRoot =
            parsedRequestBody.workspaceRoot !== undefined
              ? yield* normalizeProjectWorkspaceRoot(parsedRequestBody.workspaceRoot)
              : undefined;
          const projectById =
            parsedRequestBody.projectId !== undefined
              ? yield* findActiveProject({ projectId: parsedRequestBody.projectId })
              : null;
          const projectByWorkspace =
            normalizedWorkspaceRoot !== undefined
              ? yield* findActiveProject({ workspaceRoot: normalizedWorkspaceRoot })
              : null;
          if (projectById && projectByWorkspace && projectById.id !== projectByWorkspace.id) {
            respond(
              400,
              commonHeaders,
              JSON.stringify({
                error: "Supplied projectId and workspaceRoot resolve to different active projects.",
              }),
            );
            return;
          }
          const resolvedProject = projectById ?? projectByWorkspace;
          if (!resolvedProject) {
            respond(404, commonHeaders, JSON.stringify({ error: "Project not found." }));
            return;
          }

          const result = yield* publishJhSidebarProjectVisibility({
            projectId: resolvedProject.id,
            workspaceRoot: resolvedProject.workspaceRoot,
            expanded: parsedRequestBody.expanded,
          });
          respond(200, commonHeaders, JSON.stringify(result));
          return;
        }

        if (
          yield* tryHandleJhLoopRoute({
            req,
            url,
            jhLoopRuntime,
            respond,
            readRequestBody: () =>
              Effect.tryPromise({
                try: () => readHttpRequestBody(req),
                catch: () =>
                  new RouteRequestError({
                    message:
                      req.method === "PATCH"
                        ? "Failed to read JH loop control request body."
                        : "Failed to read JH loop create request body.",
                  }),
              }),
          })
        ) {
          return;
        }

        if (url.pathname === JH_NOTIFY_ROUTE_PATH) {
          const commonHeaders = {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          };
          if (req.method === "OPTIONS") {
            respond(204, {
              ...commonHeaders,
              "Access-Control-Allow-Methods": "POST,OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            });
            return;
          }

          if (req.method !== "POST") {
            respond(405, commonHeaders, JSON.stringify({ error: "Method not allowed." }));
            return;
          }

          const requestBodyText = yield* Effect.tryPromise({
            try: () => readHttpRequestBody(req),
            catch: () =>
              new RouteRequestError({
                message: "Failed to read JH notification request body.",
              }),
          });
          const parsedRequestBody = decodeJhNotificationTriggerRequest(requestBodyText);
          if (!parsedRequestBody) {
            respond(400, commonHeaders, JSON.stringify({ error: "Invalid notification body." }));
            return;
          }

          const tag =
            parsedRequestBody.tag ??
            `jh-notify:${parsedRequestBody.threadId ?? "global"}:${Date.now()}`;
          yield* pushBus.publishAll(WS_CHANNELS.jhNotificationTriggered, {
            title: parsedRequestBody.title,
            body: parsedRequestBody.body,
            ...(parsedRequestBody.subtitle ? { subtitle: parsedRequestBody.subtitle } : {}),
            ...(parsedRequestBody.threadId ? { threadId: parsedRequestBody.threadId } : {}),
            ...(parsedRequestBody.projectId ? { projectId: parsedRequestBody.projectId } : {}),
            ...(parsedRequestBody.iconUrl ? { iconUrl: parsedRequestBody.iconUrl } : {}),
            ...(parsedRequestBody.glyph ? { glyph: parsedRequestBody.glyph } : {}),
            ...(parsedRequestBody.accent ? { accent: parsedRequestBody.accent } : {}),
            ...(parsedRequestBody.tone ? { tone: parsedRequestBody.tone } : {}),
            ...(typeof parsedRequestBody.requireInteraction === "boolean"
              ? { requireInteraction: parsedRequestBody.requireInteraction }
              : {}),
            ...(parsedRequestBody.actions ? { actions: parsedRequestBody.actions } : {}),
            tag,
          });
          respond(
            200,
            commonHeaders,
            JSON.stringify({
              ok: true,
              tag,
            }),
          );
          return;
        }

        // In dev mode, redirect to Vite dev server
        if (devUrl) {
          respond(302, { Location: devUrl.href });
          return;
        }

        // Serve static files from the web app build
        if (!staticDir) {
          respond(
            503,
            { "Content-Type": "text/plain" },
            "No static directory configured and no dev URL set.",
          );
          return;
        }

        const staticRoot = path.resolve(staticDir);
        const staticRequestPath = url.pathname === "/" ? "/index.html" : url.pathname;
        const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
        const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
        const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
        const hasPathTraversalSegment = staticRelativePath.startsWith("..");
        if (
          staticRelativePath.length === 0 ||
          hasRawLeadingParentSegment ||
          hasPathTraversalSegment ||
          staticRelativePath.includes("\0")
        ) {
          respond(400, { "Content-Type": "text/plain" }, "Invalid static file path");
          return;
        }

        const isWithinStaticRoot = (candidate: string) =>
          candidate === staticRoot ||
          candidate.startsWith(
            staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`,
          );

        let filePath = path.resolve(staticRoot, staticRelativePath);
        if (!isWithinStaticRoot(filePath)) {
          respond(400, { "Content-Type": "text/plain" }, "Invalid static file path");
          return;
        }

        const ext = path.extname(filePath);
        if (!ext) {
          filePath = path.resolve(filePath, "index.html");
          if (!isWithinStaticRoot(filePath)) {
            respond(400, { "Content-Type": "text/plain" }, "Invalid static file path");
            return;
          }
        }

        const fileInfo = yield* fileSystem
          .stat(filePath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!fileInfo || fileInfo.type !== "File") {
          const indexPath = path.resolve(staticRoot, "index.html");
          const indexData = yield* fileSystem
            .readFile(indexPath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!indexData) {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }
          respond(200, { "Content-Type": "text/html; charset=utf-8" }, indexData);
          return;
        }

        const contentType = Mime.getType(filePath) ?? "application/octet-stream";
        const data = yield* fileSystem
          .readFile(filePath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!data) {
          respond(500, { "Content-Type": "text/plain" }, "Internal Server Error");
          return;
        }
        respond(200, { "Content-Type": contentType }, data);
      }).pipe(Effect.provideService(Path.Path, path)),
    ).catch((error) => {
      logger.error("http request handler failed", {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
      });
      if (!res.headersSent) {
        respond(500, { "Content-Type": "text/plain" }, "Internal Server Error");
      }
    });
  });
  httpServer.on("error", (error) => {
    logger.error("http server error", {
      message: error.message,
      stack: error.stack,
    });
  });
  httpServer.on("close", () => {
    logger.warn("http server closed", {
      port,
      host,
    });
  });

  // WebSocket server — upgrades from the HTTP server
  const wss = new WebSocketServer({ noServer: true });

  const closeWebSocketServer = Effect.callback<void, ServerLifecycleError>((resume) => {
    wss.close((error) => {
      if (error && !isServerNotRunningError(error)) {
        resume(
          Effect.fail(
            new ServerLifecycleError({ operation: "closeWebSocketServer", cause: error }),
          ),
        );
      } else {
        resume(Effect.void);
      }
    });
  });

  const closeAllClients = Ref.get(clients).pipe(
    Effect.flatMap(Effect.forEach((client) => Effect.sync(() => client.close()))),
    Effect.flatMap(() => Ref.set(clients, new Set())),
  );

  const listenOptions = host ? { host, port } : { port };

  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionReadModelQuery = yield* ProjectionSnapshotQuery;
  const checkpointDiffQuery = yield* CheckpointDiffQuery;
  const orchestrationReactor = yield* OrchestrationReactor;
  const jhLoopRuntime = yield* JhLoopRuntimeService;
  const { openInEditor } = yield* Open;

  const subscriptionsScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(subscriptionsScope, Exit.void));

  yield* Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
    pushBus.publishAll(ORCHESTRATION_WS_CHANNELS.domainEvent, event),
  ).pipe(Effect.forkIn(subscriptionsScope));

  yield* Stream.runForEach(keybindingsManager.streamChanges, (event) =>
    pushBus.publishAll(WS_CHANNELS.serverConfigUpdated, {
      issues: event.issues,
      providers: providerStatuses,
    }),
  ).pipe(Effect.forkIn(subscriptionsScope));

  yield* Scope.provide(orchestrationReactor.start, subscriptionsScope);
  yield* Scope.provide(jhLoopRuntime.start, subscriptionsScope);
  yield* readiness.markOrchestrationSubscriptionsReady;

  let welcomeBootstrapProjectId: ProjectId | undefined;
  let welcomeBootstrapThreadId: ThreadId | undefined;

  if (autoBootstrapProjectFromCwd) {
    yield* Effect.gen(function* () {
      const snapshot = yield* projectionReadModelQuery.getSnapshot();
      const existingProject = snapshot.projects.find(
        (project) => project.workspaceRoot === cwd && project.deletedAt === null,
      );
      let bootstrapProjectId: ProjectId;
      let bootstrapProjectDefaultModel: string;

      if (!existingProject) {
        const createdAt = new Date().toISOString();
        bootstrapProjectId = ProjectId.makeUnsafe(crypto.randomUUID());
        const bootstrapProjectTitle = path.basename(cwd) || "project";
        bootstrapProjectDefaultModel = "gpt-5-codex";
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          projectId: bootstrapProjectId,
          title: bootstrapProjectTitle,
          workspaceRoot: cwd,
          defaultModel: bootstrapProjectDefaultModel,
          createdAt,
        });
      } else {
        bootstrapProjectId = existingProject.id;
        bootstrapProjectDefaultModel = existingProject.defaultModel ?? "gpt-5-codex";
      }

      const existingThread = snapshot.threads.find(
        (thread) => thread.projectId === bootstrapProjectId && thread.deletedAt === null,
      );
      if (!existingThread) {
        const createdAt = new Date().toISOString();
        const threadId = ThreadId.makeUnsafe(crypto.randomUUID());
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          threadId,
          projectId: bootstrapProjectId,
          title: "New thread",
          model: bootstrapProjectDefaultModel,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        welcomeBootstrapProjectId = bootstrapProjectId;
        welcomeBootstrapThreadId = threadId;
      } else {
        welcomeBootstrapProjectId = bootstrapProjectId;
        welcomeBootstrapThreadId = existingThread.id;
      }
    }).pipe(
      Effect.mapError(
        (cause) => new ServerLifecycleError({ operation: "autoBootstrapProject", cause }),
      ),
    );
  }

  const runtimeServices = yield* Effect.services<
    ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
  >();
  const runPromise = Effect.runPromiseWith(runtimeServices);

  const unsubscribeTerminalEvents = yield* terminalManager.subscribe(
    (event) => void Effect.runPromise(pushBus.publishAll(WS_CHANNELS.terminalEvent, event)),
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => unsubscribeTerminalEvents()));
  yield* readiness.markTerminalSubscriptionsReady;

  yield* NodeHttpServer.make(() => httpServer, listenOptions).pipe(
    Effect.mapError((cause) => new ServerLifecycleError({ operation: "httpServerListen", cause })),
  );
  yield* readiness.markHttpListening;

  yield* Effect.addFinalizer(() =>
    Effect.all([closeAllClients, closeWebSocketServer.pipe(Effect.ignoreCause({ log: true }))]),
  );

  const routeRequest = Effect.fnUntraced(function* (ws: WebSocket, request: WebSocketRequest) {
    switch (request.body._tag) {
      case ORCHESTRATION_WS_METHODS.getSnapshot:
        return yield* projectionReadModelQuery.getSnapshot();

      case ORCHESTRATION_WS_METHODS.dispatchCommand: {
        const { command } = request.body;
        return yield* dispatchClientCommand(command);
      }

      case ORCHESTRATION_WS_METHODS.getTurnDiff: {
        const body = stripRequestTag(request.body);
        return yield* checkpointDiffQuery.getTurnDiff(body);
      }

      case ORCHESTRATION_WS_METHODS.getFullThreadDiff: {
        const body = stripRequestTag(request.body);
        return yield* checkpointDiffQuery.getFullThreadDiff(body);
      }

      case ORCHESTRATION_WS_METHODS.replayEvents: {
        const { fromSequenceExclusive } = request.body;
        return yield* Stream.runCollect(
          orchestrationEngine.readEvents(
            clamp(fromSequenceExclusive, {
              maximum: Number.MAX_SAFE_INTEGER,
              minimum: 0,
            }),
          ),
        ).pipe(Effect.map((events) => Array.from(events)));
      }

      case WS_METHODS.projectsSearchEntries: {
        const body = stripRequestTag(request.body);
        return yield* Effect.tryPromise({
          try: () => searchWorkspaceEntries(body),
          catch: (cause) =>
            new RouteRequestError({
              message: `Failed to search workspace entries: ${String(cause)}`,
            }),
        });
      }

      case WS_METHODS.projectsWriteFile: {
        const body = stripRequestTag(request.body);
        const target = yield* resolveWorkspaceWritePath({
          workspaceRoot: body.cwd,
          relativePath: body.relativePath,
          path,
        });
        yield* fileSystem
          .makeDirectory(path.dirname(target.absolutePath), { recursive: true })
          .pipe(
            Effect.mapError(
              (cause) =>
                new RouteRequestError({
                  message: `Failed to prepare workspace path: ${String(cause)}`,
                }),
            ),
          );
        yield* fileSystem.writeFileString(target.absolutePath, body.contents).pipe(
          Effect.mapError(
            (cause) =>
              new RouteRequestError({
                message: `Failed to write workspace file: ${String(cause)}`,
              }),
          ),
        );
        return { relativePath: target.relativePath };
      }

      case WS_METHODS.shellOpenInEditor: {
        const body = stripRequestTag(request.body);
        return yield* openInEditor(body);
      }

      case WS_METHODS.gitStatus: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.status(body);
      }

      case WS_METHODS.gitPull: {
        const body = stripRequestTag(request.body);
        return yield* git.pullCurrentBranch(body.cwd);
      }

      case WS_METHODS.gitRunStackedAction: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.runStackedAction(body, {
          actionId: body.actionId,
          progressReporter: {
            publish: (event) =>
              pushBus.publishClient(ws, WS_CHANNELS.gitActionProgress, event).pipe(Effect.asVoid),
          },
        });
      }

      case WS_METHODS.gitResolvePullRequest: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.resolvePullRequest(body);
      }

      case WS_METHODS.gitPreparePullRequestThread: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.preparePullRequestThread(body);
      }

      case WS_METHODS.gitListBranches: {
        const body = stripRequestTag(request.body);
        return yield* git.listBranches(body);
      }

      case WS_METHODS.gitCreateWorktree: {
        const body = stripRequestTag(request.body);
        return yield* git.createWorktree(body);
      }

      case WS_METHODS.gitRemoveWorktree: {
        const body = stripRequestTag(request.body);
        return yield* git.removeWorktree(body);
      }

      case WS_METHODS.gitCreateBranch: {
        const body = stripRequestTag(request.body);
        return yield* git.createBranch(body);
      }

      case WS_METHODS.gitCheckout: {
        const body = stripRequestTag(request.body);
        return yield* Effect.scoped(git.checkoutBranch(body));
      }

      case WS_METHODS.gitInit: {
        const body = stripRequestTag(request.body);
        return yield* git.initRepo(body);
      }

      case WS_METHODS.terminalOpen: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.open(body);
      }

      case WS_METHODS.terminalWrite: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.write(body);
      }

      case WS_METHODS.terminalResize: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.resize(body);
      }

      case WS_METHODS.terminalClear: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.clear(body);
      }

      case WS_METHODS.terminalRestart: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.restart(body);
      }

      case WS_METHODS.terminalClose: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.close(body);
      }

      case WS_METHODS.serverGetConfig:
        const keybindingsConfig = yield* keybindingsManager.loadConfigState;
        return {
          cwd,
          keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers: providerStatuses,
          availableEditors,
        };

      case WS_METHODS.serverUpsertKeybinding: {
        const body = stripRequestTag(request.body);
        const keybindingsConfig = yield* keybindingsManager.upsertKeybindingRule(body);
        return { keybindings: keybindingsConfig, issues: [] };
      }

      default: {
        const _exhaustiveCheck: never = request.body;
        return yield* new RouteRequestError({
          message: `Unknown method: ${String(_exhaustiveCheck)}`,
        });
      }
    }
  });

  const handleMessage = Effect.fnUntraced(function* (ws: WebSocket, raw: unknown) {
    const sendWsResponse = (response: WsResponseMessage) =>
      encodeWsResponse(response).pipe(
        Effect.tap((encodedResponse) => Effect.sync(() => ws.send(encodedResponse))),
        Effect.asVoid,
      );

    const messageText = websocketRawToString(raw);
    if (messageText === null) {
      return yield* sendWsResponse({
        id: "unknown",
        error: { message: "Invalid request format: Failed to read message" },
      });
    }

    const request = decodeWebSocketRequest(messageText);
    if (Result.isFailure(request)) {
      return yield* sendWsResponse({
        id: "unknown",
        error: { message: `Invalid request format: ${formatSchemaError(request.failure)}` },
      });
    }

    const result = yield* Effect.exit(routeRequest(ws, request.success));
    if (Exit.isFailure(result)) {
      return yield* sendWsResponse({
        id: request.success.id,
        error: { message: Cause.pretty(result.cause) },
      });
    }

    return yield* sendWsResponse({
      id: request.success.id,
      result: result.value,
    });
  });

  httpServer.on("upgrade", (request, socket, head) => {
    socket.on("error", () => {}); // Prevent unhandled `EPIPE`/`ECONNRESET` from crashing the process if the client disconnects mid-handshake

    if (authToken) {
      let providedToken: string | null = null;
      try {
        const url = new URL(request.url ?? "/", `http://localhost:${port}`);
        providedToken = url.searchParams.get("token");
      } catch {
        rejectUpgrade(socket, 400, "Invalid WebSocket URL");
        return;
      }

      if (providedToken !== authToken) {
        rejectUpgrade(socket, 401, "Unauthorized WebSocket connection");
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws) => {
    const segments = cwd.split(/[/\\]/).filter(Boolean);
    const projectName = segments[segments.length - 1] ?? "project";

    const welcomeData = {
      cwd,
      projectName,
      ...(welcomeBootstrapProjectId ? { bootstrapProjectId: welcomeBootstrapProjectId } : {}),
      ...(welcomeBootstrapThreadId ? { bootstrapThreadId: welcomeBootstrapThreadId } : {}),
    };
    // Send welcome before adding to broadcast set so publishAll calls
    // cannot reach this client before the welcome arrives.
    void runPromise(
      readiness.awaitServerReady.pipe(
        Effect.flatMap(() => pushBus.publishClient(ws, WS_CHANNELS.serverWelcome, welcomeData)),
        Effect.flatMap((delivered) =>
          delivered ? Ref.update(clients, (clients) => clients.add(ws)) : Effect.void,
        ),
      ),
    );

    ws.on("message", (raw) => {
      void runPromise(handleMessage(ws, raw).pipe(Effect.ignoreCause({ log: true })));
    });

    ws.on("close", () => {
      void runPromise(
        Ref.update(clients, (clients) => {
          clients.delete(ws);
          return clients;
        }),
      );
    });

    ws.on("error", () => {
      void runPromise(
        Ref.update(clients, (clients) => {
          clients.delete(ws);
          return clients;
        }),
      );
    });
  });

  return httpServer;
});

export const ServerLive = Layer.succeed(Server, {
  start: createServer(),
  stopSignal: Effect.never,
} satisfies ServerShape);
