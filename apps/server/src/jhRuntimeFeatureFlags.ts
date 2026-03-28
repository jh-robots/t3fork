import fs from "node:fs";
import path from "node:path";

import { Effect } from "effect";

export interface JHRuntimeFeatureFlags {
  askUserWorkflow: boolean;
  richImageRendering: boolean;
  streamlinedHeaderActions: boolean;
  mobileTerminalViewport: boolean;
  mobileFullscreenViewport: boolean;
  mobileInAppNotifications: boolean;
}

export interface JHRuntimeFeatureFlagsConfig {
  flags: JHRuntimeFeatureFlags;
  source: "managed-manifest" | "manifest-missing" | "invalid-manifest" | "overlay-root-missing";
  sourcePath: string | null;
  updatedAt: string | null;
}

export const DEFAULT_JH_RUNTIME_FEATURE_FLAGS: JHRuntimeFeatureFlags = {
  askUserWorkflow: true,
  richImageRendering: true,
  streamlinedHeaderActions: true,
  mobileTerminalViewport: true,
  mobileFullscreenViewport: true,
  mobileInAppNotifications: false,
};

function isRuntimeFeatureFlags(input: unknown): input is JHRuntimeFeatureFlags {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  const candidate = input as Record<string, unknown>;
  return (
    typeof candidate.askUserWorkflow === "boolean" &&
    typeof candidate.richImageRendering === "boolean" &&
    typeof candidate.streamlinedHeaderActions === "boolean" &&
    typeof candidate.mobileTerminalViewport === "boolean" &&
    typeof candidate.mobileFullscreenViewport === "boolean" &&
    typeof candidate.mobileInAppNotifications === "boolean"
  );
}

function resolveOverlayRoot(): string | null {
  const raw = process.env.JH_CODE_OVERLAY_ROOT?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export const loadJhRuntimeFeatureFlags = Effect.fn(function* () {
  const overlayRoot = resolveOverlayRoot();

  if (!overlayRoot) {
    return {
      flags: DEFAULT_JH_RUNTIME_FEATURE_FLAGS,
      source: "overlay-root-missing",
      sourcePath: null,
      updatedAt: null,
    } satisfies JHRuntimeFeatureFlagsConfig;
  }

  const manifestPath = path.join(overlayRoot, "customizations", "jh-feature-flags.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      flags: DEFAULT_JH_RUNTIME_FEATURE_FLAGS,
      source: "manifest-missing",
      sourcePath: manifestPath,
      updatedAt: null,
    } satisfies JHRuntimeFeatureFlagsConfig;
  }

  const manifestContents = yield* Effect.try({
    try: () => fs.readFileSync(manifestPath, "utf8"),
    catch: () => null,
  });
  if (manifestContents === null) {
    return {
      flags: DEFAULT_JH_RUNTIME_FEATURE_FLAGS,
      source: "invalid-manifest",
      sourcePath: manifestPath,
      updatedAt: null,
    } satisfies JHRuntimeFeatureFlagsConfig;
  }

  const parsedManifest = yield* Effect.try({
    try: () => JSON.parse(manifestContents) as { flags?: unknown; updated_at?: unknown },
    catch: () => null,
  });
  if (!parsedManifest || !isRuntimeFeatureFlags(parsedManifest.flags)) {
    return {
      flags: DEFAULT_JH_RUNTIME_FEATURE_FLAGS,
      source: "invalid-manifest",
      sourcePath: manifestPath,
      updatedAt: null,
    } satisfies JHRuntimeFeatureFlagsConfig;
  }

  return {
    flags: parsedManifest.flags,
    source: "managed-manifest",
    sourcePath: manifestPath,
    updatedAt: typeof parsedManifest.updated_at === "string" ? parsedManifest.updated_at : null,
  } satisfies JHRuntimeFeatureFlagsConfig;
});
