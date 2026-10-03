import type { Metadata } from "next"
import { ExperimentNav } from "@/src/experiments/nav"
import { AnalysisView } from "./analysis-view"

export const metadata: Metadata = {
  title: "Analysis Workbench — System One Investment Lab",
  description: "Customisable deep analytics: win rate, profit factor, yearly/monthly returns, drawdowns, decision forward-returns — on any window, any settings.",
}

export const dynamic = "force-dynamic"

export default function AnalysisPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#0d1117] text-[#e6edf3]">
      <ExperimentNav active="analysis" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
        <AnalysisView />
      </main>
    </div>
  )
}
