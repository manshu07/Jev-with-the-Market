"use client"

import { useEffect, useMemo, useState } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { runStudio, type StudioConfig, type StudioPrices, type StrategyKey, type FrequencyKey } from "@/src/studio/engine"
import { pairTrades, winStats, yearlyReturns, monthlyReturns, drawdownSeries, cagr, decisionAnalysis } from "@/src/studio/analysis"

const pct = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(2)}%`)
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`

const STRATEGIES: { key: StrategyKey; label: string }[] = [
  { key: "momentum", label: "Base momentum" },
  { key: "ema_cross", label: "EMA-262×365 crossover" },
  { key: "systemone", label: "System One (recorded)" },
]
const FREQUENCIES: FrequencyKey[] = ["close", "crossover", "session", "low", "high", "open"]
const HORIZONS = [1, 5, 20]

type Data = StudioPrices & { warmup: string; benchmark: (number | null)[] }

export function AnalysisView() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [years, setYears] = useState(5)
  const [customWindow, setCustomWindow] = useState(false)
  const [startIdx, setStartIdx] = useState(0)
  const [endIdx, setEndIdx] = useState(0)
  const [sessions, setSessions] = useState(0)
  const [strategy, setStrategy] = useState<StrategyKey>("momentum")
  const [frequency, setFrequency] = useState<FrequencyKey>("close")
  const [maxWeight, setMaxWeight] = useState(20)
  const [cost, setCost] = useState(0.1)
  const [slippage, setSlippage] = useState(0.05)
  const [maxPositions, setMaxPositions] = useState(5)

  useEffect(() => {
    fetch("/studio/data.json")
      .then((r) => {
        if (!r.ok) throw new Error(`http ${r.status}`)
        return r.json()
      })
      .then((d: Data) => {
        setData(d)
        setStartIdx(0)
        setEndIdx(d.dates.length - 1)
      })
      .catch((e) => setError(String(e)))
  }, [])

  const dateBounds = useMemo(() => {
    if (!data) return null
    const last = data.dates[data.dates.length - 1]
    const boundsFor = (y: number) => {
      const d = new Date(last)
      d.setFullYear(d.getFullYear() - y)
      const target = d.toISOString().slice(0, 10)
      const i = data.dates.findIndex((x) => x >= target)
      return i < 0 ? 0 : i
    }
    return { last, boundsFor }
  }, [data])

  const slice = useMemo(() => {
    if (!data || !dateBounds) return null
    const start = customWindow ? startIdx : dateBounds.boundsFor(years)
    const end = customWindow && endIdx > startIdx ? endIdx : data.dates.length - 1
    const available = end - start + 1
    const count = sessions > 0 ? Math.min(sessions, available) : available
    const cut = <T,>(g: T[][]) => g.slice(start, start + count)
    return {
      dates: data.dates.slice(start, start + count),
      tickers: data.tickers,
      open: cut(data.open as number[][]),
      high: cut(data.high as number[][]),
      low: cut(data.low as number[][]),
      close: cut(data.close as number[][]),
      ready: data.ready.slice(start, start + count),
      r20: cut(data.r20),
      ema: { "262": cut(data.ema["262"]), "365": cut(data.ema["365"]) },
      benchmark: data.benchmark.slice(start, start + count),
      decisions: Object.fromEntries(Object.entries(data.decisions).filter(([d]) => d >= data.dates[start] && d <= data.dates[Math.min(data.dates.length - 1, start + count - 1)])),
    } as StudioPrices
  }, [data, years, customWindow, startIdx, endIdx, sessions, dateBounds])

  const config: StudioConfig | null = useMemo(
    () =>
      slice
        ? {
            strategy,
            frequency,
            sessions: slice.dates.length,
            maxWeight: maxWeight / 100,
            cost: cost / 100,
            slippage: slippage / 100,
            maxPositions,
            seed: 20260922,
          }
        : null,
    [slice, strategy, frequency, maxWeight, cost, slippage, maxPositions],
  )

  const run = useMemo(() => (slice && config ? runStudio(slice, config) : null), [slice, config])

  const analysis = useMemo(() => {
    if (!run || !slice) return null
    const closed = pairTrades(run.trades, slice.dates)
    const stats = winStats(closed)
    const yearsRows = yearlyReturns(run.days.map((d, i) => ({ date: d.date, v: d.value, b: (slice as StudioPrices & { benchmark?: (number | null)[] }).benchmark?.[i] ?? null })))
    const months = monthlyReturns(run.days.map((d, i) => ({ date: d.date, v: d.value, b: (slice as StudioPrices & { benchmark?: (number | null)[] }).benchmark?.[i] ?? null })))
    const dd = drawdownSeries(run.days.map((d) => d.value))
    const span = cagr(1_000_000, run.summary.finalValue, slice.dates[0], slice.dates.at(-1)!)
    const decisions = strategy === "systemone" ? decisionAnalysis(slice.decisions, slice.dates, slice.close, slice.tickers, HORIZONS) : null
    return { closed, stats, yearsRows, months, dd, span, decisions }
  }, [run, slice, strategy])

  const ddChart = useMemo(() => {
    if (!analysis || !slice) return []
    const step = Math.max(1, Math.floor(analysis.dd.length / 500))
    const rows: { date: string; dd: number }[] = []
    for (let i = 0; i < analysis.dd.length; i += step) rows.push({ date: slice.dates[i], dd: Math.round(analysis.dd[i] * 10000) / 100 })
    return rows
  }, [analysis, slice])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Analysis workbench</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[#9aa4b8]">
          Every number below is computed live from YOUR experiment settings — change any control and the analytics re-run instantly. Same engine and dataset as the Studio.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[#ff6b6b]/40 bg-[#ff6b6b]/10 p-4 text-sm text-[#ff6b6b]">
          Failed to load the dataset ({error}).{" "}
          <button onClick={() => location.reload()} className="underline">
            Retry
          </button>
        </div>
      )}
      {!data && !error && <p className="text-sm text-[#9aa4b8]">Loading dataset…</p>}

      {data && (
        <>
          {/* scope controls (same contract as Studio) */}
          <section className="rounded-lg border border-white/10 p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">PERIOD</label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {[1, 2, 3, 4, 5].map((y) => (
                    <button
                      key={y}
                      onClick={() => {
                        setYears(y)
                        setCustomWindow(false)
                        setSessions(0)
                      }}
                      className={`min-h-[36px] rounded-md border px-3 text-xs ${!customWindow && years === y ? "border-[#3ddc97] bg-[#3ddc97]/10 text-[#3ddc97]" : "border-white/15 text-[#9aa4b8] hover:text-white"}`}
                    >
                      {y}y
                    </button>
                  ))}
                  <button
                    onClick={() => setCustomWindow(true)}
                    className={`min-h-[36px] rounded-md border px-3 text-xs ${customWindow ? "border-[#7eb6ff] bg-[#7eb6ff]/10 text-[#7eb6ff]" : "border-white/15 text-[#9aa4b8] hover:text-white"}`}
                  >
                    Custom
                  </button>
                </div>
                {customWindow && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">
                      START
                      <input
                        type="date"
                        min={data.dates[0]}
                        max={data.dates.at(-1)}
                        value={data.dates[startIdx] ?? ""}
                        onChange={(e) => {
                          const i = data.dates.indexOf(e.target.value)
                          if (i >= 0) setStartIdx(i)
                        }}
                        className="mt-1 block w-full rounded-md border border-white/15 bg-[#161b22] px-2 py-1.5 text-sm normal-case tracking-normal"
                      />
                    </label>
                    <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">
                      END
                      <input
                        type="date"
                        min={data.dates[startIdx]}
                        max={data.dates.at(-1)}
                        value={data.dates[endIdx] ?? ""}
                        onChange={(e) => {
                          const i = data.dates.indexOf(e.target.value)
                          if (i > startIdx) setEndIdx(i)
                        }}
                        className="mt-1 block w-full rounded-md border border-white/15 bg-[#161b22] px-2 py-1.5 text-sm normal-case tracking-normal"
                      />
                    </label>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">TRADING SESSIONS (auto — override)</label>
                <input
                  type="number"
                  min={10}
                  max={slice ? slice.dates.length : 1300}
                  value={sessions > 0 ? sessions : slice?.dates.length ?? 0}
                  onChange={(e) => setSessions(Math.max(0, Number(e.target.value)))}
                  className="mt-1 block w-full rounded-md border border-white/15 bg-[#161b22] px-3 py-2 text-sm"
                />
                {sessions > 0 && (
                  <button onClick={() => setSessions(0)} className="mt-1 text-[11px] text-[#7eb6ff] underline">
                    reset to auto
                  </button>
                )}
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">
                  DECISION FREQUENCY
                  {strategy === "ema_cross" && <span className="ml-1 normal-case tracking-normal text-[#3ddc97]">(fixed: closing prices — crossover strategy)</span>}
                </label>
                <select value={frequency} disabled={strategy === "ema_cross"} onChange={(e) => setFrequency(e.target.value as FrequencyKey)} className="mt-1 block w-full rounded-md border border-white/15 bg-[#161b22] px-3 py-2 text-sm disabled:opacity-50">
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">MAX ALLOCATION ({maxWeight}%)</label>
                <input type="range" min={2} max={100} value={maxWeight} onChange={(e) => setMaxWeight(Number(e.target.value))} className="h-10 w-full accent-[#3ddc97]" />
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">TRANSACTION COST (%)</label>
                <input type="number" step={0.01} min={0} value={cost} onChange={(e) => setCost(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-white/15 bg-[#161b22] px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">SLIPPAGE (%)</label>
                <input type="number" step={0.01} min={0} value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-white/15 bg-[#161b22] px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">STRATEGY</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {STRATEGIES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setStrategy(s.key)}
                    className={`min-h-[36px] rounded-md border px-3 text-xs ${strategy === s.key ? "border-[#3ddc97] bg-[#3ddc97]/10 text-[#3ddc97]" : "border-white/15 text-[#9aa4b8] hover:text-white"}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {run && analysis && (
            <>
              {/* headline metrics */}
              <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ["TOTAL RETURN", pct(run.summary.totalReturn)],
                  ["CAGR", pct(analysis.span)],
                  ["MAX DRAWDOWN", pct(run.summary.maxDrawdown)],
                  ["WIN RATE", pct(analysis.stats.winRate)],
                  ["PROFIT FACTOR", analysis.stats.profitFactor == null ? "—" : analysis.stats.profitFactor.toFixed(2)],
                  ["EXPECTANCY / TRADE", pct(analysis.stats.expectancy)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-white/10 p-3">
                    <p className="text-[9px] tracking-[0.14em] text-[#9aa4b8]">{label}</p>
                    <p className="mt-1 text-base font-semibold">{value}</p>
                  </div>
                ))}
              </section>

              {/* trade quality */}
              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-white/10 p-4">
                  <h2 className="text-sm font-medium">Trade quality</h2>
                  <dl className="mt-2 space-y-1 text-xs text-[#9aa4b8]">
                    <div className="flex justify-between"><dt>Closed trades</dt><dd className="text-white">{analysis.stats.count} closed · {analysis.stats.open} open</dd></div>
                    <div className="flex justify-between"><dt>Wins / losses</dt><dd className="text-white">{analysis.closed.filter((c) => !c.stillOpen && (c.pnlPct ?? 0) > 0).length}W / {analysis.closed.filter((c) => !c.stillOpen && (c.pnlPct ?? 0) <= 0).length}L</dd></div>
                    <div className="flex justify-between"><dt>Avg win / loss</dt><dd className="text-white">{pct(analysis.stats.avgWin)} / {pct(analysis.stats.avgLoss)}</dd></div>
                    <div className="flex justify-between"><dt>Best / worst trade</dt><dd className="text-white">{pct(analysis.stats.best)} / {pct(analysis.stats.worst)}</dd></div>
                    <div className="flex justify-between"><dt>Avg holding</dt><dd className="text-white">{analysis.stats.avgHolding == null ? "—" : `${analysis.stats.avgHolding.toFixed(1)} sessions`}</dd></div>
                    <div className="flex justify-between"><dt>Buys / sells executed</dt><dd className="text-white">{run.summary.buyCount} / {run.summary.sellCount}</dd></div>
                  </dl>
                </div>

                {/* yearly table */}
                <div className="rounded-lg border border-white/10">
                  <div className="border-b border-white/10 px-4 py-3"><h2 className="text-sm font-medium">Yearly returns</h2></div>
                  <table className="w-full text-xs">
                    <thead className="text-[#9aa4b8]">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Year</th>
                        <th className="px-4 py-2 text-right font-medium">Strategy</th>
                        <th className="px-4 py-2 text-right font-medium">NIFTY 100</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.yearsRows.map((y) => (
                        <tr key={y.year} className="border-t border-white/5">
                          <td className="px-4 py-1.5">{y.year}</td>
                          <td className={`px-4 py-1.5 text-right ${y.strategy >= 0 ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>{pct(y.strategy)}</td>
                          <td className="px-4 py-1.5 text-right">{pct(y.benchmark)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* drawdown chart */}
              <section className="rounded-lg border border-white/10 p-4">
                <h2 className="text-sm font-medium">Drawdown from peak</h2>
                <div className="mt-3 h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={ddChart}>
                      <CartesianGrid stroke="#21262d" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9aa4b8" }} minTickGap={60} />
                      <YAxis tick={{ fontSize: 10, fill: "#9aa4b8" }} tickFormatter={(v: number) => `${v}%`} domain={["auto", 0]} />
                      <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", fontSize: 12 }} formatter={(v) => `${Number(v).toFixed(2)}%`} />
                      <Area type="monotone" dataKey="dd" stroke="#ff6b6b" fill="#ff6b6b33" strokeWidth={1.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* monthly table (scrollable) */}
              <section className="rounded-lg border border-white/10">
                <div className="border-b border-white/10 px-4 py-3"><h2 className="text-sm font-medium">Monthly returns ({analysis.months.length} months)</h2></div>
                <div className="max-h-[300px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#161b22] text-[#9aa4b8]">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Month</th>
                        <th className="px-4 py-2 text-right font-medium">Strategy</th>
                        <th className="px-4 py-2 text-right font-medium">NIFTY 100</th>
                        <th className="px-4 py-2 text-right font-medium">Diff (pp)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.months.map((m) => (
                        <tr key={m.month} className="border-t border-white/5">
                          <td className="px-4 py-1.5">{m.month}</td>
                          <td className={`px-4 py-1.5 text-right ${m.strategy >= 0 ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>{pct(m.strategy)}</td>
                          <td className="px-4 py-1.5 text-right">{pct(m.benchmark)}</td>
                          <td className="px-4 py-1.5 text-right">{m.benchmark == null ? "—" : ((m.strategy - m.benchmark) * 100).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* decision analytics (System One only — rules have no probabilities) */}
              {analysis.decisions && (
                <section className="rounded-lg border border-white/10 p-4">
                  <h2 className="text-sm font-medium">Decision analytics — what happened AFTER each decision</h2>
                  <p className="mt-1 text-[11px] text-[#9aa4b8]">Forward close-to-close returns per horizon. Never available to the model at decision time. Mean chosen-action probability shown per action.</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-4">
                    {(["BUY", "HOLD", "SELL", "NO_ACTION"] as const).map((a) => (
                      <div key={a} className="rounded-md border border-white/10 p-3">
                        <p className="text-[10px] tracking-[0.14em] text-[#9aa4b8]">{a}</p>
                        <p className="mt-1 text-sm font-semibold">{analysis.decisions!.counts[a].toLocaleString("en-IN")} decisions</p>
                        <p className="text-[11px] text-[#9aa4b8]">mean p {analysis.decisions!.meanProb[a] == null ? "—" : (analysis.decisions!.meanProb[a] as number).toFixed(2)}</p>
                        <div className="mt-1 space-y-0.5 text-[11px]">
                          {HORIZONS.map((h) => (
                            <div key={h} className="flex justify-between">
                              <span className="text-[#9aa4b8]">+{h}S</span>
                              <span className={(analysis.decisions!.forward[a][h] ?? 0) >= 0 ? "text-[#3ddc97]" : "text-[#ff6b6b]"}>{pct(analysis.decisions!.forward[a][h])}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* worst trades */}
              <section className="rounded-lg border border-white/10">
                <div className="border-b border-white/10 px-4 py-3"><h2 className="text-sm font-medium">Round trips ({analysis.closed.length}) — 10 worst</h2></div>
                <table className="w-full text-xs">
                  <thead className="text-[#9aa4b8]">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Ticker</th>
                      <th className="px-4 py-2 text-left font-medium">Buy</th>
                      <th className="px-4 py-2 text-left font-medium">Sell</th>
                      <th className="px-4 py-2 text-right font-medium">P&L</th>
                      <th className="px-4 py-2 text-right font-medium">Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...analysis.closed]
                      .filter((c) => !c.stillOpen)
                      .sort((a, b) => (a.pnlPct as number) - (b.pnlPct as number))
                      .slice(0, 10)
                      .map((c, i) => (
                        <tr key={`${c.ticker}-${c.buyDate}-${i}`} className="border-t border-white/5">
                          <td className="px-4 py-1.5 font-medium">{c.ticker}</td>
                          <td className="px-4 py-1.5">{c.buyDate}</td>
                          <td className="px-4 py-1.5">{c.sellDate}</td>
                          <td className="px-4 py-1.5 text-right text-[#ff6b6b]">{pct(c.pnlPct)}</td>
                          <td className="px-4 py-1.5 text-right">{c.holding}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
