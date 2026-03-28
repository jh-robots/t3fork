import { queryOptions } from "@tanstack/react-query";
import { Schema } from "effect";

export const JHFeatureFlagsSchema = Schema.Struct({
  askUserWorkflow: Schema.Boolean,
  richImageRendering: Schema.Boolean,
  streamlinedHeaderActions: Schema.Boolean,
  mobileTerminalViewport: Schema.Boolean,
  mobileFullscreenViewport: Schema.Boolean,
});
export type JHFeatureFlags = typeof JHFeatureFlagsSchema.Type;
export const DEFAULT_JH_FEATURE_FLAGS: JHFeatureFlags = {
  askUserWorkflow: true,
  richImageRendering: true,
  streamlinedHeaderActions: true,
  mobileTerminalViewport: true,
  mobileFullscreenViewport: true,
};
export type JHFeatureFlagOverrideMap = {
  askUserWorkflow?: boolean | undefined;
  richImageRendering?: boolean | undefined;
  streamlinedHeaderActions?: boolean | undefined;
  mobileTerminalViewport?: boolean | undefined;
  mobileFullscreenViewport?: boolean | undefined;
};

export const JHRuntimeFeatureFlagsConfigSchema = Schema.Struct({
  flags: JHFeatureFlagsSchema,
  source: Schema.String,
  sourcePath: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String),
});
export type JHRuntimeFeatureFlagsConfig = typeof JHRuntimeFeatureFlagsConfigSchema.Type;

export const DEFAULT_JH_RUNTIME_FEATURE_FLAGS_CONFIG: JHRuntimeFeatureFlagsConfig = {
  flags: DEFAULT_JH_FEATURE_FLAGS,
  source: "overlay-root-missing",
  sourcePath: null,
  updatedAt: null,
};

export const jhRuntimeFeatureFlagQueryKeys = {
  all: ["jh-runtime-feature-flags"] as const,
  config: () => ["jh-runtime-feature-flags", "config"] as const,
};

export function resolveJhManagementHttpOrigin(): string {
  const envOrigin = import.meta.env.VITE_JH_MANAGEMENT_HTTP_URL as string | undefined;
  if (typeof envOrigin === "string" && envOrigin.length > 0) {
    return envOrigin;
  }
  if (typeof window !== "undefined" && window.location.hostname.length > 0) {
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//${window.location.hostname}:4773`;
  }
  return "http://127.0.0.1:4773";
}

export function resolveJhRuntimeFeatureFlagsUrl(): string {
  return `${resolveJhManagementHttpOrigin()}/jh-runtime-config`;
}

export async function fetchJhRuntimeFeatureFlags(): Promise<JHRuntimeFeatureFlagsConfig> {
  try {
    const response = await fetch(resolveJhRuntimeFeatureFlagsUrl(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return DEFAULT_JH_RUNTIME_FEATURE_FLAGS_CONFIG;
    }

    const payload = Schema.decodeUnknownSync(JHRuntimeFeatureFlagsConfigSchema)(
      await response.json(),
    );
    return payload;
  } catch {
    return DEFAULT_JH_RUNTIME_FEATURE_FLAGS_CONFIG;
  }
}

export function resolveEffectiveJhFeatureFlags(params: {
  managedDefaults: JHFeatureFlags;
  overrides: JHFeatureFlagOverrideMap;
}): JHFeatureFlags {
  return {
    askUserWorkflow: params.overrides.askUserWorkflow ?? params.managedDefaults.askUserWorkflow,
    richImageRendering:
      params.overrides.richImageRendering ?? params.managedDefaults.richImageRendering,
    streamlinedHeaderActions:
      params.overrides.streamlinedHeaderActions ?? params.managedDefaults.streamlinedHeaderActions,
    mobileTerminalViewport:
      params.overrides.mobileTerminalViewport ?? params.managedDefaults.mobileTerminalViewport,
    mobileFullscreenViewport:
      params.overrides.mobileFullscreenViewport ??
      params.managedDefaults.mobileFullscreenViewport,
  };
}

export function jhRuntimeFeatureFlagsQueryOptions() {
  return queryOptions({
    queryKey: jhRuntimeFeatureFlagQueryKeys.config(),
    queryFn: fetchJhRuntimeFeatureFlags,
    staleTime: 30_000,
  });
}
