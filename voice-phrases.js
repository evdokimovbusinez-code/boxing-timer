/* Все фразы голосового помощника — только важное: номер раунда, «10 секунд», счёт 5…1, сколько осталось, финиш. Один список на двоих:
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

  var EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  var EN_TENS = { 2: 'twenty', 3: 'thirty', 4: 'forty', 5: 'fifty', 6: 'sixty' };
  function wordsEn(n) {
    if (n < 20) return EN_ONES[n];
    var t = Math.floor(n / 10), u = n % 10;
    return EN_TENS[t] + (u ? '-' + EN_ONES[u] : '');
  }

  var MAX_ROUNDS = 30;
  var WARN = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]; // все значения колеса «Сигнал за»

  /** Фразы на языке lang ('ru' по умолчанию или 'en'). id одинаковые — приложению всё равно, на каком языке файл. */
  // Задания тренера для режима «Груша» — из programs.js (там же, где программы, чтобы словарь не разъехался).
  var BP = root.BoxPrograms || (typeof require === 'function' ? require('./programs.js') : null);

  function list(lang) {
    return (lang === 'en' ? listEn() : listRu()).concat(BP ? BP.phrases(lang === 'en' ? 'en' : 'ru') : []);
  }

  function listRu() {
    var out = [];
    function add(id, text) { out.push({ id: id, text: text }); }
    add('prep', 'Приготовиться!');
    add('box', 'Бокс!');
    for (var r = 1; r <= MAX_ROUNDS; r++) add('round_' + r, 'Раунд ' + words(r) + '. Бокс!');
    add('last_round', 'Последний раунд. Бокс!');
    add('stop_rest', 'Стоп! Отдых.');
    add('left_1', 'Остался последний раунд.');
    for (var n = 2; n <= MAX_ROUNDS; n++) {
      add('left_' + n, (n % 10 === 1 && n !== 11 ? 'Остался ' : 'Осталось ') + words(n) + ' ' + plural(n, ['раунд', 'раунда', 'раундов']) + '.');
    }
    WARN.forEach(function (s) { add('warn_' + s, cap(words(s)) + ' ' + plural(s, ['секунда', 'секунды', 'секунд']) + '!'); });
    add('half', 'Половина!');
    for (var c = 1; c <= 5; c++) add('cnt_' + c, cap(words(c)) + '!');
    add('ok', 'Готово!');
    add('finish', 'Тренировка окончена. Отличная работа!');
    return out;
  }

  function listEn() {
    var out = [];
    function add(id, text) { out.push({ id: id, text: text }); }
    add('prep', 'Get ready!');
    add('box', 'Box!');
    for (var r = 1; r <= MAX_ROUNDS; r++) add('round_' + r, 'Round ' + wordsEn(r) + '. Box!');
    add('last_round', 'Last round. Box!');
    add('stop_rest', 'Stop! Rest.');
    add('left_1', 'One round left.');
    for (var n = 2; n <= MAX_ROUNDS; n++) add('left_' + n, cap(wordsEn(n)) + ' rounds left.');
    WARN.forEach(function (s) { add('warn_' + s, cap(wordsEn(s)) + ' seconds!'); });
    add('half', 'Halfway!');
    for (var c = 1; c <= 5; c++) add('cnt_' + c, cap(wordsEn(c)) + '!');
    add('ok', 'Done!');
    add('finish', 'Workout complete. Great job!');
    return out;
  }

  var api = { list: list, words: words, plural: plural, MAX_ROUNDS: MAX_ROUNDS, WARN: WARN, LANGS: ['ru', 'en'] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoxPhrases = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
