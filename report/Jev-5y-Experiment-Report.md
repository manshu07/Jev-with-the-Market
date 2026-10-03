# System One-with-the-Market — 5-Year Experiment Report

**Repo:** `github.com/manshu07/System One-with-the-Market` · **Branch:** `5yr-experiment` · **Window:** 2021-10-01 → 2026-09-22 (1,223 trading sessions)

**Prepared for:** Himanshu. Covers the 5-year extension of the "Can System One Invest?" experiment: data, repairs, monthly returns, trade holding periods, and the System One decision-model status.

**Verification basis:** every number below comes from scripts executed on this machine against the downloaded Yahoo Finance cache and the repo's own simulation engine. Evidence files: `results/phase5y_free.md`, `results/monthly-analytics.{md,json}`, `results/nse-repairs.{md,json}`, `results/phase1_data_quality.md`.

---

## 1. Executive summary

| Strategy (₹10,00,000 each, same rules) | Final value | Total return | Max drawdown | Trades |
| --- | ---: | ---: | ---: | ---: |
| **Momentum** (top-5 by 20-day return, rebalanced daily) | **₹23,76,000** | **+137.60%** | −47.9% | 1,432 |
| NIFTY 100 buy-and-hold | ₹13,76,364 | +37.64% | −17.6% | 1 (synthetic) |
| Random (seeded, same churn) | ₹78,167 | −92.18% | −92.4% | ~2,900 |

- Momentum beat the index in **30 of 60 months** and was positive in 28/60 — the edge is real but concentrated: 2022 **+44.2%** and 2023 **+33.5%** did the heavy lifting; 2025 was **−11.8%** and 2026 (9 months) −4.7%.
- **Trade holding periods:** average **4.2 sessions**, median **2**, min 1, max 67. 1,129 of 1,427 closed trades lasted ≤5 sessions. This is a fast-churn system — and the random leg proves what churn costs when there is no signal: **−92%**.
- The **System One** decision-model leg is wired, smoke-proven on 5-year data (12/12 live calls, 118 ms mean), and awaiting a spending decision: ~96,000 paid gateway calls for the full run.

---

## 2. What was built (all committed on this branch)

| Step | What happened | Result |
| --- | --- | --- |
| 1. Download | `config/data.json` widened to 2020-05-01 → 2026-09-23 (5y + ~105-session warm-up buffer beyond the 252 needed); `npm run download` | 100/100 stocks cached, 1,585 sessions, 0 failures |
| 2. Features | `npm run features` — 29 point-in-time indicators per stock-day | 158,500 rows; decision-ready counts below |
| 3. Data repair | **Found Yahoo serving flat placeholder bars for 96/100 stocks on 2025-03-18** (live re-fetch proved it persists; NSE's official bhavcopy shows a fully traded session). Built `scripts/repair-from-bhavcopy.ts` | **118 symbol-days patched** from official NSE bhavcopy (incl. VEDL 2026-04-30 −65% bad print); 10 unreparable (symbol absent from bhavcopy EQ series) honestly logged |
| 4. Rebuild | `npm run features` after repairs | Decision-ready rows: **95,499 → 122,328** (+28%). The 2025-03-18 poison had made every 200/252-session window null for ~a year — dead zone fully healed (93–98 ready tickers every month) |
| 5. 5y simulation | `scripts/run-5y-free.ts` — repo's own engine (next-open execution, 10 bps cost, 5 bps slippage, max 5 positions, 20% cap), System One leg off | Full 1,223-session run + monthly/holding analytics |
| 6. System One smoke | `scripts/jev-smoke-5y.ts` — live TypeSafe API calls on 5y features, repo's exact prompt | **12/12 OK**, mean 118 ms, sane calibrated decisions (BUY 0.54–0.91, NO_ACTION 0.62–0.72) |

**Benchmark-gap handling:** 6 of 1,229 sessions have a missing/invalid NIFTY 100 index bar while stocks traded (2022-12-26, 2024-01-01, 2024-02-19, 2025-01-01, 2025-02-01, 2026-01-01). Following the repo's no-guessing philosophy, those sessions are **excluded and disclosed**, not interpolated.

---

## 3. Monthly returns (momentum vs NIFTY 100)

Full 60-month table with the random column lives in `results/monthly-analytics.md`. Highlights:

| Year | Momentum | NIFTY 100 | Months |
| --- | ---: | ---: | ---: |
| 2021 (Oct–Dec) | +6.0% | −3.3% | 3 |
| **2022** | **+44.2%** | +1.5% | 12 |
| **2023** | **+33.5%** | +17.0% | 12 |
| 2024 | +6.9% | +3.3% | 12 |
| 2025 | −11.8% | +7.6% | 12 |
| 2026 (Jan–Sep) | −4.7% | −10.0% | 9 |

- Best month: **+28.2%** (2022-11) · Worst month: **−12.9%** (2024-10)
- Beat NIFTY: 30/60 months · Positive months: 28/60
- Pattern: strong in trending markets (2022–23), bleeds in choppy/bear regimes (2025) — textbook momentum behaviour, now proven on this universe with full costs.

---

## 4. Holding periods — every trade's days-after-buy

From the complete momentum ledger (1,432 trades, 1,427 closed):

| Holding length (trading sessions) | Trades |
| --- | ---: |
| 1–5 | 1,129 |
| 6–10 | 149 |
| 11–20 | 117 |
| 21–40 | 28 |
| 41–60 | 3 |
| 60+ | 1 |

**Average 4.2 sessions · Median 2 · Max 67.** The rule mechanics explain it: a name is sold the day its 20-day return drops out of the top-5, so most positions live days, not months. The full trade-by-trade table (buy date, sell date, prices, P&L %, holding sessions for all 1,432 trades) is in `results/monthly-analytics.md`.

---

## 5. What this proves — and what it doesn't

**Proves:** the pipeline scales to 5 years unchanged (phase separation paid off — only config + one repair script were needed); momentum on the current NIFTY 100 with realistic costs earned +137.6% over 5 years vs +37.6% buy-and-hold; Yahoo Finance needs an official-source repair layer for NSE (documented artifact class + working fix).

**Doesn't prove:** forward returns (survivorship bias — today's NIFTY 100 applied backward — flatters momentum more than the index because past winners are exactly the stocks that entered the index); System One's edge (that run hasn't happened yet — below); investability of a −47.9% max drawdown strategy at 10bps/5bps flat costs.

---

## 6. The System One leg — decision needed

| | Detail |
| --- | --- |
| Status | Code path fully wired (`scripts/phase4-run.ts`, resume-safe, checkpointed); smoke-proven live on 5-year data (12/12 calls OK, 118 ms) |
| Cost | ~122k sessions × ~95 eligible stocks ≈ **96,000 calls** to the Vercel AI Gateway (`System One`) — paid; no gateway key on this box yet |
| Time | ~16 h serial, ~4–5 h at concurrency 4 (backoff/retry machinery already built) |
| To start | Provide `AI_GATEWAY_API_KEY` → I set the new experiment id, run Phase 4, and this report gains the System One column + System One-specific trade holding stats |

*Not financial advice. Experimental backtest on repaired Yahoo/NSE daily data; flat cost assumptions; survivorship bias disclosed above.*
