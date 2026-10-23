// Kalabalık videoda analiz edilecek çocuğu seçme ve video boyunca takip etme, kamera hareketini ölçme.
// Tarayıcıya bağlı değildir (testlerde de çalışır); video ve model işlemleri pose.js'tedir.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Kişinin kutusu için kullanılan noktalar: burun, omuzlar, kalçalar, dizler, ayak bilekleri, topuklar, parmak uçları
const BOX_PTS = [0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

/** İskeletten ([[x, y, görünürlük], ...] piksel) kişi bilgisi: kutu [x0, y0, x1, y1], kalça ortası, boy. */
export function personOf(k) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of BOX_PTS) {
    const [x, y] = k[i];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const h = Math.max(y1 - y0, x1 - x0, 1);
  // Burun başın tepesi değildir, kollar da kutuya girmez: kutu biraz genişletilir
  const box = [x0 - 0.12 * h, y0 - 0.12 * h, x1 + 0.12 * h, y1 + 0.03 * h];
  // Boyundan çok daha geniş "kişi" çoğunlukla yan yana duran iki kişinin tek sanılmasıdır
  return { box, hip: [(k[23][0] + k[24][0]) / 2, (k[23][1] + k[24][1]) / 2], h, k, wide: x1 - x0 > 1.3 * (y1 - y0) };
}

/**
 * Dokunulan noktadaki kişi. Telefonda küçük görünen çocuğa tam isabet zor olduğu için nokta kutunun biraz dışında
 * da olabilir (boyunun en fazla slack katı). Birden fazla aday varsa kutusuna, sonra kalçasına en yakın olanı.
 */
export function personAt(people, x, y, slack = 0.3) {
  let best = null, bd = Infinity;
  for (const p of people) {
    const [x0, y0, x1, y1] = p.box;
    const out = Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)) / p.h;
    if (out > slack) continue;
    const d = out + 0.1 * (Math.hypot(p.hip[0] - x, p.hip[1] - y) / p.h);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/**
 * Kareyi üst üste binen kare parçalara böler: [[sx, sy, kenar, kenar], ...]. Uzaktaki küçük çocuklar bütün karede
 * bulunamaz; her parça modele büyütülerek verilince bulunabilir.
 */
export function tiles(W, H, frac = 0.6) {
  const side = Math.round(Math.min(W, H) * frac);
  const at = (L) => {
    const n = Math.ceil((L - side) / (side / 2)) + 1;
    return Array.from({ length: n }, (_, i) => Math.round(n > 1 ? (i * (L - side)) / (n - 1) : 0));
  };
  return at(W).flatMap((x) => at(H).map((y) => [x, y, side, side]));
}

/** Farklı parçalarda bulunan aynı kişiyi birleştirir (kutuları büyük ölçüde örtüşenlerden en büyük görüneni kalır). */
export function mergePeople(people) {
  const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const out = [];
  for (const p of [...people].sort((a, b) => b.h - a.h)) {
    const dup = out.some((q) => {
      const i = area([Math.max(p.box[0], q.box[0]), Math.max(p.box[1], q.box[1]), Math.min(p.box[2], q.box[2]), Math.min(p.box[3], q.box[3])]);
      return i > 0.5 * Math.min(area(p.box), area(q.box));
    });
    if (!dup) out.push(p);
  }
  return out;
}

/**
 * Takip edilen kişiyi (prev: {hip, h, vel}) bu karedeki adaylar arasında bulur. Kişi kalçasının beklenen yerine
 * yakın ve boyu benzer olmalı; aksi hâlde başka biridir (antrenör, yanından geçen çocuk) ve null döner.
 * lost: kişinin kaç karedir bulunamadığı; arama alanı buna göre genişler.
 */
export function associate(prev, people, lost = 0) {
  const n = lost + 1;
  const pred = [prev.hip[0] + (prev.vel?.[0] ?? 0) * n, prev.hip[1] + (prev.vel?.[1] ?? 0) * n];
  const reach = Math.min(1.5, 0.35 + 0.1 * lost) * prev.h;
  const lo = Math.max(0.4, 0.7 - 0.03 * lost);
  let best = null, bs = Infinity;
  for (const p of people) {
    const d = Math.hypot(p.hip[0] - pred[0], p.hip[1] - pred[1]);
    const r = p.h / prev.h;
    if (d > reach || r < lo || r > 1 / lo) continue;
    const s = d / prev.h + Math.abs(Math.log(r));
    if (s < bs) { bs = s; best = p; }
  }
  return best;
}

/** Bulunan kişiyle takip durumunu günceller (kalçanın kare başına hızı yumuşatılarak tutulur). */
export function follow(prev, p, lost = 0) {
  const n = lost + 1;
  const v = prev ? [(p.hip[0] - prev.hip[0]) / n, (p.hip[1] - prev.hip[1]) / n] : [0, 0];
  const pv = prev?.vel ?? v;
  return { ...p, vel: [0.6 * pv[0] + 0.4 * v[0], 0.6 * pv[1] + 0.4 * v[1]] };
}

/**
 * Modele verilecek bölge [sx, sy, kenar, kenar]: kişinin çevresinde, boyunun ~2,2 katı kare. Küçük görünen
 * (uzaktaki) çocuk böylece modele büyütülerek verilir ve kadrajdaki diğer kişiler çoğunlukla dışarıda kalır.
 * Kare videoya sığmıyorsa ya da kişi kayıpsa ve alan çok büyüdüyse bütün kare kullanılır (null).
 */
export function cropAround(p, W, H, lost = 0) {
  const side = Math.round(Math.max(96, p.h * (2.2 + 0.5 * lost)));
  if (side > Math.min(W, H) * 0.9) return null;
  const cx = (p.box[0] + p.box[2]) / 2, cy = (p.box[1] + p.box[3]) / 2;
  return [Math.round(clamp(cx - side / 2, 0, W - side)), Math.round(clamp(cy - side / 2, 0, H - side)), side, side];
}

const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const i = ix * iy;
  return i / (a[2] * a[3] + b[2] * b[3] - i);
};

/** Bölge her karede değişmez: kişi ideal bölgeden belirgin uzaklaşınca (örtüşme < 0,6) yeni bölgeye geçilir. */
export const cropStillFits = (cur, ideal) => (cur == null || ideal == null ? cur === ideal : iou(cur, ideal) >= 0.6);

// ------------------------------------------------------------ KAMERA HAREKETİ

/** RGBA görüntüyü gri tona çevirir. */
export function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.3 * rgba[j] + 0.59 * rgba[j + 1] + 0.11 * rgba[j + 2];
  return g;
}

/**
 * Arka planın a görüntüsünden b görüntüsüne kayması [dx, dy] (piksel). Görüntü bloklara bölünür, her bloğun b'deki
 * yeri aranır; kişilerin üstündeki bloklar (masks: [x0, y0, x1, y1]) ve dokusuz bloklar (düz zemin, duvar)
 * kullanılmaz. Hareket eden başka kişiler sonucu bozmasın diye blokların ortancası alınır.
 * Güvenilir bir sonuç yoksa null.
 */
export function bgShift(a, b, w, h, masks = [], { block = 16, radius = 6, maxBlocks = 48 } = {}) {
  const cands = [];
  for (let by = radius; by + block + radius <= h; by += block) {
    for (let bx = radius; bx + block + radius <= w; bx += block) {
      if (masks.some((m) => bx < m[2] && bx + block > m[0] && by < m[3] && by + block > m[1])) continue;
      let tex = 0;
      for (let y = by; y < by + block - 1; y++) {
        for (let x = bx; x < bx + block - 1; x++) {
          const i = y * w + x;
          tex += Math.abs(a[i + 1] - a[i]) + Math.abs(a[i + w] - a[i]);
        }
      }
      cands.push({ bx, by, tex: tex / (block * block) });
    }
  }
  // Dokusu en belirgin bloklar
  const blocks = cands.filter((c) => c.tex >= 4).sort((p, q) => q.tex - p.tex).slice(0, maxBlocks);
  const R = 2 * radius + 1;
  const sad = new Float32Array(R * R);
  const vecs = [];
  for (const { bx, by } of blocks) {
    let bi = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        let s = 0;
        for (let y = by; y < by + block; y++) {
          const ra = y * w, rb = (y + dy) * w + dx;
          for (let x = bx; x < bx + block; x++) s += Math.abs(a[ra + x] - b[rb + x]);
        }
        const j = (dy + radius) * R + dx + radius;
        sad[j] = s;
        if (s < sad[bi]) bi = j;
      }
    }
    const ix = bi % R, iy = Math.floor(bi / R);
    if (ix === 0 || iy === 0 || ix === R - 1 || iy === R - 1) continue; // arama sınırında: kayma daha büyük olabilir
    const at = (x, y) => sad[clamp(y, 0, R - 1) * R + clamp(x, 0, R - 1)];
    const best = sad[bi];
    // Eşleşme her iki yönde belirgin olmalı: yalnızca yatay çizgi olan blok (saha çizgisi) yatay kaymayı göstermez
    const floor = best * 1.15 + block * block * 0.5;
    if (Math.min(at(ix - 2, iy), at(ix + 2, iy)) < floor || Math.min(at(ix, iy - 2), at(ix, iy + 2)) < floor) continue;
    // Piksel altı düzeltme: en iyi noktanın komşularından parabol
    const sub = (m, c, p) => { const d = m - 2 * c + p; return d > 0 ? clamp((m - p) / (2 * d), -0.5, 0.5) : 0; };
    vecs.push([ix - radius + sub(at(ix - 1, iy), best, at(ix + 1, iy)), iy - radius + sub(at(ix, iy - 1), best, at(ix, iy + 1))]);
  }
  if (vecs.length < 4) return null;
  const med = (arr) => { const s = [...arr].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
  const mx = med(vecs.map((v) => v[0])), my = med(vecs.map((v) => v[1]));
  const ins = vecs.filter((v) => Math.abs(v[0] - mx) <= 1 && Math.abs(v[1] - my) <= 1);
  if (ins.length < Math.max(4, 0.4 * vecs.length)) return null;
  return [ins.reduce((s, v) => s + v[0], 0) / ins.length, ins.reduce((s, v) => s + v[1], 0) / ins.length];
}
