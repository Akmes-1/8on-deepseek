/**
 * 重新打包 index.html：node tools/build.js
 * ------------------------------------------------------------------
 * index.html 是"一个文件就能玩"的成品：源码、样式、数据、122 张贴图全部内联，
 * 双击就能开，不需要服务器、不需要联网。
 *
 * 每次运行会自动先做两件"同步"的事（所以不用单独记命令）：
 *   1. 把 data/*.json 打成 src/embedded-data.js（离线读数据的快照）
 *   2. 把 art/ 下的贴图打成 art/art-bundle.js（路径 → data URI 的表）
 *
 *   node tools/build.js            正常打包
 *   node tools/build.js --small   贴图不内联（体积小，但要带 art/ 目录）
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC_HTML = path.join(ROOT, 'src', 'index.html');
const OUT_FILE = path.join(ROOT, 'index.html');
const SMALL = process.argv.includes('--small');

/* ================= 0. 同步数据快照与贴图包 ================= */
if (fs.existsSync(path.join(ROOT, 'tools', 'sync-assets.js'))) {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'sync-assets.js')], { stdio: 'inherit' });
}

/* ================= 1. 拼接源码 ================= */
const ORDER = [
  'src/engine.js',
  'src/ai.js',
  'src/utils.js',
  'src/audio.js',
  'src/embedded-data.js',
  'src/tutorial.js',
  'src/tutorial-auto.js',
  'src/story.js',
  'src/view.js',
  'src/main.js'
];

// 自检：src/ 下每个本地 import 都必须在清单里，否则打包会漏代码
{
  const srcDir = path.join(ROOT, 'src');
  const missing = [];
  fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).forEach((f) => {
    const code = fs.readFileSync(path.join(srcDir, f), 'utf8');
    const re = /from\s+['"]\.\/([\w.-]+)['"]/g;
    let m;
    while ((m = re.exec(code))) {
      const rel = 'src/' + m[1];
      if (!ORDER.includes(rel) && !missing.includes(rel)) missing.push(rel);
    }
  });
  if (missing.length) {
    console.error('✘ 打包清单缺少这些模块（会被漏掉导致运行报错）：' + missing.join(', '));
    process.exit(1);
  }
  console.log(`· 依赖自检通过（${ORDER.length} 个模块）`);
}

function stripModuleSyntax(code, file) {
  let out = code;
  out = out.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  out = out.replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '');
  out = out.replace(/^(\s*)export\s+(async\s+function|function|const|let|var|class)\b/gm, '$1$2');
  out = out.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  out = out.replace(/^(\s*)export\s+default\s+/gm, '$1const __default__ = ');
  if (/^\s*(import|export)\s/m.test(out)) {
    const left = out.split('\n').filter((l) => /^\s*(import|export)\s/.test(l));
    throw new Error(`${file} 里还有没处理干净的模块语法：\n${left.join('\n')}`);
  }
  return out;
}

const parts = [];
const seen = new Set();
ORDER.forEach((rel) => {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  let stripped = stripModuleSyntax(code, rel);
  // 多个文件都写了 `const $ = ...`，拼一起会重复声明，保留第一份
  stripped = stripped.replace(/^const \$ = \(id\) => document\.getElementById\(id\);\s*$/m, (line) => {
    if (seen.has('$')) return '/* const $ 已在前面声明过 */';
    seen.add('$');
    return line;
  });
  parts.push(`\n/* ================= ${rel} ================= */\n${stripped}`);
});
const bundle = parts.join('\n');

/* ================= 2. 样式 ================= */
const CSS_FILES = ['styles/main.css', 'styles/cards.css', 'styles/card-v2.css', 'styles/animations.css', 'styles/screens.css', 'styles/modes.css'];
let css = CSS_FILES.map((rel) => `\n/* ===== ${rel} ===== */\n${fs.readFileSync(path.join(ROOT, rel), 'utf8')}`).join('\n');
const dataUri = (rel) => `data:image/svg+xml;base64,${fs.readFileSync(path.join(ROOT, rel)).toString('base64')}`;

/* ================= 3. 贴图包 ================= */
let artJson = '{}';
let artCount = 0;
const artBundlePath = path.join(ROOT, 'art', 'art-bundle.js');
if (fs.existsSync(artBundlePath)) {
  const raw = fs.readFileSync(artBundlePath, 'utf8');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    artJson = raw.slice(start, end + 1);
    artCount = Object.keys(JSON.parse(artJson)).length;
  }
}
if (!artCount) console.warn('  ！没读到贴图包（art/art-bundle.js），产物会缺插画');

/* ================= 4. 组 HTML ================= */
let html = fs.readFileSync(SRC_HTML, 'utf8');

const errorCatcher = `  <script>
  (function () {
    var show = function (msg) {
      if (window.__babanBootOk) { console.warn('[八班风云] ' + msg); return; }
      var box = document.getElementById('fatal-error') || document.createElement('pre');
      box.id = 'fatal-error';
      box.style.cssText = 'position:fixed;inset:auto 0 0 0;max-height:60vh;overflow:auto;z-index:99999;margin:0;'
        + 'padding:14px 18px;background:#3A1614;color:#FFD9D5;font:12px/1.6 Consolas,monospace;white-space:pre-wrap';
      box.textContent = '【八班风云】启动失败：\\n' + msg + '\\n\\n重新打包一次试试：node tools/build.js';
      if (!box.parentNode) document.body.appendChild(box);
    };
    window.addEventListener('error', function (e) {
      if (e.target && e.target.tagName === 'SCRIPT') { show('脚本加载失败：' + (e.target.src || 'inline')); return; }
      show((e.message || '未知错误') + '\\n@' + (e.filename || '') + ':' + (e.lineno || 0));
    });
    window.addEventListener('unhandledrejection', function (e) {
      show('未处理的 Promise 异常：' + ((e.reason && e.reason.message) || e.reason));
    });
    window.__babanBootOk = false;
    setInterval(function () {
      var box = document.getElementById('fatal-error');
      if (box && window.__babanBootOk) box.remove();
    }, 600);
  })();
  </script>`;

const linkCount = (html.match(/<link rel="stylesheet"/g) || []).length;
html = html.replace(/\s*<link rel="stylesheet" href="(?:\.\.\/)?styles\/[\w.-]+\.css"\s*\/>/g, '');
html = html.replace('</head>', `  <style>\n${css}\n  </style>\n</head>`);
html = html.replace(/\s*<script type="module" src="\.\/main\.js"><\/script>/, '');
html = html.replace('</body>', `${errorCatcher}\n  <script type="module">\n${bundle}\n  </script>\n</body>`);

if (!SMALL) {
  let imgs = 0;
  html = html.replace(/src="(?:\.\.\/)?(art\/[^"]+)"/g, (m, rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return m;
    imgs += 1;
    return `src="${dataUri(rel)}"`;
  });
  html = html.replace('</body>', `  <script>window.__ART_INLINE__ = ${artJson};</script>\n</body>`);
  console.log(`· 内联了 ${linkCount} 个样式表、${imgs} 张直接引用的贴图、${artCount} 张运行时贴图`);
} else {
  console.log(`· 内联了 ${linkCount} 个样式表（贴图仍读 art/ 目录）`);
}

html = html.replace('<head>', `<head>
  <!-- ============================================================
       这是打包产物，请勿手改：改 src/ 或 styles/ 后运行 node tools/build.js
       ============================================================ -->`);

fs.writeFileSync(OUT_FILE, html, 'utf8');
console.log(`已生成 index.html（${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(0)} KB${SMALL ? '，贴图外链' : '，完全自包含'}）`);
console.log('双击 index.html 就能玩。');
