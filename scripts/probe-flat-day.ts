/**
 * Probe: is the 2025-03-18 flat-zero print a long-request artifact?
 * 1) Short-window Yahoo re-fetch for RELIANCE.NS around 2025-03-18
 * 2) If still flat, NSE bhavcopy for that date
 * Read-only probe — writes nothing.
 */
import YahooFinance from "yahoo-finance2"

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] })

async function yahooShort() {
  const chart = await yf.chart("RELIANCE.NS", {
    period1: "2025-03-10",
    period2: "2025-03-25",
    interval: "1d",
    return: "array",
  })
  console.log("=== Yahoo short window (RELIANCE.NS 2025-03-10..25) ===")
  for (const q of chart.quotes ?? []) {
    const d = new Date(q.date).toISOString().slice(0, 10)
    console.log(d, "open", q.open, "close", q.close, "vol", q.volume)
  }
}

async function nseBhavcopy() {
  const url = "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_18032025.csv"
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/csv,*/*",
        Referer: "https://www.nseindia.com/",
      },
    })
    console.log("\n=== NSE bhavcopy 2025-03-18 ===", res.status, res.headers.get("content-type"))
    if (res.ok) {
      const text = await res.text()
      const lines = text.split("\n").filter((l) => l.includes("RELIANCE") || l.includes("SYMBOL"))
      console.log(lines.slice(0, 4).join("\n"))
    }
  } catch (error) {
    console.log("NSE fetch failed:", error instanceof Error ? error.message : error)
  }
}

async function main() {
  await yahooShort()
  await nseBhavcopy()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
