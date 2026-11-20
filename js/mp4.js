// MP4 / MOV dosyasının başlığından video kare hızını okur. Videoyu oynatarak ölçmeye göre daha güvenilirdir:
// ekranın yenilenme hızına ve sekmenin görünür olup olmamasına bağlı değildir. Dosyanın tamamı belleğe
// alınmaz, yalnızca kutu başlıkları ve "moov" kutusu okunur.

const COMMON_FPS = [24, 25, 30, 48, 50, 60, 90, 100, 120, 240];

const readU32 = (dv, o) => dv.getUint32(o);
const readU64 = (dv, o) => dv.getUint32(o) * 2 ** 32 + dv.getUint32(o + 4);

/** Dosyanın en üst düzeydeki kutularını gezip "moov" kutusunu döndürür. */
async function findMoov(file) {
  let off = 0;
  for (let guard = 0; off + 8 <= file.size && guard < 1000; guard++) {
    const head = new DataView(await file.slice(off, off + 16).arrayBuffer());
    let size = readU32(head, 0);
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    let hdr = 8;
    if (size === 1) { size = readU64(head, 8); hdr = 16; } else if (size === 0) size = file.size - off;
    if (size < hdr) return null;
    if (type === 'moov') {
      if (size > 64 * 1024 * 1024) return null;
      return new DataView(await file.slice(off + hdr, off + size).arrayBuffer());
    }
    off += size;
  }
  return null;
}

/** dv içindeki [start, end) aralığında verilen türdeki alt kutuları sırayla verir. */
function* boxes(dv, start = 0, end = dv.byteLength) {
  let off = start;
  while (off + 8 <= end) {
    let size = readU32(dv, off);
    const type = String.fromCharCode(dv.getUint8(off + 4), dv.getUint8(off + 5), dv.getUint8(off + 6), dv.getUint8(off + 7));
    let hdr = 8;
    if (size === 1) { size = readU64(dv, off + 8); hdr = 16; } else if (size === 0) size = end - off;
    if (size < hdr || off + size > end) return;
    yield { type, start: off + hdr, end: off + size };
    off += size;
  }
}
const child = (dv, box, type) => {
  for (const b of boxes(dv, box.start, box.end)) if (b.type === type) return b;
  return null;
};

/** Video izinin ortalama kare hızı; okunamazsa null. */
export async function fpsFromFile(file) {
  try {
    if (!file?.slice) return null;
    const dv = await findMoov(file);
    if (!dv) return null;
    for (const trak of boxes(dv)) {
      if (trak.type !== 'trak') continue;
      const mdia = child(dv, trak, 'mdia');
      const hdlr = mdia && child(dv, mdia, 'hdlr');
      if (!hdlr || String.fromCharCode(...[8, 9, 10, 11].map((i) => dv.getUint8(hdlr.start + i))) !== 'vide') continue;
      const mdhd = child(dv, mdia, 'mdhd');
      const stbl = child(dv, child(dv, mdia, 'minf') || mdia, 'stbl');
      const stts = stbl && child(dv, stbl, 'stts');
      if (!mdhd || !stts) continue;
      const timescale = readU32(dv, mdhd.start + (dv.getUint8(mdhd.start) === 1 ? 20 : 12));
      const entries = readU32(dv, stts.start + 4);
      let samples = 0;
      let ticks = 0;
      for (let i = 0; i < entries; i++) {
        const o = stts.start + 8 + i * 8;
        if (o + 8 > stts.end) break;
        const n = readU32(dv, o);
        samples += n;
        ticks += n * readU32(dv, o + 4);
      }
      if (!timescale || !ticks || samples < 2) continue;
      const raw = samples / (ticks / timescale);
      const near = COMMON_FPS.find((f) => Math.abs(f - raw) / f < 0.04);
      return near ?? Math.round(raw);
    }
  } catch { /* okunamayan dosya: oynatarak ölçülür */ }
  return null;
}
