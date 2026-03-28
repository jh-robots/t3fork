import { describe, expect, it, vi } from "vitest";
import { type OrchestrationEvent, ProjectId, ThreadId } from "@t3tools/contracts";

import {
  buildJhInAppNotificationDescriptor,
  getJhBrowserNotificationPermission,
  requestJhBrowserNotificationPermission,
  shouldDispatchJhInAppNotification,
  showJhBrowserNotification,
} from "./jhInAppNotifications";
import type { Project, Thread } from "./types";

function setNotificationForTest(
  value: typeof globalThis.Notification | undefined,
): typeof globalThis.Notification | undefined {
  const originalNotification = globalThis.Notification;
  if (value === undefined) {
    Reflect.deleteProperty(globalThis, "Notification");
  } else {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value,
    });
  }
  return originalNotification;
}

const projectId = ProjectId.makeUnsafe("project-1");
const threadId = ThreadId.makeUnsafe("thread-1");

const projects: Project[] = [
  {
    id: projectId,
    name: "Demo project",
    cwd: "/demo",
    model: "gpt-5.4",
    expanded: true,
    scripts: [],
  },
];

const threads: Thread[] = [
  {
    id: threadId,
    codexThreadId: null,
    projectId,
    title: "Ship notifications",
    model: "gpt-5.4",
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-27T00:00:00.000Z",
    updatedAt: "2026-03-27T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  },
];

describe("buildJhInAppNotificationDescriptor", () => {
  it("builds working notifications from running thread.session-set events", () => {
    const event: OrchestrationEvent = {
      type: "thread.session-set",
      sequence: 1,
      eventId: "event-working-1" as any,
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: "2026-03-27T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId,
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: "turn-1" as any,
          lastError: null,
          updatedAt: "2026-03-27T00:00:00.000Z",
        },
      },
    };

    expect(buildJhInAppNotificationDescriptor({ event, threads, projects })).toMatchObject({
      threadId,
      title: "Demo project: working",
      toastTitle: "Working in Ship notifications",
      accent: "blue",
      glyph: "AI",
      tone: "info",
      tag: `jh-thread-turn-status:${threadId}:turn-1`,
    });
  });

  it("builds completed-turn notifications from thread.turn-diff-completed events", () => {
    const event: OrchestrationEvent = {
      type: "thread.turn-diff-completed",
      sequence: 1,
      eventId: "event-1" as any,
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: "2026-03-27T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId,
        turnId: "turn-1" as any,
        checkpointTurnCount: 1,
        checkpointRef: "checkpoint-1" as any,
        status: "ready",
        files: [
          { path: "src/jhInAppNotifications.ts", kind: "modified", additions: 10, deletions: 2 },
        ],
        assistantMessageId: "message-1" as any,
        completedAt: "2026-03-27T00:00:00.000Z",
      },
    };
    threads[0]!.messages = [
      {
        id: "message-1" as any,
        role: "assistant",
        text: "The background task finished successfully and is ready for review.",
        createdAt: "2026-03-27T00:00:00.000Z",
        streaming: false,
      },
    ];
    threads[0]!.turnDiffSummaries = [
      {
        turnId: "turn-1" as any,
        completedAt: "2026-03-27T00:00:00.000Z",
        files: [{ path: "src/jhInAppNotifications.ts" }],
      },
    ];

    expect(buildJhInAppNotificationDescriptor({ event, threads, projects })).toMatchObject({
      threadId,
      title: "Demo project: turn complete",
      toastTitle: "Turn complete in Ship notifications",
      accent: "teal",
      glyph: "AI",
      tone: "success",
      tag: `jh-thread-turn-status:${threadId}:turn-1`,
    });
  });

  it("ignores generic activity updates so notifications only fire on completed turns", () => {
    const event: OrchestrationEvent = {
      type: "thread.activity-appended",
      sequence: 1,
      eventId: "event-2" as any,
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: "2026-03-27T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId,
        activity: {
          id: "activity-1" as any,
          tone: "info",
          kind: "user-input.requested",
          summary: "Need clarification",
          payload: {},
          turnId: null,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      },
    };

    expect(buildJhInAppNotificationDescriptor({ event, threads, projects })).toBeNull();
  });
});

describe("shouldDispatchJhInAppNotification", () => {
  it("suppresses notifications for the active focused thread", () => {
    expect(
      shouldDispatchJhInAppNotification({
        targetThreadId: threadId,
        activeThreadId: threadId,
        pathname: `/${threadId}`,
        documentVisibilityState: "visible",
        hasDocumentFocus: true,
      }),
    ).toBe(false);
  });

  it("keeps notifications when the app is hidden", () => {
    expect(
      shouldDispatchJhInAppNotification({
        targetThreadId: threadId,
        activeThreadId: threadId,
        pathname: `/${threadId}`,
        documentVisibilityState: "hidden",
        hasDocumentFocus: false,
      }),
    ).toBe(true);
  });
});

describe("browser notification helpers", () => {
  it("reports unsupported when Notification is unavailable", () => {
    const originalNotification = setNotificationForTest(undefined);

    expect(getJhBrowserNotificationPermission()).toBe("unsupported");

    setNotificationForTest(originalNotification);
  });

  it("requests permission and shows notifications when supported", async () => {
    const requestPermission = vi.fn(async () => "granted" as const);
    const close = vi.fn();
    const NotificationCtor = vi.fn().mockImplementation(function NotificationMock() {
      return { close, onclick: null };
    });
    Object.assign(NotificationCtor, {
      permission: "granted",
      requestPermission,
    });
    const originalNotification = setNotificationForTest(
      NotificationCtor as unknown as typeof Notification,
    );

    expect(await requestJhBrowserNotificationPermission()).toBe("granted");
    const notification = showJhBrowserNotification({
      descriptor: {
        title: "Demo project",
        body: "Assistant replied",
        tag: "demo",
      },
      onClick: close,
    });

    expect(notification).not.toBeNull();
    expect(NotificationCtor).toHaveBeenCalledWith("Demo project", {
      body: "Assistant replied",
      tag: "demo",
    });

    setNotificationForTest(originalNotification);
  });
});
