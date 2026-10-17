/* Детектор топота в аудиопотоке (AudioWorklet).
 * Работает в отдельном аудиопотоке: главный поток спит и не греет телефон,
 * а сюда приходит только событие «был удар» (и уровень — пока открыт индикатор в настройках).
 * Перед этим файлом загружается detect.js (BoxDetect).
 */
class StompProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const D = globalThis.BoxDetect;
    this.win = Math.max(1, Math.round(sampleRate * 0.0107 / 128)); // окно ≈ 10,7 мс
    this.det = new D.OnsetDetector({ floor0: 0.01, dt: 10.7, refractory: 110 });
    this.n = 0; this.peak = 0;
    this.capture = null;     // после атаки ловим максимум ~30 мс
    this.meter = false; this.meterN = 0; this.meterMax = 0;
    this.port.onmessage = (e) => { if ('meter' in e.data) this.meter = !!e.data.meter; };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let p = this.peak;
    for (let i = 0; i < ch.length; i++) { const a = ch[i] < 0 ? -ch[i] : ch[i]; if (a > p) p = a; }
    this.peak = p;
    if (++this.n < this.win) return true;
    const t = currentTime * 1000, v = this.peak;
    this.n = 0; this.peak = 0;

    const hit = this.det.push(v, t, 0); // порог ×3 от фона; настоящий порог применяет главный поток
    if (this.capture) {
      if (v > this.capture.max) this.capture.max = v;
      if (t - this.capture.t >= 30) {
        this.port.postMessage({ type: 'hit', peak: this.capture.max, floor: this.det.floor });
        this.capture = null;
      }
    } else if (hit) {
      this.capture = { t: t, max: v };
    }
    if (this.meter) {
      if (v > this.meterMax) this.meterMax = v;
      if (++this.meterN >= 5) {
        this.port.postMessage({ type: 'level', level: this.meterMax, floor: this.det.floor });
        this.meterN = 0; this.meterMax = 0;
      }
    }
    return true;
  }
}
registerProcessor('stomp', StompProcessor);
