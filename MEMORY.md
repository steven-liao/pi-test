# Project Memory

> Auto-managed memory file for tracking project context and decisions.

## Project: pi-coding-agent Playground

- **Working directory**: `D:\pi_test`
- **Goal**: Experiment with pi coding agent extensions, skills, and configurations

---

## Active Extension: Permission System

- **Location**: `.pi/extensions/permission-system/`
- **Purpose**: Mimics Claude Code's permission system — intercepts risky tool calls and asks for user confirmation
- **Loaded**: ✅ (after `/reload`)
- **Status**: Session started before extension was created → new sessions or `/reload` required to pick it up
- **Known issue**: Extension does NOT retroactively apply to already-running sessions
- **Testing**: Use `/permission status` to verify, then try dangerous commands like `rm -rf` to trigger the dialog

### Key Config

| Setting | Value |
|---------|-------|
| `mode` | `ask-dangerous` |
| `non-interactive` | `block` |
| `enabled` | `true` |

### Files

| File | Purpose |
|------|---------|
| `index.ts` | Entry point, event hooks, permission pipeline |
| `types.ts` | All type definitions |
| `config.ts` | Config loader (global + project level) |
| `risk-classifier.ts` | Tool risk classification (L0-L4) |
| `rule-engine.ts` | Custom allow/deny rule engine |
| `permission-store.ts` | Session decision memory + persistence |
| `dialogs.ts` | TUI permission confirmation dialogs |
| `utils.ts` | Lightweight glob matching utility |

---

## Lessons Learned (2026-05-16)

1. **Extension lifecycle**: pi loads extensions at **startup** or after **`/reload`**. If you create extension files mid-session, they won't take effect until `/reload`.
2. **No retroactive protection**: Tools called before the extension loads (like `write MEMORY.md`) bypass permission checks entirely.
3. **Auto-discovery**: Extensions in `.pi/extensions/*/index.ts` are auto-discovered at startup — no `-e` flag needed.
4. **Permissions not inherited**: `/permission` command wasn't intercepted because the extension wasn't loaded when this session started.

---

## Lessons Learned (2026-05-17)

1. **`ctx.ui.select()` expects `string[]`, not objects**: The permission extension's `showFullPermissionDialog` was passing `{label, description}[]` to `select()`, which caused `[object Object]` to display instead of proper labels. The fix is to pass plain strings and look up the selected value afterwards.
2. **Extension changes require `/reload`**: Editing extension source files mid-session does not take effect until `/reload` is run or a new session starts.

## Notes

- pi auto-discovers extensions from `.pi/extensions/*/index.ts`
- Use `/reload` to reload extensions after changes
- Settings go in `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project)
