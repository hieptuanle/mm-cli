---
name: mm-cli
description: Read and search Mattermost chat using the `mm` CLI (TypeScript port of mattermost-cli). Use this skill whenever the user mentions Mattermost, chat messages, team chat, unread messages, DMs, channel history, mentions, or wants to catch up on what happened in chat. Also triggers when the user asks about specific people's messages, channel activity, searching for something someone said, checking notifications, or pastes a Mattermost permalink (https://.../pl/...). Default output is colored human-readable; pass --json / --ndjson / --full / --raw for machine output. Every post entry exposes a `thread_id` and channels expose a `ref` so you can chain commands without parsing.
---

# Mattermost CLI (`mm`)

Read and search Mattermost from the command line. Default output is colored human-readable; opt in to JSON/NDJSON for piping or programmatic use.

## Setup

Check if `mm` is already available:

```bash
mm whoami
```

If that works, skip to "Start here" below.

If `mm` is not on PATH, install it from source (no npm package yet):

```bash
git clone https://github.com/hieptuanle/mm-cli.git
cd mm-cli
pnpm install
pnpm build
# add to PATH (one of):
pnpm link --global       # exposes `mm`
# or run directly:
node /absolute/path/to/mm-cli/dist/index.js --help
```

Then authenticate (one-time):

```bash
mm login --url https://your.mattermost.server
mm whoami   # verify
```

Login prompts for credentials interactively. If your server supports Personal Access Tokens (Profile > Security > Personal Access Tokens in the Mattermost UI), you can skip the prompt:

```bash
mm login --url https://your.mattermost.server --token YOUR_TOKEN
```

For environment variables, multiple servers, and troubleshooting, see [references/setup.md](references/setup.md).

## Output flags (every command)

| Flag             | What it does                                  |
| ---------------- | --------------------------------------------- |
| _(default)_      | Colored TTY output for humans                 |
| `--json`         | Pretty JSON with essential fields             |
| `--json --full`  | Pretty JSON with all fields                   |
| `--ndjson`       | One JSON object per line (good for piping)    |
| `--raw`          | Markdown / plaintext, no ANSI colors          |

`--json`, `--ndjson`, and `--raw` automatically disable ANSI colors.

When you want to programmatically extract data, prefer `--json` (or `--ndjson` for streams). When echoing chat content into a chat reply or another tool, prefer `--raw` so you don't leak terminal escape codes.

## Start here: `mm overview`

Always run this first. It returns mentions, unread channels, and active channels in a single call.

```bash
mm overview              # last 6 hours (default)
mm overview --since 1d   # last 24 hours
mm overview --json       # machine-readable
```

The response has three sections:

- **mentions** — posts that @-mention you, with root-message context when it's a reply
- **unread** — channels with unread messages, sorted by count
- **active_channels** — channels with recent posts, sorted by recency

Each entry includes a `ref` field you can pass directly to other commands.

## Reading messages

```bash
mm messages <channel>                   # last 30 messages, chronological
mm messages <channel> --since 2h
mm messages <channel> --threads         # thread index: root + reply count + last reply
mm messages @username                   # DMs with someone
mm messages https://chat.example.com/<team>/channels/<name>   # paste a channel link
```

`<channel>` accepts a name (`off-topic`), `@username` for DMs, a 26-char channel ID (for group DMs from overview output), or a Mattermost channel link.

### Threads

Every post includes a `thread_id`. Use it to read the full conversation:

```bash
mm thread <thread_id>                   # root + last 9 replies
mm thread <thread_id> --limit 0         # entire thread
mm thread <thread_id> --since 1h        # just recent replies (root always included)

# Permalinks work too:
mm thread https://chat.example.com/<team>/pl/<post-id>
```

## Searching and mentions

```bash
mm search "deployment issue"
mm search "from:alice in:devops after:2025-01-01"
mm mentions                             # @-mentions in last 24h
mm mentions --since 3d
```

Mentions for replies include a `root` field with the original message, so you know what "this" or "it" refers to without a follow-up call.

## Channel context

```bash
mm channel <name>                       # purpose, header, member/pinned count
mm pinned <channel>                     # important/pinned posts
mm members <channel>                    # who's here + online status
mm channels --since 6h                  # all channels with recent activity
mm channels --type dm                   # just DMs
mm unread                               # only channels with unread messages
```

## People

```bash
mm user @someone                        # profile, role, status, timezone
```

## Key JSON fields

Every post emitted with `--json` includes these fields so you can navigate without guesswork:

| Field | What it's for |
|-------|---------------|
| `thread_id` | Pass to `mm thread` to read the full conversation |
| `ref` | On channel entries; pass to `mm messages` |
| `is_bot` / `bot_name` | Webhook and bot posts are flagged automatically |
| `root` | On reply-mentions; the original message being replied to |
| `is_reply` / `reply_count` | Thread structure |
| `reactions` | Emoji counts like `{"+1": 3, "white_check_mark": 1}` |

Bot posts from webhooks automatically extract alert content from Slack-format attachments, so you see the actual alert text instead of empty messages.

## Further reading

- [references/scenarios.md](references/scenarios.md) — real use cases: "what did I miss?", "summarize this channel", "is this resolved?", "find that thing someone said"
- [references/workflows.md](references/workflows.md) — command sequences: morning triage, incident investigation, channel discovery
- [references/commands.md](references/commands.md) — full command reference with every option and flag
- [references/setup.md](references/setup.md) — install, auth, env vars, troubleshooting
