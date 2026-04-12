import {
  JhLoopControlResult as JhLoopControlResultSchema,
  JhLoopCreateResult as JhLoopCreateResultSchema,
  JhLoopStatusResult as JhLoopStatusResultSchema,
  type JhLoopControlRequest,
  type JhLoopControlResult,
  type JhLoopCreateRequest,
  type JhLoopCreateResult,
  type JhLoopStatusResult,
} from "@t3tools/contracts";
import { Schema } from "effect";
import { resolveJhManagementHttpOrigin } from "./jhRuntimeFeatureFlags";

const JH_LOOP_ROUTE_PATH = "/jh/loops";

type JhLoopErrorPayload = {
  error?: unknown;
  message?: unknown;
  detail?: unknown;
};

export class JhLoopRequestError extends Error {
  readonly status: number | null;
  readonly bodyText: string | null;

  constructor(message: string, options?: { status?: number | null; bodyText?: string | null }) {
    super(message);
    this.name = "JhLoopRequestError";
    this.status = options?.status ?? null;
    this.bodyText = options?.bodyText ?? null;
  }
}

function resolveJhLoopUrl(jobKey?: string): string {
  const url = new URL(JH_LOOP_ROUTE_PATH, resolveJhManagementHttpOrigin());
  if (jobKey) {
    url.searchParams.set("job_key", jobKey);
  }
  return url.toString();
}

function readJhLoopErrorPayload(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as JhLoopErrorPayload;
    for (const candidate of [parsed.error, parsed.message, parsed.detail]) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  } catch {
    return trimmed;
  }
  return null;
}

async function decodeJhLoopResponse<T>(
  response: Response,
  schema: typeof JhLoopCreateResultSchema | typeof JhLoopControlResultSchema | typeof JhLoopStatusResultSchema,
  options?: { allowNotFound?: boolean; fallbackMessage?: string },
): Promise<T | null> {
  if (options?.allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const fallbackMessage =
      options?.fallbackMessage ?? `Loop request failed with HTTP ${response.status}.`;
    throw new JhLoopRequestError(readJhLoopErrorPayload(bodyText) ?? fallbackMessage, {
      status: response.status,
      bodyText,
    });
  }

  return Schema.decodeUnknownSync(schema)(await response.json()) as T;
}

export function getJhLoopErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof JhLoopRequestError && error.message.trim().length > 0) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

export async function createJhLoop(
  request: JhLoopCreateRequest,
): Promise<JhLoopCreateResult | null> {
  const response = await fetch(resolveJhLoopUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  return await decodeJhLoopResponse<JhLoopCreateResult>(response, JhLoopCreateResultSchema, {
    fallbackMessage: "The loop create request was rejected.",
  });
}

export async function controlJhLoop(
  request: JhLoopControlRequest,
): Promise<JhLoopControlResult | null> {
  const response = await fetch(resolveJhLoopUrl(), {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  return await decodeJhLoopResponse<JhLoopControlResult>(response, JhLoopControlResultSchema, {
    fallbackMessage: "The loop control request was rejected.",
  });
}

export async function fetchJhLoopStatus(
  jobKey: string,
): Promise<JhLoopStatusResult | null> {
  const response = await fetch(resolveJhLoopUrl(jobKey), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  return await decodeJhLoopResponse<JhLoopStatusResult>(response, JhLoopStatusResultSchema, {
    allowNotFound: true,
    fallbackMessage: "The loop status request failed.",
  });
}
