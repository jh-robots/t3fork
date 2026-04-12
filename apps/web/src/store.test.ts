import {
  DEFAULT_MODEL_BY_PROVIDER,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  bindSidebarNodeToRuntimeProject,
  createSidebarVirtualProject,
  deleteSidebarNode,
  markThreadUnread,
  moveThreadToProject,
  readPersistedStateFromStorage,
  removeThread,
  reorderProjects,
  reorderThreads,
  setProjectCustomIndicator,
  setProjectLeaderThread,
  setThreadCustomIndicator,
  setSidebarNodeAccent,
  setSidebarNodeIcon,
  setProjectExpanded,
  setSidebarNodeWorkspaceOverride,
  syncServerReadModel,
  type AppState,
} from "./store";
import {
  createEmptySidebarTree,
  createSidebarTreeContainer,
  flattenSidebarTree,
  runtimeSidebarNodeId,
} from "./sidebarTree";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type SidebarTreeState,
  type Thread,
} from "./types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    customIndicator: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

function makeState(thread: Thread): AppState {
  return {
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        name: "Project",
        cwd: "/tmp/project",
        model: "gpt-5-codex",
        expanded: true,
        customIndicator: null,
        scripts: [],
      },
    ],
    threads: [thread],
    sidebarTree: createEmptySidebarTree(),
    projectLeaderThreadIdByProjectId: {},
    threadsHydrated: true,
  };
}

function makeReadModelThread(overrides: Partial<OrchestrationReadModel["threads"][number]>) {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5.3-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    customIndicator: null,
    latestTurn: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: null,
    ...overrides,
  } satisfies OrchestrationReadModel["threads"][number];
}

function makeReadModel(
  thread?: OrchestrationReadModel["threads"][number],
  overrides?: Partial<OrchestrationReadModel>,
): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-02-27T00:00:00.000Z",
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModel: "gpt-5.3-codex",
        customIndicator: null,
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
        deletedAt: null,
        scripts: [],
      },
    ],
    threads: thread ? [thread] : [],
    ...overrides,
  };
}

function makeReadModelProject(
  overrides: Partial<OrchestrationReadModel["projects"][number]>,
): OrchestrationReadModel["projects"][number] {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    title: "Project",
    workspaceRoot: "/tmp/project",
    defaultModel: "gpt-5.3-codex",
    customIndicator: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    scripts: [],
    ...overrides,
  };
}

describe("store pure functions", () => {
  it("loads persisted sidebar state from the previous storage key", () => {
    const container = createSidebarTreeContainer(createEmptySidebarTree(), {
      kind: "virtualProject",
      parentId: null,
      title: "Legacy folder",
      nodeId: "legacy-node",
      createdAt: "2026-04-11T00:00:00.000Z",
    });
    const raw = JSON.stringify({
      sidebarTree: {
        ...container.state,
        nodesById: {
          ...container.state.nodesById,
          "legacy-node": {
            ...container.state.nodesById["legacy-node"],
            icon: "??",
          },
        },
      },
      projectLeaderThreadIdByProjectId: {
        [ProjectId.makeUnsafe("project-1")]: ThreadId.makeUnsafe("thread-1"),
      },
    });

    const state = readPersistedStateFromStorage({
      getItem: (key) => (key === "t3code:renderer-state:v10" ? raw : null),
    });

    expect(state.sidebarTree).toEqual(createEmptySidebarTree());
    expect(state.projectLeaderThreadIdByProjectId).toEqual({
      [ProjectId.makeUnsafe("project-1")]: ThreadId.makeUnsafe("thread-1"),
    });
  });

  it("createSidebarVirtualProject assigns a folder icon by default", () => {
    const result = createSidebarVirtualProject(makeState(makeThread()), null, "New folder");
    expect(result.state.sidebarTree.nodesById[result.nodeId]).toMatchObject({
      icon: "\u{1F4C1}",
      title: "New folder",
    });
  });

  it("updates sidebar node binding and customization metadata", () => {
    const container = createSidebarTreeContainer(createEmptySidebarTree(), {
      kind: "virtualProject",
      parentId: null,
      title: "Inbox",
      nodeId: "container",
      createdAt: "2026-04-10T00:00:00.000Z",
    });
    const state: AppState = {
      projects: [],
      threads: [],
      sidebarTree: container.state,
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: true,
    };

    const withBinding = bindSidebarNodeToRuntimeProject(
      state,
      "container",
      ProjectId.makeUnsafe("project-1"),
    );
    const withWorkspace = setSidebarNodeWorkspaceOverride(
      withBinding,
      "container",
      "C:\\Users\\johnh\\git\\obsidian",
    );
    const withIcon = setSidebarNodeIcon(withWorkspace, "container", "📄");
    const withAccent = setSidebarNodeAccent(withIcon, "container", "cyan");
    const node = withAccent.sidebarTree.nodesById.container;

    expect(node).toMatchObject({
      runtimeProjectId: ProjectId.makeUnsafe("project-1"),
      workspaceOverride: "C:\\Users\\johnh\\git\\obsidian",
      icon: "📄",
      accent: "cyan",
    });
  });

  it("markThreadUnread moves lastVisitedAt before completion for a completed thread", () => {
    const latestTurnCompletedAt = "2026-02-25T12:30:00.000Z";
    const initialState = makeState(
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-02-25T12:28:00.000Z",
          startedAt: "2026-02-25T12:28:30.000Z",
          completedAt: latestTurnCompletedAt,
          assistantMessageId: null,
        },
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    const updatedThread = next.threads[0];
    expect(updatedThread).toBeDefined();
    expect(updatedThread?.lastVisitedAt).toBe("2026-02-25T12:29:59.999Z");
    expect(Date.parse(updatedThread?.lastVisitedAt ?? "")).toBeLessThan(
      Date.parse(latestTurnCompletedAt),
    );
  });

  it("markThreadUnread does not change a thread without a completed turn", () => {
    const initialState = makeState(
      makeThread({
        latestTurn: null,
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    expect(next).toEqual(initialState);
  });

  it("reorderProjects moves a project to a target index", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const state: AppState = {
      projects: [
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project3,
          name: "Project 3",
          cwd: "/tmp/project-3",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [],
      sidebarTree: createEmptySidebarTree(),
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: true,
    };

    const next = reorderProjects(state, project1, project3);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project3, project1]);
  });

  it("reorderThreads only reorders threads within the same project", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const thread1 = makeThread({ id: ThreadId.makeUnsafe("thread-1"), projectId: project1 });
    const thread2 = makeThread({ id: ThreadId.makeUnsafe("thread-2"), projectId: project1 });
    const thread3 = makeThread({ id: ThreadId.makeUnsafe("thread-3"), projectId: project2 });
    const state: AppState = {
      projects: [
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [thread1, thread2, thread3],
      sidebarTree: createEmptySidebarTree(),
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: true,
    };

    const next = reorderThreads(state, thread1.id, thread2.id);

    expect(next.threads.map((thread) => thread.id)).toEqual([thread2.id, thread1.id, thread3.id]);
  });

  it("moveThreadToProject rehomes a thread into another project before a target thread", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const thread1 = makeThread({ id: ThreadId.makeUnsafe("thread-1"), projectId: project1 });
    const thread2 = makeThread({ id: ThreadId.makeUnsafe("thread-2"), projectId: project1 });
    const thread3 = makeThread({ id: ThreadId.makeUnsafe("thread-3"), projectId: project2 });
    const thread4 = makeThread({ id: ThreadId.makeUnsafe("thread-4"), projectId: project2 });
    const state: AppState = {
      projects: [
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [thread1, thread2, thread3, thread4],
      sidebarTree: createEmptySidebarTree(),
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: true,
    };

    const next = moveThreadToProject(state, thread2.id, project2, thread4.id);

    expect(next.threads.map((thread) => [thread.id, thread.projectId])).toEqual([
      [thread1.id, project1],
      [thread3.id, project2],
      [thread2.id, project2],
      [thread4.id, project2],
    ]);
  });

  it("moveThreadToProject inserts into an empty project in project order", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const thread1 = makeThread({ id: ThreadId.makeUnsafe("thread-1"), projectId: project1 });
    const thread2 = makeThread({ id: ThreadId.makeUnsafe("thread-2"), projectId: project3 });
    const state: AppState = {
      projects: [
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project3,
          name: "Project 3",
          cwd: "/tmp/project-3",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [thread1, thread2],
      sidebarTree: createEmptySidebarTree(),
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: true,
    };

    const next = moveThreadToProject(state, thread1.id, project2);

    expect(next.threads.map((thread) => [thread.id, thread.projectId])).toEqual([
      [thread1.id, project2],
      [thread2.id, project3],
    ]);
  });

  it("moveThreadToProject carries the leader thread into its new project", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const thread1 = makeThread({ id: ThreadId.makeUnsafe("thread-1"), projectId: project1 });
    const state: AppState = {
      projects: [
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [thread1],
      sidebarTree: createEmptySidebarTree(),
      projectLeaderThreadIdByProjectId: {
        [project1]: thread1.id,
      },
      threadsHydrated: true,
    };

    const next = moveThreadToProject(state, thread1.id, project2);

    expect(next.projectLeaderThreadIdByProjectId).toEqual({
      [project2]: thread1.id,
    });
  });

  it("setThreadCustomIndicator updates a thread immediately", () => {
    const thread = makeThread({ id: ThreadId.makeUnsafe("thread-indicator") });
    const next = setThreadCustomIndicator(makeState(thread), thread.id, {
      label: "Pinned",
      tone: "violet",
    });

    expect(next.threads[0]?.customIndicator).toEqual({
      label: "Pinned",
      tone: "violet",
    });
  });

  it("setProjectCustomIndicator updates a project immediately", () => {
    const state = makeState(makeThread());
    const next = setProjectCustomIndicator(state, ProjectId.makeUnsafe("project-1"), {
      label: "Hot",
      tone: "rose",
    });

    expect(next.projects[0]?.customIndicator).toEqual({
      label: "Hot",
      tone: "rose",
    });
  });

  it("setProjectLeaderThread records the designated leader thread", () => {
    const thread = makeThread({ id: ThreadId.makeUnsafe("thread-leader") });
    const next = setProjectLeaderThread(makeState(thread), thread.projectId, thread.id);

    expect(next.projectLeaderThreadIdByProjectId).toEqual({
      [thread.projectId]: thread.id,
    });
  });

  it("removeThread drops a deleted thread from local state", () => {
    const thread1 = makeThread({ id: ThreadId.makeUnsafe("thread-1") });
    const thread2 = makeThread({ id: ThreadId.makeUnsafe("thread-2") });
    const state: AppState = {
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          name: "Project",
          cwd: "/tmp/project",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          customIndicator: null,
          scripts: [],
        },
      ],
      threads: [thread1, thread2],
      sidebarTree: createEmptySidebarTree(),
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: true,
    };

    const next = removeThread(state, thread1.id);

    expect(next.threads.map((thread) => thread.id)).toEqual([thread2.id]);
  });

  it("removeThread clears a deleted project leader", () => {
    const thread1 = makeThread({ id: ThreadId.makeUnsafe("thread-1") });
    const thread2 = makeThread({ id: ThreadId.makeUnsafe("thread-2") });
    const state: AppState = {
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          name: "Project",
          cwd: "/tmp/project",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          customIndicator: null,
          scripts: [],
        },
      ],
      threads: [thread1, thread2],
      sidebarTree: createEmptySidebarTree(),
      projectLeaderThreadIdByProjectId: {
        [thread1.projectId]: thread1.id,
      },
      threadsHydrated: true,
    };

    const next = removeThread(state, thread1.id);

    expect(next.projectLeaderThreadIdByProjectId).toEqual({});
  });

  it("setProjectExpanded updates one project's expansion state", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const state: AppState = {
      projects: [
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: false,
          scripts: [],
        },
      ],
      threads: [],
      sidebarTree: createEmptySidebarTree(),
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: true,
    };

    const next = setProjectExpanded(state, project1, false);

    expect(next.projects.map((project) => [project.id, project.expanded])).toEqual([
      [project1, false],
      [project2, false],
    ]);
  });
});

describe("store read model sync", () => {
  it("preserves claude model slugs without an active session", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        model: "claude-opus-4-6",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.model).toBe("claude-opus-4-6");
  });

  it("resolves claude aliases when session provider is claudeAgent", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        model: "sonnet",
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-02-27T00:00:00.000Z",
        },
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.model).toBe("claude-sonnet-4-6");
  });

  it("preserves project and thread updatedAt timestamps from the read model", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        updatedAt: "2026-02-27T00:05:00.000Z",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects[0]?.updatedAt).toBe("2026-02-27T00:00:00.000Z");
    expect(next.threads[0]?.updatedAt).toBe("2026-02-27T00:05:00.000Z");
  });


  it("collapses legacy folder and runtime project duplicates into one runtime-backed container", () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const treeWithFolder = createSidebarTreeContainer(createEmptySidebarTree(), {
      kind: "folder",
      parentId: null,
      title: "What",
      nodeId: "folder-what",
      createdAt: "2026-04-10T00:00:00.000Z",
    });
    const folderWhatNode = treeWithFolder.state.nodesById["folder-what"];
    if (folderWhatNode?.kind !== "folder") {
      throw new Error("Expected folder-what to be a folder");
    }
    const duplicatedTree: SidebarTreeState = {
      ...treeWithFolder.state,
      nodesById: {
        ...treeWithFolder.state.nodesById,
        [runtimeSidebarNodeId(projectId)]: {
          id: runtimeSidebarNodeId(projectId),
          kind: "runtimeProject",
          projectId,
          parentId: "folder-what",
          expanded: true,
          createdAt: "2026-04-10T00:01:00.000Z",
          updatedAt: "2026-04-10T00:01:00.000Z",
        },
      },
    };
    duplicatedTree.nodesById["folder-what"] = {
      ...folderWhatNode,
      childrenIds: [runtimeSidebarNodeId(projectId)],
    };

    const initialState: AppState = {
      projects: [],
      threads: [],
      sidebarTree: duplicatedTree,
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: true,
    };
    const readModel = makeReadModel(undefined, {
      projects: [
        makeReadModelProject({
          id: projectId,
          title: "What",
          workspaceRoot: "/tmp/what",
        }),
      ],
      threads: [
        makeReadModelThread({
          id: ThreadId.makeUnsafe("thread-what"),
          projectId,
          title: "It changed the icon or duplicated the folder??",
        }),
      ],
    });

    const next = syncServerReadModel(initialState, readModel);
    const normalizedNode = next.sidebarTree.nodesById["folder-what"];

    expect(normalizedNode).toMatchObject({
      kind: "virtualProject",
      runtimeProjectId: projectId,
      childrenIds: [],
    });
    expect(next.sidebarTree.nodesById[runtimeSidebarNodeId(projectId)]).toBeUndefined();
    expect(flattenSidebarTree(next.sidebarTree).map((entry) => entry.node.id)).toEqual(["folder-what"]);
  });


  it("folds any duplicate project wrapper back into the original matching folder", () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const loopBinding = {
      jobKey: "loop-what",
      loopType: "goal-loop",
      runtimeProjectId: projectId,
      supervisorThreadId: ThreadId.makeUnsafe("thread-supervisor"),
      workerThreadIds: [ThreadId.makeUnsafe("thread-worker")],
      lastKnownStatus: null,
    } as const;
    const folderTree = createSidebarTreeContainer(createEmptySidebarTree(), {
      kind: "folder",
      parentId: null,
      title: "What",
      nodeId: "folder-what",
      createdAt: "2026-04-10T00:00:00.000Z",
    });
    const autoProjectNodeId = "sidebar-node:auto-what";
    const duplicatedTree: SidebarTreeState = {
      ...folderTree.state,
      rootIds: [...folderTree.state.rootIds, autoProjectNodeId],
      nodesById: {
        ...folderTree.state.nodesById,
        [autoProjectNodeId]: {
          id: autoProjectNodeId,
          kind: "folder",
          title: "What",
          parentId: null,
          expanded: true,
          childrenIds: [],
          runtimeProjectId: projectId,
          workspaceOverride: null,
          icon: "\u{1F4C1}",
          accent: null,
          loopBinding,
          createdAt: "2026-04-10T00:01:00.000Z",
          updatedAt: "2026-04-10T00:01:00.000Z",
        },
      },
    };

    const initialState: AppState = {
      projects: [],
      threads: [],
      sidebarTree: duplicatedTree,
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: true,
    };
    const readModel = makeReadModel(undefined, {
      projects: [
        makeReadModelProject({
          id: projectId,
          title: "What",
          workspaceRoot: "/tmp/what",
        }),
      ],
      threads: [
        makeReadModelThread({
          id: ThreadId.makeUnsafe("thread-what"),
          projectId,
          title: "New thread",
        }),
      ],
    });

    const next = syncServerReadModel(initialState, readModel);

    expect(next.sidebarTree.nodesById["folder-what"]).toMatchObject({
      kind: "folder",
      runtimeProjectId: projectId,
      title: "What",
      icon: "\u{1F4C1}",
      loopBinding,
    });
    expect(next.sidebarTree.nodesById[autoProjectNodeId]).toBeUndefined();
    expect(flattenSidebarTree(next.sidebarTree).map((entry) => entry.node.id)).toEqual(["folder-what"]);
  });

  it("keeps locally deleted runtime-backed folders from reappearing on the next sync", () => {
    const projectId = ProjectId.makeUnsafe("project-dismissed-locally");
    const folderTree = createSidebarTreeContainer(createEmptySidebarTree(), {
      kind: "virtualProject",
      parentId: null,
      title: "Dismiss me",
      nodeId: "folder-dismissed",
      createdAt: "2026-04-10T00:00:00.000Z",
    });
    const initialState: AppState = {
      projects: [],
      threads: [],
      sidebarTree: {
        ...folderTree.state,
        nodesById: {
          ...folderTree.state.nodesById,
          "folder-dismissed": {
            ...folderTree.state.nodesById["folder-dismissed"],
            runtimeProjectId: projectId,
            icon: "\u{1F4C1}",
          },
        },
      } as SidebarTreeState,
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: true,
    };

    const deleted = deleteSidebarNode(initialState, "folder-dismissed");
    const next = syncServerReadModel(
      deleted,
      makeReadModel(undefined, {
        projects: [
          makeReadModelProject({
            id: projectId,
            title: "Dismiss me",
            workspaceRoot: "/tmp/dismissed",
          }),
        ],
        threads: [],
      }),
    );

    expect(flattenSidebarTree(next.sidebarTree)).toEqual([]);
    expect(next.sidebarTree.nodesById[runtimeSidebarNodeId(projectId)]).toBeUndefined();
  });

  it("preserves the current thread order within each project when syncing read model updates", () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const thread1 = ThreadId.makeUnsafe("thread-1");
    const thread2 = ThreadId.makeUnsafe("thread-2");
    const initialState: AppState = {
      projects: [
        {
          id: projectId,
          name: "Project",
          cwd: "/tmp/project",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [
        makeThread({ id: thread2, projectId }),
        makeThread({ id: thread1, projectId }),
      ],
      sidebarTree: createEmptySidebarTree(),
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: true,
    };
    const readModel: OrchestrationReadModel = {
      ...makeReadModel(
        makeReadModelThread({
          id: thread1,
          projectId,
          title: "Thread 1",
        }),
      ),
      threads: [
        makeReadModelThread({
          id: thread1,
          projectId,
          title: "Thread 1",
        }),
        makeReadModelThread({
          id: thread2,
          projectId,
          title: "Thread 2",
        }),
      ],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads.map((thread) => thread.id)).toEqual([thread2, thread1]);
  });

  it("preserves the current project order when syncing incoming read model updates", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const initialState: AppState = {
      projects: [
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [],
      sidebarTree: createEmptySidebarTree(),
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: true,
    };
    const readModel: OrchestrationReadModel = {
      snapshotSequence: 2,
      updatedAt: "2026-02-27T00:00:00.000Z",
      projects: [
        makeReadModelProject({
          id: project1,
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
        }),
        makeReadModelProject({
          id: project2,
          title: "Project 2",
          workspaceRoot: "/tmp/project-2",
        }),
        makeReadModelProject({
          id: project3,
          title: "Project 3",
          workspaceRoot: "/tmp/project-3",
        }),
      ],
      threads: [],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project1, project3]);
  });

  it("materializes runtime projects into the sidebar tree during sync", () => {
    const initialState: AppState = {
      projects: [],
      threads: [],
      sidebarTree: createEmptySidebarTree(),
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: false,
    };
    const projectId = ProjectId.makeUnsafe("project-1");
    const readModel: OrchestrationReadModel = {
      snapshotSequence: 1,
      updatedAt: "2026-02-27T00:00:00.000Z",
      projects: [
        makeReadModelProject({
          id: projectId,
          title: "Runtime Project",
          workspaceRoot: "/tmp/runtime-project",
        }),
      ],
      threads: [],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(flattenSidebarTree(next.sidebarTree).map((entry) => entry.node.id)).toEqual([
      runtimeSidebarNodeId(projectId),
    ]);
  });

  it("clears duplicate runtime bindings when syncing persisted sidebar state", () => {
    const initialTree = createSidebarTreeContainer(createEmptySidebarTree(), {
      kind: "virtualProject",
      parentId: null,
      title: "First",
      nodeId: "project-a",
      createdAt: "2026-04-10T00:00:00.000Z",
    });
    const duplicatedTree = createSidebarTreeContainer(initialTree.state, {
      kind: "virtualProject",
      parentId: null,
      title: "Second",
      nodeId: "project-b",
      createdAt: "2026-04-10T00:01:00.000Z",
    });
    const projectId = ProjectId.makeUnsafe("project-1");
    const initialState: AppState = {
      projects: [],
      threads: [],
      sidebarTree: {
        ...duplicatedTree.state,
        nodesById: {
          ...duplicatedTree.state.nodesById,
          "project-a": {
            ...duplicatedTree.state.nodesById["project-a"],
            runtimeProjectId: projectId,
          },
          "project-b": {
            ...duplicatedTree.state.nodesById["project-b"],
            runtimeProjectId: projectId,
          },
        },
      } as SidebarTreeState,
      projectLeaderThreadIdByProjectId: {},
      threadsHydrated: true,
    };
    const readModel: OrchestrationReadModel = {
      snapshotSequence: 1,
      updatedAt: "2026-02-27T00:00:00.000Z",
      projects: [
        makeReadModelProject({
          id: projectId,
          title: "Runtime Project",
          workspaceRoot: "/tmp/runtime-project",
        }),
      ],
      threads: [],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.sidebarTree.nodesById["project-a"]).toMatchObject({ runtimeProjectId: projectId });
    expect(next.sidebarTree.nodesById["project-b"]).toMatchObject({ runtimeProjectId: null });
  });
});
