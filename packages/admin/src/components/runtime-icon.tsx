import type { ComponentType, CSSProperties } from "react";
import ClaudeCode from "@lobehub/icons/es/ClaudeCode";
import Codex from "@lobehub/icons/es/Codex";
import Cursor from "@lobehub/icons/es/Cursor";
import Grok from "@lobehub/icons/es/Grok";
import OpenCode from "@lobehub/icons/es/OpenCode";
import type { RuntimeCatalogEntry } from "../api";
import { useTheme } from "../theme";

type LobeIconComponent = ComponentType<{
  className?: string;
  size?: number | string;
  style?: CSSProperties;
}>;

interface RuntimeIconSpec {
  dark: LobeIconComponent;
  light: LobeIconComponent;
}

const runtimeIconSpecs: Record<string, RuntimeIconSpec> = {
  "claude-code": { light: ClaudeCode.Color, dark: ClaudeCode },
  codex: { light: Codex.Color, dark: Codex },
  cursor: { light: Cursor, dark: Cursor },
  grok: { light: Grok, dark: Grok },
  opencode: { light: OpenCode, dark: OpenCode },
};

export const runtimeDescriptions: Record<string, string> = {
  "claude-code": "Stateless Claude Code sessions.",
  codex: "Pooled Codex app-server runtime.",
  opencode: "OpenCode daemon runtime.",
  grok: "Grok Build ACP runtime.",
  cursor: "Cursor ACP runtime.",
};

export function RuntimeIcon({ runtime, className = "" }: { runtime: RuntimeCatalogEntry; className?: string }) {
  const { theme } = useTheme();
  const spec = runtimeIconSpecs[runtime.id] ?? runtimeIconSpecs.opencode;
  const Icon = theme === "dark" ? spec.dark : spec.light;
  return (
    <span aria-hidden="true" className={`runtime-icon-frame ${className}`}>
      <Icon className="runtime-icon-glyph" size="100%" />
    </span>
  );
}

export function detectedPath(runtime?: RuntimeCatalogEntry): string {
  if (!runtime?.detection.detected) return "";
  return runtime.detection.path;
}
