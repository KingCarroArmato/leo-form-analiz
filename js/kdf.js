// PBKDF2-HMAC-SHA256 (saf JS). crypto.subtle http üzerinden açılan sayfalarda bulunmayabildiği için
// kullanılmaz. Aynı hesap tools/hesap.js içinde Node'un crypto modülüyle yapılır.

// ------------------------------------------------------------------ SHA-256
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const IV = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const W = new Uint32Array(64);

// W[0..15] içindeki 64 baytlık bloğu H durumuna uygular, sonucu out'a yazar (out === H olabilir)
function compress(H, out) {
  for (let i = 16; i < 64; i++) {
    const x = W[i - 15];
    const y = W[i - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  out[0] = H[0] + a; out[1] = H[1] + b; out[2] = H[2] + c; out[3] = H[3] + d;
  out[4] = H[4] + e; out[5] = H[5] + f; out[6] = H[6] + g; out[7] = H[7] + h;
}

// H0 durumundan devam ederek bytes'ı özetler; prefixLen, H0'a daha önce işlenmiş bayt sayısıdır (64'ün katı)
function digest(H0, prefixLen, bytes) {
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  const bits = (prefixLen + bytes.length) * 8;
  dv.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  dv.setUint32(padded.length - 4, bits >>> 0);
  const H = Uint32Array.from(H0);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    compress(H, H);
  }
  return H;
}

const wordsToBytes = (words) => {
  const out = new Uint8Array(words.length * 4);
  const dv = new DataView(out.buffer);
  words.forEach((w, i) => dv.setUint32(i * 4, w));
  return out;
};
const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** PBKDF2-HMAC-SHA256, 32 baytlık anahtar. Sonuç onaltılık metin. */
export function pbkdf2Hex(password, saltHex, iterations) {
  let key = new TextEncoder().encode(String(password).normalize('NFC'));
  if (key.length > 64) key = wordsToBytes(digest(IV, 0, key));
  const block = new Uint8Array(64);
  block.set(key);
  const padState = (x) => {
    for (let i = 0; i < 16; i++) W[i] = ((block[i * 4] ^ x) << 24) | ((block[i * 4 + 1] ^ x) << 16) | ((block[i * 4 + 2] ^ x) << 8) | (block[i * 4 + 3] ^ x);
    const H = Uint32Array.from(IV);
    compress(H, H);
    return H;
  };
  const inner = padState(0x36);
  const outer = padState(0x5c);

  const salt = hexToBytes(saltHex);
  const first = new Uint8Array(salt.length + 4);
  first.set(salt);
  first[salt.length + 3] = 1; // blok sırası: INT(1)
  const U = digest(outer, 64, wordsToBytes(digest(inner, 64, first)));
  const T = Uint32Array.from(U);
  const tmp = new Uint32Array(8);
  // Sonraki turlarda ileti hep 32 bayt: dolgu sabit, blok başına bir sıkıştırma yeter
  const load = (src) => {
    for (let i = 0; i < 8; i++) W[i] = src[i];
    W[8] = 0x80000000;
    for (let i = 9; i < 15; i++) W[i] = 0;
    W[15] = (64 + 32) * 8;
  };
  for (let n = 1; n < iterations; n++) {
    load(U); compress(inner, tmp);
    load(tmp); compress(outer, U);
    for (let i = 0; i < 8; i++) T[i] ^= U[i];
  }
  return toHex(wordsToBytes(T));
}
