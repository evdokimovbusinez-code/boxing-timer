/* Режим «Груша»: готовые программы тренера — 6 целей × 4 уровня (новичок → профи).
 * Основа и источники — docs/bag-programs.md (методички AIBA, советская методика, Kamandulis 2018, Enamait, Evolve MMA).
 * Программа: раунды × длина / отдых, внутри раунда отрезки (тип, секунды, задание), задание раунда — его «тема».
 * Чистая логика без браузера (UMD): app.js, voice-phrases.js (озвучка заданий) и тесты.
 */
(function (root) {
  'use strict';

  // Серии и удары. nums — как у тренеров (1 джеб, 2 прямой, 3/4 боковые, 5/6 апперкоты, b — в корпус).
  var COMBOS = {
    jab: { ru: 'Джеб', en: 'Jab', nums: '1' },
    jab_b: { ru: 'Джеб в корпус', en: 'Jab to the body', nums: '1b' },
    cross: { ru: 'Прямой правой', en: 'Cross', nums: '2' },
    hook: { ru: 'Левый боковой', en: 'Lead hook', nums: '3' },
    hook_r: { ru: 'Правый боковой', en: 'Rear hook', nums: '4' },
    jj: { ru: 'Два джеба', en: 'Double jab', nums: '1-1' },
    onetwo: { ru: 'Двойка', en: 'One-two', nums: '1-2' },
    c23: { ru: 'Прямой и левый боковой', en: 'Cross, hook', nums: '2-3' },
    c32: { ru: 'Боковой и прямой', en: 'Hook, cross', nums: '3-2' },
    c3b3: { ru: 'Боковой в корпус и в голову', en: 'Hook to the body, hook to the head', nums: '3b-3' },
    uppers: { ru: 'Два апперкота', en: 'Two uppercuts', nums: '5-6' },
    c112: { ru: 'Два джеба и прямой', en: 'Jab, jab, cross', nums: '1-1-2' },
    c123: { ru: 'Тройка', en: 'One-two-three', nums: '1-2-3' },
    c12_3b: { ru: 'Двойка и боковой в печень', en: 'One-two, hook to the liver', nums: '1-2-3b' },
    c232: { ru: 'Прямой, боковой, прямой', en: 'Cross, hook, cross', nums: '2-3-2' },
    c632: { ru: 'Апперкот, боковой, прямой', en: 'Uppercut, hook, cross', nums: '6-3-2' },
    c5b6b3: { ru: 'Апперкоты в корпус, боковой в голову', en: 'Uppercuts to the body, hook to the head', nums: '5b-6b-3' },
    c1232: { ru: 'Тройка и прямой', en: 'One-two-three-two', nums: '1-2-3-2' },
    c1632: { ru: 'Джеб, апперкот, боковой, прямой', en: 'Jab, uppercut, hook, cross', nums: '1-6-3-2' },
    c1252: { ru: 'Двойка, апперкот, прямой', en: 'One-two, uppercut, cross', nums: '1-2-5-2' },
    d12_slip2: { ru: 'Двойка, уклон, прямой', en: 'One-two, slip, cross', nums: '1-2-уклон-2' },
    d12_roll32: { ru: 'Двойка, нырок, боковой, прямой', en: 'One-two, roll, hook, cross', nums: '1-2-нырок-3-2' },
    d123_out: { ru: 'Тройка и уход в сторону', en: 'One-two-three and step out', nums: '1-2-3-шаг' },
    fl_straight: { ru: 'Прямые без остановки', en: 'Straight punches, non-stop', nums: '1-2-1-2' },
    fl_hooks: { ru: 'Боковые без остановки', en: 'Hooks, non-stop', nums: '3-4-3-4' },
    fl_uppers: { ru: 'Апперкоты без остановки', en: 'Uppercuts, non-stop', nums: '5-6-5-6' },
    fl_body: { ru: 'Серия в корпус', en: 'Body shots, non-stop', nums: '3b-4b-5b-6b' },
    free: { ru: 'Свободно, свои серии', en: 'Free work, your own combos', nums: '' }
  };

  // Указания тренера: темп, защита, ноги, подсказки.
  var CUES = {
    shadow: { ru: 'Бой с тенью, разогреваемся', en: 'Shadow box, warm up' },
    power: { ru: 'Сильнейший удар — с ноги и корпуса', en: 'Hardest shots — from the legs and hips' },
    hard: { ru: 'Сильно!', en: 'Hard!' },
    all_out: { ru: 'Взрыв! Всё, что есть!', en: 'Explode! Everything you have!' },
    speed: { ru: 'Быстро! Скорость!', en: 'Fast! Speed!' },
    active_rest: { ru: 'Активный отдых, двигайся', en: 'Active rest, keep moving' },
    slip_roll: { ru: 'Уклон и нырок после серии', en: 'Slip and roll after each combo' },
    footwork: { ru: 'Работаем ногами вокруг мешка', en: 'Footwork around the bag' },
    pivot: { ru: 'Разворот, новый угол', en: 'Pivot, new angle' },
    step_in_out: { ru: 'Вошёл — ударил — вышел', en: 'Step in, punch, step out' },
    keep_pace: { ru: 'Держи темп', en: 'Keep the pace' },
    breathe: { ru: 'Выдох на каждый удар', en: 'Exhale on every punch' },
    finish_strong: { ru: 'Добиваем раунд!', en: 'Finish the round strong!' },
    body: { ru: 'Работаем по корпусу', en: 'Work the body' },
    easy: { ru: 'Легко, без силы', en: 'Easy, no power' },
    snap: { ru: 'Резко — и рука назад', en: 'Snap it and bring it back' },
    relax: { ru: 'Плечи расслаблены', en: 'Relax your shoulders' },
    hands_up: { ru: 'Руки у подбородка', en: 'Hands up by your chin' },
    hips: { ru: 'Вкладывай корпус', en: 'Turn your hips into it' },
    accuracy: { ru: 'Точно в одну точку', en: 'Hit the same spot' },
    stance: { ru: 'Стойка, подбородок вниз', en: 'Stance, chin down' },
    good: { ru: 'Отлично, так держать', en: 'Good, keep it up' },
    cool_down: { ru: 'Заминка, легко', en: 'Cool down, easy' },
    double_last: { ru: 'Удвой последний удар', en: 'Double up the last punch' }
  };

  var GOALS = ['power', 'endurance', 'speed', 'burst', 'technique', 'cardio'];
  var LEVELS = ['beginner', 'amateur', 'advanced', 'pro'];
  var TYPES = ['light', 'medium', 'hard', 'max', 'defense', 'footwork', 'active_rest'];

  // Раунд 1 — разминка: бой с тенью, потом задание первого раунда ('TASK' = themes[0]).
  var WARM = {
    120: [['light', 60, 'shadow'], ['light', 60, 'TASK']],
    180: [['light', 60, 'shadow'], ['light', 60, 'TASK'], ['medium', 60, 'TASK']]
  };

  function P(id, goal, level, rounds, round, rest, blocks, themes) {
    return { id: id, goal: goal, level: level, rounds: rounds, round: round, rest: rest, blocks: blocks, themes: themes };
  }
  var PROGRAMS = [
    // Сила: короткий максимум 10 с и восстановление — каждый удар в полную силу (Evolve, методика взрывной силы).
    P('power_b', 'power', 'beginner', 5, 120, 60, [['medium', 20, 'TASK'], ['hard', 10, 'power'], ['active_rest', 30, 'active_rest']],
      ['jab', 'cross', 'onetwo', 'hook', 'c123']),
    P('power_a', 'power', 'amateur', 6, 180, 60, [['medium', 20, 'TASK'], ['max', 10, 'power'], ['active_rest', 30, 'active_rest']],
      ['onetwo', 'cross', 'hook', 'c32', 'uppers', 'c123']),
    P('power_adv', 'power', 'advanced', 8, 180, 60, [['medium', 15, 'TASK'], ['max', 10, 'power'], ['footwork', 35, 'pivot']],
      ['onetwo', 'cross', 'hook', 'hook_r', 'c32', 'c632', 'c12_3b', 'c1232']),
    P('power_pro', 'power', 'pro', 10, 180, 60,
      [['medium', 20, 'TASK'], ['max', 10, 'power'], ['defense', 15, 'slip_roll'], ['footwork', 15, 'pivot']],
      ['c123', 'cross', 'hook', 'c3b3', 'c632', 'c5b6b3', 'c232', 'c1632', 'c1252', 'free']),
    // Выносливость: длинный средний темп, «добиваем» в конце раунда (бой на 73–86% аэробный; AIBA 5×3/1).
    P('endur_b', 'endurance', 'beginner', 6, 120, 60, [['light', 30, 'TASK'], ['medium', 75, 'keep_pace'], ['hard', 15, 'finish_strong']],
      ['jab', 'jj', 'onetwo', 'c112', 'c123', 'free']),
    P('endur_a', 'endurance', 'amateur', 7, 180, 60, [['medium', 90, 'TASK'], ['medium', 60, 'breathe'], ['hard', 30, 'finish_strong']],
      ['onetwo', 'c112', 'c123', 'c32', 'c12_3b', 'c1232', 'free']),
    P('endur_adv', 'endurance', 'advanced', 9, 180, 60,
      [['medium', 60, 'TASK'], ['defense', 20, 'slip_roll'], ['medium', 70, 'keep_pace'], ['hard', 30, 'finish_strong']],
      ['onetwo', 'c123', 'c232', 'c12_3b', 'c632', 'c1232', 'd12_slip2', 'c1632', 'free']),
    P('endur_pro', 'endurance', 'pro', 12, 180, 30, [['medium', 45, 'TASK'], ['hard', 15, 'keep_pace']],
      ['c123', 'onetwo', 'c112', 'c232', 'c12_3b', 'c3b3', 'c632', 'c1232', 'd12_slip2', 'c1632', 'd12_roll32', 'free']),
    // Скорость: короткие отрезки максимальной скорости, отдых не меньше отрезка (Enamait 15/15, Evolve).
    P('speed_b', 'speed', 'beginner', 5, 120, 60, [['light', 20, 'TASK'], ['hard', 10, 'speed']],
      ['jab', 'jj', 'onetwo', 'c112', 'fl_straight']),
    P('speed_a', 'speed', 'amateur', 6, 180, 60, [['light', 20, 'TASK'], ['max', 10, 'speed']],
      ['onetwo', 'jj', 'c23', 'c32', 'uppers', 'fl_straight']),
    P('speed_adv', 'speed', 'advanced', 8, 180, 60, [['light', 15, 'TASK'], ['max', 15, 'speed']],
      ['onetwo', 'c23', 'c32', 'c123', 'c232', 'uppers', 'fl_hooks', 'fl_straight']),
    P('speed_pro', 'speed', 'pro', 10, 180, 60,
      [['medium', 20, 'TASK'], ['max', 10, 'speed'], ['defense', 20, 'slip_roll'], ['max', 10, 'fl_straight']],
      ['c123', 'c23', 'c32', 'c3b3', 'c232', 'uppers', 'c632', 'c1232', 'c1632', 'free']),
    // Взрывная: 50 + 10 → 20 + 10 (Бутенко) → 10 + 5 у профи (Kamandulis: короткие «всё, что есть»).
    P('burst_b', 'burst', 'beginner', 5, 120, 60, [['light', 50, 'TASK'], ['hard', 10, 'hard']],
      ['jab', 'onetwo', 'c112', 'c123', 'fl_straight']),
    P('burst_a', 'burst', 'amateur', 6, 180, 60, [['medium', 50, 'TASK'], ['max', 10, 'all_out']],
      ['onetwo', 'c123', 'c32', 'uppers', 'c12_3b', 'fl_straight']),
    P('burst_adv', 'burst', 'advanced', 8, 180, 60, [['medium', 20, 'TASK'], ['max', 10, 'all_out']],
      ['onetwo', 'c123', 'c232', 'fl_straight', 'c632', 'fl_hooks', 'c1232', 'fl_uppers']),
    P('burst_pro', 'burst', 'pro', 10, 180, 60, [['medium', 10, 'TASK'], ['max', 5, 'all_out']],
      ['c123', 'fl_straight', 'c632', 'fl_hooks', 'c3b3', 'fl_body', 'c1232', 'fl_uppers', 'c1632', 'free']),
    // Техника: длинные отрезки на одну связку, после серии — защита и ноги.
    P('tech_b', 'technique', 'beginner', 5, 120, 60, [['light', 40, 'TASK'], ['medium', 40, 'TASK'], ['footwork', 40, 'step_in_out']],
      ['jab', 'jab_b', 'onetwo', 'c112', 'c123']),
    P('tech_a', 'technique', 'amateur', 6, 180, 60,
      [['medium', 60, 'TASK'], ['defense', 30, 'slip_roll'], ['medium', 60, 'TASK'], ['footwork', 30, 'pivot']],
      ['onetwo', 'c123', 'c32', 'c12_3b', 'c3b3', 'c1232']),
    P('tech_adv', 'technique', 'advanced', 8, 180, 60, [['medium', 45, 'TASK'], ['defense', 15, 'slip_roll']],
      ['onetwo', 'd12_slip2', 'c632', 'd12_roll32', 'c5b6b3', 'd123_out', 'c1632', 'c1252']),
    P('tech_pro', 'technique', 'pro', 10, 180, 60, [['medium', 40, 'TASK'], ['hard', 10, 'TASK'], ['footwork', 10, 'pivot']],
      ['c123', 'd12_slip2', 'c3b3', 'd12_roll32', 'c632', 'c5b6b3', 'd123_out', 'c1632', 'c1252', 'free']),
    // Кардио: плотные интервалы с короткими паузами (расход — больше в восстановлении, Scott 2019).
    P('cardio_b', 'cardio', 'beginner', 6, 120, 60,
      [['medium', 30, 'TASK'], ['hard', 15, 'fl_straight'], ['active_rest', 15, 'active_rest']],
      ['jab', 'onetwo', 'c112', 'c123', 'uppers', 'free']),
    P('cardio_a', 'cardio', 'amateur', 7, 180, 45, [['hard', 20, 'TASK'], ['active_rest', 10, 'active_rest']],
      ['onetwo', 'c123', 'fl_straight', 'c32', 'fl_hooks', 'uppers', 'fl_body']),
    P('cardio_adv', 'cardio', 'advanced', 10, 180, 45, [['hard', 30, 'TASK'], ['footwork', 15, 'footwork'], ['max', 15, 'fl_straight']],
      ['onetwo', 'c123', 'c32', 'c12_3b', 'uppers', 'c232', 'c3b3', 'c632', 'c1232', 'free']),
    P('cardio_pro', 'cardio', 'pro', 12, 180, 30,
      [['hard', 20, 'TASK'], ['max', 10, 'all_out'], ['footwork', 15, 'footwork'], ['medium', 15, 'body']],
      ['c123', 'c232', 'fl_straight', 'c3b3', 'c632', 'fl_hooks', 'c12_3b', 'c1232', 'fl_body', 'c1632', 'fl_uppers', 'free'])
  ];

  function find(goal, level) {
    for (var i = 0; i < PROGRAMS.length; i++) if (PROGRAMS[i].goal === goal && PROGRAMS[i].level === level) return PROGRAMS[i];
    return null;
  }

  /** Развернуть программу по раундам: [{ sec, segs: [{ type, sec, start, task }] }], rest, total (сек, без подготовки). */
  function expand(p) {
    if (!p) return null;
    var rounds = [];
    for (var r = 0; r < p.rounds; r++) {
      var theme = p.themes[r] || p.themes[p.themes.length - 1];
      var pattern = r === 0 && WARM[p.round] ? WARM[p.round] : null, segs = [], t = 0;
      if (pattern) {
        pattern.forEach(function (b) { segs.push({ type: b[0], sec: b[1], start: t, task: b[2] === 'TASK' ? p.themes[0] : b[2] }); t += b[1]; });
      } else {
        while (t < p.round) {
          for (var k = 0; k < p.blocks.length && t < p.round; k++) {
            var b = p.blocks[k];
            segs.push({ type: b[0], sec: b[1], start: t, task: b[2] === 'TASK' ? theme : b[2] });
            t += b[1];
          }
        }
      }
      rounds.push({ sec: p.round, segs: segs, theme: theme });
    }
    return { id: p.id, goal: p.goal, level: p.level, rest: p.rest, rounds: rounds,
      total: p.rounds * p.round + (p.rounds - 1) * p.rest };
  }

  /** Отрезок, идущий в секунду elapsed от начала раунда (0…длина). */
  function segAt(round, elapsed) {
    var segs = round.segs;
    for (var i = segs.length - 1; i >= 0; i--) if (elapsed >= segs[i].start) return { seg: segs[i], i: i, next: segs[i + 1] || null };
    return { seg: segs[0], i: 0, next: segs[1] || null };
  }

  /** Фразы для озвучки: id = 'bag_' + задание. */
  function phrases(lang) {
    var out = [];
    [COMBOS, CUES].forEach(function (dict) {
      Object.keys(dict).forEach(function (id) { out.push({ id: 'bag_' + id, text: dict[id][lang === 'en' ? 'en' : 'ru'] }); });
    });
    return out;
  }

  var api = { COMBOS: COMBOS, CUES: CUES, GOALS: GOALS, LEVELS: LEVELS, TYPES: TYPES, WARM: WARM, PROGRAMS: PROGRAMS,
    find: find, expand: expand, segAt: segAt, phrases: phrases };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BoxPrograms = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
