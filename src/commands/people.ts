import { Command } from 'commander'
import { getContext } from '../lib/auth.js'
import { EXIT_ERROR, type Post } from '../lib/client.js'
import { enrichPosts, formatPostMd } from '../lib/formatters.js'
import { resolveAuthors, resolveChannel as resolveChannelArg } from '../lib/helpers.js'
import { Resolver } from '../lib/resolve.js'
import { getState } from '../lib/state.js'

export function registerPeopleCommand(program: Command): void {
    program
        .command('user <username>')
        .description('Show user profile and status (with or without @ prefix).')
        .action(async (usernameArg: string, _opts: object, cmd: Command) => {
            const state = getState(cmd)
            const ctx = await getContext(state)
            const username = usernameArg.replace(/^@/, '')

            let u
            try {
                u = await ctx.client.getUserByUsername(username)
            } catch {
                console.error(`Error: User '@${username}' not found.`)
                process.exit(EXIT_ERROR)
            }

            let status = 'unknown'
            try {
                const r = await ctx.client.getUserStatus(u.id)
                status = r.status ?? 'unknown'
            } catch {}

            const display = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.username
            const info: Record<string, string> = {
                user_id: u.id,
                username: u.username,
                display_name: display,
                email: u.email ?? '',
                position: u.position ?? '',
                status,
                locale: u.locale ?? '',
            }
            const tz = u.timezone ?? {}
            if (tz.automaticTimezone) info.timezone = tz.automaticTimezone
            else if (tz.manualTimezone) info.timezone = tz.manualTimezone

            for (const k of Object.keys(info)) if (!info[k]) delete info[k]

            if (!state.human) {
                console.log(JSON.stringify(info, null, 2))
                return
            }
            const lines = [`**@${info.username}** (${info.display_name ?? ''})`]
            if (info.position) lines.push(`Position: ${info.position}`)
            if (info.email) lines.push(`Email: ${info.email}`)
            lines.push(`Status: ${info.status ?? 'unknown'}`)
            if (info.timezone) lines.push(`Timezone: ${info.timezone}`)
            console.log(lines.join('\n'))
        })

    program
        .command('pinned <channel>')
        .description('Show pinned posts in a channel.')
        .option('--limit <n>', 'Max pinned posts to show.', '10')
        .action(
            async (
                channelArg: string,
                opts: { limit?: string },
                cmd: Command,
            ) => {
                const state = getState(cmd)
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

                if (!posts.length) {
                    console.log(state.human ? 'No pinned posts.' : '[]')
                    return
                }

                const { authors } = await resolveAuthors(resolver, posts)

                if (!state.human) {
                    console.log(JSON.stringify(enrichPosts(posts, authors, chInfo.display_name), null, 2))
                    return
                }

                const lines = [`## #${chInfo.display_name} - Pinned`, '']
                for (const p of posts) {
                    const author = authors[p.user_id ?? ''] ?? 'unknown'
                    lines.push(formatPostMd(p, author, chInfo.display_name))
                    lines.push('')
                }
                console.log(lines.join('\n').replace(/\s+$/, ''))
            },
        )

    program
        .command('members <channel>')
        .description('List members of a channel.')
        .action(async (channelArg: string, _opts: object, cmd: Command) => {
            const state = getState(cmd)
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

            interface MemberOut {
                user_id: string
                username: string
                display_name: string
                status: string
                position?: string
            }

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

            if (!state.human) {
                console.log(JSON.stringify(out, null, 2))
                return
            }
            const icons: Record<string, string> = { online: '+', away: '~', offline: '-', dnd: 'x' }
            const lines: string[] = []
            for (const m of out) {
                const ic = icons[m.status] ?? '?'
                const pos = m.position ? ` (${m.position})` : ''
                lines.push(`  ${ic} @${m.username}${pos}`)
            }
            console.log(`${out.length} members:\n${lines.join('\n')}`)
        })
}
