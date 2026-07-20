import { createCanvas, COLORS, SIZES } from './canvas.js';
import * as chat from './chat.js';
import * as ui from './ui.js';

const socket = io();
const $ = (id) => document.getElementById(id);

const AVATARS = [
  '🐱', '🐶', '🐼', '🦊', '🐰', '🐯', '🦁', '🐸', '🐵', '🐨',
  '🐷', '🐮', '🦄', '🐧', '🦉', '🐢', '🐙', '🦀', '🐳', '🐝',
];

const state = {
  you: null,
  code: null,
  token: null,
  phase: 'JOIN',
  players: [],
  hostId: null,
  drawerId: null,
  hint: null,
  word: null,
  endsAt: 0,
  round: 0,
  totalRounds: 3,
};

const canvas = createCanvas($('canvas'), socket);

// ─────────── screens ───────────

function showScreen(name) {
  for (const s of ['join', 'lobby', 'game']) {
    $(`screen-${s}`).classList.toggle('hidden', s !== name);
  }
}

function isDrawer() {
  return state.you && state.you === state.drawerId;
}

function renderAll() {
  if (state.phase === 'LOBBY') {
    showScreen('lobby');
    renderLobby();
    return;
  }
  if (state.phase === 'JOIN') {
    showScreen('join');
    return;
  }
  showScreen('game');
  ui.renderPlayers(state, (id) => socket.emit('room:kick', { playerId: id }));
  ui.renderRound(state.round, state.totalRounds);
  ui.renderHint(state);
  const drawing = state.phase === 'DRAWING' && isDrawer();
  canvas.setEnabled(drawing);
  $('toolbar').classList.toggle('hidden', !drawing);
  $('guess-form').classList.toggle('hidden', isDrawer());
  const isHost = state.you === state.hostId;
  $('btn-settings').classList.toggle('hidden', !isHost);
  if (!isHost) $('settings-pop').classList.add('hidden');
}

// ─────────── join screen ───────────

let selectedAvatar = localStorage.getItem('crabble:avatar') || AVATARS[0];
$('nickname').value = localStorage.getItem('crabble:name') || '';

const avatarGrid = $('avatar-grid');
for (const emoji of AVATARS) {
  const btn = document.createElement('button');
  btn.className = 'avatar-btn' + (emoji === selectedAvatar ? ' selected' : '');
  btn.textContent = emoji;
  btn.onclick = () => {
    selectedAvatar = emoji;
    localStorage.setItem('crabble:avatar', emoji);
    avatarGrid.querySelectorAll('.avatar-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
  };
  avatarGrid.appendChild(btn);
}

const urlCode = new URLSearchParams(location.search).get('room');
if (urlCode) $('room-code').value = urlCode.toUpperCase();

function joinPayload() {
  const name = $('nickname').value.trim();
  if (!name) {
    showError('join-error', 'Please enter your name / 请输入你的名字');
    return null;
  }
  localStorage.setItem('crabble:name', name);
  return { name, avatar: selectedAvatar };
}

function showError(id, text) {
  const el = $(id);
  el.textContent = text;
  el.hidden = !text;
}

function enterRoom(ack) {
  state.code = ack.code;
  state.token = ack.token;
  sessionStorage.setItem('crabble:session', JSON.stringify({ code: ack.code, token: ack.token }));
  history.replaceState(null, '', `?room=${ack.code}`);
  applySnapshot(ack.state);
}

$('btn-join').onclick = () => {
  const payload = joinPayload();
  if (!payload) return;
  const code = $('room-code').value.trim().toUpperCase();
  if (code.length !== 4) {
    showError('join-error', 'Enter the 4-letter room code / 请输入4位房间码');
    return;
  }
  socket.emit('room:join', { ...payload, code }, (ack) => {
    if (ack.error) return showError('join-error', ack.error);
    enterRoom(ack);
  });
};

$('room-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-join').click();
});

// ─────────── create screen ───────────

$('btn-show-create').onclick = () => {
  const payload = joinPayload();
  if (!payload) return;
  $('join-card').classList.add('hidden');
  $('create-card').classList.remove('hidden');
};
$('btn-back').onclick = () => {
  $('create-card').classList.add('hidden');
  $('join-card').classList.remove('hidden');
};

fetch('/api/categories')
  .then((r) => r.json())
  .then((categories) => {
    const grid = $('category-grid');
    for (const c of categories) {
      const label = document.createElement('label');
      label.className = 'category-item';
      label.innerHTML = `<input type="checkbox" value="${c.id}" checked> ${c.en} ${c.zh} (${c.count})`;
      grid.appendChild(label);
    }
  });

let previewTimer = null;
$('custom-words').addEventListener('input', () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const text = $('custom-words').value;
    if (!text.trim()) {
      $('custom-preview').textContent = '';
      return;
    }
    socket.emit('words:preview', { text }, ({ count, skippedLines }) => {
      let msg = `✔ ${count} words ${count}个词`;
      if (skippedLines.length) {
        msg += ` · skipped lines 跳过行: ${skippedLines.join(', ')}`;
      }
      $('custom-preview').textContent = msg;
    });
  }, 300);
});

$('btn-create').onclick = () => {
  const payload = joinPayload();
  if (!payload) return;
  const categories = [...$('category-grid').querySelectorAll('input:checked')].map((i) => i.value);
  socket.emit(
    'room:create',
    {
      ...payload,
      settings: {
        rounds: $('set-rounds').value,
        drawSeconds: $('set-drawtime').value,
        categories,
      },
      customWords: $('custom-words').value,
    },
    (ack) => {
      if (ack.error) return showError('create-error', ack.error);
      enterRoom(ack);
    }
  );
};

// ─────────── lobby ───────────

function renderLobby() {
  $('lobby-code').textContent = state.code || '';
  $('lobby-count').textContent = state.players.filter((p) => p.connected).length;
  const box = $('lobby-players');
  box.innerHTML = '';
  for (const p of state.players) {
    if (!p.connected) continue;
    const chip = document.createElement('span');
    chip.className = 'lobby-chip';
    chip.textContent = `${p.avatar} ${p.name}`;
    if (p.id === state.hostId) chip.innerHTML += ' <span class="crown">👑</span>';
    box.appendChild(chip);
  }
  const isHost = state.you === state.hostId;
  $('btn-start').classList.toggle('hidden', !isHost);
  $('lobby-wait').classList.toggle('hidden', isHost);
}

$('btn-copy').onclick = () => {
  const url = `${location.origin}/?room=${state.code}`;
  navigator.clipboard.writeText(url).then(() => {
    $('btn-copy').textContent = '✅ Copied! 已复制!';
    setTimeout(() => ($('btn-copy').textContent = '📋 Copy invite link 复制邀请链接'), 1500);
  });
};

$('btn-start').onclick = () => socket.emit('game:start');

// ─────────── game events ───────────

function applySnapshot(snap) {
  Object.assign(state, {
    you: snap.you,
    code: snap.code,
    phase: snap.phase,
    players: snap.players,
    hostId: snap.hostId,
    drawerId: snap.drawerId,
    hint: snap.hint,
    word: snap.word || null,
    endsAt: snap.endsAt,
    round: snap.round,
    totalRounds: snap.totalRounds,
    drawSeconds: snap.drawSeconds,
  });
  canvas.setStrokes(snap.strokes);
  ui.hideOverlay();
  if (snap.phase === 'CHOOSING') {
    if (snap.choices) {
      ui.showWordChoices(snap.choices, (i) => socket.emit('word:pick', { index: i }));
    } else {
      const drawer = snap.players.find((p) => p.id === snap.drawerId);
      ui.showChoosing(drawer?.name, false);
    }
  }
  renderAll();
}

socket.on('player:update', ({ players, hostId }) => {
  state.players = players;
  if (hostId !== undefined) state.hostId = hostId;
  renderAll();
  // If the host left the podium, a newly-promoted host needs the return button.
  if (state.phase === 'GAME_END') renderGameEnd();
});

socket.on('phase:lobby', ({ players, hostId }) => {
  state.phase = 'LOBBY';
  state.players = players;
  state.hostId = hostId;
  state.round = 0;
  state.drawerId = null;
  state.word = null;
  ui.hideOverlay();
  renderAll();
});

socket.on('phase:choosing', ({ drawerId, drawerName, round, totalRounds, endsAt, players }) => {
  Object.assign(state, { phase: 'CHOOSING', drawerId, round, totalRounds, endsAt, players });
  state.word = null;
  state.hint = null;
  canvas.setStrokes([]);
  ui.hideOverlay();
  ui.showChoosing(drawerName, drawerId === state.you);
  renderAll();
});

socket.on('word:choices', ({ choices }) => {
  ui.showWordChoices(choices, (i) => socket.emit('word:pick', { index: i }));
});

socket.on('phase:drawing', ({ drawerId, hint, endsAt }) => {
  Object.assign(state, { phase: 'DRAWING', drawerId, hint, endsAt });
  ui.hideOverlay();
  renderAll();
  if (!isDrawer()) $('guess-input').focus();
});

socket.on('word:assigned', ({ word }) => {
  state.word = word;
  renderAll();
});

socket.on('hint:update', ({ hint }) => {
  state.hint = hint;
  ui.renderHint(state);
});

socket.on('guess:correct', ({ name, points, players }) => {
  state.players = players;
  chat.addCorrectGuess(name, points);
  renderAll();
});

socket.on('guess:close', () => chat.addCloseGuess());

socket.on('chat', (msg) => chat.addChat(msg));

socket.on('phase:turnEnd', (payload) => {
  state.phase = 'TURN_END';
  state.players = payload.players;
  state.endsAt = payload.endsAt;
  state.word = null;
  if (payload.word) chat.addWordReveal(payload.word);
  ui.showTurnEnd(payload, payload.players);
  renderAll();
});

function renderGameEnd() {
  ui.showGameEnd(state.finalScores || [], state.you === state.hostId, () =>
    socket.emit('room:return')
  );
}

socket.on('phase:gameEnd', ({ finalScores, hostId }) => {
  state.phase = 'GAME_END';
  state.endsAt = 0;
  state.drawerId = null;
  state.finalScores = finalScores;
  if (hostId !== undefined) state.hostId = hostId;
  renderGameEnd();
  renderAll();
});

socket.on('error:msg', ({ text }) => chat.addNotice(text));

socket.on('kicked', () => {
  sessionStorage.removeItem('crabble:session');
  state.phase = 'JOIN';
  state.code = null;
  showError('join-error', 'You were removed from the room / 你被移出了房间');
  showScreen('join');
});

// Auto-rejoin after a dropped connection (flaky school Wi-Fi).
socket.on('connect', () => {
  const saved = sessionStorage.getItem('crabble:session');
  if (!saved || state.phase === 'JOIN') return;
  const { code, token } = JSON.parse(saved);
  const name = localStorage.getItem('crabble:name') || 'Player';
  socket.emit('room:join', { code, token, name, avatar: selectedAvatar }, (ack) => {
    if (ack.error) {
      state.phase = 'JOIN';
      showScreen('join');
      return;
    }
    enterRoom(ack);
  });
});

// Rejoin after a page refresh mid-game.
const savedSession = sessionStorage.getItem('crabble:session');
if (savedSession) {
  const { code, token } = JSON.parse(savedSession);
  const name = localStorage.getItem('crabble:name');
  if (name) {
    socket.emit('room:join', { code, token, name, avatar: selectedAvatar }, (ack) => {
      if (!ack.error) enterRoom(ack);
      else sessionStorage.removeItem('crabble:session');
    });
  }
}

// ─────────── guess input ───────────

$('guess-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('guess-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('guess', { text });
  input.value = '';
});

// ─────────── toolbar ───────────

const palette = $('palette');
COLORS.forEach((c, i) => {
  const btn = document.createElement('button');
  btn.className = 'color-swatch' + (i === 0 ? ' selected' : '');
  btn.style.background = c;
  btn.title = c;
  btn.onclick = () => {
    canvas.setColor(c);
    $('tool-eraser').classList.remove('selected');
    palette.querySelectorAll('.color-swatch').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
  };
  palette.appendChild(btn);
});

const sizesBox = $('sizes');
SIZES.forEach((s, i) => {
  const btn = document.createElement('button');
  btn.className = 'size-btn' + (i === 1 ? ' selected' : '');
  btn.innerHTML = `<span class="dot" style="width:${s + 4}px;height:${s + 4}px"></span>`;
  btn.onclick = () => {
    canvas.setSize(s);
    sizesBox.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
  };
  sizesBox.appendChild(btn);
});

$('tool-eraser').onclick = () => {
  const on = canvas.getTool() !== 'eraser';
  canvas.setTool(on ? 'eraser' : 'brush');
  $('tool-eraser').classList.toggle('selected', on);
};
$('tool-undo').onclick = () => canvas.undoLocal();
$('tool-clear').onclick = () => canvas.clearLocal();

// ─────────── mid-game settings (host) ───────────

$('btn-settings').onclick = () => {
  const pop = $('settings-pop');
  if (pop.classList.contains('hidden')) {
    $('game-drawtime').value = String(state.drawSeconds || 80);
    $('game-rounds').value = String(state.totalRounds || 3);
    pop.classList.remove('hidden');
  } else {
    pop.classList.add('hidden');
  }
};

$('btn-apply-settings').onclick = () => {
  socket.emit('settings:update', {
    drawSeconds: $('game-drawtime').value,
    rounds: $('game-rounds').value,
  });
  $('settings-pop').classList.add('hidden');
};

socket.on('settings:changed', ({ drawSeconds, totalRounds }) => {
  state.drawSeconds = drawSeconds;
  state.totalRounds = totalRounds;
  ui.renderRound(state.round, state.totalRounds);
});

// ─────────── timer tick ───────────

setInterval(() => {
  if (state.phase === 'CHOOSING' || state.phase === 'DRAWING') {
    ui.renderTimer(state.endsAt);
  } else {
    ui.renderTimer(0);
  }
}, 250);
