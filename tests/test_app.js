/* 背单词小程序 · 自动化回归测试
 * 运行：node tests/test_app.js  （在 cet6-vocab/ 目录下）
 * 说明：手写最小 DOM 桩加载 app.js，模拟点击，覆盖四遍流程 / 回退 / 查询 / 导入 / 全量出题质量。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const DATA = fs.readFileSync(path.join(ROOT, 'data', 'words.js'), 'utf8');

let fail = 0, pass = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 最小 DOM 桩 ---------------- */
const TAG_RE = /<([a-zA-Z]+)((?:\s+[^<>]*?)?)\/?>/g;
function parseTags(html) {
  const out = [];
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(html)) !== null) {
    const attrs = {};
    const ar = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = ar.exec(m[2] || '')) !== null) attrs[a[1].toLowerCase()] = a[2];
    out.push({ tag: m[1].toLowerCase(), attrs: attrs });
  }
  return out;
}
function matchSel(el, sel) {
  sel = sel.trim();
  if (sel.indexOf('[data-act=') === 0) return el.attrs['data-act'] === sel.slice(10, -2).replace(/"/g, '');
  if (sel === '[data-act]') return 'data-act' in el.attrs;
  if (sel.charAt(0) === '.') return (el.attrs.class || '').split(/\s+/).indexOf(sel.slice(1)) >= 0;
  return el.tag === sel;
}
class El {
  constructor(id) {
    this.id = id || '';
    this.attrs = {};
    this._cls = new Set();
    this._lis = {};
    this._html = '';
    this._parsed = [];
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.files = null;
    this.style = {};
    const self = this;
    this.classList = {
      add: (c) => self._cls.add(c),
      remove: (c) => self._cls.delete(c),
      contains: (c) => self._cls.has(c),
      toggle: (c, f) => { const on = f === undefined ? !self._cls.has(c) : !!f; on ? self._cls.add(c) : self._cls.delete(c); return on; }
    };
  }
  get className() { return Array.from(this._cls).join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v);
    this._parsed = parseTags(this._html).map((d) => {
      const el = new El();
      el.tag = d.tag; el.attrs = d.attrs;
      el._cls = new Set(String(d.attrs.class || '').split(/\s+/).filter(Boolean));
      return el;
    });
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k === 'id' && this.id ? this.id : (this.attrs[k] || null); }
  addEventListener(ev, fn) { (this._lis[ev] = this._lis[ev] || []).push(fn); }
  fire(ev, extra) {
    const e = Object.assign({ currentTarget: this, target: this, preventDefault() {}, key: '', keyCode: 0 }, extra || {});
    (this._lis[ev] || []).forEach((fn) => fn(e));
  }
  querySelectorAll(sel) { return this._parsed.filter((el) => matchSel(el, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  focus() {} insertAdjacentHTML() {} appendChild() {} removeChild() {}
}

function bootApp(seed) {
  const reg = {};
  const store = Object.assign({}, seed || {});
  const getEl = (id) => (reg[id] = reg[id] || new El(id));
  const documentStub = {
    getElementById: getEl,
    querySelectorAll: (sel) => (sel.indexOf('#stage-card') >= 0
      ? getEl('stage-card').querySelectorAll('.option')
      : (sel === '.list-item' ? getEl('search-results').querySelectorAll('.list-item') : [])),
    createElement: () => new El(),
    body: new El('body')
  };
  const windowStub = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    speechSynthesis: { getVoices: () => [{ lang: 'en-US' }], speak() {}, cancel() {}, onvoiceschanged: null },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    scrollTo() {}, confirm: () => true,
    Audio: function () { return { play: () => ({ catch() {} }) }; },
    CET6_WORDS: []
  };
  const sandbox = {
    window: windowStub, document: documentStub, console,
    setTimeout, clearTimeout, Math, Date, JSON, Object, Array, String, Number, RegExp, Error,
    Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
    FileReader: function () {}, parseInt, parseFloat, isNaN
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(DATA, sandbox, { filename: 'words.js' });
  vm.runInContext(APP, sandbox, { filename: 'app.js' });
  return { getEl, store, words: windowStub.CET6_WORDS };
}

/* ---------------- 公共小工具 ---------------- */
const txt = (el) => String(el.textContent);
const optTextsOf = (el) => (el.innerHTML.match(/<span class="t">([^<]*)<\/span>/g) || []).map((x) => x.replace(/<[^>]+>/g, ''));
const wordOf = (el) => {
  const m = /<div class="word(?: small)?">([^<]+)<\/div>/.exec(el.innerHTML);
  return m ? m[1].trim() : null;
};
const cnKey = (x) => String(x).replace(/[\s，,；;、。.（）()【】\[\]：:／/·\-—!！?？'"]/g, '');
const tooClose = (a, b) => {
  const x = cnKey(a), y = cnKey(b);
  if (!x || !y) return true;
  if (x === y) return true;
  return x.length >= 3 && y.length >= 3 && (x.indexOf(y) >= 0 || y.indexOf(x) >= 0);
};
const fmtDate = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);

(async function main() {
  /* ============ 1. 词库 ============ */
  const A = bootApp();
  const WORDS = A.words;
  console.log('\n[1] 词库');
  ok(WORDS.length === 240, '词条总数 = ' + WORDS.length + '（期望 240）');
  const seen = {}, dup = [];
  WORDS.forEach((w) => { if (seen[w.w]) dup.push(w.w); seen[w.w] = 1; });
  ok(dup.length === 0, '无重复单词' + (dup.length ? '：' + dup.join(',') : ''));
  const missing = WORDS.filter((w) => !w.w || !w.c || !w.p || !w.e || !w.t || !w.img || !Array.isArray(w.sim));
  ok(missing.length === 0, '每条都有 w/p/c/e/t/img/sim' + (missing.length ? '：' + missing.map((x) => x.w) : ''));
  const badSim = [];
  WORDS.forEach((w) => w.sim.forEach((s) => { if (!/^[a-zA-Z-]+\|.+/.test(s)) badSim.push(w.w + '→' + s); }));
  ok(badSim.length === 0, '形近词格式统一（"单词|释义"）');

  /* ============ 2. 首页 / 滑动条 ============ */
  const $ = A.getEl;
  const stageOf = () => parseInt(/第 (\d) 遍/.exec(txt($('study-stage')))[1], 10);
  const options = () => $('stage-card').querySelectorAll('.option');
  const cardHTML = () => $('stage-card').innerHTML;
  const meaningOf = (w) => (WORDS.find((x) => x.w === w) || {}).c;
  const correctIdx = (w) => optTextsOf($('stage-card')).indexOf(meaningOf(w));

  console.log('\n[2] 首页 / 每日数量滑动条');
  ok(!$('view-home')._cls.has('hidden'), '默认打开首页');
  ok(txt($('kb-builtin')) === '240', '内置词条数 = ' + txt($('kb-builtin')));
  ok($('chart-box').innerHTML.indexOf('<svg') === 0, '学习曲线 SVG 已渲染');
  const range = $('target-range');
  range.value = '13'; range.fire('input');
  ok(txt($('target-val')) === '13 词' && txt($('st-today')) === '0/13', '滑到 13 → 显示 13 词 / 今日 0/13');
  range.value = '99'; range.fire('input');
  ok(txt($('target-val')) === '20 词', '超范围自动夹到 20');
  range.value = '5'; range.fire('input');
  ok(txt($('target-val')) === '10 词', '低于范围自动夹到 10');
  range.value = '12'; range.fire('input');

  /* ============ 3. 四遍流程 ============ */
  console.log('\n[3] 四遍流程 + 答错回退');
  $('btn-start').fire('click');
  ok(!$('view-study')._cls.has('hidden'), '进入学习页');
  ok(txt($('study-count')) === '1 / 12', '计数 = ' + txt($('study-count')) + '（跟随滑动条）');
  ok(stageOf() === 1, '从第 1 遍开始');
  const word = wordOf($('stage-card'));
  ok(!!word && word.length > 1, '第 1 遍显示单词：' + word);
  ok(/class="phonetic"/.test(cardHTML()) && /data-act="speak"/.test(cardHTML()), '第 1 遍有音标 + 发音按钮');
  ok(options().length === 4, '第 1 遍 4 个选项');
  ok(correctIdx(word) >= 0, '选项含正确释义（第 ' + (correctIdx(word) + 1) + ' 项）');

  const wrong1 = correctIdx(word) === 0 ? 1 : 0;
  options()[wrong1].fire('click');
  await sleep(120);
  const fb1 = txt($('feedback'));
  await sleep(1800);
  ok(/✗/.test(fb1), '第 1 遍点错有提示：' + fb1.slice(0, 14));
  ok(stageOf() === 1, '第 1 遍答错 → 原地重来');
  ok(options().length === 4, '重来后仍是 4 个选项');

  options()[correctIdx(word)].fire('click');
  await sleep(950);
  ok(stageOf() === 2, '第 1 遍答对 → 第 2 遍');
  ok(wordOf($('stage-card')) === word, '第 2 遍仍是同一个词：' + wordOf($('stage-card')));
  ok(options().length === 0, '第 2 遍没有选项（只看）');
  ok(/class="figure"/.test(cardHTML()) && /class="example"/.test(cardHTML()), '第 2 遍有配图 + 例句');
  const to3 = $('stage-card').querySelectorAll('[data-act="to3"]');
  ok(to3.length === 1, '第 2 遍有「进入第 3 遍」按钮');
  to3[0].fire('click');
  ok(stageOf() === 3, '进入第 3 遍');
  ok(cardHTML().indexOf('phonetic') < 0, '第 3 遍只给单词（无音标无发音）');
  ok(options().length === 4, '第 3 遍 4 个选项');

  const wrong3 = correctIdx(word) === 0 ? 1 : 0;
  options()[wrong3].fire('click');
  await sleep(120);
  const fb3 = txt($('feedback'));
  await sleep(1800);
  ok(/✗/.test(fb3), '第 3 遍点错有提示：' + fb3.slice(0, 14));
  ok(stageOf() === 2, '第 3 遍答错 → 退回第 2 遍重新看图文');
  $('stage-card').querySelectorAll('[data-act="to3"]')[0].fire('click');
  ok(stageOf() === 3, '从第 2 遍再点回第 3 遍');
  options()[correctIdx(word)].fire('click');
  await sleep(950);
  ok(stageOf() === 4, '第 3 遍答对 → 第 4 遍');
  ok(/spell-input/.test(cardHTML()), '第 4 遍是拼写输入框');
  ok(/首字母 /.test(cardHTML()), '第 4 遍给首字母 + 长度提示');

  $('spell-input').value = 'zzzzzz';
  $('spell-input').fire('keydown', { key: 'Enter', keyCode: 13 });
  await sleep(150);
  ok(/正确拼写/.test(txt($('feedback'))), '拼错时提示正确答案');
  await sleep(1950);
  ok(stageOf() === 3, '拼错 → 退回第 3 遍');
  options()[correctIdx(word)].fire('click');
  await sleep(950);
  ok(stageOf() === 4, '第 3 遍再答对 → 回到第 4 遍');
  $('spell-input').value = word.toUpperCase();
  $('spell-input').fire('keydown', { key: 'Enter', keyCode: 13 });
  await sleep(950);
  ok(txt($('study-count')) === '2 / 12', '拼对（大小写不敏感）→ 下一个词：' + txt($('study-count')));
  ok(stageOf() === 1, '新词从第 1 遍重新开始');

  /* ============ 4. 持久化 + 艾宾浩斯 ============ */
  console.log('\n[4] 持久化 + 艾宾浩斯调度');
  const saved = JSON.parse(A.store['cet6vocab.v1']);
  const p = saved.progress[word];
  ok(!!p, '进度已写入：' + JSON.stringify(p));
  ok(p.wrong >= 1, '答错次数已累计 = ' + p.wrong);
  ok(p.level === 0, '本次答错过 → 掌握度不被抬高 = ' + p.level);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(p.due), '已安排下次复习 = ' + p.due);
  ok(p.step === 0 && p.due === fmtDate(new Date(Date.now() + 864e5)), '答错过 → 回到第 1 档（明天复习）');
  ok(saved.daily.done.length === 1, '今日完成 1 个词');
  $('btn-quit').fire('click');
  ok(!$('view-home')._cls.has('hidden'), '退出回首页（进度已存）');
  ok(txt($('st-learned')) === '1', '累计学过 = ' + txt($('st-learned')));
  ok(txt($('st-due-all')) === '1 词', '已安排复习 = ' + txt($('st-due-all')));
  ok(/近 14 天共学 1 词/.test($('chart-box').innerHTML), '学习曲线记录了今天的 1 词（逐词记账）');

  /* ============ 5. 查询 ============ */
  console.log('\n[5] 单词查询');
  $('nav-search').fire('click');
  ok(!$('view-search')._cls.has('hidden'), '进入查询页');
  $('search-input').value = 'abandon'; $('search-input').fire('input');
  ok($('search-results').innerHTML.indexOf('abandon') >= 0, '英文模糊查询命中');
  $('search-input').value = 'ab'; $('search-input').fire('input');
  ok(($('search-results').innerHTML.match(/class="list-item"/g) || []).length >= 3, '前缀查询返回多条');
  $('search-input').value = '抛弃'; $('search-input').fire('input');
  ok($('search-results').innerHTML.indexOf('abandon') >= 0, '中文释义查询命中');
  $('search-input').value = 'qqqq'; $('search-input').fire('input');
  ok($('search-results').innerHTML.indexOf('没找到') >= 0, '无结果有提示');
  $('search-input').value = word; $('search-input').fire('input');
  $('search-results').querySelector('.list-item').fire('click');
  ok(/掌握度/.test($('search-results').innerHTML), '详情页显示学习记录');
  ok($('search-results').innerHTML.indexOf('错误次数</span><b>' + p.wrong) >= 0, '详情显示错误次数');

  /* ============ 6. 错词本 ============ */
  console.log('\n[6] 错词本');
  $('nav-wrong').fire('click');
  ok(/1 个错词/.test(txt($('wrong-hint'))), '错词本收录 1 个：' + txt($('wrong-hint')).slice(0, 16));
  ok($('wrong-list').innerHTML.indexOf('错 ' + p.wrong + ' 次') >= 0, '列表显示错误次数');

  /* ============ 7. 到期优先 ============ */
  console.log('\n[7] 到期复习优先');
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const B = bootApp({
    'cet6vocab.v1': JSON.stringify({
      settings: { target: 10, autoAudio: true, onlineAudio: false, shuffle: false },
      progress: {
        capacity: { level: 3, seen: 5, right: 4, wrong: 1, last: fmtDate(yest), step: 2, due: fmtDate(yest) },
        budget: { level: 4, seen: 9, right: 9, wrong: 0, last: fmtDate(yest), step: 4, due: '' }
      },
      daily: null, userWords: [], streak: { last: '', count: 0 }, history: {}
    })
  });
  const $$ = B.getEl;
  ok(txt($$('st-due')) === '1 词', '首页「今日待复习」= ' + txt($$('st-due')));
  $$('btn-start').fire('click');
  ok(wordOf($$('stage-card')) === 'capacity', '逾期词排到队首（实际：' + wordOf($$('stage-card')) + '）');
  $$('btn-quit').fire('click');
  ok(/1 个词到复习时间/.test(txt($$('due-hint'))), '复习提示文案正确');
  $$('btn-due').fire('click');
  ok(wordOf($$('stage-card')) === 'capacity', '「只复习到期词」直接进入该词');

  /* ============ 8. 导入词表 ============ */
  console.log('\n[8] 导入词表');
  $$('btn-quit').fire('click');
  $$('btn-import').fire('click');
  $$('import-text').value = 'rigorous | /ˈrɪɡərəs/ | a. 严格的 | He is rigorous. | 他很严格。 | 📏\n' +
    'notorious, /nəʊˈtɔːriəs/, a. 臭名昭著的\nabandon | /əˈbændən/ | v. 放弃';
  $$('modal-foot').querySelector('[data-act="ok"]').fire('click');
  ok(txt($$('kb-user')) === '2', '导入 2 个新词（重复的 abandon 被忽略）：' + txt($$('kb-user')));
  $$('nav-search').fire('click');
  $$('search-input').value = 'rigorous'; $$('search-input').fire('input');
  ok($$('search-results').innerHTML.indexOf('严格的') >= 0, '导入的词可被检索');
  ok(JSON.parse(B.store['cet6vocab.v1']).userWords.length === 2, '导入结果已持久化');

  /* ============ 9. 出题质量：全量 240 词 ============ */
  console.log('\n[9] 出题质量（覆盖全部 240 词）');
  const ALLW = bootApp().words.map((w) => w.w);
  const problems = [];
  let checked = 0, misordered = 0;
  for (let idx = 0; idx < ALLW.length; idx++) {
    const target = ALLW[idx];
    const progress = {};
    ALLW.forEach((k) => { progress[k] = { level: 5, seen: 9, right: 9, wrong: 0, last: '2020-01-01', step: 5, due: '' }; });
    delete progress[target];
    const app = bootApp({
      'cet6vocab.v1': JSON.stringify({
        settings: { target: 10, autoAudio: false, onlineAudio: false, shuffle: false },
        progress: progress, daily: null, userWords: [], streak: { last: '', count: 0 }, history: {}
      })
    });
    const g = app.getEl;
    g('btn-start').fire('click');
    const wd = wordOf(g('stage-card'));
    if (wd !== target) { misordered++; continue; }
    const texts = optTextsOf(g('stage-card'));
    checked++;
    if (texts.length !== 4) problems.push(target + ' 只有 ' + texts.length + ' 个选项');
    if (texts.indexOf(app.words[idx].c) < 0) problems.push(target + ' 选项里没有正确释义');
    for (let a = 0; a < texts.length; a++) {
      for (let b = a + 1; b < texts.length; b++) {
        if (tooClose(texts[a], texts[b])) problems.push(target + '："' + texts[a] + '" ~ "' + texts[b] + '"');
      }
    }
  }
  ok(checked === ALLW.length && misordered === 0, '全部 ' + ALLW.length + ' 个词都能正常出题（顺序异常 ' + misordered + '）');
  ok(problems.length === 0, '无「选项撞意思 / 缺正确项 / 选项不足」' + (problems.length ? '：' + problems.slice(0, 4).join(' | ') : ''));

  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
