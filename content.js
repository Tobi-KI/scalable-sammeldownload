// Content Script (isolated world): UI-Checkboxen + Kommunikation mit background.js
(() => {
  'use strict';

  const API = (window.chrome ?? window.browser)?.runtime;

  function log(...a) { console.log('[ScDocDL]', ...a); }

  // ---------- Checkboxen an Transaktionslisten ----------
  // Kandidaten: klickbare Listen-/Grid-Zeilen, die eine Datums-/Betragsstruktur haben
  function findRowCandidates() {
    const rows = document.querySelectorAll(
      'main [role="row"], [data-testid*="transaction"], [class*="TransactionListItem"], [class*="transactions"] li'
    );
    const out = [];
    for (const row of rows) {
      const txt = (row.innerText || '').trim();
      if (txt.length < 8 || txt.length > 400) continue;
      // Heuristik: enthält ein Datum (tt.mm.jjjj / yyyy-mm-dd) ODER Betrag
      const hasDate = /\b\d{2}\.\d{2}\.\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/.test(txt);
      const hasAmount = /-?\d{1,3}(\.\d{3})*(,\d{2})?\s?(€|EUR|USD)/.test(txt);
      if (!hasDate && !hasAmount) continue;
      out.push(row);
    }
    return out;
  }

  function addCheckboxes() {
    const rows = findRowCandidates();
    for (const row of rows) {
      if (row.querySelector(':scope > .sc-docdl-cell')) continue;
      const cell = document.createElement('div');
      cell.className = 'sc-docdl-cell';
      cell.style.cssText =
        'flex:0 0 auto;min-width:34px;display:flex;align-items:center;justify-content:center;padding-right:8px;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'sc-docdl-cb';
      cb.style.cssText = 'width:17px;height:17px;cursor:pointer;accent-color:#00a0af;';
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        row.__scDocSelected = cb.checked;
      });
      // Auch Klicks auf die Zeile dürfen das Häkchen spiegeln? Nein – Zeile öffnet Detailansicht.
      cell.appendChild(cb);
      row.style.display = row.style.display || ''; // Layout nicht anfassen
      row.insertBefore(cell, row.firstChild);
      row.__scDocSelected = false;
      row.__scDocCheckbox = cb;
    }
  }

  // ---------- Brücke MAIN world -> hier -> background ----------
  window.addEventListener('sc-docdl-docs', (e) => {
    const docs = e.detail || [];
    if (docs.length) API.sendMessage({ type: 'SC_PUSH_DOCS', docs }).catch(() => {});
  });

  // ---------- Panel ----------
  let panel;
  function ensurePanel() {
    if (panel && document.body.contains(panel)) return panel;
    panel = document.createElement('div');
    panel.id = 'sc-docdl-panel';
    panel.style.cssText = [
      'position:fixed', 'bottom:18px', 'right:18px', 'z-index:2147483600',
      'background:#fff', 'color:#1a2b3c', 'border:1px solid #d7dee5', 'border-radius:12px',
      'box-shadow:0 8px 30px rgba(0,0,0,.18)', 'padding:14px 16px', 'font:13px/1.4 system-ui,sans-serif',
      'min-width:230px'
    ].join(';');
    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;">📄 Sammeldownload</div>
      <button id="sc-docdl-refresh" style="margin-right:6px;">Zeilen scannen</button>
      <button id="sc-docdl-download">Ausgewählte laden</button>
      <div id="sc-docdl-status" style="margin-top:8px;color:#555;white-space:pre-line;"></div>
      <style>
        #sc-docdl-panel button{padding:5px 10px;border-radius:7px;border:1px solid #c8d2da;background:#f4f7f9;cursor:pointer;font-size:12px}
        #sc-docdl-panel button:hover{background:#e7eef2}
        #sc-docdl-panel button.primary{background:#00a0af;color:#fff;border-color:#00a0af}
      </style>`;
    document.body.appendChild(panel);

    panel.querySelector('#sc-docdl-refresh').addEventListener('click', () => {
      addCheckboxes();
      const n = document.querySelectorAll('.sc-docdl-cb').length;
      setStatus(`${n} Zeilen mit Checkbox gefunden.`);
    });
    panel.querySelector('#sc-docdl-download').addEventListener('click', onDownload);
    return panel;
  }

  function setStatus(t) {
    const el = panel?.querySelector('#sc-docdl-status');
    if (el) el.textContent = t;
  }

  // ---------- Ablauf des Sammel-Downloads ----------
  let running = false;

  async function onDownload() {
    if (running) return;
    const selectedRows = [...document.querySelectorAll('.sc-docdl-cb')]
      .filter(cb => cb.checked)
      .map(cb => cb.closest('.sc-docdl-cell').parentElement);
    if (!selectedRows.length) { setStatus('Nichts ausgewählt.'); return; }

    running = true;
    setStatus(`0/${selectedRows.length} – öffne Transaktionen…`);

    // Cache leeren (nur neue Documents von dieser Session sammeln)
    await API.sendMessage({ type: 'SC_CLEAR_CACHE' }).catch(() => {});

    // Merker, welche URLs wir schon zuordnen konnten
    const collected = new Map(); // url -> {isin,name,date,label}
    let priorCache = [];

    for (let i = 0; i < selectedRows.length; i++) {
      const row = selectedRows[i];
      const label = (row.innerText || '').replace(/\s+/g, ' ').slice(0, 60);
      try {
        row.scrollIntoView({ block: 'center' });
        row.click(); // öffnet Detailansicht → App feuert GraphQL-Requests → Injector sammelt
      } catch (e) { log('row click failed', e); }

      // warten bis neue Dokumente im Cache auftauchen (max. 4 s)
      const found = await waitForNewDocs(priorCache, 4000);
      priorCache = found.slice();
      for (const d of found) if (!collected.has(d.url)) collected.set(d.url, d);

      setStatus(`${i + 1}/${selectedRows.length} – ${collected.size} Dokumente`);
      await sleep(250);
    }

    // Zurück zur Listenansicht navigieren? Der Nutzer klickt ggf. selbst zurück.
    setStatus(`Fertig: ${collected.size} Dokumente gefunden – starte Download…`);

    // Alles an background zum Speichern
    let docs = [...collected.values()];
    // Nur Wertpapierabrechnungen herunterladen
    const filtered = docs.filter(d => /abrechnung/i.test(d.label || ''));
    if (!filtered.length) {
      setStatus(`⚠️ ${docs.length} Dokumente gefunden, aber keine Wertpapierabrechnung dabei. Labels: ${[...new Set(docs.map(d => d.label || '?'))].join(', ') || 'keine'}`);
      running = false;
      return;
    }
    setStatus(`Fertig: ${filtered.length} Wertpapierabrechnungen gefunden – starte Download…`);

    // PDFs direkt aus der angemeldeten Seite laden (Session-Cookies inklusive)
    let ok = 0;
    const errors = [];
    for (let i = 0; i < filtered.length; i++) {
      const d = filtered[i];
      setStatus(`Lade ${i + 1}/${filtered.length}: ${d.label || 'Dokument'}…`);
      try {
        const res = await fetchDocPdf(d);
        if (!res.ok) {
          errors.push(`${d.label || d.date}: HTTP ${res.status} (${res.via})`);
          continue;
        }
        const blob = res.blob;
        const dataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
        const resp = await API.sendMessage({ type: 'SC_SAVE_DATAURL', name: buildFilename(d), dataUrl }).catch(() => null);
        if (resp?.ok) ok++; else errors.push(`${d.label || d.date}: speichern fehlgeschlagen ${resp?.error || ''}`);
      } catch (e) {
        errors.push(`${d.label || d.date}: ${String(e)}`);
      }
    }

    setStatus(errors.length
      ? `⚠️ ${ok}/${filtered.length} gespeichert. Fehler:\n${errors.slice(0, 5).join('\n')}`
      : `✅ ${ok} Abrechnungen gespeichert (Downloads/scalable-dokumente).`);
    running = false;
  }

  function buildFilename(d) {
    const date = (d.date || '').replaceAll('-', '');
    const isin = (d.isin || '').trim();
    const wpName = (d.name || '')
      .replace(/[^\w\-ÄÖÜäöüß&. ]+/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 50);
    const kind = d.isSparplan ? 'Abrechnung_Sparplan' : 'Abrechnung';
    const parts = [wpName, isin, kind, date].filter(Boolean);
    let name = parts.join('_') || 'dokument';
    if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf';
    return name;
  }

  // Scalables echter Download-Endpunkt: /broker/api/download/{date}-{label}-{isin}?id={docId}
  // Fallback: die url aus der GraphQL-Antwort (funktioniert oft nicht direkt).
  async function fetchDocPdf(d) {
    const candidates = [];
    if (d.id && d.date && d.isin && d.label) {
      const slug = `${d.date}-${d.label}-${d.isin}`;
      candidates.push({ via: 'download-endpoint', url: `${location.origin}/broker/api/download/${encodeURIComponent(slug)}?id=${encodeURIComponent(d.id)}` });
    }
    if (d.url) {
      let u = d.url;
      if (u.startsWith('/')) u = location.origin + u;
      else if (!/^https?:/i.test(u)) u = location.origin + '/' + u;
      candidates.push({ via: 'graphql-url', url: u });
    }
    let last = { ok: false, status: 0, via: 'keine URL' };
    for (const c of candidates) {
      try {
        const r = await fetch(c.url, { credentials: 'include' });
        if (!r.ok) { last = { ok: false, status: r.status, via: c.via }; continue; }
        const blob = await r.blob();
        const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
        if (String.fromCharCode(...head) !== '%PDF-') {
          last = { ok: false, status: 0, via: `${c.via} (kein PDF: ${blob.type || '?'})` };
          continue;
        }
        return { ok: true, blob, via: c.via };
      } catch (e) {
        last = { ok: false, status: 0, via: `${c.via} (${String(e)})` };
      }
    }
    return last;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function waitForNewDocs(prior, timeoutMs) {
    const start = Date.now();
    let last = [];
    while (Date.now() - start < timeoutMs) {
      const cache = await API.sendMessage({ type: 'SC_GET_CACHE' }).then(r => r?.docs || []).catch(() => []);
      const fresh = cache.filter(d => !prior.some(p => p.url === d.url));
      if (fresh.length) return cache; // ganze Liste zurück (inkl. Kontext)
      await sleep(150);
    }
    return prior;
  }

  // ---------- Auto-Scan, wenn Transaktionsliste sichtbar ----------
  const mo = new MutationObserver(() => {
    const hasList = document.querySelector('[role="row"], [class*="TransactionListItem"]');
    if (hasList) addCheckboxes();
    ensurePanel();
  });
  new Promise(res => {
    if (document.body) return res();
    new MutationObserver((m, obs) => { if (document.body) { obs.disconnect(); res(); } })
      .observe(document.documentElement, { childList: true });
  }).then(() => {
    ensurePanel();
    addCheckboxes();
    mo.observe(document.body, { childList: true, subtree: true });
  });

  log('content script aktiv');
})();