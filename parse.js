/* Разбор голосовых фраз на русском: «10 раундов по 2 минуты, отдых минута». */
(function (root) {
  'use strict';

  var UNITS = {
    'ноль': 0, 'один': 1, 'одна': 1, 'одну': 1, 'одной': 1, 'одного': 1,
    'два': 2, 'две': 2, 'двух': 2, 'три': 3, 'трех': 3, 'четыре': 4, 'четырех': 4,
    'пять': 5, 'пяти': 5, 'шесть': 6, 'шести': 6, 'семь': 7, 'семи': 7,
    'восемь': 8, 'восьми': 8, 'девять': 9, 'девяти': 9, 'десять': 10, 'десяти': 10,
    'одиннадцать': 11, 'двенадцать': 12, 'тринадцать': 13, 'четырнадцать': 14,
    'пятнадцать': 15, 'шестнадцать': 16, 'семнадцать': 17, 'восемнадцать': 18,
    'девятнадцать': 19
  };
  var TENS = { 'двадцать': 20, 'тридцать': 30, 'сорок': 40, 'пятьдесят': 50, 'шестьдесят': 60, 'девяносто': 90 };
  var HALF = { 'полторы': 1.5, 'полтора': 1.5, 'полутора': 1.5 };

  function isMin(w) { return /^мин(ут[а-я]*)?$/.test(w); }
  function isSec(w) { return /^сек(унд[а-я]*)?$/.test(w); }
  function kindOf(w) {
    if (/^(раунд|бо[йяеию]$|боев|бокс|работ|спарр|схват)/.test(w)) return 'round';
    if (/^(отдых|перерыв|пауз|передыш)/.test(w)) return 'rest';
    if (/^(подготов|разминк)/.test(w)) return 'prep';
    if (/^(предупрежд|сигнал)/.test(w)) return 'warn';
    return null;
  }

  function tokenize(text) {
    var s = String(text || '').toLowerCase().replace(/ё/g, 'е');
    s = s.replace(/(\d+):(\d{2})/g, function (m, a, b) { return ' ' + (+a + (+b) / 60) + ' мин '; });
    s = s.replace(/(\d),(\d)/g, '$1.$2');
    s = s.replace(/пол\s?минуты/g, ' 30 сек ');
    s = s.replace(/([а-я])(\d)/g, '$1 $2').replace(/(\d)([а-я])/g, '$1 $2');
    var words = s.split(/[^0-9a-zа-я.]+/).map(function (w) { return w.replace(/^\.+|\.+$/g, ''); }).filter(Boolean);
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i], n = null;
      if (/^\d+(\.\d+)?$/.test(w)) n = parseFloat(w);
      else if (HALF.hasOwnProperty(w)) n = HALF[w];
      else if (TENS.hasOwnProperty(w)) {
        n = TENS[w];
        var nx = words[i + 1];
        if (nx && UNITS.hasOwnProperty(nx) && UNITS[nx] < 10) { n += UNITS[nx]; i++; }
      } else if (UNITS.hasOwnProperty(w)) n = UNITS[w];

      if (n !== null) {
        if (words[i + 1] === 'с' && /^половин/.test(words[i + 2] || '')) { n += 0.5; i += 2; }
        out.push({ t: 'num', v: n });
      } else {
        out.push({ t: 'w', v: w });
      }
    }
    return out;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /** Возвращает {rounds, roundSec, restSec, prepSec, warnSec} — только найденные поля. */
  function parseWorkout(text) {
    var tk = tokenize(text);
    var res = {};
    var items = [];
    for (var i = 0; i < tk.length; i++) {
      var t = tk[i];
      if (t.t === 'num') {
        var nx = tk[i + 1];
        if (nx && nx.t === 'w') {
          if (isMin(nx.v)) {
            var q = { type: 'q', sec: Math.round(t.v * 60), i: i, j: i + 1 };
            i++;
            if (tk[i + 1] && tk[i + 1].t === 'num' && tk[i + 2] && tk[i + 2].t === 'w' && isSec(tk[i + 2].v)) {
              q.sec += Math.round(tk[i + 1].v); q.j = i + 2; i += 2;
            }
            items.push(q);
            continue;
          }
          if (isSec(nx.v)) { items.push({ type: 'q', sec: Math.round(t.v), i: i, j: i + 1 }); i++; continue; }
          if (/^раунд/.test(nx.v)) { res.rounds = Math.round(t.v); items.push({ type: 'kw', kind: 'round', i: i + 1, count: true }); i++; continue; }
        }
        items.push({ type: 'n', v: t.v, i: i, j: i });
        continue;
      }
      if (isMin(t.v)) { items.push({ type: 'q', sec: 60, i: i, j: i }); continue; }
      if (isSec(t.v)) continue;
      var k = kindOf(t.v);
      if (k) items.push({ type: 'kw', kind: k, i: i });
    }

    function isQty(it) { return it && (it.type === 'q' || it.type === 'n'); }

    for (var x = 0; x < items.length; x++) {
      var it = items[x];
      if (!isQty(it)) continue;
      var next = items[x + 1], after = items[x + 2];
      var prev = null;
      for (var p = x - 1; p >= 0; p--) { if (items[p].type === 'kw') { prev = items[p]; break; } }

      var kind = null;
      var postfix = next && next.type === 'kw' && !next.count && next.i <= it.j + 2 &&
        !(isQty(after) && after.i <= next.i + 2);
      if (postfix) kind = next.kind;
      else if (prev) kind = prev.kind;
      else if (it.type === 'q') kind = 'round';
      if (!kind) continue;

      var sec = it.sec;
      if (it.type === 'n') {
        if (kind === 'prep' || kind === 'warn') sec = Math.round(it.v);
        else sec = it.v <= 10 ? Math.round(it.v * 60) : Math.round(it.v);
      }
      if (kind === 'round') res.roundSec = sec;
      else if (kind === 'rest') res.restSec = sec;
      else if (kind === 'prep') res.prepSec = sec;
      else if (kind === 'warn') res.warnSec = sec;
    }

    if (res.rounds != null) res.rounds = clamp(res.rounds, 1, 30);
    if (res.roundSec != null) res.roundSec = clamp(res.roundSec, 10, 1200);
    if (res.restSec != null) res.restSec = clamp(res.restSec, 0, 600);
    if (res.prepSec != null) res.prepSec = clamp(res.prepSec, 0, 120);
    if (res.warnSec != null) res.warnSec = clamp(res.warnSec, 0, 60);
    return res;
  }

  /** Голосовые команды управления. */
  function parseCommand(text) {
    var s = String(text || '').toLowerCase().replace(/ё/g, 'е');
    if (/(сброс|заново|отмен)/.test(s)) return 'reset';
    if (/(дальше|пропуст|скип|следующ)/.test(s)) return 'skip';
    if (/(продолж)/.test(s)) return 'resume';
    if (/(пауз|подожд|стоп|(^|[^а-я])стой($|[^а-я]))/.test(s)) return 'pause';
    if (/(старт|поехали|погнали|начина|начали|начать|вперед|(^|[^а-я])го($|[^а-я]))/.test(s)) return 'start';
    return null;
  }

  function plural(n, f) {
    n = Math.abs(Math.floor(n));
    var a = n % 100, b = n % 10;
    if (a > 10 && a < 20) return f[2];
    if (b === 1) return f[0];
    if (b >= 2 && b <= 4) return f[1];
    return f[2];
  }

  /** Длительность словами для озвучки (именительный падеж). */
  function durWords(sec) {
    sec = Math.round(sec);
    if (sec === 90) return 'полторы минуты';
    var m = Math.floor(sec / 60), s = sec % 60, parts = [];
    if (m === 1) parts.push('минута');
    else if (m === 2) parts.push('две минуты');
    else if (m > 0) parts.push(m + ' ' + plural(m, ['минута', 'минуты', 'минут']));
    if (s > 0) parts.push(s + ' ' + plural(s, ['секунда', 'секунды', 'секунд']));
    if (!parts.length) return 'без отдыха';
    return parts.join(' ');
  }

  var api = { tokenize: tokenize, parseWorkout: parseWorkout, parseCommand: parseCommand, plural: plural, durWords: durWords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoxParse = api;
})(this);
