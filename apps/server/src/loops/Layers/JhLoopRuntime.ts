import crypto from "node:crypto";
import os from "node:os";

import {
  CommandId,
  type JhLoopBinding as JhLoopBindingContract,
  type JhLoopControlRequest,
  type JhLoopControlResult,
  type JhLoopCreateRequest,
  type JhLoopCreateResult,
  type JhLoopRequestedState,
  type JhLoopStatusResult,
  type JhLoopType,
  OrchestrationCustomIndicator,
  type OrchestrationMessage,
  type OrchestrationThread,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";
import { FileSystem, Path } from "effect";

import { JhLoopRuntimeRepository } from "../../persistence/Services/JhLoopRuntime.ts";
import type {
  JhLoopDefinition,
  JhLoopRecord,
  JhLoopRuntimeState,
  JhLoopWorkerRosterEntry,
  JhLoopWorkerSpec,
} from "../../persistence/Services/JhLoopRuntime.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { createJhLoopOrchestration } from "../jhLoopOrchestration.ts";
import {
  JhLoopRuntimeService,
  type JhLoopRuntimeServiceShape,
} from "../Services/JhLoopRuntime.ts";

const LEGACY_SUPERVISOR_DIR = ["git", "obsidian", "ai-data", "runtime", "jh-ai-supervisor"] as const;
const ACTIVE_LOOP_PHASES = new Set([
  "worker-running",
  "waiting-for-worker",
  "supervisor-running",
  "waiting-for-supervisor",
  "worker-steerable",
]);

const DEFAULT_INTERVAL_SECONDS = 20;
const DEFAULT_ACTIVE_POLL_SECONDS = 1;
const DEFAULT_FAST_CHAIN_WINDOW_MS = 4000;
const DEFAULT_FAST_CHAIN_MAX_TRANSITIONS = 4;

type MutableLoopRecord = {
  definition: any;
  runtimeState: any;
};

type LoopContext = {
  projectId: ProjectId;
  projectTitle: string;
  workerSpec: JhLoopWorkerSpec | null;
  workerThread: OrchestrationThread | null;
  supervisorThread: OrchestrationThread | null;
  workerThreadsByKey: Map<string, OrchestrationThread>;
  stopped: boolean;
};

type SupervisorDecision = {
  decision: string;
  completion: string;
  nextWorkerKey: string | null;
  nextWorkerPrompt: string | null;
  workerStatusLabel: string | null;
  workerStatusTone: string | null;
  supervisorStatusLabel: string | null;
  supervisorStatusTone: string | null;
};

function asMutable(record: JhLoopRecord): MutableLoopRecord {
  return {
    definition: { ...record.definition, workerThreadIds: [...record.definition.workerThreadIds] },
    runtimeState: {
      ...record.runtimeState,
      workerRoster: [...record.runtimeState.workerRoster],
      ignoredControlMessageKeys: [...record.runtimeState.ignoredControlMessageKeys],
      ignoredControlMessageFingerprints: [...record.runtimeState.ignoredControlMessageFingerprints],
    },
  };
}

function resolveThreadStatusTone(input: string | null | undefined): OrchestrationCustomIndicator["tone"] {
  const allowed: Array<OrchestrationCustomIndicator["tone"]> = [
    "slate",
    "gray",
    "red",
    "orange",
    "amber",
    "yellow",
    "lime",
    "green",
    "emerald",
    "teal",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
  ];
  if (!input) {
    return "sky";
  }
  const normalized = input.trim().toLowerCase() as OrchestrationCustomIndicator["tone"];
  return allowed.includes(normalized) ? normalized : "sky";
}

function isActiveLoopPhase(phase: string): boolean {
  return ACTIVE_LOOP_PHASES.has(phase);
}

function getLatestAssistantMessage(thread: OrchestrationThread | null): OrchestrationMessage | null {
  if (!thread) {
    return null;
  }
  const assistantMessages = thread.messages.filter((message) => message.role === "assistant");
  return assistantMessages.at(-1) ?? null;
}

function getLatestUserMessage(thread: OrchestrationThread | null): OrchestrationMessage | null {
  if (!thread) {
    return null;
  }
  const userMessages = thread.messages.filter((message) => message.role === "user");
  return userMessages.at(-1) ?? null;
}

function newAssistantPreview(thread: OrchestrationThread | null): string | null {
  const assistant = getLatestAssistantMessage(thread);
  if (!assistant) {
    return null;
  }
  return assistant.text.length > 900 ? assistant.text.slice(0, 900) : assistant.text;
}

function isThreadSteerable(thread: OrchestrationThread | null): boolean {
  if (!thread) {
    return false;
  }
  if (!thread.session) {
    if (!thread.latestTurn || !thread.latestTurn.state) {
      return true;
    }
    return ["completed", "failed", "cancelled", "interrupted", "error"].includes(
      thread.latestTurn.state,
    );
  }
  if (thread.session.status !== "ready") {
    return false;
  }
  if (thread.session.activeTurnId) {
    return false;
  }
  if (thread.latestTurn?.state === "running") {
    return false;
  }
  return true;
}

function hasProjectedAssistantForLatestTurn(thread: OrchestrationThread | null): boolean {
  if (!thread?.latestTurn?.assistantMessageId) {
    return false;
  }
  const assistant = getLatestAssistantMessage(thread);
  if (!assistant) {
    return false;
  }
  return (
    assistant.id === thread.latestTurn.assistantMessageId &&
    assistant.turnId === thread.latestTurn.turnId &&
    thread.latestTurn.state === "completed"
  );
}

function hasPendingWorkerPrompt(record: MutableLoopRecord, worker: OrchestrationThread | null): boolean {
  if (!worker || !record.runtimeState.pendingWorkerPromptMessageId) {
    return false;
  }
  return getLatestUserMessage(worker)?.id === record.runtimeState.pendingWorkerPromptMessageId;
}

function loopObjective(definition: JhLoopDefinition, workerSpec: JhLoopWorkerSpec | null): string {
  return workerSpec?.objective?.trim() || definition.objective;
}

function resolveNextRunAt(definition: JhLoopDefinition, runtimeState: JhLoopRuntimeState): string | null {
  const delaySeconds = isActiveLoopPhase(runtimeState.phase)
    ? definition.activePollSeconds
    : definition.intervalSeconds;
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

function createJhLoopWorkerSpecs(input: {
  projectTitle: string;
  workerCount: number;
  workerTitlePrefix?: string | undefined;
  workerModel: string;
}): JhLoopWorkerSpec[] {
  const prefix = input.workerTitlePrefix?.trim() || `${input.projectTitle} Worker`;
  return Array.from({ length: input.workerCount }, (_, index) => ({
    key: input.workerCount === 1 ? "primary" : `worker-${index + 1}`,
    title: input.workerCount === 1 ? prefix : `${prefix} ${index + 1}`,
    objective: null,
    initialPrompt: null,
    continuePromptTemplate: null,
    model: input.workerModel,
  }));
}

function getSelectedWorkerSpec(definition: JhLoopDefinition, runtimeState: JhLoopRuntimeState) {
  if (definition.workerSpecs.length === 0) {
    return null;
  }
  if (isActiveLoopPhase(runtimeState.phase) && runtimeState.activeWorkerKey) {
    const active = definition.workerSpecs.find((spec) => spec.key === runtimeState.activeWorkerKey);
    if (active) {
      return active;
    }
  }
  const normalizedIndex = runtimeState.nextWorkerIndex % definition.workerSpecs.length;
  return definition.workerSpecs[normalizedIndex] ?? definition.workerSpecs[0] ?? null;
}

function getNextScheduledWorkerSpec(definition: JhLoopDefinition, runtimeState: JhLoopRuntimeState) {
  if (definition.workerSpecs.length === 0) {
    return null;
  }
  const normalizedIndex = runtimeState.nextWorkerIndex % definition.workerSpecs.length;
  return definition.workerSpecs[normalizedIndex] ?? definition.workerSpecs[0] ?? null;
}

function advanceLoopWorkerCursor(
  definition: JhLoopDefinition,
  runtimeState: any,
  selectedWorkerSpec: JhLoopWorkerSpec | null,
) {
  if (definition.workerSpecs.length === 0 || !selectedWorkerSpec) {
    runtimeState.activeWorkerKey = null;
    runtimeState.nextWorkerIndex = 0;
    return;
  }
  const selectedIndex = definition.workerSpecs.findIndex((spec) => spec.key === selectedWorkerSpec.key);
  const normalizedSelectedIndex = selectedIndex < 0 ? 0 : selectedIndex;
  runtimeState.activeWorkerKey = selectedWorkerSpec.key;
  runtimeState.nextWorkerIndex = (normalizedSelectedIndex + 1) % definition.workerSpecs.length;
}

function updateWorkerRosterEntry(
  runtimeState: any,
  workerSpec: JhLoopWorkerSpec,
  thread: OrchestrationThread | null,
  assistantPreview: string | null,
  selected: boolean,
) {
  const nextEntry: JhLoopWorkerRosterEntry = {
    key: workerSpec.key,
    title: workerSpec.title,
    threadId: thread?.id ?? null,
    lastAssistantSummary:
      assistantPreview ??
      runtimeState.workerRoster.find((entry: any) => entry.key === workerSpec.key)?.lastAssistantSummary ??
      null,
    lastSelectedAt: selected ? new Date().toISOString() : null,
  };
  const existingIndex = runtimeState.workerRoster.findIndex((entry: any) => entry.key === workerSpec.key);
  if (existingIndex >= 0) {
    runtimeState.workerRoster[existingIndex] = {
      ...runtimeState.workerRoster[existingIndex]!,
      ...nextEntry,
      lastSelectedAt:
        selected || !runtimeState.workerRoster[existingIndex]?.lastSelectedAt
          ? nextEntry.lastSelectedAt
          : runtimeState.workerRoster[existingIndex]!.lastSelectedAt,
    };
    return;
  }
  runtimeState.workerRoster.push(nextEntry);
}

function getWorkerInitialPrompt(definition: JhLoopDefinition, workerSpec: JhLoopWorkerSpec | null): string {
  if (workerSpec?.initialPrompt?.trim()) {
    return workerSpec.initialPrompt;
  }
  const workerKey = workerSpec?.key ?? "primary";
  return [
    "You are the worker thread for a long-running autonomous effort in JH Code.",
    "",
    "Worker key:",
    workerKey,
    "",
    "Objective:",
    loopObjective(definition, workerSpec),
    "",
    "Completion criteria:",
    definition.completionCriteria,
    "",
    "Keep making real forward motion and leave concrete evidence of progress, discovery, or verification.",
    "Do not claim completion unless it is actually proven.",
  ].join("\n");
}

function getLoopWorkerRosterSummary(runtimeState: JhLoopRuntimeState): string[] {
  if (runtimeState.workerRoster.length <= 1) {
    return [];
  }
  const lines = ["Managed worker queue:"];
  for (const entry of runtimeState.workerRoster) {
    const status = runtimeState.activeWorkerKey === entry.key ? "active" : "queued";
    if (entry.lastAssistantSummary) {
      const preview =
        entry.lastAssistantSummary.length > 140
          ? `${entry.lastAssistantSummary.slice(0, 140)}...`
          : entry.lastAssistantSummary;
      lines.push(`- ${entry.key}: ${entry.title} [${status}] - latest: ${preview}`);
    } else {
      lines.push(`- ${entry.key}: ${entry.title} [${status}]`);
    }
  }
  return lines;
}

function getSupervisorPrompt(input: {
  definition: JhLoopDefinition;
  runtimeState: JhLoopRuntimeState;
  workerThread: OrchestrationThread | null;
  workerSpec: JhLoopWorkerSpec | null;
  initial: boolean;
}) {
  const preview = newAssistantPreview(input.workerThread);
  const header = input.initial
    ? "You are the supervisor thread for a long-running autonomous effort in JH Code."
    : "Review the worker's latest output and decide the next action.";
  const lines = [
    header,
    "",
    "Objective:",
    input.definition.objective,
    "",
    "Completion criteria:",
    input.definition.completionCriteria,
    "",
    "Use these exact markers:",
    "Decision: GOAL-ACHIEVED | CONTINUE-WORKER | INTERRUPT-WORKER | BLOCKED",
    "Why: ...",
    "Evidence: ...",
    "Next Worker Key: ...",
    "Worker Status Label: ...",
    "Worker Status Tone: ...",
    "Supervisor Status Label: ...",
    "Supervisor Status Tone: ...",
    "Next Worker Prompt:",
    "<plain English prompt text>",
    "Completion Status: COMPLETE | INCOMPLETE | BLOCKED",
  ];
  if (input.workerSpec) {
    lines.push("", "Current worker:", `${input.workerSpec.key}: ${input.workerSpec.title}`);
  }
  const roster = getLoopWorkerRosterSummary(input.runtimeState);
  if (roster.length > 0) {
    lines.push("", ...roster);
  }
  if (preview) {
    lines.push("", "Latest worker assistant output:", preview);
  }
  if (input.runtimeState.lastSupervisorDecision) {
    lines.push("", "Previous supervisor decision:", input.runtimeState.lastSupervisorDecision);
  }
  return lines.join("\n");
}

function parseSupervisorDecision(text: string): SupervisorDecision {
  const capture = (regex: RegExp) => text.match(regex)?.[1]?.trim() ?? null;
  const nextPromptMatch = text.match(/Next Worker Prompt:\s*([\s\S]+?)(?:\r?\n[A-Z][A-Za-z ]+:\s|$)/i);
  return {
    decision: capture(/^Decision:\s*(.+)$/im)?.toUpperCase() ?? "CONTINUE-WORKER",
    completion: capture(/^Completion Status:\s*(.+)$/im)?.toUpperCase() ?? "INCOMPLETE",
    nextWorkerKey: capture(/^Next Worker Key:\s*(.+)$/im),
    nextWorkerPrompt: nextPromptMatch?.[1]?.trim() ?? null,
    workerStatusLabel: capture(/^Worker Status Label:\s*(.+)$/im),
    workerStatusTone: capture(/^Worker Status Tone:\s*(.+)$/im),
    supervisorStatusLabel: capture(/^Supervisor Status Label:\s*(.+)$/im),
    supervisorStatusTone: capture(/^Supervisor Status Tone:\s*(.+)$/im),
  };
}

function testExplicitLoopStopDecision(decision: SupervisorDecision): boolean {
  if (decision.decision === "GOAL-ACHIEVED" || decision.completion === "COMPLETE") {
    return true;
  }
  if (decision.decision !== "INTERRUPT-WORKER" || !decision.nextWorkerPrompt) {
    return false;
  }
  return /\b(no further worker action|stop (the )?autonomous loop|stop looping|do not continue|manual turn-by-turn)\b/i.test(
    decision.nextWorkerPrompt,
  );
}

function testPauseLoopDecision(decision: SupervisorDecision): boolean {
  if (decision.decision !== "INTERRUPT-WORKER") {
    return false;
  }
  const combined = [decision.nextWorkerPrompt, decision.workerStatusLabel, decision.supervisorStatusLabel]
    .filter((value) => value)
    .join("\n");
  return /\b(paused|pause|remain paused|stay paused|wait for explicit resume|manual control)\b/i.test(
    combined,
  );
}

function resolveJhLoopIndicator(input: {
  enabled: boolean;
  requestedState: JhLoopRequestedState | null;
  phase: string;
  completed: boolean;
  lastError: string | null;
}): OrchestrationCustomIndicator {
  if (input.lastError) {
    return { label: "Problem", tone: "rose", pulse: false, priority: 5 };
  }
  if (!input.enabled && input.requestedState === "stopped") {
    return { label: "Stopped", tone: "slate", pulse: false, priority: 1 };
  }
  if (!input.enabled || input.phase === "paused") {
    return { label: "Paused", tone: "slate", pulse: false, priority: 1 };
  }
  if (input.completed) {
    return { label: "Goal Achieved", tone: "green", pulse: false, priority: 1 };
  }
  if (input.phase === "starting" || input.phase === "queued") {
    return { label: "Starting", tone: "cyan", pulse: true, priority: 2 };
  }
  if (input.phase.includes("supervisor")) {
    return { label: "Watching", tone: "violet", pulse: input.phase.includes("running"), priority: 3 };
  }
  if (input.phase.includes("worker")) {
    return { label: "Working", tone: "sky", pulse: true, priority: 3 };
  }
  if (input.phase.includes("blocked")) {
    return { label: "Blocked", tone: "amber", pulse: false, priority: 4 };
  }
  return { label: "Running", tone: "sky", pulse: true, priority: 2 };
}

function buildJhLoopStatus(record: JhLoopRecord): JhLoopStatusResult {
  const indicator = resolveJhLoopIndicator({
    enabled: record.definition.enabled,
    requestedState: record.definition.requestedState,
    phase: record.runtimeState.phase,
    completed: record.runtimeState.completed,
    lastError: record.runtimeState.lastError,
  });
  return {
    jobKey: record.definition.jobKey,
    loopType: record.definition.loopType,
    enabled: record.definition.enabled,
    requestedState: record.definition.requestedState,
    phase: record.runtimeState.phase,
    completed: record.runtimeState.completed,
    summary: record.runtimeState.lastSummary,
    lastError: record.runtimeState.lastError,
    lastRunAt: record.runtimeState.lastRunAt,
    nextRunAt: record.runtimeState.nextRunAt,
    projectId: record.definition.runtimeProjectId,
    projectTitle: record.definition.projectTitle,
    workspaceRoot: record.definition.workspaceRoot,
    supervisorThreadId:
      record.runtimeState.supervisorThreadId ?? record.definition.supervisorThreadId ?? null,
    supervisorThreadTitle: record.runtimeState.supervisorThreadTitle,
    workerThreadIds: [...record.definition.workerThreadIds],
    workerThreadTitles: record.runtimeState.workerRoster.map((entry) => entry.title),
    indicator,
    updatedAt: new Date().toISOString(),
  };
}

function buildJhLoopBinding(record: JhLoopRecord, status: JhLoopStatusResult): JhLoopBindingContract {
  return {
    jobKey: record.definition.jobKey,
    loopType: record.definition.loopType,
    runtimeProjectId: record.definition.runtimeProjectId,
    supervisorThreadId: status.supervisorThreadId,
    workerThreadIds: status.workerThreadIds,
    lastKnownStatus: {
      phase: status.phase,
      enabled: status.enabled,
      requestedState: status.requestedState,
      completed: status.completed,
      summary: status.summary,
      indicator: status.indicator,
      updatedAt: status.updatedAt,
    },
  };
}

const makeJhLoopRuntimeService = Effect.gen(function* () {
  const repository = yield* JhLoopRuntimeRepository;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  let started = false;
  let importedLegacyState = false;
  const activeExecutions = new Set<string>();

  const dispatchCommand = (command: Parameters<typeof orchestrationEngine.dispatch>[0]) =>
    orchestrationEngine.dispatch(command).pipe(Effect.asVoid);

  const getSnapshot = () => projectionSnapshotQuery.getSnapshot();
  const loopOrchestration = createJhLoopOrchestration({
    dispatchCommand,
    getSnapshot,
  });

  const expandHomePath = (input: string) =>
    input.startsWith("~")
      ? path.join(os.homedir(), input.slice(1).replace(/^[/\\]+/, ""))
      : input;

  const normalizeWorkspaceRoot = (workspaceRoot: string) => Effect.gen(function* () {
    const resolved = path.resolve(expandHomePath(workspaceRoot.trim()));
    const stat = yield* fileSystem.stat(resolved).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!stat || stat.type !== "Directory") {
      return yield* Effect.fail(new Error(`Project directory does not exist: ${resolved}`));
    }
    return resolved;
  });

  const setThreadSidebarStatus = (
    thread: OrchestrationThread | null,
    label: string,
    tone: string,
    pulse: boolean,
    priority: number,
  ) => Effect.gen(function* () {
    return yield* loopOrchestration.setThreadIndicator(thread, {
      label,
      tone: resolveThreadStatusTone(tone),
      pulse,
      priority,
    });
  });

  const publishProjectIndicator = (record: JhLoopRecord) =>
    loopOrchestration.publishProjectIndicator(
      record.definition.runtimeProjectId,
      buildJhLoopStatus(record).indicator,
    );

  const persistRecord = (record: MutableLoopRecord) =>
    Effect.all([
      repository.upsertDefinition(record.definition),
      repository.upsertRuntimeState({
        ...record.runtimeState,
        updatedAt: new Date().toISOString(),
      }),
    ]).pipe(Effect.asVoid);

  const ensureLoopThreads = (record: MutableLoopRecord) => Effect.gen(function* () {
    const project = yield* loopOrchestration.ensureProject(record.definition);
    const workerThreadsByKey = new Map<string, OrchestrationThread>();
    for (const workerSpec of record.definition.workerSpecs) {
      const snapshot = yield* getSnapshot();
      let thread = loopOrchestration.getThreadByTitle(snapshot, project.id, workerSpec.title);
      const previousEntry = record.runtimeState.workerRoster.find(
        (entry: any) => entry.key === workerSpec.key,
      );
      if (
        !thread &&
        record.definition.stopWhenWorkerDeleted &&
        record.runtimeState.activeWorkerKey === workerSpec.key &&
        (previousEntry?.threadId || record.runtimeState.workerThreadId)
      ) {
        record.definition.enabled = false;
        record.definition.requestedState = "stopped";
        record.runtimeState.phase = "stopped-by-user";
        record.runtimeState.stoppedReason = "worker deleted by user";
        record.runtimeState.lastSummary = "stopped because the active worker thread was deleted";
        record.runtimeState.nextRunAt = null;
        yield* persistRecord(record);
        return {
          projectId: project.id,
          projectTitle: project.title,
          workerSpec: null,
          workerThread: null,
          supervisorThread: null,
          workerThreadsByKey,
          stopped: true,
        };
      }
      if (!thread) {
        thread = yield* loopOrchestration.ensureThread({
          projectId: project.id,
          title: workerSpec.title,
          model: workerSpec.model ?? record.definition.workerModel,
          runtimeMode: record.definition.workerRuntimeMode,
          interactionMode: record.definition.workerInteractionMode,
        });
      }
      workerThreadsByKey.set(workerSpec.key, thread);
      updateWorkerRosterEntry(
        record.runtimeState,
        workerSpec,
        thread,
        newAssistantPreview(thread),
        record.runtimeState.activeWorkerKey === workerSpec.key,
      );
    }
    const supervisorThread = yield* loopOrchestration.ensureThread({
      projectId: project.id,
      title: record.definition.projectTitle + " Supervisor" === record.definition.projectTitle
        ? "Autonomous Supervisor"
        : record.runtimeState.supervisorThreadTitle ?? `${record.definition.projectTitle} Supervisor`,
      model: record.definition.supervisorModel,
      runtimeMode: record.definition.supervisorRuntimeMode,
      interactionMode: record.definition.supervisorInteractionMode,
    });

    const selectedWorkerSpec = getSelectedWorkerSpec(record.definition, record.runtimeState);
    const selectedWorkerThread =
      selectedWorkerSpec && workerThreadsByKey.has(selectedWorkerSpec.key)
        ? workerThreadsByKey.get(selectedWorkerSpec.key) ?? null
        : null;

    record.definition.supervisorThreadId = supervisorThread.id;
    record.definition.workerThreadIds = [...workerThreadsByKey.values()].map((thread) => thread.id);

    return {
      projectId: project.id,
      projectTitle: project.title,
      workerSpec: selectedWorkerSpec,
      workerThread: selectedWorkerThread,
      supervisorThread,
      workerThreadsByKey,
      stopped: false,
    };
  });

  const syncLoopState = (
    record: MutableLoopRecord,
    workerSpec: JhLoopWorkerSpec | null,
    workerThread: OrchestrationThread | null,
    supervisorThread: OrchestrationThread | null,
  ) => {
    if (workerThread) {
      record.runtimeState.workerThreadTitle = workerThread.title;
      record.runtimeState.workerThreadId = workerThread.id;
      if (workerSpec) {
        record.runtimeState.activeWorkerKey = workerSpec.key;
      }
      const preview = newAssistantPreview(workerThread);
      if (preview) {
        record.runtimeState.lastWorkerAssistantSummary = preview;
        record.runtimeState.lastForwardProgressAt = new Date().toISOString();
      }
      if (workerSpec) {
        updateWorkerRosterEntry(
          record.runtimeState,
          workerSpec,
          workerThread,
          preview,
          record.runtimeState.activeWorkerKey === workerSpec.key,
        );
      }
    }
    if (supervisorThread) {
      record.runtimeState.supervisorThreadTitle = supervisorThread.title;
      record.runtimeState.supervisorThreadId = supervisorThread.id;
      const preview = newAssistantPreview(supervisorThread);
      if (preview) {
        record.runtimeState.lastSupervisorDecision = preview;
      }
    }
  };

  const disableLoopForManualControl = (input: {
    record: MutableLoopRecord;
    workerThread: OrchestrationThread | null;
    supervisorThread: OrchestrationThread | null;
    decision: SupervisorDecision;
    phase: string;
    reason: string;
    completed: boolean;
    workerLabel: string;
    workerTone: string;
    supervisorLabel: string;
    supervisorTone: string;
    summaryVerb: string;
  }) => Effect.gen(function* () {
    yield* setThreadSidebarStatus(
      input.workerThread,
      input.decision.workerStatusLabel ?? input.workerLabel,
      input.decision.workerStatusTone ?? input.workerTone,
      false,
      1,
    );
    yield* setThreadSidebarStatus(
      input.supervisorThread,
      input.decision.supervisorStatusLabel ?? input.supervisorLabel,
      input.decision.supervisorStatusTone ?? input.supervisorTone,
      false,
      1,
    );
    input.record.definition.enabled = false;
    input.record.runtimeState.completed = input.completed;
    input.record.runtimeState.phase = input.phase;
    input.record.runtimeState.stoppedReason = input.reason;
    input.record.runtimeState.pendingWorkerPromptMessageId = null;
    input.record.runtimeState.nextRunAt = null;
    input.record.runtimeState.lastSummary = `${input.summaryVerb} loop '${input.record.definition.jobKey}' and left '${input.record.definition.projectTitle}' unmanaged`;
  });

  const executeLoop = (record: MutableLoopRecord) => Effect.gen(function* () {
    const summaryParts: string[] = [];
    const chainDeadlineMs = Date.now() + record.definition.fastChainWindowMs;
    let remainingTransitions = record.definition.fastChainMaxTransitions;

    while (true) {
      const ctx = yield* ensureLoopThreads(record);
      if (ctx.stopped) {
        summaryParts.push(
          `stopped '${record.definition.jobKey}' because the worker thread was deleted`,
        );
        return summaryParts.join("; ");
      }

      let worker = ctx.workerThread;
      const supervisor = ctx.supervisorThread;
      let workerSpec = ctx.workerSpec;
      syncLoopState(record, workerSpec, worker, supervisor);

      if (worker && !getLatestUserMessage(worker)) {
        yield* setThreadSidebarStatus(worker, "New", "cyan", false, 2);
        yield* setThreadSidebarStatus(supervisor, "Queued", "slate", false, 1);
        yield* setThreadSidebarStatus(worker, "Thinking", "indigo", true, 3);
        advanceLoopWorkerCursor(record.definition, record.runtimeState, workerSpec);
        const startedWorkerTurn = yield* loopOrchestration.startThreadTurn(
          worker,
          getWorkerInitialPrompt(record.definition, workerSpec),
          workerSpec?.model ?? record.definition.workerModel,
          record.definition.workerRuntimeMode,
          record.definition.workerInteractionMode,
        );
        record.runtimeState.phase = "worker-running";
        record.runtimeState.pendingWorkerPromptMessageId = startedWorkerTurn.messageId;
        record.runtimeState.lastRunAt = new Date().toISOString();
        record.runtimeState.nextRunAt = resolveNextRunAt(record.definition, record.runtimeState);
        record.runtimeState.executionCount += 1;
        record.runtimeState.lastSummary = `started worker thread '${worker.title}'`;
        summaryParts.push(`started worker thread '${worker.title}' in '${ctx.projectTitle}'`);
        yield* persistRecord(record);
        remainingTransitions -= 1;
        if (remainingTransitions <= 0 || Date.now() >= chainDeadlineMs) {
          return summaryParts.join("; ");
        }
        const readyThread = yield* loopOrchestration.waitForThreadReadyWithin(
          worker.id,
          chainDeadlineMs,
          isThreadSteerable,
        );
        if (!readyThread) {
          return summaryParts.join("; ");
        }
        continue;
      }

      if (worker && !isThreadSteerable(worker)) {
        const workerHasProblem = worker.session?.status === "error";
        yield* setThreadSidebarStatus(
          worker,
          workerHasProblem ? "Problem" : "Working",
          workerHasProblem ? "rose" : "sky",
          !workerHasProblem,
          workerHasProblem ? 5 : 3,
        );
        yield* setThreadSidebarStatus(
          supervisor,
          workerHasProblem ? "Problem" : "Watching",
          workerHasProblem ? "rose" : "slate",
          false,
          workerHasProblem ? 5 : 2,
        );
        record.runtimeState.phase = workerHasProblem ? "blocked" : "waiting-for-worker";
        record.runtimeState.lastSummary = workerHasProblem
          ? `worker thread '${worker.title}' hit a provider error`
          : `worker thread '${worker.title}' is still busy`;
        record.runtimeState.nextRunAt = resolveNextRunAt(record.definition, record.runtimeState);
        yield* persistRecord(record);
        if (workerHasProblem) {
          return summaryParts.join("; ");
        }
        if (Date.now() < chainDeadlineMs) {
          const readyThread = yield* loopOrchestration.waitForThreadReadyWithin(
            worker.id,
            chainDeadlineMs,
            isThreadSteerable,
          );
          if (readyThread) {
            continue;
          }
        }
        return summaryParts.join("; ");
      }

      if (hasPendingWorkerPrompt(record, worker)) {
        yield* setThreadSidebarStatus(worker, "Working", "sky", true, 3);
        yield* setThreadSidebarStatus(supervisor, "Watching", "slate", false, 2);
        record.runtimeState.phase = "waiting-for-worker";
        record.runtimeState.lastSummary = `worker thread '${worker?.title ?? "Worker"}' is starting the queued turn`;
        record.runtimeState.nextRunAt = resolveNextRunAt(record.definition, record.runtimeState);
        yield* persistRecord(record);
        return summaryParts.join("; ");
      }

      const workerAnchor = worker?.latestTurn?.turnId ?? null;
      const shouldReviewWorkerTurn =
        Boolean(supervisor && worker && workerAnchor) &&
        hasProjectedAssistantForLatestTurn(worker) &&
        record.runtimeState.lastObservedTurnId !== workerAnchor;
      if (
        supervisor &&
        worker &&
        shouldReviewWorkerTurn
      ) {
        yield* setThreadSidebarStatus(worker, "Reviewing", "amber", false, 4);
        yield* setThreadSidebarStatus(supervisor, "Reasoning", "violet", true, 4);
        yield* loopOrchestration.startThreadTurn(
          supervisor,
          getSupervisorPrompt({
            definition: record.definition,
            runtimeState: record.runtimeState,
            workerThread: worker,
            workerSpec,
            initial: !getLatestUserMessage(supervisor),
          }),
          record.definition.supervisorModel,
          record.definition.supervisorRuntimeMode,
          record.definition.supervisorInteractionMode,
        );
        record.runtimeState.lastObservedTurnId = workerAnchor;
        record.runtimeState.lastConsumedSupervisorMessageId = null;
        record.runtimeState.pendingWorkerPromptMessageId = null;
        record.runtimeState.phase = "supervisor-running";
        record.runtimeState.lastRunAt = new Date().toISOString();
        record.runtimeState.nextRunAt = resolveNextRunAt(record.definition, record.runtimeState);
        record.runtimeState.lastSummary = `sent worker state to supervisor thread '${supervisor.title}'`;
        summaryParts.push(
          `sent worker state to supervisor thread '${supervisor.title}' in '${ctx.projectTitle}'`,
        );
        yield* persistRecord(record);
        remainingTransitions -= 1;
        if (remainingTransitions <= 0 || Date.now() >= chainDeadlineMs) {
          return summaryParts.join("; ");
        }
        const readyThread = yield* loopOrchestration.waitForThreadReadyWithin(
          supervisor.id,
          chainDeadlineMs,
          isThreadSteerable,
        );
        if (!readyThread) {
          return summaryParts.join("; ");
        }
        continue;
      }

      if (supervisor && !isThreadSteerable(supervisor)) {
        const supervisorHasProblem = supervisor.session?.status === "error";
        yield* setThreadSidebarStatus(
          worker,
          supervisorHasProblem ? "Problem" : "Reviewing",
          supervisorHasProblem ? "rose" : "amber",
          false,
          supervisorHasProblem ? 5 : 4,
        );
        yield* setThreadSidebarStatus(
          supervisor,
          supervisorHasProblem ? "Problem" : "Reasoning",
          supervisorHasProblem ? "rose" : "violet",
          !supervisorHasProblem,
          supervisorHasProblem ? 5 : 4,
        );
        record.runtimeState.phase = supervisorHasProblem ? "blocked" : "waiting-for-supervisor";
        record.runtimeState.lastSummary = supervisorHasProblem
          ? `supervisor thread '${supervisor.title}' hit a provider error`
          : `supervisor thread '${supervisor.title}' is still deciding`;
        record.runtimeState.nextRunAt = resolveNextRunAt(record.definition, record.runtimeState);
        yield* persistRecord(record);
        if (supervisorHasProblem) {
          return summaryParts.join("; ");
        }
        if (Date.now() < chainDeadlineMs) {
          const readyThread = yield* loopOrchestration.waitForThreadReadyWithin(
            supervisor.id,
            chainDeadlineMs,
            isThreadSteerable,
          );
          if (readyThread) {
            continue;
          }
        }
        return summaryParts.join("; ");
      }

      const supervisorAssistant = getLatestAssistantMessage(supervisor);
      if (!supervisorAssistant) {
        yield* setThreadSidebarStatus(supervisor, "Problem", "rose", false, 5);
        record.runtimeState.phase = "blocked";
        record.runtimeState.nextRunAt = resolveNextRunAt(record.definition, record.runtimeState);
        record.runtimeState.lastSummary = `supervisor thread '${supervisor?.title ?? "Supervisor"}' had no decision yet`;
        yield* persistRecord(record);
        return summaryParts.join("; ");
      }

      if (!hasProjectedAssistantForLatestTurn(supervisor)) {
        yield* setThreadSidebarStatus(worker, "Reviewing", "amber", false, 4);
        yield* setThreadSidebarStatus(supervisor, "Reasoning", "violet", true, 4);
        record.runtimeState.phase = "waiting-for-supervisor";
        record.runtimeState.lastSummary = `waiting for supervisor output to settle in '${supervisor.title}'`;
        record.runtimeState.nextRunAt = resolveNextRunAt(record.definition, record.runtimeState);
        yield* persistRecord(record);
        return summaryParts.join("; ");
      }

      if (record.runtimeState.lastConsumedSupervisorMessageId === supervisorAssistant.id) {
        yield* setThreadSidebarStatus(worker, "Working", "sky", true, 3);
        yield* setThreadSidebarStatus(supervisor, "Watching", "slate", false, 2);
        record.runtimeState.phase = "waiting-for-worker";
        record.runtimeState.lastSummary = `awaiting fresh worker progress after supervisor guidance from '${supervisor.title}'`;
        record.runtimeState.nextRunAt = resolveNextRunAt(record.definition, record.runtimeState);
        yield* persistRecord(record);
        return summaryParts.join("; ");
      }

      const decision = parseSupervisorDecision(supervisorAssistant.text);
      record.runtimeState.lastSupervisorDecision = supervisorAssistant.text;
      record.runtimeState.lastConsumedSupervisorMessageId = supervisorAssistant.id;

      if (record.definition.loopType === "endless-loop" && testExplicitLoopStopDecision(decision)) {
        yield* disableLoopForManualControl({
          record,
          workerThread: worker,
          supervisorThread: supervisor,
          decision,
          phase: "paused",
          reason: "explicit stop instruction accepted by supervisor",
          completed: false,
          workerLabel: "Stopped",
          workerTone: "slate",
          supervisorLabel: "Interrupted",
          supervisorTone: "amber",
          summaryVerb: "stopped",
        });
        yield* persistRecord(record);
        return summaryParts.join("; ");
      }

      if (record.definition.loopType === "endless-loop" && testPauseLoopDecision(decision)) {
        yield* disableLoopForManualControl({
          record,
          workerThread: worker,
          supervisorThread: supervisor,
          decision,
          phase: "paused",
          reason: "explicit pause instruction accepted by supervisor",
          completed: false,
          workerLabel: "Paused",
          workerTone: "slate",
          supervisorLabel: "Paused",
          supervisorTone: "slate",
          summaryVerb: "paused",
        });
        yield* persistRecord(record);
        return summaryParts.join("; ");
      }

      if (
        record.definition.loopType !== "endless-loop" &&
        (decision.completion === "COMPLETE" || decision.decision === "GOAL-ACHIEVED")
      ) {
        yield* setThreadSidebarStatus(
          worker,
          decision.workerStatusLabel ?? "Done",
          decision.workerStatusTone ?? "green",
          false,
          1,
        );
        yield* setThreadSidebarStatus(
          supervisor,
          decision.supervisorStatusLabel ?? "Success",
          decision.supervisorStatusTone ?? "green",
          false,
          1,
        );
        record.runtimeState.completed = true;
        record.runtimeState.phase = "completed";
        record.runtimeState.pendingWorkerPromptMessageId = null;
        record.runtimeState.lastSummary = `goal achieved in '${ctx.projectTitle}'`;
        record.runtimeState.nextRunAt = null;
        record.definition.enabled = false;
        record.definition.requestedState = "stopped";
        yield* persistRecord(record);
        summaryParts.push(`completed '${record.definition.jobKey}' in '${ctx.projectTitle}'`);
        return summaryParts.join("; ");
      }

      if (decision.decision === "BLOCKED") {
        yield* setThreadSidebarStatus(
          worker,
          decision.workerStatusLabel ?? "Blocked",
          decision.workerStatusTone ?? "red",
          false,
          6,
        );
        yield* setThreadSidebarStatus(
          supervisor,
          decision.supervisorStatusLabel ?? "Blocked",
          decision.supervisorStatusTone ?? "red",
          false,
          6,
        );
        record.runtimeState.phase = "blocked";
        record.runtimeState.pendingWorkerPromptMessageId = null;
        record.runtimeState.lastSummary = `loop '${record.definition.jobKey}' is blocked`;
        record.runtimeState.nextRunAt = resolveNextRunAt(record.definition, record.runtimeState);
        yield* persistRecord(record);
        summaryParts.push(`loop '${record.definition.jobKey}' is blocked in '${ctx.projectTitle}'`);
        return summaryParts.join("; ");
      }

      if (decision.decision === "INTERRUPT-WORKER" && worker?.session?.status === "running") {
        yield* loopOrchestration.interruptThreadTurn(worker);
        yield* setThreadSidebarStatus(worker, "Interrupted", "amber", false, 4);
        yield* setThreadSidebarStatus(supervisor, "Steering", "amber", false, 4);
        record.runtimeState.phase = "worker-steerable";
        record.runtimeState.pendingWorkerPromptMessageId = null;
        record.runtimeState.nextRunAt = new Date(Date.now() + 5000).toISOString();
        record.runtimeState.lastSummary = `interrupted worker thread '${worker.title}'`;
        yield* persistRecord(record);
        summaryParts.push(`interrupted worker thread '${worker.title}' in '${ctx.projectTitle}'`);
        return summaryParts.join("; ");
      }

      let nextWorkerSpec = decision.nextWorkerKey
        ? record.definition.workerSpecs.find((spec: any) => spec.key === decision.nextWorkerKey) ?? null
        : null;
      if (!nextWorkerSpec) {
        nextWorkerSpec = getNextScheduledWorkerSpec(record.definition, record.runtimeState);
      }
      if (!nextWorkerSpec) {
        nextWorkerSpec = workerSpec;
      }
      if (nextWorkerSpec && ctx.workerThreadsByKey.has(nextWorkerSpec.key)) {
        worker = ctx.workerThreadsByKey.get(nextWorkerSpec.key) ?? worker;
        workerSpec = nextWorkerSpec;
      }
      advanceLoopWorkerCursor(record.definition, record.runtimeState, workerSpec);

      let nextPrompt =
        "Continue making concrete progress toward the objective. Incorporate the supervisor guidance and leave evidence of what changed, what was learned, or what was validated.";
      if (workerSpec?.continuePromptTemplate?.trim()) {
        nextPrompt = workerSpec.continuePromptTemplate;
      }
      if (decision.nextWorkerPrompt?.trim()) {
        nextPrompt = decision.nextWorkerPrompt;
      }
      if (!worker || !workerSpec) {
        record.runtimeState.phase = "blocked";
        record.runtimeState.lastSummary = "loop lost its worker binding";
        record.runtimeState.nextRunAt = resolveNextRunAt(record.definition, record.runtimeState);
        yield* persistRecord(record);
        return summaryParts.join("; ");
      }
      yield* setThreadSidebarStatus(
        worker,
        decision.workerStatusLabel ?? "Working",
        decision.workerStatusTone ?? "sky",
        true,
        3,
      );
      yield* setThreadSidebarStatus(
        supervisor,
        decision.supervisorStatusLabel ?? "Watching",
        decision.supervisorStatusTone ?? "slate",
        false,
        2,
      );
      const continuedWorkerTurn = yield* loopOrchestration.startThreadTurn(
        worker,
        nextPrompt,
        workerSpec.model ?? record.definition.workerModel,
        record.definition.workerRuntimeMode,
        record.definition.workerInteractionMode,
      );
      record.runtimeState.phase = "worker-running";
      record.runtimeState.pendingWorkerPromptMessageId = continuedWorkerTurn.messageId;
      record.runtimeState.lastRunAt = new Date().toISOString();
      record.runtimeState.nextRunAt = resolveNextRunAt(record.definition, record.runtimeState);
      record.runtimeState.executionCount += 1;
      record.runtimeState.lastSummary = `continued worker thread '${worker.title}'`;
      yield* persistRecord(record);
      summaryParts.push(`continued worker thread '${worker.title}' in '${ctx.projectTitle}'`);
      remainingTransitions -= 1;
      if (remainingTransitions <= 0 || Date.now() >= chainDeadlineMs) {
        return summaryParts.join("; ");
      }
      const readyThread = yield* loopOrchestration.waitForThreadReadyWithin(
        worker.id,
        chainDeadlineMs,
        isThreadSteerable,
      );
      if (!readyThread) {
        return summaryParts.join("; ");
      }
    }
  });

  const runLoopNow = (loopId: string) => Effect.gen(function* () {
    if (activeExecutions.has(loopId)) {
      return;
    }
    activeExecutions.add(loopId);
    try {
      const recordOption = yield* repository.getByLoopId({ loopId });
      if (Option.isNone(recordOption)) {
        return;
      }
      const record = asMutable(recordOption.value);
      if (
        !record.definition.enabled ||
        record.definition.requestedState === "paused" ||
        record.definition.requestedState === "stopped" ||
        (record.runtimeState.completed && record.definition.loopType !== "endless-loop")
      ) {
        yield* publishProjectIndicator(record);
        return;
      }
      try {
        const summary = yield* executeLoop(record);
        record.runtimeState.lastError = null;
        record.runtimeState.lastHeartbeatAt = new Date().toISOString();
        if (summary) {
          record.runtimeState.lastSummary = summary;
        }
      } catch (error) {
        record.runtimeState.lastError = error instanceof Error ? error.message : String(error);
        record.runtimeState.lastSummary = `execution failed: ${record.runtimeState.lastError}`;
        record.runtimeState.phase = "blocked";
        record.runtimeState.lastHeartbeatAt = new Date().toISOString();
      }
      yield* persistRecord(record);
      yield* publishProjectIndicator(record);
    } finally {
      activeExecutions.delete(loopId);
    }
  });

  const legacyRuntimeRoot = path.join(os.homedir(), ...LEGACY_SUPERVISOR_DIR);

  const importLegacySidecarLoops = () => Effect.gen(function* () {
    if (importedLegacyState) {
      return;
    }
    importedLegacyState = true;
    const existingCount = yield* repository.count();
    if (existingCount > 0) {
      return;
    }
    const jobsPath = path.join(legacyRuntimeRoot, "jobs.json");
    const statePath = path.join(legacyRuntimeRoot, "state.json");
    const jobsRaw = yield* fileSystem.readFileString(jobsPath).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!jobsRaw) {
      return;
    }
    const stateRaw = yield* fileSystem.readFileString(statePath).pipe(Effect.catch(() => Effect.succeed(null)));
    const jobs = JSON.parse(jobsRaw) as Array<Record<string, unknown>>;
    const state = stateRaw ? (JSON.parse(stateRaw) as Record<string, unknown>) : {};
    const jobStateMap =
      state.jobState && typeof state.jobState === "object"
        ? (state.jobState as Record<string, Record<string, unknown>>)
        : {};
    for (const job of jobs) {
      const jobType = typeof job.jobType === "string" ? job.jobType : null;
      const jobKey = typeof job.name === "string" ? job.name.trim() : "";
      if ((jobType !== "goal-loop" && jobType !== "endless-loop") || jobKey.length === 0) {
        continue;
      }
      const project = (job.project ?? {}) as Record<string, unknown>;
      const goal = (job.goal ?? {}) as Record<string, unknown>;
      const models = (job.models ?? {}) as Record<string, unknown>;
      const trigger = (job.trigger ?? {}) as Record<string, unknown>;
      const controls = (job.controls ?? {}) as Record<string, unknown>;
      const workers = Array.isArray(job.workers) ? (job.workers as Array<Record<string, unknown>>) : [];
      const runtimeState = (jobStateMap[jobKey] ?? {}) as Record<string, unknown>;
      const loopId = crypto.randomUUID();
      const now = new Date().toISOString();
      const workerSpecs =
        workers.length > 0
          ? workers.map((worker, index) => ({
              key:
                typeof worker.key === "string" && worker.key.trim().length > 0
                  ? worker.key.trim()
                  : `worker-${index + 1}`,
              title:
                typeof worker.title === "string" && worker.title.trim().length > 0
                  ? worker.title.trim()
                  : `Worker ${index + 1}`,
              objective: typeof worker.objective === "string" ? worker.objective : null,
              initialPrompt: typeof worker.initialPrompt === "string" ? worker.initialPrompt : null,
              continuePromptTemplate:
                typeof worker.continuePromptTemplate === "string"
                  ? worker.continuePromptTemplate
                  : null,
              model: typeof worker.model === "string" ? worker.model : null,
            }))
          : createJhLoopWorkerSpecs({
              projectTitle:
                typeof project.title === "string" && project.title.trim().length > 0
                  ? project.title.trim()
                  : jobKey,
              workerCount: 1,
              workerModel:
                typeof models.worker === "string" && models.worker.trim().length > 0
                  ? models.worker.trim()
                  : "gpt-5.4",
            });

      const definition: JhLoopDefinition = {
        loopId,
        jobKey,
        loopType: jobType,
        runtimeProjectId: ProjectId.makeUnsafe(
          typeof project.id === "string" && project.id.trim().length > 0
            ? project.id
            : crypto.randomUUID(),
        ),
        workspaceRoot:
          typeof project.workspaceRoot === "string" && project.workspaceRoot.trim().length > 0
            ? project.workspaceRoot
            : path.join(os.tmpdir(), "jh-goal-loops", jobKey.replace(/[^\w.-]+/g, "-")),
        projectTitle:
          typeof project.title === "string" && project.title.trim().length > 0
            ? project.title
            : jobKey,
        objective:
          typeof goal.objective === "string" && goal.objective.trim().length > 0
            ? goal.objective
            : "Make forward progress.",
        completionCriteria:
          typeof goal.completionCriteria === "string" && goal.completionCriteria.trim().length > 0
            ? goal.completionCriteria
            : jobType === "endless-loop"
              ? "Do not stop automatically. Keep iterating until John disables the loop or deletes a worker thread."
              : "Stop only when the stated goal is genuinely complete.",
        requestedState:
          typeof (job.sidebar as Record<string, unknown> | undefined)?.requestedState === "string"
            ? ((job.sidebar as Record<string, unknown>).requestedState as JhLoopRequestedState)
            : "running",
        enabled: job.enabled !== false,
        workerModel:
          typeof models.worker === "string" && models.worker.trim().length > 0
            ? models.worker
            : "gpt-5.4",
        supervisorModel:
          typeof models.supervisor === "string" && models.supervisor.trim().length > 0
            ? models.supervisor
            : "gpt-5.4",
        workerRuntimeMode: null,
        workerInteractionMode: null,
        supervisorRuntimeMode: null,
        supervisorInteractionMode: null,
        supervisorThreadId:
          typeof ((job.threads as Record<string, unknown> | undefined)?.supervisorThreadId) === "string"
            ? ThreadId.makeUnsafe((job.threads as Record<string, unknown>).supervisorThreadId as string)
            : null,
        workerThreadIds: workers
          .map((worker) =>
            typeof worker.threadId === "string" ? ThreadId.makeUnsafe(worker.threadId) : null,
          )
          .filter((threadId): threadId is ThreadId => threadId !== null),
        workerSpecs,
        source: "legacy-sidecar-import",
        intervalSeconds:
          typeof trigger.intervalSeconds === "number" && trigger.intervalSeconds > 0
            ? Math.trunc(trigger.intervalSeconds)
            : DEFAULT_INTERVAL_SECONDS,
        activePollSeconds:
          typeof controls.activePollSeconds === "number" && controls.activePollSeconds > 0
            ? Math.trunc(controls.activePollSeconds)
            : DEFAULT_ACTIVE_POLL_SECONDS,
        fastChainWindowMs:
          typeof controls.fastChainWindowMs === "number" && controls.fastChainWindowMs >= 0
            ? Math.trunc(controls.fastChainWindowMs)
            : DEFAULT_FAST_CHAIN_WINDOW_MS,
        fastChainMaxTransitions:
          typeof controls.fastChainMaxTransitions === "number" && controls.fastChainMaxTransitions > 0
            ? Math.trunc(controls.fastChainMaxTransitions)
            : DEFAULT_FAST_CHAIN_MAX_TRANSITIONS,
        stopWhenWorkerDeleted: controls.stopWhenWorkerDeleted !== false,
        createdAt: now,
        updatedAt: now,
      };

      const runtime: JhLoopRuntimeState = {
        loopId,
        phase:
          typeof runtimeState.phase === "string" && runtimeState.phase.trim().length > 0
            ? runtimeState.phase
            : "queued",
        completed: runtimeState.completed === true,
        lastRunAt: typeof runtimeState.lastRunAt === "string" ? runtimeState.lastRunAt : null,
        nextRunAt: typeof runtimeState.nextRunAt === "string" ? runtimeState.nextRunAt : now,
        lastHeartbeatAt:
          typeof state.lastHeartbeat === "string" && state.lastHeartbeat.trim().length > 0
            ? (state.lastHeartbeat as string)
            : null,
        lastSummary:
          typeof runtimeState.lastSummary === "string" ? (runtimeState.lastSummary as string) : null,
        lastError:
          typeof runtimeState.lastError === "string" ? (runtimeState.lastError as string) : null,
        executionCount:
          typeof runtimeState.executionCount === "number" && runtimeState.executionCount >= 0
            ? Math.trunc(runtimeState.executionCount)
            : 0,
        workerThreadTitle:
          typeof runtimeState.workerThreadTitle === "string"
            ? (runtimeState.workerThreadTitle as string)
            : null,
        supervisorThreadTitle:
          typeof runtimeState.supervisorThreadTitle === "string"
            ? (runtimeState.supervisorThreadTitle as string)
            : null,
        workerThreadId:
          typeof runtimeState.workerThreadId === "string"
            ? ThreadId.makeUnsafe(runtimeState.workerThreadId as string)
            : null,
        supervisorThreadId:
          typeof runtimeState.supervisorThreadId === "string"
            ? ThreadId.makeUnsafe(runtimeState.supervisorThreadId as string)
            : definition.supervisorThreadId,
        lastWorkerAssistantSummary:
          typeof runtimeState.lastWorkerAssistantSummary === "string"
            ? (runtimeState.lastWorkerAssistantSummary as string)
            : null,
        lastSupervisorDecision:
          typeof runtimeState.lastSupervisorDecision === "string"
            ? (runtimeState.lastSupervisorDecision as string)
            : null,
        lastObservedTurnId:
          typeof runtimeState.lastObservedTurnId === "string"
            ? (runtimeState.lastObservedTurnId as string)
            : null,
        lastConsumedSupervisorMessageId:
          typeof runtimeState.lastConsumedSupervisorMessageId === "string"
            ? (runtimeState.lastConsumedSupervisorMessageId as string)
            : null,
        pendingWorkerPromptMessageId:
          typeof runtimeState.pendingWorkerPromptMessageId === "string"
            ? (runtimeState.pendingWorkerPromptMessageId as string)
            : null,
        lastForwardProgressAt:
          typeof runtimeState.lastForwardProgressAt === "string"
            ? (runtimeState.lastForwardProgressAt as string)
            : null,
        stoppedReason:
          typeof runtimeState.stoppedReason === "string" ? (runtimeState.stoppedReason as string) : null,
        activeWorkerKey:
          typeof runtimeState.activeWorkerKey === "string"
            ? (runtimeState.activeWorkerKey as string)
            : null,
        nextWorkerIndex:
          typeof runtimeState.nextWorkerIndex === "number" && runtimeState.nextWorkerIndex >= 0
            ? Math.trunc(runtimeState.nextWorkerIndex)
            : 0,
        workerRoster: Array.isArray(runtimeState.workerRoster)
          ? (runtimeState.workerRoster as JhLoopWorkerRosterEntry[])
          : [],
        ignoredControlMessageKeys: [],
        ignoredControlMessageFingerprints: [],
        lastControlMessageKey: null,
        lastHumanControlText: null,
        lastHumanControlAt: null,
        lastHumanControlInstruction: null,
        startupEnsured: runtimeState.startupEnsured === true,
        updatedAt: now,
      };

      yield* repository.upsertDefinition(definition);
      yield* repository.upsertRuntimeState(runtime);
    }
  });

  const getLoopStatus: JhLoopRuntimeServiceShape["getLoopStatus"] = (jobKey) =>
    repository.getByJobKey({ jobKey }).pipe(
      Effect.flatMap((recordOption) =>
        Option.match(recordOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (record) => Effect.succeed(Option.some(buildJhLoopStatus(record))),
        }),
      ),
    );

  const createLoop: JhLoopRuntimeServiceShape["createLoop"] = (request: JhLoopCreateRequest) =>
    Effect.gen(function* () {
    yield* importLegacySidecarLoops();
    const normalizedWorkspaceRoot = yield* normalizeWorkspaceRoot(request.project.workspaceRoot);
    const projectTitle = request.project.title.trim();
    const workerSpecs = createJhLoopWorkerSpecs({
      projectTitle,
      workerCount: request.workerCount,
      workerTitlePrefix: request.workerTitlePrefix,
      workerModel: request.workerModel,
    });

    const runtimeProjectId = request.project.projectId ?? ProjectId.makeUnsafe(crypto.randomUUID());
    const now = new Date().toISOString();
    const existing = yield* repository.listAll();
    const existingJobKeys = new Set(existing.map((entry) => entry.definition.jobKey));
    const baseJobKey = `${projectTitle} ${request.loopType === "goal-loop" ? "Goal Loop" : "Endless Loop"}`;
    let jobKey = baseJobKey;
    let suffix = 2;
    while (existingJobKeys.has(jobKey)) {
      jobKey = `${baseJobKey} (${suffix})`;
      suffix += 1;
    }

    const definition: JhLoopDefinition = {
      loopId: crypto.randomUUID(),
      jobKey,
      loopType: request.loopType,
      runtimeProjectId,
      workspaceRoot: normalizedWorkspaceRoot,
      projectTitle,
      objective: request.objective,
      completionCriteria:
        request.completionCriteria ??
        (request.loopType === "endless-loop"
          ? "Do not stop automatically. Keep iterating until John disables the loop or deletes a worker thread."
          : "Stop only when the stated goal is genuinely complete."),
      requestedState: "running",
      enabled: true,
      workerModel: request.workerModel,
      supervisorModel: request.supervisorModel,
      workerRuntimeMode: request.workerRuntimeMode ?? null,
      workerInteractionMode: request.workerInteractionMode ?? null,
      supervisorRuntimeMode: request.supervisorRuntimeMode ?? null,
      supervisorInteractionMode: request.supervisorInteractionMode ?? null,
      supervisorThreadId: null,
      workerThreadIds: [],
      workerSpecs,
      source: "jh-code-sidebar",
      intervalSeconds: DEFAULT_INTERVAL_SECONDS,
      activePollSeconds: DEFAULT_ACTIVE_POLL_SECONDS,
      fastChainWindowMs: DEFAULT_FAST_CHAIN_WINDOW_MS,
      fastChainMaxTransitions: DEFAULT_FAST_CHAIN_MAX_TRANSITIONS,
      stopWhenWorkerDeleted: true,
      createdAt: now,
      updatedAt: now,
    };
    const runtimeState: JhLoopRuntimeState = {
      loopId: definition.loopId,
      phase: "queued",
      completed: false,
      lastRunAt: null,
      nextRunAt: now,
      lastHeartbeatAt: null,
      lastSummary: `created from JH Code sidebar for '${projectTitle}'`,
      lastError: null,
      executionCount: 0,
      workerThreadTitle: null,
      supervisorThreadTitle: request.supervisorTitle?.trim() || `${projectTitle} Supervisor`,
      workerThreadId: null,
      supervisorThreadId: null,
      lastWorkerAssistantSummary: null,
      lastSupervisorDecision: null,
      lastObservedTurnId: null,
      lastConsumedSupervisorMessageId: null,
      pendingWorkerPromptMessageId: null,
      lastForwardProgressAt: null,
      stoppedReason: null,
      activeWorkerKey: null,
      nextWorkerIndex: 0,
      workerRoster: workerSpecs.map((workerSpec) => ({
        key: workerSpec.key,
        title: workerSpec.title,
        threadId: null,
        lastAssistantSummary: null,
        lastSelectedAt: null,
      })),
      ignoredControlMessageKeys: [],
      ignoredControlMessageFingerprints: [],
      lastControlMessageKey: null,
      lastHumanControlText: null,
      lastHumanControlAt: null,
      lastHumanControlInstruction: null,
      startupEnsured: false,
      updatedAt: now,
    };
    yield* repository.upsertDefinition(definition);
    yield* repository.upsertRuntimeState(runtimeState);
    const recordOption = yield* repository.getByLoopId({ loopId: definition.loopId });
    if (Option.isNone(recordOption)) {
      return yield* Effect.fail(new Error("Loop creation succeeded but the loop record could not be reloaded."));
    }
    const status = buildJhLoopStatus(recordOption.value);
    return {
      ok: true,
      binding: buildJhLoopBinding(recordOption.value, status),
      status,
    };
    });

  const controlLoop: JhLoopRuntimeServiceShape["controlLoop"] = (request: JhLoopControlRequest) =>
    Effect.gen(function* () {
    yield* importLegacySidecarLoops();
    const recordOption = yield* repository.getByJobKey({ jobKey: request.jobKey });
    if (Option.isNone(recordOption)) {
      return Option.none();
    }
    const record = asMutable(recordOption.value);
    const now = new Date().toISOString();
    switch (request.action) {
      case "pause":
        record.definition.enabled = false;
        record.definition.requestedState = "paused";
        record.runtimeState.phase = "paused";
        record.runtimeState.completed = false;
        record.runtimeState.nextRunAt = null;
        record.runtimeState.stoppedReason = "paused from JH Code sidebar";
        record.runtimeState.lastSummary = "paused from JH Code sidebar";
        break;
      case "resume":
        record.definition.enabled = true;
        record.definition.requestedState = "running";
        record.runtimeState.phase = "queued";
        record.runtimeState.completed = false;
        record.runtimeState.nextRunAt = now;
        record.runtimeState.stoppedReason = null;
        record.runtimeState.lastError = null;
        record.runtimeState.lastSummary = "resumed from JH Code sidebar";
        break;
      case "stop":
        record.definition.enabled = false;
        record.definition.requestedState = "stopped";
        record.runtimeState.phase = "stopped";
        record.runtimeState.completed = false;
        record.runtimeState.nextRunAt = null;
        record.runtimeState.stoppedReason = "stopped from JH Code sidebar";
        record.runtimeState.lastSummary = "stopped from JH Code sidebar";
        break;
      case "update-type":
        if (!request.loopType) {
          return yield* Effect.fail(new Error("Loop type is required when updating the loop type."));
        }
        record.definition.loopType = request.loopType;
        record.runtimeState.lastSummary = `converted to ${request.loopType} from JH Code sidebar`;
        break;
    }
    yield* persistRecord(record);
    yield* publishProjectIndicator(record);
    const refreshedRecordOption = yield* repository.getByLoopId({ loopId: record.definition.loopId });
    if (Option.isNone(refreshedRecordOption)) {
      return Option.none();
    }
    const status = buildJhLoopStatus(refreshedRecordOption.value);
    return Option.some({
      ok: true,
      binding: buildJhLoopBinding(refreshedRecordOption.value, status),
      status,
    } satisfies JhLoopControlResult);
    });

  const schedulerTick = Effect.gen(function* () {
    yield* importLegacySidecarLoops();
    const records = yield* repository.listAll();
    const now = Date.now();
    for (const record of records) {
      if (activeExecutions.has(record.definition.loopId)) {
        continue;
      }
      if (
        !record.definition.enabled ||
        record.definition.requestedState === "paused" ||
        record.definition.requestedState === "stopped" ||
        (record.runtimeState.completed && record.definition.loopType !== "endless-loop")
      ) {
        continue;
      }
      const nextRunAtMs = record.runtimeState.nextRunAt ? Date.parse(record.runtimeState.nextRunAt) : now;
      if (Number.isFinite(nextRunAtMs) && nextRunAtMs > now) {
        continue;
      }
      yield* runLoopNow(record.definition.loopId);
    }
  }).pipe(
    Effect.catch((error: unknown) =>
      Effect.logWarning("jh loop scheduler tick failed", {
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
  );

  const start: JhLoopRuntimeServiceShape["start"] = Effect.gen(function* () {
    if (started) {
      return;
    }
    started = true;
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          yield* schedulerTick;
          yield* Effect.sleep("1 second");
        }),
      ),
    ).pipe(Effect.asVoid);
  });

  return {
    start,
    createLoop,
    controlLoop,
    getLoopStatus,
  } satisfies JhLoopRuntimeServiceShape;
});

export const JhLoopRuntimeServiceLive = Layer.effect(
  JhLoopRuntimeService,
  makeJhLoopRuntimeService,
);
