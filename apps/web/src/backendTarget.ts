import * as Schema from "effect/Schema";

export const BackendTarget = Schema.Literals(["jh-standalone", "upstream-mirror"]);
export type BackendTarget = typeof BackendTarget.Type;

export const BACKEND_TARGET_STORAGE_KEY = "jhcode:backend-target:v1";
export const DEFAULT_BACKEND_TARGET: BackendTarget = "jh-standalone";

export const BACKEND_TARGET_LABELS: Record<BackendTarget, string> = {
  "jh-standalone": "JH standalone",
  "upstream-mirror": "Upstream mirror",
};

export const BACKEND_TARGET_DESCRIPTIONS: Record<BackendTarget, string> = {
  "jh-standalone": "Use the JH-managed backend for this session.",
  "upstream-mirror": "Mirror the upstream T3 backend for this session.",
};

function resolveBrowserHost(): string {
  if (typeof window === "undefined") {
    return "127.0.0.1";
  }
  return window.location.hostname || "127.0.0.1";
}

function resolveHttpProtocol(): "http:" | "https:" {
  if (typeof window === "undefined") {
    return "http:";
  }
  return window.location.protocol === "https:" ? "https:" : "http:";
}

function resolveWsProtocol(): "ws:" | "wss:" {
  return resolveHttpProtocol() === "https:" ? "wss:" : "ws:";
}

export function resolveBackendTargetWsUrl(target: BackendTarget): string {
  const host = resolveBrowserHost();
  const port = target === "upstream-mirror" ? 3773 : 4773;
  return `${resolveWsProtocol()}//${host}:${port}`;
}

export function resolveBackendTargetHttpOrigin(target: BackendTarget): string {
  const host = resolveBrowserHost();
  const port = target === "upstream-mirror" ? 3773 : 4773;
  return `${resolveHttpProtocol()}//${host}:${port}`;
}
