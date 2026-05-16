/**
 * Permission System Extension — Rule Engine
 *
 * Manages permission rules with CRUD operations and matching.
 * Rules are ordered by priority (higher = more specific).
 */

import type {
  PermissionRule,
  PermissionRequest,
  PermissionResult,
  RuleCondition,
  RuleField,
  RuleOperator,
  PermissionDecision,
  RuleScope,
  RuleSource,
} from "./types.ts";

let ruleIdCounter = 0;
function generateRuleId(): string {
  return `rule-${Date.now()}-${++ruleIdCounter}`;
}

export class RuleEngine {
  private rules: PermissionRule[] = [];

  // ── CRUD ────────────────────────────────────

  /** 添加一条规则 */
  addRule(rule: Omit<PermissionRule, "id" | "createdAt" | "hitCount">): PermissionRule {
    const newRule: PermissionRule = {
      ...rule,
      id: generateRuleId(),
      createdAt: Date.now(),
      hitCount: 0,
    };
    this.rules.push(newRule);
    this.sortRules();
    return newRule;
  }

  /** 批量添加规则 */
  addRules(rules: PermissionRule[]): void {
    for (const rule of rules) {
      this.rules.push({ ...rule, hitCount: rule.hitCount ?? 0 });
    }
    this.sortRules();
  }

  /** 删除规则 */
  removeRule(id: string): boolean {
    const index = this.rules.findIndex((r) => r.id === id);
    if (index === -1) return false;
    this.rules.splice(index, 1);
    return true;
  }

  /** 清空规则 */
  clearRules(): void {
    this.rules = [];
  }

  /** 获取所有规则 */
  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  /** 获取指定作用域的规则 */
  getRulesByScope(scope: RuleScope): PermissionRule[] {
    return this.rules.filter((r) => r.scope === scope);
  }

  /** 获取指定来源的规则 */
  getRulesBySource(source: RuleSource): PermissionRule[] {
    return this.rules.filter((r) => r.source === source);
  }

  // ── 规则匹配 ────────────────────────────────

  /**
   * 匹配请求并返回决策结果
   * @returns 匹配到的规则结果，或 null（未匹配）
   */
  match(request: PermissionRequest): PermissionResult | null {
    for (const rule of this.rules) {
      // 检查过期
      if (rule.expiresAt && rule.expiresAt < Date.now()) {
        continue;
      }

      if (this.matchConditions(rule.conditions, request)) {
        // 命中计数
        rule.hitCount = (rule.hitCount ?? 0) + 1;

        return {
          decision: rule.action,
          ruleId: rule.id,
          reason: rule.name,
          scope: rule.scope === "session" ? "session" : "always",
        };
      }
    }

    return null;
  }

  /**
   * 检查是否所有条件都满足（AND 逻辑）
   */
  private matchConditions(conditions: RuleCondition[], request: PermissionRequest): boolean {
    if (conditions.length === 0) return true;

    return conditions.every((cond) => {
      const fieldValue = this.getFieldValue(cond.field, request);
      if (fieldValue === undefined || fieldValue === null) return false;
      return this.evaluateCondition(cond.operator, String(fieldValue), String(cond.value));
    });
  }

  /** 从请求中提取字段值 */
  private getFieldValue(field: RuleField, request: PermissionRequest): string | undefined {
    switch (field) {
      case "toolName":
        return request.toolName;
      case "command":
        return request.command;
      case "path":
        return request.path;
      case "riskLevel":
        return request.riskLevel;
    }
  }

  /** 执行条件评估 */
  private evaluateCondition(operator: RuleOperator, fieldValue: string, condValue: string): boolean {
    switch (operator) {
      case "equals":
        return fieldValue === condValue;

      case "contains":
        return fieldValue.toLowerCase().includes(condValue.toLowerCase());

      case "regex":
        try {
          return new RegExp(condValue, "i").test(fieldValue);
        } catch {
          return false;
        }

      case "startsWith":
        return fieldValue.toLowerCase().startsWith(condValue.toLowerCase());

      case "endsWith":
        return fieldValue.toLowerCase().endsWith(condValue.toLowerCase());

      default:
        return false;
    }
  }

  // ── 辅助方法 ────────────────────────────────

  /** 按优先级排序（高 → 低） */
  private sortRules(): void {
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /** 导出规则（用于持久化） */
  exportRules(): PermissionRule[] {
    return this.rules.map((r) => ({ ...r }));
  }

  /** 获取规则数量 */
  get ruleCount(): number {
    return this.rules.length;
  }
}
