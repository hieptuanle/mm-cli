import chalk from 'chalk'
import { Command } from 'commander'
import { getContext } from '../lib/auth.js'
import { EXIT_ERROR, type Post } from '../lib/client.js'
import {
    type EnrichedPost,
    enrichPosts,
    formatPostHuman,
    formatPostMd,
} from '../lib/formatters.js'
import { resolveAuthors, resolveChannel as resolveChannelArg } from '../lib/helpers.js'
import { addOutputFlags, getOutputOptions, outputItem, outputList } from '../lib/output.js'
import { Resolver } from '../lib/resolve.js'
import { getState } from '../lib/state.js'

interface UserOut {
    user_id: string
    username: string
    display_name: string
    email: string
    position: string
    status: string
    locale: string
    timezone: string
}

const USER_ESSENTIAL: (keyof UserOut)[] = ['user_id', 'username', 'display_name', 'status']

interface MemberOut {
    user_id: string
    username: string
    display_name: string
    status: string
    position?: string
}

const MEMBER_ESSENTIAL: (keyof MemberOut)[] = ['username', 'display_name', 'status']

const POST_ESSENTIAL: (keyof EnrichedPost)[] = [
    'id',
    'thread_id',
    'is_reply',
    'author',
    'message',
    'created_at',
    'channel',
]

const STATUS_ICON: Record<string, string> = {
    online: '+',
    away: '~',
    offline: '-',
    dnd: 'x',
}
const STATUS_COLOR: Record<string, (s: string) => string> = {
    online: chalk.green,
    away: chalk.yellow,
    offline: chalk.dim,
    dnd: chalk.red,
}

export function registerPeopleCommand(program: Command): void {
    addOutputFlags(
        program
            .command('user <username>')
            .description('Show user profile and status (with or without @ prefix).'),
    ).action(async (usernameArg: string, opts: Record<string, unknown>, cmd: Command) => {
        const state = getState(cmd)
        const outputOpts = getOutputOptions(opts)
        const ctx = await getContext(state)
        const username = usernameArg.replace(/^@/, '')

        let u
        try {
            u = await ctx.client.getUserByUsername(username)
        } catch {
            console.error(chalk.red(`Error: User '@${username}' not found.`))
            process.exit(EXIT_ERROR)
        }

        let status = 'unknown'
        try {
            const r = await ctx.client.getUserStatus(u.id)
            status = r.status ?? 'unknown'
        } catch {}

        const display = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.username
        const tz = u.timezone ?? {}
        const data: UserOut = {
            user_id: u.id,
            username: u.username,
            display_name: display,
            email: u.email ?? '',
            position: u.position ?? '',
            status,
            locale: u.locale ?? '',
            timezone: tz.automaticTimezone || tz.manualTimezone || '',
        }

        outputItem<UserOut>(
            data,
            (info) => {
                const colorize = STATUS_COLOR[info.status] ?? chalk.white
                const lines = [
                    `${chalk.bold('@' + info.username)} ${chalk.dim(info.display_name)}`,
                    `  ${chalk.dim('Status:')}   ${colorize(info.status)}`,
                ]
                if (info.position) lines.push(`  ${chalk.dim('Position:')} ${info.position}`)
                if (info.email) lines.push(`  ${chalk.dim('Email:')}    ${info.email}`)
                if (info.timezone) lines.push(`  ${chalk.dim('Timezone:')} ${info.timezone}`)
                return lines.join('\n')
            },
            USER_ESSENTIAL,
            outputOpts,
            (info) => {
                const lines = [`**@${info.username}** (${info.display_name})`]
                if (info.position) lines.push(`Position: ${info.position}`)
                if (info.email) lines.push(`Email: ${info.email}`)
                lines.push(`Status: ${info.status}`)
                if (info.timezone) lines.push(`Timezone: ${info.timezone}`)
                return lines.join('\n')
            },
        )
    })

    addOutputFlags(
        program
            .command('pinned <channel>')
            .description('Show pinned posts in a channel.')
            .option('--limit <n>', 'Max pinned posts to show.', '10'),
    ).action(
        async (
            channelArg: string,
            opts: { limit?: string } & Record<string, unknown>,
            cmd: Command,
        ) => {
            const state = getState(cmd)
            const outputOpts = getOutputOptions(opts)
            const ctx = await getContext(state)
            const resolver = new Resolver(ctx.client, ctx.userId)

            const ch = await resolveChannelArg(ctx, channelArg)
            const chInfo = await resolver.formatChannel(ch)

            const result = await ctx.client.getPinnedPosts(ch.id)
            const order = result.order ?? []
            const postsMap = result.posts ?? {}
            let posts: Post[] = []
            for (const pid of order) {
                const p = postsMap[pid]
                if (p) posts.push(p)
            }
            posts.sort((a, b) => (b.create_at ?? 0) - (a.create_at ?? 0))
            posts = posts.slice(0, Number(opts.limit ?? 10))

            const { authors } = await resolveAuthors(resolver, posts)

            outputList<EnrichedPost>(
                enrichPosts(posts, authors, chInfo.display_name),
                () => {
                    if (!posts.length) return chalk.dim('No pinned posts.')
                    const lines: string[] = [
                        `${chalk.bold.magenta('#' + chInfo.display_name)} ${chalk.dim('— Pinned')}`,
                        '',
                    ]
                    for (const p of posts) {
                        const author = authors[p.user_id ?? ''] ?? 'unknown'
                        lines.push(formatPostHuman(p, author, chInfo.display_name))
                    }
                    return lines.join('\n\n')
                },
                POST_ESSENTIAL,
                outputOpts,
                () => {
                    if (!posts.length) return 'No pinned posts.'
                    const lines = [`## #${chInfo.display_name} - Pinned`, '']
                    for (const p of posts) {
                        const author = authors[p.user_id ?? ''] ?? 'unknown'
                        lines.push(formatPostMd(p, author, chInfo.display_name))
                        lines.push('')
                    }
                    return lines.join('\n').replace(/\s+$/, '')
                },
            )
        },
    )

    addOutputFlags(
        program
            .command('members <channel>')
            .description('List members of a channel.'),
    ).action(async (channelArg: string, opts: Record<string, unknown>, cmd: Command) => {
        const state = getState(cmd)
        const outputOpts = getOutputOptions(opts)
        const ctx = await getContext(state)
        const resolver = new Resolver(ctx.client, ctx.userId)

        const ch = await resolveChannelArg(ctx, channelArg)

        const all: Array<{ channel_id: string; user_id: string }> = []
        const perPage = 200
        let page = 0
        while (true) {
            const batch = await ctx.client.getChannelMembers(ch.id, page, perPage)
            if (!batch.length) break
            all.push(...batch)
            if (batch.length < perPage) break
            page += 1
        }

        const userIds = all.map((m) => m.user_id)
        const userMap = await resolver.resolveUsers(userIds)

        let statusMap: Record<string, string> = {}
        try {
            const statuses = await ctx.client.getUsersStatusByIds(userIds)
            statusMap = Object.fromEntries(statuses.map((s) => [s.user_id, s.status]))
        } catch {}

        const out: MemberOut[] = []
        for (const m of all) {
            const info = userMap[m.user_id] ?? { username: 'unknown', display_name: '' }
            const entry: MemberOut = {
                user_id: m.user_id,
                username: info.username,
                display_name: info.display_name,
                status: statusMap[m.user_id] ?? 'unknown',
            }
            if (info.position) entry.position = info.position
            out.push(entry)
        }

        const order: Record<string, number> = { online: 0, away: 1, dnd: 2, offline: 3 }
        out.sort((a, b) => {
            const sa = order[a.status] ?? 9
            const sb = order[b.status] ?? 9
            if (sa !== sb) return sa - sb
            return a.username.localeCompare(b.username)
        })

        outputList<MemberOut>(
            out,
            (items) => {
                const lines: string[] = [chalk.dim(`${items.length} members:`)]
                for (const m of items) {
                    const ic = STATUS_ICON[m.status] ?? '?'
                    const colorize = STATUS_COLOR[m.status] ?? chalk.white
                    const pos = m.position ? chalk.dim(` (${m.position})`) : ''
                    lines.push(`  ${colorize(ic)} ${chalk.bold('@' + m.username)}${pos}`)
                }
                return lines.join('\n')
            },
            MEMBER_ESSENTIAL,
            outputOpts,
            (items) => {
                const lines: string[] = []
                for (const m of items) {
                    const ic = STATUS_ICON[m.status] ?? '?'
                    const pos = m.position ? ` (${m.position})` : ''
                    lines.push(`  ${ic} @${m.username}${pos}`)
                }
                return `${items.length} members:\n${lines.join('\n')}`
            },
        )
    })
}
