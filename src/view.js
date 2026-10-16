/**
 * 对战界面渲染 + 事件动画
 * ------------------------------------------------------------------
 * render(game) 负责"把状态画出来"（幂等，随时可调用）
 * handle(event, game) 负责"把刚发生的事演出效果"
 */


import { CARD_TYPE_META, STATUS_DESC, STATUS_ICON, STATUS_NAME, artImg, buildCardElement, iconImg, portraitImg, resolveArt, sleep } from './utils.js';

const $ = (id) => document.getElementById(id);

export class BattleView {
  constructor({ sfx, onPlayCard, onEndTurn, onChoice }) {
    this.sfx = sfx;
    this.onPlayCard = onPlayCard;
    this.onEndTurn = onEndTurn;
    this.onChoice = onChoice;
    this.fast = false;
    this.stats = { cardsPlayed: 0, damageDealt: 0, damageTaken: 0, healed: 0, turns: 0, ults: 0 };
    this.el = {
      foeSide: $('foe-side'), mySide: $('my-side'),
      foePortrait: $('foe-portrait'), myPortrait: $('my-portrait'),
      foeName: $('foe-name'), foeNick: $('foe-nick'),
      myName: $('my-name'), myNick: $('my-nick'), myPassive: $('my-passive'),
      foeScoreFill: $('foe-score-fill'), myScoreFill: $('my-score-fill'),
      foeScoreNum: $('foe-score-num'), myScoreNum: $('my-score-num'),
      foeScoreThumb: $('foe-score-thumb'), myScoreThumb: $('my-score-thumb'),
      foeMomentum: $('foe-momentum'), myMomentum: $('my-momentum'),
      foeEnergy: $('foe-energy'), myEnergy: $('my-energy'),
      foeStatus: $('foe-status'), myStatus: $('my-status'),
      hand: $('hand'), turnBanner: $('turn-banner'), arenaHint: $('arena-hint'),
      foePlayed: $('foe-played'), myPlayed: $('my-played'),
      log: $('battle-log'), deckCount: $('deck-count'), discardCount: $('discard-count'),
      pileCount: $('pile-count'), endBtn: $('btn-end'), tooltip: $('card-tooltip'),
      foeHandCount: $('foe-hand-count'),
      ring: document.querySelector('.pulse-ring')
    };
    this.el.endBtn.addEventListener('click', () => this.onEndTurn());
    this.bindTooltip();
    this.lastStatus = { 0: {}, 1: {} };
    this.lastScore = {};
    this.currentGame = null;
    this.currentPlayer = null;
    this._pickedCard = null;
  }

  /* ---------------- 节奏控制 ---------------- */

  pace(ms) {
    return sleep(this.fast ? Math.min(120, ms * 0.25) : ms);
  }

  setFast(v) { this.fast = Boolean(v); }

  /* ---------------- 日志 ---------------- */

  addLog(html, cls = '') {
    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = html;
    this.el.log.append(li);
    while (this.el.log.children.length > 120) this.el.log.firstChild.remove();
    this.el.log.scrollTop = this.el.log.scrollHeight;
  }

  sideTag(idx, game) {
    const who = game.humanIndex === idx ? '你' : '对手';
    const cls = game.humanIndex === idx ? 'log-side--me' : 'log-side--foe';
    const name = game.players[idx].name;
    return `<span class="log-side ${cls}">${who}·${name}</span>`;
  }

  /* ---------------- 渲染 ---------------- */

  render(game) {
    const me = game.players[game.humanIndex];
    const foe = game.players[1 - game.humanIndex];
    this.currentGame = game;
    this.currentPlayer = me;
    this.paintSide(me, 'my', game);
    this.paintSide(foe, 'foe', game);
    this.paintHand(me, game);
    this.el.deckCount.textContent = me.deck.length;
    this.el.discardCount.textContent = me.discard.length;
    this.el.pileCount.textContent = foe.deck.length;
    const myTurn = game.current === game.humanIndex && !game.over && !game.waiting;
    const waitingMe = game.waiting === game.humanIndex;
    this.el.endBtn.disabled = !waitingMe;
    this.el.ring.classList.toggle('is-on', waitingMe);
    // 对手手牌数：数他还剩几张牌，是新手最该学会的信息之一
    if (this.el.foeHandCount) {
      this.el.foeHandCount.textContent = `手牌 ${foe.hand.length}`;
      this.el.foeHandCount.hidden = false;
    }
    // 注意：这里**不能**给整副手牌设 pointer-events:none。
    // 之前那样写会让"没轮到 / 正在等结算"时连看牌都点不动，
    // 而且只要 waiting 一时对不上，卡片就完全点不了（鼠标和手指都点不动）。
    // 单张牌能不能出，由 .is-unplayable 和 tryPlay 里的引擎判断负责。
    this.el.hand.style.opacity = waitingMe ? '1' : '0.92';
    if (game.over) this.el.arenaHint.textContent = game.winner === game.humanIndex ? '你赢了这一局！' : '这局……先这样吧。';
    else if (myTurn) this.el.arenaHint.textContent = '';
  }

  paintSide(player, prefix, game) {
    const isMe = prefix === 'my';
    const maxScore = game.maxScore;
    const fill = isMe ? this.el.myScoreFill : this.el.foeScoreFill;
    const num = isMe ? this.el.myScoreNum : this.el.foeScoreNum;
    const thumb = isMe ? this.el.myScoreThumb : this.el.foeScoreThumb;
    const pct = Math.max(0, Math.min(100, (player.score / maxScore) * 100));
    fill.style.width = `${pct}%`;
    fill.classList.toggle('is-low', player.score <= 6);
    fill.classList.toggle('is-high', player.score >= 16);
    if (thumb) thumb.style.left = `${pct}%`;
    num.textContent = player.score;
    // 趋势提示：自己涨分是好事，对手涨分是坏事
    const prev = this.lastScore[player.idx];
    let trend = '';
    if (typeof prev === 'number' && prev !== player.score) {
      const up = player.score > prev;
      trend = isMe ? (up ? '▲ 冲线中' : '▼ 掉分') : (up ? '▲ 他要赢了' : '▼ 被压住了');
    }
    num.dataset.trend = trend;
    this.lastScore[player.idx] = player.score;
    this.setPips(isMe ? this.el.myMomentum : this.el.foeMomentum, player.momentum, game.maxMomentum, `${isMe ? 'my' : 'foe'}-momentum`);
    this.setPips(isMe ? this.el.myEnergy : this.el.foeEnergy, player.energy, player.energyMax, `${isMe ? 'my' : 'foe'}-energy`);

    const meter = (isMe ? this.el.myMomentum : this.el.foeMomentum).closest('.momentum-meter');
    meter.classList.toggle('is-ready', player.momentum >= 3);

    const statusRow = isMe ? this.el.myStatus : this.el.foeStatus;
    statusRow.textContent = '';
    Object.entries(player.status || {}).forEach(([key, entry]) => {
      if (!entry || entry.stacks <= 0) return;
      const chip = document.createElement('span');
      chip.className = `status-chip${['stink', 'cringe', 'silence', 'spotlight', 'mark', 'tilt'].includes(key) ? ' status-chip--bad' : ''}`;
      chip.style.setProperty('--chip-color', `var(--${isMe ? 'c-success' : 'c-danger'})`);
      chip.append(iconImg(STATUS_ICON[key] || 'art/icons/icon-star.svg', STATUS_NAME[key] || key, { size: 18, color: 'var(--chalk)' }));
      chip.append(document.createTextNode(STATUS_NAME[key] || key));
      const b = document.createElement('b');
      b.textContent = `×${entry.stacks}`;
      chip.append(b);
      chip.title = `${STATUS_NAME[key]}：${STATUS_DESC[key] || ''}`;
      if (this.lastStatus[player.idx][key] !== entry.stacks) chip.classList.add('status-chip--new');
      statusRow.append(chip);
    });
    this.lastStatus[player.idx] = Object.fromEntries(Object.entries(player.status || {}).map(([k, v]) => [k, v.stacks]));
  }

  setPips(container, value, max, kind) {
    const prev = this._lastPips && this._lastPips[kind];
    container.textContent = '';
    for (let i = 0; i < max; i += 1) {
      const pip = document.createElement('span');
      pip.className = `pip${i < value ? ' pip--on' : ''}`;
      pip.dataset.kind = kind;
      // 刚被点亮的精力球 / 气势格：播一个"点亮"动画
      if (typeof prev === 'number' && i >= prev && i < value) pip.classList.add('pip--just');
      if (typeof prev === 'number' && i >= value && i < prev) pip.classList.add('pip--spent');
      container.append(pip);
    }
    this._lastPips = { ...(this._lastPips || {}), [kind]: value };
  }

  paintHand(me, game) {
    const frag = document.createDocumentFragment();
    me.hand.forEach((card, i) => {
      const el = buildCardElement(card, game, me);
      el.setAttribute('role', 'listitem');
      // 扇形排布（角度与下沉都压得很小，避免旋转包围盒顶出窗口底边）
      const n = me.hand.length;
      const mid = (n - 1) / 2;
      const spread = Math.min(4.5, 30 / Math.max(1, n));
      const rot = (i - mid) * spread;
      const lift = Math.abs(i - mid) * Math.min(2.5, 14 / Math.max(1, n));
      el.style.setProperty('--fan', `${rot.toFixed(2)}deg`);
      el.style.setProperty('--lift', `${lift.toFixed(1)}px`);
      el.style.zIndex = String(10 + i);
      // 点击统一由 bindHand() 里的委托监听处理，这里不再单独挂（避免多层监听互相干扰）
      frag.append(el);
    });
    this.el.hand.textContent = '';
    this.el.hand.append(frag);
    // 手牌重绘后，如果之前选中的那张还在，就把"已选中"的样子贴回去
    // （不然玩家点一下选中、牌桌一刷新就白选了）
    if (this._pickedCard) {
      const still = [...this.el.hand.querySelectorAll('.card')]
        .find((node) => node.dataset.uid === this._pickedCard);
      if (still) {
        still.classList.add('is-selected', 'is-picked');
        still.dataset.hint = '再点一下出招';
      } else {
        this._pickedCard = null;
      }
    }
    this.el.tooltip.hidden = true;
  }

  /**
   * 出牌：**点一下选中，再点一下打出**（鼠标、触屏都一样，手机上手指不会挡着卡面）。
   * · 第一次点：选中这张牌 + 弹出说明 + 卡上出现「再点一下出招」
   * · 第二次点同一张：真的打出去
   * · 点另一张：换成那张（不误出牌）
   * · 打不出去的牌：直接抖一下并告诉原因，不会进入选中状态
   */
  tryPlay(el, card) {
    const game = this.currentGame;
    const me = this.currentPlayer;
    const check = game && me ? game.canPlay(me, card) : { ok: true, why: '' };

    if (!check.ok) {
      this.clearSelection();
      this.showTooltip(card, el);
      el.classList.remove('is-deny');
      void el.offsetWidth;
      el.classList.add('is-deny');
      this.sfx.play('deny');
      return;
    }

    if (this._pickedCard !== card.uid) {
      // 第一次点：选中（_pickedCard 最后赋值，等选中效果都设置好再生效）
      this.clearSelection();
      el.classList.add('is-selected', 'is-picked');
      el.dataset.hint = '再点一下出招';
      this.showTooltip(card, el);
      this.sfx.play('click');
      this._pickedCard = card.uid;
      return;
    }

    // 第二次点同一张：出牌
    this.clearSelection();
    this.el.tooltip.hidden = true;
    this._pickedCard = null;
    const res = this.onPlayCard(card, el);
    if (res === false) {
      el.classList.remove('is-deny');
      void el.offsetWidth;
      el.classList.add('is-deny');
      this.sfx.play('deny');
    }
  }

  /** 取消"已选中"状态 */
  clearSelection() {
    this._pickedCard = null;
    if (!this.el.hand) return;
    this.el.hand.querySelectorAll('.card.is-picked').forEach((node) => {
      node.classList.remove('is-picked');
      delete node.dataset.hint;
    });
  }

  isTouch() {
    return window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
  }

  /* ---------------- 提示气泡 ---------------- */

  bindTooltip() {
    // 手牌点击：一个委托监听搞定（paintHand 会重建卡牌，委托比逐个挂更稳）
    this.el.hand.addEventListener('click', (e) => {
      const cardEl = e.target.closest && e.target.closest('.card');
      if (!cardEl) return;
      e.stopPropagation();
      const card = (this.currentHand || []).find(
        (c) => c.uid === cardEl.dataset.uid || c.id === cardEl.dataset.id
      );
      if (card) this.tryPlay(cardEl, card);
    });

    // 点空白处取消选中（手机上尤其需要）
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && (t.closest('#hand') || t.closest('#card-tooltip'))) return;
      this.clearSelection();
      if (this.el.tooltip) this.el.tooltip.hidden = true;
    });
    this.el.hand.addEventListener('mouseover', (e) => {
      const cardEl = e.target.closest('.card');
      if (!cardEl) return;
      const card = (this.currentHand || []).find((c) => c.uid === cardEl.dataset.uid || c.id === cardEl.dataset.id);
      if (!card) return;
      this.showTooltip(card, cardEl);
    });
    this.el.hand.addEventListener('mouseout', () => { this.el.tooltip.hidden = true; });
    this.el.hand.addEventListener('focusin', (e) => {
      const cardEl = e.target.closest('.card');
      if (!cardEl) return;
      const card = (this.currentHand || []).find((c) => c.uid === cardEl.dataset.uid);
      if (card) this.showTooltip(card, cardEl);
    });
    this.el.hand.addEventListener('focusout', () => { this.el.tooltip.hidden = true; });
  }

  showTooltip(card, anchor) {
    const meta = CARD_TYPE_META[card.type] || { name: '卡牌' };
    const playable = this.currentGame && this.currentPlayer
      ? this.currentGame.canPlay(this.currentPlayer, card)
      : { ok: true, why: '' };
    this.el.tooltip.innerHTML = `
      <h4>${card.name}</h4>
      <div class="tt-meta">${meta.name} · 精力 ${card.cost ?? 0}${card.momentum ? ` · 需要气势 ${card.momentum}` : ''}${card.rarity === 'epic' ? ' · ★史诗' : card.rarity === 'rare' ? ' · ★稀有' : ''}</div>
      <div>${card.text || ''}</div>
      ${!playable.ok ? `<div class="tt-block">现在打不出去：${playable.why}</div>` : '<div class="tt-flavor">点一下选中，再点一下出招</div>'}`;
    this.el.tooltip.hidden = false;
    const tt = this.el.tooltip.getBoundingClientRect();
    if (this.isTouch()) {
      // 手机：贴底弹一张"说明卡"，别被手指挡住
      this.el.tooltip.style.left = '50%';
      this.el.tooltip.style.transform = 'translateX(-50%)';
      this.el.tooltip.style.top = 'auto';
      this.el.tooltip.style.bottom = '12px';
      this.el.tooltip.style.maxWidth = '92vw';
      return;
    }
    this.el.tooltip.style.transform = 'none';
    this.el.tooltip.style.bottom = 'auto';
    const rect = anchor.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tt.width / 2;
    left = Math.max(12, Math.min(window.innerWidth - tt.width - 12, left));
    let top = rect.top - tt.height - 12;
    if (top < 8) top = rect.bottom + 12;
    this.el.tooltip.style.left = `${left}px`;
    this.el.tooltip.style.top = `${top}px`;
  }

  /* ---------------- 特效小工具 ---------------- */

  floatNumber(targetEl, text, kind = 'dmg') {
    const rect = (targetEl || document.body).getBoundingClientRect();
    const node = document.createElement('div');
    node.className = `float-num float-num--${kind}`;
    node.textContent = text;
    node.style.left = `${rect.left + rect.width / 2}px`;
    node.style.top = `${rect.top + rect.height * 0.32}px`;
    document.body.append(node);
    setTimeout(() => node.remove(), 1000);
  }

  bumpNumber(el) {
    el.classList.remove('is-bump');
    void el.offsetWidth;
    el.classList.add('is-bump');
  }

  shake(el, cls = 'is-hit') {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 600);
  }

  banner(text, kind = '') {
    const el = this.el.turnBanner;
    el.textContent = text;
    el.className = `turn-banner is-on ${kind}`;
  }

  /* ---------------- 事件演出 ---------------- */

  /**
   * 事件演出串行化：把事件塞进队列一条条演，避免玩家连点导致动画打架。
   * 引擎每次 emit 都会 await 这个函数。
   */
  handle(ev, game) {
    this._queue = (this._queue || Promise.resolve()).then(() => this.play(ev, game)).catch((err) => {
      console.error('[八班风云] 演出异常', ev.type, err);
    });
    return this._queue;
  }

  async play(ev, game) {
    const me = game.players[game.humanIndex];
    this.currentHand = me.hand;
    switch (ev.type) {
      case 'gameStart':
        this.addLog(`<span class="log-sys">上课铃响，${game.players[0].name} vs ${game.players[1].name}，开始！</span>`);
        this.sfx.play('bell');
        await this.pace(700);
        break;

      case 'turnStart': {
        this.stats.turns = Math.max(this.stats.turns, Math.round(ev.turn / 2));
        const mine = ev.player === game.humanIndex;
        this.banner(mine ? `第 ${Math.ceil(ev.turn / 2)} 节课 · 你的回合` : `对手的回合`, mine ? 'is-mine' : 'is-foe');
        this.addLog(`<span class="log-sys">—— 第 ${Math.ceil(ev.turn / 2)} 节课 ——</span>`);
        this.sfx.play('bell');
        await this.pace(520);
        break;
      }

      case 'draw': {
        this.sfx.play('draw');
        this.render(game);
        if (ev.player === game.humanIndex) {
          const el = this.el.hand.querySelector(`[data-uid="${ev.cardId}"], [data-id="${ev.cardId}"]`);
          if (el) { el.classList.add('is-new'); setTimeout(() => el.classList.remove('is-new'), 500); }
          if (ev.overflow) this.addLog(`<span class="log-sys">手牌满了，${this.cardName(ev.overflow, game)} 被塞进抽屉。</span>`);
        }
        await this.pace(120);
        break;
      }

      case 'discard':
        this.render(game);
        if (ev.player === game.humanIndex) this.addLog(`<span class="log-sys">你丢掉了 ${ev.cards.length} 张牌。</span>`);
        else this.addLog(`<span class="log-sys">对手丢掉了 ${ev.cards.length} 张牌。</span>`);
        await this.pace(200);
        break;

      case 'energyReset':
        this.render(game);
        await this.pace(120);
        break;

      case 'momentumGain':
      case 'momentum':
        this.render(game);
        await this.pace(90);
        break;

      case 'energy':
        this.render(game);
        this.sfx.play('status');
        await this.pace(120);
        break;

      case 'play': {
        this.render(game);
        this.sfx.play('play');
        const card = this.findCard(ev.cardId, game);
        const mine = ev.player === game.humanIndex;
        this.stats.cardsPlayed += mine ? 1 : 0;
        this.addLog(`${this.sideTag(ev.player, game)} 打出了 <b>${card ? card.name : ev.name}</b>`);
        // 出牌演出：砸落 + 尘屑 + 压痕（card-v2）
        if (card) await this.playCardShow(card, mine);
        if (ev.cardType === 'ult' && card) await this.playUlt(card, game, mine);
        await this.pace(200);
        break;
      }

      case 'playRejected':
        this.addLog(`<span class="log-sys">出牌失败：${ev.why}</span>`);
        break;

      case 'cardNullified':
        this.nullifyStamp(ev.player === game.humanIndex ? '被点名，无效！' : '对手被点名！');
        this.sfx.play('deny');
        this.addLog(`<span class="log-sys">这张牌被老师点名，直接作废。</span>`);
        await this.pace(500);
        break;

      case 'block': {
        const target = ev.player === game.humanIndex ? this.el.mySide : this.el.foeSide;
        this.floatNumber(target, `挡下 ${ev.blocked}`, 'status');
        this.sfx.play('block');
        this.addLog(`<span class="log-sys">挡下了 ${ev.blocked} 点成绩打击。</span>`);
        this.render(game);
        await this.pace(300);
        break;
      }

      case 'damage': {
        const isMe = ev.player === game.humanIndex;
        const side = isMe ? this.el.mySide : this.el.foeSide;
        const portrait = isMe ? this.el.myPortrait : this.el.foePortrait;
        const num = isMe ? this.el.myScoreNum : this.el.foeScoreNum;
        this.shake(side);
        this.shake(portrait, 'is-hit');
        this.floatNumber(side, `-${ev.amount}`, 'dmg');
        this.bumpNumber(num);
        this.sfx.play('hit');
        if (isMe) this.stats.damageTaken += ev.amount; else this.stats.damageDealt += ev.amount;
        const tag = ev.subject === 'status' ? '（状态结算）' : '';
        this.addLog(`${this.sideTag(ev.player, game)} 成绩 -<span class="log-dmg">${ev.amount}</span>${tag}`);
        this.render(game);
        await this.pace(420);
        break;
      }

      case 'damageZero':
        this.floatNumber(ev.player === game.humanIndex ? this.el.mySide : this.el.foeSide, '0', 'status');
        this.render(game);
        await this.pace(220);
        break;

      case 'heal': {
        const isMe = ev.player === game.humanIndex;
        const side = isMe ? this.el.mySide : this.el.foeSide;
        const portrait = isMe ? this.el.myPortrait : this.el.foePortrait;
        this.shake(side, 'is-heal');
        this.shake(portrait, 'is-heal');
        this.floatNumber(side, `+${ev.amount}`, 'heal');
        this.sfx.play('heal');
        if (isMe) this.stats.healed += ev.amount;
        this.addLog(`${this.sideTag(ev.player, game)} 成绩 +<b>${ev.amount}</b>`);
        this.render(game);
        await this.pace(360);
        break;
      }

      case 'setScore':
        this.addLog(`<span class="log-sys">成绩被改写为 ${ev.to}。</span>`);
        this.render(game);
        await this.pace(300);
        break;

      case 'status':
      case 'statusRemove': {
        this.render(game);
        if (ev.status) this.sfx.play('status');
        if (ev.delta > 0 || ev.delta === undefined) {
          this.floatNumber(
            ev.player === game.humanIndex ? this.el.mySide : this.el.foeSide,
            `${STATUS_NAME[ev.status] || ev.status} ${ev.delta > 0 ? `+${ev.delta}` : ''}`,
            'status'
          );
        }
        await this.pace(180);
        break;
      }

      case 'statusTick':
        this.addLog(`<span class="log-sys">${STATUS_NAME[ev.status] || ev.status} 结算：${ev.stacks} 层。</span>`);
        await this.pace(280);
        break;

      case 'flag':
        this.render(game);
        await this.pace(90);
        break;

      case 'passiveTrigger':
        this.addLog(`<span class="log-sys">【被动·${ev.name}】发动！</span>`);
        this.floatNumber(ev.player === game.humanIndex ? this.el.mySide : this.el.foeSide, ev.name, 'status');
        await this.pace(420);
        break;

      case 'condition':
        await this.pace(80);
        break;

      case 'boost':
        this.floatNumber(ev.player === game.humanIndex ? this.el.mySide : this.el.foeSide, `骚气 +${ev.amount}`, 'status');
        this.addLog(`<span class="log-sys">【骚气】生效：这张牌强度 +${ev.amount}。</span>`);
        await this.pace(320);
        break;

      case 'transfer':
        this.addLog(`<span class="log-sys">${STATUS_NAME[ev.status] || ev.status} 被转移了 ${ev.value} 层。</span>`);
        this.render(game);
        await this.pace(300);
        break;

      case 'searchDeck':
        this.addLog(`<span class="log-sys">从书包里翻出了一张 ${this.cardName(ev.cardId, game)}。</span>`);
        await this.pace(300);
        break;

      case 'recover':
        this.addLog(`<span class="log-sys">回收了 ${this.cardName(ev.cardId, game)}。</span>`);
        await this.pace(240);
        break;

      case 'copyCard':
        this.addLog(`<span class="log-sys">复制了上一张牌：${this.cardName(ev.cardId, game)}。</span>`);
        await this.pace(300);
        break;

      case 'extraTurn':
        this.banner('追加一节自习课！');
        this.addLog('<span class="log-sys">获得一个额外回合！</span>');
        this.sfx.play('bell');
        await this.pace(700);
        break;

      case 'revealHand':
        this.addLog(`<span class="log-sys">对手的手牌被亮出来了。</span>`);
        this.revealFoeHand(game);
        await this.pace(500);
        break;

      case 'needChoice':
        await this.promptChoice(game);
        break;

      case 'choiceMade':
        await this.pace(120);
        break;

      case 'deckEmpty':
        this.addLog('<span class="log-sys">牌堆空了，把弃牌堆重新洗一遍。</span>');
        await this.pace(260);
        break;

      case 'actionWindow':
        this.render(game);
        if (ev.player === game.humanIndex) {
          this.el.arenaHint.textContent = '轮到你了：点手牌出招，或结束回合';
        }
        this.pace(120);
        break;

      case 'turnEnd':
        this.addLog(`<span class="log-sys">下课铃响，本回合结束。</span>`);
        await this.pace(260);
        break;

      case 'gameOver':
        this.render(game);
        this.showResult(game, ev);
        break;

      default:
        break;
    }
  }

  cardName(cardId, game) {
    const pool = [...(game.commonCards || []), ...game.players.flatMap((p) => p.character.decks || [])];
    const found = pool.find((c) => c.id === cardId);
    return found ? found.name : cardId;
  }

  findCard(cardId, game) {
    const pools = [...(game.commonCards || []), ...game.players.flatMap((p) => p.character.decks || [])];
    return pools.find((c) => c.id === cardId) || null;
  }

  buildPlayedCard(card, mine) {
    const wrap = document.createElement('div');
    wrap.className = `played-card cv2-played${mine ? '' : ' played-card--foe'}`;
    const meta = CARD_TYPE_META[card.type] || { icon: 'art/icons/icon-star.svg' };
    wrap.style.setProperty('--card-accent', `var(--c-${card.type === 'attack' ? 'danger' : card.type === 'support' ? 'success' : card.type === 'ult' ? 'warning' : 'accent'})`);
    wrap.append(artImg(meta.icon, ''));
    const b = document.createElement('b');
    b.textContent = card.name;
    wrap.append(b);
    const p = document.createElement('span');
    p.textContent = (card.text || '').slice(0, 26);
    p.style.fontSize = '10px';
    p.style.opacity = '0.75';
    wrap.append(p);
    return wrap;
  }

  /**
   * 出牌演出（card-v2）：抬起 → 飞出 → 砸落 → 尘屑 → 压痕残留。
   * 时间轴与 styles/card-v2.css 里的关键帧对齐。
   */
  async playCardShow(card, mine) {
    const slot = mine ? this.el.myPlayed : this.el.foePlayed;
    const arena = document.querySelector('.arena') || document.querySelector('.arena-cards');
    const kind = card.type || 'attack';

    // 1) 手牌抬起 + 飞出（人类出牌时才有手牌元素）
    if (mine) {
      const handEl = this.el.hand.querySelector(`[data-uid="${card.uid}"]`);
      if (handEl) {
        handEl.classList.add('cv2-play-enter', 'cv2-play-fly', `cv2-play--${kind}`);
        await sleep(180);
      }
    }

    // 2) 战场卡砸落
    slot.textContent = '';
    const el = this.buildPlayedCard(card, mine);
    el.classList.add('cv2-play-slam', `cv2-play--${kind}`);
    if (kind === 'ult') el.classList.add('cv2-play-ceremony');
    slot.append(el);

    // 3) 尘屑 + 落位微震 + 压痕残留
    if (arena) {
      const dust = document.createElement('div');
      dust.className = `cv2-dust cv2-dust--${kind}`;
      dust.setAttribute('aria-hidden', 'true');
      arena.append(dust);
      setTimeout(() => dust.remove(), 1100);

      const residue = document.createElement('div');
      residue.className = `cv2-residue cv2-residue--${kind}`;
      residue.setAttribute('aria-hidden', 'true');
      const slotRect = slot.getBoundingClientRect();
      const arenaRect = arena.getBoundingClientRect();
      residue.style.left = `${slotRect.left - arenaRect.left + slotRect.width / 2}px`;
      residue.style.top = `${slotRect.top - arenaRect.top + slotRect.height / 2}px`;
      arena.append(residue);
      setTimeout(() => residue.remove(), 2600);

      arena.classList.remove('cv2-impact', 'cv2-rumble');
      void arena.offsetWidth;
      arena.classList.add('cv2-impact', 'cv2-rumble');
      setTimeout(() => arena.classList.remove('cv2-impact', 'cv2-rumble'), 900);
    }
    if (kind === 'ult') {
      document.body.classList.add('cv2-ult-ceremony');
      setTimeout(() => document.body.classList.remove('cv2-ult-ceremony'), 1500);
    }
    await sleep(kind === 'ult' ? 520 : 320);
  }

  async playUlt(card, game, mine) {
    this.stats.ults += 1;
    const color = mine ? getComputedStyle(document.documentElement).getPropertyValue('--c-char') : 'rgba(228,87,76,.9)';
    const flash = document.createElement('div');
    flash.className = 'ult-flash';
    flash.style.setProperty('--ult-color', color || 'rgba(247,201,72,.9)');
    const word = document.createElement('div');
    word.className = 'ult-word';
    word.textContent = card.name;
    document.body.append(flash, word);
    document.body.classList.add('is-screen-shake');
    this.sfx.play('ult');
    setTimeout(() => {
      flash.remove(); word.remove();
      document.body.classList.remove('is-screen-shake');
    }, 1200);
    await this.pace(950);
  }

  nullifyStamp(text) {
    const node = document.createElement('div');
    node.className = 'nullify-stamp';
    node.textContent = text;
    node.style.left = '50%';
    node.style.top = '46%';
    node.style.transform = 'translate(-50%, -50%)';
    document.body.append(node);
    setTimeout(() => node.remove(), 1100);
  }

  revealFoeHand(game) {
    const foe = game.players[1 - game.humanIndex];
    const slot = this.el.foePlayed;
    slot.textContent = '';
    const wrap = document.createElement('div');
    wrap.className = 'foe-hand';
    foe.hand.forEach((c) => {
      const mini = document.createElement('div');
      mini.className = 'card-mini is-revealed';
      mini.textContent = c.name;
      mini.title = c.text;
      wrap.append(mini);
    });
    slot.append(wrap);
  }

  /* ---------------- 弹窗 ---------------- */

  async promptChoice(game) {
    const pending = game.pendingChoice;
    if (!pending) return;
    const overlay = $('choice-overlay');
    const title = $('choice-title');
    const box = $('choice-options');
    title.textContent = pending.prompt || '选一个';
    box.textContent = '';
    pending.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.type = 'button';
      btn.textContent = `${i + 1}. ${opt.label}`;
      btn.addEventListener('click', () => {
        overlay.hidden = true;
        this.sfx.play('click');
        this.onChoice(opt.label);
      });
      box.append(btn);
    });
    overlay.hidden = false;
    box.querySelector('.choice-btn')?.focus();
  }

  showResult(game, ev) {
    const won = ev.winner === game.humanIndex;
    const overlay = $('result-overlay');
    const badge = $('result-badge');
    const winner = game.players[ev.winner];
    const loser = game.players[1 - ev.winner];
    badge.src = resolveArt(won ? 'art/ui/badge-win.svg' : 'art/ui/badge-lose.svg');
    badge.classList.toggle('is-lose', !won);
    $('result-title').textContent = won ? '这局你赢了！' : '这局输了，下次再来';
    // 文案要说明"谁因为什么输/赢"，不要只写对手名字
    $('result-text').textContent = ev.reason === 'score up'
      ? `${winner.name} 把成绩冲到了 ${game.maxScore} 分，提前交卷走人。`
      : `${loser.name} 的成绩掉到了 0，被请去办公室喝茶。`;
    const me = game.players[game.humanIndex];
    const foe = game.players[1 - game.humanIndex];
    $('result-stats').innerHTML = `
      <div>你的成绩：<b>${me.score}</b></div>
      <div>对手成绩：<b>${foe.score}</b></div>
      <div>打了 <b>${this.stats.turns}</b> 节课</div>
      <div>出牌 <b>${this.stats.cardsPlayed}</b> 张</div>
      <div>造成伤害 <b>${this.stats.damageDealt}</b></div>
      <div>受到伤害 <b>${this.stats.damageTaken}</b></div>`;
    overlay.hidden = false;
    this.sfx.play(won ? 'win' : 'lose');
  }

  resetStats() {
    this.stats = { cardsPlayed: 0, damageDealt: 0, damageTaken: 0, healed: 0, turns: 0, ults: 0 };
    this.el.log.textContent = '';
    this.el.foePlayed.textContent = '';
    this.el.myPlayed.textContent = '';
    this.lastStatus = { 0: {}, 1: {} };
    $('result-overlay').hidden = true;
    $('choice-overlay').hidden = true;
  }
}
