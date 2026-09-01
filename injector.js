// Läuft in der Seiten-Welt (MAIN world via injector): patcht fetch/XHR und
// sammelt jede Antwort, die Dokumenten-Listen enthält.
(function () {
  if (window.__scDocInterceptorInstalled) return;
  window.__scDocInterceptorInstalled = true;

  const seen = new Set();
  const isinNameCache = {}; // isin -> Wertpapiername, aus beliebigen Antworten gesammelt

  function harvest(text) {
    if (!text || typeof text !== 'string' || text.length > 5_000_000) return;
    if (!text.includes('documents')) return;
    let data;
    try { data = JSON.parse(text); } catch { return; }
    const docs = [];
    const isinByName = {};

    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }

      // Transaktions-Objekt merken (id + isin + Datum), falls vorhanden
      if (typeof node.id === 'string' && typeof node.isin === 'string') {
        isinByName[node.id] = {
          isin: node.isin,
          name: typeof node.security?.name === 'string' ? node.security.name : '',
          date: typeof node.lastEventDateTime === 'string' ? node.lastEventDateTime.slice(0, 10) : ''
        };
      }
      if (typeof node.security?.isin === 'string' && typeof node.security?.name === 'string') {
        isinNameCache[node.security.isin] = node.security.name;
      }
      if (Array.isArray(node.documents)) {
        for (const d of node.documents) {
          if (d && typeof d.url === 'string' && !docs.some(x => x.url === d.url)) {
            const isin = typeof node.security?.isin === 'string' ? node.security.isin : '';
            const name = typeof node.security?.name === 'string' ? node.security.name : (isinNameCache[isin] || '');
            // Sparplan-Erkennung: savingsPlan-Objekt oder "Sparplan" in Beschreibung/Typ
            const isSparplan =
              !!node.savingsPlan ||
              /sparplan/i.test(typeof node.description === 'string' ? node.description : '') ||
              /sparplan/i.test(typeof node.securityTransactionType === 'string' ? node.securityTransactionType : '') ||
              /sparplan/i.test(typeof node.nonTradeSecurityTransactionType === 'string' ? node.nonTradeSecurityTransactionType : '');
            docs.push({
              id: typeof d.id === 'string' ? d.id : '',
              url: d.url,
              label: typeof d.label === 'string' ? d.label : 'Dokument',
              // Kontext: nächstgelegene Transaktionsdaten im selben Knoten
              isin,
              name,
              isSparplan,
              date: typeof node.lastEventDateTime === 'string' ? node.lastEventDateTime.slice(0, 10) : ''
            });
          }
        }
      }
      for (const k in node) walk(node[k]);
    })(data);

    if (docs.length) {
      // Kontext aus isinByName ergänzen, wenn im Dokument-Knoten fehlend
      const enriched = [];
      for (const d of docs) {
        if (!d.isin || !d.date) {
          for (const [tid, ctx] of Object.entries(isinByName)) {
            if (d.url.includes(tid)) { d.isin = d.isin || ctx.isin; d.date = d.date || ctx.date; d.name = d.name || ctx.name; }
          }
        }
        if (d.isin || d.date) { window.__scDocCache.push(d); enriched.push(d); }
      }
      if (enriched.length) {
        // Isolated-world content script kann page-Variablen nicht lesen -> DOM-Event
        window.dispatchEvent(new CustomEvent('sc-docdl-docs', { detail: enriched }));
      }
    }
  }

  window.__scDocCache = window.__scDocCache || [];

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