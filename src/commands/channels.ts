import chalk from 'chalk'
import { Command } from 'commander'
import { getContext } from '../lib/auth.js'
import { type Channel, EXIT_ERROR } from '../lib/client.js'
import {
    channelRef,
    formatChannelsHuman,
    formatChannelsMd,
    formatUnreadHuman,
    formatUnreadMd,
    isoTs,
    TYPE_LABELS,
    type UnreadEntry,
} from '../lib/formatters.js'
import {
    computeUnreads,
    getChannelsAndMembers,
    resolveChannel as resolveChannelArg,
} from '../lib/helpers.js'
import { addOutputFlags, getOutputOptions, outputItem, outputList } from '../lib/output.js'
import { Resolver } from '../lib/resolve.js'
import { getState } from '../lib/state.js'
import { parseSince } from '../lib/time-utils.js'

const TYPE_FILTERS: Record<string, string> = {
    public: 'O',
    private: 'P',
    dm: 'D',
    group: 'G',
}

interface ChannelOut {
    id: string
    name: string
    display_name: string
    ref: string
    type: string
    type_label: string
    team: string
    team_id: string
    last_post_at: string
    last_post_at_ms: number
    purpose: string
    header: string
}

const CHANNEL_LIST_ESSENTIAL: (keyof ChannelOut)[] = [
    'id',
    'name',
    'ref',
    'type_label',
    'team',
    'last_post_at',
]

interface ChannelInfoOut {
    id: string
    name: string
    type: string
    purpose: string
    header: string
    member_count?: number
    pinned_count: number
    last_post_at: string
    created_at: string
}

const CHANNEL_INFO_ESSENTIAL: (keyof ChannelInfoOut)[] = [
    'id',
    'name',
    'type',
    'member_count',
    'pinned_count',
    'last_post_at',
]

const UNREAD_ESSENTIAL: (keyof UnreadEntry)[] = [
    'channel',
    'display_name',
    'type',
    'unread',
    'mentions',
    'team_name',
    'last_post_at',
]

export function registerChannelsCommand(program: Command): void {
    addOutputFlags(
        program
            .command('channel <channel>')
            .description('Show info about a single channel (name, @user, or ID).'),
    ).action(async (channelArg: string, opts: Record<string, unknown>, cmd: Command) => {
        const state = getState(cmd)
        const outputOpts = getOutputOptions(opts)
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

        const data: ChannelInfoOut = {
            id: ch.id,
            name: chInfo.display_name,
            type: TYPE_LABELS[ch.type] ?? ch.type,
            purpose: ch.purpose ?? '',
            header: ch.header ?? '',
            pinned_count: pinnedCount,
            last_post_at: isoTs(ch.last_post_at),
            created_at: isoTs(ch.create_at),
        }
        if (memberCount !== undefined) data.member_count = memberCount

        outputItem<ChannelInfoOut>(
            data,
            (info) => {
                const lines = [`${chalk.bold.magenta('#' + info.name)} ${chalk.dim('(' + info.type + ')')}`]
                if (info.purpose) lines.push(`${chalk.dim('Purpose:')} ${info.purpose}`)
                if (info.header) lines.push(`${chalk.dim('Header:')}  ${info.header}`)
                if (info.member_count !== undefined) {
                    lines.push(`${chalk.dim('Members:')} ${info.member_count}`)
                }
                lines.push(`${chalk.dim('Pinned:')}  ${info.pinned_count}`)
                if (info.last_post_at) lines.push(`${chalk.dim('Last:')}    ${info.last_post_at}`)
                if (info.created_at) lines.push(`${chalk.dim('Created:')} ${info.created_at}`)
                return lines.join('\n')
            },
            CHANNEL_INFO_ESSENTIAL,
            outputOpts,
            (info) => {
                const lines = [`## #${info.name}`, `Type: ${info.type}`]
                if (info.purpose) lines.push(`Purpose: ${info.purpose}`)
                if (info.header) lines.push(`Header: ${info.header}`)
                if (info.member_count !== undefined) lines.push(`Members: ${info.member_count}`)
                lines.push(`Pinned: ${info.pinned_count}`)
                if (info.last_post_at) lines.push(`Last post: ${info.last_post_at}`)
                if (info.created_at) lines.push(`Created: ${info.created_at}`)
                return lines.join('\n')
            },
        )
    })

    addOutputFlags(
        program
            .command('channels')
            .description('List channels you belong to.')
            .option('--type <type>', 'Filter by type: public, private, dm, group.')
            .option('--since <since>', 'Only channels with posts since (1h, 6h, 1d, today).'),
    ).action(
        async (
            opts: { type?: string; since?: string } & Record<string, unknown>,
            cmd: Command,
        ) => {
            const state = getState(cmd)
            const outputOpts = getOutputOptions(opts)
            const ctx = await getContext(state)
            const resolver = new Resolver(ctx.client, ctx.userId)

            const typeFilter = opts.type ? TYPE_FILTERS[opts.type] : undefined
            let sinceMs: number | undefined
            if (opts.since) {
                try {
                    sinceMs = parseSince(opts.since)
                } catch (err) {
                    console.error(chalk.red(`Error: ${(err as Error).message}`))
                    process.exit(EXIT_ERROR)
                }
            }

            const all: ChannelOut[] = []
            for (const team of ctx.teams) {
                const raw = await ctx.client.getChannelsForUser(ctx.userId, team.id)
                for (const ch of raw) {
                    if (typeFilter && ch.type !== typeFilter) continue
                    if (sinceMs && (ch.last_post_at ?? 0) < sinceMs) continue
                    const info = await resolver.formatChannel(ch)
                    all.push({
                        id: info.id,
                        name: info.name,
                        display_name: info.display_name,
                        ref: channelRef(ch),
                        type: info.type,
                        type_label: TYPE_LABELS[info.type] ?? info.type,
                        team: team.display_name,
                        team_id: team.id,
                        last_post_at: isoTs(ch.last_post_at),
                        last_post_at_ms: ch.last_post_at ?? 0,
                        purpose: ch.purpose ?? '',
                        header: ch.header ?? '',
                    })
                }
            }

            if (opts.since) {
                all.sort((a, b) => b.last_post_at_ms - a.last_post_at_ms)
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
            const deduped = all.filter((c) => {
                if (seen.has(c.id)) return false
                seen.add(c.id)
                return true
            })

            outputList<ChannelOut>(
                deduped,
                (items) =>
                    formatChannelsHuman(
                        items.map((c) => ({
                            id: c.id,
                            name: c.name,
                            display_name: c.display_name,
                            type: c.type,
                            team_name: c.team,
                            last_post_at: c.last_post_at_ms,
                            purpose: c.purpose,
                            header: c.header,
                        })) as Array<Channel & { team_name?: string }>,
                    ),
                CHANNEL_LIST_ESSENTIAL,
                outputOpts,
                (items) =>
                    formatChannelsMd(
                        items.map((c) => ({
                            id: c.id,
                            name: c.name,
                            display_name: c.display_name,
                            type: c.type,
                            team_name: c.team,
                            last_post_at: c.last_post_at_ms,
                        })) as Array<Channel & { team_name?: string }>,
                    ),
            )
        },
    )

    addOutputFlags(
        program
            .command('unread')
            .description('Show channels with unread messages. Muted channels hidden by default.')
            .option('--include-muted', 'Include muted channels.', false),
    ).action(
        async (opts: { includeMuted?: boolean } & Record<string, unknown>, cmd: Command) => {
            const state = getState(cmd)
            const outputOpts = getOutputOptions(opts)
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

            outputList<UnreadEntry>(
                deduped,
                formatUnreadHuman,
                UNREAD_ESSENTIAL,
                outputOpts,
                formatUnreadMd,
            )
        },
    )
}
