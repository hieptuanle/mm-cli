export const EXIT_OK = 0
export const EXIT_ERROR = 1
export const EXIT_AUTH_EXPIRED = 2
export const EXIT_RATE_LIMITED = 3

export class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
        super(message)
        this.name = 'ApiError'
        this.status = status
    }
}

export class AuthExpiredError extends Error {
    constructor(message = 'Authentication expired') {
        super(message)
        this.name = 'AuthExpiredError'
    }
}

export interface Team {
    id: string
    name: string
    display_name: string
}

export interface User {
    id: string
    username: string
    first_name?: string
    last_name?: string
    email?: string
    position?: string
    locale?: string
    timezone?: { automaticTimezone?: string; manualTimezone?: string }
}

export interface Channel {
    id: string
    name: string
    display_name: string
    type: string
    team_id?: string
    purpose?: string
    header?: string
    last_post_at?: number
    create_at?: number
    total_msg_count?: number
    total_msg_count_root?: number
}

export interface ChannelMember {
    channel_id: string
    user_id: string
    msg_count?: number
    msg_count_root?: number
    mention_count?: number
    mention_count_root?: number
    notify_props?: Record<string, string>
}

export interface Post {
    id: string
    create_at: number
    update_at?: number
    user_id: string
    channel_id: string
    root_id?: string
    message: string
    type?: string
    props?: Record<string, unknown>
    file_ids?: string[]
    metadata?: {
        files?: Array<{ name?: string; size?: number }>
        reactions?: Array<{ emoji_name?: string }>
    }
    reply_count?: number
}

export interface PostList {
    order: string[]
    posts: Record<string, Post>
}

export interface MMContext {
    client: Client
    userId: string
    username: string
    teams: Team[]
}

function normalizeUrl(url: string): string {
    let u = url.trim()
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`
    return u.replace(/\/+$/, '')
}

export class Client {
    baseUrl: string
    token: string
    userId = ''
    username = ''

    constructor(url: string, token = '') {
        this.baseUrl = normalizeUrl(url)
        this.token = token
    }

    private async fetchRaw(
        method: string,
        path: string,
        opts: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
    ): Promise<Response> {
        let url = `${this.baseUrl}/api/v4${path}`
        if (opts.query) {
            const qs = new URLSearchParams()
            for (const [k, v] of Object.entries(opts.query)) {
                if (v !== undefined && v !== null) qs.set(k, String(v))
            }
            const s = qs.toString()
            if (s) url += `?${s}`
        }

        const headers: Record<string, string> = { Accept: 'application/json' }
        if (this.token) headers.Authorization = `Bearer ${this.token}`
        if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

        let res: Response
        try {
            res = await fetch(url, {
                method,
                headers,
                body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
            })
        } catch (err) {
            throw new Error(`Cannot connect to ${this.baseUrl}: ${(err as Error).message}`)
        }
        return res
    }

    async request<T>(
        method: string,
        path: string,
        opts: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
    ): Promise<T> {
        const res = await this.fetchRaw(method, path, opts)
        if (res.status === 401) throw new AuthExpiredError()
        if (!res.ok) {
            let msg = `${res.status} ${res.statusText}`
            try {
                const body = (await res.json()) as { message?: string; id?: string }
                if (body.message) msg = body.message
            } catch {}
            throw new ApiError(res.status, msg)
        }
        if (res.status === 204) return undefined as T
        return (await res.json()) as T
    }

    get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
        return this.request<T>('GET', path, { query })
    }

    post<T>(path: string, body?: unknown): Promise<T> {
        return this.request<T>('POST', path, { body })
    }

    /**
     * Login with credentials. Captures session token from Token header.
     * For PAT auth, call setToken() and validate via getMe() instead.
     */
    async loginWithPassword(args: {
        login_id: string
        password: string
        mfa_token?: string
    }): Promise<User> {
        const body: Record<string, string> = {
            login_id: args.login_id,
            password: args.password,
        }
        if (args.mfa_token) body.token = args.mfa_token

        const res = await this.fetchRaw('POST', '/users/login', { body })
        if (res.status === 401) {
            let msg = ''
            try {
                const j = (await res.json()) as { id?: string; message?: string }
                msg = `${j.id ?? ''} ${j.message ?? ''}`.trim()
            } catch {}
            throw new AuthExpiredError(msg || 'Invalid credentials')
        }
        if (!res.ok) {
            throw new ApiError(res.status, `Login failed: ${res.status} ${res.statusText}`)
        }
        const sessionToken = res.headers.get('Token') ?? res.headers.get('token')
        if (!sessionToken) {
            throw new Error('Login succeeded but server did not return a session token')
        }
        this.token = sessionToken
        const user = (await res.json()) as User
        this.userId = user.id
        this.username = user.username
        return user
    }

    async loginWithToken(token: string): Promise<User> {
        this.token = token
        const me = await this.getMe()
        this.userId = me.id
        this.username = me.username
        return me
    }

    getMe(): Promise<User> {
        return this.get<User>('/users/me')
    }

    getUser(idOrMe: string): Promise<User> {
        return this.get<User>(`/users/${idOrMe}`)
    }

    getUserByUsername(username: string): Promise<User> {
        return this.get<User>(`/users/username/${encodeURIComponent(username)}`)
    }

    getUsersByUsernames(usernames: string[]): Promise<User[]> {
        return this.post<User[]>('/users/usernames', usernames)
    }

    getUsersByIds(ids: string[]): Promise<User[]> {
        return this.post<User[]>('/users/ids', ids)
    }

    getUserStatus(userId: string): Promise<{ user_id: string; status: string }> {
        return this.get(`/users/${userId}/status`)
    }

    getUsersStatusByIds(ids: string[]): Promise<Array<{ user_id: string; status: string }>> {
        return this.post('/users/status/ids', ids)
    }

    getUserTeams(userId: string): Promise<Team[]> {
        return this.get<Team[]>(`/users/${userId}/teams`)
    }

    getChannelsForUser(userId: string, teamId: string): Promise<Channel[]> {
        return this.get<Channel[]>(`/users/${userId}/teams/${teamId}/channels`)
    }

    getChannelMembersForUser(userId: string, teamId: string): Promise<ChannelMember[]> {
        return this.get<ChannelMember[]>(`/users/${userId}/teams/${teamId}/channels/members`)
    }

    getChannel(id: string): Promise<Channel> {
        return this.get<Channel>(`/channels/${id}`)
    }

    getChannelByName(teamId: string, name: string): Promise<Channel> {
        return this.get<Channel>(`/teams/${teamId}/channels/name/${encodeURIComponent(name)}`)
    }

    getChannelStats(id: string): Promise<{ member_count: number }> {
        return this.get(`/channels/${id}/stats`)
    }

    getPinnedPosts(channelId: string): Promise<PostList> {
        return this.get<PostList>(`/channels/${channelId}/pinned`)
    }

    getChannelMembers(
        channelId: string,
        page: number,
        perPage: number,
    ): Promise<Array<{ channel_id: string; user_id: string }>> {
        return this.get(`/channels/${channelId}/members`, { page, per_page: perPage })
    }

    getPostsForChannel(
        channelId: string,
        params: { per_page?: number; since?: number } = {},
    ): Promise<PostList> {
        return this.get<PostList>(`/channels/${channelId}/posts`, params)
    }

    getPost(postId: string): Promise<Post> {
        return this.get<Post>(`/posts/${postId}`)
    }

    getThread(postId: string): Promise<PostList> {
        return this.get<PostList>(`/posts/${postId}/thread`)
    }

    searchTeamPosts(
        teamId: string,
        terms: string,
        isOrSearch = false,
    ): Promise<PostList> {
        return this.post<PostList>(`/teams/${teamId}/posts/search`, {
            terms,
            is_or_search: isOrSearch,
        })
    }

    logout(): Promise<unknown> {
        return this.post('/users/logout')
    }
}
