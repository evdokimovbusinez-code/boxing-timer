/* Прогон тренировок целиком в браузере на виртуальных часах: спарринг 10 × 2:00
 * и все 24 программы груши — что прозвучит, в какую секунду и в каком порядке. Полчаса тренировки — доли секунды.
 * Запуск: node tests/sim.js (нужен Playwright с Chromium; сервер не нужен — файлы отдаются из репо).
 */
var fs = require('fs'), path = require('path');
var pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
var BP = require('../programs.js');
var ROOT = path.join(__dirname, '..'), ORIGIN = 'http://sim.local/';
var TYPES = { js: 'text/javascript', css: 'text/css', html: 'text/html', mp3: 'audio/mpeg', mp4: 'video/mp4', json: 'application/json', svg: 'image/svg+xml', png: 'image/png' };

var fail = 0;
function ok(name, cond, extra) {
  if (!cond) { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
  return cond;
}
function count(log, k, v) { return log.filter(function (e) { return e.k === k && (typeof v === 'function' ? v(e.v) : e.v === v); }).length; }

(async function () {
  var t0 = Date.now();
  var browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  var ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, serviceWorkers: 'block' });
  await ctx.route(ORIGIN + '**', function (route) {
    var rel = decodeURIComponent(new URL(route.request().url()).pathname).slice(1) || 'index.html';
    var file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, body: fs.readFileSync(file), contentType: TYPES[rel.split('.').pop()] || 'application/octet-stream' });
  });
  var page = await ctx.newPage(), errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  // Свои виртуальные часы: таймеры страницы идут по очереди синхронно, без ожидания (Playwright clock отдаёт
  // управление браузеру после каждого таймера — ~4 мс на секунду тренировки, в 300 раз медленнее).
  await page.addInitScript(function () {
    localStorage.setItem('boxing-timer.settings.v1', JSON.stringify({ rev: 5, stompMode: 'off', prepSec: 10, tickSec: 5 }));
    var t = 0, seq = 0, q = {}, d0 = Date.now();
    performance.now = function () { return t; };
    Date.now = function () { return d0 + t; };
    function add(f, ms, every) { var id = ++seq; q[id] = { id: id, n: id, at: t + Math.max(0, +ms || 0), f: f, every: every ? Math.max(1, +ms || 0) : 0 }; return id; }
    window.setTimeout = function (f, ms) { return add(f, ms, false); };
    window.setInterval = function (f, ms) { return add(f, ms, true); };
    window.clearTimeout = window.clearInterval = function (id) { delete q[id]; };
    window.requestAnimationFrame = function (f) { return add(function () { f(t); }, 16, false); };
    window.cancelAnimationFrame = window.clearTimeout;
    window.__advance = function (ms) {
      var end = t + ms;
      for (;;) {
        var next = null;
        for (var id in q) if (!next || q[id].at < next.at || (q[id].at === next.at && q[id].n < next.n)) next = q[id];
        if (!next || next.at > end) break;
        t = next.at;
        if (next.every) { next.at += next.every; next.n = ++seq; } else delete q[next.id];
        if (typeof next.f === 'function') next.f();
      }
      t = end;
    };
  });
  await page.goto(ORIGIN);
  await page.evaluate(function () { __advance(500); });
  // Журнал: что прозвучало (сигнал / фраза), в какой фазе, раунде и секунде до конца фазы.
  await page.evaluate(function () {
    var B = window.BoxTimer, T = B.Timer;
    window.__log = [];
    var at = function (k, v) { __log.push({ k: k, v: v, ph: T.phase, r: T.round, s: Math.ceil(T.remaining() / 1000) }); };
    var play = B.Sound.play.bind(B.Sound), speak = B.Voice.speak.bind(B.Voice);
    B.Sound.play = function (n) { at('snd', n); return play.apply(null, arguments); };
    B.Voice.speak = function (ids) { at('say', [].concat(ids).join(',')); return speak.apply(null, arguments); };
  });

  async function run(cfg) {
    var total = await page.evaluate(function (c) {
      var B = window.BoxTimer;
      Object.keys(c).forEach(function (k) { B.S[k] = c[k]; });
      B.Plan.refresh(); __log.length = 0;
      B.App.unlocked = true; B.Timer.start();
      return B.S.prepSec + B.Plan.total();
    }, cfg);
    await page.evaluate(function (ms) { __advance(ms); }, (total + 4) * 1000);
    return page.evaluate(function () { return { log: __log.slice(), phase: window.BoxTimer.Timer.phase }; });
  }

  // Спарринг 10 × 2:00 / 1:00 — как было до груши.
  var sp = await run({ mode: 'spar', rounds: 10, roundSec: 120, restSec: 60, warnSec: 10, countVoice: true, halfVoice: false });
  var L = sp.log;
  ok('спарринг: дошёл до финиша', sp.phase === 'done', sp.phase);
  for (var r = 1; r <= 10; r++) {
    var a = r === 10 ? 'last_round' : 'round_' + r;
    ok('спарринг: объявлен раунд ' + r, L.some(function (e) { return e.k === 'say' && e.r === r && e.ph === 'round' && e.v.indexOf(a) === 0; }));
  }
  ok('спарринг: 10 стартовых сигналов', count(L, 'snd', 'r_start') === 10, count(L, 'snd', 'r_start'));
  ok('спарринг: 9 сигналов на конец раунда', count(L, 'snd', 'r_end') === 9, count(L, 'snd', 'r_end'));
  ok('спарринг: «10 секунд» в каждом раунде', count(L, 'say', function (v) { return /warn_10/.test(v); }) >= 10);
  ok('спарринг: тиканье только в последние 5 с', L.every(function (e) { return e.v !== 'tick' || e.s <= 5; }));
  ok('спарринг: финиш', count(L, 'snd', 'finish') === 1 && count(L, 'say', 'finish') === 1);
  var hist = function () { return page.evaluate(function () { return JSON.parse(localStorage.getItem('boxing-timer.history.v1') || '[]'); }); };
  var H = await hist();
  ok('история: спарринг записан — 10 раундов, 20 мин бокса', H.length === 1 && H[0].r === 10 && H[0].s === 1200 && H[0].m === 'spar', H);
  ok('финиш: итог недели', /1/.test(await page.evaluate(function () { return document.getElementById('summaryWeek').textContent; })));

  // Все программы груши: раунды, горн на каждый максимум, свисток на «сильно», задание каждого раунда, финиш.
  for (var i = 0; i < BP.PROGRAMS.length; i++) {
    var P = BP.PROGRAMS[i], X = BP.expand(P), id = P.id;
    var res = await run({ mode: 'bag', bagGoal: P.goal, bagLevel: P.level });
    var G = res.log, bad = [];
    ok(id + ': дошёл до финиша', res.phase === 'done', res.phase);
    X.rounds.forEach(function (R, k) {
      var n = k + 1, inR = G.filter(function (e) { return e.ph === 'round' && e.r === n; });
      var maxes = R.segs.filter(function (s) { return s.start > 0 && s.type === 'max'; }).length;
      var horns = inR.filter(function (e) { return e.v === 'r_horn'; }).length;
      if (horns !== maxes) bad.push('р' + n + ' горн ' + horns + '/' + maxes);
      if (!inR.some(function (e) { return e.k === 'say' && e.v.indexOf('bag_' + R.theme) >= 0; })) bad.push('р' + n + ' нет задания ' + R.theme);
      if (inR.some(function (e) { return e.k === 'say' && /half/.test(e.v); })) bad.push('р' + n + ' половина раунда');
      // Тиканье — только в конце раунда или за 1…5 с до «сильно»/«максимума»; если они есть — тикает.
      var pre = function (el) { return R.segs.some(function (g) { return g.start > 0 && (g.type === 'max' || g.type === 'hard') && g.start - el >= 1 && g.start - el <= 5; }); };
      var ticks = inR.filter(function (e) { return e.v === 'tick' && e.s > 5; });
      if (ticks.some(function (e) { return !pre(R.sec - e.s); })) bad.push('р' + n + ' лишнее тиканье');
      if (R.segs.some(function (g) { return g.start > 10 && (g.type === 'max' || g.type === 'hard'); }) && ticks.length < 5) bad.push('р' + n + ' нет тиканья');
      // Фраза тренера не наезжает на счёт 5…1.
      if (inR.some(function (e) { return e.k === 'say' && /bag_/.test(e.v) && e.s <= 5 && e.s > 0; })) bad.push('р' + n + ' фраза на счёте');
    });
    ok(id + ': раунды по программе', !bad.length, bad.slice(0, 4));
    ok(id + ': финиш', count(G, 'snd', 'finish') === 1);
  }

  H = await hist();
  ok('история: каждая программа груши записана', H.length === 1 + BP.PROGRAMS.length && H.slice(1).every(function (h) { return h.m === 'bag' && h.r > 0; }), H.length);
  // Прервал тренировку: 90 с первого раунда — засчитан раунд; 30 с — не тренировка.
  var partial = function (sec) {
    return page.evaluate(function (sec) {
      var B = window.BoxTimer; B.S.mode = 'spar'; B.S.prepSec = 0; B.Plan.refresh(); B.Timer.start(); __advance(sec * 1000); B.Timer.reset();
    }, sec);
  };
  await partial(90); H = await hist();
  ok('история: прерванная на 90-й секунде — 1 раунд, 90 с', H.length === 2 + BP.PROGRAMS.length && H[H.length - 1].r === 1 && H[H.length - 1].s === 90, H[H.length - 1]);
  await partial(30);
  ok('история: 30 секунд — не тренировка, не пишем', (await hist()).length === 2 + BP.PROGRAMS.length);
  await page.evaluate(function () { window.BoxTimer.S.roundSec = 180; });
  await partial(80); H = await hist();
  ok('история: раунд 3:00 прерван на 80-й секунде — минуты есть, раунд не засчитан', H.length === 3 + BP.PROGRAMS.length && H[H.length - 1].r === 0 && H[H.length - 1].s === 80, H[H.length - 1]);
  await page.evaluate(function () { window.BoxTimer.S.roundSec = 120; });
  var idle = await page.evaluate(function () { return document.getElementById('idleSub').textContent; });
  ok('готовность: в строке — неделя и серия (за неделю 26 тренировок — цель выполнена)', /цель недели ✓ · 🔥 1 нед/.test(idle), idle);
  await page.evaluate(function () { window.BoxTimer.S.prepSec = 10; });

  // Цифры влезают между вырезом и краем: iPhone с чёлкой/островом в горизонтали × все шрифты × все состояния экрана.
  // (Шрифтов iPhone в песочнице нет — проверяются запасные; табло DSEG7 — настоящее.)
  await page.evaluate(function () { return document.fonts.load('800 40px DSEG7'); }); // табло — из файла
  var DEVICES = [['SE', 667, 375, 0, 0], ['14', 844, 390, 47, 21], ['15 Pro Max', 932, 430, 59, 21]];
  for (var d = 0; d < DEVICES.length; d++) {
    var D = DEVICES[d];
    await page.setViewportSize({ width: D[1], height: D[2] });
    var cut = await page.evaluate(function (D) {
      var B = window.BoxTimer, T = B.Timer, root = document.getElementById('root'), out = [];
      root.style.setProperty('--sl', D[3] + 'px'); root.style.setProperty('--sr', D[3] + 'px'); root.style.setProperty('--sb', D[4] + 'px');
      var check = function (what) {
        var el = document.getElementById('clock'), st = document.getElementById('stage'), cs = getComputedStyle(st);
        el.classList.remove('enter', 'pop', 'beat'); // анимации на миг меняют масштаб — меряем цифры в покое
        var rg = document.createRange(); rg.selectNodeContents(el);
        var c = rg.getBoundingClientRect(), sr = st.getBoundingClientRect();
        var left = sr.left + parseFloat(cs.paddingLeft) - 16, right = sr.right - parseFloat(cs.paddingRight) + 16; // поля 16 px — запас, вырез — нет
        if (c.left < left - 1 || c.right > right + 1) out.push(B.S.font + ' ' + what + ' ' + Math.round(c.left) + '…' + Math.round(c.right) + ' вне ' + Math.round(left) + '…' + Math.round(right));
      };
      Object.keys(B.FONTS).forEach(function (f) {
        B.S.font = f; B.UI.applyLook();
        [['spar', 120], ['spar', 600], ['bag', 0]].forEach(function (m) {
          B.S.mode = m[0]; if (m[1]) B.S.roundSec = m[1]; B.Plan.refresh();
          T.reset(); B.UI.render(true); check('готовность ' + m.join(''));
          B.S.prepSec = 0; T.start(); B.UI.render(true); check('раунд ' + m.join(''));
          T.pause(); B.UI.render(true); check('пауза ' + m.join(''));
          T.resume(); T.enter('rest'); B.UI.render(true); check('отдых ' + m.join(''));
        });
      });
      T.reset(); root.style.cssText = ''; B.S.prepSec = 10; B.S.mode = 'spar'; B.S.roundSec = 120; B.Plan.refresh();
      return out;
    }, D);
    ok('iPhone ' + D[0] + ': цифры не обрезаются', !cut.length, cut.slice(0, 6));
  }

  ok('нет ошибок на странице', !errors.length, errors.slice(0, 3));
  await browser.close();
  console.log((fail ? fail + ' упало' : 'всё прошло') + ' · симуляция 1 спарринга, ' + BP.PROGRAMS.length + ' программ груши и экран 3 iPhone за ' + ((Date.now() - t0) / 1000).toFixed(1) + ' с');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
