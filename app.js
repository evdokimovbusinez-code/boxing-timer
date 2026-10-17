/* Боксёрский таймер — iPhone, всегда горизонтально, нейроголос, топот с локальной моделью. Работает офлайн. */
(function () {
  'use strict';

  var P = window.BoxParse, D = window.BoxDetect, PH = window.BoxPhrases, I = window.BoxI18n, BP = window.BoxPrograms, ST = window.BoxStats;
  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return performance.now(); };
  // Внутри приложения для iPhone (обёртка Capacitor, папка ios/): экран, поворот и звук держит сам iOS, хаптика — нативная.
  var NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  /* ================= Настройки ================= */
  var DEFAULTS = {
    rounds: 10, roundSec: 120, restSec: 60, prepSec: 10, warnSec: 10,
    lang: 'ru', voice: true, volume: 1.4, loudRounds: true,
    countVoice: true, halfVoice: false, sndStart: 'r_start', sndEnd: 'r_end', sndWarn: 'clapper', tickSec: 5, font: 'rounded', rev: 5,
    mode: 'spar', bagGoal: 'burst', bagLevel: 'amateur',
    stompMode: 'mic', stompPattern: 'double', stompInRound: false, sens: 0.55,
    calMic: null, calMotion: null, stompModel: null,
    commands: false, flip: false, eco: false, dimIdle: true,
    weekGoal: 3, remind: false, remindDays: [2, 4, 6], remindTime: '19:00' // дни — как в iOS: 1 = воскресенье
  };
  var PRESETS = [
    { key: 'preset.spar', rounds: 10, roundSec: 120, restSec: 60 },
    { key: 'preset.pro', rounds: 12, roundSec: 180, restSec: 60 },
    { key: 'preset.amateur', rounds: 3, roundSec: 180, restSec: 60 },
    { key: 'preset.tabata', rounds: 8, roundSec: 20, restSec: 10 }
  ];
  // Добровольная поддержка: ссылка на оплату (банка Monobank / Ko-fi / PayPal). Пусто — кнопки в настройках нет.
  var DONATE_URL = 'https://send.monobank.ua/jar/74AZz4fCCG';
  var KEY = 'boxing-timer.settings.v1';
  var S = Object.assign({}, DEFAULTS);
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (saved) Object.assign(S, saved);
  // Владелец: «54321 — да». Счёт голосом теперь включён у всех, кто не менял настройки после этого.
  if (saved && !(saved.rev >= 3)) { S.countVoice = true; S.rev = 3; }
  // Владелец: синтезированные сигналы «тупые». Кто не выбирал сам — переводим на записанные звонок и гонг ринга.
  if (saved && !(saved.rev >= 4)) {
    if (S.sndStart === 'bell') S.sndStart = 'r_bell';
    if (S.sndEnd === 'gong') S.sndEnd = 'r_gong';
    S.rev = 4;
  }
  // Владелец прислал свои звонки на старт и конец раунда — ставим всем, кто не выбирал сигнал сам.
  if (saved && !(saved.rev >= 5)) {
    if (S.sndStart === 'r_bell') S.sndStart = 'r_start';
    if (S.sndEnd === 'r_gong') S.sndEnd = 'r_end';
    S.rev = 5;
  }
  // Язык: у тех, кто уже пользовался, — русский как был; новому — по языку телефона.
  if (!saved || !saved.lang) S.lang = saved ? 'ru' : (/^ru|^uk|^be|^kk/i.test(navigator.language || 'ru') ? 'ru' : 'en');
  /** Текст интерфейса на текущем языке. */
  function L(k, v) { return I.t(S.lang, k, v); }
  // Голос один — Артём (на русском и английском). Выбора нет: владелец хочет только его.
  var curVoice = function () { return S.lang === 'en' ? 'voicer-en' : 'voicer'; };
  if (S.volume < 0.4) S.volume = 0.4;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  /* ================= История тренировок (только на телефоне) — для «Прогресса», серии и напоминаний ================= */
  var HKEY = 'boxing-timer.history.v1';
  var Hist = {
    list: (function () { try { return JSON.parse(localStorage.getItem(HKEY) || '[]') || []; } catch (e) { return []; } })(),
    add: function (rec) {
      this.list = ST.add(this.list, rec, rec.d);
      try { localStorage.setItem(HKEY, JSON.stringify(this.list)); } catch (e) {}
    },
    sum: function () { return ST.summary(this.list, ST.today(), S.weekGoal); }
  };

  /* Виджет на экране «Домой» (только приложение, ios/App/Widget): отдаём раунды по дням и тренировки по неделям —
     неделю и серию виджет считает сам по сегодняшней дате. Пишет мост WidgetBridge в общую папку App Group. */
  var Widget = {
    sync: function () {
      if (!NATIVE) return;
      var days = {}, weeks = {};
      Hist.list.forEach(function (h) { days[h.d] = (days[h.d] || 0) + h.r; var w = ST.weekStart(h.d); weeks[w] = (weeks[w] || 0) + 1; });
      var json = JSON.stringify({ goal: S.weekGoal, best: Hist.sum().best, days: days, weeks: weeks, t: { streak: L('wg.streak'), week: L('wg.week') } });
      try { window.Capacitor.nativePromise('WidgetBridge', 'save', { json: json }).catch(function () {}); } catch (e) {}
    }
  };

  /* Напоминания — только в приложении (локальные уведомления iOS, без сервера). По дням недели в выбранное время;
     текст — про серию, переписываем после каждой тренировки и при запуске. */
  var Remind = {
    P: function () { var C = window.Capacitor; return NATIVE && C && C.Plugins && C.Plugins.LocalNotifications; },
    ok: function () { return !!this.P(); },
    sync: function () {
      var P = this.P(); if (!P) return;
      var ids = [1, 2, 3, 4, 5, 6, 7].map(function (d) { return { id: 100 + d }; });
      P.cancel({ notifications: ids }).catch(function () {}).then(function () {
        if (!S.remind || !S.remindDays.length) return;
        var t = S.remindTime.split(':'), x = Hist.sum();
        var body = x.streak ? L('rem.streak', { n: x.streak }) : L('rem.go');
        return P.schedule({ notifications: S.remindDays.map(function (d) {
          return { id: 100 + d, title: L('rem.title'), body: body, schedule: { on: { weekday: d, hour: +t[0], minute: +t[1] }, allowWhileIdle: true } };
        }) });
      }).catch(function () {});
    },
    all: function () { this.sync(); Widget.sync(); },
    enable: function (on, done) {
      var P = this.P(), self = this;
      if (!on || !P) { S.remind = false; save(); self.sync(); return done(); }
      P.requestPermissions().then(function (r) {
        S.remind = r.display === 'granted';
        if (!S.remind) UI.toast(L('rem.denied'));
      }).catch(function () { S.remind = false; }).then(function () { save(); self.sync(); done(); });
    }
  };

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }
  var lerp = D.lerp;
  // Открыто «с экрана Домой» (на весь экран), а не во вкладке Safari.
  function standalone() { return NATIVE || navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches); }

  /* ================= Звук: громкий тракт + синтез сигналов ================= */
  var Sound = {
    ctx: null, master: null, voiceBus: null, noise: null,
    init: function () {
      if (this.ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var c = this.ctx = new AC({ latencyHint: 'playback' });
      // master → компрессор → усиление → лимитер → мягкое ограничение: громко и без хрипа
      this.master = c.createGain(); this.master.gain.value = S.volume;
      var comp = c.createDynamicsCompressor();
      comp.threshold.value = -22; comp.knee.value = 6; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.15;
      var makeup = c.createGain(); makeup.gain.value = 2.4;
      var lim = c.createDynamicsCompressor();
      lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06;
      var shaper = c.createWaveShaper(), n = 2048, curve = new Float32Array(n), k = 1.4, norm = Math.tanh(k);
      for (var i = 0; i < n; i++) { var x = i * 2 / (n - 1) - 1; curve[i] = Math.tanh(k * x) / norm * 0.98; }
      shaper.curve = curve;
      this.master.connect(comp); comp.connect(makeup); makeup.connect(lim); lim.connect(shaper); shaper.connect(c.destination);
      this.voiceBus = c.createGain(); this.voiceBus.gain.value = 1.15; this.voiceBus.connect(this.master);
      var len = c.sampleRate * 0.5;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      var d = this.noise.getChannelData(0);
      for (var j = 0; j < len; j++) d[j] = Math.random() * 2 - 1;
    },
    unlock: function () {
      this.init();
      if (!this.ctx) return Promise.resolve();
      this.decodeSamples();
      var b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      return this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume().catch(function () {});
    },
    setVolume: function (v) { if (this.master) this.master.gain.value = v; },
    mark: function (sec) { Stomp.muteFor(sec * 1000 + 250); },

    // Металлический удар. Обертоны подобраны под динамик телефона: он не играет ниже ~400 Гц.
    strike: function (t, f0, partials, decay, gain) {
      var c = this.ctx;
      partials.forEach(function (p, i) {
        var o = c.createOscillator(), g = c.createGain();
        o.frequency.value = f0 * p[0];
        var d = decay / (1 + i * 0.35);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain * p[1], t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g); g.connect(Sound.master);
        o.start(t); o.stop(t + d + 0.05);
      });
      var nz = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain();
      nz.buffer = this.noise; bp.type = 'bandpass'; bp.frequency.value = Math.min(6000, f0 * 3); bp.Q.value = 2;
      ng.gain.setValueAtTime(gain * 0.6, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      nz.connect(bp); bp.connect(ng); ng.connect(this.master); nz.start(t); nz.stop(t + 0.06);
    },
    BELL: [[1, 0.9], [2.0, 0.5], [2.76, 0.7], [5.4, 0.35], [8.93, 0.18]],
    GONG: [[1, 0.7], [1.004, 0.5], [1.5, 0.45], [2.0, 0.7], [2.92, 0.55], [4.07, 0.4], [5.2, 0.25], [6.8, 0.12]],

    // Сигналы на выбор (Настройки → Звук). Возвращает длительность в мс — голос вступает после сигнала.
    // r_* — настоящие записи (sounds/*.mp3, свободные лицензии — sounds/LICENSES.md); нет файла — их не видно в выборе.
    SIGNALS: ['r_start', 'r_end', 'r_bell', 'r_gong', 'r_whistle', 'r_horn', 'r_sticks', 'bell', 'ding', 'gong', 'whistle', 'horn', 'clapper', 'beeps', 'none'],
    SAMPLES: ['r_start', 'r_end', 'r_bell', 'r_gong', 'r_whistle', 'r_horn', 'r_sticks', 'tick'],
    raw: {}, buf: {},
    // Записи скачиваем сразу, раскодируем, когда есть звук (AudioContext).
    loadSamples: function () {
      var self = this;
      this.SAMPLES.forEach(function (n) {
        // В приложении (Capacitor) mp3 приходят со status 0 — это не ошибка.
        fetch('sounds/' + n + '.mp3').then(function (r) { return r.ok || r.status === 0 ? r.arrayBuffer() : null; })
          .then(function (ab) { if (ab && ab.byteLength) { self.raw[n] = ab; self.decodeSamples(); } })
          .catch(function () {});
      });
    },
    decodeSamples: function () {
      var self = this;
      if (!this.ctx) return;
      Object.keys(this.raw).forEach(function (n) {
        if (self.buf[n] || self.raw[n].pending) return;
        self.raw[n].pending = true;
        try {
          self.ctx.decodeAudioData(self.raw[n].slice(0), function (b) { self.buf[n] = b; if (typeof UI !== 'undefined') UI.syncOpts(); }, function () {});
        } catch (e) {}
      });
    },
    has: function (name) { return name.indexOf('r_') !== 0 || !!this.raw[name]; },
    sample: function (name, t, gain) {
      var c = this.ctx, b = this.buf[name];
      if (!b) return 0;
      var s = c.createBufferSource(), g = c.createGain();
      s.buffer = b; g.gain.value = gain == null ? 1 : gain;
      s.connect(g); g.connect(this.master); s.start(t);
      return b.duration;
    },
    play: function (name) {
      if (!this.ctx || !name || name === 'none') return 0;
      if (this.ctx.state !== 'running') this.ctx.resume().catch(function () {});
      var t = this.ctx.currentTime + 0.03, self = this, len = 0;
      // Запись ещё не готова (или файла нет) — играем похожий синтезированный сигнал.
      if (name.indexOf('r_') === 0) {
        len = this.sample(name, t, 1);
        if (!len) return this.play({ r_start: 'bell', r_end: 'gong', r_bell: 'bell', r_gong: 'gong', r_whistle: 'whistle', r_horn: 'horn', r_sticks: 'clapper' }[name]);
        // Голос вступает, когда основной удар отзвучал, — не ждём весь хвост гонга.
        len = Math.min(len, 1.8);
      }
      switch (name) {
        case 'bell': // три быстрых высоких «дзынь» — как звонок на ринге
          [0, 0.28, 0.56].forEach(function (dt) { self.strike(t + dt, 1320, self.BELL, 1.2, 0.7); });
          len = 0.75; break;
        case 'ding': // один долгий удар колокола
          this.strike(t, 880, this.BELL, 2.4, 0.95);
          len = 0.6; break;
        case 'gong': // два протяжных «донг»
          this.strike(t, 330, this.GONG, 2.8, 0.9);
          this.strike(t + 0.8, 330, this.GONG, 2.4, 0.8);
          len = 1.15; break;
        case 'whistle': this.whistle(t, 0.75); len = 0.8; break;
        case 'horn': this.horn(t, 0.9); len = 0.95; break;
        case 'clapper': // «тук-тук-тук»
          [0, 0.13, 0.26].forEach(function (dt) { self.knock(t + dt); });
          len = 0.35; break;
        case 'beeps': [0, 0.22, 0.44].forEach(function (dt) { self.tone(t + dt, 1760, 0.15, 0.8); }); len = 0.6; break;
        case 'finish': // конец тренировки — гонг трижды
          [0, 0.75, 1.5].forEach(function (dt) { self.strike(t + dt, 300, self.GONG, 2.8, 0.9); });
          len = 2; break;
        case 'beep': this.tone(t, 1760, 0.17, 0.75); len = 0.2; break;
        case 'beepHigh': this.tone(t, 2093, 0.17, 0.75); len = 0.2; break;
        case 'blip': this.tone(t, 1400, 0.06, 0.4); this.tone(t + 0.07, 1900, 0.08, 0.4); len = 0.15; break;
        case 'pauseTone': this.tone(t, 1900, 0.07, 0.4); this.tone(t + 0.08, 1300, 0.1, 0.4); len = 0.2; break;
        case 'tick': // тиканье последних секунд; под голосом — тише, чтобы не мешать
          if (!this.sample('tick', t, Voice.isSpeaking() ? 0.35 : 0.9)) this.knock(t);
          len = 0.1; break;
      }
      this.mark(len + 0.6); // пока звучит свой сигнал, топот не слушаем
      return Math.round(len * 1000);
    },
    // Свисток рефери: высокий тон с быстрой трелью и немного «дыхания».
    whistle: function (t, dur) {
      var c = this.ctx, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
      o.frequency.value = 2900; lfo.frequency.value = 26; lg.gain.value = 140;
      lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.75, t + 0.02);
      g.gain.setValueAtTime(0.75, t + dur - 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
      var nz = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain();
      nz.buffer = this.noise; nz.loop = true; bp.type = 'bandpass'; bp.frequency.value = 2900; bp.Q.value = 6;
      ng.gain.setValueAtTime(0.25, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      nz.connect(bp); bp.connect(ng); ng.connect(this.master); nz.start(t); nz.stop(t + dur);
    },
    // Гудок, как сирена в зале: два тона, жёсткий тембр.
    horn: function (t, dur) {
      var c = this.ctx, self = this;
      [523, 784].forEach(function (f) {
        var o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
        o.type = 'square'; o.frequency.value = f;
        lp.type = 'lowpass'; lp.frequency.value = 3200;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.32, t + 0.015);
        g.gain.setValueAtTime(0.32, t + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(lp); lp.connect(g); g.connect(self.master); o.start(t); o.stop(t + dur + 0.02);
      });
    },
    knock: function (t) {
      var c = this.ctx;
      var nz = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
      nz.buffer = this.noise; bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 5;
      g.gain.setValueAtTime(2.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      nz.connect(bp); bp.connect(g); g.connect(this.master); nz.start(t); nz.stop(t + 0.07);
      var o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(1300, t); o.frequency.exponentialRampToValueAtTime(850, t + 0.05);
      og.gain.setValueAtTime(0.8, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.08);
    },
    tone: function (t, f, dur, gain) {
      var c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.008);
      g.gain.setValueAtTime(gain, t + dur - 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    }
  };

  /* ================= Нейроголос: готовые файлы, офлайн ================= */
  var TEXTS = {};
  function loadTexts() { TEXTS = {}; PH.list(S.lang).forEach(function (p) { TEXTS[p.id] = p.text; }); }
  loadTexts();
  var speechLang = function () { return S.lang === 'en' ? 'en-US' : 'ru-RU'; };

  var Clips = {
    voiceId: null, raw: {}, buf: {}, total: 0, loading: false, active: [], gen: 0,
    // Скачиваем файлы голоса (они кэшируются для офлайна) и раскодируем, когда звук уже включён.
    load: function (id) {
      var self = this, gen = ++this.gen;
      this.voiceId = id; this.raw = {}; this.buf = {}; this.total = 0;
      if (!id || id === 'system') { UI.voiceStatus(); return Promise.resolve(); }
      this.loading = true; UI.voiceStatus();
      return fetch('voices/' + id + '/manifest.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (m) {
          var ids = Object.keys(m.clips || {});
          self.total = ids.length;
          var i = 0;
          var next = function () {
            if (gen !== self.gen) return null;
            if (i >= ids.length) return null;
            var cid = ids[i++];
            // В приложении (Capacitor) mp3 приходят ответом без HTTP-статуса (status 0) — это не ошибка.
            return fetch('voices/' + id + '/' + cid + '.mp3').then(function (r) { return r.ok || r.status === 0 ? r.arrayBuffer() : null; })
              .then(function (ab) { if (ab && ab.byteLength && gen === self.gen) { self.raw[cid] = ab; return self.decode(cid); } })
              .catch(function () {})
              .then(function () { if (i % 12 === 0) UI.voiceStatus(); return next(); });
          };
          return Promise.all([next(), next(), next()]);
        })
        .catch(function () {})
        .then(function () { if (gen === self.gen) { self.loading = false; UI.voiceStatus(); } });
    },
    decode: function (cid) {
      var self = this, ab = this.raw[cid];
      if (!ab || !Sound.ctx || this.buf[cid]) return Promise.resolve();
      return new Promise(function (res) {
        try {
          Sound.ctx.decodeAudioData(ab.slice(0), function (b) { self.buf[cid] = b; res(); }, function () { res(); });
        } catch (e) { res(); }
      });
    },
    decodeAll: function () {
      var self = this;
      return Object.keys(this.raw).reduce(function (p, cid) { return p.then(function () { return self.decode(cid); }); }, Promise.resolve())
        .then(function () { UI.voiceStatus(); });
    },
    count: function () { return Object.keys(this.buf).length; },
    ready: function (ids) {
      if (!ids.length || !Sound.ctx || !this.voiceId || this.voiceId === 'system') return false;
      for (var i = 0; i < ids.length; i++) if (!this.buf[ids[i]]) return false;
      return true;
    },
    play: function (ids) {
      var c = Sound.ctx, t = c.currentTime + 0.03, self = this;
      if (c.state !== 'running') c.resume().catch(function () {});
      this.stop();
      ids.forEach(function (id, k) {
        var s = c.createBufferSource(); s.buffer = self.buf[id];
        s.connect(Sound.voiceBus); s.start(t);
        self.active.push(s);
        s.onended = function () { var j = self.active.indexOf(s); if (j >= 0) self.active.splice(j, 1); };
        t += self.buf[id].duration + (k < ids.length - 1 ? 0.12 : 0);
      });
      return t - c.currentTime;
    },
    stop: function () { this.active.forEach(function (s) { try { s.stop(); } catch (e) {} }); this.active = []; }
  };

  /* ================= Голос: нейрофайлы, иначе системный голос iPhone ================= */
  var Voice = {
    sysVoice: null, speaking: false, speakingUntil: 0, quietUntil: 0, sysVoices: [],
    timer: null, keep: [],
    supported: 'speechSynthesis' in window,
    isSpeaking: function () { return now() < this.speakingUntil; },
    loadSystem: function () {
      if (!this.supported) return;
      var all = speechSynthesis.getVoices() || [];
      var re = S.lang === 'en' ? /^en/i : /^ru/i;
      this.sysVoices = all.filter(function (v) { return re.test(v.lang); });
      this.sysVoice =
        this.sysVoices.find(function (v) { return /premium|enhanced|улучш/i.test(v.name); }) || this.sysVoices[0] || null;
    },
    unlock: function () {
      if (!this.supported) return;
      var u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = speechLang();
      speechSynthesis.speak(u);
    },
    busy: function (ms) {
      this.speakingUntil = now() + ms;
      this.quietUntil = now() + ms + 700;
      Stomp.muteFor(ms + 300);
    },
    /** ids — фразы из voice-phrases.js; text — запасной текст для системного голоса. */
    speak: function (ids, text) {
      if (!S.voice) return;
      if (Clips.ready(ids)) {
        this.cancelSystem();
        var dur = Clips.play(ids);
        this.busy(dur * 1000);
        return;
      }
      // Голос iPhone — только если записей Артёма нет совсем (первый запуск без интернета).
      // Если записи есть, но эта ещё грузится, — лучше промолчать, чем заговорить чужим голосом.
      if (Clips.total || Clips.loading) return;
      this.say(text || ids.map(function (i) { return TEXTS[i] || ''; }).join(' '));
    },
    say: function (text, opts) {
      if (!this.supported || !S.voice || !text) return;
      opts = opts || {};
      var self = this;
      Clips.stop();
      var go = function () {
        self.timer = null;
        var u = new SpeechSynthesisUtterance(text);
        u.lang = speechLang();
        if (self.sysVoice) u.voice = self.sysVoice;
        u.rate = opts.rate || 1.05; u.pitch = 1; u.volume = 1;
        var est = 400 + text.length * 75 / u.rate;
        self.busy(est + 1200);
        self.keep.push(u); if (self.keep.length > 6) self.keep.shift();
        u.onend = u.onerror = function () { self.speakingUntil = 0; self.quietUntil = now() + 700; Stomp.muteFor(350); };
        speechSynthesis.speak(u);
      };
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); this.timer = setTimeout(go, 80); }
      else go();
    },
    // Отложенная фраза звучит, только если за это время ничего не поменялось (пауза, пропуск, сброс).
    later: function (ms, ids, text) {
      var self = this, ep = Timer.epoch;
      setTimeout(function () { if (Timer.epoch === ep && !Timer.paused && Timer.phase !== 'idle') self.speak(ids, text); }, ms);
    },
    cancelSystem: function () {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      if (this.supported && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
    },
    cancel: function () { this.cancelSystem(); Clips.stop(); this.speakingUntil = 0; }
  };
  if (Voice.supported) speechSynthesis.onvoiceschanged = function () { Voice.loadSystem(); };

  /* ================= Хаптика: отклик на касание ================= */
  // Вибрации из веба на iPhone нет. Есть системный тик Taptic Engine, когда переключается
  // <input type="checkbox" switch> (iOS 18+). С iOS 26.5 программное переключение тика не даёт —
  // только настоящее касание пальцем. Поэтому, как в ios-haptics 3.1: в каждую кнопку, колесо и на весь
  // экран таймера вкладываем невидимый переключатель. Палец щёлкает по нему, iOS тикает, клик всплывает
  // к кнопке как обычно. Ограничения iOS: один тик на касание, при перетаскивании колеса тиков нет.
  // На Android — navigator.vibrate.
  var Haptic = {
    last: 0,
    ios: /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    attach: function (el) {
      if (NATIVE || !this.ios || !el || (el.firstChild && el.firstChild.className === 'haptic-trigger')) return;
      var n = document.createElement('input');
      n.type = 'checkbox'; n.className = 'haptic-trigger'; n.setAttribute('switch', '');
      n.setAttribute('aria-hidden', 'true'); n.tabIndex = -1;
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      el.insertBefore(n, el.firstChild);
    },
    // Повторно — после смены текста кнопок (textContent стирает вложенный переключатель).
    attachAll: function () {
      if (NATIVE || !this.ios) return;
      document.querySelectorAll('button, .wheel, #stage, #gate').forEach(function (el) { Haptic.attach(el); });
    },
    // В приложении — Taptic Engine напрямую: тик на каждое значение колеса, как в будильнике, и без касания тоже.
    native: function (kind) {
      var C = window.Capacitor, h = C.Plugins && C.Plugins.Haptics;
      var call = function (m, o) {
        try {
          var r = h && h[m] ? h[m](o || {}) : C.nativePromise('Haptics', m, o || {});
          if (r && r.catch) r.catch(function () {});
        } catch (e) {}
      };
      // Владелец: «хаптики посильнее». Системный тик выбора еле слышен — везде удар Taptic Engine:
      // колесо — средний на каждое значение, кнопка — сильный, старт/пауза — двойной сильный.
      if (kind === 'tick') { call('impact', { style: 'MEDIUM' }); return; }
      call('impact', { style: 'HEAVY' });
      if (kind === 'strong') setTimeout(function () { call('impact', { style: 'HEAVY' }); }, 110);
    },
    /** tick — шаг колеса, tap — кнопка, strong — старт, пауза, сброс. Сайт вибрирует только на Android, приложение — везде. */
    play: function (kind) {
      var t = now();
      if (kind === 'tick' && t - this.last < 35) return;
      this.last = t;
      Stomp.touched(); // своя вибрация — тоже «тук» для микрофона и датчика
      if (NATIVE) { this.native(kind); return; }
      if (navigator.vibrate) { try { navigator.vibrate(kind === 'strong' ? [18, 70, 18] : kind === 'tick' ? 6 : 12); } catch (e) {} }
    }
  };

  /* ================= Экран не гаснет вообще ================= */
  var Wake = {
    lock: null, video: null, pending: false,
    // В режиме «на экран Домой» до iOS 18.4 Wake Lock обещает, но не держит экран — там включаем видео-обход.
    needVideo: (function () {
      var m = /OS (\d+)_(\d+)/.exec(navigator.userAgent);
      if (!('wakeLock' in navigator)) return true;
      if (!m || !standalone()) return false;
      var maj = +m[1], min = +m[2];
      return maj < 18 || (maj === 18 && min < 4);
    })(),
    request: function () {
      if (NATIVE || document.visibilityState !== 'visible') return; // в приложении экран держит iOS (AppDelegate)
      var self = this;
      if ('wakeLock' in navigator && !this.lock && !this.pending) {
        this.pending = true;
        navigator.wakeLock.request('screen').then(function (l) {
          self.lock = l; self.pending = false;
          l.addEventListener('release', function () { self.lock = null; });
        }).catch(function () { self.pending = false; self.startVideo(); });
      }
      if (this.needVideo) this.startVideo();
    },
    startVideo: function () {
      if (!this.video) {
        var v = this.video = document.createElement('video');
        v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.muted = true; v.loop = true;
        v.setAttribute('aria-hidden', 'true');
        v.src = 'media/keepawake.mp4';
        v.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;pointer-events:none';
        document.body.appendChild(v);
      }
      if (this.video.paused) this.video.play().catch(function () {});
    }
  };
  // iOS иногда отпускает блокировку сам — раз в 20 секунд проверяем и берём снова.
  setInterval(function () { if (App.unlocked) Wake.request(); }, 20000);

  /* ================= Детектор топота ================= */
  var Stomp = {
    stream: null, src: null, lp: null, feat: null, featBuf: null, node: null, sink: null,
    analyser: null, buf: null, timer: null, starting: null, cap: null, workletReady: null, workletCtx: null,
    motionOn: false, mPrev: null,
    micDet: new D.OnsetDetector({ floor0: 0.01, dt: 12, refractory: 120 }),
    motDet: new D.OnsetDetector({ floor0: 0.05, dt: 16, refractory: 140, minFloor: 0.005 }),
    dbl: new D.DoubleTap(90, 900, 500, 450),
    sgl: new D.SingleTap(900, 700),
    guard: new D.TouchGuard(450), // касание экрана и хаптика — «тук» в корпусе, не топот
    muteUntil: 0, level: 0, floor: 0.01, thr: 1, mLevel: 0, mThr: 1, lastP: null,
    lastMic: -1e9, lastMotion: -1e9,
    paused: false, suspended: false, cal: null,

    muteFor: function (ms) { this.muteUntil = Math.max(this.muteUntil, now() + ms); },
    // Палец на экране или телефон сам вибрирует: удары рядом не считаем, начатый двойной топ сбрасываем.
    touched: function () { this.guard.touch(now()); this.dbl.clear(); this.sgl.clear(); },
    needsMic: function () { return S.stompMode === 'mic' || S.stompMode === 'both'; },
    needsMotion: function () { return S.stompMode === 'motion' || S.stompMode === 'both'; },
    micLive: function () { return !!(this.stream && this.stream.getAudioTracks().some(function (t) { return t.readyState === 'live'; })); },

    // Вызывать в обработчике касания (iOS просит жест для разрешений).
    apply: function () {
      var jobs = [];
      if (this.needsMotion()) jobs.push(this.startMotion()); else this.stopMotion();
      if (this.needsMic() && !this.paused && !this.suspended) jobs.push(this.startMic()); else this.stopMic();
      var self = this;
      return Promise.all(jobs).then(function () { UI.renderStatus(); return self; });
    },

    /* --- «Громко в раунде»: микрофон на время тренировки выключается, iPhone возвращает полную громкость --- */
    suspend: function () {
      if (this.suspended || !this.needsMic()) return;
      this.suspended = true; this.stopMic(); UI.renderStatus();
    },
    resume: function () {
      if (!this.suspended) return;
      this.suspended = false;
      if (!this.needsMic() || this.paused) return;
      var t0 = now(), self = this;
      this.startMic().then(function () {
        // Если iPhone каждый раз спрашивает разрешение — выключаем этот режим, чтобы не мешать тренировке.
        if (now() - t0 > 1800 && S.loudRounds) {
          S.loudRounds = false; save(); UI.syncSettings();
          UI.toast(L('t.loudOff'));
        }
        UI.renderStatus();
      });
    },

    loadWorklet: function (c) {
      if (!c.audioWorklet) return Promise.resolve(false);
      if (this.workletCtx === c && this.workletReady) return this.workletReady;
      this.workletCtx = c;
      this.workletReady = c.audioWorklet.addModule('detect.js')
        .then(function () { return c.audioWorklet.addModule('stomp-worklet.js'); })
        .then(function () { return true; })
        .catch(function () { return false; });
      return this.workletReady;
    },

    startMic: function () {
      var self = this;
      if (this.micLive() && (this.node || this.analyser)) return Promise.resolve();
      if (this.starting) return this.starting;
      if (this.stream) this.stopMic();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        UI.toast(L('t.noMicApi')); return Promise.resolve();
      }
      Sound.init();
      var c = Sound.ctx;
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) {}
      this.starting = Promise.all([
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
        this.loadWorklet(c)
      ]).then(function (r) {
        var stream = r[0], hasWorklet = r[1];
        if (!self.needsMic() || self.paused || self.suspended) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        self.stream = stream;
        self.src = c.createMediaStreamSource(stream);
        // Для признаков модели — полный спектр.
        self.feat = c.createAnalyser(); self.feat.fftSize = 2048; self.feat.smoothingTimeConstant = 0;
        self.featBuf = new Float32Array(self.feat.frequencyBinCount);
        self.src.connect(self.feat);
        // Для детектора — только низ: топот глухой, хлопки и щелчки перчаток отсекаем.
        self.lp = c.createBiquadFilter(); self.lp.type = 'lowpass'; self.lp.frequency.value = 400; self.lp.Q.value = 0.7;
        self.src.connect(self.lp);
        if (hasWorklet) {
          self.node = new AudioWorkletNode(c, 'stomp', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
          self.sink = c.createGain(); self.sink.gain.value = 0;
          self.lp.connect(self.node); self.node.connect(self.sink); self.sink.connect(c.destination);
          self.node.port.onmessage = function (e) {
            var m = e.data;
            if (m.type === 'hit') self.onMicHit(m.peak, m.floor, now() - 30);
            else if (m.type === 'level') { self.level = m.level; self.floor = m.floor; }
          };
          self.setMeter(!$('settings').hidden);
        } else {
          // Запасной путь без AudioWorklet: опрос анализатора.
          self.analyser = c.createAnalyser(); self.analyser.fftSize = 512;
          self.buf = new Float32Array(self.analyser.fftSize);
          self.lp.connect(self.analyser);
          self.micDet.reset(0.01);
          clearInterval(self.timer);
          self.timer = setInterval(function () { self.pollMic(); }, 12);
        }
        stream.getAudioTracks()[0].addEventListener('ended', function () { self.stopMic(); UI.renderStatus(); });
      }).catch(function () {
        UI.toast(L('t.noMic'));
      }).then(function () { self.starting = null; });
      return this.starting;
    },
    stopMic: function () {
      clearInterval(this.timer); this.timer = null;
      if (this.node) { try { this.node.port.onmessage = null; this.node.disconnect(); } catch (e) {} }
      [this.src, this.lp, this.feat, this.sink, this.analyser].forEach(function (n) { if (n) try { n.disconnect(); } catch (e) {} });
      if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
      this.stream = this.src = this.lp = this.feat = this.node = this.sink = this.analyser = null;
      this.cap = null;
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    },
    setMeter: function (on) { if (this.node) this.node.port.postMessage({ meter: !!on }); },
    pollMic: function () {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      var peak = 0;
      for (var i = 0; i < this.buf.length; i++) { var a = Math.abs(this.buf[i]); if (a > peak) peak = a; }
      var t = now();
      this.level = peak; this.floor = this.micDet.floor;
      var hit = this.micDet.push(peak, t, 0);
      if (this.cap) {
        if (peak > this.cap.max) this.cap.max = peak;
        if (t - this.cap.t >= 30) { var c = this.cap; this.cap = null; this.onMicHit(c.max, this.micDet.floor, c.t); }
      } else if (hit) this.cap = { t: t, max: peak };
    },
    micThr: function (t, floor) {
      return D.threshold({ sens: S.sens, cal: S.calMic, floor: floor, second: this.dbl.waiting(t), absHi: 0.12, absLo: 0.012 });
    },
    // Признаки для модели: спектр сейчас и через 80 мс (насколько быстро затух удар).
    features: function (cb) {
      var an = this.feat, buf = this.featBuf, sr = Sound.ctx.sampleRate;
      if (!an) return cb(null);
      an.getFloatFrequencyData(buf);
      var first = new Float32Array(buf), l1 = D.levelDb(first);
      setTimeout(function () {
        if (!an) return cb(null);
        an.getFloatFrequencyData(buf);
        cb(D.features(first, sr, an.fftSize, D.levelDb(buf) - l1));
      }, 80);
    },
    onMicHit: function (peak, floor, t) {
      var self = this;
      this.floor = floor;
      if (this.guard.blocks(t)) return;
      if (this.cal) { this.cal.mic(peak, floor, t); return; }
      if (t <= this.muteUntil) return;
      var thr = this.micThr(t, floor);
      this.thr = thr;
      var model = S.stompModel;
      if (peak < (model ? thr * 0.7 : thr)) return;
      if (!model) {
        // Без обученной модели — простой фильтр: в топоте должен быть сильный низ (отсекает писки, хлопки, щелчки).
        if (this.feat) {
          this.feat.getFloatFrequencyData(this.featBuf);
          var lh = D.lowHigh(this.featBuf, Sound.ctx.sampleRate, this.feat.fftSize);
          if (lh < D.LOW_MIN) { UI.onModelScore(null, lh); return; }
        }
        this.lastMic = t; this.raw('mic', t); return;
      }
      this.features(function (f) {
        if (!f) return;
        var p = D.predict(model, f);
        self.lastP = p;
        UI.onModelScore(p);
        if (p >= 0.5) { self.lastMic = t; self.raw('mic', t); }
      });
    },

    startMotion: function () {
      var self = this;
      if (this.motionOn) return Promise.resolve();
      var begin = function () {
        window.addEventListener('devicemotion', self.onMotion);
        self.motionOn = true; self.mPrev = null;
        self.motDet.reset(0.05);
      };
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        return DeviceMotionEvent.requestPermission().then(function (r) {
          if (r === 'granted') begin(); else UI.toast(L('t.noMotion'));
        }).catch(function () { UI.toast(L('t.motionAgain')); });
      }
      if (typeof DeviceMotionEvent === 'undefined') { UI.toast(L('t.motionNA')); return Promise.resolve(); }
      begin();
      return Promise.resolve();
    },
    stopMotion: function () {
      window.removeEventListener('devicemotion', Stomp.onMotion);
      this.motionOn = false; this.mPrev = null;
    },
    onMotion: function (e) {
      var self = Stomp;
      var a = e.accelerationIncludingGravity;
      if (!a || a.x == null) return;
      var t = now();
      if (self.mPrev) {
        var d = Math.hypot(a.x - self.mPrev.x, a.y - self.mPrev.y, a.z - self.mPrev.z);
        var prev = self.motDet.slow;
        var thr = D.threshold({ sens: S.sens, cal: S.calMotion, floor: self.motDet.floor, second: self.dbl.waiting(t), absHi: 3.2, absLo: 0.18 });
        self.mLevel = d; self.mThr = thr;
        var hit = self.motDet.push(d, t, thr);
        if (self.cal) { if (!self.guard.blocks(t)) self.cal.motion(d, t, self.motDet.floor, prev); }
        else if (hit && t > self.muteUntil) { self.lastMotion = t; self.raw('motion', t); }
      }
      self.mPrev = { x: a.x, y: a.y, z: a.z };
    },

    // Сырой удар → правило «оба» → одиночный/двойной.
    raw: function (src, t) {
      if (src !== 'key' && this.guard.blocks(t)) return;
      if (S.stompMode === 'both' && src !== 'key') {
        var other = src === 'mic' ? this.lastMotion : this.lastMic;
        if (Math.abs(t - other) > 200) return;
        this.lastMic = this.lastMotion = -1e9;
      }
      UI.onRawHit();
      var self = this;
      if (S.stompPattern === 'single') {
        this.sgl.push(t);
        setTimeout(function () { if (self.sgl.confirm(now())) App.onStomp(); }, this.sgl.qa + 15);
        return;
      }
      var r = this.dbl.push(t);
      if (r === 'first') UI.onFirstHit();
      else if (r === 'second') setTimeout(function () { if (self.dbl.confirm(now())) App.onStomp(); }, this.dbl.confirmDelay() + 15);
    },

    listening: function () { return (this.needsMic() && !!(this.node || this.analyser)) || (this.needsMotion() && this.motionOn); }
  };

  /* ================= Обучение под свой топот (2 шага) ================= */
  var Cal = {
    step: 0, pos: [], neg: [], mot: null, timer: null, deadline: 0,
    open: function () {
      if (S.stompMode === 'off') { UI.toast(L('cl.needMode')); return; }
      var self = this;
      Stomp.apply().then(function () {
        if (!Stomp.listening()) { UI.toast(L('cl.deaf')); return; }
        self.pos = []; self.neg = []; self.mot = new D.PeakCollector(4);
        Stomp.dbl.clear();
        Stomp.cal = {
          mic: function (peak, floor, t) { self.onMic(peak, floor, t); },
          motion: function (v, t, floor, prev) { self.mot.push(v, t, floor, prev); self.render(); }
        };
        $('calLayer').hidden = false;
        self.setStep(1);
      });
    },
    setStep: function (n) {
      var self = this;
      this.step = n;
      clearInterval(this.timer);
      if (n === 1) {
        $('calStep').textContent = Stomp.needsMic() ? L('cl.step1') : L('cl.setup');
        $('calTitle').textContent = L('cl.title1');
        $('calSub').textContent = L('cl.sub1');
        $('btnCalNext').textContent = L('cl.next'); Haptic.attach($('btnCalNext'));
      } else {
        this.deadline = now() + 10000;
        $('calStep').textContent = L('cl.step2');
        $('calSub').textContent = L('cl.sub2');
        $('btnCalNext').textContent = L('btn.done'); Haptic.attach($('btnCalNext'));
        this.timer = setInterval(function () {
          var left = Math.ceil((self.deadline - now()) / 1000);
          $('calTitle').textContent = L('cl.move', { n: Math.max(0, left) });
          if (left <= 0) self.finish();
        }, 250);
      }
      this.render();
    },
    onMic: function (peak, floor, t) {
      var self = this;
      if (this.step === 1 && peak < floor * 5) return; // шум, а не удар
      Stomp.features(function (f) {
        if (!f || !Stomp.cal) return;
        if (self.step === 1) self.pos.push({ peak: peak, f: f }); else self.neg.push({ peak: peak, f: f });
        self.render();
        if (self.step === 1 && self.count() >= 5) setTimeout(function () { if (self.step === 1 && Stomp.cal) self.next(); }, 700);
      });
    },
    count: function () { return Math.max(this.pos.length, Stomp.needsMotion() ? this.mot.events.length : 0); },
    render: function () {
      var html = '', i;
      if (this.step === 1) for (i = 0; i < 5; i++) html += '<i class="' + (i < this.count() ? 'on' : '') + '"></i>';
      else for (i = 0; i < Math.min(this.neg.length, 30); i++) html += '<i class="neg"></i>';
      $('calDots').innerHTML = html;
      $('btnCalNext').disabled = this.step === 1 && this.count() < 3;
    },
    next: function () {
      if (this.step === 1) {
        if (this.count() < 3) return;
        if (Stomp.needsMic()) this.setStep(2); else this.finish();
      } else this.finish();
    },
    finish: function () {
      clearInterval(this.timer);
      if (!Stomp.cal) return;
      Stomp.cal = null; Stomp.dbl.clear();
      $('calLayer').hidden = true;
      var msg = [];
      if (Stomp.needsMic() && this.pos.length >= 3) {
        var peaks = this.pos.map(function (p) { return p.peak; }).sort(function (a, b) { return a - b; });
        S.calMic = peaks[Math.floor(peaks.length / 2)];
        var X = this.pos.map(function (p) { return p.f; }).concat(this.neg.map(function (p) { return p.f; }));
        var y = this.pos.map(function () { return 1; }).concat(this.neg.map(function () { return 0; }));
        var m = D.trainModel(X, y);
        S.stompModel = m;
        msg.push(m ? L('cl.trained', { pos: this.pos.length, neg: this.neg.length, acc: Math.round(m.acc * 100) }) : L('cl.thrOnly'));
      }
      if (Stomp.needsMotion()) {
        var lv = this.mot.level();
        if (lv) { S.calMotion = lv; msg.push(L('cl.motionOk')); } else msg.push(L('cl.motionNo'));
      }
      save();
      UI.syncCal();
      UI.toast(msg.length ? L('cl.done', { msg: msg.join(', ') }) : L('cl.fail'));
      Sound.play('blip');
    },
    cancel: function () {
      clearInterval(this.timer);
      Stomp.cal = null; Stomp.dbl.clear();
      $('calLayer').hidden = true;
    }
  };

  /* ================= План тренировки: «Спарринг» (колёса) или «Груша» (программа тренера) ================= */
  var Plan = {
    prog: null,
    refresh: function () { this.prog = S.mode === 'bag' ? BP.expand(BP.find(S.bagGoal, S.bagLevel)) : null; },
    bag: function () { return !!this.prog; },
    rounds: function () { return this.prog ? this.prog.rounds.length : S.rounds; },
    roundSec: function (n) { return this.prog ? this.prog.rounds[Math.max(0, (n || 1) - 1)].sec : S.roundSec; },
    restSec: function () { return this.prog ? this.prog.rest : S.restSec; },
    total: function () { return this.prog ? this.prog.total : S.rounds * S.roundSec + Math.max(0, S.rounds - 1) * S.restSec; }
  };

  /* ================= Тренер на груше: отрезки внутри раунда — звук + задание голосом ================= */
  // Владелец: «главное слышать». Смена отрезка — звуком (горн — максимум, свисток — «сильно» и выход из него,
  // колокол — спокойная смена), задание — голосом Артёма, только когда оно новое в раунде; «максимум» напоминаем
  // не чаще раза в 25 с. Последние 6 с раунда — только звук: там счёт 5…1. Перед «максимумом» — тиканье 5 с.
  var Coach = {
    spoke: {}, lastAt: 0,
    intense: function (seg) { return !!seg && (seg.type === 'max' || seg.type === 'hard'); },
    // Начало раунда: после «Раунд N» — задание первого отрезка.
    roundIds: function (r) {
      var R = Plan.prog.rounds[r - 1];
      this.spoke = {}; this.lastAt = now();
      if (!R) return [];
      this.spoke[R.segs[0].task] = 1;
      return ['bag_' + R.segs[0].task];
    },
    onSecond: function (sec) {
      var R = Plan.prog.rounds[Timer.round - 1];
      if (!R) return;
      var el = R.sec - sec, at = BP.segAt(R, el);
      if (el > 0 && at.seg.start === el) { this.enter(at.seg, R.segs[at.i - 1], sec); return; }
      var left = at.seg.start + at.seg.sec - el;
      if (S.tickSec > 0 && this.intense(at.next) && left >= 1 && left <= 5 && sec > S.tickSec + 1) Sound.play('tick');
    },
    enter: function (seg, prev, sec) {
      var snd = seg.type === 'max' ? 'r_horn' : seg.type === 'hard' || this.intense(prev) ? 'r_whistle' : 'ding';
      var d = Sound.play(snd);
      if (sec <= 6) return;
      var fresh = !this.spoke[seg.task], again = this.intense(seg) && seg.sec >= 10 && now() - this.lastAt > 25000;
      if (!fresh && !again) return;
      var ids = ['bag_' + seg.task];
      if (this.intense(seg) && fresh && PH.WARN.indexOf(seg.sec) >= 0) ids.push('warn_' + seg.sec);
      this.spoke[seg.task] = 1; this.lastAt = now();
      Voice.later(d + 150, ids);
    }
  };

  /* ================= Таймер ================= */
  var Timer = {
    phase: 'idle', round: 0, paused: false,
    endAt: 0, left: 0, dur: 0, lastSec: null,
    epoch: 0, // меняется при любом переходе — отложенные фразы старой фазы не звучат
    tickTimer: null,

    phaseLen: function (p) {
      if (p === 'prep') return S.prepSec; if (p === 'round') return Plan.roundSec(this.round);
      if (p === 'rest') return Plan.restSec(); return 0;
    },
    remaining: function () { return this.paused ? this.left : Math.max(0, this.endAt - now()); },
    running: function () { return this.phase === 'prep' || this.phase === 'round' || this.phase === 'rest'; },

    start: function () {
      Sound.unlock();
      UI.wake();
      this.round = 1;
      this.log = { r: 0, s: 0 };
      Wake.request();
      if (S.prepSec > 0) this.enter('prep'); else this.enter('round');
    },
    enter: function (p, carry, silent) {
      this.phase = p; this.paused = false; carry = carry || 0;
      this.epoch++;
      this.dur = this.phaseLen(p) * 1000;
      this.endAt = now() + this.dur - carry;
      this.lastSec = Math.ceil((this.dur - carry) / 1000);
      if (p === 'rest' && this.dur <= 0) { this.next(carry, silent); return; }
      App.syncMic(p === 'done' ? 5000 : 0); // в громком режиме микрофон выключается на всю тренировку
      if (p === 'done') this.saveLog(); // и когда финиш наступил в фоне без озвучки
      if (!silent) this.announce(p);
      UI.render(true);
      this.schedule();
    },
    next: function (carry, silent) {
      if (this.phase === 'prep') return this.enter('round', carry, silent);
      if (this.phase === 'round') {
        this.logRound();
        if (this.round >= Plan.rounds()) return this.enter('done', 0, silent);
        return this.enter('rest', carry, silent);
      }
      if (this.phase === 'rest') { this.round++; return this.enter('round', carry, silent); }
    },
    pause: function () {
      if (!this.running() || this.paused) return;
      this.left = this.remaining(); this.paused = true; this.epoch++;
      clearTimeout(this.tickTimer);
      Voice.cancel(); Sound.play('pauseTone');
      App.syncMic(1200);
      UI.render(true);
    },
    resume: function () {
      if (!this.paused) return;
      this.endAt = now() + this.left; this.paused = false; this.epoch++;
      Sound.unlock(); Wake.request();
      App.syncMic(0);
      Sound.play('blip');
      UI.render(true);
      this.schedule();
    },
    skip: function () {
      if (!this.running()) return;
      this.paused = false;
      this.next(0, false);
    },
    // Раунд засчитан, если отработана хотя бы половина (пропуск в самом начале — не тренировка).
    logRound: function () {
      if (!this.log) return;
      var sec = Math.max(0, (this.dur - this.remaining()) / 1000);
      this.log.s += sec;
      if (sec * 2 >= this.dur / 1000) this.log.r++;
    },
    // В историю — всё, где бокса набралась хотя бы минута: и полная тренировка, и прерванная.
    saveLog: function () {
      var g = this.log; this.log = null;
      if (!g || g.s < 60) return;
      Hist.add({ d: ST.today(), r: g.r, s: Math.round(g.s), m: Plan.bag() ? 'bag' : 'spar' });
      Remind.all();
    },
    reset: function () {
      if (this.phase === 'round') this.logRound();
      this.saveLog();
      this.phase = 'idle'; this.round = 0; this.paused = false; this.epoch++;
      clearTimeout(this.tickTimer);
      Voice.cancel();
      App.syncMic(0);
      UI.render(true);
    },

    isLast: function () { return this.round >= Plan.rounds(); },
    announce: function (p) {
      var r = this.round, total = Plan.rounds();
      if (p === 'prep') {
        Voice.later(400, ['prep'], L('say.prep', { rounds: L('n.rounds', { n: total }) }));
      } else if (p === 'round') {
        var id = total > 1 && r === total ? 'last_round' : (total > 1 && r <= PH.MAX_ROUNDS ? 'round_' + r : 'box');
        Voice.later(Sound.play(S.sndStart) + 250, Plan.bag() ? [id].concat(Coach.roundIds(r)) : [id]);
      } else if (p === 'rest') {
        var left = total - r;
        Voice.later(Sound.play(S.sndEnd) + 250, ['stop_rest', left === 1 ? 'left_1' : 'left_' + Math.min(left, PH.MAX_ROUNDS)]);
      } else if (p === 'done') {
        Sound.play('finish');
        Voice.later(2000, ['finish']);
      }
    },

    // Тикаем ровно на смене секунды, а не 60 раз в секунду: процессор спит, телефон не греется.
    schedule: function () {
      clearTimeout(this.tickTimer);
      if (!this.running() || this.paused) return;
      var rem = this.endAt - now();
      var ms = rem > 0 ? (rem % 1000) + 6 : 0;
      var self = this;
      this.tickTimer = setTimeout(function () { self.tick(); UI.render(false); self.schedule(); }, ms);
    },
    tick: function () {
      if (!this.running() || this.paused) return;
      var rem = this.endAt - now();
      var guard = 0;
      while (rem <= 0 && this.running() && guard++ < 100) {
        var overdue = -rem;
        this.next(overdue, overdue > 1500);
        if (!this.running()) return;
        rem = this.endAt - now();
      }
      var sec = Math.ceil(rem / 1000);
      if (sec !== this.lastSec) { this.lastSec = sec; this.onSecond(sec); }
    },
    // Голос — только важное: «10 секунд» с сигналом и счёт 5…1 (в раунде и перед раундом), остальное — звуки.
    onSecond: function (sec) {
      var p = this.phase, bag = p === 'round' && Plan.bag();
      // На груше внутри раунда говорит тренер; свой сигнал «перед концом» и «половина» не нужны.
      var w = bag ? 0 : p === 'round' ? S.warnSec : 10;
      if (bag) Coach.onSecond(sec);
      if (w > 0 && sec === w && this.dur > (w + 2) * 1000) {
        var d = Sound.play(S.sndWarn);
        if (PH.WARN.indexOf(w) >= 0) Voice.later(d + 120, ['warn_' + w]);
      }
      if (p === 'round' && !bag && S.halfVoice && this.dur >= 60000 && sec === Math.round(this.dur / 2000) && sec > w + 2) {
        Sound.play('beepHigh');
        Voice.later(280, ['half']);
      }
      var countFrom = Math.min(5, Math.ceil(this.dur / 1000) - 1);
      // Тиканье последних секунд (владелец: «чтобы слышать, что конец близко»). Не в ту же секунду, что сигнал «перед концом».
      var tick = S.tickSec > 0 && sec >= 1 && sec <= S.tickSec && sec !== w && this.dur > (S.tickSec + 2) * 1000;
      if (S.countVoice && S.voice && sec >= 1 && sec <= countFrom && (bag || sec < w)) { Voice.speak(['cnt_' + sec]); if (tick) Sound.play('tick'); }
      else if (sec >= 1 && sec <= 3) Sound.play(p === 'round' ? 'beep' : 'beepHigh');
      else if (tick) Sound.play('tick');
    }
  };

  /* ================= Голосовой ввод ================= */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var Listen = {
    supported: !!SR, rec: null, cmdOn: false, oneShot: false,

    once: function () {
      if (!this.supported) { UI.toast(L('vl.unsupported')); return; }
      this.stopCommands(true);
      Stomp.paused = true; Stomp.stopMic();
      Voice.cancel();
      var r = new SR(); this.rec = r; this.oneShot = true;
      r.lang = speechLang(); r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      var layer = $('voiceLayer');
      layer.hidden = false; layer.classList.add('listening');
      $('voiceText').textContent = ''; $('voiceResult').textContent = '';
      $('voicePrompt').textContent = L('vl.prompt');
      var finalText = '';
      r.onresult = function (e) {
        var txt = '';
        for (var i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        $('voiceText').textContent = '«' + txt + '»';
        if (e.results[e.results.length - 1].isFinal) finalText = txt;
      };
      r.onerror = function (e) {
        $('voiceResult').textContent = e.error === 'not-allowed' ? L('vl.noAccess') : L('vl.again');
      };
      r.onend = function () {
        layer.classList.remove('listening');
        Listen.oneShot = false;
        var txt = finalText || ($('voiceText').textContent || '').replace(/[«»]/g, '');
        if (txt) App.handleSpeech(txt, true);
        setTimeout(function () { Listen.closeOnce(); }, txt ? 2200 : 2500);
      };
      try { r.start(); } catch (e) { layer.hidden = true; }
    },
    closeOnce: function () {
      if (this.oneShot && this.rec) { try { this.rec.stop(); } catch (e) {} return; }
      if ($('voiceLayer').hidden && !Stomp.paused) return;
      $('voiceLayer').hidden = true;
      Stomp.paused = false;
      setTimeout(function () { Stomp.apply(); if (S.commands) Listen.startCommands(); }, 300);
    },

    startCommands: function () {
      if (!this.supported || this.cmdOn) return;
      this.cmdOn = true;
      var self = this;
      var r = new SR(); this.rec = r;
      r.lang = speechLang(); r.continuous = true; r.interimResults = false;
      r.onresult = function (e) {
        var res = e.results[e.results.length - 1];
        if (!res.isFinal) return;
        if (now() < Voice.quietUntil || Voice.isSpeaking()) return; // не реагируем на собственный голос
        App.handleSpeech(res[0].transcript, false);
      };
      r.onerror = function (e) {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          self.cmdOn = false; S.commands = false; save(); UI.syncSettings();
          UI.toast(L('t.noSR'));
        }
      };
      r.onend = function () { if (self.cmdOn) setTimeout(function () { try { r.start(); } catch (e) {} }, 250); };
      try { r.start(); } catch (e) { this.cmdOn = false; }
      UI.renderStatus();
    },
    stopCommands: function (temporary) {
      if (!this.cmdOn) return;
      this.cmdOn = false;
      try { this.rec && this.rec.abort(); } catch (e) {}
      if (!temporary) UI.renderStatus();
    }
  };

  /* ================= Приложение ================= */
  var App = {
    unlocked: false, starting: false, micTimer: null,

    unlock: function () {
      Sound.unlock(); Voice.unlock(); Wake.request();
      try { if (navigator.audioSession && !Stomp.needsMic()) navigator.audioSession.type = 'playback'; } catch (e) {}
      Voice.loadSystem();
      this.unlocked = true;
      $('gate').hidden = true;
      if (Clips.count() < Object.keys(Clips.raw).length) Clips.decodeAll();
      Stomp.apply().then(function () { if (S.commands) Listen.startCommands(); });
      UI.wake();
      UI.render(true);
    },
    regate: function (text) {
      $('gateText').textContent = text;
      $('gate').hidden = false;
    },

    // Микрофон нужен только когда топот реально что-то сделает. В громком режиме во время тренировки он выключен.
    micWanted: function () {
      if (!Stomp.needsMic()) return false;
      if (S.loudRounds && !S.stompInRound && Timer.running() && !Timer.paused) return false;
      return true;
    },
    syncMic: function (delay) {
      clearTimeout(this.micTimer);
      var self = this;
      var apply = function () { if (self.micWanted()) Stomp.resume(); else Stomp.suspend(); };
      if (!this.micWanted() || !delay) apply(); else this.micTimer = setTimeout(apply, delay);
    },

    // Пауза топотом во время тренировки: нет (микрофон выключен — громче) / только в отдыхе / всегда.
    stompDuring: function () { return S.stompInRound ? 'all' : S.loudRounds ? 'none' : 'rest'; },
    stompAllowed: function () {
      var T = Timer, d = this.stompDuring();
      if (!T.running() || T.paused) return true;
      return d === 'all' || (d === 'rest' && T.phase !== 'round');
    },

    onStomp: function () {
      UI.wake();
      if (!$('settings').hidden) { UI.onCalibStomp(); return; }
      if (!$('voiceLayer').hidden || !$('gate').hidden || !$('calLayer').hidden || this.starting) return;
      var T = Timer, self = this;
      if (T.phase === 'idle' || T.phase === 'done') {
        UI.flashStomp(); Sound.play('blip');
        this.starting = true;
        setTimeout(function () {
          self.starting = false;
          if (T.phase === 'idle' || T.phase === 'done') T.start();
        }, 600);
        return;
      }
      if (T.paused) { UI.flashStomp(); T.resume(); return; }
      if (!this.stompAllowed()) return;
      UI.flashStomp(); T.pause();
    },

    handleSpeech: function (text, fromOnce) {
      var cmd = P.parseCommand(text);
      var cfg = P.parseWorkout(text);
      if (Object.keys(cfg).length && (Timer.phase === 'idle' || Timer.phase === 'done' || Timer.paused || fromOnce)) {
        Object.assign(S, cfg);
        if (cfg.rounds || cfg.roundSec || cfg.restSec) S.mode = 'spar'; // назвал раунды голосом — значит, спарринг
        save(); Plan.refresh();
        UI.syncSettings(); UI.render(true);
        var msg = App.describe();
        $('voiceResult').textContent = msg;
        UI.toast(msg);
        Voice.speak(['ok']);
        if (cmd !== 'start') return;
      }
      if (!cmd) {
        if (fromOnce) $('voiceResult').textContent = L('vl.notUnderstood');
        return;
      }
      if (fromOnce) { $('voiceLayer').hidden = true; Stomp.paused = false; Stomp.apply(); if (S.commands) Listen.startCommands(); }
      var T = Timer;
      if (cmd === 'start') { if (T.phase === 'idle' || T.phase === 'done') T.start(); else if (T.paused) T.resume(); }
      else if (cmd === 'pause') T.pause();
      else if (cmd === 'resume') T.resume();
      else if (cmd === 'skip') T.skip();
      else if (cmd === 'reset') T.reset();
    },

    describe: function () {
      return L('describe', { rounds: L('n.rounds', { n: S.rounds }), len: fmt(S.roundSec), rest: S.restSec ? fmt(S.restSec) : L('none') });
    }
  };

  // Шрифты цифр: только встроенные в iPhone — работают офлайн, ничего не скачивается.
  var FONTS = {
    rounded: '"SF Pro Rounded", ui-rounded, -apple-system, system-ui, sans-serif',
    classic: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
    din: '"DIN Condensed", "DIN Alternate", Bahnschrift, "Roboto Condensed", "Arial Narrow", sans-serif',
    lcd: 'DSEG7, ui-monospace, monospace', // семисегментное табло — свой файл fonts/, работает везде
    serif: 'ui-serif, "New York", Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, "SF Mono", Menlo, "Courier New", monospace',
    // Дальше — встроенные в iPhone шрифты; где их нет (Android, компьютер), вариант не показывается.
    sport: '"Futura-CondensedExtraBold", "Futura Condensed ExtraBold", sans-serif',
    heavy: '"AvenirNextCondensed-Heavy", "Avenir Next Condensed", sans-serif',
    slab: '"Rockwell-Bold", Rockwell, serif',
    chalk: 'Chalkduster, fantasy',
    marker: '"MarkerFelt-Wide", "Marker Felt", fantasy',
    typewriter: '"AmericanTypewriter-Bold", "American Typewriter", serif',
    elegant: '"Didot-Bold", Didot, serif',
    engraved: '"Copperplate-Bold", Copperplate, serif'
  };
  var FONT_BASE = ['rounded', 'classic', 'din', 'lcd', 'serif', 'mono'];
  // Шрифт есть на устройстве, если «1:23» им шире или уже, чем запасным (canvas меряет без вёрстки).
  function hasFont(stack) {
    var c = hasFont.c || (hasFont.c = document.createElement('canvas').getContext('2d'));
    var named = stack.replace(/,\s*(sans-serif|serif|fantasy|monospace)$/, '');
    var w = function (f) { c.font = '800 40px ' + f; return c.measureText('1:23 0').width; };
    return ['monospace', 'serif'].some(function (g) { return w(named + ', ' + g) !== w(g); });
  }

  /* ================= Колесо настройки: листаем пальцем, как будильник в iPhone ================= */
  // d — {k, f}: ключ настройки и формат. Значения — P.choices(k). onChange вызывается на каждом шаге.
  function makeWheel(el, d, onChange) {
    var W = { pos: 0, target: 0, list: [], items: [], drag: null, anim: 0, ticked: null, quiet: false };
    for (var j = 0; j < 7; j++) { var it = document.createElement('span'); it.className = 'wheel-item'; el.appendChild(it); W.items.push(it); }
    var row = function () { return el.offsetHeight * 0.36 || 40; };
    // Ось «вверх-вниз» экрана в координатах окна: в портрете #root повёрнут, свайп тоже надо повернуть.
    var axis = function () {
      var m = /matrix\(([^)]+)\)/.exec(getComputedStyle($('root')).transform || '');
      if (!m) return [0, 1];
      var v = m[1].split(',').map(Number);
      return [v[2], v[3]];
    };
    var clampIdx = function (i) { return Math.max(0, Math.min(W.list.length - 1, Math.round(i))); };

    W.draw = function () {
      var base = Math.round(W.pos), r = row();
      W.items.forEach(function (it, j) {
        var k = base + j - 3, dist = k - W.pos, a = Math.min(1, Math.abs(dist));
        if (k < 0 || k >= W.list.length || Math.abs(dist) > 2.2) { it.style.visibility = 'hidden'; return; }
        var t = d.f(W.list[k]);
        if (it.textContent !== t) it.textContent = t;
        it.style.visibility = '';
        it.style.transform = 'translateY(' + (dist * r).toFixed(1) + 'px) scale(' + (1 - 0.45 * a).toFixed(3) + ')';
        it.style.opacity = (1 - 0.72 * a).toFixed(2);
      });
    };
    W.commit = function () {
      var v = W.list[clampIdx(W.pos)];
      if (S[d.k] !== v) {
        S[d.k] = v;
        if (W.ticked !== v && !W.quiet) Haptic.play('tick'); // одно значение — один тик
        W.ticked = v;
        onChange();
      }
    };
    W.sync = function () {
      if (W.drag || W.anim) return;
      W.list = P.choices(d.k, S[d.k]);
      W.pos = W.list.indexOf(S[d.k]);
      W.draw();
    };
    W.animTo = function (target) {
      target = W.target = clampIdx(target);
      var from = W.pos, t0 = now(), dur = Math.min(650, 160 + Math.abs(target - from) * 45);
      cancelAnimationFrame(W.anim);
      var step = function () {
        var p = Math.min(1, (now() - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        W.pos = from + (target - from) * e;
        W.draw(); W.commit();
        if (p < 1) W.anim = requestAnimationFrame(step);
        else { W.anim = 0; W.quiet = false; save(); }
      };
      W.anim = requestAnimationFrame(step);
    };

    // Куда считать следующий шаг: если колесо ещё докручивается — от его цели (быстрые касания складываются).
    var base = function () { return W.anim ? W.target : Math.round(W.pos); };
    // Прокрутить к значению (пресет): видно, как меняется, но без вибрации на каждый шаг.
    W.go = function (v) {
      if (W.drag) return;
      W.list = P.choices(d.k, v);
      W.quiet = true;
      W.animTo(W.list.indexOf(v));
    };
    el.addEventListener('pointerdown', function (e) {
      W.quiet = false;
      var b0 = base();
      if (W.anim) { cancelAnimationFrame(W.anim); W.anim = 0; }
      else W.list = P.choices(d.k, S[d.k]);
      // На касании захват неявный (к невидимому переключателю — так клик и тик доходят); мышь — захватываем.
      if (e.pointerType === 'mouse') { try { el.setPointerCapture(e.pointerId); } catch (err) {} }
      W.drag = { ax: axis(), x: e.clientX, y: e.clientY, p0: W.pos, base: b0, t0: now(), moved: 0, hist: [[now(), W.pos]] };
    });
    el.addEventListener('pointermove', function (e) {
      var g = W.drag;
      if (!g) return;
      var dy = (e.clientX - g.x) * g.ax[0] + (e.clientY - g.y) * g.ax[1], max = W.list.length - 1;
      var p = g.p0 - dy / row();
      if (p < 0) p /= 3; else if (p > max) p = max + (p - max) / 3; // резинка на краях
      g.moved = Math.max(g.moved, Math.abs(dy));
      g.hist.push([now(), p]); if (g.hist.length > 8) g.hist.shift();
      W.pos = p; W.draw(); W.commit();
    });
    var end = function (e) {
      var g = W.drag;
      if (!g) return;
      W.drag = null;
      if (g.moved < 6 && now() - g.t0 < 450) {
        // Касание соседнего значения — шаг на одно.
        var b = el.getBoundingClientRect();
        var off = (e.clientX - (b.left + b.width / 2)) * g.ax[0] + (e.clientY - (b.top + b.height / 2)) * g.ax[1];
        var dir = off > row() / 2 ? 1 : off < -row() / 2 ? -1 : 0, to = W.list[clampIdx(g.base + dir)];
        if (to !== S[d.k]) { Haptic.play('tick'); W.ticked = to; } // тик сразу, пока идёт касание
        W.animTo(g.base + dir);
        return;
      }
      // Бросок: скорость за последние ~100 мс, колесо докручивается по инерции.
      var t = now(), h = g.hist.filter(function (x) { return t - x[0] < 100; }), v = 0;
      if (h.length > 1) v = (h[h.length - 1][1] - h[0][1]) / Math.max(16, h[h.length - 1][0] - h[0][0]);
      W.animTo(W.pos + v * 250);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!W.anim) W.list = P.choices(d.k, S[d.k]);
      W.animTo(base() + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });
    return W;
  }

  /* ================= Интерфейс ================= */
  var UI = {
    lastKey: '', lastClock: '', lastFit: '', lastActive: now(),

    // Язык: тексты из словаря по data-i18n (текст), data-i18n-html (с разметкой), data-i18n-aria (подпись для VoiceOver).
    applyLang: function () {
      document.documentElement.lang = S.lang;
      document.title = L('app.title');
      document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = L(el.dataset.i18n); });
      document.querySelectorAll('[data-i18n-html]').forEach(function (el) { el.innerHTML = L(el.dataset.i18nHtml); });
      document.querySelectorAll('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', L(el.dataset.i18nAria)); });
      document.querySelectorAll('[data-lang-seg] button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === S.lang); });
      Haptic.attachAll();
    },
    setLang: function (lang) {
      if (lang === S.lang) return;
      S.lang = lang; save();
      loadTexts(); Voice.loadSystem(); Clips.load(curVoice());
      if (Listen.cmdOn) { Listen.stopCommands(true); Listen.startCommands(); } // распознавание — на новом языке
      this.applyLang(); this.syncSettings(); this.render(true);
      Remind.all(); // напоминания и подписи виджета — на новом языке
      if (!$('settings').hidden) this.showTab(this.tab);
    },
    applyLook: function () {
      document.body.classList.toggle('flip', !!S.flip);
      document.body.classList.toggle('eco', !!S.eco);
      document.body.style.setProperty('--digits', FONTS[S.font] || FONTS.rounded);
      this.fitClock(true);
    },
    // Цифры не шире места между вырезом и краем: размер в CSS — от ширины экрана, а ширина цифр зависит от шрифта.
    // Меряем только при смене фазы, длины, шрифта или размера экрана; не влезают — уменьшаем ровно насколько нужно.
    fitClock: function (force) {
      var c = $('clock'), box = c.parentNode, b = document.body;
      var key = [b.dataset.phase, b.dataset.paused, this.lastClock.length, S.font, box.clientWidth, box.clientHeight].join('|');
      if (!force && key === this.lastFit) return;
      this.lastFit = key;
      c.style.zoom = '';
      // Ширина — по вёрстке, высота — по самим знакам (у табло и «Мела» цифры выше строки и наезжали на кнопки).
      var cs = getComputedStyle(c), ctx = hasFont.c || (hasFont.c = document.createElement('canvas').getContext('2d'));
      ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      var m = ctx.measureText(c.textContent), half = box.clientHeight / 2 * 0.94, lh = c.offsetHeight; // запас: метрики шрифтов неточны
      // базовая линия от центра строки; знаки — выше и ниже неё; часы стоят по центру места, zoom сжимает к центру
      var base = m.fontBoundingBoxAscent !== undefined ? (lh - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent - lh / 2 : 0;
      var up = m.actualBoundingBoxAscent - base, down = base + m.actualBoundingBoxDescent;
      var k = Math.min(1, box.clientWidth / c.scrollWidth, up > 0 ? half / up : 1, down > 0 ? half / down : 1);
      if (k < 1 && k > 0) c.style.zoom = k.toFixed(3);
    },
    syncOpts: function () {
      document.querySelectorAll('[data-snd]').forEach(function (sel) {
        // записи, которых нет (не скачались), не предлагаем
        sel.querySelectorAll('option').forEach(function (o) { o.hidden = o.disabled = !Sound.has(o.value) && S[sel.dataset.snd] !== o.value; });
        sel.value = S[sel.dataset.snd];
      });
      $('tickPick').value = String(S.tickSec);
      document.querySelectorAll('#fontOpts .opt').forEach(function (b) { var on = S.font === b.dataset.v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    },

    render: function (force) {
      var T = Timer, b = document.body;
      var rem = T.remaining(), sec = Math.ceil(rem / 1000);
      var warn = (T.phase === 'round' && S.warnSec > 0 && sec <= S.warnSec) ||
                 ((T.phase === 'rest' || T.phase === 'prep') && sec <= 10 && T.dur > 13000) ||
                 ((T.phase === 'rest' || T.phase === 'prep') && sec <= 3);
      var w = warn && !T.paused ? '1' : '0';
      if (b.dataset.warn !== w) b.dataset.warn = w;

      var txt = fmt(T.running() ? sec : Plan.roundSec(1));
      if (txt !== this.lastClock) {
        this.lastClock = txt;
        var clock = $('clock');
        clock.textContent = txt;
        clock.classList.toggle('long', txt.length > 4);
        this.fitClock();
        // Последние 3 секунды цифры «толкаются» в такт бипам — видно краем глаза.
        if (T.running() && !T.paused && sec >= 1 && sec <= 3) this.animate(clock, 'beat');
      }

      var key = [T.phase, T.round, T.paused, T.epoch, S.rounds, S.roundSec, S.restSec, S.prepSec, S.stompMode, S.stompPattern, S.mode, S.bagGoal, S.bagLevel].join('|');
      if (!force && key === this.lastKey) return;
      this.lastKey = key;

      // Новая фаза (раунд, отдых) — цифры и надпись «выпрыгивают»: смена заметна с другого конца зала.
      var stage = T.phase + T.round;
      if (stage !== this.lastStage && T.running()) {
        if (/^(idle|done)/.test(this.lastStage)) this.animate($('clock'), 'enter'); // из плана — цифры наезжают
        else { this.animate($('clock'), 'pop'); this.animate($('phaseLabel'), 'pop'); }
      }
      this.lastStage = stage;

      b.dataset.phase = T.phase;
      b.dataset.paused = T.paused ? '1' : '0';
      this.fitClock();
      this.syncBar();

      // Сверху слева — что сейчас, справа — какой раунд (в отдыхе — какой следующий).
      var labels = { idle: '', prep: L('ph.prep'), round: L('ph.round'), rest: L('ph.rest'), done: '' };
      $('phaseLabel').textContent = T.paused ? L('ph.pause') : labels[T.phase];
      var NR = Plan.rounds(), last = NR > 1, rl = '';
      if (T.phase === 'prep') rl = L('round.n', { n: 1, total: NR });
      else if (T.phase === 'round') rl = last && T.isLast() ? L('round.last') : L('round.n', { n: T.round, total: NR });
      else if (T.phase === 'rest') rl = '<small>' + L('round.next') + '</small>' + (last && T.round + 1 === NR ? L('round.nextLast') : L('round.n', { n: T.round + 1, total: NR }));
      $('roundLabel').innerHTML = rl;

      this.syncWheels();
      $('summaryText').textContent = L('summary', { rounds: L('n.rounds', { n: NR }), len: fmt(Plan.roundSec(1)), min: Math.round(NR * Plan.roundSec(1) / 60) });
      if (T.phase === 'done') {
        var wx = Hist.sum(), met = wx.week.count >= wx.goal;
        $('summaryWeek').textContent = (met ? L('done.met') : L('done.week', { n: wx.week.count, goal: wx.goal })) + (wx.streak ? ' · ' + L('st.streak', { n: wx.streak }) : '');
      }
      $('planText').textContent = Plan.bag()
        ? L('plan.bag', { goal: L('goal.' + S.bagGoal), level: L('level.' + S.bagLevel), min: Math.round((S.prepSec + Plan.total()) / 60) })
        : S.rounds + ' × ' + fmt(S.roundSec) + ' · ' + (S.restSec ? L('plan.rest', { t: fmt(S.restSec) }) : L('plan.noRest'));

      $('skipText').textContent = this.skipTarget();
      this.resetConfirm(false);
      this.renderStatus();
    },
    lastStage: 'idle',
    // Перезапуск короткой CSS-анимации (только transform/opacity — дёшево для батареи).
    animate: function (el, cls) {
      el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
      clearTimeout(el['_t' + cls]);
      el['_t' + cls] = setTimeout(function () { el.classList.remove(cls); }, 600);
    },
    // Куда ведёт «пропустить» — пишем прямо на кнопке.
    skipTarget: function () {
      var T = Timer, nr = T.phase === 'prep' ? 1 : T.round + 1;
      if (T.phase === 'round') {
        if (T.isLast()) return L('skip.finish');
        if (Plan.restSec() > 0) return L('skip.rest');
      }
      return nr === Plan.rounds() && Plan.rounds() > 1 ? L('skip.last') : L('skip.round', { n: nr });
    },
    // Сброс на паузе — со второго касания: случайно задел — тренировка не пропала.
    resetTimer: null,
    resetConfirm: function (on) {
      clearTimeout(this.resetTimer);
      $('btnReset').classList.toggle('confirm', on);
      $('resetText').textContent = on ? L('reset.confirm') : L('reset');
      if (on) this.resetTimer = setTimeout(function () { UI.resetConfirm(false); }, 3000);
    },

    // Полоса прогресса: одна CSS-анимация на всю фазу (компоновщик, без JS каждый кадр).
    syncBar: function () {
      var T = Timer, f = $('barFill');
      var frac = T.dur > 0 ? Math.min(1, 1 - T.remaining() / T.dur) : (T.phase === 'done' ? 1 : 0);
      f.style.transition = 'none';
      f.style.transform = 'scaleX(' + frac.toFixed(4) + ')';
      if (T.running() && !T.paused && T.dur > 0) {
        void f.offsetWidth;
        f.style.transition = 'transform ' + Math.max(0, T.remaining()) + 'ms linear';
        f.style.transform = 'scaleX(1)';
      }
    },

    // Слышит ли таймер топот прямо сейчас — честно, по факту, а не по настройке.
    renderStatus: function () {
      var T = Timer, live = Stomp.listening() && S.stompMode !== 'off';
      var how = S.stompPattern === 'double' ? L('how.double') : L('how.single');
      $('liveStomp').hidden = !(live && T.running() && App.stompAllowed());
      $('liveCmd').hidden = !(Listen.cmdOn && T.running());
      $('chipVoice').hidden = !Listen.supported;

      // Внизу экрана готовности — одна строка «как стартовать» и одна мелкая: длительность или совет.
      var on = S.stompMode !== 'off', hint, sub = '';
      if (!App.unlocked) {
        hint = L(on ? 'ready.unlockStomp' : 'ready.unlock');
        // Совет нужен, пока перчатки не надеты: в Safari панели съедают экран; горизонтально без блокировки — повернётся.
        if (Haptic.ios && !standalone()) sub = L('ready.home');
        else if (!NATIVE && matchMedia('(orientation: landscape)').matches) sub = L('gate.rot');
      } else if (T.phase === 'done') {
        hint = live ? L('ready.doneStomp', { how: how }) : L('ready.done');
      } else {
        var total = S.prepSec + Plan.total();
        hint = live ? L('ready.tapStomp', { how: how }) : L('ready.tap');
        sub = L('total', { min: Math.max(1, Math.round(total / 60)) });
        if (Hist.list.length) {
          var x = Hist.sum();
          sub += ' · ' + (x.week.count >= x.goal ? L('st.weekDone') : L('st.week', { n: x.week.count, goal: x.goal })) + (x.streak ? ' · ' + L('st.streak', { n: x.streak }) : '');
        }
      }
      if (App.unlocked && on && !live) sub = (sub ? sub + ' · ' : '') + L('st.deaf');
      $('idleHint').textContent = hint;
      $('idleSub').textContent = sub;
      $('idleDot').hidden = !App.unlocked || !on;
      $('idleDot').classList.toggle('on', live);

      $('pauseHint').textContent = live ? L('pause.stomp', { how: how }) : L('pause.tap');
      $('dimText').textContent = Plan.rounds() + ' × ' + fmt(Plan.roundSec(1));
      $('dimHint').textContent = live ? L('st.start', { how: how }) : L('dim.tap');
    },

    flashStomp: function () {
      var f = $('stompFlash');
      f.classList.remove('on', 'half'); void f.offsetWidth; f.classList.add('on');
    },
    onFirstHit: function () {
      UI.wake();
      if (!$('settings').hidden) { $('meterCount').textContent = L('meter.first'); return; }
      if (!$('gate').hidden || !$('voiceLayer').hidden || !$('calLayer').hidden) return;
      if (!App.stompAllowed()) return;
      var f = $('stompFlash');
      f.classList.remove('on', 'half'); void f.offsetWidth; f.classList.add('half');
    },

    /* --- Чёрный экран в ожидании (экран не гаснет, но почти не тратит батарею) --- */
    wake: function () {
      this.lastActive = now();
      if (!$('dim').hidden) $('dim').hidden = true;
    },
    checkDim: function () {
      var idle = Timer.phase === 'idle' || Timer.phase === 'done';
      var layersClosed = $('settings').hidden && $('voiceLayer').hidden && $('calLayer').hidden && $('gate').hidden;
      if (S.dimIdle && idle && layersClosed && now() - this.lastActive > 120000) $('dim').hidden = false;
    },

    toastTimer: null,
    toast: function (msg) {
      var t = $('toast');
      t.textContent = msg; t.classList.add('on');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(function () { t.classList.remove('on'); }, 3200);
    },

    /* ---- Настройки ---- */
    tab: 'workout',
    showTab: function (t) {
      this.tab = t;
      document.querySelectorAll('.sheet-nav .tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
      document.querySelectorAll('#sheetBody > section').forEach(function (sec) { sec.hidden = sec.dataset.tab !== t; });
      $('sheetBody').scrollTop = 0;
      this.syncWheels(); // колёса меряют высоту — только когда видны
    },
    openSettings: function (tab) {
      if (Timer.running() && !Timer.paused) Timer.pause();
      var el = $('settings');
      el.classList.remove('closing');
      el.hidden = false;
      this.showTab(tab || this.tab);
      this.syncSettings();
      this.calibHits = 0;
      $('meterCount').textContent = L('meter.try');
      Stomp.setMeter(true);
      if (!this.meterOn) { this.meterOn = true; this.meterLoop(); }
    },
    closeSettings: function () {
      var el = $('settings'), self = this;
      Stomp.setMeter(false);
      el.classList.add('closing'); // уезжает вниз, потом прячется
      setTimeout(function () { if (el.classList.contains('closing')) { el.classList.remove('closing'); el.hidden = true; } self.render(true); }, 200);
    },

    STEPS: [
      { k: 'rounds', lbl: 'w.rounds', f: String },
      { k: 'roundSec', lbl: 'w.round', f: fmt },
      { k: 'restSec', lbl: 'w.rest', f: function (v) { return v ? fmt(v) : L('none'); } },
      { k: 'prepSec', lbl: 'w.prep', f: function (v) { return v ? fmt(v) : L('none'); } },
      { k: 'warnSec', lbl: 'w.warn', f: function (v) { return v ? v + ' ' + L('unit.s') : L('none'); } }
    ],
    wheels: [],
    syncWheels: function () { this.wheels.forEach(function (w) { w.sync(); }); },
    buildSettings: function () {
      var self = this;
      // Готовые тренировки — над колёсами: одно касание, и колёса прокручиваются к значениям.
      PRESETS.forEach(function (p, i) {
        var b = document.createElement('button');
        b.className = 'opt preset'; b.type = 'button'; b.dataset.i = i; b.setAttribute('role', 'radio');
        b.innerHTML = '<b></b><span data-i18n="' + p.key + '"></span>';
        b.firstChild.textContent = p.rounds + ' × ' + fmt(p.roundSec) + ' / ' + fmt(p.restSec);
        b.onclick = function () { self.wheels.forEach(function (w) { if (w.key in p) w.go(p[w.key]); }); };
        $('presets').appendChild(b);
      });
      // Каждое значение листается колесом.
      var changed = function () { self.syncPresets(); self.render(true); };
      this.STEPS.forEach(function (d) {
        var cell = document.createElement('div');
        cell.className = 'wheel-cell';
        cell.innerHTML = '<span class="lbl" data-i18n="' + d.lbl + '"></span><div class="wheel wheel-sm" role="slider" data-i18n-aria="' + d.lbl + '"></div>';
        $('steppers').appendChild(cell);
        var w = makeWheel(cell.lastChild, d, changed);
        w.key = d.k;
        self.wheels.push(w);
      });
      document.querySelectorAll('.sheet-nav .tab').forEach(function (b) {
        b.onclick = function () { self.showTab(b.dataset.tab); };
      });
      // Режим: спарринг (свои раунды) или груша (готовая программа тренера по цели и уровню).
      var bagChanged = function () { save(); Plan.refresh(); self.syncSettings(); self.render(true); };
      $('modeSeg').querySelectorAll('button').forEach(function (b) {
        b.onclick = function () { S.mode = b.dataset.v; bagChanged(); };
      });
      BP.GOALS.forEach(function (g) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'opt goal'; b.dataset.v = g; b.setAttribute('role', 'radio');
        b.innerHTML = '<b data-i18n="goal.' + g + '"></b><span data-i18n="gsub.' + g + '"></span>';
        b.onclick = function () { S.bagGoal = g; bagChanged(); };
        $('goalOpts').appendChild(b);
      });
      $('levelSeg').querySelectorAll('button').forEach(function (b) {
        b.onclick = function () { S.bagLevel = b.dataset.v; bagChanged(); };
      });

      $('optVoice').onchange = function () { S.voice = this.checked; save(); self.syncSettings(); if (S.voice) Voice.speak(['round_1']); };
      $('optVolume').oninput = function () { S.volume = +this.value; Sound.setVolume(S.volume); save(); };
      $('optCount').onchange = function () { S.countVoice = this.checked; save(); };
      $('optHalf').onchange = function () { S.halfVoice = this.checked; save(); };
      $('optFlip').onchange = function () { S.flip = this.checked; save(); self.applyLook(); };
      $('optEco').onchange = function () { S.eco = this.checked; save(); self.applyLook(); };
      $('optDim').onchange = function () { S.dimIdle = this.checked; save(); };
      // Сигналы — выпадающие списки: выбор сразу проигрывается, отдельная «проверка звука» не нужна.
      var option = function (sel, v, key) { var o = document.createElement('option'); o.value = v; o.dataset.i18n = key; sel.appendChild(o); };
      document.querySelectorAll('[data-snd]').forEach(function (sel) {
        Sound.SIGNALS.forEach(function (v) { option(sel, v, 'snd.' + v); });
        sel.onchange = function () { S[sel.dataset.snd] = sel.value; save(); Sound.unlock(); Sound.play(sel.value); self.syncOpts(); };
      });
      // Тиканье: выкл / последние 5 / 10 секунд раунда и отдыха — выбрать и сразу услышать.
      [0, 5, 10].forEach(function (v) { option($('tickPick'), v, 'tick.' + v); });
      $('tickPick').onchange = function () {
        var v = +this.value;
        S.tickSec = v; save(); Sound.unlock(); self.syncOpts();
        if (v) [0, 1, 2].forEach(function (k) { setTimeout(function () { Sound.play('tick'); }, k * 1000); });
      };
      // Шрифт цифр: каждый вариант показан своим шрифтом.
      Object.keys(FONTS).forEach(function (v) {
        if (FONT_BASE.indexOf(v) < 0 && !hasFont(FONTS[v]) && S.font !== v) return;
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'opt font-opt'; b.dataset.v = v; b.setAttribute('role', 'radio');
        b.innerHTML = '<b style="font-family:' + FONTS[v].replace(/"/g, "'") + '">1:23</b><span data-i18n="font.' + v + '"></span>';
        b.onclick = function () { S.font = v; save(); self.applyLook(); self.syncOpts(); };
        $('fontOpts').appendChild(b);
      });
      for (var g = 1; g <= 7; g++) { var o = document.createElement('option'); o.value = g; $('goalPick').appendChild(o); }
      $('goalPick').onchange = function () { S.weekGoal = +this.value; save(); self.renderProgress(); self.renderStatus(); Remind.all(); };
      [2, 3, 4, 5, 6, 7, 1].forEach(function (d, i) { // пн…вс; номера — как в iOS (1 = воскресенье)
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'day'; b.dataset.d = d; b.dataset.i = i; b.innerHTML = '<span></span>'; // текст — в span: хаптика лежит первым ребёнком
        b.onclick = function () {
          var at = S.remindDays.indexOf(d);
          if (at >= 0) S.remindDays.splice(at, 1); else S.remindDays.push(d);
          save(); self.renderProgress(); Remind.sync();
        };
        $('remDays').appendChild(b);
      });
      $('remTime').onchange = function () { if (this.value) { S.remindTime = this.value; save(); Remind.sync(); } };
      $('optRemind').onchange = function () { Remind.enable(this.checked, function () { self.renderProgress(); }); };
      if (DONATE_URL) {
        $('donateLink').href = DONATE_URL; $('donate').hidden = false;
        // В приложении обычный переход на чужой сайт Capacitor сам открывает в Safari; на сайте — новая вкладка.
        if (NATIVE) $('donateLink').removeAttribute('target');
      }
      $('btnCal').onclick = function () { Cal.open(); };
      $('btnCalNext').onclick = function () { Cal.next(); };
      $('btnCalCancel').onclick = function () { Cal.cancel(); };
      $('btnCalReset').onclick = function () {
        S.calMic = null; S.calMotion = null; S.stompModel = null; save(); self.syncCal(); UI.toast(L('cl.reset'));
      };
      $('stompMode').onchange = function () {
        S.stompMode = this.value; save();
        if ((S.stompMode === 'mic' || S.stompMode === 'both') && Listen.cmdOn) {
          Listen.stopCommands(); S.commands = false; save();
          UI.toast(L('t.cmdOff'));
        }
        Stomp.apply(); self.syncSettings(); self.render(true);
      };
      $('stompPattern').querySelectorAll('button').forEach(function (b) {
        b.onclick = function () { S.stompPattern = b.dataset.v; save(); self.syncSettings(); self.render(true); };
      });
      $('stompDuring').onchange = function () {
        S.stompInRound = this.value === 'all'; S.loudRounds = this.value === 'none'; save();
        App.syncMic(0); self.syncSettings(); self.renderStatus();
      };
      $('optSens').oninput = function () { S.sens = +this.value; save(); };
      document.querySelectorAll('[data-lang-seg] button').forEach(function (b) {
        b.onclick = function () { self.setLang(b.dataset.v); };
      });
      $('optCommands').onchange = function () {
        S.commands = this.checked; save();
        if (S.commands) {
          if (Stomp.needsMic()) { S.stompMode = 'motion'; save(); Stomp.apply(); UI.toast(L('t.toMotion')); }
          Listen.startCommands();
        } else Listen.stopCommands();
        self.syncSettings();
      };
    },
    syncSettings: function () {
      this.syncWheels();
      this.syncPresets();
      this.syncOpts();
      $('optVoice').checked = S.voice;
      $('optVolume').value = S.volume;
      $('optCount').checked = S.countVoice;
      $('optHalf').checked = S.halfVoice;
      $('optFlip').checked = S.flip;
      $('optEco').checked = S.eco;
      $('optDim').checked = S.dimIdle;
      $('optSens').value = S.sens;
      $('optCommands').checked = S.commands;
      $('commandsSection').hidden = !Listen.supported;
      $('voiceOpts').hidden = !S.voice;
      $('stompOpts').hidden = S.stompMode === 'off';
      document.querySelectorAll('.stomp-only').forEach(function (r) { r.hidden = S.stompMode === 'off'; });
      var bag = S.mode === 'bag';
      $('sparOpts').hidden = bag; $('bagOpts').hidden = !bag;
      $('modeSeg').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === S.mode); });
      $('levelSeg').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === S.bagLevel); });
      document.querySelectorAll('#goalOpts .opt').forEach(function (b) { var on = b.dataset.v === S.bagGoal; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
      if (bag && Plan.prog) {
        var P = Plan.prog, lens = P.rounds.map(function (r) { return r.sec; });
        var mn = Math.min.apply(null, lens), mx = Math.max.apply(null, lens);
        $('bagDesc').textContent = L('bag.desc', { rounds: P.rounds.length, len: mn === mx ? fmt(mn) : fmt(mn) + '–' + fmt(mx),
          rest: fmt(P.rest), min: Math.round(P.total / 60) });
        this.renderBagPlan(P);
      }
      var during = App.stompDuring();
      $('stompDuring').value = during;
      $('stompDuringHint').textContent = {
        none: Stomp.needsMic() ? L('duh.noneMic') : L('duh.none'),
        rest: L('duh.rest') + (Stomp.needsMic() ? L('duh.quieter') : ''),
        all: L('duh.all') + (Stomp.needsMic() ? L('duh.quieter') : '')
      }[during];
      $('stompMode').value = S.stompMode;
      $('stompPattern').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === S.stompPattern); });
      $('stompModeHint').textContent = L('smh.' + S.stompMode);
      this.syncCal();
      this.voiceStatus();
      this.renderProgress();
    },
    // Программа груши по раундам: полоса отрезков (цвет = темп, как его слышно) и задание раунда.
    renderBagPlan: function (P) {
      var box = $('bagPlan'), lang = S.lang === 'en' ? 'en' : 'ru';
      var kind = function (t) { return t === 'max' ? 'max' : t === 'hard' ? 'hard' : 'calm'; };
      var EN = { 'уклон': 'slip', 'нырок': 'roll', 'шаг': 'step' }, used = {};
      box.textContent = '';
      P.rounds.forEach(function (R, i) {
        var li = document.createElement('li'), bar = document.createElement('div'), t = document.createElement('span');
        var c = BP.COMBOS[R.theme] || BP.CUES[R.theme] || { ru: R.theme, en: R.theme }, nums = c.nums || '';
        if (lang === 'en') nums = nums.replace(/[а-я]+/g, function (w) { return EN[w] || w; });
        bar.className = 'segs';
        R.segs.forEach(function (sg) {
          var x = document.createElement('i'); x.className = 'k-' + kind(sg.type); x.style.flexGrow = sg.sec; bar.appendChild(x);
          used[kind(sg.type)] = 1;
        });
        t.textContent = (i === 0 ? L('bag.warm') + ' → ' : '') + c[lang] + ' ';
        if (nums) { var n = document.createElement('small'); n.textContent = nums; t.appendChild(n); }
        li.appendChild(bar); li.appendChild(t); box.appendChild(li);
      });
      // В легенде — только темпы, которые есть в программе (у новичков нет «максимума»).
      document.querySelectorAll('.bag-legend span').forEach(function (x) { x.hidden = !used[x.className.slice(2)]; });
    },
    // «Прогресс»: неделя к цели, серия недель, календарь 12 недель (ярче — больше раундов), месяц и всего.
    renderProgress: function () {
      var x = Hist.sum(), wd = L('wd.short').split(',');
      $('prWeekSub').textContent = x.week.count >= x.goal ? L('pr.weekDone', { w: L('n.workouts', { n: x.week.count }) }) : L('pr.weekSub', { n: x.week.count, goal: x.goal });
      $('prWeekFill').style.width = Math.min(100, x.week.count / x.goal * 100) + '%';
      $('goalPick').querySelectorAll('option').forEach(function (o) { o.textContent = L('pr.goalN', { n: o.value }); });
      $('goalPick').value = String(S.weekGoal);
      $('prStreak').textContent = L('pr.weeks', { n: x.streak }) + (x.best > x.streak ? ' · ' + L('pr.best', { n: x.best }) : '');
      var heat = $('prHeat'), html = '';
      x.grid.forEach(function (w) {
        w.forEach(function (c) {
          var lv = c.future ? 'f' : c.r >= 12 ? 4 : c.r >= 8 ? 3 : c.r >= 4 ? 2 : c.r > 0 ? 1 : 0;
          html += '<i class="l' + lv + (c.d === ST.today() ? ' today' : '') + '" title="' + c.d + (c.r ? ' · ' + c.r : '') + '"></i>';
        });
      });
      heat.innerHTML = html;
      var line = function (a) {
        var t = a.min >= 60 ? L('pr.h', { h: Math.floor(a.min / 60), m: a.min % 60 }) : L('pr.m', { m: a.min });
        return L('pr.line', { rounds: L('n.rounds', { n: a.rounds }), time: t });
      };
      $('prMonth').textContent = line(x.month); $('prMonthN').textContent = L('n.workouts', { n: x.month.count });
      $('prTotal').textContent = line(x.total); $('prTotalN').textContent = L('n.workouts', { n: x.total.count });
      $('remGroup').hidden = !Remind.ok();
      $('optRemind').checked = S.remind;
      $('remWhen').hidden = !S.remind;
      $('remTime').value = S.remindTime;
      document.querySelectorAll('#remDays .day').forEach(function (b) {
        b.lastChild.textContent = wd[+b.dataset.i];
        b.classList.toggle('on', S.remindDays.indexOf(+b.dataset.d) >= 0);
      });
    },
    syncPresets: function () {
      document.querySelectorAll('.preset').forEach(function (b) {
        var p = PRESETS[+b.dataset.i];
        var on = p.rounds === S.rounds && p.roundSec === S.roundSec && p.restSec === S.restSec;
        b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
      });
    },
    syncCal: function () {
      var parts = [];
      if (Stomp.needsMic()) parts.push(S.stompModel ? L('cal.model', { p: Math.round(S.stompModel.acc * 100) }) : S.calMic ? L('cal.thr') : null);
      if (Stomp.needsMotion()) parts.push(S.calMotion ? L('cal.motion') : null);
      parts = parts.filter(Boolean);
      $('calText').textContent = S.stompMode === 'off' ? L('cal.off') :
        parts.length ? L('cal.offline', { parts: parts.join(' · ') }) : L('cal.none');
      $('btnCalReset').hidden = !(S.calMic || S.calMotion || S.stompModel);
    },
    voiceStatus: function () {
      var el = $('voiceStatus'); if (!el) return;
      // Пишем, только когда есть что сказать: загрузка или проблема. Всё готово — тишина.
      var n = Clips.count(), t = Clips.total;
      if (!t) el.textContent = Clips.loading ? L('vs.loading') : L('vs.missing');
      else if (n < t) el.textContent = L(Object.keys(Clips.raw).length >= t ? 'vs.prepare' : 'vs.download', { p: Math.round(n / t * 100) });
      else el.textContent = '';
    },

    calibHits: 0,
    onRawHit: function () {
      if ($('settings').hidden) return;
      var m = document.querySelector('.meter');
      m.classList.add('hit'); setTimeout(function () { m.classList.remove('hit'); }, 200);
    },
    onModelScore: function (p, lowHigh) {
      if ($('settings').hidden) return;
      $('meterCount').textContent = p == null ? L('meter.noLow') : L('meter.model', { verdict: L(p >= 0.5 ? 'meter.yes' : 'meter.no'), p: Math.round(p * 100) });
    },
    onCalibStomp: function () {
      this.calibHits++;
      $('meterCount').textContent = L('meter.hits', { n: this.calibHits });
      Sound.play('blip');
    },
    meterOn: false,
    meterLoop: function () {
      var self = this;
      if ($('settings').hidden) { this.meterOn = false; return; }
      var lvl, thr;
      if (S.stompMode === 'motion') { lvl = Stomp.mLevel; thr = Stomp.mThr; }
      else { lvl = Stomp.level; thr = Stomp.micThr(now(), Stomp.floor); }
      $('meterFill').style.width = Math.min(100, lvl / (thr * 2 || 1) * 100) + '%';
      setTimeout(function () { requestAnimationFrame(function () { self.meterLoop(); }); }, 50);
    }
  };

  /* ================= События ================= */
  $('gate').addEventListener('click', function () { App.unlock(); });
  // Весь экран — одна большая кнопка: первое касание включает звук и топот, дальше — старт и пауза.
  $('stage').addEventListener('click', function (e) {
    UI.wake();
    if (e.target.closest('button, .pause-controls')) return;
    if (!App.unlocked) { App.unlock(); return; }
    var T = Timer;
    if (T.phase === 'idle') { Haptic.play('strong'); T.start(); }
    else if (T.phase === 'done') T.reset(); // с итога — к готовности; случайное касание не запустит 10 раундов
    else if (T.paused) { Haptic.play('strong'); T.resume(); }
    else { Haptic.play('strong'); T.pause(); }
  });
  $('dim').addEventListener('click', function () { UI.wake(); });
  // Тик на каждую кнопку, переключатель и список. Главные действия — двойной тик.
  document.addEventListener('click', function (e) {
    var t = e.target;
    var b = t.closest && t.closest('button, input[type="checkbox"], select');
    if (!b || b.disabled) return;
    var strong = b.id === 'btnResume' || b.id === 'btnGate' || (b.id === 'btnReset' && b.classList.contains('confirm'));
    Haptic.play(strong ? 'strong' : 'tap');
  }, true);
  $('btnResume').onclick = function () { Timer.resume(); };
  $('btnSkip').onclick = function () { Timer.skip(); };
  $('btnReset').onclick = function () { if (this.classList.contains('confirm')) Timer.reset(); else UI.resetConfirm(true); };
  $('planBtn').onclick = function () { UI.openSettings('workout'); };
  $('btnPauseSettings').onclick = function () { UI.openSettings(); };
  $('chipSettings').onclick = function () { UI.openSettings(); };
  $('chipVoice').onclick = function () { Listen.once(); };
  $('btnSettingsClose').onclick = function () { UI.closeSettings(); };
  $('btnVoiceClose').onclick = function () { Listen.closeOnce(); };
  document.addEventListener('pointerdown', function () { UI.lastActive = now(); Stomp.touched(); }, { passive: true, capture: true });
  document.addEventListener('pointerup', function () { Stomp.touched(); }, { passive: true, capture: true });

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); if (Timer.phase === 'idle' || Timer.phase === 'done') { if (!App.unlocked) App.unlock(); Timer.start(); } else if (Timer.paused) Timer.resume(); else Timer.pause(); }
    if (e.key === 's' || e.key === 'ы') Stomp.raw('key', now());
    if (e.key === 'n' || e.key === 'т') Timer.skip();
    if (e.key === 'r' || e.key === 'к') Timer.reset();
  });

  // Шрифт табло догружается из файла — после загрузки ширина цифр другая, подгоняем заново.
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { UI.fitClock(true); });
  window.addEventListener('resize', function () { UI.fitClock(true); if (!App.unlocked) UI.renderStatus(); }); // совет про поворот

  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { hiddenAt = now(); clearTimeout(Timer.tickTimer); return; }
    if (Sound.ctx && Sound.ctx.state !== 'running') Sound.ctx.resume().catch(function () {});
    if (App.unlocked) Wake.request();
    if (App.unlocked && App.micWanted() && !Stomp.listening() && !Stomp.paused) Stomp.startMic().then(function () { UI.renderStatus(); });
    Timer.tick(); UI.render(true); Timer.schedule();
    setTimeout(function () {
      if (App.unlocked && Sound.ctx && Sound.ctx.state !== 'running') {
        App.regate(L('gate.back'));
        return;
      }
    }, 600);
  });

  // Страховка раз в секунду (дёшево): если таймер setTimeout отстал — догоняем.
  setInterval(function () { if (Timer.running() && !Timer.paused) { Timer.tick(); UI.render(false); } }, 1000);
  setInterval(function () { UI.checkDim(); }, 15000);

  UI.applyLook();
  UI.buildSettings();
  UI.applyLang();
  Voice.loadSystem();
  Sound.loadSamples();
  Clips.load(curVoice());
  Plan.refresh();
  Remind.all(); // текст напоминаний — про текущую серию; виджет — свежие данные
  UI.syncSettings();
  UI.render(true);
  // В приложении звук разрешён без касания — таймер сразу готов, топот слышно с первой секунды.
  // Если iOS всё же не дала звук — как на сайте: первое касание включает.
  if (NATIVE) {
    App.unlock();
    setTimeout(function () { if (!Sound.ctx || Sound.ctx.state !== 'running') { App.unlocked = false; UI.renderStatus(); } }, 800);
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) UI.toast(L('t.update'));
    });
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  window.BoxTimer = { Timer: Timer, UI: UI, FONTS: FONTS, Plan: Plan, Coach: Coach, Stomp: Stomp, Sound: Sound, Voice: Voice, Clips: Clips, App: App, Cal: Cal, Wake: Wake, S: S };
})();
