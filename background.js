// Background Service Worker: speichert PDFs mit vernünftigem Dateinamen
// in Unterordnern nach Belegart (Abrechnungen / Dividenden).
(() => {
  'use strict';

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SC_SAVE_DATAURL') {
      const sub = msg.folder === 'Dividenden' ? 'Dividenden' : 'Abrechnungen';
      chrome.downloads.download({
        url: msg.dataUrl,
        filename: `scalable-dokumente/${sub}/${msg.name}`,
        conflictAction: 'uniquify',
        saveAs: false
      }, (id) => {
        if (chrome.runtime.lastError || !id) {
          console.warn('[ScDocDL] save failed', chrome.runtime.lastError);
          sendResponse({ ok: false, error: chrome.runtime.lastError?.message || 'kein Download-ID' });
        } else {
          sendResponse({ ok: true, id });
        }
      });
      return true;
    }
  });
})();
