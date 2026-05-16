/**
 * Permission System Extension — Type Definitions
 */

/** 风险等级 L0-L4 */
export type RiskLevel = "L0" | "L1" | "L2" | "L3" | "L4";

/** 权限模式 */
export type PermissionMode =
  | "allow-all"      // 全部放行
  | "ask-write"      // 写入时询问
  | "ask-dangerous"  // 危险操作时询问（默认）
  | "ask-all"        // 全部询问
  | "deny-all"       // 全部拒绝
  | "custom";        // 自定义（由规则引擎决定）

/** 权限决策 */
export type PermissionDecision = "allow" | "deny";

/** 决策作用域 */
export type DecisionScope = "once" | "session" | "always";

/** 非交互模式下的默认行为 */
export type NonInteractiveAction = "allow" | "block" | "fail";

/** 权限请求上下文 */
export interface PermissionRequest {
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: RiskLevel;
  command?: string;
  path?: string;
  cwd: string;
  /** Terminal-friendly diff preview (for write/edit tools) */
  diffPreview?: string;
}

/** 权限决策结果 */
export interface PermissionResult {
  decision: PermissionDecision;
  scope?: DecisionScope;
  ruleId?: string;
  reason?: string;
}

/** 规则条件操作符 */
export type RuleOperator =
  | "equals"
  | "contains"
  | "regex"
  | "startsWith"
  | "endsWith";

/** 规则条件字段 */
export type RuleField =
  | "toolName"
  | "command"
  | "path"
  | "riskLevel";

/** 规则条件 */
export interface RuleCondition {
  field: RuleField;
  operator: RuleOperator;
  value: string | number;
}

/** 规则作用域 */
export type RuleScope = "global" | "project" | "session";

/** 规则来源 */
export type RuleSource = "user" | "implicit" | "config";

/** 权限规则 */
export interface PermissionRule {
  id: string;
  name: string;
  priority: number;
  action: PermissionDecision;
  conditions: RuleCondition[];
  scope: RuleScope;
  source: RuleSource;
  createdAt: number;
  expiresAt?: number;
  hitCount?: number;
}

/** 模式匹配配置（bash 命令风险等级判定） */
export interface BashPatterns {
  critical: string[];
  high: string[];
  medium: string[];
}

/** 完整权限配置 */
export interface PermissionConfig {
  enabled: boolean;
  mode: PermissionMode;
  defaultAction: NonInteractiveAction;
  rememberDecisions: boolean;
  maxRememberedRules: number;
  quietMode: boolean;
  riskOverrides: Partial<Record<string, RiskLevel>>;
  bashPatterns: BashPatterns;
  sensitivePaths: string[];
  protectedPaths: string[];
  allowedPaths: string[];
  trustedCommands: string[];
  blockedCommands: string[];
}

/** 默认配置常量 */
export const DEFAULT_CONFIG: PermissionConfig = {
  enabled: true,
  mode: "ask-dangerous",
  defaultAction: "block",
  rememberDecisions: true,
  maxRememberedRules: 100,
  quietMode: false,
  riskOverrides: {},
  bashPatterns: {
    critical: [
      "^rm\\s+(-rf?|--recursive)",
      "^sudo\\s+",
      "^chmod\\s+.*777",
      "^chown\\s+.*777",
      "^dd\\s+if=",
      "^mkfs\\.",
      "^wall\\s+",
      ">\\s*/dev/(?!null)",
    ],
    high: [
      "curl\\s+(-o|--output|-O)",
      "wget\\s+(-o|--output|-O)",
      "npm\\s+(install|add|publish|uninstall)",
      "yarn\\s+(add|publish|remove)",
      "pnpm\\s+(add|publish|remove)",
      "git\\s+push",
      "git\\s+reset.*--hard",
      "apt\\s+(install|remove|update|upgrade)",
      "yum\\s+(install|remove|update|upgrade)",
      "brew\\s+(install|remove|update|upgrade)",
      "pacman\\s+(install|remove|update|upgrade)",
      "docker\\s+(rm|rmi|build|push|exec|run)",
      "kill\\s+",
      "pip\\s+(install|uninstall)",
      "gem\\s+(install|uninstall)",
      "cargo\\s+(install|uninstall|publish)",
      "cp\\s+-[rf].*\\s+/[^\\s]*",
      "mv\\s+.*\\s+/[^\\s]*",
    ],
    medium: [
      "npm\\s+(run|test|build|start)",
      "git\\s+commit",
      "git\\s+checkout\\s+",
      "git\\s+merge",
      "git\\s+rebase",
      "git\\s+stash",
      "docker\\s+(up|start|restart)",
      "docker-compose\\s+(up|start|restart)",
      "make\\s+",
      "cargo\\s+(build|test|check)",
      "npx\\s+",
    ],
  },
  sensitivePaths: [
    ".env*",
    "*.pem",
    "*.key",
    "credentials*",
    "**/secrets/**",
    "**/config/production*",
  ],
  protectedPaths: [
    ".git/*",
  ],
  allowedPaths: [
    "src/**",
    "test/**",
    "*.md",
    "*.json",
    "*.ts",
    "*.tsx",
    "*.js",
    "*.jsx",
    "*.css",
    "*.html",
  ],
  trustedCommands: [
    "^npm\\s+run\\s+(dev|start|test|build)$",
    "^git\\s+status$",
    "^ls\\s+",
    "^cat\\s+",
    "^cd\\s+",
    "^echo\\s+",
    "^mkdir\\s+-p\\s+",
    "^pwd$",
    "^which\\s+",
    "^type\\s+",
    "^file\\s+",
    "^head\\s+",
    "^tail\\s+",
    "^wc\\s+",
    "^date\\s*$",
  ],
  blockedCommands: [
    "^rm\\s+-rf\\s+/$",
    "^sudo\\s+rm\\s+-rf\\s+/$",
    "^dd\\s+if=.*\\s+of=/dev/sd",
  ],
};

/** 风险等级颜色映射 */
export const RISK_COLORS: Record<RiskLevel, string> = {
  L0: "success",   // 绿色
  L1: "muted",     // 灰色
  L2: "warning",   // 黄色/橙色
  L3: "error",     // 红色
  L4: "error",     // 深红（加粗）
};

/** 风险等级标签 */
export const RISK_LABELS: Record<RiskLevel, string> = {
  L0: "SAFE",
  L1: "LOW",
  L2: "MEDIUM",
  L3: "HIGH",
  L4: "CRITICAL",
};

/** 权限模式描述 */
export const MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
  "allow-all": "Allow all tool calls without confirmation",
  "ask-write": "Ask for write operations (write, edit), allow reads",
  "ask-dangerous": "Ask for dangerous operations (bash with risky commands)",
  "ask-all": "Ask for every tool call",
  "deny-all": "Deny all tool calls except read-only ones",
  "custom": "Custom rules based permission",
};
