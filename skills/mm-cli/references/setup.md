# Setup Guide

Getting `mm` working from scratch. This covers installation, authentication, and verifying everything works.

## 1. Install the CLI

The CLI is published on npm as `@hieptuanle/mm-cli`. Requires Node.js >= 20.18.1.

```bash
# Run without installing (good for one-off use)
npx @hieptuanle/mm-cli --help

# Install globally (adds `mm` to PATH)
npm i -g @hieptuanle/mm-cli
# or
pnpm add -g @hieptuanle/mm-cli
```

Verify:

```bash
mm --help
```

If you want to hack on the CLI itself, clone the repo and run from source:

```bash
git clone https://github.com/hieptuanle/mm-cli.git
cd mm-cli
pnpm install
pnpm build
node dist/index.js --help
```

## 2. Find your Mattermost server URL

You need the base URL of your Mattermost instance — what you type in your browser to access chat. For example:

- `https://chat.example.com`
- `https://mattermost.yourcompany.com`

If you're not sure, ask your team or check your browser's address bar when you're logged into Mattermost.

## 3. Authenticate

Two options. Personal Access Token is simpler if your server allows it.

### Option A: Personal Access Token (recommended)

1. Log into Mattermost in your browser
2. Go to **Profile > Security > Personal Access Tokens**
   - If you don't see this option, your admin may have disabled it — use Option B instead
3. Click **Create Token**, give it a name (e.g. "mm-cli"), and copy the token
4. Run:

```bash
mm login --url https://chat.example.com --token YOUR_TOKEN
```

The token never expires unless revoked, so you only do this once.

### Option B: Password + MFA

If your server doesn't allow personal access tokens, or you prefer not to create one:

```bash
mm login --url https://chat.example.com
```

This prompts for username, password, and MFA code (if enabled). It creates a session token that's stored locally. Session tokens can expire, so you may need to re-login occasionally.

### Non-interactive login (for scripts/CI)

```bash
mm login --url https://chat.example.com --user you@example.com --password 'yourpass'
```

## 4. Verify

```bash
mm whoami
```

You should see your username, user ID, and the teams you belong to. If you get an auth error, re-run `mm login`.

## 5. Try it

```bash
# What needs attention?
mm overview

# Read a channel
mm messages general

# Your DMs with someone
mm messages @colleague
```

## Where config is stored

Credentials are saved to `$HOME/.config/mm/config.json` with mode 0600. The file contains your server URL and session token (not your password).

You can also configure via environment variables, which take precedence over the config file:

| Variable | Purpose |
|----------|---------|
| `MATTERMOST_URL` | Server URL |
| `MATTERMOST_TOKEN` | Auth token |
| `MATTERMOST_TEAM` | Default team filter |
| `MM_CONFIG_PATH` | Custom config file path |

## Multiple servers

The config file stores one server at a time. To switch between servers, re-run `mm login` with a different `--url`. If you need to work with multiple servers simultaneously, use environment variables:

```bash
MATTERMOST_URL=https://chat-a.example.com MATTERMOST_TOKEN=abc123 mm overview
MATTERMOST_URL=https://chat-b.example.com MATTERMOST_TOKEN=def456 mm overview
```

## Troubleshooting

**"Not authenticated"** — Run `mm login` first.

**"Session expired"** — Your session token expired. Run `mm login` again. Consider using a Personal Access Token instead (PATs don't expire).

**"Cannot connect to ..."** — Check the URL. Make sure you can reach it from where you're running `mm` (VPN, firewall, etc.).

**SSL errors** — If your server uses a self-signed certificate, set `NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.pem` before running `mm`.
