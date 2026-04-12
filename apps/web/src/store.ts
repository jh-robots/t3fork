import { Fragment, type ReactNode, createElement, useEffect } from "react";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type OrchestrationCustomIndicator,
  type ProviderKind,
  ProjectId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationSessionStatus,
} from "@t3tools/contracts";
import {
  inferProviderForModel,
  resolveModelSlug,
  resolveModelSlugForProvider,
} from "@t3tools/shared/model";
import { create } from "zustand";
import {
  type ChatMessage,
  type Project,
  type SidebarTreeContainerMetadata,
  type SidebarTreeNodeId,
  type SidebarTreeState,
  type Thread,
} from "./types";
import { Debouncer } from "@tanstack/react-pacer";
import { toBackendAssetUrl } from "./backendOrigin";
import { getLocalStorageItem } from "./hooks/useLocalStorage";
import {
  createEmptySidebarTree,
  createSidebarTreeContainer,
  deleteSidebarTreeNode,
  setSidebarTreeNodeAccent,
  setSidebarTreeNodeIcon,
  setSidebarTreeNodeLoopBinding as setSidebarTreeNodeLoopBindingInTree,
  setSidebarTreeNodeRuntimeProjectId,
  setSidebarTreeNodeWorkspaceOverride,
  moveSidebarTreeNode,
  reconcileSidebarTreeRuntimeProjects,
  renameSidebarTreeNode,
  toggleSidebarTreeNodeExpanded,
} from "./sidebarTree";
import type { SidebarNodeAccent } from "./types";

// ── State ────────────────────────────────────────────────────────────

export interface AppState {
  projects: Project[];
  threads: Thread[];
  sidebarTree: SidebarTreeState;
  projectLeaderThreadIdByProjectId: Record<Project["id"], ThreadId>;
  threadsHydrated: boolean;
}

const PERSISTED_STATE_KEY = "t3code:renderer-state:v12";
const LEGACY_PERSISTED_STATE_KEYS = [
  "t3code:renderer-state:v11",
  "t3code:renderer-state:v10",
  "t3code:renderer-state:v9",
  "t3code:renderer-state:v8",
  "t3code:renderer-state:v7",
  "t3code:renderer-state:v6",
  "t3code:renderer-state:v5",
  "t3code:renderer-state:v4",
  "t3code:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

const PERSISTED_STATE_KEYS = [PERSISTED_STATE_KEY, ...LEGACY_PERSISTED_STATE_KEYS] as const;

const initialState: AppState = {
  projects: [],
  threads: [],
  sidebarTree: createEmptySidebarTree(),
  projectLeaderThreadIdByProjectId: {},
  threadsHydrated: false,
};
const persistedProjectExpansionByCwd = new Map<string, boolean>();
const persistedProjectOrderCwds: string[] = [];
const persistedThreadOrderIdsByProjectId = new Map<string, string[]>();
const dismissedRuntimeProjectIds = new Set<Project["id"]>();

const DEFAULT_FOLDER_ICON = "\u{1F4C1}";

function rememberDismissedRuntimeProjects(
  sidebarTree: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
): void {
  const stack: SidebarTreeNodeId[] = [nodeId];
  const seen = new Set<SidebarTreeNodeId>();

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId || seen.has(currentId)) {
      continue;
    }
    seen.add(currentId);
    const node = sidebarTree.nodesById[currentId];
    if (!node) {
      continue;
    }
    if ((node.kind === "folder" || node.kind === "virtualProject") && node.runtimeProjectId) {
      dismissedRuntimeProjectIds.add(node.runtimeProjectId);
      for (const childId of node.childrenIds) {
        stack.push(childId);
      }
    }
  }
}

function normalizePersistedSidebarTree(sidebarTree: SidebarTreeState | undefined): SidebarTreeState {
  if (!sidebarTree) {
    return createEmptySidebarTree();
  }
  let changed = false;
  const nodesById = Object.fromEntries(
    Object.entries(sidebarTree.nodesById).map(([nodeId, node]) => {
      if ((node.kind === "folder" || node.kind === "virtualProject") && node.icon === "??") {
        changed = true;
        return [nodeId, { ...node, icon: DEFAULT_FOLDER_ICON }] as const;
      }
      return [nodeId, node] as const;
    }),
  );
  return changed ? { ...sidebarTree, nodesById } : sidebarTree;
}

function collapseLegacyDuplicateSidebarProjects(
  sidebarTree: SidebarTreeState,
  projects: readonly Pick<Project, "id" | "name">[],
): SidebarTreeState {
  const projectNameById = new Map(projects.map((project) => [project.id, project.name.trim()] as const));
  let nextTree = sidebarTree;

  for (const [nodeId, node] of Object.entries(nextTree.nodesById)) {
    if (node.kind !== "folder" || node.runtimeProjectId || node.childrenIds.length !== 1) {
      continue;
    }

    const childId = node.childrenIds[0];
    if (!childId) {
      continue;
    }
    const childNode = nextTree.nodesById[childId];
    if (!childNode || childNode.kind !== "runtimeProject" || childNode.parentId !== nodeId) {
      continue;
    }

    const folderTitle = node.title.trim();
    const runtimeProjectTitle = projectNameById.get(childNode.projectId) ?? "";
    if (!folderTitle || folderTitle !== runtimeProjectTitle) {
      continue;
    }

    const timestamp = new Date().toISOString();
    nextTree = {
      ...nextTree,
      nodesById: {
        ...nextTree.nodesById,
        [nodeId]: {
          ...node,
          kind: "virtualProject",
          runtimeProjectId: childNode.projectId,
          childrenIds: [],
          loopBinding: node.loopBinding ?? null,
          updatedAt: timestamp,
        },
      },
    };
    nextTree = deleteSidebarTreeNode(nextTree, childId);
  }

  for (const [folderNodeId, folderNode] of Object.entries(nextTree.nodesById)) {
    if (
      (folderNode.kind !== "folder" && folderNode.kind !== "virtualProject") ||
      folderNode.parentId !== null ||
      folderNode.runtimeProjectId ||
      folderNode.title.trim().length === 0
    ) {
      continue;
    }

    const matchingProject = projects.find((project) => project.name.trim() === folderNode.title.trim());
    if (!matchingProject) {
      continue;
    }

    const duplicateEntry = Object.entries(nextTree.nodesById).find(([candidateNodeId, candidate]) => {
      if (candidateNodeId === folderNodeId || candidate.parentId !== null) {
        return false;
      }
      if (candidate.kind === "runtimeProject") {
        return candidate.projectId === matchingProject.id;
      }
      if (candidate.kind === "folder" || candidate.kind === "virtualProject") {
        return candidate.runtimeProjectId === matchingProject.id;
      }
      return false;
    });
    if (!duplicateEntry) {
      continue;
    }

    const [duplicateNodeId, duplicateNode] = duplicateEntry;
    const timestamp = new Date().toISOString();
    nextTree = {
      ...nextTree,
      nodesById: {
        ...nextTree.nodesById,
        [folderNodeId]: {
          ...folderNode,
          runtimeProjectId: matchingProject.id,
          workspaceOverride:
            folderNode.workspaceOverride ??
            (duplicateNode.kind === "folder" || duplicateNode.kind === "virtualProject"
              ? duplicateNode.workspaceOverride ?? null
              : null),
          accent:
            folderNode.accent ??
            (duplicateNode.kind === "folder" || duplicateNode.kind === "virtualProject"
              ? duplicateNode.accent ?? null
              : null),
          icon:
            folderNode.icon ??
            (duplicateNode.kind === "folder" || duplicateNode.kind === "virtualProject"
              ? duplicateNode.icon ?? null
              : null),
          loopBinding:
            folderNode.loopBinding ??
            (duplicateNode.kind === "folder" || duplicateNode.kind === "virtualProject"
              ? duplicateNode.loopBinding ?? null
              : null),
          updatedAt: timestamp,
        },
      },
    };
    nextTree = deleteSidebarTreeNode(nextTree, duplicateNodeId);
  }

  return nextTree;
}

// ── Persist helpers ──────────────────────────────────────────────────

type PersistedStateStorage = Pick<Storage, "getItem">;

export function readPersistedStateFromStorage(storage: PersistedStateStorage): AppState {
  persistedProjectExpansionByCwd.clear();
  persistedProjectOrderCwds.length = 0;
  persistedThreadOrderIdsByProjectId.clear();
  dismissedRuntimeProjectIds.clear();
  try {
    let persistedEntry: readonly [(typeof PERSISTED_STATE_KEYS)[number], string] | null = null;
    for (const key of PERSISTED_STATE_KEYS) {
      const value = storage.getItem(key);
      if (typeof value === "string" && value.length > 0) {
        persistedEntry = [key, value] as const;
        break;
      }
    }
    if (!persistedEntry) return initialState;
    const [persistedKey, raw] = persistedEntry;
    const shouldReusePersistedSidebarTree = persistedKey === PERSISTED_STATE_KEY;
    const parsed = JSON.parse(raw) as {
      projectExpansionByCwd?: Record<string, boolean>;
      expandedProjectCwds?: string[];
      projectOrderCwds?: string[];
      threadOrderIdsByProjectId?: Record<string, string[]>;
      dismissedRuntimeProjectIds?: string[];
      sidebarTree?: SidebarTreeState;
      projectLeaderThreadIdByProjectId?: Record<string, string>;
    };
    for (const [cwd, expanded] of Object.entries(parsed.projectExpansionByCwd ?? {})) {
      if (typeof cwd === "string" && cwd.length > 0 && typeof expanded === "boolean") {
        persistedProjectExpansionByCwd.set(cwd, expanded);
      }
    }
    for (const cwd of parsed.expandedProjectCwds ?? []) {
      if (typeof cwd === "string" && cwd.length > 0) {
        persistedProjectExpansionByCwd.set(cwd, true);
      }
    }
    for (const cwd of parsed.projectOrderCwds ?? []) {
      if (typeof cwd === "string" && cwd.length > 0 && !persistedProjectOrderCwds.includes(cwd)) {
        persistedProjectOrderCwds.push(cwd);
      }
    }
    for (const [projectId, threadOrderIds] of Object.entries(parsed.threadOrderIdsByProjectId ?? {})) {
      if (typeof projectId !== "string" || projectId.length === 0 || !Array.isArray(threadOrderIds)) {
        continue;
      }
      const normalizedThreadIds = threadOrderIds.filter(
        (threadId): threadId is string => typeof threadId === "string" && threadId.length > 0,
      );
      if (normalizedThreadIds.length > 0) {
        persistedThreadOrderIdsByProjectId.set(projectId, normalizedThreadIds);
      }
    }
    if (shouldReusePersistedSidebarTree) {
      for (const projectId of parsed.dismissedRuntimeProjectIds ?? []) {
        if (typeof projectId === "string" && projectId.length > 0) {
          dismissedRuntimeProjectIds.add(ProjectId.makeUnsafe(projectId));
        }
      }
    }
    const projectLeaderThreadIdByProjectId = Object.fromEntries(
      Object.entries(parsed.projectLeaderThreadIdByProjectId ?? {}).filter(
        ([projectId, threadId]) =>
          typeof projectId === "string" &&
          projectId.length > 0 &&
          typeof threadId === "string" &&
          threadId.length > 0,
      ),
    ) as Record<Project["id"], ThreadId>;
    return {
      ...initialState,
      sidebarTree: shouldReusePersistedSidebarTree
        ? normalizePersistedSidebarTree(parsed.sidebarTree)
        : initialState.sidebarTree,
      projectLeaderThreadIdByProjectId,
    };
  } catch {
    return initialState;
  }
}

function readPersistedState(): AppState {
  if (typeof window === "undefined") return initialState;
  return readPersistedStateFromStorage(window.localStorage);
}

let legacyKeysCleanedUp = false;

function persistState(state: AppState): void {
  if (typeof window === "undefined") return;
  try {
    const threadOrderIdsByProjectId = state.threads.reduce<Record<string, string[]>>((acc, thread) => {
      const existing = acc[thread.projectId] ?? [];
      existing.push(thread.id);
      acc[thread.projectId] = existing;
      return acc;
    }, {});
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        projectExpansionByCwd: Object.fromEntries(
          state.projects.map((project) => [project.cwd, project.expanded] as const),
        ),
        expandedProjectCwds: state.projects
          .filter((project) => project.expanded)
          .map((project) => project.cwd),
        projectOrderCwds: state.projects.map((project) => project.cwd),
        threadOrderIdsByProjectId,
        dismissedRuntimeProjectIds: Array.from(dismissedRuntimeProjectIds),
        sidebarTree: state.sidebarTree,
        projectLeaderThreadIdByProjectId: state.projectLeaderThreadIdByProjectId,
      }),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}
const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

// ── Pure helpers ──────────────────────────────────────────────────────

function updateThread(
  threads: Thread[],
  threadId: ThreadId,
  updater: (t: Thread) => Thread,
): Thread[] {
  let changed = false;
  const next = threads.map((t) => {
    if (t.id !== threadId) return t;
    const updated = updater(t);
    if (updated !== t) changed = true;
    return updated;
  });
  return changed ? next : threads;
}

function reconcileProjectLeaderThreadIds(input: {
  projectLeaderThreadIdByProjectId: Record<Project["id"], ThreadId>;
  projects: readonly Pick<Project, "id">[];
  threads: readonly Pick<Thread, "id" | "projectId">[];
}): Record<Project["id"], ThreadId> {
  const validProjectIds = new Set(input.projects.map((project) => project.id));
  const threadById = new Map(input.threads.map((thread) => [thread.id, thread] as const));
  const nextEntries: Array<readonly [Project["id"], ThreadId]> = [];

  for (const [projectId, threadId] of Object.entries(input.projectLeaderThreadIdByProjectId) as Array<
    [Project["id"], ThreadId]
  >) {
    if (!validProjectIds.has(projectId)) {
      continue;
    }
    const thread = threadById.get(threadId);
    if (!thread || thread.projectId !== projectId) {
      continue;
    }
    nextEntries.push([projectId, threadId]);
  }

  if (nextEntries.length === Object.keys(input.projectLeaderThreadIdByProjectId).length) {
    let unchanged = true;
    for (const [projectId, threadId] of nextEntries) {
      if (input.projectLeaderThreadIdByProjectId[projectId] !== threadId) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) {
      return input.projectLeaderThreadIdByProjectId;
    }
  }

  return Object.fromEntries(nextEntries) as Record<Project["id"], ThreadId>;
}

function mapProjectsFromReadModel(
  incoming: OrchestrationReadModel["projects"],
  previous: Project[],
): Project[] {
  const previousById = new Map(previous.map((project) => [project.id, project] as const));
  const previousByCwd = new Map(previous.map((project) => [project.cwd, project] as const));
  const previousOrderById = new Map(previous.map((project, index) => [project.id, index] as const));
  const previousOrderByCwd = new Map(
    previous.map((project, index) => [project.cwd, index] as const),
  );
  const persistedOrderByCwd = new Map(
    persistedProjectOrderCwds.map((cwd, index) => [cwd, index] as const),
  );
  const usePersistedOrder = previous.length === 0;

  const mappedProjects = incoming.map((project) => {
    const existing = previousById.get(project.id) ?? previousByCwd.get(project.workspaceRoot);
    return {
      id: project.id,
      name: project.title,
      cwd: project.workspaceRoot,
      model:
        existing?.model ??
        resolveModelSlug(project.defaultModel ?? DEFAULT_MODEL_BY_PROVIDER.codex),
      customIndicator: project.customIndicator ?? null,
      expanded:
        existing?.expanded ??
        persistedProjectExpansionByCwd.get(project.workspaceRoot) ??
        true,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      scripts: project.scripts.map((script) => ({ ...script })),
    } satisfies Project;
  });

  return mappedProjects
    .map((project, incomingIndex) => {
      const previousIndex =
        previousOrderById.get(project.id) ?? previousOrderByCwd.get(project.cwd);
      const persistedIndex = usePersistedOrder ? persistedOrderByCwd.get(project.cwd) : undefined;
      const orderIndex =
        previousIndex ??
        persistedIndex ??
        (usePersistedOrder ? persistedProjectOrderCwds.length : previous.length) + incomingIndex;
      return { project, incomingIndex, orderIndex };
    })
    .toSorted((a, b) => {
      const byOrder = a.orderIndex - b.orderIndex;
      if (byOrder !== 0) return byOrder;
      return a.incomingIndex - b.incomingIndex;
    })
    .map((entry) => entry.project);
}

function mapThreadsFromReadModel(
  incoming: OrchestrationReadModel["threads"],
  previous: Thread[],
): Thread[] {
  const previousThreadById = new Map(previous.map((thread) => [thread.id, thread] as const));
  const previousThreadOrderByProjectId = new Map<string, Map<string, number>>();
  for (let index = 0; index < previous.length; index += 1) {
    const thread = previous[index];
    if (!thread) continue;
    const projectOrder = previousThreadOrderByProjectId.get(thread.projectId) ?? new Map<string, number>();
    projectOrder.set(thread.id, index);
    previousThreadOrderByProjectId.set(thread.projectId, projectOrder);
  }
  const usePersistedOrder = previous.length === 0;

  return incoming
    .map((thread, incomingIndex) => {
      const existing = previousThreadById.get(thread.id);
      const mappedThread = {
        id: thread.id,
        codexThreadId: null,
        projectId: thread.projectId,
        title: thread.title,
        model: resolveModelSlugForProvider(
          inferProviderForThreadModel({
            model: thread.model,
            sessionProviderName: thread.session?.providerName ?? null,
          }),
          thread.model,
        ),
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        customIndicator: thread.customIndicator ?? null,
        session: thread.session
          ? {
              provider: toLegacyProvider(thread.session.providerName),
              status: toLegacySessionStatus(thread.session.status),
              orchestrationStatus: thread.session.status,
              activeTurnId: thread.session.activeTurnId ?? undefined,
              createdAt: thread.session.updatedAt,
              updatedAt: thread.session.updatedAt,
              ...(thread.session.lastError ? { lastError: thread.session.lastError } : {}),
            }
          : null,
        messages: thread.messages.map((message) => {
          const attachments = message.attachments?.map((attachment) => ({
            type: "image" as const,
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
          }));
          const normalizedMessage: ChatMessage = {
            id: message.id,
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            streaming: message.streaming,
            ...(message.streaming ? {} : { completedAt: message.updatedAt }),
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          };
          return normalizedMessage;
        }),
        proposedPlans: thread.proposedPlans.map((proposedPlan) => ({
          id: proposedPlan.id,
          turnId: proposedPlan.turnId,
          planMarkdown: proposedPlan.planMarkdown,
          implementedAt: proposedPlan.implementedAt,
          implementationThreadId: proposedPlan.implementationThreadId,
          createdAt: proposedPlan.createdAt,
          updatedAt: proposedPlan.updatedAt,
        })),
        error: thread.session?.lastError ?? null,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        latestTurn: thread.latestTurn,
        lastVisitedAt: existing?.lastVisitedAt ?? thread.updatedAt,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        turnDiffSummaries: thread.checkpoints.map((checkpoint) => ({
          turnId: checkpoint.turnId,
          completedAt: checkpoint.completedAt,
          status: checkpoint.status,
          assistantMessageId: checkpoint.assistantMessageId ?? undefined,
          checkpointTurnCount: checkpoint.checkpointTurnCount,
          checkpointRef: checkpoint.checkpointRef,
          files: checkpoint.files.map((file) => ({ ...file })),
        })),
        activities: thread.activities.map((activity) => ({ ...activity })),
      } satisfies Thread;
      const previousProjectOrder = previousThreadOrderByProjectId.get(thread.projectId);
      const previousProjectIndex = previousProjectOrder?.get(thread.id);
      const persistedProjectOrder = usePersistedOrder
        ? persistedThreadOrderIdsByProjectId.get(thread.projectId)
        : undefined;
      const persistedProjectIndex = persistedProjectOrder?.indexOf(thread.id);
      const orderIndex =
        previousProjectIndex ??
        (persistedProjectIndex !== undefined && persistedProjectIndex >= 0
          ? persistedProjectIndex
          : (usePersistedOrder ? persistedProjectOrder?.length ?? 0 : previous.length) + incomingIndex);

      return {
        thread: mappedThread,
        incomingIndex,
        orderIndex,
      };
    })
    .toSorted((left, right) => {
      if (left.thread.projectId !== right.thread.projectId) {
        return left.incomingIndex - right.incomingIndex;
      }
      const byOrder = left.orderIndex - right.orderIndex;
      if (byOrder !== 0) return byOrder;
      return left.incomingIndex - right.incomingIndex;
    })
    .map((entry) => entry.thread);
}

function toLegacySessionStatus(
  status: OrchestrationSessionStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

function toLegacyProvider(providerName: string | null): ProviderKind {
  if (providerName === "codex" || providerName === "claudeAgent") {
    return providerName;
  }
  return "codex";
}

function inferProviderForThreadModel(input: {
  readonly model: string;
  readonly sessionProviderName: string | null;
}): ProviderKind {
  if (input.sessionProviderName === "codex" || input.sessionProviderName === "claudeAgent") {
    return input.sessionProviderName;
  }
  return inferProviderForModel(input.model);
}

function toAttachmentPreviewUrl(rawUrl: string): string {
  return toBackendAssetUrl(rawUrl);
}

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}

// ── Pure state transition functions ────────────────────────────────────

export function syncServerReadModel(state: AppState, readModel: OrchestrationReadModel): AppState {
  const projects = mapProjectsFromReadModel(
    readModel.projects.filter((project) => project.deletedAt === null),
    state.projects,
  );
  const threads = mapThreadsFromReadModel(
    readModel.threads.filter((thread) => thread.deletedAt === null),
    state.threads,
  );
  const normalizedSidebarTree = collapseLegacyDuplicateSidebarProjects(state.sidebarTree, projects);
  return {
    ...state,
    projects,
    threads,
    sidebarTree: reconcileSidebarTreeRuntimeProjects(
      normalizedSidebarTree,
      projects,
      dismissedRuntimeProjectIds,
    ),
    projectLeaderThreadIdByProjectId: reconcileProjectLeaderThreadIds({
      projectLeaderThreadIdByProjectId: state.projectLeaderThreadIdByProjectId,
      projects,
      threads,
    }),
    threadsHydrated: true,
  };
}

export function markThreadVisited(
  state: AppState,
  threadId: ThreadId,
  visitedAt?: string,
): AppState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const threads = updateThread(state.threads, threadId, (thread) => {
    const previousVisitedAtMs = thread.lastVisitedAt ? Date.parse(thread.lastVisitedAt) : NaN;
    if (
      Number.isFinite(previousVisitedAtMs) &&
      Number.isFinite(visitedAtMs) &&
      previousVisitedAtMs >= visitedAtMs
    ) {
      return thread;
    }
    return { ...thread, lastVisitedAt: at };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function markThreadUnread(state: AppState, threadId: ThreadId): AppState {
  const threads = updateThread(state.threads, threadId, (thread) => {
    if (!thread.latestTurn?.completedAt) return thread;
    const latestTurnCompletedAtMs = Date.parse(thread.latestTurn.completedAt);
    if (Number.isNaN(latestTurnCompletedAtMs)) return thread;
    const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
    if (thread.lastVisitedAt === unreadVisitedAt) return thread;
    return { ...thread, lastVisitedAt: unreadVisitedAt };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function toggleProject(state: AppState, projectId: Project["id"]): AppState {
  return {
    ...state,
    projects: state.projects.map((p) => (p.id === projectId ? { ...p, expanded: !p.expanded } : p)),
  };
}

export function setProjectExpanded(
  state: AppState,
  projectId: Project["id"],
  expanded: boolean,
  workspaceRoot?: string,
): AppState {
  if (workspaceRoot && workspaceRoot.length > 0) {
    persistedProjectExpansionByCwd.set(workspaceRoot, expanded);
  }
  let changed = false;
  const projects = state.projects.map((p) => {
    const matchesProject = p.id === projectId || (workspaceRoot !== undefined && p.cwd === workspaceRoot);
    if (!matchesProject || p.expanded === expanded) return p;
    changed = true;
    return { ...p, expanded };
  });
  return changed ? { ...state, projects } : state;
}

export function reorderProjects(
  state: AppState,
  draggedProjectId: Project["id"],
  targetProjectId: Project["id"],
): AppState {
  if (draggedProjectId === targetProjectId) return state;
  const draggedIndex = state.projects.findIndex((project) => project.id === draggedProjectId);
  const targetIndex = state.projects.findIndex((project) => project.id === targetProjectId);
  if (draggedIndex < 0 || targetIndex < 0) return state;
  const projects = [...state.projects];
  const [draggedProject] = projects.splice(draggedIndex, 1);
  if (!draggedProject) return state;
  projects.splice(targetIndex, 0, draggedProject);
  return { ...state, projects };
}

export function reorderThreads(
  state: AppState,
  draggedThreadId: Thread["id"],
  targetThreadId: Thread["id"],
): AppState {
  if (draggedThreadId === targetThreadId) return state;
  const draggedThread = state.threads.find((thread) => thread.id === draggedThreadId);
  const targetThread = state.threads.find((thread) => thread.id === targetThreadId);
  if (!draggedThread || !targetThread || draggedThread.projectId !== targetThread.projectId) {
    return state;
  }
  const projectThreads = state.threads.filter((thread) => thread.projectId === draggedThread.projectId);
  const draggedIndex = projectThreads.findIndex((thread) => thread.id === draggedThreadId);
  const targetIndex = projectThreads.findIndex((thread) => thread.id === targetThreadId);
  if (draggedIndex < 0 || targetIndex < 0) return state;
  const reorderedProjectThreads = [...projectThreads];
  const [movedThread] = reorderedProjectThreads.splice(draggedIndex, 1);
  if (!movedThread) return state;
  reorderedProjectThreads.splice(targetIndex, 0, movedThread);

  let projectThreadIndex = 0;
  const threads = state.threads.map((thread) => {
    if (thread.projectId !== draggedThread.projectId) {
      return thread;
    }
    const nextThread = reorderedProjectThreads[projectThreadIndex];
    projectThreadIndex += 1;
    return nextThread ?? thread;
  });
  return { ...state, threads };
}

export function moveThreadToProject(
  state: AppState,
  threadId: Thread["id"],
  targetProjectId: Project["id"],
  targetThreadId?: Thread["id"],
): AppState {
  const movedThread = state.threads.find((thread) => thread.id === threadId);
  if (!movedThread) {
    return state;
  }
  if (!state.projects.some((project) => project.id === targetProjectId)) {
    return state;
  }
  const targetThread =
    targetThreadId !== undefined
      ? state.threads.find((thread) => thread.id === targetThreadId)
      : undefined;
  if (targetThreadId !== undefined && (!targetThread || targetThread.projectId !== targetProjectId)) {
    return state;
  }
  if (movedThread.projectId === targetProjectId && targetThreadId === undefined) {
    return state;
  }

  const nextMovedThread =
    movedThread.projectId === targetProjectId ? movedThread : { ...movedThread, projectId: targetProjectId };
  const remainingThreads = state.threads.filter((thread) => thread.id !== threadId);

  let insertionIndex = remainingThreads.length;
  if (targetThread) {
    insertionIndex = remainingThreads.findIndex((thread) => thread.id === targetThread.id);
    if (insertionIndex < 0) {
      insertionIndex = remainingThreads.length;
    }
  } else {
    const lastTargetProjectIndex = [...remainingThreads].reduce(
      (lastIndex, thread, index) => (thread.projectId === targetProjectId ? index : lastIndex),
      -1,
    );
    if (lastTargetProjectIndex >= 0) {
      insertionIndex = lastTargetProjectIndex + 1;
    } else {
      const projectOrder = new Map(state.projects.map((project, index) => [project.id, index] as const));
      const targetProjectOrder = projectOrder.get(targetProjectId) ?? Number.MAX_SAFE_INTEGER;
      const nextProjectIndex = remainingThreads.findIndex((thread) => {
        const threadProjectOrder = projectOrder.get(thread.projectId) ?? Number.MAX_SAFE_INTEGER;
        return threadProjectOrder > targetProjectOrder;
      });
      insertionIndex = nextProjectIndex >= 0 ? nextProjectIndex : remainingThreads.length;
    }
  }

  const threads = [...remainingThreads];
  threads.splice(insertionIndex, 0, nextMovedThread);
  const reconciledProjectLeaderThreadIdByProjectId = reconcileProjectLeaderThreadIds({
    projectLeaderThreadIdByProjectId: state.projectLeaderThreadIdByProjectId,
    projects: state.projects,
    threads,
  });
  const wasSourceLeader = state.projectLeaderThreadIdByProjectId[movedThread.projectId] === threadId;
  const projectLeaderThreadIdByProjectId = wasSourceLeader
    ? {
        ...reconciledProjectLeaderThreadIdByProjectId,
        [targetProjectId]: threadId,
      }
    : reconciledProjectLeaderThreadIdByProjectId;
  if (wasSourceLeader) {
    delete projectLeaderThreadIdByProjectId[movedThread.projectId];
  }
  return { ...state, threads, projectLeaderThreadIdByProjectId };
}

export function setThreadCustomIndicator(
  state: AppState,
  threadId: ThreadId,
  customIndicator: OrchestrationCustomIndicator | null,
): AppState {
  const threads = updateThread(state.threads, threadId, (thread) => {
    if ((thread.customIndicator ?? null) === customIndicator) {
      return thread;
    }
    return { ...thread, customIndicator };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function setProjectCustomIndicator(
  state: AppState,
  projectId: Project["id"],
  customIndicator: OrchestrationCustomIndicator | null,
): AppState {
  let changed = false;
  const projects = state.projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }
    if ((project.customIndicator ?? null) === customIndicator) {
      return project;
    }
    changed = true;
    return { ...project, customIndicator };
  });
  return changed ? { ...state, projects } : state;
}

export function removeThread(state: AppState, threadId: Thread["id"]): AppState {
  const threads = state.threads.filter((thread) => thread.id !== threadId);
  if (threads.length === state.threads.length) {
    return state;
  }
  return {
    ...state,
    threads,
    projectLeaderThreadIdByProjectId: reconcileProjectLeaderThreadIds({
      projectLeaderThreadIdByProjectId: state.projectLeaderThreadIdByProjectId,
      projects: state.projects,
      threads,
    }),
  };
}

export function setProjectLeaderThread(
  state: AppState,
  projectId: Project["id"],
  threadId: ThreadId | null,
): AppState {
  const currentLeaderThreadId = state.projectLeaderThreadIdByProjectId[projectId] ?? null;
  if (threadId === null) {
    if (currentLeaderThreadId === null) {
      return state;
    }
    const { [projectId]: _removed, ...restProjectLeaderThreadIdByProjectId } =
      state.projectLeaderThreadIdByProjectId;
    return { ...state, projectLeaderThreadIdByProjectId: restProjectLeaderThreadIdByProjectId };
  }

  const thread = state.threads.find((entry) => entry.id === threadId);
  if (!thread || thread.projectId !== projectId || currentLeaderThreadId === threadId) {
    return state;
  }

  return {
    ...state,
    projectLeaderThreadIdByProjectId: {
      ...state.projectLeaderThreadIdByProjectId,
      [projectId]: threadId,
    },
  };
}

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.error === error) return t;
    return { ...t, error };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function setThreadBranch(
  state: AppState,
  threadId: ThreadId,
  branch: string | null,
  worktreePath: string | null,
): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.branch === branch && t.worktreePath === worktreePath) return t;
    const cwdChanged = t.worktreePath !== worktreePath;
    return {
      ...t,
      branch,
      worktreePath,
      ...(cwdChanged ? { session: null } : {}),
    };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function createSidebarFolder(
  state: AppState,
  parentId: SidebarTreeNodeId | null,
  title = "New folder",
): { nodeId: SidebarTreeNodeId; state: AppState } {
  const result = createSidebarTreeContainer(state.sidebarTree, {
    kind: "folder",
    parentId,
    title,
  });
  return {
    nodeId: result.nodeId,
    state: {
      ...state,
      sidebarTree: result.state,
    },
  };
}

export function createSidebarVirtualProject(
  state: AppState,
  parentId: SidebarTreeNodeId | null,
  title = "New project",
): { nodeId: SidebarTreeNodeId; state: AppState } {
  const result = createSidebarTreeContainer(state.sidebarTree, {
    kind: "virtualProject",
    parentId,
    title,
  });
  return {
    nodeId: result.nodeId,
    state: {
      ...state,
      sidebarTree: setSidebarTreeNodeIcon(result.state, result.nodeId, "\u{1F4C1}"),
    },
  };
}

export function renameSidebarNode(
  state: AppState,
  nodeId: SidebarTreeNodeId,
  title: string,
): AppState {
  return {
    ...state,
    sidebarTree: renameSidebarTreeNode(state.sidebarTree, nodeId, title),
  };
}

export function bindSidebarNodeToRuntimeProject(
  state: AppState,
  nodeId: SidebarTreeNodeId,
  runtimeProjectId: Project["id"] | null,
): AppState {
  if (runtimeProjectId) {
    dismissedRuntimeProjectIds.delete(runtimeProjectId);
  }
  const nextSidebarTree = setSidebarTreeNodeRuntimeProjectId(state.sidebarTree, nodeId, runtimeProjectId);
  return {
    ...state,
    sidebarTree:
      runtimeProjectId === null
        ? setSidebarTreeNodeLoopBindingInTree(nextSidebarTree, nodeId, null)
        : nextSidebarTree,
  };
}

export function setSidebarNodeWorkspaceOverride(
  state: AppState,
  nodeId: SidebarTreeNodeId,
  workspaceOverride: string | null,
): AppState {
  return {
    ...state,
    sidebarTree: setSidebarTreeNodeWorkspaceOverride(state.sidebarTree, nodeId, workspaceOverride),
  };
}

export function setSidebarNodeIcon(
  state: AppState,
  nodeId: SidebarTreeNodeId,
  icon: string | null,
): AppState {
  return {
    ...state,
    sidebarTree: setSidebarTreeNodeIcon(state.sidebarTree, nodeId, icon),
  };
}

export function setSidebarNodeAccent(
  state: AppState,
  nodeId: SidebarTreeNodeId,
  accent: SidebarNodeAccent | null,
): AppState {
  return {
    ...state,
    sidebarTree: setSidebarTreeNodeAccent(state.sidebarTree, nodeId, accent),
  };
}

export function setSidebarNodeLoopBinding(
  state: AppState,
  nodeId: SidebarTreeNodeId,
  loopBinding: SidebarTreeContainerMetadata["loopBinding"],
): AppState {
  return {
    ...state,
    sidebarTree: setSidebarTreeNodeLoopBindingInTree(state.sidebarTree, nodeId, loopBinding),
  };
}

export function toggleSidebarNodeExpanded(
  state: AppState,
  nodeId: SidebarTreeNodeId,
): AppState {
  return {
    ...state,
    sidebarTree: toggleSidebarTreeNodeExpanded(state.sidebarTree, nodeId),
  };
}

export function deleteSidebarNode(state: AppState, nodeId: SidebarTreeNodeId): AppState {
  rememberDismissedRuntimeProjects(state.sidebarTree, nodeId);
  return {
    ...state,
    sidebarTree: deleteSidebarTreeNode(state.sidebarTree, nodeId),
  };
}

export function moveSidebarNode(
  state: AppState,
  draggedNodeId: SidebarTreeNodeId,
  overNodeId: SidebarTreeNodeId,
): AppState {
  return {
    ...state,
    sidebarTree: moveSidebarTreeNode(state.sidebarTree, draggedNodeId, overNodeId),
  };
}

// ── Zustand store ────────────────────────────────────────────────────

interface AppStore extends AppState {
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId) => void;
  createSidebarFolder: (parentId: SidebarTreeNodeId | null, title?: string) => SidebarTreeNodeId;
  createSidebarVirtualProject: (
    parentId: SidebarTreeNodeId | null,
    title?: string,
  ) => SidebarTreeNodeId;
  renameSidebarNode: (nodeId: SidebarTreeNodeId, title: string) => void;
  bindSidebarNodeToRuntimeProject: (
    nodeId: SidebarTreeNodeId,
    runtimeProjectId: Project["id"] | null,
  ) => void;
  setSidebarNodeWorkspaceOverride: (
    nodeId: SidebarTreeNodeId,
    workspaceOverride: string | null,
  ) => void;
  setSidebarNodeIcon: (nodeId: SidebarTreeNodeId, icon: string | null) => void;
  setSidebarNodeAccent: (nodeId: SidebarTreeNodeId, accent: SidebarNodeAccent | null) => void;
  setSidebarNodeLoopBinding: (
    nodeId: SidebarTreeNodeId,
    loopBinding: SidebarTreeContainerMetadata["loopBinding"],
  ) => void;
  toggleSidebarNodeExpanded: (nodeId: SidebarTreeNodeId) => void;
  deleteSidebarNode: (nodeId: SidebarTreeNodeId) => void;
  moveSidebarNode: (draggedNodeId: SidebarTreeNodeId, overNodeId: SidebarTreeNodeId) => void;
  toggleProject: (projectId: Project["id"]) => void;
  setProjectExpanded: (projectId: Project["id"], expanded: boolean, workspaceRoot?: string) => void;
  reorderProjects: (draggedProjectId: Project["id"], targetProjectId: Project["id"]) => void;
  reorderThreads: (draggedThreadId: Thread["id"], targetThreadId: Thread["id"]) => void;
  moveThreadToProject: (
    threadId: Thread["id"],
    targetProjectId: Project["id"],
    targetThreadId?: Thread["id"],
  ) => void;
  setProjectLeaderThread: (projectId: Project["id"], threadId: ThreadId | null) => void;
  setThreadCustomIndicator: (
    threadId: ThreadId,
    customIndicator: OrchestrationCustomIndicator | null,
  ) => void;
  setProjectCustomIndicator: (
    projectId: Project["id"],
    customIndicator: OrchestrationCustomIndicator | null,
  ) => void;
  removeThread: (threadId: Thread["id"]) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadBranch: (threadId: ThreadId, branch: string | null, worktreePath: string | null) => void;
}

export const useStore = create<AppStore>((set) => {
  const setAndPersistImmediately = (recipe: (state: AppState) => AppState) =>
    set((state) => {
      const nextState = recipe(state);
      debouncedPersistState.cancel();
      persistState(nextState);
      return nextState;
    });

  return ({
  ...readPersistedState(),
  syncServerReadModel: (readModel) => set((state) => syncServerReadModel(state, readModel)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId) => set((state) => markThreadUnread(state, threadId)),
  createSidebarFolder: (parentId, title) => {
    const result = createSidebarFolder(useStore.getState(), parentId, title);
    set(result.state);
    debouncedPersistState.cancel();
    persistState(result.state);
    return result.nodeId;
  },
  createSidebarVirtualProject: (parentId, title) => {
    const result = createSidebarVirtualProject(useStore.getState(), parentId, title);
    set(result.state);
    debouncedPersistState.cancel();
    persistState(result.state);
    return result.nodeId;
  },
  renameSidebarNode: (nodeId, title) =>
    setAndPersistImmediately((state) => renameSidebarNode(state, nodeId, title)),
  bindSidebarNodeToRuntimeProject: (nodeId, runtimeProjectId) =>
    setAndPersistImmediately((state) => bindSidebarNodeToRuntimeProject(state, nodeId, runtimeProjectId)),
  setSidebarNodeWorkspaceOverride: (nodeId, workspaceOverride) =>
    setAndPersistImmediately((state) => setSidebarNodeWorkspaceOverride(state, nodeId, workspaceOverride)),
  setSidebarNodeIcon: (nodeId, icon) =>
    setAndPersistImmediately((state) => setSidebarNodeIcon(state, nodeId, icon)),
  setSidebarNodeAccent: (nodeId, accent) =>
    setAndPersistImmediately((state) => setSidebarNodeAccent(state, nodeId, accent)),
  setSidebarNodeLoopBinding: (nodeId, loopBinding) =>
    setAndPersistImmediately((state) => setSidebarNodeLoopBinding(state, nodeId, loopBinding)),
  toggleSidebarNodeExpanded: (nodeId) =>
    setAndPersistImmediately((state) => toggleSidebarNodeExpanded(state, nodeId)),
  deleteSidebarNode: (nodeId) => setAndPersistImmediately((state) => deleteSidebarNode(state, nodeId)),
  moveSidebarNode: (draggedNodeId, overNodeId) =>
    setAndPersistImmediately((state) => moveSidebarNode(state, draggedNodeId, overNodeId)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded, workspaceRoot) =>
    set((state) => setProjectExpanded(state, projectId, expanded, workspaceRoot)),
  reorderProjects: (draggedProjectId, targetProjectId) =>
    set((state) => reorderProjects(state, draggedProjectId, targetProjectId)),
  reorderThreads: (draggedThreadId, targetThreadId) =>
    set((state) => reorderThreads(state, draggedThreadId, targetThreadId)),
  moveThreadToProject: (threadId, targetProjectId, targetThreadId) =>
    set((state) => moveThreadToProject(state, threadId, targetProjectId, targetThreadId)),
  setProjectLeaderThread: (projectId, threadId) =>
    set((state) => setProjectLeaderThread(state, projectId, threadId)),
  setThreadCustomIndicator: (threadId, customIndicator) =>
    set((state) => setThreadCustomIndicator(state, threadId, customIndicator)),
  setProjectCustomIndicator: (projectId, customIndicator) =>
    set((state) => setProjectCustomIndicator(state, projectId, customIndicator)),
  removeThread: (threadId) => set((state) => removeThread(state, threadId)),
  setError: (threadId, error) => set((state) => setError(state, threadId, error)),
  setThreadBranch: (threadId, branch, worktreePath) =>
    set((state) => setThreadBranch(state, threadId, branch, worktreePath)),
  });
});

// Persist state changes with debouncing to avoid localStorage thrashing
useStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

// Flush pending writes synchronously before page unload to prevent data loss.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}

export function StoreProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    persistState(useStore.getState());
  }, []);
  return createElement(Fragment, null, children);
}
