# Agent Entry

This is the Codex entry point for Mira.
Common ethics, engineering philosophy, comment policy, and workflow rules live in the Codex global rules.

## Next Documents

- `.claude/README.md` - project-local index, moved internal task notes, local logs, and Claude workspace files.
- `README.md` - public project overview, features, build commands, and repository layout.
- `DEVELOPMENT.md` - public developer setup, local operation, troubleshooting, and test commands.
- `CHANGELOG.md` - public release history.
- `docs/` - public technical documentation when present.

## Routing

- Need project-local internal notes or prior agent decisions: read `.claude/README.md`.
- Need GitHub-visible or user-facing explanation: read `README.md`, `DEVELOPMENT.md`, `CHANGELOG.md`, or `docs/`.
- Need an internal note, audit handoff, local task list, or runtime log: keep it under `.claude/`; do not move it into public docs.
