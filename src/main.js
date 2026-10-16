/**
 * 《八班风云》入口：数据加载 → 选人 → 对战循环
 */
import { BabanGame, setSpeed } from './engine.js';
import { applyTokens, artImg, avatarSrc, bootError, buildCardElement, placeholderPortrait, portraitSrc, sleep } from './utils.js';
import { BabanAI } from './ai.js';


// 贴图包（node tools/build-upload.js 生成）：122 张 SVG 打包成一个文件，
import { BattleView } from './view.js';
import { Sfx } from './audio.js';
import { TutorialHint, TutorialRunner } from './tutorial.js';
import { TutorialAutoDriver } from './tutorial-auto.js';
import { StoryRunner, loadStoryProgress } from './story.js';
// 内联数据快照（node tools/embed-data.js 生成）：让 file:// 双击打开也能玩
import { embeddedCharacters, embeddedCommon, embeddedTokens, embeddedStory, embeddedModes } from './embedded-data.js';

const $ = (id) => document.getElementById(id);

/** 页面级错误收集：任何未捕获异常都会记录，?diag=1 时显示出来 */
const pageErrors = [];
window.addEventListener('error', (e) => pageErrors.push(`error: ${e.message} @${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => pageErrors.push(`rejection: ${e.reason && e.reason.message ? e.reason.message : e.reason}`));

const state = {
  data: null,
  common: [],
  modes: null,          // data/modes.json
  story: null,          // data/story.json
  storyRunner: null,
  tutorial: null,       // 教程控制器
  tutorialHint: null,
  mode: 'endless',      // tutorial | story | endless
  stageId: null,        // 剧情模式当前关卡
  pendingSetup: null,   // 本局开局的覆盖参数（剧情/教程用）
  myPick: null,
  rivalPick: null,
  difficulty: 'normal',
  game: null,
  running: false,
  sfx: null,
  view: null
};

/** 自动收尾看门狗的循环次数（诊断用） */
let watchdogTick = 0;

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    const isFileProtocol = location.protocol === 'file:';
    // file:// 下必须先注入内联 token（fetch 会被浏览器拦掉）
    if (isFileProtocol) {
      await applyTokens(null, embeddedTokens);
    } else {
      await applyTokens();
    }
    state.sfx = new Sfx();

    // 先试网络（改完 JSON 刷新就能生效），失败或 file:// 时用内联快照兜底
    let loaded = false;
    if (!isFileProtocol) {
      try {
        const [charsRes, commonRes, storyRes, modesRes] = await Promise.all([
          fetch('data/characters.json'),
          fetch('data/common.json'),
          fetch('data/story.json').catch(() => null),
          fetch('data/modes.json').catch(() => null)
        ]);
        if (charsRes.ok) {
          state.data = await charsRes.json();
          state.common = commonRes.ok ? (await commonRes.json()).cards || [] : [];
          state.story = storyRes && storyRes.ok ? await storyRes.json() : null;
          state.modes = modesRes && modesRes.ok ? await modesRes.json() : null;
          loaded = true;
        }
      } catch (err) {
        console.warn('[八班风云] 读 JSON 失败，改用内联数据', err);
      }
    }
    if (!loaded) {
      state.data = embeddedCharacters;
      // embeddedCommon 是 data/common.json 的整份快照（{ name, cards: [...] }），
      // 引擎要的是"牌数组"，这里必须取出 cards —— 不然会报 commonCards is not iterable
      state.common = Array.isArray(embeddedCommon) ? embeddedCommon : (embeddedCommon.cards || []);
      state.story = embeddedStory;
      state.modes = embeddedModes;
    }
    state.story = state.story || embeddedStory || null;
    state.modes = state.modes || embeddedModes || null;
    state.data.characters = state.data.characters || [];
    if (!state.data.characters.length) throw new Error('数据里一个角色都没有');

    buildStartScreen();
    // 剧情模式控制器（进度存在 localStorage）
    state.storyRunner = new StoryRunner({
      data: state.data,
      story: state.story || { stages: [] },
      onNarrate: (script, kind) => showNarration(script, kind),
      onBattle: () => {},
      onStageEnd: (stage, info) => onStageEnd(stage, info),
      onAllClear: () => showNarration({
        speaker: '班主任',
        lines: ['三关全过了？行，这个学期课间就归你们自己安排了。', '……不过下节课的卷子还是要交的。'],
        stage: null
      }, 'outro')
    });
    state.tutorialHint = new TutorialHint();
    buildModePicker();
    state.view = new BattleView({
      sfx: state.sfx,
      onPlayCard: (card) => playCard(card),
      onEndTurn: () => endMyTurn(),
      onChoice: (label) => state.game?.resolveChoice(label)
    });
    bindGlobalUI();
    applyUrlParams();
    // 告诉单文件版的错误兜底条：一切正常，可以撤了
    window.__babanBootOk = true;
  } catch (err) {
    console.error('[八班风云] 启动失败', err);
    bootError('加载游戏数据或初始化界面时出错了。', err && err.stack ? err.stack : String(err));
  }
}

/**
 * URL 参数（便于分享与自测）：
 *   ?me=zhangkaiyao&foe=yuhaitian&difficulty=hard&auto=1&speed=0.2&layout=1
 * 这里每一步都做了容错：参数写错最多是没生效，绝不让整个页面卡住。
 */
function applyUrlParams() {
  try {
    const q = new URLSearchParams(location.search);
    const find = (id) => (state.data && state.data.characters || []).find((c) => c && c.id === id);
    const me = find(q.get('me'));
    const foe = find(q.get('foe'));
    // ?bot=1 → 连你这边也交给电脑打（观战模式，也方便自动化测试跑完整局）
    state.autoPilot = q.get('bot') === '1';
    const diff = q.get('difficulty');
    if (diff && ['easy', 'normal', 'hard'].includes(diff)) {
      state.difficulty = diff;
      $('difficulty').value = diff;
    }
    if (me) selectChar(me, 'my');
    if (foe) selectChar(foe, 'rival');
    // ?speed=0.2 → 整局节奏压缩到 1/5（自测、录屏、快速演示都方便）
    const speed = Number(q.get('speed'));
    if (Number.isFinite(speed) && speed > 0) {
      setSpeed(speed);
      $('fast-toggle').checked = true;
      document.body.classList.add('fast-mode');
    }
    refreshStartButton();
    // ?pool=zhangkaiyao 直接摊开某个角色的完整卡池
    const poolWho = find(q.get('pool'));
    if (poolWho) setTimeout(() => openPool(poolWho), 80);

    // ?mode=tutorial | story | endless —— 直接进某个模式（自测与分享用）
    const mode = q.get('mode');
    state.tutorialAutoWanted = q.get('tutauto') === '1';
    // ?tutstep=8 / ?step=8 直接跳到教程第 8 步（要在下面启动教程之前就读出来）
    const tutStep = Number(q.get('tutstep') || q.get('step'));
    if (Number.isFinite(tutStep) && tutStep > 0) state.tutorialStartAt = tutStep;
    if (mode && ['tutorial', 'story', 'endless'].includes(mode)) {
      setMode(mode);
      const stage = q.get('stage');
      if (mode === 'story' && stage && state.storyRunner.stageById(stage)) {
        state.stageId = stage;
        buildStageList();
      }
      if (q.get('auto') === '1') {
        setTimeout(() => {
          if (mode === 'tutorial') startTutorial({ auto: state.tutorialAutoWanted, startAt: state.tutorialStartAt });
          else if (mode === 'story') state.storyRunner.startStage(state.stageId || state.storyRunner.stages[0].id);
          else startBattle();
        }, 120);
      }
    } else if (q.get('auto') === '1' && state.myPick && state.rivalPick && state.myPick.id !== state.rivalPick.id) {
      setTimeout(() => startBattle(), 60);
    }
    // ?newgame=1 清掉本机进度（剧情/连胜/教程标记），方便反复体验
    if (q.get('newgame') === '1') {
      try {
        localStorage.removeItem('baban_story_progress');
        localStorage.removeItem('baban_endless_streak');
        localStorage.removeItem('baban_tutorial_done');
        state.storyRunner.progress = { cleared: [], encounter: {} };
      } catch (err) { /* 忽略 */ }
    }
    // ?ruler=1 实时量尺：手机排版调试用，直接显示各容器实际宽度
    if (q.get('ruler') === '1') showLayoutRuler();
    // ?tutstep=8 直接跳到教程第 8 步（见上方读取处）
    if (q.get('layout') === '1') setTimeout(reportLayout, 4000);
    // ?tapdemo=1 自测"点一下选中、再点一下打出"：
    // 先替玩家点"上课铃响"按钮，等手牌发下来，再用真点击点两次
    if (q.get('tapdemo') === '1') {
      // 屏幕上的记录板（截图能直接看到卡在哪一步）
      const box = document.createElement('pre');
      box.id = 'probe-report';
      box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;margin:0;padding:8px 12px;'
        + 'background:rgba(8,16,14,.85);color:#EAF2F8;font:12px/1.6 Consolas,monospace;border-radius:8px;max-width:48vw';
      document.body.append(box);
      const lines = [];
      window.__probe = (t) => {
        lines.push(t);
        box.textContent = lines.join('\n');
        // 同时写一份到隐藏节点，方便用 --dump-dom 抓出来读
        let dump = document.getElementById('probe-dump');
        if (!dump) {
          dump = document.createElement('div');
          dump.id = 'probe-dump';
          dump.style.display = 'none';
          document.body.append(dump);
        }
        dump.textContent += t + '\n';
        console.log('[tapdemo]', t);
      };

      let waited = 0;
      let clicked = false;
      const timer = setInterval(() => {
        waited += 400;
        const btn = document.getElementById('start-btn');
        const game = state.game;
        const hand = document.querySelectorAll('#hand .card').length;
        const deck = game ? game.players[game.humanIndex].deck.length : -1;
        window.__probe(`${(waited / 1000).toFixed(1)}s 按钮${btn ? (btn.disabled ? '禁用' : '可用') : '无'}`
          + ` · game${game ? '有' : '无'} · 手牌${hand} · 牌堆${deck}`
          + ` · 轮${game ? (game.current === game.humanIndex ? '我' : '敌') : '-'}`
          + ` · waiting${game ? game.waiting : '-'}`);
        if (waited > 20000) { clearInterval(timer); return; }
        if (btn && !btn.disabled && !clicked) {
          clicked = true;
          window.__probe('→ 点开始按钮');
          btn.click();
          return;
        }
        if (hand && game && !game.over && game.current === game.humanIndex) {
          clearInterval(timer);
          window.__probe('→ 手牌就绪，开始两次点击测试');
          demoTwoTapPlay(game);
        }
      }, 400);
    }
    if (q.get('diag') === '1') {
      // 连续采样：能看出"卡在第几回合、卡在谁身上"
      setTimeout(reportDiag, 3000);
      setTimeout(() => {
        const old = document.getElementById('diag-report');
        if (old) old.remove();
        reportDiag();
      }, 12000);
    }
  } catch (err) {
    console.warn('[八班风云] URL 参数处理失败（已忽略）', err);
  }
}

/**
 * 自测用：?clickdemo=1
 * 自动演示"点一下选中、再点一下打出"，并在屏幕上留一份记录，方便截图核对。
 */
function demoTwoTapPlay(game) {
  const note = (text) => {
    let box = document.getElementById('click-demo-report');
    if (!box) {
      box = document.createElement('pre');
      box.id = 'click-demo-report';
      box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;margin:0;padding:8px 12px;'
        + 'background:rgba(8,16,14,.82);color:#EAF2F8;font:12px/1.6 Consolas,monospace;border-radius:8px';
      document.body.append(box);
    }
    box.textContent += text + '\n';
    if (window.__probe) window.__probe(text);
    else console.log('[自测]', text);
  };
  window.__clickNote = note;

  const snap = (tag) => {
    const h = document.getElementById('hand');
    const n = h ? h.querySelectorAll('.card').length : -1;
    const playable = h ? h.querySelectorAll('.card:not(.is-unplayable)').length : -1;
    const g = state.game;
    note(`[${tag}] 手牌 ${n}（可出 ${playable}）· 轮到 ${g ? (g.current === g.humanIndex ? '我' : '对手') : '?'}`
      + ` · 牌堆 ${g ? g.players[g.humanIndex].deck.length : '?'}`);
  };

  snap('进入自测');
  // 手牌和回合都就绪了（外面已经等过），直接点
  playNow();

  function playNow() {
  const hand = document.getElementById('hand');
  if (!hand) { note('没找到手牌区'); return; }
  const cards = [...hand.querySelectorAll('.card')];
  const me = game.players[game.humanIndex];
  // 按引擎的判断挑一张真能出的牌（不靠 CSS 类名猜）
  const cardEl = cards.find((el) => {
    const card = me.hand.find((c) => c.uid === el.dataset.uid || c.id === el.dataset.id);
    return card && game.canPlay(me, card).ok;
  });
  if (!cardEl) { note(`手牌 ${cards.length} 张，但没有引擎判定能出的牌`); return; }
  const card = me.hand.find((c) => c.uid === cardEl.dataset.uid || c.id === cardEl.dataset.id);
  const before = cards.length;
  const arenaBefore = document.querySelectorAll('#battlefield .card, .arena .card, .slot .card').length;
  note(`手牌 ${before} 张，准备出：《${card.name}》`);

  // 点击：按坐标找"真正被点到的那个元素"，再从它派发完整事件序列
  // （真人点击就是这样：事件从最上层元素冒泡上去，而不是直接打在卡牌上）
  const realClick = (el) => {
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height * 0.55);
    const target = document.elementFromPoint(x, y) || el;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      const Ev = type.indexOf('pointer') === 0 && window.PointerEvent ? PointerEvent : MouseEvent;
      target.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    });
    return { target, x, y };
  };
  const describe = (el) => !el ? '(空)'
    : `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.')}`;

  // 第 1 次点击：应该只是选中
  const hit1 = realClick(cardEl);
  const picked = document.querySelector('#hand .card.is-picked');
  note(`第 1 次点击 → 落点 (${hit1.x},${hit1.y}) 上是 ${describe(hit1.target)}`);
  note(`  → ${picked ? '✔ 已选中（提示条：' + picked.dataset.hint + '）' : '✘ 没进入选中状态'}`);

  // 第 2 次点击：应该真的打出去
  window.setTimeout(() => {
    // 手牌可能被重绘过，按 uid 找当前这一刻的那张牌（和真人玩家看到的一致）
    const live = [...document.getElementById('hand').querySelectorAll('.card')]
      .find((el) => el.dataset.uid === card.uid || el.dataset.id === card.id) || cardEl;
    note(`（第 2 次点击前）卡片还在手牌里吗：${document.getElementById('hand').contains(live) ? '在' : '已被重绘换掉'}`
      + ` · is-picked：${live.classList.contains('is-picked') ? '在' : '已被清掉'}`);
    const hit2 = realClick(live);
    note(`第 2 次点击 → 落点 (${hit2.x},${hit2.y}) 上是 ${describe(hit2.target)}`);
    const played = game.cardsPlayedThisTurn || 0;
    note(`  → 引擎记录本回合已出牌 ${played} 张 · 最近事件 ${game.log.slice(-4).map((e) => e.type).join(' → ')}`);
    note(played > 0 ? '✔ 出牌成功' : '✘ 引擎没有记录到出牌');
  }, 1500);
  }
}

/**
 * 实时量尺（?ruler=1）：手机排版调试用。
 * 直接把手牌、成绩条、资源行等容器的实际宽度写在屏幕左上角，一眼看出谁超宽。
 */
function showLayoutRuler() {
  const box = document.createElement('pre');
  box.id = 'layout-ruler';
  box.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;margin:0;padding:4px 6px;'
    + 'background:rgba(8,16,14,.86);color:#EAF2F8;font:10px/1.35 Consolas,monospace;'
    + 'border-bottom-right-radius:8px;pointer-events:none;white-space:pre';
  document.body.append(box);

  const tick = () => {
    const vw = document.documentElement.clientWidth;
    const w = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return '—';
      const b = el.getBoundingClientRect();
      return `${Math.round(b.width)}@${Math.round(b.right)}`;
    };
    const narrow = window.matchMedia('(max-width: 620px)').matches;
    // 右边距 = 右边界到视口右边的距离，缩到别的宽度时这个值基本不变，
    // 所以"若屏幕更窄会怎样"可以用 假设宽度 - 右边距 推算
    const guess = (sel, target = 390) => {
      const el = document.querySelector(sel);
      if (!el) return '—';
      const b = el.getBoundingClientRect();
      const gapRight = vw - b.right;
      return `${Math.round(target - gapRight)}@${target}`;
    };
    box.textContent = [
      `视口 ${vw} · 窄屏规则${narrow ? ' 生效' : ' 未生效'}`,
      `board ${w('.board')}  side ${w('.side--me')}`,
      `score块 ${w('.side--me .score-block')}`,
      `成绩条 ${w('.side--me .score-bar')}`,
      `资源行 ${w('.side--me .meter-row')}  头像块 ${w('.side--me .who')}`,
      `手牌区 ${w('.hand-zone')}`,
      `若宽390 → 成绩条 ${guess('.side--me .score-bar')} 资源行 ${guess('.side--me .meter-row')}`,
      `屏宽标尺 ${'='.repeat(Math.max(4, Math.round(vw / 10)))} (${vw})`
    ].join('\n');
  };
  tick();
  window.addEventListener('resize', tick);
  setInterval(tick, 800);
}

/** 启动诊断（自测用）：?diag=1 会把关键状态打到屏幕上 */
function reportDiag() {
  const data = {
    abilities: (() => {
      const me = state.game ? state.game.players[state.game.humanIndex] : null;
      const foe = state.game ? state.game.players[1 - state.game.humanIndex] : null;
      return me ? {
        meCharacter: me.character.id, meScore: me.score, meEnergy: me.energy,
        meHand: me.hand.map((c) => c.name),
        foeCharacter: foe.character.id, foeScore: foe.score, foeEnergy: foe.energy, foeHand: foe.hand.length,
        事件数: state.game.log.length,
        controllers: state.game.controllers,
        waiting: state.game.waiting,
        演出流水: state.viewTrace || [],
        最后事件: state.game.log.slice(-6).map((e) => `${e.type}${e.player !== undefined ? '#' + e.player : ''}${e.name ? ':' + e.name : ''}`)
      } : null;
    })(),
    // 放在最前面，方便截图时一眼读到（否则要滚动很久）
    hasData: Boolean(state.data),
    characters: state.data && state.data.characters ? state.data.characters.map((c) => c.id) : [],
    commonCards: state.common.length,
    myPick: state.myPick && state.myPick.id,
    rivalPick: state.rivalPick && state.rivalPick.id,
    charGridChildren: document.querySelectorAll('#char-grid .char-pick').length,
    rivalGridChildren: document.querySelectorAll('#rival-grid .char-pick').length,
    screens: [...document.querySelectorAll('.screen')].map((s) => `${s.id}:${s.className}`),
    battleLogItems: document.querySelectorAll('#battle-log li').length,
    handCards: document.querySelectorAll('#hand .card').length,
    gameStarted: Boolean(state.game),
    turn: state.game ? state.game.turn : null,
    current: state.game ? state.game.current : null,
    humanIndex: state.game ? state.game.humanIndex : null,
    waiting: state.game ? state.game.waiting : null,
    pendingChoice: state.game && state.game.pendingChoice ? state.game.pendingChoice.prompt : null,
    over: state.game ? state.game.over : null,
    scores: state.game ? state.game.players.map((p) => p.score) : [],
    resultVisible: !document.getElementById('result-overlay').hidden,
    watchdogTick,
    queueDepth: state.view && state.view._queue ? 'chained' : 'idle',
    pageErrors
  };
  const pre = document.createElement('pre');
  pre.id = 'diag-report';
  pre.style.cssText = 'position:fixed;inset:0;z-index:999;background:#0E1A16;color:#EAF2F8;'
    + 'font:13px Consolas,monospace;padding:16px;margin:0;overflow:auto;white-space:pre-wrap';
  pre.textContent = JSON.stringify(data, null, 2);
  document.body.append(pre);
  console.log('[diag]', data);
}

/** 布局体检（自测用）：?auto=1&layout=1 会把各区块尺寸打到屏幕上 */
function reportLayout() {
  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) };
  };
  const vh = document.documentElement.clientHeight;
  const cards = [...document.querySelectorAll('#hand .card')].map((el) => {
    const b = el.getBoundingClientRect();
    return {
      name: el.querySelector('.card__name')?.textContent,
      top: Math.round(b.top),
      bottom: Math.round(b.bottom),
      h: Math.round(b.height),
      offsetH: el.offsetHeight,
      transform: getComputedStyle(el).transform,
      cardHVar: getComputedStyle(document.documentElement).getPropertyValue('--hand-card-h')
    };
  });
  const data = {
    reportKind: 'layout',
    /** 横向超宽体检：手机排版最常见的问题就是某个元素比屏幕还宽 */
    overflow: (() => {
      const vw = document.documentElement.clientWidth;
      const out = { viewportWidth: vw, over: [] };
      ['.board', '.side--me', '.side--foe', '.side--me .score-block', '.side--me .score-row',
        '.side--me .score-bar', '.side--me .meter-row', '.side--me .who',
        '.side--foe .meter-row', '.hand-zone', '.arena'].forEach((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const b = el.getBoundingClientRect();
        out[sel.replace(/[.\s>-]+/g, '_')] = { w: Math.round(b.width), left: Math.round(b.left), right: Math.round(b.right) };
      });
      // 成绩条内部的零件，看谁把宽度顶出去了
      const bar = document.querySelector('.side--me .score-bar');
      if (bar) {
        out.scoreParts = {};
        [...bar.children].forEach((el) => {
          const b = el.getBoundingClientRect();
          out.scoreParts[el.className.split(' ')[0] || el.tagName.toLowerCase()] = `${Math.round(b.width)}px@${Math.round(b.left)}`;
        });
      }
      document.querySelectorAll('#screen-battle *').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.right > vw + 1 && out.over.length < 12) {
          out.over.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.')} +${Math.round(b.right - vw)}px`);
        }
      });
      return out;
    })(),
    tutorialStep: (() => {
      const el = document.querySelector('.tut');
      const stepTxt = el && !el.hidden ? (el.querySelector('.tut__step') || {}).textContent : null;
      return {
        urlStepParam: new URLSearchParams(location.search).get('step'),
        wanted: state.tutorialStartAt,
        debug: state.tutorialDebug || null,
        mode: state.mode,
        stepIndex: state.tutorial ? state.tutorial.index : null,
        stepLabel: stepTxt,
        autoRunning: Boolean(state.tutorialAuto),
        hand: state.game ? state.game.players[state.game.humanIndex].hand.map((c) => c.name) : null,
        scores: state.game ? state.game.players.map((p) => p.score) : null
      };
    })(),
    viewport: { w: document.documentElement.clientWidth, h: vh },
    board: rect('.board'),
    foe: rect('.side--foe'),
    arena: rect('.arena'),
    me: rect('.side--me'),
    handZone: rect('.hand-zone'),
    hand: rect('.hand'),
    abilities: (() => {
    const me = state.game ? state.game.players[state.game.humanIndex] : null;
    const foe = state.game ? state.game.players[1 - state.game.humanIndex] : null;
    return me ? {
      meCharacter: me.character.id, meScore: me.score, meEnergy: me.energy,
      meHand: me.hand.map((c) => c.name),
      foeCharacter: foe.character.id, foeScore: foe.score, foeEnergy: foe.energy, foeHand: foe.hand.length,
      事件数: state.game.log.length,
      最后事件: state.game.log.slice(-6).map((e) => `${e.type}${e.player !== undefined ? '#' + e.player : ''}${e.name ? ':' + e.name : ''}`)
    } : null;
  })(),
  log: rect('.log-wrap'),
    cardCount: cards.length,
    clippedCards: cards.filter((c) => c.bottom > vh || c.top < 0),
    docScrollH: document.documentElement.scrollHeight,
    generatedAt: new Date().toISOString()
  };
  const pre = document.createElement('pre');
  pre.id = 'layout-report';
  pre.style.cssText = 'position:fixed;inset:0;z-index:999;background:#0E1A16;color:#EAF2F8;font:13px Consolas,monospace;padding:16px;margin:0;overflow:auto;white-space:pre-wrap';
  // 窄屏用紧凑字号，保证一屏能看完整
  if (document.documentElement.clientWidth < 520) pre.style.font = '9px/1.35 Consolas,monospace';
  pre.textContent = JSON.stringify(data, null, 2);
  document.body.append(pre);
  console.log('[layout]', data);
  document.title = 'layout-done';
}

/* ------------------------------------------------------------------ */
/* 选人界面                                                            */
/* ------------------------------------------------------------------ */

function buildStartScreen() {
  const grid = $('char-grid');
  const rivalGrid = $('rival-grid');
  grid.textContent = '';
  rivalGrid.textContent = '';

  state.data.characters.forEach((ch, i) => {
    grid.append(buildPick(ch, 'my', i));
    rivalGrid.append(buildPick(ch, 'rival', i));
  });
  // 默认：你选第一个，对手选第二个（可自由改）
  selectChar(state.data.characters[0], 'my');
  selectChar(state.data.characters[1] ?? state.data.characters[0], 'rival');
  refreshStartButton();
  buildCodex();
}

function buildPick(ch, role, index) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'char-pick';
  btn.dataset.charId = ch.id;
  btn.dataset.role = role;
  btn.style.setProperty('--pick-color', ch.themeColor || 'var(--c-accent)');

  const portrait = document.createElement('div');
  portrait.className = 'char-pick__portrait';
  portrait.append(artImg(avatarSrc(ch), `${ch.name} 头像`, placeholderPortrait(ch.name, ch.themeColor)));

  const body = document.createElement('div');
  body.className = 'char-pick__body';
  const name = document.createElement('div');
  name.className = 'char-pick__name';
  name.textContent = ch.name;
  const nick = document.createElement('div');
  nick.className = 'char-pick__nick';
  nick.textContent = ch.nickname ? `外号：${ch.nickname}` : '';
  const desc = document.createElement('div');
  desc.className = 'char-pick__desc';
  desc.textContent = ch.desc || ch.tagline || '';
  const mech = document.createElement('div');
  mech.className = 'char-pick__mech';
  mech.textContent = `绝活：${ch.passive ? ch.passive.name : '—'}${ch.ult ? ` ／ 大招：${ch.ult.name}` : ''}`;
  const strat = document.createElement('div');
  strat.className = 'char-pick__strat';
  strat.textContent = ch.strategy || '';
  body.append(name, nick, mech, desc, strat);

  // 「看卡池」：选人页就能翻完整卡表（点它不会误选角色）
  const poolBtn = document.createElement('span');
  poolBtn.className = 'char-pick__pool';
  poolBtn.textContent = '看卡池 ▸';
  poolBtn.setAttribute('role', 'button');
  poolBtn.setAttribute('tabindex', '0');
  poolBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.sfx.play('click');
    openPool(ch);
  });
  poolBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openPool(ch); }
  });

  btn.append(portrait, body, poolBtn);
  btn.addEventListener('click', () => {
    state.sfx.play('click');
    selectChar(ch, role);
    refreshStartButton();
  });
  btn.addEventListener('mouseenter', () => {
    const hint = $('start-hint');
    if (role === 'my' && hint) hint.textContent = `${ch.name}：${ch.strategy || ''}`;
  });
  return btn;
}

function selectChar(ch, role) {
  if (role === 'my') state.myPick = ch; else state.rivalPick = ch;
  document.querySelectorAll(`.char-pick[data-role="${role}"]`).forEach((el) => {
    el.classList.toggle('is-picked', el.dataset.charId === ch.id);
  });
  // 选人页的图鉴跟着你选的角色走（页签能看别人的）
  if (role === 'my' && document.getElementById('codex-grid')) {
    renderPool({
      character: ch,
      grid: $('codex-grid'),
      tabs: $('codex-tabs'),
      abilities: $('codex-abilities')
    });
  }
}

function refreshStartButton() {
  const btn = $('start-btn');
  const hint = $('start-hint');
  const same = state.myPick && state.rivalPick && state.myPick.id === state.rivalPick.id;
  btn.disabled = !state.myPick || !state.rivalPick || same;

  if (state.mode === 'tutorial') {
    btn.disabled = !state.myPick;
    btn.textContent = '开始新手教程';
    hint.textContent = state.myPick
      ? `教程用 ${state.myPick.name}，对手固定是于浩天，一步一步教你打。`
      : '先选一位同学，教程会手把手带你。';
    return;
  }
  if (state.mode === 'story') {
    btn.disabled = !state.myPick;
    btn.textContent = '选好人物，去选关卡';
    const stage = state.stageId ? state.storyRunner.stageById(state.stageId) : null;
    hint.textContent = state.myPick
      ? (stage ? `当前选中：${stage.title}（点上面的关卡卡片开始）` : '先在上面挑一关，再点开始。')
      : '先选一位同学出战。';
    return;
  }
  btn.textContent = '上课铃响，开始对决';
  if (same) hint.textContent = '不能自己打自己，换一个对手吧。';
  else if (state.myPick && state.rivalPick) {
    const streak = loadStreak();
    const tune = endlessTuning(streak.now + 1);
    hint.textContent = `开打：${state.myPick.name}（你） vs ${state.rivalPick.name}（${tune.label}）`
      + (streak.now ? ` · 当前连胜 ${streak.now}` : '');
  }
}

/* ------------------------------------------------------------------ */
/* 全局 UI 绑定                                                        */
/* ------------------------------------------------------------------ */

function bindGlobalUI() {
  $('start-btn').addEventListener('click', () => {
    if (window.__probe) {
      window.__probe(`[点击] mode=${state.mode} 我=${state.myPick ? state.myPick.id : 'null'}`
        + ` 敌=${state.rivalPick ? state.rivalPick.id : 'null'} game=${state.game ? '有' : 'null'}`);
    }
    if (state.mode === 'tutorial') return startTutorial({ auto: state.tutorialAutoWanted });
    if (state.mode === 'story') {
      if (!state.stageId) {
        const first = state.storyRunner.stages.find((s, i) => state.storyRunner.isUnlocked(i) && !state.storyRunner.isCleared(s.id))
          || state.storyRunner.stages[0];
        if (first) state.stageId = first.id;
      }
      if (!state.stageId) return;
      state.storyRunner.startStage(state.stageId);
      return;
    }
    const streak = loadStreak();
    const tune = endlessTuning(streak.now + 1);
    try {
      startBattle({ difficulty: tune.difficulty, setup: tune.bonusScore ? { 1: { score: 10 + tune.bonusScore } } : null });
    } catch (err) {
      console.error('[八班风云] 开局失败', err);
      if (window.__probe) window.__probe('[开局异常] ' + err.message + '\n' + (err.stack || '').split('\n').slice(0, 4).join('\n'));
      bootError('这一局没能开起来', err && err.stack ? err.stack : String(err));
    }
  });
  $('btn-stages-back').addEventListener('click', () => { state.sfx.play('click'); setMode('endless'); });
  $('difficulty').addEventListener('change', (e) => {
    state.difficulty = e.target.value;
    refreshStartButton();
  });
  $('sound-toggle').addEventListener('change', (e) => {
    state.sfx.setEnabled(e.target.checked);
    if (e.target.checked) state.sfx.play('click');
  });
  $('fast-toggle').addEventListener('change', (e) => {
    state.view.setFast(e.target.checked);
    document.body.classList.toggle('fast-mode', e.target.checked);
  });
  $('btn-again').addEventListener('click', () => {
    $('result-overlay').hidden = true;
    if (state.mode === 'tutorial') return startTutorial({ auto: state.tutorialAutoWanted });
    if (state.mode === 'story') return beginStoryBattle();
    const streak = loadStreak();
    const tune = endlessTuning(streak.now + 1);
    startBattle({ difficulty: tune.difficulty, setup: tune.bonusScore ? { 1: { score: 10 + tune.bonusScore } } : null });
  });
  $('btn-back').addEventListener('click', () => {
    $('result-overlay').hidden = true;
    $('screen-battle').classList.remove('screen--active');
    $('screen-start').classList.add('screen--active');
    buildModePicker();
  });
  $('btn-help').addEventListener('click', showRules);
  $('btn-pool').addEventListener('click', () => {
    const me = state.game ? state.game.players[state.game.humanIndex].character : state.myPick;
    state.sfx.play('click');
    openPool(me);
  });
  $('btn-info-close').addEventListener('click', () => { $('info-overlay').hidden = true; });
  $('btn-open-pool').addEventListener('click', () => {
    const me = state.game ? state.game.players[state.game.humanIndex].character : state.myPick;
    $('info-overlay').hidden = true;
    openPool(me);
  });
  $('btn-pool-close').addEventListener('click', () => { state.sfx.play('click'); closePool(); });
  // 点遮罩空白处也能关掉图鉴
  $('pool-overlay').addEventListener('click', (e) => { if (e.target === $('pool-overlay')) closePool(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('info-overlay').hidden = true;
      closePool();
      return;
    }
    if (!$('pool-overlay').hidden) return;   // 看图鉴时不响应出牌快捷键
    if ($('screen-battle').classList.contains('screen--active') === false) return;
    if (!$('choice-overlay').hidden) {
      const n = Number(e.key);
      if (n >= 1 && n <= 6) {
        const btn = $('choice-options').querySelectorAll('.choice-btn')[n - 1];
        if (btn) btn.click();
      }
      return;
    }
    if (e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      endMyTurn();
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 8 && state.game) {
      const me = state.game.players[state.game.humanIndex];
      const card = me.hand[n - 1];
      if (card) playCard(card);
    }
  });
}

function showRules() {
  const me = state.game ? state.game.players[state.game.humanIndex] : null;
  const ch = me ? me.character : state.myPick;
  $('info-title').textContent = ch ? `${ch.name} · 规则与绝活` : '规则速查';
  $('info-body').innerHTML = `
    <h4>怎么赢</h4>
    <ul>
      <li>成绩既是血条也是进度条：<b>涨到 ${state.data.maxScore} 直接赢</b>，<b>掉到 0 直接输</b>。</li>
      <li>每回合抽 ${state.data.drawPerTurn} 张牌、精力回满、气势 +1。精力用完就等下一节课。</li>
      <li>气势攒到 3 点可以放<b>大招</b>，一局只能用一次。</li>
    </ul>
    ${ch ? `<h4>${ch.name}（${ch.nickname || ''}）</h4>
      <p>${ch.desc || ''}</p>
      <p><b>被动 · ${ch.passive ? ch.passive.name : '—'}</b>：${ch.passive ? ch.passive.text : ''}</p>
      <p><b>大招 · ${ch.ult ? ch.ult.name : '—'}</b>：${ch.ult ? ch.ult.text : ''}</p>
      <p>打法：${ch.strategy || ''}</p>` : ''}
    <h4>状态一览</h4>
    <ul>
      <li><b>臭气</b>：回合结束每层 -1 成绩</li>
      <li><b>骚气</b>：本回合第一张牌 +1 强度</li>
      <li><b>创可贴 / 面子</b>：抵消成绩打击</li>
      <li><b>干儿子</b>：回合结束每层 +1 成绩</li>
      <li><b>被点名</b>：下一张牌无效</li>
      <li><b>众目睽睽</b>：回合开始每层 -1 成绩</li>
      <li><b>心态崩</b>：回合开始弃牌 ／ <b>状态不错</b>：回合结束 +1 成绩</li>
    </ul>
    <h4>快捷键</h4>
    <ul><li>数字键 1-8：出对应的手牌</li><li>空格：结束回合</li><li>Esc：关闭弹窗</li></ul>`;
  $('info-overlay').hidden = false;
}

/* ------------------------------------------------------------------ */
/* 卡池图鉴：选人页内嵌 + 局内弹窗，共用一套渲染逻辑                    */
/* ------------------------------------------------------------------ */

/**
 * 把某个角色的卡池渲染到指定容器。
 * @param {object} opts
 * @param {object} opts.character 要展示的角色
 * @param {HTMLElement} opts.grid 卡面容器
 * @param {HTMLElement} opts.tabs 页签容器（可选）
 * @param {HTMLElement} opts.abilities 被动/大招说明容器（可选）
 * @param {HTMLElement} opts.title 标题元素（可选）
 */
function renderPool({ character, grid, tabs, abilities, title }) {
  if (!character || !character.decks || !grid) return;

  const showAbilities = (ch, isCommon) => {
    if (!abilities) return;
    if (isCommon) {
      abilities.innerHTML = '<div class="pool-line"><b>公共牌</b>：所有人都能抽到的基础牌，便宜、朴实、通用。</div>';
    } else {
      abilities.innerHTML = `
        <div class="pool-line"><b>被动 · ${ch.passive ? ch.passive.name : '—'}</b>：${ch.passive ? ch.passive.text : ''}</div>
        <div class="pool-line"><b>大招 · ${ch.ult ? ch.ult.name : '—'}</b>：${ch.ult ? ch.ult.text : ''}</div>
        <div class="pool-line"><b>打法</b>：${ch.strategy || '—'}</div>`;
    }
    if (title) title.textContent = isCommon ? '公共牌池' : `${ch.name} 的卡池`;
  };

  const parts = [{ key: 'self', label: `${character.name} · 专属 ${character.decks.length} 张`, cards: character.decks, ch: character }];
  (state.data.characters || []).forEach((c) => {
    if (c.id !== character.id) parts.push({ key: c.id, label: `${c.name} · 专属 ${c.decks.length} 张`, cards: c.decks, ch: c });
  });
  if (state.common.length) parts.push({ key: 'common', label: `公共牌 ${state.common.length} 张`, cards: state.common, common: true });

  const renderTab = (idx) => {
    const part = parts[idx];
    grid.textContent = '';
    [...part.cards]
      .sort((a, b) => (a.cost || 0) - (b.cost || 0) || (a.type === 'ult' ? 1 : 0) - (b.type === 'ult' ? 1 : 0))
      .forEach((card) => {
        const el = buildCardElement(card, null, null, { size: 'codex' });
        el.disabled = false;
        el.style.cursor = 'default';
        el.tabIndex = -1;
        grid.append(el);
      });
    if (tabs) [...tabs.children].forEach((b, i) => b.classList.toggle('is-on', i === idx));
    showAbilities(part.ch || character, Boolean(part.common));
  };

  if (tabs) {
    tabs.textContent = '';
    parts.forEach((part, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pool-tab';
      b.textContent = part.label;
      b.addEventListener('click', () => { state.sfx.play('click'); renderTab(i); });
      tabs.append(b);
    });
  }
  renderTab(0);
}

/** 选人页里内嵌的图鉴：4 个角色各一个页签 */
function buildCodex() {
  const grid = $('codex-grid');
  if (!grid || !(state.data.characters || []).length) return;
  renderPool({
    character: state.myPick || state.data.characters[0],
    grid,
    tabs: $('codex-tabs'),
    abilities: $('codex-abilities'),
    title: null
  });
}

/** 局内/选人页点「看卡池」时弹出的完整图鉴 */
function openPool(character) {
  if (!character || !character.decks) return;
  const box = $('pool-portrait');
  box.textContent = '';
  box.style.setProperty('--pick-color', character.themeColor || 'var(--c-accent)');
  box.append(artImg(avatarSrc(character), `${character.name} 头像`, placeholderPortrait(character.name, character.themeColor)));
  $('pool-nick').textContent = character.nickname ? `外号：${character.nickname}` : '';
  renderPool({
    character,
    grid: $('pool-grid'),
    tabs: $('pool-tabs'),
    abilities: $('pool-abilities'),
    title: $('pool-name')
  });
  $('pool-overlay').hidden = false;
  $('btn-pool-close').focus();
}

function closePool() {
  $('pool-overlay').hidden = true;
}

/* ------------------------------------------------------------------ */
/* 模式：新手教程 / 剧情模式 / 无尽模式                                 */
/* ------------------------------------------------------------------ */

/** 渲染顶部三张模式卡片 */
function buildModePicker() {
  const grid = $('modes-grid');
  if (!grid) return;
  const list = (state.modes && state.modes.modes) || [
    { id: 'tutorial', name: '新手教程', tagline: '三分钟学会出牌', desc: '一步步教你精力、气势、大招和状态结算。', order: 1 },
    { id: 'story', name: '剧情模式', tagline: '三段课间故事', desc: '边打边学，通关解锁下一关。', order: 2 },
    { id: 'endless', name: '无尽模式', tagline: '自己挑人打', desc: '随便挑两个人对打，连胜越多越难。', order: 3 }
  ];
  const icons = { tutorial: '🎓', story: '📖', endless: '♾️' };
  const streak = loadStreak();

  grid.textContent = '';
  [...list].sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((mode) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `mode-card${state.mode === mode.id ? ' is-on' : ''}`;
    btn.dataset.mode = mode.id;

    const icon = document.createElement('div');
    icon.className = 'mode-card__icon';
    icon.textContent = icons[mode.id] || '🎮';
    const name = document.createElement('div');
    name.className = 'mode-card__name';
    name.textContent = mode.name || mode.id;
    const tag = document.createElement('div');
    tag.className = 'mode-card__tag';
    tag.textContent = mode.tagline || '';
    const desc = document.createElement('div');
    desc.className = 'mode-card__desc';
    desc.textContent = mode.desc || '';
    btn.append(icon, name, tag, desc);

    if (mode.id === 'endless' && streak.best > 0) {
      const badge = document.createElement('span');
      badge.className = 'mode-card__badge';
      badge.textContent = `最高连胜 ${streak.best}`;
      btn.append(badge);
    }
    if (mode.id === 'story' && state.storyRunner) {
      const cleared = state.storyRunner.progress.cleared.length;
      const total = state.storyRunner.stages.length;
      if (total) {
        const badge = document.createElement('span');
        badge.className = 'mode-card__badge';
        badge.textContent = cleared >= total ? '已全部通关 ★' : `进度 ${cleared}/${total}`;
        btn.append(badge);
      }
    }
    if (mode.id === 'tutorial' && localStorage.getItem('baban_tutorial_done') === '1') {
      const badge = document.createElement('span');
      badge.className = 'mode-card__badge';
      badge.textContent = '已学过';
      btn.append(badge);
    }

    btn.addEventListener('click', () => { state.sfx.play('click'); setMode(mode.id); });
    grid.append(btn);
  });
}

/** 切换模式：改选人区、显示/隐藏剧情关卡列表 */
function setMode(modeId) {
  state.mode = modeId;
  document.querySelectorAll('.mode-card').forEach((el) => {
    el.classList.toggle('is-on', el.dataset.mode === modeId);
  });

  const rivalTitle = $('rival-title');
  const rivalGrid = $('rival-grid');
  const diffOpt = $('difficulty-opt');
  const stages = $('stages');

  if (modeId === 'tutorial') {
    // 教程里对手是固定的（于浩天，招式简单好懂）
    rivalTitle.textContent = '② 这一局教你打于浩天（固定对手）';
    rivalGrid.hidden = true;
    diffOpt.hidden = true;
    rivalGrid.style.display = 'none';
    diffOpt.style.display = 'none';
    stages.hidden = true;
    const foe = state.data.characters.find((c) => c.id === 'yuhaitian') || state.data.characters[1];
    selectChar(foe, 'rival');
  } else {
    rivalTitle.textContent = '② 谁来跟你过招？';
    rivalGrid.hidden = false;
    diffOpt.hidden = false;
    rivalGrid.style.display = '';
    diffOpt.style.display = '';
    stages.hidden = modeId !== 'story';
    if (modeId === 'story') buildStageList();
    if (!state.rivalPick) selectChar(state.data.characters[1] || state.data.characters[0], 'rival');
  }
  refreshStartButton();
}

/** 剧情模式：三张关卡卡片 */
function buildStageList() {
  const grid = $('stages-grid');
  if (!grid || !state.storyRunner) return;
  const stages = state.storyRunner.stages;
  grid.textContent = '';
  stages.forEach((stage, i) => {
    const unlocked = state.storyRunner.isUnlocked(i);
    const cleared = state.storyRunner.isCleared(stage.id);
    const encIdx = state.storyRunner.encounterIndex(stage.id);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `stage-card${cleared ? ' is-on' : ''}${unlocked ? '' : ' is-locked'}`;
    card.disabled = !unlocked;
    card.innerHTML = `
      <div class="stage-card__no">第 ${stage.no || i + 1} 关 ${cleared ? '· 已通关 ★' : ''}</div>
      <div class="stage-card__title">${stage.title}</div>
      <div class="stage-card__sub">${stage.subtitle || ''}</div>
      <div class="stage-card__goal">教学点：${stage.goal || '—'}</div>
      <div class="stage-card__foot">
        <span class="stage-card__pips">${(stage.encounters || []).map((e, k) => `<i class="stage-card__pip${cleared ? ' is-done' : (k === encIdx && unlocked ? ' is-now' : '')}"></i>`).join('')}</span>
        <span>${(stage.encounters || []).length} 场 ${unlocked ? '' : '· 先过上一关'}</span>
      </div>`;
    card.addEventListener('click', () => {
      if (!unlocked) return;
      state.sfx.play('click');
      state.stageId = stage.id;
      state.storyRunner.startStage(stage.id);
    });
    grid.append(card);
  });
}

/* ---------------- 无尽模式连胜 ---------------- */

function loadStreak() {
  try {
    const raw = localStorage.getItem('baban_endless_streak');
    const data = raw ? JSON.parse(raw) : null;
    return { now: (data && data.now) || 0, best: (data && data.best) || 0 };
  } catch (err) {
    return { now: 0, best: 0 };
  }
}

function saveStreak(s) {
  try { localStorage.setItem('baban_endless_streak', JSON.stringify(s)); } catch (err) { /* 忽略 */ }
}

function updateStreak(won) {
  const s = loadStreak();
  s.now = won ? s.now + 1 : 0;
  s.best = Math.max(s.best, s.now);
  saveStreak(s);
  return s;
}

/** 无尽模式：连胜越多，电脑越凶（用引擎已有的旋钮，不动数值平衡） */
function endlessTuning(streakNow) {
  if (streakNow <= 1) return { difficulty: 'normal', bonusScore: 0, label: '第 1 场' };
  if (streakNow <= 3) return { difficulty: 'normal', bonusScore: 1, label: '开始来劲' };
  if (streakNow <= 5) return { difficulty: 'hard', bonusScore: 2, label: '对面认真了' };
  if (streakNow <= 8) return { difficulty: 'hard', bonusScore: 3, label: '卷王登场' };
  return { difficulty: 'hard', bonusScore: 4, label: '全班围观' };
}

/* ------------------------------------------------------------------ */
/* 剧情独白 & 关卡结算                                                  */
/* ------------------------------------------------------------------ */

/**
 * 显示一段独白。
 * @param {object} script { speaker, lines, stage }
 * @param {string} kind   intro | outro | win | lose | stageEnd
 */
function showNarration(script, kind = 'intro') {
  if (!script || !script.lines || !script.lines.length) return;
  const overlay = $('story-overlay');
  $('story-speaker').textContent = script.speaker || '旁白';
  const box = $('story-lines');
  box.textContent = '';
  script.lines.forEach((line, i) => {
    const p = document.createElement('p');
    p.textContent = line;
    if (i === 0) p.className = 'is-focus';
    box.append(p);
  });

  if (script.reward) {
    const r = document.createElement('div');
    r.className = 'story-reward';
    r.textContent = `奖励：${script.reward}`;
    box.append(r);
  }

  const actions = $('story-actions');
  actions.textContent = '';
  const mkBtn = (label, primary, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${primary ? 'btn--primary' : 'btn--ghost'}`;
    b.textContent = label;
    b.addEventListener('click', () => { state.sfx.play('click'); overlay.hidden = true; fn && fn(); });
    actions.append(b);
    return b;
  };

  const stage = script.stage;

  if (kind === 'intro') {
    mkBtn('换个人再开打', false, () => {
      $('screen-battle').classList.remove('screen--active');
      $('screen-start').classList.add('screen--active');
      setMode('story');
    });
    mkBtn('上场！', true, () => beginStoryBattle());
  } else if (kind === 'outro') {
    if (script.isFinal) mkBtn('回到选关', true, () => { backToStart(); setMode('story'); });
    else mkBtn('打下一场', true, () => beginStoryBattle());
    if (!script.isFinal) mkBtn('先歇会儿', false, () => { backToStart(); setMode('story'); });
  } else if (kind === 'lose') {
    mkBtn('再试一次', true, () => beginStoryBattle());
    mkBtn('回选关', false, () => { backToStart(); setMode('story'); });
  } else {
    mkBtn('好', true, null);
  }
  overlay.hidden = false;
  actions.querySelector('.btn--primary')?.focus();
}

/** 剧情：这一关打完了（还有下一场 / 整关结束） */
function onStageEnd(stage, info) {
  if (info && typeof info.nextEncounter === 'number') {
    const enc = stage.encounters[info.nextEncounter];
    showNarration({
      speaker: enc && enc.taunt ? '对手' : '旁白',
      lines: [
        (stage.encounters[info.nextEncounter - 1] || {}).winLine || '这一场你拿下了！',
        enc && enc.taunt ? `下一场：${enc.title}。${enc.taunt}` : `下一场：${enc ? enc.title : '继续上课'}`
      ],
      stage
    }, 'intro');
    state.pendingEncounter = info.nextEncounter;
    return;
  }
  // 整关通关
  const isFinal = state.storyRunner.stages.every((s) => state.storyRunner.isCleared(s.id));
  showNarration({
    speaker: stage.outro ? stage.outro.speaker : '旁白',
    lines: (stage.outro && stage.outro.lines) || ['这一关过了！'],
    reward: stage.reward ? stage.reward.text : null,
    stage,
    isFinal
  }, 'outro');
  buildStageList();
  buildModePicker();
}

function backToStart() {
  $('story-overlay').hidden = true;
  $('screen-battle').classList.remove('screen--active');
  $('screen-start').classList.add('screen--active');
  if (state.tutorialHint) state.tutorialHint.hide();
}

/* ------------------------------------------------------------------ */
/* 开打                                                                */
/* ------------------------------------------------------------------ */

/**
 * 开一局。
 * @param {object} opts
 *   opts.myChar / opts.foeChar  指定双方（默认用选人页的选择）
 *   opts.setup                  引擎开局覆盖（教程/剧情用）
 *   opts.aiHandicap             电脑放水
 *   opts.difficulty             覆盖难度
 *   opts.tutorial               true 时挂上教程控制器
 */
function startBattle(opts = {}) {
  const myChar = opts.myChar || state.myPick;
  const foeChar = opts.foeChar || state.rivalPick;
  if (window.__probe) window.__probe(`[startBattle] 我=${myChar ? myChar.id : 'null'} 敌=${foeChar ? foeChar.id : 'null'}`);
  if (!myChar || !foeChar) {
    if (window.__probe) window.__probe('[startBattle] 缺角色，直接返回了');
    return;
  }
  state.myPick = myChar;
  state.rivalPick = foeChar;
  state.sfx.init();
  if ($('sound-toggle').checked) state.sfx.setEnabled(true);

  $('screen-start').classList.remove('screen--active');
  $('screen-battle').classList.add('screen--active');
  document.documentElement.style.setProperty('--c-char', myChar.themeColor || 'var(--green)');
  document.documentElement.style.setProperty('--c-rival', foeChar.themeColor || 'var(--red)');

  // 头像与名字
  setSide('my', myChar);
  setSide('foe', foeChar);

  if (state.tutorialHint) state.tutorialHint.hide();
  state.view.resetStats();
  state.view.setFast($('fast-toggle').checked);
  document.body.classList.toggle('fast-mode', $('fast-toggle').checked);

  const ai = new BabanAI({ difficulty: opts.difficulty || state.difficulty });

  const game = new BabanGame({
    data: state.data,
    commonCards: state.common,
    controllers: state.autoPilot ? { p0: 'ai', p1: 'ai' } : { p0: 'human', p1: 'ai' },
    aiChooser: ai,
    picks: [state.data.characters.indexOf(myChar), state.data.characters.indexOf(foeChar)],
    setup: opts.setup || null,
    openingHand: state.tutorial ? state.tutorial.step && state.tutorial.step.setup : null,
    onActionWindow: opts.onActionWindow || null,
    hook: (ev) => {
      // 记一份"演出流水"，卡住时能看出卡在哪一条事件上
      state.viewTrace = state.viewTrace || [];
      state.viewTrace.push(`${((Date.now() - (state.battleStart || Date.now())) / 1000).toFixed(1)}s ${ev.type}${ev.name ? ':' + ev.name : ''}`);
      if (state.viewTrace.length > 24) state.viewTrace.shift();
      if (state.tutorial) state.tutorial.onEvent(ev);
      if (ev.type === 'gameOver') onBattleOver(ev, game);
      return state.view.handle(ev, game);
    }
  });
  state.game = game;
  state.viewTrace = [`0.0s startBattle（mode=${state.mode} controllers=${JSON.stringify(game.controllers)}）`];
  state.battleStart = Date.now();
  if (opts.aiHandicap) game.aiHandicap = opts.aiHandicap;

  // 人类把牌打完直接结课后自动收尾，避免发呆（观战模式不需要）
  watchdogTick = 0;
  if (!state.autoPilot) {
    (async () => {
      while (!game.over) {
        await sleep(300);
        watchdogTick += 1;
        if (game.waiting === game.humanIndex && game._actionResolve) {
          const actor = game.players[game.humanIndex];
          const hasPlayable = actor.hand.some((c) => game.canPlay(actor, c).ok);
          if (!hasPlayable) {
            await sleep(700);
            if (game.waiting === game.humanIndex) endMyTurn();
          }
        }
      }
    })();
  }

  game.start().catch((err) => {
    console.error('[八班风云] 对局异常', err);
    state.view.addLog(`<span class="log-sys">出错了：${err.message}</span>`);
  });
  return game;
}

/* ------------------------------------------------------------------ */
/* 教程 / 剧情 的开局入口                                              */
/* ------------------------------------------------------------------ */

function startTutorial(opts = {}) {
  state.tutorial = null;
  state.mode = 'tutorial';
  const cfg = (state.modes && state.modes.tutorial) || {};
  const byId = (id, fb) => state.data.characters.find((c) => c.id === id) || fb;
  const me = byId(cfg.player, state.data.characters[0]);
  const foe = byId(cfg.rival, state.data.characters[1] || state.data.characters[0]);
  const steps = ((state.modes && state.modes.modes) || []).find((m) => m.id === 'tutorial');
  const stepList = (steps && steps.steps) || [];
  const first = stepList[0] || { setup: {} };

  const setup = {
    0: {
      score: (first.setup && first.setup.myScore) ?? 10,
      momentum: (first.setup && first.setup.myMomentum) ?? 0,
      hand: (first.setup && first.setup.myHand) || null,
      deckOrder: cfg.deckOrder || null,
      passive: cfg.passive === false ? false : undefined
    },
    1: {
      score: (first.setup && first.setup.foeScore) ?? 10,
      deckOrder: cfg.foeDeckOrder || null,
      passive: cfg.passive === false ? false : undefined
    },
    aiHandicap: cfg.aiHandicap || { maxCardsPerTurn: 1, thinkMs: 620 }
  };

  const game = startBattle({
    myChar: me,
    foeChar: foe,
    difficulty: 'easy',
    setup
  });
  if (!game) return;

  const runner = new TutorialRunner({
    game,
    view: state.view,
    hint: state.tutorialHint,
    steps: stepList,
    onStep: (step) => {
      // 让对手的手牌数一眼可见（t11 要用）
      updateFoeHandBadge(game);
    },
    onDone: (info) => {
      state.tutorial = null;
      showTutorialDone(info);
    }
  });
  state.tutorial = runner;
  if (opts.auto) {
    // ?tutauto=1：让页面自己把教程走完（演示 / 自测用）
    state.tutorialAuto = new TutorialAutoDriver({
      runner,
      game,
      view: state.view,
      onDone: () => { /* 报告留在屏幕上，方便截图核对 */ }
    });
    state.tutorialAuto.start();
  }
  if (opts.startAt) {
    const target = Math.min(opts.startAt - 1, stepList.length - 1);
    state.tutorialDebug = { askedStartAt: opts.startAt, stepListLength: stepList.length, targetIndex: target };
    setTimeout(() => runner.enterStep(target), 900);
  } else {
    setTimeout(() => runner.begin(), 700);
  }
}

/** 对手手牌数角标：让"数对手还剩几张"这件事看得见 */
function updateFoeHandBadge(game) {
  const badge = $('foe-hand-count');
  if (!badge) return;
  const foe = game.players[1 - game.humanIndex];
  badge.textContent = `手牌 ${foe.hand.length}`;
  badge.hidden = false;
}

/** 教程通关/跳过后的小结 */
function showTutorialDone(info) {
  const overlay = $('story-overlay');
  const skipped = info && info.skipped;
  $('story-speaker').textContent = skipped ? '跳过教程' : '教程完成';
  const box = $('story-lines');
  box.textContent = '';
  const lines = skipped
    ? ['没问题，规则随时能在「规则」按钮里翻。', '去剧情模式或无尽模式试试手吧。']
    : ['你已经学会了出牌、精力、气势大招和状态结算。', '接下来去剧情模式打三关，对手会一点点变强。'];
  lines.forEach((t, i) => {
    const p = document.createElement('p');
    p.textContent = t;
    if (i === 0) p.className = 'is-focus';
    box.append(p);
  });
  const actions = $('story-actions');
  actions.textContent = '';
  const mk = (label, primary, mode) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${primary ? 'btn--primary' : 'btn--ghost'}`;
    b.textContent = label;
    b.addEventListener('click', () => {
      state.sfx.play('click');
      overlay.hidden = true;
      backToStart();
      if (mode) setMode(mode);
    });
    actions.append(b);
  };
  mk('去剧情模式', true, 'story');
  mk('回主菜单', false, null);
  overlay.hidden = false;
  buildModePicker();
}

/** 剧情模式：按当前关卡/场次开一局 */
function beginStoryBattle() {
  if (!state.storyRunner || !state.stageId) return;
  const me = state.myPick || state.data.characters[0];
  const built = state.storyRunner.buildEncounter(state.stageId, me, me);
  if (!built) return;
  const enc = built.encounter;
  // 如果这一场给了简化牌堆，就先按它建牌堆；起手照常发（没有手牌覆盖）
  const setup = { ...built.setup };
  if (setup[1] && setup[1].hand === null) delete setup[1].hand;

  state.mode = 'story';
  state.pendingEncounter = built.index;
  const enemy = built.enemy;
  selectChar(enemy, 'rival');
  if (enc.taunt) state.view && state.view.addLog && null; // 占位：开场台词在独白里已给

  startBattle({
    myChar: me,
    foeChar: enemy,
    setup,
    difficulty: 'normal'
  });
}

/** 一局结束：按模式分发（教程 / 剧情 / 无尽） */
function onBattleOver(ev, game) {
  const humanWon = ev.winner === game.humanIndex;
  if (state.mode === 'tutorial') {
    if (state.tutorial) state.tutorial.onEvent(ev);   // 教程自己会推进
    return;
  }
  if (state.mode === 'story') {
    const stage = state.storyRunner.stageById(state.stageId);
    const enc = stage ? stage.encounters[state.storyRunner.encounterIndex(state.stageId)] : null;
    state.storyRunner.reportResult(state.stageId, humanWon);
    if (humanWon) {
      $('result-overlay').hidden = true;
      if (enc && enc.winLine) state.view.addLog(`<span class="log-sys">${enc.winLine}</span>`);
      onStageEnd(stage, {});
    } else {
      setTimeout(() => {
        $('result-overlay').hidden = true;
        showNarration({
          speaker: '旁白',
          lines: [(enc && enc.loseLine) || '这一场没拿下，再来一次吧。', '提示：输掉的那一场可以从头再打，不影响已通关的进度。'],
          stage
        }, 'lose');
      }, 1200);
    }
    return;
  }
  // 无尽模式：记录连胜
  const streak = updateStreak(humanWon);
  const stats = $('result-stats');
  if (stats) {
    const div = document.createElement('div');
    div.innerHTML = `连胜：<b>${streak.now}</b>（最高 ${streak.best}）`;
    stats.append(div);
  }
  buildModePicker();
}

function setSide(prefix, ch) {
  const portraitBox = $(`${prefix}-portrait`);
  portraitBox.textContent = '';
  portraitBox.append(artImg(portraitSrc(ch), `${ch.name} 立绘`, placeholderPortrait(ch.name, ch.themeColor)));
  $(`${prefix}-name`).textContent = ch.name;
  $(`${prefix}-nick`).textContent = ch.nickname ? `「${ch.nickname}」` : '';
  if (prefix === 'my') {
    const p = $('my-passive');
    p.textContent = `被动：${ch.passive ? ch.passive.name : '—'}`;
    p.title = ch.passive ? ch.passive.text : '';
  }
}

/* ------------------------------------------------------------------ */
/* 玩家操作                                                            */
/* ------------------------------------------------------------------ */

async function playCard(card) {
  const game = state.game;
  if (!game || game.over) return false;
  if (game.waiting !== game.humanIndex) {
    state.view.addLog('<span class="log-sys">还没轮到你呢。</span>');
    return false;
  }
  const me = game.players[game.humanIndex];
  const check = game.canPlay(me, card);
  if (!check.ok) {
    state.view.addLog(`<span class="log-sys">${check.why}</span>`);
    state.sfx.play('deny');
    return false;
  }
  const ok = await game.playCard(me, card.uid);
  state.view.render(game);
  return ok;
}

function endMyTurn() {
  const game = state.game;
  if (!game || game.over) return;
  if (game.waiting !== game.humanIndex) return;
  state.sfx.play('click');
  game.endTurn();
}

boot();
