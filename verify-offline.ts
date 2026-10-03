/**
 * Offline verification for Jev-with-the-Market (read-only against committed data).
 * 1) Does the published Jev curve reproduce from the stored DuckDB decisions?
 * 2) Do the momentum/random baselines trade under the current simulate.ts code?
 * No network calls. No Jev calls. Does not modify any repo file.
 */
import { resolve } from "node:path"
import { loadCells, tradingDates, benchmarkCloses } from "./src/phase4/data"
import { loadCompleteDecisions, openDecisionsDatabase } from "./src/phase4/decisions"
import { simulateAll } from "./src/phase4/simulate"
import { PHASE4_DB, START_DATE, END_DATE } from "./src/phase4/paths"
import type { Signal } from "./src/phase4/rules"

const root = process.cwd()

async function main() {
  const dates = tradingDates(root, START_DATE, END_DATE).filter((d) => d <= "2026-08-31")
  const cells = await loadCells(root, START_DATE, END_DATE)
  const db = await openDecisionsDatabase(resolve(root, PHASE4_DB))
  const saved = await loadCompleteDecisions(db.connection)
  console.log("sessions:", dates.length, "| stored OK decisions:", saved.size)
  const benchmarks = benchmarkCloses(root, dates)

  function eligible(date: string): string[] {
    const out: string[] = []
    for (const [key, cell] of cells) {
      if (cell.ready && key.startsWith(`${date}|`)) out.push(key.slice(date.length + 1))
    }
    return out.sort()
  }

  let missing = 0
  const records = await simulateAll({
    dates,
    benchmarkCloses: benchmarks,
    openOf: (d, t) => cells.get(`${d}|${t}`)?.open ?? null,
    closeOf: (d, t) => cells.get(`${d}|${t}`)?.close ?? null,
    momentumEligible: (d) =>
      eligible(d).flatMap((t) => {
        const v = cells.get(`${d}|${t}`)?.features.return_20d
        return v == null ? [] : [{ ticker: t, return20d: v }]
      }),
    randomEligible: (d) => eligible(d),
    resolveJev: async (date) => {
      const signals: Signal[] = []
      for (const ticker of eligible(date)) {
        const row = saved.get(`${date}|${ticker}`)
        if (!row) {
          missing += 1
          continue
        }
        signals.push({ ticker, action: row.action as Signal["action"], chosenProbability: row.chosen })
      }
      return signals
    },
  })

  const last = records.at(-1)!
  const momentumTraded = records.some((r) => Math.abs(r.momentumValue - 1_000_000) > 0.01)
  const randomTraded = records.some((r) => Math.abs(r.randomValue - 1_000_000) > 0.01)
  const reproTrades = records.reduce((n, r) => n + r.jev.trades.length, 0)
  console.log("missing decisions for eligible cells:", missing)
  console.log("REPRO  Jev final:", Math.round(last.jev.portfolioValue), "| trades:", reproTrades)
  console.log("PUB    Jev final: 1122525 | trades: 19")
  console.log("REPRO  momentum final:", Math.round(last.momentumValue), "| ever moved:", momentumTraded)
  console.log("REPRO  random   final:", Math.round(last.randomValue), "| ever moved:", randomTraded)
  console.log("PUB    momentum/random final: 1000000 (flat)")
  db.close()
}

main().catch((error) => {
  console.error("VERIFY FAIL:", error instanceof Error ? error.message : error)
  process.exit(1)
})
