import chalk from 'chalk'
import { Command } from 'commander'
import { getContext } from '../lib/auth.js'
import { EXIT_ERROR } from '../lib/client.js'
import { channelRef, isoTs, truncateMessage, TYPE_LABELS } from '../lib/formatters.js'
import {
    computeUnreads,
    fetchRootContext,
    getChannelsAndMembers,
    resolveAuthors,
    searchMentions,
} from '../lib/helpers.js'
import { addOutputFlags, getOutputOptions, outputItem } from '../lib/output.js'
import { Resolver } from '../lib/resolve.js'
import { getState } from '../lib/state.js'
import { parseSince } from '../lib/time-utils.js'

interface MentionEntry {
    author: string
    message: string
    created_at: string
    channel: string
    thread_id: string
    is_reply: boolean
    root_message?: string
    root_author?: string
    is_bot?: boolean
}

interface UnreadEntryOut {
    channel: string
    ref: string
    type: string
    unread: number
    last_post_at: string
}

interface ActiveEntry {
    channel: string
    ref: string
    type: string
    last_post_at: string
}

interface OverviewData {
    since: string
    mentions: MentionEntry[]
    unread: UnreadEntryOut[]
    active_channels?: ActiveEntry[]
}

const OVERVIEW_ESSENTIAL: (keyof OverviewData)[] = [
    'since',
    'mentions',
    'unread',
    'active_channels',
]

export function registerOverviewCommand(program: Command): void {
    addOutputFlags(
        program
            .command('overview')
            .description('Get oriented: mentions, unread, and active channels in one call.')
            .option('--since <since>', 'Look back period (1h, 6h, 1d, 0 for all).', '6h'),
    ).action(async (opts: { since: string } & Record<string, unknown>, cmd: Command) => {
        const state = getState(cmd)
        const outputOpts = getOutputOptions(opts)
        const ctx = await getContext(state)
        const resolver = new Resolver(ctx.client, ctx.userId)

        const since = opts.since
        let sinceMs: number | undefined
        if (since && since !== '0') {
            try {
                sinceMs = parseSince(since)
            } catch (err) {
                console.error(chalk.red(`Error: ${(err as Error).message}`))
                process.exit(EXIT_ERROR)
            }
        }

        // 1. Mentions
        const mentionsRaw = await searchMentions(ctx, sinceMs)
        const mentionPosts = mentionsRaw.map(([p]) => p)
        const { userMap, authors } = await resolveAuthors(resolver, mentionPosts)
        const rootContext = await fetchRootContext(ctx, mentionPosts, userMap, authors)

        const mentions: MentionEntry[] = []
        for (const [p] of mentionsRaw) {
            const ch = await resolver.resolveChannel(p.channel_id ?? '')
            const rootId = p.root_id ?? ''
            const entry: MentionEntry = {
                author: authors[p.user_id ?? ''] ?? 'unknown',
                message: truncateMessage(p.message ?? '', 200),
                created_at: isoTs(p.create_at),
                channel: ch.display_name,
                thread_id: rootId || p.id,
                is_reply: Boolean(rootId),
            }
            if (rootId && rootContext[rootId]) {
                entry.root_message = rootContext[rootId]!.message
                entry.root_author = rootContext[rootId]!.author
            }
            if ((p.props as Record<string, unknown> | undefined)?.from_webhook === 'true') {
                entry.is_bot = true
            }
            mentions.push(entry)
        }

        // 2. Channels + members
        const pairs = await getChannelsAndMembers(ctx)

        // 3. Unreads
        const unreadsRaw = await computeUnreads(pairs, resolver)
        const unread: UnreadEntryOut[] = unreadsRaw
            .map((u) => ({
                channel: u.display_name,
                ref: channelRef(u),
                type: TYPE_LABELS[u.type] ?? u.type,
                unread: u.unread,
                last_post_at: isoTs(u.last_post_at),
            }))
            .sort((a, b) => b.unread - a.unread)

        // 4. Active channels
        const active: ActiveEntry[] = []
        if (sinceMs) {
            for (const { channel: ch } of pairs) {
                if ((ch.last_post_at ?? 0) >= sinceMs) {
                    const info = await resolver.formatChannel(ch)
                    active.push({
                        channel: info.display_name,
                        ref: channelRef(ch),
                        type: TYPE_LABELS[ch.type] ?? ch.type,
                        last_post_at: isoTs(ch.last_post_at),
                    })
                }
            }
            active.sort((a, b) => b.last_post_at.localeCompare(a.last_post_at))
        }

        const data: OverviewData = { since, mentions, unread }
        if (active.length) data.active_channels = active

        outputItem<OverviewData>(
            data,
            (d) => renderOverviewHuman(d),
            OVERVIEW_ESSENTIAL,
            outputOpts,
            (d) => renderOverviewRaw(d),
        )
    })
}

function renderOverviewHuman(d: OverviewData): string {
    const lines: string[] = []
    lines.push(chalk.bold(`Overview ${chalk.dim(`(last ${d.since})`)}`))
    lines.push('')

    lines.push(chalk.bold.cyan(`Mentions (${d.mentions.length})`))
    if (d.mentions.length) {
        for (const m of d.mentions) {
            const bot = m.is_bot ? ` ${chalk.yellow('[bot]')}` : ''
            lines.push(
                `  ${chalk.bold.cyan(m.author)}${bot} in ${chalk.magenta('#' + m.channel)} ${chalk.dim('(' + m.created_at + ')')}`,
            )
            if (m.root_message) {
                lines.push(`    ${chalk.dim('re: ' + m.root_author + ': ' + truncateMessage(m.root_message, 80))}`)
            }
            lines.push(`    ${truncateMessage(m.message, 80)}`)
        }
    } else {
        lines.push(chalk.dim('  No mentions.'))
    }
    lines.push('')

    lines.push(chalk.bold.cyan(`Unread (${d.unread.length} channels)`))
    if (d.unread.length) {
        for (const u of d.unread) {
            const name = chalk.bold(u.channel.padEnd(40))
            const cnt = chalk.cyan(`${String(u.unread).padStart(4)} unread`)
            lines.push(`  ${name} ${cnt}  ${chalk.dim('(' + u.type + ')')}`)
        }
    } else {
        lines.push(chalk.green('  All caught up.'))
    }

    if (d.active_channels?.length) {
        lines.push('')
        lines.push(chalk.bold.cyan(`Active Channels (${d.active_channels.length})`))
        for (const c of d.active_channels) {
            const name = chalk.bold(c.channel.padEnd(40))
            lines.push(`  ${name} ${chalk.dim('last: ' + c.last_post_at)}  ${chalk.dim('(' + c.type + ')')}`)
        }
    }

    return lines.join('\n').replace(/\s+$/, '')
}

function renderOverviewRaw(d: OverviewData): string {
    const lines: string[] = [`# Overview (last ${d.since})`, '']
    lines.push(`## Mentions (${d.mentions.length})`, '')
    if (d.mentions.length) {
        for (const m of d.mentions) {
            const bot = m.is_bot ? ' [bot]' : ''
            lines.push(`**${m.author}**${bot} in #${m.channel} (${m.created_at})`)
            if (m.root_message) {
                lines.push(`  re: ${m.root_author}: ${truncateMessage(m.root_message, 80)}`)
            }
            lines.push(`  ${truncateMessage(m.message, 80)}`)
            lines.push('')
        }
    } else {
        lines.push('No mentions.', '')
    }

    lines.push(`## Unread (${d.unread.length} channels)`, '')
    if (d.unread.length) {
        for (const u of d.unread) {
            lines.push(`  ${u.channel.padEnd(40)} ${String(u.unread).padStart(4)} unread  (${u.type})`)
        }
    } else {
        lines.push('All caught up.')
    }

    if (d.active_channels?.length) {
        lines.push('', `## Active Channels (${d.active_channels.length})`, '')
        for (const c of d.active_channels) {
            lines.push(`  ${c.channel.padEnd(40)} last: ${c.last_post_at}  (${c.type})`)
        }
    }

    return lines.join('\n').replace(/\s+$/, '')
}
