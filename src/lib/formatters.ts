import type { Channel, Post } from './client.js'

export const TYPE_LABELS: Record<string, string> = {
    O: 'Public',
    P: 'Private',
    D: 'DM',
    G: 'Group DM',
}

export function isoTs(epochMs: number | undefined): string {
    if (!epochMs) return ''
    return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

interface ChannelLike {
    id?: string
    channel_id?: string
    name?: string
    channel?: string
    display_name?: string
    type?: string
}

export function channelRef(ch: ChannelLike): string {
    const t = ch.type ?? ''
    if (t === 'D' || t === 'G') {
        return ch.id ?? ch.channel_id ?? ''
    }
    return ch.name ?? ch.channel ?? ch.id ?? ch.channel_id ?? ''
}

export interface EnrichedPost {
    id: string
    thread_id: string
    is_reply: boolean
    author: string
    message: string
    created_at: string
    channel_id: string
    file_count: number
    reply_count?: number
    files?: Array<{ name: string; size: number }>
    is_bot?: boolean
    bot_name?: string
    reactions?: Record<string, number>
    channel?: string
    team?: string
}

export function enrichPost(
    post: Post,
    author: string,
    channelName = '',
    teamName = '',
): EnrichedPost {
    const rootId = post.root_id ?? ''
    const fileIds = post.file_ids ?? []
    const entry: EnrichedPost = {
        id: post.id,
        thread_id: rootId || post.id,
        is_reply: Boolean(rootId),
        author,
        message: post.message ?? '',
        created_at: isoTs(post.create_at),
        channel_id: post.channel_id ?? '',
        file_count: fileIds.length,
    }

    if (!rootId && post.reply_count) entry.reply_count = post.reply_count

    if (fileIds.length && post.metadata?.files) {
        entry.files = post.metadata.files.map((f) => ({
            name: f.name ?? '',
            size: f.size ?? 0,
        }))
    }

    const props = (post.props ?? {}) as Record<string, unknown>
    if (props.from_webhook === 'true') {
        entry.is_bot = true
        const webhookName = (props.override_username as string) ?? ''
        if (webhookName) entry.bot_name = webhookName
        if (!entry.message && Array.isArray(props.attachments)) {
            const parts: string[] = []
            for (const att of props.attachments as Array<Record<string, unknown>>) {
                if (att.pretext) parts.push(String(att.pretext))
                if (att.text) parts.push(String(att.text))
                const fields = (att.fields as Array<Record<string, unknown>>) ?? []
                for (const field of fields) {
                    if (field.title) parts.push(String(field.title))
                    if (field.value) parts.push(String(field.value).slice(0, 200))
                }
            }
            if (parts.length) entry.message = parts.join('\n').slice(0, 500)
        }
    }

    const reactions = post.metadata?.reactions
    if (reactions && reactions.length) {
        const counts: Record<string, number> = {}
        for (const r of reactions) {
            const name = r.emoji_name ?? ''
            counts[name] = (counts[name] ?? 0) + 1
        }
        entry.reactions = counts
    }

    if (channelName) entry.channel = channelName
    if (teamName) entry.team = teamName
    return entry
}

export function enrichPosts(
    posts: Post[],
    authors: Record<string, string>,
    channelName = '',
    teamByPost: Record<string, string> = {},
    channelByPost: Record<string, string> = {},
): EnrichedPost[] {
    return posts.map((p) => {
        const uid = p.user_id ?? ''
        const author = authors[uid] ?? 'unknown'
        const ch = channelName || channelByPost[p.id] || ''
        const team = teamByPost[p.id] ?? ''
        return enrichPost(p, author, ch, team)
    })
}

interface ChannelEntry {
    id: string
    name?: string
    display_name?: string
    ref?: string
    type?: string
    team?: string
    team_name?: string
    last_post_at?: number | string
    purpose?: string
    header?: string
}

export function formatChannelsMd(channels: Array<Channel & { team_name?: string }>): string {
    if (!channels.length) return 'No channels found.'
    const lines = ['| Channel | Type | Team |', '|---------|------|------|']
    for (const ch of channels) {
        const name = ch.display_name
        const t = TYPE_LABELS[ch.type] ?? ch.type
        const team = ch.team_name ?? ''
        lines.push(`| ${name} | ${t} | ${team} |`)
    }
    return lines.join('\n')
}

export function formatChannelsJson(channels: Array<Channel & { team_name?: string }>): string {
    const out: ChannelEntry[] = []
    for (const ch of channels) {
        const t = ch.type
        const entry: ChannelEntry = {
            id: ch.id,
            name: ch.display_name || ch.name,
            ref: channelRef(ch),
            type: TYPE_LABELS[t] ?? t,
            team: ch.team_name ?? '',
        }
        if (ch.last_post_at) entry.last_post_at = isoTs(ch.last_post_at)
        if (ch.purpose) entry.purpose = ch.purpose
        if (ch.header) entry.header = ch.header
        out.push(entry)
    }
    return JSON.stringify(out, null, 2)
}

export interface UnreadEntry {
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

export function formatUnreadMd(unreads: UnreadEntry[]): string {
    if (!unreads.length) return 'No unread messages.'
    const lines = [
        '| Channel | Unread | Mentions | Team |',
        '|---------|--------|----------|------|',
    ]
    for (const u of unreads) {
        const mentions = u.mentions > 0 ? `**${u.mentions}**` : '0'
        lines.push(`| ${u.display_name} | ${u.unread} | ${mentions} | ${u.team_name} |`)
    }
    return lines.join('\n')
}

export function formatUnreadJson(unreads: UnreadEntry[]): string {
    return JSON.stringify(
        unreads.map((u) => ({
            channel_id: u.channel_id,
            channel: u.display_name,
            ref: channelRef(u),
            type: TYPE_LABELS[u.type] ?? u.type,
            unread: u.unread,
            mentions: u.mentions,
            team: u.team_name,
            last_post_at: isoTs(u.last_post_at),
        })),
        null,
        2,
    )
}

function formatTimestamp(ms: number | undefined): string {
    if (!ms) return '??:??'
    const dt = new Date(ms)
    const now = new Date()
    const sameDay =
        dt.getUTCFullYear() === now.getUTCFullYear() &&
        dt.getUTCMonth() === now.getUTCMonth() &&
        dt.getUTCDate() === now.getUTCDate()
    const hh = String(dt.getUTCHours()).padStart(2, '0')
    const mm = String(dt.getUTCMinutes()).padStart(2, '0')
    if (sameDay) return `${hh}:${mm}`
    const yyyy = dt.getUTCFullYear()
    const mo = String(dt.getUTCMonth() + 1).padStart(2, '0')
    const d = String(dt.getUTCDate()).padStart(2, '0')
    return `${yyyy}-${mo}-${d} ${hh}:${mm}`
}

export function formatPostMd(
    post: Post,
    author: string,
    channelName?: string,
    indent = false,
): string {
    const ts = formatTimestamp(post.create_at)
    const msg = (post.message ?? '').trim()
    const prefix = indent ? '> ' : ''
    let header = `${prefix}**${author}** (${ts})`
    if (channelName) header = `${prefix}**${author}** in #${channelName} (${ts})`

    const annotations: string[] = []
    if (post.reply_count && !post.root_id) annotations.push(`${post.reply_count} replies`)

    const fileIds = post.file_ids ?? []
    let fileNames: string[] = []
    if (fileIds.length && post.metadata?.files) {
        fileNames = post.metadata.files.map((f) => f.name ?? '').filter(Boolean)
    }
    if (fileNames.length) annotations.push(`files: ${fileNames.join(', ')}`)
    else if (fileIds.length) {
        annotations.push(`${fileIds.length} file${fileIds.length > 1 ? 's' : ''}`)
    }

    const suffix = annotations.length ? ` [${annotations.join(', ')}]` : ''

    if (!msg) {
        if (fileNames.length) return header + suffix
        if (post.type) return `${header} *(${post.type})*`
        return `${header} *(no text)*${suffix}`
    }

    let body = msg
    if (indent && body.includes('\n')) {
        body = body.split('\n').join('\n> ')
    }

    return `${header}${suffix}\n${prefix}${body}`
}

export function formatPostsMd(
    posts: Post[],
    authors: Record<string, string>,
    channelName?: string,
): string {
    if (!posts.length) return 'No messages.'
    const lines: string[] = []
    if (channelName) lines.push(`## #${channelName}\n`)
    for (const p of posts) {
        const author = authors[p.user_id ?? ''] ?? 'unknown'
        const isReply = Boolean(p.root_id)
        lines.push(formatPostMd(p, author, undefined, isReply))
        lines.push('')
    }
    return lines.join('\n').replace(/\s+$/, '')
}

export function formatPostsJson(
    posts: Post[],
    authors: Record<string, string>,
    channelName?: string,
): string {
    return JSON.stringify(enrichPosts(posts, authors, channelName ?? ''), null, 2)
}
