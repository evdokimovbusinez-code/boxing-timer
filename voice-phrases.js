/* Все фразы голосового помощника. Один список на двоих:
 *  - tools/gen_voices.py озвучивает их нейросетью (GitHub Actions) в voices/<голос>/<id>.mp3
 *  - app.js проигрывает готовые файлы офлайн, а если файла нет — читает текст системным голосом iPhone.
 */
(function (root) {
  'use strict';

  var ONES = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять',
    'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать',
    'восемнадцать', 'девятнадцать'];
  var TENS = { 2: 'двадцать', 3: 'тридцать', 4: 'сорок', 5: 'пятьдесят', 6: 'шестьдесят' };

  function words(n) {
    if (n < 20) return ONES[n];
    var t = Math.floor(n / 10), u = n % 10;
    return TENS[t] + (u ? ' ' + ONES[u] : '');
  }
  function plural(n, f) {
    var a = n % 100, b = n % 10;
    if (a > 10 && a < 20) return f[2];
    if (b === 1) return f[0];
    if (b >= 2 && b <= 4) return f[1];
    return f[2];
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  var MAX_ROUNDS = 30;
  var WARN = [5, 10, 15, 20, 30];

  function list() {
    var out = [];
    function add(id, text) { out.push({ id: id, text: text }); }
    add('prep', 'Приготовиться!');
    add('start', 'Старт!');
    add('box', 'Бокс!');
    for (var r = 1; r <= MAX_ROUNDS; r++) add('round_' + r, 'Раунд ' + words(r) + '. Бокс!');
    add('last_round', 'Последний раунд. Бокс!');
    add('stop_rest', 'Стоп! Отдых.');
    add('left_1', 'Остался последний раунд.');
    for (var n = 2; n <= MAX_ROUNDS; n++) {
      add('left_' + n, (n % 10 === 1 && n !== 11 ? 'Остался ' : 'Осталось ') + words(n) + ' ' + plural(n, ['раунд', 'раунда', 'раундов']) + '.');
    }
    WARN.forEach(function (s) { add('warn_' + s, cap(words(s)) + ' ' + plural(s, ['секунда', 'секунды', 'секунд']) + '!'); });
    for (var k = 1; k <= MAX_ROUNDS; k++) add('ready_' + k, 'Готовимся, раунд ' + words(k) + '.');
    add('ready_last', 'Готовимся, последний раунд.');
    add('half', 'Половина!');
    for (var c = 1; c <= 5; c++) add('cnt_' + c, cap(words(c)) + '!');
    add('pause', 'Пауза.');
    add('resume', 'Продолжаем!');
    add('reset', 'Сброс.');
    add('finish', 'Тренировка окончена. Отличная работа!');
    return out;
  }

  var api = { list: list, words: words, plural: plural, MAX_ROUNDS: MAX_ROUNDS, WARN: WARN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoxPhrases = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
