import {
  CommandId,
  type OrchestrationCustomIndicator,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import type { CSSProperties } from "react";
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "../appSettings";
import type { Thread } from "../types";
import { cn } from "../lib/utils";
import {
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
} from "../session-logic";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export type SidebarNewThreadEnvMode = "local" | "worktree";
type SidebarProject = {
  id: string;
  name: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};
type SidebarThreadSortInput = Pick<Thread, "createdAt" | "updatedAt" | "messages">;

export interface ThreadStatusPill {
  label: string;
  colorClass: string;
  dotClass: string;
  containerClass?: string;
  pulse: boolean;
  priority: number;
  style?: CSSProperties;
  dotStyle?: CSSProperties;
}

export type SidebarBadgeTarget =
  | { kind: "thread"; id: ThreadId }
  | { kind: "project"; id: ProjectId };

const THREAD_STATUS_PRIORITY = {
  "Pending Approval": 5,
  "Awaiting Input": 4,
  Working: 3,
  Connecting: 3,
  "Plan Ready": 2,
  Completed: 1,
} as const satisfies Record<string, number>;
const CUSTOM_INDICATOR_DEFAULT_PRIORITY = 100;

const CUSTOM_INDICATOR_TONE_CLASSES = {
  slate: {
    textClass: "text-slate-600 dark:text-slate-300/90",
    dotClass: "bg-slate-500 dark:bg-slate-300/90",
  },
  gray: {
    textClass: "text-gray-600 dark:text-gray-300/90",
    dotClass: "bg-gray-500 dark:bg-gray-300/90",
  },
  zinc: {
    textClass: "text-zinc-600 dark:text-zinc-300/90",
    dotClass: "bg-zinc-500 dark:bg-zinc-300/90",
  },
  neutral: {
    textClass: "text-neutral-600 dark:text-neutral-300/90",
    dotClass: "bg-neutral-500 dark:bg-neutral-300/90",
  },
  stone: {
    textClass: "text-stone-600 dark:text-stone-300/90",
    dotClass: "bg-stone-500 dark:bg-stone-300/90",
  },
  red: {
    textClass: "text-red-600 dark:text-red-300/90",
    dotClass: "bg-red-500 dark:bg-red-300/90",
  },
  orange: {
    textClass: "text-orange-600 dark:text-orange-300/90",
    dotClass: "bg-orange-500 dark:bg-orange-300/90",
  },
  amber: {
    textClass: "text-amber-600 dark:text-amber-300/90",
    dotClass: "bg-amber-500 dark:bg-amber-300/90",
  },
  yellow: {
    textClass: "text-yellow-600 dark:text-yellow-300/90",
    dotClass: "bg-yellow-500 dark:bg-yellow-300/90",
  },
  lime: {
    textClass: "text-lime-600 dark:text-lime-300/90",
    dotClass: "bg-lime-500 dark:bg-lime-300/90",
  },
  green: {
    textClass: "text-green-600 dark:text-green-300/90",
    dotClass: "bg-green-500 dark:bg-green-300/90",
  },
  emerald: {
    textClass: "text-emerald-600 dark:text-emerald-300/90",
    dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
  },
  teal: {
    textClass: "text-teal-600 dark:text-teal-300/90",
    dotClass: "bg-teal-500 dark:bg-teal-300/90",
  },
  cyan: {
    textClass: "text-cyan-600 dark:text-cyan-300/90",
    dotClass: "bg-cyan-500 dark:bg-cyan-300/90",
  },
  sky: {
    textClass: "text-sky-600 dark:text-sky-300/80",
    dotClass: "bg-sky-500 dark:bg-sky-300/80",
  },
  blue: {
    textClass: "text-blue-600 dark:text-blue-300/90",
    dotClass: "bg-blue-500 dark:bg-blue-300/90",
  },
  indigo: {
    textClass: "text-indigo-600 dark:text-indigo-300/90",
    dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
  },
  violet: {
    textClass: "text-violet-600 dark:text-violet-300/90",
    dotClass: "bg-violet-500 dark:bg-violet-300/90",
  },
  purple: {
    textClass: "text-purple-600 dark:text-purple-300/90",
    dotClass: "bg-purple-500 dark:bg-purple-300/90",
  },
  fuchsia: {
    textClass: "text-fuchsia-600 dark:text-fuchsia-300/90",
    dotClass: "bg-fuchsia-500 dark:bg-fuchsia-300/90",
  },
  pink: {
    textClass: "text-pink-600 dark:text-pink-300/90",
    dotClass: "bg-pink-500 dark:bg-pink-300/90",
  },
  rose: {
    textClass: "text-rose-600 dark:text-rose-300/90",
    dotClass: "bg-rose-500 dark:bg-rose-300/90",
  },
} as const satisfies Record<string, { textClass: string; dotClass: string }>;

type ThreadStatusInput = Pick<
  Thread,
  | "customIndicator"
  | "interactionMode"
  | "latestTurn"
  | "lastVisitedAt"
  | "proposedPlans"
  | "session"
> & {
  error?: Thread["error"];
};

function makeDerivedStatusPill(
  label: keyof typeof THREAD_STATUS_PRIORITY,
  colorClass: string,
  dotClass: string,
  pulse: boolean,
): ThreadStatusPill {
  return {
    label,
    colorClass,
    dotClass,
    pulse,
    priority: THREAD_STATUS_PRIORITY[label],
  };
}

function resolveCustomIndicatorPill(
  indicator: OrchestrationCustomIndicator | null | undefined,
): ThreadStatusPill | null {
  if (!indicator) return null;
  const toneKey = indicator.tone as keyof typeof CUSTOM_INDICATOR_TONE_CLASSES | undefined;
  const toneClasses =
    (toneKey ? CUSTOM_INDICATOR_TONE_CLASSES[toneKey] : undefined) ??
    CUSTOM_INDICATOR_TONE_CLASSES.slate;
  const style: CSSProperties = {};
  if (indicator.textColor) {
    style.color = indicator.textColor;
  }
  if (indicator.bgColor) {
    style.backgroundColor = indicator.bgColor;
  }
  const dotStyle: CSSProperties | undefined = indicator.dotColor
    ? { backgroundColor: indicator.dotColor }
    : undefined;

  return {
    label: indicator.label,
    colorClass: toneClasses.textClass,
    dotClass: toneClasses.dotClass,
    pulse: indicator.pulse ?? false,
    priority: indicator.priority ?? CUSTOM_INDICATOR_DEFAULT_PRIORITY,
    ...(indicator.bgColor ? { containerClass: "rounded-full px-1.5 py-0.5" } : {}),
    ...(Object.keys(style).length > 0 ? { style } : {}),
    ...(dotStyle ? { dotStyle } : {}),
  };
}

function normalizeCompletedStatusPill(pill: ThreadStatusPill | null): ThreadStatusPill | null {
  if (!pill || !/goal achieved|work complete|complete|completed/i.test(pill.label)) {
    return pill;
  }
  return {
    ...pill,
    label: "Complete",
    colorClass: "text-green-600 dark:text-green-300/90",
    dotClass: "bg-green-500 dark:bg-green-300/90",
    pulse: false,
  };
}

function isProblemStatusPill(pill: ThreadStatusPill | null): boolean {
  return Boolean(pill && /problem|blocked|error|failed/i.test(pill.label));
}

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export function resolveSidebarNewThreadEnvMode(input: {
  requestedEnvMode?: SidebarNewThreadEnvMode;
  defaultEnvMode: SidebarNewThreadEnvMode;
}): SidebarNewThreadEnvMode {
  return input.requestedEnvMode ?? input.defaultEnvMode;
}

export function resolveDraftThreadTitle(prompt: string | null | undefined): string {
  const firstLine = (prompt ?? "")
    .split(/\r?\n/, 1)[0]
    ?.trim();
  return firstLine && firstLine.length > 0 ? firstLine : "New thread";
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName =
    "h-7 w-full translate-x-0 cursor-pointer justify-start px-2 text-left select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  if (input.isSelected && input.isActive) {
    return cn(
      baseClassName,
      "bg-primary/22 text-foreground font-medium hover:bg-primary/26 hover:text-foreground dark:bg-primary/30 dark:hover:bg-primary/36",
    );
  }

  if (input.isSelected) {
    return cn(
      baseClassName,
      "bg-primary/15 text-foreground hover:bg-primary/19 hover:text-foreground dark:bg-primary/22 dark:hover:bg-primary/28",
    );
  }

  if (input.isActive) {
    return cn(
      baseClassName,
      "bg-accent/85 text-foreground font-medium hover:bg-accent hover:text-foreground dark:bg-accent/55 dark:hover:bg-accent/70",
    );
  }

  return cn(baseClassName, "text-muted-foreground hover:bg-accent hover:text-foreground");
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
}): ThreadStatusPill | null {
  const { hasPendingApprovals, hasPendingUserInput, thread } = input;
  if (thread.session?.status === "error" || thread.error) {
    return {
      label: "Problem",
      colorClass: "text-rose-600 dark:text-rose-300/90",
      dotClass: "bg-rose-500 dark:bg-rose-300/90",
      pulse: false,
      priority: 6,
    };
  }

  const customIndicator = normalizeCompletedStatusPill(resolveCustomIndicatorPill(thread.customIndicator));
  if (customIndicator) {
    return customIndicator;
  }

  if (hasPendingApprovals) {
    return makeDerivedStatusPill(
      "Pending Approval",
      "text-amber-600 dark:text-amber-300/90",
      "bg-amber-500 dark:bg-amber-300/90",
      false,
    );
  }

  if (hasPendingUserInput) {
    return makeDerivedStatusPill(
      "Awaiting Input",
      "text-indigo-600 dark:text-indigo-300/90",
      "bg-indigo-500 dark:bg-indigo-300/90",
      false,
    );
  }

  if (thread.session?.status === "running") {
    return makeDerivedStatusPill(
      "Working",
      "text-sky-600 dark:text-sky-300/80",
      "bg-sky-500 dark:bg-sky-300/80",
      true,
    );
  }

  if (thread.session?.status === "connecting") {
    return makeDerivedStatusPill(
      "Connecting",
      "text-sky-600 dark:text-sky-300/80",
      "bg-sky-500 dark:bg-sky-300/80",
      true,
    );
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    hasActionableProposedPlan(
      findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null),
    );
  if (hasPlanReadyPrompt) {
    return makeDerivedStatusPill(
      "Plan Ready",
      "text-violet-600 dark:text-violet-300/90",
      "bg-violet-500 dark:bg-violet-300/90",
      false,
    );
  }

  if (hasUnseenCompletion(thread)) {
    return makeDerivedStatusPill(
      "Completed",
      "text-green-600 dark:text-green-300/90",
      "bg-green-500 dark:bg-green-300/90",
      false,
    );
  }

  return null;
}

export function resolveProjectStatusIndicator(input: {
  loopIndicator?: OrchestrationCustomIndicator | null;
  projectCustomIndicator?: OrchestrationCustomIndicator | null;
  supervisorThreadStatus?: ThreadStatusPill | null;
  leaderThreadStatus: ThreadStatusPill | null;
}): ThreadStatusPill | null {
  const loopStatus = normalizeCompletedStatusPill(resolveCustomIndicatorPill(input.loopIndicator));
  const projectStatus = normalizeCompletedStatusPill(
    resolveCustomIndicatorPill(input.projectCustomIndicator),
  );
  const supervisorThreadStatus = normalizeCompletedStatusPill(input.supervisorThreadStatus ?? null);
  const leaderThreadStatus = normalizeCompletedStatusPill(input.leaderThreadStatus);

  if (isProblemStatusPill(loopStatus)) {
    return loopStatus;
  }
  if (isProblemStatusPill(supervisorThreadStatus)) {
    return supervisorThreadStatus;
  }
  if (isProblemStatusPill(projectStatus)) {
    return projectStatus;
  }
  if (supervisorThreadStatus?.label === "Complete") {
    return supervisorThreadStatus;
  }
  if (loopStatus) {
    return loopStatus;
  }
  if (projectStatus) {
    return projectStatus;
  }
  if (supervisorThreadStatus) {
    return supervisorThreadStatus;
  }
  return leaderThreadStatus;
}

export function createSidebarBadgeUpdateCommand(input: {
  commandId: CommandId;
  target: SidebarBadgeTarget;
  customIndicator: OrchestrationCustomIndicator | null;
}) {
  if (input.target.kind === "thread") {
    return {
      type: "thread.meta.update" as const,
      commandId: input.commandId,
      threadId: input.target.id,
      customIndicator: input.customIndicator,
    };
  }

  return {
    type: "project.meta.update" as const,
    commandId: input.commandId,
    projectId: input.target.id,
    customIndicator: input.customIndicator,
  };
}

export function getVisibleThreadsForProject(input: {
  threads: readonly Thread[];
  activeThreadId: Thread["id"] | undefined;
  isThreadListExpanded: boolean;
  previewLimit: number;
}): {
  hasHiddenThreads: boolean;
  visibleThreads: Thread[];
} {
  const { activeThreadId, isThreadListExpanded, previewLimit, threads } = input;
  const hasHiddenThreads = threads.length > previewLimit;

  if (!hasHiddenThreads || isThreadListExpanded) {
    return {
      hasHiddenThreads,
      visibleThreads: [...threads],
    };
  }

  const previewThreads = threads.slice(0, previewLimit);
  if (!activeThreadId || previewThreads.some((thread) => thread.id === activeThreadId)) {
    return {
      hasHiddenThreads: true,
      visibleThreads: previewThreads,
    };
  }

  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  if (!activeThread) {
    return {
      hasHiddenThreads: true,
      visibleThreads: previewThreads,
    };
  }

  const visibleThreadIds = new Set([...previewThreads, activeThread].map((thread) => thread.id));

  return {
    hasHiddenThreads: true,
    visibleThreads: threads.filter((thread) => visibleThreadIds.has(thread.id)),
  };
}

function toSortableTimestamp(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function getLatestUserMessageTimestamp(thread: SidebarThreadSortInput): number {
  let latestUserMessageTimestamp: number | null = null;

  for (const message of thread.messages) {
    if (message.role !== "user") continue;
    const messageTimestamp = toSortableTimestamp(message.createdAt);
    if (messageTimestamp === null) continue;
    latestUserMessageTimestamp =
      latestUserMessageTimestamp === null
        ? messageTimestamp
        : Math.max(latestUserMessageTimestamp, messageTimestamp);
  }

  if (latestUserMessageTimestamp !== null) {
    return latestUserMessageTimestamp;
  }

  return toSortableTimestamp(thread.updatedAt ?? thread.createdAt) ?? Number.NEGATIVE_INFINITY;
}

function getThreadSortTimestamp(
  thread: SidebarThreadSortInput,
  sortOrder: SidebarThreadSortOrder | Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (sortOrder === "created_at") {
    return toSortableTimestamp(thread.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return getLatestUserMessageTimestamp(thread);
}

export function sortThreadsForSidebar<
  T extends Pick<Thread, "id" | "createdAt" | "updatedAt" | "messages">,
>(threads: readonly T[], sortOrder: SidebarThreadSortOrder): T[] {
  if (sortOrder === "manual") {
    return [...threads];
  }
  return threads.toSorted((left, right) => {
    const rightTimestamp = getThreadSortTimestamp(right, sortOrder);
    const leftTimestamp = getThreadSortTimestamp(left, sortOrder);
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return right.id.localeCompare(left.id);
  });
}

export function getProjectSortTimestamp(
  project: SidebarProject,
  projectThreads: readonly SidebarThreadSortInput[],
  sortOrder: Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (projectThreads.length > 0) {
    return projectThreads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }

  if (sortOrder === "created_at") {
    return toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

export function sortProjectsForSidebar<TProject extends SidebarProject, TThread extends Thread>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  if (sortOrder === "manual") {
    return [...projects];
  }

  const threadsByProjectId = new Map<string, TThread[]>();
  for (const thread of threads) {
    const existing = threadsByProjectId.get(thread.projectId) ?? [];
    existing.push(thread);
    threadsByProjectId.set(thread.projectId, existing);
  }

  return [...projects].toSorted((left, right) => {
    const rightTimestamp = getProjectSortTimestamp(
      right,
      threadsByProjectId.get(right.id) ?? [],
      sortOrder,
    );
    const leftTimestamp = getProjectSortTimestamp(
      left,
      threadsByProjectId.get(left.id) ?? [],
      sortOrder,
    );
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}
