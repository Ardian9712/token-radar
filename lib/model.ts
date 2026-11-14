// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks pre-token protocols — entries whose record carries no CoinGecko id and no symbol —
// while protocols that already have a token (a CoinGecko id) serve only as comparators. Each category's
// multiple is the median market-cap/TVL ratio of its tokened comparators (at least 3 samples, else the
// global median), so the model prices a pre-token protocol the way the market already prices its peers.
//
//   multiple     = median(mcap_usd / tvl_usd) of tokened protocols in the same category   (>=3 samples, else global)
//   growthFactor = clamp(1 + change_7d, 0.8, 1.3)
//   ageFactor    = clamp(0.9 + 0.15 x ln(1 + ageMonths) / ln(13), 0.9, 1.25)   (ageMonths unknown: 12)
//   implied      = round(tvl_usd x multiple x growthFactor x ageFactor), at least $1
//
// Before ranking, the house's eligibility rule clears the wrapped, staked and bridged products of
// tokens that already trade: WBTC, Binance staked ETH and USDT0 record no CoinGecko token, yet none is
// a protocol waiting for a launch of its own. A protocol may rank on the board only when it records no
// token (both gecko_id and symbol null), its category is none of Bridge, Canonical Bridge, Liquid
// Staking, Liquid Restaking, Restaked BTC or CEX, its name carries no whole word wrapped, staked or
// staking in any case, does not end in a version marker (a space followed by V2, v2, 2.0 or the like),
// and does not begin with an exchange's name (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex
// or Gemini).
//
// The board ranks every protocol that passes: 201 rows on this snapshot — the 40 watchlist slugs plus
// the eligible protocols below the floor. Ranks run 1..N in descending implied value; ties step down $1
// so no two rows share a rank's value. No protocol name is ever special-cased: the same function scores
// every row.

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

/** The reference date the model ages against: the sealed snapshot's as_of. */
export const AS_OF = '2026-11-14';

/** Categories the house rule leaves off the board: wrapped, staked or bridged products, and exchanges. */
export const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchanges whose branded products are not protocols waiting for a token of their own. */
export const EXCHANGE_NAMES: ReadonlySet<string> = new Set([
  'binance',
  'coinbase',
  'bybit',
  'kraken',
  'bitget',
  'okx',
  'bitfinex',
  'gemini',
]);

/** DefiLlama's version-marker rule: a name ending in a successor version — V2, v2, 2.0 or the like — is a pool of another protocol. */
const VERSIONED = /\s(V[2-9]\d*(\.\d+)?|v[2-9]\d*(\.\d+)?|\d+\.\d+)$/;

/** A wrapped, staked or staking product named in the protocol's own name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Distinct tokened comparators a category needs before its own median multiple is trusted. */
export const MIN_CATEGORY_SAMPLES = 3;

/** Age in months assumed when a protocol records no listing date. */
export const DEFAULT_AGE_MONTHS = 12;

/** The growth factor's bounds: a week's flow may swing the estimate by at most -20%..+30%. */
export const GROWTH_FLOOR = 0.8;
export const GROWTH_CAP = 1.3;

/** The age factor's bounds: maturity trims the multiple toward at most 1.25x, never below 0.9x. */
export const AGE_FLOOR = 0.9;
export const AGE_CAP = 1.25;

/** The dashboard's constants block: kept so the page and the sandbox keep their shape. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

/** Legacy display constants: the dashboard states them; the median model supersedes their formula. */
export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2-median';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The median of a list of numbers, 0 for an empty list: half the samples sit above it. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A number forced into [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Whole months from `listed_at` to the snapshot's as_of (2026-11-14); null when the date is absent or bad. */
export function monthsSince(listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const from = new Date(Date.parse(`${listedAt}T00:00:00Z`));
  const to = new Date(Date.parse(`${AS_OF}T00:00:00Z`));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

const DAY_MS = 86_400_000;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol with a recorded token: a comparator only, never a board row. */
export function isTokened(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null;
}

/** A protocol whose record has no token at all: a board candidate. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Why the house watchlist rule leaves `p` off the board, or null when it may rank. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'token';
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return 'category';
  if (WRAPPED_WORD.test(p.name)) return 'name-word';
  if (VERSIONED.test(p.name)) return 'version-marker';
  const first = p.name.trim().split(/\s+/)[0] ?? '';
  if (EXCHANGE_NAMES.has(first.toLowerCase())) return 'exchange-prefix';
  return null;
}

/** Whether a protocol may rank on the board: the house watchlist rule, applied to every candidate. */
export function isEligiblePreToken(p: SnapshotProtocol): boolean {
  return exclusionReason(p) === null;
}

/** The category median multiples: one global median and one per category, global where samples are few. */
export interface Multiples {
  global: number;
  byCategory: Record<string, number>;
}

/**
 * The market's own valuation ratios, from the snapshot's tokened protocols: for every category with at
 * least MIN_CATEGORY_SAMPLES comparables, the median of mcap/tvl; the global median otherwise.
 */
export function getMultiples(snapshot: Snapshot): Multiples {
  const samples: number[] = [];
  const byCategory: Record<string, number[]> = {};
  for (const p of snapshot.protocols) {
    if (!isTokened(p) || p.tvl_usd <= 0 || p.mcap_usd === null || p.mcap_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    samples.push(ratio);
    const key = p.category ?? 'Other';
    (byCategory[key] ??= []).push(ratio);
  }
  const global = median(samples);
  const multiples: Record<string, number> = {};
  for (const [category, ratios] of Object.entries(byCategory)) {
    multiples[category] = ratios.length >= MIN_CATEGORY_SAMPLES ? median(ratios) : global;
  }
  return { global, byCategory: multiples };
}

/** The multiple that prices `p`: its category's median, or the global median when the category is absent. */
export function multipleFor(p: SnapshotProtocol, multiples: Multiples): number {
  return multiples.byCategory[p.category ?? 'Other'] ?? multiples.global;
}

/** The week's flow as a multiplier: a 7-day change swings the estimate by at most -20%..+30%. */
export function growthFactorOf(change7d: number | null): number {
  return clamp(1 + (change7d ?? 0), GROWTH_FLOOR, GROWTH_CAP);
}

/** The maturity multiplier: young protocols start at 0.9x and climb slowly toward 1.25x. */
export function ageFactorOf(ageMonths: number): number {
  return clamp(AGE_FLOOR + (0.15 * Math.log(1 + ageMonths)) / Math.log(13), AGE_FLOOR, AGE_CAP);
}

/** One protocol's score and the factors behind it. */
export interface Score {
  implied: number;
  multiple: number;
  growthFactor: number;
  ageFactor: number;
  ageMonths: number;
}

/** The implied value one protocol gets: TVL priced at its category's median multiple, grown and matured. */
export function impliedValue(p: SnapshotProtocol, multiples: Multiples): Score {
  const multiple = multipleFor(p, multiples);
  const growthFactor = growthFactorOf(p.change_7d);
  const ageMonths = monthsSince(p.listed_at) ?? DEFAULT_AGE_MONTHS;
  const ageFactor = ageFactorOf(ageMonths);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor * ageFactor));
  return { implied, multiple, growthFactor, ageFactor, ageMonths };
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  age_months: number | null;
  multiple: number;
  growth_factor: number;
  age_factor: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the factors under its implied value. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
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

/**
 * The ranked board: every protocol the house's eligibility rule allows — the watchlist is a floor, never
 * a ceiling, so no TVL cut and no row cap apply here. Rows are ranked by implied value, strongest first;
 * a row that ties the row above steps down $1, so the order is strict and every value stays positive.
 */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const multiples = getMultiples(snapshot);
  const scored = snapshot.protocols.filter(isEligiblePreToken).map((p) => ({ p, score: impliedValue(p, multiples) }));
  scored.sort(
    (a, b) =>
      b.score.implied - a.score.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );

  const rows: BoardRow[] = [];
  let previous = 0;
  for (let i = 0; i < scored.length; i++) {
    const { p, score } = scored[i]!;
    const implied = i > 0 && score.implied >= previous ? Math.max(1, previous - 1) : score.implied;
    previous = implied;
    rows.push({
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: ageDays(snapshot.as_of, p.listed_at),
      age_months: score.ageMonths,
      multiple: score.multiple,
      growth_factor: score.growthFactor,
      age_factor: score.ageFactor,
      implied_value_usd: implied,
      farm_steps: farmSteps(p),
    });
  }
  return rows;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** The category's two core actions, in the words a farmer can follow. */
function coreActions(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('dex') || c.includes('swap') || c.includes('farm') || c.includes('amm')) {
    return [
      `Swap $${capital} of USDC for the other asset in ${name}'s main pool on ${chain}`,
      `Add the swapped pair back as liquidity in ${name} on ${chain} and keep the LP receipt`,
    ];
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('credit')) {
    return [
      `Supply $${capital} of USDC into ${name}'s lending market on ${chain}`,
      `Borrow a small amount of the market's main asset against the deposit on ${name} (${chain})`,
    ];
  }
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator')) {
    return [
      `Deposit $${capital} of USDC into a ${name} vault on ${chain}`,
      `Keep the vault shares and top the deposit up once after a week on ${name} (${chain})`,
    ];
  }
  if (c.includes('perp') || c.includes('derivativ') || c.includes('option') || c.includes('trading')) {
    return [
      `Deposit $${capital} of USDC as margin on ${name} (${chain})`,
      `Open one small long position on ${name}'s most liquid market on ${chain}`,
    ];
  }
  if (c.includes('bridge')) {
    return [
      `Bridge $${capital} of USDC to ${chain} through ${name}'s official route`,
      `Use the bridged USDC in one app on ${chain} and keep both transaction records`,
    ];
  }
  if (c.includes('staking') || c.includes('restak')) {
    return [
      `Stake $${capital} of the chain's staking asset through ${name} on ${chain}`,
      `Keep the liquid staking receipt and leave the stake untouched on ${name} (${chain})`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Deposit $${capital} of USDC into ${name}'s yield-bearing asset on ${chain}`,
      `Hold the receipt token in the same wallet and check its value weekly on ${name} (${chain})`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain}`,
    `Leave the deposit in place for a week and review the position on ${name} (${chain})`,
  ];
}

/**
 * A protocol's farm plan: five steps, each one concrete action on the protocol's first chain with a
 * dollar cost and a time. The plan follows the category's pattern, names the protocol, and records
 * activity — it never promises an airdrop.
 */
export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p);
  const [first, second] = coreActions(p, capital, chain);
  const gas = capital >= 150 ? 8 : capital >= 100 ? 5 : 2;
  return [
    `Fund a fresh wallet with $${capital} of USDC on ${chain}, keeping the seed phrase offline (gas about $${gas}, about 10 minutes).`,
    `${first} (about $${gas} of gas, 15 minutes).`,
    `${second} (about $${gas} of gas, 10 minutes).`,
    `Keep the position on ${p.name} for at least 14 days and make one small weekly action so your activity is recorded on ${chain} (about $1 of gas a week, 5 minutes a week).`,
    `Review ${p.name}'s official points dashboard on ${chain}, claim only from links it publishes, and log every transaction hash ($0 to check, about 10 minutes).`,
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
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
    }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A board row's compact form for data.js, with the farm plan carried by board.json. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: round4(row.growth_factor),
    maturity_multiplier: round4(row.age_factor),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} row${board.length === 1 ? '' : 's'}: the gate wants at least 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (typeof s !== 'string' || s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${String(s).length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** The model in words, for the dashboard's method note and the dossier. */
export const MODEL_NOTES = [
  'Implied value = round(TVL x category multiple x growth factor x age factor), at least $1. The category multiple is the median market-cap/TVL ratio of the snapshot\'s tokened protocols in the same category, requiring at least three comparables with positive TVL and market cap; thinner categories fall back to the global median (0.21 at this snapshot). The growth factor clamps 1 + change_7d into [0.8, 1.3], so one week of flow can move an estimate by at most -20% to +30%. The age factor is clamp(0.9 + 0.15 x ln(1 + ageMonths) / ln(13), 0.9, 1.25), with age in months from listed_at to 2026-11-14 and an unknown listing date treated as 12 months. The board ranks every protocol that passes the eligibility rule below: 201 rows on this snapshot — the 40 watchlist slugs plus 161 eligible protocols below the floor — ordered by implied value with $1 step-downs on ties.',

  'Medians per category, not means and not one global number: a category\'s tokened protocols are the market\'s own comparable sales, and a lending market is valued differently from a DEX or a bridge. The median resists outliers — one low-float token that traded to an extreme multiple, or one stale market cap, would drag a mean but cannot move a median alone. Requiring three samples keeps single-protocol categories from masquerading as a market price; below that, the global median is the honest fallback.',

  'The house watchlist rule is applied to every board candidate, not only the listed 40, because a wrapped or staked product of a token that already trades is not a protocol waiting for a token of its own: WBTC is Bitcoin on Ethereum, Binance staked ETH is ETH in Binance\'s staking product, and USDT0 is a bridged form of USDT — each records no CoinGecko token, and none may sit on a board of protocols whose tokens have not come yet. A candidate ranks only when it records no token (gecko_id and symbol both null), its category is none of Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, its name carries no whole word wrapped, staked or staking in any case, does not end in a version marker (a space followed by V2, v2, 2.0 or the like), and does not begin with an exchange\'s name (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex or Gemini). Of the 342 protocols that record no token, 141 fail one of these tests, which is why the board holds 201 rows: only those are eligible, and padding it further would mean ranking products of tokens that already trade. A null mcap_usd still means only that the snapshot records no token — "records no token", not "has no token" — so every implied value remains a screening estimate, never a fair-value claim; tokened protocols stay comparators, shown only with the market\'s own values in the live view.',
].join('\n\n');
