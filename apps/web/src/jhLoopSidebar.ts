import type {
  JhLoopBinding,
  JhLoopStatusResult,
  OrchestrationCustomIndicator,
} from "@t3tools/contracts";

import type { Thread } from "./types";

export type JhLoopStatusQueryState = {
  data?: JhLoopStatusResult | null | undefined;
  isError?: boolean | undefined;
};

export type JhLoopStatusState = {
  status: JhLoopStatusResult | null;
  hasError: boolean;
};

export function buildLoopStatusStateByJobKey(
  loopBindings: Array<{ binding: Pick<JhLoopBinding, "jobKey"> }>,
  loopStatusQueries: JhLoopStatusQueryState[],
): Map<string, JhLoopStatusState> {
  const map = new Map<string, JhLoopStatusState>();
  for (let index = 0; index < loopBindings.length; index += 1) {
    const binding = loopBindings[index]?.binding;
    const query = loopStatusQueries[index];
    if (!binding?.jobKey) {
      continue;
    }
    map.set(binding.jobKey, {
      status: query?.isError ? null : (query?.data ?? null),
      hasError: query?.isError ?? false,
    });
  }
  return map;
}

export function resolveLoopStatusForBinding(
  binding: JhLoopBinding | null | undefined,
  stateByJobKey: Map<string, JhLoopStatusState>,
): JhLoopStatusResult | null {
  if (!binding) {
    return null;
  }

  const state = stateByJobKey.get(binding.jobKey);
  if (state?.hasError) {
    return {
      jobKey: binding.jobKey,
      loopType: binding.loopType,
      enabled: false,
      requestedState: null,
      phase: "status-unavailable",
      completed: false,
      summary: "Loop status is temporarily unavailable.",
      lastError: "The loop status poll failed.",
      lastRunAt: null,
      nextRunAt: null,
      projectId: binding.runtimeProjectId,
      projectTitle: null,
      workspaceRoot: null,
      supervisorThreadId: binding.supervisorThreadId,
      supervisorThreadTitle: null,
      workerThreadIds: binding.workerThreadIds,
      workerThreadTitles: [],
      indicator: {
        label: "Problem",
        tone: "rose",
        pulse: false,
        priority: 5,
      } satisfies OrchestrationCustomIndicator,
      updatedAt: new Date().toISOString(),
    } satisfies JhLoopStatusResult;
  }

  return state?.status ?? null;
}

export function orderLoopProjectThreads(
  projectThreads: Thread[],
  binding: JhLoopBinding | null | undefined,
): Thread[] {
  if (!binding) {
    return projectThreads;
  }

  const indexByThreadId = new Map(projectThreads.map((thread, index) => [thread.id, index]));
  const rankByThreadId = new Map<string, number>();

  if (binding.supervisorThreadId) {
    rankByThreadId.set(binding.supervisorThreadId, 0);
  }

  binding.workerThreadIds.forEach((threadId, index) => {
    rankByThreadId.set(threadId, index + 1);
  });

  return projectThreads.toSorted((left, right) => {
    const leftRank = rankByThreadId.get(left.id);
    const rightRank = rankByThreadId.get(right.id);
    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) return 1;
      if (rightRank === undefined) return -1;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
    }
    return (indexByThreadId.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (indexByThreadId.get(right.id) ?? Number.MAX_SAFE_INTEGER);
  });
}
