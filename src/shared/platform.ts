export const isMacOS = (
  platform: string = typeof process !== "undefined" ? process.platform : "",
  userAgent: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
): boolean => {
  if (platform === "darwin") return true;
  return /Macintosh|Mac OS X/i.test(userAgent);
};

export const isWindows = (
  platform: string = typeof process !== "undefined" ? process.platform : "",
  userAgent: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
): boolean => {
  if (platform === "win32") return true;
  return /Windows/i.test(userAgent);
};

export function resolveCliBinary(
  name: "claude" | "codex" | "antigravity" | string,
  platform: string = typeof process !== "undefined" ? process.platform : "",
): string {
  if (platform === "win32") {
    if (name === "claude") return "claude.exe";
    if (name === "antigravity") return "agy.exe";
    return `${name}.cmd`;
  }
  if (name === "antigravity") return "agy";
  return name;
}

export const getModifierKeyLabel = (isMac = isMacOS()): string =>
  isMac ? "Cmd" : "Ctrl";

export const getModifierKeySymbol = (isMac = isMacOS()): string =>
  isMac ? "⌘⇧" : "Ctrl⇧";

export interface KeyboardEventSubset {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  code: string;
}

export const isShortcutMatch = (
  event: KeyboardEventSubset,
  targetCode: string,
  isMac = isMacOS(),
): boolean => {
  if (event.repeat || event.isComposing || event.altKey) {
    return false;
  }
  if (!event.shiftKey || event.code !== targetCode) {
    return false;
  }
  if (isMac) {
    return event.metaKey && !event.ctrlKey;
  }
  return event.ctrlKey && !event.metaKey;
};
