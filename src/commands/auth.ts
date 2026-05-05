import chalk from 'chalk'
import { Command } from 'commander'
import prompts from 'prompts'
import { getContext } from '../lib/auth.js'
import { AuthExpiredError, Client, EXIT_ERROR } from '../lib/client.js'
import { clearConfig, loadConfig, saveConfig } from '../lib/config.js'
import { addOutputFlags, getOutputOptions, outputItem } from '../lib/output.js'
import { getState } from '../lib/state.js'

interface WhoAmI {
    user_id: string
    username: string
    display_name: string
    email: string
    teams: Array<{ id: string; name: string; display_name: string }>
}

const WHOAMI_ESSENTIAL: (keyof WhoAmI)[] = ['user_id', 'username', 'display_name', 'teams']

function formatWhoAmI(w: WhoAmI): string {
    const lines: string[] = []
    lines.push(`${chalk.bold('@' + w.username)} ${chalk.dim(w.user_id)}`)
    if (w.display_name) lines.push(`  ${chalk.dim('Name:')}  ${w.display_name}`)
    if (w.email) lines.push(`  ${chalk.dim('Email:')} ${w.email}`)
    lines.push(`  ${chalk.dim('Teams:')}`)
    for (const t of w.teams) {
        lines.push(`    - ${chalk.bold(t.display_name)} ${chalk.dim('(' + t.name + ')')}`)
    }
    return lines.join('\n')
}

function formatWhoAmIRaw(w: WhoAmI): string {
    const lines = [
        `**@${w.username}**`,
        `User ID: ${w.user_id}`,
    ]
    if (w.display_name) lines.push(`Display name: ${w.display_name}`)
    if (w.email) lines.push(`Email: ${w.email}`)
    lines.push('Teams:')
    for (const t of w.teams) lines.push(`  - ${t.display_name} (${t.name})`)
    return lines.join('\n')
}

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

    addOutputFlags(
        program
            .command('whoami')
            .description('Show current user info and validate auth.'),
    ).action(async (opts: Record<string, unknown>, cmd: Command) => {
        const state = getState(cmd)
        const ctx = await getContext(state)
        const u = await ctx.client.getUser(ctx.userId)
        const display = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()
        const data: WhoAmI = {
            user_id: u.id,
            username: u.username,
            display_name: display,
            email: u.email ?? '',
            teams: ctx.teams.map((t) => ({
                id: t.id,
                name: t.name,
                display_name: t.display_name,
            })),
        }
        outputItem(data, formatWhoAmI, WHOAMI_ESSENTIAL, getOutputOptions(opts), formatWhoAmIRaw)
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
            console.log(chalk.green('Logged out.') + chalk.dim(' Stored credentials cleared.'))
        })
}

async function loginWithPat(url: string, pat: string): Promise<void> {
    const client = new Client(url, pat)
    try {
        await client.loginWithToken(pat)
    } catch (err) {
        if (err instanceof AuthExpiredError) {
            console.error(chalk.red('Error: Invalid Personal Access Token.'))
        } else {
            console.error(chalk.red(`Error: ${(err as Error).message}`))
        }
        process.exit(EXIT_ERROR)
    }
    await showTeams(client)
    const path = saveConfig({ url, auth_method: 'token', token: pat })
    console.log(chalk.green(`Logged in as @${client.username} (PAT)`))
    console.log(chalk.dim(`Config saved to ${path}`))
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
                    console.error(chalk.red('Error: MFA code required.'))
                    process.exit(EXIT_ERROR)
                }
                try {
                    await client.loginWithPassword({
                        login_id: loginId,
                        password,
                        mfa_token: code,
                    })
                } catch {
                    console.error(chalk.red('Error: Invalid credentials or MFA code.'))
                    process.exit(EXIT_ERROR)
                }
            } else {
                console.error(chalk.red('Error: Invalid username or password.'))
                process.exit(EXIT_ERROR)
            }
        } else {
            console.error(chalk.red(`Error: ${(err as Error).message}`))
            process.exit(EXIT_ERROR)
        }
    }
    await showTeams(client)
    const path = saveConfig({ url, auth_method: 'password', token: client.token })
    console.log(chalk.green(`Logged in as @${client.username}`))
    console.log(chalk.dim(`Config saved to ${path}`))
}

async function showTeams(client: Client): Promise<void> {
    const teams = await client.getUserTeams(client.userId)
    if (!teams.length) {
        console.log(chalk.yellow("Warning: You don't belong to any teams."))
        return
    }
    if (teams.length === 1) {
        console.log(`Team: ${chalk.bold(teams[0]!.display_name)} ${chalk.dim('(' + teams[0]!.name + ')')}`)
        return
    }
    console.log('Teams:')
    for (const t of teams) {
        console.log(`  - ${chalk.bold(t.display_name)} ${chalk.dim('(' + t.name + ')')}`)
    }
    console.log(chalk.dim('Use --team <name> to filter commands to a specific team.'))
}
