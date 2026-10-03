/**
 * FULL 5-year System One (Jev model) leg: real paid decisions for every
 * decision-ready stock-day, 2021-10-01 .. 2026-09-22, using the repo's own
 * simulation engine (simulateAll) and prompt (decision_schema_v1).
 *
 * Endpoint: TypeSafe direct API (POST https://api.typesafe.ai/v1/systemone,
 * model jev-latest) — same Choice shape the repo sends through the Vercel
 * gateway, proven live by scripts/jev-smoke-5y.ts. Key: TYPESAFE_API_KEY env.
 *
 * Resume-safe: every decision is persisted to DuckDB (UNIQUE date+ticker);
 * re-running skips stored OK decisions. Aborts on payment/auth blocks;
 * retries 429/5xx with Retry-After-aware exponential backoff (cap 60s).
 *
 * Usage:
 *   npx tsx scripts/phase5y-jev-full.ts            # full run (resumes)
 *   npx tsx scripts/phase5y-jev-full.ts --sessions 2   # bounded live check
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api"
import { benchmarkCloses, loadCells, tradingDates } from "../src/phase4/data"
import { simulateAll, type DayRecord } from "../src/phase4/simulate"
import type { Signal } from "../src/phase4/rules"
import { DECISION_INSTRUCTIONS, ACTION_CRITERIA, MODEL, PROMPT_VERSION } from "../src/jev/schema"
import { parseDecision } from "../src/jev/client"
import { marketState } from "../src/jev/state"

const root = process.cwd()
const START = "2021-10-01"
const END = "2026-09-22"
const RUN_ID = "SYSTEMONE-5Y-2021-2026-V1"
const DB_PATH = "data/processed/phase5y/jev_decisions.duckdb"
const CONCURRENCY = 4
const MAX_ATTEMPTS = 6
const BACKOFF_CAP_MS = 60_000
const BOUND_SESSIONS = (() => {
  const i = process.argv.indexOf("--sessions")
  return i >= 0 ? Number(process.argv[i + 1] ?? 0) : 0
})()

const key = process.env.TYPESAFE_API_KEY?.trim()
if (!key) {
  console.error("TYPESAFE_API_KEY missing — source ~/.hermes/.env first")
  process.exit(1)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const exp = Math.min(BACKOFF_CAP_MS, 1_000 * 2 ** Math.max(0, attempt - 1))
  if (!retryAfter?.trim()) return exp
  const t = retryAfter.trim()
  if (/^\d+(\.\d+)?$/.test(t)) return Math.min(BACKOFF_CAP_MS, Math.max(0, Number(t) * 1000))
  const when = Date.parse(t)
  return Number.isFinite(when) ? Math.min(BACKOFF_CAP_MS, Math.max(0, when - Date.now())) : exp
}

class UnresolvedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnresolvedDecisionError"
  }
}

type DecisionRow = { action: string; chosen: number | null; probabilities: Record<string, number> | null }

async function callSystemOne(market: unknown, portfolio: unknown): Promise<DecisionRow> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response
    try {
      response = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "jev-latest",
          state: { market, portfolio },
          questions: { action: { type: "choice", instructions: DECISION_INSTRUCTIONS, criteria: ACTION_CRITERIA } },
        }),
      })
    } catch {
      if (attempt >= MAX_ATTEMPTS) throw new UnresolvedError(`network after ${MAX_ATTEMPTS} attempts`)
      await sleep(retryDelayMs(attempt, null))
      continue
    }
    const text = await response.text()
    if (!response.ok) {
      if (response.status === 401 || response.status === 402) {
        throw new Error(`PAYMENT/AUTH BLOCK http ${response.status}: ${text.slice(0, 200)} — stopping run`)
      }
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
        await sleep(retryDelayMs(attempt, response.headers.get("retry-after")))
        continue
      }
      throw new UnresolvedError(`http ${response.status}: ${text.slice(0, 160)}`)
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = { unparsed: text }
    }
    const parsed = parseDecision(raw)
    if (!parsed.ok) throw new UnresolvedError(`parse: ${parsed.error}`)
    return { action: parsed.action, chosen: parsed.confidence, probabilities: parsed.probabilities }
  }
  throw new UnresolvedError("retries exhausted")
}

const DECISIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS decisions (
    run_id VARCHAR, decision_date VARCHAR, ticker VARCHAR,
    market_state_json VARCHAR, portfolio_state_json VARCHAR,
    action VARCHAR, chosen_action_probability DOUBLE, probabilities_json VARCHAR,
    model VARCHAR, prompt_version VARCHAR, latency_ms INTEGER, attempt INTEGER,
    status VARCHAR, created_at VARCHAR,
    UNIQUE (run_id, decision_date, ticker)
  )`

async function main() {
  const calendarDates = tradingDates(root, START, END)
  const excluded: string[] = []
  let dates: string[] = []
  try {
    await benchmarkCloses(root, calendarDates)
    dates = calendarDates
  } catch {
    for (const date of calendarDates) {
      try {
        await benchmarkCloses(root, [date])
        dates.push(date)
      } catch {
        excluded.push(date)
      }
    }
  }
  const cells = await loadCells(root, dates[0], dates.at(-1)!)
  const benchmarks = benchmarkCloses(root, dates)
  const readyRows = [...cells.values()].filter((c) => c.ready).length
  console.log(`[5Y-JEV] ${RUN_ID} sessions=${dates.length} excluded=${excluded.length} ready_rows=${readyRows}`)

  function eligible(date: string): string[] {
    const out: string[] = []
    for (const [k, cell] of cells) {
      if (cell.ready && k.startsWith(`${date}|`)) out.push(k.slice(date.length + 1))
    }
    return out.sort()
  }

  // ---- decisions DB (resume) ----
  mkdirSync(resolve(root, "data/processed/phase5y"), { recursive: true })
  const dbPath = resolve(root, DB_PATH)
  const instance = await DuckDBInstance.create(dbPath)
  const connection = await instance.connect()
  await connection.run(DECISIONS_TABLE)
  const saved = new Map<string, DecisionRow>()
  {
    const res = await connection.run(
      `SELECT decision_date, ticker, action, chosen_action_probability, probabilities_json FROM decisions WHERE run_id = ? AND status = 'OK'`,
      [RUN_ID],
    )
    for (const row of await res.getRowObjectsJson()) {
      saved.set(`${row.decision_date}|${row.ticker}`, {
        action: String(row.action),
        chosen: row.chosen_action_probability == null ? null : Number(row.chosen_action_probability),
        probabilities: row.probabilities_json == null ? null : JSON.parse(String(row.probabilities_json)),
      })
    }
  }
  console.log(`[5Y-JEV] resume: ${saved.size} stored OK decisions`)

  // ---- light manifest (provenance) ----
  const manifestPath = resolve(root, "data/processed/phase5y/manifest.json")
  if (!existsSync(manifestPath)) {
    const body = {
      run_id: RUN_ID,
      window: { start: dates[0], end: dates.at(-1), sessions: dates.length },
      excluded_sessions: excluded,
      model: MODEL,
      prompt_version: PROMPT_VERSION,
      decisions_db: DB_PATH,
      feature_dataset_sha256: createHash("sha256").update(readFileSync(resolve(root, "data/processed/market.duckdb"))).digest("hex"),
      prompt_sha256: createHash("sha256").update(JSON.stringify({ instructions: DECISION_INSTRUCTIONS, criteria: ACTION_CRITERIA })).digest("hex"),
      created_at: new Date().toISOString(),
    }
    writeFileSync(manifestPath, `${JSON.stringify({ ...body, manifest_sha256: createHash("sha256").update(JSON.stringify(body)).digest("hex") }, null, 2)}\n`)
  }

  // ---- serialized writes ----
  let writes: Promise<unknown> = Promise.resolve()
  const persist = (date: string, ticker: string, market: unknown, portfolio: unknown, row: DecisionRow, latencyMs: number, attempts: number) => {
    const run = writes.then(async () => {
      await connection.run(
        `INSERT OR REPLACE INTO decisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [RUN_ID, date, ticker, JSON.stringify(market), JSON.stringify(portfolio), row.action, row.chosen, row.probabilities ? JSON.stringify(row.probabilities) : null, MODEL, PROMPT_VERSION, latencyMs, attempts, "OK", new Date().toISOString()],
      )
    })
    writes = run.then(() => undefined, () => undefined)
    return run
  }

  const startedAt = Date.now()
  let unresolvedTotal = 0
  const limitedDates = BOUND_SESSIONS > 0 ? dates.slice(0, BOUND_SESSIONS) : dates
  const fullDates = BOUND_SESSIONS > 0 ? limitedDates : dates

  const records: DayRecord[] = await simulateAll({
    dates: fullDates,
    benchmarkCloses: BOUND_SESSIONS > 0 ? benchmarks.slice(0, BOUND_SESSIONS) : benchmarks,
    openOf: (d, t) => cells.get(`${d}|${t}`)?.open ?? null,
    closeOf: (d, t) => cells.get(`${d}|${t}`)?.close ?? null,
    momentumEligible: (d) =>
      eligible(d).flatMap((t) => {
        const v = cells.get(`${d}|${t}`)?.features.return_20d
        return v == null ? [] : [{ ticker: t, return20d: v }]
      }),
    randomEligible: (d) => eligible(d),
    resolveJev: async (date, book, portfolioValue) => {
      const tickers = eligible(date)
      const signals: Signal[] = []
      const missing = tickers.filter((t) => !saved.has(`${date}|${t}`))
      let cursor = 0
      let stopped = false
      const failure: { msg: string | null } = { msg: null }

      async function worker() {
        while (!stopped) {
          const index = cursor
          cursor += 1
          if (index >= missing.length) return
          const ticker = missing[index]
          const cell = cells.get(`${date}|${ticker}`)
          if (!cell) throw new Error(`missing cell ${date}|${ticker}`)
          const market = marketState(cell.features)
          const position = book.positions.find((p) => p.ticker === ticker)
          const held = Boolean(position)
          const portfolio = {
            currently_held: held,
            entry_price: held ? position!.entryPrice : null,
            holding_days: held ? Math.max(1, dates.indexOf(date) - dates.indexOf(position!.entryDate) + 1) : 0,
            unrealized_return: held && cell.close != null && position!.entryPrice > 0 ? cell.close / position!.entryPrice - 1 : 0,
            portfolio_cash: book.cash,
            portfolio_value: portfolioValue,
            number_of_positions: book.positions.length,
            max_positions: 5,
          }
          const started = Date.now()
          try {
            const row = await callSystemOne(market, portfolio)
            const latency = Date.now() - started
            await persist(date, ticker, market, portfolio, row, latency, 1)
            saved.set(`${date}|${ticker}`, row)
            signals.push({ ticker, action: row.action as Signal["action"], chosenProbability: row.chosen })
          } catch (error) {
            if (error instanceof Error && error.message.startsWith("PAYMENT/AUTH BLOCK")) {
              console.error(`[5Y-JEV] ${error.message}`)
              process.exit(1)
            }
            stopped = true
            failure.msg ??= error instanceof Error ? error.message : String(error)
            unresolvedTotal += 1
            return
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(missing.length, 1)) }, () => worker()))
      if (failure.msg) {
        throw new UnresolvedError(`${date} ${failure.msg} (stored=${saved.size}, unresolved=${unresolvedTotal}) — rerun to resume`)
      }
      // fill cached signals for tickers already stored
      for (const t of tickers) {
        if (!signals.some((s) => s.ticker === t)) {
          const row = saved.get(`${date}|${t}`)
          if (!row) throw new UnresolvedError(`missing decision ${date}|${t}`)
          signals.push({ ticker: t, action: row.action as Signal["action"], chosenProbability: row.chosen })
        }
      }
      const done = saved.size
      const elapsed = Date.now() - startedAt
      const etaMin = done > 0 ? Math.round(((readyRows - done) / done) * (elapsed / 60000)) : 0
      console.log(`[5Y-JEV] ${date} | day signals=${tickers.length} | stored ${done}/${readyRows} | unresolved=${unresolvedTotal} | portfolio ₹${Math.round(portfolioValue).toLocaleString("en-IN")} | eta ~${etaMin}m`)
      return signals.sort((a, b) => a.ticker.localeCompare(b.ticker))
    },
  })

  await writes
  const last = records.at(-1)!
  console.log(`[5Y-JEV] COMPLETE ${RUN_ID} final=₹${Math.round(last.jev.portfolioValue).toLocaleString("en-IN")} benchmark=₹${Math.round(last.benchmarkValue).toLocaleString("en-IN")} momentum=₹${Math.round(last.momentumValue).toLocaleString("en-IN")} random=₹${Math.round(last.randomValue).toLocaleString("en-IN")}`)

  if (BOUND_SESSIONS === 0) {
    // publish replay dataset for analytics
    const dataset = {
      experiment: { id: RUN_ID, startDate: dates[0], endDate: dates.at(-1), initialCapital: 1_000_000 },
      equityCurve: records.map((r) => ({
        date: r.date,
        jev_portfolio_value: r.jev.portfolioValue,
        nifty100_value: r.benchmarkValue,
        momentum_value: r.momentumValue,
        random_value: r.randomValue,
      })),
      days: records.map((r) => ({ date: r.date, tradesExecuted: r.jev.trades })),
      decisions: records.flatMap((r) =>
        r.jev.signals.map((s) => ({
          date: r.date,
          ticker: s.ticker,
          action: s.action,
          chosen: s.chosenProbability,
          executed: r.jev.trades.some((t) => t.decisionDate === r.date && t.ticker === s.ticker),
        })),
      ),
    }
    writeFileSync(resolve(root, "data/processed/phase5y-jev.json"), `${JSON.stringify(dataset, null, 2)}\n`)
    console.log(`[5Y-JEV] published data/processed/phase5y-jev.json`)
  }
  connection.closeSync()
  instance.closeSync()
}

main().catch((error) => {
  console.error(`[5Y-JEV] FATAL: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
