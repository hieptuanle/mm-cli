import { Command } from 'commander'
import { getContext } from '../lib/auth.js'
import { type Channel, EXIT_ERROR } from '../lib/client.js'
import {
    formatChannelsJson,
    formatChannelsMd,
    formatUnreadJson,
    formatUnreadMd,
    isoTs,
    TYPE_LABELS,
} from '../lib/formatters.js'
import {
    computeUnreads,
    getChannelsAndMembers,
    resolveChannel as resolveChannelArg,
} from '../lib/helpers.js'
import { Resolver } from '../lib/resolve.js'
import { getState } from '../lib/state.js'
import { parseSince } from '../lib/time-utils.js'

const TYPE_FILTERS: Record<string, string> = {
    public: 'O',
    private: 'P',
    dm: 'D',
    group: 'G',
}

export function registerChannelsCommand(program: Command): void {
    program
        .command('channel <channel>')
        .description('Show info about a single channel (name, @user, or ID).')
        .action(async (channelArg: string, _opts: object, cmd: Command) => {
            const state = getState(cmd)
            const ctx = await getContext(state)
            const resolver = new Resolver(ctx.client, ctx.userId)

            const ch = await resolveChannelArg(ctx, channelArg)
            const chInfo = await resolver.formatChannel(ch)

            let memberCount: number | undefined
            try {
                const stats = await ctx.client.getChannelStats(ch.id)
                memberCount = stats.member_count
            } catch {}

            let pinnedCount = 0
            try {
                const pinned = await ctx.client.getPinnedPosts(ch.id)
                pinnedCount = (pinned.order ?? []).length
            } catch {}

            const info: Record<string, unknown> = {
                id: ch.id,
                name: chInfo.display_name,
                type: TYPE_LABELS[ch.type] ?? ch.type,
                purpose: ch.purpose ?? '',
                header: ch.header ?? '',
                last_post_at: isoTs(ch.last_post_at),
                created_at: isoTs(ch.create_at),
                pinned_count: pinnedCount,
            }
            if (memberCount !== undefined) info.member_count = memberCount

            for (const k of Object.keys(info)) {
                const v = info[k]
                if (v === '' || v === null || v === undefined) delete info[k]
            }

            if (!state.human) {
                console.log(JSON.stringify(info, null, 2))
                return
            }
            const lines = [`## #${info.name}`]
            lines.push(`Type: ${info.type ?? '?'}`)
            if (info.purpose) lines.push(`Purpose: ${info.purpose}`)
            if (info.header) lines.push(`Header: ${info.header}`)
            if (memberCount !== undefined) lines.push(`Members: ${memberCount}`)
            lines.push(`Pinned: ${pinnedCount}`)
            lines.push(`Last post: ${info.last_post_at ?? '?'}`)
            lines.push(`Created: ${info.created_at ?? '?'}`)
            console.log(lines.join('\n'))
        })

    program
        .command('channels')
        .description('List channels you belong to.')
        .option('--type <type>', 'Filter by type: public, private, dm, group.')
        .option('--since <since>', 'Only channels with posts since (1h, 6h, 1d, today).')
        .action(
            async (
                opts: { type?: string; since?: string },
                cmd: Command,
            ) => {
                const state = getState(cmd)
                const ctx = await getContext(state)
                const resolver = new Resolver(ctx.client, ctx.userId)

                const typeFilter = opts.type ? TYPE_FILTERS[opts.type] : undefined
                let sinceMs: number | undefined
                if (opts.since) {
                    try {
                        sinceMs = parseSince(opts.since)
                    } catch (err) {
                        console.error(`Error: ${(err as Error).message}`)
                        process.exit(EXIT_ERROR)
                    }
                }

                interface Out {
                    id: string
                    name: string
                    display_name: string
                    type: string
                    purpose?: string
                    header?: string
                    team_name: string
                    team_id: string
                    last_post_at: number
                }

                const all: Out[] = []
                for (const team of ctx.teams) {
                    const raw = await ctx.client.getChannelsForUser(ctx.userId, team.id)
                    for (const ch of raw) {
                        if (typeFilter && ch.type !== typeFilter) continue
                        if (sinceMs && (ch.last_post_at ?? 0) < sinceMs) continue
                        const info = await resolver.formatChannel(ch)
                        all.push({
                            ...info,
                            team_name: team.display_name,
                            team_id: team.id,
                            last_post_at: ch.last_post_at ?? 0,
                        })
                    }
                }

                if (opts.since) {
                    all.sort((a, b) => (b.last_post_at ?? 0) - (a.last_post_at ?? 0))
                } else {
                    const order: Record<string, number> = { O: 0, P: 1, G: 2, D: 3 }
                    all.sort((a, b) => {
                        const ta = order[a.type] ?? 9
                        const tb = order[b.type] ?? 9
                        if (ta !== tb) return ta - tb
                        return a.display_name.toLowerCase().localeCompare(b.display_name.toLowerCase())
                    })
                }

                const seen = new Set<string>()
                const deduped: Array<Channel & { team_name: string }> = []
                for (const c of all) {
                    if (seen.has(c.id)) continue
                    seen.add(c.id)
                    deduped.push(c as unknown as Channel & { team_name: string })
                }

                console.log(state.human ? formatChannelsMd(deduped) : formatChannelsJson(deduped))
            },
        )

    program
        .command('unread')
        .description('Show channels with unread messages. Muted channels hidden by default.')
        .option('--include-muted', 'Include muted channels.', false)
        .action(async (opts: { includeMuted?: boolean }, cmd: Command) => {
            const state = getState(cmd)
            const ctx = await getContext(state)
            const resolver = new Resolver(ctx.client, ctx.userId)

            const pairs = await getChannelsAndMembers(ctx)
            const unreads = await computeUnreads(pairs, resolver, Boolean(opts.includeMuted))

            const seen = new Set<string>()
            const deduped = unreads.filter((u) => {
                if (seen.has(u.channel_id)) return false
                seen.add(u.channel_id)
                return true
            })

            console.log(state.human ? formatUnreadMd(deduped) : formatUnreadJson(deduped))
        })
}
