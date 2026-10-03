import { describe, expect, it } from "vitest"
import { pairTrades, winStats, yearlyReturns, drawdownSeries, cagr, decisionAnalysis } from "../src/studio/analysis"

const T = (ticker: string, action: "BUY" | "SELL", date: string, executionPrice: number) => ({ ticker, action, date, decisionDate: date, executionPrice, shares: 10, gross: 0, cost: 0, net: 0, cashAfter: 0 })

describe("pairTrades", () => {
  it("pairs buy→sell into P&L and holding sessions", () => {
    const trades = [T("AAA", "BUY", "2024-01-02", 100), T("AAA", "SELL", "2024-01-05", 110), T("BBB", "BUY", "2024-01-02", 50)]
    const dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]
    const closed = pairTrades(trades, dates)
    expect(closed).toHaveLength(2)
    const aaa = closed.find((c) => c.ticker === "AAA")!
    expect(aaa.pnlPct).toBeCloseTo(0.1, 6)
    expect(aaa.holding).toBe(3)
    const bbb = closed.find((c) => c.ticker === "BBB")!
    expect(bbb.stillOpen).toBe(true)
    expect(bbb.pnlPct).toBeNull()
  })
})

describe("winStats", () => {
  it("computes win rate, profit factor and averages", () => {
    const closed = [
      { ticker: "A", pnlPct: 0.10, holding: 2, stillOpen: false, buyDate: "", sellDate: "", sellPrice: 0, buyPrice: 0 },
      { ticker: "B", pnlPct: -0.05, holding: 3, stillOpen: false, buyDate: "", sellDate: "", sellPrice: 0, buyPrice: 0 },
      { ticker: "C", pnlPct: 0.02, holding: 1, stillOpen: false, buyDate: "", sellDate: "", sellPrice: 0, buyPrice: 0 },
    ]
    const s = winStats(closed)
    expect(s.count).toBe(3)
    expect(s.winRate).toBeCloseTo(2 / 3, 6)
    expect(s.avgWin).toBeCloseTo(0.06, 6)
    expect(s.avgLoss).toBeCloseTo(-0.05, 6)
    // profit factor = sum wins / |sum losses| = 0.12/0.05
    expect(s.profitFactor).toBeCloseTo(2.4, 6)
    expect(s.best).toBeCloseTo(0.10, 6)
    expect(s.worst).toBeCloseTo(-0.05, 6)
  })
})

describe("yearlyReturns", () => {
  it("compounds calendar-year returns for strategy and benchmark", () => {
    const rows = [
      { date: "2023-01-02", v: 100, b: 200 },
      { date: "2023-12-29", v: 110, b: 190 },
      { date: "2024-01-02", v: 110, b: 190 },
      { date: "2024-06-28", v: 121, b: 209 },
    ]
    const y = yearlyReturns(rows)
    expect(y[0].year).toBe("2023")
    expect(y[0].strategy).toBeCloseTo(0.10, 6)
    expect(y[0].benchmark).toBeCloseTo(-0.05, 6)
    expect(y[1].strategy).toBeCloseTo(0.10, 6)
  })
})

describe("drawdownSeries", () => {
  it("tracks drawdown from running peak", () => {
    const dd = drawdownSeries([100, 120, 90, 95])
    expect(dd[1]).toBe(0)
    expect(dd[2]).toBeCloseTo(-0.25, 6)
    expect(dd[3]).toBeCloseTo(-0.208333, 5)
  })
})

describe("cagr", () => {
  it("annualises total return over the date span", () => {
    // 1.21x over ~2.0014 calendar years (731 days incl. leap padding)
    const v = cagr(1_000_000, 1_210_000, "2023-01-01", "2025-01-01") as number
    expect(v).toBeGreaterThan(0.099)
    expect(v).toBeLessThan(0.101)
  })
})

describe("decisionAnalysis", () => {
  it("counts actions and measures forward returns after BUY", () => {
    const dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"]
    const close = [
      [100, 50],
      [102, 51],
      [104, 52],
      [106, 53],
    ]
    const decisions = {
      "2024-01-01": [
        { t: [0, 0, 0.9] }, // AAA BUY p=0.9
        { t: [1, 3, 0.6] }, // BBB NO_ACTION
      ],
      "2024-01-02": [{ t: [0, 2, 0.7] }], // AAA SELL
    }
    const da = decisionAnalysis(decisions, dates, close, ["AAA", "BBB"], [1, 2])
    expect(da.counts.BUY).toBe(1)
    expect(da.counts.SELL).toBe(1)
    expect(da.counts.NO_ACTION).toBe(1)
    expect(da.meanProb.BUY).toBeCloseTo(0.9, 6)
    const buyFwd = da.forward.BUY
    // BUY decision on 2024-01-01 at close 100: +1 session close 102, +2 sessions close 104
    expect(buyFwd[1]).toBeCloseTo(102 / 100 - 1, 6)
    expect(buyFwd[2]).toBeCloseTo(104 / 100 - 1, 6)
    // SELL decision on 2024-01-02 at close 102: +1 session close 104
    expect(da.forward.SELL[1]).toBeCloseTo(104 / 102 - 1, 6)
  })
})
