/** 极小的合成音效（Web Audio API），不依赖任何音频文件 */
export class Sfx {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.master = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.28;
    this.master.connect(this.ctx.destination);
  }

  setEnabled(v) {
    this.enabled = Boolean(v);
    if (v) this.init();
    if (this.master) this.master.gain.value = this.enabled ? 0.28 : 0;
  }

  tone({ freq = 440, dur = 0.14, type = 'sine', gain = 0.5, slideTo = null, delay = 0 }) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise({ dur = 0.18, gain = 0.3, delay = 0, filterFreq = 1200 }) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
  }

  play(name) {
    if (!this.enabled) return;
    switch (name) {
      case 'draw':
        this.tone({ freq: 620, dur: 0.08, type: 'triangle', gain: 0.25, slideTo: 880 });
        break;
      case 'play':
        this.noise({ dur: 0.12, gain: 0.22, filterFreq: 2200 });
        this.tone({ freq: 300, dur: 0.1, type: 'square', gain: 0.18, slideTo: 520 });
        break;
      case 'hit':
        this.tone({ freq: 180, dur: 0.22, type: 'sawtooth', gain: 0.35, slideTo: 60 });
        this.noise({ dur: 0.16, gain: 0.28, filterFreq: 800 });
        break;
      case 'block':
        this.tone({ freq: 900, dur: 0.1, type: 'triangle', gain: 0.25, slideTo: 1400 });
        break;
      case 'heal':
        this.tone({ freq: 660, dur: 0.16, type: 'sine', gain: 0.22 });
        this.tone({ freq: 880, dur: 0.2, type: 'sine', gain: 0.2, delay: 0.08 });
        break;
      case 'status':
        this.tone({ freq: 520, dur: 0.1, type: 'sine', gain: 0.2, slideTo: 700 });
        break;
      case 'click':
        this.tone({ freq: 420, dur: 0.05, type: 'square', gain: 0.12 });
        break;
      case 'deny':
        this.tone({ freq: 200, dur: 0.16, type: 'square', gain: 0.2, slideTo: 120 });
        break;
      case 'ult':
        [0, 0.09, 0.18, 0.3].forEach((d, i) => this.tone({ freq: 330 * (1 + i * 0.35), dur: 0.4, type: 'sawtooth', gain: 0.24, delay: d }));
        this.noise({ dur: 0.6, gain: 0.25, filterFreq: 3000 });
        break;
      case 'bell':
        [0, 0.18].forEach((d) => this.tone({ freq: 1320, dur: 0.5, type: 'sine', gain: 0.3, delay: d }));
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.3, delay: i * 0.13 }));
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => this.tone({ freq: f, dur: 0.34, type: 'sine', gain: 0.28, delay: i * 0.16 }));
        break;
      default:
        break;
    }
  }
}
