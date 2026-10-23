// Video (2B) analizi: MediaPipe Pose çıktısından ölçümler.
// Görüntü koordinatları piksel; y aşağı doğru artar. Gerçek ölçek yoktur,
// bu yüzden ölçümler süreye, açılara veya vücut boyuna oranlanır.
import {
  G, sub, mid, dist, deg, angleAt, mean, std, percentile, median, min, max,
  fillGaps, smooth, winFor, findValleys, mergeEvents, crossTime, estimateFps, round, downsample, rollingPercentile, touchdowns,
} from './util.js';

// MediaPipe Pose 33 nokta dizinleri
export const MP = {
  nose: 0, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28, lHeel: 29, rHeel: 30, lToe: 31, rToe: 32,
};

export const BONES_2D = [
  ['lSh', 'rSh'], ['lSh', 'lEl'], ['lEl', 'lWr'], ['rSh', 'rEl'], ['rEl', 'rWr'],
  ['lSh', 'lHip'], ['rSh', 'rHip'], ['lHip', 'rHip'], ['lHip', 'lKnee'], ['lKnee', 'lAnk'],
  ['rHip', 'rKnee'], ['rKnee', 'rAnk'], ['lAnk', 'lHeel'], ['lHeel', 'lToe'], ['lAnk', 'lToe'],
  ['rAnk', 'rHeel'], ['rHeel', 'rToe'], ['rAnk', 'rToe'], ['lEar', 'nose'], ['rEar', 'nose'],
];

/** Ham kareleri ({t, k:[[x,y,v],...]|null}) adlandırılmış, boşlukları doldurulmuş dizilere çevirir. */
export function prepare2D(frames, meta = {}) {
  const times = frames.map((f) => f.t);
  const fps = meta.fps || estimateFps(times);
  const n = frames.length;
  const maxGap = Math.max(2, Math.round(0.15 * fps));
  const sw = winFor(0.04, fps); // 30 fps: yumuşatma yok, 60 fps: 3 kare
  const S = {};
  const rawY = {};
  for (const [name, idx] of Object.entries(MP)) {
    const xs = frames.map((f) => (f.k ? f.k[idx][0] : null));
    rawY[name] = fillGaps(frames.map((f) => (f.k ? f.k[idx][1] : null)), maxGap);
    S[name] = {
      x: smooth(fillGaps(xs, maxGap), sw),
      y: smooth(rawY[name], sw),
      v: frames.map((f) => (f.k ? f.k[idx][2] ?? 1 : 0)),
    };
  }
  const P = (name, i) => (S[name].x[i] == null ? null : [S[name].x[i], S[name].y[i]]);
  const detected = frames.filter((f) => f.k).length / Math.max(1, n);

  const footLowSide = (side, i) => {
    // Zamanlama hassasiyeti için yumuşatılmamış y kullanılır
    const ys = ['Ank', 'Heel', 'Toe'].map((p) => rawY[side + p][i]).filter((v) => v != null);
    return ys.length ? Math.max(...ys) : null;
  };
  const footL = times.map((_, i) => footLowSide('l', i));
  const footR = times.map((_, i) => footLowSide('r', i));
  const footLow = times.map((_, i) => (footL[i] == null || footR[i] == null ? footL[i] ?? footR[i] : Math.max(footL[i], footR[i])));

  const statureRaw = times.map((_, i) => (footLow[i] != null && S.nose.y[i] != null ? footLow[i] - S.nose.y[i] : null));
  const bodyH = (percentile(statureRaw, 0.8) || 1) / 0.92;

  const segLen = (h, k, a, i) => {
    const H = P(h, i), K = P(k, i), A = P(a, i);
    return H && K && A ? dist(H, K) + dist(K, A) : null;
  };
  const legLen = median(times.map((_, i) => mean([segLen('lHip', 'lKnee', 'lAnk', i), segLen('rHip', 'rKnee', 'rAnk', i)]))) || bodyH * 0.5;

  const torso = times.map((_, i) => {
    const a = P('lSh', i), b = P('rSh', i), c = P('lHip', i), d = P('rHip', i);
    return a && b && c && d ? dist(mid(a, b), mid(c, d)) : null;
  });
  const torsoLen = median(torso) || bodyH * 0.3;
  const widthRatio = times.map((_, i) => {
    const a = P('lSh', i), b = P('rSh', i), c = P('lHip', i), d = P('rHip', i);
    return a && b && c && d ? (Math.abs(a[0] - b[0]) + Math.abs(c[0] - d[0])) / 2 / torsoLen : null;
  });
  const wr = median(widthRatio);
  const view = wr == null ? 'bilinmiyor' : wr >= 0.33 ? 'ön' : wr <= 0.2 ? 'yan' : 'çapraz';

  // Kameraya daha yakın taraf (yan çekimde görünürlüğü yüksek olan)
  const visSide = (side) => mean(['Hip', 'Knee', 'Ank', 'Sh', 'El', 'Wr'].flatMap((p) => S[side + p].v));
  const nearSide = visSide('l') >= visSide('r') ? 'l' : 'r';

  const W = meta.width || 1;
  const H = meta.height || 1;
  const outOfFrame = mean(times.map((_, i) => {
    const pts = ['lAnk', 'rAnk', 'nose'].map((nm) => P(nm, i)).filter(Boolean);
    if (!pts.length) return null;
    return pts.some(([x, y]) => x < 0 || y < 0 || x > W || y > H) ? 1 : 0;
  })) ?? 0;

  // Bacaklar kadraj dışındayken MediaPipe yine de nokta tahmin eder, ama görünürlüğü düşük verir
  const legVis = median(frames.filter((f) => f.k).map((f) => mean(LEG_POINTS.map((nm) => f.k[MP[nm]][2] ?? 1))));
  // Takip başka birine atlarsa kalça bir karede vücut boyunun önemli bir kısmı kadar sıçrar
  let jumpsN = 0, pairs = 0;
  for (let i = 1; i < n; i++) {
    const a = mid2(S, 'Hip', i - 1), b = mid2(S, 'Hip', i);
    if (!a || !b) continue;
    pairs++;
    if (dist(a, b) > 0.35 * bodyH) jumpsN++;
  }

  let invalid = null;
  if (detected < 0.6) invalid = `Videonun yalnızca %${Math.round(detected * 100)}'inde bir kişi algılandı. Çocuğun baştan ayağa göründüğü, iyi ışıklı bir çekim kullanın.`;
  else if (legVis != null && legVis < 0.5) invalid = 'Çocuğun bacakları ve ayakları videoda net görünmüyor. Baştan ayağa tamamı kadrajda olacak şekilde çekin.';
  else if (pairs && jumpsN / pairs > 0.02) invalid = 'Takip edilen kişi video boyunca sürekli değişiyor. Kadrajda yalnızca analiz edilecek çocuk olsun.';

  const warnings = [];
  if (detected < 0.7) warnings.push(`Karelerin yalnızca %${Math.round(detected * 100)}'inde çocuk algılandı. Işık, mesafe ve kadrajı kontrol edin.`);
  if (meta.width && outOfFrame > 0.1) warnings.push('Baş veya ayaklar zaman zaman kadraj dışına çıkıyor; kamerayı biraz uzaklaştırın.');
  if (fps < 25) warnings.push(`Kare hızı düşük (${Math.round(fps)} fps); zamanlama ölçümleri daha az hassas olur. 60 fps önerilir.`);

  return { times, fps, n, S, P, footL, footR, footLow, bodyH, legLen, torsoLen, view, nearSide, detected, warnings, invalid, statureM: meta.statureM };
}

const LEG_POINTS = ['lHip', 'rHip', 'lKnee', 'rKnee', 'lAnk', 'rAnk'];
const mid2 = (S, part, i) => {
  const ax = S['l' + part].x[i], bx = S['r' + part].x[i];
  return ax == null || bx == null ? null : [(ax + bx) / 2, (S['l' + part].y[i] + S['r' + part].y[i]) / 2];
};

/** Hareket bulunamadığında ya da veri yetersizken: puan verilmez, nedeni gösterilir. */
const reject = (D, invalid, warnings = D.warnings) => ({ metrics: {}, warnings: [...warnings], invalid, view: D.view, charts: [], events: [] });

export const kneeAngle = (D, side, i) => {
  const a = D.P(side + 'Hip', i), b = D.P(side + 'Knee', i), c = D.P(side + 'Ank', i);
  return a && b && c ? angleAt(a, b, c) : null;
};
export const hipMid = (D, i) => {
  const a = D.P('lHip', i), b = D.P('rHip', i);
  return a && b ? mid(a, b) : null;
};
export const shMid = (D, i) => {
  const a = D.P('lSh', i), b = D.P('rSh', i);
  return a && b ? mid(a, b) : null;
};
export const idxRange = (D, t0, t1) => {
  const out = [];
  D.times.forEach((t, i) => { if (t >= t0 && t <= t1) out.push(i); });
  return out;
};
const hipRangePct = (D, t0, t1) => {
  const ids = idxRange(D, t0, t1);
  if (ids.length < 0.5 * D.fps) return null;
  const xs = ids.map((i) => hipMid(D, i)).filter(Boolean);
  if (xs.length < 3) return null;
  const rx = max(xs.map((p) => p[0])) - min(xs.map((p) => p[0]));
  const ry = max(xs.map((p) => p[1])) - min(xs.map((p) => p[1]));
  return (Math.hypot(rx, ry) / D.bodyH) * 100;
};

/** Ayak yüksekliği dizisinde uçuş evrelerini bulur (yükseklik pozitif = yukarı). */
export function detectFlights(times, h, { detectThr, eps, epsMeters = 0, minFlight = 0.12, maxFlight = 0.9 }) {
  const flights = [];
  let i = 0;
  while (i < h.length) {
    if (h[i] == null || h[i] <= detectThr) { i++; continue; }
    let j = i;
    while (j < h.length && h[j] != null && h[j] > detectThr) j++;
    if (j - i < 2) { i = j; continue; }
    let a = i;
    while (a > 0 && h[a - 1] != null && h[a - 1] > eps) a--;
    let b = j - 1;
    while (b < h.length - 1 && h[b + 1] != null && h[b + 1] > eps) b++;
    if (a === 0 || b === h.length - 1) { i = b + 1; continue; } // kaydın başında/sonunda yarım kalmış
    const takeoff = crossTime(times[a - 1], h[a - 1], times[a], h[a], eps);
    const landing = crossTime(times[b], h[b], times[b + 1], h[b + 1], eps);
    // Eşik (eps) geçişi gerçek kalkıştan biraz sonra, inişten biraz önce olur.
    // Balistik yörüngede eps = (g/2)·τ·(Tm + τ) → τ çözülerek iki uç düzeltilir.
    const tm = landing - takeoff;
    const tau = epsMeters > 0 ? (-tm + Math.sqrt(tm * tm + (8 * epsMeters) / G)) / 2 : 0;
    const ft = tm + 2 * tau;
    if (ft >= minFlight && ft <= maxFlight) flights.push({ takeoff: takeoff - tau, landing: landing + tau, flight: ft, iStart: a, iEnd: b });
    i = b + 1;
  }
  return flights;
}

function groundAndNoise(footLow, scaleRef) {
  // y aşağı: yerdeki ayak en büyük y değerlerinde. Alt %70'lik kısmın medyanı = zemin.
  const p30 = percentile(footLow, 0.3);
  const ground = median(footLow.filter((v) => v != null && v >= p30));
  const h = footLow.map((v) => (v == null ? null : ground - v));
  const noise = std(h.filter((v) => v != null && Math.abs(v) < 0.03 * scaleRef)) || 0;
  return { ground, h, noise };
}

// ------------------------------------------------------------------ ZIPLAMA
export function analyzeJump2D(D) {
  if (D.invalid) return reject(D, D.invalid);
  const { times, bodyH, view } = D;
  const { h, noise } = groundAndNoise(D.footLow, bodyH);
  const detectThr = 0.035 * bodyH;
  const eps = Math.min(0.6 * detectThr, Math.max(0.012 * bodyH, 2.5 * noise));
  // Piksel → metre dönüşümü için çocuğun boyu (bilinmiyorsa 1,40 m varsayılır)
  const statureM = D.statureM || 1.4;
  // Gerçek bir yerinde sıçramada ayaklarla birlikte kalça da yükselir ve çocuk yerinde kalır.
  // Koşu adımındaki uçuş evresi ya da hatalı ayak takibi bu iki koşulu sağlamaz.
  const gL = groundAndNoise(D.footL, bodyH).ground;
  const gR = groundAndNoise(D.footR, bodyH).ground;
  // Kalkıştan hemen önce iki ayak birlikte yerde olmalı: diz çekmede ve koşuda öteki ayak zaten havadadır
  const tol = Math.max(eps, 0.03 * bodyH);
  const bothDown = (i) => D.footL[i] != null && D.footR[i] != null && gL - D.footL[i] <= tol && gR - D.footR[i] <= tol;
  const flights = detectFlights(times, h, { detectThr, eps, epsMeters: (eps / bodyH) * statureM }).filter((f) => {
    if (!idxRange(D, f.takeoff - 0.25, f.takeoff + 0.02).some(bothDown)) return false;
    const hip = (i) => hipMid(D, i);
    const air = idxRange(D, f.takeoff, f.landing);
    const t0 = hip(f.iStart);
    const hipRise = t0 ? max(air.map((i) => (hip(i) ? t0[1] - hip(i)[1] : null))) : null;
    const footPeak = max(air.map((i) => h[i]));
    const around = idxRange(D, f.takeoff - 0.3, f.landing + 0.3).map(hip).filter(Boolean);
    const travel = around.length ? max(around.map((p) => p[0])) - min(around.map((p) => p[0])) : Infinity;
    return hipRise != null && footPeak != null && hipRise >= Math.max(0.4 * footPeak, 0.015 * bodyH) && travel <= 0.35 * bodyH;
  });
  const warnings = [...D.warnings];
  const metrics = {};

  if (!flights.length) {
    return reject(D, 'Bu videoda yerinde dikey sıçrama bulunamadı. Çocuğun tamamı kadrajda olsun, kamera sabit dursun ve çocuk yerinde zıplasın.');
  }

  const jumps = flights.map((f) => ({ ...f, heightCm: ((G * f.flight ** 2) / 8) * 100 }));
  const best = jumps.reduce((a, b) => (b.heightCm > a.heightCm ? b : a));
  metrics.jumpHeight = round(best.heightCm, 1);
  metrics.flightTime = round(best.flight * 1000, 0);
  metrics.jumpCount = jumps.length;

  const side = D.nearSide;
  const cm = [], lf = [], ka = [], asym = [], sway = [];
  for (const j of jumps) {
    if (view === 'yan') {
      const pre = idxRange(D, j.takeoff - 1.0, j.takeoff).map((i) => kneeAngle(D, side, i));
      const post = idxRange(D, j.landing, j.landing + 0.4).map((i) => kneeAngle(D, side, i));
      if (min(pre) != null) cm.push(180 - min(pre));
      if (min(post) != null) lf.push(180 - min(post));
    }
    if (view === 'ön') {
      const ratios = idxRange(D, j.landing, j.landing + 0.4).map((i) => {
        const lk = D.P('lKnee', i), rk = D.P('rKnee', i), la = D.P('lAnk', i), ra = D.P('rAnk', i);
        if (!lk || !rk || !la || !ra) return null;
        const ankSep = Math.abs(la[0] - ra[0]);
        return ankSep > 0.05 * bodyH ? Math.abs(lk[0] - rk[0]) / ankSep : null;
      });
      const r = percentile(ratios, 0.1);
      if (r != null) ka.push(Math.min(r, 1.5));
      // ayak ayak iniş anı
      const landT = (arr, ground) => {
        for (let i = j.iEnd; i < arr.length - 1 && times[i] <= j.landing + 0.3; i++) {
          const a = ground - arr[i], b = ground - arr[i + 1];
          if (a > eps && b <= eps) return crossTime(times[i], a, times[i + 1], b, eps);
        }
        return null;
      };
      const tl = landT(D.footL, gL), tr = landT(D.footR, gR);
      if (tl != null && tr != null) asym.push(Math.abs(tl - tr) * 1000);
    }
    const s = hipRangePct(D, j.landing + 0.3, j.landing + 1.3);
    if (s != null) sway.push(s);
  }
  if (cm.length) metrics.cmDepth = round(mean(cm), 0);
  if (lf.length) metrics.landingFlex = round(mean(lf), 0);
  if (ka.length) metrics.kasr = round(mean(ka), 2);
  if (asym.length) metrics.landingAsym = round(mean(asym), 0);
  if (sway.length) metrics.landingSway = round(mean(sway), 1);

  if (view === 'ön') warnings.push('Önden çekim: diz bükülme açıları için ayrıca yandan bir çekim yapabilirsiniz.');
  if (view === 'yan') warnings.push('Yandan çekim: dizlerin içe kapanması için ayrıca önden bir çekim yapabilirsiniz.');
  if (view === 'çapraz') warnings.push('Kamera çapraz açıda; açı ölçümleri için tam önden veya tam yandan çekin.');
  if (jumps.length > 1) warnings.push(`${jumps.length} sıçrama algılandı; yükseklik en iyi denemeden, teknik ölçümler ortalamadan hesaplandı.`);

  const hPct = h.map((v) => (v == null ? null : (v / bodyH) * 100));
  const ds = downsample(times, hPct);
  const charts = [{
    title: 'Ayak yüksekliği (vücut boyunun %)', t: ds.t,
    series: [{ name: 'Ayak', v: ds.v }],
    marks: jumps.flatMap((j, k) => [{ t: j.takeoff, label: `Kalkış ${k + 1}` }, { t: j.landing, label: `İniş ${k + 1}` }]),
  }];
  if (view === 'yan') {
    const ka2 = downsample(times, times.map((_, i) => kneeAngle(D, side, i)));
    charts.push({ title: 'Diz açısı (°)', t: ka2.t, series: [{ name: 'Diz', v: ka2.v }], marks: [] });
  }
  return {
    metrics, warnings, view, charts,
    events: jumps.map((j) => ({ takeoff: round(j.takeoff, 3), landing: round(j.landing, 3), heightCm: round(j.heightCm, 1) })),
  };
}

// --------------------------------------------------------------------- KOŞU
export function analyzeRun2D(D) {
  if (D.invalid) return reject(D, D.invalid);
  const { times, bodyH, legLen, view, fps } = D;
  const warnings = [...D.warnings];
  const metrics = {};

  // Koşu yönü: burun kulakların önündeyse o yön
  const facing = median(times.map((_, i) => {
    const n = D.P('nose', i), a = D.P('lEar', i), b = D.P('rEar', i);
    return n && a && b ? n[0] - mid(a, b)[0] : null;
  }));
  const hm0 = hipMid(D, 0), hm1 = hipMid(D, D.n - 1);
  const dir = facing != null && Math.abs(facing) > 0.01 * bodyH ? Math.sign(facing) : hm0 && hm1 ? Math.sign(hm1[0] - hm0[0]) || 1 : 1;

  // Ayak temasları: ayağın yerel zemine indiği anlar (kamera eğikse zemin
  // kadraj boyunca değişebildiği için 1,5 sn'lik kayan pencere kullanılır)
  const ground = rollingPercentile(D.footLow, Math.round(0.75 * fps), 0.9);
  const hOf = (foot) => foot.map((v, i) => (v == null || ground[i] == null ? null : ground[i] - v));
  const td = { thr: 0.03 * bodyH, minSwing: 0.06 * bodyH };
  const contacts = mergeEvents([...touchdowns(times, hOf(D.footL), td), ...touchdowns(times, hOf(D.footR), td)], 0.1);
  const intervals = [];
  for (let k = 1; k < contacts.length; k++) {
    const d = contacts[k] - contacts[k - 1];
    if (d >= 0.15 && d <= 0.6) intervals.push(d);
  }
  // Koşu doğrulaması: düzenli ayak temasları, koşu düzeyinde adım sıklığı ve gerçekten yer değiştirme.
  // Bunlar yoksa duruş ölçümleri (gövde eğimi, dirsek açısı vb.) anlamsızdır ve puanlanmaz.
  const notRun = 'Bu videoda koşu bulunamadı. Çocuk kameranın önünden yandan, koşarak geçmeli ve en az 3-4 adım kadrajda görünmeli.';
  if (contacts.length < 4 || intervals.length < 3 || intervals.length < 0.6 * (contacts.length - 1)) return reject(D, notRun);
  const stepT = median(intervals);
  if (std(intervals) / mean(intervals) > 0.35) return reject(D, notRun);
  if (stepT > 60 / 150) return reject(D, `Adım sıklığı dakikada ${Math.round(60 / stepT)}; bu koşu değil, yürüyüş temposu. Koşu testi için çocuk koşarak geçmeli.`);
  const span = idxRange(D, contacts[0], contacts[contacts.length - 1]);
  const hx = span.map((i) => hipMid(D, i)?.[0]).filter((v) => v != null);
  const travel = hx.length ? max(hx) - min(hx) : 0;
  // Kameraya doğru/uzağa koşuda yatay yer değiştirme az olur, çocuk büyür ya da küçülür
  const sizes = span.map((i) => (D.footLow[i] != null && D.S.nose.y[i] != null ? D.footLow[i] - D.S.nose.y[i] : null));
  const third = Math.max(1, Math.floor(sizes.length / 3));
  const s0 = median(sizes.slice(0, third)), s1 = median(sizes.slice(-third));
  const scale = s0 && s1 ? Math.max(s0, s1) / Math.min(s0, s1) : 1;
  if (travel < 1.0 * bodyH && scale < 1.25) return reject(D, 'Çocuk koşu boyunca yer değiştirmiyor (yerinde hareket). Koşu testi için kameranın önünden koşarak geçmeli; kamera sabit durmalı.');
  metrics.cadence = round(60 / stepT, 0);

  const nearestIdx = (t) => times.reduce((b, ti, i) => (Math.abs(ti - t) < Math.abs(times[b] - t) ? i : b), 0);

  if (view === 'yan') {
    metrics.trunkLean = round(median(times.map((_, i) => {
      const s = shMid(D, i), h = hipMid(D, i);
      return s && h ? deg(Math.atan2(dir * (s[0] - h[0]), h[1] - s[1])) : null;
    })), 0);
    const thigh = [];
    const knee = [];
    for (const side of ['l', 'r']) {
      times.forEach((_, i) => {
        const h = D.P(side + 'Hip', i), k = D.P(side + 'Knee', i);
        if (h && k) thigh.push(deg(Math.atan2(dir * (k[0] - h[0]), k[1] - h[1])));
        knee.push(kneeAngle(D, side, i));
      });
    }
    metrics.kneeDrive = round(percentile(thigh, 0.9), 0);
    metrics.heelRecovery = round(percentile(knee, 0.1), 0);

    const os = contacts.map((t) => {
      const i = nearestIdx(t);
      const side = (D.footL[i] ?? -Infinity) >= (D.footR[i] ?? -Infinity) ? 'l' : 'r';
      const a = D.P(side + 'Ank', i), h = hipMid(D, i);
      return a && h ? ((dir * (a[0] - h[0])) / legLen) * 100 : null;
    });
    if (os.filter((v) => v != null).length >= 2) metrics.overstride = round(median(os), 0);

    const s = D.nearSide;
    metrics.elbowAngle = round(median(times.map((_, i) => {
      const a = D.P(s + 'Sh', i), b = D.P(s + 'El', i), c = D.P(s + 'Wr', i);
      return a && b && c ? angleAt(a, b, c) : null;
    })), 0);

    if (contacts.length >= 3) {
      const osc = [];
      for (let k = 1; k < contacts.length; k++) {
        const ys = idxRange(D, contacts[k - 1], contacts[k]).map((i) => hipMid(D, i)?.[1]);
        if (ys.filter((v) => v != null).length >= 3) osc.push(max(ys) - min(ys));
      }
      if (osc.length) metrics.vertOsc = round((median(osc) / legLen) * 100, 0);
    }
  } else if (view === 'ön') {
    const lean = times.map((_, i) => {
      const s = shMid(D, i), h = hipMid(D, i);
      return s && h ? deg(Math.atan2(s[0] - h[0], h[1] - s[1])) : null;
    });
    metrics.lateralSway = round(std(lean), 1);
    const cross = times.map((_, i) => {
      const h = hipMid(D, i);
      if (!h) return null;
      let c = 0;
      for (const side of ['l', 'r']) {
        const w = D.P(side + 'Wr', i), sh = D.P(side + 'Sh', i);
        if (w && sh && Math.sign(w[0] - h[0]) !== Math.sign(sh[0] - h[0])) c = 1;
      }
      return c;
    });
    metrics.armCross = round(mean(cross) * 100, 0);
    warnings.push('Önden çekim: gövde eğimi, diz kaldırma ve ayak basışı için yandan çekim gerekir.');
  } else {
    warnings.push('Kamera çapraz açıda; teknik ölçümler için koşuyu tam yandan çekin.');
  }

  const floorRef = percentile(D.footLow, 0.9);
  const ds = downsample(times, D.footLow.map((v) => (v == null ? null : ((floorRef - v) / bodyH) * 100)));
  const charts = [{
    title: 'Ayak yüksekliği (temaslar işaretli)', t: ds.t,
    series: [{ name: 'Ayak', v: ds.v }],
    marks: contacts.map((t, k) => ({ t, label: `${k + 1}` })),
  }];
  if (fps < 50) warnings.push('Sprint için 60 fps çekim, temas anlarını daha doğru yakalar.');
  return { metrics, warnings, view, charts, events: contacts.map((t) => ({ contact: round(t, 3) })) };
}

// -------------------------------------------------------------------- DÖNME
export function analyzeSpin2D(D) {
  if (D.invalid) return reject(D, D.invalid);
  const { times, bodyH, fps, torsoLen } = D;
  const warnings = [...D.warnings];
  const metrics = {};

  const Wr = smooth(times.map((_, i) => {
    const a = D.P('lSh', i), b = D.P('rSh', i), c = D.P('lHip', i), d = D.P('rHip', i);
    return a && b && c && d ? (Math.abs(a[0] - b[0]) + Math.abs(c[0] - d[0])) / 2 / torsoLen : null;
  }), winFor(0.08, fps));
  const range = (max(Wr) ?? 0) - (min(Wr) ?? 0);
  const valleys = findValleys(Wr, times, { minProminence: Math.max(0.12, 0.35 * range), minSeparation: 0.12 });

  // Dönüşte gövde önden (geniş) yana (dar) tekrar tekrar geçer; yerinde, düzenli bir ritimle
  const notSpin = 'Bu videoda kendi etrafında dönme bulunamadı. Çocuğu önden çekin; kameraya dönük başlayıp yerinde en az bir tam tur dönsün.';
  if (valleys.length < 2 || range < 0.2 || (max(Wr) ?? 0) < 0.3) return reject(D, notSpin);

  const vt = valleys.map((v) => v.t);
  const half = [];
  for (let k = 1; k < vt.length; k++) half.push(vt[k] - vt[k - 1]);
  const hm = median(half);
  if (half.length >= 3 && std(half) / mean(half) > 0.6) return reject(D, notSpin);
  // Bir tur 3 sn'den uzun sürüyorsa bu dönme değil, yavaş gövde çevirme ya da kurgu geçişleridir
  if (hm * 2 > 3) return reject(D, notSpin);
  metrics.turns = round(valleys.length / 2, 1);
  metrics.turnTime = round(hm * 2, 2);
  if (half.length >= 3) metrics.spinRhythm = round((std(half) / mean(half)) * 100, 0);

  const start = Math.max(times[0], vt[0] - hm / 2);
  const end = Math.min(times[times.length - 1], vt[vt.length - 1] + hm / 2);
  const ids = idxRange(D, start, end);
  const h0 = hipMid(D, ids[0]);
  if (h0) {
    metrics.spinDrift = round((max(ids.map((i) => { const h = hipMid(D, i); return h ? dist(h, h0) : null; })) / bodyH) * 100, 0);
    if (metrics.spinDrift > 60) return reject(D, 'Çocuk dönerken yerinde kalmıyor, sürekli yer değiştiriyor. Dönme testi yerinde yapılmalı.');
  }
  metrics.spinTilt = round(mean(ids.map((i) => {
    const s = shMid(D, i), h = hipMid(D, i);
    return s && h ? Math.abs(deg(Math.atan2(s[0] - h[0], h[1] - s[1]))) : null;
  })), 0);
  const fs = hipRangePct(D, end + 0.3, end + 1.3);
  if (fs != null) metrics.finishSway = round(fs, 1);
  else warnings.push('Bitiş dengesi ölçülemedi: dönüşten sonra en az 1,5 sn daha çekim yapın.');
  warnings.push('Dönüş yönü ve kameraya yaklaşıp uzaklaşma videodan ölçülemez.');

  const ds = downsample(times, Wr);
  return {
    metrics, warnings, view: D.view,
    charts: [{ title: 'Omuz/kalça genişliği (dönüş döngüsü)', t: ds.t, series: [{ name: 'Genişlik', v: ds.v }], marks: vt.map((t, k) => ({ t, label: k % 2 ? '' : `${k / 2 + 0.5}` })) }],
    events: vt.map((t) => ({ sideways: round(t, 3) })),
  };
}

export const ANALYZERS_2D = { jump: analyzeJump2D, run: analyzeRun2D, spin: analyzeSpin2D };

/** Kayıt için iskelet verisini küçültür (≤30 fps, tam sayı piksel). */
export function compactSkeleton2D(frames, meta) {
  const step = Math.max(1, Math.round((meta.fps || 30) / 30));
  const names = Object.keys(MP);
  const out = [];
  for (let i = 0; i < frames.length; i += step) {
    const f = frames[i];
    out.push([round(f.t, 3), f.k ? names.map((n) => [Math.round(f.k[MP[n]][0]), Math.round(f.k[MP[n]][1])]) : null]);
  }
  return { kind: '2d', names, width: meta.width, height: meta.height, frames: out, bones: BONES_2D };
}
