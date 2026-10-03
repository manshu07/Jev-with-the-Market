/**
 * Experiment Studio engine: fully parameterised backtests over the cached
 * NIFTY 100 dataset, computed client-side (static-hosting friendly).
 *
 * Parameters: strategy (registry-based, see ./strategies), decision frequency,
 * session count, max initial position weight, transaction cost, slippage,
 * max positions, random seed.
 *
 * Pure functions only — no IO, no network.
 */

import { STRATEGIES, type StrategyKey } from "./strategies"

export type { StrategyKey }
export type FrequencyKey = "close" | "crossover" | "session" | "low" | "high" | "open"

export type StudioPrices = {
  dates: string[]
  tickers: string[]
  /** [dateIdx][tickerIdx] */
  open: number[][]
  high: number[][]
  low: number[][]
  close: number[][]
  /** decision-ready membership bitstring per date ("1011...") */
  ready: string[]
  /** 20-day return per date/ticker for the momentum strategy */
  r20: (number | null)[][]
  /** EMA series per strategy period */
  ema: { "262": number[][]; "365": number[][] }
  /** stored System One decisions: date -> sorted ticker list [idx, action, prob]; action 0=BUY 1=HOLD 2=SELL 3=NO_ACTION */
  decisions: Record<string, { t: number[] }[]>
}

export type StudioConfig = {
  strategy: StrategyKey
  frequency: FrequencyKey
  sessions: number
  maxWeight: number
  cost: number
  slippage: number
  maxPositions: number
  seed: number
}

export type StudioTrade = {
  date: string
  decisionDate: string
  ticker: string
  action: "BUY" | "SELL"
  shares: number
  executionPrice: number
  gross: number
  cost: number
  net: number
  cashAfter: number
}

export type StudioDay = {
  date: string
  cash: number
  marketValue: number
  value: number
}

export type StudioResult = {
  config: StudioConfig
  days: StudioDay[]
  trades: StudioTrade[]
  plannedDays: string[]
  equity: { date: string; value: number }[]
  summary: {
    finalValue: number
    totalReturn: number
    maxDrawdown: number
    buyCount: number
    sellCount: number
    avgHolding: number | null
  }
}

const initialCapital = 1_000_000

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Signal = { tickerIdx: number; action: "BUY" | "SELL" | "HOLD" | "NO_ACTION"; prob: number | null }

/** Signals via the strategy registry — the engine has no per-strategy branches. */
function daySignals(prices: StudioPrices, cfg: StudioConfig, d: number): { signals: Signal[] } {
  const n = prices.tickers.length
  const signals: Signal[] = []
  const def = STRATEGIES[cfg.strategy]

  if (def.replays) {
    const rows = prices.decisions[prices.dates[d]] ?? []
    for (const row of rows) {
      const action = (["BUY", "HOLD", "SELL", "NO_ACTION"] as const)[row.t[1]]
      signals.push({ tickerIdx: row.t[0], action, prob: row.t[2] })
    }
    return { signals }
  }

  const ctx = {
    dayIdx: d,
    tickers: prices.tickers,
    open: prices.open,
    high: prices.high,
    low: prices.low,
    close: prices.close,
    r20: prices.r20,
    ema: prices.ema,
    ready: prices.ready,
    frequency: cfg.frequency,
  }
  const scores = def.rank(ctx)
  for (let t = 0; t < n; t += 1) {
    const v = scores[t]
    if (v != null) signals.push({ tickerIdx: t, action: "NO_ACTION", prob: v })
  }
  return { signals }
}

export function runStudio(prices: StudioPrices, cfg: StudioConfig): StudioResult {
  const total = Math.min(cfg.sessions, prices.dates.length)
  const dates = prices.dates.slice(0, total)
  const n = prices.tickers.length

  let cash = initialCapital
  const shares = Array(n).fill(0)
  const entryIdx = Array(n).fill(-1)
  const holdingDays: number[] = []
  const trades: StudioTrade[] = []
  const days: StudioDay[] = []
  const equity: { date: string; value: number }[] = []
  const plannedDays: string[] = []
  const random = mulberry32(cfg.seed)

  // pending orders created at decision time, executed at NEXT session open
  let pending: { tickerIdx: number; action: "BUY" | "SELL"; notional?: number }[] | null = null

  for (let d = 0; d < total; d += 1) {
    // 1) execute pending orders at today's open
    if (pending) {
      // sells first to free cash and slots
      for (const order of pending) {
        if (order.action !== "SELL") continue
        const t = order.tickerIdx
        if (shares[t] <= 0) continue
        const open = prices.open[d][t]
        if (!(open > 0)) continue
        const exec = open * (1 - cfg.slippage)
        const gross = shares[t] * open
        const cost = shares[t] * exec * cfg.cost
        const net = shares[t] * exec - cost
        cash += net
        if (entryIdx[t] >= 0) holdingDays.push(d - entryIdx[t])
        entryIdx[t] = -1
        shares[t] = 0
        trades.push({ date: dates[d], decisionDate: dates[d - 1] ?? dates[d], ticker: prices.tickers[t], action: "SELL", shares: 0, executionPrice: exec, gross, cost, net, cashAfter: cash, ...{ sharesFilled: 0 } } as StudioTrade & { sharesFilled: number })
        trades.at(-1)!.shares = gross / open > 0 ? Math.round((trades.at(-1)!.gross) / open) : 0
      }
      // then buys, capped by free slots, weight, and cash
      let held = shares.filter((s) => s > 0).length
      for (const order of pending) {
        if (order.action !== "BUY") continue
        if (held >= cfg.maxPositions) break
        const t = order.tickerIdx
        if (shares[t] > 0) continue
        const open = prices.open[d][t]
        if (!(open > 0)) continue
        const exec = open * (1 + cfg.slippage)
        const perShare = exec * (1 + cfg.cost)
        const notional = Math.min(order.notional ?? 0, cash)
        const q = Math.floor(notional / perShare)
        if (q <= 0) continue
        const gross = q * open
        const cost = q * perShare - q * open
        cash -= q * perShare
        shares[t] = q
        entryIdx[t] = d
        held += 1
        trades.push({ date: dates[d], decisionDate: dates[d - 1] ?? dates[d], ticker: prices.tickers[t], action: "BUY", shares: q, executionPrice: exec, gross, cost, net: q * perShare, cashAfter: cash })
      }
      pending = null
    }

    // 2) mark to market at close
    let marketValue = 0
    for (let t = 0; t < n; t += 1) {
      if (shares[t] > 0) {
        const c = prices.close[d][t]
        if (!(c > 0)) {
          // missing close: mark at last known via open fallback; refuse to zero an open position
          const o = prices.open[d][t]
          marketValue += shares[t] * (o > 0 ? o : 0)
        } else marketValue += shares[t] * c
      }
    }
    const value = cash + marketValue
    days.push({ date: dates[d], cash, marketValue, value })
    equity.push({ date: dates[d], value: Math.round(value * 100) / 100 })

    // 3) decide for the NEXT session (skip the final day — nothing left to execute)
    if (d < total - 1) {
      const { signals } = daySignals(prices, cfg, d)
      plannedDays.push(dates[d])
      const orders: { tickerIdx: number; action: "BUY" | "SELL"; notional?: number }[] = []
      const def = STRATEGIES[cfg.strategy]

      if (def.replays) {
        // parity with the frozen runner's planTrades(): rank BUY candidates by the
        // model's chosen probability, fill free slots, notional = min(cap, cash/free)
        const buys = signals
          .filter((s) => s.action === "BUY" && shares[s.tickerIdx] === 0)
          .sort((a, b) => (b.prob ?? -1) - (a.prob ?? -1) || a.tickerIdx - b.tickerIdx)
        const sells = signals.filter((s) => s.action === "SELL" && shares[s.tickerIdx] > 0)
        for (const s of sells) orders.push({ tickerIdx: s.tickerIdx, action: "SELL" })
        const freeSlots = cfg.maxPositions - (shares.filter((s) => s > 0).length - sells.length)
        const accepted = buys.slice(0, Math.max(0, freeSlots))
        const projectedCash = cash + sells.reduce((sum, s) => {
          const t = s.tickerIdx
          const close = prices.close[d][t]
          return sum + (close != null && close > 0 ? shares[t] * close * (1 - cfg.slippage) * (1 - cfg.cost) : 0)
        }, 0)
        const notional = accepted.length === 0 ? 0 : Math.min(cfg.maxWeight * value, projectedCash / accepted.length)
        for (const s of accepted) orders.push({ tickerIdx: s.tickerIdx, action: "BUY", notional: Math.max(0, notional) })
      } else {
        const ctx = {
          dayIdx: d,
          tickers: prices.tickers,
          open: prices.open,
          high: prices.high,
          low: prices.low,
          close: prices.close,
          r20: prices.r20,
          ema: prices.ema,
          ready: prices.ready,
          frequency: cfg.frequency,
        }
        // forced exits first (death cross), then ranking-driven rotation
        for (const t of def.forcedExits(ctx)) {
          if (shares[t] > 0) orders.push({ tickerIdx: t, action: "SELL" })
        }
        const scored = signals
          .filter((s) => s.prob != null)
          .sort((a, b) => (b.prob as number) - (a.prob as number) || a.tickerIdx - b.tickerIdx)
        const targets = new Set(scored.slice(0, cfg.maxPositions).map((s) => s.tickerIdx))
        for (let t = 0; t < n; t += 1) {
          if (shares[t] > 0 && !targets.has(t) && !orders.some((o) => o.tickerIdx === t && o.action === "SELL")) orders.push({ tickerIdx: t, action: "SELL" })
        }
        const sellsPlanned = orders.filter((o) => o.action === "SELL").length
        const free = def.refillOnExit ? cfg.maxPositions - (shares.filter((s) => s > 0).length - sellsPlanned) : cfg.maxPositions - shares.filter((s) => s > 0).length
        for (const s of scored) {
          if (orders.filter((o) => o.action === "BUY").length >= Math.max(0, free)) break
          if (shares[s.tickerIdx] === 0 && targets.has(s.tickerIdx)) orders.push({ tickerIdx: s.tickerIdx, action: "BUY", notional: cfg.maxWeight * value })
        }
      }

      if (orders.length > 0) pending = orders
      else pending = []
    }
  }

  // summary
  const values = days.map((x) => x.value)
  let peak = values[0] ?? initialCapital
  let worst = 0
  for (const v of values) {
    if (v > peak) peak = v
    worst = Math.min(worst, v / peak - 1)
  }
  const buys = trades.filter((t) => t.action === "BUY")
  const sells = trades.filter((t) => t.action === "SELL")
  const avgHolding = holdingDays.length ? holdingDays.reduce((s, v) => s + v, 0) / holdingDays.length : null

  return {
    config: cfg,
    days,
    trades: trades.map((t) => ({ ...t, shares: t.action === "SELL" ? Math.abs(t.shares) : t.shares })),
    plannedDays,
    equity,
    summary: {
      finalValue: values.at(-1) ?? initialCapital,
      totalReturn: (values.at(-1) ?? initialCapital) / initialCapital - 1,
      maxDrawdown: worst,
      buyCount: buys.length,
      sellCount: sells.length,
      avgHolding,
    },
  }
}

/** NIFTY 100 buy-and-hold over the same window for comparison. Prefers the true
 *  index series when present in the dataset (benchmark), else an equal-weight basket. */
export function studioBenchmark(prices: StudioPrices, sessions: number): { dates: string[]; values: number[]; source: "index" | "basket" } {
  const withBench = prices as StudioPrices & { benchmark?: (number | null)[] }
  if (withBench.benchmark && withBench.benchmark.length >= Math.min(sessions, prices.dates.length)) {
    const raw = withBench.benchmark.slice(0, Math.min(sessions, prices.dates.length))
    // rebase to the slice start so every window compares against ₹10,00,000 fairly
    const firstIdx = raw.findIndex((v) => v != null && v > 0)
    const base = firstIdx >= 0 ? raw[firstIdx]! : 1_000_000
    const values = raw.map((v) => (v == null ? 1_000_000 : Math.round((1_000_000 * v) / base * 100) / 100))
    return { dates: prices.dates.slice(0, Math.min(sessions, prices.dates.length)), values, source: "index" }
  }
  const n = prices.tickers.length
  const idxs = Array.from({ length: n }, (_, t) => t).filter((t) => prices.close[0][t] > 0)
  const perReal = initialCapital / Math.max(1, idxs.length)
  const shares = idxs.map((t) => perReal / prices.close[0][t])
  const values: number[] = []
  for (let d = 0; d < Math.min(sessions, prices.dates.length); d += 1) {
    let v = 0
    idxs.forEach((t, i) => {
      const c = prices.close[d][t]
      v += shares[i] * (c > 0 ? c : prices.open[d][t] > 0 ? prices.open[d][t] : prices.close[0][t])
    })
    values.push(Math.round(v * 100) / 100)
  }
  return { dates: prices.dates.slice(0, Math.min(sessions, prices.dates.length)), values, source: "basket" }
}

/** Random baseline with the same cost/slippage/limits, seeded per run:
 *  a fixed random portfolio bought at the 2nd session open, held to the end. */
export function studioRandom(prices: StudioPrices, cfg: StudioConfig): StudioResult {
  const random = mulberry32(cfg.seed)
  const picks = new Set<number>()
  while (picks.size < Math.min(cfg.maxPositions, prices.tickers.length)) picks.add(Math.floor(random() * prices.tickers.length))
  const total = Math.min(cfg.sessions, prices.dates.length)
  let cash = initialCapital
  const trades: StudioTrade[] = []
  const days: StudioDay[] = []
  const equity: { date: string; value: number }[] = []
  const sharesByTicker = new Map<number, number>()
  const pickList = [...picks]
  for (let d = 0; d < total; d += 1) {
    if (d === 1) {
      const per = Math.min(initialCapital / picks.size, (cfg.maxWeight * initialCapital))
      for (const t of pickList) {
        const open = prices.open[d][t]
        if (!(open > 0)) continue
        const exec = open * (1 + cfg.slippage)
        const perShare = exec * (1 + cfg.cost)
        const q = Math.floor(per / perShare)
        if (q <= 0) continue
        cash -= q * perShare
        sharesByTicker.set(t, q)
        trades.push({ date: prices.dates[d], decisionDate: prices.dates[d - 1], ticker: prices.tickers[t], action: "BUY", shares: q, executionPrice: exec, gross: q * open, cost: q * (perShare - open), net: q * perShare, cashAfter: cash })
      }
    }
    let marketValue = 0
    for (const [t, q] of sharesByTicker) {
      const c = prices.close[d][t]
      marketValue += q * (c != null && c > 0 ? c : prices.open[d][t] > 0 ? prices.open[d][t] : 0)
    }
    const value = cash + marketValue
    days.push({ date: prices.dates[d], cash, marketValue, value })
    equity.push({ date: prices.dates[d], value: Math.round(value * 100) / 100 })
  }
  const values = days.map((x) => x.value)
  let peak = values[0] ?? initialCapital
  let worst = 0
  for (const v of values) {
    if (v > peak) peak = v
    worst = Math.min(worst, v / peak - 1)
  }
  return {
    config: cfg,
    days,
    trades,
    plannedDays: [],
    equity,
    summary: {
      finalValue: values.at(-1) ?? initialCapital,
      totalReturn: (values.at(-1) ?? initialCapital) / initialCapital - 1,
      maxDrawdown: worst,
      buyCount: trades.filter((t) => t.action === "BUY").length,
      sellCount: 0,
      avgHolding: null,
    },
  }
}

export function frequencyLabel(f: FrequencyKey): string {
  switch (f) {
    case "close":
      return "Close of candle"
    case "crossover":
      return "Crossover events"
    case "session":
      return "End of each trading session"
    case "low":
      return "Low of candle"
    case "high":
      return "High of candle"
    case "open":
      return "Open candle"
  }
}
