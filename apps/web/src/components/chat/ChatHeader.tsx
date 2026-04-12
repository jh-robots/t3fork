import {
  type EditorId,
  type ProjectId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { memo, useEffect, useMemo, useState } from "react";
import GitActionsControl from "../GitActionsControl";
import { DiffIcon, Maximize2Icon, Minimize2Icon, TerminalSquareIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { OpenInPicker } from "./OpenInPicker";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { sortThreadsForSidebar } from "../Sidebar.logic";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useAppSettings } from "~/appSettings";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useStore } from "~/store";

interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectId: ProjectId | undefined;
  activeProjectName: string | undefined;
  mobileFullscreenViewportEnabled: boolean;
  streamlinedHeaderActions: boolean;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProjectId,
  activeProjectName,
  mobileFullscreenViewportEnabled,
  streamlinedHeaderActions,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
}: ChatHeaderProps) {
  const navigate = useNavigate();
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const { settings: appSettings } = useAppSettings();
  const { handleNewThread } = useHandleNewThread();
  const isTouchLayout = useMediaQuery({ pointer: "coarse" });
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== "undefined" && document.fullscreenElement !== null,
  );
  const shouldShowProjectSwitcher = projects.length > 1;
  const fullscreenSupported =
    typeof document !== "undefined" &&
    typeof document.documentElement.requestFullscreen === "function" &&
    typeof document.exitFullscreen === "function";
  const showMobileFullscreenToggle =
    mobileFullscreenViewportEnabled && isTouchLayout && fullscreenSupported;

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const syncFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement !== null);
    };

    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, []);

  const handleProjectChange = (nextProjectId: string | null) => {
    if (!nextProjectId || nextProjectId === activeProjectId) {
      return;
    }
    const existingDraftThread = getDraftThreadByProjectId(nextProjectId as ProjectId);
    if (existingDraftThread) {
      void navigate({
        to: "/$threadId",
        params: { threadId: existingDraftThread.threadId },
      });
      return;
    }
    const nextThread = sortThreadsForSidebar(
      threads.filter((thread) => thread.projectId === nextProjectId),
      appSettings.sidebarThreadSortOrder,
    )[0];
    if (nextThread) {
      void navigate({
        to: "/$threadId",
        params: { threadId: nextThread.id },
      });
      return;
    }
    void handleNewThread(nextProjectId as ProjectId, {
      envMode: appSettings.defaultThreadEnvMode,
    });
  };

  const handleToggleFullscreen = (_pressed: boolean) => {
    if (!showMobileFullscreenToggle || typeof document === "undefined") {
      return;
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }

    void document.documentElement.requestFullscreen().catch(() => {});
  };

  return (
    <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-2 overflow-hidden sm:items-center sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
          <h2
            className="min-w-0 shrink truncate text-sm font-medium text-foreground"
            title={activeThreadTitle}
          >
            {activeThreadTitle}
          </h2>
          {activeProjectId && shouldShowProjectSwitcher ? (
            <div className="flex min-w-0">
              <Select value={activeProjectId} onValueChange={handleProjectChange}>
                <SelectTrigger
                  size="xs"
                  aria-label="Switch project"
                  className="h-7 min-w-0 max-w-full rounded-full border-border/70 bg-muted/35 pr-2"
                >
                  <SelectValue>{activeProjectName ?? "Project"}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="start" alignItemWithTrigger={false}>
                  {projects.map((project) => (
                    <SelectItem hideIndicator key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : activeProjectName ? (
            <div className="flex min-w-0 items-center gap-2">
              <Badge
                variant="outline"
                className="min-w-0 max-w-full truncate rounded-full border-border/70 bg-muted/35"
              >
                {activeProjectName}
              </Badge>
              {!isGitRepo && (
                <Badge
                  variant="outline"
                  className="shrink-0 rounded-full border-amber-300/70 bg-amber-50 text-[10px] text-amber-700"
                >
                  No Git
                </Badge>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className="@container/header-actions flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 @sm/header-actions:gap-3">
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {!streamlinedHeaderActions && activeProjectName && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {!streamlinedHeaderActions && activeProjectName && (
          <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} />
        )}
        {activeProjectName && !isGitRepo && (
          <Badge
            variant="outline"
            className="hidden shrink-0 rounded-full border-amber-300/70 bg-amber-50 text-[10px] text-amber-700 sm:inline-flex"
          >
            No Git
          </Badge>
        )}
        {showMobileFullscreenToggle && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={isFullscreen}
                  onPressedChange={handleToggleFullscreen}
                  aria-label={isFullscreen ? "Exit fullscreen mode" : "Enter fullscreen mode"}
                  variant="outline"
                  size="xs"
                >
                  {isFullscreen ? (
                    <Minimize2Icon className="size-3" />
                  ) : (
                    <Maximize2Icon className="size-3" />
                  )}
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {isFullscreen ? "Exit fullscreen mode" : "Enter fullscreen mode"}
            </TooltipPopup>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                variant="outline"
                size="xs"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!terminalAvailable
              ? "Terminal is unavailable until this thread has an active project."
              : terminalToggleShortcutLabel
                ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                : "Toggle terminal drawer"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});
