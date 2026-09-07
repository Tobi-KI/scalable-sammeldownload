// Läuft in der Seiten-Welt (MAIN world via injector): NOTFALL-INTERCEPTOR.
// Der reguläre Download läuft komplett über content.js (direkte GraphQL- und
// Download-API-Calls, live verifiziert). Der Interceptor bleibt als Fallback
// erhalten: er beobachtet App-Antworten mit Dokumentenlisten, damit zukünftige
// API-Änderungen seitens Scalable wenigstens im Log sichtbar werden.
(function () {
  if (window.__scDocInterceptorInstalled) return;
  window.__scDocInterceptorInstalled = true;

  function classifyDocType(label) {
    const l = (label || '').toLowerCase();
    if (/dividend|ertrag|ausschütt/.test(l)) return 'Dividende';
    if (/abrechnung/.test(l)) return 'Abrechnung';
    return 'Sonstiges';
  }

  function harvest(text) {
    if (!text || typeof text !== 'string' || text.length > 5_000_000) return;
    if (!text.includes('documents')) return;
    let data;
    try { data = JSON.parse(text); } catch { return; }
    let count = 0;
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (Array.isArray(node.documents)) {
        for (const d of node.documents) {
          if (d && typeof d.url === 'string') {
            count++;
            console.log('[ScDocDL:injector] Dokument in App-Antwort:', {
              label: typeof d.label === 'string' ? d.label : '?',
              docType: classifyDocType(typeof d.label === 'string' ? d.label : ''),
              id: typeof d.id === 'string' ? d.id : ''
            });
          }
        }
      }
      for (const k in node) walk(node[k]);
    })(data);
    if (count) console.log(`[ScDocDL:injector] ${count} Dokument(e) in App-Antwort gesehen.`);
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const ct = res.headers?.get?.('content-type') || '';
      if (ct.includes('json')) {
        const clone = res.clone();
        clone.text().then(harvest).catch(() => {});
      }
    } catch {}
    return res;
  };

  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    const origOpen = xhr.open;
    xhr.open = function (method, url, ...rest) {
      xhr.addEventListener('load', () => {
        try {
          const ct = xhr.getResponseHeader?.('content-type') || '';
          if (ct.includes('json') && typeof xhr.responseText === 'string') harvest(xhr.responseText);
        } catch {}
      });
      return origOpen.call(this, method, url, ...rest);
    };
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;
})();
