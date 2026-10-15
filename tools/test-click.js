/**
 * 出牌交互自测：node tools/test-click.js
 * ------------------------------------------------------------------
 * 无头浏览器打开成品，按两个时间点截图，用来核对
 * "点一下选中 → 再点一下打出" 的交互：
 *
 *   1-选中.png   第一次点击之后：卡片应该抬起、顶上出现黄色「再点一下出招」提示条
 *   2-打出.png   第二次点击之后：手牌少一张、战场多一张
 *
 * 页面上会留一块文字记录（页面内的 ?tapdemo=1 探针写的），截图里能直接看到结论。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tools', '_shots');
fs.mkdirSync(OUT, { recursive: true });

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];
const browser = BROWSERS.find((p) => fs.existsSync(p));
if (!browser) { console.log('没找到浏览器，跳过自测。'); process.exit(0); }

const url = `${pathToFileURL(path.join(ROOT, 'index.html')).href}`
  + '?me=zhangkaiyao&foe=yuhaitian&tapdemo=1';

const shots = [
  { name: '1-选中.png', budget: 9000 },
  { name: '2-打出.png', budget: 14000 }
];

shots.forEach((shot) => {
  const file = path.join(OUT, shot.name);
  try {
    execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--window-size=1500,950',
      `--virtual-time-budget=${shot.budget}`,
      `--screenshot=${file}`, url
    ], { stdio: 'ignore', timeout: 120000 });
    console.log(`✔ ${shot.name}（${(fs.statSync(file).size / 1024).toFixed(0)} KB）`);
  } catch (err) {
    console.log(`✘ ${shot.name} 失败：${err.message}`);
  }
});
console.log('\n看这两张图：1 应有黄色提示条，2 应手牌少一张、战场多一张。');
