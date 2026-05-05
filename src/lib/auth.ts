import { AuthExpiredError, Client, EXIT_AUTH_EXPIRED, EXIT_ERROR, type MMContext, type Team } from './client.js'
import { ConfigError, getCredentials } from './config.js'

async function getTeams(client: Client, filter?: string): Promise<Team[]> {
    const raw = await client.getUserTeams(client.userId)
    if (!raw || raw.length === 0) {
        console.error("Error: You don't belong to any teams.")
        process.exit(EXIT_ERROR)
    }
    const teams: Team[] = raw.map((t) => ({
        id: t.id,
        name: t.name,
        display_name: t.display_name,
    }))
    if (filter) {
        const matched = teams.filter((t) => t.name === filter || t.display_name === filter)
        if (matched.length === 0) {
            const available = teams.map((t) => t.name).join(', ')
            console.error(`Error: Team '${filter}' not found. Available teams: ${available}`)
            process.exit(EXIT_ERROR)
        }
        return matched
    }
    return teams
}

export async function ensureAuth(
    url: string,
    token: string,
    teamFilter?: string,
): Promise<MMContext> {
    const client = new Client(url, token)
    try {
        await client.loginWithToken(token)
    } catch (err) {
        if (err instanceof AuthExpiredError) {
            console.error("Error: Session expired. Run 'mm login' to re-authenticate.")
            process.exit(EXIT_AUTH_EXPIRED)
        }
        console.error(`Error: ${(err as Error).message}`)
        process.exit(EXIT_ERROR)
    }
    const teams = await getTeams(client, teamFilter)
    return {
        client,
        userId: client.userId,
        username: client.username,
        teams,
    }
}

export async function getContext(state: { team?: string }): Promise<MMContext> {
    let creds
    try {
        creds = getCredentials()
    } catch (err) {
        if (err instanceof ConfigError) {
            console.error(`Error: ${err.message}`)
            process.exit(EXIT_ERROR)
        }
        throw err
    }
    return ensureAuth(creds.url, creds.token, state.team ?? creds.team)
}
