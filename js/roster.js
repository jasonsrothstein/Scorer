const BASE_TEAMS = ['M', 'P', 'Y', 'D', 'W', 'B'];

const TEAM_META = {
  M: { name: 'Mario', captain: 'Mario', numberTwo: 'Luigi', color: '#c8102e', ink: '#ffffff' },
  P: { name: 'Peach', captain: 'Peach', numberTwo: 'Daisy', color: '#f3b6cf', ink: '#3d1630' },
  Y: { name: 'Yoshi', captain: 'Yoshi', numberTwo: 'Birdo', color: '#2f9e44', ink: '#ffffff' },
  D: { name: 'Donkey Kong', captain: 'Donkey Kong', numberTwo: 'Diddy Kong', color: '#f0b429', ink: '#2a1604' },
  W: { name: 'Wario', captain: 'Wario', numberTwo: 'Waluigi', color: '#6c3483', ink: '#ffffff' },
  B: { name: 'Bowser', captain: 'Bowser', numberTwo: 'Bowser Jr.', color: '#242424', ink: '#f2c14b' },
};

const ROSTERS = {
  M: ['Mario', 'Monty Mole', 'Noki', 'Pianta', 'Red Noki', 'Luigi', 'Yellow Pianta', 'Green Noki', 'Red Pianta'],
  Mr: ['Mario (L)', 'Yellow Pianta (L)', 'Pianta (L)', 'Noki (R)', 'Monty Mole (R)', 'Luigi (R)', 'Red Pianta (L)', 'Red Noki (R)', 'Green Noki (R)'],
  P: ['Toad', 'Toadsworth', 'Daisy', 'Yellow Toad', 'Purple Toad', 'Toadette', 'Peach', 'Green Toad', 'Blue Toad'],
  Pr: ['Toad (L)', 'Purple Toad (L)', 'Daisy (R)', 'Blue Toad (L)', 'Peach (L)', 'Toadette (L)', 'Yellow Toad (L)', 'Toadsworth (L)', 'Green Toad (L)'],
  Y: ['Shy Guy', 'Birdo', 'Black Shy Guy', 'Green Shy Guy', 'Blue Shy Guy', 'Yoshi', 'Baby Mario', 'Yellow Shy Guy', 'Baby Luigi'],
  Yr: ['Birdo (L)', 'Yoshi (R)', 'Yellow Shy Guy (R)', 'Shy Guy (R)', 'Baby Mario (L)', 'Green Shy Guy (R)', 'Black Shy Guy (R)', 'Blue Shy Guy (R)', 'Baby Luigi (R)'],
  D: ['Donkey Kong', 'Koopa', 'Red Koopa', 'Diddy Kong', 'Green Paratroopa', 'Paragoomba', 'Red Paratroopa', 'Goomba', 'Dixie Kong'],
  Dr: ['Donkey Kong (R)', 'Dixie Kong (R)', 'Red Paratroopa (L)', 'Koopa (L)', 'Red Koopa (L)', 'Green Paratroopa (R)', 'Paragoomba (L)', 'Diddy Kong (R)', 'Goomba (L)'],
  W: ['Petey Piranha', 'Wario', 'King Boo', 'Red Magikoopa', 'Boo', 'Yellow Magikoopa', 'Waluigi', 'Magikoopa', 'Green Magikoopa'],
  Wr: ['King Boo (L)', 'Petey Piranha (R)', 'Wario (L)', 'Boo (R)', 'Red Magikoopa (R)', 'Green Magikoopa (R)', 'Magikoopa (R)', 'Yellow Magikoopa (R)', 'Waluigi (R)'],
  B: ['Bowser', 'Hammer Bro', 'Fire Bro', 'Boomerang Bro', 'Bowser Jr.', 'Dry Bones', 'Green Dry Bones', 'Blue Dry Bones', 'Red Dry Bones'],
  Br: ['Blue Dry Bones (R)', 'Boomerang Bro (L)', 'Bowser (R)', 'Bowser Jr. (L)', 'Dry Bones (R)', 'Fire Bro (L)', 'Green Dry Bones (R)', 'Hammer Bro (L)', 'Red Dry Bones (R)'],
};

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function isReversedTeam(teamId) {
  return teamId.length === 2 && teamId.endsWith('r');
}

function baseTeamId(teamId) {
  return isReversedTeam(teamId) ? teamId[0] : teamId;
}

const PLAYERS = [];
const BY_ID = new Map();

for (const [teamId, names] of Object.entries(ROSTERS)) {
  const base = baseTeamId(teamId);
  const meta = TEAM_META[base];
  names.forEach((name, order) => {
    const player = {
      id: `${teamId.toLowerCase()}-${slug(name)}`,
      name,
      team: teamId,
      order,
      isCaptain: !isReversedTeam(teamId) && name === meta.captain,
      isNumberTwo: !isReversedTeam(teamId) && name === meta.numberTwo,
    };
    PLAYERS.push(player);
    BY_ID.set(player.id, player);
  });
}

function teamMeta(teamId) {
  if (teamId === 'FINAL') {
    return {
      id: 'FINAL',
      baseId: null,
      reversed: false,
      name: 'Final',
      label: 'Final',
      code: 'Final',
      color: '#1f5a3d',
      ink: '#f2c14b',
    };
  }
  const baseId = baseTeamId(teamId);
  const meta = TEAM_META[baseId];
  const reversed = isReversedTeam(teamId);
  return {
    id: teamId,
    baseId,
    reversed,
    name: meta.name,
    label: reversed ? `${meta.name} · Reversed` : meta.name,
    code: teamId,
    color: meta.color,
    ink: meta.ink,
  };
}

function allTeamIds() {
  return BASE_TEAMS.flatMap((id) => [id, `${id}r`]);
}

function playerById(id) {
  return BY_ID.get(id) || null;
}

function playersOnTeam(teamId) {
  return PLAYERS.filter((player) => player.team === teamId);
}

function rankPitcher(player) {
  if (player.isCaptain) return 0;
  if (player.isNumberTwo) return 1;
  return 2;
}

function finalAces() {
  return PLAYERS.filter((player) => BASE_TEAMS.includes(player.team) && player.team !== 'B' && (player.isCaptain || player.isNumberTwo))
    .sort((a, b) => BASE_TEAMS.indexOf(a.team) - BASE_TEAMS.indexOf(b.team) || rankPitcher(a) - rankPitcher(b));
}

function pitcherPool(opponentTeamId) {
  if (opponentTeamId === 'FINAL') return finalAces();
  return [...playersOnTeam(opponentTeamId)].sort((a, b) => rankPitcher(a) - rankPitcher(b) || a.order - b.order);
}

function captainOf(teamId) {
  return playersOnTeam(teamId).find((player) => player.isCaptain) || null;
}

function opponentChoices(userTeamId) {
  const base = baseTeamId(userTeamId);
  const choices = BASE_TEAMS.filter((id) => id !== base);
  if (base === 'B') choices.push('FINAL');
  return choices;
}

function pitcherRole(player) {
  if (player.isCaptain) return 'Captain';
  if (player.isNumberTwo) return 'Secondary';
  return '';
}

export {
  BASE_TEAMS,
  PLAYERS,
  allTeamIds,
  baseTeamId,
  captainOf,
  finalAces,
  isReversedTeam,
  opponentChoices,
  pitcherPool,
  pitcherRole,
  playerById,
  playersOnTeam,
  teamMeta,
};
