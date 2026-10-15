/**
 * 《八班风云》公共工具：贴图加载 + 卡牌 DOM 构建
 * ------------------------------------------------------------------
 * 贴图来源有三种，按优先级：
 *   1. window.__ART_INLINE__ —— 打包版塞进来的贴图包（data URI 表）
 *   2. art/art-bundle.json   —— 用 <script> 挂上来的同一个表（开发版）
 *   3. art/ 目录下的单个文件 —— 最原始的开发方式
 * 同一份代码在三种情况下都能找到图，不会白屏。
 */

/* 贴图解析 */
function resolveArt(src) {
  if (!src) return src;
  const map = (typeof window !== 'undefined' && window.__ART_INLINE__) || null;
  return (map && map[src]) ? map[src] : src;
}

/** 占位头像（贴图缺失时的兜底图形） */
function placeholderPortrait(name, color) {
  const ch = String(name || '?').slice(0, 1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <rect width="200" height="200" fill="#22362F"/>
    <circle cx="100" cy="78" r="40" fill="${color || '#5BAAE0'}" opacity="0.85"/>
    <path d="M30 200c0-40 32-64 70-64s70 24 70 64z" fill="${color || '#5BAAE0'}" opacity="0.55"/>
    <text x="100" y="118" font-size="72" text-anchor="middle" fill="#FBF7EC" font-family="sans-serif">${ch}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 占位卡面（插画缺失时的兜底图形） */
function placeholderCardArt(card) {
  const ch = String((card && card.name) || '?').slice(0, 1);
  const color = { attack: '#E4574C', tactic: '#5BAAE0', support: '#3FA45B', ult: '#F7C948' }[(card && card.type)] || '#5BAAE0';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
    <rect width="120" height="120" rx="14" fill="#FFFDF6"/>
    <path d="M0 96h120v24H0z" fill="${color}" opacity="0.25"/>
    <circle cx="60" cy="54" r="34" fill="${color}" opacity="0.85"/>
    <text x="60" y="76" font-size="46" text-anchor="middle" fill="#FFFDF6" font-family="sans-serif">${ch}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const warnedArt = new Set();

/** 创建 <img>，加载失败自动换兜底图（只警告一次） */
function artImg(src, alt, fallback) {
  const img = document.createElement('img');
  img.src = resolveArt(src) || '';
  img.alt = alt || '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.addEventListener('error', () => {
    if (!warnedArt.has(src)) {
      warnedArt.add(src);
      console.warn('[八班风云] 贴图缺失，已用兜底图形：', src);
    }
    if (fallback && img.src !== fallback) img.src = fallback;
    else img.style.display = 'none';
  }, { once: true });
  return img;
}

/** 可换色图标：用 CSS mask 跟随 currentColor */
function iconImg(src, alt, opts) {
  const o = opts || {};
  const size = o.size || 18;
  const span = document.createElement('span');
  span.className = 'icon-mask';
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', alt || '');
  span.style.width = size + 'px';
  span.style.height = size + 'px';
  span.style.background = o.color || 'currentColor';
  span.style.webkitMaskImage = `url("${resolveArt(src)}")`;
  span.style.maskImage = `url("${resolveArt(src)}")`;
  if (!(window.CSS && CSS.supports && CSS.supports('mask-image', 'url(x)'))) {
    span.classList.add('icon-mask--fallback');
    span.append(artImg(src, alt));
  }
  return span;
}

function cardArtImg(card) {
  const src = (card && card.art) || (card ? `art/cards/${card.id}.svg` : '');
  return artImg(src, (card ? card.name : '') + ' 插画', placeholderCardArt(card));
}

function typeName(type) {
  return { attack: '打击', tactic: '套路', support: '助攻', ult: '大招' }[type] || '卡牌';
}

/**
 * 构建一张卡牌的 DOM（结构对应 styles/card-v2.css）：
 * 折角 / 代价 / 名字条 / 插画 / 效果文本 / 印记 / 稀有度印章
 */
function buildCardElement(card, game, player, opts) {
  const o = opts || {};
  const box = o.size === 'codex' ? 'codex' : (o.size === 'mini' ? 'mini' : 'hand');
  const el = document.createElement('button');
  el.type = 'button';
  el.className = [
    'card', 'cv2-card', 'cv2-card--' + box,
    'card--' + card.type,
    card.rarity && card.rarity !== 'common' ? 'card--' + card.rarity : '',
    card.rarity && card.rarity !== 'common' ? 'cv2-card--' + card.rarity : '',
    card.type === 'ult' ? 'cv2-card--ult' : ''
  ].filter(Boolean).join(' ');
  el.dataset.uid = card.uid || card.id;
  el.dataset.id = card.id;
  el.dataset.type = card.type;
  el.style.setProperty('--card-accent', 'var(--c-' + (card.type === 'attack' ? 'danger' : card.type === 'support' ? 'success' : card.type === 'ult' ? 'warning' : 'accent') + ')');
  el.setAttribute('aria-label', `${card.name}，精力 ${card.cost || 0}${card.momentum ? `，需要气势 ${card.momentum}` : ''}，${card.text}`);

  const fold = document.createElement('i');
  fold.className = 'cv2-fold';
  fold.setAttribute('aria-hidden', 'true');

  const cost = document.createElement('div');
  cost.className = 'cv2-cost';
  cost.dataset.cost = String(Math.max(0, Math.min(3, card.cost || 0)));
  cost.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i += 1) cost.append(document.createElement('i'));
  if (card.momentum > 0) {
    const flag = document.createElement('span');
    flag.className = 'card__momentum';
    flag.textContent = '气势' + card.momentum;
    flag.title = `需要 ${card.momentum} 点气势（每回合 +1，攒够才能放）`;
    cost.append(flag);
  }

  const band = document.createElement('div');
  band.className = 'card__band cv2-band';
  const iconName = card.type === 'attack' ? 'bolt' : card.type === 'tactic' ? 'chalk' : card.type === 'support' ? 'heart' : 'flame';
  band.append(iconImg(`art/icons/icon-${iconName}.svg`, '', { size: 15 }));
  const bandName = document.createElement('span');
  bandName.className = 'cv2-band__type';
  bandName.textContent = typeName(card.type);
  band.append(bandName);
  const costText = document.createElement('span');
  costText.className = 'card__cost';
  costText.textContent = (card.cost || 0) + ' 精力';
  band.append(costText);

  const name = document.createElement('div');
  name.className = 'card__name cv2-name';
  name.textContent = card.name;

  const art = document.createElement('div');
  art.className = 'card__art cv2-art';
  art.append(cardArtImg(card));

  const text = document.createElement('div');
  text.className = 'card__text cv2-text';
  text.textContent = card.text || '';

  const imprints = document.createElement('div');
  imprints.className = 'cv2-imprints';
  (card.tags || []).slice(0, 3).forEach((tag) => {
    const s = document.createElement('span');
    s.className = 'cv2-imprint';
    s.textContent = tag;
    imprints.append(s);
  });
  if (game && player) {
    const check = game.canPlay(player, card);
    if (!check.ok) {
      const s = document.createElement('span');
      s.className = 'cv2-imprint cv2-imprint--bad';
      s.textContent = check.why;
      imprints.append(s);
    }
  }

  const seal = document.createElement('div');
  seal.className = 'cv2-seal';
  seal.setAttribute('aria-hidden', 'true');
  seal.title = card.rarity === 'epic' ? '史诗' : card.rarity === 'rare' ? '稀有' : '普通';

  el.append(fold, cost, band, name, art, text, imprints, seal);
  return el;
}

/**
 * 头像地址解析：数据里可能写成 art/icons/xxx.svg，而实际文件叫 avatar-xxx.svg，
 * 这里哪个在贴图包里存在就用哪个，避免头像变成兜底图形。
 */
function avatarSrc(character) {
  if (!character) return '';
  const explicit = character.icon || ('art/icons/avatar-' + character.id + '.svg');
  if (resolveArt(explicit) !== explicit) return explicit;          // 包里正好有
  const alt = explicit.replace('/icons/', '/icons/avatar-');       // 有些老数据没写 avatar- 前缀
  if (resolveArt(alt) !== alt) return alt;
  return explicit;
}

/** 立绘地址解析 */
function portraitSrc(character) {
  if (!character) return '';
  const explicit = character.portrait || ('art/portraits/' + character.id + '.svg');
  return resolveArt(explicit) !== explicit ? explicit : explicit;
}

/** 角色头像 / 立绘（缺图自动落兜底图形） */
function portraitImg(character, size) {
  const avatar = size === 'avatar';
  const src = avatar ? avatarSrc(character) : portraitSrc(character);
  return artImg(src, ((character && character.name) || '') + (avatar ? ' 头像' : ' 立绘'),
    placeholderPortrait(character && character.name, character && character.themeColor));
}

/* ============================================================
   设计 token 注入：data/ui-tokens.json → CSS 变量
   （读不到就退回 styles/main.css 里的兜底值，界面不会崩）
   ============================================================ */
async function applyTokens(url = 'data/ui-tokens.json', fallbackTokens = null) {
  try {
    let t = fallbackTokens;
    if (!t) {
      if (!url) throw new Error('没有可用的 token');
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      t = await res.json();
    }
    const root = document.documentElement;
    const set = (k, v) => { if (v) root.style.setProperty(k, v); };

    const c = t.colors || {};
    const p = t.palette || {};
    const a = t.accent || {};

    set('--ink', c.ink || p.ink);
    set('--ink-soft', c.inkDim || p.inkSoft);
    set('--paper', c.panel || p.paper);
    set('--paper-line', c.panelLine || p.paperLine);
    set('--chalk', c.chalk || p.chalk);
    set('--blackboard', c.bgAlt || p.blackboard);
    set('--blackboard-dark', c.bg || p.blackboardDark);
    set('--chalk-dust', p.chalkDust);

    set('--red', c.danger || a.red);
    set('--orange', c.accentAlt || a.orange);
    set('--yellow', c.warning || a.yellow);
    set('--green', c.success || a.green);
    set('--green-deep', a.greenDeep);
    set('--sky', c.accent || a.sky);
    set('--blue', a.blue);
    set('--purple', a.purple);
    set('--pink', a.pink);

    set('--c-bg', c.bg || p.blackboardDark);
    set('--c-bg-alt', c.bgAlt || p.blackboard);
    set('--c-text', c.chalk || p.chalk);
    set('--c-text-dim', p.chalkDust);
    set('--c-accent', c.accent || a.sky);
    set('--c-danger', c.danger || a.red);
    set('--c-success', c.success || a.green);
    set('--c-warning', c.warning || a.yellow);

    const f = t.fonts || {};
    set('--font-display', f.display);
    set('--font-body', f.body);
    set('--font-mono', f.mono);
    Object.entries(t.fontSizes || {}).forEach(([k, v]) => set('--fs-' + k, v));
    Object.entries(t.radii || {}).forEach(([k, v]) => set('--r-' + k, v));
    Object.entries(t.spacing || {}).forEach(([k, v]) => set('--sp-' + k, v));
    const s = t.shadows || {};
    set('--shadow-card', s.card); set('--shadow-panel', s.panel); set('--shadow-glow', s.glow);
    const d = t.durations || {};
    set('--d-fast', d.fast); set('--d-normal', d.normal); set('--d-slow', d.slow); set('--d-banner', d.banner);
    const e = t.easings || {};
    set('--ease-out', e.out); set('--ease-pop', e.pop); set('--ease-soft', e.soft);
    const bf = t.battlefield || {};
    set('--hand-card-w', bf.handCardWidth); set('--hand-card-h', bf.handCardHeight);

    set('--char1', c.char1); set('--char2', c.char2); set('--char3', c.char3); set('--char4', c.char4);
    return t;
  } catch (err) {
    console.warn('[八班风云] 未读取到 ui-tokens.json，使用内置配色：', err.message);
    return null;
  }
}

/* ============================================================
   界面文案常量表（卡牌类型 / 状态）
   ============================================================ */
const CARD_TYPE_META = {
  attack: { name: '打击', icon: 'art/icons/icon-bolt.svg', color: 'var(--c-danger)' },
  tactic: { name: '套路', icon: 'art/icons/icon-chalk.svg', color: 'var(--c-accent)' },
  support: { name: '助攻', icon: 'art/icons/icon-heart.svg', color: 'var(--c-success)' },
  ult: { name: '大招', icon: 'art/icons/icon-flame.svg', color: 'var(--c-warning)' }
};

const STATUS_ICON = {
  stink: 'art/icons/icon-stink.svg',
  sao: 'art/icons/icon-tongue.svg',
  cringe: 'art/icons/icon-eye.svg',
  hype: 'art/icons/icon-megaphone.svg',
  bandage: 'art/icons/icon-bandage.svg',
  acting: 'art/icons/icon-star.svg',
  followers: 'art/icons/icon-crown.svg',
  shield: 'art/icons/icon-shield.svg',
  silence: 'art/icons/icon-bell.svg',
  spotlight: 'art/icons/icon-eye.svg',
  mark: 'art/icons/icon-notebook.svg',
  haste: 'art/icons/icon-bolt.svg',
  tilt: 'art/icons/icon-flame.svg',
  buff: 'art/icons/icon-heart.svg'
};

const STATUS_NAME = {
  stink: '臭气', sao: '骚气', cringe: '尴尬', hype: '声援', bandage: '创可贴',
  acting: '演技', followers: '干儿子', shield: '面子', silence: '被点名',
  spotlight: '众目睽睽', mark: '被记名', haste: '赶作业', tilt: '心态崩', buff: '状态不错'
};

const STATUS_DESC = {
  stink: '回合结束时，每层让该同学 -1 成绩',
  sao: '每层让本回合第一张牌 +1 强度',
  cringe: '每层让打出的打击卡 -1 强度',
  hype: '每层让对手受到的伤害 +1',
  bandage: '每层抵消 1 点成绩打击',
  acting: '演技层数，部分卡牌会读取它',
  followers: '回合结束时，每层 +1 成绩',
  shield: '每层抵消 1 点成绩打击，回合结束清零',
  silence: '下一张牌直接无效',
  spotlight: '回合开始时每层 -1 成绩',
  mark: '每层让对手打你的牌 +1 强度',
  haste: '每层让回合开始多抽 1 张',
  tilt: '每层让回合开始弃 1 张牌',
  buff: '回合结束时每层 +1 成绩'
};



/** 启动失败时的兜底提示（保证任何异常都看得见，不是白屏） */
function bootError(message, detail = '') {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0E1A16;color:#EAF2F8;'
    + 'font:15px/1.7 system-ui,"Microsoft YaHei",sans-serif;padding:8vh 6vw;overflow:auto';
  box.innerHTML = `<h2 style="color:#F7C948;margin:0 0 12px">八班风云没能启动</h2>
    <p style="margin:0 0 8px">${message}</p>
    ${detail ? `<pre style="white-space:pre-wrap;background:rgba(255,255,255,.06);padding:12px;border-radius:8px">${detail}</pre>` : ''}
    <p style="opacity:.75;margin-top:16px">如果是本地直接双击打开出的错，重新打包一次：<code>node tools/build.js</code><br>
    要改代码调试的话，用任意静态服务器打开 <code>src/index.html</code>。</p>`;
  document.body.append(box);
}

/** img 加载失败时替换成兜底图 */
function withFallback(img, fallbackSrc) {
  img.addEventListener('error', () => {
    if (img.dataset.fallbackApplied) return;
    img.dataset.fallbackApplied = '1';
    img.src = fallbackSrc;
  }, { once: true });
  return img;
}

let __speedScale = 1;
/** 设置整体节奏倍速（1 = 正常；?speed=0.2 就是五倍速，调试用） */
function setSpeedScale(v) {
  if (Number.isFinite(v) && v > 0) __speedScale = v;
}
/** 极小的等待工具（全项目动画节奏都走它） */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms * __speedScale)));
