export async function writeTextToClipboard(value: string): Promise<void> {
  if (!value) {
    return;
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Clipboard unavailable outside the browser.");
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back to the legacy selection-based path below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    const successful = document.execCommand("copy");
    if (!successful) {
      throw new Error("Clipboard copy command was rejected.");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}
