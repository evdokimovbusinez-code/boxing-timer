/* Детектор ударов (топота) — чистая логика без браузерных API, чтобы её можно было тестировать.
 *
 * Как работает:
 *  - floor  — шумовой фон. Следит за минимумом: вниз быстро, вверх медленно (шум зала поднимает его за ~10 с,
 *             а короткий топот почти не сдвигает).
 *  - slow   — огибающая последних ~110 мс. Удар засчитывается, только если сигнал резко вырос относительно неё
 *             (атака), поэтому длинный громкий звук не даёт серию ложных ударов, а повторный топот
 *             ловится даже если зал ещё гудит после первого.
 */
(function (root) {
  'use strict';

  function OnsetDetector(o) {
    o = o || {};
    this.tau = o.tau || 110;            // мс, огибающая
    this.rise = o.rise || 1.8;          // во сколько раз сигнал должен превысить огибающую
    this.refractory = o.refractory || 120;
    this.floorMult = o.floorMult || 3;  // порог никогда не ниже floor × 3
    this.floorDown = o.floorDown || 0.02;
    this.floorUp = o.floorUp || 0.0015;
    this.minFloor = o.minFloor || 0.0005;
    this.dtNominal = o.dt || 12;
    this.reset(o.floor0 || 0.01);
  }
  OnsetDetector.prototype.reset = function (floor0) {
    this.slow = 0; this.floor = floor0 || this.floor || 0.01;
    this.last = -1e9; this.lastT = null;
  };
  /** v — уровень (пик за окно), t — время мс, thr — абсолютный порог. Возвращает true на ударе. */
  OnsetDetector.prototype.push = function (v, t, thr) {
    var dt = this.lastT == null ? this.dtNominal : Math.max(1, Math.min(250, t - this.lastT));
    this.lastT = t;
    var k = dt / this.dtNominal;
    var prevSlow = this.slow;
    var T = Math.max(thr, this.floor * this.floorMult);
    var hit = v > T && v > prevSlow * this.rise && t - this.last >= this.refractory;
    if (hit) this.last = t;
    this.slow += (v - this.slow) * (1 - Math.exp(-dt / this.tau));
    var rate = v < this.floor ? this.floorDown : this.floorUp;
    this.floor += (v - this.floor) * Math.min(1, rate * k);
    if (this.floor < this.minFloor) this.floor = this.minFloor;
    return hit;
  };

  /** Двойной удар: второй в окне [min, max] мс после первого. */
  function DoubleTap(min, max) { this.min = min || 90; this.max = max || 900; this.first = 0; }
  /** Возвращает 'double', 'first' или 'ignored'. */
  DoubleTap.prototype.push = function (t) {
    if (this.first) {
      var d = t - this.first;
      if (d < this.min) return 'ignored';         // отскок того же удара
      if (d <= this.max) { this.first = 0; return 'double'; }
    }
    this.first = t;
    return 'first';
  };
  DoubleTap.prototype.waiting = function (t) { return !!this.first && t - this.first <= this.max; };
  DoubleTap.prototype.clear = function () { this.first = 0; };

  /** Сборщик пиков для калибровки: каждое событие — максимум за 90 мс после атаки. */
  function PeakCollector(floorMult) { this.floorMult = floorMult || 4; this.events = []; this.ev = null; this.lastEnd = -1e9; }
  PeakCollector.prototype.push = function (v, t, floor, prevSlow) {
    if (this.ev) {
      if (v > this.ev.max) this.ev.max = v;
      if (t - this.ev.t > 90) { this.events.push(this.ev.max); this.lastEnd = t; this.ev = null; }
    } else if (v > floor * this.floorMult && v > prevSlow * 1.8 && t - this.lastEnd > 150) {
      this.ev = { t: t, max: v };
    }
  };
  /** Типичная сила удара: медиана самых сильных событий (не больше 6). */
  PeakCollector.prototype.level = function () {
    var e = this.events.slice().sort(function (a, b) { return b - a; }).slice(0, 6);
    if (e.length < 3) return null;
    e.sort(function (a, b) { return a - b; });
    return e[Math.floor(e.length / 2)];
  };

  function lerp(a, b, t) { return a + (b - a) * t; }

  /** Порог: по калибровке, если она есть, иначе — по чувствительности. second — для второго топа (тише). */
  function threshold(opts) {
    var sens = opts.sens, base;
    if (opts.cal) base = opts.cal * lerp(0.9, 0.3, sens);
    else base = Math.max(lerp(opts.absHi, opts.absLo, sens), opts.floor * lerp(14, 3.2, sens));
    return opts.second ? base * 0.65 : base;
  }

  var api = { OnsetDetector: OnsetDetector, DoubleTap: DoubleTap, PeakCollector: PeakCollector, threshold: threshold, lerp: lerp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoxDetect = api;
})(this);
