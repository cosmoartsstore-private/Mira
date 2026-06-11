# Project Agent Workspace

Read `C:\Users\kaimu\.codex\AGENTS.md` first for common rules. This file only indexes Mira-local agent materials.

## Public Documents

| Document | Audience | Use When |
| --- | --- | --- |
| `../README.md` | GitHub users, maintainers | Project overview, features, build commands, and repository layout |
| `../DEVELOPMENT.md` | Developers | Setup, local operation, troubleshooting, and test commands |
| `../CHANGELOG.md` | Users, maintainers | Release history |
| `../docs/` | Users, developers | Public technical documentation |

## Agent-Only Documents

| Document | Audience | Use When |
| --- | --- | --- |
| `../AGENT.md` | Codex | Codex entry point and document router |
| `../CLAUDE.md` | Claude | Claude entry point and bridge to Codex global rules |
| `.claude/fix-task.md` | Codex, Claude | Internal alignment audit and task list moved from the project root |
| `.claude/codex-spec-new-features.md` | Codex, Claude | Internal implementation specification moved from public docs |
| `.claude/tauri-dev.stdout.log` | Codex, Claude | Local Tauri dev stdout log |
| `.claude/tauri-dev.stderr.log` | Codex, Claude | Local Tauri dev stderr log |
| `.claude/settings.local.json` | Claude | Claude local settings |
