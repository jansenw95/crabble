// Player list, timer, hint bar, and overlays (word choice, turn end, podium).

const playersPanel = document.getElementById('players-panel');
const timerEl = document.getElementById('timer');
const roundEl = document.getElementById('round-label');
const hintBar = document.getElementById('hint-bar');
const overlay = document.getElementById('overlay');

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function renderPlayers(state, onKick) {
  playersPanel.innerHTML = '';
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  for (const p of sorted) {
    const row = document.createElement('div');
    row.className = 'player-row';
    if (p.id === state.you) row.classList.add('me');
    if (p.guessed) row.classList.add('guessed');
    if (!p.connected) row.classList.add('disconnected');

    const badges = [];
    if (p.id === state.drawerId) badges.push('✏️');
    if (p.guessed) badges.push('✅');
    if (p.id === state.hostId) badges.push('👑');

    row.innerHTML = `
      <span class="avatar">${esc(p.avatar)}</span>
      <span class="info">
        <span class="name">${esc(p.name)}</span><br>
        <span class="score">${p.score} pts 分</span>
      </span>
      <span class="badge">${badges.join('')}</span>`;

    if (state.you === state.hostId && p.id !== state.you && p.connected) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'kick-btn';
      kickBtn.title = 'Remove 移除';
      kickBtn.textContent = '❌';
      kickBtn.onclick = () => onKick(p.id);
      row.appendChild(kickBtn);
    }
    playersPanel.appendChild(row);
  }
}

export function renderRound(round, total) {
  roundEl.textContent = round > 0 ? `Round ${round}/${total} 第${round}轮` : '';
}

export function renderTimer(endsAt) {
  if (!endsAt || endsAt < Date.now()) {
    timerEl.textContent = '⏱ --';
    timerEl.classList.remove('low');
    return;
  }
  const secs = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  timerEl.textContent = `⏱ ${m}:${s}`;
  timerEl.classList.toggle('low', secs <= 10);
}

function hintSlots(mask, groupCls) {
  const slots = mask
    .map((ch) => {
      if (ch === ' ') return '<span class="slot space"></span>';
      const hidden = ch === '_' || ch === '□';
      return `<span class="slot${hidden ? ' hid' : ''}">${hidden ? '&nbsp;' : esc(ch)}</span>`;
    })
    .join('');
  return `<span class="hint-group ${groupCls}">${slots}</span>`;
}

// Guessers see masks; the drawer sees the full word + pinyin.
export function renderHint(state) {
  if (state.phase !== 'DRAWING') {
    hintBar.innerHTML = '';
    return;
  }
  if (state.word) {
    hintBar.innerHTML =
      `✏️ ${esc(state.word.en)} · ${esc(state.word.zh)} ` +
      `<span class="py">(${esc(state.word.pinyin)})</span>`;
    return;
  }
  if (state.hint) {
    hintBar.innerHTML =
      hintSlots(state.hint.en, 'hint-en') +
      hintSlots(state.hint.py || [], 'hint-py') +
      hintSlots(state.hint.zh, 'hint-zh');
  }
}

// ---- overlays ----

export function hideOverlay() {
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

function showOverlay(html) {
  overlay.innerHTML = `<div class="overlay-card">${html}</div>`;
  overlay.classList.remove('hidden');
  return overlay.firstElementChild;
}

export function showChoosing(drawerName, isMe) {
  if (!isMe) {
    showOverlay(`<h2>✏️ ${esc(drawerName || '...')} is choosing a word<br>正在选词…</h2>`);
  }
}

export function showWordChoices(choices, onPick) {
  const card = showOverlay(`
    <h2>Pick a word to draw! 选一个词来画!</h2>
    <div class="word-choices"></div>`);
  const box = card.querySelector('.word-choices');
  choices.forEach((w, i) => {
    const btn = document.createElement('button');
    btn.className = 'word-choice-btn';
    btn.textContent = `${w.en} · ${w.zh}`;
    btn.onclick = () => onPick(i);
    box.appendChild(btn);
  });
}

export function showTurnEnd(payload, players) {
  const names = Object.fromEntries(players.map((p) => [p.id, p]));
  const reasonText = {
    time: `⏰ Time's up! 时间到!`,
    allGuessed: `🎉 Everyone guessed it! 大家都猜对了!`,
    drawerLeft: `The artist left 画画的人离开了`,
  }[payload.reason] || '';

  let deltas = '';
  const entries = Object.entries(payload.deltas || {});
  if (entries.length) {
    deltas = '<div class="delta-list">' + entries
      .sort((a, b) => b[1] - a[1])
      .map(([id, pts]) => {
        const p = names[id];
        return `<div class="delta-row"><span>${esc(p ? p.avatar + ' ' + p.name : '?')}</span><span class="pts">+${pts}</span></div>`;
      })
      .join('') + '</div>';
  }

  const word = payload.word
    ? `<div class="reveal-word">${esc(payload.word.en)} · ${esc(payload.word.zh)}</div>
       <div class="reveal-pinyin">${esc(payload.word.pinyin)}</div>`
    : '';

  showOverlay(`<h2>${reasonText}</h2>${word}${deltas}`);
}

export function showGameEnd(finalScores, isHost, onReturn) {
  const top = finalScores.slice(0, 3);
  const order = [1, 0, 2]; // second, first, third
  const cls = ['first', 'second', 'third'];
  const medals = ['🥇', '🥈', '🥉'];
  const spots = order
    .filter((i) => top[i])
    .map((i) => {
      const p = top[i];
      return `<div class="podium-spot ${cls[i]}">
        <span style="font-size:26px">${esc(p.avatar)}</span>
        <span class="pname">${esc(p.name)}</span>
        <span class="pscore">${p.score} pts 分</span>
        <div class="block">${medals[i]}</div>
      </div>`;
    })
    .join('');

  const rest = finalScores.slice(3)
    .map((p) => `<div class="delta-row"><span>${esc(p.avatar)} ${esc(p.name)}</span><span>${p.score}</span></div>`)
    .join('');

  const footer = isHost
    ? `<button id="btn-return-room" class="btn btn-primary btn-big">Back to the room 返回房间 🏠</button>`
    : `<p class="hint-text center">Waiting for the host to go back… 等待房主返回房间…</p>`;

  const card = showOverlay(`
    <h2>🏆 Winner! 冠军!</h2>
    <div class="podium">${spots}</div>
    ${rest ? `<div class="delta-list">${rest}</div>` : ''}
    ${footer}`);

  if (isHost) card.querySelector('#btn-return-room').onclick = onReturn;
}
