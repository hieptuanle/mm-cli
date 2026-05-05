import chalk from 'chalk'
import { Command } from 'commander'
import { getContext } from '../lib/auth.js'
import { EXIT_ERROR, type Post } from '../lib/client.js'
import {
    type EnrichedPost,
    enrichPosts,
    formatPostHuman,
    formatPostMd,
    truncateMessage,
} from '../lib/formatters.js'
import { fetchRootContext, resolveAuthors, searchMentions } from '../lib/helpers.js'
import { addOutputFlags, getOutputOptions, outputList } from '../lib/output.js'
import { Resolver } from '../lib/resolve.js'
import { getState } from '../lib/state.js'
import { parseSince } from '../lib/time-utils.js'

const POST_ESSENTIAL: (keyof EnrichedPost)[] = [
    'id',
    'thread_id',
    'is_reply',
    'author',
    'message',
    'created_at',
    'channel',
    'team',
]

export function registerSearchCommand(program: Command): void {
    addOutputFlags(
        program
            .command('mentions')
            .description('Show recent posts that mention you. Defaults to last 24h.')
            .option('--since <since>', 'Show mentions since (1h, 2d, today, 0 for all).', '1d')
            .option('--limit <n>', 'Max results.', '30'),
    ).action(
        async (opts: { since: string; limit?: string } & Record<string, unknown>, cmd: Command) => {
            const state = getState(cmd)
            const outputOpts = getOutputOptions(opts)
            const ctx = await getContext(state)
            const resolver = new Resolver(ctx.client, ctx.userId)

            const since = opts.since
            const limit = Number(opts.limit ?? 30)
            let sinceMs: number | undefined
            if (since && since !== '0') {
                try {
                    sinceMs = parseSince(since)
                } catch (err) {
                    console.error(chalk.red(`Error: ${(err as Error).message}`))
                    process.exit(EXIT_ERROR)
                }
            }

            const mentionsRaw = await searchMentions(ctx, sinceMs, limit)
            const posts = mentionsRaw.map(([p]) => p)
            const teamByPost: Record<string, string> = Object.fromEntries(
                mentionsRaw.map(([p, t]) => [p.id, t]),
            )

            const { userMap, authors } = await resolveAuthors(resolver, posts)

            const channelByPost: Record<string, string> = {}
            for (const p of posts) {
                const ch = await resolver.resolveChannel(p.channel_id ?? '')
                channelByPost[p.id] = ch.display_name
            }

            const rootContext = await fetchRootContext(ctx, posts, userMap, authors)

            type EnrichedWithRoot = EnrichedPost & { root?: { author: string; message: string; created_at: string } }
            const enriched: EnrichedWithRoot[] = enrichPosts(
                posts,
                authors,
                '',
                teamByPost,
                channelByPost,
            )
            for (const entry of enriched) {
                if (entry.is_reply) {
                    const rc = rootContext[entry.thread_id]
                    if (rc) entry.root = rc
                }
            }

            outputList<EnrichedWithRoot>(
                enriched,
                (items) => {
                    if (!items.length) return chalk.dim('No mentions.')
                    const lines: string[] = []
                    for (const e of items) {
                        const author = authors[posts.find((p) => p.id === e.id)?.user_id ?? ''] ?? e.author
                        const post = posts.find((p) => p.id === e.id)
                        if (!post) continue
                        if (e.root) {
                            lines.push(
                                chalk.dim(`re: ${e.root.author}: ${truncateMessage(e.root.message, 80)}`),
                            )
                        }
                        lines.push(formatPostHuman(post, author, channelByPost[e.id] ?? ''))
                    }
                    return lines.join('\n\n')
                },
                POST_ESSENTIAL,
                outputOpts,
                () => {
                    if (!posts.length) return 'No mentions.'
                    const lines: string[] = []
                    for (const p of posts) {
                        const author = authors[p.user_id ?? ''] ?? 'unknown'
                        const rc = rootContext[p.root_id ?? '']
                        if (rc) lines.push(`*re: ${rc.author}: ${truncateMessage(rc.message, 80)}*`)
                        lines.push(formatPostMd(p, author, channelByPost[p.id] ?? ''))
                        lines.push('')
                    }
                    return lines.join('\n').replace(/\s+$/, '')
                },
            )
        },
    )

    addOutputFlags(
        program
            .command('search <query>')
            .description('Search messages across all teams. Supports from:user, in:channel, before:, after:, on:.')
            .option('--limit <n>', 'Max results.', '30'),
    ).action(
        async (
            query: string,
            opts: { limit?: string } & Record<string, unknown>,
            cmd: Command,
        ) => {
            const state = getState(cmd)
            const outputOpts = getOutputOptions(opts)
            const ctx = await getContext(state)
            const resolver = new Resolver(ctx.client, ctx.userId)
            const limit = Number(opts.limit ?? 30)

            const all: Array<[Post, string]> = []
            for (const team of ctx.teams) {
                const result = await ctx.client.searchTeamPosts(team.id, query, false)
                const order = result.order ?? []
                const postsMap = result.posts ?? {}
                for (const pid of order) {
                    const p = postsMap[pid]
                    if (p) all.push([p, team.display_name])
                }
            }
            all.sort((a, b) => (b[0].create_at ?? 0) - (a[0].create_at ?? 0))
            const seen = new Set<string>()
            const deduped: Array<[Post, string]> = []
            for (const entry of all) {
                if (!seen.has(entry[0].id)) {
                    seen.add(entry[0].id)
                    deduped.push(entry)
                }
            }
            const trimmed = deduped.slice(0, limit)
            const posts = trimmed.map(([p]) => p)
            const teamByPost: Record<string, string> = Object.fromEntries(
                trimmed.map(([p, t]) => [p.id, t]),
            )

            const { authors } = await resolveAuthors(resolver, posts)

            const channelByPost: Record<string, string> = {}
            for (const p of posts) {
                const ch = await resolver.resolveChannel(p.channel_id ?? '')
                channelByPost[p.id] = ch.display_name
            }

            outputList<EnrichedPost>(
                enrichPosts(posts, authors, '', teamByPost, channelByPost),
                () => {
                    if (!posts.length) return chalk.dim('No results.')
                    const lines: string[] = []
                    for (const p of posts) {
                        const author = authors[p.user_id ?? ''] ?? 'unknown'
                        lines.push(formatPostHuman(p, author, channelByPost[p.id] ?? ''))
                    }
                    return lines.join('\n\n')
                },
                POST_ESSENTIAL,
                outputOpts,
                () => {
                    if (!posts.length) return 'No results.'
                    const lines: string[] = []
                    for (const p of posts) {
                        const author = authors[p.user_id ?? ''] ?? 'unknown'
                        lines.push(formatPostMd(p, author, channelByPost[p.id] ?? ''))
                        lines.push('')
                    }
                    return lines.join('\n').replace(/\s+$/, '')
                },
            )
        },
    )
}
