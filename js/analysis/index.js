// Tek giriş noktası: video (2B) kaydını analiz edip rapora çevirir.
import { prepare2D, ANALYZERS_2D, compactSkeleton2D, hipMid, shMid } from './video2d.js';
import { analyzeMotion2D } from './motion.js';
import { cameraMotion, stabilize, movedAxes, dropMoved } from './camera.js';
import { buildReport, RULES, MOTIONS } from '../rules.js';
import { round, median, percentile, std, deg, dist } from './util.js';

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

const SCORED = ['jump', 'run', 'spin'];
// Bundan kısa bölüm analiz edilmez (sn)
const MIN_PART = 1.5;

/**
 * Hareketi bulur: zıplama, koşu ya da dönme varsa o testle yaşa göre puanlar, yoksa genel hareket analizi
 * (diz çekme, squat, hamle...) yapar. Birden çok test geçerse videoda en uzun süren hareketinki seçilir.
 */
function pick({ frames, meta, age }) {
  const free = runAnalysis({ test: 'free', frames, meta, age });
  const scored = SCORED.map((test) => ({ test, result: runAnalysis({ test, frames, meta, age }) })).filter((x) => !x.result.invalid);
  if (!scored.length) return { test: 'free', result: free };
  const time = (test) => (free.motion?.segments ?? []).filter((s) => MOTIONS[s.key]?.test === test).reduce((t, s) => t + s.end - s.start, 0);
  return scored.reduce((a, b) => (time(b.test) > time(a.test) ? b : a));
}

/**
 * Antrenör test seçmez: hareket videodan bulunur. Bütün video analiz edilemezse (çocuk zaman zaman kadraj dışında,
 * takip başka kişiye kayıyor, bacaklar görünmüyor) yapılabilen kadarı yapılır: çocuğun net göründüğü en uzun bölüm
 * ya da yalnızca üst vücut. Bu durumda result.partial, neyin neden ölçülemediğini ve çekimin nasıl düzeltileceğini
 * taşır. {test, result} döner; gösterilecek hiçbir şey yoksa result.invalid nedenleriyle doludur.
 */
export function analyzeAuto({ frames, meta = {}, age }) {
  const full = pick({ frames, meta, age });
  const D = prepare2D(frames, { ...meta, allowNoLegs: true });
  const problems = diagnose(D, meta);
  // Çocuk videonun çoğunda görünmüyor ya da takip başka kişiye kayıyor: puanlı testler bütün videoda bulunamaz,
  // ama çocuğun net göründüğü bölümde bulunabilir
  const dataProblem = D.detected < 0.6 || D.switchRate > 0.02;
  if (!full.result.invalid && (full.test !== 'free' || !dataProblem)) {
    if (meta.enhanced > 0.05 * frames.length) full.result.warnings.push(enhancedNote(meta));
    return full;
  }
  const fps = D.fps;
  const finish = (r, info) => {
    const res = r.result;
    res.partial = partialInfo(res, problems, info, r.test);
    // Tekrar oynatmada videonun tamamı gösterilir
    res.skeleton = compactSkeleton2D(frames, { ...meta, fps });
    if (meta.enhanced > 0.05 * frames.length) res.warnings.push(enhancedNote(meta));
    return r;
  };

  // 1) Çocuğun kesintisiz ve net göründüğü en uzun bölüm
  const win = usableWindow(frames, fps);
  let part = frames;
  let window = null;
  if (win && win.b - win.a + 1 < 0.95 * frames.length && frames[win.b].t - frames[win.a].t >= MIN_PART) {
    part = frames.slice(win.a, win.b + 1);
    window = [part[0].t, part[part.length - 1].t];
    const r = pick({ frames: part, meta, age });
    // Bütün videonun genel analizi geçerliyse, bölüm ancak puanlı bir test bulduğunda tercih edilir
    if (!r.result.invalid && (full.result.invalid || r.test !== 'free')) return finish(r, { window });
  }
  // Genel hareket analizi bütün videoda yapılabildi; çocuğun görünmediği ya da takibin kaydığı kısımlar ölçülmedi
  if (!full.result.invalid) return finish(full, { skipped: true });
  // 2) Bacaklar görünmüyorsa üst vücut: dönme bacaksız da ölçülür, yoksa gövde duruşu ve kalça salınımı
  const PD = prepare2D(part, { ...meta, allowNoLegs: true });
  if (!PD.invalid && PD.legVis != null && PD.legVis < 0.5) {
    const spin = runAnalysis({ test: 'spin', frames: part, meta: { ...meta, allowNoLegs: true }, age });
    if (!spin.invalid) return finish({ test: 'spin', result: spin }, { window, noLegs: true });
    const ub = upperBody(PD, age);
    if (ub) return finish({ test: 'free', result: ub }, { window, noLegs: true });
  }
  // 3) Gösterilecek bir şey yok: nedenler ve çekimin nasıl düzeltileceği yazılır
  if (problems.length) {
    full.result.invalid = `${problems.map((p) => p.text).join(' ')} Öneri: ${unique(problems.map((p) => p.tip)).join(' ')}`;
  }
  return full;
}

const unique = (arr) => [...new Set(arr)];
const fmt = (t) => t.toFixed(1).replace('.', ',');
const enhancedNote = (meta) => `Görüntü karanlık ya da net olmadığı için ${meta.enhanced} karede görüntü otomatik iyileştirilerek bakıldı; ölçümler biraz daha az hassas olabilir.`;

/** Videonun analizi zorlaştıran yanları: {text, tip}. */
export function diagnose(D, meta = {}) {
  const out = [];
  if (D.detected < 0.6) {
    out.push({ text: `Çocuk videonun yalnızca %${Math.round(D.detected * 100)}'inde algılanabildi (kadraj dışına çıkıyor, çok uzakta ya da görüntü net değil).`, tip: 'Çocuk baştan sona kadrajda kalsın; telefonu biraz yaklaştırın.' });
  }
  if (D.legVis != null && D.legVis < 0.5) {
    out.push({ text: 'Bacaklar ve ayaklar videonun çoğunda görünmüyor ya da net değil.', tip: 'Telefonu biraz geri alın ya da aşağı eğin; çocuk baştan ayağa görünsün.' });
  }
  if (D.switchRate > 0.02) {
    out.push({ text: 'Takip zaman zaman başka bir kişiye kayıyor (kadrajda başka biri var ya da biri çocuğun önünden geçiyor).', tip: 'Video yüklenince analiz edilecek çocuğa dokunun; mümkünse kadrajda başka kimse olmasın.' });
  }
  const short = Math.min(meta.width || Infinity, meta.height || Infinity);
  if (short < 540) {
    out.push({ text: `Video çözünürlüğü düşük (${meta.width}×${meta.height}).`, tip: 'Videonun aslını yükleyin; WhatsApp ile gelen videolar küçültülür.' });
  }
  if (meta.brightness != null && meta.brightness < 55) {
    out.push({ text: 'Video karanlık.', tip: 'Daha aydınlık bir yerde çekin; ışık kameranın arkasından gelsin.' });
  }
  if (D.fps < 25) {
    out.push({ text: `Kare hızı düşük (${Math.round(D.fps)} fps).`, tip: "60 fps ile çekin (iPhone'da Ayarlar > Kamera > Video Kaydı)." });
  }
  return out;
}

function partialInfo(res, problems, { window, noLegs, skipped }, test) {
  const missing = [];
  if (skipped) missing.push('Çocuğun görünmediği ya da takibin başka kişiye kaydığı kısımlar ölçülmedi; puanlı testler (zıplama, koşu, dönme) bu yüzden aranamadı.');
  if (window) missing.push(`Yalnızca çocuğun net izlenebildiği ${fmt(window[0])}-${fmt(window[1])} sn arası analiz edildi; videonun geri kalanı ölçülmedi.`);
  if (noLegs) {
    missing.push(test === 'spin'
      ? 'Bacaklara bağlı ölçümler yapılamadı; dönüş gövdeden ölçüldü.'
      : 'Zıplama, koşu ve bacak hareketleri (diz kaldırma, çömelme, adımlar) ölçülemedi; yalnızca gövde duruşu ve kalça salınımı ölçüldü.');
  }
  const reasons = problems.map((p) => p.text);
  if (!reasons.length) reasons.push('Videonun bir kısmında çocuk yeterince net izlenemedi.');
  return { reasons, missing, tips: unique(problems.map((p) => p.tip)), window: window ? [round(window[0], 2), round(window[1], 2)] : null, noLegs: !!noLegs };
}

/**
 * Çocuğun kesintisiz göründüğü en uzun bölüm {a, b} (kare dizinleri). Kısa boşluklar (≤0,15 sn) bölümü bölmez;
 * daha uzun boşluklar ve kalçanın bir anda vücut boyunun önemli bir kısmı kadar sıçraması (takibin başka kişiye
 * atlaması) böler.
 */
export function usableWindow(frames, fps) {
  const maxGap = Math.max(2, Math.round(0.15 * fps));
  const hip = (k) => [(k[23][0] + k[24][0]) / 2, (k[23][1] + k[24][1]) / 2];
  const torso = (k) => dist([(k[11][0] + k[12][0]) / 2, (k[11][1] + k[12][1]) / 2], hip(k));
  const T = median(frames.filter((f) => f.k).map((f) => torso(f.k)));
  if (!T) return null;
  let best = null, a = -1, last = -1, prev = null;
  const close = () => { if (a >= 0 && (!best || last - a > best.b - best.a)) best = { a, b: last }; };
  frames.forEach((f, i) => {
    if (!f.k) return;
    const h = hip(f.k);
    // Kalça vücut boyunun ~%35'inden fazla sıçradıysa (gövde boyu ~ vücut boyunun %30'u) başka bir kişidir
    if (a >= 0 && (i - last > maxGap || dist(h, prev) > 1.2 * T * Math.min(i - last, 3))) { close(); a = -1; }
    if (a < 0) a = i;
    last = i;
    prev = h;
  });
  close();
  return best;
}

/** Bacaklar görünmediğinde yalnızca üst vücuttan ölçüm: gövde eğimi ve kalçanın yatay salınımı. */
function upperBody(D, age) {
  const { times } = D;
  const bodyH = D.torsoLen / 0.3;
  const tilt = percentile(times.map((_, i) => {
    const s = shMid(D, i), h = hipMid(D, i);
    return s && h ? Math.abs(deg(Math.atan2(s[0] - h[0], h[1] - s[1]))) : null;
  }), 0.9);
  const hx = times.map((_, i) => hipMid(D, i)?.[0]).filter((v) => v != null);
  if (tilt == null || hx.length < 10) return null;
  const metrics = { mTrunkTilt: round(tilt, 0), mSway: round((std(hx) / bodyH) * 100, 1) };
  const start = times[0], end = times[times.length - 1];
  return {
    mode: 'video', test: 'free', age, invalid: null, view: D.view, fps: round(D.fps, 0), duration: round(end - start, 2),
    metrics: {}, motion: { main: 'other', segments: [{ key: 'other', start: round(start, 2), end: round(end, 2), view: D.view, metrics }], cuts: 0 },
    report: buildReport({}, age), warnings: [...D.warnings], charts: [], events: [{ start: round(start, 2) }], skeleton: null,
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
