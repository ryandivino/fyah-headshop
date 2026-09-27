(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.id = "smoke-canvas";
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999;";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  function resize() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  const COLORS = ["200,200,195", "160,160,155", "230,230,225"]; // tons de cinza-fumaça
  const MAX_PARTICLES = 90; // teto pra não pesar em aparelhos mais fracos
  let particles = [];
  let lastSpawn = 0;
  const SPAWN_INTERVAL = 28; // ms entre partículas — controla densidade do rastro

  function spawn(x, y) {
    if (particles.length >= MAX_PARTICLES) return;
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.6 - Math.random() * 0.6,
      size: 6 + Math.random() * 10,
      alpha: 0.5 + Math.random() * 0.25,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 0,
      maxLife: 40 + Math.random() * 30
    });
  }

  function onMove(e) {
    const now = performance.now();
    if (now - lastSpawn < SPAWN_INTERVAL) return;
    lastSpawn = now;
    const x = e.clientX ?? (e.touches && e.touches[0] && e.touches[0].clientX);
    const y = e.clientY ?? (e.touches && e.touches[0] && e.touches[0].clientY);
    if (x == null || y == null) return;
    spawn(x, y);
  }

  document.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: true });

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter(p => p.life < p.maxLife);
    for (const p of particles) {
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      p.size += 0.25;
      const progress = p.life / p.maxLife;
      const alpha = p.alpha * (1 - progress);

      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      grad.addColorStop(0, `rgba(${p.color},${alpha})`);
      grad.addColorStop(1, `rgba(${p.color},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(tick);
  }
  tick();
})();