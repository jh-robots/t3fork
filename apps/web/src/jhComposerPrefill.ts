import {
  type JhComposerDraftStateResult,
  JhComposerDraftStateResult as JhComposerDraftStateResultSchema,
  type JhComposerClearedResult,
  JhComposerClearedResult as JhComposerClearedResultSchema,
  type ThreadId,
} from "@t3tools/contracts";
import { Schema } from "effect";
import { resolveJhManagementHttpOrigin } from "./jhRuntimeFeatureFlags";

export function resolveJhThreadComposerUrl(threadId: ThreadId): string {
  const url = new URL("/jh/thread-composer", resolveJhManagementHttpOrigin());
  url.searchParams.set("thread_id", threadId);
  return url.toString();
}

export async function fetchJhThreadComposerState(
  threadId: ThreadId,
): Promise<JhComposerDraftStateResult | null> {
  try {
    const response = await fetch(resolveJhThreadComposerUrl(threadId), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return null;
    }
    return Schema.decodeUnknownSync(JhComposerDraftStateResultSchema)(await response.json());
  } catch {
    return null;
  }
}

export async function clearJhThreadComposerState(
  threadId: ThreadId,
): Promise<JhComposerClearedResult | null> {
  try {
    const response = await fetch(resolveJhThreadComposerUrl(threadId), {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return null;
    }
    return Schema.decodeUnknownSync(JhComposerClearedResultSchema)(await response.json());
  } catch {
    return null;
  }
}
