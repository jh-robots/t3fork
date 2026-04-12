import {
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  FileTextIcon,
  FolderIcon,
  PaletteIcon,
  GitPullRequestIcon,
  PlusIcon,
  RocketIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { autoAnimate } from "@formkit/auto-animate";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  DndContext,
  type DragCancelEvent,
  type CollisionDetection,
  PointerSensor,
  type DragStartEvent,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  type OrchestrationCustomIndicator,
  DEFAULT_MODEL_BY_PROVIDER,
  type DesktopUpdateState,
  type JhLoopBinding,
  type JhLoopCreateRequest,
  type JhLoopStatusResult,
  type JhLoopType,
  type ProviderInteractionMode,
  ProjectId,
  type RuntimeMode,
  ThreadId,
  type GitStatusResult,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  getAppModelOptions,
  getCustomModelsByProvider,
  type SidebarProjectSortOrder,
  type SidebarThreadSortOrder,
  useAppSettings,
} from "../appSettings";
import { isElectron } from "../env";
import { APP_STAGE_LABEL, APP_VERSION } from "../branding";
import {
  buildLoopStatusStateByJobKey,
  orderLoopProjectThreads,
  resolveLoopStatusForBinding,
} from "../jhLoopSidebar";
import { cn, isLinuxPlatform, isMacPlatform, newCommandId, newProjectId } from "../lib/utils";
import { useStore } from "../store";
import { shortcutLabelForCommand } from "../keybindings";
import { derivePendingApprovals, derivePendingUserInputs } from "../session-logic";
import { gitRemoveWorktreeMutationOptions, gitStatusQueryOptions } from "../lib/gitReactQuery";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { toastManager } from "./ui/toast";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldHighlightDesktopUpdateError,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "./ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenuAction,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";
import { Switch } from "./ui/switch";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { isNonEmpty as isNonEmptyString } from "effect/String";
import {
  createSidebarBadgeUpdateCommand,
  getVisibleThreadsForProject,
  resolveDraftThreadTitle,
  resolveProjectStatusIndicator,
  resolveSidebarNewThreadEnvMode,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  shouldClearThreadSelectionOnMouseDown,
  sortThreadsForSidebar,
} from "./Sidebar.logic";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { getLocalStorageItem, useLocalStorage } from "~/hooks/useLocalStorage";
import {
  BACKEND_TARGET_DESCRIPTIONS,
  BACKEND_TARGET_LABELS,
  BACKEND_TARGET_STORAGE_KEY,
  BackendTarget,
  DEFAULT_BACKEND_TARGET,
  resolveBackendTargetHttpOrigin,
} from "~/backendTarget";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { flattenSidebarTree } from "../sidebarTree";
import {
  resolveSidebarContainerDisplayTitle,
  resolveSidebarNodeRuntimeProjectId,
  resolveSidebarNodeWorkspaceRoot,
} from "../sidebarNodeRuntime";
import { StatusIndicatorPill } from "./StatusIndicatorPill";
import type { Project, SidebarNodeAccent, SidebarTreeNode, SidebarTreeNodeId, Thread } from "../types";
import {
  controlJhLoop,
  createJhLoop,
  fetchJhLoopStatus,
  getJhLoopErrorMessage,
} from "../jhLoopManagement";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const THREAD_PREVIEW_LIMIT = 6;
const SIDEBAR_SORT_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};
const SIDEBAR_THREAD_SORT_LABELS: Record<SidebarThreadSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};
const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;
const loadedProjectFaviconSrcs = new Set<string>();
const SIDEBAR_BADGE_TONE_SUGGESTIONS = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
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
] as const;

type SidebarBadgeEditorTarget =
  | {
      kind: "thread";
      id: ThreadId;
      title: string;
      indicator: Thread["customIndicator"];
    }
  | {
      kind: "project";
      id: ProjectId;
      title: string;
      indicator: Project["customIndicator"];
    };

type SidebarBadgeFormState = {
  label: string;
  tone: string;
  textColor: string;
  dotColor: string;
  bgColor: string;
  pulse: boolean;
  priority: string;
};

type SidebarNodeCustomizerTarget = {
  nodeId: SidebarTreeNodeId;
  title: string;
  runtimeProjectId: ProjectId | null;
};

type SidebarLoopDialogTarget = {
  nodeId: SidebarTreeNodeId;
  title: string;
  runtimeProjectId: ProjectId | null;
  workspaceRoot: string;
  loopBinding: JhLoopBinding | null;
  isDraftNode: boolean;
};

type SidebarLoopFormState = {
  loopType: JhLoopType;
  objective: string;
  completionCriteria: string;
  projectTitle: string;
  workerCount: number;
  workerModel: string;
  supervisorModel: string;
  workerRuntimeMode: RuntimeMode;
  workerInteractionMode: ProviderInteractionMode;
  supervisorRuntimeMode: RuntimeMode;
  supervisorInteractionMode: ProviderInteractionMode;
};

function createSidebarLoopFormState(
  input?: Partial<SidebarLoopFormState>,
): SidebarLoopFormState {
  return {
    loopType: input?.loopType ?? "goal-loop",
    objective: input?.objective ?? "",
    completionCriteria: input?.completionCriteria ?? "",
    projectTitle: input?.projectTitle ?? "",
    workerCount: input?.workerCount ?? 1,
    workerModel: input?.workerModel ?? DEFAULT_MODEL_BY_PROVIDER.codex,
    supervisorModel: input?.supervisorModel ?? DEFAULT_MODEL_BY_PROVIDER.codex,
    workerRuntimeMode: input?.workerRuntimeMode ?? "full-access",
    workerInteractionMode: input?.workerInteractionMode ?? "default",
    supervisorRuntimeMode: input?.supervisorRuntimeMode ?? "full-access",
    supervisorInteractionMode: input?.supervisorInteractionMode ?? "default",
  };
}

function buildJhLoopCreateRequest(input: {
  target: SidebarLoopDialogTarget;
  form: SidebarLoopFormState;
}): JhLoopCreateRequest {
  const projectTitle = input.form.projectTitle.trim() || input.target.title.trim() || "Loop Project";
  const completionCriteria = input.form.completionCriteria.trim();
  return {
    loopType: input.form.loopType,
    project: {
      ...(input.target.runtimeProjectId ? { projectId: input.target.runtimeProjectId } : {}),
      workspaceRoot: input.target.workspaceRoot.trim(),
      title: projectTitle,
    },
    objective: input.form.objective.trim(),
    ...(completionCriteria ? { completionCriteria } : {}),
    workerCount: Math.max(1, Math.round(input.form.workerCount)),
    workerModel: input.form.workerModel.trim(),
    supervisorModel: input.form.supervisorModel.trim(),
    workerRuntimeMode: input.form.workerRuntimeMode,
    workerInteractionMode: input.form.workerInteractionMode,
    supervisorRuntimeMode: input.form.supervisorRuntimeMode,
    supervisorInteractionMode: input.form.supervisorInteractionMode,
  };
}

function deriveInitialLoopTitle(sourceTitle?: string | null): string {
  const trimmed = sourceTitle?.trim() ?? "";
  if (!trimmed || /^new (folder|loop)$/i.test(trimmed)) {
    return "New loop";
  }
  return /loop$/i.test(trimmed) ? trimmed : `${trimmed} Loop`;
}

const SIDEBAR_NODE_ACCENT_OPTIONS: ReadonlyArray<{
  value: SidebarNodeAccent;
  label: string;
  buttonClassName: string;
  rowClassName: string;
  iconClassName: string;
}> = [
  {
    value: "neutral",
    label: "Neutral",
    buttonClassName: "border-zinc-400/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-200",
    rowClassName: "border-zinc-500/25 bg-zinc-500/7",
    iconClassName: "text-zinc-600 dark:text-zinc-300",
  },
  {
    value: "slate",
    label: "Slate",
    buttonClassName: "border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-200",
    rowClassName: "border-slate-500/25 bg-slate-500/7",
    iconClassName: "text-slate-600 dark:text-slate-300",
  },
  {
    value: "blue",
    label: "Blue",
    buttonClassName: "border-blue-400/40 bg-blue-500/10 text-blue-700 dark:text-blue-200",
    rowClassName: "border-blue-500/25 bg-blue-500/8",
    iconClassName: "text-blue-600 dark:text-blue-300",
  },
  {
    value: "green",
    label: "Green",
    buttonClassName: "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
    rowClassName: "border-emerald-500/25 bg-emerald-500/8",
    iconClassName: "text-emerald-600 dark:text-emerald-300",
  },
  {
    value: "amber",
    label: "Amber",
    buttonClassName: "border-amber-400/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
    rowClassName: "border-amber-500/25 bg-amber-500/8",
    iconClassName: "text-amber-600 dark:text-amber-300",
  },
  {
    value: "rose",
    label: "Rose",
    buttonClassName: "border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-200",
    rowClassName: "border-rose-500/25 bg-rose-500/8",
    iconClassName: "text-rose-600 dark:text-rose-300",
  },
  {
    value: "violet",
    label: "Violet",
    buttonClassName: "border-violet-400/40 bg-violet-500/10 text-violet-700 dark:text-violet-200",
    rowClassName: "border-violet-500/25 bg-violet-500/8",
    iconClassName: "text-violet-600 dark:text-violet-300",
  },
  {
    value: "cyan",
    label: "Cyan",
    buttonClassName: "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200",
    rowClassName: "border-cyan-500/25 bg-cyan-500/8",
    iconClassName: "text-cyan-600 dark:text-cyan-300",
  },
] as const;

function resolveSidebarNodeAccentOption(accent: SidebarNodeAccent | null | undefined) {
  return SIDEBAR_NODE_ACCENT_OPTIONS.find((option) => option.value === accent) ?? null;
}

function toSidebarBadgeFormState(
  indicator: OrchestrationCustomIndicator | null | undefined,
): SidebarBadgeFormState {
  return {
    label: indicator?.label ?? "",
    tone: indicator?.tone ?? "",
    textColor: indicator?.textColor ?? "",
    dotColor: indicator?.dotColor ?? "",
    bgColor: indicator?.bgColor ?? "",
    pulse: indicator?.pulse ?? false,
    priority: indicator?.priority !== undefined ? String(indicator.priority) : "",
  };
}

function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface TerminalStatusIndicator {
  label: "Terminal process running";
  colorClass: string;
  pulse: boolean;
}

interface PrStatusIndicator {
  label: "PR open" | "PR closed" | "PR merged";
  colorClass: string;
  tooltip: string;
  url: string;
}

type ThreadPr = GitStatusResult["pr"];

function terminalStatusFromRunningIds(
  runningTerminalIds: string[],
): TerminalStatusIndicator | null {
  if (runningTerminalIds.length === 0) {
    return null;
  }
  return {
    label: "Terminal process running",
    colorClass: "text-teal-600 dark:text-teal-300/90",
    pulse: true,
  };
}

function prStatusIndicator(pr: ThreadPr): PrStatusIndicator | null {
  if (!pr) return null;

  if (pr.state === "open") {
    return {
      label: "PR open",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      tooltip: `#${pr.number} PR open: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "closed") {
    return {
      label: "PR closed",
      colorClass: "text-zinc-500 dark:text-zinc-400/80",
      tooltip: `#${pr.number} PR closed: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "merged") {
    return {
      label: "PR merged",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      tooltip: `#${pr.number} PR merged: ${pr.title}`,
      url: pr.url,
    };
  }
  return null;
}

function T3Wordmark() {
  return (
    <div
      aria-label="JH"
      className="shrink-0 text-sm font-semibold tracking-[0.2em] text-foreground uppercase"
    >
      JH
    </div>
  );
}

/**
 * Derives the server's HTTP origin (scheme + host + port) from the same
 * sources WsTransport uses, converting ws(s) to http(s).
 */
function getServerHttpOrigin(): string {
  const bridgeUrl = window.desktopBridge?.getWsUrl();
  const configuredTarget =
    getLocalStorageItem(BACKEND_TARGET_STORAGE_KEY, BackendTarget) ?? DEFAULT_BACKEND_TARGET;
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsUrl =
    bridgeUrl && bridgeUrl.length > 0
      ? bridgeUrl
      : envUrl && envUrl.length > 0
        ? envUrl
        : resolveBackendTargetHttpOrigin(configuredTarget).replace(/^http:/, "ws:");
  // Parse to extract just the origin, dropping path/query (e.g. ?token=…)
  const httpUrl = wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  try {
    return new URL(httpUrl).origin;
  } catch {
    return httpUrl;
  }
}

const serverHttpOrigin = getServerHttpOrigin();

function BackendTargetControl() {
  const [backendTarget, setBackendTarget] = useLocalStorage(
    BACKEND_TARGET_STORAGE_KEY,
    DEFAULT_BACKEND_TARGET,
    BackendTarget,
  );

  const handleBackendChange = (value: BackendTarget | null) => {
    if (!value) {
      return;
    }
    const nextTarget = value;
    if (nextTarget === backendTarget) {
      return;
    }
    setBackendTarget(nextTarget);
    window.location.reload();
  };

  return (
    <div className="rounded-lg border border-border/70 bg-card/60 px-2 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
          Backend
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          {resolveBackendTargetHttpOrigin(backendTarget)}
        </span>
      </div>
      <Select
        value={backendTarget}
        onValueChange={handleBackendChange}
      >
        <SelectTrigger size="xs" aria-label="Backend target">
          <SelectValue>{BACKEND_TARGET_LABELS[backendTarget]}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {(Object.keys(BACKEND_TARGET_LABELS) as BackendTarget[]).map((target) => (
            <SelectItem hideIndicator key={target} value={target}>
              {BACKEND_TARGET_LABELS[target]}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/70">
        {BACKEND_TARGET_DESCRIPTIONS[backendTarget]}
      </p>
    </div>
  );
}

function ProjectFavicon({ cwd }: { cwd: string }) {
  const src = `${serverHttpOrigin}/api/project-favicon?cwd=${encodeURIComponent(cwd)}`;
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(() =>
    loadedProjectFaviconSrcs.has(src) ? "loaded" : "loading",
  );

  if (status === "error") {
    return <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/50" />;
  }

  return (
    <img
      src={src}
      alt=""
      className={`size-3.5 shrink-0 rounded-sm object-contain ${status === "loading" ? "hidden" : ""}`}
      onLoad={() => {
        loadedProjectFaviconSrcs.add(src);
        setStatus("loaded");
      }}
      onError={() => setStatus("error")}
    />
  );
}

type SortableProjectHandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
> & {
  setNodeRef: ReturnType<typeof useSortable>["setNodeRef"];
  style: React.CSSProperties;
  className?: string;
};

type SortableThreadHandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
> & {
  setNodeRef: ReturnType<typeof useSortable>["setNodeRef"];
  style: React.CSSProperties;
  className?: string;
};

function primaryButtonOnlyDragListeners<
  T extends { onPointerDown?: ((event: unknown) => void) | undefined } | null | undefined,
>(listeners: T): T {
  if (!listeners?.onPointerDown) {
    return listeners;
  }

  return {
    ...listeners,
    onPointerDown: (event: unknown) => {
      if (
        typeof event === "object" &&
        event !== null &&
        "button" in event &&
        typeof event.button === "number" &&
        event.button !== 0
      ) {
        return;
      }
      listeners.onPointerDown?.(event);
    },
  };
}

type SidebarDragTarget =
  | { kind: "node"; nodeId: SidebarTreeNodeId }
  | { kind: "thread"; threadId: ThreadId }
  | null;

type SidebarRootActionId = "new-folder" | "new-thread" | "create-loop";
type SidebarFolderActionId =
  | "new-folder"
  | "new-thread"
  | "create-loop"
  | "pause-loop"
  | "resume-loop"
  | "stop-loop"
  | "convert-to-goal-loop"
  | "convert-to-endless-loop"
  | "open-supervisor-thread"
  | "open-worker-threads"
  | "quick-style"
  | "customize"
  | "clear-workspace"
  | "rename"
  | "delete";
type SidebarProjectActionId =
  | "new-thread"
  | "create-loop"
  | "rename"
  | "delete";
type SidebarThreadActionId =
  | "new-thread"
  | "rename"
  | "set-badge"
  | "clear-badge"
  | "set-project-leader"
  | "clear-project-leader"
  | "mark-unread"
  | "copy-path"
  | "copy-thread-id"
  | "delete";

const DEFAULT_FOLDER_ICON = "\u{1F4C1}";
const GOAL_LOOP_ICON = "\u{1F501}";
const ENDLESS_LOOP_ICON = "\u{1F504}";

const SIDEBAR_ROOT_ACTIONS: ReadonlyArray<{ id: SidebarRootActionId; label: string }> = [
  { id: "new-folder", label: `${DEFAULT_FOLDER_ICON} New folder` },
  { id: "new-thread", label: "📄 New thread" },
  { id: "create-loop", label: `${GOAL_LOOP_ICON} New loop` },
];

const SIDEBAR_FOLDER_ACTIONS: ReadonlyArray<{ id: SidebarFolderActionId; label: string }> = [
  { id: "new-folder", label: `${DEFAULT_FOLDER_ICON} New folder` },
  { id: "new-thread", label: "📄 New thread" },
  { id: "create-loop", label: `${GOAL_LOOP_ICON} New loop` },
  { id: "pause-loop", label: "⏸ Pause loop" },
  { id: "resume-loop", label: "▶ Resume loop" },
  { id: "stop-loop", label: "⏹ Stop loop" },
  { id: "convert-to-goal-loop", label: "Convert to goal loop" },
  { id: "convert-to-endless-loop", label: "Convert to endless loop" },
  { id: "open-supervisor-thread", label: "Open supervisor thread" },
  { id: "open-worker-threads", label: "Open worker threads" },
  { id: "quick-style", label: "Quick style" },
  { id: "customize", label: "Customize" },
  { id: "clear-workspace", label: "Clear workspace override" },
  { id: "rename", label: "Rename" },
  { id: "delete", label: "Delete" },
];

const SIDEBAR_PROJECT_ACTIONS: ReadonlyArray<{ id: SidebarProjectActionId; label: string }> = [
  { id: "new-thread", label: "New thread" },
  { id: "create-loop", label: `${GOAL_LOOP_ICON} New loop` },
  { id: "rename", label: "Rename project" },
  { id: "delete", label: "Remove project" },
];

const SIDEBAR_THREAD_ACTIONS_BASE: ReadonlyArray<{ id: SidebarThreadActionId; label: string }> = [
  { id: "new-thread", label: "New thread" },
  { id: "rename", label: "Rename thread" },
  { id: "set-badge", label: "Set Badge" },
  { id: "clear-badge", label: "Clear Badge" },
  { id: "mark-unread", label: "Mark unread" },
  { id: "copy-path", label: "Copy Path" },
  { id: "copy-thread-id", label: "Copy Thread ID" },
  { id: "delete", label: "Delete" },
];

function isDefaultFolderIcon(icon: string | null | undefined): boolean {
  return icon === DEFAULT_FOLDER_ICON;
}

function getLoopFolderIcon(loopType: JhLoopType): string {
  return loopType === "endless-loop" ? ENDLESS_LOOP_ICON : GOAL_LOOP_ICON;
}

function isLoopFolderIcon(icon: string | null | undefined): boolean {
  return icon === GOAL_LOOP_ICON || icon === ENDLESS_LOOP_ICON;
}

function renderDefaultFolderEmoji(loopType?: JhLoopType | null) {
  return (
    <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-sm">
      {loopType ? getLoopFolderIcon(loopType) : DEFAULT_FOLDER_ICON}
    </span>
  );
}

function inferLoopFolderIconType(
  projectName: string,
  projectThreads: readonly Pick<Thread, "title">[],
): JhLoopType | null {
  const normalizedProjectName = projectName.trim();
  if (normalizedProjectName.length === 0) {
    return null;
  }

  const hasSupervisorThread = projectThreads.some(
    (thread) => thread.title === `${normalizedProjectName} Supervisor`,
  );
  const hasWorkerThread = projectThreads.some((thread) =>
    thread.title.startsWith(`${normalizedProjectName} Worker`),
  );

  return hasSupervisorThread && hasWorkerThread ? "goal-loop" : null;
}

const SIDEBAR_NODE_DRAG_PREFIX = "node:";
const SIDEBAR_THREAD_DRAG_PREFIX = "thread:";
const SIDEBAR_NODE_ICON_PRESETS = ["\u{1F4C1}", "\u{1F9E0}", "\u{1F4A1}", "\u{1F525}", "\u2B50", "\u{1F4CC}", "\u{1F6E0}\uFE0F", "\u{1F680}", "\u{1F4DD}", "\u{1F3AF}", "\u{1F52C}", "\u{1F5C2}\uFE0F"] as const;

function getSidebarNodeDragId(nodeId: SidebarTreeNodeId): string {
  return `${SIDEBAR_NODE_DRAG_PREFIX}${nodeId}`;
}

function getSidebarThreadDragId(threadId: ThreadId): string {
  return `${SIDEBAR_THREAD_DRAG_PREFIX}${threadId}`;
}

function parseSidebarDragTarget(id: string): SidebarDragTarget {
  if (id.startsWith(SIDEBAR_NODE_DRAG_PREFIX)) {
    return {
      kind: "node",
      nodeId: id.slice(SIDEBAR_NODE_DRAG_PREFIX.length),
    };
  }
  if (id.startsWith(SIDEBAR_THREAD_DRAG_PREFIX)) {
    return {
      kind: "thread",
      threadId: ThreadId.makeUnsafe(id.slice(SIDEBAR_THREAD_DRAG_PREFIX.length)),
    };
  }
  return null;
}

function ProjectSortMenu({
  projectSortOrder,
  threadSortOrder,
  onProjectSortOrderChange,
  onThreadSortOrderChange,
}: {
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  onProjectSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground" />
          }
        >
          <ArrowUpDownIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">Sort projects</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-44">
        <MenuGroup>
          <div className="px-2 py-1 sm:text-xs font-medium text-muted-foreground">
            Sort projects
          </div>
          <MenuRadioGroup
            value={projectSortOrder}
            onValueChange={(value) => {
              onProjectSortOrderChange(value as SidebarProjectSortOrder);
            }}
          >
            {(Object.entries(SIDEBAR_SORT_LABELS) as Array<[SidebarProjectSortOrder, string]>).map(
              ([value, label]) => (
                <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                  {label}
                </MenuRadioItem>
              ),
            )}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 sm:text-xs font-medium text-muted-foreground">
            Sort threads
          </div>
          <MenuRadioGroup
            value={threadSortOrder}
            onValueChange={(value) => {
              onThreadSortOrderChange(value as SidebarThreadSortOrder);
            }}
          >
            {(
              Object.entries(SIDEBAR_THREAD_SORT_LABELS) as Array<[SidebarThreadSortOrder, string]>
            ).map(([value, label]) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function SortableProjectItem({
  dragId,
  disabled = false,
  children,
}: {
  dragId: string;
  disabled?: boolean;
  children: (handleProps: SortableProjectHandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: dragId, disabled });
  return children({
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    style: {
      transform: CSS.Translate.toString(transform),
      transition,
    },
    className: `${isDragging ? "z-20 opacity-80" : ""} ${
      isOver && !isDragging ? "ring-1 ring-primary/40" : ""
    }`.trim(),
  });
}

function SortableThreadItem({
  dragId,
  disabled = false,
  children,
}: {
  dragId: string;
  disabled?: boolean;
  children: (handleProps: SortableThreadHandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: dragId, disabled });
  return children({
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    style: {
      transform: CSS.Translate.toString(transform),
      transition,
    },
    className: `${isDragging ? "z-20 opacity-80" : ""} ${
      isOver && !isDragging ? "ring-1 ring-primary/40" : ""
    }`.trim(),
  });
}

export default function Sidebar() {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const sidebarTree = useStore((store) => store.sidebarTree);
  const markThreadUnread = useStore((store) => store.markThreadUnread);
  const createSidebarVirtualProject = useStore((store) => store.createSidebarVirtualProject);
  const projectLeaderThreadIdByProjectId = useStore((store) => store.projectLeaderThreadIdByProjectId);
  const renameSidebarNode = useStore((store) => store.renameSidebarNode);
  const bindSidebarNodeToRuntimeProject = useStore((store) => store.bindSidebarNodeToRuntimeProject);
  const setSidebarNodeWorkspaceOverride = useStore(
    (store) => store.setSidebarNodeWorkspaceOverride,
  );
  const setSidebarNodeIcon = useStore((store) => store.setSidebarNodeIcon);
  const setSidebarNodeAccent = useStore((store) => store.setSidebarNodeAccent);
  const setSidebarNodeLoopBinding = useStore((store) => store.setSidebarNodeLoopBinding);
  const toggleSidebarNodeExpanded = useStore((store) => store.toggleSidebarNodeExpanded);
  const deleteSidebarNode = useStore((store) => store.deleteSidebarNode);
  const moveSidebarNode = useStore((store) => store.moveSidebarNode);
  const reorderThreads = useStore((store) => store.reorderThreads);
  const moveThreadToProject = useStore((store) => store.moveThreadToProject);
  const setProjectLeaderThread = useStore((store) => store.setProjectLeaderThread);
  const setThreadCustomIndicator = useStore((store) => store.setThreadCustomIndicator);
  const setProjectCustomIndicator = useStore((store) => store.setProjectCustomIndicator);
  const removeThreadFromStore = useStore((store) => store.removeThread);
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const draftsByThreadId = useComposerDraftStore((store) => store.draftsByThreadId);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearDraftThread);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const isOnSettings = useLocation({ select: (loc) => loc.pathname === "/settings" });
  const { settings: appSettings, updateSettings } = useAppSettings();
  const { handleNewThread } = useHandleNewThread();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const { data: keybindings = EMPTY_KEYBINDINGS } = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.keybindings,
  });
  const queryClient = useQueryClient();
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));
  const [addingProject, setAddingProject] = useState(false);
  const [newCwd, setNewCwd] = useState("");
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const addProjectInputRef = useRef<HTMLInputElement | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingThreadTitle, setRenamingThreadTitle] = useState("");
  const [renamingProjectId, setRenamingProjectId] = useState<ProjectId | null>(null);
  const [renamingProjectTitle, setRenamingProjectTitle] = useState("");
  const [renamingTreeNodeId, setRenamingTreeNodeId] = useState<SidebarTreeNodeId | null>(null);
  const [renamingTreeNodeTitle, setRenamingTreeNodeTitle] = useState("");
  const [badgeEditorTarget, setBadgeEditorTarget] = useState<SidebarBadgeEditorTarget | null>(null);
  const [badgeFormState, setBadgeFormState] = useState<SidebarBadgeFormState>(() =>
    toSidebarBadgeFormState(null),
  );
  const [nodeCustomizerTarget, setNodeCustomizerTarget] = useState<SidebarNodeCustomizerTarget | null>(
    null,
  );
  const [loopDialogTarget, setLoopDialogTarget] = useState<SidebarLoopDialogTarget | null>(null);
  const [loopFormState, setLoopFormState] = useState<SidebarLoopFormState>(() =>
    createSidebarLoopFormState(),
  );
  const [isSubmittingLoopDialog, setIsSubmittingLoopDialog] = useState(false);
  const [quickCustomizeNodeId, setQuickCustomizeNodeId] = useState<SidebarTreeNodeId | null>(null);
  const [nodeWorkspaceDraft, setNodeWorkspaceDraft] = useState("");
  const [nodeIconDraft, setNodeIconDraft] = useState("");
  const [nodeAccentDraft, setNodeAccentDraft] = useState<SidebarNodeAccent | "">("");
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<ProjectId>
  >(() => new Set());
  const renamingThreadCommittedRef = useRef(false);
  const renamingThreadInputRef = useRef<HTMLInputElement | null>(null);
  const renamingProjectCommittedRef = useRef(false);
  const renamingProjectInputRef = useRef<HTMLInputElement | null>(null);
  const renamingTreeNodeCommittedRef = useRef(false);
  const renamingTreeNodeInputRef = useRef<HTMLInputElement | null>(null);
  const dragInProgressRef = useRef(false);
  const suppressProjectClickAfterDragRef = useRef(false);
  const lastThreadContextMenuHandledAtRef = useRef(0);
  const threadDragInProgressRef = useRef(false);
  const suppressThreadClickAfterDragRef = useRef(false);
  const pendingThreadRenameRef = useRef<{
    threadId: ThreadId;
    wasActive: boolean;
    wasSingleFocused: boolean;
  } | null>(null);
  const pendingContainerRenameRef = useRef<{
    nodeId: SidebarTreeNodeId;
    wasExpanded: boolean;
  } | null>(null);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const selectedThreadIds = useThreadSelectionStore((s) => s.selectedThreadIds);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const isLinuxDesktop = isElectron && isLinuxPlatform(navigator.platform);
  const shouldBrowseForProjectImmediately = isElectron && !isLinuxDesktop;
  const shouldShowProjectPathEntry = addingProject && !shouldBrowseForProjectImmediately;
  const projectCwdById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cwd] as const)),
    [projects],
  );
  const customModelsByProvider = useMemo(() => getCustomModelsByProvider(appSettings), [appSettings]);
  const getLoopModelOptions = useCallback(
    (selectedModel: string) => {
      const seen = new Set<string>();
      const options = [
        ...getAppModelOptions("codex", customModelsByProvider.codex).map((option) => {
          seen.add(option.slug);
          return {
            ...option,
            name: `Codex: ${option.name}`,
          };
        }),
        ...getAppModelOptions("claudeAgent", customModelsByProvider.claudeAgent)
          .filter((option) => !seen.has(option.slug))
          .map((option) => ({
            ...option,
            name: `Claude: ${option.name}`,
          })),
      ];
      const trimmedSelectedModel = selectedModel.trim();
      if (trimmedSelectedModel.length > 0 && !seen.has(trimmedSelectedModel)) {
        options.push({
          slug: trimmedSelectedModel,
          name: trimmedSelectedModel,
          isCustom: true,
        });
      }
      return options;
    },
    [customModelsByProvider.claudeAgent, customModelsByProvider.codex],
  );
  const workerModelOptions = useMemo(
    () => getLoopModelOptions(loopFormState.workerModel),
    [getLoopModelOptions, loopFormState.workerModel],
  );
  const supervisorModelOptions = useMemo(
    () => getLoopModelOptions(loopFormState.supervisorModel),
    [getLoopModelOptions, loopFormState.supervisorModel],
  );
  const loopBindingsByNodeId = useMemo(
    () =>
      Object.values(sidebarTree.nodesById)
        .filter(
          (node): node is Extract<SidebarTreeNode, { kind: "folder" | "virtualProject" }> =>
            (node.kind === "folder" || node.kind === "virtualProject") &&
            Boolean(node.loopBinding?.jobKey),
        )
        .map((node) => ({
          nodeId: node.id,
          binding: node.loopBinding!,
        })),
    [sidebarTree],
  );
  const loopStatusQueries = useQueries({
    queries: loopBindingsByNodeId.map(({ binding }) => ({
      queryKey: ["jh-loop-status", binding.jobKey],
      queryFn: () => fetchJhLoopStatus(binding.jobKey),
      staleTime: 1_000,
      refetchInterval: 3_000,
    })),
  });
  const loopStatusStateByJobKey = useMemo(
    () => buildLoopStatusStateByJobKey(loopBindingsByNodeId, loopStatusQueries),
    [loopBindingsByNodeId, loopStatusQueries],
  );
  const threadGitTargets = useMemo(
    () =>
      threads.map((thread) => ({
        threadId: thread.id,
        branch: thread.branch,
        cwd: thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null,
      })),
    [projectCwdById, threads],
  );
  const threadGitStatusCwds = useMemo(
    () => [
      ...new Set(
        threadGitTargets
          .filter((target) => target.branch !== null)
          .map((target) => target.cwd)
          .filter((cwd): cwd is string => cwd !== null),
      ),
    ],
    [threadGitTargets],
  );
  const threadGitStatusQueries = useQueries({
    queries: threadGitStatusCwds.map((cwd) => ({
      ...gitStatusQueryOptions(cwd),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  const prByThreadId = useMemo(() => {
    const statusByCwd = new Map<string, GitStatusResult>();
    for (let index = 0; index < threadGitStatusCwds.length; index += 1) {
      const cwd = threadGitStatusCwds[index];
      if (!cwd) continue;
      const status = threadGitStatusQueries[index]?.data;
      if (status) {
        statusByCwd.set(cwd, status);
      }
    }

    const map = new Map<ThreadId, ThreadPr>();
    for (const target of threadGitTargets) {
      const status = target.cwd ? statusByCwd.get(target.cwd) : undefined;
      const branchMatches =
        target.branch !== null && status?.branch !== null && status?.branch === target.branch;
      map.set(target.threadId, branchMatches ? (status?.pr ?? null) : null);
    }
    return map;
  }, [threadGitStatusCwds, threadGitStatusQueries, threadGitTargets]);

  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, []);

  const focusMostRecentThreadForProject = useCallback(
    (projectId: ProjectId) => {
      const latestThread = sortThreadsForSidebar(
        threads.filter((thread) => thread.projectId === projectId),
        appSettings.sidebarThreadSortOrder,
      )[0];
      if (!latestThread) return;

      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({
        to: "/$threadId",
        params: { threadId: latestThread.id },
      });
    },
    [appSettings.sidebarThreadSortOrder, isMobile, navigate, setOpenMobile, threads],
  );

  const closeLoopDialog = useCallback(() => {
    const currentTarget = loopDialogTarget;
    if (currentTarget?.isDraftNode) {
      const currentNode = useStore.getState().sidebarTree.nodesById[currentTarget.nodeId];
      if (
        currentNode &&
        (currentNode.kind === "folder" || currentNode.kind === "virtualProject") &&
        !currentNode.runtimeProjectId &&
        !currentNode.loopBinding &&
        currentNode.childrenIds.length === 0
      ) {
        deleteSidebarNode(currentTarget.nodeId);
      }
    }
    setLoopDialogTarget(null);
    setLoopFormState(createSidebarLoopFormState());
  }, [deleteSidebarNode, loopDialogTarget]);

  const createSidebarLoopContainer = useCallback(
    (parentId: SidebarTreeNodeId | null, title = "New loop", workspaceRoot?: string | null) => {
      const nodeId = createSidebarVirtualProject(parentId, title);
      setSidebarNodeIcon(nodeId, GOAL_LOOP_ICON);
      if (workspaceRoot !== undefined) {
        setSidebarNodeWorkspaceOverride(nodeId, workspaceRoot);
      }
      return nodeId;
    },
    [createSidebarVirtualProject, setSidebarNodeIcon, setSidebarNodeWorkspaceOverride],
  );

  const focusLoopThread = useCallback(
    (threadId: ThreadId | null) => {
      if (!threadId) {
        return;
      }
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [isMobile, navigate, setOpenMobile],
  );

  const ensureManagedContainerForProject = useCallback(
    (projectId: ProjectId) => {
      const state = useStore.getState();
      for (const node of Object.values(state.sidebarTree.nodesById)) {
        if ((node.kind === "folder" || node.kind === "virtualProject") && node.runtimeProjectId === projectId) {
          return node.id;
        }
      }
      const project = state.projects.find((entry) => entry.id === projectId);
      if (!project) {
        return null;
      }
      const nodeId = createSidebarVirtualProject(null, project.name);
      bindSidebarNodeToRuntimeProject(nodeId, projectId);
      return nodeId;
    },
    [bindSidebarNodeToRuntimeProject, createSidebarVirtualProject],
  );

  const openLoopDialogForNode = useCallback(
    (nodeId: SidebarTreeNodeId, options?: { isDraftNode?: boolean }) => {
      const state = useStore.getState();
      const node = state.sidebarTree.nodesById[nodeId];
      if (!node || node.kind === "runtimeProject") {
        return;
      }
      const runtimeProjectId = resolveSidebarNodeRuntimeProjectId(state.sidebarTree, nodeId);
      const runtimeProject =
        runtimeProjectId !== null
          ? state.projects.find((entry) => entry.id === runtimeProjectId) ?? null
          : null;
      const workspaceRoot = resolveSidebarNodeWorkspaceRoot(
        state.sidebarTree,
        nodeId,
        appSettings.defaultWorkspaceRoot,
      );
      const projectTitle = resolveSidebarContainerDisplayTitle(node, runtimeProject);
      setLoopFormState(
        createSidebarLoopFormState({
          loopType: node.loopBinding?.loopType ?? "goal-loop",
          projectTitle,
          workerCount: Math.max(1, node.loopBinding?.workerThreadIds.length ?? 1),
          workerModel: runtimeProject?.model ?? DEFAULT_MODEL_BY_PROVIDER.codex,
          supervisorModel: runtimeProject?.model ?? DEFAULT_MODEL_BY_PROVIDER.codex,
        }),
      );
      setLoopDialogTarget({
        nodeId,
        title: projectTitle,
        runtimeProjectId,
        workspaceRoot,
        loopBinding: node.loopBinding ?? null,
        isDraftNode: options?.isDraftNode === true,
      });
    },
    [appSettings.defaultWorkspaceRoot],
  );

  const openLoopDialogForProject = useCallback(
    (projectId: ProjectId) => {
      const state = useStore.getState();
      const project = state.projects.find((entry) => entry.id === projectId);
      if (!project) {
        toastManager.add({
          type: "error",
          title: "Unable to create loop",
          description: "The selected runtime project could not be prepared for loop creation.",
        });
        return;
      }
      const nodeId = createSidebarLoopContainer(null, deriveInitialLoopTitle(project.name), project.cwd);
      openLoopDialogForNode(nodeId, { isDraftNode: true });
    },
    [createSidebarLoopContainer, openLoopDialogForNode],
  );

  const handleLoopControlAction = useCallback(
    async (
      nodeId: SidebarTreeNodeId,
      binding: JhLoopBinding,
      action: "pause" | "resume" | "stop" | "update-type",
      loopType?: JhLoopType,
    ) => {
      let result: Awaited<ReturnType<typeof controlJhLoop>>;
      try {
        result = await controlJhLoop({
          jobKey: binding.jobKey,
          action,
          ...(loopType ? { loopType } : {}),
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Loop control failed",
          description: getJhLoopErrorMessage(error, "The loop registry could not be updated."),
        });
        return;
      }
      if (!result) {
        toastManager.add({
          type: "error",
          title: "Loop control failed",
          description: "The loop registry could not be updated.",
        });
        return;
      }
      bindSidebarNodeToRuntimeProject(nodeId, result.binding.runtimeProjectId);
      setSidebarNodeLoopBinding(nodeId, result.binding);
      if (action === "update-type" && loopType) {
        const currentNode = useStore.getState().sidebarTree.nodesById[nodeId];
        if (
          currentNode &&
          (currentNode.kind === "folder" || currentNode.kind === "virtualProject") &&
          (!currentNode.icon || isDefaultFolderIcon(currentNode.icon) || isLoopFolderIcon(currentNode.icon))
        ) {
          setSidebarNodeIcon(nodeId, getLoopFolderIcon(loopType));
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["jh-loop-status", binding.jobKey] });
    },
    [bindSidebarNodeToRuntimeProject, queryClient, setSidebarNodeIcon, setSidebarNodeLoopBinding],
  );

  const submitLoopDialog = useCallback(async () => {
    if (!loopDialogTarget || isSubmittingLoopDialog) {
      return;
    }
    if (loopFormState.objective.trim().length === 0) {
      toastManager.add({
        type: "error",
        title: "Objective required",
        description: "Add the initial objective or prompt for the loop.",
      });
      return;
    }
    setIsSubmittingLoopDialog(true);
    let transientNodeId: SidebarTreeNodeId | null = null;
    try {
      const requestedProjectTitle =
        loopFormState.projectTitle.trim() ||
        loopDialogTarget.title.trim() ||
        deriveInitialLoopTitle(loopDialogTarget.title);
      const creationTarget =
        loopDialogTarget.isDraftNode
          ? loopDialogTarget
          : {
              nodeId: createSidebarLoopContainer(
                null,
                requestedProjectTitle,
                loopDialogTarget.workspaceRoot,
              ),
              title: requestedProjectTitle,
              runtimeProjectId: null,
              workspaceRoot: loopDialogTarget.workspaceRoot,
              loopBinding: null,
              isDraftNode: true,
            };
      if (creationTarget.nodeId !== loopDialogTarget.nodeId) {
        transientNodeId = creationTarget.nodeId;
      }
      const result = await createJhLoop(
        buildJhLoopCreateRequest({
          target: creationTarget,
          form: loopFormState,
        }),
      );
      if (!result) {
        if (creationTarget.nodeId !== loopDialogTarget.nodeId) {
          deleteSidebarNode(creationTarget.nodeId);
        }
        toastManager.add({
          type: "error",
          title: "Loop creation failed",
          description: "The JH loop management route did not accept the request.",
        });
        return;
      }
      renameSidebarNode(creationTarget.nodeId, requestedProjectTitle);
      bindSidebarNodeToRuntimeProject(creationTarget.nodeId, result.binding.runtimeProjectId);
      setSidebarNodeLoopBinding(creationTarget.nodeId, result.binding);
      setSidebarNodeIcon(creationTarget.nodeId, getLoopFolderIcon(result.binding.loopType));
      const nextNode = useStore.getState().sidebarTree.nodesById[creationTarget.nodeId];
      if (
        nextNode &&
        (nextNode.kind === "folder" || nextNode.kind === "virtualProject") &&
        !nextNode.expanded
      ) {
        toggleSidebarNodeExpanded(creationTarget.nodeId);
      }
      await queryClient.invalidateQueries({ queryKey: ["jh-loop-status", result.binding.jobKey] });
      closeLoopDialog();
      focusLoopThread(result.binding.workerThreadIds[0] ?? result.binding.supervisorThreadId ?? null);
    } catch (error) {
      if (transientNodeId) {
        deleteSidebarNode(transientNodeId);
      }
      toastManager.add({
        type: "error",
        title: "Loop creation failed",
        description: getJhLoopErrorMessage(
          error,
          "The JH loop management route did not accept the request.",
        ),
      });
    } finally {
      setIsSubmittingLoopDialog(false);
    }
  }, [
    bindSidebarNodeToRuntimeProject,
    closeLoopDialog,
    createSidebarLoopContainer,
    deleteSidebarNode,
    focusLoopThread,
    isSubmittingLoopDialog,
    loopDialogTarget,
    loopFormState,
    queryClient,
    renameSidebarNode,
    setSidebarNodeLoopBinding,
    toggleSidebarNodeExpanded,
  ]);

  const addProjectFromPath = useCallback(
    async (rawCwd: string) => {
      const cwd = rawCwd.trim();
      if (!cwd || isAddingProject) return;
      const api = readNativeApi();
      if (!api) return;

      setIsAddingProject(true);
      const finishAddingProject = () => {
        setIsAddingProject(false);
        setNewCwd("");
        setAddProjectError(null);
        setAddingProject(false);
      };

      const existing = projects.find((project) => project.cwd === cwd);
      if (existing) {
        focusMostRecentThreadForProject(existing.id);
        finishAddingProject();
        return;
      }

      const projectId = newProjectId();
      const createdAt = new Date().toISOString();
      const title = cwd.split(/[/\\]/).findLast(isNonEmptyString) ?? cwd;
      try {
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot: cwd,
          defaultModel: DEFAULT_MODEL_BY_PROVIDER.codex,
          createdAt,
        });
        await handleNewThread(projectId, {
          envMode: appSettings.defaultThreadEnvMode,
        }).catch(() => undefined);
      } catch (error) {
        const description =
          error instanceof Error ? error.message : "An error occurred while adding the project.";
        setIsAddingProject(false);
        if (shouldBrowseForProjectImmediately) {
          toastManager.add({
            type: "error",
            title: "Failed to add project",
            description,
          });
        } else {
          setAddProjectError(description);
        }
        return;
      }
      finishAddingProject();
    },
    [
      focusMostRecentThreadForProject,
      handleNewThread,
      isAddingProject,
      projects,
      shouldBrowseForProjectImmediately,
      appSettings.defaultThreadEnvMode,
    ],
  );

  const handleAddProject = () => {
    void addProjectFromPath(newCwd);
  };

  const canAddProject = newCwd.trim().length > 0 && !isAddingProject;

  const handlePickFolder = async () => {
    const api = readNativeApi();
    if (!api || isPickingFolder) return;
    setIsPickingFolder(true);
    let pickedPath: string | null = null;
    try {
      pickedPath = await api.dialogs.pickFolder();
    } catch {
      // Ignore picker failures and leave the current thread selection unchanged.
    }
    if (pickedPath) {
      await addProjectFromPath(pickedPath);
    } else if (!shouldBrowseForProjectImmediately) {
      addProjectInputRef.current?.focus();
    }
    setIsPickingFolder(false);
  };

  const handleStartAddProject = () => {
    setAddProjectError(null);
    if (shouldBrowseForProjectImmediately) {
      void handlePickFolder();
      return;
    }
    setAddingProject((prev) => !prev);
  };

  const openNodeCustomizer = useCallback(
    (nodeId: SidebarTreeNodeId) => {
      const node = sidebarTree.nodesById[nodeId];
      if (!node || node.kind === "runtimeProject") {
        return;
      }
      setNodeCustomizerTarget({
        nodeId,
        title: node.title,
        runtimeProjectId: node.runtimeProjectId ?? null,
      });
      setNodeWorkspaceDraft(node.workspaceOverride ?? "");
      setNodeIconDraft(node.icon ?? "");
      setNodeAccentDraft(node.accent ?? "");
    },
    [sidebarTree],
  );

  const closeNodeCustomizer = useCallback(() => {
    setNodeCustomizerTarget(null);
    setNodeWorkspaceDraft("");
    setNodeIconDraft("");
    setNodeAccentDraft("");
  }, []);

  const openQuickCustomizer = useCallback((nodeId: SidebarTreeNodeId) => {
    setQuickCustomizeNodeId(nodeId);
  }, []);

  const closeQuickCustomizer = useCallback(() => {
    setQuickCustomizeNodeId(null);
  }, []);

  const saveNodeCustomization = useCallback(() => {
    if (!nodeCustomizerTarget) {
      return;
    }
    const trimmedWorkspace = nodeWorkspaceDraft.trim();
    const trimmedIcon = nodeIconDraft.trim();
    setSidebarNodeWorkspaceOverride(
      nodeCustomizerTarget.nodeId,
      trimmedWorkspace.length > 0 ? trimmedWorkspace : null,
    );
    setSidebarNodeIcon(nodeCustomizerTarget.nodeId, trimmedIcon.length > 0 ? trimmedIcon : null);
    setSidebarNodeAccent(
      nodeCustomizerTarget.nodeId,
      nodeAccentDraft === "" ? null : nodeAccentDraft,
    );
    closeNodeCustomizer();
  }, [
    closeNodeCustomizer,
    nodeAccentDraft,
    nodeCustomizerTarget,
    nodeIconDraft,
    nodeWorkspaceDraft,
    setSidebarNodeAccent,
    setSidebarNodeIcon,
    setSidebarNodeWorkspaceOverride,
  ]);

  const ensureRuntimeProjectForSidebarNode = useCallback(
    async (nodeId: SidebarTreeNodeId) => {
      const api = readNativeApi();
      if (!api) {
        return null;
      }
      const state = useStore.getState();
      const existingBinding = resolveSidebarNodeRuntimeProjectId(state.sidebarTree, nodeId);
      if (
        existingBinding &&
        (!state.threadsHydrated || state.projects.some((project) => project.id === existingBinding))
      ) {
        return existingBinding;
      }

      const node = state.sidebarTree.nodesById[nodeId];
      if (!node || node.kind === "runtimeProject") {
        return node?.kind === "runtimeProject" ? node.projectId : null;
      }

      const title = resolveSidebarContainerDisplayTitle(node, null).trim();
      const representedProject = state.projects.find((project) => {
        if (project.name.trim() !== title) {
          return false;
        }
        return Object.values(state.sidebarTree.nodesById).some((candidate) => {
          if (candidate.id === nodeId) {
            return false;
          }
          if (candidate.kind === "runtimeProject") {
            return candidate.projectId === project.id;
          }
          return candidate.runtimeProjectId === project.id;
        });
      });
      if (representedProject) {
        bindSidebarNodeToRuntimeProject(nodeId, representedProject.id);
        return representedProject.id;
      }

      const workspaceRoot = resolveSidebarNodeWorkspaceRoot(
        state.sidebarTree,
        nodeId,
        appSettings.defaultWorkspaceRoot,
      );
      if (!workspaceRoot) {
        toastManager.add({
          type: "warning",
          title: "Workspace required",
          description: "Set a default workspace or a node override before creating a thread here.",
        });
        return null;
      }

      // Custom sidebar containers should own a distinct runtime project even if they
      // happen to target the same workspace root as another sidebar node.
      const projectId = newProjectId();
      const createdAt = new Date().toISOString();
      try {
        bindSidebarNodeToRuntimeProject(nodeId, projectId);
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot,
          defaultModel: DEFAULT_MODEL_BY_PROVIDER.codex,
          createdAt,
        });
        return projectId;
      } catch (error) {
        bindSidebarNodeToRuntimeProject(nodeId, null);
        toastManager.add({
          type: "error",
          title: `Failed to create runtime project for ${title}`,
          description: error instanceof Error ? error.message : "An unknown error occurred.",
        });
        return null;
      }
    },
    [appSettings.defaultWorkspaceRoot, bindSidebarNodeToRuntimeProject],
  );

  const createThreadInProject = useCallback(
    async (projectId: ProjectId | null) => {
      if (!projectId) {
        toastManager.add({
          type: "warning",
          title: "Create a project first",
          description: "Add a project before creating a new thread.",
        });
        return;
      }
      if (isMobile) {
        setOpenMobile(false);
      }
      await handleNewThread(projectId, {
        envMode: resolveSidebarNewThreadEnvMode({
          defaultEnvMode: appSettings.defaultThreadEnvMode,
        }),
      });
    },
    [appSettings.defaultThreadEnvMode, handleNewThread, isMobile, setOpenMobile],
  );

  const createThreadForSidebarNode = useCallback(
    async (nodeId: SidebarTreeNodeId) => {
      const projectId = await ensureRuntimeProjectForSidebarNode(nodeId);
      if (!projectId) {
        return;
      }
      const currentNode = useStore.getState().sidebarTree.nodesById[nodeId];
      if (currentNode && !currentNode.expanded) {
        toggleSidebarNodeExpanded(nodeId);
      }
      await createThreadInProject(projectId);
    },
    [createThreadInProject, ensureRuntimeProjectForSidebarNode, toggleSidebarNodeExpanded],
  );

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null);
    renamingThreadInputRef.current = null;
  }, []);

  const cancelProjectRename = useCallback(() => {
    setRenamingProjectId(null);
    renamingProjectInputRef.current = null;
  }, []);

  const cancelTreeNodeRename = useCallback(() => {
    setRenamingTreeNodeId(null);
    renamingTreeNodeInputRef.current = null;
  }, []);

  const startThreadRename = useCallback(
    (threadId: ThreadId, title: string) => {
      setRenamingProjectId(null);
      setRenamingThreadId(threadId);
      setRenamingThreadTitle(title);
      renamingThreadCommittedRef.current = false;
    },
    [],
  );

  const startProjectRename = useCallback((projectId: ProjectId, title: string) => {
    setRenamingThreadId(null);
    setRenamingTreeNodeId(null);
    setRenamingProjectId(projectId);
    setRenamingProjectTitle(title);
    renamingProjectCommittedRef.current = false;
  }, []);

  const startTreeNodeRename = useCallback((nodeId: SidebarTreeNodeId, title: string) => {
    setRenamingThreadId(null);
    setRenamingProjectId(null);
    setRenamingTreeNodeId(nodeId);
    setRenamingTreeNodeTitle(title);
    renamingTreeNodeCommittedRef.current = false;
  }, []);

  const createThreadFromSidebarRoot = useCallback(async () => {
    const nodeId = createSidebarVirtualProject(null, "New folder");
    setSidebarNodeIcon(nodeId, "\u{1F4C1}");
    startTreeNodeRename(nodeId, "New folder");
    await createThreadForSidebarNode(nodeId);
  }, [createSidebarVirtualProject, createThreadForSidebarNode, setSidebarNodeIcon, startTreeNodeRename]);

  const commitRename = useCallback(
    async (threadId: ThreadId, newTitle: string, originalTitle: string) => {
      const finishRename = () => {
        setRenamingThreadId((current) => {
          if (current !== threadId) return current;
          renamingThreadInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readNativeApi();
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      finishRename();
    },
    [],
  );

  const commitProjectRename = useCallback(
    async (projectId: ProjectId, newTitle: string, originalTitle: string) => {
      const finishRename = () => {
        setRenamingProjectId((current) => {
          if (current !== projectId) return current;
          renamingProjectInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Project title cannot be empty" });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readNativeApi();
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "project.meta.update",
          commandId: newCommandId(),
          projectId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename project",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      finishRename();
    },
    [],
  );

  const commitTreeNodeRename = useCallback(
    (nodeId: SidebarTreeNodeId, newTitle: string, originalTitle: string) => {
      const finishRename = () => {
        setRenamingTreeNodeId((current) => {
          if (current !== nodeId) return current;
          renamingTreeNodeInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Title cannot be empty" });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      renameSidebarNode(nodeId, trimmed);
      finishRename();
    },
    [renameSidebarNode],
  );

  const openBadgeEditor = useCallback((target: SidebarBadgeEditorTarget) => {
    setBadgeEditorTarget(target);
    setBadgeFormState(toSidebarBadgeFormState(target.indicator));
  }, []);

  const closeBadgeEditor = useCallback(() => {
    setBadgeEditorTarget(null);
    setBadgeFormState(toSidebarBadgeFormState(null));
  }, []);

  const getCurrentCustomIndicator = useCallback(
    (target: SidebarBadgeEditorTarget): OrchestrationCustomIndicator | null => {
      if (target.kind === "thread") {
        return threads.find((thread) => thread.id === target.id)?.customIndicator ?? null;
      }
      return projects.find((project) => project.id === target.id)?.customIndicator ?? null;
    },
    [projects, threads],
  );

  const applyCustomIndicatorOptimistically = useCallback(
    (target: SidebarBadgeEditorTarget, customIndicator: OrchestrationCustomIndicator | null) => {
      if (target.kind === "thread") {
        setThreadCustomIndicator(target.id, customIndicator);
        return;
      }
      setProjectCustomIndicator(target.id, customIndicator);
    },
    [setProjectCustomIndicator, setThreadCustomIndicator],
  );

  const saveBadgeEditor = useCallback(async () => {
    if (!badgeEditorTarget) {
      return;
    }
    const api = readNativeApi();
    if (!api) {
      return;
    }

    const label = badgeFormState.label.trim();
    if (label.length === 0) {
      toastManager.add({ type: "warning", title: "Badge label cannot be empty" });
      return;
    }

    const priorityText = badgeFormState.priority.trim();
    let priority: number | undefined;
    if (priorityText.length > 0) {
      const parsedPriority = Number(priorityText);
      if (!Number.isInteger(parsedPriority) || parsedPriority < 0) {
        toastManager.add({
          type: "warning",
          title: "Badge priority must be a non-negative integer",
        });
        return;
      }
      priority = parsedPriority;
    }

    const customIndicator: OrchestrationCustomIndicator = {
      label,
      ...(normalizeOptionalText(badgeFormState.tone)
        ? { tone: normalizeOptionalText(badgeFormState.tone) }
        : {}),
      ...(normalizeOptionalText(badgeFormState.textColor)
        ? { textColor: normalizeOptionalText(badgeFormState.textColor) }
        : {}),
      ...(normalizeOptionalText(badgeFormState.dotColor)
        ? { dotColor: normalizeOptionalText(badgeFormState.dotColor) }
        : {}),
      ...(normalizeOptionalText(badgeFormState.bgColor)
        ? { bgColor: normalizeOptionalText(badgeFormState.bgColor) }
        : {}),
      ...(badgeFormState.pulse ? { pulse: true } : {}),
      ...(priority !== undefined ? { priority } : {}),
    };

    const previousIndicator = getCurrentCustomIndicator(badgeEditorTarget);
    applyCustomIndicatorOptimistically(badgeEditorTarget, customIndicator);
    closeBadgeEditor();

    try {
      await api.orchestration.dispatchCommand(
        createSidebarBadgeUpdateCommand({
          commandId: newCommandId(),
          target:
            badgeEditorTarget.kind === "thread"
              ? { kind: "thread", id: badgeEditorTarget.id }
              : { kind: "project", id: badgeEditorTarget.id },
          customIndicator,
        }),
      );
    } catch (error) {
      applyCustomIndicatorOptimistically(badgeEditorTarget, previousIndicator);
      toastManager.add({
        type: "error",
        title: `Failed to save ${badgeEditorTarget.kind} badge`,
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  }, [
    applyCustomIndicatorOptimistically,
    badgeEditorTarget,
    badgeFormState,
    closeBadgeEditor,
    getCurrentCustomIndicator,
  ]);

  const clearCustomIndicator = useCallback(
    async (target: SidebarBadgeEditorTarget) => {
      const api = readNativeApi();
      if (!api) {
        return;
      }
      const previousIndicator = getCurrentCustomIndicator(target);
      applyCustomIndicatorOptimistically(target, null);
      if (badgeEditorTarget?.kind === target.kind && badgeEditorTarget.id === target.id) {
        closeBadgeEditor();
      }
      try {
        await api.orchestration.dispatchCommand(
          createSidebarBadgeUpdateCommand({
            commandId: newCommandId(),
            target: target.kind === "thread" ? { kind: "thread", id: target.id } : { kind: "project", id: target.id },
            customIndicator: null,
          }),
        );
      } catch (error) {
        applyCustomIndicatorOptimistically(target, previousIndicator);
        toastManager.add({
          type: "error",
          title: `Failed to clear ${target.kind} badge`,
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [
      applyCustomIndicatorOptimistically,
      badgeEditorTarget,
      closeBadgeEditor,
      getCurrentCustomIndicator,
    ],
  );

  /**
   * Delete a single thread: dispatch the delete immediately so the sidebar updates
   * right away, then perform slower terminal/worktree cleanup in the background.
   */
  const deleteThread = useCallback(
    async (
      threadId: ThreadId,
      opts: { deletedThreadIds?: ReadonlySet<ThreadId> } = {},
    ): Promise<void> => {
      const api = readNativeApi();
      if (!api) return;
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;
      const threadProject = projects.find((project) => project.id === thread.projectId);
      const deletedIds = opts.deletedThreadIds;
      const survivingThreads =
        deletedIds && deletedIds.size > 0
          ? threads.filter((t) => t.id === threadId || !deletedIds.has(t.id))
          : threads;
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(survivingThreads, threadId);
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const allDeletedIds = deletedIds ?? new Set<ThreadId>();
      const shouldNavigateToFallback = routeThreadId === threadId;
      const fallbackThreadId =
        threads.find((entry) => entry.id !== threadId && !allDeletedIds.has(entry.id))?.id ?? null;

      await api.orchestration.dispatchCommand({
        type: "thread.delete",
        commandId: newCommandId(),
        threadId,
      });

      removeThreadFromStore(threadId);
      clearComposerDraftForThread(threadId);
      clearProjectDraftThreadById(thread.projectId, thread.id);
      clearTerminalState(threadId);

      if (shouldNavigateToFallback) {
        if (fallbackThreadId) {
          void navigate({
            to: "/$threadId",
            params: { threadId: fallbackThreadId },
            replace: true,
          });
        } else {
          void navigate({ to: "/", replace: true });
        }
      }

      try {
        await api.terminal.close({ threadId, deleteHistory: true });
      } catch {
        // Terminal may already be closed
      }

      if (!orphanedWorktreePath || !threadProject) {
        return;
      }

      const shouldDeleteWorktree = await api.dialogs.confirm(
        [
          "This thread was the only one linked to this worktree:",
          displayWorktreePath ?? orphanedWorktreePath,
          "",
          "Delete the worktree too?",
        ].join("\n"),
      );

      if (!shouldDeleteWorktree) {
        return;
      }

      try {
        await removeWorktreeMutation.mutateAsync({
          cwd: threadProject.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after thread deletion", {
          threadId,
          projectCwd: threadProject.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add({
          type: "error",
          title: "Thread deleted, but worktree removal failed",
          description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
        });
      }
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalState,
      navigate,
      projects,
      removeThreadFromStore,
      removeWorktreeMutation,
      routeThreadId,
      threads,
    ],
  );

  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{ threadId: ThreadId }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: ctx.threadId,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy thread ID",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: ctx.path,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy path",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });
  const createInlineSidebarFolder = useCallback(
    (parentId: SidebarTreeNodeId | null) => {
      const nodeId = createSidebarVirtualProject(parentId, "New folder");
      setSidebarNodeIcon(nodeId, "\u{1F4C1}");
      startTreeNodeRename(nodeId, "New folder");
      return nodeId;
    },
    [createSidebarVirtualProject, setSidebarNodeIcon, startTreeNodeRename],
  );
  const runSidebarRootAction = useCallback(
    async (action: SidebarRootActionId) => {
      if (action === "new-folder") {
        createInlineSidebarFolder(null);
        return;
      }
      if (action === "create-loop") {
        const nodeId = createSidebarLoopContainer(null);
        openLoopDialogForNode(nodeId, { isDraftNode: true });
        return;
      }
      await createThreadFromSidebarRoot();
    },
    [createInlineSidebarFolder, createSidebarLoopContainer, createThreadFromSidebarRoot, openLoopDialogForNode],
  );

  const deleteEmptyProject = useCallback(
    async (projectId: ProjectId): Promise<boolean> => {
      const api = readNativeApi();
      if (!api) return false;
      const liveProjectThreads = useStore.getState().threads.filter((thread) => thread.projectId === projectId);
      if (liveProjectThreads.length > 0) {
        return false;
      }
      const project = projects.find((entry) => entry.id === projectId);
      try {
        const projectDraftThread = getDraftThreadByProjectId(projectId);
        if (projectDraftThread) {
          clearComposerDraftForThread(projectDraftThread.threadId);
        }
        clearProjectDraftThreadId(projectId);
        await api.orchestration.dispatchCommand({
          type: "project.delete",
          commandId: newCommandId(),
          projectId,
        });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing project.";
        console.error("Failed to remove project", { projectId, error });
        toastManager.add({
          type: "error",
          title: project ? `Failed to remove "${project.name}"` : "Failed to remove project",
          description: message,
        });
        return false;
      }
    },
    [clearComposerDraftForThread, clearProjectDraftThreadId, getDraftThreadByProjectId, projects],
  );

  const collectSidebarNodeDeletionTargets = useCallback(
    (nodeId: SidebarTreeNodeId) => {
      const projectIds = new Set<ProjectId>();
      const nodesToVisit: SidebarTreeNodeId[] = [nodeId];
      const visitedNodeIds = new Set<SidebarTreeNodeId>();

      while (nodesToVisit.length > 0) {
        const currentNodeId = nodesToVisit.pop();
        if (!currentNodeId || visitedNodeIds.has(currentNodeId)) {
          continue;
        }
        visitedNodeIds.add(currentNodeId);
        const node = sidebarTree.nodesById[currentNodeId];
        if (!node) {
          continue;
        }
        if (node.kind === "runtimeProject") {
          projectIds.add(node.projectId);
          continue;
        }
        if (node.runtimeProjectId) {
          projectIds.add(node.runtimeProjectId);
        }
        if (node.kind === "folder" || node.kind === "virtualProject") {
          nodesToVisit.push(...node.childrenIds);
        }
      }

      return {
        projectIds: [...projectIds],
        threads: threads.filter((thread) => projectIds.has(thread.projectId)),
      };
    },
    [sidebarTree, threads],
  );

  const getTreeNodeActions = useCallback(
    (node: Extract<SidebarTreeNode, { kind: "folder" | "virtualProject" }>) => {
      const loopBinding = node.loopBinding ?? null;
      const loopStatus = resolveLoopStatusForBinding(loopBinding, loopStatusStateByJobKey);
      return SIDEBAR_FOLDER_ACTIONS.filter((item) => {
        switch (item.id) {
          case "clear-workspace":
            return Boolean(node.workspaceOverride);
          case "create-loop":
            return !loopBinding;
          case "pause-loop":
            return Boolean(loopBinding && loopStatus?.enabled);
          case "resume-loop":
          case "stop-loop":
            return Boolean(loopBinding);
          case "convert-to-goal-loop":
            return Boolean(loopBinding && loopBinding.loopType !== "goal-loop");
          case "convert-to-endless-loop":
            return Boolean(loopBinding && loopBinding.loopType !== "endless-loop");
          case "open-supervisor-thread":
            return Boolean(loopBinding?.supervisorThreadId);
          case "open-worker-threads":
            return Boolean(loopBinding && loopBinding.workerThreadIds.length > 0);
          default:
            return true;
        }
      });
    },
    [loopStatusStateByJobKey],
  );

  const runTreeNodeAction = useCallback(
    async (
      nodeId: SidebarTreeNodeId,
      action: SidebarFolderActionId,
      title: string,
    ) => {
      const api = readNativeApi();
      if (action === "new-folder") {
        createInlineSidebarFolder(nodeId);
        return;
      }
      if (action === "new-thread") {
        await createThreadForSidebarNode(nodeId);
        return;
      }
      const currentNode = useStore.getState().sidebarTree.nodesById[nodeId];
      const loopBinding =
        currentNode && (currentNode.kind === "folder" || currentNode.kind === "virtualProject")
          ? currentNode.loopBinding ?? null
          : null;
      if (action === "create-loop") {
        const workspaceRoot = resolveSidebarNodeWorkspaceRoot(
          useStore.getState().sidebarTree,
          nodeId,
          appSettings.defaultWorkspaceRoot,
        );
        const draftNodeId = createSidebarLoopContainer(
          null,
          deriveInitialLoopTitle(title),
          workspaceRoot,
        );
        openLoopDialogForNode(draftNodeId, { isDraftNode: true });
        return;
      }
      if (action === "pause-loop" && loopBinding) {
        await handleLoopControlAction(nodeId, loopBinding, "pause");
        return;
      }
      if (action === "resume-loop" && loopBinding) {
        await handleLoopControlAction(nodeId, loopBinding, "resume");
        return;
      }
      if (action === "stop-loop" && loopBinding) {
        await handleLoopControlAction(nodeId, loopBinding, "stop");
        return;
      }
      if (action === "convert-to-goal-loop" && loopBinding) {
        await handleLoopControlAction(nodeId, loopBinding, "update-type", "goal-loop");
        return;
      }
      if (action === "convert-to-endless-loop" && loopBinding) {
        await handleLoopControlAction(nodeId, loopBinding, "update-type", "endless-loop");
        return;
      }
      if (action === "open-supervisor-thread" && loopBinding) {
        focusLoopThread(loopBinding.supervisorThreadId);
        return;
      }
      if (action === "open-worker-threads" && loopBinding) {
        const node = useStore.getState().sidebarTree.nodesById[nodeId];
        if (node && (node.kind === "folder" || node.kind === "virtualProject") && !node.expanded) {
          toggleSidebarNodeExpanded(nodeId);
        }
        focusLoopThread(loopBinding.workerThreadIds[0] ?? null);
        return;
      }
      if (action === "quick-style") {
        openQuickCustomizer(nodeId);
        return;
      }
      if (action === "customize") {
        openNodeCustomizer(nodeId);
        return;
      }
      if (action === "clear-workspace") {
        setSidebarNodeWorkspaceOverride(nodeId, null);
        return;
      }
      if (action === "rename") {
        startTreeNodeRename(nodeId, title);
        return;
      }
      const { projectIds, threads: descendantThreads } = collectSidebarNodeDeletionTargets(nodeId);
      if (!api) {
        if (projectIds.length === 0) {
          deleteSidebarNode(nodeId);
        }
        return;
      }
      if (projectIds.length === 0) {
        const confirmed = await api.dialogs.confirm(`Delete folder "${title}" from the sidebar tree?`);
        if (!confirmed) {
          return;
        }
        deleteSidebarNode(nodeId);
        return;
      }
      if (descendantThreads.length === 0) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete "${title}"?`,
            "",
            `This will permanently delete ${projectIds.length} empty runtime project${projectIds.length === 1 ? "" : "s"}.`,
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
        for (const projectId of projectIds) {
          const deleted = await deleteEmptyProject(projectId);
          if (!deleted) {
            return;
          }
        }
        deleteSidebarNode(nodeId);
        return;
      }

      const confirmed = await api.dialogs.confirm(
        [
          `Delete "${title}" and everything underneath it?`,
          "",
          `This will permanently delete ${descendantThreads.length} thread${descendantThreads.length === 1 ? "" : "s"} across ${projectIds.length} project${projectIds.length === 1 ? "" : "s"}.`,
        ].join("\n"),
      );
      if (!confirmed) {
        return;
      }
      const deletedThreadIds = new Set(descendantThreads.map((thread) => thread.id));
      for (const thread of descendantThreads) {
        await deleteThread(thread.id, { deletedThreadIds });
      }
      for (const projectId of projectIds) {
        const deleted = await deleteEmptyProject(projectId);
        if (!deleted) {
          return;
        }
      }
      deleteSidebarNode(nodeId);
    },
    [
      collectSidebarNodeDeletionTargets,
      createInlineSidebarFolder,
      createSidebarLoopContainer,
      createThreadForSidebarNode,
      deleteEmptyProject,
      deleteSidebarNode,
      deleteThread,
      focusLoopThread,
      handleLoopControlAction,
      appSettings.defaultWorkspaceRoot,
      openNodeCustomizer,
      openLoopDialogForNode,
      openQuickCustomizer,
      setSidebarNodeWorkspaceOverride,
      startTreeNodeRename,
      toggleSidebarNodeExpanded,
    ],
  );

  const runProjectAction = useCallback(
    async (projectId: ProjectId, action: SidebarProjectActionId) => {
      const api = readNativeApi();
      if (!api) return;
      const project = projects.find((entry) => entry.id === projectId);
      if (!project) return;

      if (action === "new-thread") {
        await createThreadInProject(projectId);
        return;
      }
      if (action === "create-loop") {
        openLoopDialogForProject(projectId);
        return;
      }
      if (action === "rename") {
        startProjectRename(projectId, project.name);
        return;
      }
      const projectThreads = useStore.getState().threads.filter((thread) => thread.projectId === projectId);
      if (projectThreads.length > 0) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete project "${project.name}" and all of its threads?`,
            "",
            `This will permanently delete ${projectThreads.length} thread${projectThreads.length === 1 ? "" : "s"}.`,
          ].join("\n"),
        );
        if (!confirmed) return;
        const deletedThreadIds = new Set(projectThreads.map((thread) => thread.id));
        for (const thread of projectThreads) {
          await deleteThread(thread.id, { deletedThreadIds });
        }
      } else {
        const confirmed = await api.dialogs.confirm(`Remove empty project "${project.name}"?`);
        if (!confirmed) return;
      }

      await deleteEmptyProject(projectId);
    },
    [
      createThreadInProject,
      deleteEmptyProject,
      deleteThread,
      openLoopDialogForProject,
      projects,
      startProjectRename,
    ],
  );

  const runThreadAction = useCallback(
    async (threadId: ThreadId, action: SidebarThreadActionId) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) return;
      const threadWorkspacePath = thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null;

      if (action === "new-thread") {
        await createThreadInProject(thread.projectId);
        return;
      }
      if (action === "rename") {
        startThreadRename(threadId, thread.title);
        return;
      }
      if (action === "set-badge") {
        openBadgeEditor({
          kind: "thread",
          id: threadId,
          title: thread.title,
          indicator: thread.customIndicator,
        });
        return;
      }
      if (action === "clear-badge") {
        await clearCustomIndicator({
          kind: "thread",
          id: threadId,
          title: thread.title,
          indicator: thread.customIndicator,
        });
        return;
      }
      if (action === "set-project-leader") {
        setProjectLeaderThread(thread.projectId, threadId);
        return;
      }
      if (action === "clear-project-leader") {
        setProjectLeaderThread(thread.projectId, null);
        return;
      }
      if (action === "mark-unread") {
        markThreadUnread(threadId);
        return;
      }
      if (action === "copy-path") {
        if (!threadWorkspacePath) {
          toastManager.add({
            type: "error",
            title: "Path unavailable",
            description: "This thread does not have a workspace path to copy.",
          });
          return;
        }
        copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
        return;
      }
      if (action === "copy-thread-id") {
        copyThreadIdToClipboard(threadId, { threadId });
        return;
      }
      if (appSettings.confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete thread "${thread.title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }
      await deleteThread(threadId);
      removeFromSelection([threadId]);
    },
    [
      appSettings.confirmThreadDelete,
      clearCustomIndicator,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      createThreadInProject,
      deleteThread,
      markThreadUnread,
      openBadgeEditor,
      projectCwdById,
      removeFromSelection,
      setProjectLeaderThread,
      startThreadRename,
      threads,
    ],
  );

  const getThreadActions = useCallback(
    (thread: Pick<Thread, "id" | "projectId">) => {
      const isProjectLeader = projectLeaderThreadIdByProjectId[thread.projectId] === thread.id;
      return [
        ...SIDEBAR_THREAD_ACTIONS_BASE.slice(0, 4),
        {
          id: isProjectLeader ? "clear-project-leader" : "set-project-leader",
          label: isProjectLeader ? "Clear project leader" : "Set as project leader",
        },
        ...SIDEBAR_THREAD_ACTIONS_BASE.slice(4),
      ] satisfies ReadonlyArray<{ id: SidebarThreadActionId; label: string }>;
    },
    [projectLeaderThreadIdByProjectId],
  );

  const handleThreadContextMenu = useCallback(
    async (threadId: ThreadId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) return;
      const clicked = await api.contextMenu.show(
        getThreadActions(thread).map((item) => ({
          id: item.id,
          label: item.label,
          ...(item.id === "delete" ? { destructive: true } : {}),
        })),
        position,
      );
      if (!clicked) return;
      await runThreadAction(threadId, clicked);
    },
    [getThreadActions, runThreadAction, threads],
  );

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const ids = [...selectedThreadIds];
      if (ids.length === 0) return;
      const count = ids.length;

      const clicked = await api.contextMenu.show(
        [
          { id: "mark-unread", label: `Mark unread (${count})` },
          { id: "delete", label: `Delete (${count})`, destructive: true },
        ],
        position,
      );

      if (clicked === "mark-unread") {
        for (const id of ids) {
          markThreadUnread(id);
        }
        clearSelection();
        return;
      }

      if (clicked !== "delete") return;

      if (appSettings.confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete ${count} thread${count === 1 ? "" : "s"}?`,
            "This permanently clears conversation history for these threads.",
          ].join("\n"),
        );
        if (!confirmed) return;
      }

      const deletedIds = new Set<ThreadId>(ids);
      for (const id of ids) {
        await deleteThread(id, { deletedThreadIds: deletedIds });
      }
      removeFromSelection(ids);
    },
    [
      appSettings.confirmThreadDelete,
      clearSelection,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
      selectedThreadIds,
    ],
  );

  const handleThreadClick = useCallback(
    (event: MouseEvent, threadId: ThreadId, orderedProjectThreadIds: readonly ThreadId[]) => {
      if (threadDragInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (suppressThreadClickAfterDragRef.current) {
        suppressThreadClickAfterDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;

      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadId);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(threadId, orderedProjectThreadIds);
        return;
      }

      // Plain click — clear selection, set anchor for future shift-clicks, and navigate
      if (selectedThreadIds.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadId);
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [
      clearSelection,
      isMobile,
      navigate,
      rangeSelectTo,
      selectedThreadIds.size,
      setSelectionAnchor,
      setOpenMobile,
      toggleThreadSelection,
    ],
  );

  const handleSidebarRootContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(SIDEBAR_ROOT_ACTIONS, position);
      if (!clicked) return;
      await runSidebarRootAction(clicked);
    },
    [runSidebarRootAction],
  );

  const handleProjectContextMenu = useCallback(
    async (projectId: ProjectId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        SIDEBAR_PROJECT_ACTIONS.map((item) => ({
          id: item.id,
          label: item.label,
          ...(item.id === "delete" ? { destructive: true } : {}),
        })),
        position,
      );
      if (!clicked) return;
      await runProjectAction(projectId, clicked);
    },
    [runProjectAction],
  );

  const handleTreeNodeContextMenu = useCallback(
    async (
      nodeId: SidebarTreeNodeId,
      title: string,
      position: { x: number; y: number },
    ) => {
      const api = readNativeApi();
      if (!api) return;
      const node = sidebarTree.nodesById[nodeId];
      if (!node || (node.kind !== "folder" && node.kind !== "virtualProject")) {
        return;
      }
      const items = getTreeNodeActions(node).map((item) => ({
        id: item.id,
        label: item.label,
        ...(item.id === "delete" ? { destructive: true } : {}),
      }));
      const clicked = await api.contextMenu.show(
        items,
        position,
      );
      if (!clicked) return;
      await runTreeNodeAction(nodeId, clicked, title);
    },
    [getTreeNodeActions, runTreeNodeAction, sidebarTree],
  );

  const sidebarDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);

  const animatedProjectListsRef = useRef(new WeakSet<HTMLElement>());
  const attachProjectListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedProjectListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedProjectListsRef.current.add(node);
  }, []);

  const animatedThreadListsRef = useRef(new WeakSet<HTMLElement>());
  const attachThreadListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedThreadListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedThreadListsRef.current.add(node);
  }, []);

  const handleProjectTitlePointerDownCapture = useCallback((event: { button: number; stopPropagation: () => void }) => {
    if (event.button !== 0) {
      event.stopPropagation();
      return;
    }
    suppressProjectClickAfterDragRef.current = false;
  }, []);

  const handleThreadTitlePointerDownCapture = useCallback((event: { button: number; stopPropagation: () => void }) => {
    if (event.button !== 0) {
      event.stopPropagation();
      return;
    }
    suppressThreadClickAfterDragRef.current = false;
  }, []);

  const suppressSecondaryPointerEvent = useCallback(
    (event: { button: number; preventDefault: () => void; stopPropagation: () => void }) => {
      if (event.button !== 2) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
    [],
  );

  const flattenedSidebarTree = useMemo(() => flattenSidebarTree(sidebarTree), [sidebarTree]);
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );
  const sidebarNormalizationRepairs = useMemo(() => {
    const treeNodes = Object.values(sidebarTree.nodesById);
    const projectNameById = new Map(projects.map((project) => [project.id, project.name.trim()] as const));

    return treeNodes.flatMap((node) => {
      if ((node.kind !== "folder" && node.kind !== "virtualProject") || node.runtimeProjectId || node.title.trim().length === 0) {
        return [] as Array<{
          folderNodeId: SidebarTreeNodeId;
          duplicateNodeId: SidebarTreeNodeId;
          projectId: ProjectId;
        }>;
      }
      const duplicateNode = treeNodes.find((candidate) => {
        if (candidate.id === node.id) {
          return false;
        }
        if (candidate.kind === "runtimeProject") {
          return projectNameById.get(candidate.projectId) === node.title.trim();
        }
        return candidate.runtimeProjectId ? projectNameById.get(candidate.runtimeProjectId) === node.title.trim() : false;
      });
      if (!duplicateNode) {
        return [];
      }
      const projectId = duplicateNode.kind === "runtimeProject" ? duplicateNode.projectId : duplicateNode.runtimeProjectId;
      if (!projectId) {
        return [];
      }
      return [{ folderNodeId: node.id, duplicateNodeId: duplicateNode.id, projectId }];
    });
  }, [projects, sidebarTree]);
  const loopIconRepairs = useMemo(
    () =>
      Object.values(sidebarTree.nodesById).flatMap((node) => {
        if (
          (node.kind !== "folder" && node.kind !== "virtualProject") ||
          !node.loopBinding ||
          (node.icon && !isDefaultFolderIcon(node.icon))
        ) {
          return [] as Array<{ nodeId: SidebarTreeNodeId; loopType: JhLoopType }>;
        }

        return [{ nodeId: node.id, loopType: node.loopBinding.loopType }];
      }),
    [sidebarTree],
  );
  const isManualThreadSorting = appSettings.sidebarThreadSortOrder === "manual";

  useEffect(() => {
    if (sidebarNormalizationRepairs.length === 0) {
      return;
    }
    for (const repair of sidebarNormalizationRepairs) {
      bindSidebarNodeToRuntimeProject(repair.folderNodeId, repair.projectId);
      deleteSidebarNode(repair.duplicateNodeId);
    }
  }, [bindSidebarNodeToRuntimeProject, deleteSidebarNode, sidebarNormalizationRepairs]);
  useEffect(() => {
    if (loopIconRepairs.length === 0) {
      return;
    }

    for (const repair of loopIconRepairs) {
      setSidebarNodeIcon(repair.nodeId, getLoopFolderIcon(repair.loopType));
    }
  }, [loopIconRepairs, setSidebarNodeIcon]);

  const resolveOwnerNodeIdForThread = useCallback(
    (threadId: ThreadId): SidebarTreeNodeId | null => {
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) {
        return null;
      }
      const matchingEntry = flattenedSidebarTree.find(({ node }) => {
        if (node.kind === "runtimeProject") {
          return node.projectId === thread.projectId;
        }
        return node.runtimeProjectId === thread.projectId;
      });
      return matchingEntry?.node.id ?? null;
    },
    [flattenedSidebarTree, threads],
  );

  const resolveTargetProjectIdForNodeDrop = useCallback(
    async (nodeId: SidebarTreeNodeId): Promise<ProjectId | null> => {
      const node = sidebarTree.nodesById[nodeId];
      if (!node) {
        return null;
      }
      if (node.kind === "runtimeProject") {
        return node.projectId;
      }
      return await ensureRuntimeProjectForSidebarNode(node.id);
    },
    [ensureRuntimeProjectForSidebarNode, sidebarTree],
  );

  const moveThreadAcrossProjects = useCallback(
    async (threadId: ThreadId, targetProjectId: ProjectId, targetThreadId?: ThreadId) => {
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) {
        return;
      }
      if (thread.projectId === targetProjectId && targetThreadId === undefined) {
        return;
      }

      const api = readNativeApi();
      if (!api) {
        return;
      }

      if (thread.session && thread.session.status !== "closed") {
        await api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }

      await api.orchestration.dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId,
        projectId: targetProjectId,
      });
      moveThreadToProject(threadId, targetProjectId, targetThreadId);
      setDraftThreadContext(threadId, { projectId: targetProjectId });
    },
    [moveThreadToProject, setDraftThreadContext, threads],
  );

  const handleSidebarDragStart = useCallback((event: DragStartEvent) => {
    const activeTarget = parseSidebarDragTarget(String(event.active.id));
    if (activeTarget?.kind === "node") {
      dragInProgressRef.current = true;
      suppressProjectClickAfterDragRef.current = true;
      return;
    }
    if (activeTarget?.kind === "thread") {
      threadDragInProgressRef.current = true;
      suppressThreadClickAfterDragRef.current = true;
    }
  }, []);

  const handleSidebarDragEnd = useCallback(
    async (event: DragEndEvent) => {
      dragInProgressRef.current = false;
      threadDragInProgressRef.current = false;
      const activeTarget = parseSidebarDragTarget(String(event.active.id));
      const overTarget = event.over ? parseSidebarDragTarget(String(event.over.id)) : null;
      if (!activeTarget || !overTarget) {
        return;
      }
      if (activeTarget.kind === "node" && overTarget.kind === "node") {
        if (activeTarget.nodeId === overTarget.nodeId) {
          return;
        }
      }
      if (activeTarget.kind === "thread" && overTarget.kind === "thread") {
        if (activeTarget.threadId === overTarget.threadId) {
          return;
        }
      }

      if (activeTarget.kind === "node") {
        const targetNodeId =
          overTarget.kind === "node"
            ? overTarget.nodeId
            : resolveOwnerNodeIdForThread(overTarget.threadId);
        if (!targetNodeId || targetNodeId === activeTarget.nodeId) {
          return;
        }
        moveSidebarNode(activeTarget.nodeId, targetNodeId);
        return;
      }

      const activeThread = threads.find((thread) => thread.id === activeTarget.threadId);
      if (!activeThread) {
        return;
      }

      if (overTarget.kind === "thread") {
        const overThread = threads.find((thread) => thread.id === overTarget.threadId);
        if (!overThread) {
          return;
        }
        if (activeThread.projectId === overThread.projectId) {
          if (!isManualThreadSorting) {
            return;
          }
          reorderThreads(activeThread.id, overThread.id);
          return;
        }
        await moveThreadAcrossProjects(activeThread.id, overThread.projectId, overThread.id);
        return;
      }

      const targetProjectId = await resolveTargetProjectIdForNodeDrop(overTarget.nodeId);
      if (!targetProjectId || targetProjectId === activeThread.projectId) {
        return;
      }
      await moveThreadAcrossProjects(activeThread.id, targetProjectId);
    },
    [
      isManualThreadSorting,
      moveSidebarNode,
      moveThreadAcrossProjects,
      reorderThreads,
      resolveOwnerNodeIdForThread,
      resolveTargetProjectIdForNodeDrop,
      threads,
    ],
  );

  const handleSidebarDragCancel = useCallback((_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
    threadDragInProgressRef.current = false;
  }, []);

  const renderNodeQuickCustomizer = useCallback(
    (node: Extract<SidebarTreeNode, { kind: "folder" | "virtualProject" }>) => {
      const accentOption = resolveSidebarNodeAccentOption(node.accent);
      return (
        <Popover
          open={quickCustomizeNodeId === node.id}
          onOpenChange={(open) => {
            setQuickCustomizeNodeId(open ? node.id : null);
          }}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <SidebarMenuAction
                      render={
                        <button
                          type="button"
                          aria-label={`Quick style for ${node.title}`}
                          data-thread-selection-safe
                        />
                      }
                      showOnHover
                      className="top-1 right-7 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                    />
                  }
                >
                  <PaletteIcon className="size-3.5" />
                </PopoverTrigger>
              }
            />
            <TooltipPopup side="top">Quick style</TooltipPopup>
          </Tooltip>
          <PopoverPopup align="end" side="bottom" className="w-72">
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Emoji
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {SIDEBAR_NODE_ICON_PRESETS.map((icon) => {
                    const isSelected = node.icon === icon;
                    return (
                      <button
                        key={icon}
                        type="button"
                        className={cn(
                          "inline-flex h-9 items-center justify-center rounded-md border text-base transition-colors",
                          isSelected
                            ? "border-primary/70 bg-primary/10"
                            : "border-border/70 hover:bg-accent/60",
                        )}
                        onClick={() => {
                          setSidebarNodeIcon(node.id, icon);
                        }}
                      >
                        {icon}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex justify-end">
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => {
                      setSidebarNodeIcon(node.id, null);
                    }}
                  >
                    Clear emoji
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Accent
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {SIDEBAR_NODE_ACCENT_OPTIONS.map((option) => {
                    const isSelected = node.accent === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={cn(
                          "rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors",
                          option.buttonClassName,
                          isSelected ? "ring-1 ring-primary/60" : "hover:opacity-90",
                        )}
                        onClick={() => {
                          setSidebarNodeAccent(node.id, option.value);
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex justify-end">
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => {
                      setSidebarNodeAccent(node.id, null);
                    }}
                  >
                    Clear accent
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between border-t pt-2">
                <div className="min-w-0 text-xs text-muted-foreground">
                  <span className="block truncate">{node.title}</span>
                  {accentOption ? <span className="block truncate">{accentOption.label}</span> : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    closeQuickCustomizer();
                    openNodeCustomizer(node.id);
                  }}
                >
                  Advanced
                </Button>
              </div>
            </div>
          </PopoverPopup>
        </Popover>
      );
    },
    [
      closeQuickCustomizer,
      openNodeCustomizer,
      quickCustomizeNodeId,
      setSidebarNodeAccent,
      setSidebarNodeIcon,
    ],
  );

  function renderTreeNodeItem(
    entry: (typeof flattenedSidebarTree)[number],
    dragHandleProps: SortableProjectHandleProps | null,
  ) {
    const { depth, node } = entry;
    const rowPaddingLeft = 8 + depth * 16;
    const isRuntimeNode = node.kind === "runtimeProject";
    const isContainerNode = node.kind === "folder" || node.kind === "virtualProject";
    const containerNode = isContainerNode ? node : null;
    const runtimeProjectId = isRuntimeNode ? node.projectId : containerNode?.runtimeProjectId ?? null;
    const runtimeProject = runtimeProjectId ? projectById.get(runtimeProjectId) ?? null : null;
    if (isRuntimeNode && runtimeProject === null) {
      return null;
    }

    const renderThreadRow = (
      thread: (typeof threads)[number] & { isDraft?: boolean | undefined },
      orderedProjectThreadIds: readonly ThreadId[],
      threadDragHandleProps: SortableThreadHandleProps | null,
    ) => {
      const isActive = routeThreadId === thread.id;
      const isSelected = selectedThreadIds.has(thread.id);
      const isHighlighted = isActive || isSelected;
      const isDraftThread = thread.isDraft === true;
      const threadStatus = isDraftThread
        ? null
        : resolveThreadStatusPill({
            thread,
            hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
            hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
          });
      const prStatus = isDraftThread ? null : prStatusIndicator(prByThreadId.get(thread.id) ?? null);
      const terminalStatus = isDraftThread
        ? null
        : terminalStatusFromRunningIds(
            selectThreadTerminalState(terminalStateByThreadId, thread.id).runningTerminalIds,
          );
      const threadActions = isDraftThread ? [] : getThreadActions(thread);
      const openThreadRowContextMenu = (event: { clientX: number; clientY: number }) => {
        if (isDraftThread) {
          return;
        }
        const now = Date.now();
        if (now - lastThreadContextMenuHandledAtRef.current < 150) {
          return;
        }
        lastThreadContextMenuHandledAtRef.current = now;
        if (selectedThreadIds.size > 0 && selectedThreadIds.has(thread.id)) {
          void handleMultiSelectContextMenu({
            x: event.clientX,
            y: event.clientY,
          });
          return;
        }
        if (selectedThreadIds.size > 0) {
          clearSelection();
        }
        void handleThreadContextMenu(thread.id, {
          x: event.clientX,
          y: event.clientY,
        });
      };

      return (
        <SidebarMenuSubItem
          key={thread.id}
          ref={threadDragHandleProps?.setNodeRef}
          style={threadDragHandleProps?.style}
          className={cn("group/menu-item w-full rounded-md", threadDragHandleProps?.className)}
          data-thread-item
          onContextMenuCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openThreadRowContextMenu(event);
          }}
          onPointerDownCapture={(event) => {
            suppressSecondaryPointerEvent(event);
          }}
        >
          <SidebarMenuButton
            render={<div role="button" tabIndex={0} />}
            size="sm"
            isActive={isActive}
            className={
              resolveThreadRowClassName({
                isActive,
                isSelected,
              }) + " cursor-grab active:cursor-grabbing"
            }
            ref={threadDragHandleProps?.setActivatorNodeRef}
            {...(threadDragHandleProps ? threadDragHandleProps.attributes : {})}
            {...primaryButtonOnlyDragListeners(threadDragHandleProps?.listeners)}
            onContextMenuCapture={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openThreadRowContextMenu(event);
            }}
            onPointerDownCapture={(event) => {
              if (suppressSecondaryPointerEvent(event)) {
                return;
              }
              handleThreadTitlePointerDownCapture(event);
            }}
            onClick={(event) => {
              if (event.detail === 1) {
                pendingThreadRenameRef.current = {
                  threadId: thread.id,
                  wasActive: isActive,
                  wasSingleFocused:
                    isActive && (selectedThreadIds.size === 0 || (selectedThreadIds.size === 1 && isSelected)),
                };
              }
              handleThreadClick(event, thread.id, orderedProjectThreadIds);
            }}
            onDoubleClick={(event) => {
              if (isDraftThread) {
                return;
              }
              const pendingRename = pendingThreadRenameRef.current;
              if (
                !pendingRename ||
                pendingRename.threadId !== thread.id ||
                !pendingRename.wasActive ||
                !pendingRename.wasSingleFocused
              ) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              startThreadRename(thread.id, thread.title);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              if (selectedThreadIds.size > 0) {
                clearSelection();
              }
              setSelectionAnchor(thread.id);
              if (isMobile) {
                setOpenMobile(false);
              }
              void navigate({
                to: "/$threadId",
                params: { threadId: thread.id },
              });
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              {prStatus && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={prStatus.tooltip}
                        className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                        onClick={(event) => {
                          openPrLink(event, prStatus.url);
                        }}
                      >
                        <GitPullRequestIcon className="size-3" />
                      </button>
                    }
                  />
                  <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
                </Tooltip>
              )}
              {threadStatus && <StatusIndicatorPill indicator={threadStatus} />}
              {renamingThreadId === thread.id ? (
                <input
                  ref={(el) => {
                    if (el && renamingThreadInputRef.current !== el) {
                      renamingThreadInputRef.current = el;
                      el.focus();
                      el.select();
                    }
                  }}
                  className="min-w-0 flex-1 truncate rounded border border-ring bg-transparent px-0.5 text-xs outline-none"
                  value={renamingThreadTitle}
                  onChange={(e) => setRenamingThreadTitle(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      renamingThreadCommittedRef.current = true;
                      void commitRename(thread.id, renamingThreadTitle, thread.title);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      renamingThreadCommittedRef.current = true;
                      cancelRename();
                    }
                  }}
                  onBlur={() => {
                    if (!renamingThreadCommittedRef.current) {
                      void commitRename(thread.id, renamingThreadTitle, thread.title);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-xs">{thread.title}</span>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {!isDraftThread ? (
                <Menu>
                  <MenuTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Thread actions for ${thread.title}`}
                        data-thread-selection-safe
                        className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground/45 opacity-100 transition hover:bg-accent hover:text-foreground md:opacity-0 md:group-hover/menu-item:opacity-100 md:group-focus-within/menu-item:opacity-100"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                      />
                    }
                  >
                    <EllipsisIcon className="size-3.5" />
                  </MenuTrigger>
                  <MenuPopup align="end" side="bottom" className="min-w-40">
                    {threadActions.map((item) => (
                      <MenuItem
                        key={item.id}
                        data-thread-selection-safe
                        variant={item.id === "delete" ? "destructive" : "default"}
                        onClick={(event) => {
                          event.stopPropagation();
                          void runThreadAction(thread.id, item.id);
                        }}
                      >
                        {item.label}
                      </MenuItem>
                    ))}
                  </MenuPopup>
                </Menu>
              ) : null}
              {terminalStatus && (
                <span
                  role="img"
                  aria-label={terminalStatus.label}
                  title={terminalStatus.label}
                  className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
                >
                  <TerminalIcon className={`size-3 ${terminalStatus.pulse ? "animate-pulse" : ""}`} />
                </span>
              )}
              <span
                className={`text-[10px] ${
                  isHighlighted
                    ? "text-foreground/72 dark:text-foreground/82"
                    : "text-muted-foreground/40"
                }`}
              >
                {formatRelativeTime(thread.updatedAt ?? thread.createdAt)}
              </span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuSubItem>
      );
    };

    const buttonBaseClass =
      "gap-2 px-2 py-1.5 text-left hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground cursor-grab active:cursor-grabbing";

    if (containerNode && runtimeProject === null) {
      const accentOption = resolveSidebarNodeAccentOption(containerNode.accent);
      const containerActions = getTreeNodeActions(containerNode);
      return (
        <SidebarMenuItem key={containerNode.id} className="rounded-md">
          <div className="group/project-header relative" data-sidebar-tree-node={containerNode.id}>
            <SidebarMenuButton
              ref={dragHandleProps?.setActivatorNodeRef}
              render={<div role="button" tabIndex={0} />}
              size="sm"
              className={cn(buttonBaseClass, accentOption?.rowClassName)}
              style={{ paddingLeft: `${rowPaddingLeft}px` }}
              {...(dragHandleProps ? dragHandleProps.attributes : {})}
              {...primaryButtonOnlyDragListeners(dragHandleProps?.listeners)}
              onPointerDownCapture={handleProjectTitlePointerDownCapture}
              onClick={(event) => {
                if (dragInProgressRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                if (suppressProjectClickAfterDragRef.current) {
                  suppressProjectClickAfterDragRef.current = false;
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                if (event.detail === 1) {
                  pendingContainerRenameRef.current = {
                    nodeId: containerNode.id,
                    wasExpanded: containerNode.expanded,
                  };
                }
                toggleSidebarNodeExpanded(containerNode.id);
              }}
              onDoubleClick={(event) => {
                const pendingRename = pendingContainerRenameRef.current;
                if (
                  !pendingRename ||
                  pendingRename.nodeId !== containerNode.id ||
                  !pendingRename.wasExpanded
                ) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                startTreeNodeRename(containerNode.id, containerNode.title);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                toggleSidebarNodeExpanded(containerNode.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handleTreeNodeContextMenu(containerNode.id, containerNode.title, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <ChevronRightIcon
                className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
                  containerNode.expanded ? "rotate-90" : ""
                }`}
              />
              {containerNode.icon && !isDefaultFolderIcon(containerNode.icon) ? (
                <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-sm">
                  {containerNode.icon}
                </span>
              ) : (
                renderDefaultFolderEmoji(containerNode.loopBinding?.loopType ?? null)
              )}
              {renamingTreeNodeId === containerNode.id ? (
                <input
                  ref={(el) => {
                    if (el && renamingTreeNodeInputRef.current !== el) {
                      renamingTreeNodeInputRef.current = el;
                      el.focus();
                      el.select();
                    }
                  }}
                  className="min-w-0 flex-1 truncate rounded border border-ring bg-transparent px-0.5 text-xs font-medium text-foreground/90 outline-none"
                  value={renamingTreeNodeTitle}
                  onChange={(e) => setRenamingTreeNodeTitle(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      renamingTreeNodeCommittedRef.current = true;
                      commitTreeNodeRename(containerNode.id, renamingTreeNodeTitle, containerNode.title);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      renamingTreeNodeCommittedRef.current = true;
                      cancelTreeNodeRename();
                    }
                  }}
                  onBlur={() => {
                    if (!renamingTreeNodeCommittedRef.current) {
                      commitTreeNodeRename(
                        containerNode.id,
                        renamingTreeNodeTitle,
                        containerNode.title,
                      );
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="flex-1 truncate text-xs font-medium text-foreground/90">
                  {containerNode.title}
                </span>
              )}
            </SidebarMenuButton>
            <Tooltip>
              <TooltipTrigger
                render={
                  <SidebarMenuAction
                    render={
                      <button
                        type="button"
                        aria-label={`Create nested folder in ${containerNode.title}`}
                        data-thread-selection-safe
                      />
                    }
                    showOnHover
                    className="top-1 right-1 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      createInlineSidebarFolder(containerNode.id);
                    }}
                  >
                    <PlusIcon className="size-3.5" />
                  </SidebarMenuAction>
                }
              />
              <TooltipPopup side="top">New folder</TooltipPopup>
            </Tooltip>
            {renderNodeQuickCustomizer(containerNode)}
            <Menu>
              <MenuTrigger
                render={
                  <SidebarMenuAction
                    render={
                      <button
                        type="button"
                        aria-label={`${containerNode.title} actions`}
                        data-thread-selection-safe
                      />
                    }
                    showOnHover
                    className="top-1 right-13 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <EllipsisIcon className="size-3.5" />
                  </SidebarMenuAction>
                }
              />
              <MenuPopup align="end" side="bottom" className="min-w-40">
                {containerActions.map((item) => (
                  <MenuItem
                    key={item.id}
                    variant={item.id === "delete" ? "destructive" : "default"}
                    onClick={(event) => {
                      event.stopPropagation();
                      void runTreeNodeAction(containerNode.id, item.id, containerNode.title);
                    }}
                  >
                    {item.label}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </div>
        </SidebarMenuItem>
      );
    }

    const project = runtimeProject;
    if (!project) {
      return null;
    }
    const runtimeBackedContainerNode = containerNode;
    const accentOption = runtimeBackedContainerNode
      ? resolveSidebarNodeAccentOption(runtimeBackedContainerNode.accent)
      : null;
    const displayTitle = runtimeBackedContainerNode
      ? resolveSidebarContainerDisplayTitle(runtimeBackedContainerNode, project)
      : project.name;
    const serverProjectThreads = threads.filter((thread) => thread.projectId === project.id);
    const projectDraftThread = getDraftThreadByProjectId(project.id);
    const draftSidebarThread =
      projectDraftThread && !serverProjectThreads.some((thread) => thread.id === projectDraftThread.threadId)
        ? {
            id: projectDraftThread.threadId,
            codexThreadId: null,
            projectId: project.id,
            title: resolveDraftThreadTitle(draftsByThreadId[projectDraftThread.threadId]?.prompt),
            model: draftsByThreadId[projectDraftThread.threadId]?.model ?? project.model,
            runtimeMode: projectDraftThread.runtimeMode,
            interactionMode: projectDraftThread.interactionMode,
            session: null,
            messages: [],
            proposedPlans: [],
            error: null,
            createdAt: projectDraftThread.createdAt,
            updatedAt: projectDraftThread.createdAt,
            latestTurn: null,
            lastVisitedAt: undefined,
            branch: projectDraftThread.branch,
            worktreePath: projectDraftThread.worktreePath,
            customIndicator: null,
            turnDiffSummaries: [],
            activities: [],
            isDraft: true,
          }
        : null;
    const projectThreads = orderLoopProjectThreads(
      sortThreadsForSidebar(
        draftSidebarThread ? [...serverProjectThreads, draftSidebarThread] : serverProjectThreads,
        appSettings.sidebarThreadSortOrder,
      ),
      runtimeBackedContainerNode?.loopBinding ?? null,
    );
    const inferredLoopIconType =
      runtimeBackedContainerNode?.loopBinding?.loopType ??
      inferLoopFolderIconType(project.name, projectThreads);
    const leaderThreadId = projectLeaderThreadIdByProjectId[project.id] ?? null;
    const leaderThread = leaderThreadId ? projectThreads.find((thread) => thread.id === leaderThreadId) ?? null : null;
    const loopSupervisorThreadId = runtimeBackedContainerNode?.loopBinding?.supervisorThreadId ?? null;
    const loopSupervisorThread = loopSupervisorThreadId
      ? projectThreads.find((thread) => thread.id === loopSupervisorThreadId) ?? null
      : null;
    const loopStatus =
      runtimeBackedContainerNode?.loopBinding
        ? resolveLoopStatusForBinding(runtimeBackedContainerNode.loopBinding, loopStatusStateByJobKey) ??
          runtimeBackedContainerNode.loopBinding.lastKnownStatus ??
          null
        : null;
    const projectStatus = resolveProjectStatusIndicator({
      loopIndicator: loopStatus?.indicator ?? null,
      projectCustomIndicator: project.customIndicator ?? null,
      supervisorThreadStatus:
        loopSupervisorThread && !loopSupervisorThread.isDraft
          ? resolveThreadStatusPill({
              thread: loopSupervisorThread,
              hasPendingApprovals: derivePendingApprovals(loopSupervisorThread.activities).length > 0,
              hasPendingUserInput: derivePendingUserInputs(loopSupervisorThread.activities).length > 0,
            })
          : null,
      leaderThreadStatus:
        leaderThread && !leaderThread.isDraft
          ? resolveThreadStatusPill({
              thread: leaderThread,
              hasPendingApprovals: derivePendingApprovals(leaderThread.activities).length > 0,
              hasPendingUserInput: derivePendingUserInputs(leaderThread.activities).length > 0,
            })
          : null,
    });
    const activeThreadId = routeThreadId ?? undefined;
    const isThreadListExpanded = expandedThreadListsByProject.has(project.id);
    const pinnedCollapsedThread =
      !node.expanded && activeThreadId
        ? (projectThreads.find((thread) => thread.id === activeThreadId) ?? null)
        : null;
    const shouldShowThreadPanel = node.expanded || pinnedCollapsedThread !== null;
    const { hasHiddenThreads, visibleThreads } = isManualThreadSorting
      ? {
          hasHiddenThreads: false,
          visibleThreads: projectThreads,
        }
      : getVisibleThreadsForProject({
          threads: projectThreads,
          activeThreadId,
          isThreadListExpanded,
          previewLimit: THREAD_PREVIEW_LIMIT,
        });
    const orderedProjectThreadIds = projectThreads.map((thread) => thread.id);
    const renderedThreads = pinnedCollapsedThread ? [pinnedCollapsedThread] : visibleThreads;

    return (
      <SidebarMenuItem
        key={node.id}
        ref={dragHandleProps?.setNodeRef}
        style={dragHandleProps?.style}
        className={cn("rounded-md", dragHandleProps?.className)}
      >
        <Collapsible className="group/collapsible" open={shouldShowThreadPanel}>
          <div className="group/project-header relative" data-sidebar-tree-node={node.id}>
            <SidebarMenuButton
              ref={dragHandleProps?.setActivatorNodeRef}
              render={<div role="button" tabIndex={0} />}
              size="sm"
              className={cn(buttonBaseClass, accentOption?.rowClassName)}
              style={{ paddingLeft: `${rowPaddingLeft}px` }}
              {...(dragHandleProps ? dragHandleProps.attributes : {})}
              {...primaryButtonOnlyDragListeners(dragHandleProps?.listeners)}
              onPointerDownCapture={handleProjectTitlePointerDownCapture}
              onClick={(event) => {
                if (dragInProgressRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                if (suppressProjectClickAfterDragRef.current) {
                  suppressProjectClickAfterDragRef.current = false;
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                if (event.detail === 1) {
                  pendingContainerRenameRef.current = {
                    nodeId: node.id,
                    wasExpanded: node.expanded,
                  };
                }
                toggleSidebarNodeExpanded(node.id);
              }}
              onDoubleClick={(event) => {
                const pendingRename = pendingContainerRenameRef.current;
                if (!pendingRename || pendingRename.nodeId !== node.id || !pendingRename.wasExpanded) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                if (runtimeBackedContainerNode) {
                  startTreeNodeRename(runtimeBackedContainerNode.id, runtimeBackedContainerNode.title);
                  return;
                }
                startProjectRename(project.id, project.name);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                toggleSidebarNodeExpanded(node.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void (runtimeBackedContainerNode
                  ? handleTreeNodeContextMenu(runtimeBackedContainerNode.id, runtimeBackedContainerNode.title, {
                      x: event.clientX,
                      y: event.clientY,
                    })
                  : handleProjectContextMenu(project.id, {
                      x: event.clientX,
                      y: event.clientY,
                    }));
              }}
            >
              {!node.expanded && projectStatus ? (
                <span
                  aria-hidden="true"
                  title={projectStatus.label}
                  className={`-ml-0.5 relative inline-flex size-3.5 shrink-0 items-center justify-center ${projectStatus.colorClass}`}
                  style={projectStatus.style}
                >
                  <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover/project-header:opacity-0">
                    <span
                      className={`size-[9px] rounded-full ${projectStatus.dotClass} ${
                        projectStatus.pulse ? "animate-pulse" : ""
                      }`}
                      style={projectStatus.dotStyle}
                    />
                  </span>
                  <ChevronRightIcon className="absolute inset-0 m-auto size-3.5 text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover/project-header:opacity-100" />
                </span>
              ) : (
                <ChevronRightIcon
                  className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
                    node.expanded ? "rotate-90" : ""
                  }`}
                />
              )}
              {runtimeBackedContainerNode?.icon ? (
                isDefaultFolderIcon(runtimeBackedContainerNode.icon) ? (
                  renderDefaultFolderEmoji(inferredLoopIconType)
                ) : (
                  <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-sm">
                    {runtimeBackedContainerNode.icon}
                  </span>
                )
              ) : (
                renderDefaultFolderEmoji(inferredLoopIconType)
              )}
              {runtimeBackedContainerNode ? (
                renamingTreeNodeId === runtimeBackedContainerNode.id ? (
                  <input
                    ref={(el) => {
                      if (el && renamingTreeNodeInputRef.current !== el) {
                        renamingTreeNodeInputRef.current = el;
                        el.focus();
                        el.select();
                      }
                    }}
                    className="min-w-0 flex-1 truncate rounded border border-ring bg-transparent px-0.5 text-xs font-medium text-foreground/90 outline-none"
                    value={renamingTreeNodeTitle}
                    onChange={(e) => setRenamingTreeNodeTitle(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        renamingTreeNodeCommittedRef.current = true;
                        commitTreeNodeRename(
                          runtimeBackedContainerNode.id,
                          renamingTreeNodeTitle,
                          runtimeBackedContainerNode.title,
                        );
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        renamingTreeNodeCommittedRef.current = true;
                        cancelTreeNodeRename();
                      }
                    }}
                    onBlur={() => {
                      if (!renamingTreeNodeCommittedRef.current) {
                        commitTreeNodeRename(
                          runtimeBackedContainerNode.id,
                          renamingTreeNodeTitle,
                          runtimeBackedContainerNode.title,
                        );
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="flex-1 truncate text-xs font-medium text-foreground/90">
                    {displayTitle}
                  </span>
                )
              ) : renamingProjectId === project.id ? (
                <input
                  ref={(el) => {
                    if (el && renamingProjectInputRef.current !== el) {
                      renamingProjectInputRef.current = el;
                      el.focus();
                      el.select();
                    }
                  }}
                  className="min-w-0 flex-1 truncate rounded border border-ring bg-transparent px-0.5 text-xs font-medium text-foreground/90 outline-none"
                  value={renamingProjectTitle}
                  onChange={(e) => setRenamingProjectTitle(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      renamingProjectCommittedRef.current = true;
                      void commitProjectRename(project.id, renamingProjectTitle, project.name);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      renamingProjectCommittedRef.current = true;
                      cancelProjectRename();
                    }
                  }}
                  onBlur={() => {
                    if (!renamingProjectCommittedRef.current) {
                      void commitProjectRename(project.id, renamingProjectTitle, project.name);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="flex-1 truncate text-xs font-medium text-foreground/90">
                  {displayTitle}
                </span>
              )}
              {node.expanded && projectStatus ? (
                <StatusIndicatorPill indicator={projectStatus} hideLabelOnMobile={false} />
              ) : null}
            </SidebarMenuButton>
            <Tooltip>
              <TooltipTrigger
                render={
                  <SidebarMenuAction
                    render={
                      <button
                        type="button"
                        aria-label={`Create new thread in ${displayTitle}`}
                        data-testid="new-thread-button"
                      />
                    }
                    showOnHover
                    className="top-1 right-1 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void (runtimeBackedContainerNode
                        ? createThreadForSidebarNode(runtimeBackedContainerNode.id)
                        : createThreadInProject(project.id));
                    }}
                  >
                    <SquarePenIcon className="size-3.5" />
                  </SidebarMenuAction>
                }
              />
              <TooltipPopup side="top">
                {newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"}
              </TooltipPopup>
            </Tooltip>
            {runtimeBackedContainerNode ? renderNodeQuickCustomizer(runtimeBackedContainerNode) : null}
            <Menu>
              <MenuTrigger
                render={
                  <SidebarMenuAction
                    render={
                      <button
                        type="button"
                        aria-label={`Project actions for ${displayTitle}`}
                        data-thread-selection-safe
                      />
                    }
                    showOnHover
                    className="top-1 right-13 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <EllipsisIcon className="size-3.5" />
                  </SidebarMenuAction>
                }
              />
              <MenuPopup align="end" side="bottom" className="min-w-40">
                {runtimeBackedContainerNode
                  ? getTreeNodeActions(runtimeBackedContainerNode).map((item) => (
                      <MenuItem
                        key={item.id}
                        variant={item.id === "delete" ? "destructive" : "default"}
                        onClick={(event) => {
                          event.stopPropagation();
                          void runTreeNodeAction(
                            runtimeBackedContainerNode.id,
                            item.id,
                            runtimeBackedContainerNode.title,
                          );
                        }}
                      >
                        {item.label}
                      </MenuItem>
                    ))
                  : SIDEBAR_PROJECT_ACTIONS.map((item) => (
                      <MenuItem
                        key={item.id}
                        variant={item.id === "delete" ? "destructive" : "default"}
                        onClick={(event) => {
                          event.stopPropagation();
                          void runProjectAction(project.id, item.id);
                        }}
                      >
                        {item.label}
                      </MenuItem>
                    ))}
              </MenuPopup>
            </Menu>
          </div>

          <CollapsibleContent>
            <SidebarMenuSub
              ref={attachThreadListAutoAnimateRef}
              className="my-0 w-full translate-x-0 gap-0.5 px-1.5 py-0"
              style={{ marginLeft: `${rowPaddingLeft + 12}px` }}
            >
              <SortableContext
                items={renderedThreads.filter((thread) => !thread.isDraft).map((thread) => getSidebarThreadDragId(thread.id))}
                strategy={verticalListSortingStrategy}
              >
                {renderedThreads.map((thread) =>
                  thread.isDraft ? (
                    renderThreadRow(thread, orderedProjectThreadIds, null)
                  ) : (
                    <SortableThreadItem key={thread.id} dragId={getSidebarThreadDragId(thread.id)}>
                      {(threadDragHandleProps) =>
                        renderThreadRow(thread, orderedProjectThreadIds, threadDragHandleProps)
                      }
                    </SortableThreadItem>
                  ),
                )}
              </SortableContext>
              {node.expanded && hasHiddenThreads && !isThreadListExpanded && (
                <SidebarMenuSubItem className="w-full">
                  <SidebarMenuSubButton
                    render={<button type="button" />}
                    data-thread-selection-safe
                    size="sm"
                    className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                    onClick={() => {
                      expandThreadListForProject(project.id);
                    }}
                  >
                    <span>Show more</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )}
              {node.expanded && hasHiddenThreads && isThreadListExpanded && (
                <SidebarMenuSubItem className="w-full">
                  <SidebarMenuSubButton
                    render={<button type="button" />}
                    data-thread-selection-safe
                    size="sm"
                    className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                    onClick={() => {
                      collapseThreadListForProject(project.id);
                    }}
                  >
                    <span>Show less</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuItem>
    );
  }

  useEffect(() => {
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (selectedThreadIds.size === 0) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldClearThreadSelectionOnMouseDown(target)) return;
      clearSelection();
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [clearSelection, selectedThreadIds.size]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const showDesktopUpdateButton = isElectron && shouldShowDesktopUpdateButton(desktopUpdateState);

  const desktopUpdateTooltip = desktopUpdateState
    ? getDesktopUpdateButtonTooltip(desktopUpdateState)
    : "Update available";

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;
  const desktopUpdateButtonInteractivityClasses = desktopUpdateButtonDisabled
    ? "cursor-not-allowed opacity-60"
    : "hover:bg-accent hover:text-foreground";
  const desktopUpdateButtonClasses =
    desktopUpdateState?.status === "downloaded"
      ? "text-emerald-500"
      : desktopUpdateState?.status === "downloading"
        ? "text-sky-400"
        : shouldHighlightDesktopUpdateError(desktopUpdateState)
          ? "text-rose-500 animate-pulse"
          : "text-amber-500 animate-pulse";
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal") ??
    shortcutLabelForCommand(keybindings, "chat.new");

  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectId)) return current;
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  }, []);

  const wordmark = (
    <div className="flex items-center gap-2">
      <SidebarTrigger className="shrink-0 md:hidden" />
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="flex min-w-0 flex-1 items-center gap-1 ml-1 cursor-pointer">
              <T3Wordmark />
              <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
                Code
              </span>
              <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
                {APP_STAGE_LABEL}
              </span>
            </div>
          }
        />
        <TooltipPopup side="bottom" sideOffset={2}>
          Version {APP_VERSION}
        </TooltipPopup>
      </Tooltip>
    </div>
  );

  return (
    <>
      {isElectron ? (
        <>
          <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[90px]">
            {wordmark}
            {showDesktopUpdateButton && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={desktopUpdateTooltip}
                      aria-disabled={desktopUpdateButtonDisabled || undefined}
                      disabled={desktopUpdateButtonDisabled}
                      className={`inline-flex size-7 ml-auto mt-1.5 items-center justify-center rounded-md text-muted-foreground transition-colors ${desktopUpdateButtonInteractivityClasses} ${desktopUpdateButtonClasses}`}
                      onClick={handleDesktopUpdateButtonClick}
                    >
                      <RocketIcon className="size-3.5" />
                    </button>
                  }
                />
                <TooltipPopup side="bottom">{desktopUpdateTooltip}</TooltipPopup>
              </Tooltip>
            )}
          </SidebarHeader>
        </>
      ) : (
        <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">
          {wordmark}
        </SidebarHeader>
      )}

      <SidebarContent className="flex min-h-full flex-col gap-0">
        {showArm64IntelBuildWarning && arm64IntelBuildWarningDescription ? (
          <SidebarGroup className="px-2 pt-2 pb-0">
            <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
              <TriangleAlertIcon />
              <AlertTitle>Intel build on Apple Silicon</AlertTitle>
              <AlertDescription>{arm64IntelBuildWarningDescription}</AlertDescription>
              {desktopUpdateButtonAction !== "none" ? (
                <AlertAction>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={desktopUpdateButtonDisabled}
                    onClick={handleDesktopUpdateButtonClick}
                  >
                    {desktopUpdateButtonAction === "download"
                      ? "Download ARM build"
                      : "Install ARM build"}
                  </Button>
                </AlertAction>
              ) : null}
            </Alert>
          </SidebarGroup>
        ) : null}
        <SidebarGroup
          className="flex min-h-full flex-1 px-2 py-2"
          onContextMenu={(event) => {
            event.preventDefault();
            void handleSidebarRootContextMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Sidebar
            </span>
            <div className="flex items-center gap-1">
              <ProjectSortMenu
                projectSortOrder={appSettings.sidebarProjectSortOrder}
                threadSortOrder={appSettings.sidebarThreadSortOrder}
                onProjectSortOrderChange={(sortOrder) => {
                  updateSettings({ sidebarProjectSortOrder: sortOrder });
                }}
                onThreadSortOrderChange={(sortOrder) => {
                  updateSettings({ sidebarThreadSortOrder: sortOrder });
                }}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={shouldShowProjectPathEntry ? "Cancel attach folder" : "Attach folder"}
                      aria-pressed={shouldShowProjectPathEntry}
                      className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                      onClick={handleStartAddProject}
                    />
                  }
                >
                  <PlusIcon
                    className={`size-3.5 transition-transform duration-150 ${
                      shouldShowProjectPathEntry ? "rotate-45" : "rotate-0"
                    }`}
                  />
                </TooltipTrigger>
                <TooltipPopup side="right">
                  {shouldShowProjectPathEntry ? "Cancel attach folder" : "Attach folder"}
                </TooltipPopup>
              </Tooltip>
              <Menu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <MenuTrigger className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground" />
                    }
                  >
                    <EllipsisIcon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup side="right">Sidebar actions</TooltipPopup>
                </Tooltip>
                <MenuPopup align="end" side="bottom" className="min-w-40">
                  {SIDEBAR_ROOT_ACTIONS.map((item) => (
                    <MenuItem
                      key={item.id}
                      onClick={() => {
                        void runSidebarRootAction(item.id);
                      }}
                    >
                      {item.label}
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            </div>
          </div>

          {shouldShowProjectPathEntry && (
            <div className="mb-2 px-1">
              {isElectron && (
                <button
                  type="button"
                  className="mb-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-secondary py-1.5 text-xs text-foreground/80 transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void handlePickFolder()}
                  disabled={isPickingFolder || isAddingProject}
                >
                  <FolderIcon className="size-3.5" />
                  {isPickingFolder ? "Picking folder..." : "Browse for folder"}
                </button>
              )}
              <div className="flex gap-1.5">
                <input
                  ref={addProjectInputRef}
                  className={`min-w-0 flex-1 rounded-md border bg-secondary px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none ${
                    addProjectError
                      ? "border-red-500/70 focus:border-red-500"
                      : "border-border focus:border-ring"
                  }`}
                  placeholder="/path/to/project"
                  value={newCwd}
                  onChange={(event) => {
                    setNewCwd(event.target.value);
                    setAddProjectError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleAddProject();
                    if (event.key === "Escape") {
                      setAddingProject(false);
                      setAddProjectError(null);
                    }
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-60"
                  onClick={handleAddProject}
                  disabled={!canAddProject}
                >
                  {isAddingProject ? "Adding..." : "Add"}
                </button>
              </div>
              {addProjectError && (
                <p className="mt-1 px-0.5 text-[11px] leading-tight text-red-400">
                  {addProjectError}
                </p>
              )}
              <div className="mt-1.5 px-0.5">
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                  onClick={() => {
                    setAddingProject(false);
                    setAddProjectError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <DndContext
            sensors={sidebarDnDSensors}
            collisionDetection={projectCollisionDetection}
            modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
            onDragStart={handleSidebarDragStart}
            onDragEnd={handleSidebarDragEnd}
            onDragCancel={handleSidebarDragCancel}
          >
            <SidebarMenu ref={attachProjectListAutoAnimateRef}>
              <SortableContext
                items={flattenedSidebarTree.map((entry) => getSidebarNodeDragId(entry.node.id))}
                strategy={verticalListSortingStrategy}
              >
                {flattenedSidebarTree.map((entry) => (
                  <SortableProjectItem key={entry.node.id} dragId={getSidebarNodeDragId(entry.node.id)}>
                    {(dragHandleProps) => renderTreeNodeItem(entry, dragHandleProps)}
                  </SortableProjectItem>
                ))}
              </SortableContext>
            </SidebarMenu>
          </DndContext>

          {flattenedSidebarTree.length === 0 && !shouldShowProjectPathEntry && (
            <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
              No folders or projects yet
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="p-2">
        <div className="mb-2">
          <BackendTargetControl />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            {isOnSettings ? (
              <SidebarMenuButton
                size="sm"
                className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                onClick={() => window.history.back()}
              >
                <ArrowLeftIcon className="size-3.5" />
                <span className="text-xs">Back</span>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                size="sm"
                className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                onClick={() => void navigate({ to: "/settings" })}
              >
                <SettingsIcon className="size-3.5" />
                <span className="text-xs">Settings</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <Dialog open={nodeCustomizerTarget !== null} onOpenChange={(open) => !open && closeNodeCustomizer()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Customize sidebar node</DialogTitle>
            <DialogDescription>
              {nodeCustomizerTarget
                ? `Set the workspace, icon, and accent for ${nodeCustomizerTarget.title}.`
                : "Customize a sidebar node."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">Workspace override</span>
              <Input
                value={nodeWorkspaceDraft}
                onChange={(event) => setNodeWorkspaceDraft(event.target.value)}
                placeholder={appSettings.defaultWorkspaceRoot}
                spellCheck={false}
              />
              <span className="text-xs text-muted-foreground">
                Leave blank to inherit the default workspace:
                {" "}
                <code>{appSettings.defaultWorkspaceRoot}</code>
              </span>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">Icon or emoji</span>
              <Input
                value={nodeIconDraft}
                onChange={(event) => setNodeIconDraft(event.target.value)}
                placeholder="📁"
                spellCheck={false}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">Accent color</span>
              <Select
                value={nodeAccentDraft}
                onValueChange={(value) => {
                  setNodeAccentDraft(value as SidebarNodeAccent | "");
                }}
              >
                <SelectTrigger aria-label="Sidebar node accent">
                  <SelectValue>
                    {nodeAccentDraft
                      ? SIDEBAR_NODE_ACCENT_OPTIONS.find((option) => option.value === nodeAccentDraft)
                          ?.label ?? "Custom"
                      : "None"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="start" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="">
                    None
                  </SelectItem>
                  {SIDEBAR_NODE_ACCENT_OPTIONS.map((option) => (
                    <SelectItem hideIndicator key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
            {nodeCustomizerTarget ? (
              <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                <div>
                  Runtime binding:
                  {" "}
                  {nodeCustomizerTarget.runtimeProjectId ? (
                    <code>{nodeCustomizerTarget.runtimeProjectId}</code>
                  ) : (
                    "Created automatically on first new thread"
                  )}
                </div>
                <div className="mt-1">
                  Effective workspace:
                  {" "}
                  <code>
                    {resolveSidebarNodeWorkspaceRoot(
                      sidebarTree,
                      nodeCustomizerTarget.nodeId,
                      appSettings.defaultWorkspaceRoot,
                    )}
                  </code>
                </div>
              </div>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeNodeCustomizer}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => setNodeWorkspaceDraft("")}>
              Clear workspace
            </Button>
            <Button onClick={saveNodeCustomization}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={loopDialogTarget !== null}
        onOpenChange={(open) => !open && !isSubmittingLoopDialog && closeLoopDialog()}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New loop</DialogTitle>
            <DialogDescription>
              {loopDialogTarget
                ? `Launch a supervisor-managed loop for ${loopDialogTarget.title}.`
                : "Configure a new managed loop."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Loop type</span>
                <Select
                  value={loopFormState.loopType}
                  onValueChange={(value) =>
                    setLoopFormState((current) => ({
                      ...current,
                      loopType: value as JhLoopType,
                    }))
                  }
                >
                  <SelectTrigger aria-label="Loop type">
                    <SelectValue>{loopFormState.loopType === "goal-loop" ? "Goal loop" : "Endless loop"}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    <SelectItem value="goal-loop">Goal loop</SelectItem>
                    <SelectItem value="endless-loop">Endless loop</SelectItem>
                  </SelectPopup>
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Workers</span>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={String(loopFormState.workerCount)}
                  onChange={(event) =>
                    setLoopFormState((current) => ({
                      ...current,
                      workerCount: Math.max(1, Number.parseInt(event.target.value || "1", 10) || 1),
                    }))
                  }
                />
              </label>
            </div>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">Project title</span>
              <Input
                value={loopFormState.projectTitle}
                onChange={(event) =>
                  setLoopFormState((current) => ({ ...current, projectTitle: event.target.value }))
                }
                placeholder={loopDialogTarget?.title ?? "Loop project"}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">Objective / initial prompt</span>
              <Textarea
                value={loopFormState.objective}
                onChange={(event) =>
                  setLoopFormState((current) => ({ ...current, objective: event.target.value }))
                }
                placeholder="Describe the goal, operating posture, and what the loop should start doing."
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">Completion criteria</span>
              <Textarea
                value={loopFormState.completionCriteria}
                onChange={(event) =>
                  setLoopFormState((current) => ({ ...current, completionCriteria: event.target.value }))
                }
                placeholder={
                  loopFormState.loopType === "goal-loop"
                    ? "Define what proof or end state should stop the loop."
                    : "Optional override. Leave blank to keep looping until manually stopped."
                }
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Worker model</span>
                <Select
                  value={loopFormState.workerModel}
                  onValueChange={(value) =>
                    setLoopFormState((current) => ({
                      ...current,
                      workerModel: value ?? current.workerModel,
                    }))
                  }
                >
                  <SelectTrigger aria-label="Worker model">
                    <SelectValue>{loopFormState.workerModel}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    {workerModelOptions.map((option) => (
                      <SelectItem key={option.slug} value={option.slug}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Supervisor model</span>
                <Select
                  value={loopFormState.supervisorModel}
                  onValueChange={(value) =>
                    setLoopFormState((current) => ({
                      ...current,
                      supervisorModel: value ?? current.supervisorModel,
                    }))
                  }
                >
                  <SelectTrigger aria-label="Supervisor model">
                    <SelectValue>{loopFormState.supervisorModel}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    {supervisorModelOptions.map((option) => (
                      <SelectItem key={option.slug} value={option.slug}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Worker runtime</span>
                <Select
                  value={loopFormState.workerRuntimeMode}
                  onValueChange={(value) =>
                    setLoopFormState((current) => ({
                      ...current,
                      workerRuntimeMode: value as RuntimeMode,
                    }))
                  }
                >
                  <SelectTrigger aria-label="Worker runtime mode">
                    <SelectValue>{loopFormState.workerRuntimeMode}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    <SelectItem value="full-access">full-access</SelectItem>
                    <SelectItem value="approval-required">approval-required</SelectItem>
                  </SelectPopup>
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Supervisor runtime</span>
                <Select
                  value={loopFormState.supervisorRuntimeMode}
                  onValueChange={(value) =>
                    setLoopFormState((current) => ({
                      ...current,
                      supervisorRuntimeMode: value as RuntimeMode,
                    }))
                  }
                >
                  <SelectTrigger aria-label="Supervisor runtime mode">
                    <SelectValue>{loopFormState.supervisorRuntimeMode}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    <SelectItem value="full-access">full-access</SelectItem>
                    <SelectItem value="approval-required">approval-required</SelectItem>
                  </SelectPopup>
                </Select>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Worker mode</span>
                <Select
                  value={loopFormState.workerInteractionMode}
                  onValueChange={(value) =>
                    setLoopFormState((current) => ({
                      ...current,
                      workerInteractionMode: value as ProviderInteractionMode,
                    }))
                  }
                >
                  <SelectTrigger aria-label="Worker interaction mode">
                    <SelectValue>{loopFormState.workerInteractionMode}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    <SelectItem value="default">default</SelectItem>
                    <SelectItem value="plan">plan</SelectItem>
                  </SelectPopup>
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Supervisor mode</span>
                <Select
                  value={loopFormState.supervisorInteractionMode}
                  onValueChange={(value) =>
                    setLoopFormState((current) => ({
                      ...current,
                      supervisorInteractionMode: value as ProviderInteractionMode,
                    }))
                  }
                >
                  <SelectTrigger aria-label="Supervisor interaction mode">
                    <SelectValue>{loopFormState.supervisorInteractionMode}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    <SelectItem value="default">default</SelectItem>
                    <SelectItem value="plan">plan</SelectItem>
                  </SelectPopup>
                </Select>
              </label>
            </div>
            {loopDialogTarget ? (
              <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                <div>
                  Workspace:
                  {" "}
                  <code>{loopDialogTarget.workspaceRoot}</code>
                </div>
                <div className="mt-1">
                  Runtime binding:
                  {" "}
                  {loopDialogTarget.runtimeProjectId ? (
                    <code>{loopDialogTarget.runtimeProjectId}</code>
                  ) : (
                    "A runtime project will be created and bound on submit."
                  )}
                </div>
              </div>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeLoopDialog}
              disabled={isSubmittingLoopDialog}
            >
              Cancel
            </Button>
            <Button onClick={() => void submitLoopDialog()} disabled={isSubmittingLoopDialog}>
              {isSubmittingLoopDialog ? "Creating..." : "Create loop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={badgeEditorTarget !== null} onOpenChange={(open) => !open && closeBadgeEditor()}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {badgeEditorTarget?.kind === "project" ? "Set Project Badge" : "Set Thread Badge"}
            </DialogTitle>
            <DialogDescription>
              {badgeEditorTarget
                ? `Customize the badge for ${badgeEditorTarget.title}. Leave optional styling fields blank to rely on the tone palette.`
                : "Customize a sidebar badge."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <datalist id="sidebar-badge-tone-options">
              {SIDEBAR_BADGE_TONE_SUGGESTIONS.map((tone) => (
                <option key={tone} value={tone} />
              ))}
            </datalist>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Label</span>
                <Input
                  value={badgeFormState.label}
                  onChange={(event) =>
                    setBadgeFormState((current) => ({ ...current, label: event.target.value }))
                  }
                  placeholder="Thinking"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Tone</span>
                <Input
                  value={badgeFormState.tone}
                  onChange={(event) =>
                    setBadgeFormState((current) => ({ ...current, tone: event.target.value }))
                  }
                  list="sidebar-badge-tone-options"
                  placeholder="sky"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Text color</span>
                <Input
                  value={badgeFormState.textColor}
                  onChange={(event) =>
                    setBadgeFormState((current) => ({ ...current, textColor: event.target.value }))
                  }
                  placeholder="#e2e8f0 or oklch(...)"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Dot color</span>
                <Input
                  value={badgeFormState.dotColor}
                  onChange={(event) =>
                    setBadgeFormState((current) => ({ ...current, dotColor: event.target.value }))
                  }
                  placeholder="#38bdf8"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Background color</span>
                <Input
                  value={badgeFormState.bgColor}
                  onChange={(event) =>
                    setBadgeFormState((current) => ({ ...current, bgColor: event.target.value }))
                  }
                  placeholder="transparent, #111827, rgba(...)"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Priority</span>
                <Input
                  value={badgeFormState.priority}
                  onChange={(event) =>
                    setBadgeFormState((current) => ({ ...current, priority: event.target.value }))
                  }
                  inputMode="numeric"
                  placeholder="100"
                />
              </label>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
              <div>
                <div className="text-sm font-medium">Pulse</div>
                <div className="text-xs text-muted-foreground">
                  Animate the badge dot for active or urgent states.
                </div>
              </div>
              <Switch
                checked={badgeFormState.pulse}
                onCheckedChange={(checked) =>
                  setBadgeFormState((current) => ({ ...current, pulse: Boolean(checked) }))
                }
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (badgeEditorTarget) {
                  void clearCustomIndicator(badgeEditorTarget);
                }
              }}
              disabled={!badgeEditorTarget}
            >
              Clear badge
            </Button>
            <Button variant="outline" onClick={closeBadgeEditor}>
              Cancel
            </Button>
            <Button onClick={() => void saveBadgeEditor()}>Save badge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
