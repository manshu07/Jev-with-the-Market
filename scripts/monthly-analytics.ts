/**
 * Post-run analytics: monthly returns per strategy + per-trade holding days.
 * Reads data/processed/replay/experiment.json (Jev + momentum + random + benchmark).
 * Monthly return = month-end value / prior month-end value - 1 (calendar-month buckets
 * over trading sessions; a partial first month uses its first session as the base).
 * Holding days = trading sessions between a BUY execution and its matching SELL execution.
 * Usage: npx tsx scripts/monthly-analytics.ts [experiment.json path]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

const root = process.cwd()
const datasetPath = resolve(root, process.argv[2] ?? "data/processed/replay/experiment.json")

type Equity = {
  date: string
  jev_portfolio_value: number
  nifty100_value: number
  momentum_value: number
  random_value: number
}
type TradeRow = {
  decisionDate: string
  executionDate: string
  ticker: string
  action: "BUY" | "SELL"
  executionPrice: number
  shares: number
  value: number
}
type Dataset = {
  experiment: { id: string; startDate: string; endDate: string; initialCapital: number }
  equityCurve: Equity[]
  days: { date: string; tradesExecuted: TradeRow[] }[]
}

type MonthStat = { month: string; jev: number | null; nifty: number | null; momentum: number | null; random: number | null }
type TradeSummary = {
  ticker: string
  buy_decision_date: string
  buy_execution_date: string
  sell_execution_date: string | null
  buy_price: number
  sell_price: number | null
  pnl_pct: number | null
  holding_sessions: number | null
  still_open: boolean
}

function monthBuckets(series: number[], dates: string[]): Map<string, { open: number; close: number }> {
  const out = new Map<string, { open: number; close: number }>()
  for (let i = 0; i < series.length; i += 1) {
    const key = dates[i].slice(0, 7)
    const bucket = out.get(key)
    if (!bucket) out.set(key, { open: series[i], close: series[i] })
    else bucket.close = series[i]
  }
  return out
}

function monthReturns(buckets: Map<string, { open: number; close: number }>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [key, b] of buckets) out.set(key, b.close / b.open - 1)
  return out
}

function summarizeTrades(days: Dataset["days"]): TradeSummary[] {
  const flat: TradeRow[] = days.flatMap((d) => d.tradesExecuted ?? [])
  const byTicker = new Map<string, TradeRow[]>()
  for (const t of flat) {
    const list = byTicker.get(t.ticker) ?? []
    list.push(t)
    byTicker.set(t.ticker, list)
  }
  const summaries: TradeSummary[] = []
  for (const [ticker, rows] of byTicker) {
    let open: TradeRow | null = null
    for (const row of rows) {
      if (row.action === "BUY" && !open) {
        open = row
        continue
      }
      if (row.action === "SELL" && open) {
        summaries.push({
          ticker,
          buy_decision_date: open.decisionDate,
          buy_execution_date: open.executionDate,
          sell_execution_date: row.executionDate,
          buy_price: open.executionPrice,
          sell_price: row.executionPrice,
          pnl_pct: row.executionPrice / open.executionPrice - 1,
          holding_sessions: sessionsBetween(days, open.executionDate, row.executionDate),
          still_open: false,
        })
        open = null
      }
    }
    if (open) {
      summaries.push({
        ticker,
        buy_decision_date: open.decisionDate,
        buy_execution_date: open.executionDate,
        sell_execution_date: null,
        buy_price: open.executionPrice,
        sell_price: null,
        pnl_pct: null,
        holding_sessions: sessionsBetween(days, open.executionDate, null),
        still_open: true,
      })
    }
  }
  return summaries.sort((a, b) => a.buy_execution_date.localeCompare(b.buy_execution_date))
}

function sessionsBetween(days: Dataset["days"], from: string, to: string | null): number {
  const dates = days.map((d) => d.date)
  const i = dates.indexOf(from)
  const j = to == null ? dates.length - 1 : dates.indexOf(to)
  if (i < 0 || j < 0 || j < i) return 0
  return j - i
}

function holdingBucket(sessions: number): string {
  if (sessions <= 5) return "1-5"
  if (sessions <= 10) return "6-10"
  if (sessions <= 20) return "11-20"
  if (sessions <= 40) return "21-40"
  if (sessions <= 60) return "41-60"
  return "60+"
}

function median(values: number[]): number {
  if (!values.length) return NaN
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[s.length / 2]) / 2
}

function pct(x: number | null): string {
  return x == null ? "n/a" : `${(x * 100).toFixed(2)}%`
}

async function main() {
  const dataset = JSON.parse(readFileSync(datasetPath, "utf8")) as Dataset
  const equity = dataset.equityCurve
  const dates = equity.map((row) => row.date)
  const series: Record<string, number[]> = {
    jev: equity.map((r) => r.jev_portfolio_value),
    nifty: equity.map((r) => r.nifty100_value),
    momentum: equity.map((r) => r.momentum_value),
    random: equity.map((r) => r.random_value),
  }
  const keys = Object.keys(series)
  const bucketMaps = new Map(keys.map((k) => [k, monthBuckets(series[k], dates)]))
  const returnMaps = new Map(keys.map((k) => [k, monthReturns(bucketMaps.get(k)!)]))

  const months = [...bucketMaps.get("jev")!.keys()].sort()
  const monthly: MonthStat[] = months.map((m) => ({
    month: m,
    jev: returnMaps.get("jev")!.get(m) ?? null,
    nifty: returnMaps.get("nifty")!.get(m) ?? null,
    momentum: returnMaps.get("momentum")!.get(m) ?? null,
    random: returnMaps.get("random")!.get(m) ?? null,
  }))

  const trades = summarizeTrades(dataset.days)
  const closed = trades.filter((t) => !t.still_open && t.holding_sessions != null)
  const holdingValues = closed.map((t) => t.holding_sessions as number)
  const distribution = new Map<string, number>()
  for (const value of holdingValues) {
    const key = holdingBucket(value)
    distribution.set(key, (distribution.get(key) ?? 0) + 1)
  }
  const bucketOrder = ["1-5", "6-10", "11-20", "21-40", "41-60", "60+"]

  const result = {
    experiment_id: dataset.experiment.id,
    window: { start: dataset.experiment.startDate, end: dataset.experiment.endDate, sessions: dates.length },
    monthly_returns: monthly,
    overall: Object.fromEntries(keys.map((k) => [k, series[k].at(-1)! / series[k][0] - 1])),
    holdings: {
      closed_trades: closed.length,
      open_trades: trades.length - closed.length,
      avg_holding_sessions: holdingValues.length ? holdingValues.reduce((s, v) => s + v, 0) / holdingValues.length : null,
      median_holding_sessions: holdingValues.length ? median(holdingValues) : null,
      min_holding_sessions: holdingValues.length ? Math.min(...holdingValues) : null,
      max_holding_sessions: holdingValues.length ? Math.max(...holdingValues) : null,
      distribution: bucketOrder.map((bucket) => ({ bucket, count: distribution.get(bucket) ?? 0 })),
    },
    trades,
  }

  mkdirSync(resolve(root, "results"), { recursive: true })
  writeFileSync(resolve(root, "results/monthly-analytics.json"), `${JSON.stringify(result, null, 2)}\n`)

  const lines: string[] = []
  lines.push(`# Monthly returns and holding-period analytics`)
  lines.push("")
  lines.push(`Experiment: ${result.experiment_id} | Window: ${result.window.start} to ${result.window.end} (${result.window.sessions} sessions)`)
  lines.push("")
  lines.push("## Monthly returns (calendar months over trading sessions)")
  lines.push("")
  lines.push("| Month | Jev | NIFTY 100 | Momentum | Random | Jev - NIFTY (pp) |")
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |")
  for (const m of monthly) {
    const diff = m.jev != null && m.nifty != null ? ((m.jev - m.nifty) * 100).toFixed(2) : "n/a"
    lines.push(`| ${m.month} | ${pct(m.jev)} | ${pct(m.nifty)} | ${pct(m.momentum)} | ${pct(m.random)} | ${diff} |`)
  }
  lines.push("")
  lines.push("## Overall return")
  lines.push("")
  for (const k of keys) lines.push(`- ${k}: ${pct(result.overall[k] as number)}`)
  lines.push("")
  lines.push("## Trade holding periods (Jev strategy)")
  lines.push("")
  lines.push(`- Closed trades: ${result.holdings.closed_trades} | Still open: ${result.holdings.open_trades}`)
  lines.push(`- Average holding: ${result.holdings.avg_holding_sessions?.toFixed(1) ?? "n/a"} sessions | Median: ${result.holdings.median_holding_sessions ?? "n/a"} | Min: ${result.holdings.min_holding_sessions ?? "n/a"} | Max: ${result.holdings.max_holding_sessions ?? "n/a"}`)
  lines.push("")
  lines.push("| Holding length (sessions) | Trades |")
  lines.push("| --- | ---: |")
  for (const d of result.holdings.distribution) lines.push(`| ${d.bucket} | ${d.count} |`)
  lines.push("")
  lines.push("## Every trade")
  lines.push("")
  lines.push("| Ticker | Buy decision | Buy exec | Sell exec | Buy price | Sell price | P&L % | Holding (sessions) | Status |")
  lines.push("| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |")
  for (const t of trades) {
    lines.push(
      `| ${t.ticker} | ${t.buy_decision_date} | ${t.buy_execution_date} | ${t.sell_execution_date ?? "-"} | ${t.buy_price.toFixed(2)} | ${t.sell_price?.toFixed(2) ?? "-"} | ${t.pnl_pct == null ? "-" : pct(t.pnl_pct)} | ${t.holding_sessions ?? "-"} | ${t.still_open ? "OPEN" : "closed"} |`,
    )
  }
  lines.push("")
  writeFileSync(resolve(root, "results/monthly-analytics.md"), `${lines.join("\n")}\n`)
  console.log(`monthly-analytics: ${months.length} months, ${trades.length} trades (${closed.length} closed) → results/monthly-analytics.{json,md}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
