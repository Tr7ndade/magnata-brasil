/* global io, BOARD */
const { SQUARES, GROUPS, RULES, LEVEL_NAMES } = BOARD;
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmt = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const socket = io();
let S = null;          // último estado recebido
let myId = null;
let clockOffset = 0;
let timerTotal = 1;
let lastDeadline = null;
let lastRollT = 0, lastCardT = 0;
let chatSeen = 0, chatTab = false;
const disp = {};       // posição exibida de cada peão (para animar)

const ICONS = { start: '🏁', chance: '❓', tax: '🧾', airport: '✈️', jail: '🚔', travel: '🧳', gotojail: '👮', copa: '🏆' };
const sqIcon = (sq) => sq.type === 'utility' ? (sq.name.includes('Energia') ? '⚡' : '💧') : ICONS[sq.type] || '';

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

function show(id) {
  ['#home', '#lobby', '#game'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
}
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
function leave() { socket.emit('leave'); session.clear(); myId = null; S = null; history.replaceState(null, '', location.pathname); show('#home'); }
$('#btnLeave').onclick = leave;
$('#btnQuit').onclick = () => {
  if (S && S.status === 'playing' && !confirm('Sair agora conta como falência. Tem certeza?')) return;
  leave();
};

socket.on('connect', () => {
  const s = session.get();
  if (s && (!urlCode || urlCode.toUpperCase() === s.code)) {
    socket.emit('join', { code: s.code, token: s.token, name: savedName }, onJoined);
  }
});

socket.on('state', (st) => {
  S = st;
  clockOffset = st.now - Date.now();
  if (st.deadline !== lastDeadline) { lastDeadline = st.deadline; timerTotal = Math.max(1, st.deadline - st.now); }
  render();
});

// ---------- Tabuleiro ----------
function gridPos(i) {
  if (i <= 10) return { r: 11, c: 11 - i, side: i === 0 || i === 10 ? 'corner' : 'b' };
  if (i <= 20) return { r: 11 - (i - 10), c: 1, side: i === 20 ? 'corner' : 'l' };
  if (i <= 30) return { r: 1, c: 1 + (i - 20), side: i === 30 ? 'corner' : 't' };
  return { r: 1 + (i - 30), c: 11, side: 'r' };
}

const sqEls = [];
(function buildBoard() {
  const board = $('#board');
  SQUARES.forEach((sq, i) => {
    const g = gridPos(i);
    const d = el('div', `sq ${g.side === 'corner' ? 'corner' : 'side-' + g.side}`);
    d.style.gridRow = g.r; d.style.gridColumn = g.c;
    if (sq.type === 'city') {
      d.style.setProperty('--g', GROUPS[sq.group].color);
      d.innerHTML = `<div class="bar"></div><div class="nm">${sq.name}</div><div class="lvl"></div><div class="pr">${fmt(sq.price)}</div>`;
    } else {
      d.innerHTML = `<div class="ic">${sqIcon(sq)}</div><div class="nm">${sq.name}</div>${sq.price ? `<div class="pr">${fmt(sq.price)}</div>` : sq.amount ? `<div class="pr">${fmt(sq.amount)}</div>` : ''}`;
    }
    d.appendChild(el('div', 'tokens'));
    d.onclick = () => onSquareClick(i);
    board.appendChild(d);
    sqEls[i] = d;
  });
})();

const pById = (id) => S && S.players.find((p) => p.id === id);
const me = () => pById(myId);
const myTurn = () => S && S.status === 'playing' && S.turn === myId;

function pickable() {
  if (!myTurn() || S.phase !== 'action' || !S.pending) return null;
  if (S.pending.type === 'travel') return (i) => i !== 20;
  if (S.pending.type === 'copa') return (i) => SQUARES[i].type === 'city' && S.props[i].owner === myId;
  return null;
}

function onSquareClick(i) {
  if (!S || S.status === 'lobby') return;
  const pick = pickable();
  if (pick) {
    if (!pick(i)) return;
    if (S.pending.type === 'travel') return act('travel', { target: i });
    return act('copa', { target: i });
  }
  if (SQUARES[i].price) showDeed(i);
}

function act(type, extra = {}) { socket.emit('action', { type, ...extra }); }

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
function invested(i) { const sq = SQUARES[i]; return sq.price + (sq.type === 'city' ? S.props[i].level * GROUPS[sq.group].house : 0); }

function showDeed(i) {
  const sq = SQUARES[i], pr = S.props[i], owner = pById(pr.owner);
  const head = sq.type === 'city' ? GROUPS[sq.group].color : '#34495e';
  let rows = '';
  if (sq.type === 'city') {
    rows = sq.rent.map((r, l) => `<div class="r ${owner && pr.level === l ? 'cur' : ''}"><span>${LEVEL_NAMES[l]}</span><span>${fmt(r)}</span></div>`).join('');
    rows += `<hr><div class="r"><span>Construção (por nível)</span><span>${fmt(GROUPS[sq.group].house)}</span></div>`;
    rows += `<div class="muted" style="font-size:12px">Terreno vale o dobro com a região completa. Copa do Mundo dobra o aluguel.</div>`;
  } else if (sq.type === 'airport') {
    rows = [1, 2, 3, 4].map((n) => `<div class="r"><span>${n} aeroporto${n > 1 ? 's' : ''}</span><span>${fmt(25 * 2 ** (n - 1))}</span></div>`).join('');
  } else {
    rows = `<div class="r"><span>1 companhia</span><span>4× dados</span></div><div class="r"><span>2 companhias</span><span>10× dados</span></div>`;
  }
  let info = '<hr>';
  if (owner) {
    info += `<div class="r"><span>Dono</span><b style="color:${owner.color}">${esc(owner.name)}</b></div>`;
    info += `<div class="r"><span>Aluguel atual</span><b>${typeof rentNow(i) === 'number' ? fmt(rentNow(i)) : rentNow(i)}</b></div>`;
    if (sq.type === 'city') info += `<div class="r"><span>Preço de compra (2×)</span><span>${pr.level === 5 ? 'Hotel: não pode' : fmt(invested(i) * 2)}</span></div>`;
    info += `<div class="r"><span>Venda ao banco</span><span>${fmt(Math.floor(invested(i) / 2))}</span></div>`;
  } else info += `<div class="r"><span>Dono</span><span>Banco (à venda por ${fmt(sq.price)})</span></div>`;
  const canSell = myTurn() && pr.owner === myId && ['roll', 'end', 'debt'].includes(S.phase);
  const sub = sq.type === 'city' ? GROUPS[sq.group].name : sq.type === 'airport' ? 'Aeroporto' : 'Companhia';
  openModal(`<div class="deed-head" style="background:${head}"><small>${sub}</small><h3>${sq.name}${S.copa === i ? ' 🏆' : ''}</h3></div>
    <div class="deed">${rows}${info}${canSell ? `<button class="danger" id="sellBtn">Vender por ${fmt(Math.floor(invested(i) / 2))}</button>` : ''}</div>`);
  if (canSell) $('#sellBtn').onclick = () => { act('sell', { square: i }); closeModal(); };
}

function showPlayer(p) {
  const mine = Object.keys(S.props).map(Number).filter((k) => S.props[k].owner === p.id);
  const list = mine.length ? mine.map((k) => {
    const sq = SQUARES[k]; const c = sq.type === 'city' ? GROUPS[sq.group].color : '#34495e';
    return `<div class="r"><span><span class="dot" style="display:inline-block;background:${c};vertical-align:middle;margin-right:6px"></span>${sq.name}${S.copa === k ? ' 🏆' : ''}</span><span>${sq.type === 'city' ? LEVEL_NAMES[S.props[k].level] : ''}</span></div>`;
  }).join('') : '<div class="muted">Nenhuma propriedade.</div>';
  const worth = p.money + mine.reduce((s, k) => s + invested(k), 0);
  openModal(`<div class="deed-head" style="background:${p.color}"><small>Jogador</small><h3>${esc(p.name)}</h3></div>
    <div class="deed"><div class="r"><span>Dinheiro</span><b>${fmt(p.money)}</b></div><div class="r"><span>Patrimônio</span><b>${fmt(worth)}</b></div>
    ${p.jailCards ? `<div class="r"><span>Habeas corpus</span><b>${p.jailCards}</b></div>` : ''}<hr>${list}</div>`);
}

function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modalClose').onclick = closeModal;
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };

// ---------- Render ----------
function render() {
  if (!S) return;
  if (S.status === 'lobby') return renderLobby();
  show('#game');
  renderSquares();
  syncTokens();
  renderPlayers();
  renderDice();
  renderCard();
  renderPrompt();
  renderLog();
  renderChat();
}

function renderLobby() {
  show('#lobby');
  $('#lobbyCode').textContent = S.code;
  const ul = $('#lobbyPlayers'); ul.innerHTML = '';
  S.players.forEach((p) => {
    const li = el('li');
    li.innerHTML = `<span class="dot" style="background:${p.color}"></span><b>${esc(p.name)}</b>${p.id === myId ? ' <span class="muted">(você)</span>' : ''}${p.id === S.hostId ? '<span class="tag">anfitrião</span>' : ''}${!p.connected ? '<span class="tag">offline</span>' : ''}`;
    ul.appendChild(li);
  });
  const host = S.hostId === myId, n = S.players.length;
  $('#btnStart').classList.toggle('hidden', !host);
  $('#btnStart').disabled = n < RULES.MIN_PLAYERS;
  $('#lobbyInfo').textContent = `${n}/${RULES.MAX_PLAYERS} jogadores. ` +
    (host ? (n < 2 ? 'Espere pelo menos mais 1 jogador.' : 'Comece quando todos estiverem aqui.') : 'Esperando o anfitrião começar…');
}

function renderSquares() {
  const pick = pickable();
  const cur = pById(S.turn);
  SQUARES.forEach((sq, i) => {
    const d = sqEls[i];
    const pr = S.props[i];
    const owner = pr && pById(pr.owner);
    d.classList.toggle('owned', !!owner);
    if (owner) d.style.setProperty('--own', owner.color);
    if (sq.type === 'city') d.querySelector('.lvl').textContent = pr.level === 5 ? '🏨' : '🏠'.repeat(pr.level);
    let cp = d.querySelector('.copa');
    if (S.copa === i && !cp) { cp = el('div', 'copa', '🏆'); d.appendChild(cp); }
    if (S.copa !== i && cp) cp.remove();
    const prEl = d.querySelector('.pr');
    if (prEl && sq.price) prEl.textContent = owner ? (typeof rentNow(i) === 'number' ? fmt(rentNow(i)) : rentNow(i)) : fmt(sq.price);
    d.classList.toggle('pick', !!pick && pick(i));
    d.classList.toggle('dim', !!pick && !pick(i));
    d.classList.toggle('here', !pick && cur && S.status === 'playing' && disp[cur.id] === i && cur.pos === i);
  });
}

function syncTokens() {
  S.players.forEach((p) => {
    if (p.bankrupt) { delete disp[p.id]; return; }
    if (disp[p.id] === undefined) disp[p.id] = p.pos;
    else if (disp[p.id] !== p.pos) {
      const d = (p.pos - disp[p.id] + 40) % 40;
      if (d > 12 || p.inJail) disp[p.id] = p.pos; // teleporte (viagem, prisão, voltar casas)
    }
  });
  drawTokens();
}
setInterval(() => {
  if (!S || S.status === 'lobby') return;
  let moved = false;
  S.players.forEach((p) => { if (disp[p.id] !== undefined && disp[p.id] !== p.pos) { disp[p.id] = (disp[p.id] + 1) % 40; moved = true; } });
  if (moved) { drawTokens(); renderSquares(); }
}, 140);

function drawTokens() {
  sqEls.forEach((d) => { d.querySelector('.tokens').innerHTML = ''; });
  S.players.forEach((p) => {
    if (p.bankrupt || disp[p.id] === undefined) return;
    const t = el('div', 'token' + (p.id === myId ? ' me' : ''), esc(p.name[0].toUpperCase()));
    t.style.setProperty('--c', p.color);
    t.title = p.name;
    sqEls[disp[p.id]].querySelector('.tokens').appendChild(t);
  });
}

function renderPlayers() {
  const box = $('#players'); box.innerHTML = '';
  S.players.forEach((p) => {
    const n = Object.values(S.props).filter((x) => x.owner === p.id).length;
    const flags = [p.inJail ? '🔒 preso' : '', !p.connected && !p.bankrupt ? '📴 offline' : '', p.jailCards ? '📜' : ''].filter(Boolean).join(' · ');
    const d = el('div', `pl ${S.turn === p.id && S.status === 'playing' ? 'turn' : ''} ${p.bankrupt ? 'out' : ''}`);
    d.innerHTML = `<span class="dot" style="background:${p.color}"></span>
      <div style="min-width:0"><div class="nm">${esc(p.name)}${p.id === myId ? ' (você)' : ''}</div>
      <div class="meta">${p.bankrupt ? '💀 falido' : `${n} propriedade${n === 1 ? '' : 's'}${flags ? ' · ' + flags : ''}`}</div></div>
      <div class="cash ${p.money < 0 ? 'neg' : ''}">${p.bankrupt ? '—' : fmt(p.money)}</div>`;
    d.onclick = () => showPlayer(p);
    box.appendChild(d);
  });
}

const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
function drawDie(node, v) {
  node.innerHTML = '';
  for (let k = 1; k <= 9; k++) {
    const i = el('i'); if (!PIPS[v].includes(k)) i.style.visibility = 'hidden';
    i.style.gridArea = `${Math.ceil(k / 3)} / ${((k - 1) % 3) + 1}`;
    node.appendChild(i);
  }
}
function renderDice() {
  const r = S.lastRoll || { d1: 1, d2: 1, t: 0 };
  drawDie($('#d1'), r.d1); drawDie($('#d2'), r.d2);
  if (r.t && r.t !== lastRollT) {
    lastRollT = r.t;
    ['#d1', '#d2'].forEach((s) => { const n = $(s); n.classList.remove('roll'); void n.offsetWidth; n.classList.add('roll'); });
  }
}

function renderCard() {
  const c = S.lastCard, box = $('#cardShow');
  if (c && c.t !== lastCardT) {
    lastCardT = c.t;
    const p = pById(c.id);
    box.innerHTML = `<b>❓ Sorte ou Revés</b><br>${esc(p ? p.name : '')}: ${esc(c.text)}`;
    box.classList.remove('hidden');
    clearTimeout(renderCard.h); renderCard.h = setTimeout(() => box.classList.add('hidden'), 4500);
  }
}

function btn(label, cls, fn) { const b = el('button', cls, label); b.onclick = fn; return b; }

function renderPrompt() {
  const box = $('#prompt'); box.innerHTML = '';
  const title = (t) => box.appendChild(el('div', 'title', t));
  const text = (t) => box.appendChild(el('div', '', t));
  const btns = (...bs) => { const w = el('div', 'btns'); bs.forEach((b) => w.appendChild(b)); box.appendChild(w); };

  if (S.status === 'ended') {
    const w = pById(S.winner);
    title(w ? `🏆 ${esc(w.name)} venceu!` : 'Fim de jogo');
    text(w && w.id === myId ? 'Você é o grande magnata do Brasil!' : 'Boa partida!');
    btns(btn('Voltar ao início', 'primary', leave));
    $('#timer').classList.add('hidden');
    return;
  }
  $('#timer').classList.remove('hidden');
  const cur = pById(S.turn), pd = S.pending, p = me();
  if (!myTurn()) {
    title(`Vez de <span style="color:${cur.color}">${esc(cur.name)}</span>`);
    const sqn = pd && pd.square != null ? SQUARES[pd.square].name : '';
    const what = {
      roll: 'Rolando os dados…', end: 'Terminando a jogada…', debt: 'Vendendo propriedades para pagar dívidas…',
      buy: `Decidindo se compra ${sqn}…`, build: `Construindo em ${sqn}…`, buyout: `Pensando em comprar ${sqn} de você…`,
      travel: 'Escolhendo um destino de viagem…', copa: 'Escolhendo a cidade-sede da Copa…',
    };
    let w = S.phase === 'action' && pd ? what[pd.type] : what[S.phase];
    if (pd && pd.type === 'buyout' && pd.owner !== myId) w = `Pensando em comprar ${sqn} de ${esc(pById(pd.owner)?.name || '')}…`;
    text(w || '');
    if (!cur.connected) text('<span class="muted">(desconectado: jogada automática em instantes)</span>');
    return;
  }

  if (S.phase === 'roll') {
    if (p.inJail) {
      title('Você está na Prisão 🔒');
      text(`Tire uma dupla para sair (tentativa ${p.jailTries + 1}/3) ou pague a fiança.`);
      const bs = [btn('🎲 Tentar dupla', 'primary', () => act('roll'))];
      if (p.money >= RULES.JAIL_FINE) bs.push(btn(`Pagar ${fmt(RULES.JAIL_FINE)}`, '', () => act('payJail')));
      if (p.jailCards) bs.push(btn('📜 Usar habeas corpus', '', () => act('useCard')));
      btns(...bs);
    } else {
      title('Sua vez!');
      btns(btn('🎲 Rolar dados', 'primary', () => act('roll')));
    }
  } else if (S.phase === 'end') {
    title('Jogada concluída');
    text('<span class="muted">Clique numa propriedade sua se quiser vender.</span>');
    btns(btn('Encerrar turno ➜', 'primary', () => act('endTurn')));
  } else if (S.phase === 'debt') {
    title(`Você está devendo ${fmt(-p.money)} ⚠️`);
    text('Venda propriedades ao banco (metade do valor investido):');
    const list = el('div', 'sellList');
    Object.keys(S.props).map(Number).filter((k) => S.props[k].owner === myId).forEach((k) => {
      list.appendChild(btn(`${SQUARES[k].name} +${fmt(Math.floor(invested(k) / 2))}`, '', () => act('sell', { square: k })));
    });
    box.appendChild(list);
    btns(btn('Declarar falência', 'danger', () => { if (confirm('Declarar falência? Você sai da partida.')) act('bankrupt'); }));
  } else if (S.phase === 'action' && pd) {
    const sq = pd.square != null ? SQUARES[pd.square] : null;
    if (pd.type === 'buy') {
      title(`Comprar ${sq.name}?`);
      text(`Preço: <b>${fmt(pd.cost)}</b>. Você tem ${fmt(p.money)}.`);
      btns(btn('Comprar', 'primary', () => act('buy')), btn('Não comprar', '', () => act('skip')), btn('Ver detalhes', '', () => showDeed(pd.square)));
    } else if (pd.type === 'build') {
      title(`Construir em ${sq.name}`);
      text(`Agora: ${LEVEL_NAMES[S.props[pd.square].level]}. Aluguel atual: ${fmt(rentNow(pd.square))}.`);
      btns(...pd.options.map((o) => btn(`${LEVEL_NAMES[o.level]} · ${fmt(o.cost)}<br><small>aluguel ${fmt(sq.rent[o.level] * (S.copa === pd.square ? 2 : 1))}</small>`, o.level === 5 ? 'primary' : '', () => act('build', { level: o.level }))), btn('Agora não', '', () => act('skip')));
    } else if (pd.type === 'buyout') {
      const o = pById(pd.owner);
      title(`Comprar ${sq.name} de ${esc(o.name)}?`);
      text(`Você pode tomar a cidade pagando o dobro do valor investido: <b>${fmt(pd.cost)}</b> (vai para ${esc(o.name)}).`);
      btns(btn('Comprar à força 💼', 'primary', () => act('buyout')), btn('Deixar pra lá', '', () => act('skip')));
    } else if (pd.type === 'travel') {
      title('✈️ Viagem');
      text(`Clique em qualquer casa do tabuleiro para viajar até ela por ${fmt(pd.cost)}.`);
      btns(btn('Ficar aqui', '', () => act('skip')));
    } else if (pd.type === 'copa') {
      title('🏆 Copa do Mundo');
      text('Clique numa cidade sua para sediar a Copa: o aluguel dela dobra.');
      btns(btn('Pular', '', () => act('skip')));
    }
  }
}

function renderLog() {
  const box = $('#log');
  box.innerHTML = '';
  S.log.slice().reverse().forEach((l) => box.appendChild(el('div', '', esc(l.msg))));
}

function renderChat() {
  const box = $('#chatMsgs');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = '';
  S.chat.forEach((m) => {
    const d = el('div');
    d.innerHTML = `<b style="color:${m.color}">${esc(m.name)}</b>${esc(m.text)}`;
    box.appendChild(d);
  });
  if (atBottom) box.scrollTop = box.scrollHeight;
  const last = S.chat.length ? S.chat[S.chat.length - 1].t : 0;
  if (chatTab) chatSeen = last;
  const unseen = S.chat.filter((m) => m.t > chatSeen).length;
  $('#chatBadge').textContent = unseen;
  $('#chatBadge').classList.toggle('hidden', !unseen || chatTab);
}

document.querySelectorAll('.tab').forEach((t) => t.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  chatTab = t.dataset.tab === 'chat';
  $('#log').classList.toggle('hidden', chatTab);
  $('#chat').classList.toggle('hidden', !chatTab);
  if (S) renderChat();
  if (chatTab) $('#chatMsgs').scrollTop = 1e9;
});
$('#chatForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#chatInput').value.trim();
  if (v) socket.emit('chat', v);
  $('#chatInput').value = '';
};

// Barra de tempo do turno
setInterval(() => {
  if (!S || !S.deadline) return;
  const left = S.deadline - (Date.now() + clockOffset);
  const pct = Math.max(0, Math.min(100, (left / timerTotal) * 100));
  const bar = $('#timerBar');
  bar.style.width = pct + '%';
  bar.classList.toggle('low', left < 10000);
}, 250);
