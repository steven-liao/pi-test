# Permission System Extension — 技术设计文档

## 1. 概述

本文档设计一个 pi coding agent extension，实现类似 Claude Code 的权限系统（Permission System）。该扩展在 agent 调用具有风险的工具（如写文件、执行危险 shell 命令）时，先征求用户的同意，并提供灵活的权限管理模式。

### 1.1 参考实现

- Claude Code 的 Permission System（基于 risk level 的权限控制）
- pi 内置示例：[permission-gate.ts](../examples/extensions/permission-gate.ts)
- pi 内置示例：[protected-paths.ts](../examples/extensions/protected-paths.ts)
- pi 内置示例：[confirm-destructive.ts](../examples/extensions/confirm-destructive.ts)

### 1.2 核心理念

| 概念 | 说明 |
|------|------|
| **Risk Level** | 每个工具调用根据其操作的风险程度被划分为一个风险等级 |
| **Permission Mode** | 用户设定的全局权限策略，决定哪些 Risk Level 需要确认 |
| **Rule** | 用户自定义的精细化规则（允许/拒绝特定命令、路径、模式） |
| **Session Decision** | 用户在一次会话中做出的选择（"本次允许"vs"始终允许"） |

---

## 2. 目标

### 2.1 功能目标

1. **风险分级拦截**：在 tool 执行前，根据风险等级决定是否需要用户确认
2. **多种权限模式**：提供预设的权限模式（宽松、默认、严格、自定义）
3. **用户交互**：通过 TUI 对话框征求用户同意，支持"允许一次""本次会话允许""始终允许/拒绝"
4. **自定义规则**：支持用户定义精细化的允许/拒绝规则（如特定命令、文件路径、模式匹配）
5. **状态持久化**：用户的选择在会话重启后仍能恢复
6. **命令管理**：提供 `/permission` 命令查看和修改权限设置
7. **非交互模式降级**：在 print/json/RPC 模式下，根据配置决定默认行为（允许、拒绝或报错）

### 2.2 非功能目标

1. **低侵入性**：在不必要的场景下不打断用户工作流
2. **可配置性**：所有行为均可通过 settings.json 配置
3. **可扩展性**：支持第三方扩展注册自定义的风险评估逻辑
4. **安全性**：默认拒绝高风险操作
5. **性能**：权限判定在微秒级完成，不阻塞工具执行流程

---

## 3. 整体架构

### 3.1 模块结构

```
permission-system/
├── index.ts                  # 扩展入口，注册事件、命令、工具
├── risk-classifier.ts        # 风险分类引擎
├── permission-store.ts       # 权限状态存储（Session + Persistent）
├── rule-engine.ts            # 自定义规则引擎
├── dialogs.ts                # TUI 交互对话框
├── config.ts                 # 配置定义与加载
├── types.ts                  # 类型定义
└── risk-profiles/
    ├── default.ts            # 默认风险配置文件
    └── strict.ts             # 严格模式风险配置文件
```

### 3.2 数据流

```
┌──────────────┐      tool_call event       ┌──────────────────┐
│   LLM Model  │ ─────────────────────────►  │  Permission Ext  │
│  (calls tool) │                            │                  │
└──────────────┘                             │  1. Risk Classify │
      ▲                                      │  2. Rule Check   │
      │                                      │  3. Mode Check   │
      │                                      │  4. Ask User?    │
      │                                      └──────┬───────────┘
      │                                             │
      │                                     ┌───────▼───────────┐
      │                                     │    Needs Confirm? │
      │                                     │                   │
      │                                     │  No: allow pass   │
      │                                     │  Yes: show dialog │
      │                                     └───────┬───────────┘
      │                                             │
      │                                     ┌───────▼───────────┐
      │    tool_execution                    │  User Decision    │
      │ ◄─────────────────────────────────   │  ┌─────────────┐ │
      │                                     │  │ Allow Once   │ │
      │                                     │  │ Allow Session│ │
      │                                     │  │ Always Allow │ │
      │                                     │  │ Deny         │ │
      │                                     │  │ Always Deny  │ │
      │                                     │  └─────────────┘ │
      │                                     └──────────────────┘
```

### 3.3 核心事件 Hook

利用 pi 的 `tool_call` 事件进行拦截，该事件在 tool 执行前触发，支持返回 `{ block: true, reason }` 来阻止执行。

```typescript
pi.on("tool_call", async (event, ctx) => {
  // 1. 解析工具和参数
  // 2. 风险分类
  // 3. 规则匹配
  // 4. 权限决策
  // 5. 如需确认则弹出对话框
  // 6. 返回 block / allow
});
```

---

## 4. 风险分类模型

### 4.1 风险等级定义

| 等级 | 名称 | 颜色 | 说明 |
|------|------|------|------|
| `L0` | **None** | 绿色 | 无风险，不需要任何权限检查 |
| `L1` | **Low** | 黄色 | 低风险，读取操作等（如 `read`、`ls` 但涉及敏感路径） |
| `L2` | **Medium** | 橙色 | 中风险，文件写入（`write`、`edit`） |
| `L3` | **High** | 红色 | 高风险，有副作用的命令（`bash` 中的安装、构建、部署等） |
| `L4` | **Critical** | 深红 | 严重风险，破坏性命令（`rm -rf`、`sudo`、`chmod 777`、Dangerous patterns） |

### 4.2 默认风险映射

| 工具 | 默认风险等级 | 判定依据 |
|------|-------------|---------|
| `read` | `L0` | 始终安全 |
| `grep` | `L0` | 只读搜索 |
| `find` | `L0` | 只读搜索 |
| `ls` | `L0` | 只读列出 |
| `write` | `L2` | 创建/覆写文件 |
| `edit` | `L2` | 修改文件 |
| `bash` | `L3` | 执行命令（根据命令内容动态判定） |

### 4.3 bash 命令的动态风险判定

bash 命令需要根据命令内容动态判定风险等级：

```typescript
// 匹配模式 → 风险等级提升
const CRITICAL_PATTERNS = [
  /\brm\s+(-rf?|--recursive)\b/,       // rm -rf
  /\bsudo\b/,                            // sudo
  /\b(chmod|chown)\b.*777/,             // chmod 777
  /\bdd\s+if=/,                          // dd
  /\bmkfs\b/,                            // 格式化
  /\bwall\b/,                            // 广播
  /\b>:?\s*\//,                          // 重定向到根
  /\b(?:>|>>)\s*\/dev\/(?!null)/,       // 写入非 null 设备
];

const HIGH_PATTERNS = [
  /\b(?:curl|wget)\s+(?:-o|--output|-O)\b/,  // 下载文件
  /\b(?:npm|yarn|pnpm)\s+(?:install|add|publish)\b/,  // 包管理写操作
  /\bgit\s+push\b/,                        // git push
  /\bgit\s+reset\b.*--hard/,              // git reset --hard
  /\b(?:apt|yum|brew|pacman)\s+(?:install|remove|update|upgrade)\b/,  // 系统包管理
  /\bdocker\s+(?:rm|rmi|build|push|exec)\b/,  // docker 操作
  /\bkill\b/,                              // kill 进程
  /\b(?:pip|gem|cargo)\s+(?:install|publish)\b/,  // 语言包管理写操作
  /\b(?:cp|mv)\s+(?:-f|--force)?\s*\S+\s+(?:\/|\/[^\s]*)$/,  // 复制/移动文件到系统目录
];

const MEDIUM_PATTERNS = [
  /\bnpm\s+(?:run|test|build)\b/,          // npm scripts
  /\bgit\s+commit\b/,                      // git commit
  /\bgit\s+checkout\b/,                    // git checkout
  /\b(?:docker|docker-compose)\s+(?:up|start|restart)\b/,  // docker start
  /\bmake\b/,                              // make
  /\bcargo\s+(?:build|test|check)\b/,      // cargo build
];
```

### 4.4 文件路径风险判定

对于 `write` 和 `edit` 工具，根据目标路径判定风险：

| 路径特征 | 风险提升 | 示例 |
|----------|---------|------|
| 系统关键文件 | `L2→L3` | `/etc/`, `/usr/bin/` |
| 配置文件 | `L2→L3` | `.env`, `*.pem`, `credentials.*` |
| node_modules | `L2→L1` | 一般不关心修改 |
| 构建产物目录 | `L2→L1` | `dist/`, `build/`, `out/` |
| git 内部文件 | `L2→L3` | `.git/` 下的文件 |

---

## 5. 权限模式

### 5.1 预设模式

| 模式 | 说明 | 行为 |
|------|------|------|
| `allow-all` | 允许所有 | 所有工具直接执行，不弹出任何确认 |
| `ask-write` | 写入时询问 | L0-L1 直接允许，L2+ 需要确认 |
| `ask-dangerous` | 危险操作时询问（默认） | L0-L2 直接允许，L3+ 需要确认 |
| `ask-all` | 全部询问 | 所有非 L0 工具都需要确认 |
| `deny-all` | 全部拒绝 | 所有非只读工具被拒绝（只读模式） |
| `custom` | 自定义 | 用户通过规则进行精细化配置 |

### 5.2 模式切换

通过以下方式切换模式：

```bash
# 命令
/permission mode ask-write

# 快捷键
Ctrl+P 后切换权限模式? (待定)

# 配置文件
~/.pi/agent/settings.json
{
  "extensions": {
    "permission-system": {
      "mode": "ask-dangerous",
      ...
    }
  }
}
```

---

## 6. 用户交互设计

### 6.1 权限确认对话框

当需要用户确认时，弹出如下对话：

```
╔════════════════════════════════════════════════╗
║  ⚠️  Permission Required                       ║
║                                                ║
║  Tool:  bash                                   ║
║  Risk:  CRITICAL (L4)                         ║
║                                                ║
║  Command:                                      ║
║  $ rm -rf /var/log/*                           ║
║                                                ║
║  ┌──────────────────────────────────────────┐  ║
║  │  [1] Allow Once                          │  ║
║  │  [2] Allow for This Session              │  ║
║  │  [3] Always Allow This Command           │  ║
║  │  [4] Always Allow This Tool              │  ║
║  │  [5] Deny Once                           │  ║
║  │  [6] Always Deny This Command            │  ║
║  └──────────────────────────────────────────┘  ║
║                                                ║
║  ↑↓ navigate • Enter to select • Esc to deny  ║
╚════════════════════════════════════════════════╝
```

### 6.2 简化的快速确认（L3 风险）

对于 L3（High）级别，提供简化对话框：

```
╔════════════════════════════════════════════════╗
║  ⚠️  Run command?   [Y]es  [N]o  [A]lways     ║
║                                                ║
║  $ npm install express cors                    ║
╚════════════════════════════════════════════════╝
```

### 6.3 通知方式

- **允许时静默**：工具正常执行，在工具输出行显示绿色 `✓ allowed`
- **拒绝时通知**：显示警告通知 `ctx.ui.notify("Blocked: ...", "warning")`
- **风险提示**：在工具执行时，用颜色标识风险等级

### 6.4 自定义渲染

利用 pi 的 `renderCall` / `renderResult` 为工具调用添加风险等级标识：

```typescript
// 在工具调用行显示风险等级
renderCall(args, theme, context) {
  const riskLevel = getRiskLevel(event.toolName, args);
  const badge = riskBadge(riskLevel, theme); // 如 [CRITICAL]
  return new Text(`${badge} ${toolName} ${args}`, 0, 0);
}
```

---

## 7. 规则引擎

### 7.1 规则定义

```typescript
interface PermissionRule {
  id: string;                    // 唯一 ID
  name: string;                  // 人类可读名称
  priority: number;              // 优先级（数字越大越优先）
  action: "allow" | "deny";     // 允许或拒绝
  conditions: RuleCondition[];   // 匹配条件（AND 逻辑）
  scope: "global" | "project" | "session";  // 作用域
  expiresAt?: number;            // 过期时间戳
}

interface RuleCondition {
  field: "toolName" | "command" | "path" | "pattern" | "riskLevel";
  operator: "equals" | "contains" | "regex" | "startsWith" | "endsWith" | "gte" | "lte";
  value: string | number;
}
```

### 7.2 规则示例

```json
{
  "id": "rule-001",
  "name": "Allow npm install",
  "priority": 100,
  "action": "allow",
  "conditions": [
    { "field": "toolName", "operator": "equals", "value": "bash" },
    { "field": "command", "operator": "regex", "value": "^npm\\s+install" }
  ],
  "scope": "session",
  "expiresAt": null
}
```

### 7.3 规则匹配优先级

1. 显式规则（用户定义的 `allow`/`deny` 规则）— 按 priority 排序
2. 会话决策（"本次会话允许"）— 优先级次于显式规则
3. 权限模式（`ask-dangerous` 等）— 兜底
4. 默认行为（未匹配任何规则时）— 根据风险等级和模式决定

### 7.4 自动生成的隐式规则

当用户选择"Always Allow This Command"时，自动生成一条隐式规则：

```json
{
  "id": "implicit-allow-command-xxx",
  "name": "Always allow: npm install express",
  "priority": 50,
  "action": "allow",
  "conditions": [
    { "field": "toolName", "operator": "equals", "value": "bash" },
    { "field": "command", "operator": "contains", "value": "npm install express" }
  ],
  "scope": "project"
}
```

---

## 8. 状态管理

### 8.1 状态存储策略

| 数据类型 | 存储方式 | 持久化 | 说明 |
|----------|---------|--------|------|
| 权限模式 | `pi.appendEntry("permission-state", ...)` | ✅ | 跨会话持久化 |
| 显式规则 | `pi.appendEntry("permission-rule", ...)` | ✅ | 跨会话持久化 |
| 会话决策 | 内存 Map | ❌ | 仅当前会话有效 |
| 隐式规则（全局/项目） | `pi.appendEntry("permission-rule", ...)` | ✅ | 跨会话持久化 |

### 8.2 状态恢复流程

```typescript
pi.on("session_start", async (_event, ctx) => {
  // 1. 清空运行时状态
  permissionStore.reset();
  
  // 2. 遍历 session entries，恢复持久化状态
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom") continue;
    
    if (entry.customType === "permission-state") {
      permissionStore.restoreMode(entry.data);
    }
    if (entry.customType === "permission-rule") {
      ruleEngine.addRule(entry.data);
    }
  }
  
  // 3. 加载全局配置
  await loadConfig();
});
```

### 8.3 状态扩散（Branching 支持）

利用 pi 的 Session 分支特性，工具执行结果中的 `details` 包含权限决策信息，确保在 `/tree` 导航或 `/fork` 时权限状态正确：

```typescript
// 在 tool_result 事件中附加权限信息
pi.on("tool_result", async (event, ctx) => {
  return {
    details: {
      ...event.details,
      permission: {
        riskLevel: "L3",
        decision: "allowed_once",
        ruleId: "implicit-allow-command-xxx",
      }
    }
  };
});
```

---

## 9. 配置定义

### 9.1 配置文件结构

```jsonc
// ~/.pi/agent/settings.json 或 .pi/settings.json
{
  "extensions": {
    "permission-system": {
      "enabled": true,
      "mode": "ask-dangerous",           // 权限模式
      "defaultAction": "block",          // 非交互模式下的默认行为: "allow" | "block" | "fail"
      "rememberDecisions": true,         // 是否记住"始终允许/拒绝"
      "maxRememberedRules": 100,         // 最大记住规则数
      "quietMode": false,                // 静默模式（只通知，不弹框）
      
      // 自定义风险映射（覆盖默认）
      "riskOverrides": {
        "write": "L1",                   // 将 write 降级为低风险
        "bash": "L4"                     // 将 bash 提升为严重风险
      },
      
      // 自定义风险模式
      "bashPatterns": {
        "critical": [
          "^rm\\s+-rf",
          "^sudo\\s+"
        ],
        "high": [
          "^npm\\s+(install|add)",
          "^git\\s+push"
        ],
        "medium": [
          "^npm\\s+run",
          "^git\\s+commit"
        ]
      },
      
      // 敏感路径
      "sensitivePaths": [
        ".env*",
        "*.pem",
        "credentials*",
        "**/secrets/**"
      ],
      
      // 受保护路径（始终拒绝写入）
      "protectedPaths": [
        ".git/*",
        "node_modules/**"  // 可以写入但需要确认
      ],
      
      // 白名单路径（始终允许写入）
      "allowedPaths": [
        "src/**",
        "test/**",
        "*.md",
        "*.json"
      ],
      
      // 信任的命令（始终允许，不询问）
      "trustedCommands": [
        "^npm\\s+run\\s+(dev|start|test|build)$",
        "^git\\s+status$",
        "^ls\\s+",
        "^cat\\s+",
        "^cd\\s+",
        "^echo\\s+",
        "^mkdir\\s+-p\\s+"
      ],
      
      // 始终拒绝的命令
      "blockedCommands": [
        "^rm\\s+-rf\\s+/$",
        "^sudo\\s+rm\\s+-rf"
      ]
    }
  }
}
```

### 9.2 配置加载优先级

1. 项目级配置 `.pi/settings.json` — 最高优先级
2. 全局配置 `~/.pi/agent/settings.json`
3. 扩展内置默认值

---

## 10. 命令参考

### 10.1 `/permission` 命令

```
/permission                         # 显示当前权限状态
/permission mode <mode>             # 切换权限模式
/permission mode list               # 列出所有模式
/permission rules                   # 列出所有规则
/permission rules add <condition>   # 添加规则（交互式）
/permission rules remove <id>       # 删除规则
/permission rules clear             # 清除所有规则
/permission allow <tool> [command]  # 临时允许某个工具/命令
/permission deny <tool> [command]   # 临时拒绝某个工具/命令
/permission reset                   # 重置所有会话决策
/permission status                  # 显示详细状态
```

### 10.2 快捷键

| 快捷键 | 功能 | 上下文 |
|--------|------|--------|
| `Ctrl+G` | 暂停/继续权限检查 | 全局 |
| `Ctrl+Shift+P` | 切换权限模式 | 全局（待确认不与内置冲突） |

### 10.3 状态指示

在 footer 中显示当前权限模式：

```
┌─────────────────────────────────────────────────────┐
│ 📁 d:/project  session-abc  ⚡ ask-dangerous  🔒 2 rules │
└─────────────────────────────────────────────────────┘
```

- `⚡ ask-dangerous` — 当前权限模式
- `🔒 2 rules` — 活跃的自定义规则数

---

## 11. 实现计划

### Phase 1: 核心拦截（基础版）

实现最简单的权限门控，类似于 `permission-gate.ts` 的增强版。

```
文件: permission-system/
├── index.ts      # 入口
├── types.ts      # 类型定义
├── config.ts     # 配置加载
└── dialogs.ts    # 确认对话框
```

**功能**：
- [x] 拦截 tool_call 事件
- [x] 基础风险分类（bash 危险模式 + file write）
- [x] 简单的 confirm 对话框
- [x] config 配置
- [x] 非交互模式降级

### Phase 2: 权限模式与规则引擎

```
文件: permission-system/
├── risk-classifier.ts    # 风险分类引擎
├── permission-store.ts   # 权限状态管理
├── rule-engine.ts        # 规则引擎
└── risk-profiles/
    ├── default.ts
    └── strict.ts
```

**功能**：
- [x] 5 种权限模式
- [x] 规则引擎（条件匹配、优先级）
- [x] 会话决策（Allow Once / Allow Session）
- [x] 隐式规则生成
- [x] 持久化存储与恢复

### Phase 3: 命令与 UI 增强

```
文件: permission-system/
├── commands.ts           # /permission 命令
├── status-indicator.ts   # Footer 状态指示器
└── dialogs.ts            # 增强对话框（多选项）
```

**功能**：
- [x] `/permission` 命令系统
- [x] 多选对话框（Allow Once / Session / Always）
- [x] 风险等级标识（tool call 渲染）
- [x] Footer 状态指示

### Phase 4: 高级功能

```
文件: permission-system/
├── stats.ts              # 权限审计日志
├── allowlist-ui.ts       # 白名单管理 UI
└── policy-provider.ts    # 远程策略加载（可选）
```

**功能**：
- [x] 权限审计日志（统计被阻止/允许的操作）
- [x] 可视化规则管理
- [x] 项目级策略文件（`.pi/permissions.json`）

---

## 12. 与 pi 扩展 API 的关键集成点

### 12.1 事件集成

```typescript
import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    // bash 拦截
    if (isToolCallEventType("bash", event)) {
      return handleBashPermission(event, ctx);
    }
    
    // write/edit 拦截
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      return handleFilePermission(event, ctx);
    }
    
    // 其他工具
    return handleGenericPermission(event, ctx);
  });
}
```

### 12.2 UI 集成

```typescript
// 使用 ctx.ui.custom 实现复杂的权限对话框
const decision = await ctx.ui.custom<PermissionDecision>(
  (tui, theme, keybindings, done) => {
    // 渲染多选项权限对话框
    return component;
  },
  { overlay: true } // 浮层模式，不打断当前视图
);
```

### 12.3 状态持久化

```typescript
// 保存规则
pi.appendEntry("permission-rule", {
  id: "rule-001",
  action: "allow",
  conditions: [{ field: "command", operator: "regex", value: "^npm install" }],
  scope: "project"
});
```

### 12.4 自定义渲染

```typescript
// 为工具调用添加风险等级标识
pi.registerTool({
  name: "bash",  // 覆盖内置工具
  // ... 保持原有功能，添加自定义渲染
  renderCall(args, theme, context) {
    const risk = classifyBashRisk(args.command);
    const badge = theme.fg(risk.color, `[${risk.label}]`);
    return new Text(`${badge} bash ${args.command}`, 0, 0);
  }
});
```

### 12.5 非交互模式处理

```typescript
if (!ctx.hasUI) {
  // 非交互模式下根据配置决定行为
  switch (config.defaultAction) {
    case "allow":
      return undefined; // 放行
    case "block":
      return { block: true, reason: "Blocked by permission system (non-interactive mode)" };
    case "fail":
      throw new Error("Permission denied: requires user confirmation");
  }
}
```

---

## 13. 安全考虑

1. **规则注入**：规则条件中的 regex 需要做长度和复杂度限制，防止 ReDoS 攻击
2. **路径规范化**：所有路径需通过 `path.resolve()` 规范化后再进行匹配，防止 `../../etc/passwd` 绕过
3. **默认拒绝**：未匹配任何规则的高风险操作默认拒绝
4. **权限提升防护**：防止 agent 通过禁用扩展来绕过权限检查（需要在 agent 系统提示中明确约束）
5. **配置加密**：敏感路径模式不应泄露系统信息

---

## 14. 测试策略

| 测试类型 | 范围 | 方法 |
|----------|------|------|
| 单元测试 | 风险分类、规则匹配、权限决策 | Vitest + 纯函数测试 |
| 集成测试 | tool_call 拦截、UI 交互 | pi RPC 模式 + 模拟输入 |
| E2E 测试 | 完整权限流程 | pi interactive 模式 + 自动输入 |

---

## 15. 与 Claude Code 权限系统的对比

| 特性 | Claude Code | pi Permission Extension |
|------|-------------|------------------------|
| 风险等级 | 3 级（allow/deny/ask） | 5 级（L0-L4） |
| 权限模式 | ask/allow 开关 | 6 种预设模式 + custom |
| 自定义规则 | ❌ 不支持 | ✅ 规则引擎 |
| 路径保护 | ❌ 不支持 | ✅ 路径模式匹配 |
| 会话记忆 | ✅（部分） | ✅（完整） |
| 隐式规则 | ❌ | ✅ |
| 审计日志 | ❌ | ✅ |
| 远程策略 | ❌ | ❌（可选扩展） |

---

## 16. 附录

### 16.1 关键 TypeScript 类型定义

```typescript
// types.ts

export type RiskLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type PermissionMode =
  | "allow-all"
  | "ask-write"
  | "ask-dangerous"  // 默认
  | "ask-all"
  | "deny-all"
  | "custom";

export type PermissionDecision = "allow" | "deny";

export type DecisionScope = "once" | "session" | "always";

export interface PermissionRequest {
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: RiskLevel;
  command?: string;    // bash 命令内容
  path?: string;       // 文件路径
  cwd: string;
}

export interface PermissionResult {
  decision: PermissionDecision;
  scope?: DecisionScope;
  ruleId?: string;
  reason?: string;
}

export interface PermissionRule {
  id: string;
  name: string;
  priority: number;
  action: PermissionDecision;
  conditions: RuleCondition[];
  scope: "global" | "project" | "session";
  source: "user" | "implicit" | "config";
  createdAt: number;
  expiresAt?: number;
  hitCount?: number;
}

export interface RuleCondition {
  field: "toolName" | "command" | "path" | "riskLevel";
  operator: "equals" | "contains" | "regex" | "startsWith" | "endsWith";
  value: string | number;
}

export interface PermissionConfig {
  enabled: boolean;
  mode: PermissionMode;
  defaultAction: "allow" | "block" | "fail";
  rememberDecisions: boolean;
  maxRememberedRules: number;
  quietMode: boolean;
  riskOverrides: Partial<Record<string, RiskLevel>>;
  bashPatterns: Record<string, string[]>;
  sensitivePaths: string[];
  protectedPaths: string[];
  allowedPaths: string[];
  trustedCommands: string[];
  blockedCommands: string[];
}
```

### 16.2 参考示例

- [permission-gate.ts](../examples/extensions/permission-gate.ts) — 基础权限门控
- [protected-paths.ts](../examples/extensions/protected-paths.ts) — 路径保护
- [confirm-destructive.ts](../examples/extensions/confirm-destructive.ts) — 会话操作确认
- [question.ts](../examples/extensions/question.ts) — 自定义 UI 对话框
- [plan-mode/](../examples/extensions/plan-mode/) — 复杂扩展结构参考

---

> **文档版本**: v1.0  
> **最后更新**: 2026-05-16  
> **状态**: Draft / 待评审
