import * as db from './db.js';
import * as auth from './auth.js';
import { apiConfigured, SESSION_EXPIRED } from './api.js';
import { TESTS, MOTIONS, RULES, STATUS_LABEL, formatValue, buildReport, evaluateMotion, scoreReport } from './rules.js';
import { runAnalysis } from './analysis/index.js';
import { groupSegments } from './analysis/motion.js';
import { lineChart } from './charts.js';
import { mountReplay } from './replay.js';
import { fpsFromFile } from './mp4.js';
import { icon, TEST_ICON } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (iso) => new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const ageOf = (p, at = new Date()) => (p?.birthYear ? new Date(at).getFullYear() - Number(p.birthYear) : null);
// Oyuncu sayfasında ve gelişim grafiğinde gösterilen ölçüm. Serbest hareket puanlanmadığı için yoktur.
const KEY_METRIC = { jump: 'jumpHeight', run: 'cadence', spin: 'turnTime', free: null };
const fmtSec = (v) => (Number(v) || 0).toFixed(1).replace('.', ',');
const motionName = (key, short = false) => (MOTIONS[key] ? MOTIONS[key][short ? 'short' : 'name'] : 'Hareket');

const pref = (key, fallback, allowed) => {
  try { const v = localStorage.getItem(key); return allowed.includes(v) ? v : fallback; } catch { return fallback; }
};
const setPref = (key, v) => { try { localStorage.setItem(key, v); } catch { /* yoksay */ } };
const settings = {
  get model() { return pref('model', 'heavy', ['heavy', 'full']); },
  set model(v) { setPref('model', v); },
  get roster() { return pref('kadro', 'mine', ['mine', 'all']); },
  set roster(v) { setPref('kadro', v); },
};

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('role', 'status');
  t.innerHTML = `${icon(kind === 'warn' ? 'alert' : 'check', 16)}<span>${esc(msg)}</span>`;
  document.body.append(t);
  setTimeout(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, kind === 'warn' ? 4200 : 2600);
}

// Sayfa içi pencere. confirm()/prompt() kullanılmaz: bazı gömülü tarayıcılarda ve Safari'de "diyalogları engelle"
// seçildikten sonra hiç gösterilmeden false döner.
// buttons: [{v, label, kind: 'ghost' | 'primary' | 'danger'}]. Form alanı varsa gönderilen değerler {v, values} olarak döner.
function dialog({ title, message = '', body = '', buttons, validate }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<form class="sheet form" role="alertdialog" aria-modal="true" aria-labelledby="dlgTitle" ${message ? 'aria-describedby="dlgMsg"' : ''} novalidate>
      <h2 id="dlgTitle">${esc(title)}</h2>
      ${message ? `<p id="dlgMsg" class="muted">${esc(message)}</p>` : ''}${body}
      <p class="login-error hidden" role="alert">${icon('alert', 16)}<span></span></p>
      <div class="form-actions ${buttons.length > 2 ? 'stack' : ''}">${buttons.map((b) => `<button type="${b.submit ? 'submit' : 'button'}" class="btn ${b.kind || 'ghost'}" data-v="${esc(b.v)}">${esc(b.label)}</button>`).join('')}</div></form>`;
    const form = wrap.firstElementChild;
    const close = (v) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const values = () => Object.fromEntries([...form.querySelectorAll('input[name]')].map((i) => [i.name, i.type === 'checkbox' ? i.checked : i.value]));
    const submit = async (v) => {
      if (validate) {
        // Sunucu yanıtı beklenirken ikinci kez gönderilmesin
        const btns = form.querySelectorAll('button');
        if (form.dataset.busy) return;
        form.dataset.busy = '1';
        btns.forEach((b) => { b.disabled = true; });
        const err = await validate(v, values());
        delete form.dataset.busy;
        btns.forEach((b) => { b.disabled = false; });
        if (err) {
          const box = form.querySelector('.login-error');
          box.querySelector('span').textContent = err;
          box.classList.remove('hidden');
          return;
        }
      }
      close(body ? { v, values: values() } : v);
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) return close(null);
      const b = e.target.closest('button[type=button][data-v]');
      if (!b) return;
      if (b.dataset.v === '0') close(null); else submit(b.dataset.v);
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(e.submitter?.dataset.v ?? buttons.find((b) => b.submit)?.v); });
    wrap.addEventListener('dismiss', () => close(null));
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
    (form.querySelector('input') || form.querySelector('[data-v="0"]') || form.querySelector('button')).focus();
  });
}

/** Evet/hayır onayı. true ya da false döner. */
async function ask(message, { title = 'Emin misiniz?', ok = 'Sil', cancel = 'Vazgeç', danger = true } = {}) {
  const buttons = [...(cancel ? [{ v: '0', label: cancel }] : []), { v: '1', label: ok, kind: danger ? 'danger' : 'primary' }];
  return (await dialog({ title, message, buttons })) === '1';
}

// Uzun süren işlerde ekranı kapatan bekleme penceresi
function busy(text) {
  const wrap = document.createElement('div');
  wrap.className = 'modal show';
  wrap.innerHTML = `<div class="sheet" role="status" aria-live="polite"><div class="progress-top"><strong>${esc(text)}</strong><span class="pct"></span></div><div class="bar"><span style="width:0"></span></div></div>`;
  document.body.append(wrap);
  return {
    update(n, total) {
      const r = total ? n / total : 0;
      wrap.querySelector('.bar span').style.width = `${Math.round(r * 100)}%`;
      wrap.querySelector('.pct').textContent = total ? `${n}/${total}` : '';
    },
    close: () => wrap.remove(),
  };
}

function setNav(name) {
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

const errMsg = (e) => e?.message || 'Bilinmeyen hata';

// ------------------------------------------------------------------ YÖNLENDİRME
const routes = [
  [/^#\/?$/, () => viewPlayers()],
  [/^#\/oyuncular$/, () => viewPlayers()],
  [/^#\/oyuncu\/([\w-]+)$/, (m) => viewPlayer(m[1])],
  [/^#\/analiz(?:\?oyuncu=([\w-]+))?(?:&test=(\w+))?$/, (m) => viewNewAnalysis(m[1], m[2])],
  [/^#\/rapor\/([\w-]+)$/, (m) => viewReport(m[1])],
  [/^#\/ayarlar$/, () => viewSettings()],
];

// Sayfalar veri beklerken başka bir sayfaya geçilirse eski sayfa ekrana yazılmamalı.
// Her yönlendirme bir sıra numarası alır. Sayfa açılırken `const live = current()` ile kendi denetimini alır
// ve her beklemeden sonra live() ile hâlâ ekranda olup olmadığını sorar.
let routeSeq = 0;
const current = () => { const seq = routeSeq; return () => seq === routeSeq; };
let cleanup = null;
const onLeave = (live, fn) => { if (live()) cleanup = fn; else fn(); };

async function route() {
  ++routeSeq;
  const live = current();
  const prev = cleanup;
  cleanup = null;
  prev?.();
  document.querySelectorAll('.modal').forEach((m) => m.dispatchEvent(new Event('dismiss')));
  const user = auth.currentUser();
  document.body.classList.toggle('locked', !user);
  if (!user) { viewLogin(); return; }
  const h = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      try {
        await fn(m);
      } catch (e) {
        console.error(e);
        if (live() && e.code !== '28000') {
          app.innerHTML = `<div class="card error"><h2>Sayfa açılamadı</h2><p>${esc(errMsg(e))}</p><button class="btn" id="retry" style="margin-top:12px">Tekrar dene</button></div>`;
          $('#retry').onclick = route;
        }
      }
      if (live()) window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', route);

window.addEventListener(SESSION_EXPIRED, () => {
  if (!auth.currentUser()) return;
  auth.forget();
  toast('Oturumunuz sona erdi. Lütfen yeniden giriş yapın.', 'warn');
  route();
});

// ------------------------------------------------------------------------ GİRİŞ
function viewLogin() {
  setNav('');
  app.innerHTML = `
    <section class="login">
      <div class="login-brand"><img class="logo lg" src="icons/icon-192.png" alt="">
        <p class="kicker">Antrenör girişi</p><h1>Leo Futbol Akademisi</h1><p class="muted">Form Analiz</p></div>
      ${apiConfigured() ? `
      <form id="loginForm" class="card form" autocomplete="on">
        <label>Kullanıcı adı<input name="user" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
        <label>Şifre<input name="pass" type="password" autocomplete="current-password" required></label>
        <p class="login-error hidden" id="loginError" role="alert">${icon('alert', 16)}<span></span></p>
        <button class="btn primary block" id="loginBtn">${icon('lock', 17)}<span>Giriş yap</span></button>
      </form>` : `
      <div class="card warn">
        <h2>Sunucu henüz ayarlanmadı</h2>
        <p>Supabase projesinin adresini ve anahtarını <code>web/js/config.js</code> dosyasına yazın (README: "Sunucu kurulumu").</p>
      </div>`}
      <p class="privacy">${icon('lock', 16)}<span>Videolar telefonunuzdan çıkmaz. Yalnızca oyuncu bilgileri ve analiz sonuçları akademinin hesabında saklanır.</span></p>
    </section>`;
  const f = $('#loginForm');
  if (!f) return;
  f.user.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn');
    const err = $('#loginError');
    if (!f.user.value.trim() || !f.pass.value) return;
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Giriş yapılıyor…';
    err.classList.add('hidden');
    try {
      await auth.login(f.user.value, f.pass.value);
    } catch (ex) {
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Giriş yap';
      f.pass.value = '';
      f.pass.focus();
      err.querySelector('span').textContent = errMsg(ex);
      err.classList.remove('hidden');
      return;
    }
    await route();
    offerLegacyImport();
  };
}

// Önceki sürümde bu cihazda (tarayıcıda) kaydedilmiş veriler varsa sunucuya aktarmayı önerir
async function offerLegacyImport({ always = false } = {}) {
  const user = auth.currentUser();
  if (!user) return false;
  let recs;
  try { recs = await db.legacyRecords(user.username); } catch (e) { console.error(e); return false; }
  if (!recs) { if (always) toast('Bu cihazda aktarılacak eski kayıt yok'); return false; }
  const msg = `Bu cihazda önceki sürümde kaydedilmiş ${recs.players.length} oyuncu ve ${recs.analyses.length} analiz var. Hesabınıza aktarılırsa her cihazdan görebilirsiniz.`;
  if (!(await ask(msg, { title: 'Eski kayıtlar bulundu', ok: 'Hesabıma aktar', cancel: 'Şimdi değil', danger: false }))) return false;
  const b = busy('Kayıtlar aktarılıyor…');
  try {
    await db.importRecords(recs, (n, t) => b.update(n, t));
    await db.legacyRemove(recs);
  } catch (e) {
    console.error(e);
    b.close();
    toast(`Aktarılamadı: ${errMsg(e)}`, 'warn');
    return false;
  }
  b.close();
  toast('Eski kayıtlar hesabınıza aktarıldı');
  route();
  return true;
}

// --------------------------------------------------------------------- OYUNCULAR
const ownerNote = (p) => (p.mine ? '' : `<span class="owner">${icon(p.editable ? 'players' : 'eye', 13)}${esc(p.owner)}</span>`);

async function viewPlayers() {
  const live = current();
  setNav('players');
  const all = await db.listPlayers();
  if (!live()) return;
  const others = all.filter((p) => !p.mine).length;
  const filter = others ? settings.roster : 'all';
  const players = filter === 'mine' ? all.filter((p) => p.mine) : all;
  const analyses = players.reduce((s, p) => s + p.analysisCount, 0);
  const recent = players.reduce((s, p) => s + p.recentCount, 0);
  const shared = auth.isAdmin() ? 'Bütün antrenörlerin oyuncuları' : 'Paylaşılan oyuncular';
  app.innerHTML = `
    <header class="page-head">
      <div><p class="kicker">Kadro</p><h1>Oyuncular</h1></div>
      <button class="btn primary" id="add">${icon('plus', 18)}Oyuncu ekle</button>
    </header>
    <form id="addForm" class="card form hidden" autocomplete="off">
      <div class="card-head"><h2>Yeni oyuncu</h2></div>
      ${playerFields({})}
      <div class="form-actions"><button type="button" class="btn ghost" id="cancelAdd">Vazgeç</button><button class="btn primary">Kaydet</button></div>
    </form>
    ${others ? `
      <div class="segmented" role="tablist" aria-label="Gösterilen oyuncular">
        <button role="tab" data-f="mine" aria-selected="${filter === 'mine'}">Oyuncularım <span>${all.length - others}</span></button>
        <button role="tab" data-f="all" aria-selected="${filter === 'all'}">Tümü <span>${all.length}</span></button>
      </div>
      ${filter === 'all' ? `<p class="hint seg-hint">${icon('eye', 14)}<span>${shared} da listede. ${auth.isAdmin() ? 'Yönetici olarak hepsini düzenleyebilirsiniz.' : 'Başka antrenörün oyuncusunu yalnızca görüntüleyebilirsiniz.'}</span></p>` : ''}` : ''}
    ${players.length ? `
      <div class="stats">
        <div class="stat"><p class="kicker">Oyuncu</p><strong>${players.length}</strong></div>
        <div class="stat"><p class="kicker">Analiz</p><strong>${analyses}</strong></div>
        <div class="stat"><p class="kicker">Son 30 gün</p><strong>${recent}</strong></div>
      </div>
      ${players.length > 6 ? `<label class="search">${icon('search', 18)}<input id="q" type="search" placeholder="Oyuncu ara" autocomplete="off" aria-label="Oyuncu ara"></label>` : ''}
      <ul class="roster" id="roster">
        ${players.map((p) => {
          const a = p.last;
          return `<li data-name="${esc(`${p.name} ${p.mine ? '' : p.owner}`.toLocaleLowerCase('tr'))}"><a class="row-link" href="#/oyuncu/${p.id}">
            ${avatar(p.name)}
            <span class="grow"><strong>${esc(p.name)}</strong>
              <small>${ageOf(p) != null ? `${ageOf(p)} yaş` : 'Yaş girilmedi'}${p.position ? ` · ${esc(p.position)}` : ''}${ownerNote(p)}</small></span>
            <span class="last-test">${a ? `<b>${icon(TEST_ICON[a.test], 14)}${TESTS[a.test]?.short ?? ''}</b>${fmtDate(a.date)}` : 'Analiz yok'}</span>
            ${icon('chevron', 18)}
          </a></li>`;
        }).join('')}
      </ul>
      <p class="hint hidden" id="noMatch">Aramaya uyan oyuncu yok.</p>` : `
      <div class="empty card">
        <svg class="art" viewBox="0 0 132 84" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <rect x="1" y="1" width="130" height="82" rx="6"/><path d="M66 1v82"/><circle cx="66" cy="42" r="14"/>
          <path d="M1 22h18v40H1M131 22h-18v40h18"/><circle cx="66" cy="42" r="1.5" fill="currentColor"/>
        </svg>
        <h2>${filter === 'mine' ? 'Henüz oyuncunuz yok' : 'Kadro henüz boş'}</h2>
        <p class="muted">İlk oyuncuyu ekleyin, ardından zıplama, koşu veya dönme testi kaydedin.</p>
        <button class="btn primary" id="addEmpty">${icon('plus', 18)}Oyuncu ekle</button>
      </div>`}`;
  const form = $('#addForm');
  const openForm = () => { form.classList.remove('hidden'); form.name.focus(); };
  $('#add').onclick = openForm;
  $('#addEmpty')?.addEventListener('click', openForm);
  document.querySelectorAll('.segmented [data-f]').forEach((b) => b.addEventListener('click', () => { settings.roster = b.dataset.f; viewPlayers(); }));
  $('#q')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLocaleLowerCase('tr');
    let shown = 0;
    document.querySelectorAll('#roster li').forEach((li) => { li.hidden = !!q && !li.dataset.name.includes(q); shown += !li.hidden; });
    $('#noMatch').classList.toggle('hidden', shown > 0);
  });
  $('#cancelAdd').onclick = () => form.classList.add('hidden');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const p = readPlayerForm(form);
    if (!p.name) return toast('Ad soyad gerekli', 'warn');
    const btn = form.querySelector('.btn.primary');
    btn.disabled = true;
    try {
      await db.savePlayer({ id: db.newId(), createdAt: new Date().toISOString(), ...p });
    } catch (ex) {
      btn.disabled = false;
      return toast(`Kaydedilemedi: ${errMsg(ex)}`, 'warn');
    }
    toast('Oyuncu eklendi');
    if (filter === 'mine' || !others) viewPlayers(); else { settings.roster = 'mine'; viewPlayers(); }
  };
}

const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toLocaleUpperCase('tr')).join('');
// Her oyuncuya adından türeyen sabit bir renk tonu
const HUES = [150, 205, 28, 265, 345, 85, 185, 10];
const hueOf = (n) => HUES[[...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length];
const avatar = (name, cls = '') => `<span class="avatar ${cls}" style="--h:${hueOf(name)}">${esc(initials(name))}</span>`;

function playerFields(p) {
  const y = new Date().getFullYear();
  return `
    <label>Ad soyad<input name="name" required maxlength="80" value="${esc(p.name)}" placeholder="Örn. Ali Yılmaz"></label>
    <div class="row">
      <label>Doğum yılı<input name="birthYear" type="number" inputmode="numeric" min="${y - 20}" max="${y - 3}" value="${esc(p.birthYear)}" placeholder="${y - 10}"></label>
      <label>Boy (cm)<input name="heightCm" type="number" inputmode="numeric" min="80" max="210" value="${esc(p.heightCm)}" placeholder="İsteğe bağlı"></label>
    </div>
    <label>Mevki<input name="position" maxlength="40" value="${esc(p.position)}" placeholder="İsteğe bağlı"></label>
    <label>Not<textarea name="notes" rows="2" maxlength="1000" placeholder="İsteğe bağlı">${esc(p.notes)}</textarea></label>
    <p class="hint">Doğum yılı, yaşa göre değerlendirme eşikleri için kullanılır. Boy, video analizinde sıçrama ölçümünü biraz daha hassas yapar.</p>`;
}

function readPlayerForm(f) {
  const num = (v, lo, hi) => {
    const n = Number(v);
    return v !== '' && Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null;
  };
  const y = new Date().getFullYear();
  return {
    name: f.name.value.trim().replace(/\s+/g, ' '),
    birthYear: num(f.birthYear.value, y - 25, y - 2),
    heightCm: num(f.heightCm.value, 60, 230),
    position: f.position.value.trim(),
    notes: f.notes.value.trim(),
  };
}

// Başka antrenörün oyuncusunda gösterilen bilgi satırı
const readonlyNote = (p) => (p.editable ? '' : `
  <div class="card readonly row center">${icon('eye', 18)}<span>Bu oyuncu <b>${esc(p.owner)}</b> antrenörüne ait. Bilgilerini ve sonuçlarını görebilirsiniz; değişiklik yapamazsınız.</span></div>`);

// ----------------------------------------------------------------- OYUNCU DETAY
async function viewPlayer(id) {
  const live = current();
  setNav('players');
  const r = await db.getPlayer(id);
  if (!live()) return;
  if (!r) { toast('Oyuncu bulunamadı ya da görme yetkiniz yok', 'warn'); location.hash = '#/'; return; }
  const { player: p, analyses } = r;
  const byTest = { jump: [], run: [], spin: [], free: [] };
  for (const a of analyses) byTest[a.test]?.push(a);
  const ed = p.editable;

  app.innerHTML = `
    <a class="back" href="#/oyuncular">${icon('back', 18)}Oyuncular</a>
    <header class="profile">
      ${avatar(p.name, 'lg')}
      <div class="grow"><h1>${esc(p.name)}</h1>
        <div class="chips">
          ${ageOf(p) != null ? `<span class="chip"><b>${ageOf(p)}</b> yaş</span>` : ''}
          ${p.heightCm ? `<span class="chip"><b>${esc(p.heightCm)}</b> cm</span>` : ''}
          ${p.position ? `<span class="chip">${esc(p.position)}</span>` : ''}
          <span class="chip"><b>${analyses.length}</b> analiz</span>
          ${p.mine ? '' : `<span class="chip">${icon(ed ? 'players' : 'eye', 13)}Antrenör: <b>${esc(p.owner)}</b></span>`}
        </div></div>
    </header>
    ${readonlyNote(p)}
    ${ed ? `<a class="action primary" href="#/analiz?oyuncu=${p.id}">
      <span class="a-icon">${icon('plus', 22)}</span>
      <span class="a-text"><strong>Yeni analiz</strong><small>Zıplama, koşu, dönme ya da diğer hareket</small></span>
      ${icon('chevron', 18)}
    </a>` : ''}
    ${p.notes ? `<p class="card note">${esc(p.notes)}</p>` : ''}
    ${Object.entries(byTest).map(([test, list]) => `
      <section class="card">
        <div class="card-head">
          <h2><span class="test-tag">${icon(TEST_ICON[test], 18)}</span>${TESTS[test].name} <span class="count">${list.length || ''}</span></h2>
          ${ed ? `<a class="btn small" href="#/analiz?oyuncu=${p.id}&test=${test}">${icon('plus', 15)}Kayıt</a>` : ''}</div>
        ${list.length ? `
          ${list.length > 1 && KEY_METRIC[test] ? `<div class="trend" data-test="${test}"></div>` : ''}
          <ul class="list">
            ${list.map((a) => {
              const k = KEY_METRIC[a.test];
              const sc = scoreOf(a);
              return `<li><a class="session" href="#/rapor/${a.id}">
                <span class="grow when"><strong>${fmtDate(a.date)}</strong>
                <small>${a.mode === 'lidar' ? 'LiDAR 3B' : 'Video 2B'}${a.view && a.mode !== 'lidar' && a.view !== 'bilinmiyor' ? ` · ${esc(a.view)}` : ''}</small></span>
                <span class="val"><strong class="${scoreClass(sc.score)}">${sc.score ?? '-'}<small>/10</small></strong>
                  <small class="sub">${k ? `${esc(formatValue(k, a.metrics?.[k]))} ${RULES[k].unit}` : esc(motionName(a.motion?.main, true))}</small></span>
                ${icon('chevron', 18)}
              </a></li>`;
            }).join('')}
          </ul>` : '<p class="muted hint">Bu test için henüz kayıt yok.</p>'}
      </section>`).join('')}
    ${ed ? `<details class="card edit-box">
      <summary>${icon('edit', 18)}Oyuncu bilgilerini düzenle${icon('chevron', 18)}</summary>
      <form id="editForm" class="form">${playerFields(p)}
        <div class="row between"><button type="button" class="btn danger ghost" id="del">${icon('trash', 17)}Oyuncuyu sil</button><button class="btn primary">Kaydet</button></div>
      </form>
    </details>` : ''}`;

  for (const box of document.querySelectorAll('.trend')) {
    const list = byTest[box.dataset.test].slice().reverse();
    const k = KEY_METRIC[box.dataset.test];
    const pts = list.filter((a) => a.metrics?.[k] != null);
    if (pts.length < 2) { box.remove(); continue; }
    const t = pts.map((a) => new Date(a.date).getTime());
    box.innerHTML = `<p class="chart-title">${RULES[k].label} · ${RULES[k].unit}</p>`;
    const th = RULES[k].ageBased ? RULES[k].thresholds[ageGroupFor(p)] : RULES[k].thresholds;
    box.append(lineChart({
      width: box.clientWidth - 28, t, series: [{ name: RULES[k].label, v: pts.map((a) => a.metrics[k]) }], points: true,
      xTicks: t.length <= 6 ? t : [t[0], t[Math.floor(t.length / 2)], t[t.length - 1]],
      xFormat: (v) => new Date(v).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }),
      refLines: th ? [{ v: th.good, label: `İyi ${RULES[k].type === 'lower' ? '≤' : '≥'} ${formatValue(k, th.good)}` }] : [],
    }));
  }

  if (!ed) return;
  const f = $('#editForm');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const upd = readPlayerForm(f);
    if (!upd.name) return toast('Ad soyad gerekli', 'warn');
    const { owner: _o, mine: _m, editable: _e, ...rest } = p;
    try {
      await db.savePlayer({ ...rest, ...upd });
    } catch (ex) {
      return toast(`Kaydedilemedi: ${errMsg(ex)}`, 'warn');
    }
    toast('Kaydedildi');
    route();
  };
  $('#del').onclick = async () => {
    if (!(await ask(`${p.name} ve tüm analizleri silinecek. Bu işlem geri alınamaz.`, { title: 'Oyuncu silinsin mi?', ok: 'Oyuncuyu sil' }))) return;
    try {
      await db.deletePlayer(id);
    } catch (ex) {
      console.error(ex);
      return toast(`Silinemedi: ${errMsg(ex)}`, 'warn');
    }
    toast('Oyuncu silindi');
    location.hash = '#/oyuncular';
  };
}

const ageGroupFor = (p) => {
  const a = ageOf(p);
  return a == null ? '9-10' : a <= 8 ? '6-8' : a <= 10 ? '9-10' : a <= 12 ? '11-12' : '13-15';
};
// ------------------------------------------------------------------ YENİ ANALİZ
const MAX_SECONDS = 60;
// Bundan uzun bölümler 30 fps ile işlenir: telefonda süre makul kalsın (zıplamada zamanlama biraz daha az hassas olur)
const LONG_SECONDS = 20;

const UNKNOWN = ['other', 'still'];
const fmtDur = (sec) => `${fmtSec(sec)} sn`;
const groupMeta = (g) => `${g.count > 1 ? `${g.count} bölüm · ` : ''}${fmtDur(g.total)}`;

/** Videoda tanınan hareketlerin kısa özeti: hareket türü başına bir satır, en fazla 5 satır. */
function motionSummary(motion) {
  const groups = groupSegments(motion?.segments);
  const known = groups.filter((g) => !UNKNOWN.includes(g.key));
  const unknown = groups.filter((g) => UNKNOWN.includes(g.key)).reduce((t, g) => t + g.total, 0);
  const shown = known.slice(0, 5);
  const rest = known.slice(5).reduce((t, g) => t + g.total, 0);
  return `<ul class="seg-list">${shown.map((g, i) => `
    <li><strong><i class="dot m${i}"></i>${esc(motionName(g.key))}</strong><span>${groupMeta(g)}</span></li>`).join('')}
    ${rest ? `<li class="muted"><strong><i class="dot"></i>Diğer tanınan hareketler</strong><span>${fmtDur(rest)}</span></li>` : ''}
    ${unknown ? `<li class="muted"><strong><i class="dot"></i>Tanımlanamayan</strong><span>${fmtDur(unknown)}</span></li>` : ''}</ul>
    ${motion?.cuts >= 4 ? `<p class="hint">Video ${motion.cuts + 1} parçalı bir kurgu. Tek egzersizin sabit kamerayla çekildiği videolar daha doğru sonuç verir.</p>` : ''}`;
}
const knownMotions = (r) => groupSegments(r?.motion?.segments).filter((g) => !UNKNOWN.includes(g.key)).length;
const firstSentence = (t) => String(t).split(/(?<=\.)\s/)[0];

/**
 * Seçilen test videoda bulunamadığında ya da "Diğer hareket" seçildiğinde ne kaydedileceğini sorar.
 * Videoda puanlı testlerden biri varsa o test, yoksa puansız genel hareket analizi önerilir.
 * {test, result} ya da (vazgeçilirse) null döner.
 */
async function chooseAlternative(selected, result, analyze) {
  const scored = ['jump', 'run', 'spin'].filter((t) => t !== selected).map((t) => ({ test: t, result: analyze(t) })).find((x) => !x.result.invalid);
  const free = selected === 'free' ? result : analyze('free');
  const freeOk = !free.invalid;
  const lower = (t) => TESTS[t].name.toLocaleLowerCase('tr');
  const scoreBtn = scored && { v: scored.test, label: `${TESTS[scored.test].short} testi olarak puanla`, kind: 'primary' };
  let v;
  if (selected === 'free') {
    if (!freeOk && !scored) {
      await ask(free.invalid, { title: 'Hareket analiz edilemedi', ok: 'Tamam', cancel: null, danger: false });
      return null;
    }
    if (!scored) return { test: 'free', result: free };
    v = await dialog({
      title: `Videoda ${lower(scored.test)} bulundu`,
      message: `${TESTS[scored.test].name} testi olarak yaşa göre puanlanabilir${freeOk ? ' ya da genel hareket analizi olarak kaydedilebilir' : ''}.`,
      body: freeOk ? motionSummary(free.motion) : '',
      buttons: [{ v: '0', label: 'Vazgeç' }, ...(freeOk ? [{ v: 'free', label: 'Genel analiz olarak kaydet' }] : []), scoreBtn],
    });
  } else {
    if (!freeOk && !scored) {
      await ask(result.invalid, { title: `${TESTS[selected].name} analiz edilemedi`, ok: 'Tamam', cancel: null, danger: false });
      return null;
    }
    const hint = scored
      ? ` Videoda ${lower(scored.test)} var; ${TESTS[scored.test].name} testi olarak puanlanabilir.`
      : !freeOk ? ''
        : knownMotions(free) ? ' Videoda tanınan hareketler aşağıda; genel hareket analizi olarak kaydedilip tekniği puanlanabilir.'
          : ' Videodaki hareket tanınamadı; yine de açı ve denge gibi genel ölçümler (puansız) kaydedilebilir.';
    v = await dialog({
      title: `${TESTS[selected].name} bulunamadı`,
      message: firstSentence(result.invalid) + hint,
      body: freeOk && knownMotions(free) ? motionSummary(free.motion) : '',
      buttons: [{ v: '0', label: 'Vazgeç' }, ...(freeOk ? [{ v: 'free', label: 'Genel analizi kaydet', kind: scored ? 'ghost' : 'primary' }] : []), ...(scoreBtn ? [scoreBtn] : [])],
    });
  }
  // Pencerede içerik (body) varsa dialog() düğme değerini {v, values} olarak döndürür
  if (v && typeof v === 'object') v = v.v;
  if (v === 'free') return { test: 'free', result: free };
  if (scored && v === scored.test) return scored;
  return null;
}

async function viewNewAnalysis(playerId, presetTest) {
  const live = current();
  setNav('new');
  const players = (await db.listPlayers()).filter((p) => p.editable);
  if (!live()) return;
  const state = {
    playerId: players.some((p) => p.id === playerId) ? playerId : players.find((p) => p.mine)?.id || players[0]?.id || '',
    test: TESTS[presetTest] ? presetTest : 'jump',
    file: null, url: null, fps: null, busy: false, cancelled: false,
  };
  const label = (p) => `${p.name}${ageOf(p) != null ? ` (${ageOf(p)})` : ''}${p.mine ? '' : ` · ${p.owner}`}`;

  app.innerHTML = `
    <header class="page-head"><div><p class="kicker">Kayıt</p><h1>Yeni analiz</h1></div></header>
    ${!players.length ? `<div class="card warn row center">${icon('alert', 18)}<span>Önce <a href="#/oyuncular">bir oyuncu ekleyin</a>.</span></div>` : ''}
    <section class="card step">
      <div class="step-head"><span class="n">01</span><h2>Oyuncu</h2></div>
      <select id="player" aria-label="Oyuncu" ${players.length ? '' : 'disabled'}>
        ${players.map((p) => `<option value="${p.id}" ${p.id === state.playerId ? 'selected' : ''}>${esc(label(p))}</option>`).join('')}
      </select>
    </section>
    <section class="card step">
      <div class="step-head"><span class="n">02</span><h2>Test</h2></div>
      <div class="tests" role="radiogroup" aria-label="Test">
        ${Object.entries(TESTS).map(([k, t]) => `
          <button class="test-card ${k === state.test ? 'sel' : ''}" data-test="${k}" role="radio" aria-checked="${k === state.test}">
            <span class="t-icon">${icon(TEST_ICON[k], 22)}</span><strong>${t.short}</strong><small>${t.desc}</small>
            <span class="tick">${icon('check', 13)}</span></button>`).join('')}
      </div>
      <details class="guide" open><summary>${icon('target', 17)}Çekim rehberi${icon('chevron', 16)}</summary><ol id="guide"></ol></details>
    </section>
    <section class="card step">
      <div class="step-head"><span class="n">03</span><h2>Video</h2></div>
      <label class="action primary" id="pick"><span class="a-icon">${icon('film', 22)}</span>
        <span class="a-text"><strong id="pickTitle">Video seç veya çek</strong><small id="pickSub">Galeriden seçin ya da kamerayla yeni çekin</small></span>${icon('chevron', 18)}
        <input type="file" id="file" accept="video/*" hidden ${players.length ? '' : 'disabled'}>
      </label>
      <p class="hint">iPhone'da Ayarlar > Kamera > Video Kaydı > 1080p 60 fps seçin; daha hassas sonuç verir.</p>
      <div id="videoBox" class="hidden">
        <div class="stage">
          <video id="preview" playsinline muted controls preload="auto"></video>
          <canvas id="who" class="hidden" aria-label="Analiz edilecek çocuğa dokunun"></canvas>
        </div>
        <div class="who-bar">
          <p class="hint" id="whoText" aria-live="polite"></p>
          <button class="btn small" id="whoBtn">Çocuğu seç</button>
        </div>
        <div class="row">
          <label>Başlangıç (sn)<input id="start" type="number" step="0.1" min="0" value="0" inputmode="decimal"></label>
          <label>Bitiş (sn)<input id="end" type="number" step="0.1" min="0" inputmode="decimal"></label>
        </div>
        <div class="row gap">
          <button class="btn small" id="setStart">Başlangıç = şu an</button>
          <button class="btn small" id="setEnd">Bitiş = şu an</button>
        </div>
        <p class="hint" id="durHint"></p>
        <button class="btn primary block" id="run" disabled>Analizi başlat</button>
      </div>
      <div id="progress" class="progress hidden" aria-live="polite">
        <div class="progress-top"><strong id="progressText">Hazırlanıyor…</strong><span class="pct" id="pct">0%</span></div>
        <div class="bar"><span></span></div>
        <button class="btn small" id="cancel">İptal</button>
      </div>
    </section>
    <p class="privacy">${icon('lock', 16)}<span>Video cihazınızdan çıkmaz. Analiz telefonda yapılır; yalnızca iskelet noktaları ve sonuçlar kaydedilir.</span></p>`;

  const showGuide = () => { $('#guide').innerHTML = TESTS[state.test].guide.map((g) => `<li>${esc(g)}</li>`).join(''); };
  showGuide();
  $('#player').onchange = (e) => { state.playerId = e.target.value; };
  document.querySelectorAll('.test-card').forEach((b) => b.addEventListener('click', () => {
    if (state.busy) return;
    state.test = b.dataset.test;
    document.querySelectorAll('.test-card').forEach((x) => { x.classList.toggle('sel', x === b); x.setAttribute('aria-checked', x === b); });
    showGuide();
  }));

  const preview = $('#preview');
  const fileInput = $('#file');
  const dropVideo = () => {
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = null;
    state.file = null;
  };
  onLeave(live, () => {
    state.cancelled = true;
    preview.removeAttribute('src');
    preview.load();
    dropVideo();
  });

  // Analiz sürerken video, oyuncu ve test değiştirilemez; aksi hâlde işlenen kareler başka bir videoya karışır
  const setBusy = (on) => {
    state.busy = on;
    fileInput.disabled = on;
    $('#pick').classList.toggle('disabled', on);
    $('#player').disabled = on || !players.length;
    document.querySelectorAll('.test-card').forEach((b) => { b.disabled = on; });
    ['#run', '#start', '#end', '#setStart', '#setEnd', '#whoBtn'].forEach((s) => { $(s).disabled = on; });
    if (on) stopPicking();
    if (!on) $('#run').disabled = !(preview.duration > 0);
  };

  // ------------------------------------------------- Analiz edilecek çocuğu seçme
  // Kadrajda birden fazla kişi varsa (antrenör, sırasını bekleyen çocuklar) antrenör çocuğa dokunur; analiz video
  // boyunca yalnızca o çocuğu takip eder. state.target: {t: seçildiği an, person}
  const whoCanvas = $('#who');
  const who = { people: null, picking: false, scanning: false };
  const whoText = (s) => { $('#whoText').textContent = s; };
  const fmtT = (t) => t.toFixed(1).replace('.', ',');

  // Videonun ekranda kapladığı alan (siyah kenarlar hariç) ve video pikselinden ekran pikseline ölçek
  const viewRect = () => {
    const cw = preview.clientWidth, ch = preview.clientHeight;
    const s = Math.min(cw / preview.videoWidth, ch / preview.videoHeight);
    return { cw, ch, s, ox: (cw - preview.videoWidth * s) / 2, oy: (ch - preview.videoHeight * s) / 2 };
  };
  const drawWho = () => {
    const sel = state.target;
    // Seçim, yalnızca video seçimin yapıldığı karede durduğu sürece çerçeveyle gösterilir
    const show = who.picking || (sel && !state.busy && preview.paused && !preview.seeking && Math.abs(preview.currentTime - sel.t) < 0.05);
    whoCanvas.classList.toggle('hidden', !show);
    whoCanvas.classList.toggle('picking', who.picking);
    whoCanvas.parentElement.classList.toggle('picking', who.picking);
    if (!show || !preview.videoWidth) return;
    const r = viewRect();
    const dpr = window.devicePixelRatio || 1;
    whoCanvas.width = Math.round(r.cw * dpr);
    whoCanvas.height = Math.round(r.ch * dpr);
    const ctx = whoCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e3064f';
    const here = sel && Math.abs(preview.currentTime - sel.t) < 0.05;
    const list = who.picking ? [...(who.people || []).filter((p) => !here || p !== sel.person), ...(here ? [sel.person] : [])] : [sel.person];
    for (const p of list) {
      const chosen = sel && p === sel.person;
      const [x0, y0, x1, y1] = p.box;
      ctx.lineWidth = chosen ? 3 : 2;
      ctx.strokeStyle = chosen ? accent : 'rgba(255,255,255,.95)';
      ctx.setLineDash(chosen ? [] : [6, 4]);
      ctx.strokeRect(r.ox + x0 * r.s, r.oy + y0 * r.s, (x1 - x0) * r.s, (y1 - y0) * r.s);
    }
  };
  const startPicking = () => {
    who.picking = true;
    preview.pause();
    preview.controls = false;
    $('#whoBtn').textContent = 'Vazgeç';
    const n = who.people?.length ?? 0;
    whoText(`${n > 1 ? `Bu karede ${n} kişi bulundu. ` : ''}Analiz edilecek çocuğa dokunun; çerçevesi yoksa da üstüne dokunun, orada aranır. Çocuk bu karede yoksa "Vazgeç" deyip göründüğü bir kareye gelin.`);
    drawWho();
  };
  function stopPicking() {
    if (!who.picking) return;
    who.picking = false;
    preview.controls = true;
    $('#whoBtn').textContent = state.target ? 'Seçimi değiştir' : 'Çocuğu seç';
    whoText(state.target ? `Seçilen çocuk (${fmtT(state.target.t)} sn) takip edilecek.` : 'Çocuk seçilmedi: videoda ilk bulunan kişi analiz edilir. Kadrajda başka kişiler de varsa çocuğun göründüğü bir kareye gelip "Çocuğu seç"e dokunun.');
    drawWho();
  }
  const resetWho = () => {
    stopPicking();
    state.target = null;
    Object.assign(who, { people: null, scanning: false, auto: false });
    $('#whoBtn').textContent = 'Çocuğu seç';
    whoText('');
    drawWho();
  };
  // Videonun durduğu karedeki (t verilirse o andaki) kişileri bulur. auto: video ilk açıldığında; kadrajda büyük ve
  // net görünen tek bir kişi varsa sormadan seçilir. Küçük görünen kişilerin algılanması güvenilir olmadığı için
  // (uzaktaki çocuk bulunamayabilir, yan yana iki kişi tek sanılabilir) diğer her durumda antrenöre sorulur.
  const scan = async ({ t, auto = false } = {}) => {
    if (who.scanning || state.busy) return;
    const file = state.file;
    who.scanning = true;
    whoText('Kadrajdaki kişiler aranıyor…');
    try {
      const { findPeople } = await import('./pose.js');
      const people = await findPeople(preview, { t, model: settings.model });
      if (state.file !== file || !live()) return;
      who.people = people;
      if (auto && people.length === 1 && people[0].h >= 0.25 * preview.videoHeight) {
        state.target = { t: preview.currentTime, person: people[0] };
        $('#whoBtn').textContent = 'Seçimi değiştir';
        whoText('Kadrajdaki kişi işaretlendi ve analiz edilecek. Başka bir çocuksa, onun göründüğü bir kareye gelip "Seçimi değiştir"e dokunun.');
      } else {
        who.scanning = false;
        startPicking();
      }
    } catch (e) {
      console.error(e);
      if (state.file === file) whoText(`Kişiler aranamadı (${errMsg(e)}). Seçmeden de analiz edebilirsiniz.`);
    } finally {
      who.scanning = false;
      drawWho();
    }
  };
  whoCanvas.addEventListener('click', async (e) => {
    if (!who.picking || who.scanning) return;
    const r = viewRect();
    const b = whoCanvas.getBoundingClientRect();
    const x = (e.clientX - b.left - r.ox) / r.s, y = (e.clientY - b.top - r.oy) / r.s;
    if (x < 0 || y < 0 || x > preview.videoWidth || y > preview.videoHeight) return;
    const file = state.file;
    // Dokunulan yerin çevresine yakından bakılır: uzaktaki küçük çocuk bütün karede bulunamayabilir, bulunsa da
    // yakın bakışta eklemleri daha doğru çıkar
    let p = null;
    who.scanning = true;
    whoText('Dokunulan yerde aranıyor…');
    try {
      const { findPeople } = await import('./pose.js');
      [p] = await findPeople(preview, { at: [x, y], model: settings.model });
    } catch (err) {
      console.error(err);
    } finally {
      who.scanning = false;
    }
    if (state.file !== file || !live() || !who.picking) return;
    if (!p) {
      whoText('Dokunulan yerde kimse bulunamadı. Çocuğun üstüne dokunun ya da "Vazgeç" deyip çocuğun daha net göründüğü bir kareye geçin.');
      return;
    }
    state.target = { t: preview.currentTime, person: p };
    stopPicking();
  });
  $('#whoBtn').onclick = () => {
    if (state.busy || who.scanning) return;
    if (who.picking) stopPicking();
    else scan();
  };
  // Video ilk kez bir kare gösterdiğinde kişiler kendiliğinden aranır (iPhone'da bu ancak oynatınca olur)
  const autoScan = () => {
    if (who.auto || state.busy || !state.file || preview.readyState < 2 || !preview.paused) return;
    who.auto = true;
    scan({ auto: true });
  };
  preview.addEventListener('loadeddata', autoScan);
  preview.addEventListener('pause', autoScan);
  ['play', 'seeking', 'seeked', 'pause'].forEach((ev) => preview.addEventListener(ev, () => { if (!who.picking) drawWho(); }));
  window.addEventListener('resize', drawWho);
  onLeave(live, () => window.removeEventListener('resize', drawWho));

  fileInput.onchange = () => {
    const f = fileInput.files[0];
    fileInput.value = ''; // aynı video tekrar seçilince de değişiklik algılansın
    if (!f || state.busy) return;
    dropVideo();
    resetWho();
    state.file = f;
    state.fps = null;
    state.url = URL.createObjectURL(f);
    fpsFromFile(f).then((fps) => { if (state.file === f) state.fps = fps; });
    $('#progress').classList.add('hidden');
    $('#videoBox').classList.remove('hidden');
    $('#run').disabled = true;
    $('#start').value = '0';
    $('#end').value = '';
    $('#durHint').textContent = 'Video açılıyor…';
    $('#pickTitle').textContent = 'Başka video seç';
    $('#pickSub').textContent = f.name;
    preview.onloadedmetadata = () => {
      // Analiz sırasında takılan video yeniden yüklenince de bu olay gelir; seçilen aralık korunur
      if (state.file !== f || state.busy) return;
      const d = preview.duration;
      if (!(d > 0) || !Number.isFinite(d)) {
        $('#durHint').textContent = 'Videonun süresi okunamadı. Farklı bir video deneyin.';
        return;
      }
      $('#end').value = Math.min(d, MAX_SECONDS).toFixed(1);
      $('#end').max = d.toFixed(1);
      $('#start').max = d.toFixed(1);
      $('#durHint').textContent = `Video ${d.toFixed(1).replace('.', ',')} sn. ${d > MAX_SECONDS ? `En fazla ${MAX_SECONDS} sn analiz edilir; hareketin olduğu bölümü seçin.` : 'Gerekirse yalnızca hareketin olduğu bölümü seçin.'}${d > LONG_SECONDS ? ` ${LONG_SECONDS} sn'den uzun bölümlerin analizi telefonda birkaç dakika sürebilir; bu sırada ekranı kapatmayın ve başka uygulamaya geçmeyin.` : ''}`;
      $('#run').disabled = false;
    };
    preview.onerror = () => {
      if (state.file !== f) return;
      $('#durHint').textContent = 'Bu video bu tarayıcıda açılamadı. Farklı bir video deneyin (iPhone\'da "En Uyumlu" biçim: Ayarlar > Kamera > Biçimler).';
      $('#run').disabled = true;
    };
    preview.src = state.url;
  };
  $('#setStart').onclick = () => { $('#start').value = preview.currentTime.toFixed(1); };
  $('#setEnd').onclick = () => { $('#end').value = preview.currentTime.toFixed(1); };

  const progress = (ratio, text) => {
    $('#progress').classList.remove('hidden');
    $('#progress .bar span').style.width = `${Math.round(ratio * 100)}%`;
    $('#pct').textContent = `${Math.round(ratio * 100)}%`;
    $('#progressText').textContent = text;
  };
  $('#cancel').onclick = () => { state.cancelled = true; $('#progressText').textContent = 'İptal ediliyor…'; };

  const save = async (rec, skeleton) => {
    for (;;) {
      try { await db.saveAnalysis(rec, skeleton); return true; } catch (e) {
        console.error(e);
        if (!live() || e.code === '28000') return false;
        if (!(await ask(`Sonuç kaydedilemedi: ${errMsg(e)}`, { title: 'Kaydedilemedi', ok: 'Tekrar dene', cancel: 'Vazgeç', danger: false }))) return false;
      }
    }
  };

  $('#run').onclick = async () => {
    if (state.busy) return;
    const player = players.find((p) => p.id === state.playerId);
    if (!player) return toast('Önce oyuncu seçin', 'warn');
    if (!state.url || !(preview.duration > 0)) return toast('Önce bir video seçin', 'warn');
    const d = preview.duration;
    const start = Math.min(Math.max(0, Number($('#start').value) || 0), d);
    let end = Math.min(Number($('#end').value) || d, d);
    if (end - start > MAX_SECONDS) end = start + MAX_SECONDS;
    if (end - start < 1) return toast('Başlangıç ile bitiş arasında en az 1 sn olmalı', 'warn');
    if (who.picking || who.scanning) return toast('Önce analiz edilecek çocuğa dokunun', 'warn');
    if (state.target && (state.target.t < start - 0.05 || state.target.t > end + 0.05)) {
      return toast('Çocuk, analiz aralığının dışındaki bir karede seçildi. Aralık içindeki bir kareye gelip çocuğu yeniden seçin.', 'warn');
    }
    if (!state.target) {
      if (!who.people) {
        // Kişiler henüz aranmadıysa (iPhone'da video oynatılmadan kare yüklenmez) başlangıç karesine bakılır.
        // Oynat/durdur, dokunma anında yapılmalı (aşağıdaki açıklamaya bakın).
        preview.play()?.catch(() => {});
        preview.pause();
        who.auto = true;
        await scan({ t: start, auto: true });
        if (who.picking) return toast('Önce analiz edilecek çocuğa dokunun', 'warn');
      } else if (who.people.length > 1) {
        startPicking();
        return toast('Kadrajda birden fazla kişi var. Analiz edilecek çocuğa dokunun.', 'warn');
      }
    }
    const selected = state.test;
    const file = state.file;
    setBusy(true);
    state.cancelled = false;
    // iPhone, kullanıcı oynatmadıkça video verisini yüklemeyebilir ve kareye atlama hiç tamamlanmaz. Dokunma
    // anında (ilk await'ten önce) yapılan kısa bir oynat/durdur bu kısıtı kaldırır.
    preview.play()?.catch(() => {});
    preview.pause();
    // Uzun analizde ekran kararıp kilitlenirse tarayıcı işlemi durdurur
    let wake = null;
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* desteklenmiyor ya da izin yok */ }
    try {
      progress(0, 'Hazırlanıyor…');
      const { processVideo } = await import('./pose.js');
      const knownFps = state.fps ?? (await fpsFromFile(file));
      const out = await processVideo(preview, {
        start, end, model: settings.model, knownFps, maxFps: end - start > LONG_SECONDS ? 30 : 60, target: state.target,
        isCancelled: () => state.cancelled || state.file !== file,
        onProgress: (p) => live() && progress(p.ratio, p.phase === 'model'
          ? 'Analiz modeli yükleniyor (ilk seferde biraz sürebilir)…'
          : `Kareler işleniyor: ${p.frame}/${p.total}${p.eta != null ? ` · ~${p.eta > 90 ? `${Math.round(p.eta / 60)} dk` : `${Math.ceil(p.eta)} sn`} kaldı` : ''}`),
      });
      if (!live()) return;
      progress(1, 'Ölçümler hesaplanıyor…');
      const meta = { ...out.meta, statureM: player.heightCm ? player.heightCm / 100 : null };
      const analyze = (t) => runAnalysis({ test: t, frames: out.frames, meta, age: ageOf(player) });
      let test = selected;
      let result = analyze(test);
      if (result.invalid || test === 'free') {
        // İstenen hareket yoksa puan verilmez; antrenör başka bir testi ya da puansız genel analizi seçebilir
        const pick = await chooseAlternative(selected, result, analyze);
        if (!live()) return;
        if (!pick) {
          $('#progress').classList.add('hidden');
          setBusy(false);
          return;
        }
        ({ test, result } = pick);
      }
      progress(1, 'Kaydediliyor…');
      const id = db.newId();
      const rec = {
        id, playerId: player.id, test, mode: 'video', date: new Date().toISOString(),
        age: ageOf(player), view: result.view, fps: result.fps, duration: result.duration,
        metrics: result.metrics, counts: result.report.counts, warnings: result.warnings,
        charts: result.charts, events: result.events, note: '', videoStart: start, srcFps: out.meta.srcFps,
        ...(result.motion ? { motion: result.motion } : {}),
      };
      if (!(await save(rec, result.skeleton))) {
        if (live()) { $('#progress').classList.add('hidden'); setBusy(false); }
        return;
      }
      // Video, rapor ekranında iskeletle birlikte izlenebilsin diye rapordan çıkılana kadar bellekte tutulur
      pendingVideo = { id, url: state.url, offset: start };
      state.url = null;
      state.file = null;
      location.hash = `#/rapor/${id}`;
    } catch (e) {
      console.error(e);
      if (!live()) return;
      $('#progress').classList.add('hidden');
      setBusy(false);
      if (e.message === 'İptal edildi') toast('Analiz iptal edildi', 'warn');
      // Telefona özgü hataların nedeni ekran görüntüsünden anlaşılabilsin diye teknik ayrıntı da gösterilir
      else if (e.detail) ask(`${errMsg(e)} Teknik ayrıntı: ${e.detail}`, { title: 'Analiz durdu', ok: 'Tamam', cancel: null, danger: false });
      else toast(`Hata: ${errMsg(e)}`, 'warn');
    } finally {
      wake?.release().catch(() => {});
    }
  };
}

// Analizden hemen sonra rapor sayfasında videonun üzerine iskelet çizmek için
let pendingVideo = null;

// ------------------------------------------------------------------------ RAPOR
// Ölçümün eşik bölgelerine göre nerede durduğunu gösteren çubuk
function gauge(it) {
  const t = it.thresholds;
  const v = it.value;
  if (!t || typeof v !== 'number' || !['higher', 'lower', 'range'].includes(it.type)) return '';
  let stops, zones;
  if (it.type === 'higher') {
    const w = Math.abs(t.good - t.ok) || 1;
    stops = [t.ok - w * 1.2, t.ok, t.good, t.good + w * 1.2];
    zones = ['gelistir', 'orta', 'iyi'];
  } else if (it.type === 'lower') {
    const w = Math.abs(t.ok - t.good) || 1;
    let lo = t.good - w;
    if (t.good > 0 && lo < 0) lo = 0;
    if (lo >= t.good) lo = t.good - w * 0.5;
    stops = [lo, t.good, t.ok, t.ok + w * 1.2];
    zones = ['iyi', 'orta', 'gelistir'];
  } else {
    const [a, b] = t.good;
    const [c, d] = t.ok;
    const w = Math.max(b - a, 1e-6);
    stops = [c - w * 0.6, c, a, b, d, d + w * 0.6];
    zones = ['gelistir', 'orta', 'iyi', 'orta', 'gelistir'];
  }
  const span = stops[stops.length - 1] - stops[0];
  if (v < stops[0]) stops[0] = v - span * 0.04;
  if (v > stops[stops.length - 1]) stops[stops.length - 1] = v + span * 0.04;
  const lo = stops[0];
  const hi = stops[stops.length - 1];
  const pct = ((v - lo) / (hi - lo)) * 100;
  const track = zones.map((z, i) => `<i class="${z}" style="flex:${Math.max(stops[i + 1] - stops[i], 0)}"></i>`).join('');
  return `<div class="gauge" aria-hidden="true"><div class="track">${track}</div><span class="pin" style="left:${pct.toFixed(1)}%"></span></div>`;
}

const metricCard = (it) => `
  <article class="metric ${it.status}">
    <div class="metric-top"><h3>${esc(it.label)}</h3><span class="pill ${it.status}">${STATUS_LABEL[it.status]}</span></div>
    <p class="value">${esc(it.display)}<small>${esc(it.unit || '')}</small></p>
    ${gauge(it)}
    ${it.message ? `<p class="msg">${esc(it.message)}</p>` : ''}
    ${it.drill ? `<div class="drill">${icon('target', 16)}<span><b>Egzersiz:</b> ${esc(it.drill)}</span></div>` : ''}
    ${it.help || it.ref ? `<p class="help">${esc(it.help)}${it.ref ? ` <span class="ref">${esc(it.ref)}</span>` : ''}</p>` : ''}
  </article>`;

const validSegments = (a) => (Array.isArray(a.motion?.segments) ? a.motion.segments.filter((g) => g && Number.isFinite(g.start) && Number.isFinite(g.end)) : []);
const severity = { gelistir: 0, orta: 1 };

/**
 * Kaydın 10 üzerinden puanı: {score, reason, fixes, parts}.
 * Diğer harekette her tanınan hareket türü ayrı puanlanır; genel puan sürelerine göre ağırlıklı ortalamadır.
 */
function scoreOf(a) {
  if (a.test !== 'free') return { ...scoreReport(buildReport(a.metrics || {}, a.age).items), parts: [] };
  const groups = groupSegments(validSegments(a)).filter((g) => !UNKNOWN.includes(g.key));
  const parts = groups.map((g) => ({ g, ...scoreReport(evaluateMotion(g.key, g.metrics, g.view)) })).filter((x) => x.score != null);
  if (!parts.length) {
    return { score: null, reason: groups.length ? 'Bu hareket için puan kuralı yok; yalnızca ölçümler verildi.' : 'Hareket tanınamadığı için puan verilemedi.', fixes: [], parts };
  }
  const total = parts.reduce((t, x) => t + x.g.total, 0) || 1;
  const score = Math.round(parts.reduce((t, x) => t + x.score * x.g.total, 0) / total);
  const reason = parts.length === 1 ? parts[0].reason : `${parts.map((x) => `${motionName(x.g.key)} ${x.score}/10`).join(', ')}.`;
  const fixes = parts.flatMap((x) => x.fixes.map((f) => ({ ...f, motion: parts.length > 1 ? motionName(x.g.key) : null })))
    .sort((p, q) => severity[p.status] - severity[q.status]).slice(0, 4);
  return { score, reason, fixes, parts };
}
const scoreClass = (n) => (n == null ? '' : n >= 8 ? 'iyi' : n >= 5 ? 'orta' : 'gelistir');

// Diğer hareket: zaman çizelgesi ve hareket türü başına puan
function motionOverview(a, sc) {
  const segs = validSegments(a);
  if (!segs.length) return '';
  const groups = groupSegments(segs);
  const known = groups.filter((g) => !UNKNOWN.includes(g.key));
  const color = (key) => { const i = known.findIndex((g) => g.key === key); return i >= 0 && i < 5 ? `m${i}` : ''; };
  const t0 = Math.min(...segs.map((g) => g.start)), t1 = Math.max(...segs.map((g) => g.end));
  const span = Math.max(t1 - t0, 1e-6);
  const partScore = (key) => sc.parts.find((x) => x.g.key === key)?.score;
  const unknown = groups.filter((g) => UNKNOWN.includes(g.key)).reduce((t, g) => t + g.total, 0);
  return `<section class="card"><div class="card-head"><h2>Videodaki hareketler</h2></div>
    <div class="timeline" aria-hidden="true">${segs.map((g) => `<i class="${color(g.key)}" style="left:${(((g.start - t0) / span) * 100).toFixed(2)}%;width:${(((g.end - g.start) / span) * 100).toFixed(2)}%" title="${esc(motionName(g.key))}: ${fmtSec(g.start)}-${fmtSec(g.end)} sn"></i>`).join('')}</div>
    <div class="timeline-axis"><span>${fmtSec(t0)} sn</span><span>${fmtSec(t1)} sn</span></div>
    <ul class="seg-list">${known.map((g) => `<li><strong><i class="dot ${color(g.key)}"></i>${esc(motionName(g.key))}</strong>
      <span>${groupMeta(g)}${partScore(g.key) != null ? ` · <b class="${scoreClass(partScore(g.key))}">${partScore(g.key)}/10</b>` : ''}</span></li>`).join('')}
      ${unknown ? `<li class="muted"><strong><i class="dot"></i>Tanımlanamayan</strong><span>${fmtDur(unknown)}</span></li>` : ''}</ul></section>`;
}

// Ayrıntılar: puana giren kontroller ve sayımlar (diğer hareket) ya da bütün ölçümler (puanlı test)
const COUNT_KEYS = ['mReps', 'mTempo', 'mSteps', 'mStepRate', 'mBalanceTime', 'turns', 'flightTime'];
function detailCards(a, rep) {
  if (a.test !== 'free') return `<section class="metrics">${rep.items.map(metricCard).join('') || '<div class="card">Bu kayıttan ölçüm çıkarılamadı.</div>'}</section>`;
  const groups = groupSegments(validSegments(a));
  const known = groups.filter((g) => !UNKNOWN.includes(g.key));
  return (known.length ? known : groups.filter((g) => g.key === 'other')).map((g) => {
    const checks = evaluateMotion(g.key, g.metrics, g.view);
    const counts = buildReport(Object.fromEntries(COUNT_KEYS.filter((k) => g.metrics[k] != null).map((k) => [k, g.metrics[k]])), a.age).items;
    const cards = [...checks, ...counts];
    return `<h3 class="detail-title">${esc(UNKNOWN.includes(g.key) ? 'Genel ölçümler' : motionName(g.key))}</h3>
      <section class="metrics">${cards.map(metricCard).join('') || '<div class="card">Bu hareketten ölçüm çıkarılamadı.</div>'}</section>`;
  }).join('');
}

async function viewReport(id) {
  const live = current();
  setNav('');
  // Video bu sayfadan çıkınca bellekten silinir; sayfa açılamasa bile
  const video = pendingVideo?.id === id ? pendingVideo : null;
  pendingVideo = null;
  onLeave(live, () => { if (video) URL.revokeObjectURL(video.url); });
  const r = await db.getAnalysis(id);
  if (!live()) return;
  if (!r) { toast('Analiz bulunamadı ya da görme yetkiniz yok', 'warn'); location.hash = '#/'; return; }
  const { analysis: a, skeleton: skel, player } = r;
  const ed = player.editable;
  const rep = buildReport(a.metrics, a.age);
  const t = TESTS[a.test];
  const free = a.test === 'free';
  const by = a.createdBy && a.createdBy !== auth.currentUser().username ? a.createdBy : null;

  const sc = scoreOf(a);
  const title = free && sc.parts.length === 1 ? motionName(sc.parts[0].g.key) : t.name;
  app.innerHTML = `
    <a class="back no-print" href="#/oyuncu/${a.playerId}">${icon('back', 18)}${esc(player.name)}</a>
    <header class="report-hero">
      <p class="kicker">${icon(TEST_ICON[a.test], 15)}${esc(title)} raporu</p>
      <h1>${esc(player.name)}</h1>
      <p class="meta">${fmtDateTime(a.date)}${a.age != null ? ` · ${esc(a.age)} yaş` : ''}${player.mine ? '' : ` · Antrenör: ${esc(player.owner)}`}${by && by !== player.owner ? ` · Kaydeden: ${esc(by)}` : ''}</p>
      <div class="score-row">
        ${sc.score != null ? `<div class="score ${scoreClass(sc.score)}"><strong>${sc.score}</strong><span>/10</span></div>` : ''}
        <p class="reason">${esc(sc.reason || 'Bu kayıttan puan çıkarılamadı.')}${free && sc.score != null ? '<small>Teknik puanı; yaşa göre değerlendirilmez.</small>' : ''}</p>
      </div>
    </header>
    ${ed ? '' : `<div class="no-print">${readonlyNote(player)}</div>`}

    ${free && validSegments(a).length > 1 ? motionOverview(a, sc) : ''}

    ${sc.fixes.length ? `
      <section class="card">
        <div class="card-head"><h2>Düzeltilmesi gerekenler</h2></div>
        <ol class="priorities">${sc.fixes.map((p, i) => `<li><span class="n">0${i + 1}</span><div>
          <strong>${p.motion ? `${esc(p.motion)}: ` : ''}${esc(p.label)} <span class="pill ${p.status}">${STATUS_LABEL[p.status]}</span></strong>
          <p>${esc(p.message)}</p>
          ${p.drill ? `<div class="drill">${icon('target', 16)}<span><b>Egzersiz:</b> ${esc(p.drill)}</span></div>` : ''}</div></li>`).join('')}</ol>
      </section>` : sc.score != null ? `<section class="card ok row center">${icon('check', 20)}<div><h2>Düzeltilecek belirgin bir şey yok</h2><p class="muted">Ölçülen bütün alanlar iyi düzeyde.</p></div></section>` : ''}

    ${skel ? `<section class="card no-print"><div class="card-head"><h2>Hareket tekrarı</h2></div><div id="replay"></div>
      <p class="hint">${video ? 'Video kaydedilmez: bu ekrandan çıkınca silinir. Sonraki açılışlarda yalnızca iskelet gösterilir.' : a.mode === 'lidar' ? 'LiDAR ile kaydedilen 3B iskelet. "Üstten" görünüm dönme ve kaymayı gösterir.' : 'Kaydedilen iskelet (video saklanmaz).'}</p></section>` : ''}

    <details class="card more" id="more">
      <summary>${icon('sliders', 18)}Ayrıntılar<small>ölçümler, grafikler, çekim notları</small>${icon('chevron', 18)}</summary>
      <div class="badges">
        <span class="badge ${a.mode === 'lidar' ? 'lidar' : 'video'}">${a.mode === 'lidar' ? 'LiDAR 3B' : 'Video 2B'}</span>
        ${a.mode === 'video' && a.view && a.view !== 'bilinmiyor' ? `<span class="badge">${esc(a.view)} çekim</span>` : ''}
        ${a.fps ? `<span class="badge">${esc(a.fps)} fps</span>` : ''}
      </div>
      ${detailCards(a, rep)}
      ${a.charts?.length ? '<h3 class="detail-title">Grafikler</h3><div id="charts"></div>' : ''}
      ${a.warnings?.length ? `<h3 class="detail-title">Çekim notları</h3><ul class="notes-list">${a.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    </details>

    ${ed ? `
    <section class="card">
      <div class="card-head"><h2>Antrenör notu</h2></div>
      <textarea id="note" rows="3" maxlength="2000" placeholder="Bu analizle ilgili notunuz…" aria-label="Antrenör notu">${esc(a.note)}</textarea>
      <div class="form-actions"><button class="btn small" id="saveNote">Notu kaydet</button></div>
    </section>` : a.note ? `
    <section class="card"><div class="card-head"><h2>Antrenör notu</h2></div><p class="pre">${esc(a.note)}</p></section>` : ''}

    <div class="actions no-print">
      ${ed ? `<button class="btn danger ghost" id="delA">${icon('trash', 17)}Analizi sil</button>` : '<span></span>'}
      <button class="btn" id="print">${icon('print', 17)}Yazdır / PDF</button>
    </div>
    <p class="disclaimer">Bu rapor antrenman amaçlı otomatik bir değerlendirmedir; tıbbi teşhis değildir. Ölçüm doğruluğu çekim koşullarına bağlıdır.</p>`;

  if (skel) {
    const firstEvent = a.events?.[0];
    const startAt = firstEvent ? Math.max(0, (firstEvent.takeoff ?? firstEvent.contact ?? firstEvent.sideways ?? firstEvent.halfTurn ?? firstEvent.start ?? 0) - 0.6) : 0;
    mountReplay($('#replay'), skel, { videoUrl: video?.url, videoOffset: video?.offset || 0, startAt });
  }
  // Grafikler kutunun genişliğiyle çizilir; kapalı "Ayrıntılar" içinde genişlik olmadığından ilk açılışta çizilir
  let drawn = false;
  const drawCharts = () => {
    const ch = $('#charts');
    if (drawn || !ch) return;
    drawn = true;
    for (const c of a.charts || []) {
      const box = document.createElement('div');
      box.innerHTML = `<p class="chart-title">${esc(c.title)}</p>${c.series?.length > 1
        ? `<p class="chart-legend">${c.series.map((sr, i) => `<span class="s${i}">${esc(sr.name)}</span>`).join('')}</p>` : ''}`;
      ch.append(box);
      box.append(lineChart({ ...c, width: box.clientWidth }));
    }
  };
  $('#more').addEventListener('toggle', () => { if ($('#more').open) drawCharts(); });
  // Yazdırırken ayrıntılar da açılır
  window.addEventListener('beforeprint', () => { $('#more')?.setAttribute('open', ''); drawCharts(); }, { once: true });
  $('#print').onclick = () => window.print();
  if (!ed) return;
  $('#saveNote').onclick = async () => {
    const btn = $('#saveNote');
    btn.disabled = true;
    try {
      await db.saveAnalysis({ ...a, note: $('#note').value.trim() });
      a.note = $('#note').value.trim();
      toast('Not kaydedildi');
    } catch (e) {
      toast(`Kaydedilemedi: ${errMsg(e)}`, 'warn');
    }
    btn.disabled = false;
  };
  $('#delA').onclick = async () => {
    if (!(await ask('Bu analizin sonuçları ve iskelet kaydı silinecek.', { title: 'Analiz silinsin mi?', ok: 'Analizi sil' }))) return;
    try {
      await db.deleteAnalysis(id);
    } catch (e) {
      console.error(e);
      return toast(`Silinemedi: ${errMsg(e)}`, 'warn');
    }
    toast('Analiz silindi');
    location.hash = `#/oyuncu/${a.playerId}`;
  };
}

// ---------------------------------------------------------------------- AYARLAR
const passwordFields = (withOld) => `
  ${withOld ? '<label>Mevcut şifre<input name="old" type="password" autocomplete="current-password" required></label>' : ''}
  <label>Yeni şifre<input name="pass" type="password" autocomplete="new-password" minlength="${auth.MIN_PASSWORD}" required></label>
  <label>Yeni şifre (tekrar)<input name="again" type="password" autocomplete="new-password" required></label>`;

const roleLabel = (r) => (r === 'admin' ? 'Yönetici' : 'Antrenör');

async function viewSettings() {
  const live = current();
  setNav('settings');
  const me = auth.currentUser();
  const admin = me.role === 'admin';
  const legacy = await db.legacyRecords(me.username).catch(() => null);
  if (!live()) return;
  app.innerHTML = `
    <header class="page-head"><div><p class="kicker">Uygulama</p><h1>Ayarlar</h1></div></header>
    <section class="card">
      <div class="card-head"><h2>Hesap</h2></div>
      <div class="row between wrap">
        <div class="row center">${avatar(me.username)}<div><strong>${esc(me.username)}</strong><p class="hint" style="margin:0">${roleLabel(me.role)}</p></div></div>
        <button class="btn" id="logout">${icon('logout', 17)}Çıkış yap</button>
      </div>
      <details class="sub-box">
        <summary>${icon('key', 17)}Şifremi değiştir${icon('chevron', 16)}</summary>
        <form id="pwForm" class="form" autocomplete="off">
          <input type="text" name="username" value="${esc(me.username)}" autocomplete="username" hidden>
          ${passwordFields(true)}
          <p class="login-error hidden" role="alert">${icon('alert', 16)}<span></span></p>
          <div class="form-actions"><button class="btn primary">Şifreyi değiştir</button></div>
        </form>
      </details>
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('share', 19)}Paylaşım</h2></div>
      <label class="switch-row">
        <span><strong>Oyuncularımı diğer antrenörlerle paylaş</strong>
          <small>Açıkken diğer antrenörler oyuncularınızın bilgilerini ve analiz sonuçlarını görebilir, ama değişiklik yapamaz. Kapatınca hemen gizlenir.</small></span>
        <input type="checkbox" class="switch" id="share" ${me.share ? 'checked' : ''}>
      </label>
      <p class="hint">${admin ? 'Yönetici olarak siz bu ayardan bağımsız olarak bütün antrenörlerin oyuncularını görür ve düzenleyebilirsiniz.' : 'Diğer antrenörlerin oyuncularını, onlar paylaşımı açtığında Oyuncular sayfasında "Tümü" sekmesinde görürsünüz.'}</p>
    </section>
    ${admin ? `
    <section class="card" id="coaches">
      <div class="card-head"><h2>${icon('players', 19)}Antrenörler</h2><button class="btn small" id="addCoach">${icon('userPlus', 15)}Antrenör ekle</button></div>
      <div id="coachList"><p class="hint">Yükleniyor…</p></div>
    </section>` : ''}
    ${legacy ? `
    <section class="card warn">
      <div class="card-head"><h2>${icon('cloud', 19)}Bu cihazdaki eski kayıtlar</h2></div>
      <p>Önceki sürümde bu cihazda kaydedilmiş ${legacy.players.length} oyuncu ve ${legacy.analyses.length} analiz hesabınıza henüz aktarılmadı.</p>
      <button class="btn primary" id="legacy" style="margin-top:12px">${icon('upload', 17)}Hesabıma aktar</button>
    </section>` : ''}
    <section class="card">
      <div class="card-head"><h2>Video analiz modeli</h2></div>
      <div class="options">
        <label class="option"><input type="radio" name="model" value="heavy" ${settings.model === 'heavy' ? 'checked' : ''}><span><strong>Hassas</strong>En doğru sonuç; analiz biraz daha uzun sürer. Önerilen.</span></label>
        <label class="option"><input type="radio" name="model" value="full" ${settings.model === 'full' ? 'checked' : ''}><span><strong>Hızlı</strong>Yaklaşık 2-3 kat daha çabuk, biraz daha az hassas.</span></label>
      </div>
      <p class="hint">Bu ayar yalnızca bu cihaz için geçerlidir.</p>
    </section>
    <p class="privacy">${icon('lock', 16)}<span>Videolar cihazdan çıkmaz: analiz, sayfanın içine gömülü açık kaynak MediaPipe modeliyle telefonda yapılır. Sunucuda yalnızca oyuncu bilgileri, sonuçlar ve iskelet noktaları tutulur. Analiz başına ücret yoktur.</span></p>`;

  $('#logout').onclick = async () => { await auth.logout(); history.replaceState(null, '', '#/'); route(); };

  const pw = $('#pwForm');
  const pwErr = (msg) => { const b = pw.querySelector('.login-error'); b.querySelector('span').textContent = msg; b.classList.toggle('hidden', !msg); };
  pw.onsubmit = async (e) => {
    e.preventDefault();
    const bad = !pw.old.value ? 'Mevcut şifrenizi girin.' : auth.checkNewPassword(pw.pass.value, pw.again.value);
    if (bad) return pwErr(bad);
    pwErr('');
    const btn = pw.querySelector('.btn.primary');
    btn.disabled = true;
    try {
      await auth.changeOwnPassword(pw.old.value, pw.pass.value);
      pw.reset();
      pw.closest('details').open = false;
      toast('Şifreniz değiştirildi. Diğer cihazlarda yeniden giriş yapmanız gerekir.');
    } catch (ex) {
      pwErr(errMsg(ex));
    }
    btn.disabled = false;
  };

  $('#share').onchange = async (e) => {
    const on = e.target.checked;
    e.target.disabled = true;
    try {
      await auth.setShare(on);
      toast(on ? 'Oyuncularınız diğer antrenörlerle paylaşılıyor' : 'Paylaşım kapatıldı');
    } catch (ex) {
      e.target.checked = !on;
      toast(`Kaydedilemedi: ${errMsg(ex)}`, 'warn');
    }
    e.target.disabled = false;
  };

  if (admin) {
    renderCoaches();
    $('#addCoach').onclick = addCoachDialog;
  }
  $('#legacy')?.addEventListener('click', () => offerLegacyImport({ always: true }));

  document.querySelectorAll('input[name=model]').forEach((r) => r.addEventListener('change', (e) => { settings.model = e.target.value; toast('Kaydedildi'); }));
}

async function renderCoaches() {
  const box = $('#coachList');
  if (!box) return;
  let list;
  try {
    list = await auth.listCoaches();
  } catch (e) {
    if ($('#coachList') === box) box.innerHTML = `<p class="hint">Liste alınamadı: ${esc(errMsg(e))}</p>`;
    return;
  }
  if ($('#coachList') !== box) return;
  const me = auth.currentUser().username;
  box.innerHTML = `<ul class="coach-list">${list.map((c) => `
    <li>
      ${avatar(c.username)}
      <div class="grow"><strong>${esc(c.username)}${c.username === me ? ' <span class="pill">Siz</span>' : ''}${c.role === 'admin' ? ' <span class="pill">Yönetici</span>' : ''}${c.locked ? ' <span class="pill gelistir">Kilitli</span>' : ''}</strong>
        <small>${c.players} oyuncu · ${c.analyses} analiz · Paylaşım ${c.share ? 'açık' : 'kapalı'}${c.lastSeen ? ` · Son giriş ${fmtDate(c.lastSeen)}` : ' · Henüz giriş yapmadı'}</small></div>
      <div class="coach-actions">
        <button class="btn small" data-pw="${esc(c.username)}" aria-label="${esc(c.username)} şifresini değiştir">${icon('key', 15)}<span>Şifre</span></button>
        ${c.role === 'admin' ? '' : `<button class="btn small danger ghost" data-del="${esc(c.username)}" aria-label="${esc(c.username)} hesabını sil">${icon('trash', 15)}<span>Sil</span></button>`}
      </div>
    </li>`).join('')}</ul>`;
  box.querySelectorAll('[data-pw]').forEach((b) => b.addEventListener('click', () => coachPasswordDialog(b.dataset.pw)));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => deleteCoachDialog(list.find((c) => c.username === b.dataset.del))));
}

async function addCoachDialog() {
  const r = await dialog({
    title: 'Antrenör ekle',
    message: 'Kullanıcı adını ve ilk şifresini antrenöre siz iletin. Antrenör şifresini daha sonra Ayarlar\'dan değiştirebilir.',
    body: `<label>Kullanıcı adı<input name="user" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="32" placeholder="ör. ayse.k" required></label>${passwordFields(false).replace(/Yeni şifre/g, 'Şifre')}`,
    buttons: [{ v: '0', label: 'Vazgeç' }, { v: 'ok', label: 'Ekle', kind: 'primary', submit: true }],
    validate: async (_v, { user, pass, again }) => {
      const u = auth.normalizeUser(user);
      if (!auth.USERNAME_RE.test(u)) return 'Kullanıcı adı 3-32 karakter olmalı; harf, rakam, nokta, alt çizgi ve kısa tire kullanılabilir.';
      const bad = auth.checkNewPassword(pass, again);
      if (bad) return bad;
      try { await auth.addCoach(u, pass); } catch (e) { return errMsg(e); }
      return null;
    },
  });
  if (!r) return;
  toast(`${auth.normalizeUser(r.values.user)} eklendi`);
  renderCoaches();
}

async function coachPasswordDialog(username) {
  const self = username === auth.currentUser().username;
  const r = await dialog({
    title: `${username}: şifre değiştir`,
    message: self ? '' : 'Antrenörün açık oturumları kapanır; yeni şifreyle tekrar giriş yapması gerekir.',
    body: passwordFields(self),
    buttons: [{ v: '0', label: 'Vazgeç' }, { v: 'ok', label: 'Değiştir', kind: 'primary', submit: true }],
    validate: async (_v, { old, pass, again }) => {
      if (self && !old) return 'Mevcut şifrenizi girin.';
      const bad = auth.checkNewPassword(pass, again);
      if (bad) return bad;
      try {
        if (self) await auth.changeOwnPassword(old, pass); else await auth.setCoachPassword(username, pass);
      } catch (e) { return errMsg(e); }
      return null;
    },
  });
  if (!r) return;
  toast(self ? 'Şifreniz değiştirildi' : `${username} şifresi değiştirildi`);
  renderCoaches();
}

async function deleteCoachDialog(c) {
  if (!c) return;
  const has = c.players > 0;
  const v = await dialog({
    title: `${c.username} silinsin mi?`,
    message: has
      ? `${c.username} artık giriş yapamaz. ${c.players} oyuncusu ve ${c.analyses} analizi ne olsun?`
      : `${c.username} artık giriş yapamaz. Bu antrenörün kayıtlı oyuncusu yok.`,
    buttons: has
      ? [{ v: 'transfer', label: 'Oyuncularını bana aktar ve sil', kind: 'primary' }, { v: 'delete', label: 'Oyuncularıyla birlikte sil', kind: 'danger ghost' }, { v: '0', label: 'Vazgeç' }]
      : [{ v: '0', label: 'Vazgeç' }, { v: 'transfer', label: 'Antrenörü sil', kind: 'danger' }],
  });
  if (!v) return;
  if (v === 'delete' && !(await ask(`${c.players} oyuncu ve ${c.analyses} analiz kalıcı olarak silinecek. Bu işlem geri alınamaz.`, { title: 'Son onay', ok: 'Hepsini sil' }))) return;
  try {
    await auth.deleteCoach(c.username, v === 'transfer');
  } catch (e) {
    return toast(`Silinemedi: ${errMsg(e)}`, 'warn');
  }
  toast(v === 'transfer' && has ? `${c.username} silindi, oyuncuları size aktarıldı` : `${c.username} silindi`);
  renderCoaches();
}

// ------------------------------------------------------------------------ BAŞLAT
async function start() {
  // Başka bir sitenin içine gömülü açılmaz: görünmez çerçeveyle düğmelere tıklatılmasın (GitHub Pages
  // frame-ancestors başlığı gönderemediği için tarayıcıda denetlenir)
  if (window.top !== window.self) {
    app.innerHTML = `<div class="card warn"><h2>Bu sayfa başka bir sitenin içinde açılamaz</h2>
      <p><a href="${esc(location.href)}" target="_top" rel="noopener">Form Analiz'i ayrı sayfada açın</a></p></div>`;
    return;
  }
  if (auth.token()) {
    app.innerHTML = '<p class="hint loading">Yükleniyor…</p>';
    try {
      await auth.refreshSession();
    } catch (e) {
      // Sunucuya ulaşılamadı: kayıtlı oturumla devam edilir, sayfalar hatayı kendileri gösterir
      console.error(e);
    }
  }
  await route();
  if (auth.currentUser()) offerLegacyImport();
}
start();
