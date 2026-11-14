/* global io, BOARD */
const { SQUARES, GROUPS, RULES, LEVEL_NAMES } = BOARD;
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmt = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STEP = 210; // ms por casa

const socket = io();
let S = null;            // estado já exibido na tela
let myId = null;
let clockOffset = 0, timerTotal = 1, lastDeadline = null;
const queue = [];
let busy = false;
let U = 40;
let tileCenters = [];
let boardCenter = { x: 0, y: 0 };
const pawnPos = {};
const pawnEls = {};
let chatSeen = Number(sessionStorage.getItem('mb_chatSeen') || 0);
let drawerTab = null;
let shownCardT = 0;
let lastTickerT = 0;

// ---------- Som (sintetizado, sem arquivos) ----------
const Sfx = {
  ctx: null,
  on: (() => { try { return localStorage.getItem('mb_sound') !== '0'; } catch { return true; } })(),
  init() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(f, d = 0.08, type = 'sine', vol = 0.06, when = 0, slide) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + d + 0.03);
  },
  dice() { for (let i = 0; i < 9; i++) this.tone(180 + Math.random() * 500, 0.035, 'square', 0.025, i * 0.08); },
  step(k) { this.tone(480 + (k % 2) * 90, 0.07, 'triangle', 0.07); },
  coin() { this.tone(988, 0.08, 'square', 0.035); this.tone(1319, 0.2, 'square', 0.035, 0.08); },
  lose() { this.tone(330, 0.3, 'sawtooth', 0.035, 0, 140); },
  buy() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.06, i * 0.07)); },
  build() { [196, 262, 330].forEach((f, i) => this.tone(f, 0.08, 'square', 0.04, i * 0.09)); },
  turn() { this.tone(660, 0.1, 'sine', 0.08); this.tone(990, 0.22, 'sine', 0.08, 0.1); },
  card() { this.tone(300, 0.3, 'sine', 0.05, 0, 1100); },
  jail() { [440, 330, 220].forEach((f, i) => this.tone(f, 0.16, 'square', 0.04, i * 0.13)); },
  fly() { this.tone(200, 0.5, 'sine', 0.05, 0, 900); },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.07, i * 0.14)); },
};
document.addEventListener('pointerdown', () => Sfx.init());
function syncSoundBtn() { $('#btnSound').textContent = Sfx.on ? '🔊' : '🔇'; }
$('#btnSound').onclick = () => { Sfx.on = !Sfx.on; try { localStorage.setItem('mb_sound', Sfx.on ? '1' : '0'); } catch {} syncSoundBtn(); };
syncSoundBtn();

// ---------- Personagens (SVG original) ----------
const COLOR_ORDER = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#ff8c2b'];
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))));
  return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
const HATS = [
  () => `<ellipse cx="30" cy="12" rx="17" ry="3.6" fill="#2b2233"/><rect x="20" y="-7" width="20" height="19" rx="2.5" fill="#2b2233"/><rect x="20" y="6" width="20" height="3.5" fill="#ff5b6b"/>`,
  (c) => `<path d="M14 15 Q14 -1 30 -1 Q46 -1 46 15 Z" fill="#fff" stroke="#d9d2e3" stroke-width="1.5"/><path d="M43 13 Q55 12 57 17 Q49 18.5 43 16.5Z" fill="${c}"/><circle cx="30" cy="-1" r="2.4" fill="${c}"/>`,
  () => `<path d="M13 17 Q13 -2 30 -2 Q47 -2 47 17 Z" fill="#ff6b6b"/><rect x="12" y="12" width="36" height="7" rx="3.5" fill="#ffd3d3"/><circle cx="30" cy="-4" r="5.5" fill="#fff"/>`,
  () => `<path d="M30 11 L15 3 L16 19 Z" fill="#ff4fa3"/><path d="M30 11 L45 3 L44 19 Z" fill="#ff4fa3"/><circle cx="30" cy="11" r="4.2" fill="#d6338a"/>`,
  () => `<polygon points="15,15 16,0 23,8 30,-4 37,8 44,0 45,15" fill="#ffd23f" stroke="#c99400" stroke-width="1.5" stroke-linejoin="round"/><circle cx="30" cy="9" r="2.2" fill="#ff4f6d"/>`,
  () => `<path d="M30 12 Q29 3 31 -3" stroke="#3a9a46" stroke-width="2.5" fill="none" stroke-linecap="round"/><ellipse cx="24" cy="3" rx="6" ry="3" fill="#56c26a" transform="rotate(-25 24 3)"/><circle cx="33" cy="-4" r="4" fill="#ffd23f"/><circle cx="33" cy="-4" r="1.8" fill="#ff8c2b"/>`,
];
let pawnUid = 0;
function pawnSVG(color) {
  const idx = Math.max(0, COLOR_ORDER.indexOf(color));
  const dark = shade(color, -0.38), id = 'pg' + (pawnUid++);
  return `<svg viewBox="0 -10 60 90" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="${id}" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="21" cy="75" rx="7.5" ry="4.2" fill="${dark}"/><ellipse cx="39" cy="75" rx="7.5" ry="4.2" fill="${dark}"/>
    <ellipse cx="10.5" cy="55" rx="4.5" ry="8" fill="${color}" stroke="${dark}" stroke-width="2" transform="rotate(18 10.5 55)"/>
    <ellipse cx="49.5" cy="55" rx="4.5" ry="8" fill="${color}" stroke="${dark}" stroke-width="2" transform="rotate(-18 49.5 55)"/>
    <path d="M12 71 Q9 40 30 38 Q51 40 48 71 Q30 79 12 71Z" fill="${color}" stroke="${dark}" stroke-width="2"/>
    <path d="M12 71 Q9 40 30 38 Q51 40 48 71 Q30 79 12 71Z" fill="url(#${id})"/>
    <ellipse cx="30" cy="61" rx="10" ry="9" fill="#fff" opacity=".38"/>
    <circle cx="30" cy="27" r="17.5" fill="${color}" stroke="${dark}" stroke-width="2"/>
    <circle cx="30" cy="27" r="17.5" fill="url(#${id})"/>
    <ellipse cx="23.5" cy="26" rx="4.4" ry="5.3" fill="#fff"/><ellipse cx="36.5" cy="26" rx="4.4" ry="5.3" fill="#fff"/>
    <circle cx="24.6" cy="27.2" r="2.5" fill="#22182e"/><circle cx="37.6" cy="27.2" r="2.5" fill="#22182e"/>
    <circle cx="25.4" cy="26.2" r=".9" fill="#fff"/><circle cx="38.4" cy="26.2" r=".9" fill="#fff"/>
    <ellipse cx="17.5" cy="33" rx="3.2" ry="2" fill="#ff7b9c" opacity=".65"/><ellipse cx="42.5" cy="33" rx="3.2" ry="2" fill="#ff7b9c" opacity=".65"/>
    <path d="M25.5 34 Q30 38.5 34.5 34" stroke="#22182e" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    ${HATS[idx % HATS.length](shade(color, 0.15))}
  </svg>`;
}
$('#homePawns').innerHTML = COLOR_ORDER.map(pawnSVG).join('');

const houseSVG = (c) => `<svg viewBox="0 0 20 22"><polygon points="2,11 10,15 10,22 2,18" fill="#f4ecdc"/><polygon points="10,15 18,11 18,18 10,22" fill="#d9ccb2"/><polygon points="1,11 10,3 19,11 10,15.5" fill="${c}" stroke="${shade(c, -0.3)}" stroke-width=".8"/><rect x="5" y="16" width="2.5" height="3" fill="#7fc4ff"/></svg>`;
const hotelSVG = (c) => `<svg viewBox="0 0 24 34"><polygon points="2,8 12,13 12,34 2,29" fill="#f4ecdc"/><polygon points="12,13 22,8 22,29 12,34" fill="#d9ccb2"/><polygon points="2,8 12,3 22,8 12,13" fill="${c}" stroke="${shade(c, -0.3)}" stroke-width=".8"/>${[0, 1, 2, 3].map((r) => `<rect x="4" y="${14 + r * 4.5}" width="2.4" height="2.6" fill="#7fc4ff"/><rect x="8" y="${15.5 + r * 4.5}" width="2.4" height="2.6" fill="#7fc4ff"/><rect x="14" y="${15.5 + r * 4.5}" width="2.4" height="2.6" fill="#a9d6ff"/><rect x="18" y="${14 + r * 4.5}" width="2.4" height="2.6" fill="#a9d6ff"/>`).join('')}</svg>`;
const flagSVG = (c) => `<svg viewBox="0 0 16 22"><rect x="2" y="1" width="1.6" height="21" rx=".8" fill="#6b5a48"/><path d="M3.6 2 Q9 0 15 3 Q9 6 3.6 8 Z" fill="${c}" stroke="${shade(c, -0.3)}" stroke-width=".6"/></svg>`;

// ---------- Sessão ----------
const session = {
  get() { try { return JSON.parse(localStorage.getItem('mb_session')); } catch { return null; } },
  set(v) { try { localStorage.setItem('mb_session', JSON.stringify(v)); } catch {} },
  clear() { try { localStorage.removeItem('mb_session'); } catch {} },
};
const savedName = (() => { try { return localStorage.getItem('mb_name') || ''; } catch { return ''; } })();
$('#name').value = savedName;
const urlCode = new URLSearchParams(location.search).get('sala');
if (urlCode) $('#code').value = urlCode.toUpperCase();

function show(id) { ['#home', '#lobby', '#game'].forEach((s) => $(s).classList.toggle('hidden', s !== id)); }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), 3000);
}
function getName() {
  const n = $('#name').value.trim();
  if (!n) { $('#homeErr').textContent = 'Digite seu nome primeiro.'; $('#name').focus(); return null; }
  try { localStorage.setItem('mb_name', n); } catch {}
  return n;
}
function onJoined(res) {
  if (!res.ok) { $('#homeErr').textContent = res.error; session.clear(); show('#home'); return; }
  myId = res.id;
  session.set({ code: res.code, token: res.token });
  history.replaceState(null, '', '?sala=' + res.code);
}
$('#btnCreate').onclick = () => { const name = getName(); if (name) socket.emit('create', { name }, onJoined); };
$('#btnJoin').onclick = () => {
  const name = getName(); const code = $('#code').value.trim().toUpperCase();
  if (!name) return;
  if (code.length !== 4) { $('#homeErr').textContent = 'O código da sala tem 4 letras.'; return; }
  socket.emit('join', { code, name }, onJoined);
};
$('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoin').click(); });
$('#btnStart').onclick = () => socket.emit('start');
$('#btnCopy').onclick = async () => {
  const link = location.origin + location.pathname + '?sala=' + S.code;
  try { await navigator.clipboard.writeText(link); toast('Link copiado! Mande para seus amigos.'); }
  catch { prompt('Copie o link:', link); }
};
function leave() {
  socket.emit('leave'); session.clear(); myId = null; S = null; queue.length = 0;
  Object.keys(pawnEls).forEach((k) => { pawnEls[k].remove(); delete pawnEls[k]; delete pawnPos[k]; });
  $('#gameover').classList.add('hidden');
  history.replaceState(null, '', location.pathname); show('#home');
}
$('#btnLeave').onclick = leave;
$('#btnQuit').onclick = () => {
  if (S && S.status === 'playing' && !confirm('Sair agora conta como falência. Tem certeza?')) return;
  leave();
};

socket.on('connect', () => {
  const s = session.get();
  if (s && (!urlCode || urlCode.toUpperCase() === s.code)) socket.emit('join', { code: s.code, token: s.token, name: savedName }, onJoined);
});
socket.on('state', (st) => { queue.push(st); pump(); });

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const st = queue.shift();
      try { await apply(st, queue.length > 4); } catch (e) { console.error(e); S = st; }
    }
  } finally { busy = false; }
}

// ---------- Tabuleiro ----------
function gridPos(i) {
  if (i <= 10) return { r: 11, c: 11 - i, side: i === 0 || i === 10 ? 'corner' : 'b' };
  if (i <= 20) return { r: 11 - (i - 10), c: 1, side: i === 20 ? 'corner' : 'l' };
  if (i <= 30) return { r: 1, c: 1 + (i - 20), side: i === 30 ? 'corner' : 't' };
  return { r: 1 + (i - 30), c: 11, side: 'r' };
}
const ICONS = { start: '🏁', chance: '❓', tax: '🧾', airport: '✈️', jail: '🚔', travel: '🧳', gotojail: '👮', copa: '🏆' };
const sqIcon = (sq) => sq.type === 'utility' ? (sq.name.includes('Energia') ? '⚡' : '💧') : ICONS[sq.type] || '';
const tiles = [];
(function buildBoard() {
  const board = $('#board');
  SQUARES.forEach((sq, i) => {
    const g = gridPos(i);
    const d = el('div', `tile ${g.side === 'corner' ? 'corner' : 'side-' + g.side}`);
    d.style.gridRow = g.r; d.style.gridColumn = g.c;
    let lab;
    if (sq.type === 'city') {
      d.style.setProperty('--g', GROUPS[sq.group].color);
      d.appendChild(el('div', 'band'));
      lab = `<div class="nm">${sq.name}</div><div class="pr">${fmt(sq.price)}</div>`;
    } else {
      lab = `<div class="ic">${sqIcon(sq)}</div><div class="nm">${sq.name}</div>${sq.price ? `<div class="pr">${fmt(sq.price)}</div>` : sq.amount ? `<div class="pr">${fmt(sq.amount)}</div>` : ''}`;
    }
    d.appendChild(el('div', 'lab', lab));
    d.onclick = () => onTileClick(i);
    board.appendChild(d);
    tiles[i] = d;
  });
})();

function layout() {
  const stage = $('#stage'), vw = stage.clientWidth, vh = stage.clientHeight;
  if (!vw || !vh) return;
  const mobile = vw < 760 || vh < 500;
  document.body.classList.toggle('mobile', mobile);
  const kx = mobile ? 1 : Math.SQRT2, ky = mobile ? Math.cos(30 * Math.PI / 180) : Math.SQRT2 * Math.cos(55 * Math.PI / 180);
  let top, availH, availW;
  if (mobile) {
    const cardsH = $('#cards').offsetHeight || 110;
    const hubH = Math.max(150, $('#hub').offsetHeight || 170);
    top = cardsH; availH = vh - cardsH - hubH; availW = vw - 4;
  } else { top = 0; availH = vh - 20; availW = vw - 60; }
  const size = Math.max(220, Math.min(availW / kx, availH / (ky + 0.07)));
  U = size / 12.2;
  document.documentElement.style.setProperty('--u', U + 'px');
  $('#scene').style.left = vw / 2 + 'px';
  $('#scene').style.top = (top + availH / 2 - size * 0.02) + 'px';
  measure();
}
function measure() {
  const sr = $('#stage').getBoundingClientRect();
  tileCenters = tiles.map((t) => { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2 - sr.left, y: r.top + r.height / 2 - sr.top }; });
  const cr = $('#center').getBoundingClientRect();
  boardCenter = { x: cr.left + cr.width / 2 - sr.left, y: cr.top + cr.height / 2 - sr.top };
  if (!document.body.classList.contains('mobile')) {
    const hub = $('#hub');
    hub.style.left = boardCenter.x + 'px'; hub.style.top = boardCenter.y + 'px';
    hub.style.width = Math.min(390, cr.width * 0.5) + 'px';
  } else { $('#hub').style.width = ''; }
  if (S && S.status !== 'lobby') { arrangePawns(false); renderStanding(null); }
}
window.addEventListener('resize', () => { if (S && S.status !== 'lobby') layout(); });

const pById = (id, st = S) => st && st.players.find((p) => p.id === id);
const me = () => pById(myId);
const myTurn = () => S && S.status === 'playing' && S.turn === myId;
function act(type, extra = {}) { Sfx.init(); socket.emit('action', { type, ...extra }); }

function pickable() {
  if (!myTurn() || S.phase !== 'action' || !S.pending) return null;
  if (S.pending.type === 'travel') return (i) => i !== 20;
  if (S.pending.type === 'copa') return (i) => SQUARES[i].type === 'city' && S.props[i].owner === myId;
  return null;
}
function onTileClick(i) {
  if (!S || S.status === 'lobby') return;
  const pick = pickable();
  if (pick) {
    if (!pick(i)) return;
    return act(S.pending.type === 'travel' ? 'travel' : 'copa', { target: i });
  }
  if (SQUARES[i].price) showDeed(i);
}

// ---------- Personagens no tabuleiro ----------
function ensurePawn(p) {
  if (pawnEls[p.id]) return pawnEls[p.id];
  const e = el('div', 'pawn');
  e.style.setProperty('--c', p.color);
  e.innerHTML = `<div class="pshadow"></div><div class="sprite idle">${pawnSVG(p.color)}</div>`;
  $('#pawns').appendChild(e);
  pawnEls[p.id] = e;
  pawnPos[p.id] = p.pos;
  return e;
}
function setPawnXY(id, x, y, ms) {
  const e = pawnEls[id];
  const ox = parseFloat(e.style.left || x);
  if (Math.abs(x - ox) > 1) e.classList.toggle('flip', x < ox);
  e.style.transition = ms ? `left ${ms}ms linear, top ${ms}ms linear` : 'none';
  e.style.left = x + 'px'; e.style.top = y + 'px';
  e.style.zIndex = 1000 + Math.round(y);
}
function sprite(id, cls) {
  const s = pawnEls[id].querySelector('.sprite');
  s.className = 'sprite'; void s.offsetWidth; s.classList.add(cls);
  return s;
}
function arrangePawns(animate = true) {
  if (!S) return;
  const groups = {};
  S.players.forEach((p) => { if (!p.bankrupt && pawnEls[p.id]) (groups[pawnPos[p.id]] ||= []).push(p.id); });
  Object.entries(groups).forEach(([pos, ids]) => {
    const c = tileCenters[pos]; if (!c) return;
    ids.forEach((id, k) => {
      const n = ids.length, a = (k / n) * Math.PI * 2 + Math.PI / 2;
      const dx = n > 1 ? Math.cos(a) * U * 0.3 : 0, dy = n > 1 ? Math.sin(a) * U * 0.16 : 0;
      setPawnXY(id, c.x + dx, c.y + dy, animate ? 250 : 0);
    });
  });
}
async function walk(id, from, to, dir = 1) {
  let pos = from;
  const n = dir > 0 ? (to - from + 40) % 40 : (from - to + 40) % 40;
  for (let k = 0; k < n; k++) {
    pos = (pos + dir + 40) % 40;
    const c = tileCenters[pos];
    setPawnXY(id, c.x, c.y, STEP);
    sprite(id, 'hop');
    Sfx.step(k);
    pawnPos[id] = pos;
    if (pos === 0 && dir > 0) sparkle(c.x, c.y);
    await sleep(STEP);
  }
  sprite(id, 'idle');
  tilePulse(to, 'land');
}
async function teleport(id, to, kind) {
  if (kind === 'jail') Sfx.jail(); else Sfx.fly();
  sprite(id, 'poof');
  await sleep(330);
  const c = tileCenters[to];
  setPawnXY(id, c.x, c.y, 0);
  pawnPos[id] = to;
  sprite(id, 'appear');
  await sleep(420);
  sprite(id, 'idle');
  tilePulse(to, 'land');
}
function tilePulse(i, cls) { const t = tiles[i]; t.classList.remove(cls); void t.offsetWidth; t.classList.add(cls); }
function sparkle(x, y) {
  for (let k = 0; k < 12; k++) {
    const s = el('div', 'spark'); const a = (k / 12) * Math.PI * 2;
    s.style.left = x + 'px'; s.style.top = y + 'px';
    s.style.setProperty('--dx', Math.cos(a) * 50 + 'px'); s.style.setProperty('--dy', Math.sin(a) * 30 - 20 + 'px');
    $('#floaters').appendChild(s); setTimeout(() => s.remove(), 850);
  }
}
function floatText(x, y, text, cls) {
  const f = el('div', 'floater ' + cls, text);
  f.style.left = x + 'px'; f.style.top = y + 'px';
  $('#floaters').appendChild(f); setTimeout(() => f.remove(), 1700);
}

// ---------- Dados 3D ----------
const FACE = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
let spin = 0;
['#cube1', '#cube2'].forEach((s) => {
  const cube = $(s);
  for (let v = 1; v <= 6; v++) {
    const f = el('div', 'face f' + v);
    for (let k = 1; k <= 9; k++) { const i = el('i'); if (!PIPS[v].includes(k)) i.style.visibility = 'hidden'; f.appendChild(i); }
    cube.appendChild(f);
  }
});
function setDice(d1, d2, animate) {
  if (animate) spin += 2;
  [[$('#cube1'), d1, 1], [$('#cube2'), d2, -1]].forEach(([cube, v, sgn]) => {
    const [fx, fy] = FACE[v];
    cube.style.transition = animate ? '' : 'none';
    cube.style.transform = `rotateX(${fx - 18 + 360 * spin}deg) rotateY(${fy + 24 * sgn + 360 * spin * sgn}deg)`;
  });
}
async function rollDice(r) {
  const d = $('#dice');
  d.classList.remove('toss'); void d.offsetWidth; d.classList.add('toss');
  Sfx.dice();
  setDice(r.d1, r.d2, true);
  await sleep(1050);
}
setDice(5, 2, false);

// ---------- Aplicar estado (com animações) ----------
async function apply(st, fast) {
  const prev = S;
  if (st.status === 'lobby') { S = st; renderLobby(); return; }
  if ($('#game').classList.contains('hidden') || !tileCenters.length) {
    show('#game'); S = st; layout();
  }
  clockOffset = st.now - Date.now();
  if (st.deadline !== lastDeadline) { lastDeadline = st.deadline; timerTotal = Math.max(1, st.deadline - st.now); }

  st.players.forEach((p) => { if (!p.bankrupt && !pawnEls[p.id]) { ensurePawn(p); pawnPos[p.id] = p.pos; } });
  const live = prev && prev.status === 'playing' && !fast;
  $('#hub').classList.add('busy');
  if (live) {
    document.querySelectorAll('.pawn .bubble').forEach((b) => b.remove());
    const rollNew = st.lastRoll && (!prev.lastRoll || st.lastRoll.t !== prev.lastRoll.t);
    if (rollNew) await rollDice(st.lastRoll);
    await animateMoves(prev, st, rollNew);
  } else {
    if (st.lastRoll) setDice(st.lastRoll.d1, st.lastRoll.d2, false);
    st.players.forEach((p) => { if (!p.bankrupt) pawnPos[p.id] = p.pos; });
  }
  st.players.forEach((p) => { if (p.bankrupt && pawnEls[p.id]) { pawnEls[p.id].remove(); delete pawnEls[p.id]; } });
  S = st;
  arrangePawns(live);
  renderAll(prev, live);
  $('#hub').classList.remove('busy');
  if (document.body.classList.contains('mobile')) requestAnimationFrame(() => { const before = U; layout(); if (Math.abs(before - U) > 0.5) arrangePawns(false); });
}

async function animateMoves(prev, st, rollNew) {
  const cardNew = st.lastCard && (!prev.lastCard || st.lastCard.t !== prev.lastCard.t);
  for (const p of st.players) {
    const pp = prev.players.find((x) => x.id === p.id);
    if (!pp) continue;
    if (p.bankrupt) {
      if (!pp.bankrupt && pawnEls[p.id]) { sprite(p.id, 'poof'); await sleep(350); }
      continue;
    }
    const from = pawnPos[p.id] ?? pp.pos, to = p.pos;
    const isRoller = rollNew && st.lastRoll.id === p.id;
    if (from === to && !(isRoller && cardNew && st.lastCard.id === p.id)) continue;
    let at = from;
    if (isRoller && !(pp.inJail && p.inJail)) {
      const mid = (from + st.lastRoll.d1 + st.lastRoll.d2) % 40;
      const threeDoubles = p.inJail && !pp.inJail && mid !== 30 && SQUARES[mid].type !== 'chance';
      if (!threeDoubles && mid !== from) { await walk(p.id, from, mid); at = mid; }
    }
    if (cardNew && st.lastCard.id === p.id && SQUARES[at].type === 'chance') { await showCard(st.lastCard); }
    if (at !== to) {
      const fwd = (to - at + 40) % 40;
      if (p.inJail && to === 10) await teleport(p.id, to, 'jail');
      else if (SQUARES[at].type === 'travel') await teleport(p.id, to, 'fly');
      else if (fwd <= 12) await walk(p.id, at, to, 1);
      else if (fwd >= 36) await walk(p.id, at, to, -1);
      else await teleport(p.id, to, 'fly');
    }
  }
}

// ---------- Render geral ----------
function renderAll(prev, live) {
  if (S.status === 'lobby') return renderLobby();
  renderTiles(prev, live);
  renderStanding(live ? prev : null);
  renderCards(prev, live);
  renderPawnState();
  renderPrompt();
  renderLog();
  renderChat(prev, live);
  if (live) effects(prev);
  if (S.status === 'ended') renderGameOver(prev);
}

function effects(prev) {
  // dinheiro
  S.players.forEach((p) => {
    const pp = pById(p.id, prev); if (!pp || pp.money === p.money) return;
    const dlt = p.money - pp.money;
    const card = $(`.pcard[data-id="${p.id}"]`);
    const txt = (dlt > 0 ? '+' : '−') + fmt(Math.abs(dlt));
    if (card) { const r = card.getBoundingClientRect(), sr = $('#stage').getBoundingClientRect(); floatText(r.left + r.width / 2 - sr.left, r.top + r.height - sr.top, txt, dlt > 0 ? 'plus' : 'minus'); }
    const pe = pawnEls[p.id];
    if (pe && !p.bankrupt) floatText(parseFloat(pe.style.left), parseFloat(pe.style.top) - U * 1.3, txt, (dlt > 0 ? 'plus' : 'minus') + ' big');
  });
  const meNow = me(), mePrev = pById(myId, prev);
  if (meNow && mePrev && meNow.money !== mePrev.money) { if (meNow.money > mePrev.money) Sfx.coin(); else Sfx.lose(); }
  // compras e construções
  let bought = false, built = false;
  Object.entries(S.props).forEach(([k, pr]) => {
    const o = prev.props[k];
    if (pr.owner && pr.owner !== o.owner) { bought = true; tilePulse(Number(k), 'bought'); }
    if (pr.level > o.level && pr.owner === o.owner) built = true;
  });
  if (bought) Sfx.buy(); else if (built) Sfx.build();
  // carta que não foi mostrada durante o movimento
  if (S.lastCard && S.lastCard.t !== shownCardT && (!prev.lastCard || prev.lastCard.t !== S.lastCard.t)) showCard(S.lastCard);
  // novidade no histórico
  const fresh = S.log.filter((l) => l.t > lastTickerT && !l.msg.startsWith('▶'));
  if (fresh.length) ticker(fresh[fresh.length - 1].msg);
  if (S.log.length) lastTickerT = S.log[S.log.length - 1].t;
  // troca de vez
  if (S.status === 'playing' && S.turn !== prev.turn) banner();
  if (prev.status !== 'playing' && S.status === 'playing') banner();
}

function ticker(msg) {
  const t = $('#ticker'); t.textContent = msg; t.classList.remove('hidden');
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(ticker.h); ticker.h = setTimeout(() => t.classList.add('hidden'), 4200);
}
function banner() {
  const p = pById(S.turn); if (!p) return;
  const b = $('#banner');
  b.textContent = p.id === myId ? 'Sua vez! 🎲' : `Vez de ${p.name}`;
  b.style.setProperty('--c', shade(p.color, -0.3));
  b.classList.remove('hidden'); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
  if (p.id === myId) Sfx.turn();
  clearTimeout(banner.h); banner.h = setTimeout(() => b.classList.add('hidden'), 1500);
}
async function showCard(c) {
  shownCardT = c.t;
  const p = pById(c.id);
  const box = $('#cardFlip');
  box.innerHTML = `<div class="cf"><div class="q">❓</div><h4>Sorte ou Revés</h4><p>${esc(c.text)}</p><p class="muted" style="margin-top:8px;font-size:12px">${esc(p ? p.name : '')}</p></div>`;
  box.classList.remove('hidden');
  Sfx.card();
  clearTimeout(showCard.h); showCard.h = setTimeout(() => box.classList.add('hidden'), 3200);
  await sleep(1700);
}

function rentNow(i) {
  const sq = SQUARES[i], pr = S.props[i];
  if (!pr.owner) return null;
  if (sq.type === 'city') {
    let r = sq.rent[pr.level];
    const full = SQUARES.every((s, k) => s.group !== sq.group || S.props[k].owner === pr.owner);
    if (pr.level === 0 && full) r *= 2;
    if (S.copa === i) r *= 2;
    return r;
  }
  const n = Object.entries(S.props).filter(([k, x]) => x.owner === pr.owner && SQUARES[k].type === sq.type).length;
  if (sq.type === 'airport') return 25 * 2 ** (n - 1);
  return `${n >= 2 ? 10 : 4}× dados`;
}
const rentTxt = (i) => { const r = rentNow(i); return typeof r === 'number' ? fmt(r) : r; };
function invested(i) { const sq = SQUARES[i]; return sq.price + (sq.type === 'city' ? S.props[i].level * GROUPS[sq.group].house : 0); }

function renderTiles() {
  const pick = pickable();
  SQUARES.forEach((sq, i) => {
    const t = tiles[i], pr = S.props[i], owner = pr && pById(pr.owner);
    t.classList.toggle('owned', !!owner);
    if (owner) t.style.setProperty('--own', owner.color);
    const prEl = t.querySelector('.pr');
    if (prEl && sq.price) prEl.textContent = owner ? rentTxt(i) : fmt(sq.price);
    t.classList.toggle('pick', !!pick && pick(i));
    t.classList.toggle('dim', !!pick && !pick(i));
  });
}

let standKey = {};
function renderStanding(prev) {
  const box = $('#standing'); box.innerHTML = '';
  const newKey = {};
  Object.entries(S.props).forEach(([k, pr]) => {
    k = Number(k);
    const owner = pById(pr.owner); if (!owner) return;
    const sq = SQUARES[k], c = tileCenters[k]; if (!c) return;
    const vx = boardCenter.x - c.x, vy = boardCenter.y - c.y, len = Math.hypot(vx, vy) || 1;
    const x = c.x + (vx / len) * U * 0.42, y = c.y + (vy / len) * U * 0.42;
    let cls, html;
    if (sq.type === 'city' && pr.level === 5) { cls = 'hotel'; html = hotelSVG(owner.color); }
    else if (sq.type === 'city' && pr.level > 0) { cls = 'house'; html = Array.from({ length: pr.level }, () => houseSVG(owner.color)).join(''); }
    else { cls = 'flag'; html = flagSVG(owner.color); }
    const key = cls + pr.level + owner.id;
    newKey[k] = key;
    const s = el('div', 'stand ' + cls + (prev && standKey[k] !== key ? ' pop' : ''), `<div class="inner">${html}</div>`);
    s.style.left = x + 'px'; s.style.top = y + 'px'; s.style.zIndex = 1000 + Math.round(y) - 2;
    box.appendChild(s);
  });
  if (S.copa != null && tileCenters[S.copa]) {
    const c = tileCenters[S.copa];
    const s = el('div', 'stand trophy', '<div class="inner">🏆</div>');
    s.style.left = c.x + 'px'; s.style.top = (c.y - U * 0.15) + 'px'; s.style.zIndex = 1000 + Math.round(c.y) + 400;
    box.appendChild(s);
  }
  standKey = newKey;
}

function slotsFor(n) {
  if (n <= 4) return ['s-tl', 's-tr', 's-br', 's-bl'];
  if (n === 5) return ['s-tl', 's-tr', 's-tr2', 's-br', 's-bl'];
  return ['s-tl', 's-tr', 's-tr2', 's-br', 's-bl', 's-tl2'];
}
function renderCards(prev, live) {
  const box = $('#cards');
  const slots = slotsFor(S.players.length);
  S.players.forEach((p, idx) => {
    let c = box.querySelector(`.pcard[data-id="${p.id}"]`);
    if (!c) {
      c = el('div', 'pcard');
      c.dataset.id = p.id;
      c.style.setProperty('--c', p.color);
      c.innerHTML = `<div class="avatar"><div class="ring"></div>${pawnSVG(p.color)}</div><div class="pbody"><div class="pname"></div><div class="pcash"><span class="v"></span><span class="pflags"></span></div></div>`;
      c.onclick = () => showPlayer(pById(p.id));
      box.appendChild(c);
      c._money = p.money;
    }
    const slot = slots[idx] || 's-tl';
    c.className = `pcard ${slot} ${['s-tr', 's-tr2', 's-br'].includes(slot) ? 'right' : ''} ${slot.startsWith('s-b') ? 'bottom' : ''} ${S.turn === p.id && S.status === 'playing' ? 'turn' : ''} ${p.bankrupt ? 'out' : ''} ${p.id === myId ? 'me' : ''}`;
    c.querySelector('.pname').textContent = p.name;
    const cash = c.querySelector('.pcash');
    cash.classList.toggle('neg', p.money < 0);
    c.querySelector('.pflags').textContent = [p.bankrupt ? '💀' : '', p.inJail ? '🔒' : '', !p.connected && !p.bankrupt ? '📴' : '', p.jailCards ? '📜' : ''].join('');
    tweenMoney(c, p.bankrupt ? 0 : p.money, live);
  });
  // ordena no celular pela ordem de jogo
  S.players.forEach((p) => box.appendChild(box.querySelector(`.pcard[data-id="${p.id}"]`)));
}
function tweenMoney(c, target, live) {
  const v = c.querySelector('.v');
  const from = c._money ?? target;
  c._money = target;
  if (!live || from === target) { v.textContent = fmt(target); return; }
  const t0 = performance.now(), dur = 700;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3;
    v.textContent = fmt(Math.round(from + (target - from) * e));
    if (k < 1 && c._money === target) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function bubbleText(p) {
  const pd = S.pending, sqn = pd && pd.square != null ? SQUARES[pd.square].name : '';
  if (S.phase === 'roll') return p.inJail ? 'Tentando sair… 🔒' : 'Rolando os dados… 🎲';
  if (S.phase === 'end') return 'Já volto! 👍';
  if (S.phase === 'debt') return 'Preciso de dinheiro! 😰';
  if (S.phase === 'action' && pd) {
    return { buy: `Compro ${sqn}? 🤔`, build: 'Construindo… 🏗️', buyout: `De olho em ${sqn}… 👀`, travel: 'Para onde eu vou? ✈️', copa: 'Escolhendo a sede da Copa 🏆' }[pd.type] || '';
  }
  return '';
}
function renderPawnState() {
  S.players.forEach((p) => {
    const e = pawnEls[p.id]; if (!e) return;
    const isTurn = S.status === 'playing' && S.turn === p.id;
    e.classList.toggle('turn', isTurn);
    let b = e.querySelector('.bubble');
    const txt = isTurn && p.id !== myId ? bubbleText(p) : '';
    if (txt) {
      if (!b) { b = el('div', 'bubble'); e.appendChild(b); }
      if (b.textContent !== txt) { b.textContent = txt; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; }
    } else if (b) b.remove();
  });
}

// ---------- Decisões no centro ----------
function btn(label, cls, fn) { const b = el('button', cls, label); b.onclick = fn; return b; }
function renderPrompt() {
  const box = $('#prompt'); box.innerHTML = ''; box.className = '';
  if (S.status !== 'playing') return;
  const add = (cls, html) => box.appendChild(el('div', cls, html));
  const btns = (bs, col) => { const w = el('div', 'btns' + (col ? ' col' : '')); bs.forEach((b) => w.appendChild(b)); box.appendChild(w); };
  const cur = pById(S.turn), pd = S.pending, p = me();
  if (!myTurn()) {
    box.className = 'slim';
    box.innerHTML = `Vez de <span style="color:${shade(cur.color, 0.35)}">${esc(cur.name)}</span>${!cur.connected ? ' · 📴 jogada automática' : ''}`;
    return;
  }
  if (S.phase === 'roll') {
    if (p.inJail) {
      add('title', 'Você está preso 🔒');
      add('txt', `Tire uma dupla para sair (tentativa ${p.jailTries + 1}/3) ou pague a fiança.`);
      const bs = [btn('🎲 Tentar dupla', 'primary', () => act('roll'))];
      if (p.money >= RULES.JAIL_FINE) bs.push(btn(`Pagar ${fmt(RULES.JAIL_FINE)}`, 'gold', () => act('payJail')));
      if (p.jailCards) bs.push(btn('📜 Habeas corpus', '', () => act('useCard')));
      btns(bs);
    } else {
      btns([btn('🎲 Rolar dados', 'primary big', () => act('roll'))]);
    }
  } else if (S.phase === 'end') {
    btns([btn('Passar a vez ➜', 'primary big', () => act('endTurn'))]);
    add('txt', 'Toque numa propriedade sua para ver ou vender.');
  } else if (S.phase === 'debt') {
    add('title', `Faltam ${fmt(-p.money)} 😰`);
    add('txt', 'Venda propriedades ao banco (metade do valor investido):');
    const list = el('div', 'sellList');
    Object.keys(S.props).map(Number).filter((k) => S.props[k].owner === myId).forEach((k) => {
      list.appendChild(btn(`${SQUARES[k].name}<br><small>+${fmt(Math.floor(invested(k) / 2))}</small>`, '', () => act('sell', { square: k })));
    });
    box.appendChild(list);
    btns([btn('Declarar falência', 'danger', () => { if (confirm('Declarar falência? Você sai da partida.')) act('bankrupt'); })]);
  } else if (S.phase === 'action' && pd) {
    const sq = pd.square != null ? SQUARES[pd.square] : null;
    const chip = sq && sq.type === 'city' ? `<span class="colorchip" style="background:${GROUPS[sq.group].color}"></span>` : '';
    if (pd.type === 'buy') {
      add('title', `${chip}${sq.name}`);
      add('txt', `Comprar por <b>${fmt(pd.cost)}</b>?`);
      btns([btn(`Comprar ${fmt(pd.cost)}`, 'primary', () => act('buy')), btn('Não', '', () => act('skip')), btn('ℹ️', '', () => showDeed(pd.square))]);
    } else if (pd.type === 'build') {
      add('title', `🏗️ Construir em ${sq.name}`);
      add('txt', `Aluguel atual: <b>${rentTxt(pd.square)}</b>`);
      btns(pd.options.map((o) => btn(`<span>${o.level === 5 ? '🏨' : '🏠'.repeat(o.level)} ${LEVEL_NAMES[o.level]}<small>aluguel ${fmt(sq.rent[o.level] * (S.copa === pd.square ? 2 : 1))}</small></span><span>${fmt(o.cost)}</span>`, 'opt' + (o === pd.options[pd.options.length - 1] ? ' primary' : ''), () => act('build', { level: o.level }))).concat([btn('Agora não', 'ghost', () => act('skip'))]), true);
    } else if (pd.type === 'buyout') {
      const o = pById(pd.owner);
      add('title', `💼 Tomar ${sq.name}?`);
      add('txt', `Pague <b>${fmt(pd.cost)}</b> a ${esc(o.name)} e a cidade passa a ser sua.`);
      btns([btn('Comprar à força', 'gold', () => act('buyout')), btn('Deixar pra lá', '', () => act('skip'))]);
    } else if (pd.type === 'travel') {
      add('title', '✈️ Viagem');
      add('txt', `Toque em qualquer casa do tabuleiro para viajar até ela por ${fmt(pd.cost)}.`);
      btns([btn('Ficar aqui', '', () => act('skip'))]);
    } else if (pd.type === 'copa') {
      add('title', '🏆 Copa do Mundo');
      add('txt', 'Toque numa cidade sua para sediar a Copa: o aluguel dela dobra.');
      btns([btn('Pular', '', () => act('skip'))]);
    }
  }
}

function renderLog() {
  const box = $('#log'); box.innerHTML = '';
  S.log.slice().reverse().forEach((l) => box.appendChild(el('div', '', esc(l.msg))));
}
function renderChat(prev, live) {
  const box = $('#chatMsgs');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = '';
  S.chat.forEach((m) => { const d = el('div'); d.innerHTML = `<b style="color:${m.color}">${esc(m.name)}</b>${esc(m.text)}`; box.appendChild(d); });
  if (atBottom) box.scrollTop = box.scrollHeight;
  const last = S.chat.length ? S.chat[S.chat.length - 1].t : 0;
  if (drawerTab === 'chat') { chatSeen = last; sessionStorage.setItem('mb_chatSeen', chatSeen); }
  const unseen = S.chat.filter((m) => m.t > chatSeen).length;
  $('#chatBadge').textContent = unseen;
  $('#chatBadge').classList.toggle('hidden', !unseen);
  // balão do chat junto ao jogador
  const prevT = prev && prev.chat && prev.chat.length ? prev.chat[prev.chat.length - 1].t : Infinity;
  S.chat.filter((m) => m.t > prevT).forEach((m) => {
    const p = S.players.find((x) => x.name === m.name && x.color === m.color);
    const c = p && $(`.pcard[data-id="${p.id}"]`); if (!c) return;
    c.querySelector('.cbubble')?.remove();
    const b = el('div', 'cbubble', esc(m.text)); c.appendChild(b);
    setTimeout(() => b.remove(), 4500);
  });
}

// gaveta de histórico/chat
function openDrawer(tab) {
  if (drawerTab === tab) return closeDrawer();
  drawerTab = tab;
  $('#drawer').classList.remove('hidden');
  document.querySelectorAll('.dtab').forEach((d) => d.classList.toggle('active', d.dataset.tab === tab));
  $('#log').classList.toggle('hidden', tab !== 'log');
  $('#chat').classList.toggle('hidden', tab !== 'chat');
  if (S) renderChat(null, false);
  if (tab === 'chat') { $('#chatMsgs').scrollTop = 1e9; $('#chatInput').focus(); }
}
function closeDrawer() { drawerTab = null; $('#drawer').classList.add('hidden'); }
document.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => openDrawer(b.dataset.open));
document.querySelectorAll('.dtab').forEach((b) => b.onclick = () => openDrawer(b.dataset.tab));
$('#drawerClose').onclick = closeDrawer;
$('#chatForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#chatInput').value.trim();
  if (v) socket.emit('chat', v);
  $('#chatInput').value = '';
};

// ---------- Fim de jogo ----------
function renderGameOver(prev) {
  const go = $('#gameover');
  if (!go.classList.contains('hidden')) return;
  const w = pById(S.winner);
  go.innerHTML = `<div class="card"><div>${w ? pawnSVG(w.color) : ''}</div><p class="eyebrow">Fim de jogo</p><h2>${w ? esc(w.name) + ' venceu!' : 'Fim de jogo'}</h2><p class="muted">${w && w.id === myId ? 'Você é o grande magnata do Brasil! 🏆' : 'Boa partida!'}</p></div>`;
  const b = btn('Voltar ao início', 'primary big', leave);
  go.querySelector('.card').appendChild(b);
  go.classList.remove('hidden');
  if (prev) Sfx.win();
  const colors = ['#ff5b6b', '#ffd23f', '#2fe08f', '#4fb3e8', '#b18cff', '#ff8c2b'];
  for (let i = 0; i < 90; i++) {
    const c = el('div', 'confetti');
    c.style.left = Math.random() * 100 + 'vw'; c.style.background = colors[i % colors.length];
    c.style.animationDuration = 2.5 + Math.random() * 2.5 + 's'; c.style.animationDelay = Math.random() * 1.5 + 's';
    go.appendChild(c);
  }
}

// ---------- Fichas (modais) ----------
function showDeed(i) {
  const sq = SQUARES[i], pr = S.props[i], owner = pById(pr.owner);
  const head = sq.type === 'city' ? GROUPS[sq.group].color : '#5b4a7a';
  let rows = '';
  if (sq.type === 'city') {
    rows = sq.rent.map((r, l) => `<div class="r ${owner && pr.level === l ? 'cur' : ''}"><span>${l === 5 ? '🏨' : '🏠'.repeat(l) || '🌱'} ${LEVEL_NAMES[l]}</span><span>${fmt(r)}</span></div>`).join('');
    rows += `<hr><div class="r"><span>Construção (por nível)</span><span>${fmt(GROUPS[sq.group].house)}</span></div>`;
    rows += `<div class="muted" style="font-size:12px">Terreno vale o dobro com a região completa. A Copa do Mundo dobra o aluguel.</div>`;
  } else if (sq.type === 'airport') {
    rows = [1, 2, 3, 4].map((n) => `<div class="r"><span>${'✈️'.repeat(n)} ${n} aeroporto${n > 1 ? 's' : ''}</span><span>${fmt(25 * 2 ** (n - 1))}</span></div>`).join('');
  } else {
    rows = `<div class="r"><span>1 companhia</span><span>4× dados</span></div><div class="r"><span>2 companhias</span><span>10× dados</span></div>`;
  }
  let info = '<hr>';
  if (owner) {
    info += `<div class="r"><span>Dono</span><b style="color:${shade(owner.color, -0.2)}">${esc(owner.name)}</b></div>`;
    info += `<div class="r"><span>Aluguel atual</span><b>${rentTxt(i)}</b></div>`;
    if (sq.type === 'city') info += `<div class="r"><span>Compra forçada (2×)</span><span>${pr.level === 5 ? 'Hotel: protegida' : fmt(invested(i) * 2)}</span></div>`;
    info += `<div class="r"><span>Venda ao banco</span><span>${fmt(Math.floor(invested(i) / 2))}</span></div>`;
  } else info += `<div class="r"><span>Dono</span><span>Banco · ${fmt(sq.price)}</span></div>`;
  const canSell = myTurn() && pr.owner === myId && ['roll', 'end', 'debt'].includes(S.phase);
  const sub = sq.type === 'city' ? GROUPS[sq.group].name : sq.type === 'airport' ? 'Aeroporto' : 'Companhia';
  openModal(`<div class="deed-head" style="background:${head}"><small>${sub}</small><h3>${sq.name}${S.copa === i ? ' 🏆' : ''}</h3></div>
    <div class="deed">${rows}${info}${canSell ? `<button class="danger" id="sellBtn">Vender por ${fmt(Math.floor(invested(i) / 2))}</button>` : ''}</div>`);
  if (canSell) $('#sellBtn').onclick = () => { act('sell', { square: i }); closeModal(); };
}
function showPlayer(p) {
  if (!p) return;
  const mine = Object.keys(S.props).map(Number).filter((k) => S.props[k].owner === p.id);
  const list = mine.length ? mine.map((k) => {
    const sq = SQUARES[k]; const c = sq.type === 'city' ? GROUPS[sq.group].color : '#5b4a7a';
    return `<div class="r"><span><span class="dot" style="background:${c}"></span>${sq.name}${S.copa === k ? ' 🏆' : ''}</span><span>${sq.type === 'city' ? (S.props[k].level === 5 ? '🏨' : '🏠'.repeat(S.props[k].level)) : ''}</span></div>`;
  }).join('') : '<div class="muted">Nenhuma propriedade ainda.</div>';
  const worth = p.money + mine.reduce((s, k) => s + invested(k), 0);
  openModal(`<div class="deed-head" style="background:${p.color}"><small>Jogador</small><h3>${esc(p.name)}</h3></div>
    <div class="deed"><div class="r"><span>Dinheiro</span><b>${fmt(p.money)}</b></div><div class="r"><span>Patrimônio</span><b>${fmt(worth)}</b></div>
    ${p.jailCards ? `<div class="r"><span>Habeas corpus</span><b>${p.jailCards}</b></div>` : ''}<hr>${list}</div>`);
}
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modalClose').onclick = closeModal;
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };

// ---------- Sala de espera ----------
function renderLobby() {
  show('#lobby');
  $('#lobbyCode').textContent = S.code;
  const ul = $('#lobbyPlayers'); ul.innerHTML = '';
  S.players.forEach((p) => {
    const li = el('li');
    li.innerHTML = `${pawnSVG(p.color)}<b>${esc(p.name)}</b>${p.id === myId ? ' <span class="muted">(você)</span>' : ''}${p.id === S.hostId ? '<span class="tag">👑 anfitrião</span>' : ''}${!p.connected ? '<span class="tag">offline</span>' : ''}`;
    ul.appendChild(li);
  });
  const host = S.hostId === myId, n = S.players.length;
  $('#btnStart').classList.toggle('hidden', !host);
  $('#btnStart').disabled = n < RULES.MIN_PLAYERS;
  $('#lobbyInfo').textContent = `${n}/${RULES.MAX_PLAYERS} jogadores. ` +
    (host ? (n < 2 ? 'Espere pelo menos mais 1 jogador.' : 'Comece quando todos estiverem aqui.') : 'Esperando o anfitrião começar…');
}

// ---------- Relógio do turno (anel no cartão) ----------
setInterval(() => {
  if (!S || S.status !== 'playing' || !S.deadline) return;
  const left = S.deadline - (Date.now() + clockOffset);
  const pct = Math.max(0, Math.min(100, (left / timerTotal) * 100));
  const c = $(`.pcard[data-id="${S.turn}"] .ring`);
  if (c) c.style.setProperty('--p', pct.toFixed(1));
}, 200);
