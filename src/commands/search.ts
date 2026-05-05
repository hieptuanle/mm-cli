import { Command } from 'commander'
import { getContext } from '../lib/auth.js'
import { EXIT_ERROR, type Post } from '../lib/client.js'
import { enrichPosts, formatPostMd } from '../lib/formatters.js'
import { fetchRootContext, resolveAuthors, searchMentions } from '../lib/helpers.js'
import { Resolver } from '../lib/resolve.js'
import { getState } from '../lib/state.js'
import { parseSince } from '../lib/time-utils.js'

export function registerSearchCommand(program: Command): void {
    program
        .command('mentions')
        .description('Show recent posts that mention you. Defaults to last 24h.')
        .option('--since <since>', 'Show mentions since (1h, 2d, today, 0 for all).', '1d')
        .option('--limit <n>', 'Max results.', '30')
        .action(async (opts: { since: string; limit?: string }, cmd: Command) => {
            const state = getState(cmd)
            const ctx = await getContext(state)
            const resolver = new Resolver(ctx.client, ctx.userId)

            const since = opts.since
            const limit = Number(opts.limit ?? 30)
            let sinceMs: number | undefined
            if (since && since !== '0') {
                try {
                    sinceMs = parseSince(since)
                } catch (err) {
                    console.error(`Error: ${(err as Error).message}`)
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

            const enriched = enrichPosts(posts, authors, '', teamByPost, channelByPost) as Array<
                ReturnType<typeof enrichPosts>[number] & { root?: typeof rootContext[string] }
            >
            for (const entry of enriched) {
                if (entry.is_reply) {
                    const rc = rootContext[entry.thread_id]
                    if (rc) entry.root = rc
                }
            }

            if (!state.human) {
                console.log(JSON.stringify(enriched, null, 2))
                return
            }

            const byChannel = new Map<string, Post[]>()
            for (const p of posts) {
                const ch = await resolver.resolveChannel(p.channel_id ?? '')
                const list = byChannel.get(ch.display_name) ?? []
                list.push(p)
                byChannel.set(ch.display_name, list)
            }

            const lines: string[] = []
            for (const [chName, chPosts] of byChannel) {
                lines.push(`## #${chName}\n`)
                for (const p of chPosts) {
                    const author = authors[p.user_id ?? ''] ?? 'unknown'
                    const rc = rootContext[p.root_id ?? '']
                    if (rc) lines.push(`*re: ${rc.author}: ${rc.message.slice(0, 80)}*\n`)
                    lines.push(formatPostMd(p, author))
                    lines.push('')
                }
            }
            console.log(lines.length ? lines.join('\n').replace(/\s+$/, '') : 'No mentions found.')
        })

    program
        .command('search <query>')
        .description('Search messages across all teams. Supports from:user, in:channel, before:, after:, on:.')
        .option('--limit <n>', 'Max results.', '30')
        .action(async (query: string, opts: { limit?: string }, cmd: Command) => {
            const state = getState(cmd)
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

            if (!state.human) {
                console.log(
                    JSON.stringify(enrichPosts(posts, authors, '', teamByPost, channelByPost), null, 2),
                )
                return
            }
            const lines: string[] = []
            for (const p of posts) {
                const author = authors[p.user_id ?? ''] ?? 'unknown'
                const ch = await resolver.resolveChannel(p.channel_id ?? '')
                lines.push(formatPostMd(p, author, ch.display_name))
                lines.push('')
            }
            console.log(lines.length ? lines.join('\n').replace(/\s+$/, '') : 'No results found.')
        })
}
