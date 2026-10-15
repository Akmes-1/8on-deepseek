/**
 * 同步素材（由 tools/build.js 自动调用，也可以单独跑）：node tools/sync-assets.js
 * ------------------------------------------------------------------
 * 两件事：
 *   1. data/*.json  →  src/embedded-data.js    （离线/双击版读数据的快照）
 *   2. art/ 下的贴图 →  art/art-bundle.js       （路径 → data URI 的表）
 * 改完 JSON 或贴图，跑 build.js 会自动带上这一步，不用记。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---------- 1. 数据快照 ---------- */
const tokens = JSON.parse(read('data/ui-tokens.json'));
const characters = JSON.parse(read('data/characters.json'));
const common = JSON.parse(read('data/common.json'));
const story = JSON.parse(read('data/story.json'));
const modes = JSON.parse(read('data/modes.json'));

const out = `/**
 * 内联数据快照（自动生成，请勿手改）
 * 生成：node tools/build.js（内部会调用 tools/sync-assets.js）
 * 来源：data/{characters,common,ui-tokens,story,modes}.json
 * 作用：让 index.html 双击（file://）打开时也能读到数据，不需要联网请求 JSON。
 */
export const embeddedTokens = ${JSON.stringify(tokens)};
export const embeddedCharacters = ${JSON.stringify(characters)};
export const embeddedCommon = ${JSON.stringify(common)};
export const embeddedStory = ${JSON.stringify(story)};
export const embeddedModes = ${JSON.stringify(modes)};
`;
fs.writeFileSync(path.join(ROOT, 'src', 'embedded-data.js'), out, 'utf8');

const charCount = (characters.characters || []).length;
const cardCount = (characters.characters || []).reduce((n, c) => n + (c.decks || []).length + 1, 0) + (common.cards || []).length;
console.log(`· 数据快照：${charCount} 个角色 / ${cardCount} 张卡 / ${(story.stages || []).length} 个剧情关`);

/* ---------- 2. 贴图包 ---------- */
const ART_DIR = path.join(ROOT, 'art');
const files = [];
(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.svg')) files.push(p);
  });
})(ART_DIR);

const map = {};
files.forEach((abs) => {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  map[rel] = `data:image/svg+xml;base64,${fs.readFileSync(abs).toString('base64')}`;
});

const bundleFile = path.join(ART_DIR, 'art-bundle.js');
const existing = fs.existsSync(bundleFile) ? fs.readFileSync(bundleFile, 'utf8') : '';
const existingCount = (() => {
  try {
    const s = existing.indexOf('{');
    const e = existing.lastIndexOf('}');
    return s >= 0 && e > s ? Object.keys(JSON.parse(existing.slice(s, e + 1))).length : 0;
  } catch (err) { return 0; }
})();

if (!files.length && existingCount) {
  // art/ 下没有单独的 SVG 了（贴图只以"包"的形式存在）——保留现成的包，别把插画清空
  console.log(`· 贴图包：沿用现有的 ${existingCount} 张（art/ 下没有单独 SVG 文件）`);
} else if (!files.length) {
  console.log('· 贴图包：art/ 下没有 SVG，跳过（成品将不带插画）');
} else {
  fs.writeFileSync(bundleFile,
    `/* 自动生成（node tools/build.js）：${files.length} 张贴图的表，路径 → data URI */\nwindow.__ART_INLINE__ = ${JSON.stringify(map)};\n`,
    'utf8');
  console.log(`· 贴图包：${files.length} 张（${(fs.statSync(bundleFile).size / 1024).toFixed(0)} KB）`);
}
