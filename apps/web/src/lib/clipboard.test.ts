import { afterEach, describe, expect, it, vi } from "vitest";
import { writeTextToClipboard } from "./clipboard";

function installBrowserStubs(input?: { execCommandResult?: boolean }) {
  const textarea = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
  };
  const body = {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  };
  const documentStub = {
    body,
    createElement: vi.fn().mockReturnValue(textarea),
    execCommand: vi.fn().mockReturnValue(input?.execCommandResult ?? true),
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: documentStub,
  });

  return { body, documentStub, textarea };
}

describe("writeTextToClipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installBrowserStubs();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText,
        },
      },
    });

    await writeTextToClipboard("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when navigator.clipboard fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const { body, documentStub, textarea } = installBrowserStubs();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText,
        },
      },
    });

    await writeTextToClipboard("fallback");

    expect(writeText).toHaveBeenCalledWith("fallback");
    expect(documentStub.execCommand).toHaveBeenCalledWith("copy");
    expect(documentStub.createElement).toHaveBeenCalledWith("textarea");
    expect(body.appendChild).toHaveBeenCalledWith(textarea);
    expect(body.removeChild).toHaveBeenCalledWith(textarea);
  });
});
