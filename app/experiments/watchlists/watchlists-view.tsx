"use client"

import { useMemo, useState } from "react"

type EmaStat = { close: number; ema: number; dist: number }
type WatchlistData = {
  generatedAt: string
  warmup_note: string
  dates: string[]
  lists: { ema262: Record<string, string>; ema365: Record<string, string>; momentum: Record<string, string> }
  latest: { date: string; e262: Record<string, EmaStat>; e365: Record<string, EmaStat>; mom: string[] }
}
type ListKey = "ema262" | "ema365" | "momentum"

const LIST_META: Record<ListKey, { title: string; rule: string; color: string }> = {
  ema262: { title: "EMA-262 watchlist", rule: "Close above the 262-session EMA (~1 trading year)", color: "#3ddc97" },
  ema365: { title: "EMA-365 watchlist", rule: "Close above the 365-session EMA (~1.45 trading years)", color: "#7eb6ff" },
  momentum: { title: "Momentum top-5", rule: "The strategy's own daily watchlist — top 5 by 20-day return among decision-ready names", color: "#e4c36a" },
}

export function WatchlistsView({ data }: { data: WatchlistData }) {
  const [list, setList] = useState<ListKey>("ema262")
  const [dateIdx, setDateIdx] = useState(data.dates.length - 1)
  const [showEvents, setShowEvents] = useState(false)

  const tickers = useMemo(() => Object.keys(data.lists.ema262).sort(), [data])
  const date = data.dates[dateIdx]

  const members = useMemo(() => {
    const out: string[] = []
    for (const t of tickers) if (data.lists[list][t]?.[dateIdx] === "1") out.push(t)
    return out.sort()
  }, [tickers, data, list, dateIdx])

  const events = useMemo(() => {
    // cross events within the trailing 60 sessions around the selected date
    const from = Math.max(1, dateIdx - 60)
    const out: { ticker: string; date: string; dir: "entered" | "exited" }[] = []
    for (const t of tickers) {
      const bits = data.lists[list][t] ?? ""
      for (let i = from; i <= dateIdx; i += 1) {
        if (bits[i] !== bits[i - 1]) out.push({ ticker: t, date: data.dates[i], dir: bits[i] === "1" ? "entered" : "exited" })
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80)
  }, [tickers, data, list, dateIdx])

  const statsFor = (t: string) => (list === "ema262" ? data.latest.e262[t] : list === "ema365" ? data.latest.e365[t] : undefined)
  const isLatest = dateIdx === data.dates.length - 1
  const meta = LIST_META[list]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Watchlists</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[#9aa4b8]">{data.warmup_note}</p>
      </div>

      {/* list selector */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(LIST_META) as ListKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setList(key)}
            className={`min-h-[40px] rounded-md border px-4 text-sm ${list === key ? "border-white/40 bg-white/10 text-white" : "border-white/15 text-[#9aa4b8] hover:text-white"}`}
          >
            {LIST_META[key].title}
          </button>
        ))}
        <button
          onClick={() => setShowEvents((v) => !v)}
          className={`min-h-[40px] rounded-md border px-4 text-sm ${showEvents ? "border-[#e4c36a] bg-[#e4c36a]/10 text-[#e4c36a]" : "border-white/15 text-[#9aa4b8] hover:text-white"}`}
        >
          Cross events
        </button>
      </div>

      {/* date picker */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 p-4">
        <label className="text-[10px] tracking-[0.16em] text-[#9aa4b8]" htmlFor="wl-date">
          SESSION
        </label>
        <input
          id="wl-date"
          type="date"
          value={date}
          min={data.dates[0]}
          max={data.dates.at(-1)}
          onChange={(e) => {
            const idx = data.dates.indexOf(e.target.value)
            if (idx >= 0) setDateIdx(idx)
          }}
          className="rounded-md border border-white/15 bg-[#161b22] px-3 py-2 text-sm"
        />
        <input
          type="range"
          min={0}
          max={data.dates.length - 1}
          value={dateIdx}
          onChange={(e) => setDateIdx(Number(e.target.value))}
          className="h-10 flex-1 accent-[#3ddc97]"
          aria-label="Timeline scrubber"
        />
        <span className="text-xs text-[#9aa4b8]">
          {date} · {members.length} names {isLatest ? "(latest)" : ""}
        </span>
      </div>

      <p className="text-xs text-[#9aa4b8]">
        <span style={{ color: meta.color }}>●</span> {meta.rule}
      </p>

      {showEvents ? (
        <div className="rounded-lg border border-white/10">
          <div className="border-b border-white/10 px-4 py-3">
            <h2 className="text-sm font-medium">Cross events — trailing 60 sessions to {date} ({list === "momentum" ? "membership changes" : "EMA crosses"})</h2>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#161b22] text-[#9aa4b8]">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Ticker</th>
                  <th className="px-4 py-2 text-left font-medium">Event</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={`${e.ticker}-${e.date}-${i}`} className="border-t border-white/5">
                    <td className="px-4 py-1.5">{e.date}</td>
                    <td className="px-4 py-1.5 font-medium">{e.ticker}</td>
                    <td className={`px-4 py-1.5 ${e.dir === "entered" ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>{e.dir === "entered" ? "▲ entered" : "▼ exited"}</td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td className="px-4 py-3 text-[#9aa4b8]" colSpan={3}>
                      No cross events in this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-white/10">
          <div className="border-b border-white/10 px-4 py-3">
            <h2 className="text-sm font-medium">
              {meta.title} — {members.length} names on {date}
            </h2>
          </div>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#161b22] text-[#9aa4b8]">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">#</th>
                  <th className="px-4 py-2 text-left font-medium">Ticker</th>
                  {list !== "momentum" && <th className="px-4 py-2 text-right font-medium">Close</th>}
                  {list !== "momentum" && <th className="px-4 py-2 text-right font-medium">EMA</th>}
                  {list !== "momentum" && <th className="px-4 py-2 text-right font-medium">Distance</th>}
                  {list !== "momentum" && <th className="px-4 py-2 text-right font-medium">Days on list</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((t, i) => {
                  const stat = isLatest ? statsFor(t) : undefined
                  // days on list: count trailing 1s ending at dateIdx
                  const bits = data.lists[list][t] ?? ""
                  let days = 0
                  for (let k = dateIdx; k >= 0 && bits[k] === "1"; k -= 1) days += 1
                  return (
                    <tr key={t} className="border-t border-white/5">
                      <td className="px-4 py-1.5 text-[#9aa4b8]">{i + 1}</td>
                      <td className="px-4 py-1.5 font-medium">{t}</td>
                      {list !== "momentum" && <td className="px-4 py-1.5 text-right">{stat ? stat.close : "—"}</td>}
                      {list !== "momentum" && <td className="px-4 py-1.5 text-right">{stat ? stat.ema : "—"}</td>}
                      {list !== "momentum" && (
                        <td className={`px-4 py-1.5 text-right ${stat && stat.dist >= 0 ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>{stat ? `${stat.dist}%` : "—"}</td>
                      )}
                      {list !== "momentum" && <td className="px-4 py-1.5 text-right">{days}</td>}
                    </tr>
                  )
                })}
                {members.length === 0 && (
                  <tr>
                    <td className="px-4 py-3 text-[#9aa4b8]" colSpan={6}>
                      No names on this list for the selected session.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!isLatest && list !== "momentum" && (
            <p className="border-t border-white/5 px-4 py-2 text-[11px] text-[#9aa4b8]">Close/EMA/distance columns are available for the latest session — historical sessions show membership only.</p>
          )}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-[#9aa4b8]">
        Watchlists are descriptive trend filters, not trade signals. EMA values warm up from the first 262/365 sessions of cached history (2020-05 onward). Experimental data — not investment advice.
      </p>
    </div>
  )
}
