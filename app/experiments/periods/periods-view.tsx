"use client"

import { useEffect, useMemo, useState } from "react"
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

type PeriodSummary = {
  id: string
  label: string
  start: string
  end: string
  sessions: number
  summary: {
    momentum: { final: number; totalReturn: number; maxDrawdown: number; trades: number }
    nifty: { final: number; totalReturn: number; maxDrawdown: number }
    random: { final: number; totalReturn: number; maxDrawdown: number }
  }
  monthly: { month: string; momentum: number; nifty: number | null; random: number | null }[]
  holdings: {
    closed: number
    open: number
    avg: number | null
    median: number | null
    max: number | null
    distribution: { bucket: string; count: number }[]
    trades: { ticker: string; buy: string; sell: string; holding: number }[]
  }
}
type Manifest = { periods: PeriodSummary[]; base: string; custom_note: string; survivorship_note: string }
type Equity = { dates: string[]; momentum: number[]; nifty: number[]; random: number[] }

const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(2)}%`)
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`

export function PeriodsView({ manifest }: { manifest: Manifest }) {
  const periods = manifest.periods
  const [selected, setSelected] = useState<string>("5y")
  const [customMode, setCustomMode] = useState(false)
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd] = useState("")
  const [equity, setEquity] = useState<Equity | null>(null)
  const [equityError, setEquityError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/periods/equity-5y.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(`http ${r.status}`)))
      .then(setEquity)
      .catch((e) => setEquityError(String(e)))
  }, [])

  const period = periods.find((p) => p.id === selected) ?? periods[0]

  const customSlice = useMemo(() => {
    if (!equity || !customStart || !customEnd || customStart > customEnd) return null
    const idx = equity.dates.map((d, i) => ({ d, i })).filter(({ d }) => d >= customStart && d <= customEnd)
    if (idx.length < 2) return null
    const slice = (arr: number[]) => idx.map(({ i }) => arr[i])
    const metrics = (arr: number[]) => {
      let peak = arr[0]
      let worst = 0
      for (const v of arr) {
        if (v > peak) peak = v
        worst = Math.min(worst, v / peak - 1)
      }
      return { totalReturn: arr.at(-1)! / arr[0] - 1, maxDrawdown: worst }
    }
    return {
      start: idx[0].d,
      end: idx.at(-1)!.d,
      sessions: idx.length,
      momentum: metrics(slice(equity.momentum)),
      nifty: metrics(slice(equity.nifty)),
      random: metrics(slice(equity.random)),
      chart: idx.map(({ i, d }) => ({ date: d, Momentum: equity.momentum[i], "NIFTY 100": equity.nifty[i], Random: equity.random[i] })),
    }
  }, [equity, customStart, customEnd])

  const chartData = useMemo(() => {
    if (!equity) return []
    if (customMode && customSlice) return customSlice.chart
    const rows = equity.dates.map((d, i) => ({ date: d, Momentum: equity.momentum[i], "NIFTY 100": equity.nifty[i], Random: equity.random[i] }))
    return rows.filter((r) => (!period ? true : r.date >= period.start && r.date <= period.end))
  }, [equity, period, customMode, customSlice])

  const minDate = equity?.dates[0] ?? ""
  const maxDate = equity?.dates.at(-1) ?? ""

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Multi-period results</h1>
        <p className="mt-1 text-xs text-[#9aa4b8]">{manifest.base}</p>
      </div>

      {/* period chips */}
      <div className="flex flex-wrap items-center gap-2">
        {periods.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setSelected(p.id)
              setCustomMode(false)
            }}
            className={`min-h-[40px] rounded-md border px-4 text-sm ${!customMode && selected === p.id ? "border-[#3ddc97] bg-[#3ddc97]/10 text-[#3ddc97]" : "border-white/15 text-[#9aa4b8] hover:text-white"}`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setCustomMode(true)}
          className={`min-h-[40px] rounded-md border px-4 text-sm ${customMode ? "border-[#7eb6ff] bg-[#7eb6ff]/10 text-[#7eb6ff]" : "border-white/15 text-[#9aa4b8] hover:text-white"}`}
        >
          Custom
        </button>
      </div>

      {customMode && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-white/10 p-4">
          <div>
            <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">START</label>
            <input
              type="date"
              value={customStart}
              min={minDate}
              max={maxDate}
              onChange={(e) => setCustomStart(e.target.value)}
              className="mt-1 block rounded-md border border-white/15 bg-[#161b22] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.16em] text-[#9aa4b8]">END</label>
            <input
              type="date"
              value={customEnd}
              min={minDate}
              max={maxDate}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="mt-1 block rounded-md border border-white/15 bg-[#161b22] px-3 py-2 text-sm"
            />
          </div>
          {customSlice ? (
            <p className="text-xs text-[#9aa4b8]">
              {customSlice.start} → {customSlice.end} · {customSlice.sessions} sessions
            </p>
          ) : (
            <p className="text-xs text-[#9aa4b8]">Pick start and end inside {minDate} → {maxDate}.</p>
          )}
        </div>
      )}

      {/* summary cards */}
      {customMode && customSlice ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["Momentum", customSlice.momentum],
              ["NIFTY 100", customSlice.nifty],
              ["Random", customSlice.random],
            ] as const
          ).map(([name, m]) => (
            <div key={name} className="rounded-lg border border-white/10 p-4">
              <p className="text-[10px] tracking-[0.16em] text-[#9aa4b8]">{name.toUpperCase()}</p>
              <p className={`mt-1 text-xl font-semibold ${m.totalReturn >= 0 ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>{pct(m.totalReturn)}</p>
              <p className="mt-1 text-xs text-[#9aa4b8]">max drawdown {pct(m.maxDrawdown)}</p>
            </div>
          ))}
        </div>
      ) : (
        period && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-white/10 p-4">
                <p className="text-[10px] tracking-[0.16em] text-[#9aa4b8]">MOMENTUM · {period.label.toUpperCase()}</p>
                <p className={`mt-1 text-xl font-semibold ${period.summary.momentum.totalReturn >= 0 ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>{pct(period.summary.momentum.totalReturn)}</p>
                <p className="mt-1 text-xs text-[#9aa4b8]">
                  {inr(period.summary.momentum.final)} · max dd {pct(period.summary.momentum.maxDrawdown)} · {period.summary.momentum.trades} buys
                </p>
              </div>
              <div className="rounded-lg border border-white/10 p-4">
                <p className="text-[10px] tracking-[0.16em] text-[#9aa4b8]">NIFTY 100 · {period.label.toUpperCase()}</p>
                <p className={`mt-1 text-xl font-semibold ${period.summary.nifty.totalReturn >= 0 ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>{pct(period.summary.nifty.totalReturn)}</p>
                <p className="mt-1 text-xs text-[#9aa4b8]">
                  {inr(period.summary.nifty.final)} · max dd {pct(period.summary.nifty.maxDrawdown)}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 p-4">
                <p className="text-[10px] tracking-[0.16em] text-[#9aa4b8]">RANDOM · {period.label.toUpperCase()}</p>
                <p className={`mt-1 text-xl font-semibold ${period.summary.random.totalReturn >= 0 ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>{pct(period.summary.random.totalReturn)}</p>
                <p className="mt-1 text-xs text-[#9aa4b8]">
                  {inr(period.summary.random.final)} · max dd {pct(period.summary.random.maxDrawdown)}
                </p>
              </div>
            </div>

            {/* monthly table */}
            <div className="rounded-lg border border-white/10">
              <div className="border-b border-white/10 px-4 py-3">
                <h2 className="text-sm font-medium">Monthly returns — {period.label}</h2>
              </div>
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#161b22] text-[#9aa4b8]">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Month</th>
                      <th className="px-4 py-2 text-right font-medium">Momentum</th>
                      <th className="px-4 py-2 text-right font-medium">NIFTY 100</th>
                      <th className="px-4 py-2 text-right font-medium">Random</th>
                    </tr>
                  </thead>
                  <tbody>
                    {period.monthly.map((m) => (
                      <tr key={m.month} className="border-t border-white/5">
                        <td className="px-4 py-1.5">{m.month}</td>
                        <td className={`px-4 py-1.5 text-right ${m.momentum >= 0 ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>{pct(m.momentum)}</td>
                        <td className="px-4 py-1.5 text-right">{pct(m.nifty)}</td>
                        <td className="px-4 py-1.5 text-right text-[#ff6b6b]">{pct(m.random)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* holdings */}
            <div className="rounded-lg border border-white/10 p-4">
              <h2 className="text-sm font-medium">Trade holding periods — {period.label}</h2>
              <p className="mt-1 text-xs text-[#9aa4b8]">
                {period.holdings.closed} closed · {period.holdings.open} open · avg {period.holdings.avg ?? "—"} sessions · median {period.holdings.median ?? "—"} · max {period.holdings.max ?? "—"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {period.holdings.distribution.map((d) => (
                  <span key={d.bucket} className="rounded-md border border-white/10 px-3 py-1 text-xs text-[#9aa4b8]">
                    {d.bucket} sessions: <span className="text-white">{d.count}</span>
                  </span>
                ))}
              </div>
            </div>
          </>
        )
      )}

      {/* equity chart */}
      <div className="rounded-lg border border-white/10 p-4">
        <h2 className="text-sm font-medium">Equity curve (₹10,00,000 base)</h2>
        {equityError && <p className="mt-2 text-xs text-[#ff6b6b]">Failed to load equity data: {equityError}</p>}
        {!equity && !equityError && <p className="mt-2 text-xs text-[#9aa4b8]">Loading…</p>}
        {equity && chartData.length > 0 && (
          <div className="mt-3 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="#21262d" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9aa4b8" }} minTickGap={60} />
                <YAxis tick={{ fontSize: 10, fill: "#9aa4b8" }} tickFormatter={(v: number) => `${(v / 100000).toFixed(0)}L`} />
                <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", fontSize: 12 }} formatter={(v) => inr(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Momentum" stroke="#3ddc97" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="NIFTY 100" stroke="#7eb6ff" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="Random" stroke="#e4c36a" dot={false} strokeWidth={1} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-[#9aa4b8]">{manifest.custom_note}</p>
      <p className="text-[11px] leading-relaxed text-[#9aa4b8]">{manifest.survivorship_note}</p>
    </div>
  )
}
