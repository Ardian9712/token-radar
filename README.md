[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Ardian9712/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Ardian9712/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar

Built for the [make.fun "Build the best token launch radar" bounty](https://make.fun/bounty/token-radar-01) — referral code `p8atzycs`.

Token Radar reads one sealed snapshot of the DeFi protocol universe (DefiLlama protocols data) and
ranks the protocols that do not have a token yet by an **implied value** — a screening estimate of
what each protocol might be worth when its token arrives, built from the market's own pricing of
similar protocols that already trade.

## Model

Version `radar-2-median`. For every pre-token protocol:

    multiple     = median(mcap_usd / tvl_usd) of tokened protocols in the same category
                   (at least 3 samples with positive TVL and market cap, else the global median)
    growthFactor = clamp(1 + change_7d / 100, 0.8, 1.3)   (change_7d is in per cent)
    ageFactor    = clamp(0.9 + 0.15 x ln(1 + ageMonths) / ln(13), 0.9, 1.25)
    implied      = round(tvl_usd x multiple x growthFactor x ageFactor), at least $1

- The category multiple is the median market-cap/TVL of the snapshot's tokened comparators — the
  market's own comparable sales, resistant to outliers. A category with fewer than 3 samples falls
  back to the global median.
- The growth factor lets one week of flow move an estimate by at most -20%..+30%; a missing 7-day
  change counts as 0. change_7d is in per cent, so +2.37% is a factor of 1.024, +12.5% is 1.125,
  0 is 1.0 and -12.5% is 0.875.
- The age factor starts young protocols at 0.9x and climbs slowly toward 1.25x; an unknown listing
  date is treated as 12 months of age.

## The board

Every protocol that passes the eligibility rule ranks — 201 rows on this snapshot: the 40 watchlist
slugs plus 161 eligible protocols below the floor. Rows run 1..N by descending implied value; a row
that ties the row above steps down $1, so the order is strict and every value stays positive. A
candidate is eligible only when it records no token (gecko_id and symbol both null), its category is
none of Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, its name
carries no whole word wrapped/staked/staking, does not end in a version marker (V2, v2, 2.0, ...),
and does not begin with an exchange's name (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, ...).

"Records no token" describes the snapshot's fields, not the world: WBTC, Binance staked ETH and
USDT0 record no CoinGecko token, yet none is a protocol waiting for a launch of its own — which is
why such products are filtered out instead of ranked.

## Run

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json

Node 22, standard library only — no install step. The run is deterministic: no clock, no randomness,
explicit sorts with slug tie-breaks; two runs on the same snapshot write byte-identical files.

## Files

    main.ts                   entry point: snapshot in, out/ written
    lib/model.ts              the model: parsing, eligibility, multiples, scoring, board, dashboard data
    dashboard/                the static page (index.html, app.css, app.js), copied into out/dashboard
    vendor/makefun-board.ts   the house dossier builder
    screenshots/              the three hand-in images (board, detail, filtered)
    out/                      build output: board.json, data.js, dashboard/, screenshots/, dossier.json

## Limits

An implied value is a screening estimate, never a price or a fair-value claim: it prices TVL at a
category median, adjusted for a week's flow and age, and it inherits every distortion of the market
caps behind that median. Farm steps are generic per-category activity plans — they record activity
and never promise an airdrop. Tokened protocols appear only as comparators in the dashboard's live
view, with the market's own values.
