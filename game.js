/* Chirp — standalone HTML5 arcade game
   Polished Flappy-style with power-ups, particles, juice & save.
   Drop this folder on GitHub Pages and open index.html. */

(function () {
  "use strict";

  // ---------- Constants ----------
  const STEP = 1 / 60;
  const MAX_ACC = 0.1;
  const GRAVITY = 1950;
  const FLAP_V = -460;
  const MAX_FALL = 780;
  const BIRD_R = 16;
  const PIPE_W = 72;
  const PIPE_GAP0 = 248;
  const PIPE_GAP1 = 158;
  const PIPE_SPACE0 = 270;
  const SPEED0 = 168;
  const SPEED1 = 330;
  const METER_RATE = 0.085;
  const SAVE_KEY = "chirp-save-v1";
  const SAVE_VERSION = 1;

  // ---------- Helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);

  function lerpHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
    const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
    const r = Math.round(lerp(ar, br, t));
    const g = Math.round(lerp(ag, bg, t));
    const bl = Math.round(lerp(ab, bb, t));
    return `rgb(${r},${g},${bl})`;
  }

  // ---------- Save ----------
  const defaults = {
    version: SAVE_VERSION,
    best: 0,
    coins: 0,
    muted: false,
    haptics: true,
    shake: true,
    seenTutorial: false,
  };

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return { ...defaults };
      const p = JSON.parse(raw);
      return {
        ...defaults,
        ...p,
        version: SAVE_VERSION,
        best: Math.max(0, Number(p.best) || 0),
        coins: Math.max(0, Number(p.coins) || 0),
        muted: Boolean(p.muted),
        haptics: p.haptics !== false,
        shake: p.shake !== false,
        seenTutorial: Boolean(p.seenTutorial),
      };
    } catch {
      return { ...defaults };
    }
  }

  function writeSave(data) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...data, version: SAVE_VERSION }));
    } catch { /* private mode */ }
  }

  // ---------- Audio (Web Audio API, procedural) ----------
  let bus = null;
  let muted = false;

  function ensureAudio() {
    if (typeof window === "undefined") return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!bus) {
      const ctx = new AC({ latencyHint: "interactive" });
      const master = ctx.createGain();
      const sfx = ctx.createGain();
      const music = ctx.createGain();
      sfx.gain.value = 0.7;
      music.gain.value = 0.18;
      master.gain.value = muted ? 0 : 1;
      sfx.connect(master);
      music.connect(master);
      master.connect(ctx.destination);
      bus = { ctx, master, sfx, music };
    }
    if (bus.ctx.state === "suspended") void bus.ctx.resume();
    return bus;
  }

  function unlockAudio() { ensureAudio(); }

  function setMuted(next) {
    muted = next;
    if (!bus) return;
    bus.master.gain.setTargetAtTime(next ? 0 : 1, bus.ctx.currentTime, 0.03);
    if (next) stopMusic();
  }

  function envGain(ctx, dest, t, peak, dur) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(dest);
    return g;
  }

  function tone(freq, dur, type, peak, detune) {
    const b = ensureAudio();
    if (!b || muted) return;
    const t = b.ctx.currentTime;
    const o = b.ctx.createOscillator();
    o.type = type || "sine";
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    const g = envGain(b.ctx, b.sfx, t, peak || 0.2, dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noiseBurst(dur, peak, filterFreq) {
    const b = ensureAudio();
    if (!b || muted) return;
    const t = b.ctx.currentTime;
    const buf = b.ctx.createBuffer(1, b.ctx.sampleRate * dur, b.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = b.ctx.createBufferSource();
    src.buffer = buf;
    const f = b.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = filterFreq || 1200;
    f.Q.value = 0.8;
    const g = envGain(b.ctx, b.sfx, t, peak || 0.15, dur);
    src.connect(f);
    f.connect(g);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function sfxFlap() {
    tone(520, 0.08, "triangle", 0.18);
    tone(780, 0.06, "sine", 0.08, 12);
  }
  function sfxScore() {
    tone(660, 0.07, "sine", 0.14);
    setTimeout(() => tone(990, 0.1, "sine", 0.12), 40);
  }
  function sfxCoin() {
    tone(880, 0.06, "square", 0.1);
    setTimeout(() => tone(1320, 0.1, "sine", 0.12), 35);
  }
  function sfxPower() {
    tone(320, 0.12, "sawtooth", 0.1);
    setTimeout(() => tone(540, 0.14, "triangle", 0.12), 50);
  }
  function sfxBoost() {
    tone(180, 0.2, "sawtooth", 0.12);
    noiseBurst(0.15, 0.1, 800);
  }
  function sfxCrash() {
    noiseBurst(0.28, 0.22, 400);
    tone(90, 0.25, "sawtooth", 0.15);
  }
  function sfxUi() {
    tone(440, 0.05, "sine", 0.08);
  }

  let musicPaused = false;
  let musicTimer = null;
  let musicNote = 0;

  function startMusic() {
    stopMusic();
    musicPaused = false;
    musicNote = 0;
    const b = ensureAudio();
    if (!b || muted) return;
    scheduleMusicNote();
  }

  function scheduleMusicNote() {
    if (musicPaused || muted || !bus) return;
    const ctx = bus.ctx;
    const notes = [262, 330, 392, 523, 392, 330];
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = notes[musicNote % notes.length];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g);
    g.connect(bus.music);
    o.start(t);
    o.stop(t + 0.6);
    musicNote++;
    musicTimer = setTimeout(scheduleMusicNote, 520);
  }

  function stopMusic() {
    musicPaused = true;
    if (musicTimer) {
      clearTimeout(musicTimer);
      musicTimer = null;
    }
  }

  function pauseMusic() {
    musicPaused = true;
    if (musicTimer) {
      clearTimeout(musicTimer);
      musicTimer = null;
    }
  }

  function resumeMusic() {
    if (muted) return;
    if (!musicPaused && musicTimer) return;
    musicPaused = false;
    const b = ensureAudio();
    if (!b) return;
    if (!musicTimer) scheduleMusicNote();
  }

  function resumeAudio() {
    const b = ensureAudio();
    if (b && b.ctx.state === "suspended") void b.ctx.resume();
  }

  // ---------- Drawing ----------
  const SKY = [
    { top: "#7ec8ff", mid: "#c8ebff", bot: "#efe4c4", sun: "#ffe082", night: 0 },
    { top: "#f4a06a", mid: "#f7c9a8", bot: "#8eb8d4", sun: "#ffd180", night: 0.25 },
    { top: "#1b2a58", mid: "#3d4a86", bot: "#6a5a92", sun: "#f4f1de", night: 1 },
    { top: "#f3c48a", mid: "#f8d9b4", bot: "#9eccec", sun: "#ffcc80", night: 0.15 },
  ];

  function skyPalette(skyT) {
    const x = ((skyT % 1) + 1) % 1;
    const i = Math.floor(x * SKY.length);
    const n = (i + 1) % SKY.length;
    const f = x * SKY.length - i;
    const a = SKY[i], b = SKY[n];
    return {
      top: lerpHex(a.top, b.top, f),
      mid: lerpHex(a.mid, b.mid, f),
      bot: lerpHex(a.bot, b.bot, f),
      sun: lerpHex(a.sun, b.sun, f),
      night: lerp(a.night, b.night, f),
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawWorld(ctx, world) {
    const { w, h, t, skyT, scroll, bird, pipes, pickups, particles, pops, clouds, groundY, shakeX, shakeY, flash, boostT, shield, phase, reduced, invuln } = world;
    ctx.save();
    ctx.translate(shakeX, shakeY);

    // Sky
    const pal = skyPalette(skyT);
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, pal.top);
    grd.addColorStop(0.45, pal.mid);
    grd.addColorStop(1, pal.bot);
    ctx.fillStyle = grd;
    ctx.fillRect(-20, -20, w + 40, h + 40);

    // Sun / moon
    const sunY = lerp(h * 0.18, h * 0.55, pal.night);
    ctx.beginPath();
    ctx.arc(w * 0.78, sunY, 28 + pal.night * 8, 0, Math.PI * 2);
    ctx.fillStyle = pal.sun;
    ctx.globalAlpha = 0.95 - pal.night * 0.25;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Stars at night
    if (pal.night > 0.4) {
      ctx.globalAlpha = (pal.night - 0.4) * 1.4;
      for (let i = 0; i < 28; i++) {
        const sx = ((i * 97 + scroll * 0.05) % (w + 40)) - 20;
        const sy = 20 + ((i * 53) % (h * 0.4));
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(sx, sy, 1.2 + (i % 3) * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Clouds
    for (const c of clouds) {
      const cx = ((c.x - scroll * c.v) % (w + 160)) - 80;
      drawCloud(ctx, cx, c.y, c.s, 0.55 + pal.night * 0.15);
    }

    // Pipes
    for (const p of pipes) drawPipe(ctx, p, groundY, pal.night);

    // Pickups
    for (const u of pickups) {
      if (u.taken) continue;
      const bob = Math.sin(t * 3.2 + u.bob) * 5;
      drawPickup(ctx, u.x, u.y + bob, u.kind, t);
    }

    // Bird — blink while invulnerable after shield break
    if (bird) {
      const invulnBlink = invuln > 0 && !shield && phase === "playing";
      if (!invulnBlink || Math.floor(t * 12) % 2 === 0) {
        drawBird(ctx, bird, t, boostT > 0, shield, phase === "dead");
      }
    }

    // Particles
    for (const p of particles) {
      const life = p.life / p.max;
      ctx.globalAlpha = clamp(life * 1.4, 0, 1);
      ctx.fillStyle = p.color;
      if (p.kind === "ring") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.2 - life), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size * life), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Ground
    const groundH = h - groundY;
    ctx.fillStyle = pal.night > 0.5 ? "#2d3a28" : "#6b9e4e";
    ctx.fillRect(-10, groundY, w + 20, groundH + 20);
    // Grass strip
    ctx.fillStyle = pal.night > 0.5 ? "#3d5234" : "#8bc34a";
    ctx.fillRect(-10, groundY, w + 20, 14);
    // Dirt detail
    ctx.fillStyle = pal.night > 0.5 ? "#24301f" : "#5a7d3c";
    for (let i = 0; i < 12; i++) {
      const gx = ((i * 73 - scroll * 0.4) % (w + 40)) - 20;
      ctx.fillRect(gx, groundY + 18, 18, 6);
    }

    // Score pops
    for (const p of pops) {
      const life = p.life / p.max;
      ctx.globalAlpha = clamp(life * 1.6, 0, 1);
      ctx.font = `bold ${18 + (1 - life) * 8}px system-ui,sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 3;
      ctx.strokeText(p.text, p.x, p.y - (1 - life) * 28);
      ctx.fillText(p.text, p.x, p.y - (1 - life) * 28);
      ctx.globalAlpha = 1;
    }

    // Flash
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.55})`;
      ctx.fillRect(-20, -20, w + 40, h + 40);
    }

    ctx.restore();
  }

  function drawCloud(ctx, x, y, s, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y, 18 * s, 0, Math.PI * 2);
    ctx.arc(x + 22 * s, y - 6 * s, 24 * s, 0, Math.PI * 2);
    ctx.arc(x + 48 * s, y + 2 * s, 16 * s, 0, Math.PI * 2);
    ctx.arc(x + 28 * s, y + 10 * s, 14 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawPipe(ctx, p, groundY, night) {
    const body = night > 0.5 ? "#2e5a3c" : "#3d9e4e";
    const lip = night > 0.5 ? "#3d7a4e" : "#5cbf6a";
    const edge = night > 0.5 ? "#1e3a28" : "#2d6b38";
    const gapTop = p.gapY - p.gap / 2;
    const gapBot = p.gapY + p.gap / 2;

    // Top pipe
    ctx.fillStyle = body;
    ctx.fillRect(p.x, 0, p.w, gapTop - 18);
    ctx.fillStyle = lip;
    roundRect(ctx, p.x - 5, gapTop - 22, p.w + 10, 22, 4);
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Bottom pipe
    ctx.fillStyle = body;
    ctx.fillRect(p.x, gapBot + 18, p.w, groundY - gapBot - 18);
    ctx.fillStyle = lip;
    roundRect(ctx, p.x - 5, gapBot, p.w + 10, 22, 4);
    ctx.fill();
    ctx.stroke();
  }

  function drawPickup(ctx, x, y, kind, t) {
    ctx.save();
    ctx.translate(x, y);
    if (kind === "coin") {
      ctx.rotate(t * 2);
      ctx.fillStyle = "#ffd24a";
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff3a0";
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("$", 0, 1);
    } else if (kind === "shield") {
      ctx.fillStyle = "#8ec5ff";
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(11, -4);
      ctx.lineTo(9, 10);
      ctx.lineTo(0, 14);
      ctx.lineTo(-9, 10);
      ctx.lineTo(-11, -4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (kind === "boost") {
      ctx.fillStyle = "#ffd24a";
      ctx.beginPath();
      ctx.moveTo(-2, -13);
      ctx.lineTo(6, -2);
      ctx.lineTo(1, -2);
      ctx.lineTo(8, 13);
      ctx.lineTo(-6, 0);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      // wing
      ctx.fillStyle = "#fde68a";
      ctx.beginPath();
      ctx.ellipse(0, 0, 13, 7, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBird(ctx, bird, t, boosting, hasShield, dead) {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);
    const sx = bird.squash;
    const sy = 2 - bird.squash;
    ctx.scale(sx, sy);

    // Shield aura
    if (hasShield && !dead) {
      ctx.strokeStyle = "rgba(142,197,255,0.7)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 24 + Math.sin(t * 6) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Boost trail
    if (boosting && !dead) {
      ctx.fillStyle = "rgba(255,210,74,0.35)";
      ctx.beginPath();
      ctx.ellipse(-22, 4, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Body
    ctx.fillStyle = dead ? "#94a3b8" : "#fbbf24";
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // Belly
    ctx.fillStyle = dead ? "#cbd5e1" : "#fef3c7";
    ctx.beginPath();
    ctx.ellipse(3, 4, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wing
    const wingAng = -0.4 + bird.wing * 1.1;
    ctx.save();
    ctx.translate(-4, 2);
    ctx.rotate(wingAng);
    ctx.fillStyle = dead ? "#64748b" : "#f59e0b";
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Beak
    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.moveTo(14, -2);
    ctx.lineTo(24, 1);
    ctx.lineTo(14, 5);
    ctx.closePath();
    ctx.fill();

    // Eye
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(7, -5, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(8.5, -5, 2.4, 0, Math.PI * 2);
    ctx.fill();

    // Cheek
    if (!dead) {
      ctx.fillStyle = "rgba(251,113,133,0.45)";
      ctx.beginPath();
      ctx.arc(4, 3, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ---------- Game class ----------
  class ChirpGame {
    constructor(canvas, onHud) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
      this.onHud = onHud;
      this.raf = 0;
      this.acc = 0;
      this.last = 0;
      this.running = false;
      this.w = 390;
      this.h = 844;
      this.groundY = 700;
      this.birdX = 118;
      this.phase = "menu";
      this.t = 0;
      this.skyT = 0.08;
      this.scroll = 0;
      this.score = 0;
      this.runCoins = 0;
      this.newBest = false;
      this.deathLock = 0;
      this.invuln = 0;
      this.boostT = 0;
      this.shield = false;
      this.wings = 0;
      this.meter = 0;
      this.lastGapY = 0;
      this.hintUntilFlap = true;
      this.trauma = 0;
      this.flash = 0;
      this.hitstop = 0;
      this.bird = null;
      this.pipes = [];
      this.pickups = [];
      this.particles = [];
      this.pops = [];
      this.clouds = [];
      this.save = loadSave();
      this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.hudDirty = true;
      this.unbind = [];
      setMuted(this.save.muted);
      this.hintUntilFlap = !this.save.seenTutorial;
      this.resetWorld(true);
      this.bind();
      this.layout();
      this.emitHud();
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.last = performance.now();
      const loop = (now) => {
        if (!this.running) return;
        let dt = (now - this.last) / 1000;
        this.last = now;
        if (dt > 0.25) dt = 0.25;
        if (this.hitstop > 0) {
          this.hitstop -= dt;
          this.render();
          this.raf = requestAnimationFrame(loop);
          return;
        }
        this.acc += dt;
        if (this.acc > MAX_ACC) this.acc = MAX_ACC;
        while (this.acc >= STEP) {
          this.step(STEP);
          this.acc -= STEP;
        }
        this.render();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    destroy() {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.unbind.forEach((fn) => fn());
      this.unbind = [];
      stopMusic();
    }

    playFromMenu() {
      unlockAudio();
      startMusic();
      sfxUi();
      this.resetWorld(false);
      this.phase = "ready";
      this.hudDirty = true;
      this.emitHud();
    }

    pause() {
      if (this.phase !== "playing" && this.phase !== "ready") return;
      this.phase = "paused";
      pauseMusic();
      sfxUi();
      this.hudDirty = true;
      this.emitHud();
    }

    resume() {
      if (this.phase !== "paused") return;
      this.phase = "playing";
      resumeAudio();
      resumeMusic();
      sfxUi();
      this.hudDirty = true;
      this.emitHud();
    }

    home() {
      sfxUi();
      stopMusic();
      this.resetWorld(true);
      this.phase = "menu";
      this.hudDirty = true;
      this.emitHud();
    }

    retry() {
      if (this.phase === "dead" && this.deathLock > 0) return;
      sfxUi();
      unlockAudio();
      startMusic();
      this.resetWorld(false);
      this.phase = "ready";
      this.hudDirty = true;
      this.emitHud();
    }

    toggleMute() {
      this.save.muted = !this.save.muted;
      setMuted(this.save.muted);
      if (!this.save.muted) {
        unlockAudio();
        // Only resume music if actively playing (not paused/menu/dead)
        if (this.phase === "playing" || this.phase === "ready") {
          startMusic();
        }
        sfxUi();
      } else {
        stopMusic();
      }
      this.persist();
      this.hudDirty = true;
      this.emitHud();
    }

    toggleHaptics() {
      this.save.haptics = !this.save.haptics;
      this.persist();
      this.hudDirty = true;
      this.emitHud();
    }

    toggleShake() {
      this.save.shake = !this.save.shake;
      this.persist();
      this.hudDirty = true;
      this.emitHud();
    }

    flap() {
      unlockAudio();
      if (this.phase === "paused") return;
      if (this.phase === "dead") {
        if (this.deathLock > 0) return;
        this.retry();
        return;
      }
      if (this.phase === "menu") {
        this.playFromMenu();
        return;
      }
      if (this.phase === "ready") {
        this.phase = "playing";
        this.hintUntilFlap = false;
        if (!this.save.seenTutorial) {
          this.save.seenTutorial = true;
          this.persist();
        }
      }
      if (this.phase !== "playing") return;

      // Extra wing flaps
      if (this.wings > 0 && this.bird.vy > -100) {
        // still allow normal flap
      }
      this.bird.vy = FLAP_V;
      this.bird.wing = 1;
      this.bird.squash = 1.18;
      this.bird.alive = true;
      sfxFlap();
      this.buzz(12);
      this.burst(this.bird.x - 8, this.bird.y + 8, 8, "puff", "#fff6d0");
      this.hudDirty = true;
      this.emitHud();
    }

    // Use wing power (double-tap style is just extra flaps stored)
    useWing() {
      if (this.wings <= 0 || this.phase !== "playing") return;
      this.wings--;
      this.bird.vy = FLAP_V * 1.15;
      this.bird.wing = 1;
      this.invuln = Math.max(this.invuln, 0.35);
      sfxPower();
      this.burst(this.bird.x, this.bird.y, 10, "feather", "#ffe27a");
      this.hudDirty = true;
      this.emitHud();
    }

    snapshot() {
      return {
        phase: this.phase,
        score: this.score,
        best: this.save.best,
        coins: this.save.coins,
        runCoins: this.runCoins,
        shield: this.shield,
        wings: this.wings,
        boostT: this.boostT,
        meter: this.meter,
        newBest: this.newBest,
        showHint: this.hintUntilFlap && (this.phase === "ready" || this.phase === "playing"),
        muted: this.save.muted,
        haptics: this.save.haptics,
        shake: this.save.shake,
      };
    }

    emitHud() {
      this.hudDirty = false;
      this.onHud(this.snapshot());
    }

    persist() {
      writeSave(this.save);
    }

    buzz(ms) {
      if (!this.save.haptics) return;
      try {
        if (navigator.vibrate) navigator.vibrate(ms);
      } catch { /* ignore */ }
    }

    bind() {
      const onPointer = (e) => {
        const t = e.target;
        if (t && t.closest && t.closest("[data-ui]")) return;
        e.preventDefault();
        this.flap();
      };
      const onKey = (e) => {
        if (e.repeat) return;
        if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
          e.preventDefault();
          this.flap();
        } else if (e.code === "Escape" || e.code === "KeyP") {
          e.preventDefault();
          if (this.phase === "playing" || this.phase === "ready") this.pause();
          else if (this.phase === "paused") this.resume();
        } else if (e.code === "KeyM") {
          this.toggleMute();
        } else if (e.code === "KeyF" || e.code === "ShiftLeft") {
          this.useWing();
        }
      };
      const onVis = () => {
        if (document.hidden) {
          if (this.phase === "playing") this.pause();
        } else {
          resumeAudio();
          this.last = performance.now();
        }
      };
      this.canvas.addEventListener("pointerdown", onPointer);
      window.addEventListener("keydown", onKey);
      document.addEventListener("visibilitychange", onVis);
      this.unbind.push(() => this.canvas.removeEventListener("pointerdown", onPointer));
      this.unbind.push(() => window.removeEventListener("keydown", onKey));
      this.unbind.push(() => document.removeEventListener("visibilitychange", onVis));

      this.resizeObs = new ResizeObserver(() => this.layout());
      this.resizeObs.observe(this.canvas.parentElement || this.canvas);
      this.unbind.push(() => this.resizeObs.disconnect());
    }

    layout() {
      const parent = this.canvas.parentElement || this.canvas;
      const rect = parent.getBoundingClientRect();
      const cssW = Math.max(1, rect.width);
      const cssH = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      this.canvas.style.width = cssW + "px";
      this.canvas.style.height = cssH + "px";
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = cssW;
      this.h = cssH;
      this.groundY = cssH * 0.78;
      this.birdX = cssW * 0.3;
      if (this.bird) {
        this.bird.x = this.birdX;
        if (this.phase === "menu" || this.phase === "ready") {
          this.bird.y = this.h * 0.42;
        }
      }
      this.seedClouds();
    }

    seedClouds() {
      this.clouds = Array.from({ length: 7 }, (_, i) => ({
        x: (i / 7) * (this.w + 200),
        y: 40 + ((i * 97) % Math.max(80, this.h * 0.38)),
        s: 0.7 + (i % 3) * 0.25,
        v: 0.15 + (i % 4) * 0.05,
      }));
    }

    difficulty() {
      return clamp(this.score / 42, 0, 1);
    }

    speed() {
      const d = this.difficulty();
      const ease = d * d * (3 - 2 * d);
      return lerp(SPEED0, SPEED1, ease);
    }

    gapSize() {
      return lerp(PIPE_GAP0, PIPE_GAP1, this.difficulty());
    }

    spacing() {
      return PIPE_SPACE0 + this.speed() * 0.12;
    }

    resetWorld(menu) {
      this.score = 0;
      this.runCoins = 0;
      this.newBest = false;
      this.deathLock = 0;
      this.invuln = 0;
      this.boostT = 0;
      this.shield = false;
      this.wings = 0;
      this.meter = 0;
      this.trauma = 0;
      this.flash = 0;
      this.hitstop = 0;
      this.t = 0;
      this.scroll = 0;
      this.pipes = [];
      this.pickups = [];
      this.particles = [];
      this.pops = [];
      this.lastGapY = this.h * 0.42;
      this.bird = {
        x: this.birdX,
        y: this.h * 0.42,
        vy: 0,
        rot: 0,
        wing: 0.5,
        squash: 1,
        alive: true,
      };
      if (!menu) {
        const start = this.w * 0.58;
        for (let i = 0; i < 4; i++) this.spawnPipe(start + i * this.spacing());
      }
      this.hudDirty = true;
    }

    spawnPipe(x) {
      const gap = this.gapSize();
      const margin = 96;
      const minY = margin + gap / 2;
      const maxY = this.groundY - margin - gap / 2;
      let gapY = rand(minY, maxY);
      const maxD = lerp(170, 120, this.difficulty());
      gapY = clamp(gapY, this.lastGapY - maxD, this.lastGapY + maxD);
      gapY = clamp(gapY, minY, maxY);
      this.lastGapY = gapY;
      this.pipes.push({ x, gapY, gap, w: PIPE_W, scored: false });

      const roll = Math.random();
      let kind = null;
      if (roll < 0.42) kind = "coin";
      else if (roll < 0.5) kind = "shield";
      else if (roll < 0.56) kind = "boost";
      else if (roll < 0.64) kind = "wing";
      if (kind) {
        this.pickups.push({
          x: x + PIPE_W / 2,
          y: gapY + rand(-gap * 0.18, gap * 0.18),
          kind,
          taken: false,
          bob: Math.random() * 6,
        });
      }
    }

    step(dt) {
      this.t += dt;
      this.skyT += dt * 0.012;
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3.2);
      if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - dt * 2.4);
      if (this.deathLock > 0) this.deathLock -= dt;
      if (this.invuln > 0) this.invuln -= dt;
      if (this.boostT > 0) this.boostT = Math.max(0, this.boostT - dt);

      const moving =
        this.phase === "playing" || this.phase === "menu" || this.phase === "ready";

      if (moving) {
        this.scroll += this.speed() * dt * (this.phase === "menu" ? 0.35 : 1);
        // Clouds drift
        for (const c of this.clouds) {
          c.x -= c.v * this.speed() * dt * 0.3;
          if (c.x < -100) c.x = this.w + 80;
        }
      }

      // Bird physics
      if (this.phase === "playing") {
        const grav = this.boostT > 0 ? GRAVITY * 0.55 : GRAVITY;
        this.bird.vy = Math.min(MAX_FALL, this.bird.vy + grav * dt);
        this.bird.y += this.bird.vy * dt;
        this.bird.rot = clamp(this.bird.vy / 700, -0.55, 1.15);
        this.bird.wing = Math.max(0, this.bird.wing - dt * 3.2);
        this.bird.squash = lerp(this.bird.squash, 1, 1 - Math.exp(-10 * dt));

        this.advancePipes(dt);
        this.collectPickups();
        this.collide();
      } else if (this.phase === "menu" || this.phase === "ready") {
        // Idle float
        this.bird.y = this.h * 0.42 + Math.sin(this.t * 2.2) * 10;
        this.bird.rot = Math.sin(this.t * 2.2) * 0.12;
        this.bird.wing = 0.4 + Math.sin(this.t * 8) * 0.35;
        this.bird.squash = 1;
      } else if (this.phase === "dead") {
        this.bird.vy = Math.min(MAX_FALL, this.bird.vy + GRAVITY * dt);
        this.bird.y += this.bird.vy * dt;
        this.bird.rot = lerp(this.bird.rot, 1.15, 1 - Math.exp(-6 * dt));
        if (this.bird.y > this.groundY + 80) this.bird.y = this.groundY + 80;
      }

      this.stepParticles(dt);
      this.stepPops(dt);
      if (this.hudDirty) this.emitHud();
    }

    advancePipes(dt) {
      const sp = this.speed() * dt * (this.boostT > 0 ? 1.35 : 1);
      for (const p of this.pipes) p.x -= sp;
      for (const u of this.pickups) u.x -= sp;

      for (const p of this.pipes) {
        if (!p.scored && p.x + p.w < this.bird.x) {
          p.scored = true;
          const bonus = this.meter >= 1 ? 2 : 1;
          this.score += bonus;
          this.meter = this.meter >= 1 ? 0 : clamp(this.meter + METER_RATE, 0, 1);
          sfxScore();
          this.pop(this.bird.x + 18, this.bird.y - 24, bonus > 1 ? "+2" : "+1");
          this.burst(p.x + p.w / 2, p.gapY, 10, "star", "#fff4a0");
          this.hudDirty = true;
        }
      }

      const space = this.spacing();
      this.pipes = this.pipes.filter((p) => p.x + p.w > -40);
      this.pickups = this.pickups.filter((u) => !u.taken && u.x > -40);
      let right = 0;
      for (const p of this.pipes) if (p.x > right) right = p.x;
      while (this.pipes.length < 5) {
        right += space;
        this.spawnPipe(right);
      }
    }

    collectPickups() {
      for (const u of this.pickups) {
        if (u.taken) continue;
        const dx = u.x - this.bird.x;
        const dy = u.y - this.bird.y;
        if (dx * dx + dy * dy < 36 * 36) {
          u.taken = true;
          this.takePickup(u.kind, u.x, u.y);
        }
      }
    }

    takePickup(kind, x, y) {
      if (kind === "coin") {
        this.runCoins += 1;
        this.save.coins += 1;
        sfxCoin();
        this.pop(x, y, "+1");
        this.burst(x, y, 12, "spark", "#ffd24a");
      } else if (kind === "shield") {
        this.shield = true;
        sfxPower();
        this.pop(x, y, "SHIELD");
        this.burst(x, y, 14, "ring", "#8ec5ff");
      } else if (kind === "boost") {
        this.boostT = 2.2;
        this.invuln = Math.max(this.invuln, 2.2);
        sfxBoost();
        this.pop(x, y, "BOOST");
        this.burst(x, y, 16, "star", "#fff3a0");
      } else {
        this.wings = Math.min(3, this.wings + 1);
        sfxPower();
        this.pop(x, y, "WING");
        this.burst(x, y, 12, "feather", "#ffe27a");
      }
      this.persist();
      this.hudDirty = true;
      this.buzz(18);
    }

    collide() {
      const b = this.bird;
      // Ceiling clamp
      if (b.y - BIRD_R < 40) {
        b.y = 40 + BIRD_R;
        if (b.vy < 0) b.vy = 0;
      }

      // Ground
      if (b.y + BIRD_R > this.groundY) {
        if (this.invuln > 0) {
          // Still invulnerable — keep bird above ground
          b.y = this.groundY - BIRD_R - 1;
          if (b.vy > 0) b.vy = FLAP_V * 0.55;
          return;
        }
        this.tryDie("ground");
        return;
      }

      // Pipes
      for (const p of this.pipes) {
        if (b.x + BIRD_R < p.x || b.x - BIRD_R > p.x + p.w) continue;
        const top = p.gapY - p.gap / 2;
        const bot = p.gapY + p.gap / 2;
        if (b.y - BIRD_R < top || b.y + BIRD_R > bot) {
          if (this.invuln > 0) {
            // Push bird into the gap center while invulnerable
            b.y = p.gapY;
            if (b.vy > 120) b.vy = 0;
            return;
          }
          this.tryDie("pipe", p);
          return;
        }
      }
    }

    tryDie(reason, pipe) {
      if (this.invuln > 0) return;
      if (this.shield) {
        // Absorb hit — break shield, grant invuln, eject from hazard
        this.shield = false;
        this.invuln = 1.25;
        this.flash = 0.55;
        this.trauma = 0.45;
        sfxPower();
        this.burst(this.bird.x, this.bird.y, 18, "ring", "#8ec5ff");
        this.buzz(25);

        if (reason === "ground") {
          this.bird.y = this.groundY - BIRD_R - 2;
          this.bird.vy = FLAP_V * 0.65;
        } else if (reason === "pipe" && pipe) {
          // Nudge into the safe gap
          this.bird.y = pipe.gapY;
          this.bird.vy = Math.min(this.bird.vy, 40);
        } else {
          this.bird.vy = FLAP_V * 0.5;
        }

        this.hudDirty = true;
        this.emitHud();
        return;
      }
      this.die();
    }

    die() {
      if (this.phase === "dead") return;
      this.phase = "dead";
      this.bird.alive = false;
      this.bird.vy = -180;
      this.deathLock = 0.7;
      this.flash = 0.85;
      this.trauma = 0.9;
      this.hitstop = 0.08;
      stopMusic();
      sfxCrash();
      this.buzz(40);
      this.burst(this.bird.x, this.bird.y, 22, "feather", "#fbbf24");
      this.burst(this.bird.x, this.bird.y, 14, "puff", "#fff");

      if (this.score > this.save.best) {
        this.save.best = this.score;
        this.newBest = true;
      }
      this.persist();
      this.hudDirty = true;
      this.emitHud();
    }

    burst(x, y, n, kind, color) {
      if (this.reduced) n = Math.min(n, 6);
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = rand(40, 220);
        this.particles.push({
          x, y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 40,
          life: rand(0.35, 0.75),
          max: rand(0.35, 0.75),
          size: rand(2, 6),
          color,
          kind,
        });
      }
    }

    pop(x, y, text) {
      this.pops.push({ x, y, text, life: 0.7, max: 0.7 });
    }

    stepParticles(dt) {
      for (const p of this.particles) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 280 * dt;
        p.vx *= 0.98;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
    }

    stepPops(dt) {
      for (const p of this.pops) p.life -= dt;
      this.pops = this.pops.filter((p) => p.life > 0);
    }

    render() {
      let shakeX = 0, shakeY = 0;
      if (this.save.shake && this.trauma > 0 && !this.reduced) {
        const mag = this.trauma * this.trauma * 14;
        shakeX = (Math.random() - 0.5) * mag;
        shakeY = (Math.random() - 0.5) * mag;
      }
      drawWorld(this.ctx, {
        w: this.w,
        h: this.h,
        t: this.t,
        skyT: this.skyT,
        scroll: this.scroll,
        bird: this.bird,
        pipes: this.pipes,
        pickups: this.pickups,
        particles: this.particles,
        pops: this.pops,
        clouds: this.clouds,
        groundY: this.groundY,
        shakeX,
        shakeY,
        flash: this.flash,
        boostT: this.boostT,
        shield: this.shield,
        invuln: this.invuln,
        phase: this.phase,
        reduced: this.reduced,
      });
    }
  }

  // ---------- UI wiring ----------
  const canvas = document.getElementById("c");
  const $ = (id) => document.getElementById(id);

  const els = {
    topHud: $("topHud"),
    scoreNum: $("scoreNum"),
    bestNum: $("bestNum"),
    powerRow: $("powerRow"),
    meterFill: $("meterFill"),
    hint: $("hint"),
    menuPanel: $("menuPanel"),
    pausePanel: $("pausePanel"),
    deadPanel: $("deadPanel"),
    newBestBadge: $("newBestBadge"),
    deadScore: $("deadScore"),
    deadBest: $("deadBest"),
    deadCoins: $("deadCoins"),
    menuBest: $("menuBest"),
    menuCoins: $("menuCoins"),
    settings: $("settings"),
    muteIcon: $("muteIcon"),
    togMute: $("togMute"),
    togHaptics: $("togHaptics"),
    togShake: $("togShake"),
  };

  let game = null;
  let lastHud = null;

  function onHud(hud) {
    lastHud = hud;
    const playing = hud.phase === "playing" || hud.phase === "ready";
    const showMenu = hud.phase === "menu";
    const showPause = hud.phase === "paused";
    const showDead = hud.phase === "dead";

    els.topHud.classList.toggle("hidden", !(playing || showPause));
    els.menuPanel.classList.toggle("hidden", !showMenu);
    els.pausePanel.classList.toggle("hidden", !showPause);
    els.deadPanel.classList.toggle("hidden", !showDead);
    els.hint.classList.toggle("hidden", !hud.showHint);

    els.scoreNum.textContent = String(hud.score);
    els.bestNum.textContent = String(hud.best);
    els.menuBest.textContent = String(hud.best);
    els.menuCoins.textContent = String(hud.coins);
    els.deadScore.textContent = String(hud.score);
    els.deadBest.textContent = String(hud.best);
    els.deadCoins.textContent = String(hud.runCoins);
    els.newBestBadge.classList.toggle("hidden", !hud.newBest);
    els.meterFill.style.width = Math.round(hud.meter * 100) + "%";

    // Power pills
    let pills = "";
    if (hud.shield) pills += `<span class="pill shield">🛡 Shield</span>`;
    if (hud.boostT > 0) pills += `<span class="pill boost">⚡ Boost</span>`;
    if (hud.wings > 0) pills += `<span class="pill wing">🪶 ×${hud.wings}</span>`;
    if (hud.runCoins > 0) pills += `<span class="pill coins">🪙 ${hud.runCoins}</span>`;
    els.powerRow.innerHTML = pills;

    // Mute icon
    els.muteIcon.innerHTML = hud.muted
      ? `<path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2"/>`
      : `<path d="M11 5 6 9H2v6h4l5 4V5zm7.07 2.93a8 8 0 0 1 0 8.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;

    // Toggles
    els.togMute.classList.toggle("on", !hud.muted);
    els.togHaptics.classList.toggle("on", hud.haptics);
    els.togShake.classList.toggle("on", hud.shake);
  }

  // Buttons
  $("btnPlay").addEventListener("click", () => game && game.playFromMenu());
  $("btnResume").addEventListener("click", () => game && game.resume());
  $("btnRetry").addEventListener("click", () => game && game.retry());
  $("btnHomeFromPause").addEventListener("click", () => game && game.home());
  $("btnHomeFromDead").addEventListener("click", () => game && game.home());
  $("btnPause").addEventListener("click", () => game && game.pause());
  $("btnMute").addEventListener("click", () => game && game.toggleMute());
  $("btnSettings").addEventListener("click", () => {
    els.settings.classList.remove("hidden");
  });
  $("btnCloseSettings").addEventListener("click", () => {
    els.settings.classList.add("hidden");
  });
  els.settings.addEventListener("click", (e) => {
    if (e.target === els.settings) els.settings.classList.add("hidden");
  });

  els.togMute.addEventListener("click", () => game && game.toggleMute());
  els.togHaptics.addEventListener("click", () => game && game.toggleHaptics());
  els.togShake.addEventListener("click", () => game && game.toggleShake());

  // Mark UI elements so canvas pointer ignores them
  document.querySelectorAll("button, .panel, .settings").forEach((el) => {
    el.setAttribute("data-ui", "1");
  });

  // Boot
  game = new ChirpGame(canvas, onHud);
  game.start();
  window.__chirp = game;
})();
