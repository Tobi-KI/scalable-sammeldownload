// Background Service Worker: fängt Downloads ab und speichert sie mit vernünftigem Dateinamen.
(() => {
  'use strict';

  // Dokument-Cache, vom Injector über content script gefüllt
  let docCache = [];

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SC_CLEAR_CACHE') { docCache = []; sendResponse({ ok: true }); return; }
    if (msg.type === 'SC_GET_CACHE') { sendResponse({ docs: docCache }); return; }
    if (msg.type === 'SC_PUSH_DOCS') {
      for (const d of msg.docs || []) {
        if (!docCache.some(x => x.url === d.url)) docCache.push(d);
      }
      sendResponse({ ok: true, count: docCache.length }); return;
    }
    if (msg.type === 'SC_SAVE_DATAURL') {
      chrome.downloads.download({
        url: msg.dataUrl,
        filename: `scalable-dokumente/${msg.name}`,
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

  function buildFilename(d) {
    const date = (d.date || '').replaceAll('-', '');
    const isin = (d.isin || '').trim();
    const label = (d.label || 'Dokument')
      .replace(/[^\w\-ÄÖÜäöüß ]+/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 40);
    const parts = [date, isin, label].filter(Boolean);
    let name = parts.join('_') || 'dokument';
    if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf';
    return name;
  }
})();