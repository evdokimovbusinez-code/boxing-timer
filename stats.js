/* Статистика тренировок: неделя, серия недель с выполненной целью, календарь 12 недель, итоги.
 * Запись — { d: 'ГГГГ-ММ-ДД' (местная дата), r: раундов, s: секунд бокса, m: 'spar' | 'bag' }.
 * Серия — в неделях, а не днях: в боксе между тренировками отдыхают, дневная серия рвалась бы постоянно.
 * Чистая логика без браузера (UMD): app.js и тесты.
 */
(function (root) {
  'use strict';

  var DAY = 864e5;
  function num(d) { return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY; }
  function key(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  /** Дата + n дней. */
  function shift(d, n) { return key(num(d) + n); }
  /** Понедельник недели, в которую попадает дата. */
  function weekStart(d) { var n = num(d); return key(n - (n + 3) % 7); } // 1970-01-01 — четверг
  /** Сегодня по местному времени. */
  function today(date) { var t = date || new Date(); return key(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / DAY); }

  /** Добавить тренировку; храним 2 года. */
  function add(hist, rec, now) {
    var from = shift(now || rec.d, -730);
    return hist.filter(function (x) { return x.d >= from; }).concat([rec]);
  }

  function sum(list) {
    return list.reduce(function (a, x) { a.count++; a.rounds += x.r; a.min += x.s / 60; return a; }, { count: 0, rounds: 0, min: 0 });
  }

  /** Всё для экрана «Прогресс», строки готовности и итога. */
  function summary(hist, now, goal) {
    var wk = weekStart(now), perWeek = {}, perDay = {};
    hist.forEach(function (x) {
      var w = weekStart(x.d);
      perWeek[w] = (perWeek[w] || 0) + 1;
      perDay[x.d] = (perDay[x.d] || 0) + x.r;
    });
    var met = function (w) { return (perWeek[w] || 0) >= goal; };
    // Серия: недели подряд с выполненной целью. Текущая, пока не закрыта, серию не рвёт.
    var streak = 0, w = met(wk) ? wk : shift(wk, -7);
    while (met(w)) { streak++; w = shift(w, -7); }
    // Рекорд — по всем неделям от первой записи.
    var best = 0, run = 0, first = hist.length ? weekStart(hist.reduce(function (a, x) { return x.d < a ? x.d : a; }, hist[0].d)) : wk;
    for (w = first; w <= wk; w = shift(w, 7)) { run = met(w) ? run + 1 : 0; if (run > best) best = run; }
    var grid = [];
    for (var i = 11; i >= 0; i--) {
      var col = [], ws = shift(wk, -7 * i);
      for (var j = 0; j < 7; j++) { var d = shift(ws, j); col.push({ d: d, r: perDay[d] || 0, future: d > now }); }
      grid.push(col);
    }
    var round = function (a) { a.min = Math.round(a.min); return a; };
    return {
      goal: goal, streak: streak, best: best, grid: grid,
      week: round(sum(hist.filter(function (x) { return x.d >= wk && x.d <= now; }))),
      month: round(sum(hist.filter(function (x) { return x.d.slice(0, 7) === now.slice(0, 7) && x.d <= now; }))),
      total: round(sum(hist))
    };
  }

  var api = { shift: shift, weekStart: weekStart, today: today, add: add, summary: summary };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BoxStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
