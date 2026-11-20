// Ortak matematik ve sinyal işleme yardımcıları (2B ve 3B analizciler kullanır).

export const G = 9.81;

export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const scale = (a, k) => a.map((v) => v * k);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const norm = (a) => Math.sqrt(dot(a, a));
export const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
export const dist = (a, b) => norm(sub(a, b));
export const deg = (rad) => (rad * 180) / Math.PI;

export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function unit(a) {
  const n = norm(a);
  return n > 1e-9 ? scale(a, 1 / n) : a.map(() => 0);
}

/** b noktasındaki a-b-c açısı (derece). 2B veya 3B vektörlerle çalışır. */
export function angleAt(a, b, c) {
  const u = sub(a, b);
  const v = sub(c, b);
  const d = norm(u) * norm(v);
  if (d < 1e-9) return null;
  return deg(Math.acos(Math.max(-1, Math.min(1, dot(u, v) / d))));
}

/** İki vektör arasındaki açı (derece). */
export function angleBetween(u, v) {
  const d = norm(u) * norm(v);
  if (d < 1e-9) return null;
  return deg(Math.acos(Math.max(-1, Math.min(1, dot(u, v) / d))));
}

const finite = (arr) => arr.filter((v) => v != null && Number.isFinite(v));

export function mean(arr) {
  const a = finite(arr);
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
}

export function std(arr) {
  const a = finite(arr);
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

export function percentile(arr, p) {
  const a = finite(arr).sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

export const median = (arr) => percentile(arr, 0.5);

export function min(arr) {
  const a = finite(arr);
  return a.length ? Math.min(...a) : null;
}

export function max(arr) {
  const a = finite(arr);
  return a.length ? Math.max(...a) : null;
}

/** Eksik (null) değerleri en fazla maxGap örnek boyunca doğrusal doldurur. */
export function fillGaps(series, maxGap = 5) {
  const out = series.slice();
  let i = 0;
  while (i < out.length) {
    if (out[i] != null) { i++; continue; }
    let j = i;
    while (j < out.length && out[j] == null) j++;
    const gap = j - i;
    if (i > 0 && j < out.length && gap <= maxGap) {
      const a = out[i - 1];
      const b = out[j];
      for (let k = i; k < j; k++) out[k] = a + ((b - a) * (k - i + 1)) / (gap + 1);
    }
    i = j;
  }
  return out;
}

/** Merkezli hareketli ortalama; null değerleri atlar. */
export function smooth(series, win = 3) {
  if (win <= 1) return series.slice();
  const h = Math.floor(win / 2);
  return series.map((v, i) => {
    if (v == null) return null;
    let s = 0;
    let n = 0;
    for (let k = i - h; k <= i + h; k++) {
      if (k >= 0 && k < series.length && series[k] != null) { s += series[k]; n++; }
    }
    return s / n;
  });
}

/** Saniye cinsinden pencereyi örnek sayısına çevirir (tek sayı). */
export function winFor(seconds, fps) {
  const n = Math.max(1, Math.round(seconds * fps));
  return n % 2 ? n : n + 1;
}

/**
 * Yerel tepe noktaları bulur.
 * @param values sayı dizisi (null olabilir)
 * @param times saniye dizisi
 * @param minProminence tepe ile iki yanındaki en düşük noktalar arasındaki asgari fark
 * @param minSeparation iki tepe arası asgari süre (sn)
 */
export function findPeaks(values, times, { minProminence = 0, minSeparation = 0 } = {}) {
  const cand = [];
  for (let i = 1; i < values.length - 1; i++) {
    const v = values[i];
    if (v == null) continue;
    let l = i - 1;
    while (l >= 0 && values[l] === v) l--;
    let r = i + 1;
    while (r < values.length && values[r] === v) r++;
    if (l < 0 || r >= values.length) continue;
    if (values[l] == null || values[r] == null) continue;
    if (!(v > values[l] && v > values[r])) continue;
    if (l !== i - 1) continue; // düz tepede yalnızca ilk örneği al
    // belirginlik: sola ve sağa daha yüksek bir değere ya da sona kadar en düşük nokta
    let lmin = v;
    for (let k = i - 1; k >= 0 && values[k] != null && values[k] <= v; k--) lmin = Math.min(lmin, values[k]);
    let rmin = v;
    for (let k = i + 1; k < values.length && values[k] != null && values[k] <= v; k++) rmin = Math.min(rmin, values[k]);
    const prom = v - Math.max(lmin, rmin);
    if (prom >= minProminence) cand.push({ i, t: times[i], v, prom });
  }
  // yakın tepelerden en belirgin olanı tut
  cand.sort((a, b) => b.prom - a.prom);
  const kept = [];
  for (const c of cand) {
    if (kept.every((k) => Math.abs(k.t - c.t) >= minSeparation)) kept.push(c);
  }
  return kept.sort((a, b) => a.t - b.t);
}

export const findValleys = (values, times, opts) =>
  findPeaks(values.map((v) => (v == null ? null : -v)), times, opts).map((p) => ({ ...p, v: -p.v }));

/** Birbirine minGap'ten yakın olayları birleştirir (zamanların ortalaması). */
export function mergeEvents(times, minGap) {
  const s = times.slice().sort((a, b) => a - b);
  const out = [];
  for (const t of s) {
    if (out.length && t - out[out.length - 1].last < minGap) {
      const g = out[out.length - 1];
      g.sum += t; g.n++; g.last = t;
    } else out.push({ sum: t, n: 1, last: t });
  }
  return out.map((g) => g.sum / g.n);
}

/** Açı dizisini (derece) 360 sıçramalarından arındırır. */
export function unwrapDeg(arr) {
  const out = [];
  let offset = 0;
  let prev = null;
  for (const v of arr) {
    if (v == null) { out.push(null); continue; }
    if (prev != null) {
      const d = v - prev;
      if (d > 180) offset -= 360;
      else if (d < -180) offset += 360;
    }
    out.push(v + offset);
    prev = v;
  }
  return out;
}

/** Bir dizinin a ve b örnekleri arasındaki eşik geçişini doğrusal enterpolasyonla bulur. */
export function crossTime(t0, v0, t1, v1, thr) {
  if (v1 === v0) return (t0 + t1) / 2;
  return t0 + ((thr - v0) * (t1 - t0)) / (v1 - v0);
}

/** Örnekleme hızını zaman damgalarından tahmin eder. */
export function estimateFps(times) {
  const d = [];
  for (let i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]);
  const m = median(d);
  return m ? 1 / m : 30;
}

export const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Çizim için diziyi en fazla n noktaya indirir. */
export function downsample(times, values, n = 300) {
  const step = Math.max(1, Math.ceil(times.length / n));
  const t = [];
  const v = [];
  for (let i = 0; i < times.length; i += step) {
    t.push(round(times[i], 3));
    v.push(values[i] == null ? null : round(values[i], 3));
  }
  return { t, v };
}

/** Kayan pencereli yüzdelik (ör. yerel zemin seviyesi). halfWin örnek sayısıdır. */
export function rollingPercentile(series, halfWin, p) {
  return series.map((_, i) => percentile(series.slice(Math.max(0, i - halfWin), i + halfWin + 1), p));
}

/**
 * Ayağın yere değme anları: yükseklik thr altına iner ve öncesindeki
 * lookback süresinde en az minSwing kadar havada olmuşsa.
 */
export function touchdowns(times, h, { thr, minSwing, lookback = 0.3 }) {
  const out = [];
  for (let i = 1; i < h.length; i++) {
    if (h[i] == null || h[i - 1] == null) continue;
    if (!(h[i - 1] > thr && h[i] <= thr)) continue;
    let peak = -Infinity;
    for (let k = i - 1; k >= 0 && times[i] - times[k] <= lookback; k--) if (h[k] != null) peak = Math.max(peak, h[k]);
    if (peak >= minSwing) out.push(crossTime(times[i - 1], h[i - 1], times[i], h[i], thr));
  }
  return out;
}
