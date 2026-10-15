/**
 * 贴图体检：node tools/check-art.js [--list]
 * ------------------------------------------------------------------
 * 逐张检查 art/art-bundle.js 里的贴图：
 *   1. 是不是合法的 svg base64 data URI、base64 能否完整解码
 *   2. 是不是完整合法的 SVG（根节点 / xmlns / viewBox / 标签闭合）
 *   3. 有没有真实图形数据（路径数据 / 点集 / 圆等，防"空图"）
 *   4. 代码 + 数据里引用到的每个贴图路径，是否都能在包里找到
 * 纯 Node 实现，无依赖。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const bundlePath = path.join(ROOT, 'art', 'art-bundle.js');
if (!fs.existsSync(bundlePath)) {
  console.error('✘ 找不到 art/art-bundle.js');
  process.exit(1);
}

const raw = fs.readFileSync(bundlePath, 'utf8');
const map = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
const keys = Object.keys(map);
console.log(`贴图包里有 ${keys.length} 张图\n`);

const problems = [];
let totalBytes = 0;
const stats = { cards: 0, icons: 0, portraits: 0, ui: 0 };

keys.forEach((key) => {
  const uri = map[key];
  const prefix = 'data:image/svg+xml;base64,';
  if (!uri.startsWith(prefix)) { problems.push(`${key}：不是 svg base64 data URI`); return; }

  const b64 = uri.slice(prefix.length);
  const svg = Buffer.from(b64, 'base64').toString('utf8');
  if (Buffer.from(svg, 'utf8').toString('base64') !== b64) {
    problems.push(`${key}：base64 不完整或不是有效 UTF-8`);
  }
  totalBytes += Buffer.byteLength(svg, 'utf8');

  const head = svg.slice(0, 400);
  if (!/^<svg[\s>]/.test(svg.trim())) problems.push(`${key}：不是以 <svg 开头`);
  if (!svg.trim().endsWith('</svg>')) problems.push(`${key}：缺 </svg>`);
  if (!/xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(head)) problems.push(`${key}：缺 xmlns`);
  if (!/viewBox=["'][^"']+["']/.test(head)) problems.push(`${key}：缺 viewBox`);

  // 真实图形数据：路径 d= 的字符数 + 圆/矩形数量 + 点集
  const pathData = (svg.match(/\sd=["']([^"']*)["']/g) || []).join('').replace(/\sd=["']/g, '').replace(/["']/g, '');
  const primitives = (svg.match(/<(circle|ellipse|rect|line|polyline|polygon|use|text)\b/g) || []).length;
  const points = (svg.match(/points=["']([^"']*)["']/g) || []).join('').length;
  const richness = pathData.length + primitives * 8 + points;
  if (richness < 20) problems.push(`${key}：图形数据太少（路径 ${pathData.length} 字符 / 图元 ${primitives} 个），可能是空图`);

  if (key.startsWith('art/cards/')) stats.cards += 1;
  else if (key.startsWith('art/icons/')) stats.icons += 1;
  else if (key.startsWith('art/portraits/')) stats.portraits += 1;
  else if (key.startsWith('art/ui/')) stats.ui += 1;

  if (process.argv.includes('--list')) {
    console.log(`${key.padEnd(44)} 路径 ${String(pathData.length).padStart(4)} 字符 · 图元 ${String(primitives).padStart(2)} 个 · ${(svg.length / 1024).toFixed(1)} KB`);
  }
});

/* 收集代码里引用到的路径（含模板拼接 runtime 引用的样式） */
const referenced = new Set();
const scan = [];
(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|html)$/.test(e.name)) scan.push(p);
  });
})(path.join(ROOT, 'src'));
fs.readdirSync(path.join(ROOT, 'styles')).forEach((f) => scan.push(path.join(ROOT, 'styles', f)));
scan.forEach((file) => {
  const code = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')     // 去掉块注释
    .replace(/^\s*\/\/.*$/gm, '');       // 去掉行注释
  let m;
  const re = /art\/[\w./-]+\.svg/g;
  while ((m = re.exec(code))) referenced.add(m[0]);
});

/* 数据里写死的贴图路径（角色头像/立绘、卡牌 art 字段） */
const dataRefs = new Set();
['data/characters.json', 'data/common.json'].forEach((rel) => {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const walkObj = (o) => {
    if (!o) return;
    if (typeof o === 'string') { if (/^art\/.*\.svg$/.test(o)) dataRefs.add(o); return; }
    if (Array.isArray(o)) { o.forEach(walkObj); return; }
    if (typeof o === 'object') Object.values(o).forEach(walkObj);
  };
  walkObj(json);
});

/* 角色头像/立绘：数据里写的路径，加上 avatar- 前缀的兜底写法，都要能对上 */
const chars = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters.json'), 'utf8'));
const charPaths = new Set();
(chars.characters || []).forEach((c) => {
  const icon = c.icon || ('art/icons/avatar-' + c.id + '.svg');
  charPaths.add(icon);
  charPaths.add(icon.replace('/icons/', '/icons/avatar-'));           // 老数据没写前缀的情况
  charPaths.add(c.portrait || ('art/portraits/' + c.id + '.svg'));
});

const allRefs = new Set([...referenced, ...dataRefs, ...charPaths]);
const missing = [...allRefs].filter((r) => !map[r]);
const unused = keys.filter((k) => !allRefs.has(k));

console.log('=== 统计 ===');
console.log(`  卡牌插画 ${stats.cards} · 图标 ${stats.icons} · 立绘/头像 ${stats.portraits} · 界面 ${stats.ui}`);
console.log(`  解码后合计 ${(totalBytes / 1024).toFixed(0)} KB（平均每张 ${(totalBytes / keys.length / 1024).toFixed(1)} KB）`);
console.log(`  代码/数据里引用 ${allRefs.size} 个路径`);

if (missing.length) {
  console.log(`\n✘ 被引用但包里没有（${missing.length} 个）：`);
  missing.forEach((m) => console.log('   ' + m));
} else {
  console.log('\n✔ 代码与数据引用的贴图路径全部命中');
}
if (unused.length) {
  console.log(`\n· ${unused.length} 张没被引用（正常，备用图标）：`);
  console.log('   ' + unused.slice(0, 10).join('、') + (unused.length > 10 ? ` 等 ${unused.length} 张` : ''));
}

if (problems.length) {
  console.log(`\n✘ 发现 ${problems.length} 个问题：`);
  problems.forEach((p) => console.log('   ' + p));
  process.exit(1);
}
console.log('\n✔ 全部贴图合法、完好，没有空图 / 坏图 / 缺失');
