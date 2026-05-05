import type { Command } from 'commander'

export interface GlobalState {
    human: boolean
    team?: string
    debug: boolean
}

export function getState(cmd: Command): GlobalState {
    let root: Command = cmd
    while (root.parent) root = root.parent
    const opts = root.opts() as { human?: boolean; team?: string; debug?: boolean }
    return {
        human: Boolean(opts.human),
        team: opts.team,
        debug: Boolean(opts.debug),
    }
}
