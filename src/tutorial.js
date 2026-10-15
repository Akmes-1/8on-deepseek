/**
 * 新手教程关
 * ------------------------------------------------------------------
 * 设计要点：**不靠玩家自己摸**。每一步都：
 *   1) 把牌局状态摆成"只能做这一件事"的样子（引擎的 setup 覆盖）
 *   2) 在屏幕上说一句人话
 *   3) 高亮要点的那个元素
 *   4) 等玩家真的做了那件事，再进下一步
 *
 * 步骤脚本本身放在 **data/modes.json 的 modes[tutorial].steps** 里（13 步），
 * 这里只负责：读脚本 → 翻译成引擎的 setup 字段 → 监听事件推进。
 * 依赖引擎已有的能力：setup 覆盖、aiHandicap 放水、hook 事件流。
 */

const DONE_KEY = 'baban_tutorial_done';

/** 把 modes.json 的一步翻译成引擎能吃的开局覆盖 */
export function stepToSetup(step, humanIdx = 0, foeIdx = 1) {
  const s = (step && step.setup) || {};
  const setup = {};
  const me = {};
  const foe = {};
  if (typeof s.myScore === 'number') me.score = s.myScore;
  if (typeof s.foeScore === 'number') foe.score = s.foeScore;
  if (typeof s.myEnergy === 'number') me.energy = s.myEnergy;
  if (typeof s.myMomentum === 'number') me.momentum = s.myMomentum;
  if (typeof s.foeMomentum === 'number') foe.momentum = s.foeMomentum;
  if (Array.isArray(s.myHand)) me.hand = s.myHand;
  if (typeof s.foeHand === 'number') foe.handCount = s.foeHand;
  if (s.myStatus) me.status = s.myStatus;
  if (s.foeStatus) foe.status = s.foeStatus;
  if (typeof s.foeExtraDraw === 'number') setup.foeExtraDraw = s.foeExtraDraw;
  setup[humanIdx] = me;
  setup[foeIdx] = foe;
  return setup;
}

/** 教程解说层：压暗全屏 + 高亮框 + 底部解说气泡 */
export class TutorialHint {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'tut';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="tut__mask"></div>
      <div class="tut__spot"></div>
      <div class="tut__box" role="dialog" aria-live="polite">
        <div class="tut__teach"></div>
        <p class="tut__say"></p>
        <div class="tut__foot">
          <span class="tut__step"></span>
          <div class="tut__btns">
            <button class="btn btn--ghost tut__skip" type="button">跳过教程</button>
            <button class="btn btn--primary tut__next" type="button">下一步</button>
          </div>
        </div>
      </div>`;
    document.body.append(this.el);
    this.maskEl = this.el.querySelector('.tut__mask');
    this.spotEl = this.el.querySelector('.tut__spot');
    this.teachEl = this.el.querySelector('.tut__teach');
    this.sayEl = this.el.querySelector('.tut__say');
    this.stepEl = this.el.querySelector('.tut__step');
    this.nextBtn = this.el.querySelector('.tut__next');
    this.skipBtn = this.el.querySelector('.tut__skip');
    window.addEventListener('resize', () => {
      if (!this.el.hidden) this.highlight(this._current);
    });
  }

  onNext(fn) { this.nextBtn.addEventListener('click', fn); }
  onSkip(fn) { this.skipBtn.addEventListener('click', fn); }

  show({ teach, say, highlight, step, total, nextLabel, showNext }) {
    this.el.hidden = false;
    this.teachEl.textContent = teach || '';
    this.sayEl.textContent = say || '';
    this.stepEl.textContent = step ? `第 ${step} / ${total} 步` : '';
    this.nextBtn.textContent = nextLabel || '下一步';
    this.nextBtn.hidden = !showNext;
    this.highlight(highlight);
  }

  hide() {
    this.el.hidden = true;
    this.highlight(null);
  }

  /** 把要强调的元素框出来（其余部分压暗） */
  highlight(selector) {
    this._current = selector;
    const target = selector ? document.querySelector(selector) : null;
    if (!target) {
      this.spotEl.hidden = true;
      this.maskEl.style.background = 'rgba(8, 16, 14, 0.28)';
      return;
    }
    const r = target.getBoundingClientRect();
    const pad = 8;
    this.spotEl.hidden = false;
    this.spotEl.style.left = `${Math.max(0, r.left - pad)}px`;
    this.spotEl.style.top = `${Math.max(0, r.top - pad)}px`;
    this.spotEl.style.width = `${r.width + pad * 2}px`;
    this.spotEl.style.height = `${r.height + pad * 2}px`;
    this.maskEl.style.background = 'rgba(8, 16, 14, 0.5)';
  }
}

/**
 * 教程控制器：按 modes.json 的脚本一步步推进。
 * @param {object} opts
 *   opts.game / opts.view / opts.hint / opts.steps（脚本数组）
 *   opts.onStep(step, index) 每一步开始时的额外处理（比如给对手补手牌）
 *   opts.onDone({ skipped })
 */
export class TutorialRunner {
  constructor({ game, view, hint, steps, onDone, onStep }) {
    this.game = game;
    this.view = view;
    this.hint = hint;
    this.steps = steps || [];
    this.onDone = onDone;
    this.onStep = onStep;
    this.index = 0;
    this.finished = false;
    this.hint.onNext(() => this.advanceByButton());
    this.hint.onSkip(() => this.finish(true));
  }

  get step() { return this.steps[this.index]; }

  begin() { this.enterStep(0); }

  enterStep(i) {
    this.index = i;
    const step = this.steps[i];
    if (!step) { this.finish(false); return; }
    this.applyStepState(step);
    if (this.view) this.view.render(this.game);
    if (this.onStep) this.onStep(step, i);
    const adv = step.completeOn || {};
    // 点击类步骤：进来就把监听挂上（不能等引擎事件，因为玩家可能一直不出牌）
    if (adv.type === 'tap') this.bindTapOnce(adv.target);
    this.hint.show({
      teach: step.teach,
      say: step.say,
      highlight: step.highlight,
      step: i + 1,
      total: this.steps.length,
      nextLabel: step.nextLabel,
      showNext: adv.type === 'next'
    });
  }

  /** 把这一步要求的状态摆到牌桌上 */
  applyStepState(step) {
    const s = (step && step.setup) || {};
    const game = this.game;
    const human = game.humanIndex;
    const foe = 1 - human;
    const set = (idx, fn) => fn(game.players[idx]);
    const meApplied = s.myScore !== undefined || s.myEnergy !== undefined || s.myMomentum !== undefined || Array.isArray(s.myHand) || s.myStatus;
    if (meApplied) {
      set(human, (p) => {
        if (typeof s.myScore === 'number') p.score = s.myScore;
        if (typeof s.myEnergy === 'number') p.energy = s.myEnergy;
        if (typeof s.myMomentum === 'number') p.momentum = s.myMomentum;
        if (Array.isArray(s.myHand)) {
          p.hand = s.myHand
            .map((id, n) => {
              const card = game._findCard(id);
              return card ? { ...card, owner: human, uid: `${id}-t${this.index}-${n}` } : null;
            })
            .filter(Boolean);
        }
        if (s.myStatus) {
          p.status = {};
          Object.entries(s.myStatus).forEach(([k, v]) => {
            p.status[k] = typeof v === 'object' ? { ...v } : { stacks: v, duration: -1 };
          });
        }
      });
    }
    if (s.foeScore !== undefined || s.foeMomentum !== undefined || typeof s.foeHand === 'number' || s.foeStatus) {
      set(foe, (p) => {
        if (typeof s.foeScore === 'number') p.score = s.foeScore;
        if (typeof s.foeMomentum === 'number') p.momentum = s.foeMomentum;
        if (s.foeStatus) {
          p.status = {};
          Object.entries(s.foeStatus).forEach(([k, v]) => {
            p.status[k] = typeof v === 'object' ? { ...v } : { stacks: v, duration: -1 };
          });
        }
        // 教学里"对手手牌数"是摆出来的，牌从牌堆里抽不到就凭空给
        if (typeof s.foeHand === 'number') {
          while (p.hand.length > s.foeHand) p.deck.push(p.hand.pop());
          while (p.hand.length < s.foeHand) {
            const top = p.deck.pop() || game._findCard('common_01');
            if (!top) break;
            p.hand.push(top);
          }
        }
      });
    }
    // 教学局电脑放水：每回合最多出一张，想得慢一点
    game.aiHandicap = { maxCardsPerTurn: 1, thinkMs: 620 };
  }

  /** 引擎事件流：判断当前这一步是否完成 */
  onEvent(ev) {
    if (this.finished) return;
    const step = this.step;
    if (!step) return;
    const adv = step.completeOn;
    if (!adv) return;

    if (adv.type === 'playCard' && ev.type === 'play' && ev.player === this.game.humanIndex) {
      const card = this.game._findCard(ev.cardId);
      const hitId = !adv.cardId || adv.cardId === ev.cardId;
      const hitType = !adv.cardType || (card && card.type === adv.cardType);
      if (hitId && hitType) this.advance(600);
      return;
    }
    if (adv.type === 'endTurn' && ev.type === 'turnEnd' && ev.player === this.game.humanIndex) {
      this.advance(500);
      return;
    }
    if (adv.type === 'scoreBelow') {
      const who = adv.who === 'self' ? this.game.humanIndex : 1 - this.game.humanIndex;
      if (this.game.players[who].score < (adv.value ?? 0)) this.advance(700);
      return;
    }
    if (adv.type === 'tap') {
      // 点击类：玩家点了高亮元素就过（监听一次）
      this.bindTapOnce(adv.target);
    }
  }

  bindTapOnce(selector) {
    if (this._tapBound === selector) return;
    this._tapBound = selector;
    const target = selector ? document.querySelector(selector) : null;
    if (!target) { this.advance(400); return; }
    const handler = () => {
      target.removeEventListener('click', handler, true);
      this.advance(300);
    };
    target.addEventListener('click', handler, true);
  }

  advanceByButton() {
    const step = this.step;
    if (step && step.completeOn && step.completeOn.type === 'next') this.advance(0);
  }

  advance(delay = 300) {
    if (this.finished || this._advancing) return;
    this._advancing = true;
    const next = this.index + 1;
    this.hint.hide();
    window.setTimeout(() => {
      this._advancing = false;
      this._tapBound = null;
      if (this.finished) return;
      if (next >= this.steps.length) this.finish(false);
      else this.enterStep(next);
    }, delay);
  }

  finish(skipped) {
    if (this.finished) return;
    this.finished = true;
    this.hint.hide();
    try { localStorage.setItem(DONE_KEY, skipped ? 'skipped' : 'done'); } catch (err) { /* 忽略 */ }
    if (this.onDone) this.onDone({ skipped });
  }
}

export function tutorialDone() {
  try { return localStorage.getItem(DONE_KEY); } catch (err) { return null; }
}
