# Phase 2 feature quality

Generated: 3/10/2026, 07:29:00

System One was not called. No portfolio was simulated.

## Coverage

- Stocks: 100
- Trading sessions: 1585
- Feature rows: 158500
- Decision-ready rows: 122328
- First decision-ready date: 2021-05-04
- Last decision-ready date: 2026-09-23
- Database: `data/processed/market.duckdb`

## Formulas

Features on date D use only trading sessions on or before D. `close` is the raw Yahoo close, not `adj_close`. A stock session with missing prices, a non-positive price, or volume of 0 is stored and then treated as missing inside every window. A window with any missing session is null. Nothing is forward-filled.

- Returns are close / close N sessions earlier − 1.
- SMA is the mean of that many closes, including D.
- `above_sma*` is true only when close is strictly above that average.
- RSI is Wilder's 14-period RSI. A missing session starts a new average.
- `volatility_20d` is the sample standard deviation of 20 one-day returns. It is not annualized.
- `volume_ratio_20d` is volume / the 20-session mean volume, including D.
- `high_52w` is the maximum high over 252 trading sessions. Distance is close / high_52w − 1.
- `drawdown_20d` is close / the 20-session maximum close − 1.
- NIFTY returns use the NIFTY 100 close. Relative return is the stock return minus the NIFTY return of the same horizon.
- A row is decision-ready only when return_20d, return_60d, sma_50, sma_200, rsi_14, volatility_20d, volume_ratio_20d, the 52-week high, and all three NIFTY returns exist.

The cached `close` is already split-adjusted as of the Yahoo download. That can change the rupee level of a session that precedes a later split. `adj_close` is not used, because it also embeds later dividends.

## Missing values

| Field | Null rows |
| --- | ---: |
| return_1d | 6970 |
| return_5d | 7371 |
| return_20d | 8871 |
| return_60d | 12871 |
| rsi_14 | 8374 |
| volatility_20d | 9022 |
| volume_ratio_20d | 8914 |
| distance_from_52w_high | 33916 |
| drawdown_20d | 8914 |
| nifty_return_20d | 3600 |
| relative_return_20d | 10401 |

## Decision-ready distribution

| Field | Min | Median | Max |
| --- | ---: | ---: | ---: |
| return_1d | -0.899434 | 0.000363 | 9.119051 |
| return_5d | -0.895569 | 0.002862 | 9.407427 |
| return_20d | -0.893193 | 0.011986 | 9.345793 |
| return_60d | -0.893694 | 0.036797 | 11.678421 |
| rsi_14 | 9.74231 | 52.365498 | 99.366238 |
| volatility_20d | 0.003449 | 0.016092 | 2.059693 |
| volume_ratio_20d | 0.013597 | 0.8421 | 15.156365 |
| distance_from_52w_high | -0.906587 | -0.113178 | 0 |
| drawdown_20d | -0.901319 | -0.030977 | 0 |
| nifty_return_20d | -0.127783 | 0.00888 | 0.131047 |
| relative_return_20d | -0.95255 | 0.002934 | 9.345139 |

## Stocks with no decision-ready session

TATACAP, TMCV

These names do not have 252 valid sessions after their first usable bar, or a later hole breaks the 52-week window before the sample ends. Their rows are left null. They are not filled.

ITC is decision-ready before the rest of the universe because its 2025-03-18 bar is a real print. The other long-history names have a flat zero-volume print that day, so their 252-session window starts later.

## Large one-day moves on decision-ready rows

These are closes that passed the bar check and moved at least 20% versus the prior usable close. They are not removed. A move this large with no split in the Yahoo event file is a corporate-action gap inside `close`.

| Date | Ticker | Close | 1-day return | Volume |
| --- | --- | ---: | ---: | ---: |
| 2025-03-18 | BAJFINANCE | 8682.5 | 9.119051 | 1103110 |
| 2025-03-18 | KOTAKBANK | 2034 | 4.102604 | 5384288 |
| 2024-01-15 | SHRIRAMFIN | 2319.55 | 4.058335 | 556738 |
| 2025-03-18 | ADANIPOWER | 516.15 | 4.048415 | 2910834 |
| 2024-01-15 | MAZDOCK | 2347.4 | 1.04794 | 2174201 |
| 2025-03-18 | HDFCAMC | 3827.6 | 1.043212 | 416479 |
| 2025-03-18 | HDFCBANK | 1732.2 | 1.025491 | 10953589 |
| 2025-03-18 | NESTLEIND | 2202.05 | 1.025479 | 423776 |
| 2025-03-18 | PIDILITIND | 2729.15 | 0.985631 | 288689 |
| 2025-03-19 | BAJFINANCE | 873.16 | -0.899434 | 12898200 |
| 2025-03-19 | KOTAKBANK | 404.31 | -0.801224 | 26691440 |
| 2024-01-16 | SHRIRAMFIN | 461.94 | -0.800849 | 6647950 |
| 2025-03-19 | ADANIPOWER | 104.2 | -0.798121 | 18174890 |
| 2025-03-18 | SIEMENS | 5107.6 | 0.762643 | 259115 |
| 2026-04-30 | VEDL | 271.55 | -0.648979 | 73870853 |
| 2025-03-18 | MOTHERSON | 125.38 | 0.554426 | 11974671 |
| 2024-01-15 | MOTHERSON | 109.65 | 0.531425 | 24152334 |
| 2024-01-16 | MAZDOCK | 1163 | -0.504558 | 8391410 |
| 2025-03-19 | NESTLEIND | 1092 | -0.504098 | 845086 |
| 2025-03-19 | PIDILITIND | 1365.925 | -0.499505 | 484702 |
| 2025-03-19 | HDFCBANK | 872.05 | -0.496565 | 15221406 |
| 2025-03-19 | HDFCAMC | 1987.875 | -0.480647 | 813080 |
| 2025-03-19 | SIEMENS | 3066.7788 | -0.399566 | 855208 |
| 2024-01-16 | MOTHERSON | 72.9 | -0.335157 | 28529832 |
| 2025-03-19 | MOTHERSON | 86.0067 | -0.314032 | 14779144 |
| 2022-01-14 | MOTHERSON | 82.4667 | 0.285503 | 100740235 |
| 2023-02-01 | ADANIENT | 2135.3501 | -0.28197 | 13525314 |
| 2023-02-02 | ADANIENT | 1565.25 | -0.266982 | 34474080 |
| 2024-05-21 | HINDZINC | 741.3 | 0.256015 | 15462688 |
| 2024-06-04 | RECLTD | 452.2 | -0.251944 | 103902126 |
| 2024-06-04 | PFC | 426.75 | -0.230804 | 108815947 |
| 2024-11-21 | ADANIENT | 2183.6499 | -0.226068 | 21796668 |
| 2021-05-12 | GODREJCP | 872.85 | 0.218724 | 27379767 |
| 2024-11-29 | ADANIGREEN | 1323.9 | 0.217715 | 23771119 |
| 2024-06-04 | ADANIPORTS | 1248.95 | -0.211497 | 52109624 |
| 2021-10-13 | TMPV | 506.9 | 0.204467 | 197949387 |
| 2023-02-08 | ADANIENT | 2164.25 | 0.200394 | 19173006 |

## Validation

Result: **pass**. Violations: 0.

Validation recomputes each row from prices on or before that date, then recomputes again on histories cut at 25%, 50%, and 75% of the calendar. A cut that changes an earlier row is a future-data failure and stops the run.

## Sample rows

### RELIANCE 2020-05-04 decision_ready=false

```json
{
  "date": "2020-05-04",
  "ticker": "RELIANCE",
  "open": 658.3196,
  "high": 669.7487,
  "low": 648.0104,
  "close": 656.1252,
  "volume": 53456868,
  "return_1d": null,
  "return_5d": null,
  "return_20d": null,
  "return_60d": null,
  "sma_20": null,
  "sma_50": null,
  "sma_200": null,
  "above_sma20": null,
  "above_sma50": null,
  "above_sma200": null,
  "rsi_14": null,
  "volatility_20d": null,
  "volume_avg_20d": null,
  "volume_ratio_20d": null,
  "high_52w": null,
  "distance_from_52w_high": null,
  "drawdown_20d": null,
  "nifty_return_1d": null,
  "nifty_return_5d": null,
  "nifty_return_20d": null,
  "relative_return_5d": null,
  "relative_return_20d": null,
  "decision_ready": false
}
```

### RELIANCE 2021-05-04 decision_ready=true

```json
{
  "date": "2021-05-04",
  "ticker": "RELIANCE",
  "open": 899.9247,
  "high": 908.1394,
  "low": 881.9262,
  "close": 884.5106,
  "volume": 21849830,
  "return_1d": -0.02166870017773459,
  "return_5d": -0.03623064680079813,
  "return_20d": -0.05205622562784851,
  "return_60d": -0.004777237047181915,
  "sma_20": 902.64984,
  "sma_50": 938.9823320000003,
  "sma_200": 946.805106500001,
  "above_sma20": false,
  "above_sma50": false,
  "above_sma200": false,
  "rsi_14": 40.909656424982806,
  "volatility_20d": 0.014950395702321229,
  "volume_avg_20d": 18047323.55,
  "volume_ratio_20d": 1.210696419303681,
  "high_52w": 1093.4546,
  "distance_from_52w_high": -0.1910861228257671,
  "drawdown_20d": -0.0530866756278886,
  "nifty_return_1d": -0.008608350321265612,
  "nifty_return_5d": -0.008377356451857998,
  "nifty_return_20d": -0.020632866836739372,
  "relative_return_5d": -0.02785329034894013,
  "relative_return_20d": -0.031423358791109135,
  "decision_ready": true
}
```

### HDFCBANK 2021-05-04 decision_ready=true

```json
{
  "date": "2021-05-04",
  "ticker": "HDFCBANK",
  "open": 704.975,
  "high": 711.5,
  "low": 691.65,
  "close": 694.175,
  "volume": 21486328,
  "return_1d": -0.0184524019937079,
  "return_5d": -0.034996872176270344,
  "return_20d": -0.06618463090633941,
  "return_60d": -0.11034571144788696,
  "sma_20": 711.6524999999999,
  "sma_50": 744.1760000000002,
  "sma_200": 661.8506249999998,
  "above_sma20": false,
  "above_sma50": false,
  "above_sma200": true,
  "rsi_14": 40.91546634091152,
  "volatility_20d": 0.01973416971186538,
  "volume_avg_20d": 23986843,
  "volume_ratio_20d": 0.895754726872561,
  "high_52w": 820.5,
  "distance_from_52w_high": -0.15396099939061558,
  "drawdown_20d": -0.05989301191765983,
  "nifty_return_1d": -0.008608350321265612,
  "nifty_return_5d": -0.008377356451857998,
  "nifty_return_20d": -0.020632866836739372,
  "relative_return_5d": -0.026619515724412346,
  "relative_return_20d": -0.04555176406960004,
  "decision_ready": true
}
```

