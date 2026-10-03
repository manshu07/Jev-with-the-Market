import { describe, expect, it } from "vitest"
import { buildStockLedger, runChecks, type ClientSummary } from "../src/studio/server-audit"
import { runStudio, type StudioPrices } from "../src/studio/engine"

const DATES = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"]
const TICKERS = ["AAA", "BBB", "CCC"]
function makePrices(): StudioPrices {
  const g3 = (a: number, b: number, c: number) => DATES.map(() => [a, b, c])
  return {
    dates: DATES,
    tickers: TICKERS,
    open: g3(100, 50, 200),
    high: g3(103, 52, 206),
    low: g3(98, 49, 196),
    close: g3(101, 51, 202),
    ready: DATES.map(() => "111"),
    r20: DATES.map((_, i) => [0.10 - i * 0.01, 0.05 - i * 0.01, 0.01]),
    ema: { "262": g3(90, 45, 180), "365": g3(85, 42, 170) },
    decisions: {},
  }
}
const cfg = { strategy: "momentum" as const, frequency: "close" as const, sessions: 6, maxWeight: 0.2, cost: 0.001, slippage: 0.0005, maxPositions: 2, seed: 7 }

describe("server audit", () => {
  const prices = makePrices()
  const run = runStudio(prices, cfg)
  const clientSummary: ClientSummary = {
    finalValue: run.summary.finalValue,
    totalReturn: run.summary.totalReturn,
    maxDrawdown: run.summary.maxDrawdown,
    buyCount: run.summary.buyCount,
    sellCount: run.summary.sellCount,
  }

  it("all checks PASS when the client summary matches the server recomputation", () => {
    const audit = runChecks(prices, cfg, clientSummary)
    expect(audit.checks.every((c) => c.verdict === "PASS")).toBe(true)
    expect(audit.verdict).toBe("PASS")
    expect(audit.serverSummary.totalReturn).toBeCloseTo(clientSummary.totalReturn, 9)
  })

  it("FAILS recomputation when the client summary is tampered with", () => {
    const audit = runChecks(prices, cfg, { ...clientSummary, totalReturn: clientSummary.totalReturn + 0.05 })
    const recompute = audit.checks.find((c) => c.name === "independent_recomputation:total_return")!
    expect(recompute.verdict).toBe("FAIL")
    expect(audit.verdict).toBe("FAIL")
  })

  it("builds a per-stock ledger with max holding periods", () => {
    const ledger = buildStockLedger(run.trades, DATES)
    expect(ledger.length).toBeGreaterThan(0)
    for (const row of ledger) {
      expect(row.buys).toBeGreaterThan(0)
      expect(row.maxHolding).toBeGreaterThanOrEqual(0)
      if (row.maxHoldingDates) expect(row.maxHoldingDates.sell >= row.maxHoldingDates.buy).toBe(true)
    }
    // sorted by max holding descending by default
    for (let i = 1; i < ledger.length; i += 1) {
      expect(ledger[i - 1].maxHolding).toBeGreaterThanOrEqual(ledger[i].maxHolding)
    }
  })

  it("audit id is stable for the same inputs", () => {
    const a = runChecks(prices, cfg, clientSummary)
    const b = runChecks(prices, cfg, clientSummary)
    expect(a.auditId).toBe(b.auditId)
    expect(a.auditId).toMatch(/^[0-9a-f]{16}$/)
  })
})
