# Command Reference

Every `mm` command. Default output is colored human-readable. Add `--json`, `--ndjson`, `--full`, or `--raw` for machine-friendly output.

Global options (before the command name):

- `--team TEXT` — filter to a specific team
- `--debug` — verbose error output

Per-command output flags (after the command name):

- `--json` — pretty JSON with essential fields
- `--json --full` — pretty JSON with all fields
- `--ndjson` — one JSON object per line
- `--raw` — markdown / plaintext, no ANSI colors

## overview

Get oriented in one call. This is the starting point.

```
mm overview [--since 6h]
```

Returns `{ since, mentions, unread, active_channels }`. Each entry has a `ref` field usable with `mm messages` and a `thread_id` usable with `mm thread`.

## messages

Read messages from a channel.

```
mm messages <channel> [--since 1h] [--limit 30] [--threads]
```

- `<channel>` — channel name, `@username` for DMs, channel ID, or a Mattermost channel link `https://.../<team>/channels/<name>`
- `--threads` — group by thread, showing root message, reply count, and last reply
- `--since` — time filter (`1h`, `2d`, `today`, `2025-03-05`, `0` for all)
- `--limit` — max messages (max 200)

## thread

Read a full thread conversation.

```
mm thread <postIdOrLink> [--limit 10] [--since 1h]
```

- `<postIdOrLink>` — bare 26-char post ID, or a Mattermost permalink `https://.../<team>/pl/<post-id>`
- `--limit 0` — all replies (default: root + 9 replies)
- `--since` — only replies after this time (root always included)

## mentions

Posts that @-mention you. Reply-mentions include `root` context (the original message being replied to).

```
mm mentions [--since 1d] [--limit 30]
```

## search

Full-text search across all teams.

```
mm search <query> [--limit 30]
```

Supports Mattermost search modifiers:

- `from:username` — posts by a specific user
- `in:channel` — posts in a specific channel
- `before:2025-03-05` / `after:2025-03-05` / `on:2025-03-05` — date filters

## channel

Show info about a single channel.

```
mm channel <name>
```

Returns purpose, header, member count, pinned count, last post time, creation date.

## channels

List all channels you belong to.

```
mm channels [--type public|private|dm|group] [--since 6h]
```

- `--type` — filter by channel type
- `--since` — only channels with posts since this time

## unread

Show channels with unread messages. Muted channels hidden by default.

```
mm unread [--include-muted]
```

## pinned

Show pinned posts in a channel.

```
mm pinned <channel> [--limit 10]
```

## members

List channel members with online status.

```
mm members <channel>
```

Sorted by status (online first). Shows username, full name, position, and status.

## user

Show user profile and status.

```
mm user <username>
```

Username can be with or without `@` prefix. Returns name, position, email, status, timezone.

## login

Authenticate with Mattermost.

```
mm login [--url URL] [--token TOKEN] [--user USER] [--password PASS]
```

Two auth methods:

1. **Personal Access Token** (recommended): `mm login --url https://chat.example.com --token YOUR_TOKEN`
2. **Password + MFA**: `mm login --url https://chat.example.com` (interactive prompt)

## logout

Revoke session and clear stored credentials.

```
mm logout
```

## whoami

Show current user info and validate auth.

```
mm whoami
```
