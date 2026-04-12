import { Schema } from "effect";
import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { JhComposerPrefillMetadata, JhComposerPrefillMode } from "./jhComposer";
import { ProviderModelOptions } from "./model";
import {
  AssistantDeliveryMode,
  ProviderInteractionMode,
  ProviderKind,
  ProviderStartOptions,
  RuntimeMode,
} from "./orchestration";

export const JhSpawnProjectSpec = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
  workspaceRoot: Schema.optionalKey(TrimmedNonEmptyString),
  title: Schema.optionalKey(TrimmedNonEmptyString),
  defaultModel: Schema.optionalKey(TrimmedNonEmptyString),
  sidebarExpanded: Schema.optionalKey(Schema.Boolean),
});
export type JhSpawnProjectSpec = typeof JhSpawnProjectSpec.Type;

export const JhSpawnThreadDraftSpec = Schema.Struct({
  text: Schema.String,
  mode: Schema.optionalKey(JhComposerPrefillMode),
  metadata: Schema.optionalKey(JhComposerPrefillMetadata),
});
export type JhSpawnThreadDraftSpec = typeof JhSpawnThreadDraftSpec.Type;

export const JhSpawnThreadFirstTurnSpec = Schema.Struct({
  text: Schema.String,
  provider: Schema.optionalKey(ProviderKind),
  model: Schema.optionalKey(TrimmedNonEmptyString),
  modelOptions: Schema.optionalKey(ProviderModelOptions),
  providerOptions: Schema.optionalKey(ProviderStartOptions),
  assistantDeliveryMode: Schema.optionalKey(AssistantDeliveryMode),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(ProviderInteractionMode),
});
export type JhSpawnThreadFirstTurnSpec = typeof JhSpawnThreadFirstTurnSpec.Type;

export const JhSpawnThreadSpec = Schema.Struct({
  threadId: Schema.optionalKey(ThreadId),
  title: TrimmedNonEmptyString,
  model: Schema.optionalKey(TrimmedNonEmptyString),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(ProviderInteractionMode),
  branch: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  draft: Schema.optionalKey(JhSpawnThreadDraftSpec),
  firstTurn: Schema.optionalKey(JhSpawnThreadFirstTurnSpec),
});
export type JhSpawnThreadSpec = typeof JhSpawnThreadSpec.Type;

export const JhSpawnRequest = Schema.Struct({
  project: JhSpawnProjectSpec,
  threads: Schema.Array(JhSpawnThreadSpec),
});
export type JhSpawnRequest = typeof JhSpawnRequest.Type;

export const JhSpawnProjectResult = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  created: Schema.Boolean,
  sidebarExpanded: Schema.Boolean,
});
export type JhSpawnProjectResult = typeof JhSpawnProjectResult.Type;

export const JhSpawnThreadResult = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  created: Schema.Boolean,
  draftRevision: Schema.optionalKey(NonNegativeInt),
  firstTurnSent: Schema.Boolean,
});
export type JhSpawnThreadResult = typeof JhSpawnThreadResult.Type;

export const JhSpawnResult = Schema.Struct({
  ok: Schema.Boolean,
  project: JhSpawnProjectResult,
  threads: Schema.Array(JhSpawnThreadResult),
});
export type JhSpawnResult = typeof JhSpawnResult.Type;
