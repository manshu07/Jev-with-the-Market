/**
 * EMA-262/365 series, cross-event detection, and shared helpers for the
 * multi-period + watchlists feature. Pure functions only — no IO.
 */

/** Wilder-style EMA with SMA seed over `period` sessions; nulls pass through as nulls. */
export function emaSeries(closes: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null)
  if (period <= 0 || closes.length < period) return out
  const k = 2 / (period + 1)
  let prev: number | null = null
  for (let i = 0; i < closes.length; i += 1) {
    const value = closes[i]
    if (value == null) {
      out[i] = null // gap: emit null but keep `prev` — the EMA bridges data gaps
      continue
    }
    if (prev == null) {
      // seed a fresh segment with the SMA of the first `period` valid closes
      let sum = 0
      let seen = 0
      let j = i
      while (j < closes.length && seen < period) {
        const v = closes[j]
        if (v != null) {
          sum += v
          seen += 1
        }
        j += 1
      }
      if (seen < period) return out // not enough history for the seed
      prev = sum / period
      out[j - 1] = prev
      i = j - 1
      continue
    }
    prev = value * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

/** Date-stamped flips of a boolean membership flag. */
export function crossEvents(above: boolean[], dates: string[]): { date: string; dir: "entered" | "exited" }[] {
  const out: { date: string; dir: "entered" | "exited" }[] = []
  for (let i = 1; i < above.length; i += 1) {
    if (above[i] !== above[i - 1]) {
      out.push({ date: dates[i], dir: above[i] ? "entered" : "exited" })
    }
  }
  return out
}

/** Compact run-length string for per-stock membership over the window. */
export function encodeBits(flags: boolean[]): string {
  return flags.map((f) => (f ? "1" : "0")).join("")
}

export function decodeBits(s: string): boolean[] {
  return s.split("").map((c) => c === "1")
}

/** Slice date-keyed rows by [start, end] inclusive. */
export function periodSlice<T>(rows: T[], start: string, end: string, dateOf: (row: T) => string): T[] {
  return rows.filter((row) => {
    const d = dateOf(row)
    return d >= start && d <= end
  })
}

/** Calendar-month open→close returns from a value series. */
export function monthlyFromEquity(rows: { date: string; v: number }[]): Map<string, number> {
  const buckets = new Map<string, { o: number; c: number }>()
  for (const row of rows) {
    const key = row.date.slice(0, 7)
    const b = buckets.get(key)
    if (!b) buckets.set(key, { o: row.v, c: row.v })
    else b.c = row.v
  }
  const out = new Map<string, number>()
  for (const [key, b] of buckets) out.set(key, b.c / b.o - 1)
  return out
}

/** Pair BUY/SELL executions into trades with session-count holding periods. */
export function holdingFromTrades(
  days: { date: string; tradesExecuted: { ticker: string; action: string; executionDate: string }[] }[],
): { closed: { ticker: string; buy: string; sell: string; holding: number; buyDate: string; sellDate: string }[]; open: { ticker: string; buyDate: string }[] } {
  const dates = days.map((d) => d.date)
  const openMap = new Map<string, string>()
  const closed: { ticker: string; buy: string; sell: string; holding: number; buyDate: string; sellDate: string }[] = []
  const open: { ticker: string; buyDate: string }[] = []
  for (const day of days) {
    for (const trade of day.tradesExecuted ?? []) {
      if (trade.action === "BUY" && !openMap.has(trade.ticker)) openMap.set(trade.ticker, trade.executionDate)
      else if (trade.action === "SELL" && openMap.has(trade.ticker)) {
        const buyDate = openMap.get(trade.ticker)!
        openMap.delete(trade.ticker)
        closed.push({
          ticker: trade.ticker,
          buy: trade.executionDate,
          sell: trade.executionDate,
          holding: dates.indexOf(trade.executionDate) - dates.indexOf(buyDate),
          buyDate,
          sellDate: trade.executionDate,
        })
      }
    }
  }
  for (const [ticker, buyDate] of openMap) open.push({ ticker, buyDate })
  return { closed, open }
}

/** Standard strategy metrics over an equity curve (₹10L base). */
export function strategyMetrics(values: number[]): { totalReturn: number; maxDrawdown: number } {
  const base = values[0]
  let peak = values[0]
  let worst = 0
  for (const v of values) {
    if (v > peak) peak = v
    const dd = v / peak - 1
    if (dd < worst) worst = dd
  }
  return { totalReturn: values.at(-1)! / base - 1, maxDrawdown: worst }
}
