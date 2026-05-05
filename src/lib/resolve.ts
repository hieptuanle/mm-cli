import type { Channel, Client, User } from './client.js'

export interface UserInfo {
    id: string
    username: string
    display_name: string
    position?: string
}

export interface ChannelInfo {
    id: string
    name: string
    display_name: string
    type: string
    purpose?: string
    header?: string
}

function userDisplayName(user: User): string {
    const first = user.first_name ?? ''
    const last = user.last_name ?? ''
    const display = `${first} ${last}`.trim()
    return display || user.username
}

export class Resolver {
    private users = new Map<string, UserInfo>()
    private channels = new Map<string, ChannelInfo>()

    constructor(
        private client: Client,
        private myUserId: string,
    ) {}

    async resolveUser(userId: string): Promise<UserInfo> {
        const cached = this.users.get(userId)
        if (cached) return cached
        try {
            const u = await this.client.getUser(userId)
            const info: UserInfo = {
                id: u.id,
                username: u.username,
                display_name: userDisplayName(u),
            }
            if (u.position) info.position = u.position
            this.users.set(userId, info)
            return info
        } catch {
            const fallback: UserInfo = {
                id: userId,
                username: userId,
                display_name: userId,
            }
            this.users.set(userId, fallback)
            return fallback
        }
    }

    async resolveUsers(userIds: string[]): Promise<Record<string, UserInfo>> {
        const unique = [...new Set(userIds)]
        const uncached = unique.filter((id) => !this.users.has(id))
        if (uncached.length) {
            try {
                const users = await this.client.getUsersByIds(uncached)
                for (const u of users) {
                    const info: UserInfo = {
                        id: u.id,
                        username: u.username,
                        display_name: userDisplayName(u),
                    }
                    if (u.position) info.position = u.position
                    this.users.set(u.id, info)
                }
                // any still missing?
                for (const id of uncached) {
                    if (!this.users.has(id)) await this.resolveUser(id)
                }
            } catch {
                for (const id of uncached) await this.resolveUser(id)
            }
        }
        const out: Record<string, UserInfo> = {}
        for (const id of userIds) {
            out[id] = this.users.get(id) ?? { id, username: id, display_name: id }
        }
        return out
    }

    async resolveChannel(channelId: string): Promise<ChannelInfo> {
        const cached = this.channels.get(channelId)
        if (cached) return cached
        try {
            const ch = await this.client.getChannel(channelId)
            const info = await this.formatChannel(ch)
            this.channels.set(channelId, info)
            return info
        } catch {
            const fallback: ChannelInfo = {
                id: channelId,
                name: channelId,
                display_name: channelId,
                type: '?',
            }
            this.channels.set(channelId, fallback)
            return fallback
        }
    }

    async formatChannel(ch: Channel): Promise<ChannelInfo> {
        const type = ch.type ?? 'O'
        const name = ch.name ?? ''
        let displayName = ch.display_name ?? ''

        if (type === 'D') {
            displayName = await this.resolveDmName(name)
        } else if (type === 'G' && !displayName) {
            displayName = await this.resolveGroupDmName(name)
        }
        if (!displayName) displayName = name

        const result: ChannelInfo = {
            id: ch.id,
            name,
            display_name: displayName,
            type,
        }
        if (ch.purpose) result.purpose = ch.purpose
        if (ch.header) result.header = ch.header
        return result
    }

    private async resolveDmName(channelName: string): Promise<string> {
        const parts = channelName.split('__')
        const others = parts.filter((p) => p !== this.myUserId)
        if (others.length) {
            const user = await this.resolveUser(others[0]!)
            return `@${user.username}`
        }
        return channelName
    }

    private async resolveGroupDmName(channelName: string): Promise<string> {
        const parts = channelName.split('__')
        const others = parts.filter((p) => p !== this.myUserId)
        if (!others.length) return channelName
        const users = await this.resolveUsers(others)
        const names = others.map((id) => `@${users[id]!.username}`).sort()
        return names.join(', ')
    }

    async populateChannels(channels: Channel[]): Promise<void> {
        for (const ch of channels) {
            this.channels.set(ch.id, await this.formatChannel(ch))
        }
    }
}
