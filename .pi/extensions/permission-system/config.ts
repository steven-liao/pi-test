/**
 * Permission System Extension — Configuration
 *
 * Loads and merges configuration from:
 *   1. Built-in defaults (types.ts)
 *   2. Global settings (~/.pi/agent/settings.json → extensions.permission-system)
 *   3. Project settings (.pi/settings.json → extensions.permission-system)
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  PermissionConfig,
  PermissionMode,
  NonInteractiveAction,
  BashPatterns,
} from "./types.ts";
import { DEFAULT_CONFIG } from "./types.ts";

/** 合并两个配置对象（深度合并 bashPatterns） */
function mergeConfig(base: PermissionConfig, override: Partial<PermissionConfig>): PermissionConfig {
  return {
    ...base,
    ...override,
    // bashPatterns 需要深度合并
    bashPatterns: override.bashPatterns
      ? {
          critical: [...(override.bashPatterns.critical ?? base.bashPatterns.critical)],
          high: [...(override.bashPatterns.high ?? base.bashPatterns.high)],
          medium: [...(override.bashPatterns.medium ?? base.bashPatterns.medium)],
        }
      : base.bashPatterns,
    // 数组字段替换而非合并
    sensitivePaths: override.sensitivePaths ?? base.sensitivePaths,
    protectedPaths: override.protectedPaths ?? base.protectedPaths,
    allowedPaths: override.allowedPaths ?? base.allowedPaths,
    trustedCommands: override.trustedCommands ?? base.trustedCommands,
    blockedCommands: override.blockedCommands ?? base.blockedCommands,
  };
}

/** 尝试从 JSON 文件中读取 settings 片段 */
async function tryReadSettingsSection(configPath: string): Promise<Partial<PermissionConfig> | null> {
  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;

    // 从 extensions.permission-system 读取
    const extensions = parsed.extensions as Record<string, unknown> | undefined;
    if (extensions?.permissionSystem) {
      return extensions.permissionSystem as Partial<PermissionConfig>;
    }
    // 兼容 camelCase
    if (extensions?.["permission-system"]) {
      return extensions["permission-system"] as Partial<PermissionConfig>;
    }

    return null;
  } catch {
    return null;
  }
}

/** 加载并合并完整的配置 */
export async function loadConfig(cwd: string): Promise<PermissionConfig> {
  let config: PermissionConfig = { ...DEFAULT_CONFIG };

  // 1. 全局配置 ~/.pi/agent/settings.json
  const globalSettingsPath = join(homedir(), ".pi", "agent", "settings.json");
  const globalOverride = await tryReadSettingsSection(globalSettingsPath);
  if (globalOverride) {
    config = mergeConfig(config, globalOverride);
  }

  // 2. 项目配置 .pi/settings.json
  const projectSettingsPath = resolve(cwd, ".pi", "settings.json");
  const projectOverride = await tryReadSettingsSection(projectSettingsPath);
  if (projectOverride) {
    config = mergeConfig(config, projectOverride);
  }

  return config;
}

/** 校验权限模式 */
export function isValidMode(mode: string): mode is PermissionMode {
  return ["allow-all", "ask-write", "ask-dangerous", "ask-all", "deny-all", "custom"].includes(mode);
}

/** 校验非交互模式行为 */
export function isValidNonInteractiveAction(action: string): action is NonInteractiveAction {
  return ["allow", "block", "fail"].includes(action);
}

/** 输出人类可读的配置摘要 */
export function configSummary(config: PermissionConfig): string {
  const parts: string[] = [];
  parts.push(`mode: ${config.mode}`);
  if (config.quietMode) parts.push("quiet");
  parts.push(`non-interactive: ${config.defaultAction}`);
  return parts.join(", ");
}
