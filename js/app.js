// Screens and routing. Routes live in the URL hash so the phone's back
// button works:  #/  #/setup  #/voice  #/voice/first
//                #/m/<id>  #/m/<id>/stand  #/m/<id>/go  #/m/<id>/done

import { UI, METHODS, VOICE_SCRIPT, VOICE_GROUPS } from './data.js';
import { getSettings, setSettings, getPhoto, setPhoto, clearAll } from './store.js';
import {
  initVoices,
  refreshAmmaKeys,
  ammaCount,
  hasAmma,
  hasDefault,
  forgetAmma,
  decodeAndTune,
  say,
  stopVoice,
  ring,
  unlockAudio,
} from './sound.js';
import { putClip, deleteClip, clearClips } from './voicestore.js';
import { canRecord, startRecording } from './recorder.js';
import { loadImage, createCropper } from './cropper.js';
import { mountRitual } from './ritual.js';

const TOTAL_CUES = Object.keys(VOICE_SCRIPT).length;
const MAX_CLIP_SECONDS = 45;

const app = document.getElementById('app');
const sheet = document.getElementById('settings');

let settings = getSettings();
let cleanup = null; // teardown for the current screen
let keepVoice = false; // let a cue started on one screen finish on the next

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const other = () => (settings.lang === 'te' ? 'en' : 'te');
const t = (obj) => obj[settings.lang];
const bi = (obj) => `<span class="pri">${esc(obj[settings.lang])}</span><span class="sec">${esc(obj[other()])}</span>`;

function ammaName() {
  const n = (settings.ammaName || '').trim();
  return { te: n || 'అమ్మ', en: n || 'Amma' };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function updateSettings(patch) {
  settings = setSettings(patch);
  document.documentElement.lang = settings.lang;
}

// ------------------------------------------------------------- router --

function parse() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'setup') return { name: 'setup' };
  if (parts[0] === 'voice') return { name: 'voice', first: parts[1] === 'first' };
  if (parts[0] === 'm') {
    const method = METHODS.find((m) => m.id === parts[1]);
    if (!method) return { name: 'home' };
    const step = parts[2] || 'detail';
    return { name: step, method };
  }
  return { name: 'home' };
}

function render() {
  cleanup?.();
  cleanup = null;
  if (!keepVoice) stopVoice();
  keepVoice = false;
  document.documentElement.lang = settings.lang;

  const route = parse();
  if (!getPhoto() && route.name !== 'setup') {
    location.replace('#/setup');
    return;
  }

  const screens = { home, setup, voice, detail, stand, go: ritual, done };
  (screens[route.name] || home)(route);
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------- home --

function home() {
  const photo = getPhoto();
  app.innerHTML = `
<section class="screen">
  <div class="topbar">
    <button class="chip-btn" data-act="lang" aria-label="Change language">${settings.lang === 'te' ? 'EN' : 'తెలుగు'}</button>
    <button class="icon-btn" data-act="settings" aria-label="${esc(t(UI.settings))}">⚙️</button>
  </div>

  <header class="hero">
    <button class="amma-photo" data-act="photo" aria-label="${esc(t(UI.changePhoto))}">
      <img src="${esc(photo)}" alt="${esc(ammaName()[settings.lang])}" />
      <span class="edit" aria-hidden="true">✎</span>
    </button>
    <h1 class="title">${esc(UI.appName.te)}</h1>
    <p class="title-en">${esc(UI.appName.en)}</p>
    <p class="tagline bi center">${bi(UI.tagline)}</p>
    <button class="voice-chip ${ammaCount() ? 'has' : ''}" data-act="voice">
      <span aria-hidden="true">🎙️</span>
      ${
        ammaCount()
          ? `${esc(t(UI.voiceChip))} · ${ammaCount()}/${TOTAL_CUES}`
          : esc(t(UI.voiceChipAdd))
      }
    </button>
  </header>

  <h2 class="section-q bi center">${bi(UI.chooseMethod)}</h2>
  <ul class="methods">
    ${METHODS.map(
      (m) => `
    <li>
      <button class="method" data-method="${m.id}">
        <span class="emoji" aria-hidden="true">${m.emoji}</span>
        <span class="bi">${bi(m.name)}</span>
        <span class="arrow" aria-hidden="true">›</span>
      </button>
    </li>`,
    ).join('')}
  </ul>

  <p class="footnote">${esc(t(UI.privacy))}</p>
</section>`;

  const onClick = (e) => {
    const el = e.target.closest('[data-act], [data-method]');
    if (!el) return;
    unlockAudio();
    if (el.dataset.method) return go(`#/m/${el.dataset.method}`);
    if (el.dataset.act === 'lang') {
      updateSettings({ lang: other() });
      render();
    }
    if (el.dataset.act === 'settings') openSettings();
    if (el.dataset.act === 'photo') go('#/setup');
    if (el.dataset.act === 'voice') go('#/voice');
  };
  app.addEventListener('click', onClick);
  cleanup = () => app.removeEventListener('click', onClick);
}

// ------------------------------------------------------------- setup --

function setup() {
  const hasPhoto = !!getPhoto();
  app.innerHTML = `
<section class="screen">
  <div class="topbar">
    ${
      hasPhoto
        ? `<button class="chip-btn" data-act="back">← ${esc(t(UI.back))}</button>`
        : `<button class="chip-btn" data-act="lang" aria-label="Change language">${settings.lang === 'te' ? 'EN' : 'తెలుగు'}</button>`
    }
    <span></span>
  </div>

  <h1 class="setup-head bi center">${bi(UI.setupTitle)}<span class="sec">${esc(t(UI.setupSub))}</span></h1>

  <input type="file" accept="image/*" id="file" hidden />

  <div class="pick-state">
    <button class="pick" data-act="choose">
      <span class="bi center"><span class="plus" aria-hidden="true">📷</span>${bi(UI.addPhoto)}</span>
    </button>
  </div>

  <div class="crop-state" hidden>
    <div class="crop" aria-label="${esc(t(UI.dragHint))}"></div>
    <label class="zoom">
      <span aria-hidden="true">−</span>
      <input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom" />
      <span aria-hidden="true">+</span>
    </label>
    <p class="hint">${esc(t(UI.dragHint))}</p>

    <div class="field">
      <label for="amma-name">${esc(t(UI.ammaNameLabel))}</label>
      <input id="amma-name" maxlength="24" autocomplete="off" placeholder="${esc(t(UI.ammaNamePlaceholder))}" value="${esc(settings.ammaName)}" />
    </div>
  </div>

  <p class="error" hidden>${esc(t(UI.photoError))}</p>

  <div class="privacy"><span aria-hidden="true">🔒</span><span class="bi">${bi(UI.privacy)}</span></div>

  <div class="actions crop-actions" hidden>
    <button class="btn" data-act="save"><span class="bi center">${bi(UI.savePhoto)}</span></button>
    <button class="btn ghost" data-act="choose"><span class="bi center">${bi(UI.changePhoto)}</span></button>
  </div>
</section>`;

  const file = app.querySelector('#file');
  const pickState = app.querySelector('.pick-state');
  const cropState = app.querySelector('.crop-state');
  const cropActions = app.querySelector('.crop-actions');
  const errorEl = app.querySelector('.error');
  const frame = app.querySelector('.crop');
  const zoom = app.querySelector('.zoom input');
  let cropper = null;
  let objectUrl = null;

  async function onFile() {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    errorEl.hidden = true;
    try {
      const { img, url } = await loadImage(f);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = url;
      pickState.hidden = true;
      cropState.hidden = false;
      cropActions.hidden = false;
      cropper?.destroy();
      cropper = createCropper(frame, zoom, img);
    } catch {
      errorEl.hidden = false;
    }
  }

  function save() {
    if (!cropper) return;
    setPhoto(cropper.exportDataUrl());
    updateSettings({ ammaName: app.querySelector('#amma-name').value.trim().slice(0, 24) });
    ring({ enabled: settings.bell, strength: 0.7 });
    go(settings.voiceIntroSeen ? '#/' : '#/voice/first');
  }

  const onClick = (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    unlockAudio();
    switch (el.dataset.act) {
      case 'choose':
        file.click();
        break;
      case 'save':
        save();
        break;
      case 'back':
        history.length > 1 ? history.back() : go('#/');
        break;
      case 'lang':
        updateSettings({ lang: other() });
        render();
        break;
    }
  };

  app.addEventListener('click', onClick);
  file.addEventListener('change', onFile);
  cleanup = () => {
    app.removeEventListener('click', onClick);
    cropper?.destroy();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}

// ------------------------------------------------------------- Amma's voice --

function voice({ first }) {
  if (!settings.voiceIntroSeen) updateSettings({ voiceIntroSeen: true });
  const recOk = canRecord();
  const methodFor = (key) => METHODS.find((m) => 'finish_' + m.id === key);

  const cue = (key) => {
    const line = VOICE_SCRIPT[key];
    const m = methodFor(key);
    return `
    <li class="cue" data-key="${key}">
      ${m ? `<span class="cue-method">${m.emoji} ${esc(t(m.name))}</span>` : ''}
      <p class="cue-line bi"><span class="pri">“${esc(line.te)}”</span><span class="sec">${esc(line.en)}</span></p>
      <div class="cue-row">
        <span class="badge" data-badge></span>
        <span class="rec-time" aria-live="polite"></span>
        <span class="cue-actions">
          ${
            recOk
              ? `<button class="cue-btn rec" data-act="rec" aria-label="${esc(t(UI.record))}"><span class="ico">🎙️</span><span class="lbl">${esc(t(UI.record))}</span></button>`
              : ''
          }
          <button class="cue-btn" data-act="upload" aria-label="${esc(t(UI.upload))}" title="${esc(t(UI.upload))}">📁</button>
          <button class="cue-btn" data-act="play" aria-label="${esc(t(UI.play))}" title="${esc(t(UI.play))}">▶</button>
          <button class="cue-btn" data-act="del" aria-label="${esc(t(UI.remove))}" title="${esc(t(UI.remove))}">🗑</button>
        </span>
      </div>
    </li>`;
  };

  app.innerHTML = `
<section class="screen voice-screen">
  <div class="topbar">
    <button class="chip-btn" data-act="back">← ${esc(t(UI.back))}</button>
    <span class="pill"><b class="v-count">${ammaCount()}</b>/${TOTAL_CUES} ${esc(t(UI.recordedOf))}</span>
  </div>

  <header class="voice-head">
    <div class="mic-hero" aria-hidden="true">🎙️</div>
    <h1 class="bi center">${bi(UI.voiceTitle)}</h1>
    <p class="bi center">${bi(UI.voiceSub)}</p>
  </header>

  ${
    first
      ? `<div class="choice">
    <button class="btn sun" data-act="start-rec"><span class="bi center">${bi({ te: 'అవును, అమ్మ గొంతు పెడతా', en: "Yes, add Amma's voice" })}</span></button>
    <button class="btn ghost" data-act="skip"><span class="bi center">${bi(UI.voiceSkip)}</span></button>
  </div>`
      : ''
  }

  <div class="note-card">
    <p><span aria-hidden="true">✨</span><span class="bi">${bi(UI.voiceTune)}</span></p>
    <p><span aria-hidden="true">💛</span><span class="bi">${bi(UI.voiceSkipNote)}</span></p>
  </div>

  <details class="tips">
    <summary>${esc(t(UI.voiceHowTo))}</summary>
    <ul>${UI.voiceTips.map((tip) => `<li class="bi">${bi(tip)}</li>`).join('')}</ul>
  </details>

  <input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus" id="audio-file" hidden />

  ${VOICE_GROUPS.map(
    (g) => `
  <h2 class="group-title bi">${bi(g.title)}</h2>
  <ul class="cues">${g.keys.map(cue).join('')}</ul>`,
  ).join('')}

  <div class="privacy"><span aria-hidden="true">🔒</span><span class="bi">${bi({
    te: 'అమ్మ గొంతు కూడా నీ ఫోన్‌లోనే ఉంటుంది. ఎక్కడికీ అప్‌లోడ్ అవ్వదు.',
    en: "Amma's recordings also stay on your phone. They are never uploaded.",
  })}</span></div>

  <div class="actions">
    <button class="btn" data-act="finish"><span class="bi center">${bi(UI.voiceDone)}</span></button>
  </div>
</section>`;

  const file = app.querySelector('#audio-file');
  const countEl = app.querySelector('.v-count');
  let uploadKey = null;
  let recording = null; // { key, li, stop }
  let toastTimer = 0;

  const cueEl = (key) => app.querySelector(`.cue[data-key="${key}"]`);

  function paint(li) {
    const key = li.dataset.key;
    const amma = hasAmma(key);
    const fallback = hasDefault(key);
    const badge = li.querySelector('[data-badge]');
    badge.className = 'badge ' + (amma ? 'amma' : fallback ? 'default' : 'none');
    badge.textContent = t(amma ? UI.badgeAmma : fallback ? UI.badgeDefault : UI.badgeNone);
    li.querySelector('[data-act="play"]').disabled = !amma && !fallback;
    li.querySelector('[data-act="del"]').hidden = !amma;
    countEl.textContent = String(ammaCount());
  }
  app.querySelectorAll('.cue').forEach(paint);

  function showError(li, msg) {
    app.querySelectorAll('.cue-error').forEach((e) => e.remove());
    const p = document.createElement('p');
    p.className = 'cue-error';
    p.textContent = msg;
    li.appendChild(p);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => p.remove(), 6000);
  }

  async function save(key, data, type) {
    const li = cueEl(key);
    li.classList.add('busy');
    try {
      const { tuned, duration } = await decodeAndTune(data);
      if (duration > MAX_CLIP_SECONDS) return showError(li, t(UI.audioLong));
      if (!tuned) return showError(li, t(UI.audioSilent));
      await putClip(key, data, type);
      forgetAmma(key);
      await refreshAmmaKeys();
      paint(li);
      li.classList.add('saved');
      setTimeout(() => li.classList.remove('saved'), 1200);
      say(key, { source: 'amma' }); // let them hear the fine-tuned result
    } catch {
      showError(li, t(UI.audioBad));
    } finally {
      li.classList.remove('busy');
    }
  }

  function stopRecording() {
    if (!recording) return;
    recording.stop();
  }

  async function toggleRecord(li) {
    const key = li.dataset.key;
    if (recording) {
      const same = recording.key === key;
      stopRecording();
      if (same) return;
    }
    stopVoice();
    const btn = li.querySelector('[data-act="rec"]');
    const timeEl = li.querySelector('.rec-time');
    try {
      const session = await startRecording({
        onLevel: (l) => li.style.setProperty('--level', l.toFixed(2)),
        onTick: (sec) => (timeEl.textContent = `0:${String(sec).padStart(2, '0')}`),
      });
      recording = { key, li, stop: session.stop };
      li.classList.add('recording');
      btn.querySelector('.ico').textContent = '⏹';
      btn.querySelector('.lbl').textContent = t(UI.stop);
      timeEl.textContent = '0:00';

      const blob = await session.result;
      recording = null;
      li.classList.remove('recording');
      li.style.removeProperty('--level');
      btn.querySelector('.ico').textContent = '🎙️';
      btn.querySelector('.lbl').textContent = t(UI.record);
      timeEl.textContent = '';
      if (blob.size) await save(key, await blob.arrayBuffer(), blob.type);
    } catch {
      recording = null;
      li.classList.remove('recording');
      showError(li, t(UI.micBlocked));
    }
  }

  async function onFile() {
    const f = file.files?.[0];
    file.value = '';
    if (!f || !uploadKey) return;
    await save(uploadKey, await f.arrayBuffer(), f.type || 'audio/*');
  }

  const onClick = async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    unlockAudio();
    const li = el.closest('.cue');
    const key = li?.dataset.key;
    switch (el.dataset.act) {
      case 'rec':
        toggleRecord(li);
        break;
      case 'upload':
        stopRecording();
        uploadKey = key;
        file.click();
        break;
      case 'play':
        say(key, { source: hasAmma(key) ? 'amma' : 'default' });
        break;
      case 'del':
        if (!confirm(t(UI.removeConfirm))) return;
        await deleteClip(key);
        forgetAmma(key);
        await refreshAmmaKeys();
        paint(li);
        break;
      case 'back':
        history.length > 1 ? history.back() : go('#/');
        break;
      case 'start-rec':
        app.querySelector('.choice')?.remove();
        app.querySelector('.group-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      case 'finish':
      case 'skip':
        go('#/');
        break;
    }
  };

  app.addEventListener('click', onClick);
  file.addEventListener('change', onFile);
  cleanup = () => {
    app.removeEventListener('click', onClick);
    stopRecording();
    clearTimeout(toastTimer);
  };
}

// ------------------------------------------------------------- method detail --

function detail({ method: m }) {
  app.innerHTML = `
<section class="screen">
  <div class="topbar">
    <button class="chip-btn" data-act="back">← ${esc(t(UI.back))}</button>
    <span></span>
  </div>

  <header class="method-head">
    <div class="big-emoji" aria-hidden="true">${m.emoji}</div>
    <h1 class="bi center">${bi(m.name)}</h1>
  </header>

  <section class="card need">
    <h2 class="bi">${bi(UI.youNeed)}</h2>
    <ul class="checklist">
      ${m.items
        .map(
          (item, i) => `
      <li>
        <label class="check">
          <input type="checkbox" data-item="${i}" />
          <span class="bi">${bi(item)}</span>
        </label>
      </li>`,
        )
        .join('')}
    </ul>
  </section>

  <section class="card safe">
    <h2 class="bi">${bi(UI.careful)}</h2>
    <ul class="safe-list">
      ${m.safety.map((s) => `<li><span class="bi">${bi(s)}</span></li>`).join('')}
    </ul>
  </section>

  <div class="actions sticky">
    <button class="btn" data-act="ready"><span class="bi center">${bi(UI.ready)}</span></button>
  </div>
</section>`;

  const onClick = (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    unlockAudio();
    if (el.dataset.act === 'back') go('#/');
    if (el.dataset.act === 'ready') {
      say('ready', { enabled: settings.voice });
      keepVoice = true;
      go(`#/m/${m.id}/stand`);
    }
  };
  app.addEventListener('click', onClick);
  cleanup = () => app.removeEventListener('click', onClick);
}

// ------------------------------------------------------------- stand --

function stand({ method: m }) {
  app.innerHTML = `
<section class="screen">
  <div class="topbar">
    <button class="chip-btn" data-act="back">← ${esc(t(UI.back))}</button>
    <span></span>
  </div>

  <div class="stand-art" aria-hidden="true"><span class="phone">📱</span><span>🧍</span></div>

  <h1 class="stand-title bi center">${bi(UI.standTitle)}</h1>
  <p class="stand-body bi center">${bi(UI.standBody)}</p>
  <p class="stand-body bi center">${bi(UI.mirrorNote)}</p>

  <div class="hold">
    <span class="emoji" aria-hidden="true">${m.emoji}</span>
    <span><small>${esc(t(UI.holdIn))}</small><span class="bi">${bi(m.holding)}</span></span>
  </div>

  <div class="actions">
    <button class="btn sun" data-act="begin"><span class="bi center">${bi(UI.begin)}</span></button>
  </div>
</section>`;

  // The 'ready' cue was started by the tap on the previous screen.
  const onClick = (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    unlockAudio();
    if (el.dataset.act === 'back') go(`#/m/${m.id}`);
    if (el.dataset.act === 'begin') go(`#/m/${m.id}/go`);
  };
  app.addEventListener('click', onClick);
  cleanup = () => app.removeEventListener('click', onClick);
}

// ------------------------------------------------------------- ritual --

function ritual({ method: m }) {
  const player = mountRitual(app, {
    method: m,
    photo: getPhoto(),
    settings,
    onSettings: (patch) => updateSettings(patch),
    onDone: () => location.replace(`#/m/${m.id}/done`),
    onExit: () => go('#/'),
  });
  cleanup = () => player.destroy();
}

// ------------------------------------------------------------- done --

function done({ method: m }) {
  const name = ammaName();
  const blessing = {
    te: `${name.te} ఆశీర్వాదం ఎప్పుడూ నీతోనే. నవ్వుతూ ఉండు.`,
    en: `${name.en}'s blessings are always with you. Keep smiling.`,
  };

  app.innerHTML = `
<section class="screen done">
  <div class="amma-photo"><img src="${esc(getPhoto())}" alt="${esc(name[settings.lang])}" /></div>
  <h1 class="bi center">${bi(UI.doneTitle)}</h1>
  <p class="bi center">${bi(blessing)}</p>
  <div class="actions">
    <button class="btn" data-act="home"><span class="bi center">${bi(UI.goHome)}</span></button>
    <button class="btn ghost" data-act="again"><span class="bi center">${bi(UI.again)}</span></button>
  </div>
</section>
<div class="petals" aria-hidden="true"></div>`;

  const petals = app.querySelector('.petals');
  const colors = ['#f5a524', '#f97316', '#e8457a', '#ffc94a', '#2f9e58'];
  for (let i = 0; i < 36; i++) {
    const p = document.createElement('span');
    p.className = 'petal';
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = 3.5 + Math.random() * 3 + 's';
    p.style.animationDelay = Math.random() * 2.5 + 's';
    p.style.setProperty('--drift', (Math.random() * 120 - 60).toFixed(0) + 'px');
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    petals.appendChild(p);
  }

  ring({ enabled: settings.bell, strength: 1 });
  say('done', { enabled: settings.voice });

  const onClick = (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'home') go('#/');
    if (el.dataset.act === 'again') go(`#/m/${m.id}/stand`);
  };
  app.addEventListener('click', onClick);
  cleanup = () => app.removeEventListener('click', onClick);
}

// ------------------------------------------------------------- settings sheet --

function openSettings() {
  const seg = (key, options) =>
    `<div class="seg" role="group">${options
      .map(
        ([value, label]) =>
          `<button data-set="${key}" data-value="${value}" aria-pressed="${settings[key] === value}">${esc(label)}</button>`,
      )
      .join('')}</div>`;

  sheet.innerHTML = `
<div class="sheet-inner">
  <h2 id="settings-title">${esc(t(UI.settings))}</h2>

  <div class="row">
    <span class="label">${esc(t(UI.ammaPhoto))}</span>
    <span style="display:flex;align-items:center;gap:10px">
      <img class="thumb" src="${esc(getPhoto())}" alt="" />
      <button class="small-btn" data-act="photo">${esc(t(UI.changePhoto))}</button>
    </span>
  </div>

  <div class="field">
    <label for="sheet-name">${esc(t(UI.ammaNameLabel))}</label>
    <input id="sheet-name" maxlength="24" autocomplete="off" placeholder="${esc(t(UI.ammaNamePlaceholder))}" value="${esc(settings.ammaName)}" />
  </div>

  <div class="row">
    <span class="label">${esc(t(UI.language))}</span>
    ${seg('lang', [
      ['te', 'తెలుగు'],
      ['en', 'English'],
    ])}
  </div>

  <div class="row">
    <span class="label">${esc(t(UI.voiceChip))}</span>
    <button class="small-btn" data-act="voice">🎙️ ${ammaCount()}/${TOTAL_CUES} · ${esc(t(UI.manage))}</button>
  </div>

  <div class="row">
    <span class="label">${esc(t(UI.whoseVoice))}</span>
    ${seg('voiceSource', [
      ['amma', t(UI.ammaVoiceShort)],
      ['default', t(UI.defaultVoiceShort)],
    ])}
  </div>

  <div class="row">
    <label class="label" for="sw-voice">${esc(t(UI.voiceOn))}</label>
    <input type="checkbox" class="switch" id="sw-voice" data-toggle="voice" ${settings.voice ? 'checked' : ''} />
  </div>

  <div class="row">
    <label class="label" for="sw-bg">${esc(t(UI.bgVoice))}</label>
    <input type="checkbox" class="switch" id="sw-bg" data-toggle="bgVoice" ${settings.bgVoice !== false ? 'checked' : ''} />
  </div>

  <div class="row">
    <label class="label" for="sw-bell">${esc(t(UI.bellOn))}</label>
    <input type="checkbox" class="switch" id="sw-bell" data-toggle="bell" ${settings.bell ? 'checked' : ''} />
  </div>

  <div class="row">
    <span class="label">${esc(t(UI.speed))}</span>
    ${seg('speed', [
      ['slow', t(UI.slow)],
      ['normal', t(UI.normal)],
    ])}
  </div>

  <div class="row">
    <button class="small-btn danger" data-act="clear">${esc(t(UI.clearAll))}</button>
  </div>

  <div class="actions">
    <button class="btn" data-act="close"><span class="bi center">${bi(UI.closeSheet)}</span></button>
  </div>
</div>`;

  const nameInput = sheet.querySelector('#sheet-name');
  nameInput.addEventListener('change', () => updateSettings({ ammaName: nameInput.value.trim().slice(0, 24) }));

  sheet.onclick = (e) => {
    if (e.target === sheet) return close(); // tap on the backdrop
    const el = e.target.closest('[data-act], [data-set]');
    if (!el) return;
    if (el.dataset.set) {
      updateSettings({ [el.dataset.set]: el.dataset.value });
      openSettings(); // re-render in place (language may have changed)
      return;
    }
    if (el.dataset.act === 'photo') {
      close();
      go('#/setup');
    }
    if (el.dataset.act === 'voice') {
      close();
      go('#/voice');
    }
    if (el.dataset.act === 'clear' && confirm(t(UI.clearConfirm))) {
      clearAll();
      clearClips().then(refreshAmmaKeys);
      settings = getSettings();
      close();
      go('#/setup');
    }
    if (el.dataset.act === 'close') close();
  };

  sheet.onchange = (e) => {
    const key = e.target.dataset.toggle;
    if (!key) return;
    updateSettings({ [key]: e.target.checked });
    if (key === 'bell' && e.target.checked) ring({ strength: 0.5 });
  };

  function close() {
    updateSettings({ ammaName: nameInput.value.trim().slice(0, 24) });
    sheet.close();
  }

  sheet.onclose = () => render();
  if (!sheet.open) sheet.showModal();
}

// ------------------------------------------------------------- boot --

window.addEventListener('hashchange', render);
for (const type of ['pointerdown', 'touchend', 'keydown']) {
  document.addEventListener(type, unlockAudio, { capture: true, passive: true });
}
initVoices().finally(render);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
