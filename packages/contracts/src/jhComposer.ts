import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";

export const JhComposerPrefillMode = Schema.Literals(["replace", "append"]);
export type JhComposerPrefillMode = typeof JhComposerPrefillMode.Type;

export const JhComposerPrefillMetadata = Schema.Struct({
  source: Schema.optionalKey(TrimmedNonEmptyString),
  task_id: Schema.optionalKey(TrimmedNonEmptyString),
  mode: Schema.optionalKey(TrimmedNonEmptyString),
});
export type JhComposerPrefillMetadata = typeof JhComposerPrefillMetadata.Type;

export const JhComposerPrefillRequest = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  text: Schema.String,
  mode: Schema.optionalKey(JhComposerPrefillMode),
  metadata: Schema.optionalKey(JhComposerPrefillMetadata),
});
export type JhComposerPrefillRequest = typeof JhComposerPrefillRequest.Type;

export const JhComposerPrefillResult = Schema.Struct({
  ok: Schema.Boolean,
  draftId: Schema.optionalKey(TrimmedNonEmptyString),
  revision: NonNegativeInt,
});
export type JhComposerPrefillResult = typeof JhComposerPrefillResult.Type;

export const JhComposerDraftStateEntry = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  draftId: TrimmedNonEmptyString,
  text: Schema.String,
  mode: JhComposerPrefillMode,
  metadata: Schema.optionalKey(JhComposerPrefillMetadata),
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type JhComposerDraftStateEntry = typeof JhComposerDraftStateEntry.Type;

export const JhComposerDraftStateResult = Schema.Struct({
  threadId: ThreadId,
  revision: NonNegativeInt,
  entry: Schema.NullOr(JhComposerDraftStateEntry),
});
export type JhComposerDraftStateResult = typeof JhComposerDraftStateResult.Type;

export const JhComposerClearedResult = Schema.Struct({
  ok: Schema.Boolean,
  revision: NonNegativeInt,
});
export type JhComposerClearedResult = typeof JhComposerClearedResult.Type;

export const JhComposerPrefillUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: Schema.optionalKey(ProjectId),
  draftId: Schema.NullOr(TrimmedNonEmptyString),
  revision: NonNegativeInt,
  cleared: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export type JhComposerPrefillUpdatedPayload = typeof JhComposerPrefillUpdatedPayload.Type;
