import { Command } from 'commander'
import prompts from 'prompts'
import { getContext } from '../lib/auth.js'
import { AuthExpiredError, Client, EXIT_ERROR } from '../lib/client.js'
import { clearConfig, loadConfig, saveConfig } from '../lib/config.js'
import { getState } from '../lib/state.js'

export function registerAuthCommand(program: Command): void {
    program
        .command('login')
        .description('Authenticate with Mattermost and store session token.')
        .option('--url <url>', 'Mattermost server URL.')
        .option('--token <pat>', 'Personal Access Token (skips password flow).')
        .option('--user <login>', 'Username or email (non-interactive).')
        .option('--password <pw>', 'Password (non-interactive).')
        .action(async (opts: { url?: string; token?: string; user?: string; password?: string }) => {
            let url = opts.url
            if (!url) {
                const r = await prompts({ type: 'text', name: 'url', message: 'Mattermost URL' })
                url = r.url as string | undefined
            }
            if (!url) {
                console.error('Error: URL required.')
                process.exit(EXIT_ERROR)
            }
            if (!url.startsWith('http')) url = `https://${url}`

            if (opts.token) {
                await loginWithPat(url, opts.token)
                return
            }

            let loginId = opts.user
            if (!loginId) {
                const r = await prompts({ type: 'text', name: 'v', message: 'Username or email' })
                loginId = r.v as string | undefined
            }
            let password = opts.password
            if (!password) {
                const r = await prompts({ type: 'password', name: 'v', message: 'Password' })
                password = r.v as string | undefined
            }
            if (!loginId || !password) {
                console.error('Error: Username and password required.')
                process.exit(EXIT_ERROR)
            }

            const r = await prompts({
                type: 'text',
                name: 'v',
                message: 'MFA code (press Enter to skip)',
            })
            const mfaToken = ((r.v as string | undefined) ?? '').trim() || undefined

            await loginWithPassword(url, loginId, password, mfaToken)
        })

    program
        .command('whoami')
        .description('Show current user info and validate auth.')
        .action(async (_opts: object, cmd: Command) => {
            const state = getState(cmd)
            const ctx = await getContext(state)
            const u = await ctx.client.getUser(ctx.userId)
            const display = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()

            if (!state.human) {
                console.log(
                    JSON.stringify(
                        {
                            user_id: u.id,
                            username: u.username,
                            display_name: display,
                            email: u.email ?? '',
                            teams: ctx.teams.map((t) => ({
                                id: t.id,
                                name: t.name,
                                display_name: t.display_name,
                            })),
                        },
                        null,
                        2,
                    ),
                )
                return
            }

            console.log(`Username:     @${u.username}`)
            if (display) console.log(`Display name: ${display}`)
            if (u.email) console.log(`Email:        ${u.email}`)
            console.log(`User ID:      ${u.id}`)
            console.log('Teams:')
            for (const t of ctx.teams) console.log(`  - ${t.display_name} (${t.name})`)
        })

    program
        .command('logout')
        .description('Revoke session and clear stored credentials.')
        .action(async () => {
            const config = loadConfig()
            if (config.url && config.token) {
                try {
                    const client = new Client(config.url, config.token)
                    await client.logout()
                } catch {}
            }
            clearConfig()
            console.log('Logged out. Stored credentials cleared.')
        })
}

async function loginWithPat(url: string, pat: string): Promise<void> {
    const client = new Client(url, pat)
    try {
        await client.loginWithToken(pat)
    } catch (err) {
        if (err instanceof AuthExpiredError) {
            console.error('Error: Invalid Personal Access Token.')
        } else {
            console.error(`Error: ${(err as Error).message}`)
        }
        process.exit(EXIT_ERROR)
    }
    await showTeams(client)
    const path = saveConfig({ url, auth_method: 'token', token: pat })
    console.log(`Logged in as @${client.username} (PAT)`)
    console.log(`Config saved to ${path}`)
}

async function loginWithPassword(
    url: string,
    loginId: string,
    password: string,
    mfaToken?: string,
): Promise<void> {
    const client = new Client(url)
    try {
        await client.loginWithPassword({ login_id: loginId, password, mfa_token: mfaToken })
    } catch (err) {
        if (err instanceof AuthExpiredError) {
            const msg = err.message.toLowerCase()
            if (msg.includes('mfa') && !mfaToken) {
                console.log('MFA is required for this account.')
                const r = await prompts({ type: 'text', name: 'v', message: 'MFA code' })
                const code = ((r.v as string | undefined) ?? '').trim()
                if (!code) {
                    console.error('Error: MFA code required.')
                    process.exit(EXIT_ERROR)
                }
                try {
                    await client.loginWithPassword({
                        login_id: loginId,
                        password,
                        mfa_token: code,
                    })
                } catch {
                    console.error('Error: Invalid credentials or MFA code.')
                    process.exit(EXIT_ERROR)
                }
            } else {
                console.error('Error: Invalid username or password.')
                process.exit(EXIT_ERROR)
            }
        } else {
            console.error(`Error: ${(err as Error).message}`)
            process.exit(EXIT_ERROR)
        }
    }
    await showTeams(client)
    const path = saveConfig({ url, auth_method: 'password', token: client.token })
    console.log(`Logged in as @${client.username}`)
    console.log(`Config saved to ${path}`)
}

async function showTeams(client: Client): Promise<void> {
    const teams = await client.getUserTeams(client.userId)
    if (!teams.length) {
        console.log("Warning: You don't belong to any teams.")
        return
    }
    if (teams.length === 1) {
        console.log(`Team: ${teams[0]!.display_name} (${teams[0]!.name})`)
        return
    }
    console.log('Teams:')
    for (const t of teams) console.log(`  - ${t.display_name} (${t.name})`)
    console.log('Use --team <name> to filter commands to a specific team.')
}
