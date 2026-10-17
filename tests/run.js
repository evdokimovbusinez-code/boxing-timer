/* Тесты: node tests/run.js */
'use strict';
const P = require('../parse.js');
const D = require('../detect.js');

let fail = 0, pass = 0;
function check(name, ok, extra) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''));
}

/* ---------- Парсер голосовых настроек ---------- */
const phrases = [
  ['10 раундов по 2 минуты отдых 1 минута', { rounds: 10, roundSec: 120, restSec: 60 }],
  ['десять раундов по две минуты, отдых минута', { rounds: 10, roundSec: 120, restSec: 60 }],
  ['2 минуты бокс 1 минута отдых 10 раундов', { rounds: 10, roundSec: 120, restSec: 60 }],
  ['12 раундов по 3 минуты отдых 30 секунд', { rounds: 12, roundSec: 180, restSec: 30 }],
  ['раунд полторы минуты отдых полминуты', { roundSec: 90, restSec: 30 }],
  ['3 раунда по 3 минуты минута отдыха', { rounds: 3, roundSec: 180, restSec: 60 }],
  ['отдых 45 секунд подготовка 5 секунд', { restSec: 45, prepSec: 5 }],
  ['8 раундов 2:30 отдых 1:00', { rounds: 8, roundSec: 150, restSec: 60 }],
  ['сделай 6 раундов по 2 с половиной минуты', { rounds: 6, roundSec: 150 }],
  ['раунды по 3 минуты, перерыв 1 минута, 5 раундов', { rounds: 5, roundSec: 180, restSec: 60 }],
  ['12 раундов по 3, отдых 1', { rounds: 12, roundSec: 180, restSec: 60 }],
  ['подготовка 10', { prepSec: 10 }],
  ['предупреждение за 15 секунд', { warnSec: 15 }],
  ['двадцать пять секунд отдыха', { restSec: 25 }],
  ['Пять раундов по две минуты тридцать секунд, отдых одна минута', { rounds: 5, roundSec: 150, restSec: 60 }],
  ['10 раундов. 2 минуты бокс, 1 минута отдых.', { rounds: 10, roundSec: 120, restSec: 60 }]
];
for (const [t, exp] of phrases) {
  const r = P.parseWorkout(t);
  const ok = Object.keys(exp).length === Object.keys(r).length && Object.keys(exp).every(k => r[k] === exp[k]);
  check('фраза: ' + t, ok, ok ? '' : JSON.stringify(r));
}
for (const [t, e] of [['старт', 'start'], ['пауза', 'pause'], ['продолжаем', 'resume'], ['дальше', 'skip'], ['сброс', 'reset'], ['поехали', 'start'], ['го', 'start'], ['стой', 'pause'], ['горох', null]]) {
  check('команда: ' + t, P.parseCommand(t) === e, String(P.parseCommand(t)));
}

/* ---------- Касание экрана и хаптика — не топот ---------- */
{
  const g = new D.TouchGuard(450);
  check('касание: удар без касаний проходит', !g.blocks(10000));
  g.touch(10000);
  check('касание: удар сразу после касания отброшен', g.blocks(10030) && g.blocks(10440));
  check('касание: удар чуть раньше касания тоже отброшен (звук в корпусе быстрее события)', g.blocks(9950) && g.blocks(9600));
  check('касание: через полсекунды — снова топот', !g.blocks(10460) && !g.blocks(9540));
  const s = new D.SingleTap(900, 700);
  s.push(1000); s.clear();
  check('SingleTap.clear: ожидающий удар отменён', !s.confirm(2000));
  // Сценарий «держу телефон и жму кнопки»: каждое касание даёт стук — двойной топ не набирается.
  const dt = new D.DoubleTap(90, 900, 500, 450), guard = new D.TouchGuard(450);
  let fired = 0;
  for (let k = 0; k < 6; k++) {
    const touchAt = 20000 + k * 700;
    guard.touch(touchAt); dt.clear();
    for (const hitAt of [touchAt + 20, touchAt + 180]) {          // стук пальца и стук хаптики
      if (guard.blocks(hitAt)) continue;
      if (dt.push(hitAt) === 'second' && dt.confirm(hitAt + 2000)) fired++;
    }
  }
  check('касания кнопок не запускают таймер', fired === 0, fired + ' срабатываний');
  // А настоящий двойной топ без касаний — работает.
  const dt2 = new D.DoubleTap(90, 900, 500, 450), g2 = new D.TouchGuard(450);
  g2.touch(30000);
  const ok2 = !g2.blocks(32000) && dt2.push(32000) === 'first' && dt2.push(32350) === 'second' && dt2.confirm(32350 + 500);
  check('настоящий двойной топ через 2 с после касания работает', ok2);
}

/* ---------- Английский: те же настройки голосом и команды ---------- */
const en = [
  ['10 rounds of 2 minutes rest 1 minute', { rounds: 10, roundSec: 120, restSec: 60 }],
  ['ten rounds of two minutes, one minute rest', { rounds: 10, roundSec: 120, restSec: 60 }],
  ['12 rounds 3 minutes, 30 seconds break', { rounds: 12, roundSec: 180, restSec: 30 }],
  ['three rounds of three minutes with a minute rest', { rounds: 3, roundSec: 180, restSec: 60 }],
  ['round a minute and a half, rest half a minute', { roundSec: 90, restSec: 30 }],
  ['six rounds of two and a half minutes', { rounds: 6, roundSec: 150 }],
  ['8 rounds 2:30 rest 1:00', { rounds: 8, roundSec: 150, restSec: 60 }],
  ['twenty five seconds rest', { restSec: 25 }],
  ['prep 15 seconds', { prepSec: 15 }],
  ['Five rounds of two minutes thirty seconds, rest one minute', { rounds: 5, roundSec: 150, restSec: 60 }]
];
for (const [t, exp] of en) {
  const r = P.parseWorkout(t);
  const ok = Object.keys(exp).length === Object.keys(r).length && Object.keys(exp).every(k => r[k] === exp[k]);
  check('en фраза: ' + t, ok, ok ? '' : JSON.stringify(r));
}
for (const [t, e] of [['start', 'start'], ["let's go", 'start'], ['pause', 'pause'], ['stop', 'pause'], ['resume', 'resume'], ['continue', 'resume'], ['next', 'skip'], ['skip', 'skip'], ['reset', 'reset'], ['restart', 'reset'], ['banana', null]]) {
  check('en команда: ' + t, P.parseCommand(t) === e, String(P.parseCommand(t)));
}
check('en: durWords', P.durWords(90, 'en') === '1 minute 30 seconds' && P.durWords(60, 'en') === '1 minute' && P.durWords(45, 'en') === '45 seconds', [P.durWords(90, 'en'), P.durWords(60, 'en'), P.durWords(45, 'en')].join(' | '));
check('ru: durWords по-прежнему', P.durWords(90) === 'полторы минуты');

/* ---------- Детектор топота ---------- */
// Псевдослучайный генератор, чтобы тесты были повторяемыми.
let seed = 42;
function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }

/** Строит поток пиков (как опрос микрофона раз в 12 мс). events: [{t, peak, tail}] */
function stream(ms, noiseLo, noiseHi, events) {
  const out = [];
  for (let t = 0; t < ms; t += 12) {
    let v = noiseLo + (noiseHi - noiseLo) * rnd();
    for (const e of events) {
      const d = t - e.t;
      if (d >= 0 && d < 24) v = Math.max(v, e.peak * (d < 12 ? 1 : 0.8));     // атака (окно анализатора ~21 мс)
      else if (d >= 24 && d < 24 + (e.tail || 0)) v = Math.max(v, e.peak * 0.45 * Math.exp(-(d - 24) / 180)); // гул зала
    }
    out.push([t, v]);
  }
  return out;
}

const MIC = { absHi: 0.12, absLo: 0.012 };
function runNew(samples, sens, cal) {
  const det = new D.OnsetDetector({ floor0: 0.01 });
  const dbl = new D.DoubleTap();
  const hits = [], doubles = [], pend = [];
  for (const [t, v] of samples) {
    const thr = D.threshold({ sens, cal, floor: det.floor, second: dbl.waiting(t), absHi: MIC.absHi, absLo: MIC.absLo });
    // как в приложении: после 'second' ждём confirmDelay и проверяем тишину
    if (pend.length && t >= pend[0].at) { const p = pend.shift(); if (dbl.confirm(t)) doubles.push(p.t); }
    if (det.push(v, t, thr)) {
      hits.push(t);
      if (dbl.push(t) === 'second') pend.push({ t, at: t + dbl.confirmDelay() + 15 });
    }
  }
  for (const p of pend) if (dbl.confirm(p.at)) doubles.push(p.t);
  return { hits, doubles };
}
// Старый алгоритм из первой версии (для сравнения).
function runOld(samples, sens) {
  let floor = 0.01, armed = true, last = -1e9, pending = 0; const doubles = [];
  for (const [t, v] of samples) {
    const k = D.lerp(14, 3.2, sens), absMin = D.lerp(0.12, 0.012, sens);
    if (v < floor * 2.5) floor = floor * 0.997 + v * 0.003;
    const thr = Math.max(absMin, floor * k);
    if (armed && v > thr && t - last > 110) {
      armed = false; last = t;
      if (pending && t - pending >= 100 && t - pending <= 800) { pending = 0; doubles.push(t); } else pending = t;
    } else if (!armed && v < thr * 0.6) armed = true;
  }
  return { doubles };
}

// 1. Двойной топ, второй заметно тише первого — главный случай «срабатывает через раз».
{
  const s = stream(4000, 0.002, 0.006, [{ t: 1000, peak: 0.1, tail: 300 }, { t: 1380, peak: 0.05, tail: 300 }]);
  const n = runNew(s, 0.55), o = runOld(s, 0.55);
  check('двойной топ, второй вдвое тише: новый ловит', n.doubles.length === 1, JSON.stringify(n));
  check('… старый алгоритм здесь промахивался', o.doubles.length === 0, JSON.stringify(o));
}
// 1б. Гул в зале (бас) держит уровень между топами
{
  const s = stream(4000, 0.002, 0.006, [{ t: 1000, peak: 0.22, tail: 900 }, { t: 1250, peak: 0.2, tail: 300 }]);
  for (const x of s) if (x[0] > 1030 && x[0] < 1250) x[1] = Math.max(x[1], 0.06);
  const n = runNew(s, 0.55), o = runOld(s, 0.55);
  check('гул между топами: новый ловит', n.doubles.length === 1, JSON.stringify(n));
  check('… старый здесь промахивался', o.doubles.length === 0, JSON.stringify(o));
}
// 2. Быстрый двойной топ (200 мс)
{
  const s = stream(3000, 0.002, 0.006, [{ t: 1000, peak: 0.2, tail: 200 }, { t: 1200, peak: 0.16, tail: 200 }]);
  check('быстрый двойной (200 мс)', runNew(s, 0.55).doubles.length === 1);
}
// 3. Медленный двойной (800 мс)
{
  const s = stream(3000, 0.002, 0.006, [{ t: 1000, peak: 0.2 }, { t: 1800, peak: 0.15 }]);
  check('медленный двойной (800 мс)', runNew(s, 0.55).doubles.length === 1);
}
// 4. Один топ с отскоком через 60 мс — не двойной
{
  const s = stream(3000, 0.002, 0.006, [{ t: 1000, peak: 0.2 }, { t: 1060, peak: 0.12 }]);
  check('одиночный топ с отскоком — не двойной', runNew(s, 0.55).doubles.length === 0);
}
// 5. Два топа с паузой 1,5 с — не двойной
{
  const s = stream(4000, 0.002, 0.006, [{ t: 1000, peak: 0.2 }, { t: 2500, peak: 0.2 }]);
  check('два топа через 1,5 с — не двойной', runNew(s, 0.55).doubles.length === 0);
}
// 6. Шумный зал (музыка, разговоры) + обычные шаги каждые 550 мс — без ложных срабатываний
{
  const steps = []; for (let t = 2000; t < 20000; t += 550) steps.push({ t, peak: 0.05 + 0.02 * rnd() });
  const s = stream(20000, 0.02, 0.05, steps);
  const r = runNew(s, 0.55);
  check('шумный зал + ходьба: нет ложных двойных', r.doubles.length === 0, r.doubles.length + ' ложных');
}
// 7. В том же шуме настоящий двойной топ ловится
{
  const s = stream(20000, 0.02, 0.05, [{ t: 15000, peak: 0.25, tail: 300 }, { t: 15400, peak: 0.16, tail: 300 }]);
  check('шумный зал: двойной топ ловится', runNew(s, 0.55).doubles.length === 1);
}
// 8. Долгий громкий звук (гонг/музыка) не даёт серию ударов
{
  const s = []; for (let t = 0; t < 5000; t += 12) s.push([t, t > 1000 && t < 3500 ? 0.15 + 0.03 * Math.sin(t / 30) : 0.004]);
  const r = runNew(s, 0.55);
  check('длинный громкий звук: максимум 1 удар', r.hits.length <= 1, r.hits.length + ' ударов');
}
// 8б. Бочка в музыке 117 BPM (удар каждые 510 мс, как фейковый микрофон Chromium) — ни одного старта
{
  const beats = []; for (let t = 500; t < 20000; t += 510) beats.push({ t, peak: 0.6 });
  const r = runNew(stream(20000, 0.01, 0.03, beats), 0.55);
  check('ритм 117 BPM: нет ложных стартов', r.doubles.length === 0, r.hits.length + ' ударов, ' + r.doubles.length + ' стартов');
}
// 8в. Музыка играет, потом пауза в треке и человек делает двойной топ — ловится
{
  const ev = []; for (let t = 500; t < 8000; t += 510) ev.push({ t, peak: 0.6 });
  ev.push({ t: 9500, peak: 0.5 }, { t: 9850, peak: 0.4 });
  check('после музыки двойной топ в тишине ловится', runNew(stream(12000, 0.01, 0.03, ev), 0.55).doubles.length === 1);
}
// 8г. Тройной топ — не двойной
{
  const r = runNew(stream(4000, 0.002, 0.006, [{ t: 1000, peak: 0.2 }, { t: 1350, peak: 0.2 }, { t: 1700, peak: 0.2 }]), 0.55);
  check('тройной топ — не старт', r.doubles.length === 0, JSON.stringify(r.doubles));
}
// 8д. Одиночный режим: ритм не срабатывает, отдельный удар — да
{
  const st = new D.SingleTap(900, 700); let fired = 0;
  for (let t = 0; t < 5000; t += 510) { st.push(t); if (st.confirm(t + 505)) fired++; }
  const st2 = new D.SingleTap(900, 700); st2.push(10000); const ok2 = st2.confirm(10715);
  check('одиночный режим: ритм игнорируется, отдельный удар ловится', fired === 0 && ok2, 'ритм ' + fired + ', одиночный ' + ok2);
}
// 9. Калибровка: 4 топа → уровень ≈ медиана; затем тихий двойной (на 40% слабее) ловится, шаги — нет
{
  const pc = new D.PeakCollector();
  const det = new D.OnsetDetector({ floor0: 0.01 });
  const s = stream(6000, 0.002, 0.006, [{ t: 800, peak: 0.18 }, { t: 2000, peak: 0.24 }, { t: 3200, peak: 0.2 }, { t: 4400, peak: 0.22 }]);
  for (const [t, v] of s) { const prev = det.slow; det.push(v, t, 1); pc.push(v, t, det.floor, prev); }
  const lvl = pc.level();
  check('калибровка: найдено 4 топа', pc.events.length === 4, JSON.stringify(pc.events.map(x => +x.toFixed(3))));
  check('калибровка: уровень 0.20–0.23', lvl >= 0.2 && lvl <= 0.23, String(lvl));
  const soft = stream(4000, 0.002, 0.006, [{ t: 1000, peak: 0.13 }, { t: 1400, peak: 0.1 }]);
  check('после калибровки тихий двойной ловится', runNew(soft, 0.55, lvl).doubles.length === 1);
  const walk = []; for (let t = 500; t < 8000; t += 450) walk.push({ t, peak: 0.05 });
  check('после калибровки шаги не срабатывают', runNew(stream(8000, 0.002, 0.006, walk), 0.55, lvl).hits.length === 0);
}
// 10. Калибровка: тишина → null
{
  const pc = new D.PeakCollector();
  const det = new D.OnsetDetector({ floor0: 0.01 });
  for (const [t, v] of stream(5000, 0.002, 0.006, [])) { const prev = det.slow; det.push(v, t, 1); pc.push(v, t, det.floor, prev); }
  check('калибровка без топота → нет уровня', pc.level() === null);
}

/* ---------- Локальная модель «топот / не топот» ---------- */
{
  const SR = 48000, FFT = 2048;
  // Синтетический спектр в дБ: профиль энергии по частоте + разброс.
  function spectrum(profile, jitter) {
    const db = new Float32Array(FFT / 2);
    for (let i = 0; i < db.length; i++) {
      const f = i * SR / FFT;
      db[i] = profile(f) + (rnd() - 0.5) * jitter;
    }
    return db;
  }
  const kinds = {
    // топот: глухой удар 30–200 Гц, быстро затухает
    stomp: () => [spectrum(f => (f < 200 ? -20 : -20 - 25 * Math.log2(f / 200)) + (rnd() - 0.5) * 6, 8), -18 - 6 * rnd()],
    // шаг: тише, больше 200–600 Гц и щелчок подошвы 2–5 кГц
    step: () => [spectrum(f => (f < 120 ? -45 : f < 700 ? -38 : f > 2000 && f < 5000 ? -40 : -55) + (rnd() - 0.5) * 6, 8), -10 - 6 * rnd()],
    // удар по лапам: широкий щелчок 300–4000 Гц
    pad: () => [spectrum(f => (f < 250 ? -42 : f < 4000 ? -25 : -40) + (rnd() - 0.5) * 6, 8), -25 - 6 * rnd()],
    // прыжок: низ похож на топот, но с «двойным» приземлением и гулом (медленное затухание)
    jump: () => [spectrum(f => (f < 150 ? -24 : f < 900 ? -30 : -45) + (rnd() - 0.5) * 6, 8), -5 - 4 * rnd()]
  };
  const sample = (k) => { const [db, decay] = kinds[k](); return D.features(db, SR, FFT, decay); };
  const X = [], y = [];
  for (let i = 0; i < 5; i++) { X.push(sample('stomp')); y.push(1); }
  for (const k of ['step', 'pad', 'jump']) for (let i = 0; i < 4; i++) { X.push(sample(k)); y.push(0); }
  const model = D.trainModel(X, y);
  check('модель обучилась на 5 топах и 12 «не топах»', !!model && model.acc >= 0.9, model && ('точность на обучении ' + Math.round(model.acc * 100) + '%'));
  let ok = 0, total = 0;
  const conf = {};
  for (const k of Object.keys(kinds)) {
    let right = 0;
    for (let i = 0; i < 50; i++) {
      const p = D.predict(model, sample(k));
      if ((p >= 0.5) === (k === 'stomp')) right++;
    }
    conf[k] = right; ok += right; total += 50;
  }
  check('модель на новых примерах ≥ 90% верно', ok / total >= 0.9, Math.round(ok / total * 100) + '% ' + JSON.stringify(conf));
  check('мало примеров → модели нет', D.trainModel(X.slice(0, 4), y.slice(0, 4)) === null);
  // Фильтр «есть низ»: топот проходит, писк 2 кГц и удар по лапам — нет
  const beep = spectrum(f => (Math.abs(f - 2000) < 60 ? -10 : -70), 4);
  let stompPass = 0; for (let i = 0; i < 30; i++) if (D.lowHigh(kinds.stomp()[0], SR, FFT) >= D.LOW_MIN) stompPass++;
  let padPass = 0; for (let i = 0; i < 30; i++) if (D.lowHigh(kinds.pad()[0], SR, FFT) >= D.LOW_MIN) padPass++;
  check('фильтр низа: топот проходит', stompPass === 30, stompPass + '/30');
  check('фильтр низа: писк отсекается', D.lowHigh(beep, SR, FFT) < D.LOW_MIN, D.lowHigh(beep, SR, FFT).toFixed(4));
  check('фильтр низа: удар по лапам отсекается', padPass === 0, padPass + '/30 прошло');
  const json = JSON.stringify(model);
  check('модель маленькая (< 1 КБ)', json.length < 1024, json.length + ' байт');
}

/* ---------- Значения для колеса (листаем пальцем) ---------- */
{
  const r = P.choices('rounds'), rs = P.choices('roundSec'), rest = P.choices('restSec');
  check('колесо: раунды 1…30', r[0] === 1 && r[r.length - 1] === 30 && r.length === 30);
  check('колесо: раунд — частые значения есть', [20, 30, 60, 90, 120, 150, 180, 300, 600].every(v => rs.includes(v)), rs.join(','));
  check('колесо: раунд — шаг мельче в начале', rs[1] - rs[0] === 5 && rs[rs.length - 1] - rs[rs.length - 2] === 60);
  check('колесо: отдых начинается с «нет»', rest[0] === 0 && rest.includes(30) && rest.includes(60));
  check('колесо: по возрастанию', [r, rs, rest, P.choices('prepSec'), P.choices('warnSec')].every(l => l.every((v, i) => !i || v > l[i - 1])));
  const odd = P.choices('roundSec', 130);
  check('колесо: значение не из списка (голосом 2:10) встаёт на место', odd.includes(130) && odd.indexOf(130) === odd.indexOf(120) + 1 && odd.every((v, i) => !i || v > odd[i - 1]));
  check('колесо: обычное значение не дублируется', P.choices('roundSec', 120).length === rs.length);
}

/* ---------- Фразы нейроголоса ---------- */
{
  const PH = require('../voice-phrases.js');
  const l = PH.list(), ids = new Set(l.map(x => x.id));
  check('фразы: id уникальны', ids.size === l.length, l.length + ' фраз');
  const need = ['prep', 'start', 'box', 'round_1', 'round_30', 'last_round', 'stop_rest', 'left_1', 'left_2', 'left_30', 'warn_10', 'ready_1', 'ready_last', 'half', 'cnt_5', 'pause', 'resume', 'finish'];
  check('фразы: все нужные таймеру есть', need.every(i => ids.has(i)), need.filter(i => !ids.has(i)).join(','));
  const t = Object.fromEntries(l.map(x => [x.id, x.text]));
  check('фразы: склонения', t.left_2 === 'Осталось два раунда.' && t.left_5 === 'Осталось пять раундов.' && t.left_21 === 'Остался двадцать один раунд.' && t.warn_10 === 'Десять секунд!', [t.left_2, t.left_5, t.left_21, t.warn_10].join(' | '));
}

/* ---------- Фразы и интерфейс на английском ---------- */
{
  const PH = require('../voice-phrases.js');
  const ru = PH.list('ru'), enl = PH.list('en');
  check('фразы en: те же id, что и ru', ru.length === enl.length && ru.every((x, i) => x.id === enl[i].id), enl.length + ' фраз');
  const t = Object.fromEntries(enl.map(x => [x.id, x.text]));
  check('фразы en: текст', t.round_3 === 'Round three. Box!' && t.left_7 === 'Seven rounds left.' && t.left_1 === 'One round left.' && t.left_21 === 'Twenty-one rounds left.' && t.warn_10 === 'Ten seconds!' && t.ready_4 === 'Get ready, round four.', [t.round_3, t.left_7, t.left_21, t.ready_4].join(' | '));
  // Говорит только Артём: у всего, что таймер произносит, должна быть запись, иначе прозвучит голос iPhone.
  const ids = new Set(ru.map(x => x.id));
  const warns = P.choices('warnSec').filter(Boolean);
  check('фразы: на каждое значение «Сигнал за» есть запись', warns.every(w => ids.has('warn_' + w)), warns.filter(w => !ids.has('warn_' + w)).join(','));
  check('фразы: «Готово!» для голосовой настройки', t.ok === 'Done!' && ru.find(x => x.id === 'ok').text === 'Готово!');
  check('фразы: лишних нет (reset не произносится)', !ids.has('reset'));
  check('фразы: без языка — русские', PH.list()[3].text === ru[3].text && /Раунд/.test(ru[3].text));
  const I = require('../i18n.js');
  const kr = Object.keys(I.DICT.ru), ke = Object.keys(I.DICT.en);
  check('i18n: ключи ru и en совпадают', kr.length === ke.length && kr.every(k => k in I.DICT.en), kr.filter(k => !(k in I.DICT.en)).concat(ke.filter(k => !(k in I.DICT.ru))).join(','));
  check('i18n: подстановка', I.t('en', 'round.n', { n: 3, total: 10 }).includes('3') && I.t('ru', 'round.n', { n: 3, total: 10 }).includes('3'));
  check('i18n: множественное ru', I.t('ru', 'n.rounds', { n: 1 }) === '1 раунд' && I.t('ru', 'n.rounds', { n: 3 }) === '3 раунда' && I.t('ru', 'n.rounds', { n: 12 }) === '12 раундов', [1, 3, 12].map(n => I.t('ru', 'n.rounds', { n })).join(' | '));
  check('i18n: множественное en', I.t('en', 'n.rounds', { n: 1 }) === '1 round' && I.t('en', 'n.rounds', { n: 3 }) === '3 rounds');
  check('i18n: нет ключа — сам ключ, не падаем', I.t('en', 'no.such.key') === 'no.such.key');
  check('i18n: пустых переводов нет', kr.every(k => I.DICT.ru[k] !== '' && I.DICT.en[k] !== ''));
}

console.log('\n' + pass + ' прошло, ' + fail + ' упало');
process.exit(fail ? 1 : 0);
