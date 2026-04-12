import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildLoopStatusStateByJobKey,
  orderLoopProjectThreads,
  resolveLoopStatusForBinding,
} from "./jhLoopSidebar";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Thread,
} from "./types";

function makeThread(id: string, title: string): Thread {
  return {
    id: ThreadId.makeUnsafe(id),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title,
    model: "gpt-5.4",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    customIndicator: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-04-12T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
  };
}

describe("jhLoopSidebar", () => {
  it("normalizes a loop query failure into a synthetic Problem status", () => {
    const binding = {
      jobKey: "loop-1",
      loopType: "goal-loop" as const,
      runtimeProjectId: ProjectId.makeUnsafe("project-1"),
      supervisorThreadId: ThreadId.makeUnsafe("thread-supervisor"),
      workerThreadIds: [ThreadId.makeUnsafe("thread-worker-1")],
      lastKnownStatus: null,
    };

    const stateByJobKey = buildLoopStatusStateByJobKey(
      [{ binding }],
      [{ isError: true }],
    );

    expect(resolveLoopStatusForBinding(binding, stateByJobKey)).toMatchObject({
      jobKey: "loop-1",
      phase: "status-unavailable",
      lastError: "The loop status poll failed.",
      indicator: {
        label: "Problem",
        tone: "rose",
      },
      projectId: ProjectId.makeUnsafe("project-1"),
    });
  });

  it("keeps supervisor-first and worker-order stable for loop projects", () => {
    const supervisor = makeThread("thread-supervisor", "Supervisor");
    const workerTwo = makeThread("thread-worker-2", "Worker 2");
    const unrelated = makeThread("thread-unrelated", "Other");
    const workerOne = makeThread("thread-worker-1", "Worker 1");

    const ordered = orderLoopProjectThreads(
      [workerTwo, unrelated, supervisor, workerOne],
      {
        jobKey: "loop-1",
        loopType: "goal-loop",
        runtimeProjectId: ProjectId.makeUnsafe("project-1"),
        supervisorThreadId: supervisor.id,
        workerThreadIds: [workerOne.id, workerTwo.id],
        lastKnownStatus: null,
      },
    );

    expect(ordered.map((thread) => thread.id)).toEqual([
      supervisor.id,
      workerOne.id,
      workerTwo.id,
      unrelated.id,
    ]);
  });
});
