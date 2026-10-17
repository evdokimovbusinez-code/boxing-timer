/* Боксёрский таймер — iPhone, всегда горизонтально, нейроголос, топот с локальной моделью. Работает офлайн. */
(function () {
  'use strict';

  var P = window.BoxParse, D = window.BoxDetect, PH = window.BoxPhrases;
  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return performance.now(); };

  /* ================= Настройки ================= */
  var DEFAULTS = {
    rounds: 10, roundSec: 120, restSec: 60, prepSec: 10, warnSec: 10,
    voice: true, voiceId: 'dmitri', sysVoiceURI: '', volume: 1.4, loudRounds: true,
    countVoice: false, halfVoice: false,
    stompMode: 'mic', stompPattern: 'double', stompInRound: false, sens: 0.55,
    calMic: null, calMotion: null, stompModel: null,
    commands: false, flip: false, eco: false, dimIdle: true
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
  if (S.volume < 0.4) S.volume = 0.4;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }
  var lerp = D.lerp;

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

    play: function (name) {
      if (!this.ctx) return;
      if (this.ctx.state !== 'running') this.ctx.resume().catch(function () {});
      var t = this.ctx.currentTime + 0.03, self = this;
      switch (name) {
        case 'bellStart': // три быстрых высоких «дзынь» — начало раунда
          [0, 0.28, 0.56].forEach(function (dt) { self.strike(t + dt, 1320, self.BELL, 1.2, 0.7); });
          this.mark(1.8); break;
        case 'gongEnd': // два протяжных «донг» — конец раунда
          this.strike(t, 330, this.GONG, 2.8, 0.9);
          this.strike(t + 0.8, 330, this.GONG, 2.4, 0.8);
          this.mark(3.2); break;
        case 'finish': // конец тренировки — гонг трижды
          [0, 0.75, 1.5].forEach(function (dt) { self.strike(t + dt, 300, self.GONG, 2.8, 0.9); });
          this.mark(4.3); break;
        case 'clapper': // «тук-тук-тук» — 10 секунд
          [0, 0.13, 0.26].forEach(function (dt) { self.knock(t + dt); });
          this.mark(0.6); break;
        case 'beep': this.tone(t, 1760, 0.17, 0.75); this.mark(0.25); break;
        case 'beepHigh': this.tone(t, 2093, 0.17, 0.75); this.mark(0.25); break;
        case 'blip': this.tone(t, 1400, 0.06, 0.4); this.tone(t + 0.07, 1900, 0.08, 0.4); this.mark(0.2); break;
      }
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
  PH.list().forEach(function (p) { TEXTS[p.id] = p.text; });

  var Clips = {
    voices: [], voiceId: null, raw: {}, buf: {}, total: 0, loading: false, active: [], gen: 0,
    loadIndex: function () {
      var self = this;
      return fetch('voices/index.json').then(function (r) { return r.ok ? r.json() : { voices: [] }; })
        .then(function (d) { self.voices = d.voices || []; UI.fillVoices(); })
        .catch(function () { self.voices = []; UI.fillVoices(); });
    },
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
            return fetch('voices/' + id + '/' + cid + '.mp3').then(function (r) { return r.ok ? r.arrayBuffer() : null; })
              .then(function (ab) { if (ab && gen === self.gen) { self.raw[cid] = ab; return self.decode(cid); } })
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
      this.sysVoices = all.filter(function (v) { return /^ru/i.test(v.lang); });
      this.sysVoice = (S.sysVoiceURI && this.sysVoices.find(function (v) { return v.voiceURI === S.sysVoiceURI; })) ||
        this.sysVoices.find(function (v) { return /premium|enhanced|улучш/i.test(v.name); }) || this.sysVoices[0] || null;
    },
    unlock: function () {
      if (!this.supported) return;
      var u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'ru-RU';
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
        u.lang = 'ru-RU';
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
  if (Voice.supported) speechSynthesis.onvoiceschanged = function () { Voice.loadSystem(); UI.fillVoices(); };

  /* ================= Экран не гаснет вообще ================= */
  var Wake = {
    lock: null, video: null, pending: false,
    // В режиме «на экран Домой» до iOS 18.4 Wake Lock обещает, но не держит экран — там включаем видео-обход.
    needVideo: (function () {
      var m = /OS (\d+)_(\d+)/.exec(navigator.userAgent);
      var standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
      if (!('wakeLock' in navigator)) return true;
      if (!m || !standalone) return false;
      var maj = +m[1], min = +m[2];
      return maj < 18 || (maj === 18 && min < 4);
    })(),
    request: function () {
      if (document.visibilityState !== 'visible') return;
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
    muteUntil: 0, level: 0, floor: 0.01, thr: 1, mLevel: 0, mThr: 1, lastP: null,
    lastMic: -1e9, lastMotion: -1e9,
    paused: false, suspended: false, cal: null,

    muteFor: function (ms) { this.muteUntil = Math.max(this.muteUntil, now() + ms); },
    needsMic: function () { return S.stompMode === 'mic' || S.stompMode === 'both'; },
    needsMotion: function () { return S.stompMode === 'motion' || S.stompMode === 'both'; },
    micLive: function () { return !!(this.stream && this.stream.getAudioTracks().some(function (t) { return t.readyState === 'live'; })); },

    // Вызывать в обработчике касания (iOS просит жест для разрешений).
    apply: function () {
      var jobs = [];
      if (this.needsMotion()) jobs.push(this.startMotion()); else this.stopMotion();
      if (this.needsMic() && !this.paused && !this.suspended) jobs.push(this.startMic()); else this.stopMic();
      var self = this;
      return Promise.all(jobs).then(function () { UI.renderChips(); return self; });
    },

    /* --- «Громко в раунде»: микрофон на время тренировки выключается, iPhone возвращает полную громкость --- */
    suspend: function () {
      if (this.suspended || !this.needsMic()) return;
      this.suspended = true; this.stopMic(); UI.renderChips();
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
          UI.toast('Выключил «Громче в раунде»: iPhone каждый раз спрашивал микрофон');
        }
        UI.renderChips();
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
        UI.toast('Микрофон недоступен в этом браузере'); return Promise.resolve();
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
        stream.getAudioTracks()[0].addEventListener('ended', function () { self.stopMic(); UI.renderChips(); });
      }).catch(function () {
        UI.toast('Нет доступа к микрофону — разреши в Настройках iPhone или выбери «Датчик»');
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
        var prev = self.motDet.slow;
        var thr = D.threshold({ sens: S.sens, cal: S.calMotion, floor: self.motDet.floor, second: self.dbl.waiting(t), absHi: 3.2, absLo: 0.18 });
        self.mLevel = d; self.mThr = thr;
        var hit = self.motDet.push(d, t, thr);
        if (self.cal) self.cal.motion(d, t, self.motDet.floor, prev);
        else if (hit && t > self.muteUntil) { self.lastMotion = t; self.raw('motion', t); }
      }
      self.mPrev = { x: a.x, y: a.y, z: a.z };
    },

    // Сырой удар → правило «оба» → одиночный/двойной.
    raw: function (src, t) {
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
      if (S.stompMode === 'off') { UI.toast('Сначала выбери микрофон или датчик'); return; }
      var self = this;
      Stomp.apply().then(function () {
        if (!Stomp.listening()) { UI.toast('Топот не слушается — проверь разрешения'); return; }
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
        $('calStep').textContent = Stomp.needsMic() ? 'Шаг 1 из 2' : 'Настройка';
        $('calTitle').textContent = 'Топни 5 раз';
        $('calSub').textContent = 'По одному, с паузой около секунды, как будешь запускать таймер. Телефон — там, где он обычно лежит.';
        $('btnCalNext').textContent = 'Дальше';
      } else {
        this.deadline = now() + 10000;
        $('calStep').textContent = 'Шаг 2 из 2';
        $('calSub').textContent = 'Теперь НЕ топай: походи, попрыгай, побей по лапам или мешку рядом, поговори. Модель запомнит, что это не топот.';
        $('btnCalNext').textContent = 'Готово';
        this.timer = setInterval(function () {
          var left = Math.ceil((self.deadline - now()) / 1000);
          $('calTitle').textContent = 'Двигайся: ' + Math.max(0, left) + ' с';
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
        msg.push(m ? 'модель обучена: ' + this.pos.length + ' топов, ' + this.neg.length + ' «не топов», точность ' + Math.round(m.acc * 100) + '%'
          : 'порог настроен (для модели не хватило примеров «не топа» — подвигайся активнее на шаге 2)');
      }
      if (Stomp.needsMotion()) {
        var lv = this.mot.level();
        if (lv) { S.calMotion = lv; msg.push('датчик настроен'); } else msg.push('датчик не почувствовал топот');
      }
      save();
      UI.syncCal();
      UI.toast(msg.length ? 'Готово: ' + msg.join(', ') : 'Не поймал топот — попробуй ещё раз');
      Sound.play('blip');
    },
    cancel: function () {
      clearInterval(this.timer);
      Stomp.cal = null; Stomp.dbl.clear();
      $('calLayer').hidden = true;
    }
  };

  /* ================= Таймер ================= */
  var Timer = {
    phase: 'idle', round: 0, paused: false,
    endAt: 0, left: 0, dur: 0, lastSec: null,
    epoch: 0, // меняется при любом переходе — отложенные фразы старой фазы не звучат
    tickTimer: null,

    phaseLen: function (p) {
      if (p === 'prep') return S.prepSec; if (p === 'round') return S.roundSec;
      if (p === 'rest') return S.restSec; return 0;
    },
    remaining: function () { return this.paused ? this.left : Math.max(0, this.endAt - now()); },
    running: function () { return this.phase === 'prep' || this.phase === 'round' || this.phase === 'rest'; },

    start: function () {
      Sound.unlock();
      UI.wake();
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
      App.syncMic(p === 'done' ? 5000 : 0); // в громком режиме микрофон выключается на всю тренировку
      if (!silent) this.announce(p);
      UI.render(true);
      this.schedule();
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
      clearTimeout(this.tickTimer);
      Voice.speak(['pause']);
      App.syncMic(1200);
      UI.render(true);
    },
    resume: function () {
      if (!this.paused) return;
      this.endAt = now() + this.left; this.paused = false; this.epoch++;
      Sound.unlock(); Wake.request();
      App.syncMic(0);
      var ep = this.epoch;
      setTimeout(function () { if (Timer.epoch === ep) Voice.speak(['resume']); }, 300);
      UI.render(true);
      this.schedule();
    },
    skip: function () {
      if (!this.running()) return;
      this.paused = false;
      this.next(0, false);
    },
    reset: function () {
      this.phase = 'idle'; this.round = 0; this.paused = false; this.epoch++;
      clearTimeout(this.tickTimer);
      Voice.cancel();
      App.syncMic(0);
      UI.render(true);
    },

    isLast: function () { return this.round >= S.rounds; },
    announce: function (p) {
      var r = this.round, total = S.rounds;
      if (p === 'prep') {
        Voice.later(400, ['prep'], 'Приготовиться. ' + total + ' ' + P.plural(total, ['раунд', 'раунда', 'раундов']));
      } else if (p === 'round') {
        Sound.play('bellStart');
        var id = total > 1 && r === total ? 'last_round' : (total > 1 && r <= PH.MAX_ROUNDS ? 'round_' + r : 'box');
        Voice.later(950, [id]);
      } else if (p === 'rest') {
        Sound.play('gongEnd');
        var left = total - r;
        Voice.later(1400, ['stop_rest', left === 1 ? 'left_1' : 'left_' + Math.min(left, PH.MAX_ROUNDS)]);
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
    onSecond: function (sec) {
      var w = S.warnSec, p = this.phase;
      if (p === 'round') {
        if (w > 0 && sec === w && this.dur > (w + 2) * 1000) {
          Sound.play('clapper');
          if (PH.WARN.indexOf(w) >= 0) Voice.later(420, ['warn_' + w]);
          else Voice.later(420, [], w + ' ' + P.plural(w, ['секунда', 'секунды', 'секунд']));
        }
        if (S.halfVoice && this.dur >= 60000 && sec === Math.round(this.dur / 2000) && sec > w + 2) {
          Sound.play('beepHigh');
          Voice.later(280, ['half']);
        }
        if (S.countVoice && sec >= 1 && sec <= 5 && sec < w) Voice.speak(['cnt_' + sec]);
        else if (!S.countVoice && sec >= 1 && sec <= 3) Sound.play('beep');
      } else if (p === 'rest' || p === 'prep') {
        if (sec === 10 && this.dur > 13000) {
          var nr = p === 'prep' ? 1 : this.round + 1;
          var rid = nr === S.rounds && S.rounds > 1 ? 'ready_last' : 'ready_' + Math.min(nr, PH.MAX_ROUNDS);
          Voice.speak(['warn_10', rid]);
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
    unlocked: false, starting: false, micTimer: null,

    unlock: function () {
      Sound.unlock(); Voice.unlock(); Wake.request();
      try { if (navigator.audioSession && !Stomp.needsMic()) navigator.audioSession.type = 'playback'; } catch (e) {}
      Voice.loadSystem();
      this.unlocked = true;
      $('gate').hidden = true;
      $('gateText').textContent = 'Нажми один раз — iPhone разрешит звук, голос и датчики для топота.';
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

    onStomp: function () {
      UI.wake();
      if (!$('settings').hidden) { UI.onCalibStomp(); return; }
      if (!$('voiceLayer').hidden || !$('gate').hidden || !$('calLayer').hidden || this.starting) return;
      var T = Timer, self = this;
      if (T.phase === 'idle' || T.phase === 'done') {
        UI.flashStomp(); Voice.speak(['start']);
        this.starting = true;
        setTimeout(function () {
          self.starting = false;
          if (T.phase === 'idle' || T.phase === 'done') T.start();
        }, 600);
        return;
      }
      if (T.paused) { UI.flashStomp(); T.resume(); return; }
      if (T.phase === 'round' && !S.stompInRound) return;
      UI.flashStomp(); T.pause();
    },

    handleSpeech: function (text, fromOnce) {
      var cmd = P.parseCommand(text);
      var cfg = P.parseWorkout(text);
      if (Object.keys(cfg).length && (Timer.phase === 'idle' || Timer.phase === 'done' || Timer.paused || fromOnce)) {
        Object.assign(S, cfg); save();
        UI.syncSettings(); UI.render(true);
        var msg = App.describe();
        $('voiceResult').textContent = msg;
        UI.toast(msg);
        Voice.say(msg + '. Готово');
        if (cmd !== 'start') return;
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
    lastKey: '', lastClock: '', lastActive: now(),

    applyLook: function () {
      document.body.classList.toggle('flip', !!S.flip);
      document.body.classList.toggle('eco', !!S.eco);
    },

    render: function (force) {
      var T = Timer, b = document.body;
      var rem = T.remaining(), sec = Math.ceil(rem / 1000);
      var shown = T.phase === 'idle' ? S.roundSec : T.phase === 'done' ? S.rounds * S.roundSec : sec;
      var warn = (T.phase === 'round' && S.warnSec > 0 && sec <= S.warnSec) ||
                 ((T.phase === 'rest' || T.phase === 'prep') && sec <= 10 && T.dur > 13000) ||
                 ((T.phase === 'rest' || T.phase === 'prep') && sec <= 3);
      var w = warn && !T.paused ? '1' : '0';
      if (b.dataset.warn !== w) b.dataset.warn = w;

      var txt = fmt(shown);
      if (txt !== this.lastClock) {
        this.lastClock = txt;
        var clock = $('clock');
        clock.textContent = txt;
        clock.classList.toggle('long', txt.length > 4);
      }

      var key = [T.phase, T.round, T.paused, T.epoch, S.rounds, S.roundSec, S.restSec, S.stompMode, S.stompPattern, S.prepSec].join('|');
      if (!force && key === this.lastKey) return;
      this.lastKey = key;

      b.dataset.phase = T.phase;
      b.dataset.paused = T.paused ? '1' : '0';
      b.classList.toggle('running', T.running() && !T.paused);
      this.syncBar();

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

      var html = '';
      if (S.rounds <= 30) for (var i = 1; i <= S.rounds; i++) {
        var c = (i < T.round || (i === T.round && (T.phase === 'rest' || T.phase === 'done'))) ? 'done' : (i === T.round && T.phase === 'round' ? 'now' : '');
        html += '<i class="' + c + '"></i>';
      }
      $('pips').innerHTML = html;

      var hint = '';
      if (T.phase === 'idle') {
        var total = S.prepSec + S.rounds * S.roundSec + Math.max(0, S.rounds - 1) * S.restSec;
        hint = 'Тренировка ≈ ' + Math.round(total / 60) + ' мин';
      }
      if (S.stompMode !== 'off') hint += (hint ? ' · ' : '') + (S.stompPattern === 'double' ? 'топни дважды' : 'топни') + ' — старт';
      $('idleHint').textContent = hint;
      $('btnStart').lastChild.textContent = T.phase === 'done' ? 'Ещё раз' : 'Старт';
      $('dimText').textContent = S.rounds + ' × ' + fmt(S.roundSec);
      $('dimHint').textContent = S.stompMode !== 'off' ? (S.stompPattern === 'double' ? 'топни дважды — старт' : 'топни — старт') : 'коснись экрана';

      $('pauseLayer').hidden = !T.paused || !$('settings').hidden;
      $('pauseHint').textContent = S.stompMode !== 'off' ? (S.stompPattern === 'double' ? 'Двойной топ' : 'Топ') + ' — продолжить' : '';
      this.renderChips();
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

    renderChips: function () {
      var c = $('chipStomp');
      c.classList.toggle('listening', Stomp.listening());
      var names = { off: 'выкл', mic: 'микр', motion: 'датчик', both: 'оба' };
      $('chipStompText').textContent = S.stompMode === 'off' ? 'выкл' : (S.stompPattern === 'double' ? '×2 ' : '') + names[S.stompMode];
      $('chipVoice').hidden = !Listen.supported;
      $('chipVoice').classList.toggle('listening', Listen.cmdOn);
    },

    flashStomp: function () {
      var f = $('stompFlash');
      f.classList.remove('on', 'half'); void f.offsetWidth; f.classList.add('on');
    },
    onFirstHit: function () {
      UI.wake();
      if (!$('settings').hidden) { $('meterCount').textContent = '1-й топ… давай второй'; return; }
      if (!$('gate').hidden || !$('voiceLayer').hidden || !$('calLayer').hidden) return;
      if (Timer.phase === 'round' && !S.stompInRound) return;
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
    openSettings: function () {
      if (Timer.running() && !Timer.paused) Timer.pause();
      this.syncSettings();
      $('settings').hidden = false;
      $('pauseLayer').hidden = true;
      this.calibHits = 0;
      $('meterCount').textContent = 'топни — проверим';
      Stomp.setMeter(true);
      if (!this.meterOn) { this.meterOn = true; this.meterLoop(); }
    },
    closeSettings: function () {
      $('settings').hidden = true;
      Stomp.setMeter(false);
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
      PRESETS.forEach(function (p, i) {
        var b = document.createElement('button');
        b.className = 'preset'; b.type = 'button'; b.dataset.i = i;
        b.innerHTML = '<b>' + p.name + '</b><span>' + p.rounds + ' × ' + fmt(p.roundSec) + ' / ' + fmt(p.restSec) + '</span>';
        b.onclick = function () { S.rounds = p.rounds; S.roundSec = p.roundSec; S.restSec = p.restSec; save(); self.syncSettings(); self.render(true); };
        $('presets').appendChild(b);
      });
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
        $('steppers').appendChild(row);
      });

      $('optVoice').onchange = function () { S.voice = this.checked; save(); if (S.voice) Voice.speak(['round_1']); };
      $('optVoiceName').onchange = function () {
        var v = this.value;
        if (v.indexOf('sys:') === 0) { S.voiceId = 'system'; S.sysVoiceURI = v.slice(4); Voice.loadSystem(); Clips.load('system'); Voice.say('Раунд три. Бокс!'); }
        else { S.voiceId = v; Clips.load(v).then(function () { Voice.speak(['round_3']); }); }
        save();
      };
      $('optVolume').oninput = function () { S.volume = +this.value; Sound.setVolume(S.volume); save(); };
      $('optLoud').onchange = function () { S.loudRounds = this.checked; save(); };
      $('optCount').onchange = function () { S.countVoice = this.checked; save(); };
      $('optHalf').onchange = function () { S.halfVoice = this.checked; save(); };
      $('optFlip').onchange = function () { S.flip = this.checked; save(); self.applyLook(); };
      $('optEco').onchange = function () { S.eco = this.checked; save(); self.applyLook(); };
      $('optDim').onchange = function () { S.dimIdle = this.checked; save(); };
      document.querySelectorAll('[data-sound]').forEach(function (b) {
        b.onclick = function () {
          Sound.unlock();
          if (b.dataset.sound === 'voice') Voice.speak(['warn_10', 'ready_3']);
          else Sound.play(b.dataset.sound);
        };
      });
      $('btnCal').onclick = function () { Cal.open(); };
      $('btnCalNext').onclick = function () { Cal.next(); };
      $('btnCalCancel').onclick = function () { Cal.cancel(); };
      $('btnCalReset').onclick = function () {
        S.calMic = null; S.calMotion = null; S.stompModel = null; save(); self.syncCal(); UI.toast('Обучение сброшено');
      };
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
      $('optStompRound').onchange = function () { S.stompInRound = this.checked; save(); self.syncSettings(); };
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
      $('optVolume').value = S.volume;
      $('optLoud').checked = S.loudRounds;
      $('optLoud').disabled = !Stomp.needsMic() || S.stompInRound;
      $('optCount').checked = S.countVoice;
      $('optHalf').checked = S.halfVoice;
      $('optFlip').checked = S.flip;
      $('optEco').checked = S.eco;
      $('optDim').checked = S.dimIdle;
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
        both: 'Срабатывает, только когда удар и слышно, и чувствуется. Меньше ложных стартов, телефон на полу.'
      };
      $('stompModeHint').textContent = hints[S.stompMode];
      this.syncCal();
      this.fillVoices();
      this.voiceStatus();
    },
    syncCal: function () {
      var parts = [];
      if (Stomp.needsMic()) parts.push(S.stompModel ? 'модель ✓ (' + Math.round(S.stompModel.acc * 100) + '%)' : S.calMic ? 'порог ✓' : null);
      if (Stomp.needsMotion()) parts.push(S.calMotion ? 'датчик ✓' : null);
      parts = parts.filter(Boolean);
      $('calText').textContent = S.stompMode === 'off' ? 'Топот выключен' :
        parts.length ? parts.join(' · ') + ' — работает офлайн' : 'Топни 5 раз и подвигайся 10 секунд';
      $('btnCalReset').hidden = !(S.calMic || S.calMotion || S.stompModel);
    },
    fillVoices: function () {
      var sel = $('optVoiceName');
      if (!sel) return;
      sel.innerHTML = '';
      var cur = S.voiceId === 'system' ? 'sys:' + S.sysVoiceURI : S.voiceId;
      Clips.voices.forEach(function (v) {
        var o = document.createElement('option');
        o.value = v.id; o.textContent = v.label + (v.engine === 'piper' ? ' · нейро' : v.engine === 'elevenlabs' ? ' · ElevenLabs' : '');
        sel.appendChild(o);
      });
      var sys = Voice.sysVoices.length ? Voice.sysVoices : [{ voiceURI: '', name: 'iPhone' }];
      sys.forEach(function (v) {
        var o = document.createElement('option');
        o.value = 'sys:' + v.voiceURI; o.textContent = v.name + ' · системный';
        sel.appendChild(o);
      });
      sel.value = cur;
      if (sel.selectedIndex < 0 && sel.options.length) sel.selectedIndex = 0;
    },
    voiceStatus: function () {
      var el = $('voiceStatus'); if (!el) return;
      if (S.voiceId === 'system') { el.textContent = 'Системный голос iPhone — работает офлайн, но тише нейроголоса.'; return; }
      var n = Clips.count(), t = Clips.total;
      if (!t) el.textContent = Clips.loading ? 'Загружаю голос…' : 'Файлы голоса не найдены — пока говорю системным голосом.';
      else if (n < t) el.textContent = (Object.keys(Clips.raw).length >= t ? 'Готовлю голос ' : 'Загружаю голос ') + n + '/' + t + '…';
      else el.textContent = 'Нейроголос загружен (' + t + ' фраз) — работает офлайн.';
    },

    calibHits: 0,
    onRawHit: function () {
      if ($('settings').hidden) return;
      var m = document.querySelector('.meter');
      m.classList.add('hit'); setTimeout(function () { m.classList.remove('hit'); }, 200);
    },
    onModelScore: function (p, lowHigh) {
      if ($('settings').hidden) return;
      $('meterCount').textContent = p == null ? 'не похоже на топот (нет низа)'
        : 'модель: ' + (p >= 0.5 ? 'топ ' : 'не топ ') + Math.round(p * 100) + '%';
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
      else { lvl = Stomp.level; thr = Stomp.micThr(now(), Stomp.floor); }
      $('meterFill').style.width = Math.min(100, lvl / (thr * 2 || 1) * 100) + '%';
      setTimeout(function () { requestAnimationFrame(function () { self.meterLoop(); }); }, 50);
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
    UI.wake();
    if (e.target.closest('button')) return;
    if (Timer.running()) { if (Timer.paused) Timer.resume(); else Timer.pause(); }
  });
  $('dim').addEventListener('click', function () { UI.wake(); });
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
  document.addEventListener('pointerdown', function () { UI.lastActive = now(); }, { passive: true });

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); if (Timer.phase === 'idle' || Timer.phase === 'done') { if (!App.unlocked) App.unlock(); Timer.start(); } else if (Timer.paused) Timer.resume(); else Timer.pause(); }
    if (e.key === 's' || e.key === 'ы') Stomp.raw('key', now());
    if (e.key === 'n' || e.key === 'т') Timer.skip();
    if (e.key === 'r' || e.key === 'к') Timer.reset();
  });

  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { hiddenAt = now(); clearTimeout(Timer.tickTimer); return; }
    var away = hiddenAt ? now() - hiddenAt : 0;
    if (Sound.ctx && Sound.ctx.state !== 'running') Sound.ctx.resume().catch(function () {});
    if (App.unlocked) Wake.request();
    if (App.unlocked && App.micWanted() && !Stomp.listening() && !Stomp.paused) Stomp.startMic().then(function () { UI.renderChips(); });
    Timer.tick(); UI.render(true); Timer.schedule();
    setTimeout(function () {
      if (App.unlocked && Sound.ctx && Sound.ctx.state !== 'running') {
        App.regate('Нажми, чтобы вернуть звук — iPhone выключил его, пока таймер был в фоне.');
        return;
      }
      if (away > 3000 && Timer.running() && !Timer.paused) {
        var left = Math.ceil(Timer.remaining() / 1000);
        Voice.say(Timer.phase === 'round' ? 'Раунд ' + Timer.round + '. Осталось ' + P.durWords(left)
          : Timer.phase === 'rest' ? 'Отдых. До раунда ' + (Timer.round + 1) + ' ' + P.durWords(left) : 'Подготовка');
      }
    }, 600);
  });

  // Страховка раз в секунду (дёшево): если таймер setTimeout отстал — догоняем.
  setInterval(function () { if (Timer.running() && !Timer.paused) { Timer.tick(); UI.render(false); } }, 1000);
  setInterval(function () { UI.checkDim(); }, 15000);

  UI.applyLook();
  UI.buildSettings();
  Voice.loadSystem();
  Clips.loadIndex().then(function () {
    var ids = Clips.voices.map(function (v) { return v.id; });
    if (S.voiceId !== 'system' && ids.indexOf(S.voiceId) < 0 && ids.length) { S.voiceId = ids[0]; save(); }
    UI.fillVoices();
    return Clips.load(S.voiceId);
  });
  UI.syncSettings();
  UI.render(true);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) UI.toast('Вышла новая версия — перезапусти таймер, когда закончишь');
    });
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  window.BoxTimer = { Timer: Timer, Stomp: Stomp, Sound: Sound, Voice: Voice, Clips: Clips, App: App, Cal: Cal, Wake: Wake, S: S };
})();
