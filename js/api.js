// Sunucu (Supabase) çağrıları. Site yalnızca supabase/kurulum.sql içindeki fonksiyonları çağırır.
import { API_URL, API_KEY } from './config.js';

export const apiConfigured = () => !!API_URL;

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Oturum geçersizleşince (süre doldu, şifre değişti, hesap silindi) bu olay tetiklenir
export const SESSION_EXPIRED = 'leo:oturum-bitti';

export async function rpc(fn, body = {}) {
  if (!API_URL) throw new ApiError('Sunucu ayarlanmamış (web/js/config.js).', 'config');
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (API_KEY) {
    headers.apikey = API_KEY;
    // Eski tip (JWT) anon anahtarı Authorization başlığında da gönderilir; yeni "sb_publishable_" anahtarı gönderilmez
    if (API_KEY.startsWith('eyJ')) headers.authorization = `Bearer ${API_KEY}`;
  }
  let res;
  try {
    res = await fetch(`${API_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new ApiError('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.', 'network');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* boş ya da JSON olmayan yanıt */ }
  if (!res.ok) {
    const code = data?.code || String(res.status);
    if (code === '28000') window.dispatchEvent(new Event(SESSION_EXPIRED));
    // Kendi fonksiyonlarımızın hata metinleri Türkçe ve kullanıcıya gösterilebilir; PostgREST'inkiler değil
    const msg = data?.message && !code.startsWith('PGRST') ? data.message
      : res.status >= 500 ? `Sunucuya şu an ulaşılamıyor (${res.status}). Biraz sonra tekrar deneyin.`
        : `Sunucu hatası (${res.status}). Biraz sonra tekrar deneyin.`;
    throw new ApiError(msg, code);
  }
  return data;
}
