import { Schema } from "effect";
import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const JhNotificationTone = Schema.Literals(["info", "success", "warning", "error"]);
export type JhNotificationTone = typeof JhNotificationTone.Type;

export const JhNotificationAccent = Schema.Literals([
  "slate",
  "teal",
  "blue",
  "green",
  "amber",
  "red",
]);
export type JhNotificationAccent = typeof JhNotificationAccent.Type;

const JhNotificationGlyph = TrimmedNonEmptyString.check(Schema.isMaxLength(4));

export const JhNotificationAction = Schema.Struct({
  id: Schema.optionalKey(TrimmedNonEmptyString),
  label: TrimmedNonEmptyString,
  kind: Schema.Literals(["open-thread", "open-url", "dismiss"]),
  threadId: Schema.optionalKey(ThreadId),
  url: Schema.optionalKey(TrimmedNonEmptyString),
});
export type JhNotificationAction = typeof JhNotificationAction.Type;

export const JhNotificationTriggerRequest = Schema.Struct({
  title: TrimmedNonEmptyString,
  body: TrimmedNonEmptyString,
  subtitle: Schema.optionalKey(TrimmedNonEmptyString),
  threadId: Schema.optionalKey(ThreadId),
  projectId: Schema.optionalKey(ProjectId),
  tag: Schema.optionalKey(TrimmedNonEmptyString),
  iconUrl: Schema.optionalKey(TrimmedNonEmptyString),
  glyph: Schema.optionalKey(JhNotificationGlyph),
  accent: Schema.optionalKey(JhNotificationAccent),
  tone: Schema.optionalKey(JhNotificationTone),
  requireInteraction: Schema.optionalKey(Schema.Boolean),
  actions: Schema.optionalKey(Schema.Array(JhNotificationAction)),
});
export type JhNotificationTriggerRequest = typeof JhNotificationTriggerRequest.Type;

export const JhNotificationTriggeredPayload = Schema.Struct({
  title: TrimmedNonEmptyString,
  body: TrimmedNonEmptyString,
  subtitle: Schema.optionalKey(TrimmedNonEmptyString),
  threadId: Schema.optionalKey(ThreadId),
  projectId: Schema.optionalKey(ProjectId),
  tag: TrimmedNonEmptyString,
  iconUrl: Schema.optionalKey(TrimmedNonEmptyString),
  glyph: Schema.optionalKey(JhNotificationGlyph),
  accent: Schema.optionalKey(JhNotificationAccent),
  tone: Schema.optionalKey(JhNotificationTone),
  requireInteraction: Schema.optionalKey(Schema.Boolean),
  actions: Schema.optionalKey(Schema.Array(JhNotificationAction)),
});
export type JhNotificationTriggeredPayload = typeof JhNotificationTriggeredPayload.Type;

export const JhNotificationTriggerResult = Schema.Struct({
  ok: Schema.Boolean,
  tag: TrimmedNonEmptyString,
});
export type JhNotificationTriggerResult = typeof JhNotificationTriggerResult.Type;
