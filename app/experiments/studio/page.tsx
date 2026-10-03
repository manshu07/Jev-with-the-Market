import type { Metadata } from "next"
import { ExperimentNav } from "@/src/experiments/nav"
import { StudioView } from "./studio-view"

export const metadata: Metadata = {
  title: "Experiment Studio — System One Investment Lab",
  description: "Configure period, sessions, decision frequency, allocation, costs and slippage — results computed on the real cached NIFTY 100 data.",
}

export const dynamic = "force-dynamic"

export default function StudioPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#0d1117] text-[#e6edf3]">
      <ExperimentNav active="studio" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
        <StudioView />
      </main>
    </div>
  )
}
