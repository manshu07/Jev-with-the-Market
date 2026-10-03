import type { Metadata } from "next"
import { ExperimentNav } from "@/src/experiments/nav"
import { PeriodsView } from "./periods-view"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export const metadata: Metadata = {
  title: "Multi-Period Results — System One Investment Lab",
  description: "Momentum vs NIFTY 100 vs Random over 1/2/3/4/5-year windows, plus custom date ranges.",
}

export const dynamic = "force-dynamic"

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

export default function PeriodsPage() {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "public/periods/manifest.json"), "utf8"))
  return (
    <div className="flex min-h-screen flex-col bg-[#0d1117] text-[#e6edf3]">
      <ExperimentNav active="periods" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
        <PeriodsView manifest={manifest as { periods: PeriodSummary[]; base: string; custom_note: string; survivorship_note: string }} />
      </main>
    </div>
  )
}
