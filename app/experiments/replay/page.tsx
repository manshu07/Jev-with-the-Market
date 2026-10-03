import type { Metadata } from "next"
import { ReplayView } from "./replay-view"
import { loadReplayDataset } from "@/src/replay/load"

export const metadata: Metadata = {
  title: "System One Investment Lab — Historical Replay",
  description: "Historical replay of the System One investment experiment. No live decisions.",
}

export const dynamic = "force-dynamic"

export default async function ReplayPage() {
  const dataset = await loadReplayDataset()
  return <ReplayView dataset={dataset} />
}
