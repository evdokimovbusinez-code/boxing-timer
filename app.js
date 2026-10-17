/* Боксёрский таймер — iPhone, горизонтальный экран, голос, топот. */
(function () {
  'use strict';

  var P = window.BoxParse;
  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return performance.now(); };

  /* ================= Настройки ================= */
  var DEFAULTS = {
    rounds: 10, roundSec: 120, restSec: 60, prepSec: 10, warnSec: 10,
    voice: true, countVoice: false, halfVoice: false, voiceURI: '', volume: 1,
    stompMode: 'mic', stompPattern: 'double', stompInRound: false, sens: 0.55,
    calMic: null, calMotion: null,
    commands: false
  };
  var PRESETS = [
    { name: 'Спарринг', rounds: 10, roundSec: 120, restSec: 60 },
    { name: 'Проф', rounds: 12, roundSec: 180, restSec: 60 },
    { name: 'Любители', rounds: 3, roundSec: 180, restSec: 60 },
    { name: 'Мешок', rounds: 6, roundSec: 180, restSec: 30 },
    { name: 'Табата', rounds: 8, roundSec: 20, restSec: 10 }
  ];
  var KEY = 'boxing-timer.settings.v1';
  var S = Object.assign({}, DEFAULTS);
  try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ================= Звук (синтез, без файлов) ================= */
  var Sound = {
    ctx: null, master: null, noise: null, busyUntil: 0,
    init: function () {
      if (this.ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      var comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 4;
      comp.attack.value = 0.002; comp.release.value = 0.2;
      this.master = this.ctx.createGain();
      this.master.gain.value = S.volume;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      var len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var d = this.noise.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    },
    unlock: function () {
      this.init();
      if (!this.ctx) return Promise.resolve();
      var b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      return this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume().catch(function () {});
    },
    setVolume: function (v) { if (this.master) this.master.gain.value = v; },
    mark: function (sec) { this.busyUntil = Math.max(this.busyUntil, now() + sec * 1000 + 250); Stomp.muteFor(sec * 1000 + 250); },

    // Металлический удар: набор негармонических обертонов с затуханием.
    strike: function (t, f0, partials, decay, gain) {
      var c = this.ctx;
      partials.forEach(function (p, i) {
        var o = c.createOscillator(), g = c.createGain();
        o.type = 'sine';
        o.frequency.value = f0 * p[0];
        var d = decay / (1 + i * 0.45);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain * p[1], t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g); g.connect(Sound.master);
        o.start(t); o.stop(t + d + 0.05);
      });
      var n = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain();
      n.buffer = this.noise; bp.type = 'bandpass'; bp.frequency.value = f0 * 3; bp.Q.value = 2;
      ng.gain.setValueAtTime(gain * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      n.connect(bp); bp.connect(ng); ng.connect(this.master); n.start(t); n.stop(t + 0.05);
    },
    BELL: [[1, 1], [2.0, 0.45], [2.76, 0.6], [5.4, 0.28], [8.93, 0.14]],
    GONG: [[1, 1], [1.003, 0.6], [1.5, 0.35], [2.0, 0.55], [2.92, 0.3], [4.07, 0.18], [5.2, 0.09]],

    play: function (name) {
      if (!this.ctx) return;
      if (this.ctx.state !== 'running') this.ctx.resume().catch(function () {});
      var t = this.ctx.currentTime + 0.03, self = this;
      switch (name) {
        case 'bellStart': // три быстрых высоких «дзынь» — начало раунда
          [0, 0.3, 0.6].forEach(function (dt) { self.strike(t + dt, 1320, self.BELL, 1.3, 0.55); });
          this.mark(1.9); break;
        case 'gongEnd': // два низких протяжных «донг» — конец раунда
          this.strike(t, 205, this.GONG, 3.2, 0.95);
          this.strike(t + 0.85, 205, this.GONG, 2.6, 0.8);
          this.mark(3.4); break;
        case 'finish': // конец тренировки — гонг трижды
          [0, 0.8, 1.6].forEach(function (dt) { self.strike(t + dt, 185, self.GONG, 3, 0.95); });
          this.mark(4.5); break;
        case 'clapper': // «тук-тук-тук» деревянные палочки — 10 секунд
          [0, 0.14, 0.28].forEach(function (dt) { self.knock(t + dt); });
          this.mark(0.6); break;
        case 'beep': this.tone(t, 880, 0.16, 0.6); this.mark(0.25); break;
        case 'beepHigh': this.tone(t, 1175, 0.16, 0.6); this.mark(0.25); break;
        case 'blip': this.tone(t, 1400, 0.06, 0.35); this.tone(t + 0.07, 1900, 0.08, 0.35); this.mark(0.2); break;
      }
    },
    knock: function (t) {
      var c = this.ctx;
      var n = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
      n.buffer = this.noise; bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 6;
      g.gain.setValueAtTime(1.6, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      n.connect(bp); bp.connect(g); g.connect(this.master); n.start(t); n.stop(t + 0.07);
      var o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(1050, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.05);
      og.gain.setValueAtTime(0.7, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
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

  /* ================= Голос (озвучка) ================= */
  var Voice = {
    voice: null, speaking: false, speakingUntil: 0, quietUntil: 0, voices: [],
    timer: null, keep: [],
    supported: 'speechSynthesis' in window,
    // onend на iOS иногда не приходит — не даём «говорит» залипнуть навсегда.
    isSpeaking: function () { return this.speaking && now() < this.speakingUntil; },
    load: function () {
      if (!this.supported) return;
      var all = speechSynthesis.getVoices() || [];
      this.voices = all.filter(function (v) { return /^ru/i.test(v.lang); });
      var pick = null;
      if (S.voiceURI) pick = this.voices.find(function (v) { return v.voiceURI === S.voiceURI; });
      if (!pick) pick = this.voices.find(function (v) { return /premium|enhanced|улучш/i.test(v.name); }) || this.voices[0] || null;
      this.voice = pick;
      UI.fillVoices();
    },
    unlock: function () {
      if (!this.supported) return;
      var u = new SpeechSynthesisUtterance(' ');
      u.volume = 0; u.lang = 'ru-RU';
      speechSynthesis.speak(u);
    },
    say: function (text, opts) {
      if (!this.supported || !S.voice || !text) return;
      opts = opts || {};
      var self = this;
      var go = function () {
        self.timer = null;
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'ru-RU';
        if (self.voice) u.voice = self.voice;
        u.rate = opts.rate || 1.05; u.pitch = 1; u.volume = 1;
        var est = 400 + text.length * 75 / (u.rate || 1);
        self.speaking = true;
        self.speakingUntil = now() + est + 1500;
        self.quietUntil = now() + est + 700;
        Stomp.muteFor(est + 400);
        // Держим ссылку: иначе Safari может собрать фразу сборщиком мусора и onend не придёт.
        self.keep.push(u); if (self.keep.length > 6) self.keep.shift();
        u.onend = u.onerror = function () {
          self.speaking = false;
          self.quietUntil = now() + 700;
          Stomp.muteFor(350);
        };
        speechSynthesis.speak(u);
      };
      // Новая фраза отменяет ещё не сказанную — без этого две фразы подряд звучали обе.
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      if (opts.queue) { go(); return; }
      if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); this.timer = setTimeout(go, 80); }
      else go();
    },
    // Отложенная фраза звучит, только если за это время ничего не поменялось (пауза, пропуск, сброс).
    later: function (ms, text, opts) {
      var self = this, ep = Timer.epoch;
      setTimeout(function () { if (Timer.epoch === ep && !Timer.paused && Timer.phase !== 'idle') self.say(text, opts); }, ms);
    },
    cancel: function () {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      if (this.supported) speechSynthesis.cancel();
      this.speaking = false;
    }
  };
  if (Voice.supported) speechSynthesis.onvoiceschanged = function () { Voice.load(); };

  /* ================= Экран не гаснет ================= */
  // Держим экран всё время, пока приложение открыто: если экран погаснет в ожидании,
  // iPhone усыпит страницу и старт топотом перестанет работать.
  var Wake = {
    lock: null,
    request: function () {
      if (!('wakeLock' in navigator) || this.lock || document.visibilityState !== 'visible') return;
      var self = this;
      navigator.wakeLock.request('screen').then(function (l) {
        self.lock = l; l.addEventListener('release', function () { self.lock = null; });
      }).catch(function () {});
    },
    release: function () { if (this.lock) { this.lock.release().catch(function () {}); this.lock = null; } }
  };

  /* ================= Детектор топота ================= */
  var D = window.BoxDetect;
  var Stomp = {
    stream: null, analyser: null, buf: null, timer: null, starting: null,
    motionOn: false, mPrev: null,
    micDet: new D.OnsetDetector({ floor0: 0.01, dt: 12, refractory: 120 }),
    motDet: new D.OnsetDetector({ floor0: 0.05, dt: 16, refractory: 140, minFloor: 0.005 }),
    dbl: new D.DoubleTap(90, 900),
    muteUntil: 0, level: 0, thr: 1, mLevel: 0, mThr: 1,
    lastMic: -1e9, lastMotion: -1e9,
    paused: false, cal: null, calTimer: null,

    muteFor: function (ms) { this.muteUntil = Math.max(this.muteUntil, now() + ms); },
    needsMic: function () { return S.stompMode === 'mic' || S.stompMode === 'both'; },
    needsMotion: function () { return S.stompMode === 'motion' || S.stompMode === 'both'; },
    micLive: function () { return !!(this.stream && this.stream.getAudioTracks().some(function (t) { return t.readyState === 'live'; })); },

    // Вызывать внутри обработчика касания (iOS требует жест для разрешений).
    apply: function () {
      var jobs = [];
      if (this.needsMotion()) jobs.push(this.startMotion()); else this.stopMotion();
      if (this.needsMic() && !this.paused) jobs.push(this.startMic()); else this.stopMic();
      var self = this;
      return Promise.all(jobs).then(function () { UI.renderChips(); return self; });
    },

    startMic: function () {
      var self = this;
      if (this.micLive() && this.analyser) return Promise.resolve();
      if (this.starting) return this.starting; // защита от двойного getUserMedia
      if (this.stream) this.stopMic();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        UI.toast('Микрофон недоступен в этом браузере'); return Promise.resolve();
      }
      Sound.init();
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) {}
      this.starting = navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      }).then(function (stream) {
        if (!self.needsMic() || self.paused) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        self.stream = stream;
        var c = Sound.ctx;
        var src = c.createMediaStreamSource(stream);
        // Топот — низкий глухой звук; хлопки и щелчки перчаток отсекаем.
        var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.Q.value = 0.7;
        self.analyser = c.createAnalyser(); self.analyser.fftSize = 1024;
        self.buf = new Float32Array(self.analyser.fftSize);
        src.connect(lp); lp.connect(self.analyser);
        self.micDet.reset(0.01);
        clearInterval(self.timer);
        self.timer = setInterval(function () { self.pollMic(); }, 12);
        stream.getAudioTracks()[0].addEventListener('ended', function () { self.stopMic(); UI.renderChips(); });
      }).catch(function () {
        UI.toast('Нет доступа к микрофону — разреши в Настройках iPhone или выбери «Датчик»');
      }).then(function () { self.starting = null; });
      return this.starting;
    },
    stopMic: function () {
      clearInterval(this.timer); this.timer = null;
      if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
      this.stream = null; this.analyser = null;
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    },
    micThr: function (t) {
      return D.threshold({ sens: S.sens, cal: S.calMic, floor: this.micDet.floor, second: this.dbl.waiting(t), absHi: 0.12, absLo: 0.012 });
    },
    motThr: function (t) {
      return D.threshold({ sens: S.sens, cal: S.calMotion, floor: this.motDet.floor, second: this.dbl.waiting(t), absHi: 3.2, absLo: 0.18 });
    },
    pollMic: function () {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      var peak = 0;
      for (var i = 0; i < this.buf.length; i++) { var a = Math.abs(this.buf[i]); if (a > peak) peak = a; }
      var t = now(), prev = this.micDet.slow;
      var thr = this.micThr(t);
      this.level = peak; this.thr = thr;
      var hit = this.micDet.push(peak, t, thr);
      if (this.cal) { this.cal.mic.push(peak, t, this.micDet.floor, prev); return; }
      if (hit && t > this.muteUntil) { this.lastMic = t; this.raw('mic', t); }
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
          if (r === 'granted') begin(); else UI.toast('Нет доступа к датчику движения');
        }).catch(function () { UI.toast('Датчик: нажми «Включить» ещё раз'); });
      }
      if (typeof DeviceMotionEvent === 'undefined') { UI.toast('Датчик движения недоступен'); return Promise.resolve(); }
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
        var prev = self.motDet.slow, thr = self.motThr(t);
        self.mLevel = d; self.mThr = thr;
        var hit = self.motDet.push(d, t, thr);
        if (self.cal) self.cal.motion.push(d, t, self.motDet.floor, prev);
        else if (hit && t > self.muteUntil) { self.lastMotion = t; self.raw('motion', t); }
      }
      self.mPrev = { x: a.x, y: a.y, z: a.z };
    },

    // Сырой удар → правило «оба» → одиночный/двойной.
    raw: function (src, t) {
      if (S.stompMode === 'both') {
        var other = src === 'mic' ? this.lastMotion : this.lastMic;
        if (t - other > 160) return;
        this.lastMic = this.lastMotion = -1e9;
      }
      UI.onRawHit();
      if (S.stompPattern === 'single') { this.fire(); return; }
      var r = this.dbl.push(t);
      if (r === 'double') this.fire();
      else if (r === 'first') UI.onFirstHit();
    },
    fire: function () { App.onStomp(); },

    /* ---- Автокалибровка: человек топает 4 раза, порог ставится под его топот ---- */
    calibrate: function (onDone) {
      var self = this;
      this.dbl.clear();
      this.cal = { start: now(), mic: new D.PeakCollector(4), motion: new D.PeakCollector(4), onDone: onDone };
      clearTimeout(this.calTimer);
      this.calTimer = setTimeout(function () { self.finishCal(); }, 8000);
    },
    calCount: function () {
      if (!this.cal) return 0;
      var n = 0;
      if (this.needsMic()) n = Math.max(n, this.cal.mic.events.length);
      if (this.needsMotion()) n = Math.max(n, this.cal.motion.events.length);
      return n;
    },
    finishCal: function () {
      var c = this.cal; if (!c) return;
      this.cal = null; clearTimeout(this.calTimer);
      var res = {};
      if (this.needsMic()) res.mic = c.mic.level();
      if (this.needsMotion()) res.motion = c.motion.level();
      this.dbl.clear();
      c.onDone(res);
    },

    listening: function () { return (this.needsMic() && !!this.analyser) || (this.needsMotion() && this.motionOn); }
  };

  /* ================= Таймер ================= */
  var Timer = {
    phase: 'idle', round: 0, paused: false,
    endAt: 0, left: 0, dur: 0, lastSec: null,
    epoch: 0, // меняется при любом переходе — отложенные фразы старой фазы не звучат

    phaseLen: function (p) {
      if (p === 'prep') return S.prepSec; if (p === 'round') return S.roundSec;
      if (p === 'rest') return S.restSec; return 0;
    },
    remaining: function () { return this.paused ? this.left : Math.max(0, this.endAt - now()); },
    running: function () { return this.phase === 'prep' || this.phase === 'round' || this.phase === 'rest'; },

    start: function () {
      Sound.unlock();
      this.round = 1;
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
      if (!silent) this.announce(p);
      UI.render(true);
    },
    next: function (carry, silent) {
      if (this.phase === 'prep') return this.enter('round', carry, silent);
      if (this.phase === 'round') {
        if (this.round >= S.rounds) return this.enter('done', 0, silent);
        return this.enter('rest', carry, silent);
      }
      if (this.phase === 'rest') { this.round++; return this.enter('round', carry, silent); }
    },
    pause: function () {
      if (!this.running() || this.paused) return;
      this.left = this.remaining(); this.paused = true; this.epoch++;
      Voice.say('Пауза');
      UI.render(true);
    },
    resume: function () {
      if (!this.paused) return;
      this.endAt = now() + this.left; this.paused = false; this.epoch++;
      Sound.unlock(); Wake.request();
      Voice.say('Продолжаем');
      UI.render(true);
    },
    skip: function () {
      if (!this.running()) return;
      this.paused = false;
      this.next(0, false);
    },
    reset: function () {
      this.phase = 'idle'; this.round = 0; this.paused = false; this.epoch++;
      Voice.cancel();
      UI.render(true);
    },

    isLast: function () { return this.round >= S.rounds; },
    announce: function (p) {
      var r = this.round, total = S.rounds;
      if (p === 'prep') {
        Voice.say('Приготовиться. ' + total + ' ' + P.plural(total, ['раунд', 'раунда', 'раундов']) + ' по ' + P.durWords(S.roundSec).replace(/^минута$/, 'минуте'));
      } else if (p === 'round') {
        Sound.play('bellStart');
        var call = total > 1 && r === total ? 'Последний раунд. Бокс!' : (total > 1 ? 'Раунд ' + r + '. Бокс!' : 'Бокс!');
        Voice.later(1000, call);
      } else if (p === 'rest') {
        Sound.play('gongEnd');
        var left = total - r;
        var tail = left === 1 ? 'Остался последний раунд' :
          'Осталось ' + left + ' ' + P.plural(left, ['раунд', 'раунда', 'раундов']);
        Voice.later(1500, 'Стоп. Отдых. ' + tail);
      } else if (p === 'done') {
        Sound.play('finish');
        Voice.later(2000, 'Тренировка окончена. Отличная работа!');
      }
    },

    // Вызывается часто; события срабатывают на смене секунды.
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
      if (sec !== this.lastSec) {
        this.lastSec = sec;
        this.onSecond(sec);
      }
    },
    onSecond: function (sec) {
      var w = S.warnSec, p = this.phase;
      if (p === 'round') {
        if (w > 0 && sec === w && this.dur > (w + 2) * 1000) {
          Sound.play('clapper');
          Voice.later(450, w + ' ' + P.plural(w, ['секунда', 'секунды', 'секунд']));
        }
        if (S.halfVoice && this.dur >= 60000 && sec === Math.round(this.dur / 2000) && sec > w + 2) {
          Sound.play('beepHigh');
          Voice.later(300, 'Половина');
        }
        if (S.countVoice && sec >= 1 && sec <= 5 && sec < w) {
          Voice.say(['', 'один', 'два', 'три', 'четыре', 'пять'][sec], { rate: 1.25 });
        } else if (!S.countVoice && sec >= 1 && sec <= 3) {
          Sound.play('beep');
        }
      } else if (p === 'rest' || p === 'prep') {
        if (sec === 10 && this.dur > 13000) {
          var nr = p === 'prep' ? 1 : this.round + 1;
          var what = nr === S.rounds && S.rounds > 1 ? 'последний раунд' : 'раунд ' + nr;
          Voice.say('Десять секунд. Готовимся, ' + what);
        }
        if (sec >= 1 && sec <= 3) Sound.play('beepHigh');
      }
    }
  };

  /* ================= Голосовой ввод ================= */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var Listen = {
    supported: !!SR, rec: null, cmdOn: false, oneShot: false,

    once: function () {
      if (!this.supported) { UI.toast('Распознавание речи не поддерживается. Обнови iOS или открой в Safari.'); return; }
      this.stopCommands(true);
      Stomp.paused = true; Stomp.stopMic();
      Voice.cancel();
      var r = new SR(); this.rec = r; this.oneShot = true;
      r.lang = 'ru-RU'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      var layer = $('voiceLayer');
      layer.hidden = false; layer.classList.add('listening');
      $('voiceText').textContent = ''; $('voiceResult').textContent = '';
      $('voicePrompt').textContent = 'Говори: «10 раундов по 2 минуты, отдых минута»';
      var finalText = '';
      r.onresult = function (e) {
        var txt = '';
        for (var i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        $('voiceText').textContent = '«' + txt + '»';
        if (e.results[e.results.length - 1].isFinal) finalText = txt;
      };
      r.onerror = function (e) {
        $('voiceResult').textContent = e.error === 'not-allowed' ? 'Нет доступа к микрофону/речи' : 'Не расслышал, попробуй ещё раз';
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
      $('voiceLayer').hidden = true;
      Stomp.paused = false;
      Stomp.apply();
      if (S.commands) this.startCommands();
    },

    startCommands: function () {
      if (!this.supported || this.cmdOn) return;
      this.cmdOn = true;
      var self = this;
      var r = new SR(); this.rec = r;
      r.lang = 'ru-RU'; r.continuous = true; r.interimResults = false;
      r.onresult = function (e) {
        var res = e.results[e.results.length - 1];
        if (!res.isFinal) return;
        if (now() < Voice.quietUntil || Voice.isSpeaking()) return; // не реагируем на собственный голос
        App.handleSpeech(res[0].transcript, false);
      };
      r.onerror = function (e) {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          self.cmdOn = false; S.commands = false; save(); UI.syncSettings();
          UI.toast('iPhone не дал доступ к распознаванию речи');
        }
      };
      r.onend = function () { if (self.cmdOn) setTimeout(function () { try { r.start(); } catch (e) {} }, 250); };
      try { r.start(); } catch (e) { this.cmdOn = false; }
      UI.renderChips();
    },
    stopCommands: function (temporary) {
      if (!this.cmdOn) return;
      this.cmdOn = false;
      try { this.rec && this.rec.abort(); } catch (e) {}
      if (!temporary) UI.renderChips();
    }
  };

  /* ================= Приложение ================= */
  var App = {
    unlocked: false,

    unlock: function () {
      Sound.unlock(); Voice.unlock(); Wake.request();
      try { if (navigator.audioSession && !Stomp.needsMic()) navigator.audioSession.type = 'playback'; } catch (e) {}
      Voice.load();
      this.unlocked = true;
      $('gate').hidden = true;
      $('gateText').textContent = 'Нажми один раз — iPhone разрешит звук, голос и датчики для топота.';
      Stomp.apply().then(function () {
        if (S.commands) Listen.startCommands();
      });
      UI.render(true);
    },

    // Звук пропал (iOS усыпил аудио, пока приложение было в фоне) — просим одно касание.
    regate: function (text) {
      $('gateText').textContent = text;
      $('gate').hidden = false;
    },

    starting: false,
    onStomp: function () {
      if (!$('settings').hidden) { UI.onCalibStomp(); return; }
      if (!$('voiceLayer').hidden || !$('gate').hidden || this.starting) return;
      var T = Timer, self = this;
      if (T.phase === 'idle' || T.phase === 'done') {
        UI.flashStomp(); Sound.play('blip'); Voice.say('Старт');
        this.starting = true;
        setTimeout(function () {
          self.starting = false;
          if (T.phase === 'idle' || T.phase === 'done') T.start();
        }, 500);
        return;
      }
      if (T.paused) { UI.flashStomp(); T.resume(); return; }
      if (T.phase === 'round' && !S.stompInRound) return;
      UI.flashStomp(); T.pause();
    },

    handleSpeech: function (text, fromOnce) {
      var cmd = P.parseCommand(text);
      var cfg = P.parseWorkout(text);
      var keys = Object.keys(cfg);
      if (keys.length && (Timer.phase === 'idle' || Timer.phase === 'done' || Timer.paused || fromOnce)) {
        Object.assign(S, cfg); save();
        UI.syncSettings(); UI.render(true);
        var msg = App.describe();
        $('voiceResult').textContent = msg;
        UI.toast(msg);
        Voice.say(msg + '. Готово');
        if (!cmd || cmd !== 'start') return;
      }
      if (!cmd) {
        if (fromOnce) $('voiceResult').textContent = 'Не понял. Пример: «12 раундов по 3 минуты, отдых минута»';
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
      return S.rounds + ' ' + P.plural(S.rounds, ['раунд', 'раунда', 'раундов']) +
        ' по ' + fmt(S.roundSec) + ', отдых ' + (S.restSec ? fmt(S.restSec) : 'нет');
    }
  };

  /* ================= Интерфейс ================= */
  var UI = {
    lastKey: '',
    render: function (force) {
      var T = Timer, b = document.body;
      b.dataset.phase = T.phase;
      b.dataset.paused = T.paused ? '1' : '0';
      b.classList.toggle('running', T.running() && !T.paused);
      var rem = T.remaining(), sec = Math.ceil(rem / 1000);
      var shown = T.phase === 'idle' ? S.roundSec : T.phase === 'done' ? S.rounds * S.roundSec : sec;
      var warn = (T.phase === 'round' && S.warnSec > 0 && sec <= S.warnSec) ||
                 ((T.phase === 'rest' || T.phase === 'prep') && sec <= 10 && T.dur > 13000) ||
                 ((T.phase === 'rest' || T.phase === 'prep') && sec <= 3);
      b.dataset.warn = warn && !T.paused ? '1' : '0';

      var clock = $('clock');
      var txt = fmt(shown);
      if (clock.textContent !== txt) clock.textContent = txt;
      clock.classList.toggle('long', txt.length > 4);

      var frac = T.dur > 0 ? Math.min(1, 1 - rem / T.dur) : (T.phase === 'done' ? 1 : 0);
      $('barFill').style.width = (frac * 100).toFixed(2) + '%';

      var key = [T.phase, T.round, T.paused, S.rounds, S.roundSec, S.restSec, S.stompMode, S.stompPattern].join('|');
      if (!force && key === this.lastKey) return;
      this.lastKey = key;

      var labels = { idle: 'ГОТОВ', prep: 'ПРИГОТОВИТЬСЯ', round: 'БОКС', rest: 'ОТДЫХ', done: 'ФИНИШ' };
      $('phaseLabel').textContent = labels[T.phase];
      var rl = $('roundLabel');
      if (T.phase === 'idle') rl.innerHTML = '<b>' + S.rounds + '</b> × ' + fmt(S.roundSec) + ' <span>/ ' + fmt(S.restSec) + '</span>';
      else if (T.phase === 'done') rl.innerHTML = 'РАУНДОВ: <b>' + S.rounds + '</b>';
      else rl.innerHTML = 'РАУНД <b>' + Math.max(1, T.round) + '</b><span>/' + S.rounds + '</span>';

      var nl = '';
      if (T.phase === 'prep') nl = 'дальше · раунд 1';
      else if (T.phase === 'round') nl = T.isLast() ? 'последний раунд' : 'дальше · отдых ' + fmt(S.restSec);
      else if (T.phase === 'rest') nl = (T.round + 1 === S.rounds ? 'дальше · последний раунд' : 'дальше · раунд ' + (T.round + 1));
      else if (T.phase === 'done') nl = 'отработано бокса';
      $('nextLabel').textContent = nl;

      var pips = $('pips'), html = '';
      if (S.rounds <= 30) for (var i = 1; i <= S.rounds; i++) {
        var c = (i < T.round || (i === T.round && (T.phase === 'rest' || T.phase === 'done'))) ? 'done' : (i === T.round && T.phase === 'round' ? 'now' : '');
        html += '<i class="' + c + '"></i>';
      }
      pips.innerHTML = html;

      var hint = '';
      if (T.phase === 'idle') {
        var total = S.prepSec + S.rounds * S.roundSec + Math.max(0, S.rounds - 1) * S.restSec;
        hint = 'Тренировка ≈ ' + Math.round(total / 60) + ' мин';
      }
      if (S.stompMode !== 'off') hint += (hint ? ' · ' : '') + (S.stompPattern === 'double' ? 'топни дважды' : 'топни') + ' — старт';
      $('idleHint').textContent = hint;
      $('btnStart').lastChild.textContent = T.phase === 'done' ? 'Ещё раз' : 'Старт';

      $('pauseLayer').hidden = !T.paused || !$('settings').hidden;
      $('pauseHint').textContent = S.stompMode !== 'off' ? (S.stompPattern === 'double' ? 'Двойной топ' : 'Топ') + ' — продолжить' : '';
      this.renderChips();
    },

    renderChips: function () {
      var c = $('chipStomp');
      var on = Stomp.listening();
      c.classList.toggle('listening', on);
      var names = { off: 'выкл', mic: 'микр', motion: 'датчик', both: 'оба' };
      $('chipStompText').textContent = S.stompMode === 'off' ? 'выкл' : (S.stompPattern === 'double' ? '×2 ' : '') + names[S.stompMode];
      $('chipVoice').hidden = !Listen.supported;
      $('chipVoice').classList.toggle('listening', Listen.cmdOn);
    },

    flashStomp: function () {
      var f = $('stompFlash');
      f.classList.remove('on', 'half'); void f.offsetWidth; f.classList.add('on');
    },
    // Первый топ из двух: тихая подсказка «понял, жду второй» — без звука, чтобы не заглушить микрофон.
    onFirstHit: function () {
      if (!$('settings').hidden) { $('meterCount').textContent = '1-й топ… давай второй'; return; }
      if (!$('gate').hidden || !$('voiceLayer').hidden) return;
      if (Timer.phase === 'round' && !S.stompInRound) return;
      var f = $('stompFlash');
      f.classList.remove('on', 'half'); void f.offsetWidth; f.classList.add('half');
    },

    toastTimer: null,
    toast: function (msg) {
      var t = $('toast');
      t.textContent = msg; t.classList.add('on');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2800);
    },

    /* ---- Настройки ---- */
    openSettings: function () {
      if (Timer.running() && !Timer.paused) Timer.pause();
      this.syncSettings();
      $('settings').hidden = false;
      $('pauseLayer').hidden = true;
      this.calibHits = 0;
      $('meterCount').textContent = 'топни — проверим';
      if (!this.meterOn) { this.meterOn = true; this.meterLoop(); }
    },
    closeSettings: function () {
      if (Stomp.cal) { Stomp.cal = null; clearTimeout(Stomp.calTimer); UI.calEnd(); }
      $('settings').hidden = true;
      this.render(true);
    },

    STEPS: [
      { k: 'rounds', lbl: 'Раунды', step: 1, min: 1, max: 30, f: String },
      { k: 'roundSec', lbl: 'Раунд', step: 15, min: 15, max: 1200, f: fmt },
      { k: 'restSec', lbl: 'Отдых', step: 15, min: 0, max: 600, f: fmt },
      { k: 'prepSec', lbl: 'Подготовка', step: 5, min: 0, max: 60, f: fmt },
      { k: 'warnSec', lbl: 'Сигнал до конца', step: 5, min: 0, max: 60, f: function (v) { return v ? v + ' с' : 'нет'; } }
    ],
    buildSettings: function () {
      var self = this;
      var pr = $('presets');
      PRESETS.forEach(function (p, i) {
        var b = document.createElement('button');
        b.className = 'preset'; b.type = 'button'; b.dataset.i = i;
        b.innerHTML = '<b>' + p.name + '</b><span>' + p.rounds + ' × ' + fmt(p.roundSec) + ' / ' + fmt(p.restSec) + '</span>';
        b.onclick = function () { S.rounds = p.rounds; S.roundSec = p.roundSec; S.restSec = p.restSec; save(); self.syncSettings(); self.render(true); };
        pr.appendChild(b);
      });
      var st = $('steppers');
      this.STEPS.forEach(function (d) {
        var row = document.createElement('div');
        row.className = 'stepper';
        row.innerHTML = '<span class="lbl">' + d.lbl + '</span><button type="button" data-d="-1" aria-label="меньше">−</button><span class="val" id="val-' + d.k + '"></span><button type="button" data-d="1" aria-label="больше">+</button>';
        row.querySelectorAll('button').forEach(function (btn) {
          var rep = null, startT = null;
          var stepOnce = function () {
            var v = S[d.k] + d.step * +btn.dataset.d;
            if (d.k === 'roundSec' && S.roundSec <= 60 && btn.dataset.d === '-1') v = S.roundSec - 5;
            if (d.k === 'roundSec' && S.roundSec < 60 && btn.dataset.d === '1') v = S.roundSec + 5;
            S[d.k] = Math.max(d.min, Math.min(d.max, v)); save(); self.syncSettings(); self.render(true);
          };
          var stop = function () { clearTimeout(startT); clearInterval(rep); };
          btn.addEventListener('pointerdown', function (e) {
            e.preventDefault(); stepOnce();
            startT = setTimeout(function () { rep = setInterval(stepOnce, 90); }, 420);
          });
          ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { btn.addEventListener(ev, stop); });
        });
        st.appendChild(row);
      });

      $('optVoice').onchange = function () { S.voice = this.checked; save(); if (S.voice) Voice.say('Голос включён'); };
      $('optCount').onchange = function () { S.countVoice = this.checked; save(); };
      $('optHalf').onchange = function () { S.halfVoice = this.checked; save(); };
      $('btnCal').onclick = function () { UI.calStart(); };
      $('btnCalReset').onclick = function () { S.calMic = null; S.calMotion = null; save(); UI.syncCal(); UI.toast('Калибровка сброшена'); };
      $('optVoiceName').onchange = function () {
        S.voiceURI = this.value; save(); Voice.load(); Voice.say('Раунд один. Бокс!');
      };
      $('optVolume').oninput = function () { S.volume = +this.value; Sound.setVolume(S.volume); save(); };
      document.querySelectorAll('[data-sound]').forEach(function (b) {
        b.onclick = function () {
          Sound.unlock();
          if (b.dataset.sound === 'voice') Voice.say('Десять секунд. Готовимся, раунд три', { queue: false });
          else Sound.play(b.dataset.sound);
        };
      });
      $('stompMode').querySelectorAll('button').forEach(function (b) {
        b.onclick = function () {
          S.stompMode = b.dataset.v; save();
          if ((S.stompMode === 'mic' || S.stompMode === 'both') && Listen.cmdOn) {
            Listen.stopCommands(); S.commands = false; save();
            UI.toast('Голосовые команды выключены: микрофон отдан топоту');
          }
          Stomp.apply(); self.syncSettings(); self.render(true);
        };
      });
      $('stompPattern').querySelectorAll('button').forEach(function (b) {
        b.onclick = function () { S.stompPattern = b.dataset.v; save(); self.syncSettings(); self.render(true); };
      });
      $('optStompRound').onchange = function () { S.stompInRound = this.checked; save(); };
      $('optSens').oninput = function () { S.sens = +this.value; save(); };
      $('optCommands').onchange = function () {
        S.commands = this.checked; save();
        if (S.commands) {
          if (Stomp.needsMic()) { S.stompMode = 'motion'; save(); Stomp.apply(); UI.toast('Топот переключён на датчик: микрофон слушает команды'); }
          Listen.startCommands();
        } else Listen.stopCommands();
        self.syncSettings();
      };
    },
    syncSettings: function () {
      this.STEPS.forEach(function (d) { var el = $('val-' + d.k); if (el) el.textContent = d.f(S[d.k]); });
      document.querySelectorAll('.preset').forEach(function (b) {
        var p = PRESETS[+b.dataset.i];
        b.classList.toggle('active', p.rounds === S.rounds && p.roundSec === S.roundSec && p.restSec === S.restSec);
      });
      $('optVoice').checked = S.voice;
      $('optCount').checked = S.countVoice;
      $('optHalf').checked = S.halfVoice;
      $('optVolume').value = S.volume;
      $('optStompRound').checked = S.stompInRound;
      $('optSens').value = S.sens;
      $('optCommands').checked = S.commands;
      $('optCommands').disabled = !Listen.supported;
      $('commandsHint').textContent = !Listen.supported
        ? 'В этом браузере распознавание речи недоступно.'
        : 'На iPhone микрофон один: с командами топот работает через датчик. Команды не реагируют, пока говорит сам таймер.';
      $('stompMode').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === S.stompMode); });
      $('stompPattern').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === S.stompPattern); });
      var hints = {
        off: 'Только кнопки и голос.',
        mic: 'Ловит глухой удар ногой по полу. Телефон можно ставить где угодно рядом.',
        motion: 'Телефон лежит на полу или помосте — ловит вибрацию от топота. Звуки зала не мешают.',
        both: 'Срабатывает, только когда удар слышно и чувствуется. Меньше ложных стартов, телефон на полу.'
      };
      $('stompModeHint').textContent = hints[S.stompMode];
      if (!Stomp.cal) this.syncCal();
      this.fillVoices();
    },
    fillVoices: function () {
      var sel = $('optVoiceName');
      if (!sel) return;
      var list = Voice.voices;
      sel.innerHTML = '';
      if (!list.length) { var o = document.createElement('option'); o.textContent = 'Системный'; sel.appendChild(o); return; }
      list.forEach(function (v) {
        var o = document.createElement('option');
        o.value = v.voiceURI; o.textContent = v.name;
        if (Voice.voice && v.voiceURI === Voice.voice.voiceURI) o.selected = true;
        sel.appendChild(o);
      });
    },

    calibHits: 0,
    onRawHit: function () {
      if ($('settings').hidden) return;
      var m = document.querySelector('.meter');
      m.classList.add('hit'); setTimeout(function () { m.classList.remove('hit'); }, 200);
    },
    onCalibStomp: function () {
      this.calibHits++;
      $('meterCount').textContent = 'Сработало: ' + this.calibHits;
      Sound.play('blip');
    },
    meterOn: false,
    meterLoop: function () {
      var self = this;
      if ($('settings').hidden) { this.meterOn = false; return; }
      var lvl, thr;
      if (S.stompMode === 'motion') { lvl = Stomp.mLevel; thr = Stomp.mThr; }
      else { lvl = Stomp.level; thr = Stomp.thr; }
      var scale = thr * 2 || 1;
      $('meterFill').style.width = Math.min(100, lvl / scale * 100) + '%';
      $('meterThr').style.left = '50%';
      if (Stomp.cal) {
        var n = Stomp.calCount();
        $('calText').textContent = n ? 'Поймал: ' + n + ' из 4' : 'Топни 4 раза по одному, с паузой ~1 сек';
        if (n >= 4 && !Stomp.cal.ending) { Stomp.cal.ending = true; setTimeout(function () { Stomp.finishCal(); }, 700); }
      }
      requestAnimationFrame(function () { self.meterLoop(); });
    },

    /* ---- Автокалибровка топота ---- */
    calStart: function () {
      if (S.stompMode === 'off') { UI.toast('Сначала выбери микрофон или датчик'); return; }
      if (!Stomp.listening()) { Stomp.apply(); }
      $('btnCal').disabled = true;
      $('calText').textContent = 'Топни 4 раза по одному, с паузой ~1 сек';
      $('calRow').classList.add('active');
      Stomp.calibrate(function (res) {
        var ok = false, miss = false;
        if ('mic' in res) { if (res.mic) { S.calMic = res.mic; ok = true; } else miss = true; }
        if ('motion' in res) { if (res.motion) { S.calMotion = res.motion; ok = true; } else miss = true; }
        save();
        UI.calEnd();
        if (ok && !miss) { UI.toast('Готово: порог настроен под твой топот'); Sound.play('blip'); }
        else if (ok) UI.toast('Настроил частично — один из сенсоров не услышал топот');
        else UI.toast('Не поймал топот — топай сильнее или положи телефон ближе');
      });
    },
    calEnd: function () {
      $('btnCal').disabled = false;
      $('calRow').classList.remove('active');
      this.syncCal();
    },
    syncCal: function () {
      var has = (Stomp.needsMic() && S.calMic) || (Stomp.needsMotion() && S.calMotion);
      $('calText').textContent = S.stompMode === 'off' ? 'Топот выключен' :
        has ? 'Настроено ✓' : 'Сейчас порог по ползунку';
      $('btnCalReset').hidden = !(S.calMic || S.calMotion);
    }
  };

  /* ================= События ================= */
  $('btnGate').addEventListener('click', function () { App.unlock(); });
  $('btnStart').addEventListener('click', function (e) {
    e.stopPropagation();
    if (!App.unlocked) App.unlock();
    Sound.unlock();
    if (Timer.phase === 'done') Timer.reset();
    Timer.start();
  });
  $('stage').addEventListener('click', function (e) {
    if (e.target.closest('button')) return;
    if (Timer.running()) { if (Timer.paused) Timer.resume(); else Timer.pause(); }
  });
  $('btnResume').onclick = function () { Timer.resume(); };
  $('btnSkip').onclick = function () { Timer.skip(); };
  $('btnReset').onclick = function () { Timer.reset(); };
  $('btnPauseSettings').onclick = function () { UI.openSettings(); };
  $('pauseLayer').addEventListener('click', function (e) { if (e.target === this) Timer.resume(); });
  $('chipSettings').onclick = function () { UI.openSettings(); };
  $('chipStomp').onclick = function () { UI.openSettings(); };
  $('chipVoice').onclick = function () { Listen.once(); };
  $('btnSettingsClose').onclick = function () { UI.closeSettings(); };
  $('btnVoiceClose').onclick = function () { Listen.closeOnce(); };

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); if (Timer.phase === 'idle' || Timer.phase === 'done') { if (!App.unlocked) App.unlock(); Timer.start(); } else if (Timer.paused) Timer.resume(); else Timer.pause(); }
    if (e.key === 's' || e.key === 'ы') Stomp.raw('key', now());
    if (e.key === 'n' || e.key === 'т') Timer.skip();
    if (e.key === 'r' || e.key === 'к') Timer.reset();
  });

  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { hiddenAt = now(); return; }
    var away = hiddenAt ? now() - hiddenAt : 0;
    if (Sound.ctx && Sound.ctx.state !== 'running') Sound.ctx.resume().catch(function () {});
    if (App.unlocked) Wake.request();
    if (App.unlocked && Stomp.needsMic() && !Stomp.analyser && !Stomp.paused) Stomp.startMic().then(function () { UI.renderChips(); });
    Timer.tick(); UI.render(true);
    // Через полсекунды проверяем, ожил ли звук. Если нет — без касания iPhone его не вернёт.
    setTimeout(function () {
      if (App.unlocked && Sound.ctx && Sound.ctx.state !== 'running') {
        App.regate('Нажми, чтобы вернуть звук — iPhone выключил его, пока таймер был в фоне.');
        return;
      }
      // Вернулись в идущую тренировку — коротко говорим, где мы.
      if (away > 3000 && Timer.running() && !Timer.paused) {
        var left = Math.ceil(Timer.remaining() / 1000);
        var msg = Timer.phase === 'round' ? 'Раунд ' + Timer.round + '. Осталось ' + P.durWords(left)
          : Timer.phase === 'rest' ? 'Отдых. До раунда ' + (Timer.round + 1) + ' ' + P.durWords(left)
          : 'Подготовка';
        Voice.say(msg);
      }
    }, 600);
  });

  function loop() {
    Timer.tick();
    UI.render(false);
    requestAnimationFrame(loop);
  }
  setInterval(function () { Timer.tick(); }, 200);

  UI.buildSettings();
  UI.syncSettings();
  Voice.load();
  UI.render(true);
  requestAnimationFrame(loop);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) UI.toast('Вышла новая версия — перезапусти таймер, когда закончишь');
    });
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  window.BoxTimer = { Timer: Timer, Stomp: Stomp, Sound: Sound, Voice: Voice, App: App, S: S };
})();
