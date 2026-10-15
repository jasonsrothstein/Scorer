import {
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
  startGame,
  startRun,
  undoLastPlateAppearance,
  undoPitchingChange,
  updatePlateAppearance,
} from './model.js';
import {
  allTeamIds,
  opponentChoices,
  pitcherPool,
  pitcherRole,
  playerById,
  playersOnTeam,
  teamMeta,
} from './roster.js';
import { SHRINKAGE_PA, battingLines, battingSummary, pitchingLines } from './stats.js';
import {
  boot,
  commit,
  exportDoc,
  getDoc,
  getSettingsPublic,
  getSync,
  importDoc,
  pull,
  subscribe,
  updateSettings,
} from './store.js';

const app = document.querySelector('#app');
const ui = {
  error: '',
  modal: null,
  sheet: null,
  pendingResult: null,
  edit: null,
  player: null,
  draft: null,
  formReady: false,
  form: { owner: '', repo: '', branch: 'main', token: '' },
  booting: true,
  stats: {
    scope: 'team',
    teamId: '',
    pitcherId: '',
    sort: 'opsPlus',
    dir: 'desc',
    query: '',
  },
};

let lastRoute = '';
let lastTap = 0;

const BAT_COLS = [
  ['name', 'Player'],
  ['team', 'Tm'],
  ['gp', 'GP'],
  ['pa', 'PA'],
  ['ab', 'AB'],
  ['h', 'H'],
  ['d2', '2B'],
  ['d3', '3B'],
  ['hr', 'HR'],
  ['rbi', 'RBI'],
  ['bb', 'BB'],
  ['so', 'SO'],
  ['tb', 'TB'],
  ['gdp', 'GDP'],
  ['hbp', 'HBP'],
  ['sf', 'SF'],
  ['ba', 'BA'],
  ['obp', 'OBP'],
  ['slg', 'SLG'],
  ['ops', 'OPS'],
  ['opsPlus', 'OPS+'],
];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function parseHash() {
  const parts = (location.hash.replace(/^#/, '') || '/').split('/').filter(Boolean);
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'new') return { name: 'new-run' };
  if (parts[0] === 'run' && parts[2] === 'new') return { name: 'new-game', runId: parts[1] };
  if (parts[0] === 'run') return { name: 'run', runId: parts[1] };
  if (parts[0] === 'game' && parts[2] === 'review') return { name: 'review', gameId: parts[1] };
  if (parts[0] === 'game' && parts[2] === 'plays') return { name: 'plays', gameId: parts[1] };
  if (parts[0] === 'game') return { name: 'game', gameId: parts[1] };
  if (parts[0] === 'stats') return { name: 'stats' };
  if (parts[0] === 'history') return { name: 'history', runId: parts[1] || '' };
  if (parts[0] === 'settings') return { name: 'settings' };
  return { name: 'home' };
}

function formatWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function findGame(id) {
  return getDoc().games.find((game) => game.id === id) || null;
}

function findRun(id) {
  return getDoc().runs.find((run) => run.id === id) || null;
}

function liveGame() {
  return getDoc().games.find((game) => game.status === 'live') || null;
}

function playTarget() {
  const live = liveGame();
  if (live) return `#/game/${live.id}`;
  const active = getDoc().runs.filter((run) => run.status === 'active');
  if (active.length === 1) return `#/run/${active[0].id}`;
  return '#/';
}

function tryCommit(build, when = 'soon') {
  try {
    commit(build(getDoc()), when);
    ui.error = '';
    return true;
  } catch (error) {
    ui.error = error.message || 'Something went wrong.';
    render();
    return false;
  }
}

function ask({ title, body, confirm, danger = false }) {
  return new Promise((resolve) => {
    ui.modal = { title, body, confirm, danger, resolve };
    render();
  });
}

function closeModal(answer) {
  const resolve = ui.modal?.resolve;
  ui.modal = null;
  if (resolve) resolve(answer);
  render();
}

function tooFast() {
  const now = Date.now();
  if (now - lastTap < 400) return true;
  lastTap = now;
  return false;
}

function syncLabel() {
  const sync = getSync();
  const configured = getSettingsPublic().hasToken && getSettingsPublic().owner;
  if (!configured) return 'On this phone';
  if (sync.phase === 'syncing') return 'Syncing…';
  if (sync.phase === 'error') return 'Sync failed';
  if (sync.dirty || sync.phase === 'pending') return 'Saved here';
  if (sync.phase === 'synced') return 'Synced';
  return 'On this phone';
}

function pageTitle(route) {
  if (route.name === 'stats') return 'Stats';
  if (route.name === 'history') return 'Challenges';
  if (route.name === 'settings') return 'Sync';
  if (route.name === 'new-run') return 'New challenge';
  if (route.name === 'new-game') return 'New game';
  if (route.name === 'review') return 'Review game';
  if (route.name === 'plays') return 'Plays';
  return 'Scorebook';
}

function teamButton(teamId, action, selected) {
  const team = teamMeta(teamId);
  const tone = team.id === 'FINAL' ? 'final' : team.baseId;
  const wide = team.id === 'FINAL' ? ' wide' : '';
  const rev = team.reversed ? '<span class="rev">Reversed</span>' : '';
  const sub = team.id === 'FINAL' ? '<span class="rev">Captains and No. 2s</span>' : rev;
  return `<button type="button" class="team-card team-${tone}${wide}${selected ? ' is-selected' : ''}" style="--c:${team.color};--ink:${team.ink}" data-action="${action}" data-team="${team.id}" aria-pressed="${selected ? 'true' : 'false'}">
    <span class="code">${esc(team.code)}</span>
    <span class="team-name">${esc(team.name)}</span>
    ${sub}
  </button>`;
}

function resultButtons(action, selected) {
  const primary = [
    ['K', 'Strikeout', 'out'],
    ['FO', 'Flyout', 'out'],
    ['GO', 'Groundout', 'out'],
    ['1B', 'Single', 'hit-1'],
    ['2B', 'Double', 'hit-2'],
    ['3B', 'Triple', 'hit-3'],
    ['HR', 'Home Run', 'hit-4 span'],
  ];
  const small = [
    ['DP', 'Double Play'],
    ['BB', 'Walk'],
    ['HBP', 'Hit By Pitch'],
    ['SF', 'Sac Fly'],
  ];
  const main = primary.map(([id, label, tone]) => (
    `<button type="button" class="result ${tone}${selected === id ? ' is-selected' : ''}" data-action="${action}" data-result="${id}">${label}</button>`
  )).join('');
  const extra = small.map(([id, label]) => (
    `<button type="button" class="result small-result${selected === id ? ' is-selected' : ''}" data-action="${action}" data-result="${id}">${label}</button>`
  )).join('');
  return `<div class="result-grid">${main}</div><div class="small-grid">${extra}</div>`;
}

function rbiButtons(result, action) {
  return RESULTS[result].rbi.map((runs) => (
    `<button type="button" class="rbi" data-action="${action}" data-rbi="${runs}">${runs}</button>`
  )).join('');
}

function pitcherRows(players, action, currentId, selectedId) {
  return players.map((player) => {
    const team = teamMeta(player.team);
    const role = pitcherRole(player);
    const current = player.id === currentId;
    const selected = player.id === selectedId;
    return `<button type="button" class="list-row${selected ? ' is-selected' : ''}" data-action="${action}" data-pitcher="${player.id}" ${current ? 'disabled' : ''}>
      <span class="swatch" style="background:${team.color}"></span>
      <span class="list-copy">
        <strong>${esc(player.name)}</strong>
        <small>${esc(team.label)}${role ? ` · ${esc(role)}` : ''}${current ? ' · Pitching now' : ''}</small>
      </span>
    </button>`;
  }).join('');
}

function matchup(game) {
  const ours = teamMeta(game.userTeamId).label;
  const theirs = game.opponentTeamId === 'FINAL' ? 'Final' : teamMeta(game.opponentTeamId).label;
  return `${ours} vs ${theirs}`;
}

function playRows(game, editable) {
  const doc = getDoc();
  const pas = gamePas(doc, game.id);
  if (!pas.length) return '<p class="empty">No plate appearances yet.</p>';
  return `<ol class="plays">${pas.map((pa) => {
    const batter = playerById(pa.batterId);
    const pitcher = playerById(pa.pitcherId);
    const spot = ((pa.seq - 1) % 9) + 1;
    const inner = `<span class="play-main">${spot}. ${esc(batter?.name || 'Batter')}</span><span class="play-sub">${esc(describeResult(pa))} · ${esc(pitcher?.name || 'Pitcher')}</span>`;
    if (!editable) return `<li>${inner}</li>`;
    return `<li><button type="button" data-action="edit-pa" data-pa="${pa.id}">${inner}</button></li>`;
  }).join('')}</ol>`;
}

function viewStart(doc) {
  const recent = [...doc.runs].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 3);
  const history = recent.length ? `<section class="block">
    <h2>Recent challenges</h2>
    ${recent.map((run) => {
      const games = doc.games.filter((game) => game.runId === run.id).length;
      return `<button type="button" class="list-row" data-action="go" data-hash="#/history/${run.id}">
        <span class="list-copy"><strong>${esc(teamMeta(run.teamId).label)}</strong><small>${games} game${games === 1 ? '' : 's'} · ${esc(formatWhen(run.startedAt))}</small></span>
      </button>`;
    }).join('')}
  </section>` : '';
  return `<section class="hero">
    <p class="lede">Track every Challenge Mode at-bat, then sort the leaderboard when the run is over.</p>
    <button type="button" class="primary" data-action="go" data-hash="#/new">New challenge</button>
  </section>${history}`;
}

function viewRunPicker(runs) {
  return `<section class="block"><h2>Open challenges</h2>
    ${runs.map((run) => `<button type="button" class="list-row" data-action="go" data-hash="#/run/${run.id}"><span class="list-copy"><strong>${esc(teamMeta(run.teamId).label)}</strong><small>Started ${esc(formatWhen(run.startedAt))}</small></span></button>`).join('')}
  </section>`;
}

function viewRun(run) {
  const doc = getDoc();
  const games = doc.games.filter((game) => game.runId === run.id).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const live = games.find((game) => game.status === 'live');
  const team = teamMeta(run.teamId);
  const actions = run.status === 'active'
    ? `${live
      ? `<button type="button" class="primary" data-action="go" data-hash="#/game/${live.id}">Resume game</button>`
      : `<button type="button" class="primary" data-action="go" data-hash="#/run/${run.id}/new">Start game</button>`}
      <button type="button" class="quiet" data-action="end-run" data-run="${run.id}">End challenge</button>`
    : `<p class="note">This challenge is finished. Its games stay on the leaderboard.</p>
      <button type="button" class="primary" data-action="go" data-hash="#/new">New challenge</button>`;
  const list = games.length ? games.map((game) => {
    const count = gamePas(doc, game.id).length;
    const badge = game.status === 'live' ? 'Live' : 'Locked';
    return `<button type="button" class="list-row" data-action="go" data-hash="#/game/${game.id}">
      <span class="list-copy"><strong>${esc(matchup(game))}</strong><small>${badge} · ${count} PA · ${esc(formatWhen(game.startedAt))}</small></span>
    </button>`;
  }).join('') : '<p class="empty">No games in this challenge yet.</p>';
  return `<section class="team-banner" style="--c:${team.color};--ink:${team.ink}">
    <p class="code">${esc(team.code)}</p>
    <h2>${esc(team.label)}</h2>
  </section>
  <div class="stack">${actions}</div>
  <section class="block"><h2>Games</h2>${list}</section>`;
}

function ensureDraft(runId) {
  if (!ui.draft || ui.draft.runId !== runId) {
    ui.draft = { runId, opponentTeamId: null, pitcherId: null, lineup: [] };
  }
  return ui.draft;
}

function viewNewRun() {
  const cards = allTeamIds().map((id) => teamButton(id, 'start-run', false)).join('');
  return `<section class="block"><h2>Which team are you using?</h2><div class="team-grid">${cards}</div></section>`;
}

function viewNewGame(run) {
  const draft = ensureDraft(run.id);
  const options = opponentChoices(run.teamId);
  const roster = playersOnTeam(run.teamId);
  const remaining = roster.filter((player) => !draft.lineup.includes(player.id));
  const slots = Array.from({ length: 9 }, (_, index) => {
    const id = draft.lineup[index];
    if (!id) return `<li class="slot empty"><span class="slot-no">${index + 1}</span><span>Empty</span></li>`;
    const player = playerById(id);
    return `<li><button type="button" data-action="lineup-remove" data-player="${id}"><span class="slot-no">${index + 1}</span>${esc(player.name)}</button></li>`;
  }).join('');
  const ready = draft.lineup.length === 9 && draft.opponentTeamId && (draft.opponentTeamId !== 'FINAL' || draft.pitcherId);
  const pitchers = draft.opponentTeamId === 'FINAL'
    ? `<section class="block"><h2>Starting pitcher</h2><div class="stack">${pitcherRows(pitcherPool('FINAL'), 'pick-starter', '', draft.pitcherId)}</div></section>`
    : '';
  return `<button type="button" class="back" data-action="go" data-hash="#/run/${run.id}">Back to challenge</button>
    <section class="block"><h2>Opponent</h2><div class="team-grid">${options.map((id) => teamButton(id, 'pick-opponent', draft.opponentTeamId === id)).join('')}</div></section>
    ${pitchers}
    <section class="block">
      <div class="row-title"><h2>Batting order</h2><button type="button" class="text-button" data-action="lineup-clear">Clear</button></div>
      <p class="note">Tap the remaining players in the order they will hit. Tap a spot to remove that player.</p>
      <ol class="lineup">${slots}</ol>
      <div class="chip-wrap">${remaining.map((player) => `<button type="button" class="chip" data-action="lineup-add" data-player="${player.id}">${esc(player.name)}</button>`).join('')}</div>
    </section>
    <button type="button" class="primary" data-action="begin-game" ${ready ? '' : 'disabled'}>Start game</button>`;
}

function viewAtBat(game) {
  const doc = getDoc();
  const pas = gamePas(doc, game.id);
  const batter = playerById(nextBatterId(doc, game));
  const pitcher = playerById(currentPitcherId(doc, game.id));
  const spot = (pas.length % 9) + 1;
  const rbiTotal = pas.reduce((sum, pa) => sum + (pa.rbi || 0), 0);
  const ours = teamMeta(game.userTeamId);
  const order = game.lineup.map((id, index) => {
    const player = playerById(id);
    const now = index === pas.length % 9;
    return `<li class="${now ? 'is-now' : ''}"><span>${index + 1}</span>${esc(player?.name || '')}</li>`;
  }).join('');
  const last = pas.at(-1);
  const undo = last ? `<div class="undo-bar"><span>Last: ${esc(playerById(last.batterId)?.name || '')}, ${esc(describeResult(last))}</span><button type="button" data-action="undo-pa">Undo</button></div>` : '';
  const stints = gameStints(doc, game.id);
  const previous = stints.length > 1 ? playerById(stints[stints.length - 2].pitcherId) : null;
  const undoPitch = canUndoPitchingChange(doc, game.id) && previous
    ? `<button type="button" class="text-button" data-action="undo-pitch">Back to ${esc(previous.name)}</button>`
    : '';
  const prompt = ui.pendingResult ? `<section class="panel">
      <h2>How many runs scored?</h2>
      <p class="note">${esc(RESULTS[ui.pendingResult].label)}. This is recorded as RBI.</p>
      <div class="rbi-grid">${rbiButtons(ui.pendingResult, 'rbi')}</div>
      <button type="button" class="text-button" data-action="rbi-back">Back</button>
    </section>` : `<section class="panel">${resultButtons('result')}</section>`;
  return `<div class="atbat" style="--c:${ours.color};--ink:${ours.ink}">
      <div class="atbat-top">
        <button type="button" class="text-button light" data-action="go" data-hash="#/run/${game.runId}">Challenge</button>
        <button type="button" class="text-button light" data-action="go" data-hash="#/game/${game.id}/plays">Plays</button>
      </div>
      <p class="meta">vs ${esc(game.opponentTeamId === 'FINAL' ? 'Final' : teamMeta(game.opponentTeamId).label)} · Pitching ${esc(pitcher?.name || '—')} · RBI ${rbiTotal}</p>
      <ol class="order-strip">${order}</ol>
      <p class="spot">No. ${spot} · PA ${pas.length + 1}</p>
      <h2 class="batter-name">${esc(batter?.name || 'Batter')}</h2>
    </div>
    ${undo}
    ${prompt}
    <div class="action-row">
      <button type="button" data-action="show-pitch">Pitching change</button>
      <button type="button" class="solid" data-action="go" data-hash="#/game/${game.id}/review">End game</button>
    </div>
    ${undoPitch}`;
}

function viewReview(game) {
  return `<button type="button" class="back" data-action="resume">Resume game</button>
    <section class="block">
      <h2>${esc(matchup(game))}</h2>
      <p class="note">Fix any plate appearance, then lock the game. After locking, the plays stay as they are unless you delete the whole game.</p>
      ${playRows(game, true)}
    </section>
    <div class="stack">
      <button type="button" class="primary" data-action="lock-game" data-game="${game.id}">Lock game</button>
      <button type="button" class="danger-text" data-action="abandon" data-game="${game.id}">Abandon game</button>
    </div>`;
}

function viewPlays(game) {
  const editable = game.status === 'live';
  return `<button type="button" class="back" data-action="go" data-hash="#/game/${game.id}">Back to at-bat</button>
    <section class="block"><h2>${esc(matchup(game))}</h2>${playRows(game, editable)}</section>
    ${editable ? `<button type="button" class="danger-text" data-action="abandon" data-game="${game.id}">Abandon game</button>` : ''}`;
}

function viewFinal(game) {
  const doc = getDoc();
  const starter = playerById(gameStints(doc, game.id)[0]?.pitcherId);
  const count = gamePas(doc, game.id).length;
  return `<button type="button" class="back" data-action="go" data-hash="#/run/${game.runId}">Back to challenge</button>
    <section class="block">
      <h2>${esc(matchup(game))}</h2>
      <p class="note">Locked · ${count} PA · Started ${esc(starter?.name || '—')} · ${esc(formatWhen(game.endedAt || game.startedAt))}</p>
      ${playRows(game, false)}
    </section>
    <button type="button" class="danger-text" data-action="delete-game" data-game="${game.id}">Delete this game</button>`;
}

function defaultTeamId(doc) {
  const active = doc.runs.find((run) => run.status === 'active');
  if (active) return active.teamId;
  const latest = [...doc.runs].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
  return latest?.teamId || 'M';
}

function decorate(line) {
  const player = playerById(line.playerId);
  return {
    ...line,
    name: player?.name || 'Unknown player',
    team: player ? teamMeta(player.team).code : '',
  };
}

function compareRows(a, b, key, dir) {
  const av = a[key];
  const bv = b[key];
  const aMissing = av == null || av === '';
  const bMissing = bv == null || bv === '';
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return a.name.localeCompare(b.name);
    return aMissing ? 1 : -1;
  }
  let diff = 0;
  if (typeof av === 'number' && typeof bv === 'number') diff = av - bv;
  else diff = String(av).localeCompare(String(bv), undefined, { numeric: true });
  if (!diff) return a.name.localeCompare(b.name);
  return dir === 'asc' ? diff : -diff;
}

function statCell(row, key) {
  if (key === 'ba') return row.baText;
  if (key === 'obp') return row.obpText;
  if (key === 'slg') return row.slgText;
  if (key === 'ops') return row.opsText;
  if (key === 'opsPlus') return row.opsPlusText;
  if (key === 'name') return esc(row.name);
  return esc(row[key] ?? '');
}

function viewStats() {
  const doc = getDoc();
  const scope = ui.stats.scope;
  const teamId = ui.stats.teamId || defaultTeamId(doc);
  const pitcherId = ui.stats.pitcherId;
  const pitching = pitchingLines(doc).map(decorate).filter((line) => line.pa > 0 || line.gp > 0);
  const groups = new Map();
  for (const line of [...pitching].sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name))) {
    const player = playerById(line.playerId);
    const label = player ? teamMeta(player.team).label : 'Other';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(line);
  }
  const pitcherOptions = [...groups.entries()].map(([label, lines]) => (
    `<optgroup label="${esc(label)}">${lines.map((line) => `<option value="${line.playerId}"${line.playerId === pitcherId ? ' selected' : ''}>${esc(line.name)}</option>`).join('')}</optgroup>`
  )).join('');
  const teamOptions = allTeamIds().map((id) => {
    const team = teamMeta(id);
    return `<option value="${id}"${id === teamId ? ' selected' : ''}>${esc(team.label)}</option>`;
  }).join('');
  const columns = scope === 'pitch'
    ? BAT_COLS.filter(([key]) => key !== 'opsPlus').map(([key, label]) => {
      const renamed = { gp: 'APP', pa: 'BF', so: 'K', gdp: 'DP' };
      return [key, renamed[key] || label];
    })
    : BAT_COLS;
  let rows = [];
  let summary = null;
  let summaryPlus = false;
  if (scope === 'pitch') {
    rows = pitching;
  } else {
    const only = scope === 'team' ? playersOnTeam(teamId).map((player) => player.id) : null;
    rows = battingLines(doc, { pitcherId: pitcherId || null, onlyPlayerIds: only }).map(decorate);
    if (scope === 'all') rows = rows.filter((row) => row.pa > 0);
    summary = battingSummary(doc, { pitcherId: pitcherId || null, onlyPlayerIds: only });
    summaryPlus = scope === 'team' || Boolean(pitcherId);
  }
  const query = ui.stats.query.trim().toLowerCase();
  if (query) rows = rows.filter((row) => row.name.toLowerCase().includes(query));
  const sorted = [...rows].sort((a, b) => compareRows(a, b, ui.stats.sort, ui.stats.dir));
  const head = columns.map(([key, label]) => {
    const mark = ui.stats.sort === key ? (ui.stats.dir === 'asc' ? ' ↑' : ' ↓') : '';
    const numeric = key !== 'name';
    return `<th class="${numeric ? 'num' : 'name'}" scope="col" aria-sort="${ui.stats.sort === key ? (ui.stats.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" data-action="sort" data-key="${key}">${label}${mark}</button></th>`;
  }).join('');
  const body = sorted.length ? sorted.map((row) => (
    `<tr data-action="open-player" data-player="${row.playerId}" data-side="${scope === 'pitch' ? 'pitch' : 'bat'}">${columns.map(([key]) => `<td class="${key === 'name' ? 'name' : 'num'}">${statCell(row, key)}</td>`).join('')}</tr>`
  )).join('') : `<tr><td class="empty-cell" colspan="${columns.length}">No stats for this view yet.</td></tr>`;
  const summaryHtml = summary && summary.pa ? `<p class="summary"><strong>${summary.pa}</strong> PA · <strong>${summary.gp}</strong> GP · <strong>${esc(summary.baText)}</strong> BA · <strong>${esc(summary.obpText)}</strong> OBP · <strong>${esc(summary.slgText)}</strong> SLG · <strong>${esc(summary.opsText)}</strong> OPS${summaryPlus ? ` · <strong>${esc(summary.opsPlusText)}</strong> OPS+` : ''}</p>` : '';
  const filters = scope === 'pitch' ? '' : `<label class="field">Against
      <select id="stat-pitcher"><option value="">All pitchers</option>${pitcherOptions}</select>
    </label>`;
  const teamFilter = scope === 'team' ? `<label class="field">Team
      <select id="stat-team">${teamOptions}</select>
    </label>` : '';
  return `<div class="segment">
      <button type="button" data-action="scope" data-scope="team" class="${scope === 'team' ? 'is-on' : ''}">Team</button>
      <button type="button" data-action="scope" data-scope="all" class="${scope === 'all' ? 'is-on' : ''}">All hitters</button>
      <button type="button" data-action="scope" data-scope="pitch" class="${scope === 'pitch' ? 'is-on' : ''}">Pitching</button>
    </div>
    <div class="filter-row">
      ${teamFilter}
      ${filters}
      <label class="field">Search
        <input id="stat-search" type="search" placeholder="Player name" value="${esc(ui.stats.query)}">
      </label>
    </div>
    ${summaryHtml}
    <p class="swipe">Swipe sideways for every stat. Tap a row for a closer look.</p>
    <div class="table-wrap">
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <details class="help"><summary>What the columns mean</summary>
      <p>GP games played, PA plate appearances, AB at-bats, H hits, 2B doubles, 3B triples, HR home runs, RBI runs batted in, BB walks, SO strikeouts, TB total bases, GDP double plays, HBP hit by pitch, SF sac flies, BA batting average, OBP on-base percentage, SLG slugging, OPS on-base plus slugging, OPS+ normalized OPS.</p>
      <p>For pitchers, APP is appearances, BF is batters faced, K is strikeouts, and DP is double plays. A pitcher gets one appearance the first time they enter a game, even if they come back in later.</p>
    </details>
    <details class="help"><summary>How OPS+ is calculated</summary>
      <p>100 means the hitter's OPS matches what those pitchers have allowed to everyone else. 130 means it is 30% better than that expectation.</p>
      <p>Each pitcher's baseline leaves out the hitter being measured. A short sample is blended with ${SHRINKAGE_PA} plate appearances of the overall average, and slugging is blended with ${SHRINKAGE_PA} at-bats, so one inning does not define the pitcher. The expectation is weighted by how often the hitter faced each pitcher. 999 means the hitter produced an OPS against a pitcher who otherwise allowed none.</p>
    </details>`;
}

function viewHistory(route) {
  const doc = getDoc();
  if (route.runId) {
    const run = findRun(route.runId);
    if (!run) return '<p class="empty">That challenge is not on this phone.</p>';
    return viewRun(run);
  }
  const runs = [...doc.runs].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  if (!runs.length) return '<p class="empty">No challenges yet.</p>';
  return `<section class="block">${runs.map((run) => {
    const games = doc.games.filter((game) => game.runId === run.id).length;
    const state = run.status === 'active' ? 'In progress' : 'Finished';
    return `<button type="button" class="list-row" data-action="go" data-hash="#/history/${run.id}">
      <span class="list-copy"><strong>${esc(teamMeta(run.teamId).label)}</strong><small>${state} · ${games} game${games === 1 ? '' : 's'} · ${esc(formatWhen(run.startedAt))}</small></span>
    </button>`;
  }).join('')}</section>`;
}

function ensureForm() {
  if (ui.formReady) return;
  const settings = getSettingsPublic();
  ui.form = { owner: settings.owner, repo: settings.repo, branch: settings.branch, token: '' };
  ui.formReady = true;
}

function viewSettings() {
  ensureForm();
  const settings = getSettingsPublic();
  const sync = getSync();
  const tokenNote = settings.hasToken ? 'A token is saved on this phone. Paste a new one only to replace it.' : 'Paste the token on this phone.';
  return `<section class="block">
      <h2>GitHub sync</h2>
      <p class="note">Stats save on this phone immediately. They copy to <strong>data/stats.json</strong> when you open the app, lock or delete a game, end a challenge, leave the page, tap the sync button, and about every two minutes during a game.</p>
      <p class="status-line">${esc(syncLabel())}${sync.lastSyncedAt ? ` · ${esc(formatWhen(sync.lastSyncedAt))}` : ''}</p>
      ${sync.error ? `<p class="banner-error">${esc(sync.error)}</p>` : ''}
      <label class="field">GitHub username<input data-field="owner" value="${esc(ui.form.owner)}" autocomplete="off" spellcheck="false"></label>
      <label class="field">Repository<input data-field="repo" value="${esc(ui.form.repo)}" autocomplete="off" spellcheck="false"></label>
      <label class="field">Branch<input data-field="branch" value="${esc(ui.form.branch)}" autocomplete="off" spellcheck="false"></label>
      <label class="field">Token<input data-field="token" type="password" value="${esc(ui.form.token)}" autocomplete="off" spellcheck="false" placeholder="${settings.hasToken ? 'Token saved' : 'Paste token'}"></label>
      <p class="note">${tokenNote}</p>
      <div class="stack">
        <button type="button" class="primary" data-action="save-settings">Save and sync</button>
        ${settings.hasToken ? '<button type="button" class="quiet" data-action="clear-token">Remove token from this phone</button>' : ''}
      </div>
    </section>
    <details class="help" open><summary>How to create the token</summary>
      <ol class="steps">
        <li>On GitHub, open Settings, then Developer settings, then Fine-grained personal access tokens.</li>
        <li>Limit the token to this repository only.</li>
        <li>Set Contents to Read and write.</li>
        <li>Paste it here on each phone or computer. It stays in that browser and is never written into the repository.</li>
        <li>In the repository, open Settings, then Pages, and deploy from the main branch root folder.</li>
      </ol>
      <p>If the repository is public, the stats file is public too. Anyone can read it. Only a token can change it.</p>
    </details>
    <section class="block">
      <h2>Backup file</h2>
      <p class="note">Export a copy you can keep, or import one to merge it into this phone.</p>
      <div class="action-row">
        <button type="button" data-action="export-file">Export</button>
        <button type="button" data-action="import-file">Import</button>
      </div>
      <input id="import-file" type="file" accept="application/json,.json" hidden>
    </section>`;
}

function view(route) {
  const doc = getDoc();
  if (route.name === 'home') {
    const live = liveGame();
    if (live) return viewAtBat(live);
    const active = doc.runs.filter((run) => run.status === 'active');
    if (active.length === 1) return viewRun(active[0]);
    if (active.length > 1) return viewRunPicker(active);
    return viewStart(doc);
  }
  if (route.name === 'new-run') {
    const active = doc.runs.find((run) => run.status === 'active');
    if (active) {
      return `<p class="note">End the current challenge before starting another.</p><button type="button" class="primary" data-action="go" data-hash="#/run/${active.id}">Back to ${esc(teamMeta(active.teamId).label)}</button>`;
    }
    return viewNewRun();
  }
  if (route.name === 'new-game') {
    const run = findRun(route.runId);
    if (!run) return '<p class="empty">That challenge is not on this phone.</p>';
    if (run.status !== 'active') return '<p class="empty">This challenge is already finished.</p>';
    return viewNewGame(run);
  }
  if (route.name === 'run') {
    const run = findRun(route.runId);
    return run ? viewRun(run) : '<p class="empty">That challenge is not on this phone.</p>';
  }
  if (route.name === 'game' || route.name === 'review' || route.name === 'plays') {
    const game = findGame(route.gameId);
    if (!game) return '<p class="empty">That game is not on this phone.</p>';
    if (route.name === 'review') {
      if (game.status !== 'live') return viewFinal(game);
      return viewReview(game);
    }
    if (route.name === 'plays') return viewPlays(game);
    return game.status === 'live' ? viewAtBat(game) : viewFinal(game);
  }
  if (route.name === 'stats') return viewStats();
  if (route.name === 'history') return viewHistory(route);
  if (route.name === 'settings') return viewSettings();
  return viewStart(doc);
}

function overlay() {
  const pieces = [];
  if (ui.sheet === 'pitch') {
    const game = liveGame() || findGame(parseHash().gameId);
    if (game && game.status === 'live') {
      const current = currentPitcherId(getDoc(), game.id);
      pieces.push(`<div class="modal-back" data-action="backdrop"><div class="sheet">
        <h2>Pitching change</h2>
        <div class="stack">${pitcherRows(pitcherPool(game.opponentTeamId), 'pick-reliever', current, '')}</div>
        <button type="button" class="quiet" data-action="close-sheet">Cancel</button>
      </div></div>`);
    }
  }
  if (ui.edit) {
    const doc = getDoc();
    const pa = doc.plateAppearances.find((item) => item.id === ui.edit.id);
    const game = pa ? findGame(pa.gameId) : null;
    if (pa && game && game.status === 'live') {
      const batter = playerById(pa.batterId);
      const pool = pitcherPool(game.opponentTeamId);
      const body = ui.edit.step === 'rbi'
        ? `<h2>How many runs scored?</h2><div class="rbi-grid">${rbiButtons(ui.edit.result, 'edit-rbi')}</div><button type="button" class="text-button" data-action="edit-back">Back</button>`
        : `<h2>Edit ${esc(batter?.name || 'plate appearance')}</h2>
          <div class="stack">${pitcherRows(pool, 'edit-pitcher', '', ui.edit.pitcherId)}</div>
          ${resultButtons('edit-result', ui.edit.result)}`;
      pieces.push(`<div class="modal-back" data-action="backdrop"><div class="sheet">${body}<button type="button" class="quiet" data-action="edit-cancel">Close</button></div></div>`);
    }
  }
  if (ui.player) {
    const doc = getDoc();
    const player = playerById(ui.player.id);
    if (player) {
      const side = ui.player.side === 'pitch' ? 'pitch' : 'bat';
      const source = side === 'pitch'
        ? pitchingLines(doc).find((line) => line.playerId === player.id)
        : battingLines(doc, {
          pitcherId: ui.stats.pitcherId || null,
          onlyPlayerIds: [player.id],
        })[0];
      const line = source || null;
      const labels = side === 'pitch'
        ? [['gp', 'APP'], ['pa', 'BF'], ['ab', 'AB'], ['h', 'H'], ['d2', '2B'], ['d3', '3B'], ['hr', 'HR'], ['rbi', 'RBI'], ['bb', 'BB'], ['so', 'K'], ['tb', 'TB'], ['gdp', 'DP'], ['hbp', 'HBP'], ['sf', 'SF'], ['ba', 'BA'], ['obp', 'OBP'], ['slg', 'SLG'], ['ops', 'OPS']]
        : BAT_COLS.filter(([key]) => key !== 'name' && key !== 'team');
      const cards = line ? labels.map(([key, label]) => `<div><dt>${label}</dt><dd>${statCell(decorate(line), key)}</dd></div>`).join('') : '';
      const versus = side === 'pitch' ? `<button type="button" class="primary" data-action="hitters-vs" data-pitcher="${player.id}">Hitters against ${esc(player.name)}</button>` : '';
      pieces.push(`<div class="modal-back" data-action="backdrop"><div class="sheet">
        <p class="code">${esc(teamMeta(player.team).code)}</p>
        <h2>${esc(player.name)}</h2>
        <dl class="stat-dl">${cards}</dl>
        ${versus}
        <button type="button" class="quiet" data-action="close-player">Close</button>
      </div></div>`);
    }
  }
  if (ui.modal) {
    pieces.push(`<div class="modal-back" data-action="backdrop"><div class="sheet">
      <h2>${esc(ui.modal.title)}</h2>
      <p>${esc(ui.modal.body)}</p>
      <div class="action-row">
        <button type="button" data-action="confirm-no">Cancel</button>
        <button type="button" class="${ui.modal.danger ? 'danger' : 'primary'}" data-action="confirm-yes">${esc(ui.modal.confirm)}</button>
      </div>
    </div></div>`);
  }
  return pieces.join('');
}

function shell(route) {
  const wide = route.name === 'stats' ? ' wide' : '';
  const nav = [
    ['play', 'Play', playTarget()],
    ['stats', 'Stats', '#/stats'],
    ['history', 'Runs', '#/history'],
    ['settings', 'Sync', '#/settings'],
  ];
  const current = route.name === 'stats' ? 'stats'
    : route.name === 'history' ? 'history'
      : route.name === 'settings' ? 'settings'
        : 'play';
  return `<header class="top"><div class="top-inner"><div><p class="eyebrow">Challenge Mode</p><h1>${esc(pageTitle(route))}</h1></div>
      <button type="button" class="sync-pill${getSync().phase === 'error' ? ' is-bad' : ''}" data-action="sync-pill">${esc(syncLabel())}</button>
    </div></header>
    <main class="screen${wide}">${ui.error ? `<p class="banner-error">${esc(ui.error)}</p>` : ''}${view(route)}</main>
    <nav class="nav"><div class="nav-inner">${nav.map(([id, label, hash]) => `<button type="button" data-action="go" data-hash="${hash}" class="${current === id ? 'is-on' : ''}">${label}</button>`).join('')}</div></nav>
    ${overlay()}`;
}

function render() {
  if (ui.booting) return;
  const route = parseHash();
  const routeKey = location.hash;
  const screen = document.querySelector('.screen');
  const previousScroll = screen ? screen.scrollTop : 0;
  const search = document.getElementById('stat-search');
  const searchState = search && document.activeElement === search
    ? { start: search.selectionStart, end: search.selectionEnd }
    : null;
  app.innerHTML = shell(route);
  const next = document.querySelector('.screen');
  if (next) next.scrollTop = routeKey === lastRoute ? previousScroll : 0;
  lastRoute = routeKey;
  const nextSearch = document.getElementById('stat-search');
  if (searchState && nextSearch) {
    nextSearch.focus();
    nextSearch.setSelectionRange(searchState.start, searchState.end);
  }
  const strip = document.querySelector('.order-strip');
  const now = strip?.querySelector('.is-now');
  if (strip && now) strip.scrollLeft = now.offsetLeft - strip.clientWidth / 2 + now.clientWidth / 2;
}

function resetTransient() {
  const resolve = ui.modal?.resolve;
  ui.modal = null;
  ui.sheet = null;
  ui.pendingResult = null;
  ui.edit = null;
  ui.player = null;
  ui.error = '';
  if (resolve) resolve(false);
}

async function onAction(action, dataset) {
  if (action === 'backdrop') {
    if (ui.modal) closeModal(false);
    else {
      ui.sheet = null;
      ui.edit = null;
      ui.player = null;
      render();
    }
    return;
  }
  if (action === 'go') {
    go(dataset.hash);
    return;
  }
  if (action === 'sync-pill') {
    if (!getSettingsPublic().hasToken) go('#/settings');
    else await pull();
    return;
  }
  if (action === 'confirm-yes') {
    closeModal(true);
    return;
  }
  if (action === 'confirm-no') {
    closeModal(false);
    return;
  }
  if (action === 'close-sheet') {
    ui.sheet = null;
    render();
    return;
  }
  if (action === 'close-player') {
    ui.player = null;
    render();
    return;
  }
  if (action === 'start-run') {
    let runId = '';
    const ok = tryCommit((doc) => {
      const next = startRun(doc, dataset.team);
      runId = next.runs.find((run) => run.status === 'active')?.id || '';
      return next;
    }, 'soon');
    if (ok && runId) go(`#/run/${runId}`);
    return;
  }
  if (action === 'end-run') {
    const ok = await ask({
      title: 'End this challenge?',
      body: 'Locked games stay on the leaderboard. You can start another challenge with any team.',
      confirm: 'End challenge',
    });
    if (!ok) return;
    if (tryCommit((doc) => endRun(doc, dataset.run), 'now')) go('#/');
    return;
  }
  if (action === 'pick-opponent') {
    ui.draft.opponentTeamId = dataset.team;
    if (dataset.team !== 'FINAL') ui.draft.pitcherId = null;
    render();
    return;
  }
  if (action === 'pick-starter') {
    ui.draft.pitcherId = dataset.pitcher;
    render();
    return;
  }
  if (action === 'lineup-add') {
    if (!ui.draft.lineup.includes(dataset.player) && ui.draft.lineup.length < 9) {
      ui.draft.lineup = [...ui.draft.lineup, dataset.player];
    }
    render();
    return;
  }
  if (action === 'lineup-remove') {
    ui.draft.lineup = ui.draft.lineup.filter((id) => id !== dataset.player);
    render();
    return;
  }
  if (action === 'lineup-clear') {
    ui.draft.lineup = [];
    render();
    return;
  }
  if (action === 'begin-game') {
    const draft = ui.draft;
    let gameId = '';
    const ok = tryCommit((doc) => {
      const next = startGame(doc, {
        runId: draft.runId,
        opponentTeamId: draft.opponentTeamId,
        lineup: draft.lineup,
        pitcherId: draft.pitcherId,
      });
      gameId = next.games.find((game) => game.status === 'live')?.id || '';
      return next;
    }, 'soon');
    if (ok && gameId) {
      ui.draft = null;
      go(`#/game/${gameId}`);
    }
    return;
  }
  if (action === 'result') {
    const def = RESULTS[dataset.result];
    if (!def) return;
    if (def.rbi) {
      ui.pendingResult = dataset.result;
      render();
      return;
    }
    if (tooFast()) return;
    const game = liveGame();
    if (!game) return;
    if (tryCommit((doc) => addPlateAppearance(doc, { gameId: game.id, result: dataset.result, rbi: 0 }), 'soon')) {
      navigator.vibrate?.(12);
    }
    return;
  }
  if (action === 'rbi') {
    if (tooFast()) return;
    const game = liveGame();
    const result = ui.pendingResult;
    if (!game || !result) return;
    ui.pendingResult = null;
    if (tryCommit((doc) => addPlateAppearance(doc, { gameId: game.id, result, rbi: Number(dataset.rbi) }), 'soon')) {
      navigator.vibrate?.(12);
    }
    return;
  }
  if (action === 'rbi-back') {
    ui.pendingResult = null;
    render();
    return;
  }
  if (action === 'undo-pa') {
    const game = liveGame();
    if (!game) return;
    ui.pendingResult = null;
    tryCommit((doc) => undoLastPlateAppearance(doc, game.id), 'soon');
    return;
  }
  if (action === 'show-pitch') {
    ui.sheet = 'pitch';
    render();
    return;
  }
  if (action === 'pick-reliever') {
    const game = liveGame();
    if (!game) return;
    ui.sheet = null;
    tryCommit((doc) => changePitcher(doc, game.id, dataset.pitcher), 'soon');
    return;
  }
  if (action === 'undo-pitch') {
    const game = liveGame();
    if (!game) return;
    tryCommit((doc) => undoPitchingChange(doc, game.id), 'soon');
    return;
  }
  if (action === 'resume') {
    const game = liveGame();
    if (game) go(`#/game/${game.id}`);
    return;
  }
  if (action === 'lock-game') {
    const ok = await ask({
      title: 'Lock this game?',
      body: 'You will not be able to edit these plate appearances afterward. You can still delete the whole game if it does not belong on the leaderboard.',
      confirm: 'Lock game',
    });
    if (!ok) return;
    const game = findGame(dataset.game);
    if (game && tryCommit((doc) => lockGame(doc, game.id), 'now')) go(`#/run/${game.runId}`);
    return;
  }
  if (action === 'abandon' || action === 'delete-game') {
    const game = findGame(dataset.game);
    if (!game) return;
    const count = gamePas(getDoc(), game.id).length;
    const ok = await ask({
      title: action === 'abandon' ? 'Abandon this game?' : 'Delete this game?',
      body: `${matchup(game)} has ${count} plate appearance${count === 1 ? '' : 's'}. Deleting it removes those stats from the leaderboard.`,
      confirm: action === 'abandon' ? 'Abandon game' : 'Delete game',
      danger: true,
    });
    if (!ok) return;
    const runId = game.runId;
    if (tryCommit((doc) => deleteGame(doc, game.id), 'now')) go(`#/run/${runId}`);
    return;
  }
  if (action === 'edit-pa') {
    const pa = getDoc().plateAppearances.find((item) => item.id === dataset.pa);
    if (!pa) return;
    ui.edit = { id: pa.id, result: pa.result, pitcherId: pa.pitcherId, step: 'result' };
    render();
    return;
  }
  if (action === 'edit-cancel') {
    ui.edit = null;
    render();
    return;
  }
  if (action === 'edit-back') {
    if (ui.edit) ui.edit.step = 'result';
    render();
    return;
  }
  if (action === 'edit-pitcher') {
    if (!ui.edit) return;
    ui.edit.pitcherId = dataset.pitcher;
    const current = getDoc().plateAppearances.find((item) => item.id === ui.edit.id);
    if (!current) return;
    tryCommit((doc) => updatePlateAppearance(doc, {
      id: ui.edit.id,
      result: current.result,
      rbi: current.rbi,
      pitcherId: dataset.pitcher,
    }), 'soon');
    return;
  }
  if (action === 'edit-result') {
    if (!ui.edit) return;
    ui.edit.result = dataset.result;
    if (RESULTS[dataset.result].rbi) {
      ui.edit.step = 'rbi';
      render();
      return;
    }
    const edit = ui.edit;
    const ok = tryCommit((doc) => updatePlateAppearance(doc, {
      id: edit.id,
      result: edit.result,
      rbi: 0,
      pitcherId: edit.pitcherId,
    }), 'soon');
    if (ok) ui.edit = null;
    render();
    return;
  }
  if (action === 'edit-rbi') {
    if (!ui.edit) return;
    const edit = ui.edit;
    const ok = tryCommit((doc) => updatePlateAppearance(doc, {
      id: edit.id,
      result: edit.result,
      rbi: Number(dataset.rbi),
      pitcherId: edit.pitcherId,
    }), 'soon');
    if (ok) ui.edit = null;
    render();
    return;
  }
  if (action === 'scope') {
    ui.stats.scope = dataset.scope;
    if (dataset.scope === 'pitch' && ui.stats.sort === 'opsPlus') {
      ui.stats.sort = 'pa';
      ui.stats.dir = 'desc';
    }
    render();
    return;
  }
  if (action === 'sort') {
    if (ui.stats.sort === dataset.key) ui.stats.dir = ui.stats.dir === 'asc' ? 'desc' : 'asc';
    else {
      ui.stats.sort = dataset.key;
      ui.stats.dir = dataset.key === 'name' || dataset.key === 'team' ? 'asc' : 'desc';
    }
    render();
    return;
  }
  if (action === 'open-player') {
    ui.player = { id: dataset.player, side: dataset.side || 'bat' };
    render();
    return;
  }
  if (action === 'hitters-vs') {
    ui.player = null;
    ui.stats.scope = 'all';
    ui.stats.pitcherId = dataset.pitcher;
    ui.stats.sort = 'opsPlus';
    ui.stats.dir = 'desc';
    go('#/stats');
    return;
  }
  if (action === 'save-settings') {
    const owner = ui.form.owner.trim();
    const repo = ui.form.repo.trim();
    const branch = ui.form.branch.trim() || 'main';
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) || !/^[\w./-]+$/.test(branch)) {
      ui.error = 'Enter the GitHub username, repository, and branch.';
      render();
      return;
    }
    updateSettings({ owner, repo, branch, token: ui.form.token });
    ui.form.token = '';
    ui.error = '';
    await pull();
    return;
  }
  if (action === 'clear-token') {
    updateSettings({
      owner: ui.form.owner,
      repo: ui.form.repo,
      branch: ui.form.branch,
      clearToken: true,
    });
    ui.form.token = '';
    render();
    return;
  }
  if (action === 'export-file') {
    const blob = new Blob([exportDoc()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'superstar-scorebook.json';
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  if (action === 'import-file') {
    document.getElementById('import-file')?.click();
  }
}

document.body.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'backdrop' && event.target !== el) return;
  onAction(el.dataset.action, el.dataset);
});

document.body.addEventListener('input', (event) => {
  const target = event.target;
  if (target.dataset?.field && ui.form) ui.form[target.dataset.field] = target.value;
  if (target.id === 'stat-search') {
    ui.stats.query = target.value;
    render();
  }
});

document.body.addEventListener('change', async (event) => {
  const target = event.target;
  if (target.id === 'stat-team') {
    ui.stats.teamId = target.value;
    render();
  }
  if (target.id === 'stat-pitcher') {
    ui.stats.pitcherId = target.value;
    render();
  }
  if (target.id === 'import-file' && target.files?.[0]) {
    try {
      importDoc(await target.files[0].text());
      ui.error = '';
    } catch (error) {
      ui.error = error.message || 'That file could not be imported.';
    }
    target.value = '';
    render();
  }
});

window.addEventListener('hashchange', () => {
  resetTransient();
  render();
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

boot().finally(() => {
  ui.booting = false;
  subscribe(render);
  render();
});
