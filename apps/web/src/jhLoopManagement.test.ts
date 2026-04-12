import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createJhLoop,
  fetchJhLoopStatus,
  getJhLoopErrorMessage,
  JhLoopRequestError,
} from "./jhLoopManagement";

describe("jhLoopManagement", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces server JSON error messages for loop creation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Loop provider startup failed." }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        })),
    );

    await expect(
      createJhLoop({
        loopType: "goal-loop",
        project: {
          workspaceRoot: "C:\\Users\\johnh\\git\\obsidian",
          title: "Loop",
        },
        objective: "Count to 5",
        workerCount: 1,
        workerModel: "gpt-5.4",
        supervisorModel: "gpt-5.4",
      }),
    ).rejects.toThrow("Loop provider startup failed.");
  });

  it("treats missing loop status as a null result instead of a hard error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Loop not found." }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        })),
    );

    await expect(fetchJhLoopStatus("missing-loop")).resolves.toBeNull();
  });

  it("formats request errors for toast presentation", () => {
    expect(
      getJhLoopErrorMessage(
        new JhLoopRequestError("The backend timed out.", { status: 504 }),
        "fallback",
      ),
    ).toBe("The backend timed out.");
  });
});
