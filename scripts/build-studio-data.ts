/**
 * Exports the Experiment Studio dataset to public/studio/data.json:
 * - price grids (OHLC) for the 2021-10-01.. window
 * - decision-ready bitstrings + 20d returns
 * - EMA-262/365 computed from FULL history since 2020-05 (proper warm-up)
 * - stored System One decisions (SYSTEMONE-5Y-2021-2026-V1) mapped to ticker indexes
 * Lazy-loaded by the Studio page only (file is several MB).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { DuckDBInstance } from "@duckdb/node-api"
import { emaSeries } from "../src/watchlists/ema"

const root = process.cwd()
const OUT_START = "2021-10-01"
const RUN_ID = "SYSTEMONE-5Y-2021-2026-V1"
const ACTIONS = ["BUY", "HOLD", "SELL", "NO_ACTION"] as const

async function main() {
  const instance = await DuckDBInstance.create(resolve(root, "data/processed/market.duckdb"), { access_mode: "READ_ONLY" })
  const connection = await instance.connect()
  const result = await connection.run(`SELECT date, ticker, open, high, low, close, return_20d, decision_ready FROM stock_features ORDER BY date, ticker`)
  const rows = (await result.getRowObjectsJson()) as Record<string, unknown>[]
  connection.closeSync()
  instance.closeSync()

  const allDates = [...new Set(rows.map((r) => String(r.date)))].sort()
  const tickers = [...new Set(rows.map((r) => String(r.ticker)))].sort()
  const ti = new Map(tickers.map((t, i) => [t, i]))
  const outDates = allDates.filter((d) => d >= OUT_START)
  const diAll = new Map(allDates.map((d, i) => [d, i]))
  const diOut = new Map(outDates.map((d, i) => [d, i]))

  // full-history close series per ticker for EMA warm-up
  const closes = new Map<string, (number | null)[]>()
  for (const t of tickers) closes.set(t, Array(allDates.length).fill(null))
  for (const r of rows) {
    const c = r.close == null ? null : Number(r.close)
    closes.get(String(r.ticker))![diAll.get(String(r.date))!] = c
  }

  const F = (v: number | null) => (v == null ? null : Math.round(v * 10000) / 10000)
  const grid = (pick: (r: Record<string, unknown>) => number | null) => {
    const g: (number | null)[][] = outDates.map(() => Array(tickers.length).fill(null))
    for (const r of rows) {
      const d = String(r.date)
      const oi = diOut.get(d)
      if (oi == null) continue
      g[oi][ti.get(String(r.ticker))!] = F(pick(r))
    }
    return g
  }

  const ema262out: (number | null)[][] = outDates.map(() => Array(tickers.length).fill(null))
  const ema365out: (number | null)[][] = outDates.map(() => Array(tickers.length).fill(null))
  for (const t of tickers) {
    const e262 = emaSeries(closes.get(t)!, 262)
    const e365 = emaSeries(closes.get(t)!, 365)
    for (const [d, oi] of diOut) {
      const fi = diAll.get(d)!
      ema262out[oi][ti.get(t)!] = F(e262[fi])
      ema365out[oi][ti.get(t)!] = F(e365[fi])
    }
  }
  console.log("EMAs computed over full history")

  // System One decisions
  const inst2 = await DuckDBInstance.create(resolve(root, "data/processed/phase5y/jev_decisions.duckdb"), { access_mode: "READ_ONLY" })
  const con2 = await inst2.connect()
  const res2 = await con2.run(`SELECT decision_date, ticker, action, chosen_action_probability FROM decisions WHERE run_id = ? AND status = 'OK'`, [RUN_ID])
  const drows = (await res2.getRowObjectsJson()) as Record<string, unknown>[]
  con2.closeSync()
  inst2.closeSync()
  const decisions: Record<string, { t: number[] }[]> = {}
  for (const row of drows) {
    const d = String(row.decision_date)
    const oi = diOut.get(d)
    if (oi == null) continue
    const tIdx = ti.get(String(row.ticker))
    const aIdx = ACTIONS.indexOf(String(row.action) as (typeof ACTIONS)[number])
    if (tIdx == null || aIdx < 0) continue
    ;(decisions[d] ??= []).push({ t: [tIdx, aIdx, row.chosen_action_probability == null ? -1 : Math.round(Number(row.chosen_action_probability) * 1000) / 1000] })
  }
  for (const d of Object.keys(decisions)) decisions[d].sort((a, b) => a.t[0] - b.t[0])
  console.log(`decisions: ${drows.length} rows over ${Object.keys(decisions).length} dates`)

  // true NIFTY 100 index (buy-and-hold benchmark), scaled to ₹10,00,000 at window start
  const cnxLines = readFileSync(resolve(root, "data/raw/ohlcv/CNX100.csv"), "utf8").trim().split("\n")
  const cnxByDate = new Map<string, number | null>()
  for (const line of cnxLines.slice(1)) {
    const c = line.split(",")
    cnxByDate.set(c[0], c[4] === "" ? null : Number(c[4]))
  }
  const benchRaw = outDates.map((d) => cnxByDate.get(d) ?? null)
  const benchBaseIdx = benchRaw.findIndex((v) => v != null && v > 0)
  const benchBase = benchRaw[benchBaseIdx]!
  const benchmark = benchRaw.map((v, i) => (v == null || i < benchBaseIdx ? null : Math.round((1_000_000 * v) / benchBase * 100) / 100))

  const data = {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    warmup: "EMA-262/365 computed from full history since 2020-05. Prices and decisions shown from 2021-10-01. Execution always next-session open; costs and slippage apply per your inputs.",
    dates: outDates,
    tickers,
    open: grid((r) => (r.open == null ? null : Number(r.open))),
    high: grid((r) => (r.high == null ? null : Number(r.high))),
    low: grid((r) => (r.low == null ? null : Number(r.low))),
    close: grid((r) => (r.close == null ? null : Number(r.close))),
    ready: [] as string[],
    r20: grid((r) => (r.return_20d == null ? null : Number(r.return_20d))),
    ema: { "262": ema262out, "365": ema365out },
    decisions,
    benchmark,
  }
  // ready bitstrings in ticker-sorted order
  const readyRows = new Map<string, Map<string, boolean>>()
  for (const r of rows) {
    const d = String(r.date)
    if (!diOut.has(d)) continue
    if (!readyRows.has(d)) readyRows.set(d, new Map())
    readyRows.get(d)!.set(String(r.ticker), r.decision_ready === true)
  }
  data.ready = outDates.map((d) => tickers.map((t) => (readyRows.get(d)?.get(t) ? "1" : "0")).join(""))

  mkdirSync(resolve(root, "public/studio"), { recursive: true })
  writeFileSync(resolve(root, "public/studio/data.json"), JSON.stringify(data))
  console.log(`public/studio/data.json: ${Math.round(JSON.stringify(data).length / 1024 / 1024)}MB, ${outDates.length} dates x ${tickers.length} tickers`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
