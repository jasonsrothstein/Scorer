import assert from 'node:assert/strict';
import { emptyDoc, mergeDocs } from './doc.js';
import {
  addPlateAppearance,
  changePitcher,
  currentPitcherId,
  deleteGame,
  endRun,
  gamePas,
  lockGame,
  nextBatterId,
  startGame,
  startRun,
  undoLastPlateAppearance,
  updatePlateAppearance,
} from './model.js';
import {
  allTeamIds,
  finalAces,
  opponentChoices,
  pitcherPool,
  playersOnTeam,
} from './roster.js';
import { battingLines, formatOpsPlus, formatRate, pitchingLines } from './stats.js';

const teams = allTeamIds();
assert.equal(teams.length, 12);
let total = 0;
for (const team of teams) {
  const roster = playersOnTeam(team);
  assert.equal(roster.length, 9, team);
  assert.equal(new Set(roster.map((player) => player.id)).size, 9, team);
  total += roster.length;
}
assert.equal(total, 108);
assert.equal(new Set(teams.flatMap((team) => playersOnTeam(team).map((player) => player.id))).size, 108);

assert.deepEqual(finalAces().map((player) => player.name), [
  'Mario', 'Luigi', 'Peach', 'Daisy', 'Yoshi', 'Birdo', 'Donkey Kong', 'Diddy Kong', 'Wario', 'Waluigi',
]);
assert.deepEqual(opponentChoices('M'), ['P', 'Y', 'D', 'W', 'B']);
assert.deepEqual(opponentChoices('Mr'), ['P', 'Y', 'D', 'W', 'B']);
assert.deepEqual(opponentChoices('B'), ['M', 'P', 'Y', 'D', 'W', 'FINAL']);
assert.deepEqual(opponentChoices('Br'), ['M', 'P', 'Y', 'D', 'W', 'FINAL']);
assert.equal(pitcherPool('Y').length, 9);
assert.equal(pitcherPool('FINAL').length, 10);

assert.equal(formatRate(null), '.---');
assert.equal(formatRate(0), '.000');
assert.equal(formatRate(0.3), '.300');
assert.equal(formatRate(1), '1.000');
assert.equal(formatRate(1.204), '1.204');
assert.equal(formatRate(2.519), '2.519');
assert.equal(formatOpsPlus(null), '---');
assert.equal(formatOpsPlus(130.4), '130');

function lineupOf(team) {
  return playersOnTeam(team).map((player) => player.id);
}

let doc = emptyDoc();
doc = startRun(doc, 'M');
const run = doc.runs[0];
assert.throws(() => startRun(doc, 'P'), /current challenge/);
doc = startGame(doc, { runId: run.id, opponentTeamId: 'Y', lineup: lineupOf('M') });
const game = doc.games[0];
assert.equal(currentPitcherId(doc, game.id), playersOnTeam('Y').find((player) => player.name === 'Yoshi').id);
assert.throws(() => endRun(doc, run.id), /current game/);

const order = lineupOf('M');
assert.equal(nextBatterId(doc, game), order[0]);
doc = addPlateAppearance(doc, { gameId: game.id, result: 'K' });
assert.equal(nextBatterId(doc, doc.games[0]), order[1]);
doc = addPlateAppearance(doc, { gameId: game.id, result: '1B', rbi: 2 });
doc = undoLastPlateAppearance(doc, game.id);
assert.equal(gamePas(doc, game.id).length, 1);
assert.equal(nextBatterId(doc, doc.games[0]), order[1]);

assert.throws(() => addPlateAppearance(doc, { gameId: game.id, result: 'HR', rbi: 0 }), /runs scored/);
doc = addPlateAppearance(doc, { gameId: game.id, result: 'HR', rbi: 4 });
doc = addPlateAppearance(doc, { gameId: game.id, result: 'SF', rbi: 9 });
assert.equal(gamePas(doc, game.id).at(-1).rbi, 1);
doc = addPlateAppearance(doc, { gameId: game.id, result: 'BB' });
doc = addPlateAppearance(doc, { gameId: game.id, result: 'HBP' });
doc = addPlateAppearance(doc, { gameId: game.id, result: 'DP' });
doc = addPlateAppearance(doc, { gameId: game.id, result: 'FO' });
doc = addPlateAppearance(doc, { gameId: game.id, result: 'GO' });
doc = addPlateAppearance(doc, { gameId: game.id, result: '2B', rbi: 1 });
doc = addPlateAppearance(doc, { gameId: game.id, result: '3B', rbi: 0 });

const yoshi = playersOnTeam('Y').find((player) => player.name === 'Yoshi').id;
const birdo = playersOnTeam('Y').find((player) => player.name === 'Birdo').id;
doc = changePitcher(doc, game.id, birdo);
assert.throws(() => changePitcher(doc, game.id, birdo), /already/);
doc = addPlateAppearance(doc, { gameId: game.id, result: '1B', rbi: 0 });
doc = changePitcher(doc, game.id, yoshi);
const pitch = pitchingLines(doc);
const yoshiLine = pitch.find((line) => line.playerId === yoshi);
const birdoLine = pitch.find((line) => line.playerId === birdo);
assert.equal(yoshiLine.gp, 1);
assert.equal(birdoLine.gp, 1);
assert.equal(birdoLine.pa, 1);
assert.ok(yoshiLine.pa >= 1);

doc = lockGame(doc, game.id);
assert.throws(() => addPlateAppearance(doc, { gameId: game.id, result: 'K' }), /locked/);
assert.throws(() => updatePlateAppearance(doc, {
  id: gamePas(doc, game.id)[0].id,
  result: 'GO',
  pitcherId: yoshi,
}), /locked/);

doc = endRun(doc, run.id);
assert.equal(doc.runs[0].status, 'complete');
const beforeDelete = battingLines(doc).reduce((sum, line) => sum + line.pa, 0);
assert.ok(beforeDelete > 0);
doc = deleteGame(doc, game.id);
assert.equal(doc.games.length, 0);
assert.equal(doc.plateAppearances.length, 0);
assert.equal(battingLines(doc).reduce((sum, line) => sum + line.pa, 0), 0);
assert.equal(pitchingLines(doc).length, 0);

function pa(fields) {
  return {
    id: fields.id,
    gameId: fields.gameId || 'g',
    batterId: fields.batterId,
    pitcherId: fields.pitcherId,
    result: fields.result,
    rbi: fields.rbi || 0,
    seq: fields.seq || 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const mixed = emptyDoc();
const batter = lineupOf('M')[0];
const pitcher = yoshi;
const mixedResults = [
  ['K', 0], ['FO', 0], ['GO', 0], ['1B', 1], ['2B', 2], ['3B', 0], ['HR', 4], ['DP', 0], ['BB', 0], ['HBP', 0], ['SF', 1],
];
mixed.plateAppearances = mixedResults.map(([result, rbi], index) => pa({
  id: `m${index}`, batterId: batter, pitcherId: pitcher, result, rbi, seq: index + 1,
}));
const mixedLine = battingLines(mixed).find((line) => line.playerId === batter);
assert.equal(mixedLine.pa, 11);
assert.equal(mixedLine.ab, 8);
assert.equal(mixedLine.h, 4);
assert.equal(mixedLine.d2, 1);
assert.equal(mixedLine.d3, 1);
assert.equal(mixedLine.hr, 1);
assert.equal(mixedLine.rbi, 8);
assert.equal(mixedLine.bb, 1);
assert.equal(mixedLine.so, 1);
assert.equal(mixedLine.tb, 10);
assert.equal(mixedLine.gdp, 1);
assert.equal(mixedLine.hbp, 1);
assert.equal(mixedLine.sf, 1);
assert.equal(mixedLine.gp, 1);
assert.equal(mixedLine.baText, '.500');
assert.equal(mixedLine.obpText, '.545');
assert.equal(mixedLine.slgText, '1.250');
assert.equal(mixedLine.opsText, '1.795');
assert.equal(mixedLine.opsPlus, null);

const alone = emptyDoc();
alone.plateAppearances = [pa({ id: 'solo', batterId: 'a', pitcherId: 'p', result: 'HR', rbi: 1 })];
assert.equal(battingLines(alone)[0].opsPlus, null);

const zeroEnv = emptyDoc();
zeroEnv.plateAppearances = [
  pa({ id: 'k', batterId: 'Mario', pitcherId: 'Yoshi', result: 'K', gameId: 'g1' }),
  pa({ id: 's', batterId: 'Monty', pitcherId: 'Yoshi', result: '1B', rbi: 1, gameId: 'g1', seq: 2 }),
];
const zeroLines = battingLines(zeroEnv);
assert.equal(zeroLines.find((line) => line.playerId === 'Mario').opsPlus, 0);
assert.equal(zeroLines.find((line) => line.playerId === 'Monty').opsPlus, 999);

function outs(idPrefix, batterId, pitcherId, hits, total, gameId) {
  const rows = [];
  for (let index = 0; index < total; index += 1) {
    rows.push(pa({
      id: `${idPrefix}-${index}`,
      batterId,
      pitcherId,
      result: index < hits ? '1B' : 'GO',
      rbi: 0,
      seq: index + 1,
      gameId,
    }));
  }
  return rows;
}

const sym = emptyDoc();
sym.plateAppearances = [
  ...outs('a', 'A', 'P', 30, 100, 'ga'),
  ...outs('b', 'B', 'P', 30, 100, 'gb'),
];
for (const line of battingLines(sym)) {
  assert.ok(Math.abs(line.opsPlus - 100) < 0.01, line.opsPlus);
  assert.equal(formatOpsPlus(line.opsPlus), '100');
}

const heroDoc = emptyDoc();
heroDoc.plateAppearances = [
  ...outs('t', 'Other', 'Tough', 40, 200, 'gt'),
  ...outs('e', 'Other', 'Easy', 80, 200, 'ge'),
  ...outs('h', 'Hero', 'Easy', 25, 50, 'gh'),
];
const hero = battingLines(heroDoc).find((line) => line.playerId === 'Hero');
assert.equal(Math.round(hero.opsPlus), 130);
assert.equal(hero.opsText, '1.000');

const filtered = battingLines(heroDoc, { pitcherId: 'Tough' }).find((line) => line.playerId === 'Other');
assert.equal(filtered.pa, 200);
assert.equal(filtered.h, 40);

const teamOnly = battingLines(heroDoc, { onlyPlayerIds: ['Hero', 'Nobody'] });
assert.deepEqual(teamOnly.map((line) => line.playerId).sort(), ['Hero', 'Nobody']);
assert.equal(teamOnly.find((line) => line.playerId === 'Nobody').pa, 0);
assert.equal(teamOnly.find((line) => line.playerId === 'Nobody').baText, '.---');

const left = emptyDoc();
left.updatedAt = '2026-01-01T00:00:00.000Z';
left.games = [{ id: 'g1', runId: 'r', userTeamId: 'M', opponentTeamId: 'Y', lineup: [], status: 'final', startedAt: left.updatedAt, endedAt: left.updatedAt, updatedAt: left.updatedAt }];
left.plateAppearances = [pa({ id: 'p1', gameId: 'g1', batterId: 'a', pitcherId: 'b', result: '1B' })];
const right = emptyDoc();
right.updatedAt = '2026-02-01T00:00:00.000Z';
right.games = [{ id: 'g2', runId: 'r', userTeamId: 'P', opponentTeamId: 'D', lineup: [], status: 'final', startedAt: right.updatedAt, endedAt: right.updatedAt, updatedAt: right.updatedAt }];
const merged = mergeDocs(left, right);
assert.equal(merged.games.length, 2);
assert.equal(merged.plateAppearances.length, 1);

const deleted = emptyDoc();
deleted.tombstones = [{ type: 'game', id: 'g1', deletedAt: '2026-03-01T00:00:00.000Z' }];
const afterDelete = mergeDocs(merged, deleted);
assert.equal(afterDelete.games.some((game) => game.id === 'g1'), false);
assert.equal(afterDelete.plateAppearances.length, 0);
assert.equal(afterDelete.games.length, 1);

const newerEdit = emptyDoc();
newerEdit.games = [{ id: 'g1', updatedAt: '2026-04-01T00:00:00.000Z', status: 'final', lineup: [] }];
const stillDead = mergeDocs(afterDelete, newerEdit);
assert.equal(stillDead.games.some((game) => game.id === 'g1'), false);

console.log('selftest ok');
