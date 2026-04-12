import crypto from "node:crypto";

import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  type OrchestrationCustomIndicator,
  type OrchestrationReadModel,
  type OrchestrationThread,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect } from "effect";

import type { JhLoopDefinition } from "../persistence/Services/JhLoopRuntime.ts";

type DispatchCommand = (command: any) => Effect.Effect<void, unknown>;

type SnapshotReader = () => Effect.Effect<OrchestrationReadModel, unknown>;

type WaitUntilReady = (thread: OrchestrationThread) => boolean;

export function createJhLoopOrchestration(input: {
  dispatchCommand: DispatchCommand;
  getSnapshot: SnapshotReader;
}) {
  const findProjectById = (snapshot: OrchestrationReadModel, projectId: ProjectId) =>
    snapshot.projects.find((project) => project.id === projectId && project.deletedAt === null) ?? null;

  const findProjectByWorkspaceRoot = (snapshot: OrchestrationReadModel, workspaceRoot: string) =>
    snapshot.projects.find((project) => project.workspaceRoot === workspaceRoot && project.deletedAt === null) ?? null;

  const getThreadById = (snapshot: OrchestrationReadModel, threadId: ThreadId) =>
    snapshot.threads.find((thread) => thread.id === threadId && thread.deletedAt === null) ?? null;

  const getThreadByTitle = (snapshot: OrchestrationReadModel, projectId: ProjectId, title: string) =>
    snapshot.threads.find(
      (thread) => thread.projectId === projectId && thread.title === title && thread.deletedAt === null,
    ) ?? null;

  const ensureProject = (definition: JhLoopDefinition) => Effect.gen(function* () {
    const snapshot = yield* input.getSnapshot();
    const byId = findProjectById(snapshot, definition.runtimeProjectId);
    if (byId) {
      return byId;
    }

    const createdAt = new Date().toISOString();
    yield* input.dispatchCommand({
      type: "project.create",
      commandId: CommandId.makeUnsafe(crypto.randomUUID()),
      projectId: definition.runtimeProjectId,
      title: definition.projectTitle,
      workspaceRoot: definition.workspaceRoot,
      defaultModel: definition.workerModel,
      createdAt,
    } as const);

    const nextSnapshot = yield* input.getSnapshot();
    const createdProject = findProjectById(nextSnapshot, definition.runtimeProjectId);
    if (!createdProject) {
      return yield* Effect.fail(new Error(`Failed to create loop project '${definition.projectTitle}'.`));
    }
    return createdProject;
  });

  const ensureThread = (threadInput: {
    projectId: ProjectId;
    title: string;
    model: string;
    runtimeMode?: JhLoopDefinition["workerRuntimeMode"];
    interactionMode?: JhLoopDefinition["workerInteractionMode"];
  }) => Effect.gen(function* () {
    const snapshot = yield* input.getSnapshot();
    const existing = getThreadByTitle(snapshot, threadInput.projectId, threadInput.title);
    if (existing) {
      return existing;
    }

    const createdAt = new Date().toISOString();
    const threadId = ThreadId.makeUnsafe(crypto.randomUUID());
    yield* input.dispatchCommand({
      type: "thread.create",
      commandId: CommandId.makeUnsafe(crypto.randomUUID()),
      threadId,
      projectId: threadInput.projectId,
      title: threadInput.title,
      model: threadInput.model,
      runtimeMode: threadInput.runtimeMode ?? DEFAULT_RUNTIME_MODE,
      interactionMode: threadInput.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt,
    } as const);

    const nextSnapshot = yield* input.getSnapshot();
    const createdThread = getThreadById(nextSnapshot, threadId);
    if (!createdThread) {
      return yield* Effect.fail(new Error(`Failed to create loop thread '${threadInput.title}'.`));
    }
    return createdThread;
  });

  const setThreadIndicator = (
    thread: OrchestrationThread | null,
    indicator: OrchestrationCustomIndicator,
  ) => Effect.gen(function* () {
    if (!thread) {
      return null;
    }

    yield* input.dispatchCommand({
      type: "thread.meta.update",
      commandId: CommandId.makeUnsafe(crypto.randomUUID()),
      threadId: thread.id,
      customIndicator: indicator,
    } as const);

    const snapshot = yield* input.getSnapshot();
    return getThreadById(snapshot, thread.id);
  });

  const publishProjectIndicator = (
    projectId: ProjectId,
    indicator: OrchestrationCustomIndicator | null,
  ) => Effect.gen(function* () {
    const snapshot = yield* input.getSnapshot();
    const project = findProjectById(snapshot, projectId);
    if (!project) {
      return;
    }

    yield* input.dispatchCommand({
      type: "project.meta.update",
      commandId: CommandId.makeUnsafe(crypto.randomUUID()),
      projectId,
      customIndicator: indicator,
    } as const);
  });

  const startThreadTurn = (
    thread: OrchestrationThread,
    prompt: string,
    model: string,
    runtimeMode: JhLoopDefinition["workerRuntimeMode"],
    interactionMode: JhLoopDefinition["workerInteractionMode"],
  ) => Effect.gen(function* () {
    const createdAt = new Date().toISOString();
    const messageId = MessageId.makeUnsafe(crypto.randomUUID());
    yield* input.dispatchCommand({
      type: "thread.turn.start",
      commandId: CommandId.makeUnsafe(crypto.randomUUID()),
      threadId: thread.id,
      message: {
        messageId,
        role: "user",
        text: prompt,
        attachments: [],
      },
      model,
      assistantDeliveryMode: "buffered",
      runtimeMode: runtimeMode ?? DEFAULT_RUNTIME_MODE,
      interactionMode: interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
      createdAt,
    } as const);

    return {
      threadId: thread.id,
      messageId,
      createdAt,
      text: prompt,
    };
  });

  const interruptThreadTurn = (thread: OrchestrationThread) =>
    input.dispatchCommand({
      type: "thread.turn.interrupt",
      commandId: CommandId.makeUnsafe(crypto.randomUUID()),
      threadId: thread.id,
      createdAt: new Date().toISOString(),
    } as const);

  const waitForThreadReadyWithin = (
    threadId: ThreadId,
    deadlineMs: number,
    isThreadReady: WaitUntilReady,
  ) => Effect.gen(function* () {
    while (Date.now() < deadlineMs) {
      const snapshot = yield* input.getSnapshot();
      const thread = getThreadById(snapshot, threadId);
      if (!thread) {
        return null;
      }
      if (isThreadReady(thread)) {
        return thread;
      }
      yield* Effect.sleep("250 millis");
    }
    return null;
  });

  return {
    ensureProject,
    ensureThread,
    findProjectById,
    findProjectByWorkspaceRoot,
    getThreadById,
    getThreadByTitle,
    interruptThreadTurn,
    publishProjectIndicator,
    setThreadIndicator,
    startThreadTurn,
    waitForThreadReadyWithin,
  };
}
