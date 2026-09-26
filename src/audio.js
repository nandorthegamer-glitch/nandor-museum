// Suoni della stazione, tutti generati con WebAudio (nessun file):
//   - ronzio di fondo: rumore filtrato basso + due toni che battono piano
//   - sibilo pneumatico dei portelloni con un colpo sordo
//   - doppio bip "accesso negato" davanti a una stanza chiusa
// Parte al clic sulle bandiere: i browser non suonano prima di un gesto.

export class StationAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ac = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ac.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ac.destination);

    // rumore bianco riutilizzabile (2 s)
    const len = ac.sampleRate * 2;
    this.noise = ac.createBuffer(1, len, ac.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // ronzio: rumore passa-basso che respira + 55 Hz e 110,4 Hz
    const hum = ac.createBufferSource();
    hum.buffer = this.noise;
    hum.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const humGain = ac.createGain();
    humGain.gain.value = 0.16;
    hum.connect(lp).connect(humGain).connect(this.master);
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(lp.frequency);
    for (const [f, g] of [[55, 0.035], [110.4, 0.018]]) {
      const o = ac.createOscillator();
      o.frequency.value = f;
      const og = ac.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.master);
      o.start();
    }
    hum.start();
    lfo.start();
  }

  // --- voce di Nandor: frasi generate offline con Piper (tools/piper), una per lingua ---
  // urls: { it, en }; gains pareggiano il volume (la voce italiana esce molto piu' forte)
  loadVoice(urls, gains = {}) {
    this.voiceGains = gains;
    this.voiceBuffers = {};
    const ac = this.ctx;
    for (const [lang, url] of Object.entries(urls)) {
      fetch(url).then((r) => r.arrayBuffer()).then((b) => ac.decodeAudioData(b))
        .then((buf) => { this.voiceBuffers[lang] = buf; })
        .catch(() => {});
    }
    // catena "da ologramma": voce pulita + due eco corte filtrate come una radio +
    // un velo di modulazione ad anello; poi compressore e analizzatore per il labiale
    this.voiceIn = ac.createGain();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.analyser = ac.createAnalyser();
    this.analyser.fftSize = 512;
    this.levelData = new Float32Array(this.analyser.fftSize);
    this.voiceIn.connect(comp);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4500;
    this.voiceIn.connect(hp).connect(lp);
    for (const [t, g] of [[0.085, 0.28], [0.17, 0.14]]) {
      const d = ac.createDelay(1); d.delayTime.value = t;
      const dg = ac.createGain(); dg.gain.value = g;
      lp.connect(d).connect(dg).connect(comp);
    }
    const ring = ac.createGain(); ring.gain.value = 0;
    const osc = ac.createOscillator(); osc.frequency.value = 38;
    osc.connect(ring.gain);
    const ringOut = ac.createGain(); ringOut.gain.value = 0.22;
    this.voiceIn.connect(ring).connect(ringOut).connect(comp);
    osc.start();
    comp.connect(this.analyser);
    this.analyser.connect(this.master);
  }

  // true se la frase e' partita
  say(lang) {
    const buf = this.voiceBuffers?.[lang];
    if (!this.ctx || !buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = this.voiceGains[lang] ?? 1;
    src.connect(g).connect(this.voiceIn);
    src.start();
    this.speakingUntil = this.ctx.currentTime + buf.duration + 0.3;
    return true;
  }

  get speaking() {
    return !!this.ctx && this.ctx.currentTime < (this.speakingUntil ?? 0);
  }

  // livello istantaneo della voce (0..~0.5), per muovere la bocca
  voiceLevel() {
    if (!this.analyser || !this.speaking) return 0;
    this.analyser.getFloatTimeDomainData(this.levelData);
    let s = 0;
    for (const v of this.levelData) s += v * v;
    return Math.sqrt(s / this.levelData.length);
  }

  // --- musica delle stanze (room.json "music"): in streaming ---
  // Entrando sale in 1,5 s; uscendo sfuma in 0,5 s e si FERMA (riavvolta: al rientro
  // riparte da capo). want = { url: volume } delle stanze in cui si trova il visitatore.
  updateMusic(dt, want) {
    if (!this.ctx) return;
    if (!this.tracks) {
      this.tracks = new Map();
      // pagina nascosta: il ciclo si ferma ma l'audio no, quindi si ferma tutto subito
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) for (const t of this.tracks.values()) this.stopTrack(t);
      });
    }
    for (const [url, vol] of Object.entries(want)) {
      if (this.tracks.has(url)) continue;
      const el = new Audio(url);
      el.loop = true;
      el.crossOrigin = 'anonymous';
      const g = this.ctx.createGain();
      g.gain.value = 0;
      this.ctx.createMediaElementSource(el).connect(g).connect(this.master);
      this.tracks.set(url, { el, g, level: 0, vol });
    }
    for (const [url, t] of this.tracks) {
      const inside = url in want;
      const step = (dt / (inside ? 1.5 : 0.5)) * t.vol;
      const target = inside ? t.vol : 0;
      t.level += Math.sign(target - t.level) * Math.min(Math.abs(target - t.level), step);
      t.g.gain.value = t.level;
      if (inside && t.el.paused) t.el.play().catch(() => {});
      if (!inside && t.level === 0 && !t.el.paused) this.stopTrack(t);
    }
  }

  stopTrack(t) {
    t.el.pause();
    t.el.currentTime = 0;
    t.level = 0;
    t.g.gain.value = 0;
  }

  toggleMute() {
    this.muted = !this.muted;
    this.applyVolume();
  }

  // silenzio mentre si gioca in un cabinato (il gioco ha il suo audio)
  duck(on) {
    this.ducked = on;
    this.applyVolume();
  }

  applyVolume() {
    if (this.master) this.master.gain.value = this.muted || this.ducked ? 0 : 0.7;
  }

  // volume per distanza: pieno entro 2 m, zero oltre 16 m
  near(dist) {
    return Math.max(0, Math.min(1, 1 - (dist - 2) / 14));
  }

  door(dist, opening) {
    const ac = this.ctx;
    const v = this.near(dist);
    if (!ac || v <= 0) return;
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(opening ? 1800 : 2600, t);
    bp.frequency.exponentialRampToValueAtTime(opening ? 3200 : 1200, t + 0.45);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35 * v, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.6);
    // colpo sordo a fine corsa
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(95, t + 0.38);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.55);
    const og = ac.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.setValueAtTime(0.3 * v, t + 0.38);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.65);
  }

  denied(dist) {
    const ac = this.ctx;
    const v = this.near(dist);
    if (!ac || v <= 0) return;
    const t = ac.currentTime;
    [[520, 0], [390, 0.16]].forEach(([f, dt]) => {
      const o = ac.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(0.06 * v, t + dt + 0.01);
      g.gain.setValueAtTime(0.06 * v, t + dt + 0.11);
      g.gain.linearRampToValueAtTime(0, t + dt + 0.13);
      o.connect(g).connect(this.master);
      o.start(t + dt);
      o.stop(t + dt + 0.15);
    });
  }
}
