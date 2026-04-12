import type { Project } from "./types";
import type { SidebarTreeNode, SidebarTreeNodeId, SidebarTreeState } from "./types";
import { isSidebarTreeContainerNode } from "./sidebarTree";

export function resolveSidebarNodeRuntimeProjectId(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId | null,
): Project["id"] | null {
  if (nodeId === null) {
    return null;
  }
  const node = state.nodesById[nodeId];
  if (!node) {
    return null;
  }
  if (node.kind === "runtimeProject") {
    return node.projectId;
  }
  return node.runtimeProjectId ?? null;
}

export function resolveSidebarNodeWorkspaceRoot(
  state: SidebarTreeState,
  nodeId: SidebarTreeNodeId | null,
  defaultWorkspaceRoot: string,
): string {
  let current = nodeId ? state.nodesById[nodeId] : undefined;
  while (current) {
    if (isSidebarTreeContainerNode(current)) {
      const override = current.workspaceOverride?.trim();
      if (override) {
        return override;
      }
    }
    current = current.parentId ? state.nodesById[current.parentId] : undefined;
  }
  return defaultWorkspaceRoot.trim();
}

export function resolveSidebarContainerDisplayTitle(
  node: Extract<SidebarTreeNode, { kind: "folder" | "virtualProject" }>,
  runtimeProject: Project | null,
): string {
  return node.title.trim() || runtimeProject?.name || "Untitled project";
}
