// Antrenör girişi, oturum ve hesap yönetimi. Hesaplar sunucuda (Supabase) tutulur.
// Şifre sunucuya gönderilmez: tarayıcı kullanıcı adı + şifreden PBKDF2-SHA256 ile bir anahtar türetir,
// sunucu yalnızca bu anahtarın özetini saklar ve karşılaştırır.
import { rpc } from './api.js';
import { pbkdf2Hex } from './kdf.js';

export { pbkdf2Hex };
export const ITERATIONS = 600000;
export const USERNAME_RE = /^[a-z0-9çğıöşüâîû._-]{3,32}$/;
export const MIN_PASSWORD = 8;

export const normalizeUser = (u) => String(u ?? '').trim().toLocaleLowerCase('tr');
// Anahtar kullanıcı adı ve şifreden birlikte türetilir; aynı birleştirme tools/hesap.js içinde de kullanılır.
export const credential = (user, password) => `${normalizeUser(user)}\n${password}`;

// --------------------------------------------------------------- ANAHTAR TÜRETME
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker === false) return null;
  try {
    worker ??= new Worker(new URL('./kdf-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { pending.get(e.data.id)?.resolve(e.data.key); pending.delete(e.data.id); };
    worker.onerror = () => {
      // Modül iş parçacığı desteklenmiyorsa ana iş parçacığında hesaplanır
      worker = false;
      for (const [id, p] of pending) { pending.delete(id); p.fallback(); }
    };
    return worker;
  } catch {
    worker = false;
    return null;
  }
}

async function deriveKey(user, password, salt, iterations) {
  const pw = credential(user, password);
  const w = getWorker();
  if (!w) {
    await new Promise((r) => setTimeout(r, 30)); // düğme durumu ekrana yansısın
    return pbkdf2Hex(pw, salt, iterations);
  }
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, { resolve, fallback: () => resolve(pbkdf2Hex(pw, salt, iterations)) });
    w.postMessage({ id, password: pw, salt, iterations });
  });
}

const randomSalt = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Yeni şifre için sunucuya gidecek {p_salt, p_iterations, p_key}. Şifrenin kendisi gönderilmez. */
async function newSecret(user, password) {
  const salt = randomSalt();
  return { p_salt: salt, p_iterations: ITERATIONS, p_key: await deriveKey(user, password, salt, ITERATIONS) };
}

async function currentKey(user, password) {
  const s = await rpc('auth_salt', { p_username: normalizeUser(user) });
  return deriveKey(user, password, s.salt, s.iterations);
}

export function checkNewPassword(pass, again) {
  if (String(pass).length < MIN_PASSWORD) return `Şifre en az ${MIN_PASSWORD} karakter olmalı.`;
  if (again != null && pass !== again) return 'Şifreler aynı değil.';
  return null;
}

// ------------------------------------------------------------------ OTURUM
const SESSION_KEY = 'oturum';
let memory = null; // localStorage kullanılamazsa (gizli sekme vb.) yalnızca bu açılış için

function readSession() {
  let s = memory;
  try { s = JSON.parse(localStorage.getItem(SESSION_KEY)) ?? s; } catch { /* erişilemiyor */ }
  // Önceki sürümün (sunucusuz) oturum kaydı geçersizdir
  return s?.token && s?.user?.username ? s : null;
}
function writeSession(s) {
  memory = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY);
  } catch { /* yoksay */ }
}

// Cihaz anahtarları ({kullanıcı adı: anahtar}). Oturum kapanınca silinmez: başka yerden yapılan hatalı denemeler
// hesabı kilitlese bile bu cihazdan giriş yapılabilir (sunucu her cihazın denemelerini ayrı sayar).
const DEVICE_KEY = 'cihaz';
const readDevices = () => { try { return JSON.parse(localStorage.getItem(DEVICE_KEY)) || {}; } catch { return {}; } };
function saveDevice(user, device) {
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify({ ...readDevices(), [user]: device })); } catch { /* yoksay */ }
}

export const token = () => readSession()?.token ?? null;
/** {username, role, share} ya da null */
export const currentUser = () => readSession()?.user ?? null;
export const isAdmin = () => currentUser()?.role === 'admin';

function setUser(user) {
  const s = readSession();
  if (s) writeSession({ ...s, user });
}

/** Kayıtlı oturumu sunucuda doğrular ve kullanıcı bilgisini tazeler. Oturum geçersizse null. */
export async function refreshSession() {
  const t = token();
  if (!t) return null;
  try {
    const user = await rpc('auth_session', { p_token: t });
    setUser(user);
    return user;
  } catch (e) {
    if (e.code === '28000') { writeSession(null); return null; }
    throw e;
  }
}

/** Başarılıysa kullanıcıyı döndürür; değilse hata metniyle Error fırlatır. */
export async function login(user, password) {
  const u = normalizeUser(user);
  const key = await currentKey(u, password);
  const r = await rpc('auth_login', { p_username: u, p_key: key, p_device: readDevices()[u] ?? null });
  if (r?.error || !r?.token) throw new Error(r?.error || 'Giriş yapılamadı.');
  if (r.device) saveDevice(u, r.device);
  writeSession({ token: r.token, user: r.user });
  return r.user;
}

export async function logout() {
  const t = token();
  writeSession(null);
  if (t) { try { await rpc('auth_logout', { p_token: t }); } catch { /* çevrimdışı: yerelde kapatmak yeter */ } }
}

/** Yerelde oturumu kapatır (sunucu oturumu zaten geçersizse). */
export const forget = () => writeSession(null);

// ------------------------------------------------------------- HESAP İŞLEMLERİ
/** Kendi şifresini değiştirir (mevcut şifre gerekir). */
export async function changeOwnPassword(oldPass, newPass) {
  const me = currentUser().username;
  const oldKey = await currentKey(me, oldPass);
  await rpc('auth_set_password', { p_token: token(), p_username: me, p_old_key: oldKey, ...(await newSecret(me, newPass)) });
}

/** Yönetici: bir antrenörün şifresini değiştirir. */
export async function setCoachPassword(username, newPass) {
  await rpc('auth_set_password', { p_token: token(), p_username: username, p_old_key: null, ...(await newSecret(username, newPass)) });
}

export async function addCoach(username, password) {
  const u = normalizeUser(username);
  if (!USERNAME_RE.test(u)) throw new Error('Kullanıcı adı 3-32 karakter olmalı; harf, rakam, nokta, alt çizgi ve kısa tire kullanılabilir.');
  await rpc('coach_add', { p_token: token(), p_username: u, ...(await newSecret(u, password)) });
  return u;
}

export const listCoaches = () => rpc('coach_list', { p_token: token() });
export const deleteCoach = (username, transfer) => rpc('coach_delete', { p_token: token(), p_username: username, p_transfer: transfer });

export async function setShare(on) {
  const user = await rpc('set_share', { p_token: token(), p_share: !!on });
  setUser(user);
  return user;
}
