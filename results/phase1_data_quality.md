# Phase 1 data quality report

Generated: 3/10/2026, 16:53:40 IST

## Observed

- Data source: Yahoo Finance chart API, client yahoo-finance2 4.0.2.
- Universe label: Fixed current NIFTY 100 universe.
- Constituent file: data/universe/ind_nifty100list.csv, captured 2026-09-22.
- Stocks requested: 100.
- Stocks cached: 100.
- Stocks failed: 0.
- Requested window: 2020-05-01 through the session before 2026-10-03.
- Benchmark: ^CNX100.
- Raw benchmark rows: 1597.
- Rows treated as Yahoo placeholders, not trading sessions: 2026-01-15, 2026-05-01, 2026-05-28, 2026-06-26, 2026-09-14, 2026-10-02.
- Trading sessions after that filter: 1591.
- First / last trading session: 2020-05-04 / 2026-10-01.
- Cache directory: `data/raw/ohlcv/` and `data/raw/events/`.
- Trading calendar: `data/universe/trading_calendar.json`.

## Missing and unusable bars

A trading session is a date where the NIFTY 100 bar has a high-low range, or at least one stock has a bar with volume above zero. Dates where every stock is empty or a flat zero-volume print, and the index bar is empty, stay in the raw cache and are left off the trading calendar.

Benchmark bar missing on a day stocks traded: 2020-11-14, 2021-01-01, 2022-12-26, 2024-01-01, 2024-02-19, 2025-01-01, 2025-02-01, 2026-01-01.

Unusable stock prints on trading sessions:

- 2021-11-04: flat zero-volume BRITANNIA, DLF, JSWSTEEL, ZYDUSLIFE. Flat print with volume 0 on a session the rest of the universe traded.
- 2022-09-12: flat zero-volume BRITANNIA, DLF, JSWSTEEL, ZYDUSLIFE. Flat print with volume 0 on a session the rest of the universe traded.
- 2022-10-24: flat zero-volume BRITANNIA, DLF, JSWSTEEL, ZYDUSLIFE. Flat print with volume 0 on a session the rest of the universe traded.
- 2022-12-01: flat zero-volume LTM. Flat print with volume 0 on a session the rest of the universe traded.
- 2022-12-02: flat zero-volume LTM. Flat print with volume 0 on a session the rest of the universe traded.
- 2024-01-15: flat zero-volume 12 symbols, real bars only in . Flat print with volume 0 on a session the rest of the universe traded.
- 2024-06-07: flat zero-volume UNITDSPR. Flat print with volume 0 on a session the rest of the universe traded.
- 2025-03-18: flat zero-volume 96 symbols, real bars only in ITC. Open, high, low and close equal the previous session close, and volume is 0. The NIFTY 100 bar on this date is a normal traded session.
- 2025-04-11: flat zero-volume ETERNAL. Flat print with volume 0 on a session the rest of the universe traded.
- 2025-04-15: flat zero-volume ETERNAL. Flat print with volume 0 on a session the rest of the universe traded.
- 2025-09-08: flat zero-volume M&M. Flat print with volume 0 on a session the rest of the universe traded.

History starts after the first trading session. The dates before the first real bar are not holes:

| Symbol | First real session | Trading sessions before that |
| --- | --- | ---: |
| ETERNAL | 2021-07-23 | 307 |
| HYUNDAI | 2024-10-22 | 1109 |
| IRFC | 2021-01-29 | 189 |
| JIOFIN | 2023-08-21 | 822 |
| LODHA | 2021-04-19 | 241 |
| MAXHEALTH | 2020-08-21 | 78 |
| MAZDOCK | 2020-10-12 | 113 |
| ENRIN | 2025-06-19 | 1272 |
| TATACAP | 2025-10-13 | 1351 |
| TMCV | 2025-11-12 | 1371 |

Symbols with a bad or missing bar after their first real session: 96.

## Adjustment finding

Yahoo reported 35 split events. Overnight close ratios classify 35 as already split-adjusted and 0 as unadjusted traded prices. Dividend events: 880. Symbols where adj_close differs from close: 95. A split-adjusted history downloaded on 2026-09-22 embeds split factors whose ex-date is after a simulated decision date. That changes the rupee level, not the split-adjusted return. `adj_close` also embeds later dividends and is not a point-in-time price.

## Sample raw rows

### RELIANCE.NS

| date | open | high | low | close | adj_close | volume |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2020-05-04 | 658.3196 | 669.7487 | 648.0104 | 656.1252 | 639.0863 | 53456868 |
| 2020-05-05 | 664.5828 | 676.149 | 661.6111 | 667.76 | 650.419 | 44903763 |
| 2020-05-06 | 669.2916 | 678.8692 | 660.834 | 667.8058 | 650.4636 | 40489094 |
| 2026-09-30 | 1182 | 1196.5 | 1181.7 | 1187 | 1187 | 16376789 |
| 2026-10-01 | 1180.1 | 1183.9 | 1160.8 | 1167.7 | 1167.7 | 16771221 |
| 2026-10-02 | null | null | null | null | null | null |

### HDFCBANK.NS

| date | open | high | low | close | adj_close | volume |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2020-05-04 | 478.75 | 480 | 458.75 | 461.5 | 430.0095 | 26722324 |
| 2020-05-05 | 469 | 472 | 454.025 | 455.725 | 424.6285 | 29672858 |
| 2020-05-06 | 459.5 | 475 | 452.825 | 473.2 | 440.9111 | 33785846 |
| 2026-09-30 | 711.5 | 720.3 | 708.7 | 708.7 | 708.7 | 39365496 |
| 2026-10-01 | 708.4 | 721.3 | 707.1 | 721.2 | 721.2 | 37389857 |
| 2026-10-02 | null | null | null | null | null | null |

### INFY.NS

| date | open | high | low | close | adj_close | volume |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2020-05-04 | 689.8 | 701.2 | 670.35 | 673.7 | 566.6268 | 9122740 |
| 2020-05-05 | 681.75 | 685.6 | 670 | 673.7 | 566.6268 | 6393053 |
| 2020-05-06 | 676.9 | 681.45 | 664.05 | 665.9 | 560.0666 | 7934250 |
| 2026-09-30 | 1004 | 1024 | 992.2 | 994.1 | 994.1 | 13508984 |
| 2026-10-01 | 1010 | 1035 | 999.15 | 1035 | 1035 | 15166446 |
| 2026-10-02 | null | null | null | null | null | null |

## What this file is not

No features were calculated. No portfolio was simulated. Jev was not called.

