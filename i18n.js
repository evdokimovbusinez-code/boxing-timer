/* Тексты интерфейса на двух языках. t(lang, key, vars): «{n}» в строке подменяется на vars.n,
 * массив — формы множественного числа по vars.n (ru: 1 / 2–4 / 5+, en: 1 / остальные). */
(function (root) {
  'use strict';

  var DICT = {
    ru: {
      'app.title': 'Боксёрский таймер',
      'preset.spar': 'Спарринг', 'preset.pro': 'Проф', 'preset.amateur': 'Любители', 'preset.bag': 'Мешок', 'preset.tabata': 'Табата',
      'presets.aria': 'Готовые тренировки',
      'chip.voice': 'Голосом', 'settings': 'Настройки',

      'w.rounds': 'Раунды', 'w.round': 'Раунд', 'w.rest': 'Отдых', 'w.prep': 'Подготовка', 'w.warn': 'Сигнал за',
      'none': 'нет', 'unit.s': 'с',

      'ph.prep': 'ГОТОВЬСЯ', 'ph.round': 'БОКС', 'ph.rest': 'ОТДЫХ', 'ph.pause': 'ПАУЗА',
      'round.n': 'РАУНД <b>{n}</b><span>/{total}</span>', 'round.last': 'ПОСЛЕДНИЙ РАУНД', 'round.next': 'дальше', 'round.nextLast': 'ПОСЛЕДНИЙ',

      'finish': 'ФИНИШ',
      'n.rounds': ['{n} раунд', '{n} раунда', '{n} раундов'],
      'summary': '{rounds} по {len} · {min} мин бокса',
      'btn.start': 'Старт', 'btn.again': 'Ещё раз', 'btn.edit': 'Изменить', 'btn.resume': 'Продолжить', 'btn.done': 'Готово',
      'skip.finish': 'К финишу', 'skip.rest': 'К отдыху', 'skip.last': 'К последнему раунду', 'skip.round': 'К раунду {n}',
      'reset': 'Сброс', 'reset.confirm': 'Точно сбросить?',
      'pause.stomp': '{how} или коснись экрана — продолжить', 'pause.tap': 'Коснись экрана — продолжить',

      'how.double': 'топни дважды', 'how.single': 'топни',
      'total': 'тренировка ≈ {min} мин',
      'st.start': '{how} — старт', 'st.again': '{how} — ещё раз', 'st.deaf': 'топот не слушается — проверь разрешения',
      'dim.tap': 'коснись экрана',

      'meter.first': '1-й топ… давай второй', 'meter.try': 'топни — проверим', 'meter.noLow': 'не похоже на топот (нет низа)',
      'meter.model': 'модель: {verdict} {p}%', 'meter.yes': 'топ', 'meter.no': 'не топ', 'meter.hits': 'Сработало: {n}',

      'tab.workout': 'Тренировка', 'tab.sound': 'Звук', 'tab.soundTitle': 'Звук и голос',
      'tab.hands': 'Без рук', 'tab.handsTitle': 'Управление без рук', 'tab.general': 'Общее',
      'workout.hint': 'Листай пальцем. <b>Подготовка</b> — время до первого раунда. <b>Сигнал за</b> — когда до конца раунда звучит «тук-тук» и «десять секунд».',

      'opt.voice': 'Голосовой помощник', 'opt.voice.sub': 'номер раунда, «10 секунд», «отдых»', 'voice.aria': 'Голос',
      'opt.count': 'Считать вслух 5…1 в конце раунда', 'opt.half': 'Сигнал «Половина» в середине раунда', 'opt.volume': 'Громкость',
      'test': 'Проверить звук', 'test.start': 'Старт', 'test.10': '10 сек', 'test.end': 'Конец', 'test.voice': 'Голос',
      'vs.system': 'Голос iPhone тише нейроголоса.', 'vs.loading': 'Загружаю голос…',
      'vs.missing': 'Файлы голоса не найдены — пока говорю голосом iPhone.',
      'vs.download': 'Загружаю голос {p}%…', 'vs.prepare': 'Готовлю голос {p}%…',

      'hands.stomp': 'Старт и пауза топотом',
      'sm.off': 'Выкл', 'sm.mic': 'Микрофон', 'sm.motion': 'Датчик', 'sm.both': 'Оба',
      'smh.off': 'Старт и пауза — касанием экрана.',
      'smh.mic': 'Ловит глухой удар ногой по полу. Телефон можно ставить где угодно рядом.',
      'smh.motion': 'Телефон лежит на полу или помосте — ловит вибрацию от топота. Звуки зала не мешают.',
      'smh.both': 'Срабатывает, только когда удар и слышно, и чувствуется. Меньше ложных стартов, телефон на полу.',
      'sp.single': 'Один топ', 'sp.double': 'Двойной топ',
      'during': 'Пауза топотом во время тренировки', 'du.none': 'Нет', 'du.rest': 'В отдыхе', 'du.all': 'Всегда',
      'duh.noneMic': 'Микрофон выключается до конца тренировки — iPhone играет громче. Топот работает до старта и на паузе.',
      'duh.none': 'Во время тренировки топот не ставит паузу.',
      'duh.rest': 'В раунде топот не мешает, в отдыхе двойной топ — пауза.',
      'duh.all': 'Топ ставит паузу и в раунде.',
      'duh.quieter': ' Микрофон включён — iPhone чуть тише.',
      'cal.title': 'Обучить под свой топот', 'cal.btn': 'Обучить', 'cal.off': 'Топот выключен',
      'cal.none': 'Топни 5 раз и подвигайся 10 секунд', 'cal.model': 'модель ✓ ({p}%)', 'cal.thr': 'порог ✓', 'cal.motion': 'датчик ✓',
      'cal.offline': '{parts} — работает офлайн',
      'opt.sens': 'Чувствительность',
      'opt.cmd': 'Голосовые команды', 'beta': 'бета',
      'opt.cmd.sub': '«старт», «пауза», «дальше», «сброс». Микрофон один — топот тогда работает через датчик',

      'opt.lang': 'Язык',
      'opt.flip': 'Перевернуть на 180°', 'opt.flip.sub': 'если картинка вверх ногами',
      'opt.eco': 'Экономный экран', 'opt.eco.sub': 'чёрный фон, цветные цифры',
      'opt.dim': 'Гасить в ожидании через 2 мин', 'opt.dim.sub': 'экран не выключается, топот работает',

      'gate.text': 'Нажми один раз — iPhone разрешит звук, голос и датчики для топота.',
      'gate.btn': 'Включить',
      'gate.rot': 'Включи блокировку поворота в Пункте управления — таймер сам останется горизонтальным.',
      'gate.back': 'Нажми, чтобы вернуть звук — iPhone выключил его, пока таймер был в фоне.',

      'vl.prompt': 'Говори: «10 раундов по 2 минуты, отдых минута»',
      'vl.noAccess': 'Нет доступа к микрофону/речи', 'vl.again': 'Не расслышал, попробуй ещё раз',
      'vl.notUnderstood': 'Не понял. Пример: «12 раундов по 3 минуты, отдых минута»',
      'vl.unsupported': 'Распознавание речи не поддерживается. Обнови iOS или открой в Safari.',

      'cl.step1': 'Шаг 1 из 2', 'cl.setup': 'Настройка', 'cl.title1': 'Топни 5 раз',
      'cl.sub1': 'По одному, с паузой около секунды, как будешь запускать таймер. Телефон — там, где он обычно лежит.',
      'cl.step2': 'Шаг 2 из 2',
      'cl.sub2': 'Теперь НЕ топай: походи, попрыгай, побей по лапам или мешку рядом, поговори. Модель запомнит, что это не топот.',
      'cl.move': 'Двигайся: {n} с', 'cl.next': 'Дальше', 'cl.cancel': 'Отмена',
      'cl.needMode': 'Сначала выбери микрофон или датчик', 'cl.deaf': 'Топот не слушается — проверь разрешения',
      'cl.trained': 'модель обучена: {pos} топов, {neg} «не топов», точность {acc}%',
      'cl.thrOnly': 'порог настроен (для модели не хватило примеров «не топа» — подвигайся активнее на шаге 2)',
      'cl.motionOk': 'датчик настроен', 'cl.motionNo': 'датчик не почувствовал топот',
      'cl.done': 'Готово: {msg}', 'cl.fail': 'Не поймал топот — попробуй ещё раз', 'cl.reset': 'Обучение сброшено',

      't.loudOff': 'iPhone каждый раз спрашивал микрофон — теперь он не выключается на тренировку',
      't.noMicApi': 'Микрофон недоступен в этом браузере',
      't.noMic': 'Нет доступа к микрофону — разреши в Настройках iPhone или выбери «Датчик»',
      't.noMotion': 'Нет доступа к датчику движения', 't.motionAgain': 'Датчик: нажми «Включить» ещё раз',
      't.motionNA': 'Датчик движения недоступен',
      't.cmdOff': 'Голосовые команды выключены: микрофон отдан топоту',
      't.toMotion': 'Топот переключён на датчик: микрофон слушает команды',
      't.noSR': 'iPhone не дал доступ к распознаванию речи',
      't.update': 'Вышла новая версия — перезапусти таймер, когда закончишь',

      'say.prep': 'Приготовиться. {rounds}',
      'say.seconds': ['{n} секунда', '{n} секунды', '{n} секунд'],
      'say.round': 'Раунд {r}. Осталось {left}', 'say.rest': 'Отдых. До раунда {r} {left}', 'say.prepShort': 'Подготовка',
      'say.sample': 'Раунд три. Бокс!', 'say.ok': '{msg}. Готово',
      'describe': '{rounds} по {len}, отдых {rest}'
    },

    en: {
      'app.title': 'Boxing Timer',
      'preset.spar': 'Sparring', 'preset.pro': 'Pro', 'preset.amateur': 'Amateur', 'preset.bag': 'Heavy bag', 'preset.tabata': 'Tabata',
      'presets.aria': 'Workout presets',
      'chip.voice': 'Voice', 'settings': 'Settings',

      'w.rounds': 'Rounds', 'w.round': 'Round', 'w.rest': 'Rest', 'w.prep': 'Get ready', 'w.warn': 'Warning',
      'none': 'off', 'unit.s': 's',

      'ph.prep': 'GET READY', 'ph.round': 'BOX', 'ph.rest': 'REST', 'ph.pause': 'PAUSED',
      'round.n': 'ROUND <b>{n}</b><span>/{total}</span>', 'round.last': 'LAST ROUND', 'round.next': 'next', 'round.nextLast': 'LAST ROUND',

      'finish': 'DONE',
      'n.rounds': ['{n} round', '{n} rounds'],
      'summary': '{rounds} × {len} · {min} min of boxing',
      'btn.start': 'Start', 'btn.again': 'Again', 'btn.edit': 'Edit', 'btn.resume': 'Resume', 'btn.done': 'Done',
      'skip.finish': 'Finish', 'skip.rest': 'To rest', 'skip.last': 'To last round', 'skip.round': 'To round {n}',
      'reset': 'Reset', 'reset.confirm': 'Really reset?',
      'pause.stomp': '{how} or tap the screen to resume', 'pause.tap': 'Tap the screen to resume',

      'how.double': 'stomp twice', 'how.single': 'stomp',
      'total': 'workout ≈ {min} min',
      'st.start': '{how} to start', 'st.again': '{how} to go again', 'st.deaf': 'stomp isn’t listening — check permissions',
      'dim.tap': 'tap the screen',

      'meter.first': '1st stomp… now the second', 'meter.try': 'stomp to test', 'meter.noLow': 'not a stomp (no bass)',
      'meter.model': 'model: {verdict} {p}%', 'meter.yes': 'stomp', 'meter.no': 'not a stomp', 'meter.hits': 'Triggered: {n}',

      'tab.workout': 'Workout', 'tab.sound': 'Sound', 'tab.soundTitle': 'Sound & voice',
      'tab.hands': 'Hands-free', 'tab.handsTitle': 'Hands-free control', 'tab.general': 'General',
      'workout.hint': 'Swipe to change. <b>Get ready</b> — countdown before round one. <b>Warning</b> — when the knock and “ten seconds” play before the round ends.',

      'opt.voice': 'Voice coach', 'opt.voice.sub': 'round number, “ten seconds”, “rest”', 'voice.aria': 'Voice',
      'opt.count': 'Count down 5…1 out loud', 'opt.half': '“Halfway” signal mid-round', 'opt.volume': 'Volume',
      'test': 'Test sound', 'test.start': 'Start', 'test.10': '10 sec', 'test.end': 'End', 'test.voice': 'Voice',
      'vs.system': 'The iPhone voice is quieter than the neural voices.', 'vs.loading': 'Loading voice…',
      'vs.missing': 'Voice files not found — using the iPhone voice for now.',
      'vs.download': 'Downloading voice {p}%…', 'vs.prepare': 'Preparing voice {p}%…',

      'hands.stomp': 'Start and pause by stomping',
      'sm.off': 'Off', 'sm.mic': 'Mic', 'sm.motion': 'Motion', 'sm.both': 'Both',
      'smh.off': 'Start and pause by tapping the screen.',
      'smh.mic': 'Hears a dull foot stomp on the floor. The phone can be anywhere nearby.',
      'smh.motion': 'Phone lies on the floor or ring — feels the stomp vibration. Gym noise doesn’t matter.',
      'smh.both': 'Fires only when the stomp is both heard and felt. Fewer false starts; phone on the floor.',
      'sp.single': 'Single stomp', 'sp.double': 'Double stomp',
      'during': 'Pause by stomping during the workout', 'du.none': 'Never', 'du.rest': 'During rest', 'du.all': 'Always',
      'duh.noneMic': 'The mic turns off for the workout so the iPhone plays louder. Stomp works before the start and while paused.',
      'duh.none': 'Stomping doesn’t pause the workout.',
      'duh.rest': 'Ignored during rounds; during rest a double stomp pauses.',
      'duh.all': 'A stomp pauses even mid-round.',
      'duh.quieter': ' The mic stays on, so the iPhone is a bit quieter.',
      'cal.title': 'Train it on your stomp', 'cal.btn': 'Train', 'cal.off': 'Stomp is off',
      'cal.none': 'Stomp 5 times, then move around for 10 seconds', 'cal.model': 'model ✓ ({p}%)', 'cal.thr': 'threshold ✓', 'cal.motion': 'motion ✓',
      'cal.offline': '{parts} — works offline',
      'opt.sens': 'Sensitivity',
      'opt.cmd': 'Voice commands', 'beta': 'beta',
      'opt.cmd.sub': '“start”, “pause”, “next”, “reset”. One mic — stomp then uses the motion sensor',

      'opt.lang': 'Language',
      'opt.flip': 'Rotate 180°', 'opt.flip.sub': 'if the picture is upside down',
      'opt.eco': 'Battery saver screen', 'opt.eco.sub': 'black background, colored digits',
      'opt.dim': 'Dim when idle after 2 min', 'opt.dim.sub': 'screen stays on, stomp keeps working',

      'gate.text': 'Tap once — your iPhone will allow sound, voice and the stomp sensors.',
      'gate.btn': 'Enable',
      'gate.rot': 'Turn on Rotation Lock in Control Center — the timer stays in landscape on its own.',
      'gate.back': 'Tap to bring the sound back — iOS muted it while the timer was in the background.',

      'vl.prompt': 'Say: “10 rounds of 2 minutes, rest 1 minute”',
      'vl.noAccess': 'No access to the microphone or speech', 'vl.again': 'Didn’t catch that, try again',
      'vl.notUnderstood': 'Didn’t get it. Example: “12 rounds of 3 minutes, rest 1 minute”',
      'vl.unsupported': 'Speech recognition isn’t supported. Update iOS or open in Safari.',

      'cl.step1': 'Step 1 of 2', 'cl.setup': 'Setup', 'cl.title1': 'Stomp 5 times',
      'cl.sub1': 'One at a time, about a second apart, the way you’ll start the timer. Phone where it usually lies.',
      'cl.step2': 'Step 2 of 2',
      'cl.sub2': 'Now DON’T stomp: walk, jump, hit pads or the bag nearby, talk. The model learns this is not a stomp.',
      'cl.move': 'Move: {n} s', 'cl.next': 'Next', 'cl.cancel': 'Cancel',
      'cl.needMode': 'Pick microphone or motion sensor first', 'cl.deaf': 'Stomp isn’t listening — check permissions',
      'cl.trained': 'model trained: {pos} stomps, {neg} non-stomps, accuracy {acc}%',
      'cl.thrOnly': 'threshold set (not enough non-stomp examples for the model — move more in step 2)',
      'cl.motionOk': 'motion sensor tuned', 'cl.motionNo': 'motion sensor didn’t feel the stomp',
      'cl.done': 'Done: {msg}', 'cl.fail': 'Didn’t catch the stomp — try again', 'cl.reset': 'Training reset',

      't.loudOff': 'iOS kept asking for the mic — it now stays on during the workout',
      't.noMicApi': 'The microphone isn’t available in this browser',
      't.noMic': 'No microphone access — allow it in iPhone Settings or pick “Motion”',
      't.noMotion': 'No access to the motion sensor', 't.motionAgain': 'Motion sensor: tap “Enable” again',
      't.motionNA': 'Motion sensor not available',
      't.cmdOff': 'Voice commands off: the mic is used for stomping',
      't.toMotion': 'Stomp switched to the motion sensor: the mic listens for commands',
      't.noSR': 'iOS denied speech recognition',
      't.update': 'A new version is ready — restart the timer when you’re done',

      'say.prep': 'Get ready. {rounds}',
      'say.seconds': ['{n} second', '{n} seconds'],
      'say.round': 'Round {r}. {left} left', 'say.rest': 'Rest. Round {r} in {left}', 'say.prepShort': 'Get ready',
      'say.sample': 'Round three. Box!', 'say.ok': '{msg}. Done',
      'describe': '{rounds} of {len}, rest {rest}'
    }
  };

  function pluralIdx(lang, n) {
    n = Math.abs(Math.floor(n));
    if (lang === 'en') return n === 1 ? 0 : 1;
    var a = n % 100, b = n % 10;
    if (a > 10 && a < 20) return 2;
    if (b === 1) return 0;
    if (b >= 2 && b <= 4) return 1;
    return 2;
  }

  function t(lang, key, vars) {
    var d = DICT[lang] || DICT.ru, s = d.hasOwnProperty(key) ? d[key] : DICT.ru.hasOwnProperty(key) ? DICT.ru[key] : key;
    if (Array.isArray(s)) s = s[pluralIdx(lang, vars && vars.n != null ? vars.n : 0)];
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars.hasOwnProperty(k) ? vars[k] : m; }) : s;
  }

  var api = { t: t, DICT: DICT, LANGS: ['ru', 'en'] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoxI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
