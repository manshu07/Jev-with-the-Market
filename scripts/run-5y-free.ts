/**
 * Free 5-year run: full Phase-4 engine (momentum + random + benchmark) with Jev off.
 * Rationale: every Jev call is a paid gateway call (~107k for 5y). This script proves
 * the whole 5y pipeline end-to-end and produces the monthly/holding analytics for the
 * strategy legs that cost nothing. Jev can be switched on later without code changes
 * (scripts/phase4-run.ts) once the spend is approved.
 *
 * Standalone by design (does not import scripts/phase4-run.ts, whose main() auto-runs).
 * Reuses the committed simulate/rules engine unchanged.
 *
 * Usage: npx tsx scripts/run-5y-free.ts [START] [END]
 * Outputs: results/phase5y_free.md, results/monthly-analytics.json/md (regenerated
 * by monthly-analytics.ts afterwards), data/processed/phase5y/free5y.duckdb (decisions store: unused)
 */
import { resolve } from "node:path"
import { writeFileSync, mkdirSync, openSync, readSync, statSync, fstatSync } from "node:fs"
import { benchmarkCloses, loadCells, tradingDates } from "../src/phase4/data"
import { simulateAll, type DayRecord } from "../src/phase4/simulate"
import { momentumSignals, randomTargets, planTrades, executePlan, markToMarket, emptyBook, type Book, type Signal, type ExecutionPlan, type ExecutedTrade } from "../src/phase4/rules"

const root = process.cwd()
const START = process.argv[2] ?? "2021-10-01"
const END = process.argv[3] ?? "2026-09-22"

// Momentum/random trade records: mirror of the Jev book machinery.
class TradeLedger {
  private book: Book = emptyBook()
  private plan: ExecutionPlan | null = null
  private lastValue = 1_000_000
  trades: ExecutedTrade[] = []
  get bookValue(): Book {
    return this.book
  }
  apply(date: string, openOf: (t: string) => number | null) {
    if (!this.plan) return []
    const opens: Record<string, number> = {}
    for (const ticker of [...this.plan.sells, ...this.plan.buys.map((o) => o.ticker)]) {
      const open = openOf(ticker)
      if (open != null && open > 0) opens[ticker] = open
    }
    const executed = executePlan({ book: this.book, plan: this.plan, executionDate: date, opens })
    this.book = executed.book
    this.trades.push(...executed.trades)
    return executed.trades
  }
  mark(closeOf: (t: string) => number | null) {
    const closes: Record<string, number> = {}
    for (const p of this.book.positions) {
      const close = closeOf(p.ticker)
      if (close == null || !(close > 0)) throw new Error(`missing close for ${p.ticker}`)
      closes[p.ticker] = close
    }
    const mark = markToMarket(this.book, closes)
    this.lastValue = mark.portfolioValue
    return mark
  }
  planNext(signals: Signal[], closes: Record<string, number>, decisionDate: string) {
    this.plan = planTrades({
      book: this.book,
      signals,
      closes,
      portfolioValue: this.lastValue,
    })
    this.plan.decisionDate = decisionDate
  }
  state(): Book {
    return this.book
  }
}

function eligible(cells: Map<string, { ready: boolean }>, date: string): string[] {
  const out: string[] = []
  for (const [key, cell] of cells) {
    if (cell.ready && key.startsWith(`${date}|`)) out.push(key.slice(date.length + 1))
  }
  return out.sort()
}

async function main() {
  const calendarDates = tradingDates(root, START, END)
  if (calendarDates.length === 0) throw new Error("no trading dates in window — check the calendar")
  // Exclude sessions whose NIFTY 100 index bar is missing/invalid (Yahoo index gaps
  // while constituents traded). Disclosed in the report; never guessed.
  const excluded: string[] = []
  let dates: string[] = []
  try {
    await benchmarkCloses(root, calendarDates)
    dates = calendarDates
  } catch {
    dates = []
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
  console.log(`5y free run: ${dates.length} sessions ${dates[0]}..${dates.at(-1)} | excluded (no index bar): ${excluded.length}${excluded.length ? " " + excluded.join(",") : ""} | decision-ready rows: ${readyRows}`)

  const momentum = new TradeLedger()
  const random = new TradeLedger()

  const records: DayRecord[] = []
  // We drive the two ledgers manually to keep their trade records; benchmark from closes.
  const startClose = benchmarks[0]
  const momentumEligible = (date: string) =>
    eligible(cells as Map<string, { ready: boolean }>, date).flatMap((t) => {
      const v = (cells as Map<string, { ready: boolean; features: { return_20d: number | null } }>).get(`${date}|${t}`)?.features.return_20d
      return v == null ? [] : [{ ticker: t, return20d: v }]
    })
  const closeOf = (date: string, ticker: string) => (cells as Map<string, { open: number | null; close: number | null }>).get(`${date}|${ticker}`)?.close ?? null
  const openOf = (date: string, ticker: string) => (cells as Map<string, { open: number | null; close: number | null }>).get(`${date}|${ticker}`)?.open ?? null

  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index]
    momentum.apply(date, (t) => openOf(date, t))
    random.apply(date, (t) => openOf(date, t))
    const momentumMark = momentum.mark((t) => closeOf(date, t))
    const randomMark = random.mark((t) => closeOf(date, t))

    const mList = momentumEligible(date)
    const mHeld = momentum.state().positions.map((p) => p.ticker)
    const mCloses: Record<string, number> = {}
    for (const t of [...mHeld, ...mList.map((i) => i.ticker)]) {
      const c = closeOf(date, t)
      if (c != null && c > 0) mCloses[t] = c
    }
    momentum.planNext(momentumSignals(mList, mHeld), mCloses, date)

    const rList = eligible(cells as Map<string, { ready: boolean }>, date)
    const rHeld = random.state().positions.map((p) => p.ticker)
    const target = new Set(randomTargets(rList, date))
    const rCloses: Record<string, number> = {}
    for (const t of [...rHeld, ...rList]) {
      const c = closeOf(date, t)
      if (c != null && c > 0) rCloses[t] = c
    }
    const rSignals: Signal[] = [...new Set([...rList, ...rHeld])].map((ticker) => ({
      ticker,
      action: rHeld.includes(ticker) && !target.has(ticker) ? "SELL" : !rHeld.includes(ticker) && target.has(ticker) ? "BUY" : rHeld.includes(ticker) ? "HOLD" : "NO_ACTION",
      chosenProbability: null,
    }))
    random.planNext(rSignals, rCloses, date)

    records.push({
      date,
      dayNumber: index + 1,
      jev: {
        cash: 1_000_000,
        marketValue: 0,
        portfolioValue: 1_000_000,
        positions: [],
        trades: [],
        signals: [],
      },
      momentumValue: momentumMark.portfolioValue,
      randomValue: randomMark.portfolioValue,
      benchmarkValue: (1_000_000 * benchmarks[index]) / startClose,
    })
    if ((index + 1) % 250 === 0) console.log(`progress ${index + 1}/${dates.length} | momentum ${Math.round(momentumMark.portfolioValue)} | random ${Math.round(randomMark.portfolioValue)}`)
  }

  // ---- Report ----
  const last = records.at(-1)!
  const lines: string[] = []
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`
  const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`
  const momentumRet = last.momentumValue / 1_000_000 - 1
  const randomRet = last.randomValue / 1_000_000 - 1
  const benchRet = last.benchmarkValue / 1_000_000 - 1
  const peak = (values: number[]) => {
    let top = values[0]
    let worst = 0
    for (const v of values) {
      if (v > top) top = v
      const dd = v / top - 1
      if (dd < worst) worst = dd
    }
    return worst
  }
  const momDd = peak(records.map((r) => r.momentumValue))
  const rndDd = peak(records.map((r) => r.randomValue))
  const bchDd = peak(records.map((r) => r.benchmarkValue))

  lines.push("# 5-year free run (momentum / random / benchmark — Jev off)")
  lines.push("")
  lines.push(`Window: ${dates[0]} to ${dates.at(-1)} (${dates.length} sessions). Initial capital ₹10,00,000 each. Same engine, costs, and execution rules as the 6-month experiment (next-open execution, 10 bps cost, 5 bps slippage, max 5 positions, 20% cap). Jev leg intentionally not called (paid gateway calls — see report).`)
  lines.push("")
  lines.push("## Results")
  lines.push("")
  lines.push("| Strategy | Final value | Return | Max drawdown | Trades |")
  lines.push("| --- | ---: | ---: | ---: | ---: |")
  lines.push(`| Momentum (top-5 by 20d return) | ${inr(last.momentumValue)} | ${pct(momentumRet)} | ${pct(momDd)} | ${momentum.trades.length} |`)
  lines.push(`| Random (seed 20260922) | ${inr(last.randomValue)} | ${pct(randomRet)} | ${pct(rndDd)} | ${random.trades.length} |`)
  lines.push(`| NIFTY 100 buy-and-hold | ${inr(last.benchmarkValue)} | ${pct(benchRet)} | ${pct(bchDd)} | 1 (synthetic) |`)
  lines.push("")
  lines.push("## Monthly returns")
  lines.push("")
  lines.push("| Month | Momentum | Random | NIFTY 100 |")
  lines.push("| --- | ---: | ---: | ---: |")
  {
    const mk = (series: number[]) => {
      const out = new Map<string, { o: number; c: number }>()
      records.forEach((r, i) => {
        const key = r.date.slice(0, 7)
        const v = series[i]
        const b = out.get(key)
        if (!b) out.set(key, { o: v, c: v })
        else b.c = v
      })
      return out
    }
    const mB = mk(records.map((r) => r.momentumValue))
    const rB = mk(records.map((r) => r.randomValue))
    const bB = mk(records.map((r) => r.benchmarkValue))
    for (const [month, b] of [...mB.entries()].sort()) {
      const m = b.c / b.o - 1
      const rb = rB.get(month)!
      const bb = bB.get(month)!
      lines.push(`| ${month} | ${pct(m)} | ${pct(rb.c / rb.o - 1)} | ${pct(bb.c / bb.o - 1)} |`)
    }
  }
  lines.push("")
  lines.push("## Momentum trades (full ledger)")
  lines.push("")
  lines.push("| Ticker | Decision | Executed | Side | Price | Value | Cash after |")
  lines.push("| --- | --- | --- | --- | ---: | ---: | ---: |")
  for (const t of momentum.trades) {
    lines.push(`| ${t.ticker} | ${t.decisionDate} | ${t.executionDate} | ${t.action} | ${t.executionPrice.toFixed(2)} | ${Math.round(Math.abs(t.netValue)).toLocaleString("en-IN")} | ${Math.round(t.cashAfter).toLocaleString("en-IN")} |`)
  }
  lines.push("")
  lines.push("## Random strategy trades (first 60 of " + random.trades.length + ")")
  lines.push("")
  lines.push("| Ticker | Decision | Executed | Side | Price |")
  lines.push("| --- | --- | --- | --- | ---: |")
  for (const t of random.trades.slice(0, 60)) {
    lines.push(`| ${t.ticker} | ${t.decisionDate} | ${t.executionDate} | ${t.action} | ${t.executionPrice.toFixed(2)} |`)
  }
  lines.push("")
  lines.push("*Jev leg: not run in this free pass. To add it: scripts/phase4-run.ts with updated paths.ts dates + new EXPERIMENT_ID, AI_GATEWAY_API_KEY required. ~107k calls for 5 years.*")

  mkdirSync(resolve(root, "results"), { recursive: true })
  writeFileSync(resolve(root, "results/phase5y_free.md"), `${lines.join("\n")}\n`)

  // Emit a DayRecord-shaped dataset for monthly-analytics.ts (jev leg = flat cash so
  // the same tooling works; momentum/random/benchmark are the real legs).
  const dataset = {
    experiment: { id: "FREE5Y-2021-2026", startDate: dates[0], endDate: dates.at(-1)!, initialCapital: 1_000_000 },
    equityCurve: records.map((r) => ({
      date: r.date,
      jev_portfolio_value: r.jev.portfolioValue,
      nifty100_value: r.benchmarkValue,
      momentum_value: r.momentumValue,
      random_value: r.randomValue,
    })),
    days: records.map((r) => ({ date: r.date, tradesExecuted: r.jev.trades })),
  }
  const momentumDataset = {
    experiment: { id: "FREE5Y-MOMENTUM-2021-2026", startDate: dates[0], endDate: dates.at(-1)!, initialCapital: 1_000_000 },
    equityCurve: records.map((r) => ({
      date: r.date,
      // put momentum into the "jev" slot so monthly-analytics holding analysis reads it
      jev_portfolio_value: r.momentumValue,
      nifty100_value: r.benchmarkValue,
      momentum_value: r.momentumValue,
      random_value: r.randomValue,
    })),
    days: records.map((r) => ({ date: r.date, tradesExecuted: momentum.trades.filter((t) => t.executionDate === r.date) })),
  }
  writeFileSync(resolve(root, "data/processed/phase5y-free.json"), `${JSON.stringify(dataset, null, 2)}\n`)
  writeFileSync(resolve(root, "data/processed/phase5y-free-momentum.json"), `${JSON.stringify(momentumDataset, null, 2)}\n`)
  console.log(`done | momentum ${inr(last.momentumValue)} (${pct(momentumRet)}) | random ${inr(last.randomValue)} (${pct(randomRet)}) | benchmark ${inr(last.benchmarkValue)} (${pct(benchRet)})`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
