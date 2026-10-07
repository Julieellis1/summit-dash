// Tiny WebAudio synth — no audio files. Created lazily on first user gesture.
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; this.master = null; }
  _ensure() {
    if (this.muted) return null;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
        this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.32; this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch { return null; }
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.32; }
  tone(freq, dur = 0.12, { type = 'sine', vol = 0.5, slide = 0, delay = 0 } = {}) {
    const c = this._ensure(); if (!c) return;
    const t = c.currentTime + delay; const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur = 0.2, { vol = 0.4, freq = 1200, q = 0.8, delay = 0, sweep = 0 } = {}) {
    const c = this._ensure(); if (!c) return;
    const t = c.currentTime + delay; const len = Math.floor(c.sampleRate * dur); const buf = c.createBuffer(1, len, c.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(); s.buffer = buf; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(freq, t); if (sweep) f.frequency.exponentialRampToValueAtTime(freq + sweep, t + dur); f.Q.value = q;
    const g = c.createGain(); g.gain.value = vol; s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  }
  click() { this.tone(880, 0.05, { type: 'triangle', vol: 0.25 }); }
  clack() { this.noise(0.06, { vol: 0.6, freq: 2400, q: 2 }); this.tone(300 + Math.random() * 200, 0.05, { type: 'square', vol: 0.08 }); }
  hop(i = 0) { this.tone(420 + (i % 8) * 40, 0.07, { type: 'triangle', vol: 0.18, slide: 120 }); }
  good() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.3, delay: i * 0.07 })); }
  bad() { [392, 311, 233].forEach((f, i) => this.tone(f, 0.2, { type: 'sawtooth', vol: 0.12, delay: i * 0.08 })); }
  whoosh() { this.noise(0.35, { vol: 0.35, freq: 400, sweep: 2600, q: 0.7 }); }
  rumble() { this.noise(1.6, { vol: 0.9, freq: 90, q: 0.5 }); this.tone(55, 1.4, { type: 'sine', vol: 0.5, slide: -20 }); }
  ice() { [1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.25, { type: 'sine', vol: 0.12, delay: i * 0.05 })); }
  fanfare() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.3, delay: i * 0.11 })); }
}
