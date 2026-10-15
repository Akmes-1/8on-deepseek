/**
 * 《八班风云》核心引擎
 * ------------------------------------------------------------------
 * 设计原则：
 * 1. 引擎是纯逻辑层：只改 state、产事件（event），不知道 DOM 的存在。
 * 2. 一切"玩家要做决定"的地方都通过 await 让出控制权：
 *    - 人类玩家：由 UI 通过 game.resolveChoice() 回填
 *    - 电脑玩家：由 AI 模块自动回填
 * 3. 事件的节奏（动画）由 UI 的 hook 决定，引擎只管把事说清楚。
 *
 * 效果 DSL 见 docs/effects-dsl.md，卡池数据见 data/characters.json / data/common.json
 */
import { sleep, setSpeedScale } from './utils.js';

export const STATUS_META = {
  stink: { name: '臭气', icon: 'stink', bad: true, desc: '回合结束时每层让对方 -1 成绩' },
  sao: { name: '骚气', icon: 'tongue', good: true, desc: '每层让本回合第一张牌 +1 强度' },
  cringe: { name: '尴尬', icon: 'eye', bad: true, desc: '每层让自己打出的打击卡 -1 强度' },
  hype: { name: '声援', icon: 'megaphone', good: true, desc: '每层让对手受到的伤害 +1' },
  bandage: { name: '创可贴', icon: 'bandage', good: true, desc: '每层抵消 1 点成绩打击' },
  acting: { name: '演技', icon: 'star', good: true, desc: '演技层数，部分卡会读取它' },
  followers: { name: '干儿子', icon: 'crown', good: true, desc: '回合结束每层 +1 成绩' },
  shield: { name: '面子', icon: 'shield', good: true, desc: '每层抵消 1 点成绩打击，回合结束清零' },
  silence: { name: '被点名', icon: 'bell', bad: true, desc: '每层让你下一张牌失效' },
  spotlight: { name: '众目睽睽', icon: 'eye', bad: true, desc: '每层让对手回合开始 -1 成绩' },
  mark: { name: '被记名', icon: 'notebook', bad: true, desc: '每层让记录者对你打出的牌 +1 强度' },
  haste: { name: '赶作业', icon: 'bolt', good: true, desc: '每层回合开始多抽 1 张' },
  tilt: { name: '心态崩', icon: 'flame', bad: true, desc: '每层回合开始弃 1 张牌' },
  buff: { name: '状态不错', icon: 'heart', good: true, desc: '每层回合结束 +1 成绩' }
};

const CARD_TYPES = {
  attack: { name: '打击', icon: 'bolt', color: 'danger' },
  tactic: { name: '套路', icon: 'chalk', color: 'accent' },
  support: { name: '助攻', icon: 'heart', color: 'success' },
  ult: { name: '大招', icon: 'flame', color: 'warning' }
};

const OP_WHITELIST = new Set([
  'damage', 'heal', 'drain', 'setScore', 'draw', 'discard', 'gainEnergy', 'gainMomentum',
  'loseMomentum', 'applyStatus', 'removeStatus', 'clearStatus', 'transferStatus', 'addFlag',
  'consumeFlag', 'scaleByFlag', 'if', 'repeat', 'choose', 'searchDeck', 'recoverFromDiscard',
  'extraTurn', 'copyLastCard', 'revealHand', 'cancelNext'
]);

const COND_WHITELIST = new Set([
  'scoreBelow', 'scoreAbove', 'statusAtLeast', 'flagAtLeast', 'handAtLeast', 'energyAtLeast',
  'turnAtLeast', 'not', 'and', 'or'
]);

/**
 * 全局节奏倍率：1 = 正常速度。
 * 调试 / 演示时可以用 setSpeed(0.1) 把整局压缩到几秒（?speed=0.1 或勾"快进动画"）。
 * 所有 sleep 都走这里，所以界面动画、电脑思考时间会一起变快。
 */
export function setSpeed(multiplier) {
  setSpeedScale(Number(multiplier));
}
export function getSpeed() { return 1; }
// 注：真正用来等待的 sleep 在 utils.js 里，它会读取上面的 speedScale


/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** 洗牌（Fisher-Yates），可注入 rng 便于复现 */
function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 校验卡池数据：把 DSL 白名单外的操作挑出来，避免"静默失效" */
export function validateCardPool(charactersData, commonCards) {
  const problems = [];
  const checkOps = (ops, where) => {
    if (!Array.isArray(ops)) return;
    ops.forEach((opObj, idx) => {
      const at = `${where}[${idx}]`;
      if (!opObj || typeof opObj !== 'object' || !OP_WHITELIST.has(opObj.op)) {
        problems.push(`${at} 未知操作: ${opObj && opObj.op}`);
        return;
      }
      if (opObj.op === 'if') {
        if (opObj.cond && !COND_WHITELIST.has(opObj.cond.type)) {
          problems.push(`${at}.cond 未知条件: ${opObj.cond.type}`);
        }
        checkOps(opObj.then, `${at}.then`);
        checkOps(opObj.else, `${at}.else`);
      } else if (opObj.op === 'repeat') checkOps(opObj.ops, `${at}.ops`);
      else if (opObj.op === 'scaleByFlag') checkOps(opObj.then, `${at}.then`);
      else if (opObj.op === 'choose') {
        (opObj.options || []).forEach((o, i) => checkOps(o.ops, `${at}.options[${i}].ops`));
      }
      if (opObj.status && !STATUS_META[opObj.status]) problems.push(`${at} 未定义状态: ${opObj.status}`);
    });
  };
  const checkCard = (card, where) => {
    if (!card || !card.id) problems.push(`${where} 缺少 id`);
    if (!CARD_TYPES[card.type]) problems.push(`${where} 未知类型: ${card.type}`);
    checkOps(card.ops, where);
  };
  (commonCards || []).forEach((c, i) => checkCard(c, `common[${i}]`));
  (charactersData.characters || []).forEach((ch) => {
    (ch.decks || []).forEach((c, i) => checkCard(c, `${ch.id}[${i}]`));
    if (ch.passive) checkOps(ch.passive.ops, `${ch.id}.passive`);
  });
  return problems;
}

/* ------------------------------------------------------------------ */
/* 对局                                                                */
/* ------------------------------------------------------------------ */

export class BabanGame {
  /**
   * @param {object} opts
   * @param {object} opts.data       characters.json 解析结果
   * @param {Array}  opts.commonCards  公共牌数组
   * @param {object} opts.controllers  { p0: 'human'|'ai', p1: 'human'|'ai' }
   * @param {Function} opts.aiChooser  (game, playerIdx) => Promise<{type,...}> 由 AI 模块提供
   * @param {Function} opts.hook      (event, state) => Promise<void> 由 UI 提供（控制动画节奏）
   * @param {Function} opts.rng
   */
  constructor(opts) {
    this.data = opts.data;
    this.commonCards = opts.commonCards || [];
    this.controllers = opts.controllers || { p0: 'human', p1: 'ai' };
    this.aiChooser = opts.aiChooser || null;
    this.hook = opts.hook || (async () => {});
    this.rng = opts.rng || Math.random;

    this.turn = 0;
    this.current = 0;
    this.winner = null;
    this.over = false;
    this.log = [];
    this.extraTurns = [0, 0];
    this.cardsPlayedThisTurn = 0;
    this.firstCardPlayed = false;
    this._pendingChoice = null;
    this._stopRequested = false;
    this.pendingChoice = null;

    this.players = [
      this._buildPlayer(0, this.data.characters[opts.picks ? opts.picks[0] : 0]),
      this._buildPlayer(1, this.data.characters[opts.picks ? opts.picks[1] : 1])
    ];

    this.players.forEach((p) => this._dealOpeningHand(p));

    // 教程 / 剧情 / 无尽模式用的开局覆盖（不传就完全是原来的随机开局）
    this.openingHand = opts.openingHand || null;
    this.onActionWindow = opts.onActionWindow || null;
    if (opts.setup) this.applySetup(opts.setup);
  }

  /* ---------------- 开局覆盖（教学模式用） ---------------- */

  /**
   * 覆盖开局状态。所有字段都是可选的，不传就保持默认（向后兼容）。
   * @param {object} setup
   *   setup[0] / setup[1]       每个玩家的覆盖：{ score, energy, momentum, hand, deckOrder, deckCards }
   *   setup.aiHandicap          电脑弱化：{ maxCardsPerTurn, thinkMs }
   *   setup.firstPlayer         谁先手（默认 0）
   */
  applySetup(setup) {
    [0, 1].forEach((idx) => {
      const cfg = setup[idx];
      if (!cfg) return;
      const p = this.players[idx];
      if (typeof cfg.score === 'number') p.score = clamp(cfg.score, this.data.scoreFloor ?? 0, this.maxScore);
      if (typeof cfg.momentum === 'number') p.momentum = clamp(cfg.momentum, 0, this.maxMomentum);
      if (typeof cfg.energy === 'number') p.energy = p.energyMax = cfg.energy;
      if (Array.isArray(cfg.deckCards)) {
        p.deck = this._cardIdsToDeck(cfg.deckCards, idx);
      }
      if (Array.isArray(cfg.hand)) {
        // 指定手牌：这些卡从牌堆里拿（如果牌堆里有），没有就直接造一张，方便教学
        p.hand = [];
        cfg.hand.forEach((id) => {
          const inDeck = p.deck.findIndex((c) => c.id === id);
          if (inDeck >= 0) p.hand.push(p.deck.splice(inDeck, 1)[0]);
          else {
            const c = this._findCard(id);
            if (c) p.hand.push({ ...c, owner: idx, uid: id });
          }
        });
      }
      if (Array.isArray(cfg.deckOrder)) {
        // 把指定顺序的卡放到牌堆顶（pop 从尾部取，所以倒着塞）
        const ordered = [];
        cfg.deckOrder.forEach((id) => {
          const at = p.deck.findIndex((c) => c.id === id);
          if (at >= 0) ordered.push(p.deck.splice(at, 1)[0]);
        });
        p.deck.push(...ordered.reverse());
      }
      // 预置状态（教程教"状态结算"时用）
      if (cfg.status && typeof cfg.status === 'object') {
        p.status = {};
        Object.entries(cfg.status).forEach(([key, val]) => {
          if (!STATUS_META[key] || !val) return;
          const stacks = typeof val === 'object' ? (val.stacks || val.value || 0) : val;
          const duration = typeof val === 'object' && typeof val.duration === 'number' ? val.duration : -1;
          const capped = Math.min(this.statusCap(key), stacks);
          if (capped > 0) p.status[key] = { stacks: capped, duration };
        });
      }
      // 教学局可以关掉被动（免得悄悄改数值）
      if (cfg.passive === false) p.passiveOff = true;
    });
    if (setup.aiHandicap) this.aiHandicap = setup.aiHandicap;
    if (typeof setup.firstPlayer === 'number') this.current = setup.firstPlayer;
    if (setup.revealHand) this.revealed = { player: setup.revealHand, until: 0 };
    if (typeof setup.foeExtraDraw === 'number') this.foeExtraDraw = setup.foeExtraDraw;
  }

  /** 用一份卡 id 清单建牌堆（同一个 id 写两次就是两张） */
  _cardIdsToDeck(ids, owner) {
    const deck = [];
    (ids || []).forEach((id, i) => {
      const base = this._findCard(id);
      if (!base) return;
      deck.push({ ...base, owner, uid: i === 0 || deck.every((c) => c.id !== id) ? id : `${id}#${i}` });
    });
    return deck;
  }

  /** 在所有角色的专属牌 + 公共牌里找一张卡的定义 */
  _findCard(id) {
    if (this._cardIndex && this._cardIndex[id]) return this._cardIndex[id];
    this._cardIndex = {};
    (this.data.characters || []).forEach((ch) => {
      (ch.decks || []).forEach((c) => { this._cardIndex[c.id] = c; });
    });
    (this.commonCards || []).forEach((c) => { this._cardIndex[c.id] = c; });
    return this._cardIndex[id] || null;
  }

  /* ---------------- 构建 ---------------- */

  _buildPlayer(idx, character) {
    const deckCards = [...(character.decks || []), ...this.commonCards];
    const deck = [];
    deckCards.forEach((card) => {
      const n = Math.max(1, card.count || 1);
      for (let i = 0; i < n; i += 1) {
        deck.push({ ...card, owner: idx, uid: i === 0 ? card.id : `${card.id}#${i}` });
      }
    });
    shuffle(deck, this.rng);
    return {
      idx,
      name: character.name,
      nickname: character.nickname,
      character,
      score: character.hpScoreStart ?? this.data.startScore ?? 10,
      energy: character.energyMax ?? this.data.maxEnergy ?? 3,
      energyMax: character.energyMax ?? this.data.maxEnergy ?? 3,
      momentum: character.momentumStart ?? 1,
      hand: [],
      deck,
      discard: [],
      status: {},
      flags: {},
      playedUlt: false,
      extraTurnUsed: false,
      damagedThisGame: 0
    };
  }

  _dealOpeningHand(player) {
    let n = this.data.startHand ?? 4;
    // 后手补偿：后手方多发若干张（数据里可调，见 data/characters.json: secondPlayerBonusCard）
    if (player.idx === 1) n += this.data.secondPlayerBonusCard || 0;
    for (let i = 0; i < n; i += 1) this._drawSilent(player);
  }

  get maxScore() { return this.data.maxScore ?? 20; }
  get handLimit() { return this.data.handLimit ?? 8; }
  get maxMomentum() { return this.data.maxMomentum ?? 5; }
  get drawPerTurn() { return this.data.drawPerTurn ?? 2; }

  get humanIndex() { return this.controllers.p0 === 'human' ? 0 : 1; }
  get opponentOf() { return (idx) => 1 - idx; }

  /* ---------------- 事件 ---------------- */

  emit(type, payload = {}, opts = {}) {
    const event = { type, ...payload, at: Date.now(), seq: this.log.length };
    this.log.push(event);
    if (this.hook) {
      const result = this.hook(event, this);
      if (result && typeof result.then === 'function') return result;
    }
    return Promise.resolve();
  }

  async beep(type, payload = {}, opts = {}) {
    await this.emit(type, payload, opts);
    if (opts.delay) await sleep(opts.delay);
  }

  /* ---------------- 抽牌 / 弃牌 ---------------- */

  _reshuffle(player) {
    if (player.discard.length === 0) return false;
    player.deck = shuffle(player.discard.splice(0), this.rng);
    return true;
  }

  _drawSilent(player) {
    if (player.deck.length === 0 && !this._reshuffle(player)) return null;
    const card = player.deck.pop();
    player.hand.push(card);
    return card;
  }

  async drawCard(player, reason = 'draw') {
    if (player.deck.length === 0 && !this._reshuffle(player)) {
      await this.beep('deckEmpty', { player: player.idx });
      return null;
    }
    const card = player.deck.pop();
    player.hand.push(card);
    let overflow = null;
    // 手牌上限：超出时丢掉最旧的那张（不会丢掉刚抽到的）
    if (player.hand.length > this.handLimit) {
      overflow = player.hand.shift();
      player.discard.push(overflow);
    }
    await this.beep('draw', { player: player.idx, cardId: card.id, reason, overflow: overflow ? overflow.id : null });
    await this.fireTriggers('onDraw', { self: player, ctx: { card, reason } });
    return card;
  }

  async discardRandom(player, count = 1, reason = 'effect') {
    const removed = [];
    for (let i = 0; i < count && player.hand.length > 0; i += 1) {
      const k = Math.floor(this.rng() * player.hand.length);
      const [card] = player.hand.splice(k, 1);
      player.discard.push(card);
      removed.push(card);
    }
    if (removed.length) {
      await this.beep('discard', { player: player.idx, cards: removed.map((c) => c.id), reason });
    }
    return removed;
  }

  /* ---------------- 状态 ---------------- */

  statusStacks(player, status) {
    const entry = player.status[status];
    if (!entry) return 0;
    return entry.stacks || 0;
  }

  /** 状态层数上限（防止持续伤害滚雪球），数据里可用 statusCaps 覆盖 */
  statusCap(status) {
    const caps = this.data.statusCaps || {};
    return typeof caps[status] === 'number' ? caps[status] : Infinity;
  }

  async applyStatus(player, status, value, duration = -1, source = null) {
    if (!STATUS_META[status] || !value) return;
    const entry = player.status[status] || { stacks: 0, duration: -1 };
    const cap = this.statusCap(status);
    entry.stacks = Math.min(cap, Math.max(0, entry.stacks + value));
    if (duration >= 0) entry.duration = duration;
    if (entry.stacks <= 0) {
      delete player.status[status];
      await this.beep('statusRemove', { player: player.idx, status, source });
      return;
    }
    player.status[status] = entry;
    await this.beep('status', { player: player.idx, status, stacks: entry.stacks, delta: value, source });
  }

  /* ---------------- 成绩增减（核心结算） ---------------- */

  /**
   * 对 player 造成 dmg 点成绩打击。
   * 结算顺序：mark/hype 加伤 → cringe 减伤 → 对手 shield → 自己 bandage → 落地。
   * @returns {Promise<number>} 实际掉分
   */
  async dealDamage(target, dmg, meta = {}) {
    const source = this.players[meta.from ?? 1 - target.idx];
    let amount = dmg;
    const details = {};

    // 加伤：来源方的【声援】+ 来源方对目标打牌时的记名
    const hype = this.statusStacks(source, 'hype');
    if (hype > 0) { amount += hype; details.hype = hype; }
    if (meta.subject === 'card') {
      const markOnTarget = this.statusStacks(target, 'mark');
      if (markOnTarget > 0) { amount += markOnTarget; details.mark = markOnTarget; }
    }
    // 减伤：来源方自己被"尴尬"削弱
    const cringe = this.statusStacks(source, 'cringe');
    if (cringe > 0 && (meta.subject === 'card' || dmg > 0)) {
      const cut = Math.min(cringe, amount);
      amount -= cut;
      details.cringe = cut;
    }
    amount = Math.max(0, Math.round(amount));

    // 目标方的抵消
    let blocked = 0;
    const shield = this.statusStacks(target, 'shield');
    if (shield > 0 && amount > 0) {
      const use = Math.min(shield, amount);
      blocked += use;
      amount -= use;
      await this.applyStatus(target, 'shield', -use, -1, 'block');
      details.shield = use;
    }
    const bandage = this.statusStacks(target, 'bandage');
    if (bandage > 0 && amount > 0) {
      const use = Math.min(bandage, amount);
      blocked += use;
      amount -= use;
      await this.applyStatus(target, 'bandage', -use, -1, 'block');
      details.bandage = use;
    }

    if (blocked > 0) {
      await this.beep('block', { player: target.idx, blocked, details });
    }
    if (amount <= 0) {
      await this.beep('damageZero', { player: target.idx, from: source.idx, details });
      return 0;
    }

    const before = target.score;
    target.score = clamp(target.score - amount, this.data.scoreFloor ?? 0, this.maxScore);
    const real = before - target.score;
    if (meta.from !== undefined) source.flags.dealtDamage = (source.flags.dealtDamage || 0) + real;
    target.flags.tookDamage = (target.flags.tookDamage || 0) + real;
    await this.beep('damage', {
      player: target.idx, from: source.idx, amount: real, raw: dmg, details, subject: meta.subject || 'effect'
    });
    await this.checkEnd();
    if (!this.over) {
      await this.fireTriggers('onDamage', { self: target, ctx: { amount: real, from: source.idx } });
      await this.fireTriggers('onDealDamage', { self: source, ctx: { amount: real, target: target.idx } });
    }
    return real;
  }

  async heal(player, amount, meta = {}) {
    const before = player.score;
    player.score = clamp(player.score + amount, this.data.scoreFloor ?? 0, this.maxScore);
    const real = player.score - before;
    if (real > 0) {
      await this.beep('heal', { player: player.idx, amount: real, meta });
      await this.checkEnd();
    }
    return real;
  }

  async setScore(player, value) {
    const before = player.score;
    player.score = clamp(value, this.data.scoreFloor ?? 0, this.maxScore);
    await this.beep('setScore', { player: player.idx, from: before, to: player.score });
    await this.checkEnd();
  }

  /* ---------------- 胜负 ---------------- */

  async checkEnd() {
    if (this.over) return true;
    const [a, b] = this.players;
    const max = this.maxScore;
    const floor = this.data.scoreFloor ?? 0;
    if (a.score >= max) return this._finish(0, 'score up');
    if (b.score >= max) return this._finish(1, 'score up');
    if (a.score <= floor) return this._finish(1, 'score down');
    if (b.score <= floor) return this._finish(0, 'score down');
    return false;
  }

  async _finish(winner, reason) {
    this.over = true;
    this.winner = winner;
    await this.emit('gameOver', { winner, reason });
    return true;
  }

  /* ---------------- 出牌 ---------------- */

  canPlay(player, card) {
    if (this.over) return { ok: false, why: '对局已结束' };
    if (player.idx !== this.current) return { ok: false, why: '还没轮到你' };
    const cost = card.cost || 0;
    if (cost > player.energy) return { ok: false, why: '精力不够' };
    const need = card.momentum || 0;
    if (need > player.momentum) return { ok: false, why: `气势不足（需 ${need}）` };
    if (card.type === 'ult' && player.flags.ultUsedThisGame) {
      return { ok: false, why: '本局大招已经用过了' };
    }
    if (this.statusStacks(player, 'silence') > 0) return { ok: true, why: '', silenced: true };
    return { ok: true, why: '' };
  }

  async playCard(player, uid, chosenOption = null) {
    const idxInHand = player.hand.findIndex((c) => c.uid === uid) >= 0
      ? player.hand.findIndex((c) => c.uid === uid)
      : player.hand.findIndex((c) => c.id === uid);
    if (idxInHand < 0) return false;
    const card = player.hand[idxInHand];
    const check = this.canPlay(player, card);
    if (!check.ok) {
      await this.beep('playRejected', { player: player.idx, cardId: card.id, why: check.why });
      return false;
    }

    player.hand.splice(idxInHand, 1);
    player.discard.push(card);
    player.energy = Math.max(0, player.energy - (card.cost || 0));
    if (card.momentum) player.momentum = Math.max(0, player.momentum - card.momentum);
    if (card.type === 'ult') player.playedUlt = true;
    this.cardsPlayedThisTurn += 1;

    await this.beep('play', {
      player: player.idx, cardId: card.id, cost: card.cost || 0, momentum: card.momentum || 0,
      cardType: card.type, name: card.name
    });

    // 被点名：这张牌直接失效
    if (this.statusStacks(player, 'silence') > 0) {
      await this.applyStatus(player, 'silence', -1, -1, 'silence-consume');
      await this.beep('cardNullified', { player: player.idx, cardId: card.id });
      return true;
    }

    let ops = card.ops || [];
    // 【骚气】：本回合第一张牌强度 +1（对数值型 op 生效）
    if (!this.firstCardPlayed) {
      this.firstCardPlayed = true;
      const sao = this.statusStacks(player, 'sao');
      if (sao > 0 && card.type !== 'ult') {
        ops = boostOps(ops, sao);
        await this.beep('boost', { player: player.idx, amount: sao, source: 'sao' });
        await this.applyStatus(player, 'sao', -sao, -1, 'consume');
      }
    }

    this._currentCard = card;
    await this.runOps(ops, player, { card, chosenOption });
    this._currentCard = null;

    if (card.type === 'ult') player.flags.ultUsedThisGame = true;
    await this.fireTriggers('onPlayCard', { self: player, ctx: { card } });
    await this.fireTriggers('onOppPlayCard', { self: this.players[1 - player.idx], ctx: { card } });
    await this.checkEnd();
    return true;
  }

  /** 触发被动/装备类效果；depth 防止被动互相触发造成死循环 */
  async fireTriggers(trigger, { self, ctx = {} } = {}) {
    if (this.over) return;
    this._triggerDepth = (this._triggerDepth || 0) + 1;
    if (this._triggerDepth > 6) { this._triggerDepth -= 1; return; }
    try {
      const list = self ? [self] : this.players;
      for (const player of list) {
        const passive = player.character.passive;
        if (!passive || !passive.ops || !passive.ops.length) continue;
        if (!passive.trigger || passive.trigger === 'turnStart') continue; // 回合开始的被动在主流程里处理
        if (passive.trigger !== trigger) continue;
        if (trigger === 'oncePerGame' && player.flags[`passive_${player.character.id}`]) continue;
        player.flags[`passive_${player.character.id}`] = true;
        await this.beep('passiveTrigger', { player: player.idx, name: passive.name, trigger });
        await this.runOps(passive.ops, player, { ...ctx, source: 'passive' });
        if (this.over) break;
      }
    } finally {
      this._triggerDepth -= 1;
    }
  }

  /* ---------------- 效果执行 ---------------- */

  resolveCondition(cond, ctx) {
    if (!cond) return true;
    const self = ctx.self;
    const opp = this.players[1 - self.idx];
    const pick = (who) => (who === 'opp' ? opp : self);
    switch (cond.type) {
      case 'scoreBelow': return pick(cond.who).score < cond.value;
      case 'scoreAbove': return pick(cond.who).score > cond.value;
      case 'statusAtLeast': return this.statusStacks(pick(cond.who), cond.status) >= cond.value;
      case 'flagAtLeast': return (pick(cond.who).flags[cond.flag] || 0) >= cond.value;
      case 'handAtLeast': return pick(cond.who).hand.length >= cond.value;
      case 'energyAtLeast': return self.energy >= cond.value;
      case 'turnAtLeast': return this.turn >= cond.value;
      case 'not': return !this.resolveCondition(cond.cond, ctx);
      case 'and': return (cond.conds || []).every((c) => this.resolveCondition(c, ctx));
      case 'or': return (cond.conds || []).some((c) => this.resolveCondition(c, ctx));
      default: return false;
    }
  }

  async runOps(ops, actor, ctx = {}) {
    if (!Array.isArray(ops)) return;
    for (const opObj of ops) {
      if (this.over) return;
      if (!opObj || !OP_WHITELIST.has(opObj.op)) continue;
      await this.runOp(opObj, actor, ctx);
    }
  }

  async runOp(opObj, actor, ctx) {
    const opp = this.players[1 - actor.idx];
    const target = opObj.target === 'self' ? actor
      : opObj.target === 'opp' ? opp : (opObj.target ? this.players[opObj.target] : opp);

    switch (opObj.op) {
      case 'damage':
        await this.dealDamage(target, opObj.value || 0, { from: actor.idx, subject: 'card', card: ctx.card });
        break;
      case 'heal':
        await this.heal(target, opObj.value || 0, { card: ctx.card });
        break;
      case 'drain': {
        const dealt = await this.dealDamage(target, opObj.value || 0, { from: actor.idx, subject: 'card', card: ctx.card });
        if (dealt > 0) await this.heal(actor, opObj.healValue || dealt, { card: ctx.card });
        break;
      }
      case 'setScore':
        await this.setScore(target, opObj.value ?? target.score);
        break;
      case 'draw': {
        for (let i = 0; i < (opObj.value || 0); i += 1) await this.drawCard(target, 'effect');
        break;
      }
      case 'discard':
        await this.discardRandom(target, opObj.value || 1, 'effect');
        break;
      case 'gainEnergy':
        actor.energy = clamp(actor.energy + (opObj.value || 1), 0, actor.energyMax + 2);
        await this.beep('energy', { player: actor.idx, delta: opObj.value || 1, energy: actor.energy });
        break;
      case 'gainMomentum':
        actor.momentum = clamp(actor.momentum + (opObj.value || 1), 0, this.maxMomentum);
        await this.beep('momentum', { player: actor.idx, momentum: actor.momentum });
        break;
      case 'loseMomentum':
        target.momentum = clamp(target.momentum - (opObj.value || 1), 0, this.maxMomentum);
        await this.beep('momentum', { player: target.idx, momentum: target.momentum });
        break;
      case 'applyStatus':
        await this.applyStatus(target, opObj.status, opObj.value || 1, opObj.duration ?? -1, ctx.card && ctx.card.id);
        break;
      case 'removeStatus':
        await this.applyStatus(target, opObj.status, -(opObj.value || 1), -1, ctx.card && ctx.card.id);
        break;
      case 'clearStatus':
        if (target.status[opObj.status]) {
          delete target.status[opObj.status];
          await this.beep('statusRemove', { player: target.idx, status: opObj.status });
        }
        break;
      case 'transferStatus': {
        const from = opObj.from === 'opp' ? opp : actor;
        const to = from.idx === actor.idx ? opp : actor;
        const have = this.statusStacks(from, opObj.status);
        const move = Math.min(have, opObj.value || have || 1);
        if (move > 0) {
          await this.applyStatus(from, opObj.status, -move, -1, 'transfer');
          await this.applyStatus(to, opObj.status, move, opObj.duration ?? -1, 'transfer');
          await this.beep('transfer', { status: opObj.status, value: move, from: from.idx, to: to.idx });
        }
        break;
      }
      case 'addFlag':
        actor.flags[opObj.flag] = (actor.flags[opObj.flag] || 0) + (opObj.value || 1);
        await this.beep('flag', { player: actor.idx, flag: opObj.flag, value: actor.flags[opObj.flag] });
        break;
      case 'consumeFlag': {
        const have = actor.flags[opObj.flag] || 0;
        const use = Math.min(have, opObj.value || have || 1);
        actor.flags[opObj.flag] = have - use;
        await this.beep('flag', { player: actor.idx, flag: opObj.flag, value: actor.flags[opObj.flag], consumed: use });
        break;
      }
      case 'scaleByFlag': {
        const stacks = actor.flags[opObj.flag] || 0;
        const scaled = (opObj.then || []).map((o) => ({ ...o, value: (o.value || 1) * stacks }));
        await this.runOps(scaled, actor, ctx);
        break;
      }
      case 'if': {
        const pass = this.resolveCondition(opObj.cond, { self: actor, opp, ctx });
        await this.beep('condition', { player: actor.idx, pass, cond: opObj.cond });
        await this.runOps(pass ? opObj.then : opObj.else, actor, ctx);
        break;
      }
      case 'repeat':
        for (let i = 0; i < (opObj.times || 1); i += 1) {
          if (this.over) break;
          await this.runOps(opObj.ops, actor, ctx);
        }
        break;
      case 'choose': {
        const options = (opObj.options || []).filter(Boolean);
        if (options.length === 0) break;
        let picked = null;
        if (ctx.chosenOption) {
          picked = options.find((o) => o.label === ctx.chosenOption) || null;
          ctx.chosenOption = null;
        }
        if (!picked) picked = await this.askChoice(actor, { prompt: opObj.prompt || '选择一项', options });
        if (picked) {
          await this.beep('choiceMade', { player: actor.idx, label: picked.label });
          await this.runOps(picked.ops, actor, ctx);
        }
        break;
      }
      case 'searchDeck': {
        const pool = target.deck.filter((c) => (opObj.filter === '专属'
          ? (target.character.decks || []).some((d) => d.id === c.id)
          : true));
        if (pool.length === 0) {
          await this.beep('searchEmpty', { player: target.idx, from: actor.idx });
          break;
        }
        const pick = pool[Math.floor(this.rng() * pool.length)];
        const at = target.deck.findIndex((c) => c.uid === pick.uid);
        target.deck.splice(at, 1);
        target.hand.push(pick);
        await this.beep('searchDeck', { player: actor.idx, from: actor.idx, target: target.idx, cardId: pick.id });
        break;
      }
      case 'recoverFromDiscard': {
        const pool = target.discard.filter((c) => c.id !== (ctx.card && ctx.card.id));
        if (pool.length === 0) break;
        const pick = pool[pool.length - 1];
        target.discard.splice(target.discard.findIndex((c) => c.uid === pick.uid), 1);
        target.hand.push(pick);
        await this.beep('recover', { player: target.idx, cardId: pick.id });
        break;
      }
      case 'extraTurn':
        if (!actor.extraTurnUsed) {
          this.extraTurns[actor.idx] += opObj.value || 1;
          actor.extraTurnUsed = true;
          await this.beep('extraTurn', { player: actor.idx });
        } else {
          await this.beep('extraTurnUsed', { player: actor.idx });
        }
        break;
      case 'copyLastCard': {
        const last = actor.discard.filter((c) => c.id !== (ctx.card && ctx.card.id)).pop();
        if (last) {
          await this.beep('copyCard', { player: actor.idx, cardId: last.id });
          await this.runOps(last.ops, actor, { card: last });
        }
        break;
      }
      case 'revealHand':
        this.revealed = { player: target.idx, until: this.turn };
        await this.beep('revealHand', { player: target.idx, cards: target.hand.map((c) => c.id) });
        break;
      case 'cancelNext':
        await this.applyStatus(target, 'silence', opObj.value || 1, -1, 'cancelNext');
        break;
      default:
        break;
    }
  }

  /** 需要玩家做选择时挂起，等 UI / AI 回填 */
  askChoice(actor, request) {
    const controller = this.controllers[actor.idx === 0 ? 'p0' : 'p1'];
    if (controller === 'ai' && this.aiChooser) {
      this.pendingChoice = { player: actor.idx, ...request };
      return Promise.resolve(this.aiChooser.chooseOption(this, actor.idx, request));
    }
    return new Promise((resolve) => {
      this._pendingChoice = { player: actor.idx, ...request, resolve };
      this.pendingChoice = this._pendingChoice;
      this.emit('needChoice', { player: actor.idx, prompt: request.prompt, options: request.options });
    });
  }

  resolveChoice(labelOrIndex) {
    const pending = this._pendingChoice;
    if (!pending) return false;
    const option = typeof labelOrIndex === 'number'
      ? pending.options[labelOrIndex]
      : pending.options.find((o) => o.label === labelOrIndex);
    if (!option) return false;
    this._pendingChoice = null;
    this.pendingChoice = null;
    this.emit('choiceResolved', { player: pending.player, label: option.label });
    pending.resolve(option);
    return true;
  }

  /* ---------------- 回合流程 ---------------- */

  async start() {
    await this.beep('gameStart', {
      picks: this.players.map((p) => p.character.id),
      controllers: this.controllers
    });
    let guard = 0;
    while (!this.over && guard < 400) {
      guard += 1;
      await this.takeTurn(this.current);
      if (this.over) break;
      if (this.extraTurns[this.current] > 0) {
        this.extraTurns[this.current] -= 1;
        await this.beep('extraTurnBegin', { player: this.current });
        continue;
      }
      this.current = 1 - this.current;
    }
    return this.winner;
  }

  async takeTurn(idx) {
    const player = this.players[idx];
    this.turn += 1;
    this.cardsPlayedThisTurn = 0;
    this.firstCardPlayed = false;
    this.revealed = null;

    await this.beep('turnStart', { player: idx, turn: this.turn });

    // 1) 残留状态：众目睽睽掉分
    const spotlight = this.statusStacks(player, 'spotlight');
    if (spotlight > 0) {
      await this.beep('statusTick', { player: idx, status: 'spotlight', stacks: spotlight });
      await this.dealDamage(player, spotlight, { from: 1 - idx, subject: 'status' });
      if (this.over) return;
    }

    // 2) 心态崩：弃牌
    const tilt = this.statusStacks(player, 'tilt');
    if (tilt > 0) {
      await this.beep('statusTick', { player: idx, status: 'tilt', stacks: tilt });
      await this.discardRandom(player, tilt, 'tilt');
    }

    // 3) 抽牌（先手首回合少抽一张，作为"先手补偿"的负项；可在数据里改）
    let drawCount = this.drawPerTurn + this.statusStacks(player, 'haste');
    // 无尽模式后期：对手额外抽牌（难度曲线用，默认 0）
    if (player.idx === 1 && this.foeExtraDraw) drawCount += this.foeExtraDraw;
    if (this.turn === 1 && this.data.firstTurnDrawPenalty !== 0) {
      drawCount = Math.max(1, drawCount - (this.data.firstTurnDrawPenalty ?? 1));
    }
    for (let i = 0; i < drawCount; i += 1) {
      await this.drawCard(player, 'turnStart');
      await sleep(0);
    }

    // 4) 精力重置
    player.energy = player.energyMax;
    await this.beep('energyReset', { player: idx, energy: player.energy });

    // 5) 气势 +1（先手方额外补偿可选，见 data/characters.json: firstMomentumBonus）
    player.momentum = clamp(player.momentum + 1, 0, this.maxMomentum);
    if (this.turn === 1 && this.data.firstMomentumBonus) {
      player.momentum = clamp(player.momentum + 1, 0, this.maxMomentum);
    }
    await this.beep('momentumGain', { player: idx, momentum: player.momentum });

    // 6) 被动（回合开始类）
    await this.fireTriggers('turnStart', { self: player });
    if (this.over) return;

    // 7) 自由出牌：交出控制权
    await this.beep('actionWindow', { player: idx });
    await this.takeActions(player);
    if (this.over) return;

    // 8) 铃响收尾
    await this.endTurnEffects(player);
  }

  async takeActions(player) {
    const controller = this.controllers[player.idx === 0 ? 'p0' : 'p1'];
    if (controller === 'ai' && this.aiChooser) {
      await this.aiChooser.takeTurn(this, player.idx);
    } else {
      this.waiting = player.idx;
      // 交给外部（教程 / 自动演示）决定要不要自动结束回合
      if (this.onActionWindow) {
        try { this.onActionWindow(this, player.idx); } catch (err) { console.warn(err); }
      }
      await new Promise((resolve) => { this._actionResolve = resolve; });
      this.waiting = null;
    }
  }

  /** UI 调用：人类玩家结束回合 */
  endTurn() {
    if (this._actionResolve) {
      const resolve = this._actionResolve;
      this._actionResolve = null;
      resolve();
      return true;
    }
    return false;
  }

  async endTurnEffects(player) {
    // 被动（回合结束类）
    await this.fireTriggers('turnEnd', { self: player });
    if (this.over) return;

    const stink = this.statusStacks(player, 'stink');
    if (stink > 0) {
      await this.beep('statusTick', { player: player.idx, status: 'stink', stacks: stink });
      await this.dealDamage(player, stink, { from: 1 - player.idx, subject: 'status' });
      if (this.over) return;
    }
    const followers = this.statusStacks(player, 'followers');
    if (followers > 0) {
      await this.beep('statusTick', { player: player.idx, status: 'followers', stacks: followers });
      await this.heal(player, followers, { source: 'followers' });
      if (this.over) return;
    }
    const buff = this.statusStacks(player, 'buff');
    if (buff > 0) {
      await this.beep('statusTick', { player: player.idx, status: 'buff', stacks: buff });
      await this.heal(player, buff, { source: 'buff' });
      if (this.over) return;
    }
    // 面子回合结束清零
    if (player.status.shield) {
      delete player.status.shield;
      await this.beep('statusRemove', { player: player.idx, status: 'shield' });
    }

    // 回合结束：给所有"有时限"的状态减 1 回合，归零就移除
    // （duration = -1 表示永久，像【演技】【干儿子】这种会一直留着）
    const expired = [];
    Object.entries(player.status).forEach(([key, entry]) => {
      if (!entry || entry.duration === -1 || typeof entry.duration !== 'number') return;
      entry.duration -= 1;
      if (entry.duration <= 0) expired.push(key);
    });
    for (const key of expired) {
      delete player.status[key];
      await this.beep('statusExpired', { player: player.idx, status: key });
    }

    await this.beep('turnEnd', { player: player.idx, turn: this.turn });
    await this.checkEnd();
  }
}

/** 【骚气】强化：递归给数值型 op 加 strength */
export function boostOps(ops, strength) {
  return (ops || []).map((opObj) => {
    if (!opObj || typeof opObj !== 'object') return opObj;
    const next = { ...opObj };
    if (['damage', 'heal', 'drain', 'draw', 'applyStatus'].includes(next.op) && typeof next.value === 'number') {
      next.value += strength;
    }
    if (next.op === 'if') {
      next.then = boostOps(next.then, strength);
      next.else = boostOps(next.else, strength);
    } else if (next.op === 'repeat') next.ops = boostOps(next.ops, strength);
    else if (next.op === 'scaleByFlag') next.then = boostOps(next.then, strength);
    else if (next.op === 'choose') next.options = (next.options || []).map((o) => ({ ...o, ops: boostOps(o.ops, strength) }));
    return next;
  });
}

export { CARD_TYPES, shuffle, clamp };
