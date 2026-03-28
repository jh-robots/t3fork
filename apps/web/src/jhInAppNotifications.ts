import type { OrchestrationEvent, ThreadId } from "@t3tools/contracts";

import type { Project, Thread } from "./types";

export type BrowserNotificationPermissionState = NotificationPermission | "unsupported";

export interface JHInAppNotificationDescriptor {
  threadId: ThreadId;
  title: string;
  body: string;
  toastTitle: string;
  toastDescription: string;
  toastSubtitle?: string;
  tone: "info" | "success" | "warning" | "error";
  glyph?: string;
  accent?: "slate" | "teal" | "blue" | "green" | "amber" | "red";
  tag: string;
}

function buildTurnNotificationTag(threadId: ThreadId, turnId: string): string {
  return `jh-thread-turn-status:${threadId}:${turnId}`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateForNotification(value: string, maxLength = 140): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}\u2026`;
}

function findThread(threads: ReadonlyArray<Thread>, threadId: ThreadId): Thread | undefined {
  return threads.find((thread) => thread.id === threadId);
}

function findProject(
  projects: ReadonlyArray<Project>,
  projectId: Project["id"],
): Project | undefined {
  return projects.find((project) => project.id === projectId);
}

function resolveThreadContext(params: {
  threads: ReadonlyArray<Thread>;
  projects: ReadonlyArray<Project>;
  threadId: ThreadId;
}) {
  const thread = findThread(params.threads, params.threadId);
  const project = thread ? findProject(params.projects, thread.projectId) : undefined;
  const threadLabel = thread?.title?.trim() || "thread";
  const projectLabel = project?.name?.trim() || "Project";
  return { thread, project, threadLabel, projectLabel };
}

function countChangedFiles(thread: Thread | undefined, turnId: string): number {
  return thread?.turnDiffSummaries.find((summary) => summary.turnId === turnId)?.files.length ?? 0;
}

function getAssistantExcerpt(
  thread: Thread | undefined,
  assistantMessageId: string | null,
): string {
  if (!thread || !assistantMessageId) {
    return "";
  }
  const assistantMessage = thread.messages.find((message) => message.id === assistantMessageId);
  return assistantMessage ? truncateForNotification(assistantMessage.text) : "";
}

export function shouldDispatchJhInAppNotification(params: {
  targetThreadId: ThreadId;
  activeThreadId: ThreadId | null;
  pathname: string;
  documentVisibilityState: DocumentVisibilityState | "hidden";
  hasDocumentFocus: boolean;
}): boolean {
  const isForegroundThread =
    params.activeThreadId === params.targetThreadId &&
    params.pathname === `/${params.targetThreadId}` &&
    params.documentVisibilityState === "visible" &&
    params.hasDocumentFocus;
  return !isForegroundThread;
}

export function buildJhInAppNotificationDescriptor(params: {
  event: OrchestrationEvent;
  threads: ReadonlyArray<Thread>;
  projects: ReadonlyArray<Project>;
}): JHInAppNotificationDescriptor | null {
  const { event } = params;

  if (
    event.type === "thread.session-set" &&
    event.payload.session.status === "running" &&
    event.payload.session.activeTurnId !== null
  ) {
    const { threadLabel, projectLabel } = resolveThreadContext({
      threads: params.threads,
      projects: params.projects,
      threadId: event.payload.threadId,
    });
    const turnId = event.payload.session.activeTurnId;

    return {
      threadId: event.payload.threadId,
      title: `${projectLabel}: working`,
      body: `${threadLabel} is still working on the current turn.`,
      toastTitle: `Working in ${threadLabel}`,
      toastDescription:
        "The assistant is still working. This updates when the turn is actually done.",
      toastSubtitle: `${projectLabel} • Turn in progress`,
      tone: "info",
      glyph: "AI",
      accent: "blue",
      tag: buildTurnNotificationTag(event.payload.threadId, turnId),
    };
  }

  if (event.type === "thread.turn-diff-completed") {
    const { thread, threadLabel, projectLabel } = resolveThreadContext({
      threads: params.threads,
      projects: params.projects,
      threadId: event.payload.threadId,
    });
    const fileCount = countChangedFiles(thread, event.payload.turnId);
    const fileSummary =
      fileCount <= 0
        ? "No file changes captured"
        : `${fileCount} file${fileCount === 1 ? "" : "s"} changed`;
    const excerpt = getAssistantExcerpt(thread, event.payload.assistantMessageId);

    return {
      threadId: event.payload.threadId,
      title: `${projectLabel}: turn complete`,
      body:
        excerpt ||
        `${threadLabel} finished turn ${event.payload.checkpointTurnCount}. ${fileSummary}.`,
      toastTitle: `Turn complete in ${threadLabel}`,
      toastDescription:
        excerpt || `Completed turn ${event.payload.checkpointTurnCount}. ${fileSummary}.`,
      toastSubtitle: `${projectLabel} • ${fileSummary}`,
      tone: "success",
      glyph: "AI",
      accent: "teal",
      tag: buildTurnNotificationTag(event.payload.threadId, event.payload.turnId),
    };
  }

  return null;
}

export function getJhBrowserNotificationPermission(): BrowserNotificationPermissionState {
  if (typeof globalThis === "undefined" || typeof globalThis.Notification === "undefined") {
    return "unsupported";
  }
  return globalThis.Notification.permission;
}

export async function requestJhBrowserNotificationPermission(): Promise<BrowserNotificationPermissionState> {
  if (typeof globalThis === "undefined" || typeof globalThis.Notification === "undefined") {
    return "unsupported";
  }
  return globalThis.Notification.requestPermission();
}

export function showJhBrowserNotification(params: {
  descriptor: Pick<JHInAppNotificationDescriptor, "title" | "body" | "tag"> & {
    icon?: string;
    requireInteraction?: boolean;
  };
  onClick?: () => void;
}): Notification | null {
  if (
    typeof globalThis === "undefined" ||
    typeof globalThis.Notification === "undefined" ||
    globalThis.Notification.permission !== "granted"
  ) {
    return null;
  }

  const notification = new globalThis.Notification(params.descriptor.title, {
    body: params.descriptor.body,
    tag: params.descriptor.tag,
    ...(params.descriptor.icon ? { icon: params.descriptor.icon } : {}),
    ...(typeof params.descriptor.requireInteraction === "boolean"
      ? { requireInteraction: params.descriptor.requireInteraction }
      : {}),
  });
  if (params.onClick) {
    if ("addEventListener" in notification && typeof notification.addEventListener === "function") {
      notification.addEventListener("click", () => {
        params.onClick?.();
        notification.close();
      });
    }
  }
  return notification;
}
