/**
 * Cross-Platform Support System
 * Windows, Linux, macOS detection and compatibility
 */

import { platform as osPlatform, arch as osArch, homedir as osHomedir, tmpdir as osTmpdir } from "node:os";
import { sep as pathSep, join as pathJoin } from "node:path";
import { existsSync } from "node:fs";

export type Platform = "windows" | "linux" | "macos" | "freebsd" | "unknown";

export interface PlatformInfo {
  platform: Platform;
  arch: string;
  homedir: string;
  shell: string;
  pathSeparator: string;
  lineEnding: string;
  packageManager: string;
  isWSL: boolean;
}

export function detectPlatform(): PlatformInfo {
  const osPlatformVal = osPlatform();

  let detectedPlatform: Platform;
  let shell: string;
  let lineEnding: string;

  if (osPlatformVal === "win32") {
    detectedPlatform = "windows";
    shell = process.env.COMSPEC || "cmd.exe";
    lineEnding = "\r\n";
  } else if (osPlatformVal === "darwin") {
    detectedPlatform = "macos";
    shell = process.env.SHELL || "/bin/zsh";
    lineEnding = "\n";
  } else if (osPlatformVal === "linux") {
    detectedPlatform = "linux";
    shell = process.env.SHELL || "/bin/bash";
    lineEnding = "\n";
  } else {
    detectedPlatform = "unknown";
    shell = "/bin/sh";
    lineEnding = "\n";
  }

  // Detect WSL
  const isWSL = detectedPlatform === "linux" &&
    ((process.env.WSL_DISTRO_NAME || "").length > 0 || (process.env.WSLENV || "").length > 0);

  // Detect package manager
  let packageManager = "npm";
  try {
    const cwd = process.cwd();

    if (existsSync(pathJoin(cwd, "bun.lockb")) || existsSync(pathJoin(cwd, "bun.lock"))) {
      packageManager = "bun";
    } else if (existsSync(pathJoin(cwd, "yarn.lock"))) {
      packageManager = "yarn";
    } else if (existsSync(pathJoin(cwd, "pnpm-lock.yaml"))) {
      packageManager = "pnpm";
    } else if (existsSync(pathJoin(cwd, "uv.lock"))) {
      packageManager = "uv";
    } else if (existsSync(pathJoin(cwd, "requirements.txt"))) {
      packageManager = "pip";
    } else if (existsSync(pathJoin(cwd, "Cargo.lock"))) {
      packageManager = "cargo";
    } else if (existsSync(pathJoin(cwd, "go.mod"))) {
      packageManager = "go";
    }
  } catch {
    // Default to npm
  }

  return {
    platform: detectedPlatform,
    arch: osArch(),
    homedir: osHomedir(),
    shell,
    pathSeparator: pathSep,
    lineEnding,
    packageManager,
    isWSL,
  };
}

/**
 * Platform-specific command adapter
 */
export function adaptCommand(command: string, targetPlatform?: Platform): string {
  const { platform: current } = detectPlatform();
  const target = targetPlatform || current;

  if (target === "windows" && current !== "windows") {
    // Convert Unix commands to Windows
    return command
      .replace(/\bls\b/g, "dir")
      .replace(/\bcat\b/g, "type")
      .replace(/\bcurl\b/g, "curl")
      .replace(/\brm -rf\b/g, "rmdir /s /q")
      .replace(/\bcp\b/g, "copy")
      .replace(/\bmv\b/g, "move")
      .replace(/\bchmod\b/g, "icacls")
      .replace(/\bgrep\b/g, "findstr")
      .replace(/\b\/bin\/(bash|sh|zsh)\b/g, "cmd.exe")
      .replace(/\b\/usr\/bin\/env\b/g, "");
  }

  if ((target === "linux" || target === "macos") && current === "windows") {
    // Convert Windows commands to Unix
    return command
      .replace(/\bdir\b/gi, "ls")
      .replace(/\btype\b/gi, "cat")
      .replace(/\bcopy\b/gi, "cp")
      .replace(/\bmove\b/gi, "mv")
      .replace(/\bdel\b/gi, "rm")
      .replace(/\bfindstr\b/gi, "grep");
  }

  return command;
}

/**
 * Get platform-appropriate paths
 */
export function getPlatformPath(type: "config" | "data" | "cache" | "temp", appName: string = "viclaw"): string {
  const home = osHomedir();
  const temp = osTmpdir();

  const isWin = osPlatform() === "win32";
  const isMac = osPlatform() === "darwin";

  switch (type) {
    case "config":
      if (isWin) return pathJoin(process.env.APPDATA || pathJoin(home, "AppData", "Roaming"), appName);
      if (isMac) return pathJoin(home, "Library", "Application Support", appName);
      return pathJoin(process.env.XDG_CONFIG_HOME || pathJoin(home, ".config"), appName);

    case "data":
      if (isWin) return pathJoin(process.env.LOCALAPPDATA || pathJoin(home, "AppData", "Local"), appName, "data");
      if (isMac) return pathJoin(home, "Library", appName, "data");
      return pathJoin(process.env.XDG_DATA_HOME || pathJoin(home, ".local", "share"), appName);

    case "cache":
      if (isWin) return pathJoin(process.env.LOCALAPPDATA || pathJoin(home, "AppData", "Local"), appName, "cache");
      if (isMac) return pathJoin(home, "Library", "Caches", appName);
      return pathJoin(process.env.XDG_CACHE_HOME || pathJoin(home, ".cache"), appName);

    case "temp":
      return pathJoin(temp, appName);

    default:
      return pathJoin(temp, appName);
  }
}
