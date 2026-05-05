---
description: Use pnpm + Node.js for this project.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

# mm-cli

Mattermost CLI ported from https://github.com/rhnvrm/mattermost-cli (Python).
Project shape mirrors `~/projects/outline-cli`.

## Tooling

- Package manager: **pnpm** (do not use bun/npm/yarn)
- Runtime: **Node.js** (>=20.18.1)
- Build: `pnpm build` → emits `dist/` via `tsc`
- Type check: `pnpm type-check`

## Layout

```
src/
  index.ts             # commander entry
  commands/            # one file per command group
    auth.ts            # login, logout, whoami
    channels.ts        # channel, channels, unread
    messages.ts        # messages, thread
    overview.ts        # overview (orientation)
    people.ts          # user, pinned, members
    search.ts          # mentions, search
  lib/
    auth.ts            # ensureAuth -> MMContext
    client.ts          # fetch-based Mattermost API client
    config.ts          # ~/.config/mm/config.json + env overrides
    formatters.ts      # JSON/markdown output helpers
    helpers.ts         # cross-command operations
    resolve.ts         # ID -> user/channel cache
    state.ts           # global flag plumbing
    time-utils.ts      # --since parser
```

## Conventions

- Global flags: `--team`, `--debug` (read via `getState(cmd)`).
- Per-command output flags (mirror outline-cli): `--json`, `--json --full`, `--ndjson`, `--raw`. Default = colored TTY output.
- Wire output via `addOutputFlags(cmd)` and route results through `outputItem` / `outputList` from `lib/output.ts`. Each call defines `essentialKeys` and an optional raw-markdown formatter.
- `getOutputOptions(opts)` sets `chalk.level = 0` automatically when `--raw`, `--json`, or `--ndjson` is active.
- Auth precedence: env (`MATTERMOST_URL`, `MATTERMOST_TOKEN`, `MATTERMOST_TEAM`) > config file.
- Use `node:`-prefixed builtin imports.

## Language

This repo uses **English** for everything: commit messages, README, code
comments, PR descriptions. This overrides the global rule in
`~/.claude/CLAUDE.md` that requests Vietnamese commit messages.
