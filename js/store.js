// Everything is kept in localStorage on the user's own phone.
// Reads and writes are wrapped because storage can be blocked (private mode).

const KEYS = {
  photo: 'ad.photo',
  settings: 'ad.settings',
};

const DEFAULTS = {
  lang: 'te',
  voice: true,
  bell: true,
  speed: 'normal',
  ammaName: '',
  voiceSource: 'amma', // 'amma' = Amma's clip when recorded, else default; 'default' = always default
  voiceIntroSeen: false,
  bgVoice: true, // the looping background voice during the ritual
};

let memoryPhoto = null; // fallback when storage is unavailable

export function getSettings() {
  try {
    const raw = localStorage.getItem(KEYS.settings);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEYS.settings, JSON.stringify(next));
  } catch {}
  return next;
}

export function getPhoto() {
  try {
    return localStorage.getItem(KEYS.photo) || memoryPhoto;
  } catch {
    return memoryPhoto;
  }
}

export function setPhoto(dataUrl) {
  memoryPhoto = dataUrl;
  try {
    localStorage.setItem(KEYS.photo, dataUrl);
  } catch {}
}

export function clearAll() {
  memoryPhoto = null;
  try {
    localStorage.removeItem(KEYS.photo);
    localStorage.removeItem(KEYS.settings);
  } catch {}
}
