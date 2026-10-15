import { sleep } from './utils.js';
/**
 * 《八班风云》电脑对手（教导主任式 AI：不聪明但很难缠）
 * ------------------------------------------------------------------
 * 思路：把每张牌用启发式打分（对对手掉分 / 自己涨分 / 铺状态 / 抽牌 = 正分），
 * 只要分数超过阈值就出牌，出到没精力或没牌为止。
 * 简单、透明、可调，且不会"看穿"玩家手牌。
 */


const VALUE = {
  damage: 3.0,
  drain: 3.4,
  heal: 2.6,
  setScore: 2.0,
  draw: 1.2,
  discard: 1.0,
  gainEnergy: 1.5,
  gainMomentum: 1.1,
  loseMomentum: 1.2,
  applyStatus: 1.3,
  removeStatus: 0.9,
  clearStatus: 1.1,
  transferStatus: 1.6,
  addFlag: 1.0,
  consumeFlag: 0.6,
  scaleByFlag: 1.0,
  repeat: 1.0,
  choose: 1.0,
  searchDeck: 1.3,
  recoverFromDiscard: 0.9,
  extraTurn: 6.0,
  copyLastCard: 2.0,
  revealHand: 0.6,
  cancelNext: 1.4
};

/** 好状态 / 坏状态（从我方视角看） */
const GOOD_STATUS = new Set(['sao', 'hype', 'bandage', 'acting', 'followers', 'shield', 'haste', 'buff']);
const BAD_STATUS = new Set(['stink', 'cringe', 'silence', 'spotlight', 'mark', 'tilt']);

function scoreOps(game, actor, ops, depth = 0) {
  if (!Array.isArray(ops) || depth > 4) return 0;
  let total = 0;
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    const base = VALUE[op.op] ?? 0.8;
    const value = typeof op.value === 'number' ? op.value : 1;
    switch (op.op) {
      case 'damage':
        total += base * value;
        break;
      case 'heal':
        total += base * value * (actor.score <= 12 ? 1.4 : 0.7);
        break;
      case 'drain':
        total += base * value;
        break;
      case 'setScore':
        total += (op.target === 'self' ? (op.value - actor.score) : (12 - op.value)) * 1.6;
        break;
      case 'applyStatus': {
        const toSelf = op.target === 'self';
        const good = GOOD_STATUS.has(op.status);
        const bad = BAD_STATUS.has(op.status);
        const beneficial = toSelf ? good : bad;
        total += base * value * (beneficial ? 1.35 : -0.5);
        break;
      }
      case 'removeStatus':
      case 'clearStatus': {
        const onSelf = !op.target || op.target === 'self';
        const isGood = GOOD_STATUS.has(op.status);
        total += base * (onSelf ? (isGood ? -1.2 : 1.4) : (isGood ? 1.3 : -0.8));
        break;
      }
      case 'transferStatus':
        total += base * value;
        break;
      case 'addFlag':
        total += base * value * (actor.flags[op.flag] ? 1.5 : 1.1);
        break;
      case 'scaleByFlag': {
        const stacks = actor.flags[op.flag] || 0;
        total += stacks > 0 ? scoreOps(game, actor, op.then, depth + 1) * Math.min(stacks, 3) * 0.8 : -0.4;
        break;
      }
      case 'if': {
        const pass = game.resolveCondition(op.cond, { self: actor, opp: game.players[1 - actor.idx] });
        const branch = pass ? op.then : op.else;
        total += scoreOps(game, actor, branch, depth + 1);
        // 条件不成立时给一点点"赌一把"的折扣
        if (!pass && op.then && !op.else) total -= 0.5;
        break;
      }
      case 'repeat':
        total += scoreOps(game, actor, op.ops, depth + 1) * (op.times || 1);
        break;
      case 'choose': {
        const best = (op.options || []).map((o) => scoreOps(game, actor, o.ops, depth + 1));
        total += best.length ? Math.max(...best) : 0;
        break;
      }
      case 'discard':
        total += base * value;
        break;
      default:
        total += base * value;
        break;
    }
  }
  return total;
}

function scoreCard(game, actor, card) {
  const raw = scoreOps(game, actor, card.ops || []);
  const cost = card.cost || 0;
  const momentum = card.momentum || 0;
  // 消耗越小越划算；大招要有额外加权（一局只能用一次）
  let score = raw - cost * 1.15 - momentum * 0.7;
  if (card.type === 'ult') score += 1.6;
  // 残血时优先自保
  if (actor.score <= 8 && (card.ops || []).some((o) => o.op === 'heal')) score += 1.5;
  return score;
}

export class BabanAI {
  constructor(opts = {}) {
    this.difficulty = opts.difficulty || 'normal';
    // 思考停顿：模拟"想一下再出牌"。负数表示完全不等待（自检 / 模拟用）
    this.thinkMs = opts.thinkMs ?? 420;
    // 难度：easy 会犯傻，hard 更贪
    this.threshold = { easy: 2.6, normal: 1.1, hard: 0.2 }[this.difficulty] ?? 1.1;
  }

  /** 供引擎 askChoice 调用（同步返回） */
  chooseOption(game, playerIdx, request) {
    const actor = game.players[playerIdx];
    const options = request.options || [];
    let best = options[0];
    let bestScore = -Infinity;
    options.forEach((option) => {
      let s = scoreOps(game, actor, option.ops);
      // 没有 ops 的选项（纯文本）给一点随机，避免永远选第一个
      if (!option.ops || option.ops.length === 0) s = 0.1 + Math.random();
      if (s > bestScore) { bestScore = s; best = option; }
    });
    return best;
  }

  /** 供引擎 takeActions 调用：AI 的一个回合 */
  async takeTurn(game, playerIdx) {
    const actor = game.players[playerIdx];
    // 教学模式可以让电脑"放水"：每回合最多出 N 张
    const handicap = game.aiHandicap || null;
    const maxCards = handicap && typeof handicap.maxCardsPerTurn === 'number'
      ? handicap.maxCardsPerTurn
      : Infinity;
    const think = handicap && typeof handicap.thinkMs === 'number' ? handicap.thinkMs : this.thinkMs;
    let playedThisTurn = 0;
    let guard = 0;
    for (;;) {
      guard += 1;
      if (guard > 24 || game.over) break;
      if (playedThisTurn >= maxCards) break;
      const playable = actor.hand
        .map((card) => ({ card, score: scoreCard(game, actor, card), check: game.canPlay(actor, card) }))
        .filter((entry) => entry.check.ok)
        .sort((a, b) => b.score - a.score);

      if (playable.length === 0) break;
      const best = playable[0];
      if (best.score < this.threshold) break;
      // 电脑也会"犹豫"一下，看着更像人（thinkMs 为负则完全不等待）
      if (think >= 0) await sleep(think + Math.random() * 220);
      if (game.over) break;
      const ok = await game.playCard(actor, best.card.uid);
      if (!ok) break;
      playedThisTurn += 1;
      if (think >= 0) await sleep(120);
    }
  }
}

export { scoreCard, scoreOps };
