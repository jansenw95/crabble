import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { Room, MAX_PLAYERS } from './room.js';
import { builtinCategories, parseCustomList } from './words.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 1e5 });

const publicDir = fileURLToPath(new URL('../public', import.meta.url));
app.use(express.static(publicDir));

app.get('/api/categories', (req, res) => {
  res.json(
    builtinCategories.map((c) => ({ id: c.id, en: c.en, zh: c.zh, count: c.words.length }))
  );
});

const rooms = new Map();

function generateCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// Garbage-collect rooms empty for 10+ minutes.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.isEmpty() && room.emptySince && now - room.emptySince > 10 * 60_000) {
      room.clearTimers();
      rooms.delete(code);
    }
  }
}, 60_000);

io.on('connection', (socket) => {
  let room = null;
  let playerId = null;

  socket.on('words:preview', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const { words, skippedLines } = parseCustomList(payload?.text);
    ack({ count: words.length, skippedLines });
  });

  socket.on('room:create', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const { words: customWords, skippedLines } = parseCustomList(payload?.customWords);
    const code = generateCode();
    const newRoom = new Room(io, code, payload?.settings, customWords);
    if (newRoom.pool.length < 3) {
      ack({ error: 'Pick at least one category or add 3+ custom words / 请选择词库或添加至少3个词' });
      return;
    }
    rooms.set(code, newRoom);
    const player = newRoom.addPlayer(socket, payload || {});
    if (player.error) {
      rooms.delete(code);
      ack({ error: player.error });
      return;
    }
    room = newRoom;
    playerId = player.id;
    ack({ code, token: player.token, skippedLines, state: newRoom.snapshotFor(player.id) });
  });

  socket.on('room:join', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const code = String(payload?.code || '').trim().toUpperCase();
    const target = rooms.get(code);
    if (!target) {
      ack({ error: 'Room not found / 找不到房间' });
      return;
    }
    const player = target.addPlayer(socket, payload || {});
    if (player.error) {
      ack({ error: player.error });
      return;
    }
    room = target;
    playerId = player.id;
    ack({ code, token: player.token, state: target.snapshotFor(player.id) });
  });

  socket.on('game:start', () => room?.startGame(playerId));
  socket.on('word:pick', (payload) => room?.pickWord(playerId, Number(payload?.index)));
  socket.on('guess', (payload) => room?.handleGuess(playerId, payload?.text));
  socket.on('room:kick', (payload) => room?.kick(playerId, payload?.playerId));
  socket.on('settings:update', (payload) => room?.updateSettings(playerId, payload));

  for (const event of ['draw:start', 'draw:points', 'draw:end', 'draw:undo', 'draw:clear']) {
    socket.on(event, (payload) => room?.handleDraw(playerId, event, payload, socket));
  }

  socket.on('disconnect', () => {
    room?.handleDisconnect(playerId);
    room = null;
    playerId = null;
  });
});

const port = process.env.PORT || 3000;
// Bind 0.0.0.0 explicitly: Render's port scan doesn't always detect
// Node's default IPv6 (::) binding, causing deploys to time out.
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`crabble 🦀 listening on 0.0.0.0:${port} (max ${MAX_PLAYERS} players/room)`);
});
