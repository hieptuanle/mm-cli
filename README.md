# mm-cli

Mattermost CLI for humans and agents. TypeScript port of
[rhnvrm/mattermost-cli](https://github.com/rhnvrm/mattermost-cli).

## Install

```bash
pnpm install
pnpm build
node dist/index.js --help
# or after `npm link` / `pnpm link --global`:
mm --help
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

JSON by default. Add `--human` for markdown.

Key fields:

- `thread_id` on every post — pass to `mm thread`
- `ref` on channel entries — pass to `mm messages`
- `is_bot` / `bot_name` — webhook/bot posts flagged automatically
- `root` on reply-mentions — the original message being replied to
- `reactions` — emoji counts like `{"+1": 3}`

## Global options

```
--human      Human-readable markdown output (default is JSON)
--team       Filter to a specific team
--debug      Enable debug output
```

## Develop

```bash
pnpm type-check     # tsc --noEmit
pnpm dev            # tsc --watch
pnpm build          # emit dist/
```
