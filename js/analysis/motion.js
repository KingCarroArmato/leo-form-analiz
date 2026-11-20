// Serbest hareket analizi: videodaki hareketi kurallarla tanır ve puansız (bilgi amaçlı) ölçümler çıkarır.
// Seçilen test (zıplama, koşu, dönme) videoda bulunamadığında ya da antrenör "Diğer hareket" seçtiğinde kullanılır.
//
// 1. Video, kesmelerden (kurgu geçişleri, takip edilen kişinin değişmesi) çekimlere ayrılır.
// 2. Her çekim 2 sn'lik, 0,5 sn kayan pencerelerle taranır; her pencereye bir hareket adı verilir.
// 3. Aynı adı alan ardışık pencereler bölümlere birleştirilir, her bölüm için ölçümler hesaplanır.
// Ölçümler yaşa göre değerlendirilmez: bu hareketler için akademinin eşikleri yoktur.
import { prepare2D, ANALYZERS_2D, MP, hipMid, shMid, kneeAngle } from './video2d.js';
import {
  dist, deg, mean, std, percentile, median, min, max, smooth, winFor, findPeaks, findValleys,
  rollingPercentile, touchdowns, mergeEvents, downsample, round,
} from './util.js';
import { MOTIONS } from '../rules.js';

const WIN = 2.0; // pencere (sn)
const STEP = 0.5; // pencere kayması (sn)
const MIN_SHOT = 1.5; // bundan kısa çekimler analiz edilmez (sn)
const MIN_SEG = 1.5; // bundan kısa bölümler komşusuna katılır (sn)
const UP = 0.05; // ayak yerden kalkmış sayılır (vücut boyunun oranı)
const DOWN = 0.03; // ayak yerde sayılır
const MAX_STEPS_IN_PLACE = 3; // çömelme ve hamlede 2 sn'lik pencerede en fazla adım

// ------------------------------------------------------------- ÇEKİMLER
const SHAPE_PTS = [0, 11, 12, 23, 24, 25, 26, 27, 28]; // burun, omuzlar, kalçalar, dizler, ayak bilekleri
const SHAPE_CUT = 0.045; // bir karede duruş değişimi (vücut boyunun oranı); en hızlı gerçek harekette ~0,035

/**
 * Videoyu kesmelerden çekimlere ayırır. Kesme sayılan kare geçişleri:
 *  - kalça bir karede vücut boyunun %35'inden fazla kayar ya da kişi %30 büyür/küçülür,
 *  - duruş (eklemlerin kalçaya göre yeri) bir anda değişir: kadrajda aynı yerde duran başka bir kişiye geçiş.
 *    Sürekli hızlı harekette de duruş hızla değişir; bu yüzden çevresindeki karelerin en az 3 katı olan
 *    ani sıçramalar kesme sayılır.
 */
export function splitShots(frames, fps) {
  const info = frames.map((f) => {
    if (!f.k) return null;
    const k = f.k;
    const foot = Math.max(...[27, 28, 29, 30, 31, 32].map((i) => k[i][1]));
    const size = foot - k[MP.nose][1];
    const hip = [(k[23][0] + k[24][0]) / 2, (k[23][1] + k[24][1]) / 2];
    return size > 0 ? { hip, size, rel: SHAPE_PTS.map((i) => [k[i][0] - hip[0], k[i][1] - hip[1]]) } : null;
  });
  const shape = (a, b) => a.rel.reduce((x, p, j) => x + Math.hypot(p[0] - b.rel[j][0], p[1] - b.rel[j][1]), 0) / a.rel.length / Math.min(a.size, b.size);
  const jump = (a, b) => {
    const s = Math.min(a.size, b.size);
    return dist(a.hip, b.hip) > 0.35 * s || Math.max(a.size, b.size) / s > 1.3;
  };
  const same = (a, b) => !jump(a, b) && shape(a, b) <= SHAPE_CUT;
  const valid = info.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const d = valid.map((i, k) => (k ? shape(info[valid[k - 1]], info[i]) : 0));
  const spike = (k) => d[k] > SHAPE_CUT && d[k] > 3 * (median([...d.slice(Math.max(1, k - 6), k - 1), ...d.slice(k + 2, k + 7)]) ?? 0);
  const gapMax = Math.max(3, Math.round(0.3 * fps));
  const shots = [];
  if (!valid.length) return shots;
  let start = valid[0], last = valid[0];
  for (let k = 1; k < valid.length; k++) {
    const i = valid[k];
    const a = info[last], b = info[i];
    const cut = i - last > gapMax || jump(a, b) || (shape(a, b) > SHAPE_CUT && spike(k));
    if (!cut) { last = i; continue; }
    // Tek tük hatalı karede (model bir an başka yere atlar) kesme sayılmaz
    const blip = i - last <= gapMax && [1, 2, 3].some((dd) => valid[k + dd] != null && same(a, info[valid[k + dd]]));
    if (blip) continue;
    shots.push([start, last]);
    start = i;
    last = i;
  }
  shots.push([start, last]);
  return shots;
}

// --------------------------------------------------------------- SİNYALLER
function signals(D) {
  const { times, bodyH, fps } = D;
  const idx = times.map((_, i) => i);
  const hip = idx.map((i) => hipMid(D, i));
  const ground = rollingPercentile(D.footLow, Math.round(0.75 * fps), 0.9);
  const thigh = {}, lift = {}, knee = {}, footH = {}, raised = {}, lifted = {};
  for (const s of ['l', 'r']) {
    const hk = idx.map((i) => { const h = D.P(s + 'Hip', i), k = D.P(s + 'Knee', i); return h && k ? [h, k] : null; });
    // Uyluk öne kalkınca önden çekimde kısalmış görünür; gerçek boy için en uzun görünen değerler alınır
    thigh[s] = percentile(hk.map((p) => (p ? dist(p[0], p[1]) : null)), 0.9) || 0.25 * bodyH;
    // 0 = diz kalçanın tam altında (ayakta), 1 = diz kalça hizasında (uyluk yatay)
    lift[s] = hk.map((p) => (p ? Math.max(-0.5, Math.min(1.5, 1 - (p[1][1] - p[0][1]) / thigh[s])) : null));
    knee[s] = idx.map((i) => kneeAngle(D, s, i));
    // Ayak bileğinin dize göre yüksekliği: -1 = bilek dizin tam altında, 0 = diz hizasında (düz bacak öne savrulmuş)
    const ka = idx.map((i) => { const k = D.P(s + 'Knee', i), a = D.P(s + 'Ank', i); return k && a ? [k, a] : null; });
    const shin = percentile(ka.map((p) => (p ? dist(p[0], p[1]) : null)), 0.9) || 0.25 * bodyH;
    raised[s] = ka.map((p) => (p ? (p[0][1] - p[1][1]) / shin : null));
    // Her ayağın kendi zemini: gerçek kamerada arkadaki ayak (kameradan uzak) görüntüde daha yukarıda durur.
    // Ortak zeminden en fazla boyun %8'i kadar yukarıda olabilir; daha yukarıdaki ayak gerçekten havadadır (denge).
    const foot = s === 'l' ? D.footL : D.footR;
    const own = rollingPercentile(foot, Math.round(1.5 * fps), 0.9);
    footH[s] = foot.map((v, i) => {
      if (v == null || ground[i] == null) return null;
      const g = own[i] == null ? ground[i] : Math.max(own[i], ground[i] - 0.08 * bodyH);
      return (g - v) / bodyH;
    });
  }
  // Ayak gerçekten kaldırılmış mı: ayak yerden yüksekte VE o dizi öteki dizden belirgin yukarıda (diz çekme, denge)
  // ya da ayak çok yüksekte (topuk kalçaya). Yalnızca ayak yüksekliğine bakılmaz: gerçek kamerada arkadaki ayak
  // (hamlede parmak ucunda, kameradan uzak) ve yarı gizli ayak görüntüde yukarıda durur.
  for (const [s, o] of [['l', 'r'], ['r', 'l']]) {
    lifted[s] = idx.map((i) => {
      const h = footH[s][i], ks = D.P(s + 'Knee', i), ko = D.P(o + 'Knee', i);
      if (h == null || !ks || !ko) return null;
      return h > UP && ((ko[1] - ks[1]) / bodyH >= 0.06 || h >= 0.2);
    });
  }
  const lean = idx.map((i) => {
    const s = shMid(D, i), h = hip[i];
    return s && h ? deg(Math.atan2(s[0] - h[0], h[1] - s[1])) : null;
  });
  const width = smooth(idx.map((i) => {
    const a = D.P('lSh', i), b = D.P('rSh', i), c = D.P('lHip', i), d = D.P('rHip', i);
    return a && b && c && d ? (Math.abs(a[0] - b[0]) + Math.abs(c[0] - d[0])) / 2 / D.torsoLen : null;
  }), winFor(0.08, fps));
  // Eklemlerin ortalama hızı (vücut boyu / sn): hareketsiz duruşu ayırmak için
  const parts = ['lWr', 'rWr', 'lAnk', 'rAnk', 'lKnee', 'rKnee', 'nose'];
  const speed = idx.map((i) => {
    if (i === 0) return null;
    const dt = times[i] - times[i - 1];
    return dt > 0 ? mean(parts.map((p) => { const a = D.P(p, i - 1), b = D.P(p, i); return a && b ? dist(a, b) : null; })) / bodyH / dt : null;
  });

  // Ayak temasları (koşu, yürüyüş, yana kayma adımları)
  const td = { thr: DOWN, minSwing: 0.06 };
  const steps = mergeEvents([...touchdowns(times, footH.l, td), ...touchdowns(times, footH.r, td)], 0.1);

  // İki ayakla sıçramalar: iki ayak birlikte yerden kesilir ve hemen öncesinde ikisi de yerdedir.
  // Koşu ve diz çekmedeki uçuşta bir ayak zaten havadadır; bu koşulu sağlamaz.
  const flights = [];
  const both = (i, pred) => footH.l[i] != null && footH.r[i] != null && pred(footH.l[i]) && pred(footH.r[i]);
  for (let i = 1; i < times.length; i++) {
    if (!both(i, (v) => v > DOWN) || both(i - 1, (v) => v > DOWN)) continue;
    let j = i;
    while (j < times.length && both(j, (v) => v > DOWN)) j++;
    if (j >= times.length) break;
    const t0 = times[i], t1 = times[j];
    let groundedBefore = false;
    for (let k = i - 1; k >= 0 && t0 - times[k] <= 0.2; k--) if (both(k, (v) => v <= DOWN)) { groundedBefore = true; break; }
    const pre = hip[i - 1];
    const rise = pre ? max(hip.slice(i, j).map((h) => (h ? (pre[1] - h[1]) / bodyH : null))) : null;
    if (t1 - t0 >= 0.1 && t1 - t0 <= 0.9 && groundedBefore && rise != null && rise >= 0.02) flights.push({ t0, t1 });
    i = j;
  }
  return { hip, thigh, lift, knee, footH, raised, lifted, lean, width, speed, steps, flights };
}

const viewOf = (wr) => (wr == null ? 'bilinmiyor' : wr >= 0.33 ? 'ön' : wr <= 0.2 ? 'yan' : 'çapraz');
const frac = (arr, pred) => {
  const a = arr.filter((v) => v != null);
  return a.length ? a.filter(pred).length / a.length : 0;
};

/** Diz kaldırma tepe noktaları (her iki taraf için). */
function liftPeaks(D, S, ids) {
  const t = ids.map((i) => D.times[i]);
  const out = {};
  for (const s of ['l', 'r']) {
    out[s] = findPeaks(ids.map((i) => S.lift[s][i]), t, { minProminence: 0.3, minSeparation: 0.2 }).filter((p) => p.v >= 0.4);
  }
  return out;
}

/** Kalçanın en alçak noktaları (çömelme, hamle tekrarları). y aşağı doğru arttığı için tepe noktalarıdır. */
const hipDips = (D, S, ids) => findPeaks(ids.map((i) => S.hip[i]?.[1] ?? null), ids.map((i) => D.times[i]), { minProminence: 0.06 * D.bodyH, minSeparation: 0.5 });

// ----------------------------------------------------------- PENCERE ÖZELLİKLERİ
function features(D, S, ids) {
  const { bodyH, times } = D;
  const t0 = times[ids[0]], t1 = times[ids[ids.length - 1]];
  const dur = Math.max(t1 - t0, 1e-6);
  const hx = ids.map((i) => S.hip[i]?.[0]), hy = ids.map((i) => S.hip[i]?.[1]);
  const pk = liftPeaks(D, S, ids);
  // Diz çekmede dizler sırayla kalkar; çömelmede ikisi aynı anda (uyluklar birlikte yataylaşır)
  const all = [...pk.l.map((p) => ({ ...p, s: 'l' })), ...pk.r.map((p) => ({ ...p, s: 'r' }))];
  const alone = all.filter((p) => !all.some((q) => q.s !== p.s && Math.abs(q.t - p.t) < 0.15)).length;
  // Tepe anında bilek dizin yarı boyundan daha az aşağıdaysa bacak düz savrulmuştur (tekme), bükükse diz çekmedir
  const kicks = all.filter((p) => (S.raised[p.s][ids[p.i]] ?? -1) > -0.5).length;
  // Kalçanın en alçakta olduğu kareler: hamlede bir diz yere yakın, çömelmede iki diz aynı yükseklikte
  const low = percentile(hy, 0.8);
  const bottom = ids.filter((i) => S.hip[i] && S.hip[i][1] >= low);
  const kneeDiff = mean(bottom.map((i) => { const a = D.P('lKnee', i), b = D.P('rKnee', i); return a && b ? Math.abs(a[1] - b[1]) / bodyH : null; }));
  const ankleSep = mean(bottom.map((i) => { const a = D.P('lAnk', i), b = D.P('rAnk', i); return a && b ? Math.abs(a[0] - b[0]) / bodyH : null; }));
  const w = ids.map((i) => S.width[i]);
  const wRange = (percentile(w, 0.95) ?? 0) - (percentile(w, 0.05) ?? 0);
  return {
    travel: hx.some((v) => v != null) ? (percentile(hx, 0.98) - percentile(hx, 0.02)) / bodyH : 0,
    hipRange: hy.some((v) => v != null) ? (percentile(hy, 0.95) - percentile(hy, 0.05)) / bodyH : 0,
    peaksL: pk.l.length, peaksR: pk.r.length, alternating: all.length ? alone / all.length : 0,
    kickFrac: all.length ? kicks / all.length : 0,
    upL: frac(ids.map((i) => S.lifted.l[i]), (v) => v), upR: frac(ids.map((i) => S.lifted.r[i]), (v) => v),
    downL: frac(ids.map((i) => S.footH.l[i]), (v) => v <= DOWN), downR: frac(ids.map((i) => S.footH.r[i]), (v) => v <= DOWN),
    // İki ayağın birlikte havada göründüğü süre: sıçrama dışında yüksekse kamera hareketlidir ya da kişi yaklaşıp uzaklaşıyordur
    bothUp: frac(ids.map((i) => (S.footH.l[i] == null || S.footH.r[i] == null ? null : Math.min(S.footH.l[i], S.footH.r[i]))), (v) => v > UP),
    steps: S.steps.filter((t) => t >= t0 && t <= t1).length,
    stepRate: (S.steps.filter((t) => t >= t0 && t <= t1).length / dur) * 60,
    jumps: S.flights.filter((f) => f.t0 >= t0 && f.t1 <= t1).length,
    widthRange: wRange,
    widthValleys: findValleys(w, ids.map((i) => times[i]), { minProminence: Math.max(0.12, 0.35 * wRange), minSeparation: 0.12 }).length,
    kneeDiff: kneeDiff ?? 0, ankleSep: ankleSep ?? 0,
    speed: median(ids.map((i) => S.speed[i])) ?? 0,
    view: viewOf(median(ids.map((i) => {
      const a = D.P('lSh', i), b = D.P('rSh', i), c = D.P('lHip', i), d = D.P('rHip', i);
      return a && b && c && d ? (Math.abs(a[0] - b[0]) + Math.abs(c[0] - d[0])) / 2 / D.torsoLen : null;
    }))),
  };
}

/** Bir pencereye hareket adı verir. Sıra önemlidir: daha belirgin hareketler önce denenir. */
export function classify(f) {
  if (f.jumps >= 1 && f.travel < 1.0) return 'jump';
  // İki bacak sırayla düz savruluyor (yürürken de yapılır, bu yüzden yer değiştirmeden önce bakılır)
  // Tekmede savrulan ayak gerçekten kalkar; hamlede öndeki uyluk da yataylaşır ama ayak yerde kalır
  if (f.peaksL >= 1 && f.peaksR >= 1 && f.kickFrac >= 0.6 && f.upL + f.upR >= 0.2) return 'legKick';
  // Kameraya dönük yana ilerleme; yana kaymada ayaklar az kalktığı için adım şartı aranmaz
  if (f.travel >= 1.0 && f.view === 'ön') return 'shuffle';
  if (f.travel >= 1.0 && f.steps >= 3) return f.stepRate >= 150 ? 'run' : 'walk';
  // Dönerken bacaklar kalkmaz; bacak savururken gövdenin açısı değişmesi dönme sayılmaz
  if (f.widthRange >= 0.25 && f.widthValleys >= 2 && f.travel < 0.8 && f.peaksL + f.peaksR <= 1) return 'spin';
  if (f.peaksL >= 1 && f.peaksR >= 1 && f.alternating >= 0.6 && f.upL >= 0.1 && f.upR >= 0.1) return 'highKnees';
  // Yana hamlede ayaklar geniş açık, kalça belirgin alçalır (zemin güvenilmez olsa da görünür)
  // Çömelme ve hamlede tekrar başına en fazla bir adım atılır. Top sürerken ya da kameraya doğru koşarken kalça da
  // alçalıp yükselir (yaklaşan çocuk görüntüde aşağı iner) ama adımlar sık ve süreklidir.
  const inPlace = f.steps <= MAX_STEPS_IN_PLACE;
  if (inPlace && f.view === 'ön' && f.ankleSep >= 0.4 && f.hipRange >= 0.12 && f.travel < 1.0) return 'sideLunge';
  if (inPlace && f.hipRange >= 0.08 && f.upL < 0.3 && f.upR < 0.3) {
    if (f.kneeDiff >= 0.08 || (f.view === 'yan' && f.ankleSep >= 0.3)) return 'lunge';
    return 'squat';
  }
  if ((f.peaksL >= 2 && f.peaksR === 0 && f.upL >= 0.2 && f.downR >= 0.5) || (f.peaksR >= 2 && f.peaksL === 0 && f.upR >= 0.2 && f.downL >= 0.5)) return 'legSwing';
  // Tek bacak düz savruluyor ama destek ayağı yerde durmuyor: yürürken atılan tekmelerin bir kısmı pencereye düşmüştür
  if (f.peaksL + f.peaksR >= 2 && f.kickFrac >= 0.6 && f.upL + f.upR >= 0.2) return 'legKick';
  if ((f.upL >= 0.7 && f.downR >= 0.85) || (f.upR >= 0.7 && f.downL >= 0.85)) return f.hipRange < 0.06 ? 'balance' : 'other';
  if (f.speed < 0.15 && f.hipRange < 0.03 && f.travel < 0.1) return 'still';
  return 'other';
}

// --------------------------------------------------------------- BÖLÜMLER
function segmentShot(D, S) {
  const { times } = D;
  const T0 = times[0], T1 = times[times.length - 1];
  const wins = [];
  const span = T1 - T0;
  const starts = [];
  if (span <= WIN) starts.push(T0);
  else for (let s = T0; s + WIN <= T1 + 1e-6; s += STEP) starts.push(s);
  if (span > WIN && starts[starts.length - 1] + WIN < T1 - 0.1) starts.push(T1 - WIN);
  for (const s of starts) {
    const ids = [];
    times.forEach((t, i) => { if (t >= s && t <= s + WIN) ids.push(i); });
    if (ids.length < 5) continue;
    const c = s + Math.min(WIN, span) / 2;
    wins.push({ c, label: classify(features(D, S, ids)) });
  }
  if (!wins.length) return [];
  // Tek pencerelik sapmalar (iki komşusu aynı, kendisi farklı) düzeltilir
  for (let k = 1; k < wins.length - 1; k++) {
    if (wins[k - 1].label === wins[k + 1].label && wins[k].label !== wins[k - 1].label) wins[k].label = wins[k - 1].label;
  }
  // Pencere merkezleri arasındaki orta noktalar bölüm sınırı olur
  let segs = [];
  wins.forEach((w, k) => {
    const a = k === 0 ? T0 : (wins[k - 1].c + w.c) / 2;
    const b = k === wins.length - 1 ? T1 : (w.c + wins[k + 1].c) / 2;
    const last = segs[segs.length - 1];
    if (last && last.label === w.label) last.end = b;
    else segs.push({ label: w.label, start: a, end: b });
  });
  // Kısa bölümler komşusuna katılır (önce en kısası)
  for (;;) {
    if (segs.length < 2) break;
    let k = -1, shortest = Infinity;
    segs.forEach((s, i) => { const d = s.end - s.start; if (d < MIN_SEG && d < shortest) { shortest = d; k = i; } });
    if (k < 0) break;
    const prev = segs[k - 1], next = segs[k + 1];
    const into = !prev ? next : !next ? prev : (prev.end - prev.start >= next.end - next.start ? prev : next);
    into.start = Math.min(into.start, segs[k].start);
    into.end = Math.max(into.end, segs[k].end);
    segs.splice(k, 1);
    segs = segs.reduce((acc, s) => {
      const l = acc[acc.length - 1];
      if (l && l.label === s.label) l.end = s.end; else acc.push(s);
      return acc;
    }, []);
  }
  return segs;
}

/** Tekrarlı hareketin periyodu (sn): bileşik sinyalin öz-ilintisinden. Belirgin bir tekrar yoksa null. */
function period(sig, fps) {
  const vals = sig.filter((v) => v != null);
  if (vals.length < 2 * fps) return null;
  const m = mean(vals);
  const x = sig.map((v) => (v == null ? 0 : v - m));
  const e = x.reduce((s, v) => s + v * v, 0);
  if (e < 1e-9) return null;
  const r = (lag) => { let s = 0; for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag]; return s / e; };
  const lo = Math.max(2, Math.round(0.3 * fps)), hi = Math.floor(x.length / 2);
  let prev = r(lo - 1), cur = r(lo);
  for (let lag = lo; lag < hi; lag++) {
    const next = r(lag + 1);
    if (cur > prev && cur >= next && cur >= 0.5) return lag / fps;
    prev = cur;
    cur = next;
  }
  return null;
}

const thighDeg = (lift) => (lift == null ? null : deg(Math.acos(Math.max(-1, Math.min(1, 1 - lift)))));

/** Bir bölümün ölçümleri (hepsi bilgi amaçlı). */
function segmentMetrics(D, S, seg) {
  const { times, bodyH, fps } = D;
  const ids = [];
  times.forEach((t, i) => { if (t >= seg.start && t <= seg.end) ids.push(i); });
  const dur = seg.end - seg.start;
  const m = {};
  const view = viewOf(median(ids.map((i) => S.width[i])));
  const lbl = seg.label;

  // Tekrar sayısı ve temposu
  const pk = liftPeaks(D, S, ids);
  const inSeg = (t) => t >= seg.start && t <= seg.end;
  if (['run', 'walk', 'shuffle'].includes(lbl)) {
    const n = S.steps.filter(inSeg).length;
    m.mSteps = n;
    if (n >= 2) m.mStepRate = round((n / dur) * 60, 0);
  } else if (lbl === 'jump') {
    const fl = S.flights.filter((f) => inSeg(f.t0));
    m.mReps = fl.length;
    if (fl.length) m.flightTime = round(max(fl.map((f) => f.t1 - f.t0)) * 1000, 0);
  } else if (lbl === 'spin') {
    const v = findValleys(ids.map((i) => S.width[i]), ids.map((i) => times[i]), { minProminence: 0.12, minSeparation: 0.12 });
    m.turns = round(v.length / 2, 1);
  } else if (['squat', 'lunge', 'sideLunge'].includes(lbl)) {
    m.mReps = hipDips(D, S, ids).length;
  } else if (['highKnees', 'legSwing', 'legKick'].includes(lbl)) {
    m.mReps = pk.l.length + pk.r.length;
  } else if (lbl === 'other') {
    // Bilinmeyen hareket tekrarlıysa tekrar sayısı periyottan bulunur
    const sig = ids.map((i) => {
      const parts = [S.hip[i] ? S.hip[i][1] / bodyH : null, S.lift.l[i], S.lift.r[i]];
      return parts.some((v) => v == null) ? null : parts.reduce((a, b) => a + b, 0);
    });
    const p = period(sig, fps);
    if (p) m.mReps = Math.max(1, Math.round(dur / p));
  }
  if (m.mReps === 0) delete m.mReps;
  if (m.mReps != null && m.mReps >= 2) m.mTempo = round((m.mReps / dur) * 60, 0);

  // Uyluğun dikeyle açısı: her iki çekim yönünde yaklaşık ölçülür. Çömelme ve hamlede derinliği,
  // diğer hareketlerde diz kaldırmayı gösterir.
  const kl = {};
  for (const s of ['l', 'r']) kl[s] = thighDeg(percentile(ids.map((i) => S.lift[s][i]), 0.95));
  const deep = ['squat', 'lunge', 'sideLunge'].includes(lbl);
  if (deep) {
    const d = lbl === 'squat' ? mean([kl.l, kl.r]) : max([kl.l, kl.r]);
    if (d != null) m.mDepth = round(d, 0);
  } else if (!['still', 'jump', 'spin'].includes(lbl)) {
    if (kl.l != null) m.mKneeLiftL = round(kl.l, 0);
    if (kl.r != null) m.mKneeLiftR = round(kl.r, 0);
  }
  // Diz bükülmesi: önden çekimde diz açısı kısalmış görünür, yalnızca yan/çapraz çekimde verilir
  const kf = {};
  for (const s of ['l', 'r']) { const a = percentile(ids.map((i) => S.knee[s][i]), 0.05); kf[s] = a == null ? null : 180 - a; }
  if (view !== 'ön' && lbl !== 'still') {
    if (kf.l != null) m.mKneeFlexL = round(kf.l, 0);
    if (kf.r != null) m.mKneeFlexR = round(kf.r, 0);
  }
  // Sol-sağ farkı: hareketin asıl ölçüsü üzerinden (çömelme/hamlede diz bükülmesi, diğerlerinde diz kaldırma)
  const pair = deep && view !== 'ön' ? kf : kl;
  if (!['still', 'balance', 'legSwing', 'lunge', 'sideLunge', 'jump', 'spin'].includes(lbl) && pair.l != null && pair.r != null && Math.max(pair.l, pair.r) >= 20) {
    m.mSideDiff = round((Math.abs(pair.l - pair.r) / Math.max(pair.l, pair.r)) * 100, 0);
  }
  // Kalça alçalması: en yüksek duruştan en alçak noktaya
  const hy = ids.map((i) => S.hip[i]?.[1]);
  const drop = percentile(hy, 0.95) != null ? ((percentile(hy, 0.95) - percentile(hy, 0.05)) / bodyH) * 100 : null;
  if (drop != null && (deep || lbl === 'other')) m.mHipDrop = round(drop, 0);
  // Gövde eğimi: dikeyden en büyük sapma (yandan öne/arkaya, önden yana)
  const tilt = percentile(ids.map((i) => (S.lean[i] == null ? null : Math.abs(S.lean[i]))), 0.9);
  if (tilt != null) m.mTrunkTilt = round(tilt, 0);
  // Yer değiştirme ve denge
  const hx = ids.map((i) => S.hip[i]?.[0]).filter((v) => v != null);
  // Uçlar kırpılır: tek karelik hatalı algılama yer değiştirme gibi görünmesin
  if (hx.length) m.mTravel = round(((percentile(hx, 0.98) - percentile(hx, 0.02)) / bodyH) * 100, 0);
  if (['balance', 'still'].includes(lbl) && hx.length > 2) m.mSway = round((std(hx) / bodyH) * 100, 1);
  if (lbl === 'balance') {
    const upSide = frac(ids.map((i) => S.lifted.l[i]), (v) => v) >= frac(ids.map((i) => S.lifted.r[i]), (v) => v) ? 'l' : 'r';
    m.mBalanceTime = round(ids.filter((i) => S.lifted[upSide][i]).length / fps, 1);
  }
  return { metrics: m, view };
}

// ------------------------------------------------------------- BİRLEŞTİRME
const SUM = ['mReps', 'mSteps', 'mBalanceTime', 'turns'];
const AVG = ['mSideDiff', 'mSway']; // süreyle ağırlıklı ortalama; diğerleri en büyük değer

/** Aynı hareketin birkaç bölümünün ölçümlerini birleştirir: sayılar toplanır, açılar ve mesafeler en büyüğü alınır. */
export function combineMetrics(parts) {
  const m = {};
  const total = parts.reduce((t, p) => t + p.dur, 0);
  const keys = new Set(parts.flatMap((p) => Object.keys(p.metrics || {})));
  for (const k of keys) {
    if (k === 'mTempo' || k === 'mStepRate') continue;
    const vals = parts.map((p) => ({ v: p.metrics?.[k], w: p.dur })).filter((x) => typeof x.v === 'number');
    if (!vals.length) continue;
    if (SUM.includes(k)) m[k] = round(vals.reduce((t, x) => t + x.v, 0), 1);
    else if (AVG.includes(k)) m[k] = round(vals.reduce((t, x) => t + x.v * x.w, 0) / Math.max(1e-6, vals.reduce((t, x) => t + x.w, 0)), 1);
    else m[k] = Math.max(...vals.map((x) => x.v));
  }
  if (m.mReps >= 2) m.mTempo = round((m.mReps / total) * 60, 0);
  if (m.mSteps >= 2) m.mStepRate = round((m.mSteps / total) * 60, 0);
  return m;
}

/**
 * Bölümleri hareket türüne göre toplar: [{key, count, total (sn), start, view, metrics}].
 * En uzun süren önce; tanımlanamayan hareket ve duruş en sonda.
 */
export function groupSegments(segments) {
  const by = new Map();
  for (const g of segments || []) {
    if (!by.has(g.key)) by.set(g.key, []);
    by.get(g.key).push(g);
  }
  const rank = (k) => (k === 'other' ? 1 : k === 'still' ? 2 : 0);
  return [...by.entries()].map(([key, list]) => {
    const dur = (g) => Math.max(0, g.end - g.start);
    const longest = list.reduce((a, b) => (dur(b) > dur(a) ? b : a));
    return {
      key, count: list.length, total: round(list.reduce((t, g) => t + dur(g), 0), 1), start: list[0].start, view: longest.view,
      metrics: combineMetrics(list.map((g) => ({ metrics: g.metrics, dur: dur(g) }))),
    };
  }).sort((a, b) => rank(a.key) - rank(b.key) || b.total - a.total);
}

// ------------------------------------------------------------------- GİRİŞ
/**
 * @returns {{invalid, view, metrics, motion: {main, segments}, warnings, charts, events}}
 */
export function analyzeMotion2D(frames, meta = {}) {
  const fps = meta.fps;
  const shots = splitShots(frames, fps);
  const warnings = [];
  const segments = [];
  const series = { t: [], l: [], r: [], hip: [] };
  const fmt = (t) => t.toFixed(1).replace('.', ',');
  let firstProblem = null;
  const unstable = [];
  if (shots.length > 1) warnings.push(`Videoda ${shots.length - 1} kesme (sahne geçişi ya da kadraja başka birinin girmesi) bulundu; her bölüm ayrı incelendi.`);

  for (const [a, b] of shots) {
    const sf = frames.slice(a, b + 1);
    const t0 = sf[0].t, t1 = sf[sf.length - 1].t;
    if (t1 - t0 < MIN_SHOT) continue;
    const D = prepare2D(sf, { ...meta, fps });
    if (D.invalid) {
      firstProblem ??= D.invalid;
      warnings.push(`${fmt(t0)}-${fmt(t1)} sn arası incelenemedi: ${D.invalid}`);
      continue;
    }
    const S = signals(D);
    const segs = segmentShot(D, S);
    // Puanlı testi olan hareketler (sıçrama, koşu, dönme) o testin kendi denetiminden de geçmeli.
    // Gövdeyi döndüren ısınma hareketleri dönme, kameraya yaklaşan adımlar sıçrama gibi görünebilir.
    for (const seg of segs) {
      const test = MOTIONS[seg.label]?.test;
      if (!test) continue;
      const part = sf.filter((f) => f.t >= seg.start - 0.5 && f.t <= seg.end + 0.5);
      const P = prepare2D(part, { ...meta, fps });
      if (P.invalid || ANALYZERS_2D[test](P).invalid) seg.label = 'other';
    }
    // Onaylanmayan bölümler komşu "other" bölümlerle birleşir
    for (let k = segs.length - 1; k > 0; k--) {
      if (segs[k].label === segs[k - 1].label) { segs[k - 1].end = segs[k].end; segs.splice(k, 1); }
    }
    const bothUp = frac(D.times.map((_, i) => (S.footH.l[i] == null || S.footH.r[i] == null ? null : Math.min(S.footH.l[i], S.footH.r[i]))), (v) => v > UP);
    if (bothUp > 0.4 && !segs.some((g) => g.label === 'jump')) unstable.push(`${fmt(t0)}-${fmt(t1)}`);
    for (const seg of segs) {
      const { metrics, view } = segmentMetrics(D, S, seg);
      segments.push({ key: seg.label, start: round(seg.start, 2), end: round(seg.end, 2), view, metrics });
    }
    D.times.forEach((t, i) => {
      series.t.push(t);
      series.l.push(thighDeg(S.lift.l[i]));
      series.r.push(thighDeg(S.lift.r[i]));
      series.hip.push(S.hip[i] ? ((D.footLow[i] ?? S.hip[i][1]) - S.hip[i][1]) / D.bodyH * 100 : null);
    });
    for (const w of D.warnings) if (!warnings.includes(w)) warnings.push(w);
  }

  if (unstable.length) {
    warnings.push(`${unstable.join(', ')} sn arasında kamera hareket ediyor ya da kişi kameraya yaklaşıp uzaklaşıyor gibi görünüyor; hareket tanıma ve ayak ölçümleri güvenilir olmayabilir. Telefonu sabit tutun (tripod).`);
  }
  // Kesmeyle bölünmüş aynı hareket (ör. iki ayrı açıdan çekilmiş diz çekme) tek bölüm olur
  for (let k = segments.length - 1; k > 0; k--) {
    const a = segments[k - 1], b = segments[k];
    if (a.key !== b.key || b.start - a.end > 0.5) continue;
    const da = a.end - a.start, db = b.end - b.start;
    a.metrics = combineMetrics([{ metrics: a.metrics, dur: da }, { metrics: b.metrics, dur: db }]);
    if (db > da) a.view = b.view;
    a.end = b.end;
    segments.splice(k, 1);
  }
  if (!segments.length) {
    return {
      invalid: firstProblem || 'Videoda incelenebilecek bir hareket bulunamadı. Çocuğun baştan ayağa göründüğü, en az 2 sn süren, kesintisiz bir çekim kullanın.',
      view: 'bilinmiyor', metrics: {}, motion: null, warnings, charts: [], events: [],
    };
  }

  // Asıl hareket: en uzun süren tanınmış hareket (yoksa en uzun bölüm)
  const dur = (s) => s.end - s.start;
  const known = segments.filter((s) => !['still', 'other'].includes(s.key));
  const main = (known.length ? known : segments).reduce((x, y) => (dur(y) > dur(x) ? y : x));
  if (segments.every((s) => s.key === 'other' || s.key === 'still')) {
    warnings.push('Hareket tanınamadı; yalnızca genel ölçümler verildi. Tek bir egzersizin, kesintisiz ve sabit kamerayla çekildiği videolar daha iyi sonuç verir.');
  }
  if (segments.some((s) => s.view === 'ön') && segments.some((s) => ['squat', 'lunge', 'sideLunge'].includes(s.key) && s.view === 'ön')) {
    warnings.push('Önden çekimde diz bükülme açısı ölçülemez; çömelme ve hamle için yandan çekim daha fazla ölçüm verir.');
  }

  // Grafikler: kesmelerde çizgi kopuk görünsün diye araya boş değer konur
  const marks = segments.map((s) => ({ t: s.start, label: ['other', 'still'].includes(s.key) ? '' : MOTIONS[s.key]?.short ?? '' }));
  const ds = (vals) => downsample(series.t, vals);
  const dl = ds(series.l), dr = ds(series.r), dh = ds(series.hip);
  const t = [];
  const gap = (v) => v.flatMap((x, i) => (i && dl.t[i] - dl.t[i - 1] > 0.3 ? [null, x] : [x]));
  dl.t.forEach((ti, i) => { if (i && ti - dl.t[i - 1] > 0.3) t.push(ti - 0.001); t.push(ti); });
  const charts = [
    { title: 'Diz kaldırma, uyluğun dikeyle açısı (°)', t, series: [{ name: 'Sol', v: gap(dl.v) }, { name: 'Sağ', v: gap(dr.v) }], marks },
    { title: 'Kalça yüksekliği (vücut boyunun %)', t, series: [{ name: 'Kalça', v: gap(dh.v) }], marks },
  ];

  return {
    invalid: null,
    view: main.view,
    metrics: main.metrics,
    motion: { main: main.key, segments, cuts: Math.max(0, shots.length - 1) },
    warnings,
    charts,
    events: segments.map((s) => ({ start: s.start })),
  };
}
