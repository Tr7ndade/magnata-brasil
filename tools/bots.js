// Teste: 6 bots entram numa sala e jogam até alguém vencer.
// Uso: node server.js  (num terminal)  e  node tools/bots.js [url]
const { io } = require('socket.io-client');
const URL = process.argv[2] || 'http://localhost:3000';
const N = Number(process.argv[3] || 6);
const names = ['Ana', 'Beto', 'Caio', 'Duda', 'Edu', 'Fabi'];
let code, done = false, actions = 0, lastState;
const bots = [];

function check(s) {
  // invariantes simples
  for (const [k, pr] of Object.entries(s.props)) {
    if (pr.level < 0 || pr.level > 5) throw new Error('nível inválido ' + k);
    if (pr.owner && !s.players.find((p) => p.id === pr.owner && !p.bankrupt)) throw new Error('dono inválido em ' + k);
  }
  if (s.status === 'playing') {
    const cur = s.players.find((p) => p.id === s.turn);
    if (cur.bankrupt) throw new Error('vez de jogador falido');
  }
}

function play(bot, s) {
  if (s.status !== 'playing' || s.turn !== bot.id) return;
  const key = JSON.stringify([s.phase, s.pending, s.log[s.log.length-1], s.lastRoll && s.lastRoll.t]);
  if (bot.lastKey === key) return;
  bot.lastKey = key;
  actions++;
  const me = s.players.find((p) => p.id === bot.id);
  const a = (type, x = {}) => setTimeout(() => bot.sock.emit('action', { type, ...x }), 2);
  switch (s.phase) {
    case 'roll': return me.inJail && me.money > 300 && Math.random() < 0.5 ? a('payJail') : a('roll');
    case 'end': return a('endTurn');
    case 'debt': {
      const mine = Object.keys(s.props).filter((k) => s.props[k].owner === bot.id);
      return mine.length && Math.random() < 0.9 ? a('sell', { square: Number(mine[0]) }) : a('bankrupt');
    }
    case 'action': {
      const pd = s.pending;
      if (pd.type === 'buy') return a(Math.random() < 0.85 ? 'buy' : 'skip');
      if (pd.type === 'build') return a('build', { level: pd.options[pd.options.length - 1].level });
      if (pd.type === 'buyout') return a(Math.random() < 0.5 ? 'buyout' : 'skip');
      if (pd.type === 'travel') return a('travel', { target: [0,5,15,25,35,39,24][Math.floor(Math.random() * 7)] });
      if (pd.type === 'copa') {
        const mine = Object.keys(s.props).filter((k) => s.props[k].owner === bot.id && s.props[k] && [1,3,6,8,9,11,13,14,16,18,19,21,23,24,26,27,29,31,32,34,37,39].includes(Number(k)));
        return a('copa', { target: Number(mine[Math.floor(Math.random() * mine.length)]) });
      }
    }
  }
}

function makeBot(i) {
  return new Promise((res) => {
    const sock = io(URL, { transports: ['websocket'] });
    const bot = { sock, id: null };
    bots.push(bot);
    sock.on('state', (s) => {
      lastState = s;
      try { check(s); } catch (e) { console.error('FALHA:', e.message); process.exit(1); }
      if (s.status === 'ended' && !done) {
        done = true;
        const w = s.players.find((p) => p.id === s.winner);
        console.log(`Fim! Vencedor: ${w && w.name} após ${s.round} rodadas e ${actions} ações.`);
        console.log(s.log.slice(-8).map((l) => '  ' + l.msg).join('\n'));
        process.exit(0);
      }
      play(bot, s);
    });
    sock.on('connect', () => {
      const cb = (r) => { if (!r.ok) throw new Error(r.error); bot.id = r.id; code = r.code; res(bot); };
      if (i === 0) sock.emit('create', { name: names[i] }, cb);
      else sock.emit('join', { code, name: names[i] }, cb);
    });
  });
}

(async () => {
  for (let i = 0; i < N; i++) await makeBot(i);
  console.log('Sala', code, 'com', N, 'bots');
  // 7º jogador deve ser recusado
  const extra = io(URL, { transports: ['websocket'] });
  await new Promise((r) => extra.emit('join', { code, name: 'Extra' }, (x) => { console.log('7º jogador:', x.ok ? 'ENTROU' : 'recusado: ' + x.error); r(); }));
  bots[0].sock.emit('start');
  setTimeout(() => {
    console.log('Tempo esgotado. Rodada', lastState.round, 'ações', actions, 'fase', lastState.phase, JSON.stringify(lastState.pending), 'vez', lastState.players.find(p=>p.id===lastState.turn).name); console.log(lastState.log.slice(-5).map(l=>l.msg).join('\n'));
    console.log(lastState.players.map((p) => `${p.name}: ${p.bankrupt ? 'falido' : p.money}`).join(', '));
    process.exit(0);
  }, Number(process.argv[4] || 60000));
})();
