/**
 * 教程自动演示 / 验证：?tutauto=1
 * ------------------------------------------------------------------
 * 打开后由页面自己一步步完成教程（真的点按钮、真的出牌），
 * 每一步把进度追加到一份报告里（#tut-auto-report），
 * 便于用无头浏览器截图核对"13 步能不能全部走完"。
 */
export class TutorialAutoDriver {
  constructor({ runner, game, view, onDone }) {
    this.runner = runner;
    this.game = game;
    this.view = view;
    this.onDone = onDone;
    this.log = [];
    this.lastStep = null;
    this.timer = null;
  }

  start() {
    this.hint = document.createElement('pre');
    this.hint.id = 'tut-auto-report';
    this.hint.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;margin:0;padding:6px 10px;'
      + 'background:rgba(8,16,14,.82);color:#EAF2F8;font:12px/1.5 Consolas,monospace;max-height:40vh;overflow:auto';
    this.hint.textContent = '教程自动演示中…';
    document.body.append(this.hint);
    this.timer = setInterval(() => this.tick(), 700);
    this.tick();
  }

  stop() {
    clearInterval(this.timer);
    if (this.hint) this.hint.remove();
  }

  note(text) {
    this.log.push(text);
    if (this.hint) this.hint.textContent = this.log.join('\n');
    console.log('[tutauto]', text);
  }

  tick() {
    const runner = this.runner;
    // 自动演示只负责"演示"，不替玩家点"下一步"——否则会一路冲到底，
    // 连每一步的状态都看不清（自测时也一样）。只有没挂 hint 时才兜底推进。
    if (!runner || runner.finished) {
      if (runner && runner.finished && this.lastStep !== 'done') {
        this.lastStep = 'done';
        this.note(`✔ 教程结束（共 ${runner.steps.length} 步）`);
        if (this.onDone) this.onDone();
      }
      return;
    }
    const step = runner.step;
    if (!step) return;
    const key = `${runner.index}:${step.id}`;
    if (this.lastStep === key) return;
    this.lastStep = key;
    this.note(`▶ 第 ${runner.index + 1} 步：${step.teach}（${step.completeOn ? step.completeOn.type : '?'}）`);

    const adv = step.completeOn || {};
    window.setTimeout(() => this.act(adv), 260);
  }

  act(adv) {
    const game = this.game;
    const me = game.players[game.humanIndex];
    if (adv.type === 'tap') {
      const el = document.querySelector(adv.target);
      if (el) { el.click(); return; }
      this.note('  ！找不到点击目标 ' + adv.target);
      return;
    }
    if (adv.type === 'playCard') {
      const card = me.hand.find((c) => {
        if (adv.cardId && c.id !== adv.cardId) return false;
        if (adv.cardType && c.type !== adv.cardType) return false;
        return true;
      });
      if (!card) { this.note('  ！手牌里没有要打出的牌'); return; }
      const el = document.querySelector(`#hand .card[data-id="${card.id}"]`);
      if (!el) { this.note('  ！手牌元素没找到 ' + card.id); return; }
      el.click();
      window.setTimeout(() => el.click(), 160);   // 手机上第一次点是预览，这里补一次
      return;
    }
    if (adv.type === 'endTurn') {
      const btn = document.getElementById('btn-end');
      if (btn && !btn.disabled) btn.click();
      return;
    }
    if (adv.type === 'scoreBelow') {
      // 打到对手低于指定分数：能出牌就出
      const card = me.hand.find((c) => game.canPlay(me, c).ok);
      if (card) {
        const el = document.querySelector(`#hand .card[data-id="${card.id}"]`);
        if (el) { el.click(); window.setTimeout(() => el.click(), 160); }
      } else {
        const btn = document.getElementById('btn-end');
        if (btn && !btn.disabled) btn.click();
      }
      return;
    }
    if (adv.type === 'next') {
      // 这一类的主动权在玩家手里：自动演示里只记一笔，不代点（保证一步步看得清）
      this.note('  （这一步需要点『下一步』，自动演示不代点）');
      return;
    }
  }
}
