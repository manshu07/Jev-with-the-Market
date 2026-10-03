import { describe, expect, it } from "vitest"
import { emaSeries, crossEvents, encodeBits, decodeBits, periodSlice, monthlyFromEquity, holdingFromTrades } from "../src/watchlists/ema"

describe("emaSeries", () => {
  it("returns null before the seed window fills", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i)
    const out = emaSeries(closes, 10)
    for (let i = 0; i < 8; i += 1) expect(out[i]).toBeNull()
    expect(out[9]).not.toBeNull()
    // seed = SMA of first 10
    expect(out[9]).toBeCloseTo(100 + 4.5, 6)
  })

  it("converges to the constant value on a flat series", () => {
    const closes = Array(400).fill(55.5)
    const out = emaSeries(closes, 262)
    expect(out[261]).toBeCloseTo(55.5, 6)
    expect(out[399]).toBeCloseTo(55.5, 6)
  })

  it("weights recent prices more than SMA on a convex (accelerating) series", () => {
    // accelerating gains: recent prices matter more — EMA must sit above the SMA
    const closes = Array.from({ length: 300 }, (_, i) => 100 + i * i / 100)
    const ema = emaSeries(closes, 50)
    let sma = 0
    for (let i = 250; i <= 299; i += 1) sma += closes[i]
    sma /= 50
    const emaLast = ema[299] as number
    expect(emaLast).toBeGreaterThan(sma)
  })

  it("bridges data gaps without re-seeding", () => {
    const closes: (number | null)[] = [1, 2, 3, null, null, 4, 5]
    const out = emaSeries(closes, 3)
    expect(out.slice(0, 2)).toEqual([null, null])
    expect(out[2]).toBe(2)
    expect(out[3]).toBeNull()
    expect(out[4]).toBeNull()
    // resumes from the pre-gap value, gap days emit null
    expect(out[5]).not.toBeNull()
    expect(out[5]).toBeCloseTo(4 * (2 / 4) + 2 * (2 / 4), 6)
  })
})

describe("crossEvents", () => {
  it("detects above→below and below→above flips with dates", () => {
    const above = [false, false, true, true, false, false]
    const dates = ["d1", "d2", "d3", "d4", "d5", "d6"]
    const events = crossEvents(above, dates)
    expect(events).toEqual([
      { date: "d3", dir: "entered" },
      { date: "d5", dir: "exited" },
    ])
  })
})

describe("bit encoding", () => {
  it("roundtrips membership", () => {
    const flags = [true, false, true, true, false]
    const s = encodeBits(flags)
    expect(s.length).toBe(flags.length)
    expect(decodeBits(s)).toEqual(flags)
  })
})

describe("periodSlice", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ date: `2020-01-${String(i + 1).padStart(2, "0")}`, v: i }))
  it("slices by start date and keeps the end", () => {
    const sliced = periodSlice(rows, "2020-01-50", "2020-01-79", (r) => r.date)
    expect(sliced.length).toBe(30)
    expect(sliced[0].v).toBe(49)
    expect(sliced.at(-1)!.v).toBe(78)
  })
})

describe("monthlyFromEquity", () => {
  it("computes open-to-close monthly returns", () => {
    const rows = [
      { date: "2024-01-02", v: 100 },
      { date: "2024-01-31", v: 110 },
      { date: "2024-02-01", v: 110 },
      { date: "2024-02-28", v: 99 },
    ]
    const m = monthlyFromEquity(rows)
    expect(m.get("2024-01")).toBeCloseTo(0.1, 6)
    expect(m.get("2024-02")).toBeCloseTo(-0.1, 6)
  })
})

describe("holdingFromTrades", () => {
  const dates = Array.from({ length: 10 }, (_, i) => `2024-01-${String(i + 1).padStart(2, "0")}`)
  const days = dates.map((date) => ({ date, tradesExecuted: [] as { ticker: string; action: string; executionDate: string }[] }))
  it("pairs buy and sell and counts sessions between", () => {
    days[1].tradesExecuted.push({ ticker: "X", action: "BUY", executionDate: dates[1] })
    days[4].tradesExecuted.push({ ticker: "X", action: "SELL", executionDate: dates[4] })
    const result = holdingFromTrades(days)
    expect(result.closed).toHaveLength(1)
    expect(result.closed[0].holding).toBe(3)
    expect(result.open).toHaveLength(0)
  })
})
