/* ============================================================
 * 六级词汇 · 四遍记忆法
 * 纯原生 JS，无需构建，双击 index.html 即可运行。
 *
 * 四遍流程：
 *   第 1 遍 听音辨义：单词 + 音标 + 发音 + 4 个中文释义选项
 *   第 2 遍 图文例句：配图 + 例句 + 释义（只看，点按钮进下一遍）
 *   第 3 遍 看词选义：只给单词 + 4 个选项
 *   第 4 遍 拼写：给音标 + 释义，输入英文拼写
 *   答错 → 自动退回上一遍（第 1 遍答错则原地重来）
 * ============================================================ */
(function () {
  'use strict';

  var STORE_KEY = 'cet6vocab.v1';
  var LEVEL_MASTER = 3;                              // 掌握度达到 3 视为已掌握
  var LETTERS = ['A', 'B', 'C', 'D'];
  var STAGE_NAMES = ['听音辨义', '图文例句', '看词选义', '拼写'];
  var INTERVALS = [1, 2, 4, 7, 15, 30];              // 艾宾浩斯复习间隔（天）

  /* ---------------------------------------------------------- 小工具 */
  function id(x) { return document.getElementById(x); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function yestStr() {
    var d = new Date();
    d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function ymd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function todayPlus(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    return ymd(d);
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* ---------------------------------------------------------- 状态 */
  var S = {
    settings: { target: 10, autoAudio: true, onlineAudio: false, shuffle: true },
    progress: {},          // 单词 -> {level, seen, right, wrong, last}
    daily: null,           // {date, target, keys, idx, done, correct, wrong}
    userWords: [],         // 导入的词条
    streak: { last: '', count: 0 },
    history: {},           // 'YYYY-MM-DD' -> {learned, correct, wrong}
    view: 'home',
    sess: null
  };
  var bank = [];           // 合并后的词库
  var byWord = {};         // 单词 -> 词条
  var builtinCount = 0;
  var ttsVoice = null;
  var toastTimer = null;

  /* ---------------------------------------------------------- 存取 */
  function load() {
    var raw = null;
    try { raw = window.localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }
    if (!raw) return;
    try {
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      if (d.settings) {
        for (var k in S.settings) { if (has(S.settings, k) && has(d.settings, k)) S.settings[k] = d.settings[k]; }
      }
      if (d.progress && typeof d.progress === 'object') S.progress = d.progress;
      if (d.daily && typeof d.daily === 'object') S.daily = d.daily;
      if (d.userWords && d.userWords.length) S.userWords = d.userWords;
      if (d.streak && typeof d.streak === 'object') S.streak = d.streak;
      if (d.history && typeof d.history === 'object') S.history = d.history;
    } catch (e) { /* 数据损坏就当没存过 */ }
  }
  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({
        settings: S.settings, progress: S.progress, daily: S.daily,
        userWords: S.userWords, streak: S.streak, history: S.history
      }));
    } catch (e) { /* 隐私模式等场景下静默失败 */ }
  }

  /* ---------------------------------------------------------- 词库 */
  function normalizeWord(o) {
    if (!o) return null;
    var w = String(o.w || o.word || '').trim().toLowerCase();
    if (!w) return null;
    var c = String(o.c || o.cn || o.meaning || '').trim();
    return {
      w: w,
      p: String(o.p || o.phonetic || '').trim(),
      c: c || '（暂无释义）',
      e: String(o.e || o.example || '').trim(),
      t: String(o.t || o.trans || o.translation || '').trim(),
      img: String(o.img || o.image || '📘').trim() || '📘',
      sim: (o.sim || o.similar || [])
    };
  }
  function buildBank() {
    var all = [], seen = {};
    function add(list) {
      if (!list || !list.length) return;
      for (var i = 0; i < list.length; i++) {
        var w = normalizeWord(list[i]);
        if (!w || seen[w.w]) continue;
        seen[w.w] = 1;
        all.push(w);
      }
    }
    add(window.CET6_WORDS || []);
    builtinCount = all.length;
    add(S.userWords || []);
    bank = all;
    byWord = {};
    for (var i = 0; i < bank.length; i++) byWord[bank[i].w] = bank[i];
  }

  /* ---------------------------------------------------------- 学习进度 */
  function prog(word) {
    if (!has(S.progress, word)) S.progress[word] = { level: 0, seen: 0, right: 0, wrong: 0, last: '', step: 0, due: '' };
    var p = S.progress[word];
    if (typeof p.step !== 'number') p.step = 0;
    if (typeof p.due !== 'string') p.due = '';
    return p;
  }
  function isDue(p) { return !!(p && p.due && p.due <= todayStr()); }
  // 到期 / 逾期词（day=0 表示今天及之前）
  function dueKeysFor(day) {
    var limit = todayPlus(day || 0);
    var list = [];
    for (var k in S.progress) {
      if (!has(S.progress, k)) continue;
      var p = S.progress[k];
      if (p && p.due && p.due <= limit && byWord[k]) list.push({ key: k, due: p.due, step: p.step || 0 });
    }
    list.sort(function (a, b) { return (a.due < b.due ? -1 : (a.due > b.due ? 1 : b.step - a.step)); });
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(list[i].key);
    return out;
  }
  function dueCountOn(day) {
    var n = 0;
    for (var k in S.progress) {
      if (!has(S.progress, k)) continue;
      var p = S.progress[k];
      if (p && p.due === day && byWord[k]) n++;
    }
    return n;
  }
  function scheduledCount() {
    var n = 0;
    for (var k in S.progress) {
      if (!has(S.progress, k)) continue;
      var p = S.progress[k];
      if (p && p.due && byWord[k]) n++;
    }
    return n;
  }
  // 完成一个词后安排下次复习（答错则从 1 天重新开始）
  function scheduleNext(w, hadWrong) {
    var p = prog(w.w);
    if (hadWrong) {
      p.step = 0;
      p.due = todayPlus(INTERVALS[0]);
    } else {
      p.step = clamp((p.step || 0) + 1, 0, INTERVALS.length - 1);
      p.due = todayPlus(INTERVALS[p.step]);
    }
  }
  function recordHistory(correct, wrong, learned) {
    var t = todayStr();
    if (!has(S.history, t)) S.history[t] = { learned: 0, correct: 0, wrong: 0 };
    var h = S.history[t];
    h.learned = (h.learned || 0) + (learned || 0);
    h.correct = (h.correct || 0) + (correct || 0);
    h.wrong = (h.wrong || 0) + (wrong || 0);
  }
  function recordWrong(w) {
    var p = prog(w.w);
    p.wrong = (p.wrong || 0) + 1;
    p.level = clamp((p.level || 0) - 1, 0, 5);
    p.seen = (p.seen || 0) + 1;
    p.last = todayStr();
    save();
  }
  function wrongKeys() {
    var list = [];
    for (var k in S.progress) {
      if (!has(S.progress, k)) continue;
      var p = S.progress[k];
      if (p && p.wrong > 0 && byWord[k]) list.push({ key: k, n: p.wrong });
    }
    list.sort(function (a, b) { return b.n - a.n; });
    var keys = [];
    for (var i = 0; i < list.length; i++) keys.push(list[i].key);
    return keys;
  }

  /* ---------------------------------------------------------- 队列生成 */
  function pickWords(n) {
    var scored = [];
    for (var i = 0; i < bank.length; i++) {
      var w = bank[i];
      var p = has(S.progress, w.w) ? S.progress[w.w] : null;
      var s;
      if (!p || !p.last) {
        s = 60;                                                   // 从没背过
      } else {
        s = Math.max(0, 40 - (p.level || 0) * 8);                  // 掌握度越低越优先
        if (p.wrong > 0) s += 60 + p.wrong * 6;                    // 错词加权
        if (isDue(p)) s += 200;                                    // 今日到期复习最优先
      }
      scored.push({ key: w.w, s: s, r: Math.random() });
    }
    scored.sort(function (a, b) { return (b.s - a.s) || (a.r - b.r); });
    var keys = [];
    var take = Math.min(n, scored.length);
    for (var j = 0; j < take; j++) keys.push(scored[j].key);
    if (S.settings.shuffle) shuffle(keys);
    return keys;
  }

  /* ---------------------------------------------------------- 视图切换 */
  function setView(v) {
    S.view = v;
    var views = ['home', 'study', 'result', 'search', 'wrong'];
    for (var i = 0; i < views.length; i++) {
      var el = id('view-' + views[i]);
      if (el) el.classList.toggle('hidden', views[i] !== v);
    }
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  function toast(msg) {
    var t = id('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------------------------------------------------------- 发音 */
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    var vs = [];
    try { vs = window.speechSynthesis.getVoices() || []; } catch (e) { return null; }
    for (var i = 0; i < vs.length; i++) { if (/en[-_]US/i.test(vs[i].lang)) return vs[i]; }
    for (var j = 0; j < vs.length; j++) { if (/^en/i.test(vs[j].lang)) return vs[j]; }
    return null;
  }
  function ttsSpeak(word) {
    if (!('speechSynthesis' in window)) { toast('当前浏览器不支持语音朗读'); return; }
    try {
      window.speechSynthesis.cancel();
      var u = new window.SpeechSynthesisUtterance(word);
      u.lang = 'en-US';
      u.rate = 0.92;
      if (!ttsVoice) ttsVoice = pickVoice();
      if (ttsVoice) u.voice = ttsVoice;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }
  function speak(word) {
    if (!word) return;
    if (S.settings.onlineAudio) {
      try {
        var a = new Audio('https://dict.youdao.com/dictvoice?type=2&audio=' + encodeURIComponent(word));
        var pr = a.play();
        if (pr && pr.catch) pr.catch(function () { ttsSpeak(word); });
        return;
      } catch (e) { /* 落到本地 TTS */ }
    }
    ttsSpeak(word);
  }

  /* ---------------------------------------------------------- 首页 */
  function renderHome() {
    var range = id('target-range');
    if (range) range.value = S.settings.target;
    var tval = id('target-val');
    if (tval) tval.textContent = S.settings.target + ' 词';
    var learned = 0, mastered = 0;
    for (var k in S.progress) {
      if (!has(S.progress, k)) continue;
      var p = S.progress[k];
      if ((p.seen || 0) > 0) learned++;
      if ((p.level || 0) >= LEVEL_MASTER) mastered++;
    }
    var d = S.daily;
    var done = (d && d.date === todayStr() && d.done) ? d.done.length : 0;
    var target = S.settings.target;
    id('st-today').textContent = done + '/' + target;
    id('st-learned').textContent = learned;
    id('st-mastered').textContent = mastered;
    id('st-streak').textContent = S.streak.count || 0;
    id('kb-builtin').textContent = builtinCount;
    id('kb-user').textContent = S.userWords.length;
    id('btn-start').textContent = (done > 0 && done < target) ? ('继续今日学习（' + done + '/' + target + '）') : '开始今日学习';
    id('opt-audio').checked = !!S.settings.autoAudio;
    id('opt-online').checked = !!S.settings.onlineAudio;
    id('opt-shuffle').checked = !!S.settings.shuffle;

    // 复习计划
    var dueToday = dueKeysFor(0).length;
    var dueTmr = dueCountOn(todayPlus(1));
    var dueAll = scheduledCount();
    id('st-due').textContent = dueToday + ' 词';
    id('st-due-tmr').textContent = dueTmr + ' 词';
    id('st-due-all').textContent = dueAll + ' 词';
    id('due-hint').textContent = dueToday > 0
      ? ('今天有 ' + dueToday + ' 个词到复习时间，直接点「开始今日学习」会自动优先安排它们。')
      : '今天没有到期的复习词。复习间隔按 1 → 2 → 4 → 7 → 15 → 30 天递增；答错会退回上一遍并从 1 天重新开始。';

    renderChart();
  }

  // 学习曲线：近 14 天「学习词数」柱状 +「正确率」折线（纯 SVG，无依赖）
  function renderChart() {
    var box = id('chart-box');
    if (!box) return;
    var W = 320, H = 108, padX = 4, baseY = H - 6, topY = 8;
    var vals = [], accs = [], sum = 0;
    for (var i = 13; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var h = S.history[ymd(d)] || null;
      var v = h ? (h.learned || 0) : 0;
      var tot = h ? ((h.correct || 0) + (h.wrong || 0)) : 0;
      vals.push(v);
      accs.push(tot ? Math.round((h.correct || 0) * 100 / tot) : -1);
      sum += v;
    }
    var maxV = 1;
    for (var j = 0; j < vals.length; j++) { if (vals[j] > maxV) maxV = vals[j]; }

    var slot = (W - padX * 2) / vals.length;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="近 14 天学习曲线">';
    svg += '<line x1="0" y1="' + baseY + '" x2="' + W + '" y2="' + baseY + '" stroke="#e5e7eb" stroke-width="1"/>';
    for (var k = 0; k < vals.length; k++) {
      var hgt = Math.round((baseY - topY - 4) * vals[k] / maxV);
      if (vals[k] > 0 && hgt < 2) hgt = 2;
      var x = padX + k * slot + slot * 0.2;
      var bw = slot * 0.6;
      svg += '<rect x="' + x.toFixed(1) + '" y="' + (baseY - hgt).toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + hgt + '" rx="2" fill="#bfdbfe"/>';
    }
    var pts = [];
    for (var m = 0; m < accs.length; m++) {
      if (accs[m] < 0) continue;
      var cx = padX + m * slot + slot / 2;
      var cy = topY + (100 - accs[m]) * ((baseY - topY - 4) / 100);
      pts.push(cx.toFixed(1) + ',' + cy.toFixed(1));
    }
    if (pts.length > 1) {
      svg += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#10b981" stroke-width="2" stroke-linejoin="round"/>';
    }
    for (var n = 0; n < accs.length; n++) {
      if (accs[n] < 0) continue;
      var cx2 = padX + n * slot + slot / 2;
      var cy2 = topY + (100 - accs[n]) * ((baseY - topY - 4) / 100);
      svg += '<circle cx="' + cx2.toFixed(1) + '" cy="' + cy2.toFixed(1) + '" r="2.3" fill="#10b981"/>';
    }
    svg += '</svg>';

    var last4 = vals[10] + vals[11] + vals[12] + vals[13];
    box.innerHTML = svg + '<div class="hint">近 14 天共学 ' + sum + ' 词，最近 4 天 ' + last4 +
      ' 词；折线是每天的一次正确率（没学习的日子不画点）。</div>';
  }

  /* ---------------------------------------------------------- 会话 */
  function curWord() {
    if (!S.sess) return null;
    return byWord[S.sess.keys[S.sess.idx]] || null;
  }
  function startSession(keys, mode) {
    keys = keys || [];
    if (!keys.length) { toast('没有可学习的单词'); return; }
    S.sess = {
      mode: mode || 'extra', keys: keys.slice(), idx: 0, stage: 1,
      locked: false, correct: 0, wrong: 0, recCorrect: 0, recWrong: 0, wrongSet: {}, opts: []
    };
    setView('study');
    renderStage();
  }
  function startDaily() {
    var d = S.daily;
    if (!d || d.date !== todayStr() || !d.keys || !d.keys.length) {
      d = S.daily = {
        date: todayStr(), target: S.settings.target,
        keys: pickWords(S.settings.target), idx: 0, done: [], correct: 0, wrong: 0
      };
      save();
    }
    if (d.idx >= d.keys.length) {
      toast('今天的任务已经完成，可以点「再来一组」继续练');
      setView('home'); renderHome();
      return;
    }
    S.sess = {
      mode: 'daily', keys: d.keys.slice(), idx: d.idx, stage: 1, locked: false,
      correct: d.correct || 0, wrong: d.wrong || 0,
      recCorrect: d.correct || 0, recWrong: d.wrong || 0, wrongSet: {}, opts: []
    };
    setView('study');
    renderStage();
  }
  function startExtra() { startSession(pickWords(S.settings.target), 'extra'); }

  function updateStreak() {
    var t = todayStr();
    if (S.streak.last === t) return;
    S.streak.count = (S.streak.last === yestStr()) ? ((S.streak.count || 0) + 1) : 1;
    S.streak.last = t;
  }

  function completeWord() {
    var ss = S.sess;
    if (!ss) return;
    var w = curWord();
    if (!w) { ss.idx++; renderStage(); return; }
    var p = prog(w.w);
    var hadWrong = !!ss.wrongSet[w.w];
    if (!hadWrong) p.level = clamp((p.level || 0) + 1, 0, 5);   // 本次答过错 → 不抬高掌握度
    p.right = (p.right || 0) + 1;
    p.seen = (p.seen || 0) + 1;
    p.last = todayStr();
    scheduleNext(w, hadWrong);                     // 安排艾宾浩斯复习时间
    // 学习曲线：完成一个词就记账，中途退出也不会丢统计
    recordHistory(ss.correct - (ss.recCorrect || 0), ss.wrong - (ss.recWrong || 0), 1);
    ss.recCorrect = ss.correct;
    ss.recWrong = ss.wrong;

    var next = ss.idx + 1;
    if (ss.mode === 'daily' && S.daily) {
      S.daily.done = S.daily.done || [];
      S.daily.done.push(w.w);
      S.daily.idx = next;
      S.daily.correct = ss.correct;
      S.daily.wrong = ss.wrong;
      S.daily.target = S.settings.target;
    }
    ss.idx = next;
    ss.stage = 1;
    ss.wrongSet = {};
    save();
    if (ss.idx >= ss.keys.length) { finishSession(); return; }
    renderStage();
  }

  function finishSession() {
    var ss = S.sess;
    if (!ss) return;
    var total = ss.correct + ss.wrong;
    var acc = total ? Math.round(ss.correct * 100 / total) : 100;
    var keys = [];
    for (var i = 0; i < ss.keys.length; i++) { if (ss.wrongSet[ss.keys[i]]) keys.push(ss.keys[i]); }
    updateStreak();          // 学习曲线已在 completeWord 里逐词记账
    save();
    var mode = ss.mode;
    S.sess = null;
    renderResult({
      title: mode === 'daily' ? '今日任务完成 🎉' : (mode === 'review' ? '错词复习完成' : '本组练习完成'),
      words: ss.keys.length,
      acc: acc,
      wrongCount: keys.length,
      wrongKeys: keys
    });
  }

  /* ---------------------------------------------------------- 出题 */
  function similarWords(w, used) {
    var res = [];
    for (var i = 0; i < bank.length; i++) {
      var x = bank[i];
      if (x.w === w.w) continue;
      if (has(used, x.c)) continue;
      var s = 0, n = Math.min(x.w.length, w.w.length), p = 0;
      while (p < n && x.w.charAt(p) === w.w.charAt(p)) p++;
      s += p * 3;
      if (x.w.charAt(0) === w.w.charAt(0)) s += 2;
      if (Math.abs(x.w.length - w.w.length) <= 1) s += 2;
      if (w.w.length >= 4 && x.w.indexOf(w.w.substring(0, 3)) >= 0) s += 1;
      if (s > 0) res.push({ w: x.w, c: x.c, s: s });
    }
    res.sort(function (a, b) { return b.s - a.s; });
    return res;
  }
  // 释义归一化：去掉标点和空白，用来判断两个选项是不是"同一个意思"
  function cnKey(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[\s，,；;、。.（）()【】\[\]：:／\/·\-—!！?？'"]/g, '');
  }
  // 两个释义是否太像（完全一样，或一个包含另一个）——太像就不该同时当选项
  function tooClose(a, b) {
    var x = cnKey(a), y = cnKey(b);
    if (!x || !y) return true;
    if (x === y) return true;
    if (x.length >= 3 && y.length >= 3) {
      if (x.indexOf(y) >= 0 || y.indexOf(x) >= 0) return true;
    }
    return false;
  }
  function buildOptions(w) {
    var opts = [{ text: w.c, ok: true }];
    var used = {};
    used[w.c] = 1;
    function tryAdd(cn) {
      if (!cn || opts.length >= 4) return false;
      for (var i = 0; i < opts.length; i++) { if (tooClose(cn, opts[i].text)) return false; }
      opts.push({ text: cn, ok: false });
      used[cn] = 1;
      return true;
    }
    var sims = w.sim || [];
    for (var i = 0; i < sims.length; i++) {
      var parts = String(sims[i]).split('|');
      var cn = parts.length > 1 ? String(parts[1]).trim() : '';
      if (!cn) {
        var ref = byWord[String(parts[0] || '').trim().toLowerCase()];
        cn = ref ? ref.c : '';
      }
      tryAdd(cn);
    }
    var cand = similarWords(w, used);
    for (var j = 0; j < cand.length && opts.length < 4; j++) { tryAdd(cand[j].c); }
    if (opts.length < 4) {                       // 兜底：任意其它词，同样避开近似释义
      var rest = [];
      for (var k = 0; k < bank.length; k++) { if (bank[k].w !== w.w) rest.push(bank[k]); }
      shuffle(rest);
      for (var m = 0; m < rest.length && opts.length < 4; m++) { tryAdd(rest[m].c); }
    }
    return shuffle(opts);
  }

  /* ---------------------------------------------------------- 学习页模板 */
  function tplOptions(w) {
    var opts = buildOptions(w);
    S.sess.opts = opts;
    var h = '<div class="options">';
    for (var i = 0; i < opts.length; i++) {
      h += '<button class="option" data-i="' + i + '"><span class="k">' + LETTERS[i] +
        '</span><span class="t">' + esc(opts[i].text) + '</span></button>';
    }
    h += '</div><div class="feedback" id="feedback"></div>';
    return h;
  }
  function tplStage1(w) {
    var h = '<div class="card">';
    h += '<div class="stage-label">第 1 遍 · 听音辨义</div>';
    h += '<div class="word">' + esc(w.w) + '</div>';
    h += '<div class="phonetic">' + esc(w.p) + '<button class="spk" data-act="speak" title="再听一遍">🔊</button></div>';
    h += tplOptions(w);
    h += '</div>';
    return h;
  }
  function tplStage2(w) {
    var img = w.img || '📘';
    var fig = /^(https?:\/\/|data:)/i.test(img)
      ? '<img src="' + esc(img) + '" alt="" />'
      : esc(img);
    var h = '<div class="card">';
    h += '<div class="stage-label">第 2 遍 · 图文例句</div>';
    h += '<div class="word small">' + esc(w.w) + '</div>';
    h += '<div class="phonetic">' + esc(w.p) + '<button class="spk" data-act="speak" title="再听一遍">🔊</button></div>';
    h += '<div class="figure">' + fig + '</div>';
    h += '<div class="meaning">' + esc(w.c) + '</div>';
    if (w.e) {
      h += '<div class="example"><span class="en">' + esc(w.e) + '</span>' +
        (w.t ? '<span class="tr">' + esc(w.t) + '</span>' : '') + '</div>';
    }
    h += '<button class="btn primary wide" data-act="to3" style="margin-top:16px">记住了，进入第 3 遍</button>';
    h += '</div>';
    return h;
  }
  function tplStage3(w) {
    var h = '<div class="card">';
    h += '<div class="stage-label">第 3 遍 · 看词选义</div>';
    h += '<div class="word">' + esc(w.w) + '</div>';
    h += tplOptions(w);
    h += '</div>';
    return h;
  }
  function tplStage4(w) {
    var blank = '';
    if (w.e) {
      try { blank = w.e.replace(new RegExp(w.w, 'ig'), '______'); } catch (e) { blank = ''; }
    }
    var h = '<div class="card">';
    h += '<div class="stage-label">第 4 遍 · 拼写</div>';
    h += '<div class="phonetic" style="font-size:19px">' + esc(w.p) + '<button class="spk" data-act="speak" title="再听一遍">🔊</button></div>';
    h += '<div class="meaning">' + esc(w.c) + '</div>';
    h += '<input id="spell-input" class="spell-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="在这里拼写单词" />';
    h += '<div class="spell-hint">首字母 ' + esc(w.w.charAt(0)) + ' · 共 ' + w.w.length + ' 个字母' +
      (blank ? '<br>' + esc(blank) : '') + '</div>';
    h += '<button class="btn primary wide" data-act="check" style="margin-top:14px">提交</button>';
    h += '<div class="feedback" id="feedback"></div>';
    h += '</div>';
    return h;
  }

  function updateStudyHead() {
    var ss = S.sess;
    if (!ss) return;
    var total = ss.keys.length || 1;
    id('study-count').textContent = Math.min(ss.idx + 1, total) + ' / ' + total;
    id('study-stage').textContent = '第 ' + ss.stage + ' 遍 · ' + STAGE_NAMES[ss.stage - 1];
    var frac = (ss.idx + (ss.stage - 1) / 4) / total;
    id('study-bar').style.width = Math.round(clamp(frac, 0, 1) * 100) + '%';
  }

  function renderStage() {
    var ss = S.sess;
    if (!ss) return;
    if (ss.idx >= ss.keys.length) { finishSession(); return; }
    var w = curWord();
    if (!w) { ss.idx++; renderStage(); return; }
    updateStudyHead();

    var html = '';
    if (ss.stage === 1) html = tplStage1(w);
    else if (ss.stage === 2) html = tplStage2(w);
    else if (ss.stage === 3) html = tplStage3(w);
    else html = tplStage4(w);
    id('stage-card').innerHTML = html;

    bindStage(ss.stage, w);
    if ((ss.stage === 1 || ss.stage === 2) && S.settings.autoAudio) speak(w.w);
  }

  function bindStage(stage, w) {
    var ss = S.sess;
    var card = id('stage-card');

    var optEls = card.querySelectorAll('.option');
    for (var i = 0; i < optEls.length; i++) {
      optEls[i].addEventListener('click', function (ev) {
        onChoose(stage, w, parseInt(ev.currentTarget.getAttribute('data-i'), 10));
      });
    }

    var actEls = card.querySelectorAll('[data-act]');
    for (var j = 0; j < actEls.length; j++) {
      actEls[j].addEventListener('click', function (ev) {
        var act = ev.currentTarget.getAttribute('data-act');
        if (act === 'speak') speak(w.w);
        else if (act === 'to3') { ss.stage = 3; renderStage(); }
        else if (act === 'check') checkSpell(w);
      });
    }

    if (stage === 4) {
      var inp = id('spell-input');
      if (inp) {
        try { inp.focus(); } catch (e) {}
        inp.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.keyCode === 13) { ev.preventDefault(); checkSpell(w); }
        });
      }
    }
  }

  /* ---------------------------------------------------------- 判题 */
  function setFeedback(cls, msg) {
    var fb = id('feedback');
    if (!fb) return;
    fb.className = 'feedback ' + cls;
    fb.textContent = msg;
  }
  function onChoose(stage, w, i) {
    var ss = S.sess;
    if (!ss || ss.locked) return;
    var opts = ss.opts || [];
    var chosen = opts[i];
    if (!chosen) return;

    if (chosen.ok) {
      ss.locked = true;
      ss.correct++;
      var els = document.querySelectorAll('#stage-card .option');
      for (var k = 0; k < els.length; k++) {
        if (k === i) els[k].classList.add('correct');
        else els[k].classList.add('dim');
      }
      setFeedback('ok', '✓ 正确');
      setTimeout(function () {
        ss.locked = false;
        ss.stage = stage + 1;
        renderStage();
      }, 620);
    } else {
      ss.wrong++;
      ss.wrongSet[w.w] = 1;
      recordWrong(w);
      var els2 = document.querySelectorAll('#stage-card .option');
      for (var m = 0; m < els2.length && m < opts.length; m++) {
        if (m === i) els2[m].classList.add('wrong');
        else if (opts[m].ok) els2[m].classList.add('correct');
        else els2[m].classList.add('dim');
      }
      handleWrong(stage, w);
    }
  }
  function handleWrong(stage, w) {
    var ss = S.sess;
    if (!ss) return;
    ss.locked = true;
    if (stage > 1) {
      setFeedback('bad', '✗ 答错了，退回上一遍重新记 · 正确释义：' + w.c);
      toast('答错了，已退回上一遍');
    } else {
      setFeedback('bad', '✗ 答错了，再听一遍 · 正确释义：' + w.c);
      toast('答错了，再记一次');
    }
    setTimeout(function () {
      ss.locked = false;
      ss.stage = Math.max(1, stage - 1);
      renderStage();
    }, 1600);
  }
  function checkSpell(w) {
    var ss = S.sess;
    if (!ss || ss.locked) return;
    var inp = id('spell-input');
    if (!inp) return;
    var val = String(inp.value || '').trim().toLowerCase();
    if (!val) { toast('先输入单词再提交'); return; }

    if (val === w.w.toLowerCase()) {
      ss.locked = true;
      ss.correct++;
      inp.classList.add('ok');
      setFeedback('ok', '✓ 拼写正确');
      setTimeout(function () { ss.locked = false; completeWord(); }, 780);
    } else {
      ss.wrong++;
      ss.wrongSet[w.w] = 1;
      recordWrong(w);
      ss.locked = true;
      inp.classList.add('bad');
      setFeedback('bad', '✗ 正确拼写：' + w.w + '（已退回第 3 遍）');
      toast('拼写错误，已退回上一遍');
      setTimeout(function () {
        ss.locked = false;
        ss.stage = 3;
        renderStage();
      }, 1900);
    }
  }

  /* ---------------------------------------------------------- 结算页 */
  function renderResult(info) {
    var h = '<div class="card">';
    h += '<div class="result-big">🎉</div>';
    h += '<div class="result-t">' + esc(info.title) + '</div>';
    h += '<div class="result-grid">';
    h += '<div><b>' + info.words + '</b><span>完成词数</span></div>';
    h += '<div><b>' + info.acc + '%</b><span>一次正确率</span></div>';
    h += '<div><b>' + info.wrongCount + '</b><span>需复习</span></div>';
    h += '</div>';
    h += '<div class="btn-row" style="flex-direction:column">';
    if (info.wrongCount) h += '<button class="btn primary" data-act="rw">复习本次错词（' + info.wrongCount + '）</button>';
    h += '<button class="btn" data-act="again">再来一组（' + S.settings.target + ' 词）</button>';
    h += '<button class="btn" data-act="home">返回首页</button>';
    h += '</div></div>';
    id('result-card').innerHTML = h;
    setView('result');

    var btns = id('result-card').querySelectorAll('[data-act]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        var act = ev.currentTarget.getAttribute('data-act');
        if (act === 'rw') startSession(info.wrongKeys, 'review');
        else if (act === 'again') startExtra();
        else { setView('home'); renderHome(); }
      });
    }
  }

  /* ---------------------------------------------------------- 查询 */
  function renderSearch() {
    var input = id('search-input');
    var box = id('search-results');
    var q = String(input && input.value || '').trim().toLowerCase();
    if (!q) {
      box.innerHTML = '<div class="hint" style="text-align:center;padding:24px 0">输入英文单词或中文释义开始查询</div>';
      return;
    }
    var res = [];
    for (var i = 0; i < bank.length; i++) {
      var w = bank[i];
      if (w.w.indexOf(q) >= 0 || (w.c && w.c.toLowerCase().indexOf(q) >= 0)) res.push(w);
    }
    res.sort(function (a, b) {
      function rank(x) { return x.w === q ? 0 : (x.w.indexOf(q) === 0 ? 1 : (x.w.indexOf(q) >= 0 ? 2 : 3)); }
      return (rank(a) - rank(b)) || (a.w.length - b.w.length);
    });
    res = res.slice(0, 30);
    if (!res.length) {
      box.innerHTML = '<div class="hint" style="text-align:center;padding:24px 0">没找到匹配的单词</div>';
      return;
    }
    var h = '';
    for (var j = 0; j < res.length; j++) {
      var x = res[j];
      var p = has(S.progress, x.w) ? S.progress[x.w] : null;
      h += '<div class="list-item" data-w="' + esc(x.w) + '">';
      h += '<div class="li-top"><span><span class="li-w">' + esc(x.w) + '</span>' +
        '<span class="li-p" style="margin-left:8px">' + esc(x.p) + '</span></span>';
      if (p && p.wrong > 0) h += '<span class="badge bad">错 ' + p.wrong + '</span>';
      else if (p && (p.level || 0) >= LEVEL_MASTER) h += '<span class="badge ok">已掌握</span>';
      h += '</div>';
      h += '<div class="li-c">' + esc(x.c) + '</div>';
      h += '</div>';
    }
    box.innerHTML = h;
    var items = box.querySelectorAll('.list-item');
    for (var k = 0; k < items.length; k++) {
      items[k].addEventListener('click', function (ev) {
        showWordDetail(ev.currentTarget.getAttribute('data-w'));
      });
    }
  }
  function showWordDetail(word) {
    var w = byWord[word];
    if (!w) return;
    var p = has(S.progress, word) ? S.progress[word] : { level: 0, seen: 0, right: 0, wrong: 0, last: '' };
    var h = '<div class="card">';
    h += '<div class="li-w" style="font-size:26px">' + esc(w.w) +
      '<button class="spk" data-act="speak" title="朗读">🔊</button></div>';
    h += '<div class="phonetic" style="text-align:left">' + esc(w.p) + '</div>';
    h += '<div class="meaning" style="text-align:left;margin-top:10px">' + esc(w.c) + '</div>';
    if (w.e) {
      h += '<div class="example"><span class="en">' + esc(w.e) + '</span>' +
        (w.t ? '<span class="tr">' + esc(w.t) + '</span>' : '') + '</div>';
    }
    if (w.sim && w.sim.length) {
      h += '<div class="row-title" style="margin-top:16px">形近词</div><div class="sim-row">';
      for (var i = 0; i < w.sim.length; i++) {
        var parts = String(w.sim[i]).split('|');
        h += '<span class="sim-chip">' + esc(parts[0]) + (parts[1] ? ' · ' + esc(parts[1]) : '') + '</span>';
      }
      h += '</div>';
    }
    h += '<div class="row-title" style="margin-top:16px">学习记录</div>';
    h += '<div class="kv"><span>掌握度</span><b>' + (p.level || 0) + ' / 5</b></div>';
    h += '<div class="kv"><span>错误次数</span><b>' + (p.wrong || 0) + '</b></div>';
    h += '<div class="kv"><span>上次学习</span><b>' + esc(p.last || '未学习') + '</b></div>';
    h += '<div class="btn-row"><button class="btn" data-act="back">返回列表</button>' +
      '<button class="btn primary" data-act="drill">单独练一遍</button></div>';
    h += '</div>';
    var box = id('search-results');
    box.innerHTML = h;
    var btns = box.querySelectorAll('[data-act]');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function (ev) {
        var act = ev.currentTarget.getAttribute('data-act');
        if (act === 'speak') speak(w.w);
        else if (act === 'back') renderSearch();
        else if (act === 'drill') startSession([w.w], 'extra');
      });
    }
  }

  /* ---------------------------------------------------------- 错词本 */
  function renderWrong() {
    var keys = wrongKeys();
    id('wrong-hint').textContent = keys.length
      ? ('共 ' + keys.length + ' 个错词，错误次数多的排在前面。答对一次即自动减少一次计数。')
      : '暂无错词，继续保持！';
    var box = id('wrong-list');
    if (!keys.length) { box.innerHTML = ''; return; }
    var h = '';
    for (var i = 0; i < keys.length; i++) {
      var w = byWord[keys[i]];
      var p = S.progress[keys[i]];
      if (!w) continue;
      h += '<div class="list-item">';
      h += '<div class="li-top"><span><span class="li-w">' + esc(w.w) + '</span>' +
        '<span class="li-p" style="margin-left:8px">' + esc(w.p) + '</span></span>' +
        '<span class="badge bad">错 ' + (p.wrong || 0) + ' 次</span></div>';
      h += '<div class="li-c">' + esc(w.c) + '</div>';
      h += '</div>';
    }
    box.innerHTML = h;
  }

  /* ---------------------------------------------------------- 弹窗 / 导入导出 */
  function openModal(title, bodyHtml, buttons) {
    id('modal-title').textContent = title;
    id('modal-body').innerHTML = bodyHtml;
    var foot = id('modal-foot');
    var h = '';
    for (var i = 0; i < buttons.length; i++) {
      h += '<button class="btn' + (buttons[i].primary ? ' primary' : '') +
        '" data-act="' + buttons[i].act + '">' + esc(buttons[i].text) + '</button>';
    }
    foot.innerHTML = h;
    id('modal').classList.remove('hidden');
    var bs = foot.querySelectorAll('[data-act]');
    for (var j = 0; j < bs.length; j++) {
      bs[j].addEventListener('click', function (ev) {
        if (ev.currentTarget.getAttribute('data-act') === 'cancel') closeModal();
      });
    }
  }
  function closeModal() { id('modal').classList.add('hidden'); }

  function importText(txt) {
    txt = String(txt || '').trim();
    if (!txt) return 0;
    var items = [];
    if (txt.charAt(0) === '[' || txt.charAt(0) === '{') {
      try {
        var j = JSON.parse(txt);
        if (j && j.words) j = j.words;
        if (Object.prototype.toString.call(j) === '[object Array]') items = j;
      } catch (e) { items = []; }
    }
    if (!items.length) {
      var lines = txt.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var sep = line.indexOf('|') >= 0 ? '|' : (line.indexOf('\t') >= 0 ? '\t' : ',');
        var parts = line.split(sep);
        var head = String(parts[0] || '').trim().toLowerCase();
        if (i === 0 && (head === 'word' || head === '单词' || head === 'w')) continue;  // 跳过表头
        items.push({
          w: parts[0], p: parts[1], c: parts[2], e: parts[3], t: parts[4], img: parts[5]
        });
      }
    }
    var added = 0;
    for (var k = 0; k < items.length; k++) {
      var nw = normalizeWord(items[k]);
      if (!nw || byWord[nw.w]) continue;
      S.userWords.push(nw);
      added++;
    }
    if (added) { buildBank(); save(); }
    return added;
  }
  function openImport() {
    var body = ''
      + '<div class="hint" style="margin-top:0">一行一个单词，用 <code>|</code>、<code>,</code> 或 Tab 分隔；最少只要「单词」和「释义」两列。</div>'
      + '<div class="hint">完整格式：<code>单词 | 音标 | 释义 | 例句 | 例句翻译 | 配图</code></div>'
      + '<textarea id="import-text" placeholder="abandon | /əˈbændən/ | v. 放弃；抛弃 | They had to abandon the plan. | 他们不得不放弃这个计划。 | 🚪&#10;rigorous | /ˈrɪɡərəs/ | a. 严格的"></textarea>'
      + '<input type="file" id="import-file" accept=".txt,.csv,.json" style="margin-top:10px;font-size:13px" />'
      + '<div class="hint">也可以选择本地的 .txt / .csv / .json 文件，内容会填进上面的框里。</div>';
    openModal('导入词表', body, [
      { text: '取消', act: 'cancel' },
      { text: '导入', act: 'ok', primary: true }
    ]);
    var doBtn = id('modal-foot').querySelector('[data-act="ok"]');
    doBtn.addEventListener('click', function () {
      var n = importText(id('import-text').value);
      if (n > 0) { closeModal(); toast('成功导入 ' + n + ' 个新词'); renderHome(); }
      else toast('没有解析到新单词，检查一下格式');
    });
    var fileInput = id('import-file');
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { id('import-text').value = String(fr.result || ''); };
      fr.readAsText(f, 'utf-8');
    });
  }
  function exportBank() {
    var out = [];
    for (var i = 0; i < bank.length; i++) {
      var w = bank[i];
      out.push({ w: w.w, p: w.p, c: w.c, e: w.e, t: w.t, img: w.img, sim: w.sim });
    }
    var text = JSON.stringify(out, null, 2);
    try {
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'cet6-words.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
      toast('已导出 ' + out.length + ' 个词条');
    } catch (e) { toast('导出失败，请换 Chrome / Edge 试试'); }
  }

  /* ---------------------------------------------------------- 事件绑定 */
  function bindGlobal() {
    id('brand').addEventListener('click', function () { setView('home'); renderHome(); });
    id('nav-search').addEventListener('click', function () {
      setView('search');
      var i = id('search-input');
      i.value = '';
      renderSearch();
      setTimeout(function () { try { i.focus(); } catch (e) {} }, 60);
    });
    id('nav-wrong').addEventListener('click', function () { setView('wrong'); renderWrong(); });

    var range = id('target-range');
    range.addEventListener('input', function () {
      S.settings.target = clamp(parseInt(range.value, 10) || 10, 10, 20);
      id('target-val').textContent = S.settings.target + ' 词';
      renderHome();
    });
    range.addEventListener('change', function () { save(); });

    id('btn-due').addEventListener('click', function () {
      var keys = dueKeysFor(0);
      if (!keys.length) { toast('今天没有到期的复习词'); return; }
      startSession(keys.slice(0, 20), 'review');
    });

    id('btn-start').addEventListener('click', startDaily);
    id('btn-quit').addEventListener('click', function () {
      S.sess = null;
      setView('home');
      renderHome();
      toast('进度已保存');
    });
    id('btn-audio').addEventListener('click', function () {
      var w = curWord();
      if (w) speak(w.w);
    });

    id('opt-audio').addEventListener('change', function () { S.settings.autoAudio = id('opt-audio').checked; save(); });
    id('opt-online').addEventListener('change', function () { S.settings.onlineAudio = id('opt-online').checked; save(); });
    id('opt-shuffle').addEventListener('change', function () { S.settings.shuffle = id('opt-shuffle').checked; save(); });

    id('btn-import').addEventListener('click', openImport);
    id('btn-export').addEventListener('click', exportBank);
    id('btn-reset').addEventListener('click', function () {
      if (!window.confirm('会清空学习进度、错词本和导入的词表，确定要清空吗？')) return;
      try { window.localStorage.removeItem(STORE_KEY); } catch (e) {}
      S.progress = {};
      S.daily = null;
      S.userWords = [];
      S.streak = { last: '', count: 0 };
      S.history = {};
      S.sess = null;
      buildBank();
      renderHome();
      toast('已清空');
    });

    id('search-input').addEventListener('input', renderSearch);
    id('btn-review-wrong').addEventListener('click', function () {
      var keys = wrongKeys();
      if (!keys.length) { toast('错词本是空的'); return; }
      startSession(keys.slice(0, 20), 'review');
    });
    id('btn-clear-wrong').addEventListener('click', function () {
      for (var k in S.progress) { if (has(S.progress, k)) S.progress[k].wrong = 0; }
      save();
      renderWrong();
      toast('已清空错词本');
    });

    id('modal-close').addEventListener('click', closeModal);
    id('modal').addEventListener('click', function (ev) {
      if (ev.target === id('modal')) closeModal();
    });
  }

  /* ---------------------------------------------------------- 启动 */
  function init() {
    load();
    buildBank();
    if (!bank.length) {
      id('home-hint').textContent = '警告：词库为空，请确认 data/words.js 已正确加载。';
    }
    bindGlobal();
    setView('home');
    renderHome();
    if ('speechSynthesis' in window) {
      try {
        ttsVoice = pickVoice();
        window.speechSynthesis.onvoiceschanged = function () { ttsVoice = pickVoice(); };
      } catch (e) {}
    }
  }
  try { init(); } catch (e) {
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="padding:16px;color:#b91c1c;font-size:14px">初始化失败：' + esc(e && e.message) + '</div>');
  }
})();
