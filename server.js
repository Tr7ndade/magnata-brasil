const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { Game } = require('./game');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

const rooms = new Map();

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function makeRoom() {
  const code = newCode();
  const g = new Game(code, () => io.to(code).emit('state', g.state()));
  rooms.set(code, g);
  return g;
}

const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Jogador';

io.on('connection', (socket) => {
  let game = null;
  let me = null;

  function bind(g, p) {
    game = g; me = p;
    p.connected = true;
    p.socketId = socket.id;
    socket.join(g.code);
    if (g.status === 'playing' && g.current === p) g.resetTimer();
  }

  socket.on('create', ({ name } = {}, cb) => {
    if (typeof cb !== 'function' || game) return;
    const g = makeRoom();
    const id = crypto.randomUUID(), token = crypto.randomUUID();
    g.addPlayer(id, token, cleanName(name));
    bind(g, g.player(id));
    cb({ ok: true, code: g.code, id, token });
    g.emit();
  });

  socket.on('join', ({ code, name, token } = {}, cb) => {
    if (typeof cb !== 'function' || game) return;
    code = String(code || '').toUpperCase().trim();
    const g = rooms.get(code);
    if (!g) return cb({ ok: false, error: 'Sala não encontrada.' });
    const existing = token && g.players.find((p) => p.token === token);
    if (existing) {
      bind(g, existing);
      cb({ ok: true, code, id: existing.id, token });
      return g.emit();
    }
    const id = crypto.randomUUID(), tok = crypto.randomUUID();
    const err = g.addPlayer(id, tok, cleanName(name));
    if (err) return cb({ ok: false, error: err });
    bind(g, g.player(id));
    cb({ ok: true, code, id, token: tok });
    g.emit();
  });

  socket.on('start', () => {
    if (!game || !me) return;
    game.start(me.id);
    game.emit();
  });

  socket.on('action', (a) => {
    if (!game || !me || !a || typeof a.type !== 'string') return;
    try { game.handle(me.id, a.type, a); } catch (e) { console.error(e); }
    game.emit();
  });

  socket.on('chat', (text) => {
    if (!game || !me) return;
    text = String(text || '').trim().slice(0, 200);
    if (!text) return;
    game.chat.push({ t: Date.now(), name: me.name, color: me.color, text });
    if (game.chat.length > 100) game.chat.shift();
    game.emit();
  });

  socket.on('leave', () => {
    if (!game || !me) return;
    const g = game, p = me;
    game = null; me = null;
    socket.leave(g.code);
    if (g.status === 'lobby') g.removePlayer(p.id);
    else if (g.status === 'playing' && !p.bankrupt) g.goBankrupt(p, 'saiu da partida');
    g.emit();
  });

  socket.on('disconnect', () => {
    if (!game || !me || me.socketId !== socket.id) return;
    const g = game, p = me;
    p.connected = false;
    if (g.status === 'lobby') {
      // dá 20 s para recarregar a página antes de tirar da sala
      setTimeout(() => {
        if (!p.connected && g.status === 'lobby') { g.removePlayer(p.id); g.emit(); }
      }, 20000);
    } else if (g.status === 'playing' && g.current === p) {
      g.resetTimer();
    }
    g.emit();
  });
});

// Limpa salas abandonadas.
setInterval(() => {
  const now = Date.now();
  for (const [code, g] of rooms) {
    const empty = g.players.every((p) => !p.connected);
    if ((empty && now - g.lastActive > 30 * 60e3) || now - g.lastActive > 6 * 3600e3) {
      g.stop();
      rooms.delete(code);
    }
  }
}, 5 * 60e3);

server.listen(PORT, () => console.log(`Magnata Brasil rodando em http://localhost:${PORT}`));
