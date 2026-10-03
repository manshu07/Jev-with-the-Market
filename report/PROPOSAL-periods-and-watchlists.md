# Proposal — Multi-Period Testing + EMA 262/365 Watchlists

*Prepared for Himanshu — read first, then say "go" and I build. Nothing here is coded yet.*

---

## Part 1 — What exists today (and why you only see 118 days)

The frontend shows **one recorded experiment** (2026-03-10 → 2026-08-31 = 118 sessions). It's not a bug — the site *replays recordings*, it doesn't compute. Three assets exist but aren't wired to any UI:

| Asset | Status | Where |
| --- | --- | --- |
| 6-month System One run (118 days) | ✅ shown on the site | `public/replay/experiment.json` |
| **5-year free run** (1,223 sessions: momentum/random/benchmark — no AI calls) | ✅ done, NOT wired | `data/processed/phase5y-free-momentum.json` (1.8 MB) |
| **5-year full decision run** | 🔄 running now (~112k paid calls, days) | checkpointed in `data/processed/periods/5y/` |

## Part 2 — Multi-period testing: 5/4/3/2/1y + custom

**How it works:** the pipeline (download → features → simulate) is date-windowed already. I make the *period* a parameter, generate one replay dataset per period from the already-downloaded 5-year data (no new downloads needed), and the frontend gains a period selector.

**Periods: 5y, 4y, 3y, 2y, 1y, Custom (any start→end inside the data).** Custom = two date inputs inside the cached window (2020-05 → 2026-09); results come from the same data, sliced.

**Frontend wiring:** new `/experiments/periods` page:
- Period chips: `5y | 4y | 3y | 2y | 1y | Custom`
- One summary card per period (final value, return %, max drawdown, trades, monthly table + holding periods — the analytics you already have for 5y)
- Equity-curve chart for the selected period
- Data source: a small static JSON manifest (`public/periods/manifest.json`) + one compact file per period (~100-300 KB each — 5y momentum equity is 1.8 MB raw; I'd serve summary+monthly+holdings+downsampled equity, and full equity only for the selected period)

**Effort: 1-2h.** One script generates all period datasets (5 free legs), one new page + selector component. Zero new data downloads.

**Important honesty note:** these are the **rule-based legs (momentum/random/benchmark)**. The System One (AI decision) column per period fills in automatically as the running full 5y leg completes (its decisions DB lets me slice any sub-window later for free — the decisions are stored per date, so 1y/2y/3y/4y System One views are re-simulations of stored decisions, no new calls).

## Part 3 — EMA-262 & EMA-365 watchlists (new feature)

**What they are:** new daily indicators — EMA over 262 trading sessions (~1 trading year) and EMA over 365 sessions (~1.45 trading years). Both on closing prices, as you specified.

**What a watchlist is here:** a daily list of stocks passing a rule. Proposed rules (needs your pick):

- **Rule A — Price above EMA:** stock close > EMA-262 (and separately > EMA-365) = "in uptrend" list
- **Rule B — Golden-cross style:** EMA-262 crosses **above** EMA-365 → entry signal; crosses below → exit signal
- **Rule C — Both:** show above/below flags + cross events

My recommendation: **Rule C** — watchlist shows status flags for both EMAs + cross events, dated. You see "stock X crossed into uptrend on 2023-04-12" type history plus today's list.

**Where it lives:** new "Watchlists" page (`/experiments/watchlists`):
1. **EMA-262 watchlist**: per date, stocks with close > EMA-262; count, list, entry/exit events
2. **EMA-365 watchlist**: same for EMA-365
3. **Both-EMA view**: above both / between / below both buckets + cross dates per stock

Each watchlist page: date picker (default latest), table with stock/trend status/distance-to-EMA/cross-date, per-stock cross history. **Plus the existing 20-day-momentum watchlist** (the current strategy's picks) shown alongside, since you said "existing as well there".

**EMA correctness detail (this matters):** EMA needs a seed. Standard = SMA(seed-period) then recursive smoothing. But 262/365-session EMAs need 262/365 sessions of history *before* the first value. With data from 2020-05, EMA-262 starts ~2021-05, EMA-365 starts ~2021-11 — and early values are noisy until ~2× period. My plan: compute from full 2020-05 history (that's why we have it), mark early values as "warming up" and the watchlist proper starts 2021-10 (when your experiment window opens) — honest warm-up disclosure in the UI.

**Effort: 2-3h.** EMA functions + tests (TDD), features build extension, watchlist generation script, 1 page + date picker + tables.

## Part 4 — "Does it work on live market?"

**Short answer: not as-is, and honest about it.**

| Aspect | Now (backtest) | Live market |
| --- | --- | --- |
| Data | Historical daily bars (Yahoo/NSE, EOD) | Needs daily refresh — Yahoo EOD updates post-market; NSE bhavcopy ~6pm IST. A daily refresh job is **easy** and I can add it (GitHub Actions cron at 18:30 IST: download → repair → features → watchlists → auto-commit/push → Vercel auto-deploys) |
| Decisions | ~112k paid calls for 5y | ~95/day going forward (~7-8 min) |
| Execution | Simulated next-open fills | Real broker needed (Zerobroker/Zerodha API); signals ≠ execution; slippage/liquidity differ |
| Timing | Daily EOD decisions, next-open execution | Same cadence works live: 3:30pm snapshot → decision → next morning order |

**So: EOD signals yes (with the refresh job), real-money execution no** — that needs a broker integration (separate project; Zerodha Kite Connect ₹2,000/mo + approvals). The app stays "decision lab" until you decide to wire a broker.

## Part 5 — Build order when you say go

1. **EMA watchlists** (new feature, most value): indicators + tests → features rebuild → watchlist generator → page with date picker + both EMA lists + momentum list
2. **Multi-period page** (5/4/3/2/1/custom): period datasets from cached 5y data → summary cards + equity + monthly + holdings per period
3. **Daily refresh cron** (the live-market bridge): GitHub Actions 18:30 IST → data → features → watchlists → commit+push → auto-deploy. Optional System One daily decisions (~95 calls/day) — needs your gateway key in GitHub secrets.
4. **Wire System One columns per period** once the running leg lands (free, from stored decisions)

**All static-dataset architecture (Vercel-friendly, zero server cost), same honesty discipline (warm-up labels, survivorship notes, no invented data).**

---

## The one decision I need from you

**Watchlist rule:** A (price vs EMA) / B (EMA-262×365 cross) / **C (both — my recommendation)**?
