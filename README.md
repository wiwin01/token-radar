# Token Radar

A token launch radar for make.fun's **token-radar-01** bounty: every protocol in the sealed
DefiLlama snapshot that records no token yet — and is not a wrapped, staked or bridged product
of a token that already trades — ranked by what its launch would be worth, each with the steps
to farm it. Built for the account **@irawati-469**.

## Run it

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22+, standard library only. The program writes `out/board.json` (the ranked board),
`out/data.js` (the dashboard's data), `out/dashboard/` and `out/screenshots/` (copied from this
repository) and `out/dossier.json` (built with `vendor/makefun-board.ts`, the kit's library).
Open `out/dashboard/index.html` in a browser to use the dashboard; it renders fully offline.

## The board

A protocol is ranked when the snapshot records no token for it (no CoinGecko id, no symbol, no
market cap) **and** it is not a product of a token that already trades: its category is not
Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, its name has
no whole word *wrapped/staked/staking*, no version-marker ending (V2, 2.0 …) and no exchange
name in front. That is the watchlist's own rule applied to the whole snapshot, so the board
covers all 40 watchlist protocols and continues below the $50M floor — 198 protocols ranked in
all, 158 of them early catches under the floor. Protocols whose token already trades are never
ranked; the dashboard sets the 24 largest aside in an "Already trading" view with the market's
own values.

## The value model (`peer-multiple-1`, in `lib/model.ts`)

The snapshot prices the tokens that exist: 128 protocols record both a market cap and a TVL.
The model takes, per category, the **median market-cap-per-TVL of the tokenized peers** — what
the market actually pays for one TVL dollar of that kind of protocol — and prices a launch as:

```
implied = TVL x peer_multiple x growth_mult x maturity_mult x breadth_mult
```

- **peer_multiple** — category median mcap/TVL, shrunk toward the global median (x0.223) with
  the global counting as 3 pseudo-peers: `(n x category median + 3 x global) / (n + 3)`. A
  category priced by one token alone (Api3 stands for all of Risk Curators at x2.98) cannot
  outvote the market; with no tokenized peer, the global median. Clamped to [x0.02, x3] and
  rounded to 4 places before use, so the printed multiple is the one each row was priced with.
- **growth_mult** — `1 + clamp(change_7d, -60%, +120%) x 0.5`.
- **maturity_mult** — `0.6 + min(age_days, 1095)/1095 x 0.4`; unknown age counts as 365 days.
- **breadth_mult** — `1 + 0.025 x min(chains - 1, 4)`.

No name is special-cased: one function scores every row from the snapshot's own figures, and
each protocol's detail view in the dashboard shows the arithmetic and recomputes the board's
number in the page.

## Farm plans

Each row carries six steps generated from the protocol's own record — its category decides the
core action (supply/borrow for lending, liquidity + swaps for a DEX, a curated-vault deposit
for a risk curator, and so on), its TVL the capital tier ($50–$250), its age the holding
window (30–60 days) — every step with what it costs and how long it takes.

## Results

On the sealed snapshot (as of 2026-11-14): 758 protocols scanned, **198 ranked**, all 40
watchlist protocols covered, total implied value **$10,158,436,066**. The top of the board:

| # | Protocol | Category | TVL | Peer x | Implied value | Watchlist |
|---|----------|----------|-----|--------|---------------|-----------|
| 1 | Steakhouse Financial | Risk Curators | $2,753,981,495 | x0.904 | $2,162,366,872 | yes |
| 2 | Sentora Curator | Risk Curators | $2,757,585,593 | x0.904 | $2,030,064,413 | no |
| 3 | Gauntlet | Risk Curators | $1,577,685,462 | x0.904 | $1,287,853,259 | yes |
| 4 | Polymarket International | Prediction Market | $320,193,439 | x3 | $955,385,018 | no |
| 5 | Nonce Capital | Risk Curators | $513,783,671 | x0.904 | $279,180,444 | yes |
| 6 | RockawayX | Risk Curators | $292,506,628 | x0.904 | $196,741,477 | yes |
| 7 | Veda | Onchain Capital Allocator | $1,563,415,482 | x0.1333 | $182,576,249 | yes |
| 8 | USDD | CDP | $1,055,793,606 | x0.1913 | $172,127,393 | yes |
| 9 | Hyperithm | Risk Curators | $221,638,535 | x0.904 | $172,106,562 | yes |
| 10 | Hive Protocol | Chain | $198,776,765 | x0.917 | $162,256,074 | yes |

The curators sit on top because they genuinely hold the largest tokenless TVLs in the snapshot
— priced at a shrunk x0.904, not at the x2.98 their single tokenized namesake would suggest.

## Layout

- `main.ts` — the entrypoint: snapshot in, board + dashboard data + dossier out.
- `lib/model.ts` — the selection rule, the peer-multiple model, the farm plans, the gate check.
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte.
- `dashboard/` — the static page (board, detail view, filters, live set-aside view).
- `screenshots/` — the board, a detail view and a filtered view of the rendered page.

## License

MIT — see `LICENSE`.
