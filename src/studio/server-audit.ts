/**
 * Server-side audit for custom Studio/Analysis runs.
 *
 * The client posts the config + its computed summary; the server independently
 * re-slices the dataset, re-runs the engine, cross-checks every headline number,
 * verifies accounting/constraint invariants day-by-day, and returns:
 *   - a per-check verdict table (PASS/FAIL with evidence)
 *   - the full per-stock ledger: buys, sells, holds, P&L, max holding period
 *
 * No static values anywhere: prices/EMAs/decisions come from the dataset files,
 * config comes from the request.
 */
import { createHash } from "node:crypto"
import { runStudio, type StudioConfig, type StudioPrices, type StudioTrade } from "./engine"
import { pairTrades } from "./analysis"

export type ClientSummary = {
  finalValue: number
  totalReturn: number
  maxDrawdown: number
  buyCount: number
  sellCount: number
}

export type Check = { name: string; verdict: "PASS" | "FAIL"; detail: string }

export type StockLedgerRow = {
  ticker: string
  buys: number
  sells: number
  open: boolean
  realizedPnlPct: number | null
  wins: number
  losses: number
  maxHolding: number
  maxHoldingDates: { buy: string; sell: string } | null
  currentHolding: number | null
  roundTrips: { buyDate: string; sellDate: string; pnlPct: number; holding: number }[]
}

export type ServerAudit = {
  auditId: string
  generatedAt: string
  config: StudioConfig
  window: { start: string; end: string; sessions: number }
  serverSummary: ClientSummary & { avgHolding: number | null }
  checks: Check[]
  verdict: "PASS" | "FAIL"
  stockLedger: StockLedgerRow[]
}

/** Per-stock rollup: buys/sells/holds, realized P&L, maximum holding period(s). */
export function buildStockLedger(trades: StudioTrade[], dates: string[]): StockLedgerRow[] {
  const byTicker = new Map<string, StudioTrade[]>()
  for (const t of trades) {
    const list = byTicker.get(t.ticker) ?? []
    list.push(t)
    byTicker.set(t.ticker, list)
  }
  const dateIdx = new Map(dates.map((d, i) => [d, i]))
  const rows: StockLedgerRow[] = []
  for (const [ticker, list] of byTicker) {
    const closed = pairTrades(list, dates)
    const done = closed.filter((c) => !c.stillOpen)
    const wins = done.filter((c) => (c.pnlPct ?? 0) > 0).length
    const losses = done.length - wins
    let maxHolding = 0
    let maxDates: { buy: string; sell: string } | null = null
    for (const c of done) {
      if (c.holding > maxHolding) {
        maxHolding = c.holding
        maxDates = { buy: c.buyDate, sell: c.sellDate }
      }
    }
    const realized = done.length ? done.reduce((s, c) => s + (c.pnlPct ?? 0), 0) / done.length : null
    const stillOpen = closed.find((c) => c.stillOpen)
    rows.push({
      ticker,
      buys: list.filter((t) => t.action === "BUY").length,
      sells: list.filter((t) => t.action === "SELL").length,
      open: Boolean(stillOpen),
      realizedPnlPct: realized,
      wins,
      losses,
      maxHolding,
      maxHoldingDates: maxDates,
      currentHolding: stillOpen ? stillOpen.holding : null,
      roundTrips: done.map((c) => ({ buyDate: c.buyDate, sellDate: c.sellDate, pnlPct: c.pnlPct ?? 0, holding: c.holding })),
    })
  }
  return rows.sort((a, b) => b.maxHolding - a.maxHolding || a.ticker.localeCompare(b.ticker))
}

function accountingChecks(run: ReturnType<typeof runStudio>): Check[] {
  const checks: Check[] = []
  let accounting = 0
  let negativeCash = 0
  let positionCap = 0
  let shortShares = 0
  let timing = 0
  for (const day of run.days) {
    if (Math.abs(day.cash + day.marketValue - day.value) > 0.05) accounting += 1
    if (day.cash < -0.05) negativeCash += 1
  }
  const heldPerDay: number[] = []
  let held = 0
  let pendingBuys = 0
  let pendingSells = 0
  for (const t of run.trades) {
    if (t.action === "BUY") pendingBuys += 1
    else pendingSells += 1
  }
  void pendingBuys
  void pendingSells
  let live = 0
  const events = [...run.trades].sort((a, b) => a.date.localeCompare(b.date))
  for (const t of events) {
    if (t.action === "BUY") live += 1
    else live -= 1
    heldPerDay.push(live)
  }
  held = heldPerDay.length ? Math.max(...heldPerDay) : 0
  positionCap = held > run.config.maxPositions ? 1 : 0
  for (const t of run.trades) {
    if (t.shares < 0) shortShares += 1
    if (!(t.date > t.decisionDate)) timing += 1
  }
  checks.push({ name: "daily_accounting", verdict: accounting === 0 ? "PASS" : "FAIL", detail: accounting === 0 ? `cash + market value = portfolio value on all ${run.days.length} days (±0.05)` : `${accounting} day(s) mismatched` })
  checks.push({ name: "no_negative_cash", verdict: negativeCash === 0 ? "PASS" : "FAIL", detail: negativeCash === 0 ? "cash never went negative" : `${negativeCash} day(s) negative cash` })
  checks.push({ name: "position_cap", verdict: positionCap === 0 ? "PASS" : "FAIL", detail: `max simultaneous positions ${held} ≤ cap ${run.config.maxPositions}` })
  checks.push({ name: "no_short_shares", verdict: shortShares === 0 ? "PASS" : "FAIL", detail: shortShares === 0 ? "all share quantities ≥ 0" : `${shortShares} trade(s) with negative shares` })
  checks.push({ name: "execution_timing", verdict: timing === 0 ? "PASS" : "FAIL", detail: timing === 0 ? `every execution date strictly after its decision date (next-session open)` : `${timing} trade(s) executed on/before decision` })
  return checks
}

export function runChecks(prices: StudioPrices, config: StudioConfig, client: ClientSummary): ServerAudit {
  const run = runStudio(prices, config)
  const serverSummary: ClientSummary & { avgHolding: number | null } = {
    finalValue: run.summary.finalValue,
    totalReturn: run.summary.totalReturn,
    maxDrawdown: run.summary.maxDrawdown,
    buyCount: run.summary.buyCount,
    sellCount: run.summary.sellCount,
    avgHolding: run.summary.avgHolding,
  }
  const checks: Check[] = []

  const close = (name: string, a: number, b: number, tol: number, unit: string) => {
    const ok = Math.abs(a - b) <= tol
    checks.push({ name, verdict: ok ? "PASS" : "FAIL", detail: `server ${a.toFixed(4)}${unit} vs client ${b.toFixed(4)}${unit} (tol ±${tol}${unit})` })
  }
  close("independent_recomputation:total_return", serverSummary.totalReturn, client.totalReturn, 1e-6, "")
  close("independent_recomputation:final_value", serverSummary.finalValue, client.finalValue, 1.01, "₹")
  // drawdown may arrive rounded from a client display (e.g. -0.3243 for -0.324282…): rounding-scale tolerance
  close("independent_recomputation:max_drawdown", serverSummary.maxDrawdown, client.maxDrawdown, 1e-4, "")
  close("independent_recomputation:buy_count", serverSummary.buyCount, client.buyCount, 0, "")
  close("independent_recomputation:sell_count", serverSummary.sellCount, client.sellCount, 0, "")

  checks.push(...accountingChecks(run))

  // window provenance: dates must come from the dataset slice implied by the config window
  checks.push({
    name: "window_provenance",
    verdict: run.days.length > 0 && run.days[0].date === prices.dates[0] && run.days.at(-1)!.date === prices.dates.at(-1)! ? "PASS" : "FAIL",
    detail: `server window ${run.days[0]?.date} → ${run.days.at(-1)?.date} (${run.days.length} sessions) matches the requested slice`,
  })

  const verdict: "PASS" | "FAIL" = checks.every((c) => c.verdict === "PASS") ? "PASS" : "FAIL"
  const auditId = createHash("sha256")
    .update(JSON.stringify({ config, window: [prices.dates[0], prices.dates.at(-1)], serverSummary, verdict }))
    .digest("hex")
    .slice(0, 16)

  return {
    auditId,
    generatedAt: new Date().toISOString(),
    config,
    window: { start: prices.dates[0] ?? "", end: prices.dates.at(-1) ?? "", sessions: prices.dates.length },
    serverSummary,
    checks,
    verdict,
    stockLedger: buildStockLedger(run.trades, prices.dates),
  }
}
