/**
 * Jev smoke test on the 5-year dataset: N calls to the TypeSafe SystemOne API
 * (model jev-latest) using the repo's exact prompt/criteria/state shapes.
 * Reads TYPESAFE_API_KEY from env (never printed, never logged).
 * Usage: npx tsx scripts/jev-smoke-5y.ts [N]
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { DuckDBInstance } from "@duckdb/node-api"
import { DECISION_INSTRUCTIONS, ACTION_CRITERIA } from "../src/jev/schema"
import { parseDecision } from "../src/jev/client"

const root = process.cwd()
const N = Number(process.argv[2] ?? 12)
const key = process.env.TYPESAFE_API_KEY?.trim()
if (!key) {
  console.error("TYPESAFE_API_KEY missing — source ~/.hermes/.env first")
  process.exit(1)
}

const DB_PATH = "data/processed/market.duckdb"

async function main() {
  const instance = await DuckDBInstance.create(resolve(root, DB_PATH), { access_mode: "READ_ONLY" })
  const connection = await instance.connect()
  // Spread sample: one decision-ready row near the end of each half-year, two tickers each.
  const result = await connection.run(`
    SELECT date, ticker, close, return_20d, sma_200, rsi_14, volatility_20d, distance_from_52w_high, nifty_return_20d
    FROM stock_features
    WHERE decision_ready
      AND date IN (
        SELECT date FROM (SELECT DISTINCT date FROM stock_features WHERE decision_ready ORDER BY date)
        WHERE date >= '2021-12-01' AND (date LIKE '%-06-15%' OR date LIKE '%-12-15%')
        LIMIT 40
      )
    ORDER BY date, ticker
    LIMIT ${N * 4}
  `)
  const rows = (await result.getRowObjectsJson()) as Record<string, unknown>[]
  connection.closeSync()
  instance.closeSync()

  const picked: { date: string; ticker: string }[] = []
  const seenDates = new Set<string>()
  for (const row of rows) {
    if (picked.length >= N) break
    if (seenDates.size >= 6 && !seenDates.has(String(row.date))) continue
    seenDates.add(String(row.date))
    picked.push({ date: String(row.date), ticker: String(row.ticker) })
  }

  let ok = 0
  let failed = 0
  const latencies: number[] = []
  const actions: string[] = []
  for (const item of picked) {
    const full = rows.find((r) => String(r.date) === item.date && String(r.ticker) === item.ticker)
    if (!full) continue
    const market = {
      ticker: item.ticker,
      decision_date: item.date,
      close: full.close,
      return_20d: full.return_20d,
      sma_200: full.sma_200,
      rsi_14: full.rsi_14,
      volatility_20d: full.volatility_20d,
      distance_from_52w_high: full.distance_from_52w_high,
      nifty_return_20d: full.nifty_return_20d,
    }
    const portfolio = {
      currently_held: false,
      entry_price: null,
      holding_days: null,
      unrealized_return: null,
      portfolio_cash: 600_000,
      portfolio_value: 1_000_000,
      number_of_positions: 2,
      max_positions: 5,
    }
    const started = Date.now()
    try {
      const response = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "jev-latest",
          state: { market, portfolio },
          questions: {
            action: { type: "choice", instructions: DECISION_INSTRUCTIONS, criteria: ACTION_CRITERIA },
          },
        }),
      })
      const latency = Date.now() - started
      const text = await response.text()
      if (!response.ok) {
        failed += 1
        console.log(`FAIL ${item.date} ${item.ticker} http ${response.status}: ${text.slice(0, 160)}`)
        continue
      }
      const parsed = parseDecision(JSON.parse(text))
      if (!parsed.ok) {
        failed += 1
        console.log(`FAIL ${item.date} ${item.ticker} parse: ${parsed.error}`)
        continue
      }
      ok += 1
      latencies.push(latency)
      actions.push(parsed.action)
      console.log(`OK   ${item.date} ${item.ticker.padEnd(12)} ${parsed.action.padEnd(9)} p=${parsed.confidence?.toFixed(2)} ${latency}ms`)
    } catch (error) {
      failed += 1
      console.log(`FAIL ${item.date} ${item.ticker} ${error instanceof Error ? error.message : error}`)
    }
  }
  const mean = latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0
  console.log(`\nsmoke: ${ok} ok / ${failed} failed | mean latency ${mean}ms | actions: ${[...new Set(actions)].join(",")}`)
  if (ok === 0) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
