import {
    type Channel,
    type ChannelMember,
    EXIT_ERROR,
    type MMContext,
    type Post,
} from './client.js'
import { isoTs, truncateMessage } from './formatters.js'
import { Resolver, type UserInfo } from './resolve.js'

const ID_RE = /^[a-z0-9]{26}$/

export async function resolveChannel(ctx: MMContext, channelArg: string): Promise<Channel> {
    if (channelArg.startsWith('@')) {
        const username = channelArg.slice(1)
        try {
            const users = await ctx.client.getUsersByUsernames([username])
            if (!users.length) {
                console.error(`Error: User '${username}' not found.`)
                process.exit(EXIT_ERROR)
            }
            const otherId = users[0]!.id
            for (const team of ctx.teams) {
                const channels = await ctx.client.getChannelsForUser(ctx.userId, team.id)
                for (const ch of channels) {
                    if (ch.type === 'D' && ch.name.includes(otherId)) return ch
                }
            }
            console.error(`Error: No DM channel found with @${username}.`)
            process.exit(EXIT_ERROR)
        } catch (err) {
            console.error(`Error: Could not find DM channel with @${username}: ${(err as Error).message}`)
            process.exit(EXIT_ERROR)
        }
    }

    if (ID_RE.test(channelArg)) {
        try {
            return await ctx.client.getChannel(channelArg)
        } catch {
            console.error(`Error: Channel ID '${channelArg}' not found.`)
            process.exit(EXIT_ERROR)
        }
    }

    for (const team of ctx.teams) {
        try {
            return await ctx.client.getChannelByName(team.id, channelArg)
        } catch {
            // try next team
        }
    }

    console.error(`Error: Channel '${channelArg}' not found in any team.`)
    process.exit(EXIT_ERROR)
}

export async function fetchPostSilent(
    ctx: MMContext,
    postId: string,
): Promise<Post | undefined> {
    try {
        return await ctx.client.getPost(postId)
    } catch {
        return undefined
    }
}

export async function searchMentions(
    ctx: MMContext,
    sinceMs?: number,
    limit = 30,
): Promise<Array<[Post, string]>> {
    const all: Array<[Post, string]> = []
    for (const team of ctx.teams) {
        let terms = `@${ctx.username}`
        if (sinceMs) {
            const d = new Date(sinceMs)
            const yyyy = d.getUTCFullYear()
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
            const dd = String(d.getUTCDate()).padStart(2, '0')
            terms += ` after:${yyyy}-${mm}-${dd}`
        }
        const result = await ctx.client.searchTeamPosts(team.id, terms, false)
        for (const pid of result.order ?? []) {
            const post = result.posts?.[pid]
            if (post) all.push([post, team.display_name])
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
    return deduped.slice(0, limit)
}

export interface ChannelMemberPair {
    channel: Channel
    member: ChannelMember
    teamName: string
}

export async function getChannelsAndMembers(ctx: MMContext): Promise<ChannelMemberPair[]> {
    const results: ChannelMemberPair[] = []
    const seen = new Set<string>()
    for (const team of ctx.teams) {
        const channels = await ctx.client.getChannelsForUser(ctx.userId, team.id)
        const members = await ctx.client.getChannelMembersForUser(ctx.userId, team.id)
        const memberMap = new Map<string, ChannelMember>()
        for (const m of members) memberMap.set(m.channel_id, m)
        for (const ch of channels) {
            if (seen.has(ch.id)) continue
            seen.add(ch.id)
            const member = memberMap.get(ch.id)
            if (member) results.push({ channel: ch, member, teamName: team.display_name })
        }
    }
    return results
}

export interface UnreadInfo {
    channel_id: string
    channel: string
    display_name: string
    type: string
    unread: number
    mentions: number
    team_name: string
    team_id: string
    last_post_at: number
}

export async function computeUnreads(
    pairs: ChannelMemberPair[],
    resolver: Resolver,
    includeMuted = false,
): Promise<UnreadInfo[]> {
    const unreads: UnreadInfo[] = []
    for (const { channel: ch, member, teamName } of pairs) {
        if (!includeMuted) {
            const notify = member.notify_props ?? {}
            if (notify.mark_unread === 'mention') continue
        }

        let unreadCount = 0
        let mentionCount = 0
        if (ch.total_msg_count_root !== undefined && member.msg_count_root !== undefined) {
            unreadCount = Math.max(0, ch.total_msg_count_root - member.msg_count_root)
            mentionCount = member.mention_count_root ?? 0
        } else {
            const total = ch.total_msg_count ?? 0
            const seen = member.msg_count ?? 0
            unreadCount = Math.max(0, total - seen)
            mentionCount = member.mention_count ?? 0
        }

        if (unreadCount === 0 && mentionCount === 0) continue

        const info = await resolver.formatChannel(ch)
        unreads.push({
            channel_id: ch.id,
            channel: info.name,
            display_name: info.display_name,
            type: info.type,
            unread: unreadCount,
            mentions: mentionCount,
            team_name: teamName,
            team_id: ch.team_id ?? '',
            last_post_at: ch.last_post_at ?? 0,
        })
    }
    unreads.sort((a, b) => b.mentions - a.mentions || b.unread - a.unread)
    return unreads
}

export interface RootContext {
    author: string
    message: string
    created_at: string
}

export async function fetchRootContext(
    ctx: MMContext,
    posts: Post[],
    userMap: Record<string, UserInfo>,
    authors: Record<string, string>,
): Promise<Record<string, RootContext>> {
    const rootIds = new Set<string>()
    for (const p of posts) {
        if (p.root_id) rootIds.add(p.root_id)
    }
    const out: Record<string, RootContext> = {}
    for (const rid of rootIds) {
        const root = await fetchPostSilent(ctx, rid)
        if (!root) continue
        const rootUid = root.user_id ?? ''
        if (!userMap[rootUid]) {
            const extra = await new Resolver(ctx.client, ctx.userId).resolveUsers([rootUid])
            for (const [uid, info] of Object.entries(extra)) {
                userMap[uid] = info
                authors[uid] = `@${info.username}`
            }
        }
        out[rid] = {
            author: authors[rootUid] ?? 'unknown',
            message: truncateMessage(root.message ?? '', 200),
            created_at: isoTs(root.create_at),
        }
    }
    return out
}

export async function resolveAuthors(
    resolver: Resolver,
    posts: Post[],
): Promise<{ userMap: Record<string, UserInfo>; authors: Record<string, string> }> {
    const ids = [...new Set(posts.map((p) => p.user_id ?? '').filter(Boolean))]
    const userMap = ids.length ? await resolver.resolveUsers(ids) : {}
    const authors: Record<string, string> = {}
    for (const [uid, info] of Object.entries(userMap)) authors[uid] = `@${info.username}`
    return { userMap, authors }
}
