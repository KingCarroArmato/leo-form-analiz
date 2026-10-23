// İskelet tekrar oynatıcı. Video varsa üzerine çizer; yoksa yalnızca iskeleti gösterir.
// 3B (LiDAR) kayıtları "kamera görünümü" veya "üstten görünüm" ile çizilir.

import { icon } from './icons.js';

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function project3D(skel, mode) {
  const f = skel.camFwd || [0, 0, -1];
  const fh = Math.hypot(f[0], f[2]) || 1;
  const fwd = [f[0] / fh, 0, f[2] / fh];
  const right = [-fwd[2], 0, fwd[0]]; // fwd × yukarı
  return (p) => (mode === 'top'
    ? [p[0] * right[0] + p[2] * right[2], p[0] * fwd[0] + p[2] * fwd[2]]
    : [p[0] * right[0] + p[2] * right[2], -p[1]]);
}

/**
 * @param {HTMLElement} host
 * @param {object} skel compactSkeleton2D/3D çıktısı
 * @param {object} opts {videoUrl?, events?: [{t,label}]}
 */
export function mountReplay(host, skel, opts = {}) {
  host.innerHTML = '';
  host.classList.add('replay');
  const is3d = skel.kind === '3d';
  const idx = Object.fromEntries(skel.names.map((n, i) => [n, i]));
  const frames = skel.frames;
  const dur = (frames.length && Number(frames[frames.length - 1][0])) || 0;
  let view = 'cam';

  const stage = document.createElement('div');
  stage.className = 'replay-stage';
  let video = null;
  if (opts.videoUrl && !is3d) {
    video = document.createElement('video');
    video.src = opts.videoUrl;
    video.playsInline = true;
    video.muted = true;
    video.preload = 'auto';
    stage.append(video);
  }
  const canvas = document.createElement('canvas');
  stage.append(canvas);
  host.append(stage);

  const ctrl = document.createElement('div');
  ctrl.className = 'replay-ctrl';
  ctrl.innerHTML = `
    <div class="replay-row">
      <button class="btn play" data-act="play" aria-label="Oynat">${icon('play', 18)}</button>
      <input type="range" min="0" max="${dur}" step="0.001" value="0" aria-label="Zaman">
      <span class="replay-time">0,00 sn</span>
    </div>
    <div class="replay-row end">
      <label>Hız <select data-act="speed"><option value="1">1×</option><option value="0.5">0,5×</option><option value="0.25" selected>0,25×</option></select></label>
      ${is3d ? '<label>Görünüm <select data-act="view"><option value="cam">Kamera</option><option value="top">Üstten</option></select></label>' : ''}
    </div>`;
  host.append(ctrl);
  const [btn, range, speedSel] = [ctrl.querySelector('[data-act=play]'), ctrl.querySelector('input'), ctrl.querySelector('[data-act=speed]')];
  const timeEl = ctrl.querySelector('.replay-time');

  // Görüntü alanı
  let proj, bounds;
  const computeBounds = () => {
    if (!is3d) {
      proj = (p) => p;
      bounds = { x0: 0, y0: 0, x1: skel.width, y1: skel.height };
      return;
    }
    proj = project3D(skel, view);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [, pts] of frames) {
      if (!pts) continue;
      for (const p of pts) {
        if (!p) continue;
        const [x, y] = proj(p);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    const m = 0.15 * Math.max(x1 - x0, y1 - y0, 0.5);
    bounds = { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
  };
  computeBounds();
  const aspect = () => (bounds.x1 - bounds.x0) / (bounds.y1 - bounds.y0);
  const sizeStage = () => {
    const a = video ? video.videoWidth / video.videoHeight || aspect() : aspect();
    stage.style.aspectRatio = String(a);
  };
  sizeStage();
  video?.addEventListener('loadedmetadata', sizeStage);

  const frameAt = (t) => {
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (frames[m][0] < t) lo = m + 1; else hi = m; }
    if (lo > 0 && Math.abs(frames[lo - 1][0] - t) < Math.abs(frames[lo][0] - t)) lo--;
    return frames[lo];
  };

  const draw = (t) => {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!video) { ctx.fillStyle = cssVar('--replay-bg') || '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    const sx = canvas.width / (bounds.x1 - bounds.x0);
    const sy = canvas.height / (bounds.y1 - bounds.y0);
    const s = Math.min(sx, sy);
    const ox = (canvas.width - s * (bounds.x1 - bounds.x0)) / 2;
    const oy = (canvas.height - s * (bounds.y1 - bounds.y0)) / 2;
    const P = (p) => { const [x, y] = proj(p); return [ox + (x - bounds.x0) * s, oy + (y - bounds.y0) * s]; };

    if (is3d && view === 'top') {
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.lineWidth = 1;
      const step = 0.5 * s;
      for (let x = ox % step; x < canvas.width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
      for (let y = oy % step; y < canvas.height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
    }
    const f = frameAt(t);
    if (!f || !f[1]) return;
    const pts = f[1];
    const lw = Math.max(2, canvas.width / 160);
    ctx.lineCap = 'round';
    for (const [a, b] of skel.bones) {
      const pa = pts[idx[a]], pb = pts[idx[b]];
      if (!pa || !pb) continue;
      // "lHip" sol, "rHip" sağ; "root" gibi orta hat eklemleri beyaz
      const sideOf = (n) => (n[1] && n[1] === n[1].toUpperCase() && n[1] !== n[1].toLowerCase() ? n[0] : 'c');
      const side = sideOf(a) === sideOf(b) ? sideOf(a) : 'c';
      ctx.strokeStyle = side === 'l' ? '#ff3d7a' : side === 'r' ? '#7cc4ff' : '#f8fafc';
      ctx.lineWidth = lw;
      const [x1, y1] = P(pa), [x2, y2] = P(pb);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.fillStyle = '#f8fafc';
    for (const p of pts) {
      if (!p) continue;
      const [x, y] = P(p);
      ctx.beginPath(); ctx.arc(x, y, lw * 0.9, 0, Math.PI * 2); ctx.fill();
    }
  };

  let playing = false, t = 0, last = 0, raf = 0;
  const setT = (v) => {
    t = Math.max(0, Math.min(dur, v));
    range.value = t;
    timeEl.textContent = `${t.toFixed(2).replace('.', ',')} sn`;
    draw(t);
  };
  const loop = (now) => {
    if (!playing) return;
    if (video) {
      setT(video.currentTime - (opts.videoOffset || 0));
      if (video.ended || video.currentTime - (opts.videoOffset || 0) >= dur) { stop(); return; }
    } else {
      const sp = Number(speedSel.value);
      setT(t + ((now - last) / 1000) * sp);
      last = now;
      if (t >= dur) { stop(); return; }
    }
    raf = requestAnimationFrame(loop);
  };
  const stop = () => { playing = false; btn.innerHTML = icon('play', 18); btn.setAttribute('aria-label', 'Oynat'); video?.pause(); cancelAnimationFrame(raf); };
  const play = () => {
    if (t >= dur) setT(0);
    playing = true;
    btn.innerHTML = icon('pause', 18); btn.setAttribute('aria-label', 'Duraklat');
    last = performance.now();
    if (video) {
      video.playbackRate = Number(speedSel.value);
      video.currentTime = t + (opts.videoOffset || 0);
      video.play().catch(() => {});
    }
    raf = requestAnimationFrame(loop);
  };
  btn.addEventListener('click', () => (playing ? stop() : play()));
  range.addEventListener('input', () => {
    stop();
    setT(Number(range.value));
    if (video) video.currentTime = t + (opts.videoOffset || 0);
  });
  speedSel.addEventListener('change', () => { if (video) video.playbackRate = Number(speedSel.value); });
  ctrl.querySelector('[data-act=view]')?.addEventListener('change', (e) => { view = e.target.value; computeBounds(); sizeStage(); draw(t); });
  if (video) video.addEventListener('seeked', () => { if (!playing) draw(t); });

  new ResizeObserver(() => draw(t)).observe(stage);
  requestAnimationFrame(() => setT(opts.startAt ?? 0));
  return { seek: (v) => { stop(); setT(v); if (video) video.currentTime = v + (opts.videoOffset || 0); } };
}
