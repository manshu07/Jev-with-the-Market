import type { Metadata } from "next"
import { ExperimentNav } from "@/src/experiments/nav"
import { WatchlistsView } from "./watchlists-view"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export const metadata: Metadata = {
  title: "EMA 262/365 Watchlists — System One Investment Lab",
  description: "Daily NIFTY 100 watchlists: price vs EMA-262, price vs EMA-365, cross events, and the momentum top-5.",
}

export const dynamic = "force-dynamic"

export default function WatchlistsPage() {
  const data = JSON.parse(readFileSync(resolve(process.cwd(), "public/watchlists/watchlists.json"), "utf8"))
  return (
    <div className="flex min-h-screen flex-col bg-[#0d1117] text-[#e6edf3]">
      <ExperimentNav active="watchlists" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
        <WatchlistsView data={data} />
      </main>
    </div>
  )
}
