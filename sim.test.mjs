// Simulates a full 1-round game with 3 players against the local server.
import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
const log = (...a) => console.log(...a);
let failures = 0;
function assert(cond, label) {
  if (cond) log('  ✅', label);
  else { failures++; log('  ❌ FAIL:', label); }
}

function connect(name, avatar) {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.nickname = name;
    s.avatar = avatar;
  });
}

const emit = (s, event, payload) =>
  new Promise((resolve) => s.emit(event, payload, resolve));

const waitFor = (s, event, timeout = 20000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${s.nickname}: timeout waiting for ${event}`)), timeout);
    s.once(event, (p) => { clearTimeout(t); resolve(p); });
  });

const host = await connect('Teacher', '🦀');
const kid1 = await connect('Mei', '🐼');
const kid2 = await connect('Sam', '🦊');

// --- create & join ---
log('\n== create & join ==');
const created = await emit(host, 'room:create', {
  name: host.nickname, avatar: host.avatar,
  settings: { rounds: 1, drawSeconds: 30, categories: [] },
  customWords: 'cat,猫\ndog，狗\nfish\t鱼\nbird,鸟\nbadline\napple,苹果',
});
assert(created.code?.length === 4, `room created: ${created.code}`);
assert(created.skippedLines?.length === 1 && created.skippedLines[0] === 5, `bad line 5 skipped: ${JSON.stringify(created.skippedLines)}`);
const code = created.code;

const j1 = await emit(kid1, 'room:join', { code, name: kid1.nickname, avatar: kid1.avatar });
const j2 = await emit(kid2, 'room:join', { code: code.toLowerCase(), name: kid2.nickname, avatar: kid2.avatar });
assert(!j1.error && !j2.error, 'both kids joined (incl. lowercase code)');
assert(j2.state.players.length === 3, `3 players in room: ${j2.state.players.map(p=>p.name).join(', ')}`);
assert(j2.state.hostId === j2.state.players[0].id, 'first player is host');

const badJoin = await emit(kid2, 'room:join', { code: 'ZZZZ', name: 'x', avatar: '🐢' });
assert(badJoin.error, `bad code rejected: ${badJoin.error}`);

// --- start game ---
log('\n== game start / choosing ==');
const choosingP = waitFor(kid1, 'phase:choosing');
const choicesP = waitFor(host, 'word:choices'); // host is first drawer
host.emit('game:start');
const choosing = await choosingP;
const { choices } = await choicesP;
assert(choosing.drawerId === j1.state.hostId, 'host is first drawer');
assert(choices.length === 3 && choices.every((w) => w.en && w.zh), `3 bilingual choices: ${choices.map(w=>w.en+'/'+w.zh).join(', ')}`);
assert(choosing.endsAt > Date.now(), 'choosing endsAt in future');

// --- pick word, drawing phase ---
const drawingP = waitFor(kid1, 'phase:drawing');
const wordP = waitFor(host, 'word:assigned');
host.emit('word:pick', { index: 0 });
const drawing = await drawingP;
const { word } = await wordP;
log(`  word: ${word.en} / ${word.zh} (${word.pinyin})`);
assert(drawing.hint.en.every((c) => c === '_' || !/[a-z]/i.test(c)), 'english hint fully masked');
assert(drawing.hint.zh.every((c) => c === '□'), 'chinese hint fully masked');
assert(Array.isArray(drawing.hint.py) && drawing.hint.py.length === [...word.pinyin].length, 'pinyin hint mask present');

// host changes settings mid-game
const settingsP = waitFor(kid1, 'settings:changed');
host.emit('settings:update', { drawSeconds: 60, rounds: 1 });
const sc = await settingsP;
assert(sc.drawSeconds === 60 && sc.totalRounds === 1, `settings changed mid-game: ${JSON.stringify(sc)}`);
kid2.emit('settings:update', { drawSeconds: 120, rounds: 5 }); // non-host: ignored
await new Promise((r) => setTimeout(r, 200));

// --- drawing relay ---
log('\n== drawing sync ==');
const seenStart = waitFor(kid1, 'draw:start');
const seenPoints = waitFor(kid1, 'draw:points');
host.emit('draw:start', { x: 0.1, y: 0.1, color: '#e74c3c', size: 9, tool: 'brush' });
host.emit('draw:points', { points: [0.2, 0.2, 0.3, 0.3] });
host.emit('draw:end', {});
const ds = await seenStart;
const dp = await seenPoints;
assert(ds.x === 0.1 && ds.color === '#e74c3c', 'draw:start relayed');
assert(dp.points.length === 4, 'draw:points relayed');

// kid can't draw
host.emit('draw:start', { x: 0.5, y: 0.5, color: '#000', size: 4, tool: 'brush' });
host.emit('draw:end', {});
let kidDrawLeaked = false;
kid2.on('draw:start', (p) => { if (p.x === 0.9) kidDrawLeaked = true; });
kid1.emit('draw:start', { x: 0.9, y: 0.9, color: '#000', size: 4, tool: 'brush' });
await new Promise((r) => setTimeout(r, 300));
assert(!kidDrawLeaked, 'non-drawer draw events ignored');

// late joiner gets stroke replay
const late = await connect('Late', '🐢');
const j3 = await emit(late, 'room:join', { code, name: late.nickname, avatar: late.avatar });
assert(j3.state.strokes.length === 2 && j3.state.strokes[0].points.length === 6, `late joiner replay: ${j3.state.strokes.length} strokes`);
assert(j3.state.phase === 'DRAWING' && j3.state.hint, 'late joiner sees phase + hint');
late.disconnect();

// --- guessing ---
log('\n== guessing ==');
const closeP = waitFor(kid1, 'guess:close');
const almostEn = word.en.slice(0, -1) + (word.en.at(-1) === 'x' ? 'y' : 'x');
kid1.emit('guess', { text: almostEn });
await closeP;
assert(true, `close guess detected for "${almostEn}"`);

const correct1P = waitFor(kid2, 'guess:correct');
kid1.emit('guess', { text: word.en.toUpperCase() + ' ' }); // english, messy case
const c1 = await correct1P;
assert(c1.name === 'Mei' && c1.points >= 100, `Mei correct via English (+${c1.points})`);

// guessed player chat goes to guessed channel only
let sawLeak = false;
kid2.on('chat', (m) => { if (m.text === 'secret-after-guess') sawLeak = true; });
const drawerSees = waitFor(host, 'chat');
kid1.emit('guess', { text: 'secret-after-guess' });
const dm = await drawerSees;
await new Promise((r) => setTimeout(r, 300));
assert(dm.channel === 'guessed' && !sawLeak, 'post-guess chat hidden from non-guessers');

// pinyin guess by kid2 → all guessed → turn end → (1 round, host drew... others still need to draw)
const toneless = word.pinyin.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s/g, '');
const correct2P = waitFor(host, 'guess:correct');
const turnEndP = waitFor(host, 'phase:turnEnd');
kid2.emit('guess', { text: toneless });
const c2 = await correct2P;
assert(c2.name === 'Sam', `Sam correct via pinyin "${toneless}" (+${c2.points})`);
const te = await turnEndP;
assert(te.reason === 'allGuessed', 'turn ended early: all guessed');
assert(te.word.en === word.en, 'word revealed at turn end');
assert(te.deltas[choosing.drawerId] > 0, `drawer got points: +${te.deltas[choosing.drawerId]}`);

// --- next turn: kid1 draws; test chinese guess + reconnect ---
log('\n== turn 2: 中文 guess + reconnect ==');
const choices2P = waitFor(kid1, 'word:choices');
const choosing2 = await waitFor(kid2, 'phase:choosing');
assert(choosing2.drawerId !== choosing.drawerId, 'drawer rotated');
await choices2P;
const word2P = waitFor(kid1, 'word:assigned');
const drawing2P = waitFor(kid2, 'phase:drawing');
kid1.emit('word:pick', { index: 1 });
const { word: word2 } = await word2P;
await drawing2P;
log(`  word: ${word2.en} / ${word2.zh}`);

// host disconnects and reconnects with token → seat + score restored
host.disconnect();
await new Promise((r) => setTimeout(r, 300));
const host2 = await connect('Teacher', '🦀');
const rj = await emit(host2, 'room:join', { code, token: created.token, name: 'Teacher', avatar: '🦀' });
assert(!rj.error && rj.token === created.token, 'reconnect with token accepted');
const me = rj.state.players.find((p) => p.id === rj.state.you);
assert(me.score === 200, `score restored after reconnect: ${me.score}`);
assert(rj.state.strokes !== undefined && rj.state.phase === 'DRAWING', 'reconnect lands back in game');

// kid2 guesses in Chinese
const c3P = waitFor(host2, 'guess:correct');
kid2.emit('guess', { text: word2.zh });
const c3 = await c3P;
assert(c3.name === 'Sam', `Sam correct via 中文 "${word2.zh}"`);

// host2 guesses correct in toned pinyin → all guessed → turn end
const te2P = waitFor(kid1, 'phase:turnEnd');
host2.emit('guess', { text: word2.pinyin });
const te2 = await te2P;
assert(te2.reason === 'allGuessed', 'turn 2 ended: all guessed (toned pinyin worked)');

// --- turn 3: kid2 draws; let timer... too slow (30s). Instead kid2 disconnects as drawer → turn ends ---
log('\n== turn 3: drawer disconnect ==');
await waitFor(kid1, 'phase:choosing');
const te3P = waitFor(kid1, 'phase:turnEnd', 25000);
const gameEndP = waitFor(kid1, 'phase:gameEnd', 25000);
kid2.disconnect();
const te3 = await te3P;
assert(te3.reason === 'drawerLeft', 'drawer disconnect ends turn');

// 1 round, all 3 drew (or skipped) → game end
const ge = await gameEndP;
assert(Array.isArray(ge.finalScores) && ge.finalScores[0].score >= ge.finalScores.at(-1).score, `game ended, podium sorted: ${ge.finalScores.map(p=>p.name+':'+p.score).join(', ')}`);

host2.disconnect();
kid1.disconnect();
log(failures === 0 ? '\n🎉 ALL PASSED' : `\n💥 ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
