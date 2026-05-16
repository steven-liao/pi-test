/**
 * Permission System Extension — Risk Classification Engine
 *
 * Classifies tool calls into risk levels (L0-L4) based on:
 *   - Tool name
 *   - Command content (for bash)
 *   - File path (for write/edit)
 *   - User-defined overrides
 */

import { relative, resolve } from "node:path";
import type { RiskLevel, PermissionConfig, BashPatterns } from "./types.ts";
import { minimatch } from "./utils.ts";

// ──────────────────────────────────────────────
// 工具基础风险映射
// ──────────────────────────────────────────────

const TOOL_BASE_RISK: Record<string, RiskLevel> = {
  read: "L0",
  grep: "L0",
  find: "L0",
  ls: "L0",
  write: "L2",
  edit: "L2",
  bash: "L3",
};

// ──────────────────────────────────────────────
// 关键路径模式
// ──────────────────────────────────────────────

const SYSTEM_PATH_PATTERNS = [
  "/etc/**",
  "/usr/bin/**",
  "/usr/local/bin/**",
  "/usr/lib/**",
  "/bin/**",
  "/sbin/**",
  "/boot/**",
  "/dev/**",
  "/proc/**",
  "/sys/**",
];

const CONFIG_FILE_NAMES = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "credentials*",
  "*.cred",
  "id_rsa*",
  "id_ed25519*",
  ".netrc",
  ".pgpass",
];

// ──────────────────────────────────────────────
// 路径匹配辅助
// ──────────────────────────────────────────────

function matchesAnyGlob(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(path, pattern, { dot: true, matchBase: false }));
}

/** 规范化路径为相对 cwd 的形式，便于模式匹配 */
function normalizePath(targetPath: string, cwd: string): string {
  const abs = resolve(cwd, targetPath);
  const rel = relative(cwd, abs);
  // 如果路径在 cwd 外部，保留绝对路径的特殊标记
  if (rel.startsWith("..")) {
    return abs;
  }
  return rel;
}

// ──────────────────────────────────────────────
// bash 命令风险判定
// ──────────────────────────────────────────────

/** 测试命令是否匹配模式列表（任意一个匹配即可） */
function matchesAnyPattern(command: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    try {
      const regex = new RegExp(pattern, "i");
      return regex.test(command);
    } catch {
      return command.toLowerCase().includes(pattern.toLowerCase());
    }
  });
}

/** 对 bash 命令进行风险评级 */
function classifyBashCommandRisk(command: string, patterns: BashPatterns): RiskLevel {
  // 1. 检查信任命令（L0）
  // (信任命令由调用方在更高层级处理)

  // 2. 检查严重风险模式（L4）
  if (matchesAnyPattern(command, patterns.critical)) {
    return "L4";
  }

  // 3. 检查高风险模式（L3）
  if (matchesAnyPattern(command, patterns.high)) {
    return "L3";
  }

  // 4. 检查中风险模式（L2）
  if (matchesAnyPattern(command, patterns.medium)) {
    return "L2";
  }

  // 5. 普通命令 → L1
  return "L1";
}

// ──────────────────────────────────────────────
// 文件路径风险判定
// ──────────────────────────────────────────────

/** 对文件路径进行风险评级 */
function classifyPathRisk(targetPath: string, cwd: string, config: PermissionConfig): RiskLevel {
  const normalized = normalizePath(targetPath, cwd);

  // 1. 白名单路径 → 降级为 L1
  if (matchesAnyGlob(normalized, config.allowedPaths)) {
    return "L1";
  }

  // 2. 受保护路径 → L4（由调用方决定阻止与否）
  if (matchesAnyGlob(normalized, config.protectedPaths)) {
    return "L4";
  }

  // 3. 敏感路径 → L3
  if (matchesAnyGlob(normalized, config.sensitivePaths)) {
    return "L3";
  }

  // 4. 系统路径 → L3
  if (matchesAnyGlob(normalized, SYSTEM_PATH_PATTERNS)) {
    return "L3";
  }

  // 5. 配置文件名 → L3
  const fileName = normalized.split(/[/\\]/).pop() ?? normalized;
  if (matchesAnyGlob(fileName, CONFIG_FILE_NAMES)) {
    return "L3";
  }

  // 6. 默认 → L2（普通文件写入）
  return "L2";
}

// ──────────────────────────────────────────────
// 对外接口
// ──────────────────────────────────────────────

/**
 * 分类一个工具调用的风险等级
 *
 * @param toolName 工具名称
 * @param args 工具参数
 * @param cwd 当前工作目录
 * @param config 权限配置
 * @returns 风险等级
 */
export function classifyToolRisk(
  toolName: string,
  args: Record<string, unknown>,
  cwd: string,
  config: PermissionConfig,
): RiskLevel {
  // 1. 用户自定义风险覆盖
  const override = config.riskOverrides[toolName];
  if (override) return override;

  // 2. 获取基础风险等级
  const baseRisk = TOOL_BASE_RISK[toolName] ?? "L1";

  // 3. 根据工具类型进行动态判定
  switch (toolName) {
    case "bash": {
      const command = (args.command as string) ?? "";
      if (!command.trim()) return "L0";

      // 检查信任命令
      if (matchesAnyPattern(command, config.trustedCommands)) {
        return "L0";
      }

      // 检查阻止命令
      if (matchesAnyPattern(command, config.blockedCommands)) {
        return "L4";
      }

      return classifyBashCommandRisk(command, config.bashPatterns);
    }

    case "write":
    case "edit": {
      const path = (args.path as string) ?? "";
      if (!path) return baseRisk;
      return classifyPathRisk(path, cwd, config);
    }

    default:
      return baseRisk;
  }
}

/**
 * 检查风险等级是否需要用户确认
 *
 * @param level 风险等级
 * @param mode 权限模式
 * @returns 是否需要确认
 */
export function needsConfirmation(level: RiskLevel, mode: string): boolean {
  switch (mode) {
    case "allow-all":
      return false;

    case "ask-write":
      // L2+ 需要确认
      return level === "L2" || level === "L3" || level === "L4";

    case "ask-dangerous":
      // L3+ 需要确认
      return level === "L3" || level === "L4";

    case "ask-all":
      // L1+ 需要确认（L0 始终放行）
      return level !== "L0";

    case "deny-all":
      // 全部需要检查（但不等于全部需要确认）
      return level !== "L0";

    case "custom":
      // 自定义模式由规则引擎决定
      return true;

    default:
      return level === "L3" || level === "L4";
  }
}
