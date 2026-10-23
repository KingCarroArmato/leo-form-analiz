// Arayüz ikonları (24x24, çizgi). Emoji yerine her yerde aynı görünen SVG kullanılır.

const P = {
  players: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15.5 5.2a3 3 0 0 1 0 5.6"/><path d="M17.5 14.3c1.6.6 2.7 2.2 3 4.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  jump: '<path d="M3 20h4M17 20h4"/><path d="M5.5 20C7.5 9.5 16.5 9.5 18.5 20"/><circle cx="12" cy="8.5" r="2.4" fill="currentColor" stroke="none"/><path d="M12 3.5v1"/>',
  run: '<path d="M3 8h6M3 12h9M3 16h6"/><path d="M14 6.5 19.5 12 14 17.5"/>',
  spin: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v3.8h-3.8"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  film: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="m3.5 15 4.5-4 4 3.5 3-2.5 5.5 4.5"/><circle cx="15.5" cy="9" r="1.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  play: '<path d="M7.5 5.3v13.4a.8.8 0 0 0 1.2.7l10.6-6.7a.8.8 0 0 0 0-1.4L8.7 4.6a.8.8 0 0 0-1.2.7Z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.7" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none"/>',
  trash: '<path d="M4.5 7h15M10 7V5h4v2M6.5 7l1 12.5h9l1-12.5"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="3.5" y="9" width="17" height="7.5" rx="2"/><path d="M7 14h10v6H7z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  upload: '<path d="M12 16V5M7 9.5l5-5 5 5M5 20h14"/>',
  note: '<path d="M5 4.5h14v10l-5 5H5z"/><path d="M14 19.5v-5h5M8.5 9h7M8.5 12.5h4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 16.8v.2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="6" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="m8.3 10.8 7-3.6M8.3 13.2l7 3.6"/>',
  userPlus: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M18 8v6M15 11h6"/>',
  logout: '<path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4"/><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.75 4.75 0 0 0 7 18.5Z"/><path d="M12 15.5v-5M9.8 12.5 12 10.3l2.2 2.2"/>',
  motion: '<circle cx="14" cy="4.5" r="2"/><path d="m8 21 3.5-5.5L9 12l2.5-4.5 3.5 3 3.5.5"/><path d="m11.5 15.5 3.5 1.5 1.5 4"/><path d="M11.5 7.5 7.5 9 5.5 12"/>',
  edit: '<path d="M4.5 19.5h4l10-10-4-4-10 10z"/><path d="m13 7 4 4"/>',
};

/** SVG ikon metni döndürür. */
export function icon(name, size = 20, cls = '') {
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

export const TEST_ICON = { jump: 'jump', run: 'run', spin: 'spin', free: 'motion' };
