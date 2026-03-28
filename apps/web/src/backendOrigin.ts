import {
  BACKEND_TARGET_STORAGE_KEY,
  BackendTarget,
  DEFAULT_BACKEND_TARGET,
  resolveBackendTargetHttpOrigin,
} from "./backendTarget";
import { getLocalStorageItem } from "./hooks/useLocalStorage";

export function resolveWsHttpOrigin(): string {
  if (typeof window === "undefined") return "";
  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  const configuredTarget =
    getLocalStorageItem(BACKEND_TARGET_STORAGE_KEY, BackendTarget) ?? DEFAULT_BACKEND_TARGET;
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsCandidate =
    typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0
      ? bridgeWsUrl
      : typeof envWsUrl === "string" && envWsUrl.length > 0
        ? envWsUrl
        : null;
  if (!wsCandidate) {
    return resolveBackendTargetHttpOrigin(configuredTarget);
  }
  try {
    const wsUrl = new URL(wsCandidate);
    const protocol =
      wsUrl.protocol === "wss:" ? "https:" : wsUrl.protocol === "ws:" ? "http:" : wsUrl.protocol;
    return `${protocol}//${wsUrl.host}`;
  } catch {
    return resolveBackendTargetHttpOrigin(configuredTarget);
  }
}

export function toBackendAssetUrl(rawUrl: string): string {
  if (rawUrl.startsWith("/")) {
    return `${resolveWsHttpOrigin()}${rawUrl}`;
  }
  return rawUrl;
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\]+\\[^\\]+/;

function decodeLocalFileUrl(rawSrc: string): string | null {
  try {
    const parsed = new URL(rawSrc);
    if (parsed.protocol !== "file:") {
      return null;
    }
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (/^\/[a-zA-Z]:/.test(decodedPath)) {
      return decodedPath.slice(1);
    }
    return decodedPath;
  } catch {
    return null;
  }
}

export function resolveInlineImageSrc(rawSrc: string): string {
  const trimmedSrc = rawSrc.trim();
  if (
    trimmedSrc.startsWith("http://") ||
    trimmedSrc.startsWith("https://") ||
    trimmedSrc.startsWith("data:") ||
    trimmedSrc.startsWith("blob:")
  ) {
    return trimmedSrc;
  }

  if (trimmedSrc.startsWith("/attachments/") || trimmedSrc.startsWith("/local-file?")) {
    return toBackendAssetUrl(trimmedSrc);
  }

  const fileUrlPath = trimmedSrc.startsWith("file://") ? decodeLocalFileUrl(trimmedSrc) : null;
  const normalizedWindowsSlashPath = /^\/[A-Za-z]:[\\/]/.test(trimmedSrc)
    ? trimmedSrc.slice(1)
    : trimmedSrc;
  const localPath = fileUrlPath ?? normalizedWindowsSlashPath;
  if (
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(localPath) ||
    WINDOWS_UNC_PATH_PATTERN.test(localPath) ||
    (localPath.startsWith("/") && !localPath.startsWith("//"))
  ) {
    return toBackendAssetUrl(`/local-file?path=${encodeURIComponent(localPath)}`);
  }

  return trimmedSrc;
}
