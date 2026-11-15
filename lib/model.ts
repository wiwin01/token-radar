// Token Radar's model: one sealed DefiLlama snapshot in, one ranked board of pre-token protocols out.
//
// WHO IS ON THE BOARD
// A protocol is ranked when the snapshot records no token for it (no CoinGecko id, no symbol, no
// market cap) AND it is not a wrapped, staked or bridged product of a token that already trades:
// its category is not Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or
// CEX, its name carries no whole word wrapped/staked/staking, does not end in a version marker
// (V2, v2, 2.0 ...) and does not begin with an exchange's name. That is the watchlist's own rule,
// applied to the whole snapshot rather than only above the $50M floor, so the board covers every
// watchlist slug and keeps going below the floor: the early protocols are the ones a radar exists
// to find. Protocols whose token already trades are never ranked; the dashboard sets them aside
// in a separate "already trading" view carrying the market's own values.
//
// WHAT A LAUNCH WOULD BE WORTH
// The snapshot carries no prices for tokens that do not exist, but it does carry the market's
// verdict on the ones that do: 128 protocols in it record both a token market cap and a TVL.
// For each category, the model takes the median market-cap-per-TVL ratio of that category's
// tokenized peers — what the market actually pays for one dollar of TVL in that kind of
// protocol — and prices a pre-token protocol's hypothetical launch at:
//
//   implied = TVL x peer_multiple x growth_mult x maturity_mult x breadth_mult
//
//   peer_multiple  median mcap/TVL of the protocol's tokenized category peers, shrunk toward
//                  the global median with the global counting as 3 pseudo-peers:
//                  (n x category median + 3 x global) / (n + 3). A category priced by many
//                  tokens speaks for itself; one priced by a single token (Api3 alone stands
//                  for "Risk Curators" at 2.98x, Rain alone for prediction markets at 400x)
//                  is pulled most of the way back to what the whole market pays. With no
//                  tokenized peer at all it is the global median. Clamped to [0.02, 3] so no
//                  thin category can price an outlier, and rounded to 4 places before use:
//                  the multiple the board prints is the multiple the board prices with.
//   growth_mult    1 + clamp(change_7d, -60, +120)% x 0.5: a protocol gaining TVL is priced up,
//                  one bleeding TVL is priced down, both within bounds.
//   maturity_mult  0.6 + min(age_days, 1095)/1095 x 0.4: a protocol that has run for years with
//                  no token is a surer launch than one listed last month. Unknown age: 365 days.
//   breadth_mult   1 + 0.025 x min(chains - 1, 4): each extra chain is distribution a launch
//                  would inherit, worth a small premium, capped at +10%.
//
// No protocol's name is ever special-cased: one function scores every row from the snapshot's
// own figures, and the dashboard shows the arithmetic for each row so a reader can check it.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard exactly as the code runs them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra_chains: number;
  multiple_min: number;
  multiple_max: number;
  shrinkage_peers: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.025,
  breadth_max_extra_chains: 4,
  multiple_min: 0.02,
  multiple_max: 3,
  shrinkage_peers: 3,
};

/** The model's version label, named in the dashboard and the README. */
export const MODEL_VERSION = 'peer-multiple-1';

/** How many already-trading protocols the dashboard's set-aside view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    peer_scope: string;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the row, its farm plan and its model inputs. */
export interface RadarRow extends BoardRow {
  watchlist: boolean;
}

/** A protocol whose token already trades: shown with the market's value, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  protocols_total: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from listed_at to the snapshot's as_of, clamped at zero; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the snapshot records no token for a protocol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_LED = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a protocol is a wrapped, staked or bridged product of a token that already trades —
 * the watchlist's exclusion, in the snapshot's own fields. Such a product's "launch" already
 * happened: it is the parent token. WBTC is Bitcoin; a staked-ETH product is ETH.
 */
export function isProductOfTradedToken(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORY.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_LED.test(p.name)) return true;
  if (VERSIONED.test(p.name)) return true;
  return false;
}

/** Whether the board may rank a protocol: it records no token and is no product of one. */
export function isRankable(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !isProductOfTradedToken(p);
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** What the market pays per TVL dollar, overall and per category, from the tokenized protocols. */
export interface PeerMultiples {
  global: number;
  byCategory: Map<string, { multiple: number; peers: number }>;
}

export function peerMultiples(snapshot: Snapshot): PeerMultiples {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.gecko_id === null || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    ratios.push(ratio);
    const key = p.category ?? '(uncategorised)';
    const list = perCategory.get(key) ?? [];
    list.push(ratio);
    perCategory.set(key, list);
  }
  const global = ratios.length > 0 ? median(ratios) : 0.25;
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [category, list] of perCategory) {
    byCategory.set(category, { multiple: median(list), peers: list.length });
  }
  return { global, byCategory };
}

/** The peer multiple one protocol is priced with, and where it came from. */
export function multipleFor(p: SnapshotProtocol, peers: PeerMultiples, model: ModelConstants): { multiple: number; peerCount: number; scope: string } {
  const entry = p.category === null ? undefined : peers.byCategory.get(p.category);
  let multiple: number;
  let scope: string;
  if (entry !== undefined && entry.peers > 0) {
    const k = model.shrinkage_peers;
    multiple = (entry.peers * entry.multiple + k * peers.global) / (entry.peers + k);
    scope = `category median of ${entry.peers} tokenized ${p.category} peer(s), shrunk toward the global median (which counts as ${k})`;
  } else {
    multiple = peers.global;
    scope = 'global median (the snapshot records no tokenized peer in this category)';
  }
  // Rounded before use, and clamped: the multiple a row prints is the multiple it was priced with.
  return { multiple: clamp(round4(multiple), model.multiple_min, model.multiple_max), peerCount: entry?.peers ?? 0, scope };
}

/** The full scoring of one protocol: every multiplier and the implied value they produce. */
export function score(p: SnapshotProtocol, asOf: string, peers: PeerMultiples, model: ModelConstants) {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, peerCount, scope } = multipleFor(p, peers, model);
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra_chains);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, age, multiple, peerCount, scope, growthMult, maturityMult, breadthMult };
}

// ------------------------------------------------------------------ farm plans

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, scaled to the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core farming action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral in ${n} on ${chain}, then borrow about half of it back so both sides of the market see your wallet.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into a ${n} curated vault on ${chain} and keep the vault shares in the same wallet.`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${n}'s busiest pool on ${chain} and make two small swaps through the same interface.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${n} and open one small hedged position you can leave running.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${n} to ${chain} and use the bridged funds in one app on the far side.`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the receipt token in the wallet.`;
  if (c.includes('stable')) return `Mint $${capital} of ${n}'s stable asset on ${chain} against USDC collateral and hold the minted asset.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${n} and take one position in its most liquid market.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active for the full term.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${n}, then make real transactions with two of its native apps each week.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${n} over the month instead of moving it in one transfer.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} of USDC into ${n}'s main vault on ${chain} and leave the position compounding.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its own app and keep the position open.`;
}

/** The follow-up action that makes the wallet read as a user, not a one-off deposit. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Repay part of the borrow and re-supply once in the first fortnight, so the wallet shows a full lend-borrow-repay cycle on ${n}.`;
  if (c.includes('dex')) return `Swap a small amount through ${n} on two different days each week; repeated real trades are what points programs count.`;
  if (c.includes('bridge')) return `Bridge a smaller amount back through ${n} after two weeks, so the wallet shows traffic in both directions.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Adjust the position once a week (add or trim a little margin) so the account stays active on ${n} without adding risk.`;
  return `Use one more feature of ${n} on ${chain} in the second week (a second pool, vault or market), so the wallet is a user of the protocol, not a single deposit.`;
}

/**
 * A protocol's farm plan: six concrete steps with costs and times, derived from the protocol's
 * own record (category, chains, TVL, age) by one function for every row — never a hand-written
 * list of names. Each step is a single string, as board.json carries it.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const raw = [
    `Set up a fresh wallet for ${p.name} alone, fund it on ${chain} from an exchange, and keep its seed phrase offline. Cost: about $2 of gas to fund and activate. Time: 10 minutes.`,
    `${actionFor(p, capital, chain)} Cost: $${capital} of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    `${secondActionFor(p, chain)} Cost: about $2 of gas each time. Time: 10 minutes.`,
    `Repeat one small qualifying action every week (a deposit top-up, a swap, a vote or a claim) so no week is empty. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days, across several weekly snapshots, before you withdraw anything. Cost: the $${capital} stays in the position, earning whatever it earns. Time: ${hold} days.`,
    `Watch ${p.name}'s own announcements page for a points or rewards program, and claim only from a link that page publishes; never pay a fee to claim. Cost: nothing to check. Time: 10 minutes.`,
    `Log the wallet, the dates and every transaction hash in a farm diary, so the position can be repeated, proved or unwound later. Cost: nothing. Time: 5 minutes.`,
  ];
  return raw.map((s) => {
    let t = s.trim();
    if (t.length > 600) t = `${t.slice(0, 596)}...`;
    if (t.length < 20) t = `${t} Keep the position open and check the protocol's own page weekly.`;
    return t;
  });
}

// ------------------------------------------------------------------ the board

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter(isRankable);
  const scored = chosen.map((p) => ({ p, s: score(p, snapshot.as_of, peers, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: s.age,
    on_watchlist: watch.has(p.slug),
    implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.multiple),
      peer_count: s.peerCount,
      peer_scope: s.scope,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
    },
    farm_steps: farmSteps(p, s.age),
  }));
}

/** The already-trading protocols, by market cap: set aside, with the market's own values. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerMultiples(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(peers.global),
    protocols_total: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    rows: board.map((r) => ({ ...r, watchlist: r.on_watchlist })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears on the board twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${byRank[i]!.rank} outvalues rank ${byRank[i - 1]!.rank}`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row carries the same implied value: not a ranking';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
