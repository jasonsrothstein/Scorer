import { applyTombstones, newId, nowIso } from './doc.js';
import { captainOf, opponentChoices, pitcherPool, playersOnTeam, teamMeta } from './roster.js';

const RESULTS = {
  K: { id: 'K', label: 'Strikeout', short: 'K', group: 'primary', ab: true, so: true },
  FO: { id: 'FO', label: 'Flyout', short: 'FO', group: 'primary', ab: true },
  GO: { id: 'GO', label: 'Groundout', short: 'GO', group: 'primary', ab: true },
  '1B': { id: '1B', label: 'Single', short: '1B', group: 'primary', ab: true, hit: true, tb: 1, rbi: [0, 1, 2, 3] },
  '2B': { id: '2B', label: 'Double', short: '2B', group: 'primary', ab: true, hit: true, double: true, tb: 2, rbi: [0, 1, 2, 3] },
  '3B': { id: '3B', label: 'Triple', short: '3B', group: 'primary', ab: true, hit: true, triple: true, tb: 3, rbi: [0, 1, 2, 3] },
  HR: { id: 'HR', label: 'Home Run', short: 'HR', group: 'primary', ab: true, hit: true, hr: true, tb: 4, rbi: [1, 2, 3, 4] },
  DP: { id: 'DP', label: 'Double Play', short: 'DP', group: 'small', ab: true, gdp: true },
  BB: { id: 'BB', label: 'Walk', short: 'BB', group: 'small', bb: true },
  HBP: { id: 'HBP', label: 'Hit By Pitch', short: 'HBP', group: 'small', hbp: true },
  SF: { id: 'SF', label: 'Sac Fly', short: 'SF', group: 'small', sf: true, rbiAuto: 1 },
};

function rbiFor(result, rbi) {
  const def = RESULTS[result];
  if (!def) throw new Error('Choose a result.');
  if (def.rbiAuto != null) return def.rbiAuto;
  if (Array.isArray(def.rbi)) {
    const runs = Number(rbi);
    if (!def.rbi.includes(runs)) throw new Error('Choose how many runs scored.');
    return runs;
  }
  return 0;
}

function describeResult(pa) {
  const def = RESULTS[pa.result];
  if (!def) return pa.result;
  if (def.rbi || def.rbiAuto != null) return `${def.label}, ${pa.rbi || 0} RBI`;
  return def.label;
}

function touch(doc) {
  const updatedAt = nowIso();
  return {
    version: 1,
    updatedAt,
    runs: doc.runs.map((run) => ({ ...run })),
    games: doc.games.map((game) => ({ ...game, lineup: [...game.lineup] })),
    stints: doc.stints.map((stint) => ({ ...stint })),
    plateAppearances: doc.plateAppearances.map((pa) => ({ ...pa })),
    tombstones: doc.tombstones.map((mark) => ({ ...mark })),
  };
}

function gamePas(doc, gameId) {
  return doc.plateAppearances
    .filter((pa) => pa.gameId === gameId)
    .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
}

function gameStints(doc, gameId) {
  return doc.stints
    .filter((stint) => stint.gameId === gameId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
}

function currentPitcherId(doc, gameId) {
  const stints = gameStints(doc, gameId);
  return stints.length ? stints[stints.length - 1].pitcherId : null;
}

function nextBatterId(doc, game) {
  const count = gamePas(doc, game.id).length;
  return game.lineup[count % game.lineup.length];
}

function canUndoPitchingChange(doc, gameId) {
  const stints = gameStints(doc, gameId);
  if (stints.length < 2) return false;
  const last = stints[stints.length - 1];
  return !gamePas(doc, gameId).some((pa) => pa.seq > last.paCountBefore);
}

function requireLiveGame(doc, gameId) {
  const game = doc.games.find((item) => item.id === gameId);
  if (!game) throw new Error('Game not found.');
  if (game.status !== 'live') throw new Error('This game is locked.');
  return game;
}

function startRun(doc, teamId) {
  if (!teamMeta(teamId) || teamId === 'FINAL') throw new Error('Choose a team.');
  if (doc.runs.some((run) => run.status === 'active')) {
    throw new Error('End the current challenge before starting another.');
  }
  const next = touch(doc);
  next.runs.push({
    id: newId(),
    teamId,
    status: 'active',
    startedAt: next.updatedAt,
    endedAt: null,
    updatedAt: next.updatedAt,
  });
  return next;
}

function endRun(doc, runId) {
  const next = touch(doc);
  const run = next.runs.find((item) => item.id === runId);
  if (!run) throw new Error('Challenge not found.');
  if (run.status !== 'active') throw new Error('This challenge is already finished.');
  if (next.games.some((game) => game.runId === runId && game.status === 'live')) {
    throw new Error('Lock or abandon the current game before ending the challenge.');
  }
  run.status = 'complete';
  run.endedAt = next.updatedAt;
  run.updatedAt = next.updatedAt;
  return next;
}

function startGame(doc, { runId, opponentTeamId, lineup, pitcherId }) {
  const next = touch(doc);
  const run = next.runs.find((item) => item.id === runId);
  if (!run || run.status !== 'active') throw new Error('Start a challenge first.');
  if (next.games.some((game) => game.status === 'live')) throw new Error('Finish the current game first.');
  if (!opponentChoices(run.teamId).includes(opponentTeamId)) {
    throw new Error('That opponent is not available for this team.');
  }
  if (!Array.isArray(lineup) || lineup.length !== 9 || new Set(lineup).size !== 9) {
    throw new Error('Set all nine spots in the batting order.');
  }
  const rosterIds = new Set(playersOnTeam(run.teamId).map((player) => player.id));
  if (lineup.some((id) => !rosterIds.has(id))) throw new Error('The lineup has a player from another team.');

  const pool = pitcherPool(opponentTeamId);
  let starter = pitcherId;
  if (opponentTeamId !== 'FINAL') starter = captainOf(opponentTeamId)?.id;
  if (!pool.some((player) => player.id === starter)) throw new Error('Choose a starting pitcher.');

  const gameId = newId();
  next.games.push({
    id: gameId,
    runId,
    userTeamId: run.teamId,
    opponentTeamId,
    lineup: [...lineup],
    status: 'live',
    startedAt: next.updatedAt,
    endedAt: null,
    updatedAt: next.updatedAt,
  });
  next.stints.push({
    id: newId(),
    gameId,
    pitcherId: starter,
    paCountBefore: 0,
    createdAt: next.updatedAt,
    updatedAt: next.updatedAt,
  });
  return next;
}

function addPlateAppearance(doc, { gameId, result, rbi }) {
  const runs = rbiFor(result, rbi);
  const next = touch(doc);
  const game = requireLiveGame(next, gameId);
  const pas = gamePas(next, gameId);
  const batterId = game.lineup[pas.length % game.lineup.length];
  const pitcherId = currentPitcherId(next, gameId);
  if (!batterId || !pitcherId) throw new Error('This game is missing a batter or pitcher.');
  next.plateAppearances.push({
    id: newId(),
    gameId,
    batterId,
    pitcherId,
    result,
    rbi: runs,
    seq: pas.length + 1,
    updatedAt: next.updatedAt,
  });
  return next;
}

function updatePlateAppearance(doc, { id, result, rbi, pitcherId }) {
  const runs = rbiFor(result, rbi);
  const next = touch(doc);
  const pa = next.plateAppearances.find((item) => item.id === id);
  if (!pa) throw new Error('Plate appearance not found.');
  const game = requireLiveGame(next, pa.gameId);
  if (!pitcherPool(game.opponentTeamId).some((player) => player.id === pitcherId)) {
    throw new Error('That pitcher is not in this game.');
  }
  pa.result = result;
  pa.rbi = runs;
  pa.pitcherId = pitcherId;
  pa.updatedAt = next.updatedAt;
  return next;
}

function undoLastPlateAppearance(doc, gameId) {
  const next = touch(doc);
  requireLiveGame(next, gameId);
  const pas = gamePas(next, gameId);
  if (!pas.length) throw new Error('No plate appearance to undo.');
  next.tombstones.push({ type: 'pa', id: pas[pas.length - 1].id, deletedAt: next.updatedAt });
  return applyTombstones(next);
}

function changePitcher(doc, gameId, pitcherId) {
  const next = touch(doc);
  const game = requireLiveGame(next, gameId);
  if (!pitcherPool(game.opponentTeamId).some((player) => player.id === pitcherId)) {
    throw new Error('That pitcher is not available.');
  }
  if (currentPitcherId(next, gameId) === pitcherId) throw new Error('That pitcher is already in the game.');
  next.stints.push({
    id: newId(),
    gameId,
    pitcherId,
    paCountBefore: gamePas(next, gameId).length,
    createdAt: next.updatedAt,
    updatedAt: next.updatedAt,
  });
  return next;
}

function undoPitchingChange(doc, gameId) {
  if (!canUndoPitchingChange(doc, gameId)) throw new Error('A batter has already faced this pitcher.');
  const next = touch(doc);
  requireLiveGame(next, gameId);
  const last = gameStints(next, gameId).at(-1);
  next.tombstones.push({ type: 'stint', id: last.id, deletedAt: next.updatedAt });
  return applyTombstones(next);
}

function lockGame(doc, gameId) {
  const next = touch(doc);
  const game = next.games.find((item) => item.id === gameId);
  if (!game) throw new Error('Game not found.');
  if (game.status === 'final') return doc;
  game.status = 'final';
  game.endedAt = next.updatedAt;
  game.updatedAt = next.updatedAt;
  return next;
}

function deleteGame(doc, gameId) {
  const next = touch(doc);
  if (!next.games.some((game) => game.id === gameId)) throw new Error('Game not found.');
  const deletedAt = next.updatedAt;
  next.tombstones.push({ type: 'game', id: gameId, deletedAt });
  for (const pa of next.plateAppearances) {
    if (pa.gameId === gameId) next.tombstones.push({ type: 'pa', id: pa.id, deletedAt });
  }
  for (const stint of next.stints) {
    if (stint.gameId === gameId) next.tombstones.push({ type: 'stint', id: stint.id, deletedAt });
  }
  return applyTombstones(next);
}

export {
  RESULTS,
  addPlateAppearance,
  canUndoPitchingChange,
  changePitcher,
  currentPitcherId,
  deleteGame,
  describeResult,
  endRun,
  gamePas,
  gameStints,
  lockGame,
  nextBatterId,
  rbiFor,
  startGame,
  startRun,
  undoLastPlateAppearance,
  undoPitchingChange,
  updatePlateAppearance,
};
