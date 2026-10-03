import { NextResponse } from "next/server"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { runChecks, type ClientSummary, type ServerAudit } from "@/src/studio/server-audit"
import type { StudioConfig, StudioPrices } from "@/src/studio/engine"

export const dynamic = "force-dynamic"

type AuditRequest = {
  config: {
    strategy: StudioConfig["strategy"]
    frequency: StudioConfig["frequency"]
    sessions: number
    maxWeight: number
    cost: number
    slippage: number
    maxPositions: number
    seed?: number
  }
  window: { start: string; end: string; sessions: number }
  clientSummary: ClientSummary
}

let cache: { data: StudioPrices & { benchmark?: (number | null)[] }; at: number } | null = null

function loadDataset(): StudioPrices {
  // tiny in-process cache; the dataset only changes when a refresh deploy happens
  if (cache && Date.now() - cache.at < 60_000) return cache.data
  const d = JSON.parse(readFileSync(resolve(process.cwd(), "public/studio/data.json"), "utf8"))
  const data = {
    dates: d.dates,
    tickers: d.tickers,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    ready: d.ready,
    r20: d.r20,
    ema: d.ema,
    benchmark: d.benchmark,
    decisions: d.decisions,
  } as StudioPrices
  cache = { data, at: Date.now() }
  return data
}

export async function POST(request: Request) {
  let body: AuditRequest
  try {
    body = (await request.json()) as AuditRequest
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  const { config, window, clientSummary } = body ?? ({} as AuditRequest)
  if (!config || !window || !clientSummary) {
    return NextResponse.json({ error: "config, window and clientSummary are required" }, { status: 400 })
  }

  const data = loadDataset()
  const startIdx = data.dates.findIndex((d) => d >= window.start)
  let endIdx = data.dates.findIndex((d) => d >= window.end)
  if (endIdx < 0) endIdx = data.dates.length - 1
  if (startIdx < 0 || startIdx > endIdx) {
    return NextResponse.json({ error: `window ${window.start}..${window.end} outside dataset ${data.dates[0]}..${data.dates.at(-1)}` }, { status: 400 })
  }
  const count = Math.min(config.sessions > 0 ? config.sessions : endIdx - startIdx + 1, endIdx - startIdx + 1)
  const cut = <T,>(g: T[][]) => g.slice(startIdx, startIdx + count)
  const slice = {
    dates: data.dates.slice(startIdx, startIdx + count),
    tickers: data.tickers,
    open: cut(data.open as number[][]),
    high: cut(data.high as number[][]),
    low: cut(data.low as number[][]),
    close: cut(data.close as number[][]),
    ready: data.ready.slice(startIdx, startIdx + count),
    r20: cut(data.r20),
    ema: { "262": cut(data.ema["262"]), "365": cut(data.ema["365"]) },
    benchmark: (data as typeof data & { benchmark?: (number | null)[] }).benchmark?.slice(startIdx, startIdx + count),
    decisions: Object.fromEntries(Object.entries(data.decisions).filter(([d]) => d >= data.dates[startIdx] && d <= data.dates[Math.min(data.dates.length - 1, startIdx + count - 1)])),
  } as StudioPrices

  const serverConfig: StudioConfig = {
    strategy: config.strategy,
    frequency: config.frequency,
    sessions: count,
    maxWeight: config.maxWeight,
    cost: config.cost,
    slippage: config.slippage,
    maxPositions: config.maxPositions,
    seed: config.seed ?? 20260922,
  }

  const audit: ServerAudit = runChecks(slice, serverConfig, clientSummary)
  return NextResponse.json(audit)
}
