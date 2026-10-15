import { RESULTS } from './model.js';

// A pitcher's own results are blended with this many average plate appearances
// (and the same number of at-bats for slugging) so a tiny sample does not
// define the expectation by itself.
export const SHRINKAGE_PA = 40;

function blankRate() {
  return { pa: 0, ab: 0, h: 0, bb: 0, hbp: 0, tb: 0 };
}

function freshCounts() {
  return {
    games: new Set(),
    pa: 0,
    ab: 0,
    h: 0,
    d2: 0,
    d3: 0,
    hr: 0,
    rbi: 0,
    bb: 0,
    so: 0,
    tb: 0,
    gdp: 0,
    hbp: 0,
    sf: 0,
  };
}

function absorb(counts, pa) {
  const def = RESULTS[pa.result];
  if (!def) return;
  counts.games.add(pa.gameId);
  counts.pa += 1;
  if (def.ab) counts.ab += 1;
  if (def.hit) counts.h += 1;
  if (def.double) counts.d2 += 1;
  if (def.triple) counts.d3 += 1;
  if (def.hr) counts.hr += 1;
  if (def.tb) counts.tb += def.tb;
  if (def.bb) counts.bb += 1;
  if (def.so) counts.so += 1;
  if (def.gdp) counts.gdp += 1;
  if (def.hbp) counts.hbp += 1;
  if (def.sf) counts.sf += 1;
  counts.rbi += Number(pa.rbi) || 0;
}

function addRate(bucket, pa) {
  const def = RESULTS[pa.result];
  if (!def) return;
  bucket.pa += 1;
  if (def.ab) bucket.ab += 1;
  if (def.hit) bucket.h += 1;
  if (def.bb) bucket.bb += 1;
  if (def.hbp) bucket.hbp += 1;
  if (def.tb) bucket.tb += def.tb;
}

function subtractRate(total, part) {
  return {
    pa: total.pa - part.pa,
    ab: total.ab - part.ab,
    h: total.h - part.h,
    bb: total.bb - part.bb,
    hbp: total.hbp - part.hbp,
    tb: total.tb - part.tb,
  };
}

function obpOf(bucket) {
  if (!bucket.pa) return null;
  return (bucket.h + bucket.bb + bucket.hbp) / bucket.pa;
}

function slgOf(bucket) {
  if (!bucket.ab) return null;
  return bucket.tb / bucket.ab;
}

function shrunk(sampleSize, sampleRate, priorRate) {
  if (priorRate == null && (sampleRate == null || sampleSize === 0)) return null;
  if (priorRate == null) return sampleRate;
  const size = sampleRate == null ? 0 : sampleSize;
  const rate = sampleRate == null ? 0 : sampleRate;
  return (size * rate + SHRINKAGE_PA * priorRate) / (size + SHRINKAGE_PA);
}

function validPas(doc) {
  return doc.plateAppearances.filter((pa) => RESULTS[pa.result]);
}

function buildIndexes(pas) {
  const league = blankRate();
  const batter = new Map();
  const pitcher = new Map();
  const batterPitcher = new Map();
  for (const pa of pas) {
    addRate(league, pa);
    if (!batter.has(pa.batterId)) batter.set(pa.batterId, blankRate());
    addRate(batter.get(pa.batterId), pa);
    if (!pitcher.has(pa.pitcherId)) pitcher.set(pa.pitcherId, blankRate());
    addRate(pitcher.get(pa.pitcherId), pa);
    if (!batterPitcher.has(pa.batterId)) batterPitcher.set(pa.batterId, new Map());
    const splits = batterPitcher.get(pa.batterId);
    if (!splits.has(pa.pitcherId)) splits.set(pa.pitcherId, blankRate());
    addRate(splits.get(pa.pitcherId), pa);
  }
  return { league, batter, pitcher, batterPitcher };
}

function environment(pitcherId, batterId, indexes) {
  const league = subtractRate(indexes.league, indexes.batter.get(batterId) || blankRate());
  const pitcherRates = indexes.pitcher.get(pitcherId) || blankRate();
  const own = indexes.batterPitcher.get(batterId)?.get(pitcherId) || blankRate();
  const rest = subtractRate(pitcherRates, own);
  return {
    obp: shrunk(rest.pa, obpOf(rest), obpOf(league)),
    slg: shrunk(rest.ab, slgOf(rest), slgOf(league)),
  };
}

function ratesFromCounts(counts) {
  const ba = counts.ab ? counts.h / counts.ab : null;
  const obp = counts.pa ? (counts.h + counts.bb + counts.hbp) / counts.pa : null;
  const slg = counts.ab ? counts.tb / counts.ab : null;
  const ops = obp != null && slg != null ? obp + slg : null;
  return { ba, obp, slg, ops };
}

function opsPlusFor(counts, splits, batterId, indexes) {
  const actual = ratesFromCounts(counts);
  if (actual.ops == null) return null;
  let obpNum = 0;
  let obpDen = 0;
  let slgNum = 0;
  let slgDen = 0;
  for (const [pitcherId, split] of splits) {
    const env = environment(pitcherId, batterId, indexes);
    if (env.obp != null && split.pa) {
      obpNum += split.pa * env.obp;
      obpDen += split.pa;
    }
    if (env.slg != null && split.ab) {
      slgNum += split.ab * env.slg;
      slgDen += split.ab;
    }
  }
  const expObp = obpDen ? obpNum / obpDen : null;
  const expSlg = slgDen ? slgNum / slgDen : null;
  if (expObp == null || expSlg == null) return null;
  const expOps = expObp + expSlg;
  if (expOps === 0) return actual.ops > 0 ? 999 : null;
  return (100 * actual.ops) / expOps;
}

function eraOf(counts) {
  const outs = counts.pa - counts.h - counts.bb - counts.hbp + counts.gdp;
  if (outs <= 0) return null;
  return (27 * counts.rbi) / outs;
}

function finishLine(playerId, counts, opsPlus) {
  const rates = ratesFromCounts(counts);
  return {
    playerId,
    gp: counts.games.size,
    pa: counts.pa,
    ab: counts.ab,
    h: counts.h,
    d2: counts.d2,
    d3: counts.d3,
    hr: counts.hr,
    rbi: counts.rbi,
    bb: counts.bb,
    so: counts.so,
    tb: counts.tb,
    gdp: counts.gdp,
    hbp: counts.hbp,
    sf: counts.sf,
    ...rates,
    opsPlus,
    baText: formatRate(rates.ba),
    obpText: formatRate(rates.obp),
    slgText: formatRate(rates.slg),
    opsText: formatRate(rates.ops),
    opsPlusText: formatOpsPlus(opsPlus),
  };
}

function battingLines(doc, { pitcherId = null, onlyPlayerIds = null } = {}) {
  const all = validPas(doc);
  const indexes = buildIndexes(all);
  const shown = all.filter((pa) => !pitcherId || pa.pitcherId === pitcherId);
  const counts = new Map();
  const splits = new Map();
  const ids = onlyPlayerIds ? [...onlyPlayerIds] : [];
  for (const id of ids) {
    counts.set(id, freshCounts());
    splits.set(id, new Map());
  }
  for (const pa of shown) {
    if (onlyPlayerIds && !counts.has(pa.batterId)) continue;
    if (!counts.has(pa.batterId)) counts.set(pa.batterId, freshCounts());
    absorb(counts.get(pa.batterId), pa);
    if (!splits.has(pa.batterId)) splits.set(pa.batterId, new Map());
    const playerSplits = splits.get(pa.batterId);
    if (!playerSplits.has(pa.pitcherId)) playerSplits.set(pa.pitcherId, blankRate());
    addRate(playerSplits.get(pa.pitcherId), pa);
  }
  return [...counts.entries()].map(([playerId, line]) => (
    finishLine(playerId, line, opsPlusFor(line, splits.get(playerId) || new Map(), playerId, indexes))
  ));
}

function battingSummary(doc, { pitcherId = null, onlyPlayerIds = null } = {}) {
  const all = validPas(doc);
  const indexes = buildIndexes(all);
  const allowed = onlyPlayerIds ? new Set(onlyPlayerIds) : null;
  const shown = all.filter((pa) => (!pitcherId || pa.pitcherId === pitcherId) && (!allowed || allowed.has(pa.batterId)));
  const counts = freshCounts();
  let obpNum = 0;
  let obpDen = 0;
  let slgNum = 0;
  let slgDen = 0;
  for (const pa of shown) {
    absorb(counts, pa);
    const env = environment(pa.pitcherId, pa.batterId, indexes);
    if (env.obp != null) {
      obpNum += env.obp;
      obpDen += 1;
    }
    if (env.slg != null && RESULTS[pa.result].ab) {
      slgNum += env.slg;
      slgDen += 1;
    }
  }
  const rates = ratesFromCounts(counts);
  const expObp = obpDen ? obpNum / obpDen : null;
  const expSlg = slgDen ? slgNum / slgDen : null;
  const expOps = expObp != null && expSlg != null ? expObp + expSlg : null;
  const opsPlus = rates.ops != null && expOps ? (100 * rates.ops) / expOps : null;
  return finishLine('total', counts, opsPlus);
}

function pitchingLines(doc) {
  const apps = new Map();
  function mark(pitcherId, gameId) {
    if (!pitcherId || !gameId) return;
    if (!apps.has(pitcherId)) apps.set(pitcherId, new Set());
    apps.get(pitcherId).add(gameId);
  }
  for (const stint of doc.stints) mark(stint.pitcherId, stint.gameId);
  const counts = new Map();
  for (const pa of validPas(doc)) {
    mark(pa.pitcherId, pa.gameId);
    if (!counts.has(pa.pitcherId)) counts.set(pa.pitcherId, freshCounts());
    absorb(counts.get(pa.pitcherId), pa);
  }
  return [...apps.entries()].map(([playerId, games]) => {
    const raw = counts.get(playerId) || freshCounts();
    const line = finishLine(playerId, raw, null);
    const era = eraOf(raw);
    line.gp = games.size;
    line.era = era;
    line.eraText = formatEra(era);
    return line;
  });
}

function formatRate(value) {
  if (value == null || !Number.isFinite(value)) return '.---';
  const millis = Math.round(Math.abs(value) * 1000 + 1e-8);
  const whole = Math.floor(millis / 1000);
  const frac = String(millis % 1000).padStart(3, '0');
  const text = `${whole}.${frac}`;
  return text.startsWith('0.') ? text.slice(1) : text;
}

function formatEra(value) {
  if (value == null || !Number.isFinite(value)) return '-.--';
  const rounded = Math.round((Math.max(value, 0) + Number.EPSILON) * 100) / 100;
  return rounded.toFixed(2);
}

function formatOpsPlus(value) {
  if (value == null || !Number.isFinite(value)) return '---';
  return String(Math.round(value));
}

export {
  battingLines,
  battingSummary,
  formatEra,
  formatOpsPlus,
  formatRate,
  pitchingLines,
};
