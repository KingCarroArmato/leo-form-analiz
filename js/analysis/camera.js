// Kamera hareketi. Video işlenirken her kare için arka planın ilk kareye göre kayması ölçülür (frames[i].c, piksel).
// Elde çekimdeki küçük oynamalar iskelet noktalarından çıkarılır; böylece çocuk sabit kamerayla çekilmiş gibi
// incelenir. Kamera belirgin hareket ettiyse (çocuğu takip ederek çevrildiyse) bu düzeltme yaklaşıktır: zemine ve
// yer değiştirmeye dayanan ölçümler verilmez, vücudun kendi içindeki ölçümler (açılar, ritim) verilir.
import { percentile } from './util.js';

const STILL = 0.02; // bundan küçük oynama (vücut boyunun oranı) yok sayılır, iskelet olduğu gibi kullanılır
export const MOVED = 0.25; // bundan büyüğü "kamera hareket etti"

// Kamera bu yönde hareket ettiyse verilmeyen ölçümler
const BY_AXIS = {
  x: ['spinDrift', 'finishSway', 'landingSway', 'mTravel', 'mSway'],
  y: ['vertOsc', 'landingAsym', 'finishSway', 'landingSway', 'mHipDrop', 'mSway', 'flightTime'],
};

const span = (vals) => {
  const v = vals.filter((x) => x != null);
  return v.length ? percentile(v, 0.98) - percentile(v, 0.02) : 0;
};

/** Kameranın yatay ve dikey hareketi (vücut boyunun oranı). Kamera yolu ölçülmemişse sıfır. */
export function cameraMotion(frames, bodyH) {
  if (!frames.some((f) => f.c) || !(bodyH > 0)) return { x: 0, y: 0 };
  return { x: span(frames.map((f) => f.c?.[0])) / bodyH, y: span(frames.map((f) => f.c?.[1])) / bodyH };
}

/**
 * İskelet noktalarından kamera hareketini çıkarır: kamera sağa dönünce arka plan sola kayar, sabit duran çocuk
 * görüntüde yerinde kalır; düzeltilmiş konumu kamera yolu kadar sağa taşınır.
 */
export function stabilize(frames, cam) {
  if (Math.max(cam.x, cam.y) <= STILL) return frames;
  return frames.map((f) => (f.k && f.c ? { ...f, k: f.k.map(([x, y, v]) => [x - f.c[0], y - f.c[1], v]) } : f));
}

/** Kameranın hareket ettiği yönler: {x, y} */
export const movedAxes = (cam) => ({ x: cam.x > MOVED, y: cam.y > MOVED });

/** Kamera hareketinden etkilenen ölçümleri siler; silinenlerin anahtarlarını döner. */
export function dropMoved(metrics, moved) {
  const gone = [];
  for (const axis of ['x', 'y']) {
    if (!moved[axis]) continue;
    for (const key of BY_AXIS[axis]) {
      if (key in metrics) { delete metrics[key]; gone.push(key); }
    }
  }
  return gone;
}
