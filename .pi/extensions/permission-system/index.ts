/**
 * Permission System Extension — Entry Point
 *
 * Mimics Claude Code's permission system.
 * Intercepts tool calls, classifies risk, and prompts user for confirmation.
 *
 * Features:
 *   - 5 risk levels (L0-L4) with dynamic classification for bash/file tools
 *   - 6 permission modes (allow-all → deny-all)
 *   - Rule engine for custom allow/deny rules
 *   - Session decisions ("allow for this session")
 *   - Persistent rules ("always allow this")
 *   - Config via settings.json (global + project)
 *   - Non-interactive mode handling (allow/block/fail)
 *   - /permission command for runtime management
 *   - Footer status indicators
 */

import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";

import type {
  PermissionConfig,
  PermissionDecision,
  PermissionRule,
  RuleCondition,
  RiskLevel,
} from "./types.ts";
import { MODE_DESCRIPTIONS } from "./types.ts";
import { loadConfig, isValidMode } from "./config.ts";
import { classifyToolRisk, needsConfirmation } from "./risk-classifier.ts";
import { RuleEngine } from "./rule-engine.ts";
import { PermissionStore, type DecisionKey } from "./permission-store.ts";
import { showPermissionDialog, nonInteractiveResult } from "./dialogs.ts";
import { computeDiff, formatDiff } from "./diff.ts";

// ── Internal types ────────────────────────────

interface PermissionRequestInput {
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: RiskLevel;
  command?: string;
  path?: string;
  cwd: string;
}

// ── Extension factory ─────────────────────────

export default function (pi: ExtensionAPI) {
  // ── State ──────────────────────────────────
  let config: PermissionConfig | null = null;
  const ruleEngine = new RuleEngine();
  const store = new PermissionStore();
  let initialized = false;

  // ── Initialization ─────────────────────────

  async function ensureInit(cwd: string): Promise<void> {
    if (initialized) return;
    config = await loadConfig(cwd);
    initialized = true;
  }

  // ── Helpers ────────────────────────────────

  function buildRequest(toolName: string, args: Record<string, unknown>, cwd: string): PermissionRequestInput {
    return {
      toolName,
      args,
      riskLevel: "L0" as RiskLevel,
      command: (args.command as string) ?? undefined,
      path: (args.path as string) ?? undefined,
      cwd,
    };
  }

  function makeDecisionKey(req: PermissionRequestInput): DecisionKey {
    return {
      toolName: req.toolName,
      command: req.command,
      path: req.path,
    };
  }

  /**
   * Create an implicit rule from a user's "always allow/deny" choice.
   */
  function createImplicitRule(
    req: PermissionRequestInput,
    action: PermissionDecision,
  ): Omit<PermissionRule, "id" | "createdAt" | "hitCount"> {
    const conditions: RuleCondition[] = [
      { field: "toolName", operator: "equals" as const, value: req.toolName },
    ];

    if (req.command) {
      const preview = req.command.length > 80 ? req.command.slice(0, 80) : req.command;
      conditions.push({ field: "command", operator: "contains" as const, value: preview });
    }

    if (req.path) {
      conditions.push({ field: "path", operator: "contains" as const, value: req.path });
    }

    const label = req.command
      ? req.command.slice(0, 40)
      : req.path ?? req.toolName;

    return {
      name: `${action === "allow" ? "Allow" : "Deny"}: ${label}`,
      priority: action === "deny" ? 200 : 50, // deny rules win over allow rules
      action,
      conditions,
      scope: "project", // persisted across sessions
      source: "implicit",
      expiresAt: undefined,
    };
  }

  // ── Diff preview ─────────────────────────

  /**
   * Compute a diff preview for write/edit tool calls.
   */
  async function computeDiffPreview(
    toolName: string,
    args: Record<string, unknown>,
    _cwd: string,
  ): Promise<string | undefined> {
    try {
      if (toolName === "edit") {
        const oldText = (args.oldText as string) ?? "";
        const newText = (args.newText as string) ?? "";
        if (oldText || newText) {
          const diff = computeDiff(oldText, newText);
          if (diff.additions > 0 || diff.removals > 0) {
            return formatDiff(diff);
          }
        }
      } else if (toolName === "write") {
        const path = (args.path as string) ?? "";
        const content = (args.content as string) ?? "";
        if (path && content) {
          try {
            const { readFile } = await import("node:fs/promises");
            const existing = await readFile(path, "utf-8");
            const diff = computeDiff(existing, content);
            if (diff.additions > 0 || diff.removals > 0) {
              return formatDiff(diff);
            }
          } catch {
            // New file or can't read M-bM-^@M-^T skip diff
          }
        }
      }
    } catch {
      // Silently ignore diff errors
    }
    return undefined;
  }

  // ── Core permission check ─────────────────

  /**
   * Run the full permission check pipeline for one tool call.
   *
   * Returns `{ block: true, reason }` to block the tool, or `undefined` to allow.
   */
  async function checkPermission(
    event: ToolCallEvent,
    ctx: Parameters<Parameters<typeof pi.on>[1]>[1],
  ): Promise<{ block: boolean; reason: string } | undefined> {
    if (!config?.enabled) return undefined;

    const toolName = event.toolName;
    const args = { ...event.input } as Record<string, unknown>;
    const req = buildRequest(toolName, args, ctx.cwd);

    // 1. Classify risk
    req.riskLevel = classifyToolRisk(toolName, args, ctx.cwd, config);

    // 2. Check if confirmation needed under current mode
    if (!needsConfirmation(req.riskLevel, config.mode)) {
      return undefined; // allow
    }

    // 3. Rule engine (highest priority — user-defined explicit rules)
    const ruleResult = ruleEngine.match(req);
    if (ruleResult) {
      return ruleResult.decision === "deny"
        ? { block: true, reason: ruleResult.reason ?? "Blocked by rule" }
        : undefined;
    }

    // 4. Session decision (user said "allow/deny for this session")
    const key = makeDecisionKey(req);
    const sessionDecision = store.getSessionDecision(key);
    if (sessionDecision === "deny") return { block: true, reason: "Blocked by session decision" };
    if (sessionDecision === "allow") return undefined;

    // 5. deny-all mode — block everything ≥ L1
    if (config.mode === "deny-all") {
      return { block: true, reason: `deny-all mode blocks "${toolName}"` };
    }

    // 6. No UI → rely on non-interactive default
    if (!ctx.hasUI) {
      const result = nonInteractiveResult(ctx, req, config.defaultAction);
      return result.decision === "deny"
        ? { block: true, reason: result.reason ?? "Blocked (non-interactive)" }
        : undefined;
    }

    // 6b. Compute diff preview for write/edit tools
    req.diffPreview = await computeDiffPreview(toolName, args, ctx.cwd);

    // 7. Show permission dialog
    const choice = await showPermissionDialog(ctx, req);

    if (!choice) {
      // Esc / cancel → deny
      ctx.ui.notify("Permission denied (cancelled)", "warning");
      return { block: true, reason: "Permission cancelled by user" };
    }

    const { decision, scope } = choice;

    // 8. Apply decision
    if (decision === "deny") {
      if (scope === "session") {
        store.recordSessionDecision(key, "deny");
      } else if (scope === "always" && (req.command || req.path)) {
        const rule = createImplicitRule(req, "deny");
        ruleEngine.addRule(rule);
        store.persistRule(pi, rule);
        ctx.ui.notify(`Created deny rule: ${rule.name}`, "info");
      }
      return { block: true, reason: "Permission denied by user" };
    }

    // decision === "allow"
    if (scope === "session") {
      store.recordSessionDecision(key, "allow");
      ctx.ui.notify(`Allowed for this session: ${toolName}`, "info");
    } else if (scope === "always" && (req.command || req.path)) {
      const rule = createImplicitRule(req, "allow");
      ruleEngine.addRule(rule);
      store.persistRule(pi, rule);
      ctx.ui.notify(`Created allow rule: ${rule.name}`, "info");
    }

    return undefined; // allow
  }

  // ── Session lifecycle ─────────────────────

  pi.on("session_start", async (_event, ctx) => {
    await ensureInit(ctx.cwd);
    store.reset();

    // Restore persistent rules from session history
    if (config?.rememberDecisions) {
      const entries = ctx.sessionManager.getBranch();
      const restored = store.restoreRulesFromEntries(entries);
      ruleEngine.addRules(restored);
    }

    // Update footer status
    if (config) {
      ctx.ui.setStatus("permission-mode", `perm: ${config.mode}`);
      if (ruleEngine.ruleCount > 0) {
        ctx.ui.setStatus("permission-rules", `rules: ${ruleEngine.ruleCount}`);
      }
    }

    if (config?.enabled) {
      ctx.ui.notify(`Permission system loaded — mode: ${config.mode}`, "info");
    }
  });

  pi.on("session_shutdown", async () => {
    store.reset();
    initialized = false;
    config = null;
  });

  // ── Tool call interception ───────────────

  pi.on("tool_call", async (event, ctx) => {
    if (!config?.enabled) return undefined;

    // Only intercept tools we care about
    if (!["bash", "write", "edit", "read", "grep", "find", "ls"].includes(event.toolName)) {
      return undefined;
    }

    const args = { ...event.input } as Record<string, unknown>;

    // Quiet mode: skip L0/L1 without any overhead
    const level = classifyToolRisk(event.toolName, args, ctx.cwd, config);
    if (config.quietMode && (level === "L0" || level === "L1")) {
      return undefined;
    }

    return checkPermission(event, ctx);
  });

  // ── /permission command ─────────────────

  pi.registerCommand("permission", {
    description: "Manage permission system (mode, rules, status)",
    getArgumentCompletions: (prefix: string) => {
      const words = [
        "mode", "mode list",
        "mode allow-all", "mode ask-write", "mode ask-dangerous",
        "mode ask-all", "mode deny-all", "mode custom",
        "rules", "rules list", "rules clear",
        "reset", "status", "enable", "disable",
      ];
      const matched = words.filter((w) => w.startsWith(prefix));
      return matched.length ? matched.map((w) => ({ value: w, label: w })) : null;
    },
    handler: async (args, ctx) => {
      if (!config) await ensureInit(ctx.cwd);

      const parts = (args ?? "").trim().split(/\s+/);
      const cmd = parts[0] ?? "";

      switch (cmd) {
        case "mode":
          return handleMode(parts.slice(1).join(" "), ctx);
        case "rules":
          return handleRules(parts.slice(1).join(" "), ctx);
        case "reset":
          store.clearSessionDecisions();
          ctx.ui.notify("All session decisions cleared", "info");
          return;
        case "status":
          return showStatus(ctx);
        case "enable":
          if (config) config.enabled = true;
          ctx.ui.notify("Permission system enabled", "success");
          if (config) ctx.ui.setStatus("permission-mode", `perm: ${config.mode}`);
          return;
        case "disable":
          if (config) config.enabled = false;
          ctx.ui.notify("Permission system disabled", "warning");
          ctx.ui.setStatus("permission-mode", undefined);
          return;
        default:
          return showStatus(ctx);
      }
    },
  });

  // ── Command sub-handlers ─────────────────

  async function handleMode(sub: string, ctx: Parameters<typeof pi.on>[1][1]): Promise<void> {
    if (!config) return;

    if (!sub || sub === "list") {
      const lines = Object.entries(MODE_DESCRIPTIONS).map(
        ([k, v]) => `${k === config!.mode ? " *" : "  "} ${k} — ${v}`,
      );
      ctx.ui.notify(`Current mode: ${config.mode}\n\n${lines.join("\n")}`, "info");
      return;
    }

    if (isValidMode(sub)) {
      config.mode = sub;
      ctx.ui.notify(`Permission mode → ${sub}`, "success");
      ctx.ui.setStatus("permission-mode", `perm: ${sub}`);
      return;
    }

    ctx.ui.notify(
      `Invalid mode "${sub}". Options: allow-all, ask-write, ask-dangerous, ask-all, deny-all, custom`,
      "error",
    );
  }

  async function handleRules(sub: string, ctx: Parameters<typeof pi.on>[1][1]): Promise<void> {
    const action = sub.split(/\s+/)[0] ?? "";

    if (action === "list" || action === "") {
      const rules = ruleEngine.getRules();
      if (!rules.length) {
        ctx.ui.notify("No rules defined", "info");
        return;
      }
      const lines = rules.map(
        (r, i) =>
          `${i + 1}. [${r.action.toUpperCase()}] ${r.name} (pri:${r.priority} hits:${r.hitCount ?? 0})`,
      );
      ctx.ui.notify(`Rules (${rules.length}):\n${lines.join("\n")}`, "info");
      return;
    }

    if (action === "clear") {
      const ok = ctx.hasUI
        ? await ctx.ui.confirm("Clear all rules?", "Session decisions will also be cleared.")
        : true;
      if (ok) {
        ruleEngine.clearRules();
        store.clearSessionDecisions();
        ctx.ui.setStatus("permission-rules", undefined);
        ctx.ui.notify("All rules cleared", "info");
      }
      return;
    }

    ctx.ui.notify("Usage: /permission rules [list|clear]", "info");
  }

  async function showStatus(ctx: Parameters<typeof pi.on>[1][1]): Promise<void> {
    if (!config) return;
    const lines = [
      `Enabled:           ${config.enabled}`,
      `Mode:              ${config.mode}`,
      `Quiet mode:        ${config.quietMode}`,
      `Rules:             ${ruleEngine.ruleCount}`,
      `Session decisions: ${store.sessionDecisionCount}`,
      `Non-interactive:   ${config.defaultAction}`,
    ];
    ctx.ui.notify(`Permission System Status:\n${lines.join("\n")}`, "info");
  }
}
