(() => {
  "use strict";

  // ========== CONFIG ==========
  const CONFIG = {
    gravity: 0.45,
    flapImpulse: -8.2,
    pipeWidth: 72,
    pipeGapBase: 168,
    pipeGapMin: 132,
    pipeSpeedBase: 2.6,
    pipeSpeedMax: 5.8,
    pipeSpawnInterval: 1600, // ms
    groundHeight: 96,
    birdSize: 42,
    particleCount: 10,
    maxParticles: 80,
  };

  // ========== STATE ==========
  let canvas, ctx;
  let width, height, dpr;
  let state = "start"; // start | playing | paused | gameover
  let score = 0;
  let bestScore = 0;
  let pipes = [];
  let particles = [];
  let bird = null;
  let lastTime = 0;
  let spawnTimer = 0;
  let speed = CONFIG.pipeSpeedBase;
  let gap = CONFIG.pipeGapBase;
  let frame = 0;
  let shake = 0;
  let skyPhase = 0; // 0..1 for day-night cycle
  let audioCtx = null;
  let tutorialShown = false;

  // ========== DOM ==========
  const $ = (id) => document.getElementById(id);
  const scoreEl = $("score-display");
  const bestEl = $("best-score");
  const finalScoreEl = $("final-score");
  const finalBestEl = $("final-best");
  const startScreen = $("start-screen");
  const gameoverScreen = $("gameover-screen");
  const pauseScreen = $("pause-screen");
  const pauseBtn = $("pause-btn");

  // ========== INIT ==========
  function init() {
    canvas = $("gameCanvas");
    ctx = canvas.getContext("2d", { alpha: false });

    loadBest();
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", () => setTimeout(resize, 100));

    // Input – one-tap everywhere
    const handleTap = (e) => {
      e.preventDefault();
      if (state === "playing") {
        flap();
      } else if (state === "start") {
        // handled by button mostly
      }
    };

    canvas.addEventListener("pointerdown", handleTap, { passive: false });
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        if (state === "playing") flap();
        else if (state === "start") startGame();
        else if (state === "gameover") restartGame();
      }
    });

    // Buttons
    $("start-btn").addEventListener("click", startGame);
    $("restart-btn").addEventListener("click", restartGame);
    $("home-btn").addEventListener("click", goHome);
    $("resume-btn").addEventListener("click", resumeGame);
    $("pause-home-btn").addEventListener("click", goHome);
    pauseBtn.addEventListener("click", pauseGame);

    // Prevent scrolling / zoom
    document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

    requestAnimationFrame(loop);
  }

  function resize() {
    const container = $("game-container");
    const rect = container.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    width = rect.width;
    height = rect.height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ========== BIRD ==========
  function createBird() {
    return {
      x: width * 0.28,
      y: height * 0.42,
      vy: 0,
      rotation: 0,
      wingPhase: 0,
      alive: true,
    };
  }

  function flap() {
    if (!bird || !bird.alive) return;
    bird.vy = CONFIG.flapImpulse;
    bird.wingPhase = 0;
    spawnParticles(bird.x + 8, bird.y + 6, 6, "#FFD54F", 1.8);
    playTone(520, 0.06, "sine", 0.08);
    if (navigator.vibrate) navigator.vibrate(8);
  }

  // ========== PIPES ==========
  function spawnPipe() {
    const minTop = 70;
    const maxTop = height - CONFIG.groundHeight - gap - 70;
    const topHeight = minTop + Math.random() * (maxTop - minTop);
    pipes.push({
      x: width + 20,
      top: topHeight,
      bottom: topHeight + gap,
      scored: false,
      width: CONFIG.pipeWidth,
    });
  }

  // ========== PARTICLES ==========
  function spawnParticles(x, y, count, color, speedMul = 1) {
    for (let i = 0; i < count; i++) {
      if (particles.length >= CONFIG.maxParticles) particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const spd = (1.2 + Math.random() * 2.5) * speedMul;
      particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 1,
        life: 1,
        decay: 0.018 + Math.random() * 0.02,
        size: 2 + Math.random() * 3.5,
        color,
      });
    }
  }

  // ========== AUDIO (simple Web Audio beeps) ==========
  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function playTone(freq, duration, type = "sine", volume = 0.1) {
    try {
      ensureAudio();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (_) {}
  }

  function playScore() {
    playTone(880, 0.08, "sine", 0.09);
    setTimeout(() => playTone(1175, 0.1, "sine", 0.07), 70);
  }

  function playCrash() {
    playTone(180, 0.25, "sawtooth", 0.12);
    if (navigator.vibrate) navigator.vibrate([30, 40, 50]);
  }

  // ========== GAME FLOW ==========
  function startGame() {
    ensureAudio();
    state = "playing";
    score = 0;
    pipes = [];
    particles = [];
    bird = createBird();
    speed = CONFIG.pipeSpeedBase;
    gap = CONFIG.pipeGapBase;
    spawnTimer = 600;
    frame = 0;
    shake = 0;
    scoreEl.textContent = "0";
    startScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    pauseScreen.classList.add("hidden");
    pauseBtn.classList.remove("hidden");
  }

  function restartGame() {
    startGame();
  }

  function goHome() {
    state = "start";
    bird = null;
    pipes = [];
    particles = [];
    startScreen.classList.remove("hidden");
    gameoverScreen.classList.add("hidden");
    pauseScreen.classList.add("hidden");
    pauseBtn.classList.add("hidden");
  }

  function pauseGame() {
    if (state !== "playing") return;
    state = "paused";
    pauseScreen.classList.remove("hidden");
  }

  function resumeGame() {
    if (state !== "paused") return;
    state = "playing";
    pauseScreen.classList.add("hidden");
    lastTime = performance.now();
  }

  function gameOver() {
    if (state !== "playing") return;
    state = "gameover";
    bird.alive = false;
    playCrash();
    shake = 12;
    spawnParticles(bird.x, bird.y, 18, "#FF7043", 2.5);
    spawnParticles(bird.x, bird.y, 10, "#FFD54F", 1.8);

    if (score > bestScore) {
      bestScore = score;
      saveBest();
    }
    finalScoreEl.textContent = score;
    finalBestEl.textContent = bestScore;
    bestEl.textContent = bestScore;

    pauseBtn.classList.add("hidden");
    setTimeout(() => {
      gameoverScreen.classList.remove("hidden");
    }, 420);
  }

  // ========== STORAGE ==========
  function loadBest() {
    try {
      bestScore = parseInt(localStorage.getItem("flappy2025_best") || "0", 10);
    } catch (_) {
      bestScore = 0;
    }
    bestEl.textContent = bestScore;
  }

  function saveBest() {
    try {
      localStorage.setItem("flappy2025_best", String(bestScore));
    } catch (_) {}
  }

  // ========== UPDATE ==========
  function update(dt) {
    if (state !== "playing" || !bird) return;

    // Difficulty ramp
    const progress = Math.min(score / 40, 1);
    speed = CONFIG.pipeSpeedBase + (CONFIG.pipeSpeedMax - CONFIG.pipeSpeedBase) * progress;
    gap = CONFIG.pipeGapBase - (CONFIG.pipeGapBase - CONFIG.pipeGapMin) * progress;

    // Bird physics
    bird.vy += CONFIG.gravity;
    bird.y += bird.vy;
    bird.rotation = Math.max(-0.6, Math.min(1.1, bird.vy * 0.07));
    bird.wingPhase += 0.35;

    // Spawn pipes
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnPipe();
      spawnTimer = CONFIG.pipeSpawnInterval - progress * 350;
    }

    // Move pipes & score
    for (let i = pipes.length - 1; i >= 0; i--) {
      const p = pipes[i];
      p.x -= speed;

      // Score
      if (!p.scored && p.x + p.width < bird.x) {
        p.scored = true;
        score++;
        scoreEl.textContent = score;
        playScore();
        spawnParticles(bird.x + 20, bird.y, 8, "#81C784", 1.4);
      }

      // Remove off-screen
      if (p.x + p.width < -20) {
        pipes.splice(i, 1);
      }
    }

    // Collision
    checkCollisions();

    // Sky cycle (slow)
    skyPhase = (skyPhase + dt * 0.000015) % 1;

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vy += 0.08;
      pt.life -= pt.decay;
      if (pt.life <= 0) particles.splice(i, 1);
    }

    // Screen shake decay
    if (shake > 0) shake *= 0.88;
  }

  function checkCollisions() {
    const b = bird;
    const r = CONFIG.birdSize * 0.38; // hit radius

    // Ground / ceiling
    if (b.y + r > height - CONFIG.groundHeight || b.y - r < 0) {
      gameOver();
      return;
    }

    // Pipes
    for (const p of pipes) {
      if (b.x + r > p.x && b.x - r < p.x + p.width) {
        if (b.y - r < p.top || b.y + r > p.bottom) {
          gameOver();
          return;
        }
      }
    }
  }

  // ========== DRAW ==========
  function draw() {
    // Shake offset
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    ctx.save();
    ctx.translate(sx, sy);

    drawSky();
    drawClouds();
    drawCity();
    drawPipes();
    drawGround();
    if (bird) drawBird();
    drawParticles();

    ctx.restore();
  }

  function drawSky() {
    // Soft day → dusk → night → dawn cycle
    const t = skyPhase;
    let top, mid, bot;
    if (t < 0.25) {
      // day
      top = "#87CEEB"; mid = "#E0F7FA"; bot = "#B2EBF2";
    } else if (t < 0.4) {
      const k = (t - 0.25) / 0.15;
      top = lerpColor("#87CEEB", "#FF8A65", k);
      mid = lerpColor("#E0F7FA", "#FFCCBC", k);
      bot = lerpColor("#B2EBF2", "#FFAB91", k);
    } else if (t < 0.55) {
      const k = (t - 0.4) / 0.15;
      top = lerpColor("#FF8A65", "#1A237E", k);
      mid = lerpColor("#FFCCBC", "#3949AB", k);
      bot = lerpColor("#FFAB91", "#5C6BC0", k);
    } else if (t < 0.7) {
      top = "#0D1B2A"; mid = "#1B263B"; bot = "#415A77";
    } else if (t < 0.85) {
      const k = (t - 0.7) / 0.15;
      top = lerpColor("#0D1B2A", "#FF8A65", k);
      mid = lerpColor("#1B263B", "#FFCCBC", k);
      bot = lerpColor("#415A77", "#FFAB91", k);
    } else {
      const k = (t - 0.85) / 0.15;
      top = lerpColor("#FF8A65", "#87CEEB", k);
      mid = lerpColor("#FFCCBC", "#E0F7FA", k);
      bot = lerpColor("#FFAB91", "#B2EBF2", k);
    }

    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, top);
    g.addColorStop(0.55, mid);
    g.addColorStop(1, bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    // Soft rainbow accent (subtle)
    if (t < 0.35 || t > 0.9) {
      ctx.save();
      ctx.globalAlpha = 0.18;
      const rg = ctx.createLinearGradient(width * 0.6, height * 0.15, width, height * 0.55);
      rg.addColorStop(0, "transparent");
      rg.addColorStop(0.3, "#FF8A80");
      rg.addColorStop(0.5, "#FFD54F");
      rg.addColorStop(0.7, "#81C784");
      rg.addColorStop(0.9, "#64B5F6");
      rg.addColorStop(1, "transparent");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, width, height * 0.7);
      ctx.restore();
    }
  }

  function lerpColor(a, b, t) {
    const pa = hexToRgb(a), pb = hexToRgb(b);
    const r = Math.round(pa.r + (pb.r - pa.r) * t);
    const g = Math.round(pa.g + (pb.g - pa.g) * t);
    const bl = Math.round(pa.b + (pb.b - pa.b) * t);
    return `rgb(${r},${g},${bl})`;
  }

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  }

  function drawClouds() {
    ctx.save();
    ctx.globalAlpha = 0.55;
    const cloudY = [height * 0.12, height * 0.22, height * 0.08];
    const cloudX = [
      (frame * 0.15) % (width + 200) - 100,
      (frame * 0.09 + 180) % (width + 250) - 80,
      (frame * 0.12 + 320) % (width + 180) - 60,
    ];
    cloudX.forEach((x, i) => {
      drawCloud(x, cloudY[i], 38 + i * 8);
    });
    ctx.restore();
  }

  function drawCloud(x, y, s) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y, s * 0.55, 0, Math.PI * 2);
    ctx.arc(x + s * 0.45, y - s * 0.15, s * 0.45, 0, Math.PI * 2);
    ctx.arc(x + s * 0.9, y, s * 0.5, 0, Math.PI * 2);
    ctx.arc(x + s * 0.4, y + s * 0.2, s * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCity() {
    const baseY = height - CONFIG.groundHeight;
    ctx.save();
    ctx.globalAlpha = 0.35;
    // Simple stylized skyline
    const buildings = [
      [0.05, 0.28], [0.12, 0.42], [0.19, 0.22], [0.26, 0.55],
      [0.34, 0.33], [0.42, 0.48], [0.50, 0.25], [0.58, 0.60],
      [0.66, 0.38], [0.74, 0.50], [0.82, 0.30], [0.90, 0.45],
    ];
    buildings.forEach(([rx, rh], i) => {
      const bw = width * 0.07;
      const bh = (baseY - 40) * rh;
      const bx = width * rx;
      ctx.fillStyle = i % 3 === 0 ? "#5C6BC0" : i % 2 === 0 ? "#7986CB" : "#9FA8DA";
      ctx.fillRect(bx, baseY - bh, bw, bh);
      // windows
      ctx.fillStyle = "rgba(255,255,200,0.25)";
      for (let wy = baseY - bh + 8; wy < baseY - 10; wy += 12) {
        for (let wx = bx + 4; wx < bx + bw - 4; wx += 10) {
          if (Math.random() > 0.4) ctx.fillRect(wx, wy, 4, 5);
        }
      }
    });
    ctx.restore();
  }

  function drawPipes() {
    for (const p of pipes) {
      drawPipe(p.x, 0, p.width, p.top, true);
      drawPipe(p.x, p.bottom, p.width, height - p.bottom - CONFIG.groundHeight, false);
    }
  }

  function drawPipe(x, y, w, h, isTop) {
    // Glow
    ctx.save();
    ctx.shadowColor = "#00E676";
    ctx.shadowBlur = 14;

    // Main body gradient
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#00C853");
    g.addColorStop(0.3, "#69F0AE");
    g.addColorStop(0.7, "#00E676");
    g.addColorStop(1, "#00B248");
    ctx.fillStyle = g;

    // Cap
    const capH = 28;
    const capExtra = 8;
    if (isTop) {
      ctx.fillRect(x, y, w, h - capH);
      // Cap rim
      ctx.fillStyle = "#00E676";
      ctx.fillRect(x - capExtra, y + h - capH, w + capExtra * 2, capH);
      // Highlight
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(x + 6, y, 10, h - capH);
    } else {
      ctx.fillRect(x, y + capH, w, h - capH);
      ctx.fillStyle = "#00E676";
      ctx.fillRect(x - capExtra, y, w + capExtra * 2, capH);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(x + 6, y + capH, 10, h - capH);
    }

    // Soft neon edge
    ctx.strokeStyle = "rgba(0, 230, 118, 0.6)";
    ctx.lineWidth = 2;
    if (isTop) {
      ctx.strokeRect(x - capExtra, y + h - capH, w + capExtra * 2, capH);
    } else {
      ctx.strokeRect(x - capExtra, y, w + capExtra * 2, capH);
    }

    ctx.restore();
  }

  function drawGround() {
    const gy = height - CONFIG.groundHeight;
    // Grass strip
    const g = ctx.createLinearGradient(0, gy, 0, height);
    g.addColorStop(0, "#66BB6A");
    g.addColorStop(0.15, "#43A047");
    g.addColorStop(1, "#2E7D32");
    ctx.fillStyle = g;
    ctx.fillRect(0, gy, width, CONFIG.groundHeight);

    // Decorative bumps
    ctx.fillStyle = "#81C784";
    for (let i = 0; i < width; i += 28) {
      ctx.beginPath();
      ctx.ellipse(i + 14, gy + 6, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBird() {
    const b = bird;
    const s = CONFIG.birdSize;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rotation);

    // Soft shadow
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.ellipse(4, s * 0.35, s * 0.4, s * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    const bodyG = ctx.createRadialGradient(-4, -6, 2, 0, 0, s * 0.55);
    bodyG.addColorStop(0, "#FFF59D");
    bodyG.addColorStop(0.6, "#FFEE58");
    bodyG.addColorStop(1, "#FDD835");
    ctx.fillStyle = bodyG;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.48, s * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wing (animated)
    const wingAngle = Math.sin(b.wingPhase) * 0.55 - 0.2;
    ctx.save();
    ctx.translate(-4, 2);
    ctx.rotate(wingAngle);
    ctx.fillStyle = "#FFD54F";
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.32, s * 0.18, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#FFCA28";
    ctx.beginPath();
    ctx.ellipse(-2, 2, s * 0.22, s * 0.12, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Cheek
    ctx.fillStyle = "rgba(255, 138, 128, 0.55)";
    ctx.beginPath();
    ctx.ellipse(10, 6, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eye white
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(12, -6, 9, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pupil
    ctx.fillStyle = "#1A237E";
    ctx.beginPath();
    ctx.arc(14, -5, 5, 0, Math.PI * 2);
    ctx.fill();

    // Eye shine
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(16, -7, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Beak
    ctx.fillStyle = "#FF8A65";
    ctx.beginPath();
    ctx.moveTo(18, 2);
    ctx.lineTo(30, 6);
    ctx.lineTo(18, 11);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#FF7043";
    ctx.beginPath();
    ctx.moveTo(18, 6);
    ctx.lineTo(28, 7);
    ctx.lineTo(18, 11);
    ctx.closePath();
    ctx.fill();

    // Tuft
    ctx.fillStyle = "#FBC02D";
    ctx.beginPath();
    ctx.moveTo(-6, -16);
    ctx.quadraticCurveTo(-2, -26, 4, -18);
    ctx.quadraticCurveTo(0, -20, -6, -16);
    ctx.fill();

    ctx.restore();
  }

  function drawParticles() {
    for (const pt of particles) {
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * pt.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ========== LOOP ==========
  function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = Math.min(timestamp - lastTime, 32); // cap
    lastTime = timestamp;
    frame++;

    if (state === "playing") {
      update(dt);
    } else if (state === "start" || state === "gameover") {
      // Idle bird float for preview
      if (!bird) bird = createBird();
      bird.y = height * 0.42 + Math.sin(frame * 0.04) * 12;
      bird.wingPhase += 0.12;
      bird.rotation = Math.sin(frame * 0.04) * 0.08;
    }

    draw();
    requestAnimationFrame(loop);
  }

  // Boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
