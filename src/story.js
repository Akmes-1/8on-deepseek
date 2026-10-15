/**
 * 剧情模式
 * ------------------------------------------------------------------
 * 数据来自 data/story.json（每关 1~3 场战斗 + 开场/收尾独白）。
 * 进度存在 localStorage，随时能接着打。
 *
 * 与引擎的关系：一场战斗 = 一次普通的 1v1，只是开局被 setup 覆盖了
 * （玩家/对手成绩、起手张数、对手的简化牌堆、电脑放水程度）。
 */

const KEY = 'baban_story_progress';

export function loadStoryProgress() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { cleared: [], encounter: {} };
    const data = JSON.parse(raw);
    return { cleared: data.cleared || [], encounter: data.encounter || {} };
  } catch (err) {
    return { cleared: [], encounter: {} };
  }
}

export function saveStoryProgress(progress) {
  try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (err) { /* 隐私模式下忽略 */ }
}

export class StoryRunner {
  /**
   * @param {object} opts
   *   opts.data      characters.json
   *   opts.story     story.json
   *   opts.onBattle  (encounterInfo) => void   请求开始一场战斗
   *   opts.onNarrate (script, kind) => void    请求显示独白（kind: intro | win | lose | outro）
   *   opts.onStageEnd(stage) => void
   */
  constructor({ data, story, onBattle, onNarrate, onStageEnd, onAllClear }) {
    this.data = data;
    this.story = story;
    this.onBattle = onBattle;
    this.onNarrate = onNarrate;
    this.onStageEnd = onStageEnd;
    this.onAllClear = onAllClear;
    this.progress = loadStoryProgress();
  }

  get stages() { return (this.story && this.story.stages) || []; }

  stageById(id) { return this.stages.find((s) => s.id === id) || null; }

  /** 某关是否已通关 */
  isCleared(stageId) { return this.progress.cleared.includes(stageId); }

  /** 某关打到第几场（0 起） */
  encounterIndex(stageId) {
    const n = this.progress.encounter[stageId] || 0;
    const stage = this.stageById(stageId);
    const max = stage ? Math.max(0, stage.encounters.length - 1) : 0;
    return Math.min(n, max);
  }

  /** 关卡是否解锁（前一关通关才解锁下一关） */
  isUnlocked(index) {
    if (index === 0) return true;
    const prev = this.stages[index - 1];
    return prev ? this.isCleared(prev.id) : true;
  }

  /** 开始某一关（从上次没打完的那一场继续） */
  startStage(stageId) {
    const stage = this.stageById(stageId);
    if (!stage) return;
    if (stage.intro) this.onNarrate({ speaker: stage.intro.speaker, lines: stage.intro.lines, stage }, 'intro');
    this.progress.encounter[stageId] = this.encounterIndex(stageId);
    saveStoryProgress(this.progress);
  }

  /** 玩家选好角色后，正式开这一场 */
  buildEncounter(stageId, myChar, rivalChar) {
    const stage = this.stageById(stageId);
    if (!stage) return null;
    const idx = this.encounterIndex(stageId);
    const enc = stage.encounters[idx];
    if (!enc) return null;

    const enemy = (this.data.characters || []).find((c) => c.id === enc.enemy) || rivalChar;
    const picks = [
      this.data.characters.indexOf(myChar),
      this.data.characters.indexOf(enemy)
    ];

    /** 引擎的 setup：玩家成绩/起手，对手成绩/起手/简化牌堆，电脑放水 */
    const setup = {
      0: { score: enc.playerScore ?? 10 },
      1: {
        score: enc.enemyScore ?? 10,
        hand: Array.isArray(enc.enemyDeck) && enc.enemyDeck.length
          ? enc.enemyDeck.slice(0, Math.max(1, enc.enemyOpeningHand || 3))
          : null
      },
      aiHandicap: enc.aiHandicap || { maxCardsPerTurn: 2, thinkMs: 420 },
      firstPlayer: 0
    };
    // 对手用简化牌堆：把牌堆整份换成他指定的卡 id（每张一张，写两次就是两张）
    if (Array.isArray(enc.enemyDeck) && enc.enemyDeck.length) {
      setup[1].deckCards = enc.enemyDeck;
      setup[1].hand = null; // 由 deckCards + 正常发牌决定起手
      setup[1].dealCount = enc.enemyOpeningHand;
    }

    return {
      stageId,
      stage,
      encounter: enc,
      index: idx,
      total: stage.encounters.length,
      picks,
      myChar,
      enemy,
      setup,
      dealCount: enc.enemyOpeningHand
    };
  }

  /** 一场战斗结束 */
  reportResult(stageId, won) {
    const stage = this.stageById(stageId);
    if (!stage) return;
    const idx = this.encounterIndex(stageId);
    if (won) {
      if (idx >= stage.encounters.length - 1) {
        if (!this.isCleared(stageId)) this.progress.cleared.push(stageId);
        this.progress.encounter[stageId] = 0;
        saveStoryProgress(this.progress);
        if (stage.outro) this.onNarrate({ speaker: stage.outro.speaker, lines: stage.outro.lines, stage }, 'outro');
        if (this.onStageEnd) this.onStageEnd(stage);
        if (this.stages.every((s) => this.isCleared(s.id)) && this.onAllClear) this.onAllClear();
      } else {
        this.progress.encounter[stageId] = idx + 1;
        saveStoryProgress(this.progress);
        if (this.onStageEnd) this.onStageEnd(stage, { nextEncounter: idx + 1 });
      }
    } else {
      saveStoryProgress(this.progress);
    }
  }

  reset() {
    this.progress = { cleared: [], encounter: {} };
    saveStoryProgress(this.progress);
  }
}
