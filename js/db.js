// Veri katmanı. Oyuncular, analizler ve iskelet verileri sunucuda (Supabase) tutulur; videolar hiçbir zaman
// gönderilmez. Kim neyi görebilir ve değiştirebilir, sunucudaki fonksiyonlar denetler:
//  * antrenör kendi oyuncularını görür ve değiştirir,
//  * "oyuncularımı paylaş" açık olan antrenörlerin oyuncularını diğerleri yalnızca görür,
//  * yönetici hepsini görür ve değiştirir.
// Önceki sürümde veriler cihazda (IndexedDB) tutuluyordu; bu kayıtlar legacy* fonksiyonlarıyla sunucuya aktarılır.
import { rpc } from './api.js';
import { token } from './auth.js';

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const call = (fn, body = {}) => rpc(fn, { p_token: token(), ...body });

const byName = (a, b) => a.name.localeCompare(b.name, 'tr');

/** Görülebilen bütün oyuncular: {..., owner, mine, editable, analysisCount, recentCount, last} */
export const listPlayers = async () => (await call('player_list')).sort(byName);

/** {player, analyses (özet, yeniden eskiye)} ya da null */
export const getPlayer = (id) => call('player_get', { p_id: id });
export const savePlayer = (p) => call('player_save', { p_player: p });
export const deletePlayer = (id) => call('player_delete', { p_id: id });

/** {analysis, skeleton, player} ya da null */
export const getAnalysis = (id) => call('analysis_get', { p_id: id });
/** skeleton verilmezse sunucudaki iskelet korunur (ör. yalnızca not güncellenirken). */
export const saveAnalysis = (a, skeleton = null) => call('analysis_save', { p_analysis: a, p_skeleton: skeleton });
export const deleteAnalysis = (id) => call('analysis_delete', { p_id: id });

/**
 * Bu cihazdaki eski kayıtları giriş yapan hesaba yükler.
 * Kimliği başka bir antrenörün kaydına denk gelen kayıtlar yeni kimlikle eklenir.
 */
export async function importRecords(data, onProgress) {
  const players = data.players || [];
  const analyses = (data.analyses || []).filter((a) => a.playerId && a.test);
  const skel = new Map((data.skeletons || []).map((s) => [s.id, s.data]));
  const taken = await call('ids_taken', { p_player_ids: players.map((p) => p.id), p_analysis_ids: analyses.map((a) => a.id) });
  const remap = {};
  for (const id of [...taken.players, ...taken.analyses]) remap[id] = newId();
  const total = players.length + analyses.length;
  let n = 0;
  for (const { owner: _o, mine: _m, editable: _e, ...p } of players) {
    if (!p.id || !p.name) continue;
    await savePlayer({ ...p, id: remap[p.id] ?? p.id });
    onProgress?.(++n, total);
  }
  const known = new Set(players.map((p) => p.id));
  for (const { owner: _o, ...a } of analyses) {
    // Oyuncusu aktarılanlar arasında olmayan analiz, sunucuda zaten var olan bir oyuncuya ait olabilir
    const rec = { ...a, id: remap[a.id] ?? a.id, playerId: remap[a.playerId] ?? a.playerId };
    try {
      await saveAnalysis(rec, skel.get(a.id) ?? null);
    } catch (e) {
      if (known.has(a.playerId) || e.code !== 'P0002') throw e;
    }
    onProgress?.(++n, total);
  }
  return n;
}

// ------------------------------------------------------- CİHAZDAKİ ESKİ VERİ
const STORES = ['players', 'analyses', 'skeletons'];

function legacyDb() {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve(null);
    let req;
    try { req = indexedDB.open('form-analiz', 1); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

/** Bu cihazda, önceki sürümde bu hesapla (ya da giriş sistemi öncesinde) kaydedilmiş kayıtlar. */
export async function legacyRecords(username) {
  const idb = await legacyDb();
  if (!idb) return null;
  try {
    const out = {};
    for (const s of STORES) {
      out[s] = (await wrap(idb.transaction(s).objectStore(s).getAll())).filter((r) => !r.owner || r.owner === username);
    }
    return out.players.length || out.analyses.length ? out : null;
  } finally {
    idb.close();
  }
}

/** Sunucuya aktarılmış eski kayıtları cihazdan siler. */
export async function legacyRemove(records) {
  const idb = await legacyDb();
  if (!idb) return;
  try {
    for (const s of STORES) {
      const st = idb.transaction(s, 'readwrite').objectStore(s);
      await Promise.all((records[s] || []).map((r) => wrap(st.delete(r.id))));
    }
  } finally {
    idb.close();
  }
}
