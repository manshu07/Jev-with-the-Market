/**
 * Strategy registry — the canonical separation:
 *
 *   momentum    = repo base strategy (top-5 by 20d return, rotation when slots free)
 *   ema_cross   = added strategy: EMA-262 × EMA-365 golden/death CROSSOVER on
 *                 CLOSING prices — enter the session after a golden cross, exit on
 *                 death cross; skip entries while all slots are full (decision A)
 *
 * Everything else about execution is engine-owned and identical for both:
 * next-session-open fills, per-trade cost+slippage, position cap, allocation cap.
 * Adding a strategy = registering one object here. The engine never grows branches.
 */

export type StrategyKey = "momentum" | "ema_cross" | "systemone"

export type FrequencyKey = "close" | "crossover" | "session" | "low" | "high" | "open"

export type StrategyDefinition = {
  key: StrategyKey
  label: string
  /** UI hint: whether the decision-frequency dropdown applies (ema_cross is fixed to closing prices) */
  frequencyApplies: boolean
  /**
   * Rank all eligible tickers for the given day. Higher score = stronger buy
   * preference. Tickers with score null are not eligible today. The engine fills
   * free slots from the top of this ranking and rotates momentum holdings that
   * fell out of the ranking.
   */
  rank: (ctx: StrategyContext) => (number | null)[]
  /**
   * Force-exit tickers that must be sold regardless of ranking (death cross for
   * ema_cross). Momentum returns an empty set — its exits are rotation-driven.
   */
  forcedExits: (ctx: StrategyContext) => Set<number>
  /** Which recorded decision map this strategy replays (systemone only). */
  replays?: boolean
  /**
   * true: freed slots (incl. same-day forced exits) may be refilled in the same
   * decision batch (ema_cross). false: strict base-momentum semantics — free
   * slots are computed from currently held positions only (frozen behaviour).
   */
  refillOnExit?: boolean
}

export type StrategyContext = {
  dayIdx: number
  tickers: string[]
  open: number[][]
  high: number[][]
  low: number[][]
  close: (number | null)[][]
  r20: (number | null)[][]
  ema: { "262": (number | null)[][]; "365": (number | null)[][] }
  ready: string[]
  frequency: "close" | "crossover" | "session" | "low" | "high" | "open"
}

/** 20d return measured to the frequency's candle price (close/session ≡ base r20). */
function momentumScore(ctx: StrategyContext, t: number): number | null {
  const d = ctx.dayIdx
  if (ctx.ready[d][t] !== "1") return null
  if (ctx.frequency === "low" || ctx.frequency === "high" || ctx.frequency === "open") {
    const pNow = ctx.frequency === "open" ? ctx.open[d][t] : ctx.frequency === "high" ? ctx.high[d][t] : ctx.low[d][t]
    const pThen = ctx.close[d - 20]?.[t]
    if (pNow > 0 && pThen != null && pThen > 0) return pNow / pThen - 1
    return null
  }
  const v = ctx.r20[d][t]
  return v == null ? null : v
}

function momentumRank(ctx: StrategyContext): (number | null)[] {
  return ctx.tickers.map((_, t) => momentumScore(ctx, t))
}

function emaCrossRank(ctx: StrategyContext): (number | null)[] {
  const d = ctx.dayIdx
  if (d === 0) return ctx.tickers.map(() => null)
  const out: (number | null)[] = []
  for (let t = 0; t < ctx.tickers.length; t += 1) {
    if (ctx.ready[d][t] !== "1") {
      out.push(null)
      continue
    }
    const fast = ctx.ema["262"]
    const slow = ctx.ema["365"]
    const c0 = ctx.close[d][t]
    const cPrev = ctx.close[d - 1][t]
    const f = fast[d][t]
    const fPrev = fast[d - 1][t]
    const s = slow[d][t]
    const sPrev = slow[d - 1][t]
    if (c0 == null || cPrev == null || f == null || fPrev == null || s == null || sPrev == null) {
      out.push(null)
      continue
    }
    // golden cross TODAY on closing prices → eligible with a flat score (first-come by index)
    const goldenToday = fPrev <= sPrev && f > s
    out.push(goldenToday ? 1 : null)
  }
  return out
}

function emaCrossForcedExits(ctx: StrategyContext): Set<number> {
  const d = ctx.dayIdx
  const out = new Set<number>()
  if (d === 0) return out
  for (let t = 0; t < ctx.tickers.length; t += 1) {
    const f = ctx.ema["262"][d][t]
    const fPrev = ctx.ema["262"][d - 1][t]
    const s = ctx.ema["365"][d][t]
    const sPrev = ctx.ema["365"][d - 1][t]
    if (f == null || fPrev == null || s == null || sPrev == null) continue
    if (fPrev >= sPrev && f < s) out.add(t) // death cross on closing prices
  }
  return out
}

export const STRATEGIES: Record<StrategyKey, StrategyDefinition> = {
  momentum: {
    key: "momentum",
    label: "Base momentum (top-5 by 20d return)",
    frequencyApplies: true,
    rank: momentumRank,
    forcedExits: () => new Set<number>(),
  },
  ema_cross: {
    key: "ema_cross",
    label: "EMA-262×365 crossover (closing prices)",
    frequencyApplies: false,
    rank: emaCrossRank,
    forcedExits: emaCrossForcedExits,
    refillOnExit: true,
  },
  systemone: {
    key: "systemone",
    label: "System One (recorded AI decisions)",
    frequencyApplies: false,
    rank: () => [],
    forcedExits: () => new Set<number>(),
    replays: true,
  },
}

export const STRATEGY_KEYS = Object.keys(STRATEGIES) as StrategyKey[]
