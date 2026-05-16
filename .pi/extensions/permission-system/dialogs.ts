/**
 * Permission System Extension — TUI Dialogs
 *
 * Permission confirmation dialogs with multi-option selection.
 * Supports overlay mode for non-intrusive prompts.
 */

import type { RiskLevel, PermissionRequest, DecisionScope, PermissionResult } from "./types.ts";
import { RISK_LABELS } from "./types.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ──────────────────────────────────────────────
// 选项定义
// ──────────────────────────────────────────────

interface DialogOption<T> {
  label: string;
  value: T;
  description?: string;
}

/** 权限对话框的返回结果 */
export interface PermissionDialogResult {
  decision: "allow" | "deny";
  scope: DecisionScope;
}

// ──────────────────────────────────────────────
// 格式化辅助
// ──────────────────────────────────────────────

function formatCommandPreview(command: string, maxWidth: number): string {
  // 替换换行符并截断
  const oneLine = command.replace(/\n/g, "\\n");
  if (oneLine.length <= maxWidth) return oneLine;
  return oneLine.slice(0, maxWidth - 3) + "...";
}

// ──────────────────────────────────────────────
// 对话框实现
// ──────────────────────────────────────────────

/**
 * 显示完整权限确认对话框（多选项）
 *
 * 选项:
 *   1. Allow Once
 *   2. Allow for This Session
 *   3. Always Allow This Command/Path
 *   4. Deny Once
 *   5. Always Deny This Command/Path
 *
 * @returns 用户的选择，或 null（取消/超时）
 */
export async function showFullPermissionDialog(
  ctx: ExtensionContext,
  request: PermissionRequest,
): Promise<PermissionDialogResult | null> {
  const { toolName, riskLevel, command, path, diffPreview } = request;
  const riskLabel = RISK_LABELS[riskLevel];

  // 构建上下文描述
  const contextLines: string[] = [];
  contextLines.push(`Tool:  ${toolName}  Risk: ${riskLabel}`);
  if (command) {
    contextLines.push(`Command: ${formatCommandPreview(command, 60)}`);
  }
  if (path) {
    contextLines.push(`Path:   ${path}`);
  }
  // Append diff preview if available (for write/edit tools)
  if (diffPreview) {
    contextLines.push("");
    contextLines.push(diffPreview);
  }
  const contextStr = contextLines.join("\n");

  // 构建详细选项
  const options: DialogOption<PermissionDialogResult>[] = [
    { label: "Allow Once", value: { decision: "allow", scope: "once" }, description: "Allow this one time only" },
  ];

  // 高风险的显示 session 级别选项
  if (riskLevel === "L3" || riskLevel === "L4") {
    options.push({
      label: "Allow for This Session",
      value: { decision: "allow", scope: "session" },
      description: "Remember for this session",
    });
  }

  // 添加"始终允许"选项（只对具体命令/路径）
  if (command || path) {
    options.push({
      label: "Always Allow This",
      value: { decision: "allow", scope: "always" },
      description: "Create a rule to always allow this command/path",
    });
  }

  options.push(
    { label: "Deny Once", value: { decision: "deny", scope: "once" }, description: "Block this one time" },
  );

  if (command || path) {
    options.push({
      label: "Always Deny This",
      value: { decision: "deny", scope: "always" },
      description: "Create a rule to always deny this command/path",
    });
  }

  // 使用 ctx.ui.select 展示选项
  const labels = options.map((o) => o.label);

  const selection = await ctx.ui.select(
    `⚠️  ${riskLabel} Risk — Confirm Permission\n\n${contextStr}`,
    labels,
  );

  if (!selection) {
    // 用户取消 → 拒绝
    return null;
  }

  const index = labels.indexOf(selection);
  if (index === -1) return null;

  return options[index].value;
}

/**
 * 根据风险等级选择合适的对话框
 */
export async function showPermissionDialog(
  ctx: ExtensionContext,
  request: PermissionRequest,
): Promise<PermissionDialogResult | null> {
  if (request.riskLevel === "L4") {
    // 严重风险 → 完整对话框
    return showFullPermissionDialog(ctx, request);
  }
  // 高风险 → 完整对话框
  // 中风险也可用简化版本
  if (request.riskLevel === "L3") {
    return showFullPermissionDialog(ctx, request);
  }
  // 低中风险 → 完整对话框（但选项较少）
  return showFullPermissionDialog(ctx, request);
}

/**
 * 在非交互模式下显示权限结果
 */
export function nonInteractiveResult(
  ctx: ExtensionContext,
  request: PermissionRequest,
  action: "allow" | "block" | "fail",
): PermissionResult {
  const riskLabel = RISK_LABELS[request.riskLevel];

  switch (action) {
    case "allow":
      return { decision: "allow", reason: "Allowed by permission system (non-interactive mode)" };
    case "block":
      return {
        decision: "deny",
        reason: `Blocked by permission system (non-interactive mode) — ${riskLabel} risk requires confirmation`,
      };
    case "fail":
      throw new Error(
        `Permission denied: "${riskLabel}" risk operation requires user confirmation in interactive mode.\n` +
        (request.command ? `  Command: ${request.command}\n` : "") +
        (request.path ? `  Path: ${request.path}\n` : ""),
      );
  }
}
