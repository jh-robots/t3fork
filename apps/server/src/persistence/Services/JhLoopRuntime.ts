import {
  IsoDateTime,
  JhLoopRequestedState,
  JhLoopType,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { NonNegativeInt, PositiveInt } from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const JhLoopWorkerSpec = Schema.Struct({
  key: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  objective: Schema.NullOr(Schema.String),
  initialPrompt: Schema.NullOr(Schema.String),
  continuePromptTemplate: Schema.NullOr(Schema.String),
  model: Schema.NullOr(TrimmedNonEmptyString),
});
export type JhLoopWorkerSpec = typeof JhLoopWorkerSpec.Type;

export const JhLoopWorkerRosterEntry = Schema.Struct({
  key: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  threadId: Schema.NullOr(ThreadId),
  lastAssistantSummary: Schema.NullOr(Schema.String),
  lastSelectedAt: Schema.NullOr(IsoDateTime),
});
export type JhLoopWorkerRosterEntry = typeof JhLoopWorkerRosterEntry.Type;

export const JhLoopDefinition = Schema.Struct({
  loopId: TrimmedNonEmptyString,
  jobKey: TrimmedNonEmptyString,
  loopType: JhLoopType,
  runtimeProjectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  projectTitle: TrimmedNonEmptyString,
  objective: TrimmedNonEmptyString,
  completionCriteria: TrimmedNonEmptyString,
  requestedState: Schema.NullOr(JhLoopRequestedState),
  enabled: Schema.Boolean,
  workerModel: TrimmedNonEmptyString,
  supervisorModel: TrimmedNonEmptyString,
  workerRuntimeMode: Schema.NullOr(RuntimeMode),
  workerInteractionMode: Schema.NullOr(ProviderInteractionMode),
  supervisorRuntimeMode: Schema.NullOr(RuntimeMode),
  supervisorInteractionMode: Schema.NullOr(ProviderInteractionMode),
  supervisorThreadId: Schema.NullOr(ThreadId),
  workerThreadIds: Schema.Array(ThreadId),
  workerSpecs: Schema.Array(JhLoopWorkerSpec),
  source: Schema.NullOr(TrimmedNonEmptyString),
  intervalSeconds: PositiveInt,
  activePollSeconds: PositiveInt,
  fastChainWindowMs: NonNegativeInt,
  fastChainMaxTransitions: PositiveInt,
  stopWhenWorkerDeleted: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type JhLoopDefinition = typeof JhLoopDefinition.Type;

export const JhLoopRuntimeState = Schema.Struct({
  loopId: TrimmedNonEmptyString,
  phase: TrimmedNonEmptyString,
  completed: Schema.Boolean,
  lastRunAt: Schema.NullOr(IsoDateTime),
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastHeartbeatAt: Schema.NullOr(IsoDateTime),
  lastSummary: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  executionCount: NonNegativeInt,
  workerThreadTitle: Schema.NullOr(Schema.String),
  supervisorThreadTitle: Schema.NullOr(Schema.String),
  workerThreadId: Schema.NullOr(ThreadId),
  supervisorThreadId: Schema.NullOr(ThreadId),
  lastWorkerAssistantSummary: Schema.NullOr(Schema.String),
  lastSupervisorDecision: Schema.NullOr(Schema.String),
  lastObservedTurnId: Schema.NullOr(TrimmedNonEmptyString),
  lastConsumedSupervisorMessageId: Schema.NullOr(TrimmedNonEmptyString),
  pendingWorkerPromptMessageId: Schema.NullOr(TrimmedNonEmptyString),
  lastForwardProgressAt: Schema.NullOr(IsoDateTime),
  stoppedReason: Schema.NullOr(Schema.String),
  activeWorkerKey: Schema.NullOr(TrimmedNonEmptyString),
  nextWorkerIndex: NonNegativeInt,
  workerRoster: Schema.Array(JhLoopWorkerRosterEntry),
  ignoredControlMessageKeys: Schema.Array(TrimmedNonEmptyString),
  ignoredControlMessageFingerprints: Schema.Array(TrimmedNonEmptyString),
  lastControlMessageKey: Schema.NullOr(TrimmedNonEmptyString),
  lastHumanControlText: Schema.NullOr(Schema.String),
  lastHumanControlAt: Schema.NullOr(IsoDateTime),
  lastHumanControlInstruction: Schema.NullOr(TrimmedNonEmptyString),
  startupEnsured: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export type JhLoopRuntimeState = typeof JhLoopRuntimeState.Type;

export const JhLoopRecord = Schema.Struct({
  definition: JhLoopDefinition,
  runtimeState: JhLoopRuntimeState,
});
export type JhLoopRecord = typeof JhLoopRecord.Type;

export const GetJhLoopByJobKeyInput = Schema.Struct({
  jobKey: TrimmedNonEmptyString,
});
export type GetJhLoopByJobKeyInput = typeof GetJhLoopByJobKeyInput.Type;

export const GetJhLoopByIdInput = Schema.Struct({
  loopId: TrimmedNonEmptyString,
});
export type GetJhLoopByIdInput = typeof GetJhLoopByIdInput.Type;

export interface JhLoopRuntimeRepositoryShape {
  readonly upsertDefinition: (
    definition: JhLoopDefinition,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertRuntimeState: (
    runtimeState: JhLoopRuntimeState,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByJobKey: (
    input: GetJhLoopByJobKeyInput,
  ) => Effect.Effect<Option.Option<JhLoopRecord>, ProjectionRepositoryError>;
  readonly getByLoopId: (
    input: GetJhLoopByIdInput,
  ) => Effect.Effect<Option.Option<JhLoopRecord>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<ReadonlyArray<JhLoopRecord>, ProjectionRepositoryError>;
  readonly count: () => Effect.Effect<number, ProjectionRepositoryError>;
  readonly deleteByLoopId: (
    input: GetJhLoopByIdInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class JhLoopRuntimeRepository extends ServiceMap.Service<
  JhLoopRuntimeRepository,
  JhLoopRuntimeRepositoryShape
>()("t3/persistence/Services/JhLoopRuntime/JhLoopRuntimeRepository") {}
