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
  "jh-standalone": "Use the JH-managed backend on port 4773.",
  "upstream-mirror": "Mirror the upstream T3 backend on port 3773.",
};

export function resolveBackendTargetWsUrl(target: BackendTarget): string {
  return target === "upstream-mirror" ? "ws://127.0.0.1:3773" : "ws://127.0.0.1:4773";
}

export function resolveBackendTargetHttpOrigin(target: BackendTarget): string {
  return target === "upstream-mirror" ? "http://127.0.0.1:3773" : "http://127.0.0.1:4773";
}
