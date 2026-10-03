/**
 * Deep analytics over Studio runs — pure functions, no IO.
 * Powers the custom Analysis page: win rate, profit factor, yearly/monthly
 * returns, drawdown series, CAGR, decision forward-return analysis.
 */

import type { StudioTrade } from "./engine"

export type ClosedTrade = {
  ticker: string
  buyDate: string
  sellDate: string
  buyPrice: number
  sellPrice: number
  pnlPct: number | null
  holding: number
  stillOpen: boolean
}

/** Pair BUY→SELL executions into round trips (FIFO per ticker). */
export function pairTrades(trades: StudioTrade[], dates: string[]): ClosedTrade[] {
  const dateIdx = new Map(dates.map((d, i) => [d, i]))
  const open = new Map<string, StudioTrade>()
  const closed: ClosedTrade[] = []
  for (const t of trades) {
    if (t.action === "BUY" && !open.has(t.ticker)) {
      open.set(t.ticker, t)
      continue
    }
    if (t.action === "SELL" && open.has(t.ticker)) {
      const buy = open.get(t.ticker)!
      open.delete(t.ticker)
      closed.push({
        ticker: t.ticker,
        buyDate: buy.date,
        sellDate: t.date,
        buyPrice: buy.executionPrice,
        sellPrice: t.executionPrice,
        pnlPct: t.executionPrice / buy.executionPrice - 1,
        holding: (dateIdx.get(t.date) ?? 0) - (dateIdx.get(buy.date) ?? 0),
        stillOpen: false,
      })
    }
  }
  for (const [, buy] of open) {
    closed.push({
      ticker: buy.ticker,
      buyDate: buy.date,
      sellDate: "",
      buyPrice: buy.executionPrice,
      sellPrice: 0,
      pnlPct: null,
      holding: (dates.length - 1) - (dateIdx.get(buy.date) ?? 0),
      stillOpen: true,
    })
  }
  return closed.sort((a, b) => a.buyDate.localeCompare(b.buyDate))
}

export type WinStats = {
  count: number
  open: number
  winRate: number | null
  avgWin: number | null
  avgLoss: number | null
  profitFactor: number | null
  expectancy: number | null
  best: number | null
  worst: number | null
  avgHolding: number | null
}

export function winStats(closed: ClosedTrade[]): WinStats {
  const done = closed.filter((c) => !c.stillOpen && c.pnlPct != null)
  const wins = done.filter((c) => (c.pnlPct as number) > 0)
  const losses = done.filter((c) => (c.pnlPct as number) <= 0)
  const sum = (xs: ClosedTrade[]) => xs.reduce((s, c) => s + (c.pnlPct as number), 0)
  const grossWin = sum(wins)
  const grossLoss = Math.abs(sum(losses))
  const holdings = done.map((c) => c.holding)
  return {
    count: done.length,
    open: closed.length - done.length,
    winRate: done.length ? wins.length / done.length : null,
    avgWin: wins.length ? grossWin / wins.length : null,
    avgLoss: losses.length ? sum(losses) / losses.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancy: done.length ? sum(done) / done.length : null,
    best: done.length ? Math.max(...done.map((c) => c.pnlPct as number)) : null,
    worst: done.length ? Math.min(...done.map((c) => c.pnlPct as number)) : null,
    avgHolding: holdings.length ? holdings.reduce((s, v) => s + v, 0) / holdings.length : null,
  }
}

/** Calendar-year compounding for strategy vs benchmark (null benchmark days skipped). */
export function yearlyReturns(rows: { date: string; v: number; b: number | null }[]): { year: string; strategy: number; benchmark: number | null }[] {
  const buckets = new Map<string, { so: number; sc: number; bo: number | null; bc: number | null }>()
  for (const r of rows) {
    const y = r.date.slice(0, 4)
    const b = buckets.get(y)
    if (!b) buckets.set(y, { so: r.v, sc: r.v, bo: r.b, bc: r.b })
    else {
      b.sc = r.v
      if (r.b != null) b.bc = r.b
    }
  }
  return [...buckets.entries()].sort().map(([year, b]) => ({
    year,
    strategy: b.sc / b.so - 1,
    benchmark: b.bo != null && b.bo > 0 && b.bc != null ? b.bc / b.bo - 1 : null,
  }))
}

/** Calendar-month compounding for strategy vs benchmark (null benchmark days skipped). */
export function monthlyReturns(rows: { date: string; v: number; b: number | null }[]): { month: string; strategy: number; benchmark: number | null }[] {
  const buckets = new Map<string, { so: number; sc: number; bo: number | null; bc: number | null }>()
  for (const r of rows) {
    const y = r.date.slice(0, 7)
    const b = buckets.get(y)
    if (!b) buckets.set(y, { so: r.v, sc: r.v, bo: r.b, bc: r.b })
    else {
      b.sc = r.v
      if (r.b != null) b.bc = r.b
    }
  }
  return [...buckets.entries()].sort().map(([month, b]) => ({
    month,
    strategy: b.sc / b.so - 1,
    benchmark: b.bo != null && b.bo > 0 && b.bc != null ? b.bc / b.bo - 1 : null,
  }))
}

/** Drawdown from running peak at every point. */
export function drawdownSeries(values: number[]): number[] {
  let peak = values[0] ?? 0
  return values.map((v) => {
    if (v > peak) peak = v
    return peak > 0 ? v / peak - 1 : 0
  })
}

/** Annualised return over the calendar span between two dates. */
export function cagr(initial: number, final: number, startDate: string, endDate: string): number | null {
  const years = (new Date(endDate).getTime() - new Date(startDate).getTime()) / (365.25 * 24 * 3600 * 1000)
  if (years <= 0 || initial <= 0) return null
  return Math.pow(final / initial, 1 / years) - 1
}

export type DecisionAnalysis = {
  counts: { BUY: number; HOLD: number; SELL: number; NO_ACTION: number }
  meanProb: { BUY: number | null; HOLD: number | null; SELL: number | null; NO_ACTION: number | null }
  /** mean close-to-close forward return after each action, per horizon (sessions) */
  forward: { BUY: Record<number, number | null>; SELL: Record<number, number | null>; HOLD: Record<number, number | null>; NO_ACTION: Record<number, number | null> }
}

const ACTIONS = ["BUY", "HOLD", "SELL", "NO_ACTION"] as const

/** Action mix + what happened AFTER each decision (never available at decision time). */
export function decisionAnalysis(
  decisions: Record<string, { t: number[] }[]>,
  dates: string[],
  close: (number | null)[][],
  tickers: string[],
  horizons: number[],
): DecisionAnalysis {
  const dateIdx = new Map(dates.map((d, i) => [d, i]))
  const counts = { BUY: 0, HOLD: 0, SELL: 0, NO_ACTION: 0 }
  const probSum = { BUY: 0, HOLD: 0, SELL: 0, NO_ACTION: 0 }
  const probN = { BUY: 0, HOLD: 0, SELL: 0, NO_ACTION: 0 }
  const fwdSum: Record<string, Record<number, { s: number; n: number }>> = {}
  for (const a of ACTIONS) {
    fwdSum[a] = {}
    for (const h of horizons) fwdSum[a][h] = { s: 0, n: 0 }
  }
  for (const [date, rows] of Object.entries(decisions)) {
    const d = dateIdx.get(date)
    if (d == null) continue
    for (const row of rows) {
      const [tIdx, aIdx, prob] = row.t
      const action = ACTIONS[aIdx]
      if (!action) continue
      counts[action] += 1
      if (prob >= 0) {
        probSum[action] += prob
        probN[action] += 1
      }
      const p0 = close[d][tIdx]
      if (p0 == null || !(p0 > 0)) continue
      for (const h of horizons) {
        if (d + h >= dates.length) continue
        const p1 = close[d + h][tIdx]
        if (p1 == null || !(p1 > 0)) continue
        fwdSum[action][h].s += p1 / p0 - 1
        fwdSum[action][h].n += 1
      }
    }
  }
  const forward: DecisionAnalysis["forward"] = { BUY: {}, SELL: {}, HOLD: {}, NO_ACTION: {} }
  for (const a of ACTIONS) {
    for (const h of horizons) {
      const bucket = fwdSum[a][h]
      forward[a][h] = bucket.n > 0 ? bucket.s / bucket.n : null
    }
  }
  const meanProb: DecisionAnalysis["meanProb"] = { BUY: null, HOLD: null, SELL: null, NO_ACTION: null }
  for (const a of ACTIONS) meanProb[a] = probN[a] > 0 ? probSum[a] / probN[a] : null
  return { counts, meanProb, forward }
}
