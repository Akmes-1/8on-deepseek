/**
 * 真实点击测试：node tools/test-click.js [--mobile] [虚拟时间ms]
 * ------------------------------------------------------------------
 * 模拟真人点击：按坐标找出鼠标/手指真正落在哪个元素上，再派发完整事件序列
 * （pointerdown → mousedown → pointerup → mouseup → click），
 * 并把"每次点击打到了哪个元素"记进页面里的 #probe-dump，用 --dump-dom 抓出来读。
 * 这样能定位"点两下打不出去"到底是卡在哪一步。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const browser = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find((p) => fs.existsSync(p));
if (!browser) { console.log('没找到浏览器，跳过。'); process.exit(0); }

const mobile = process.argv.includes('--mobile');
const budget = Number(process.argv.find((a) => /^\d+$/.test(a)) || 20000);
const url = `${pathToFileURL(path.join(ROOT, 'index.html')).href}?me=zhangkaiyao&foe=yuhaitian&tapdemo=1`;

const args = [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--window-size=${mobile ? '390,844' : '1400,900'}`,
  `--virtual-time-budget=${budget}`, '--dump-dom', url
];
if (mobile) {
  args.splice(1, 0, '--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');
}

const out = execFileSync(browser, args, { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024, timeout: 240000 });

console.log(`=== ${mobile ? '手机视口 390x844' : '电脑视口 1400x900'} ===`);
const dump = out.match(/<div id="probe-dump"[^>]*>([\s\S]*?)<\/div>/);
if (dump) {
  dump[1].split('\n').filter((l) => l.trim()).forEach((l) => console.log(
    l.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  ));
} else {
  console.log('（页面没有输出自测日志）');
}
const err = out.match(/<pre id="fatal-error"[^>]*>([\s\S]*?)<\/pre>/);
if (err) { console.log('\n=== 页面错误 ==='); console.log(err[1].slice(0, 800)); }
