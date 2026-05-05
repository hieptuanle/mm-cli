import chalk from 'chalk'
import type { Command } from 'commander'

export interface OutputOptions {
    json: boolean
    ndjson: boolean
    full: boolean
    raw: boolean
}

export function getOutputOptions(opts: Record<string, unknown>): OutputOptions {
    const out: OutputOptions = {
        json: Boolean(opts.json),
        ndjson: Boolean(opts.ndjson),
        full: Boolean(opts.full),
        raw: Boolean(opts.raw),
    }
    // --raw / --ndjson / --json => no ANSI colors
    if (out.raw || out.ndjson || out.json) chalk.level = 0
    return out
}

function pick<T extends object>(obj: T, keys: (keyof T)[]): Partial<T> {
    const result: Partial<T> = {}
    for (const key of keys) {
        if (key in obj) result[key] = obj[key]
    }
    return result
}

export function outputItem<T extends object>(
    item: T,
    humanFormatter: (item: T) => string,
    essentialKeys: (keyof T)[] | undefined,
    opts: OutputOptions,
    rawFormatter?: (item: T) => string,
): void {
    if (opts.ndjson) {
        const data = opts.full || !essentialKeys ? item : pick(item, essentialKeys)
        console.log(JSON.stringify(data))
        return
    }
    if (opts.json) {
        const data = opts.full || !essentialKeys ? item : pick(item, essentialKeys)
        console.log(JSON.stringify(data, null, 2))
        return
    }
    if (opts.raw && rawFormatter) {
        console.log(rawFormatter(item))
        return
    }
    console.log(humanFormatter(item))
}

export function outputList<T extends object>(
    items: T[],
    humanFormatter: (items: T[]) => string,
    essentialKeys: (keyof T)[] | undefined,
    opts: OutputOptions,
    rawFormatter?: (items: T[]) => string,
): void {
    if (opts.ndjson) {
        for (const item of items) {
            const data = opts.full || !essentialKeys ? item : pick(item, essentialKeys)
            console.log(JSON.stringify(data))
        }
        return
    }
    if (opts.json) {
        const data = items.map((item) =>
            opts.full || !essentialKeys ? item : pick(item, essentialKeys),
        )
        console.log(JSON.stringify(data, null, 2))
        return
    }
    if (opts.raw && rawFormatter) {
        console.log(rawFormatter(items))
        return
    }
    console.log(humanFormatter(items))
}

export function addOutputFlags(cmd: Command): Command {
    return cmd
        .option('--json', 'Output JSON (essential fields)')
        .option('--ndjson', 'Output NDJSON (one object per line)')
        .option('--full', 'Include all fields in JSON output')
        .option('--raw', 'Raw markdown output (no ANSI colors)')
}
