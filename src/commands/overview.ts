import { Command } from 'commander'
import { getContext } from '../lib/auth.js'
import { EXIT_ERROR } from '../lib/client.js'
import { channelRef, isoTs, TYPE_LABELS } from '../lib/formatters.js'
import {
    computeUnreads,
    fetchRootContext,
    getChannelsAndMembers,
    resolveAuthors,
    searchMentions,
} from '../lib/helpers.js'
import { Resolver } from '../lib/resolve.js'
import { getState } from '../lib/state.js'
import { parseSince } from '../lib/time-utils.js'

export function registerOverviewCommand(program: Command): void {
    program
        .command('overview')
        .description('Get oriented: mentions, unread, and active channels in one call.')
        .option('--since <since>', 'Look back period (1h, 6h, 1d, 0 for all).', '6h')
        .action(async (opts: { since: string }, cmd: Command) => {
            const state = getState(cmd)
            const ctx = await getContext(state)
            const resolver = new Resolver(ctx.client, ctx.userId)

            const since = opts.since
            let sinceMs: number | undefined
            if (since && since !== '0') {
                try {
                    sinceMs = parseSince(since)
                } catch (err) {
                    console.error(`Error: ${(err as Error).message}`)
                    process.exit(EXIT_ERROR)
                }
            }

            // 1. Mentions
            const mentionsRaw = await searchMentions(ctx, sinceMs)
            const mentionPosts = mentionsRaw.map(([p]) => p)
            const { userMap, authors } = await resolveAuthors(resolver, mentionPosts)
            const rootContext = await fetchRootContext(ctx, mentionPosts, userMap, authors)

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

            const mentionEntries: MentionEntry[] = []
            for (const [p] of mentionsRaw) {
                const ch = await resolver.resolveChannel(p.channel_id ?? '')
                const rootId = p.root_id ?? ''
                const entry: MentionEntry = {
                    author: authors[p.user_id ?? ''] ?? 'unknown',
                    message: (p.message ?? '').slice(0, 200),
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
                mentionEntries.push(entry)
            }

            // 2. Channels + members
            const pairs = await getChannelsAndMembers(ctx)

            // 3. Unreads
            const unreadsRaw = await computeUnreads(pairs, resolver)
            const unreads = unreadsRaw
                .map((u) => ({
                    channel: u.display_name,
                    ref: channelRef(u),
                    type: TYPE_LABELS[u.type] ?? u.type,
                    unread: u.unread,
                    last_post_at: isoTs(u.last_post_at),
                }))
                .sort((a, b) => b.unread - a.unread)

            // 4. Active channels
            interface Active {
                channel: string
                ref: string
                type: string
                last_post_at: string
            }
            const active: Active[] = []
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

            const data: Record<string, unknown> = {
                since,
                mentions: mentionEntries,
                unread: unreads,
            }
            if (active.length) data.active_channels = active

            if (!state.human) {
                console.log(JSON.stringify(data, null, 2))
                return
            }

            const lines = [`# Overview (last ${since})\n`]
            lines.push(`## Mentions (${mentionEntries.length})\n`)
            if (mentionEntries.length) {
                for (const m of mentionEntries) {
                    const bot = m.is_bot ? ' [bot]' : ''
                    lines.push(`**${m.author}**${bot} in #${m.channel} (${m.created_at})`)
                    if (m.root_message) {
                        lines.push(`  re: ${m.root_author}: ${m.root_message.slice(0, 80)}`)
                    }
                    lines.push(`  ${m.message.slice(0, 80)}`)
                    lines.push('')
                }
            } else {
                lines.push('No mentions.\n')
            }

            lines.push(`## Unread (${unreads.length} channels)\n`)
            if (unreads.length) {
                for (const u of unreads) {
                    lines.push(
                        `  ${u.channel.padEnd(40)} ${String(u.unread).padStart(4)} unread  (${u.type})`,
                    )
                }
            } else {
                lines.push('All caught up.\n')
            }

            if (active.length) {
                lines.push(`\n## Active Channels (${active.length})\n`)
                for (const c of active) {
                    lines.push(
                        `  ${c.channel.padEnd(40)} last: ${c.last_post_at}  (${c.type})`,
                    )
                }
            }
            console.log(lines.join('\n').replace(/\s+$/, ''))
        })
}
