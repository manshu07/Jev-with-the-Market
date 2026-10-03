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

  it("ema_cross enters on golden cross (262 over 365, closing prices), exits on death cross", () => {
    // fast EMA 90→110 crosses slow EMA 100 on day2 (golden); then 90 vs 100 on day4 (death)
    const fast = [90, 110, 110, 90, 90, 90].map((v) => [v, 500])
    const slow = DATES.map(() => [100, 500])
    const prices = makePrices({ ema: { "262": fast, "365": slow } })
    const out = runStudio(prices, { ...baseConfig, strategy: "ema_cross", frequency: "close" })
    const buys = out.trades.filter((t) => t.action === "BUY")
    const sells = out.trades.filter((t) => t.action === "SELL")
    expect(buys).toHaveLength(1)
    expect(buys[0].ticker).toBe("AAA")
    expect(buys[0].decisionDate).toBe("2024-01-02") // golden cross day
    expect(buys[0].date).toBe("2024-01-03") // next-session open
    expect(sells.length).toBeGreaterThanOrEqual(1)
    expect(sells[0].ticker).toBe("AAA") // death cross exit
  })

  it("ema_cross skips entries while all slots are full (decision A: no rotation)", () => {
    // two simultaneous golden crosses (AAA + BBB) but only 1 slot
    const fast = [90, 110, 110, 110, 110, 110].map((v) => [v, v])
    const slow = DATES.map(() => [100, 100])
    const prices = makePrices({ ema: { "262": fast, "365": slow } })
    const out = runStudio(prices, { ...baseConfig, strategy: "ema_cross", frequency: "close", maxPositions: 1 })
    const buys = out.trades.filter((t) => t.action === "BUY")
    expect(buys).toHaveLength(1) // only one entry — the other cross is skipped, not queued
  })

  it("ema_cross is frequency-immune (fixed to closing prices)", () => {
    const fast = [90, 110, 110, 110, 110, 110].map((v) => [v, 500])
    const slow = DATES.map(() => [100, 500])
    const prices = makePrices({ ema: { "262": fast, "365": slow } })
    const a = runStudio(prices, { ...baseConfig, strategy: "ema_cross", frequency: "close" })
    const b = runStudio(prices, { ...baseConfig, strategy: "ema_cross", frequency: "high" })
    expect(a.trades.map((t) => `${t.ticker}${t.action}`)).toEqual(b.trades.map((t) => `${t.ticker}${t.action}`))
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
