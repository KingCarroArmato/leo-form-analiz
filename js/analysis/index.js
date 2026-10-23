// Tek giriş noktası: video (2B) kaydını analiz edip rapora çevirir.
import { prepare2D, ANALYZERS_2D, compactSkeleton2D } from './video2d.js';
import { analyzeMotion2D } from './motion.js';
import { cameraMotion, stabilize, movedAxes, dropMoved } from './camera.js';
import { buildReport, RULES } from '../rules.js';
import { round } from './util.js';

/**
 * @param {object} input
 *   test: 'jump' | 'run' | 'spin' | 'free' (serbest hareket: hareketi tanır, puan vermez)
 *   frames [{t, k}], meta {fps, width, height, statureM}
 *   age: oyuncunun yaşı (yaşa bağlı eşikler için)
 */
export function runAnalysis({ test, frames, meta = {}, age }) {
  // Kamera oynadıysa analiz, kamera hareketi çıkarılmış iskeletle yapılır. Videonun üstüne çizilen iskelet ham kalır.
  const cam = cameraMotion(frames, prepare2D(frames, meta).bodyH);
  const used = stabilize(frames, cam);
  const D = prepare2D(used, meta);
  // Serbest harekette video kesmelerden çekimlere ayrılır; her çekimin kalitesi ayrı denetlenir
  const res = withCamera(test, test === 'free' ? analyzeMotion2D(used, { ...meta, fps: D.fps }) : ANALYZERS_2D[test](D), movedAxes(cam));
  const skeleton = compactSkeleton2D(frames, { ...meta, fps: D.fps });
  const duration = D.times[D.times.length - 1] - D.times[0];
  const report = buildReport(res.metrics, age);
  return {
    mode: 'video', test, age,
    // Doluysa istenen hareket bulunamadı ya da veri yetersiz: hiçbir ölçüm puanlanmaz
    invalid: res.invalid || null,
    view: res.view,
    fps: round(D.fps, 0),
    duration: round(duration, 2),
    metrics: res.metrics,
    motion: res.motion || null,
    report,
    warnings: res.warnings,
    charts: res.charts,
    events: res.events,
    skeleton,
  };
}

/** Kamera belirgin hareket ettiyse zemine ve yer değiştirmeye bağlı ölçümler verilmez, nedeni yazılır. */
function withCamera(test, res, moved) {
  if (res.invalid || !(moved.x || moved.y)) return res;
  if (test === 'jump' && moved.y) {
    return {
      ...res, metrics: {}, charts: [], events: [],
      invalid: 'Kamera çekim sırasında yukarı-aşağı hareket ettiği için zıplama ölçülemez: ayağın yerden yüksekliği kameraya göre değişir. Telefonu sabit tutarak (tripod ya da bir yere yaslayarak) yeniden çekin.',
    };
  }
  const gone = new Set(dropMoved(res.metrics, moved));
  for (const s of res.motion?.segments ?? []) for (const k of dropMoved(s.metrics, moved)) gone.add(k);
  const names = [...gone].map((k) => RULES[k]?.label?.toLocaleLowerCase('tr') ?? k);
  return {
    ...res,
    warnings: [...res.warnings, names.length
      ? `Kamera çekim sırasında hareket etti (çocuğu takip ederek çevrildi). Açılar ve ritim ölçüldü; ${names.join(', ')} kamera sabit olmadığı için verilmedi. Tam ölçüm için telefonu sabit tutun (tripod ya da bir yere yaslayarak).`
      : 'Kamera çekim sırasında hareket etti (çocuğu takip ederek çevrildi); bu hareket ölçümlerden çıkarıldı. En doğru sonuç için telefonu sabit tutun.'],
  };
}
