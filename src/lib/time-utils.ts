/**
 * Parse --since value into Unix timestamp in milliseconds.
 * Supports: 1h/30m/2d/1w, today, yesterday, 2026-03-05, ISO datetime, raw ms, @sec.
 */
export function parseSince(value: string): number {
    const v = value.trim()

    if (/^\d{13,}$/.test(v)) return Number(v)

    if (/^@\d+$/.test(v)) return Number(v.slice(1)) * 1000

    const rel = v.match(/^(\d+)([mhdw])$/)
    if (rel) {
        const amount = Number(rel[1])
        const unit = rel[2]!
        const ms = {
            m: 60 * 1000,
            h: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000,
            w: 7 * 24 * 60 * 60 * 1000,
        }[unit]!
        return Date.now() - amount * ms
    }

    const now = new Date()
    if (v === 'today') {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        return d.getTime()
    }
    if (v === 'yesterday') {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
        return d.getTime()
    }

    // ISO datetime or date
    const isoLike = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/
    if (isoLike.test(v)) {
        const dt = new Date(v.includes('T') ? `${v}Z` : `${v}T00:00:00Z`)
        if (!Number.isNaN(dt.getTime())) return dt.getTime()
    }

    throw new Error(
        `Cannot parse --since value: '${value}'\n` +
            'Expected: 1h, 30m, 2d, today, yesterday, 2026-03-05, ' +
            '2026-03-05T14:30, 1741171200000, or @1741171200',
    )
}
