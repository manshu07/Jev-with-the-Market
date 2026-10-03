"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { runStudio, studioBenchmark, frequencyLabel, type StudioConfig, type StudioPrices, type StrategyKey, type FrequencyKey } from "@/src/studio/engine"

const pct = (x: number) => `${(x * 100).toFixed(2)}%`
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`

const STRATEGIES: { key: StrategyKey; label: string }[] = [
  { key: "momentum", label: "Momentum (top-5 by 20d return)" },
  { key: "ema262", label: "EMA-262 watchlist" },
  { key: "ema365", label: "EMA-365 watchlist" },
  { key: "both_ema", label: "Both EMAs (262 ∧ 365)" },
  { key: "systemone", label: "System One (recorded decisions)" },
]

const FREQUENCIES: FrequencyKey[] = ["close", "crossover", "session", "low", "high", "open"]

type Data = StudioPrices & { warmup: string; benchmark: (number | null)[] }

export function StudioView() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  // config state
  const [years, setYears] = useState(5)
  const [customWindow, setCustomWindow] = useState(false)
  const [startIdx, setStartIdx] = useState(0)
  const [endIdx, setEndIdx] = useState(0)
  const [sessions, setSessions] = useState(0) // 0 = auto from period
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

  // window bounds are DATE-derived (calendar years back from the latest session),
  // never a hardcoded sessions-per-year constant
  const dateBounds = useMemo(() => {
    if (!data) return null
    const last = data.dates[data.dates.length - 1]
    const boundsFor = (years: number) => {
      const d = new Date(last)
      d.setFullYear(d.getFullYear() - years)
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
    // sessions override caps the window in EVERY mode (auto = full window)
    const count = sessions > 0 ? Math.min(sessions, available) : available
    const take = <T,>(g: T[][]) => g.slice(start, start + count)
    const ema = (arr: (number | null)[][]) => arr.slice(start, start + count)
    return {
      dates: data.dates.slice(start, start + count),
      tickers: data.tickers,
      open: take(data.open as number[][]),
      high: take(data.high as number[][]),
      low: take(data.low as number[][]),
      close: take(data.close as number[][]),
      ready: data.ready.slice(start, start + count),
      r20: ema(data.r20),
      ema: { "262": ema(data.ema["262"]), "365": ema(data.ema["365"]) },
      benchmark: data.benchmark.slice(start, start + count),
      decisions: Object.fromEntries(Object.entries(data.decisions).filter(([d]) => d >= data.dates[start] && d <= data.dates[Math.min(data.dates.length - 1, start + count - 1)])),
    } as StudioPrices
  }, [data, years, customWindow, startIdx, endIdx, sessions, dateBounds])

  const result = useMemo(() => {
    if (!slice) return null
    return runStudio(slice, {
      strategy,
      frequency,
      sessions: slice.dates.length,
      maxWeight: maxWeight / 100,
      cost: cost / 100,
      slippage: slippage / 100,
      maxPositions,
      seed: 20260922,
    })
  }, [slice, strategy, frequency, maxWeight, cost, slippage, maxPositions])

  const bench = useMemo(() => {
    if (!slice) return null
    return studioBenchmark(slice, slice.dates.length)
  }, [slice])

  const chartData = useMemo(() => {
    if (!result || !bench) return []
    const step = Math.max(1, Math.floor(result.equity.length / 500))
    const rows: { date: string; Strategy: number; "NIFTY 100": number }[] = []
    for (let i = 0; i < result.equity.length; i += step) {
      rows.push({ date: result.equity[i].date, Strategy: result.equity[i].value, "NIFTY 100": bench.values[i] })
    }
    const lastIdx = result.equity.length - 1
    if (lastIdx >= 0 && rows.at(-1)?.date !== result.equity[lastIdx].date) {
      rows.push({ date: result.equity[lastIdx].date, Strategy: result.equity[lastIdx].value, "NIFTY 100": bench.values[lastIdx] })
    }
    return rows
  }, [result, bench])

  const onSessionsChange = useCallback((v: number) => setSessions(v), [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Experiment Studio</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[#9aa4b8]">
          {data?.warmup ?? "Loading dataset…"} Decisions execute at the next session open. Runs entirely in your browser on the cached dataset — nothing is sent anywhere.
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
      {!data && !error && <p className="text-sm text-[#9aa4b8]">Loading price grid, EMAs and recorded decisions…</p>}

      {data && (
        <>
          {/* ---- EXPERIMENT SCOPE ---- */}
          <section className="rounded-lg border border-white/10 p-4">
            <h2 className="text-sm font-medium">Experiment scope</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* PERIOD */}
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
                  <div className="mt-2 space-y-2">
                    <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">
                      START DATE
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
                      END DATE
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

              {/* TRADING SESSIONS */}
              <div>
                <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">
                  TRADING SESSIONS <span className="normal-case tracking-normal">(auto from period — override below)</span>
                </label>
                <input
                  type="number"
                  min={10}
                  max={slice ? slice.dates.length : 1300}
                  value={sessions > 0 ? sessions : slice?.dates.length ?? 0}
                  onChange={(e) => onSessionsChange(Math.max(0, Number(e.target.value)))}
                  className="mt-1 block w-full rounded-md border border-white/15 bg-[#161b22] px-3 py-2 text-sm"
                />
                {customWindow && sessions === 0 && <p className="mt-1 text-[11px] text-[#9aa4b8]">Runs to the latest session. Set a number to cap the window.</p>}
                {sessions > 0 && (
                  <button onClick={() => onSessionsChange(0)} className="mt-1 text-[11px] text-[#7eb6ff] underline">
                    reset to auto
                  </button>
                )}
              </div>

              {/* DECISION FREQUENCY */}
              <div>
                <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">DECISION FREQUENCY</label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as FrequencyKey)}
                  className="mt-1 block w-full rounded-md border border-white/15 bg-[#161b22] px-3 py-2 text-sm"
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {frequencyLabel(f)}
                    </option>
                  ))}
                </select>
              </div>

              {/* MAX INITIAL POSITION ALLOCATION */}
              <div>
                <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">
                  MAX INITIAL POSITION ALLOCATION <span className="normal-case tracking-normal">(default 20%)</span>
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input type="range" min={2} max={100} step={1} value={maxWeight} onChange={(e) => setMaxWeight(Number(e.target.value))} className="h-10 flex-1 accent-[#3ddc97]" />
                  <span className="w-14 text-right text-sm">{maxWeight}%</span>
                </div>
              </div>

              {/* TRANSACTION COST */}
              <div>
                <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">TRANSACTION COST (%)</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={5}
                  value={cost}
                  onChange={(e) => setCost(Number(e.target.value))}
                  className="mt-1 block w-full rounded-md border border-white/15 bg-[#161b22] px-3 py-2 text-sm"
                />
              </div>

              {/* SLIPPAGE */}
              <div>
                <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">SLIPPAGE (%)</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={5}
                  value={slippage}
                  onChange={(e) => setSlippage(Number(e.target.value))}
                  className="mt-1 block w-full rounded-md border border-white/15 bg-[#161b22] px-3 py-2 text-sm"
                />
              </div>
            </div>

            {/* strategy */}
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

          {/* ---- RESULTS ---- */}
          {result && (
            <>
              <section className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-white/10 p-4">
                  <p className="text-[10px] tracking-[0.16em] text-[#9aa4b8]">FINAL VALUE</p>
                  <p className={`mt-1 text-xl font-semibold ${result.summary.totalReturn >= 0 ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>{inr(result.summary.finalValue)}</p>
                  <p className="text-xs text-[#9aa4b8]">{pct(result.summary.totalReturn)} total</p>
                </div>
                <div className="rounded-lg border border-white/10 p-4">
                  <p className="text-[10px] tracking-[0.16em] text-[#9aa4b8]">MAX DRAWDOWN</p>
                  <p className="mt-1 text-xl font-semibold text-[#ff6b6b]">{pct(result.summary.maxDrawdown)}</p>
                  <p className="text-xs text-[#9aa4b8]">{result.days.length} sessions</p>
                </div>
                <div className="rounded-lg border border-white/10 p-4">
                  <p className="text-[10px] tracking-[0.16em] text-[#9aa4b8]">TRADES</p>
                  <p className="mt-1 text-xl font-semibold">{result.summary.buyCount} buys · {result.summary.sellCount} sells</p>
                  <p className="text-xs text-[#9aa4b8]">avg holding {result.summary.avgHolding == null ? "—" : `${result.summary.avgHolding.toFixed(1)} sessions`}</p>
                </div>
                <div className="rounded-lg border border-white/10 p-4">
                  <p className="text-[10px] tracking-[0.16em] text-[#9aa4b8]">NIFTY 100 SAME WINDOW</p>
                  <p className={`mt-1 text-xl font-semibold ${bench && bench.values.at(-1)! >= 1_000_000 ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>{bench ? pct(bench.values.at(-1)! / 1_000_000 - 1) : "—"}</p>
                  <p className="text-xs text-[#9aa4b8]">buy-and-hold · {bench?.source === "index" ? "index" : "equal-weight basket"}</p>
                </div>
              </section>

              <section className="rounded-lg border border-white/10 p-4">
                <h2 className="text-sm font-medium">Equity curve (₹10,00,000 base)</h2>
                <div className="mt-3 h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid stroke="#21262d" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9aa4b8" }} minTickGap={60} />
                      <YAxis tick={{ fontSize: 10, fill: "#9aa4b8" }} tickFormatter={(v: number) => `${(v / 100000).toFixed(1)}L`} domain={["auto", "auto"]} />
                      <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", fontSize: 12 }} formatter={(v) => inr(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="Strategy" stroke="#3ddc97" dot={false} strokeWidth={1.5} />
                      <Line type="monotone" dataKey="NIFTY 100" stroke="#7eb6ff" dot={false} strokeWidth={1.2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="rounded-lg border border-white/10">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <h2 className="text-sm font-medium">Trade ledger ({result.trades.length})</h2>
                  <p className="text-[11px] text-[#9aa4b8]">decision → next-open execution · cost {(result.config.cost * 100).toFixed(2)}% · slippage {(result.config.slippage * 100).toFixed(2)}%</p>
                </div>
                <div className="max-h-[360px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#161b22] text-[#9aa4b8]">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Decision</th>
                        <th className="px-4 py-2 text-left font-medium">Executed</th>
                        <th className="px-4 py-2 text-left font-medium">Ticker</th>
                        <th className="px-4 py-2 text-left font-medium">Side</th>
                        <th className="px-4 py-2 text-right font-medium">Shares</th>
                        <th className="px-4 py-2 text-right font-medium">Exec price</th>
                        <th className="px-4 py-2 text-right font-medium">Cost ₹</th>
                        <th className="px-4 py-2 text-right font-medium">Cash after</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice(-200).map((t, i) => (
                        <tr key={`${t.ticker}-${t.date}-${i}`} className="border-t border-white/5">
                          <td className="px-4 py-1.5">{t.decisionDate}</td>
                          <td className="px-4 py-1.5">{t.date}</td>
                          <td className="px-4 py-1.5 font-medium">{t.ticker}</td>
                          <td className={`px-4 py-1.5 ${t.action === "BUY" ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>{t.action}</td>
                          <td className="px-4 py-1.5 text-right">{t.shares}</td>
                          <td className="px-4 py-1.5 text-right">{t.executionPrice.toFixed(2)}</td>
                          <td className="px-4 py-1.5 text-right">{Math.round(t.cost)}</td>
                          <td className="px-4 py-1.5 text-right">{inr(t.cashAfter)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
