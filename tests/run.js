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
  const hits = [], doubles = [];
  for (const [t, v] of samples) {
    const thr = D.threshold({ sens, cal, floor: det.floor, second: dbl.waiting(t), absHi: MIC.absHi, absLo: MIC.absLo });
    if (det.push(v, t, thr)) { hits.push(t); if (dbl.push(t) === 'double') doubles.push(t); }
  }
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

console.log('\n' + pass + ' прошло, ' + fail + ' упало');
process.exit(fail ? 1 : 0);
