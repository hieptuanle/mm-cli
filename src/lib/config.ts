import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface Credentials {
    url: string
    token: string
    auth_method?: string
    team?: string
}

export class ConfigError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ConfigError'
    }
}

function configPath(): string {
    const custom = process.env.MM_CONFIG_PATH
    if (custom) return custom
    return join(homedir(), '.config', 'mm', 'config.json')
}

export function loadConfig(): Partial<Credentials> {
    const path = configPath()
    if (!existsSync(path)) return {}
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as Partial<Credentials>
    } catch (err) {
        throw new ConfigError(`Failed to read config at ${path}: ${(err as Error).message}`)
    }
}

export function saveConfig(args: {
    url: string
    auth_method: string
    token: string
    team?: string
}): string {
    const path = configPath()
    const dir = dirname(path)
    mkdirSync(dir, { recursive: true })
    try {
        chmodSync(dir, 0o700)
    } catch {}

    const data: Credentials = {
        url: args.url,
        auth_method: args.auth_method,
        token: args.token,
    }
    if (args.team) data.team = args.team

    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
    try {
        chmodSync(path, 0o600)
    } catch {}
    return path
}

export function clearConfig(): void {
    const path = configPath()
    if (existsSync(path)) rmSync(path)
}

export function getCredentials(): Credentials {
    const url = process.env.MATTERMOST_URL
    const token = process.env.MATTERMOST_TOKEN
    const team = process.env.MATTERMOST_TEAM

    if (url && token) {
        const creds: Credentials = { url, token, auth_method: 'env' }
        if (team) creds.team = team
        return creds
    }

    const config = loadConfig()
    if (config.url && config.token) {
        const creds: Credentials = {
            url: url ?? config.url,
            token: token ?? config.token,
            auth_method: config.auth_method,
        }
        const t = team ?? config.team
        if (t) creds.team = t
        return creds
    }

    throw new ConfigError(
        "Not authenticated. Run 'mm login' to set up credentials.\n" +
            'Or set MATTERMOST_URL and MATTERMOST_TOKEN environment variables.',
    )
}
