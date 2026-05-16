/**
 * Permission System Extension — Permission State Store
 *
 * Manages session-scoped decisions and persistence via pi.appendEntry.
 *
 * Two layers of state:
 *   1. Session decisions (in-memory Map) — "Allow for this session"
 *   2. Persistent rules (via pi.appendEntry) — "Always allow/deny"
 *
 * On session_start, we reconstruct persistent state from session entries.
 */

import type { PermissionDecision, PermissionRule, DecisionScope } from "./types.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * 会话决策的键
 * 用于唯一标识一个工具调用上下文（工具名 + 关键参数）
 */
export interface DecisionKey {
  toolName: string;
  /** bash 命令全文 */
  command?: string;
  /** 文件路径 */
  path?: string;
}

/**
 * 会话决策记录
 */
export interface SessionDecision {
  key: DecisionKey;
  decision: PermissionDecision;
  /** "session" 作用域，仅本会话有效 */
  scope: "session";
  createdAt: number;
}

export class PermissionStore {
  /** 会话决策（内存，不持久化） */
  private sessionDecisions: Map<string, SessionDecision> = new Map();

  /** 生成决策键的字符串表示 */
  private makeKey(key: DecisionKey): string {
    return `${key.toolName}::${key.command ?? ""}::${key.path ?? ""}`;
  }

  // ── 会话决策管理 ────────────────────────────

  /** 记录一个会话决策 */
  recordSessionDecision(key: DecisionKey, decision: PermissionDecision): void {
    const mapKey = this.makeKey(key);
    this.sessionDecisions.set(mapKey, {
      key,
      decision,
      scope: "session",
      createdAt: Date.now(),
    });
  }

  /** 查询会话决策 */
  getSessionDecision(key: DecisionKey): PermissionDecision | null {
    const mapKey = this.makeKey(key);
    const record = this.sessionDecisions.get(mapKey);
    if (!record) return null;
    return record.decision;
  }

  /** 清除所有会话决策 */
  clearSessionDecisions(): void {
    this.sessionDecisions.clear();
  }

  /** 获取会话决策数量 */
  get sessionDecisionCount(): number {
    return this.sessionDecisions.size;
  }

  // ── 持久化规则管理 ──────────────────────────

  /**
   * 持久化一条隐式规则（通过 pi.appendEntry）
   * 由外部调用者传入 pi API
   */
  persistRule(pi: ExtensionAPI, rule: PermissionRule): void {
    pi.appendEntry("permission-rule", {
      ...rule,
      createdAt: Date.now(),
    });
  }

  /**
   * 从 session entries 恢复持久化规则
   * 在 session_start 事件中调用
   */
  restoreRulesFromEntries(
    entries: ReadonlyArray<{ type: string; customType?: string; data?: unknown }>,
  ): PermissionRule[] {
    const rules: PermissionRule[] = [];

    for (const entry of entries) {
      if (entry.type === "custom" && entry.customType === "permission-rule" && entry.data) {
        rules.push(entry.data as PermissionRule);
      }
    }

    return rules;
  }

  // ── 清空 ────────────────────────────────────

  /** 重置所有状态 */
  reset(): void {
    this.sessionDecisions.clear();
  }
}
