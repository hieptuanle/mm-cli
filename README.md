# mm-cli

Mattermost CLI for humans and agents. TypeScript port of
[rhnvrm/mattermost-cli](https://github.com/rhnvrm/mattermost-cli).

## Install

Published on npm as [`@hieptuanle/mm-cli`](https://www.npmjs.com/package/@hieptuanle/mm-cli). Pick whichever fits your environment:

```bash
# Run without installing (no PATH changes)
npx @hieptuanle/mm-cli --help

# Global install — adds `mm` to your PATH
npm i -g @hieptuanle/mm-cli
pnpm add -g @hieptuanle/mm-cli

# Or install per-project
pnpm add @hieptuanle/mm-cli
npx mm --help
```

Once installed, the binary is `mm`:

```bash
mm --help
```

### From source

If you want to hack on the CLI:

```bash
git clone https://github.com/hieptuanle/mm-cli.git
cd mm-cli
pnpm install
pnpm build
node dist/index.js --help

# Optionally expose `mm` globally:
pnpm link --global
```

## Setup

```bash
# Interactive login (password + MFA)
mm login --url https://chat.example.com

# Or with a Personal Access Token
mm login --url https://chat.example.com --token <pat>

# Verify
mm whoami
```

Credentials are stored at `~/.config/mm/config.json` (mode 600).
Override via `MATTERMOST_URL`, `MATTERMOST_TOKEN`, `MATTERMOST_TEAM`,
or `MM_CONFIG_PATH`.

## Usage

```bash
mm overview                         # mentions + unread + active channels
mm messages general                 # read messages
mm messages general --since 1h
mm messages general --threads
mm messages @alice                  # DM with a user
mm thread <post-id>                 # root + last 9 replies
mm thread <post-id> --limit 0       # full thread
mm search "deployment issue"
mm mentions                         # @-mentions in last 24h
mm channel general
mm channels --since 6h
mm unread
mm pinned general
mm members general
mm user @alice
```

## Output

Colored human-readable output by default. Each command supports:

| Flag             | What it does                                  |
| ---------------- | --------------------------------------------- |
| _(default)_      | Colored TTY output for humans                 |
| `--json`         | Pretty JSON with essential fields             |
| `--json --full`  | Pretty JSON with all fields                   |
| `--ndjson`       | One JSON object per line (for piping)         |
| `--raw`          | Raw markdown / plaintext without ANSI colors  |

Key fields:

- `thread_id` on every post — pass to `mm thread`
- `ref` on channel entries — pass to `mm messages`
- `is_bot` / `bot_name` — webhook/bot posts flagged automatically
- `root` on reply-mentions — the original message being replied to
- `reactions` — emoji counts like `{"+1": 3}`

## Global options

```
--team       Filter to a specific team
--debug      Enable debug output
```

## Agent skill

This repo ships an agent skill at [`skills/mm-cli/`](skills/mm-cli/) so coding agents (Claude Code, Cursor, etc.) know when and how to invoke `mm`. Install via:

```bash
npx skills add hieptuanle/mm-cli
```

The skill bundles a `SKILL.md` plus reference docs for setup, commands, workflows, and common scenarios.

## Develop

```bash
pnpm type-check     # tsc --noEmit
pnpm dev            # tsc --watch
pnpm build          # emit dist/
```
