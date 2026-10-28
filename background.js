// Background Service Worker: speichert PDFs mit vernünftigem Dateinamen.
// Ablageort kommt aus den Einstellungen im Popup: Ordner relativ zum
// Download-Ordner, optional Unterordner nach Belegart und/oder Jahr.
(() => {
  'use strict';

  const SETTINGS_KEY = 'scDocDlSettings';
  const LAST_KEY = 'scDocDlLastDownload'; // ID des zuletzt gespeicherten PDFs
  const DEFAULTS = { folder: 'scalable-dokumente', byKind: true, byYear: false };

  // Chrome erlaubt nur Pfade innerhalb des Download-Ordners: keine absoluten
  // Pfade, kein "..", keine unter Windows verbotenen Zeichen
  function cleanSegment(s) {
    return String(s).replace(/[<>:"|?*\u0000-\u001f]/g, '').trim().replace(/^\.+|[. ]+$/g, '');
  }
  function cleanPath(p) {
    return String(p || '').split(/[\\/]+/).map(cleanSegment).filter(Boolean).join('/');
  }

  async function targetPath(msg) {
    const r = await chrome.storage.local.get(SETTINGS_KEY);
    const s = { ...DEFAULTS, ...r[SETTINGS_KEY] };
    const base = cleanPath(s.folder);
    const parts = [base];
    if (s.byKind) parts.push(msg.folder === 'Dividenden' ? 'Dividenden' : 'Abrechnungen');
    if (s.byYear && /^\d{4}$/.test(msg.year || '')) parts.push(msg.year);
    parts.push(cleanSegment(msg.name) || 'dokument.pdf');
    return { base, filename: parts.filter(Boolean).join('/') };
  }

  // Explorer mit der zuletzt gespeicherten Datei markiert öffnen; existiert sie
  // nicht mehr (oder gab es noch keinen Download), den Download-Ordner
  async function showFolder() {
    const { [LAST_KEY]: id } = await chrome.storage.local.get(LAST_KEY);
    if (id) {
      const [item] = await chrome.downloads.search({ id });
      if (item?.exists) { chrome.downloads.show(id); return; }
    }
    chrome.downloads.showDefaultFolder();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SC_SHOW_FOLDER') {
      showFolder().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg.type !== 'SC_SAVE_DATAURL') return;
    targetPath(msg).then(({ base, filename }) => {
      chrome.downloads.download({
        url: msg.dataUrl,
        filename,
        conflictAction: 'uniquify',
        saveAs: false
      }, (id) => {
        if (chrome.runtime.lastError || !id) {
          console.warn('[ScDocDL] save failed', chrome.runtime.lastError);
          sendResponse({ ok: false, error: chrome.runtime.lastError?.message || 'kein Download-ID' });
        } else {
          chrome.storage.local.set({ [LAST_KEY]: id });
          sendResponse({ ok: true, id, base });
        }
      });
    }).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  });
})();
