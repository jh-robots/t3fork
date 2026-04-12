import type {
  JhLoopBinding as ContractJhLoopBinding,
  OrchestrationLatestTurn,
  OrchestrationCustomIndicator,
  OrchestrationProposedPlanId,
  OrchestrationSessionStatus,
  OrchestrationThreadActivity,
  ProjectScript as ContractProjectScript,
  ThreadId,
  ProjectId,
  TurnId,
  MessageId,
  CheckpointRef,
  ProviderKind,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const DEFAULT_INTERACTION_MODE: ProviderInteractionMode = "default";
export const DEFAULT_THREAD_TERMINAL_HEIGHT = 280;
export const DEFAULT_THREAD_TERMINAL_ID = "default";
export const MAX_TERMINALS_PER_GROUP = 4;
export type ProjectScript = ContractProjectScript;

export interface ThreadTerminalGroup {
  id: string;
  terminalIds: string[];
}

export interface ChatImageAttachment {
  type: "image";
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string;
}

export type ChatAttachment = ChatImageAttachment;

export interface ChatMessage {
  id: MessageId;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ChatAttachment[];
  createdAt: string;
  completedAt?: string | undefined;
  streaming: boolean;
}

export interface ProposedPlan {
  id: OrchestrationProposedPlanId;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
  createdAt: string;
  updatedAt: string;
}

export interface TurnDiffFileChange {
  path: string;
  kind?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface TurnDiffSummary {
  turnId: TurnId;
  completedAt: string;
  status?: string | undefined;
  files: TurnDiffFileChange[];
  checkpointRef?: CheckpointRef | undefined;
  assistantMessageId?: MessageId | undefined;
  checkpointTurnCount?: number | undefined;
}

export interface Project {
  id: ProjectId;
  name: string;
  cwd: string;
  model: string;
  expanded: boolean;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  customIndicator?: OrchestrationCustomIndicator | null;
  scripts: ProjectScript[];
}

export type SidebarTreeNodeId = string;
export type SidebarNodeAccent =
  | "slate"
  | "blue"
  | "green"
  | "amber"
  | "rose"
  | "violet"
  | "cyan"
  | "neutral";

export interface SidebarTreeContainerMetadata {
  runtimeProjectId?: ProjectId | null;
  workspaceOverride?: string | null;
  icon?: string | null;
  accent?: SidebarNodeAccent | null;
  loopBinding?: ContractJhLoopBinding | null;
}

export interface SidebarTreeBaseNode {
  id: SidebarTreeNodeId;
  parentId: SidebarTreeNodeId | null;
  expanded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SidebarFolderNode extends SidebarTreeBaseNode {
  kind: "folder";
  title: string;
  childrenIds: SidebarTreeNodeId[];
  runtimeProjectId?: ProjectId | null;
  workspaceOverride?: string | null;
  icon?: string | null;
  accent?: SidebarNodeAccent | null;
  loopBinding?: ContractJhLoopBinding | null;
}

export interface SidebarVirtualProjectNode extends SidebarTreeBaseNode {
  kind: "virtualProject";
  title: string;
  childrenIds: SidebarTreeNodeId[];
  runtimeProjectId?: ProjectId | null;
  workspaceOverride?: string | null;
  icon?: string | null;
  accent?: SidebarNodeAccent | null;
  loopBinding?: ContractJhLoopBinding | null;
}

export interface SidebarRuntimeProjectNode extends SidebarTreeBaseNode {
  kind: "runtimeProject";
  projectId: ProjectId;
}

export type SidebarTreeNode =
  | SidebarFolderNode
  | SidebarVirtualProjectNode
  | SidebarRuntimeProjectNode;

export interface SidebarTreeState {
  rootIds: SidebarTreeNodeId[];
  nodesById: Record<SidebarTreeNodeId, SidebarTreeNode>;
}

export interface Thread {
  id: ThreadId;
  codexThreadId: string | null;
  projectId: ProjectId;
  title: string;
  model: string;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  session: ThreadSession | null;
  messages: ChatMessage[];
  proposedPlans: ProposedPlan[];
  error: string | null;
  createdAt: string;
  updatedAt?: string | undefined;
  latestTurn: OrchestrationLatestTurn | null;
  lastVisitedAt?: string | undefined;
  branch: string | null;
  worktreePath: string | null;
  customIndicator?: OrchestrationCustomIndicator | null;
  isDraft?: boolean | undefined;
  turnDiffSummaries: TurnDiffSummary[];
  activities: OrchestrationThreadActivity[];
}

export interface ThreadSession {
  provider: ProviderKind;
  status: SessionPhase | "error" | "closed";
  activeTurnId?: TurnId | undefined;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  orchestrationStatus: OrchestrationSessionStatus;
}
