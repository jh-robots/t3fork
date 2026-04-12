import { Schema } from "effect";
import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas";

export const JhSidebarProjectVisibilityRequest = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
  workspaceRoot: Schema.optionalKey(TrimmedNonEmptyString),
  expanded: Schema.Boolean,
});
export type JhSidebarProjectVisibilityRequest = typeof JhSidebarProjectVisibilityRequest.Type;

export const JhSidebarProjectVisibilityResult = Schema.Struct({
  ok: Schema.Boolean,
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  expanded: Schema.Boolean,
});
export type JhSidebarProjectVisibilityResult = typeof JhSidebarProjectVisibilityResult.Type;

export const JhSidebarProjectVisibilityUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  expanded: Schema.Boolean,
});
export type JhSidebarProjectVisibilityUpdatedPayload =
  typeof JhSidebarProjectVisibilityUpdatedPayload.Type;
