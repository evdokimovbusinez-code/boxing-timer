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

  /** Двойной удар — ровно два удара и тишина.
   *  Второй должен прийти через [min, max] мс после первого; перед первым — тишина quietBefore,
   *  после второго — тишина quietAfter. Так ритм (бочка в музыке, шаги, чужой таймер) не считается топотом.
   *  push(t) → 'first' | 'second' (ждём тишину, потом confirm) | 'ignored' | 'cancel'. */
  function DoubleTap(min, max, quietBefore, quietAfter) {
    this.min = min || 90; this.max = max || 900;
    this.quietBefore = quietBefore == null ? 500 : quietBefore;
    this.quietAfter = quietAfter == null ? 450 : quietAfter;
    this.clear();
  }
  DoubleTap.prototype.clear = function () { this.first = 0; this.second = 0; this.gap = 0; this.last = -1e9; this.beforeFirst = -1e9; };
  // Тишина вокруг пары должна быть заметно длиннее промежутка внутри неё — иначе это ритм.
  DoubleTap.prototype.quiet = function (gap, base) { return Math.max(base, gap * 1.35); };
  DoubleTap.prototype.push = function (t) {
    if (this.second) {
      if (t - this.second < this.min) return 'ignored';       // отскок второго удара
      if (t - this.second <= this.quiet(this.gap, this.quietAfter)) { this.second = 0; this.first = 0; this.last = t; return 'cancel'; } // третий — это ритм
      this.second = 0;
    }
    if (this.first) {
      var d = t - this.first;
      if (d < this.min) return 'ignored';                      // отскок того же удара
      if (d <= this.max && this.first - this.beforeFirst >= this.quiet(d, this.quietBefore)) {
        this.second = t; this.gap = d; this.first = 0; this.last = t;
        return 'second';
      }
    }
    this.beforeFirst = this.last;
    this.first = t; this.last = t;
    return 'first';
  };
  /** Сколько ждать тишины после второго удара, прежде чем подтвердить. */
  DoubleTap.prototype.confirmDelay = function () { return this.quiet(this.gap, this.quietAfter); };
  /** true — двойной топ подтверждён (после второго удара была тишина). */
  DoubleTap.prototype.confirm = function (t) {
    if (this.second && t - this.second >= this.confirmDelay() - 1) { this.second = 0; return true; }
    return false;
  };
  DoubleTap.prototype.waiting = function (t) { return !!this.first && t - this.first <= this.max; };

  /** Одиночный удар тоже должен быть отдельным, а не частью ритма. */
  function SingleTap(quietBefore, quietAfter) { this.qb = quietBefore || 900; this.qa = quietAfter || 700; this.last = -1e9; this.cand = 0; }
  SingleTap.prototype.push = function (t) {
    var isolated = t - this.last >= this.qb;
    if (this.cand && t - this.cand <= this.qa) this.cand = 0;  // второй рядом — отменяем
    else if (isolated) this.cand = t;
    this.last = t;
  };
  SingleTap.prototype.confirm = function (t) {
    if (this.cand && t - this.cand >= this.qa) { this.cand = 0; return true; }
    return false;
  };
  SingleTap.prototype.clear = function () { this.cand = 0; this.last = -1e9; };

  /** Касание экрана и вибрация самого телефона (хаптика) дают «тук» в корпусе — для микрофона и датчика
   *  он неотличим от топота. touch(t) — палец коснулся/отпустил или телефон завибрировал;
   *  blocks(t) — удар в пределах ms до или после этого (звук в корпусе может опередить событие касания). */
  function TouchGuard(ms) { this.ms = ms || 450; this.last = -1e9; }
  TouchGuard.prototype.touch = function (t) { this.last = t; };
  TouchGuard.prototype.blocks = function (t) { return Math.abs(t - this.last) < this.ms; };

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

  /* ---------- Локальная модель «топот / не топот» ----------
   * Признаки — форма спектра в момент удара (8 полос) и как быстро звук затух.
   * Модель — логистическая регрессия: обучается на телефоне за миллисекунды на примерах из калибровки
   * (топы = «да», шаги, прыжки, удары по лапам = «нет») и весит пару сотен байт.
   */
  var BANDS = [20, 80, 160, 320, 640, 1280, 2560, 5120, 10000];

  /** db — Float32Array из AnalyserNode.getFloatFrequencyData, decayDb — насколько упал уровень через 80 мс. */
  function features(db, sampleRate, fftSize, decayDb) {
    var binHz = sampleRate / fftSize, pw = new Array(BANDS.length - 1), total = 0, i, b;
    for (b = 0; b < pw.length; b++) pw[b] = 0;
    for (i = 1; i < db.length; i++) {
      var f = i * binHz;
      if (f < BANDS[0] || f >= BANDS[BANDS.length - 1]) continue;
      var v = db[i]; if (!(v > -200)) continue;
      var p = Math.pow(10, v / 10);
      for (b = 0; b < pw.length; b++) if (f < BANDS[b + 1]) { pw[b] += p; break; }
      total += p;
    }
    var out = [];
    for (b = 0; b < pw.length; b++) out.push(Math.log(pw[b] / (total + 1e-20) + 1e-6) / Math.LN10);
    out.push(Math.max(-40, Math.min(5, decayDb || 0)) / 10);
    return out;
  }
  function levelDb(db) {
    var t = 0;
    for (var i = 1; i < db.length; i++) { var v = db[i]; if (v > -200) t += Math.pow(10, v / 10); }
    return 10 * Math.log(t + 1e-20) / Math.LN10;
  }

  /** Доля низа: энергия 20–400 Гц к энергии 400–8000 Гц. У топота низ сильный, у писка, хлопка, щелчка — нет. */
  function lowHigh(db, sampleRate, fftSize) {
    var binHz = sampleRate / fftSize, lo = 0, hi = 0;
    for (var i = 1; i < db.length; i++) {
      var f = i * binHz, v = db[i];
      if (!(v > -200)) continue;
      var p = Math.pow(10, v / 10);
      if (f >= 20 && f < 400) lo += p; else if (f >= 400 && f < 8000) hi += p;
    }
    return lo / (hi + 1e-20);
  }
  var LOW_MIN = 0.25; // ниже — точно не топот

  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

  /** X — массив векторов признаков, y — 1/0. Возвращает модель или null, если примеров мало. */
  function trainModel(X, y, opt) {
    opt = opt || {};
    var n = X.length; if (!n) return null;
    var pos = y.filter(function (v) { return v === 1; }).length, neg = n - pos;
    if (pos < 3 || neg < 3) return null;
    var d = X[0].length, mean = [], std = [], j, i;
    for (j = 0; j < d; j++) {
      var m = 0; for (i = 0; i < n; i++) m += X[i][j]; m /= n;
      var v = 0; for (i = 0; i < n; i++) v += (X[i][j] - m) * (X[i][j] - m); v = Math.sqrt(v / n) || 1;
      mean.push(m); std.push(Math.max(v, 0.05));
    }
    var Z = X.map(function (x) { return x.map(function (val, k) { return (val - mean[k]) / std[k]; }); });
    var w = new Array(d).fill(0), bias = 0;
    var lr = opt.lr || 0.3, lambda = opt.lambda == null ? 0.05 : opt.lambda, iters = opt.iters || 500;
    var wp = n / (2 * pos), wn = n / (2 * neg); // баланс классов
    for (var it = 0; it < iters; it++) {
      var gw = new Array(d).fill(0), gb = 0;
      for (i = 0; i < n; i++) {
        var z = bias; for (j = 0; j < d; j++) z += w[j] * Z[i][j];
        var e = (sigmoid(z) - y[i]) * (y[i] ? wp : wn);
        for (j = 0; j < d; j++) gw[j] += e * Z[i][j];
        gb += e;
      }
      for (j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + lambda * w[j]);
      bias -= lr * gb / n;
    }
    var model = { mean: mean, std: std, w: w, b: bias };
    var correct = 0;
    for (i = 0; i < n; i++) if ((predict(model, X[i]) >= 0.5) === (y[i] === 1)) correct++;
    model.acc = correct / n; model.n = [pos, neg];
    return model;
  }
  function predict(model, x) {
    var z = model.b;
    for (var j = 0; j < model.w.length; j++) z += model.w[j] * (x[j] - model.mean[j]) / model.std[j];
    return sigmoid(z);
  }

  var api = { OnsetDetector: OnsetDetector, DoubleTap: DoubleTap, SingleTap: SingleTap, TouchGuard: TouchGuard, PeakCollector: PeakCollector, threshold: threshold, lerp: lerp,
    features: features, levelDb: levelDb, lowHigh: lowHigh, LOW_MIN: LOW_MIN, trainModel: trainModel, predict: predict, BANDS: BANDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoxDetect = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
