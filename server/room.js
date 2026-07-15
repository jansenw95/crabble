import crypto from 'node:crypto';
import { prepareWord, checkGuess } from './match.js';
import { createHint, revealEnglishLetter, revealChineseChar } from './hints.js';
import { buildPool, pickChoices, markUsed } from './words.js';

const CHOOSE_MS = 15_000;
const TURN_END_MS = 5_000;
const GAME_END_MS = 30_000;
export const MAX_PLAYERS = 16;

export class Room {
  constructor(io, code, settings, customWords) {
    this.io = io;
    this.code = code;
    this.settings = {
      rounds: clampInt(settings?.rounds, 1, 10, 3),
      drawSeconds: clampInt(settings?.drawSeconds, 30, 180, 80),
      categories: settings?.categories || [],
    };
    this.pool = buildPool(this.settings.categories, customWords);
    this.players = new Map();
    this.hostId = null;
    this.phase = 'LOBBY';
    this.round = 0;
    this.drawerOrder = [];
    this.turnIndex = -1;
    this.drawerId = null;
    this.choices = null;
    this.currentWord = null;
    this.hint = null;
    this.strokes = [];
    this.guessed = new Set();
    this.turnDeltas = {};
    this.used = new Set();
    this.endsAt = 0;
    this.timer = null;
    this.hintTimers = [];
    this.emptySince = Date.now();
  }

  // ---- helpers ----

  broadcast(event, payload) {
    this.io.to(this.code).emit(event, payload);
  }

  toPlayer(playerId, event, payload) {
    const p = this.players.get(playerId);
    if (p?.socketId) this.io.to(p.socketId).emit(event, payload);
  }

  system(kind, params = {}) {
    this.broadcast('chat', { system: true, kind, ...params });
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  isEmpty() {
    return this.connectedPlayers().length === 0;
  }

  clearTimers() {
    clearTimeout(this.timer);
    this.timer = null;
    for (const t of this.hintTimers) clearTimeout(t);
    this.hintTimers = [];
  }

  setPhaseTimer(ms, fn) {
    clearTimeout(this.timer);
    this.endsAt = Date.now() + ms;
    this.timer = setTimeout(fn, ms);
  }

  playerList() {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      connected: p.connected,
      guessed: this.guessed.has(p.id),
    }));
  }

  snapshotFor(playerId) {
    const snap = {
      code: this.code,
      you: playerId,
      phase: this.phase,
      round: this.round,
      totalRounds: this.settings.rounds,
      drawSeconds: this.settings.drawSeconds,
      endsAt: this.endsAt,
      hostId: this.hostId,
      drawerId: this.drawerId,
      players: this.playerList(),
      hint: this.hint,
      strokes: this.strokes,
    };
    if (playerId === this.drawerId) {
      if (this.phase === 'CHOOSING' && this.choices) {
        snap.choices = this.choices.map((w) => ({ en: w.en, zh: w.zh }));
      }
      if (this.phase === 'DRAWING' && this.currentWord) {
        snap.word = {
          en: this.currentWord.en,
          zh: this.currentWord.zh,
          pinyin: this.currentWord.pinyin,
        };
      }
    }
    return snap;
  }

  // ---- players ----

  addPlayer(socket, { name, avatar, token }) {
    // Reconnect: restore the seat (and score) that matches the session token.
    if (token) {
      const existing = [...this.players.values()].find((p) => p.token === token);
      if (existing) {
        existing.connected = true;
        existing.socketId = socket.id;
        socket.join(this.code);
        this.broadcast('player:update', { players: this.playerList() });
        this.system('rejoined', { name: existing.name });
        return existing;
      }
    }
    if (this.connectedPlayers().length >= MAX_PLAYERS) {
      return { error: 'Room is full / 房间已满' };
    }
    const player = {
      id: crypto.randomUUID(),
      token: crypto.randomUUID(),
      socketId: socket.id,
      name: String(name || '').trim().slice(0, 12) || 'Player',
      avatar: String(avatar || '🐱').slice(0, 4),
      score: 0,
      connected: true,
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    // Late joiners get a drawing turn this round too.
    if (this.phase !== 'LOBBY' && !this.drawerOrder.includes(player.id)) {
      this.drawerOrder.push(player.id);
    }
    socket.join(this.code);
    this.broadcast('player:update', { players: this.playerList(), hostId: this.hostId });
    this.system('joined', { name: player.name });
    this.emptySince = null;
    return player;
  }

  handleDisconnect(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = false;
    player.socketId = null;
    if (this.phase === 'LOBBY') {
      this.players.delete(playerId);
    }
    this.system('left', { name: player.name });
    if (this.hostId === playerId) {
      this.hostId = this.connectedPlayers()[0]?.id || null;
    }
    this.broadcast('player:update', { players: this.playerList(), hostId: this.hostId });

    if (this.isEmpty()) {
      this.emptySince = Date.now();
      return;
    }
    if (this.phase === 'DRAWING' || this.phase === 'CHOOSING') {
      if (playerId === this.drawerId) {
        this.system('drawerLeft', { name: player.name });
        this.endTurn('drawerLeft');
      } else if (this.phase === 'DRAWING') {
        this.checkAllGuessed();
      }
    }
  }

  kick(byId, targetId) {
    if (byId !== this.hostId || targetId === byId) return;
    const target = this.players.get(targetId);
    if (!target) return;
    this.toPlayer(targetId, 'kicked', {});
    if (target.socketId) {
      this.io.sockets.sockets.get(target.socketId)?.leave(this.code);
    }
    target.token = null; // prevent rejoining with the old session
    this.players.delete(targetId);
    this.drawerOrder = this.drawerOrder.filter((id) => id !== targetId);
    this.system('kicked', { name: target.name });
    this.broadcast('player:update', { players: this.playerList(), hostId: this.hostId });
    if (targetId === this.drawerId && (this.phase === 'DRAWING' || this.phase === 'CHOOSING')) {
      this.endTurn('drawerLeft');
    }
  }

  // ---- game flow ----

  startGame(byId) {
    if (byId !== this.hostId || this.phase !== 'LOBBY') return;
    if (this.connectedPlayers().length < 2) {
      this.toPlayer(byId, 'error:msg', { text: 'Need at least 2 players / 至少需要2名玩家' });
      return;
    }
    if (this.pool.length < 3) {
      this.toPlayer(byId, 'error:msg', { text: 'Not enough words / 词语不够' });
      return;
    }
    for (const p of this.players.values()) p.score = 0;
    this.used.clear();
    this.round = 1;
    this.drawerOrder = this.connectedPlayers().map((p) => p.id);
    this.turnIndex = 0;
    this.beginChoosing();
  }

  beginChoosing() {
    this.phase = 'CHOOSING';
    this.drawerId = this.drawerOrder[this.turnIndex];
    this.choices = pickChoices(this.pool, this.used, 3);
    this.strokes = [];
    this.guessed = new Set();
    this.turnDeltas = {};
    this.currentWord = null;
    this.hint = null;
    this.setPhaseTimer(CHOOSE_MS, () => {
      // Auto-pick for a slow drawer.
      this.pickWord(this.drawerId, Math.floor(Math.random() * this.choices.length));
    });
    const drawer = this.players.get(this.drawerId);
    this.broadcast('phase:choosing', {
      drawerId: this.drawerId,
      drawerName: drawer?.name,
      round: this.round,
      totalRounds: this.settings.rounds,
      endsAt: this.endsAt,
      players: this.playerList(),
    });
    this.toPlayer(this.drawerId, 'word:choices', {
      choices: this.choices.map((w) => ({ en: w.en, zh: w.zh })),
    });
  }

  pickWord(playerId, index) {
    if (this.phase !== 'CHOOSING' || playerId !== this.drawerId) return;
    const word = this.choices?.[index] || this.choices?.[0];
    if (!word) return;
    markUsed(this.used, word);
    this.currentWord = prepareWord(word);
    this.hint = createHint(word);
    this.choices = null;
    this.beginDrawing();
  }

  beginDrawing() {
    this.phase = 'DRAWING';
    const drawMs = this.settings.drawSeconds * 1000;
    this.setPhaseTimer(drawMs, () => this.endTurn('time'));
    this.scheduleHints(drawMs);
    this.broadcast('phase:drawing', {
      drawerId: this.drawerId,
      hint: this.hint,
      endsAt: this.endsAt,
    });
    this.toPlayer(this.drawerId, 'word:assigned', {
      word: {
        en: this.currentWord.en,
        zh: this.currentWord.zh,
        pinyin: this.currentWord.pinyin,
      },
    });
  }

  scheduleHints(drawMs) {
    for (const t of this.hintTimers) clearTimeout(t);
    this.hintTimers = [
      setTimeout(() => {
        if (this.phase !== 'DRAWING') return;
        if (revealEnglishLetter(this.hint, this.currentWord)) {
          this.broadcast('hint:update', { hint: this.hint });
        }
      }, drawMs * 0.5),
      setTimeout(() => {
        if (this.phase !== 'DRAWING') return;
        let changed = false;
        const letterCount = [...this.currentWord.en].filter((c) => /[a-zA-Z]/.test(c)).length;
        if (letterCount >= 4) changed = revealEnglishLetter(this.hint, this.currentWord) || changed;
        changed = revealChineseChar(this.hint, this.currentWord) || changed;
        if (changed) this.broadcast('hint:update', { hint: this.hint });
      }, drawMs * 0.75),
    ];
  }

  handleGuess(playerId, rawText) {
    const player = this.players.get(playerId);
    if (!player) return;
    const text = String(rawText || '').trim().slice(0, 100);
    if (!text) return;

    const canGuess =
      this.phase === 'DRAWING' && playerId !== this.drawerId && !this.guessed.has(playerId);

    if (canGuess) {
      const result = checkGuess(this.currentWord, text);
      if (result === 'correct') {
        const timeLeft = Math.max(0, this.endsAt - Date.now()) / 1000;
        const points = 100 + Math.round((150 * timeLeft) / this.settings.drawSeconds);
        player.score += points;
        this.guessed.add(playerId);
        this.turnDeltas[playerId] = points;
        this.broadcast('guess:correct', {
          playerId,
          name: player.name,
          points,
          players: this.playerList(),
        });
        this.checkAllGuessed();
        return;
      }
      if (result === 'close') {
        this.toPlayer(playerId, 'guess:close', {});
      }
      // Close and wrong guesses show as normal chat.
      this.broadcast('chat', { playerId, name: player.name, text, channel: 'all' });
      return;
    }

    // Chat from the drawer or players who already guessed goes only to the
    // drawer + correct guessers, so the answer can't leak.
    if (
      this.phase === 'DRAWING' &&
      (playerId === this.drawerId || this.guessed.has(playerId))
    ) {
      const msg = { playerId, name: player.name, text, channel: 'guessed' };
      this.toPlayer(this.drawerId, 'chat', msg);
      for (const id of this.guessed) this.toPlayer(id, 'chat', msg);
      return;
    }

    this.broadcast('chat', { playerId, name: player.name, text, channel: 'all' });
  }

  checkAllGuessed() {
    const eligible = this.connectedPlayers().filter((p) => p.id !== this.drawerId);
    if (eligible.length > 0 && eligible.every((p) => this.guessed.has(p.id))) {
      this.endTurn('allGuessed');
    }
  }

  endTurn(reason) {
    if (this.phase !== 'DRAWING' && this.phase !== 'CHOOSING') return;
    this.clearTimers();
    this.phase = 'TURN_END';

    const drawer = this.players.get(this.drawerId);
    if (this.currentWord && drawer && reason !== 'drawerLeft') {
      const eligible = Math.max(
        this.connectedPlayers().filter((p) => p.id !== this.drawerId).length,
        this.guessed.size,
        1
      );
      if (this.guessed.size > 0) {
        const points = Math.round(50 + (150 * this.guessed.size) / eligible);
        drawer.score += points;
        this.turnDeltas[this.drawerId] = points;
      }
    }

    this.setPhaseTimer(TURN_END_MS, () => this.advanceTurn());
    this.broadcast('phase:turnEnd', {
      reason,
      word: this.currentWord
        ? { en: this.currentWord.en, zh: this.currentWord.zh, pinyin: this.currentWord.pinyin }
        : null,
      deltas: this.turnDeltas,
      players: this.playerList(),
      endsAt: this.endsAt,
    });
  }

  advanceTurn() {
    if (this.connectedPlayers().length < 2) {
      this.endGame();
      return;
    }
    do {
      this.turnIndex++;
      if (this.turnIndex >= this.drawerOrder.length) {
        this.round++;
        if (this.round > this.settings.rounds) {
          this.endGame();
          return;
        }
        this.drawerOrder = this.connectedPlayers().map((p) => p.id);
        this.turnIndex = 0;
      }
    } while (!this.players.get(this.drawerOrder[this.turnIndex])?.connected);
    this.beginChoosing();
  }

  endGame() {
    this.clearTimers();
    this.phase = 'GAME_END';
    this.drawerId = null;
    const finalScores = [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    this.setPhaseTimer(GAME_END_MS, () => this.resetToLobby());
    this.broadcast('phase:gameEnd', { finalScores, endsAt: this.endsAt });
  }

  resetToLobby() {
    this.clearTimers();
    this.phase = 'LOBBY';
    this.round = 0;
    this.turnIndex = -1;
    this.drawerId = null;
    this.currentWord = null;
    this.choices = null;
    this.hint = null;
    this.strokes = [];
    this.guessed = new Set();
    this.endsAt = 0;
    // Drop players who never reconnected.
    for (const [id, p] of this.players) {
      if (!p.connected) this.players.delete(id);
    }
    if (!this.players.has(this.hostId)) {
      this.hostId = this.connectedPlayers()[0]?.id || null;
    }
    this.broadcast('phase:lobby', { players: this.playerList(), hostId: this.hostId });
  }

  // ---- drawing relay ----

  handleDraw(playerId, event, payload, socket) {
    if (this.phase !== 'DRAWING' || playerId !== this.drawerId) return;
    switch (event) {
      case 'draw:start':
        this.strokes.push({
          color: String(payload?.color || '#000'),
          size: Number(payload?.size) || 6,
          tool: payload?.tool === 'eraser' ? 'eraser' : 'brush',
          points: [Number(payload?.x) || 0, Number(payload?.y) || 0],
        });
        break;
      case 'draw:points': {
        const stroke = this.strokes[this.strokes.length - 1];
        if (!stroke || !Array.isArray(payload?.points)) return;
        stroke.points.push(...payload.points.slice(0, 200).map(Number));
        break;
      }
      case 'draw:end':
        break;
      case 'draw:undo':
        this.strokes.pop();
        break;
      case 'draw:clear':
        this.strokes = [];
        break;
      default:
        return;
    }
    socket.to(this.code).emit(event, payload || {});
  }
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
