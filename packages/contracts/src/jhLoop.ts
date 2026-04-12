import { Schema } from "effect";
import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { ProviderInteractionMode, RuntimeMode, OrchestrationCustomIndicator } from "./orchestration";

export const JhLoopType = Schema.Literals(["goal-loop", "endless-loop"]);
export type JhLoopType = typeof JhLoopType.Type;

export const JhLoopRequestedState = Schema.Literals(["running", "paused", "stopped"]);
export type JhLoopRequestedState = typeof JhLoopRequestedState.Type;

export const JhLoopBinding = Schema.Struct({
  jobKey: TrimmedNonEmptyString,
  loopType: JhLoopType,
  runtimeProjectId: ProjectId,
  supervisorThreadId: Schema.NullOr(ThreadId),
  workerThreadIds: Schema.Array(ThreadId),
  lastKnownStatus: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        phase: TrimmedNonEmptyString,
        enabled: Schema.Boolean,
        requestedState: Schema.NullOr(JhLoopRequestedState),
        completed: Schema.Boolean,
        summary: Schema.NullOr(Schema.String),
        indicator: Schema.NullOr(OrchestrationCustomIndicator),
        updatedAt: IsoDateTime,
      }),
    ),
  ),
});
export type JhLoopBinding = typeof JhLoopBinding.Type;

export const JhLoopStatusResult = Schema.Struct({
  jobKey: TrimmedNonEmptyString,
  loopType: JhLoopType,
  enabled: Schema.Boolean,
  requestedState: Schema.NullOr(JhLoopRequestedState),
  phase: TrimmedNonEmptyString,
  completed: Schema.Boolean,
  summary: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  lastRunAt: Schema.NullOr(IsoDateTime),
  nextRunAt: Schema.NullOr(IsoDateTime),
  projectId: Schema.optionalKey(ProjectId),
  projectTitle: Schema.NullOr(Schema.String),
  workspaceRoot: Schema.NullOr(Schema.String),
  supervisorThreadId: Schema.NullOr(ThreadId),
  supervisorThreadTitle: Schema.NullOr(Schema.String),
  workerThreadIds: Schema.Array(ThreadId),
  workerThreadTitles: Schema.Array(Schema.String),
  indicator: Schema.NullOr(OrchestrationCustomIndicator),
  updatedAt: IsoDateTime,
});
export type JhLoopStatusResult = typeof JhLoopStatusResult.Type;

export const JhLoopCreateRequest = Schema.Struct({
  loopType: JhLoopType,
  project: Schema.Struct({
    projectId: Schema.optionalKey(ProjectId),
    workspaceRoot: TrimmedNonEmptyString,
    title: TrimmedNonEmptyString,
  }),
  objective: TrimmedNonEmptyString,
  completionCriteria: Schema.optionalKey(TrimmedNonEmptyString),
  workerCount: PositiveInt,
  workerModel: TrimmedNonEmptyString,
  supervisorModel: TrimmedNonEmptyString,
  workerRuntimeMode: Schema.optionalKey(RuntimeMode),
  workerInteractionMode: Schema.optionalKey(ProviderInteractionMode),
  supervisorRuntimeMode: Schema.optionalKey(RuntimeMode),
  supervisorInteractionMode: Schema.optionalKey(ProviderInteractionMode),
  workerTitlePrefix: Schema.optionalKey(TrimmedNonEmptyString),
  supervisorTitle: Schema.optionalKey(TrimmedNonEmptyString),
});
export type JhLoopCreateRequest = typeof JhLoopCreateRequest.Type;

export const JhLoopCreateResult = Schema.Struct({
  ok: Schema.Boolean,
  binding: JhLoopBinding,
  status: JhLoopStatusResult,
});
export type JhLoopCreateResult = typeof JhLoopCreateResult.Type;

export const JhLoopControlAction = Schema.Literals(["pause", "resume", "stop", "update-type"]);
export type JhLoopControlAction = typeof JhLoopControlAction.Type;

export const JhLoopControlRequest = Schema.Struct({
  jobKey: TrimmedNonEmptyString,
  action: JhLoopControlAction,
  loopType: Schema.optionalKey(JhLoopType),
});
export type JhLoopControlRequest = typeof JhLoopControlRequest.Type;

export const JhLoopControlResult = Schema.Struct({
  ok: Schema.Boolean,
  binding: JhLoopBinding,
  status: JhLoopStatusResult,
});
export type JhLoopControlResult = typeof JhLoopControlResult.Type;
