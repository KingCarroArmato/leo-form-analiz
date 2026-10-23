// Videodan iskelet çıkarma (MediaPipe Pose Landmarker). Kütüphane ve modeller
// uygulamanın içinde (vendor/mediapipe) gömülüdür: hiçbir dosya internetten indirilmez,
// video ve sonuçlar cihazdan çıkmaz.
import { personOf, personAt, associate, follow, cropAround, cropStillFits, tiles, mergePeople, toGray, bgShift } from './track.js';

const VENDOR = new URL('../vendor/mediapipe/', import.meta.url);
const MODELS = {
  heavy: new URL('models/pose_landmarker_heavy.task', VENDOR).href, // Hassas
  full: new URL('models/pose_landmarker_full.task', VENDOR).href, // Hızlı
};

const MAX_POSES = 4;
let cache = { key: null, landmarker: null };
// VIDEO modunda MediaPipe zaman damgalarının, aynı model üzerinde art arda işlenen bütün videolar boyunca
// sürekli artmasını ister; geri giderse ("Packet timestamp mismatch") model bozulur. Bu yüzden zaman
// damgası videodan değil bu sayaçtan verilir.
let clock = 0;
let blank = null;

const dropLandmarker = () => {
  try { cache.landmarker?.close?.(); } catch { /* yoksay */ }
  cache = { key: null, landmarker: null };
};

async function getLandmarker(model) {
  if (cache.key === model && cache.landmarker) return cache.landmarker;
  dropLandmarker();
  const { PoseLandmarker, FilesetResolver } = await import(new URL('vision_bundle.mjs', VENDOR).href);
  const fileset = await FilesetResolver.forVisionTasks(new URL('wasm', VENDOR).href);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODELS[model] || MODELS.heavy, delegate },
    runningMode: 'VIDEO',
    // Kadrajda birden fazla kişi olabilir: analiz edilecek çocuk adaylar arasından takip edilerek seçilir
    numPoses: MAX_POSES,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let lm;
  try {
    lm = await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
  } catch {
    lm = await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
  }
  cache = { key: model, landmarker: lm };
  return lm;
}

const STALLED = 'Video yanıt vermiyor. Sayfayı yenileyip tekrar deneyin.';

// Olayı bekler. Video değiştirilir ya da boşaltılırsa ("emptied") veya hiç yanıt gelmezse beklemede takılı kalmaz.
const once = (el, ev, ms = 15000) => new Promise((res, rej) => {
  const done = (fn, arg) => {
    clearTimeout(timer);
    el.removeEventListener(ev, ok);
    el.removeEventListener('error', bad);
    el.removeEventListener('emptied', gone);
    fn(arg);
  };
  const ok = () => done(res);
  const bad = () => done(rej, new Error('Video okunamadı. Farklı bir video deneyin.'));
  const gone = () => done(rej, new Error('İptal edildi'));
  const timer = setTimeout(() => done(rej, new Error(STALLED)), ms);
  el.addEventListener(ev, ok);
  el.addEventListener('error', bad);
  el.addEventListener('emptied', gone);
});

// Hata ayrıntısında gösterilir: kaç kez yeniden denemenin işe yaradığı
let rescued = 0;

// Videoyu yeniden yükler: "sayfayı yenile"nin yalnızca video için karşılığı. load() bir "emptied" olayı da
// tetikler; once() bu olayı iptal saydığı için yükleme beklenmeden önce o geçirilir.
async function reload(video) {
  const emptied = new Promise((r) => { video.addEventListener('emptied', r, { once: true }); setTimeout(r, 1000); });
  video.load();
  await emptied;
  await once(video, 'loadeddata', 10000);
}

// iPhone Safari'de bir kareye atlama bazen yarıda kalır ve "seeked" olayı hiç gelmez (rastgele, aynı video bir
// seferinde takılıp bir sonrakinde takılmayabilir). Takılınca sırayla: aynı kareye yeniden atlanır (1 ms kaydırarak,
// aynı zamana atlama yok sayılabildiği için), video kısa bir oynat/durdur ile canlandırılır, en son video yeniden
// yüklenir. Ekran kilitlenip sayfa arka plana geçtiğinde geçen süre deneme sayılmaz.
async function seekTo(video, t) {
  for (let tries = 0; ;) {
    video.currentTime = Math.min(t + tries * 0.001, video.duration);
    try {
      await once(video, 'seeked', 5000);
      if (tries) rescued++;
      return;
    } catch (e) {
      if (e.message !== STALLED) throw e;
      // Olay kaçmış ama atlama tamamlanmış olabilir
      if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - t) < 0.01) { rescued++; return; }
      if (document.hidden) continue;
      if (++tries > 3) throw e;
      if (tries === 2) { video.play()?.catch(() => {}); video.pause(); }
      if (tries === 3) await reload(video);
    }
  }
}

// Telefonda oluşan hatanın nedenini ekran görüntüsünden anlayabilmek için videonun o anki durumu
const describe = (video, extra) => [
  extra,
  `konum ${video.currentTime.toFixed(3)}/${video.duration.toFixed(3)}`,
  `rs ${video.readyState} ns ${video.networkState}`,
  `seeking ${+video.seeking} paused ${+video.paused} hidden ${+document.hidden}`,
  `kurtarma ${rescued}`,
  video.error ? `hata ${video.error.code}` : '',
  `${video.videoWidth}x${video.videoHeight}`,
  `s3 ${navigator.userAgent.match(/(CriOS|FxiOS|EdgiOS|Version)\/[\d.]+/)?.[0] || ''}`,
].filter(Boolean).join(' · ');

const COMMON_FPS = [24, 25, 30, 50, 60, 120, 240];

/** Videonun kare hızını oynatma sırasında ölçer (requestVideoFrameCallback). */
export async function detectFps(video) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return 30;
  const times = [];
  const wasMuted = video.muted;
  video.muted = true;
  video.currentTime = 0;
  await once(video, 'seeked').catch(() => {});
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; video.pause(); resolve(); } };
    const cb = (_now, md) => {
      times.push(md.mediaTime);
      if (times.length >= 20) finish(); else video.requestVideoFrameCallback(cb);
    };
    video.requestVideoFrameCallback(cb);
    video.play().catch(finish);
    setTimeout(finish, 1500);
  });
  video.muted = wasMuted;
  const d = [];
  for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) d.push(times[i] - times[i - 1]);
  if (d.length < 3) return 30;
  d.sort((a, b) => a - b);
  const raw = 1 / d[Math.floor(d.length * 0.25)];
  return COMMON_FPS.reduce((b, f) => (Math.abs(f - raw) < Math.abs(b - raw) ? f : b), 30);
}

let queue = Promise.resolve();
// Aynı model aynı anda tek bir işi yapabilir; üst üste başlatılan işler (analiz, kişi arama) sırayla çalışır
const enqueue = (fn) => {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Modelin önceki karelerden kalan takibini siler: boş bir kare, bir sonraki karede kişilerin baştan aranmasını
// sağlar. Araya bir saniyelik boşluk da bırakılır.
function resetTracking(landmarker) {
  blank ??= Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
  clock += 1000;
  landmarker.detectForVideo(blank, clock);
}

// Kişinin çevresinden kırpılan bölge modele bu boyutta verilir (uzaktaki küçük çocuk büyütülmüş olur)
const CROP_PX = 512;
let cropCanvas = null;

/** Videonun o anki karesindeki kişiler. crop ([sx, sy, kenar, kenar]) verilirse yalnızca o bölgede aranır. */
function detect(landmarker, video, crop, ts) {
  const W = video.videoWidth, H = video.videoHeight;
  let src = video;
  let map = (p) => [p.x * W, p.y * H, p.visibility ?? 1];
  if (crop) {
    const [sx, sy, side] = crop;
    cropCanvas ??= Object.assign(document.createElement('canvas'), { width: CROP_PX, height: CROP_PX });
    cropCanvas.getContext('2d').drawImage(video, sx, sy, side, side, 0, 0, CROP_PX, CROP_PX);
    src = cropCanvas;
    map = (p) => [sx + p.x * side, sy + p.y * side, p.visibility ?? 1];
  }
  const res = landmarker.detectForVideo(src, ts);
  return (res.landmarks || []).map((lm) => personOf(lm.map(map)));
}

/**
 * Seçilen kişiyi kare kare takip eder: her karede kişiler kişinin çevresindeki bölgede aranır ve önceki kareye en
 * uygun olan alınır. Kişi bulunamayan karede null döner ve arama alanı genişler; başka birine (antrenör, yanından
 * geçen çocuk) atlanmaz. Seçim yoksa ilk karede en büyük görünen kişi alınır.
 */
function tracker(landmarker, W, H, first) {
  let cur = first ? follow(null, first) : null;
  let lost = 0;
  let crop;
  return (video, ts) => {
    const ideal = cur ? cropAround(cur, W, H, lost) : null;
    if (crop === undefined || !cropStillFits(crop, ideal)) {
      // Bölge değişince modelin eski bölgedeki takibi yanıltıcı olur
      if (crop !== undefined) resetTracking(landmarker);
      crop = ideal;
    }
    const people = detect(landmarker, video, crop, ts());
    const p = cur ? associate(cur, people, lost) : people.reduce((a, b) => (!a || b.h > a.h ? b : a), null);
    if (p) { cur = follow(cur, p, lost); lost = 0; } else lost++;
    return { pts: p ? p.k : null, people };
  };
}

// Kamera hareketi küçültülmüş gri görüntülerden ölçülür
const CAM_W = 128;
let camCanvas = null;
function grayFrame(video) {
  const W = video.videoWidth, H = video.videoHeight;
  const w = CAM_W, h = Math.max(16, Math.round((CAM_W * H) / W));
  camCanvas ??= document.createElement('canvas');
  if (camCanvas.width !== w || camCanvas.height !== h) Object.assign(camCanvas, { width: w, height: h });
  const ctx = camCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  return { g: toGray(ctx.getImageData(0, 0, w, h).data, w, h), w, h, s: W / w };
}

/**
 * Videonun t anındaki (verilmezse o anki) karesinde kişileri bulur: [{box, hip, h, k}]. Uzaktaki küçük çocuklar
 * bütün karede bulunamayabileceği için kare parçalara bölünüp her parçaya da bakılır.
 * at ([x, y], video pikseli) verilirse yalnızca o noktadaki kişi döner; noktanın çevresinde giderek küçülen
 * bölgelere bakılır.
 */
export function findPeople(video, { t, at, model = 'heavy' } = {}) {
  return enqueue(async () => {
    const landmarker = await getLandmarker(model);
    if (video.readyState < 2) await once(video, 'loadeddata');
    if (t != null && Math.abs(video.currentTime - t) > 0.001) await seekTo(video, t);
    const W = video.videoWidth, H = video.videoHeight;
    const look = (crop) => {
      resetTracking(landmarker);
      clock += 1;
      return detect(landmarker, video, crop, clock);
    };
    // Kalçası kadraj dışında kalan (çatıdaki, tabeladaki şekiller) ya da boyundan çok daha geniş (yan yana iki kişi
    // tek sanılmış) algılamalar elenir
    const ok = (p) => p.hip[0] >= 0 && p.hip[0] <= W && p.hip[1] >= 0 && p.hip[1] <= H && !p.wide;
    const all = look(null);
    if (!at) return mergePeople([...all, ...tiles(W, H).flatMap(look)]).filter(ok);
    const near = [0.6, 0.35, 0.2].flatMap((f) => {
      const side = Math.round(Math.min(W, H) * f);
      return look([Math.round(clamp(at[0] - side / 2, 0, W - side)), Math.round(clamp(at[1] - side / 2, 0, H - side)), side, side]);
    });
    const p = personAt([...all, ...near].filter(ok), at[0], at[1]);
    return p ? [p] : [];
  });
}

/**
 * Videoyu kare kare analiz eder.
 * target: {t, person} antrenörün seçtiği çocuk (findPeople sonucu) ve seçildiği an; verilirse yalnızca o takip edilir.
 * @returns {{frames: {t:number, k:number[][]|null, c:number[]}[], meta: {fps,width,height}}}
 *   c: kamera yolu, arka planın ilk kareye göre kayması (piksel)
 */
export function processVideo(video, opts = {}) {
  return enqueue(() => processOne(video, opts)).catch((e) => {
    // Kare döngüsünden önce oluşan hatalarda da teknik ayrıntı gösterilsin
    if (e.message !== 'İptal edildi') e.detail ??= describe(video, 'hazırlık');
    throw e;
  });
}

async function processOne(video, { start = 0, end, model = 'heavy', maxFps = 60, knownFps, target, onProgress, isCancelled } = {}) {
  onProgress?.({ phase: 'model', ratio: 0 });
  const landmarker = await getLandmarker(model);
  if (video.readyState < 1) await once(video, 'loadedmetadata');
  // Kare verisi henüz yüklenmediyse önce o beklenir (iPhone'da yükleme ancak oynatma isteğinden sonra başlar)
  if (video.readyState < 2) await once(video, 'loadeddata').catch((e) => { if (e.message !== STALLED) throw e; });
  // Kare hızı verilmediyse video oynatılarak ölçülür
  const srcFps = knownFps || (await detectFps(video));
  const fps = Math.min(srcFps, maxFps);
  const step = 1 / fps;
  const stop = Math.min(end ?? video.duration, video.duration - step / 2);
  const W = video.videoWidth;
  const H = video.videoHeight;
  const total = Math.max(1, Math.floor((stop - start) * fps));
  // Seçim yapıldıysa takip seçilen kareden başlar: önce sona doğru, sonra seçilen kareden başa doğru
  const k0 = target ? clamp(Math.round((target.t - start) / step), 0, total) : 0;
  const passes = [[k0, total, 1], ...(k0 > 0 ? [[k0 - 1, 0, -1]] : [])];
  const frames = new Array(total + 1);
  const t0 = performance.now();
  let k = k0;
  let done = 0;
  let seekT = start;
  let first = null; // seçilen karenin gri görüntüsü ve kişileri: geri geçişte kamera yolu buradan devam eder
  rescued = 0;

  try {
    for (const [from, to, dir] of passes) {
      // Önceki videodaki (ya da önceki geçişteki) takip bu geçişe taşınmasın
      resetTracking(landmarker);
      const base = clock + 1;
      const track = tracker(landmarker, W, H, target?.person ?? null);
      let prev = dir > 0 ? null : first;
      for (k = from; dir > 0 ? k <= to : k >= to; k += dir) {
        if (isCancelled?.()) throw new Error('İptal edildi');
        const t = start + k * step;
        seekT = Math.min(t + step / 2, video.duration);
        await seekTo(video, seekT);
        const ts = () => (clock = Math.max(clock + 1, base + Math.round(Math.abs(k - from) * step * 1000)));
        const { pts, people } = track(video, ts);
        // Kamera yolu: arka planın bir önceki işlenen kareye göre kayması toplanır. Kişilerin üstü kullanılmaz.
        const img = grayFrame(video);
        const masks = people.map((p) => p.box.map((v) => v / img.s));
        let c = [0, 0];
        if (prev) {
          const d = bgShift(prev.g, img.g, img.w, img.h, [...prev.masks, ...masks]);
          c = d ? [prev.c[0] + d[0] * img.s, prev.c[1] + d[1] * img.s] : prev.c;
        }
        prev = { g: img.g, masks, c };
        if (k === k0 && dir > 0) first = prev;
        frames[k] = {
          t: Math.round((t - start) * 1000) / 1000,
          k: pts,
          c: [Math.round(c[0] * 10) / 10, Math.round(c[1] * 10) / 10],
        };
        if (++done % 3 === 0) {
          const el = (performance.now() - t0) / 1000;
          onProgress?.({ phase: 'frames', ratio: done / (total + 1), eta: (el / done) * (total + 1 - done), frame: done, total: total + 1 });
        }
      }
    }
  } catch (e) {
    // MediaPipe hatası modeli kullanılamaz bırakır; bir sonraki analiz yeni bir modelle başlar
    if (e.message !== 'İptal edildi') {
      dropLandmarker();
      e.detail = describe(video, `kare ${k}/${total} hedef ${seekT.toFixed(3)} fps ${srcFps}`);
    }
    throw e;
  }
  return { frames, meta: { fps, srcFps, width: W, height: H } };
}
