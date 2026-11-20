// Basit, bağımlılıksız SVG çizgi grafikleri.

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};
const fmt = (v) => ((Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + 0).toLocaleString('tr-TR');

function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

/**
 * Zaman serisi grafiği.
 * opts: {t:[], series:[{name, v:[]}], marks:[{t,label}], points?: bool, xFormat?: fn, xTicks?: [], refLines?: [{v, label}], width?}
 */
export function lineChart(opts) {
  // Yazıların her ekranda aynı boyutta görünmesi için kutunun gerçek genişliğiyle çizilir
  const W = Math.max(280, Math.round(opts.width || 640));
  const H = Math.round(Math.min(260, Math.max(160, W * 0.42)));
  const L = 40, R = 10, T = 14, B = 26;
  const nx = Math.max(3, Math.floor(W / 110));
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  const xs = opts.t;
  const all = opts.series.flatMap((s) => s.v).filter((v) => v != null);
  if (!xs.length || !all.length) return svg;
  let ylo = Math.min(...all), yhi = Math.max(...all);
  for (const r of opts.refLines || []) { ylo = Math.min(ylo, r.v); yhi = Math.max(yhi, r.v); }
  const pad = (yhi - ylo || Math.abs(yhi) || 1) * 0.08;
  ylo -= pad; yhi += pad;
  const xlo = xs[0], xhi = xs[xs.length - 1] === xs[0] ? xs[0] + 1 : xs[xs.length - 1];
  const X = (v) => L + ((v - xlo) / (xhi - xlo)) * (W - L - R);
  const Y = (v) => T + (1 - (v - ylo) / (yhi - ylo)) * (H - T - B);

  for (const tv of niceTicks(ylo, yhi)) {
    svg.append(el('line', { x1: L, x2: W - R, y1: Y(tv), y2: Y(tv), class: 'grid' }));
    svg.append(el('text', { x: L - 6, y: Y(tv) + 4, class: 'tick', 'text-anchor': 'end' }, fmt(tv)));
  }
  const xticks = opts.xTicks || niceTicks(xlo, xhi, nx);
  for (const tv of xticks) {
    const x = X(tv);
    // kenardaki etiketler kesilmesin
    const anchor = x < L + 30 ? 'start' : x > W - R - 30 ? 'end' : 'middle';
    svg.append(el('text', { x, y: H - 8, class: 'tick', 'text-anchor': anchor }, opts.xFormat ? opts.xFormat(tv) : `${fmt(tv)} sn`));
  }
  for (const r of opts.refLines || []) {
    svg.append(el('line', { x1: L, x2: W - R, y1: Y(r.v), y2: Y(r.v), class: 'ref-line' }));
    svg.append(el('text', { x: W - R - 2, y: Y(r.v) - 4, class: 'ref-label', 'text-anchor': 'end' }, r.label));
  }
  for (const m of opts.marks || []) {
    if (m.t < xlo || m.t > xhi) continue;
    svg.append(el('line', { x1: X(m.t), x2: X(m.t), y1: T, y2: H - B, class: 'mark' }));
    if (m.label) svg.append(el('text', { x: X(m.t) + 3, y: T + 10, class: 'mark-label' }, m.label));
  }
  opts.series.forEach((s, si) => {
    let d = '';
    let pen = false;
    s.v.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    });
    svg.append(el('path', { d, class: `line s${si}` }));
    if (opts.points) {
      s.v.forEach((v, i) => {
        if (v == null) return;
        const c = el('circle', { cx: X(xs[i]), cy: Y(v), r: 4, class: `pt s${si}` });
        c.append(el('title', {}, `${opts.xFormat ? opts.xFormat(xs[i]) : xs[i]}: ${fmt(v)}`));
        svg.append(c);
      });
    }
  });
  return svg;
}
