import { describe, expect, it } from "vitest"
import { runStudio, type StudioPrices, type StudioConfig } from "../src/studio/engine"

const DATES = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"]
const TICKERS = ["AAA", "BBB"]

function makePrices(over: Partial<StudioPrices> = {}): StudioPrices {
  const flat = (v: number) => DATES.map(() => TICKERS.map(() => v))
  return {
    dates: DATES,
    tickers: TICKERS,
    open: flat(100),
    high: flat(102),
    low: flat(99),
    close: flat(101),
    ready: DATES.map(() => "11"),
    r20: DATES.map(() => [0.05, 0.03]),
    ema: { "262": flat(90), "365": flat(85) },
    decisions: {},
    ...over,
  }
}

const baseConfig: StudioConfig = {
  strategy: "momentum",
  frequency: "close",
  sessions: DATES.length,
  maxWeight: 0.2,
  cost: 0.001,
  slippage: 0.0005,
  maxPositions: 5,
  seed: 20260922,
}

describe("runStudio", () => {
  it("buys the strongest momentum name within the weight cap and charges cost+slippage", () => {
    const out = runStudio(makePrices(), baseConfig)
    const buys = out.trades.filter((t) => t.action === "BUY")
    expect(buys.length).toBeGreaterThan(0)
    expect(buys[0].ticker).toBe("AAA") // higher r20 ranks first
    // execution price = next open * (1 + slippage); value = shares*price, cost charged
    const exec = buys[0].executionPrice
    expect(exec).toBeCloseTo(100 * 1.0005, 6)
    // notional cannot exceed maxWeight * portfolio value (1_000_000 → 200_000)
    expect(buys[0].shares * exec).toBeLessThanOrEqual(200_000 + 1)
  })

  it("respects a custom maxWeight, cost and slippage", () => {
    const out = runStudio(makePrices(), { ...baseConfig, maxWeight: 0.5, cost: 0.02, slippage: 0.01 })
    const buy = out.trades.find((t) => t.action === "BUY")!
    expect(buy.executionPrice).toBeCloseTo(100 * 1.01, 6)
    expect(buy.shares * buy.executionPrice).toBeLessThanOrEqual(500_000 + 1)
  })

  it("caps the run to the requested number of trading sessions", () => {
    const out = runStudio(makePrices(), { ...baseConfig, sessions: 3 })
    expect(out.days).toHaveLength(3)
  })

  it("crossover frequency enters only on membership flip days", () => {
    // AAA below EMA on day1, above from day2 → flip on day2 → BUY executes day3.
    const ema = DATES.map((_, i) => (i === 0 ? [500, 500] : [90, 500]))
    const prices = makePrices({ ema: { "262": ema, "365": DATES.map(() => [500, 500]) } })
    const out = runStudio(prices, { ...baseConfig, strategy: "ema262", frequency: "crossover" })
    const buys = out.trades.filter((t) => t.action === "BUY")
    expect(buys).toHaveLength(1)
    expect(buys[0].ticker).toBe("AAA")
    expect(buys[0].decisionDate).toBe("2024-01-02") // the flip day
    expect(buys[0].date).toBe("2024-01-03") // next-session execution
  })

  it("open/high/low frequency changes the evaluation price for EMA membership", () => {
    // close 101 > ema 100.5 but low 99 < ema: low-frequency keeps AAA out
    const ema = DATES.map(() => [100.5, 500])
    const prices = makePrices({ ema: { "262": ema, "365": DATES.map(() => [500, 500]) } })
    const onLow = runStudio(prices, { ...baseConfig, strategy: "ema262", frequency: "low" })
    const onClose = runStudio(prices, { ...baseConfig, strategy: "ema262", frequency: "close" })
    expect(onLow.trades.filter((t) => t.ticker === "AAA" && t.action === "BUY")).toHaveLength(0)
    expect(onClose.trades.filter((t) => t.ticker === "AAA" && t.action === "BUY").length).toBeGreaterThan(0)
  })

  it("replays stored System One decisions instead of rules", () => {
    const prices = makePrices({
      decisions: { "2024-01-01": [{ t: [1, 0, 0.9] }] }, // ticker idx 1 (BBB), BUY, p=0.90
    })
    const out = runStudio(prices, { ...baseConfig, strategy: "systemone" })
    const buy = out.trades.find((t) => t.action === "BUY")
    expect(buy?.ticker).toBe("BBB")
  })

  it("accounts cash + positions to portfolio value every day", () => {
    const out = runStudio(makePrices(), baseConfig)
    for (const day of out.days) {
      expect(Math.abs(day.cash + day.marketValue - day.value)).toBeLessThan(0.05)
    }
  })
})
