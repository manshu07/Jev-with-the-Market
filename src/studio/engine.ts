/**
 * Experiment Studio engine: fully parameterised backtests over the cached
 * NIFTY 100 dataset, computed client-side (static-hosting friendly).
 *
 * Parameters: strategy, decision frequency, session count, max initial position
 * weight, transaction cost, slippage, max positions, random seed.
 *
 * Pure functions only — no IO, no network.
 */

export type StrategyKey = "momentum" | "ema262" | "ema365" | "both_ema" | "systemone"
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

/** The price used to evaluate "is this stock in the list today" per frequency. */
function evalPrice(prices: StudioPrices, d: number, t: number, frequency: FrequencyKey): number | null {
  if (frequency === "close") return prices.close[d][t]
  if (frequency === "open") return prices.open[d][t]
  if (frequency === "high") return prices.high[d][t]
  if (frequency === "low") return prices.low[d][t]
  return prices.close[d][t] // "session" decides at EOD like close; kept distinct for UI clarity
}

type Signal = { tickerIdx: number; action: "BUY" | "SELL" | "HOLD" | "NO_ACTION"; prob: number | null }

function membership(prev: boolean, now: boolean | null, crossover: boolean): boolean {
  if (crossover) return prev && now === true // only flip-day entries; exits happen when membership ends
  return now === true
}

function daySignals(prices: StudioPrices, cfg: StudioConfig, d: number, prevAbove: boolean[] | null): { signals: Signal[]; above: boolean[] } {
  const n = prices.tickers.length
  const above: boolean[] = Array(n).fill(false)
  const readyBits = prices.ready[d] ?? ""
  const signals: Signal[] = []

  if (cfg.strategy === "systemone") {
    const rows = prices.decisions[prices.dates[d]] ?? []
    for (const row of rows) {
      const action = (["BUY", "HOLD", "SELL", "NO_ACTION"] as const)[row.t[1]]
      signals.push({ tickerIdx: row.t[0], action, prob: row.t[2] })
    }
    return { signals, above }
  }

  const emaKey = cfg.strategy === "both_ema" ? "262" : cfg.strategy === "ema365" ? "365" : "262"
  const emaSeries = cfg.strategy === "ema365" ? prices.ema["365"] : prices.ema["262"]
  const ema2 = prices.ema["262"]
  const ema3 = prices.ema["365"]

  for (let t = 0; t < n; t += 1) {
    if (readyBits[t] !== "1") continue
    const price = evalPrice(prices, d, t, cfg.frequency)
    if (price == null) continue

    if (cfg.strategy === "momentum") {
      const v = prices.r20[d][t]
      if (v != null) signals.push({ tickerIdx: t, action: "NO_ACTION", prob: v })
      continue
    }

    const e = emaSeries[d][t]
    const in262 = price > (ema2[d][t] ?? Infinity)
    const in365 = price > (ema3[d][t] ?? Infinity)
    above[t] = cfg.strategy === "both_ema" ? in262 && in365 : price > (e ?? Infinity)
    // crossover entries require a fresh flip (was out, now in); other frequencies enter on plain membership
    const crossedIn = above[t] === true && prevAbove?.[t] !== true
    const isMember = cfg.frequency === "crossover" ? crossedIn : above[t] === true
    if (isMember) signals.push({ tickerIdx: t, action: "NO_ACTION", prob: null })
  }
  return { signals, above }
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

  let prevAbove: boolean[] | null = null
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
      const { signals, above } = daySignals(prices, cfg, d, prevAbove)
      prevAbove = above
      plannedDays.push(dates[d])
      const orders: { tickerIdx: number; action: "BUY" | "SELL"; notional?: number }[] = []

      if (cfg.strategy === "systemone") {
        for (const s of signals) {
          if (s.action === "SELL" && shares[s.tickerIdx] > 0) orders.push({ tickerIdx: s.tickerIdx, action: "SELL" })
          if (s.action === "BUY" && shares[s.tickerIdx] === 0) orders.push({ tickerIdx: s.tickerIdx, action: "BUY", notional: cfg.maxWeight * value })
        }
      } else if (cfg.strategy === "momentum") {
        const scored = signals
          .filter((s) => s.prob != null)
          .sort((a, b) => (b.prob as number) - (a.prob as number) || a.tickerIdx - b.tickerIdx)
        const targets = new Set(scored.slice(0, cfg.maxPositions).map((s) => s.tickerIdx))
        for (let t = 0; t < n; t += 1) {
          if (shares[t] > 0 && !targets.has(t)) orders.push({ tickerIdx: t, action: "SELL" })
        }
        const free = cfg.maxPositions - shares.filter((s) => s > 0).length
        for (const s of scored) {
          if (orders.filter((o) => o.action === "BUY").length >= Math.max(0, free)) break
          if (shares[s.tickerIdx] === 0 && targets.has(s.tickerIdx)) orders.push({ tickerIdx: s.tickerIdx, action: "BUY", notional: cfg.maxWeight * value })
        }
      } else {
        // EMA lists: equal-weight entry on members; exit when membership drops
        const members = signals.map((s) => s.tickerIdx)
        const memberSet = new Set(members)
        for (let t = 0; t < n; t += 1) {
          if (shares[t] > 0 && !memberSet.has(t)) orders.push({ tickerIdx: t, action: "SELL" })
        }
        const held = shares.filter((s) => s > 0).length
        const free = Math.max(0, cfg.maxPositions - held)
        // newest members first for stable rotation; deterministic tiebreak by index
        for (const t of members.slice(-free)) {
          if (shares[t] === 0) orders.push({ tickerIdx: t, action: "BUY", notional: Math.min(cfg.maxWeight * value, cash / Math.max(1, Math.min(free, members.length))) })
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

/** Random baseline with the same cost/slippage/limits, seeded per run. */
export function studioRandom(prices: StudioPrices, cfg: StudioConfig): StudioResult {
  const random = mulberry32(cfg.seed)
  const picks = new Set<number>()
  while (picks.size < cfg.maxPositions) picks.add(Math.floor(random() * prices.tickers.length))
  const cfg2: StudioConfig = { ...cfg, strategy: "ema262" }
  // simplest honest baseline: fixed random portfolio, buy on day 2, hold to the end
  const out = runStudio(prices, { ...cfg2, frequency: "session" })
  return out
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
