import type { ProjectId } from "@t3tools/contracts";
import type {
  Project,
  SidebarTreeContainerMetadata,
  SidebarNodeAccent,
  SidebarFolderNode,
  SidebarTreeNode,
  SidebarTreeNodeId,
  SidebarTreeState,
  SidebarVirtualProjectNode,
} from "./types";

export interface FlattenedSidebarTreeNode {
  depth: number;
  node: SidebarTreeNode;
}

type SidebarTreeContainerNode = SidebarFolderNode | SidebarVirtualProjectNode;
type SidebarTreeCreatableKind = SidebarTreeContainerNode["kind"];
const DEFAULT_FOLDER_ICON = "\u{1F4C1}";

export function createEmptySidebarTree(): SidebarTreeState {
  return {
    rootIds: [],
    nodesById: {},
  };
}

export function createSidebarTreeNodeId(): SidebarTreeNodeId {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `sidebar-node:${crypto.randomUUID()}`;
  }
  return `sidebar-node:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export function runtimeSidebarNodeId(projectId: ProjectId): SidebarTreeNodeId {
  return `runtime-project:${projectId}`;
}

export function isSidebarTreeContainerNode(node: SidebarTreeNode): node is SidebarTreeContainerNode {
  return node.kind === "folder" || node.kind === "virtualProject";
}

export function getSidebarTreeNodeChildrenIds(node: SidebarTreeNode): SidebarTreeNodeId[] {
  return isSidebarTreeContainerNode(node) ? node.childrenIds : [];
}

function updateSidebarTreeContainerNode(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
  updater: (node: SidebarTreeContainerNode) => SidebarTreeContainerNode,
): SidebarTreeState {
  const node = state.nodesById[nodeId];
  if (!node || !isSidebarTreeContainerNode(node)) {
    return state;
  }
  const nextNode = updater(node);
  if (nextNode === node) {
    return state;
  }
  return upsertSidebarTreeNode(state, nextNode);
}

function upsertSidebarTreeNode(
  state: SidebarTreeState,
  node: SidebarTreeNode,
): SidebarTreeState {
  return {
    ...state,
    nodesById: {
      ...state.nodesById,
      [node.id]: node,
    },
  };
}


function listSidebarTreeNodeIds(state: SidebarTreeState): SidebarTreeNodeId[] {
  const orderedIds: SidebarTreeNodeId[] = [];
  const seen = new Set<SidebarTreeNodeId>();

  const visit = (nodeId: SidebarTreeNodeId) => {
    if (seen.has(nodeId)) {
      return;
    }
    seen.add(nodeId);
    orderedIds.push(nodeId);
    const node = state.nodesById[nodeId];
    if (!node) {
      return;
    }
    for (const childId of getSidebarTreeNodeChildrenIds(node)) {
      visit(childId);
    }
  };

  for (const rootId of state.rootIds) {
    visit(rootId);
  }

  return orderedIds;
}

function updateSidebarTreeContainerChildren(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
  updater: (childrenIds: SidebarTreeNodeId[]) => SidebarTreeNodeId[],
): SidebarTreeState {
  const node = state.nodesById[nodeId];
  if (!node || !isSidebarTreeContainerNode(node)) {
    return state;
  }
  const nextChildrenIds = updater(node.childrenIds);
  if (nextChildrenIds === node.childrenIds) {
    return state;
  }
  return upsertSidebarTreeNode(state, {
    ...node,
    childrenIds: nextChildrenIds,
    updatedAt: new Date().toISOString(),
  });
}

function removeIdFromList(list: SidebarTreeNodeId[], nodeId: SidebarTreeNodeId): SidebarTreeNodeId[] {
  const next = list.filter((entry) => entry !== nodeId);
  return next.length === list.length ? list : next;
}

function insertIdAtIndex(
  list: SidebarTreeNodeId[],
  nodeId: SidebarTreeNodeId,
  index?: number,
): SidebarTreeNodeId[] {
  const withoutNode = removeIdFromList(list, nodeId);
  const resolvedIndex =
    index === undefined ? withoutNode.length : Math.max(0, Math.min(index, withoutNode.length));
  const next = [...withoutNode];
  next.splice(resolvedIndex, 0, nodeId);
  return next;
}

function detachSidebarTreeNode(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
): SidebarTreeState {
  const node = state.nodesById[nodeId];
  if (!node) {
    return state;
  }
  if (node.parentId === null) {
    const nextRootIds = removeIdFromList(state.rootIds, nodeId);
    return nextRootIds === state.rootIds ? state : { ...state, rootIds: nextRootIds };
  }
  return updateSidebarTreeContainerChildren(state, node.parentId, (childrenIds) =>
    removeIdFromList(childrenIds, nodeId),
  );
}

function attachSidebarTreeNode(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
  parentId: SidebarTreeNodeId | null,
  index?: number,
): SidebarTreeState {
  const node = state.nodesById[nodeId];
  if (!node) {
    return state;
  }
  const nextNode: SidebarTreeNode =
    node.parentId === parentId ? node : { ...node, parentId, updatedAt: new Date().toISOString() };
  const stateWithParent = upsertSidebarTreeNode(state, nextNode);
  if (parentId === null) {
    return {
      ...stateWithParent,
      rootIds: insertIdAtIndex(stateWithParent.rootIds, nodeId, index),
    };
  }
  return updateSidebarTreeContainerChildren(stateWithParent, parentId, (childrenIds) =>
    insertIdAtIndex(childrenIds, nodeId, index),
  );
}

export function createSidebarTreeContainer(
  state: SidebarTreeState,
  input: {
    kind: SidebarTreeCreatableKind;
    title: string;
    parentId: SidebarTreeNodeId | null;
    index?: number;
    nodeId?: SidebarTreeNodeId;
    createdAt?: string;
  },
): { nodeId: SidebarTreeNodeId; state: SidebarTreeState } {
  const timestamp = input.createdAt ?? new Date().toISOString();
  const nodeId = input.nodeId ?? createSidebarTreeNodeId();
  const node: SidebarTreeContainerNode =
    input.kind === "folder"
      ? {
          id: nodeId,
          kind: "folder",
          title: input.title,
          parentId: input.parentId,
          expanded: true,
          childrenIds: [],
          runtimeProjectId: null,
          workspaceOverride: null,
          icon: null,
          accent: null,
            loopBinding: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      : {
          id: nodeId,
          kind: "virtualProject",
          title: input.title,
          parentId: input.parentId,
          expanded: true,
          childrenIds: [],
          runtimeProjectId: null,
          workspaceOverride: null,
          icon: null,
          accent: null,
          loopBinding: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
  const withNode = upsertSidebarTreeNode(state, node);
  const withExpandedParent =
    input.parentId !== null &&
    withNode.nodesById[input.parentId] &&
    isSidebarTreeContainerNode(withNode.nodesById[input.parentId]!)
      ? upsertSidebarTreeNode(withNode, {
          ...withNode.nodesById[input.parentId]!,
          expanded: true,
          updatedAt: timestamp,
        } as SidebarTreeContainerNode)
      : withNode;
  return {
    nodeId,
    state: attachSidebarTreeNode(withExpandedParent, nodeId, input.parentId, input.index),
  };
}

export function renameSidebarTreeNode(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
  title: string,
): SidebarTreeState {
  const node = state.nodesById[nodeId];
  if (!node || node.kind === "runtimeProject" || node.title === title) {
    return state;
  }
  return upsertSidebarTreeNode(state, {
    ...node,
    title,
    updatedAt: new Date().toISOString(),
  });
}

export function setSidebarTreeNodeRuntimeProjectId(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
  runtimeProjectId: Project["id"] | null,
): SidebarTreeState {
  let nextState = state;

  if (runtimeProjectId !== null) {
    for (const otherNodeId of listSidebarTreeNodeIds(state)) {
      if (otherNodeId === nodeId) {
        continue;
      }
      const otherNode = nextState.nodesById[otherNodeId];
      if (!otherNode || !isSidebarTreeContainerNode(otherNode)) {
        continue;
      }
      if (otherNode.runtimeProjectId !== runtimeProjectId) {
        continue;
      }
      nextState = updateSidebarTreeContainerNode(nextState, otherNodeId, (node) => ({
        ...node,
        runtimeProjectId: null,
        updatedAt: new Date().toISOString(),
      }));
    }
  }

  return updateSidebarTreeContainerNode(nextState, nodeId, (node) => {
    if ((node.runtimeProjectId ?? null) === runtimeProjectId) {
      return node;
    }
    return {
      ...node,
      runtimeProjectId,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function setSidebarTreeNodeWorkspaceOverride(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
  workspaceOverride: string | null,
): SidebarTreeState {
  return updateSidebarTreeContainerNode(state, nodeId, (node) => {
    if ((node.workspaceOverride ?? null) === workspaceOverride) {
      return node;
    }
    return {
      ...node,
      workspaceOverride,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function setSidebarTreeNodeIcon(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
  icon: string | null,
): SidebarTreeState {
  return updateSidebarTreeContainerNode(state, nodeId, (node) => {
    if ((node.icon ?? null) === icon) {
      return node;
    }
    return {
      ...node,
      icon,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function setSidebarTreeNodeAccent(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
  accent: SidebarNodeAccent | null,
): SidebarTreeState {
  return updateSidebarTreeContainerNode(state, nodeId, (node) => {
    if ((node.accent ?? null) === accent) {
      return node;
    }
    return {
      ...node,
      accent,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function setSidebarTreeNodeLoopBinding(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
  loopBinding: SidebarTreeContainerMetadata["loopBinding"],
): SidebarTreeState {
  return updateSidebarTreeContainerNode(state, nodeId, (node) => {
    if ((node.loopBinding ?? null) === (loopBinding ?? null)) {
      return node;
    }
    return {
      ...node,
      loopBinding: loopBinding ?? null,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function toggleSidebarTreeNodeExpanded(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
): SidebarTreeState {
  const node = state.nodesById[nodeId];
  if (!node) {
    return state;
  }
  return upsertSidebarTreeNode(state, {
    ...node,
    expanded: !node.expanded,
    updatedAt: new Date().toISOString(),
  });
}

function collectSidebarTreeSubtreeIds(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
  acc: Set<SidebarTreeNodeId>,
): void {
  const node = state.nodesById[nodeId];
  if (!node || acc.has(nodeId)) {
    return;
  }
  acc.add(nodeId);
  for (const childId of getSidebarTreeNodeChildrenIds(node)) {
    collectSidebarTreeSubtreeIds(state, childId, acc);
  }
}

export function deleteSidebarTreeNode(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
): SidebarTreeState {
  const node = state.nodesById[nodeId];
  if (!node) {
    return state;
  }
  const subtreeIds = new Set<SidebarTreeNodeId>();
  collectSidebarTreeSubtreeIds(state, nodeId, subtreeIds);
  const detachedState = detachSidebarTreeNode(state, nodeId);
  const nextNodesById = { ...detachedState.nodesById };
  for (const subtreeId of subtreeIds) {
    delete nextNodesById[subtreeId];
  }
  return {
    ...detachedState,
    nodesById: nextNodesById,
  };
}

export function isSidebarTreeDescendantOf(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId,
  potentialAncestorId: SidebarTreeNodeId,
): boolean {
  let current = state.nodesById[nodeId];
  while (current?.parentId) {
    if (current.parentId === potentialAncestorId) {
      return true;
    }
    current = state.nodesById[current.parentId];
  }
  return false;
}

export function moveSidebarTreeNode(
  state: SidebarTreeState,
  draggedNodeId: SidebarTreeNodeId,
  overNodeId: SidebarTreeNodeId,
): SidebarTreeState {
  if (draggedNodeId === overNodeId) {
    return state;
  }
  const draggedNode = state.nodesById[draggedNodeId];
  const overNode = state.nodesById[overNodeId];
  if (!draggedNode || !overNode) {
    return state;
  }
  if (isSidebarTreeDescendantOf(state, overNodeId, draggedNodeId)) {
    return state;
  }

  const overIsContainer = isSidebarTreeContainerNode(overNode);
  const nextParentId = overIsContainer ? overNode.id : overNode.parentId;
  if (nextParentId && isSidebarTreeDescendantOf(state, nextParentId, draggedNodeId)) {
    return state;
  }

  const detached = detachSidebarTreeNode(state, draggedNodeId);
  if (overIsContainer) {
    return attachSidebarTreeNode(detached, draggedNodeId, nextParentId, undefined);
  }

  if (nextParentId === null) {
    const overIndex = detached.rootIds.indexOf(overNodeId);
    return attachSidebarTreeNode(detached, draggedNodeId, null, overIndex + 1);
  }

  const parentNode = detached.nodesById[nextParentId];
  if (!parentNode || !isSidebarTreeContainerNode(parentNode)) {
    return detached;
  }
  const overIndex = parentNode.childrenIds.indexOf(overNodeId);
  return attachSidebarTreeNode(detached, draggedNodeId, nextParentId, overIndex + 1);
}

export function flattenSidebarTree(state: SidebarTreeState): FlattenedSidebarTreeNode[] {
  const flattened: FlattenedSidebarTreeNode[] = [];

  const visit = (nodeId: SidebarTreeNodeId, depth: number) => {
    const node = state.nodesById[nodeId];
    if (!node) {
      return;
    }
    flattened.push({ depth, node });
    if (!node.expanded) {
      return;
    }
    for (const childId of getSidebarTreeNodeChildrenIds(node)) {
      visit(childId, depth + 1);
    }
  };

  for (const rootId of state.rootIds) {
    visit(rootId, 0);
  }

  return flattened;
}

export function findSidebarTreeContainerNodeByRuntimeProjectId(
  state: SidebarTreeState,
  runtimeProjectId: Project["id"],
): SidebarTreeContainerNode | null {
  for (const node of Object.values(state.nodesById)) {
    if (!isSidebarTreeContainerNode(node)) {
      continue;
    }
    if (node.runtimeProjectId === runtimeProjectId) {
      return node;
    }
  }
  return null;
}

export function resolveSidebarTreeWorkspaceOverride(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId | null,
): string | null {
  if (nodeId === null) {
    return null;
  }
  let current = state.nodesById[nodeId];
  while (current) {
    if (isSidebarTreeContainerNode(current) && current.workspaceOverride) {
      const trimmed = current.workspaceOverride.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    current = current.parentId ? state.nodesById[current.parentId] : undefined;
  }
  return null;
}

export function reconcileSidebarTreeRuntimeProjects(
  state: SidebarTreeState,
  projects: readonly Pick<Project, "id" | "name">[],
  dismissedRuntimeProjectIds: ReadonlySet<Project["id"]> = new Set(),
): SidebarTreeState {
  let nextState = state;
  const liveProjectIds = new Set(projects.map((project) => project.id));
  const liveProjectsById = new Map(projects.map((project) => [project.id, project] as const));
  const boundRuntimeProjectIds = new Set<Project["id"]>();

  for (const nodeId of listSidebarTreeNodeIds(nextState)) {
    const node = nextState.nodesById[nodeId];
    if (!node || !isSidebarTreeContainerNode(node)) {
      continue;
    }
    if (node.runtimeProjectId && !liveProjectIds.has(node.runtimeProjectId)) {
      nextState = setSidebarTreeNodeRuntimeProjectId(nextState, node.id, null);
      continue;
    }
    if (node.runtimeProjectId && boundRuntimeProjectIds.has(node.runtimeProjectId)) {
      nextState = setSidebarTreeNodeRuntimeProjectId(nextState, node.id, null);
      continue;
    }
    if (node.runtimeProjectId) {
      boundRuntimeProjectIds.add(node.runtimeProjectId);
    }
  }

  for (const node of Object.values(nextState.nodesById)) {
    if (node.kind !== "runtimeProject") {
      continue;
    }
    if (
      !liveProjectIds.has(node.projectId) ||
      boundRuntimeProjectIds.has(node.projectId) ||
      dismissedRuntimeProjectIds.has(node.projectId)
    ) {
      nextState = deleteSidebarTreeNode(nextState, node.id);
      continue;
    }

    const project = liveProjectsById.get(node.projectId);
    if (!project) {
      nextState = deleteSidebarTreeNode(nextState, node.id);
      continue;
    }

    // Older persisted runtime nodes may already carry user-facing sidebar metadata
    // from before they are promoted into managed virtual projects. Keep that data
    // so local title/icon/accent/workspace customizations survive refreshes.
    const persistedTitle = typeof (node as unknown as { title?: unknown }).title === "string"
      ? (node as unknown as { title: string }).title.trim()
      : "";
    const persistedWorkspaceOverride = (() => {
      const value = (node as unknown as { workspaceOverride?: unknown }).workspaceOverride;
      if (typeof value === "string") {
        return value;
      }
      return value === null ? null : null;
    })();
    const persistedIcon = (() => {
      const value = (node as unknown as { icon?: unknown }).icon;
      return typeof value === "string" ? value : value === null ? null : null;
    })();
    const persistedAccent: SidebarNodeAccent | null = (() => {
      const value = (node as unknown as { accent?: unknown }).accent;
      return typeof value === "string" ? (value as SidebarNodeAccent) : value === null ? null : null;
    })();
    const persistedLoopBinding = (() => {
      const value = (node as unknown as { loopBinding?: unknown }).loopBinding;
      return value && typeof value === "object" ? (value as SidebarTreeContainerMetadata["loopBinding"]) : null;
    })();
    const managedNode: SidebarVirtualProjectNode = {
      id: node.id,
      kind: "virtualProject",
      title: persistedTitle || project.name,
      parentId: node.parentId,
      expanded: node.expanded,
      childrenIds: [],
      runtimeProjectId: node.projectId,
      workspaceOverride: persistedWorkspaceOverride,
      icon: persistedIcon ?? DEFAULT_FOLDER_ICON,
      accent: persistedAccent,
      loopBinding: persistedLoopBinding ?? null,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };
    nextState = upsertSidebarTreeNode(nextState, managedNode);
    boundRuntimeProjectIds.add(node.projectId);
  }

  for (const project of projects) {
    if (boundRuntimeProjectIds.has(project.id) || dismissedRuntimeProjectIds.has(project.id)) {
      continue;
    }
    const nodeId = runtimeSidebarNodeId(project.id);
    if (nextState.nodesById[nodeId]) {
      continue;
    }
    const timestamp = new Date().toISOString();
    const node: SidebarVirtualProjectNode = {
      id: nodeId,
      kind: "virtualProject",
      title: project.name,
      parentId: null,
      expanded: true,
      childrenIds: [],
      runtimeProjectId: project.id,
      workspaceOverride: null,
      icon: DEFAULT_FOLDER_ICON,
      accent: null,
      loopBinding: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    nextState = upsertSidebarTreeNode(nextState, node);
    nextState = attachSidebarTreeNode(nextState, nodeId, null, undefined);
    boundRuntimeProjectIds.add(project.id);
  }

  return nextState;
}
