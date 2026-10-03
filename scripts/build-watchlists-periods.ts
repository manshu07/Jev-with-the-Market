/**
 * Builds the frontend datasets for the Watchlists and Periods pages.
 *
 * Outputs (all static, Vercel-friendly):
 *   public/watchlists/watchlists.json — per-ticker membership bitstrings over the
 *     experiment window for EMA-262, EMA-365 (close > EMA) and Momentum (daily
 *     top-5 by return_20d among decision-ready names), plus latest-date values.
 *   public/periods/manifest.json      — 5y/4y/3y/2y/1y summaries (momentum, NIFTY,
 *     random): return, max drawdown, trades, monthly table, holding stats.
 *   public/periods/equity-5y.json     — daily 3-strategy equity for custom windows.
 *
 * EMA computed on the full 2020-05.. history (warm-up), output starts 2021-10-01.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { DuckDBInstance } from "@duckdb/node-api"
import { emaSeries, crossEvents, encodeBits, periodSlice, monthlyFromEquity, holdingFromTrades, strategyMetrics } from "../src/watchlists/ema"

const root = process.cwd()
const OUT_START = "2021-10-01"

type Row = { date: string; ticker: string; close: number | null; return_20d: number | null; ready: boolean }

async function main() {
  const instance = await DuckDBInstance.create(resolve(root, "data/processed/market.duckdb"), { access_mode: "READ_ONLY" })
  const connection = await instance.connect()
  const result = await connection.run(`SELECT date, ticker, close, return_20d, decision_ready FROM stock_features ORDER BY date, ticker`)
  const rows = (await result.getRowObjectsJson()) as { date: string; ticker: string; close: unknown; return_20d: unknown; decision_ready: unknown }[]
  connection.closeSync()
  instance.closeSync()

  const features: Row[] = rows.map((r) => ({
    date: r.date,
    ticker: r.ticker,
    close: r.close == null ? null : Number(r.close),
    return_20d: r.return_20d == null ? null : Number(r.return_20d),
    ready: r.decision_ready === true,
  }))
  const allDates = [...new Set(features.map((r) => r.date))].sort()
  const outDates = allDates.filter((d) => d >= OUT_START)
  const tickers = [...new Set(features.map((r) => r.ticker))].sort()
  console.log(`features: ${features.length} rows, ${tickers.length} tickers, window-out ${outDates[0]}..${outDates.at(-1)} (${outDates.length})`)

  // index helpers
  const dateIndexFull = new Map(allDates.map((d, i) => [d, i]))
  const outOffset = dateIndexFull.get(outDates[0])!
  const idxOut = (d: string) => dateIndexFull.get(d)! - outOffset

  // per-ticker close series over FULL history for EMA warm-up
  const closeBy = new Map<string, (number | null)[]>()
  for (const t of tickers) closeBy.set(t, Array(allDates.length).fill(null))
  const readyBy = new Map<string, boolean>() // keyed date|ticker
  const r20 = new Map<string, number | null>() // date|ticker -> return_20d
  for (const r of features) {
    closeBy.get(r.ticker)![dateIndexFull.get(r.date)!] = r.close
    if (r.ready) {
      readyBy.set(`${r.date}|${r.ticker}`, true)
      r20.set(`${r.date}|${r.ticker}`, r.return_20d)
    }
  }

  // ---- EMA watchlists ----
  const ema262bits: Record<string, string> = {}
  const ema365bits: Record<string, string> = {}
  const crossMap: Record<string, { e262: { date: string; dir: string }[]; e365: { date: string; dir: string }[] }> = {}
  const latest = outDates.at(-1)!
  const latestIdxFull = dateIndexFull.get(latest)!
  type EmaStat = { close: number; ema: number; dist: number }
  const latestBlock: { e262: Record<string, EmaStat>; e365: Record<string, EmaStat>; mom: string[] } = {
    e262: {},
    e365: {},
    mom: [],
  }

  for (const t of tickers) {
    const closes = closeBy.get(t)!
    const e262 = emaSeries(closes, 262)
    const e365 = emaSeries(closes, 365)
    const above262Full = closes.map((c, i) => (c != null && e262[i] != null ? c > e262[i]! : false))
    const above365Full = closes.map((c, i) => (c != null && e365[i] != null ? c > e365[i]! : false))
    const a262 = above262Full.slice(outOffset)
    const a365 = above365Full.slice(outOffset)
    ema262bits[t] = encodeBits(a262)
    ema365bits[t] = encodeBits(a365)
    crossMap[t] = {
      e262: crossEvents(a262, outDates),
      e365: crossEvents(a365, outDates),
    }
    const c = closes[latestIdxFull]
    const e2 = e262[latestIdxFull]
    const e3 = e365[latestIdxFull]
    if (c != null && e2 != null) latestBlock.e262[t] = { close: c, ema: Math.round(e2 * 100) / 100, dist: Math.round((c / e2 - 1) * 10000) / 100 }
    if (c != null && e3 != null) latestBlock.e365[t] = { close: c, ema: Math.round(e3 * 100) / 100, dist: Math.round((c / e3 - 1) * 10000) / 100 }
  }

  // ---- momentum watchlist (existing strategy: daily top-5 by return_20d) ----
  const momBits: Record<string, string> = Array.from({ length: tickers.length }, () => "").reduce((acc, _, i) => {
    acc[tickers[i]] = ""
    return acc
  }, {} as Record<string, string>)
  {
    const parts: Record<string, string[]> = Object.fromEntries(tickers.map((t) => [t, [] as string[]]))
    for (const d of outDates) {
      const scored: { t: string; v: number }[] = []
      for (const t of tickers) {
        const v = r20.get(`${d}|${t}`)
        if (readyBy.has(`${d}|${t}`) && v != null) scored.push({ t, v })
      }
      scored.sort((a, b) => b.v - a.v || a.t.localeCompare(b.t))
      const top5 = new Set(scored.slice(0, 5).map((s) => s.t))
      for (const t of tickers) parts[t].push(top5.has(t) ? "1" : "0")
      if (d === latest) latestBlock.mom = [...top5].sort()
    }
    for (const t of tickers) momBits[t] = parts[t].join("")
  }

  const watchlists = {
    generatedAt: new Date().toISOString(),
    warmup_note: "EMA-262/365 computed from full history since 2020-05; values shown from 2021-10-01 (experiment window). EMA-262 seeds ~2021-05, EMA-365 ~2021-11. Membership: close above EMA (daily). Momentum: daily top-5 by 20-day return among decision-ready names (the strategy's own watchlist).",
    dates: outDates,
    lists: { ema262: ema262bits, ema365: ema365bits, momentum: momBits },
    latest: { date: latest, ...latestBlock },
  }
  mkdirSync(resolve(root, "public/watchlists"), { recursive: true })
  writeFileSync(resolve(root, "public/watchlists/watchlists.json"), `${JSON.stringify(watchlists)}\n`)
  const sizeKB = Math.round(JSON.stringify(watchlists).length / 1024)
  console.log(`watchlists.json: ${tickers.length} tickers x ${outDates.length} dates (${sizeKB} KB)`)

  // ---- periods ----
  const momentumData = JSON.parse(readFileSync(resolve(root, "data/processed/phase5y-free-momentum.json"), "utf8"))
  const equityFull = momentumData.equityCurve as { date: string; jev_portfolio_value: number; nifty100_value: number; momentum_value: number; random_value: number }[]
  const end = equityFull.at(-1)!.date
  const yearsBack = (n: number) => {
    const d = new Date(end)
    d.setFullYear(d.getFullYear() - n)
    return d.toISOString().slice(0, 10)
  }
  const periodDefs = [5, 4, 3, 2, 1].map((n) => ({ id: `${n}y`, label: `${n} year${n > 1 ? "s" : ""}`, start: n === 5 ? equityFull[0].date : yearsBack(n) }))

  const allTrades = momentumData.days.flatMap((day: { date: string; tradesExecuted: { ticker: string; action: string; executionDate: string; executionPrice?: number }[] }) =>
    (day.tradesExecuted ?? []).map((t) => ({ ...t, executionDate: t.executionDate ?? day.date })),
  )

  const periods = periodDefs.map(({ id, label, start }) => {
    const sliced = periodSlice(equityFull, start, end, (r) => r.date)
    const mom = strategyMetrics(sliced.map((r) => r.momentum_value))
    const nifty = strategyMetrics(sliced.map((r) => r.nifty100_value))
    const rand = strategyMetrics(sliced.map((r) => r.random_value))
    const monthlyRows = [...monthlyFromEquity(sliced.map((r) => ({ date: r.date, v: r.momentum_value })))]
      .sort()
      .map(([month, m]) => {
        const nSlice = monthlyFromEquity(sliced.map((r) => ({ date: r.date, v: r.nifty100_value })))
        const rSlice = monthlyFromEquity(sliced.map((r) => ({ date: r.date, v: r.random_value })))
        return { month, momentum: m, nifty: nSlice.get(month) ?? null, random: rSlice.get(month) ?? null }
      })
    const tradesIn = allTrades.filter((t: { executionDate: string }) => t.executionDate >= start)
    const holding = holdingFromTrades(
      sliced.map((r) => ({
        date: r.date,
        tradesExecuted: allTrades.filter((t: { executionDate: string }) => t.executionDate === r.date),
      })),
    )
    const holdings = holding.closed.map((c) => c.holding)
    return {
      id,
      label,
      start: sliced[0].date,
      end: sliced.at(-1)!.date,
      sessions: sliced.length,
      summary: {
        momentum: { final: Math.round(sliced.at(-1)!.momentum_value), ...mom, trades: tradesIn.filter((t: { action: string }) => t.action === "BUY").length },
        nifty: { final: Math.round(sliced.at(-1)!.nifty100_value), ...nifty },
        random: { final: Math.round(sliced.at(-1)!.random_value), ...rand },
      },
      monthly: monthlyRows,
      holdings: {
        closed: holding.closed.length,
        open: holding.open.length,
        avg: holdings.length ? Math.round((holdings.reduce((s, v) => s + v, 0) / holdings.length) * 10) / 10 : null,
        median: holdings.length ? holdings.slice().sort((a, b) => a - b)[Math.floor(holdings.length / 2)] : null,
        max: holdings.length ? Math.max(...holdings) : null,
        distribution: [
          { bucket: "1-5", count: holdings.filter((h) => h <= 5).length },
          { bucket: "6-10", count: holdings.filter((h) => h > 5 && h <= 10).length },
          { bucket: "11-20", count: holdings.filter((h) => h > 10 && h <= 20).length },
          { bucket: "21-40", count: holdings.filter((h) => h > 20 && h <= 40).length },
          { bucket: "40+", count: holdings.filter((h) => h > 40).length },
        ],
        trades: holding.closed.map((c) => ({ ticker: c.ticker, buy: c.buyDate, sell: c.sellDate, holding: c.holding })),
      },
    }
  })

  const manifest = {
    generatedAt: new Date().toISOString(),
    base: "₹10,00,000 — same engine, costs and rules as the recorded experiment (momentum top-5 by 20d return, NIFTY 100 buy-and-hold, seeded random).",
    custom_note: "Custom windows: pick any start/end inside the 5-year data; equity and monthly returns are computed client-side from equity-5y.json. Trade ledgers shown for standard periods.",
    survivorship_note: "Current NIFTY 100 membership applied backward — survivorship bias favors momentum. Not investment advice.",
    periods,
  }
  mkdirSync(resolve(root, "public/periods"), { recursive: true })
  writeFileSync(resolve(root, "public/periods/manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`)
  const equityOut = {
    dates: equityFull.map((r) => r.date),
    momentum: equityFull.map((r) => Math.round(r.momentum_value * 100) / 100),
    nifty: equityFull.map((r) => Math.round(r.nifty100_value * 100) / 100),
    random: equityFull.map((r) => Math.round(r.random_value * 100) / 100),
  }
  writeFileSync(resolve(root, "public/periods/equity-5y.json"), `${JSON.stringify(equityOut)}\n`)
  console.log(`periods: ${periods.map((p) => `${p.id}(${p.sessions}s)`).join(", ")} | equity-5y.json ${Math.round(JSON.stringify(equityOut).length / 1024)} KB`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
