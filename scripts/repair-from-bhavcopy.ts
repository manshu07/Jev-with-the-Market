/**
 * Repair Yahoo placeholder bars from NSE official bhavcopy.
 *
 * Finds every stock row in the raw cache that is a flat zero-volume print
 * (open=high=low=close, volume 0) or missing prices on a date the universe
 * actually traded, plus known bad-level prints (e.g. VEDL 2026-04-30), then
 * replaces them with the official NSE bhavcopy values for that session.
 *
 * Writes: patched CSVs (in place), results/nse-repairs.{json,md} audit log.
 * Originals remain recoverable via git (data/raw is tracked).
 *
 * Usage: npx tsx scripts/repair-from-bhavcopy.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"

const root = process.cwd()
const ohlcvDir = join(root, "data/raw/ohlcv")
const calendar: string[] = JSON.parse(readFileSync(join(root, "data/universe/trading_calendar.json"), "utf8")).trading_dates
const universe = JSON.parse(readFileSync(join(root, "config/universe.json"), "utf8"))
const symbols: string[] = universe.symbols.map((s: { nse_symbol: string }) => s.nse_symbol)

type Row = { date: string; open: string; high: string; low: string; close: string; adj_close: string; volume: string }

function readCsv(symbol: string): Row[] {
  const lines = readFileSync(join(ohlcvDir, `${symbol}.csv`), "utf8").trim().split("\n")
  return lines.slice(1).map((line) => {
    const c = line.split(",")
    return { date: c[0], open: c[1] ?? "", high: c[2] ?? "", low: c[3] ?? "", close: c[4] ?? "", adj_close: c[5] ?? "", volume: c[6] ?? "" }
  })
}

function isPlaceholder(row: Row): boolean {
  const vals = [row.open, row.high, row.low, row.close].map((v) => (v === "" ? null : Number(v)))
  if (vals.some((v) => v == null)) return true // missing prices on a traded day
  if (Number(row.volume || "0") === 0 && vals.every((v) => v != null && vals[0] === v)) return true // flat zero-vol
  return false
}

/** Overnight move >35% with no corporate action recorded = bad level (VEDL-class). */
function badLevel(rows: Row[], events: { splits: { date: string }[]; dividends: { date: string }[] }): string[] {
  const out: string[] = []
  const splitDates = new Set(events.splits.map((s) => s.date))
  for (let i = 1; i < rows.length; i += 1) {
    const prev = Number(rows[i - 1].close)
    const cur = Number(rows[i].close)
    if (!prev || !cur) continue
    const ratio = cur / prev
    if ((ratio < 0.65 || ratio > 1.5) && !splitDates.has(rows[i].date)) out.push(rows[i].date)
  }
  return out
}

const byDate = new Map<string, { symbol: string; reason: string }[]>()
const badLevelDates = new Map<string, string[]>() // date -> symbols

for (const symbol of symbols) {
  const rows = readCsv(symbol)
  const eventsPath = join(root, "data/raw/events", `${symbol}.json`)
  const events = existsSync(eventsPath) ? JSON.parse(readFileSync(eventsPath, "utf8")) : { splits: [], dividends: [] }
  for (const row of rows) {
    if (calendar.includes(row.date) && isPlaceholder(row)) {
      const list = byDate.get(row.date) ?? []
      list.push({ symbol, reason: "placeholder" })
      byDate.set(row.date, list)
    }
  }
  for (const date of badLevel(rows, events)) {
    const list = badLevelDates.get(date) ?? []
    list.push(symbol)
    badLevelDates.set(date, list)
  }
}

// Only repair bad-level prints on single symbols (index-scale moves are real crashes).
const repairs = new Map<string, { symbol: string; reason: string }[]>()
for (const [date, list] of byDate) for (const item of list) repairs.set(date, [...(repairs.get(date) ?? []), item])
for (const [date, syms] of badLevelDates) {
  if (syms.length <= 3) for (const symbol of syms) {
    const existing = repairs.get(date) ?? []
    if (!existing.some((e) => e.symbol === symbol)) repairs.set(date, [...existing, { symbol, reason: "bad_level" }])
  }
}

const dates = [...repairs.keys()].sort()
console.log(`repair candidates: ${dates.length} dates, ${[...repairs.values()].flat().length} symbol-days`)
for (const date of dates) {
  console.log(`  ${date}: ${repairs.get(date)!.map((r) => r.symbol).join(",")}`)
}

function dmy(date: string): string {
  const [y, m, d] = date.split("-")
  return `${d}${m}${y}`
}

async function fetchBhavcopy(date: string): Promise<Map<string, { open: string; high: string; low: string; close: string; volume: string }> | null> {
  const url = `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${dmy(date)}.csv`
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "text/csv,*/*",
      Referer: "https://www.nseindia.com/",
    },
  })
  if (!res.ok) return null
  const text = await res.text()
  const lines = text.trim().split("\n")
  const out = new Map<string, { open: string; high: string; low: string; close: string; volume: string }>()
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim())
    if (cells.length < 11) continue
    const [symbol, series, , , open, high, low, , close, , volume] = cells
    if (series !== "EQ") continue
    out.set(symbol, { open, high, low, close, volume })
  }
  return out.size > 0 ? out : null
}

const log: { date: string; symbol: string; reason: string; source: string; before: Row | null; after: { open: string; high: string; low: string; close: string; volume: string } | null }[] = []

async function main() {
  let patched = 0
  let missed = 0

  for (const date of dates) {
    const bhav = await fetchBhavcopy(date)
    if (!bhav) {
      console.log(`bhavcopy unavailable for ${date} — leaving rows as-is (logged)`)
      for (const item of repairs.get(date)!) {
        missed += 1
        log.push({ date, symbol: item.symbol, reason: item.reason, source: "none", before: null, after: null })
      }
      continue
    }
    for (const item of repairs.get(date)!) {
      const fix = bhav.get(item.symbol)
      const path = join(ohlcvDir, `${item.symbol}.csv`)
      if (!fix || !existsSync(path)) {
        missed += 1
        log.push({ date, symbol: item.symbol, reason: item.reason, source: "bhavcopy_missing_symbol", before: null, after: null })
        continue
      }
      const rows = readCsv(item.symbol)
      const row = rows.find((r) => r.date === date)
      if (!row) {
        missed += 1
        log.push({ date, symbol: item.symbol, reason: item.reason, source: "row_absent", before: null, after: null })
        continue
      }
      const before: Row = { ...row }
      row.open = fix.open
      row.high = fix.high
      row.low = fix.low
      row.close = fix.close
      row.volume = fix.volume
      row.adj_close = fix.close // bhavcopy has no adjustment; features use close only (documented)
      const lines = ["date,open,high,low,close,adj_close,volume", ...rows.map((r) => [r.date, r.open, r.high, r.low, r.close, r.adj_close, r.volume].join(","))]
      writeFileSync(path, `${lines.join("\n")}\n`)
      patched += 1
      log.push({ date, symbol: item.symbol, reason: item.reason, source: "nse_bhavcopy", before, after: fix })
    }
    await new Promise((r) => setTimeout(r, 400))
  }

  writeFileSync(resolve(root, "results/nse-repairs.json"), `${JSON.stringify({ generated_at: new Date().toISOString(), patched, missed, repairs: log }, null, 2)}\n`)
  const md = [
    "# NSE bhavcopy repair log",
    "",
    `Patched ${patched} symbol-days from official NSE bhavcopy; ${missed} could not be repaired (logged).`,
    "",
    "| Date | Symbol | Reason | Source |",
    "| --- | --- | --- | --- |",
    ...log.map((r) => `| ${r.date} | ${r.symbol} | ${r.reason} | ${r.source} |`),
    "",
    "Reason `placeholder`: Yahoo flat zero-volume print on a traded session. Reason `bad_level`: overnight move >35% with no recorded split (VEDL-class artifact). adj_close set to close on repaired rows (Phase 2 uses close, never adj_close).",
    "",
  ].join("\n")
  writeFileSync(resolve(root, "results/nse-repairs.md"), md)
  console.log(`done: patched=${patched} missed=${missed} → results/nse-repairs.{json,md}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
