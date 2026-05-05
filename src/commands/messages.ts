import { Command } from 'commander'
import { getContext } from '../lib/auth.js'
import { EXIT_ERROR, type Post } from '../lib/client.js'
import { formatPostsJson, formatPostsMd, isoTs } from '../lib/formatters.js'
import { fetchPostSilent, resolveAuthors, resolveChannel as resolveChannelArg } from '../lib/helpers.js'
import { Resolver } from '../lib/resolve.js'
import { getState } from '../lib/state.js'
import { parseSince } from '../lib/time-utils.js'

export function registerMessagesCommand(program: Command): void {
    program
        .command('messages <channel>')
        .description('Read messages from a channel (name, @user, or ID).')
        .option('--since <since>', 'Show messages since (1h, 2d, today, 2026-03-05).')
        .option('--limit <n>', 'Max messages (max 200).', '30')
        .option('--threads', 'Group by thread: show root + last reply + reply count.', false)
        .action(
            async (
                channelArg: string,
                opts: { since?: string; limit?: string; threads?: boolean },
                cmd: Command,
            ) => {
                const state = getState(cmd)
                const ctx = await getContext(state)
                const resolver = new Resolver(ctx.client, ctx.userId)

                const ch = await resolveChannelArg(ctx, channelArg)
                const chInfo = await resolver.formatChannel(ch)

                const limit = Math.max(1, Number(opts.limit ?? 30))
                const params: { per_page: number; since?: number } = {
                    per_page: Math.min(limit, 200),
                }
                if (opts.since) {
                    try {
                        params.since = parseSince(opts.since)
                    } catch (err) {
                        console.error(`Error: ${(err as Error).message}`)
                        process.exit(EXIT_ERROR)
                    }
                }

                const result = await ctx.client.getPostsForChannel(ch.id, params)
                const order = result.order ?? []
                const postsMap = result.posts ?? {}
                const posts: Post[] = []
                for (const pid of order) {
                    const p = postsMap[pid]
                    if (p) posts.push(p)
                }
                posts.reverse()
                const trimmed = posts.slice(0, limit)

                const { userMap, authors } = await resolveAuthors(resolver, trimmed)

                if (opts.threads) {
                    await renderThreadIndex(state, ctx, chInfo, trimmed, userMap, authors)
                    return
                }

                console.log(
                    state.human
                        ? formatPostsMd(trimmed, authors, chInfo.display_name)
                        : formatPostsJson(trimmed, authors, chInfo.display_name),
                )
            },
        )

    program
        .command('thread <postId>')
        .description('Read a thread by post ID. Returns root + last 9 replies by default.')
        .option('--limit <n>', 'Max messages (root + last N-1 replies). 0 for all.', '10')
        .option('--since <since>', 'Show replies since (1h, 2d, today). Root always included.')
        .action(
            async (
                postId: string,
                opts: { limit?: string; since?: string },
                cmd: Command,
            ) => {
                const state = getState(cmd)
                const ctx = await getContext(state)
                const resolver = new Resolver(ctx.client, ctx.userId)

                let result
                try {
                    result = await ctx.client.getThread(postId)
                } catch (err) {
                    console.error(`Error: Could not fetch thread '${postId}': ${(err as Error).message}`)
                    process.exit(EXIT_ERROR)
                }

                const order = result.order ?? []
                const postsMap = result.posts ?? {}
                let posts: Post[] = []
                for (const pid of order) {
                    const p = postsMap[pid]
                    if (p) posts.push(p)
                }
                posts.sort((a, b) => (a.create_at ?? 0) - (b.create_at ?? 0))

                if (opts.since && posts.length) {
                    let sinceMs: number
                    try {
                        sinceMs = parseSince(opts.since)
                    } catch (err) {
                        console.error(`Error: ${(err as Error).message}`)
                        process.exit(EXIT_ERROR)
                    }
                    const root = posts[0]!
                    const replies = posts.slice(1).filter((p) => (p.create_at ?? 0) >= sinceMs)
                    posts = [root, ...replies]
                }

                const limit = Number(opts.limit ?? 10)
                if (limit > 0 && posts.length > limit) {
                    const root = posts[0]!
                    posts = [root, ...posts.slice(-(limit - 1))]
                }

                const { authors } = await resolveAuthors(resolver, posts)

                let chName: string | undefined
                if (posts.length) {
                    const chInfo = await resolver.resolveChannel(posts[0]!.channel_id ?? '')
                    chName = chInfo.display_name
                }

                console.log(
                    state.human
                        ? formatPostsMd(posts, authors, chName)
                        : formatPostsJson(posts, authors, chName),
                )
            },
        )
}

async function renderThreadIndex(
    state: { human: boolean },
    ctx: Awaited<ReturnType<typeof getContext>>,
    chInfo: { display_name: string },
    posts: Post[],
    userMap: Awaited<ReturnType<typeof resolveAuthors>>['userMap'],
    authors: Record<string, string>,
): Promise<void> {
    const threadMap = new Map<string, Post[]>()
    for (const p of posts) {
        const tid = p.root_id || p.id
        const list = threadMap.get(tid) ?? []
        list.push(p)
        threadMap.set(tid, list)
    }

    interface Summary {
        thread_id: string
        root_author: string
        root_message: string
        root_created_at: string
        reply_count: number
        channel: string
        last_reply_author?: string
        last_reply_message?: string
        last_reply_at?: string
    }

    const summaries: Summary[] = []
    for (const [tid, tposts] of threadMap) {
        let root = await fetchPostSilent(ctx, tid)
        if (root) {
            const rootUid = root.user_id ?? ''
            if (!userMap[rootUid]) {
                const extra = await new Resolver(ctx.client, ctx.userId).resolveUsers([rootUid])
                for (const [uid, info] of Object.entries(extra)) {
                    userMap[uid] = info
                    authors[uid] = `@${info.username}`
                }
            }
        } else {
            root = tposts.find((tp) => !tp.root_id) ?? tposts[0]!
        }

        const last = tposts[tposts.length - 1]!
        const lastReply = last.id !== root.id ? last : undefined
        const replyCount = root.reply_count ?? Math.max(0, tposts.length - 1)

        const summary: Summary = {
            thread_id: tid,
            root_author: authors[root.user_id ?? ''] ?? 'unknown',
            root_message: (root.message ?? '').slice(0, 200),
            root_created_at: isoTs(root.create_at),
            reply_count: replyCount,
            channel: chInfo.display_name,
        }
        if (lastReply) {
            summary.last_reply_author = authors[lastReply.user_id ?? ''] ?? 'unknown'
            summary.last_reply_message = (lastReply.message ?? '').slice(0, 200)
            summary.last_reply_at = isoTs(lastReply.create_at)
        }
        summaries.push(summary)
    }

    summaries.sort((a, b) => {
        const ka = a.last_reply_at ?? a.root_created_at
        const kb = b.last_reply_at ?? b.root_created_at
        return kb.localeCompare(ka)
    })

    if (!state.human) {
        console.log(JSON.stringify(summaries, null, 2))
        return
    }

    const lines = [`## #${chInfo.display_name} - ${summaries.length} active threads\n`]
    for (const t of summaries) {
        lines.push(`**${t.root_author}** (${t.root_created_at}) [${t.reply_count} replies]`)
        lines.push(`  ${t.root_message.slice(0, 80)}`)
        if (t.last_reply_author) {
            lines.push(
                `  > last: ${t.last_reply_author} (${t.last_reply_at}): ${(t.last_reply_message ?? '').slice(0, 60)}`,
            )
        }
        lines.push(`  thread_id: ${t.thread_id}`)
        lines.push('')
    }
    console.log(lines.join('\n').replace(/\s+$/, ''))
}
