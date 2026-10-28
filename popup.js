// Popup: Haftungshinweis bestätigen (schaltet die Erweiterung frei) und
// Einstellungen. Ablageort liest background.js, Dateiname/Verlauf content.js.
const KEY = 'scDocDlAccepted';
const SETTINGS_KEY = 'scDocDlSettings';
const DONE_KEY = 'scDocDlDone';
const DEFAULTS = { folder: 'scalable-dokumente', byKind: true, byYear: false, dateFirst: false, skipDone: true };

const $ = (id) => document.getElementById(id);
const gate = $('gate');
const accepted = $('accepted');
const fFolder = $('set-folder');
const fKind = $('set-bykind');
const fYear = $('set-byyear');
const fName = $('set-name');
const fSkip = $('set-skip');

chrome.storage.local.get([KEY, SETTINGS_KEY, DONE_KEY], (r) => {
  if (r[KEY]) showAccepted();
  const s = { ...DEFAULTS, ...r[SETTINGS_KEY] };
  fFolder.value = s.folder;
  fKind.checked = s.byKind;
  fYear.checked = s.byYear;
  fName.value = s.dateFirst ? 'date' : 'name';
  fSkip.checked = s.skipDone;
  showDoneCount((r[DONE_KEY] || []).length);
  updatePreview();
});

$('accept').addEventListener('click', () => {
  chrome.storage.local.set({ [KEY]: true }, showAccepted);
});

$('revoke').addEventListener('click', () => {
  chrome.storage.local.set({ [KEY]: false }, () => {
    accepted.style.display = 'none';
    gate.style.display = 'block';
  });
});

// Zeigt die zuletzt gespeicherte Datei im Explorer (Logik in background.js)
$('open-folder').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'SC_SHOW_FOLDER' });
});

$('done-reset').addEventListener('click', () => {
  chrome.storage.local.remove(DONE_KEY, () => showDoneCount(0));
});

function showAccepted() {
  gate.style.display = 'none';
  accepted.style.display = 'block';
}

function showDoneCount(n) {
  $('done-count').textContent = String(n);
  $('done-reset').disabled = n === 0;
}

// Gleiche Bereinigung wie in background.js, damit die Vorschau stimmt
function cleanPath(p) {
  return String(p || '').split(/[\\/]+/)
    .map(s => s.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim().replace(/^\.+|[. ]+$/g, ''))
    .filter(Boolean).join('/');
}

function currentSettings() {
  return {
    folder: cleanPath(fFolder.value),
    byKind: fKind.checked,
    byYear: fYear.checked,
    dateFirst: fName.value === 'date',
    skipDone: fSkip.checked
  };
}

function updatePreview() {
  const s = currentSettings();
  const parts = ['Downloads', s.folder];
  if (s.byKind) parts.push('Abrechnungen');
  if (s.byYear) parts.push(String(new Date().getFullYear()));
  parts.push(s.dateFirst
    ? '20260907_iShares_Core_MSCI_World_IE00B4L5Y983_Abrechnung.pdf'
    : 'iShares_Core_MSCI_World_IE00B4L5Y983_Abrechnung_20260907.pdf');
  $('set-preview').textContent = parts.filter(Boolean).join('/');
}

let savedTimer;
function save() {
  chrome.storage.local.set({ [SETTINGS_KEY]: currentSettings() }, () => {
    const el = $('set-saved');
    el.style.visibility = 'visible';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { el.style.visibility = 'hidden'; }, 1500);
  });
}

fFolder.addEventListener('input', updatePreview);
fFolder.addEventListener('change', () => {
  fFolder.value = cleanPath(fFolder.value);
  save();
});
for (const el of [fKind, fYear, fName, fSkip]) {
  el.addEventListener('change', () => { updatePreview(); save(); });
}
