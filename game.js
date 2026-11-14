// Motor do jogo: toda a lógica roda no servidor (os clientes só pedem ações).
const { SQUARES, GROUPS, RULES, LEVEL_NAMES } = require('./public/board-data');

const { START_MONEY, SALARY, JAIL_FINE, TRAVEL_COST, MAX_PLAYERS, MIN_PLAYERS } = RULES;
const TURN_MS = 60000;   // tempo por decisão
const AWAY_MS = 8000;    // tempo quando o jogador está desconectado
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#ff8c2b'];
const AIRPORTS = [5, 15, 25, 35];
const money = (v) => 'R$ ' + v.toLocaleString('pt-BR');

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const die = () => 1 + Math.floor(Math.random() * 6);

// Cartas de Sorte ou Revés. Cada uma termina movendo o jogador ou chamando g.finish(p).
const CARDS = [
  { text: 'Avance até o Início e receba R$ 200.', run: (g, p) => g.moveTo(p, 0) },
  { text: 'Vá para São Paulo.', run: (g, p) => g.moveTo(p, 39) },
  { text: 'Vá para Salvador. Se passar pelo Início, receba R$ 200.', run: (g, p) => g.moveTo(p, 24) },
  { text: 'Vá para o aeroporto mais próximo.', run: (g, p) => g.moveTo(p, AIRPORTS.find((a) => a > p.pos) ?? 5) },
  { text: 'Restituição do Imposto de Renda: receba R$ 150.', run: (g, p) => { p.money += 150; g.finish(p); } },
  { text: 'É seu aniversário! Receba R$ 50 de cada jogador.', run: (g, p) => { g.alive().filter((o) => o !== p).forEach((o) => g.pay(o, p, 50)); g.finish(p); } },
  { text: 'Você virou síndico do prédio. Pague R$ 50 a cada jogador.', run: (g, p) => { g.alive().filter((o) => o !== p).forEach((o) => g.pay(p, o, 50)); g.finish(p); } },
  { text: 'Multa por excesso de velocidade: pague R$ 100.', run: (g, p) => { g.pay(p, null, 100); g.finish(p); } },
  { text: 'Volte 3 casas.', run: (g, p) => { p.pos = (p.pos + 37) % 40; g.land(p); } },
  { text: 'Vá direto para a Prisão.', run: (g, p) => { g.sendToJail(p); g.finish(p); } },
  { text: 'Habeas corpus! Guarde esta carta para sair da Prisão.', run: (g, p) => { p.jailCards++; g.finish(p); } },
  { text: 'Reforma geral: pague R$ 25 por nível construído em suas cidades.', run: (g, p) => {
      const lv = Object.values(g.props).filter((pr) => pr.owner === p.id).reduce((s, pr) => s + pr.level, 0);
      g.pay(p, null, lv * 25); g.finish(p);
    } },
  { text: 'Você ganhou na Mega-Sena: receba R$ 200.', run: (g, p) => { p.money += 200; g.finish(p); } },
  { text: 'Viagem de negócios: vá para a casa Viagem.', run: (g, p) => g.moveTo(p, 20) },
  { text: 'Suas ações subiram: receba R$ 100.', run: (g, p) => { p.money += 100; g.finish(p); } },
  { text: 'O carro quebrou na estrada: pague R$ 75.', run: (g, p) => { g.pay(p, null, 75); g.finish(p); } },
];

class Game {
  constructor(code, onChange) {
    this.code = code;
    this.onChange = onChange;
    this.players = [];
    this.status = 'lobby'; // lobby | playing | ended
    this.hostId = null;
    this.props = {};
    SQUARES.forEach((s, i) => { if (s.price) this.props[i] = { owner: null, level: 0 }; });
    this.copa = null;
    this.log = [];
    this.chat = [];
    this.turn = 0;
    this.phase = null; // roll | action | debt | end
    this.pending = null;
    this.doubles = 0;
    this.extraTurn = false;
    this.lastRoll = null;
    this.lastCard = null;
    this.round = 1;
    this.winner = null;
    this.timer = null;
    this.deadline = null;
    this.deck = shuffle(CARDS.map((_, i) => i));
    this.lastActive = Date.now();
  }

  emit() { this.lastActive = Date.now(); this.onChange && this.onChange(); }
  get current() { return this.players[this.turn]; }
  player(id) { return this.players.find((p) => p.id === id); }
  alive() { return this.players.filter((p) => !p.bankrupt); }
  addLog(msg) { this.log.push({ t: Date.now(), msg }); if (this.log.length > 100) this.log.shift(); }

  // ---------- Sala ----------
  addPlayer(id, token, name) {
    if (this.status !== 'lobby') return 'A partida já começou.';
    if (this.players.length >= MAX_PLAYERS) return 'Sala cheia (máximo de 6 jogadores).';
    const used = this.players.map((p) => p.color);
    this.players.push({
      id, token, name, color: COLORS.find((c) => !used.includes(c)),
      money: START_MONEY, pos: 0, inJail: false, jailTries: 0, jailCards: 0,
      bankrupt: false, connected: true, socketId: null,
    });
    if (!this.hostId) this.hostId = id;
    return null;
  }

  removePlayer(id) {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.hostId === id) this.hostId = this.players[0] ? this.players[0].id : null;
  }

  start(byId) {
    if (byId !== this.hostId || this.status !== 'lobby' || this.players.length < MIN_PLAYERS) return;
    shuffle(this.players);
    this.status = 'playing';
    this.turn = 0;
    this.addLog(`🎉 A partida começou com ${this.players.length} jogadores!`);
    this.beginTurn();
  }

  // ---------- Turnos ----------
  beginTurn() {
    this.phase = 'roll';
    this.pending = null;
    this.doubles = 0;
    this.extraTurn = false;
    this.addLog(`▶ Vez de ${this.current.name}.`);
    this.resetTimer();
  }

  nextTurn() {
    if (this.status !== 'playing') return;
    let n = this.turn;
    do {
      n = (n + 1) % this.players.length;
      if (n === 0) this.round++;
    } while (this.players[n].bankrupt);
    this.turn = n;
    this.beginTurn();
  }

  resetTimer() {
    clearTimeout(this.timer);
    if (this.status !== 'playing') { this.deadline = null; return; }
    const ms = this.current.connected ? TURN_MS : AWAY_MS;
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => {
      try { this.autoAct(); } catch (e) { console.error(e); }
      this.resetTimer();
      this.emit();
    }, ms);
  }

  stop() { clearTimeout(this.timer); }

  // Quando o tempo acaba, o servidor joga pelo jogador (de forma conservadora).
  autoAct() {
    const p = this.current;
    if (!p || this.status !== 'playing') return;
    switch (this.phase) {
      case 'roll': this.act_roll(p); break;
      case 'action': this.act_skip(p); break;
      case 'debt': this.autoSettle(p); if (!p.bankrupt) this.finish(p); break;
      case 'end': this.nextTurn(); break;
    }
  }

  handle(id, type, data = {}) {
    if (this.status !== 'playing') return;
    if (type === 'bankrupt') {
      const q = this.player(id);
      if (q && !q.bankrupt) this.goBankrupt(q, 'declarou falência');
      return;
    }
    const p = this.current;
    if (!p || p.id !== id) return;
    const fn = this['act_' + type];
    if (typeof fn !== 'function') return;
    fn.call(this, p, data);
    if (this.status === 'playing' && this.current === p) this.resetTimer();
  }

  // ---------- Ações do jogador ----------
  act_roll(p) {
    if (this.phase !== 'roll') return;
    const d1 = die(), d2 = die(), total = d1 + d2, dbl = d1 === d2;
    this.lastRoll = { d1, d2, id: p.id, t: Date.now() };
    this.extraTurn = false;

    if (p.inJail) {
      p.jailTries++;
      if (dbl) {
        p.inJail = false; p.jailTries = 0;
        this.addLog(`🔓 ${p.name} tirou ${d1}+${d2} (dupla) e saiu da Prisão.`);
        return this.move(p, total);
      }
      if (p.jailTries >= 3) {
        p.inJail = false; p.jailTries = 0;
        this.addLog(`🔓 ${p.name} pagou ${money(JAIL_FINE)} após 3 tentativas e saiu da Prisão.`);
        this.pay(p, null, JAIL_FINE);
        return this.move(p, total);
      }
      this.addLog(`🔒 ${p.name} tirou ${d1}+${d2} e continua preso (${p.jailTries}/3).`);
      this.phase = 'end';
      return;
    }

    if (dbl) {
      this.doubles++;
      if (this.doubles >= 3) {
        this.addLog(`🚨 ${p.name} tirou 3 duplas seguidas e foi preso!`);
        this.sendToJail(p);
        return this.finish(p);
      }
      this.extraTurn = true;
    }
    this.addLog(`🎲 ${p.name} tirou ${d1}+${d2} = ${total}${dbl ? ' (dupla!)' : ''}.`);
    this.move(p, total);
  }

  act_payJail(p) {
    if (this.phase !== 'roll' || !p.inJail || p.money < JAIL_FINE) return;
    this.pay(p, null, JAIL_FINE);
    p.inJail = false; p.jailTries = 0;
    this.addLog(`🔓 ${p.name} pagou ${money(JAIL_FINE)} de fiança.`);
  }

  act_useCard(p) {
    if (this.phase !== 'roll' || !p.inJail || p.jailCards < 1) return;
    p.jailCards--; p.inJail = false; p.jailTries = 0;
    this.addLog(`📜 ${p.name} usou o habeas corpus e saiu da Prisão.`);
  }

  act_buy(p) {
    const pd = this.pending;
    if (this.phase !== 'action' || !pd || pd.type !== 'buy' || p.money < pd.cost) return;
    const sq = SQUARES[pd.square];
    this.pay(p, null, pd.cost);
    this.props[pd.square].owner = p.id;
    this.addLog(`🏷️ ${p.name} comprou ${sq.name} por ${money(pd.cost)}.`);
    if (sq.type === 'city') return this.offerBuild(p, pd.square);
    this.finish(p);
  }

  act_build(p, { level }) {
    const pd = this.pending;
    if (this.phase !== 'action' || !pd || pd.type !== 'build') return;
    const opt = pd.options.find((o) => o.level === Number(level));
    if (!opt || p.money < opt.cost) return;
    this.pay(p, null, opt.cost);
    this.props[pd.square].level = opt.level;
    this.addLog(`🏗️ ${p.name} construiu em ${SQUARES[pd.square].name}: ${LEVEL_NAMES[opt.level]} (${money(opt.cost)}).`);
    this.finish(p);
  }

  act_buyout(p) {
    const pd = this.pending;
    if (this.phase !== 'action' || !pd || pd.type !== 'buyout' || p.money < pd.cost) return;
    const pr = this.props[pd.square];
    const owner = this.player(pr.owner);
    this.pay(p, owner, pd.cost);
    pr.owner = p.id;
    this.addLog(`💼 ${p.name} comprou ${SQUARES[pd.square].name} de ${owner.name} por ${money(pd.cost)}!`);
    this.offerBuild(p, pd.square);
  }

  act_travel(p, { target }) {
    const pd = this.pending;
    target = Number(target);
    if (this.phase !== 'action' || !pd || pd.type !== 'travel') return;
    if (!Number.isInteger(target) || target < 0 || target > 39 || target === 20) return;
    if (p.money < TRAVEL_COST) return;
    this.pay(p, null, TRAVEL_COST);
    this.pending = null;
    this.addLog(`✈️ ${p.name} pagou ${money(TRAVEL_COST)} e viajou para ${SQUARES[target].name}.`);
    this.moveTo(p, target);
  }

  act_copa(p, { target }) {
    const pd = this.pending;
    target = Number(target);
    if (this.phase !== 'action' || !pd || pd.type !== 'copa') return;
    const pr = this.props[target];
    if (!pr || pr.owner !== p.id || SQUARES[target].type !== 'city') return;
    this.copa = target;
    this.addLog(`🏆 ${p.name} levou a Copa do Mundo para ${SQUARES[target].name}: aluguel em dobro!`);
    this.finish(p);
  }

  act_skip(p) {
    if (this.phase !== 'action') return;
    this.finish(p);
  }

  act_sell(p, { square }) {
    square = Number(square);
    if (!['roll', 'end', 'debt'].includes(this.phase)) return;
    const pr = this.props[square];
    if (!pr || pr.owner !== p.id) return;
    this.sellProp(p, square);
    if (this.phase === 'debt' && p.money >= 0) this.finish(p);
  }

  act_endTurn() {
    if (this.phase !== 'end') return;
    this.nextTurn();
  }

  // ---------- Movimento ----------
  move(p, steps) {
    const np = p.pos + steps;
    if (np >= 40) { p.money += SALARY; this.addLog(`💰 ${p.name} passou pelo Início e recebeu ${money(SALARY)}.`); }
    p.pos = np % 40;
    this.land(p);
  }

  moveTo(p, target) {
    if (target < p.pos || (target === 0 && p.pos !== 0)) {
      p.money += SALARY;
      this.addLog(`💰 ${p.name} passou pelo Início e recebeu ${money(SALARY)}.`);
    }
    p.pos = target;
    this.land(p);
  }

  sendToJail(p) {
    p.pos = 10; p.inJail = true; p.jailTries = 0;
    this.extraTurn = false;
    this.addLog(`🚓 ${p.name} foi para a Prisão.`);
  }

  land(p) {
    const i = p.pos, sq = SQUARES[i];
    switch (sq.type) {
      case 'city': case 'airport': case 'utility':
        return this.landProperty(p, i);
      case 'tax':
        this.addLog(`🧾 ${p.name} pagou ${money(sq.amount)} de ${sq.name}.`);
        this.pay(p, null, sq.amount);
        return this.finish(p);
      case 'chance':
        return this.drawCard(p);
      case 'gotojail':
        this.sendToJail(p);
        return this.finish(p);
      case 'travel':
        if (p.money >= TRAVEL_COST) return this.ask({ type: 'travel', cost: TRAVEL_COST });
        return this.finish(p);
      case 'copa':
        if (Object.entries(this.props).some(([k, pr]) => pr.owner === p.id && SQUARES[k].type === 'city')) return this.ask({ type: 'copa' });
        return this.finish(p);
      default:
        return this.finish(p);
    }
  }

  landProperty(p, i) {
    const sq = SQUARES[i], pr = this.props[i];
    if (pr.owner === null) {
      if (p.money >= sq.price) return this.ask({ type: 'buy', square: i, cost: sq.price });
      this.addLog(`${p.name} não tem dinheiro para comprar ${sq.name}.`);
      return this.finish(p);
    }
    if (pr.owner === p.id) {
      if (sq.type === 'city') return this.offerBuild(p, i);
      return this.finish(p);
    }
    const owner = this.player(pr.owner);
    const rent = this.rent(i);
    this.addLog(`💸 ${p.name} pagou ${money(rent)} de aluguel a ${owner.name} em ${sq.name}.`);
    this.pay(p, owner, rent);
    if (sq.type === 'city' && pr.level < 5 && p.money >= 0) {
      const cost = this.buyoutCost(i);
      if (p.money >= cost) return this.ask({ type: 'buyout', square: i, cost, owner: owner.id });
    }
    this.finish(p);
  }

  offerBuild(p, i) {
    const sq = SQUARES[i], pr = this.props[i];
    const max = pr.level < 4 ? 4 : 5; // hotel só depois de 4 casas
    const options = [];
    for (let l = pr.level + 1; l <= max; l++) {
      const cost = (l - pr.level) * GROUPS[sq.group].house;
      if (cost <= p.money) options.push({ level: l, cost });
    }
    if (!options.length) return this.finish(p);
    this.ask({ type: 'build', square: i, options });
  }

  drawCard(p) {
    if (!this.deck.length) this.deck = shuffle(CARDS.map((_, i) => i));
    const card = CARDS[this.deck.pop()];
    this.lastCard = { text: card.text, id: p.id, t: Date.now() };
    this.addLog(`🃏 ${p.name}: “${card.text}”`);
    card.run(this, p);
  }

  ask(pending) { this.phase = 'action'; this.pending = pending; }

  // Fecha a etapa atual: dívida, jogar de novo (dupla) ou encerrar turno.
  finish(p) {
    if (p.bankrupt || this.status !== 'playing') return;
    this.pending = null;
    if (p.money < 0) {
      this.phase = 'debt';
      this.addLog(`⚠️ ${p.name} está devendo ${money(-p.money)} e precisa vender propriedades.`);
      return;
    }
    if (this.extraTurn && !p.inJail) {
      this.phase = 'roll';
    } else {
      this.phase = 'end';
    }
  }

  // ---------- Dinheiro ----------
  pay(from, to, amount) {
    if (amount <= 0) return;
    from.money -= amount;
    if (to) to.money += amount;
    if (from !== this.current && from.money < 0) this.autoSettle(from);
  }

  rent(i) {
    const sq = SQUARES[i], pr = this.props[i];
    if (sq.type === 'city') {
      let r = sq.rent[pr.level];
      if (pr.level === 0 && this.ownsGroup(pr.owner, sq.group)) r *= 2;
      if (this.copa === i) r *= 2;
      return r;
    }
    const n = Object.entries(this.props).filter(([k, x]) => x.owner === pr.owner && SQUARES[k].type === sq.type).length;
    if (sq.type === 'airport') return 25 * 2 ** (n - 1);
    const dice = this.lastRoll ? this.lastRoll.d1 + this.lastRoll.d2 : 7;
    return (n >= 2 ? 10 : 4) * dice;
  }

  ownsGroup(owner, group) {
    return SQUARES.every((s, k) => s.group !== group || this.props[k].owner === owner);
  }

  invested(i) {
    const sq = SQUARES[i];
    return sq.price + (sq.type === 'city' ? this.props[i].level * GROUPS[sq.group].house : 0);
  }
  buyoutCost(i) { return this.invested(i) * 2; }
  sellValue(i) { return Math.floor(this.invested(i) / 2); }

  sellProp(p, i) {
    const v = this.sellValue(i);
    p.money += v;
    if (this.copa === i) this.copa = null;
    this.props[i].owner = null;
    this.props[i].level = 0;
    this.addLog(`🔻 ${p.name} vendeu ${SQUARES[i].name} ao banco por ${money(v)}.`);
  }

  // Vende automaticamente as propriedades mais baratas até sair do vermelho.
  autoSettle(p) {
    const mine = () => Object.keys(this.props).map(Number).filter((k) => this.props[k].owner === p.id)
      .sort((a, b) => this.sellValue(a) - this.sellValue(b));
    let list = mine();
    while (p.money < 0 && list.length) { this.sellProp(p, list[0]); list = mine(); }
    if (p.money < 0) this.goBankrupt(p, 'faliu');
  }

  goBankrupt(p, reason) {
    const wasCurrent = p === this.current;
    p.bankrupt = true;
    p.money = 0;
    p.inJail = false;
    Object.entries(this.props).forEach(([k, pr]) => {
      if (pr.owner === p.id) { pr.owner = null; pr.level = 0; if (this.copa === Number(k)) this.copa = null; }
    });
    this.addLog(`💀 ${p.name} ${reason}! Suas propriedades voltaram para o banco.`);
    const alive = this.alive();
    if (alive.length <= 1) {
      this.status = 'ended';
      this.phase = null;
      this.pending = null;
      this.winner = alive[0] ? alive[0].id : null;
      this.stop();
      this.deadline = null;
      if (alive[0]) this.addLog(`🏆 ${alive[0].name} venceu a partida!`);
      return;
    }
    if (wasCurrent) this.nextTurn();
  }

  // ---------- Estado público ----------
  state() {
    return {
      code: this.code,
      status: this.status,
      hostId: this.hostId,
      players: this.players.map(({ token, socketId, ...rest }) => rest),
      props: this.props,
      copa: this.copa,
      turn: this.current ? this.current.id : null,
      phase: this.phase,
      pending: this.pending,
      lastRoll: this.lastRoll,
      lastCard: this.lastCard,
      log: this.log.slice(-60),
      chat: this.chat.slice(-60),
      deadline: this.deadline,
      now: Date.now(),
      round: this.round,
      winner: this.winner,
    };
  }
}

module.exports = { Game, CARDS };
