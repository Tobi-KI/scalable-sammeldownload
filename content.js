// Content Script (isolated world):
// - erscheint nur auf /broker/transactions
// - Checkboxen als EIGENES Overlay ÜBER der Liste (nicht in Scalables DOM
//   eingebaut – das hat die App zum Einfrieren gebracht, s. Git-Historie)
// - Panel blendet ein, sobald mind. 1 Haken gesetzt ist (Scalable-Look)
// - Download über die offizielle Web-App-API (GraphQL + /api/download)
//   * Wertpapierabrechnungen
//   * Dividendenbelege (Ausschüttungen)
//   * optionaler Zeitraum -> auch alte Dokumente nachträglich
(() => {
  'use strict';

  const EXT = window.chrome ?? window.browser;
  const API = EXT?.runtime;
  const ACCEPT_KEY = 'scDocDlAccepted'; // gesetzt im Popup (Haftungshinweis bestätigt)
  const SETTINGS_KEY = 'scDocDlSettings'; // Einstellungen aus dem Popup
  const DONE_KEY = 'scDocDlDone';         // IDs bereits gespeicherter Dokumente
  const FILE_DEFAULTS = { dateFirst: false, skipDone: true };
  const MINT = '#28ebcf';
  const MINT_DARK = '#19c9b2';
  const DARK = '#101112';
  const DARK_2 = '#191a1c';
  const GRAY = '#9aa3ad';
  const ROW_SEL = 'button[class*="transactionItemButton"]';
  const ISSUES_URL = 'https://github.com/Tobi-KI/scalable-sammeldownload/issues';
  const NO_ROWS_GRACE_MS = 6000; // so lange darf die Liste zum Laden brauchen

  function log(...a) { console.log('[ScDocDL]', ...a); }

  // ============================================================
  // GraphQL-Zugriff (gleiche Schnittstelle wie die Web-App)
  // ============================================================
  const FRAGMENTS = `
    fragment BrokerSecurityTransactionSummary on BrokerSecurityTransactionSummary {
      securityTransactionType quantity amount side isin
    }
    fragment BrokerCashTransactionSummary on BrokerCashTransactionSummary {
      cashTransactionType amount relatedIsin
    }
    fragment BrokerNonTradeSecurityTransactionSummary on BrokerNonTradeSecurityTransactionSummary {
      nonTradeSecurityTransactionType quantity amount isin
    }
    fragment BrokerEltifTransactionSummary on BrokerEltifTransactionSummary {
      amount eltifQuantity isin securityTransactionType side
    }`;

  const MORE_Q = `
    query moreTransactions($personId: ID!, $input: BrokerTransactionInput!, $portfolioId: ID!) {
      account(id: $personId) {
        id
        brokerPortfolio(id: $portfolioId) {
          id
          moreTransactions(input: $input) {
            cursor
            total
            transactions {
              id
              currency
              type
              status
              isCancellation
              lastEventDateTime
              description
              ...BrokerCashTransactionSummary
              ...BrokerNonTradeSecurityTransactionSummary
              ...BrokerSecurityTransactionSummary
              ...BrokerEltifTransactionSummary
            }
          }
        }
      }
    }
    ${FRAGMENTS}`;

  const DET_Q = `
    query getTransactionDetails($personId: ID!, $transactionId: ID!, $portfolioId: ID!) {
      account(id: $personId) {
        id
        brokerPortfolio(id: $portfolioId) {
          id
          transactionDetails(id: $transactionId) {
            id
            currency
            type
            documents { id url label }
            lastEventDateTime
            isPending
            isCancellation
            security { id name isin }
            transactionReference
          }
        }
      }
    }`;

  // Bei Überlast (429/503) kurz warten und erneut versuchen
  async function fetchRetry(url, opts, tries = 4) {
    for (let i = 0; ; i++) {
      const res = await fetch(url, opts);
      if ((res.status !== 429 && res.status !== 503) || i >= tries - 1) return res;
      const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** i;
      await sleep(Math.min(wait, 10000));
    }
  }

  let gqlSeq = 0;
  async function gql(op, query, variables) {
    const res = await fetchRetry('/broker/api/data', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-apollo-operation-name': op,
        'x-request-id': `scdocdl-${Date.now()}-${gqlSeq++}`
      },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0]?.message || 'GraphQL-Fehler');
    return json.data;
  }

  function portfolioId() {
    return new URLSearchParams(location.search).get('portfolioId') || '';
  }

  async function fetchTxPage(input) {
    const data = await gql('moreTransactions', MORE_Q, { personId: 'me', input, portfolioId: portfolioId() });
    return data?.account?.brokerPortfolio?.moreTransactions || { cursor: null, total: 0, transactions: [] };
  }

  // Ganzen Zeitraum (oder erste maxPages Seiten) laden.
  // truncated = true, wenn wegen maxPages nicht alle Transaktionen geladen wurden.
  async function fetchTransactions({ fromTime, toTime, maxPages = 10, pageSize = 100, onProgress }) {
    const all = [];
    let cursor, total = 0;
    for (let page = 0; page < maxPages; page++) {
      if (cancelRequested) break;
      const input = { pageSize };
      if (fromTime) input.fromTime = fromTime;
      if (toTime) input.toTime = toTime;
      if (cursor) input.cursor = cursor;
      const mt = await fetchTxPage(input);
      all.push(...mt.transactions);
      total = mt.total || all.length;
      onProgress?.(all.length, mt.total);
      cursor = mt.cursor;
      if (!cursor || !mt.transactions.length) { cursor = null; break; }
    }
    return { transactions: all, total, truncated: !!cursor && all.length < total };
  }

  async function fetchDetails(txId) {
    const data = await gql('getTransactionDetails', DET_Q, { personId: 'me', transactionId: txId, portfolioId: portfolioId() });
    return data?.account?.brokerPortfolio?.transactionDetails || null;
  }

  // PDF über den echten App-Endpunkt laden: /broker/api/download/<YYYY-MM-DD>?id=<docId>
  async function fetchDocPdf(docId, date) {
    const res = await fetchRetry(`/broker/api/download/${date}?id=${encodeURIComponent(docId)}`, { credentials: 'include' });
    if (!res.ok) return { ok: false, status: res.status };
    const blob = await res.blob();
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) !== '%PDF-') {
      return { ok: false, status: 0, error: `kein PDF (${blob.type || 'unbekannt'})` };
    }
    return { ok: true, blob };
  }

  // ============================================================
  // Klassifikation: welche Transaktion liefert welchen Beleg?
  // ============================================================
  function docKindFor(tx, mode) {
    const kinds = [];
    const isSecurity = tx.type === 'SECURITY_TRANSACTION';
    const isDistribution = tx.type === 'CASH_TRANSACTION' && tx.cashTransactionType === 'DISTRIBUTION';
    if ((mode === 'abrechnung' || mode === 'beides') && isSecurity) kinds.push('Abrechnung');
    if ((mode === 'dividende' || mode === 'beides') && isDistribution) kinds.push('Dividende');
    return kinds;
  }

  function pickDocs(det, tx, mode) {
    const kinds = docKindFor(tx, mode);
    if (!kinds.length) return [];
    const out = [];
    for (const kind of kinds) {
      for (const d of det.documents || []) {
        const label = d.label || '';
        if (kind === 'Abrechnung' && /abrechnung/i.test(label)) out.push({ doc: d, kind });
        if (kind === 'Dividende') out.push({ doc: d, kind }); // "Wertpapierereignisse"
      }
    }
    return out;
  }

  // dateFirst: Datum vorne, damit die Dateien im Explorer chronologisch sortiert sind
  function buildFilename(det, tx, kind, dateFirst = false) {
    const date = (det.lastEventDateTime || tx.lastEventDateTime || '').slice(0, 10).replaceAll('-', '');
    const isin = (det.security?.isin || tx.isin || tx.relatedIsin || '').trim();
    const name = (det.security?.name || tx.description || '')
      .replace(/[^\w\-ÄÖÜäöüß&. ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 50);
    const isSparplan = tx.securityTransactionType === 'SAVINGS_PLAN' ||
      /sparplan/i.test(tx.nonTradeSecurityTransactionType || '');
    const kindLabel = kind === 'Dividende' ? 'Dividende' : (isSparplan ? 'Abrechnung_Sparplan' : 'Abrechnung');
    const parts = (dateFirst ? [date, name, isin, kindLabel] : [name, isin, kindLabel, date]).filter(Boolean);
    let n = parts.join('_') || 'dokument';
    if (!n.toLowerCase().endsWith('.pdf')) n += '.pdf';
    return n;
  }

  // ============================================================
  // Zeilen <-> Transaktionen verknüpfen (nur LESEND, kein DOM-Einbau!)
  // ============================================================
  function rowDateTime(row) {
    // aria-labelledby: "2026-09-07T00:00:00.000Z: transaction 1"
    const m = (row.getAttribute('aria-labelledby') || '').match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
    return m ? m[1] : null;
  }

  function rowAmount(row) {
    const matches = (row.innerText || '').match(/-?[\d.]+,\d{2}\s?€/g) || [];
    if (!matches.length) return null;
    const raw = matches[matches.length - 1].replace(/[.\s€]/g, '').replace(',', '.');
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : null;
  }

  function rowKind(row) {
    const t = (row.innerText || '');
    if (/ausschüttung/i.test(t)) return 'Ausschüttung';
    if (/sparplan/i.test(t)) return 'Sparplan';
    if (/verkauf/i.test(t)) return 'Verkauf';
    if (/kauf/i.test(t)) return 'Kauf';
    return '';
  }

  function normText(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Momentaufnahme einer Zeile – reicht zum Zuordnen, auch wenn die Zeile später
  // beim Scrollen aus dem DOM verschwindet
  function rowData(row) {
    const text = (row.innerText || '').replace(/\s+/g, ' ');
    return {
      when: rowDateTime(row),
      amount: rowAmount(row),
      kind: rowKind(row),
      text,
      label: text.slice(0, 40)
    };
  }

  // taken: bereits vergebene Transaktions-IDs. Verhindert, dass zwei gleiche
  // Zeilen (z. B. zwei Sparpläne mit gleichem Datum und Betrag) auf dieselbe
  // Transaktion fallen und ein Beleg fehlt.
  function matchByData(data, txList, taken = new Set()) {
    let candidates = txList.filter(t => !taken.has(t.id));
    if (data.when) candidates = candidates.filter(t => t.lastEventDateTime === data.when);
    if (data.amount !== null && data.amount !== undefined && candidates.length > 1) {
      const byAmount = candidates.filter(t => Math.abs((t.amount ?? NaN) - data.amount) < 0.005);
      if (byAmount.length) candidates = byAmount;
    }
    if (data.kind && candidates.length > 1) {
      const kindMap = {
        'Ausschüttung': (t) => t.cashTransactionType === 'DISTRIBUTION',
        'Sparplan': (t) => t.securityTransactionType === 'SAVINGS_PLAN',
        'Verkauf': (t) => t.side === 'SELL',
        'Kauf': (t) => t.side === 'BUY'
      };
      const byKind = candidates.filter(kindMap[data.kind]);
      if (byKind.length) candidates = byKind;
    }
    // Wertpapiername aus der Zeile gegen die Transaktionsbeschreibung
    if (data.text && candidates.length > 1) {
      const text = normText(data.text);
      const byName = candidates.filter(t => t.description && text.includes(normText(t.description)));
      if (byName.length) candidates = byName;
    }
    return candidates[0]?.id || null;
  }

  // ============================================================
  // Overlay-Checkboxen (eigenes fixed Layer, NICHT in Scalables DOM)
  // ============================================================
  let overlay = null;
  const items = new Map();          // rowEl -> { wrap, cb, sig }
  const checkedSigs = new Set();    // Auswahl überlebt Neu-Renders der Zeilen
  const checkedRowData = new Map(); // sig -> rowData() (für Matching nach Unmount)

  function rowSig(row) {
    return (row.getAttribute('aria-labelledby') || '') + '|' +
      (row.innerText || '').replace(/\s+/g, ' ').slice(0, 80);
  }

  function ensureOverlay() {
    if (overlay && document.body.contains(overlay)) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'sc-docdl-overlay';
    document.body.appendChild(overlay);
    return overlay;
  }

  function removeOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
    items.clear();
  }

  function checkedCount() {
    return checkedSigs.size;
  }

  // Findet ROW_SEL länger keine Zeilen, hat Scalable vermutlich die Seite
  // umgebaut – dann lieber einen Hinweis zeigen als stillschweigend nichts
  let noRowsSince = 0;
  function updateNoRowsHint(n) {
    if (n) noRowsSince = 0;
    else if (!noRowsSince) noRowsSince = Date.now();
    const show = !n && Date.now() - noRowsSince > NO_ROWS_GRACE_MS;
    setDisp(panel?.querySelector('#sc-docdl-norows'), show ? 'block' : 'none');
  }

  function syncOverlay() {
    if (!isActive()) { removeOverlay(); noRowsSince = 0; return; }
    const ov = ensureOverlay();
    const live = new Set();
    const vh = window.innerHeight;
    const HEADER_H = 196; // Sticky-Header der App (verifiziert: bottom ~192px)
    const scrollY = window.scrollY;

    const rowsAll = [...document.querySelectorAll(ROW_SEL)];
    updateNoRowsHint(rowsAll.length);
    for (const row of rowsAll) {
      const r = row.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 &&
        r.bottom > HEADER_H && r.top < vh - 8;
      let it = items.get(row);
      if (!visible) {
        if (it) it.wrap.style.display = 'none';
        continue;
      }
      live.add(row);
      if (!it) {
        const wrap = document.createElement('div');
        wrap.className = 'sc-docdl-rowcheck';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'sc-docdl-cb';
        cb.setAttribute('aria-label', 'Für Sammeldownload auswählen');
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('mousedown', (e) => e.stopPropagation());
        const sig = rowSig(row);
        cb.checked = checkedSigs.has(sig);
        cb.addEventListener('change', () => {
          if (cb.checked) {
            // Zeilendaten beim Anhaken einfrieren (Zeilen können beim Scrollen verschwinden)
            checkedSigs.add(it.sig);
            checkedRowData.set(it.sig, rowData(row));
          } else {
            checkedSigs.delete(it.sig);
            checkedRowData.delete(it.sig);
          }
          syncSelectionState();
          // Panel wieder ausklappen, falls eingeklappt; Status resetten
          if (checkedCount() > 0 && panel && panel.__scDisp === 'none') openPanel();
          if (panel) {
            const st = panel.querySelector('#sc-docdl-status');
            if (st && st.__scTxt) { st.__scTxt = ''; st.textContent = ''; st.className = 'status'; }
          }
          updateGoButton();
        });
        wrap.appendChild(cb);
        ov.appendChild(wrap);
        it = { wrap, cb, sig };
        items.set(row, it);
      } else {
        const sig = rowSig(row);
        if (sig !== it.sig) {
          it.sig = sig;
          it.cb.checked = checkedSigs.has(sig);
        }
      }
      // Dokument-Koordinaten: Zelle scrollt natuerlich mit (Overlay ist absolute)
      const x = r.left > 80 ? r.left - 52 : r.left + 6;
      const y = scrollY + r.top;
      it.wrap.style.display = 'flex';
      it.wrap.style.height = Math.round(r.height) + 'px';
      it.wrap.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    // Zeilen entfernen, die nicht mehr existieren
    for (const [row, it] of [...items]) {
      if (!live.has(row)) { it.wrap.remove(); items.delete(row); }
    }
  }

  let syncQueued = false;
  function scheduleSync(immediate = false) {
    if (syncQueued) return;
    syncQueued = true;
    const run = () => {
      syncQueued = false;
      try { syncOverlay(); } catch (e) { log('syncOverlay', e); }
    };
    // Scroll: sofort (rAF-los), sonst leicht gedrosselt
    if (immediate) setTimeout(run, 0);
    else setTimeout(run, 100);
  }

  // ============================================================
  // Panel + Badge (Scalable-Look)
  // ============================================================
  let panel, pill, stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.setAttribute('data-sc-docdl', '');
    style.textContent = `
      /* Overlay scrollt MIT dem Dokument (absolute, nicht fixed) -> keine
         Verzoegerung moeglich; der Sticky-Header der App (z:1100) deckt die
         Kaesten natuerlich ab, wenn sie unter ihm verschwinden. */
      #sc-docdl-overlay { position:absolute; top:0; left:0; width:100%; height:0; pointer-events:none; z-index:1049; }
      /* Zelle im Tabellen-Look: volle Zeilenhoehe, gleicher Hintergrund/Radius wie die Zeile */
      .sc-docdl-rowcheck {
        position:absolute; left:0; top:0; width:42px;
        display:flex; align-items:center; justify-content:center;
        pointer-events:auto; will-change:transform;
        border-top-left-radius:12px; border-bottom-left-radius:12px;
        background:rgba(16,17,18,.92);
        border:1px solid #2b3036; border-right:none;
      }
      /* Aurora-Stil: Kaestchen mit Umrandung, gefuellt + Mint-Haken wenn gewaehlt */
      .sc-docdl-cb {
        appearance:none; -webkit-appearance:none;
        width:21px; height:21px; margin:0; cursor:pointer;
        border:1.5px solid #565d65; border-radius:6px;
        background:rgba(25,26,28,.65);
        transition:border-color .12s ease, background .12s ease;
        display:inline-block; vertical-align:middle;
        color-scheme:dark;
      }
      .sc-docdl-cb:hover { border-color:#8b939b; }
      .sc-docdl-cb:checked {
        background:${MINT} url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23101112" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.8l5 5L19.5 6.8"/></svg>') center/13px no-repeat;
        border-color:${MINT};
      }
      #sc-docdl-panel {
        position:fixed; right:18px; bottom:18px; width:308px; z-index:2147483600;
        background:${DARK}; color:#fff;
        border:1px solid rgba(40,235,207,.28);
        border-radius:14px; padding:16px;
        box-shadow:0 12px 40px rgba(0,0,0,.4);
        font:13px/1.45 system-ui,-apple-system,sans-serif;
        box-sizing:border-box;
        opacity:0; transform:translateY(10px);
        transition:opacity .25s ease, transform .25s ease;
      }
      #sc-docdl-panel.show { opacity:1; transform:translateY(0); }
      /* Eingeklappt: kleine Pill unter dem Panel */
      #sc-docdl-pill {
        position:fixed; right:18px; bottom:18px; z-index:2147483600;
        display:none; align-items:center; gap:8px;
        background:${DARK}; color:#fff; border:1px solid rgba(40,235,207,.35);
        border-radius:999px; padding:9px 16px 9px 12px; cursor:pointer;
        box-shadow:0 6px 24px rgba(0,0,0,.3);
        font:13px/1.45 system-ui,-apple-system,sans-serif;
      }
      #sc-docdl-pill:hover { box-shadow:0 8px 28px rgba(0,0,0,.4); }
      #sc-docdl-pill .dot { width:9px; height:9px; border-radius:50%; background:${MINT}; flex:0 0 auto; }
      #sc-docdl-pill .cnt {
        background:${MINT}; color:${DARK}; font-weight:700; font-size:11px;
        border-radius:999px; padding:1px 7px; display:none;
      }
      #sc-docdl-panel .head { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
      #sc-docdl-panel .icon {
        width:30px; height:30px; border-radius:9px; background:${MINT};
        display:flex; align-items:center; justify-content:center; flex:0 0 auto;
        color:${DARK}; font-size:15px; font-weight:800;
      }
      #sc-docdl-panel .title { font-weight:700; font-size:14px; }
      #sc-docdl-panel .sub { font-size:11px; color:${GRAY}; }
      #sc-docdl-panel .close {
        margin-left:auto; background:none; border:none; color:${GRAY};
        font-size:17px; cursor:pointer; padding:2px 6px; border-radius:6px; line-height:1;
      }
      #sc-docdl-panel .close:hover { color:#fff; background:rgba(255,255,255,.08); }
      #sc-docdl-panel label.fld { display:block; font-size:11.5px; color:${GRAY}; margin:10px 0 4px; }
      #sc-docdl-panel select, #sc-docdl-panel input[type="date"] {
        width:100%; box-sizing:border-box; background:${DARK_2}; color:#fff;
        border:1px solid #33373c; border-radius:8px; padding:7px 9px;
        font:12.5px system-ui,sans-serif; outline:none;
        color-scheme:dark;
      }
      /* Kalender-Symbol: eigenes weisses SVG statt Chromes dunklem Standard-Icon */
      #sc-docdl-panel input[type="date"]::-webkit-calendar-picker-indicator {
        width:18px; height:18px;
        background:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M3 9.5h18"/><path d="M8 2.5v4"/><path d="M16 2.5v4"/></svg>') center/contain no-repeat;
        opacity:1;
        cursor:pointer;
      }
      #sc-docdl-panel input[type="date"]::-webkit-calendar-picker-indicator:hover { opacity:.75; }
      #sc-docdl-panel select:focus, #sc-docdl-panel input[type="date"]:focus { border-color:${MINT}; }
      #sc-docdl-panel .dates { display:flex; gap:8px; }
      #sc-docdl-panel .presets { display:flex; gap:6px; margin-top:7px; }
      #sc-docdl-panel .presets button {
        flex:1; background:${DARK_2}; color:#cfd5db; border:1px solid #33373c;
        border-radius:999px; padding:4px 0; font:11.5px system-ui,sans-serif; cursor:pointer;
        transition:border-color .12s ease, color .12s ease;
      }
      #sc-docdl-panel .presets button:hover { border-color:${MINT}; color:#fff; }
      #sc-docdl-panel .presets button[data-preset="clear"] { flex:0 0 auto; padding:4px 10px; }
      #sc-docdl-panel .hint { font-size:11px; color:${GRAY}; margin-top:6px; }
      #sc-docdl-panel .go {
        width:100%; margin-top:13px; padding:10px 0; border:none; border-radius:8px;
        background:${MINT}; color:${DARK}; font:700 13.5px system-ui,sans-serif;
        cursor:pointer; transition:background .15s ease;
      }
      #sc-docdl-panel .go:hover { background:${MINT_DARK}; }
      #sc-docdl-panel .go:disabled { background:#3a3f45; color:#8a9199; cursor:not-allowed; }
      #sc-docdl-panel .status {
        margin-top:9px; font-size:11.5px; color:${GRAY}; white-space:pre-line; overflow-wrap:anywhere; max-height:110px; overflow:auto;
      }
      #sc-docdl-panel .status.ok { color:${MINT}; }
      #sc-docdl-panel .warn {
        display:none; margin-bottom:10px; padding:7px 9px; border-radius:8px; font-size:11.5px;
        color:#ffd27f; background:rgba(255,190,80,.08); border:1px solid rgba(255,190,80,.3);
      }
      #sc-docdl-panel .warn a { color:${MINT}; }
      #sc-docdl-panel .sel-row { display:flex; justify-content:flex-end; margin-top:6px; }
      #sc-docdl-panel .clear-sel {
        display:none; background:none; border:none; padding:0; cursor:pointer;
        color:${GRAY}; font:11.5px system-ui,sans-serif; text-decoration:underline;
      }
      #sc-docdl-panel .clear-sel:hover { color:#fff; }
      #sc-docdl-panel .go.cancel { background:#3a3f45; color:#fff; }
      #sc-docdl-panel .go.cancel:hover { background:#4a5058; }
      #sc-docdl-panel .open {
        display:none; width:100%; margin-top:8px; padding:7px 0; border-radius:8px; cursor:pointer;
        background:${DARK_2}; color:#fff; border:1px solid #33373c; font:12.5px system-ui,sans-serif;
        transition:border-color .12s ease;
      }
      #sc-docdl-panel .open:hover { border-color:${MINT}; }
      #sc-docdl-panel .status.err { color:#ff8f8f; }
    `;
    document.documentElement.appendChild(style);
  }

  // Schreibzugriffe cachen (kein unnötiges DOM-Update)
  function setDisp(el, v) {
    if (el && el.__scDisp !== v) { el.__scDisp = v; el.style.display = v; }
  }
  function setText(el, v) {
    if (el && el.__scTxt !== v) { el.__scTxt = v; el.textContent = v; }
  }
  function setDisabled(el, v) {
    if (el && el.__scDis !== v) { el.__scDis = v; el.disabled = v; }
  }

  function ensureUi() {
    if (!stylesInjected) injectStyles();
    if (!pill || !document.body.contains(pill)) {
      pill = document.createElement('div');
      pill.id = 'sc-docdl-pill';
      pill.innerHTML = `<span class="dot"></span><span>Sammeldownload</span><span class="cnt"></span>`;
      pill.addEventListener('click', openPanel);
      document.body.appendChild(pill);
      pill.__scDisp = null;
    }
    if (!panel || !document.body.contains(panel)) {
      panel = document.createElement('div');
      panel.id = 'sc-docdl-panel';
      panel.innerHTML = `
        <div class="head">
          <div class="icon">⇩</div>
          <div>
            <div class="title">Sammeldownload</div>
            <div class="sub">Erweiterung · kein Bestandteil von Scalable</div>
          </div>
          <button class="close" title="Schließen">×</button>
        </div>
        <div class="warn" id="sc-docdl-norows">
          Keine Transaktionszeilen erkannt – evtl. hat Scalable die Seite geändert.
          Der Download per Zeitraum kann trotzdem funktionieren.
          <a href="${ISSUES_URL}" target="_blank" rel="noopener">Problem melden</a>
        </div>
        <label class="fld" for="sc-docdl-mode">Belege</label>
        <select id="sc-docdl-mode">
          <option value="beides" selected>Abrechnungen + Dividenden</option>
          <option value="abrechnung">Wertpapierabrechnungen</option>
          <option value="dividende">Dividendenbelege</option>
        </select>
        <label class="fld" for="sc-docdl-from">Zeitraum (optional)</label>
        <div class="dates">
          <input type="date" id="sc-docdl-from" />
          <input type="date" id="sc-docdl-to" />
        </div>
        <div class="presets">
          <button type="button" data-preset="lastMonth">Letzter Monat</button>
          <button type="button" data-preset="thisYear">Dieses Jahr</button>
          <button type="button" data-preset="lastYear">Letztes Jahr</button>
          <button type="button" data-preset="clear" title="Zeitraum leeren">×</button>
        </div>
        <div class="hint">Ohne Zeitraum werden die ausgewählten Zeilen geladen. Mit Zeitraum alle passenden Belege im Zeitraum – auch alte.</div>
        <button class="go" id="sc-docdl-go">PDFs herunterladen</button>
        <div class="sel-row"><button class="clear-sel" id="sc-docdl-clear">Auswahl aufheben</button></div>
        <div class="status" id="sc-docdl-status"></div>
        <button class="open" id="sc-docdl-open">📂 Ordner öffnen</button>
      `;
      document.body.appendChild(panel);
      panel.querySelector('.close').addEventListener('click', closePanel);
      panel.querySelector('#sc-docdl-go').addEventListener('click', () => {
        if (!running) { onDownload(); return; }
        cancelRequested = true; // greift nach dem gerade laufenden Schritt
        updateGoButton();
      });
      panel.querySelector('#sc-docdl-clear').addEventListener('click', () => {
        checkedSigs.clear();
        checkedRowData.clear();
        refreshChecks();
      });
      panel.querySelector('#sc-docdl-open').addEventListener('click', () => {
        API.sendMessage({ type: 'SC_SHOW_FOLDER' }).catch((e) => log('showFolder', e));
      });
      panel.querySelector('#sc-docdl-from').addEventListener('change', updateGoButton);
      panel.querySelector('#sc-docdl-to').addEventListener('change', updateGoButton);
      panel.querySelector('#sc-docdl-mode').addEventListener('change', updateGoButton);
      panel.querySelector('.presets').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-preset]');
        if (b) applyPreset(b.dataset.preset);
      });
    }
  }

  // Lokales Datum als YYYY-MM-DD (toISOString wäre UTC und kann einen Tag verrutschen)
  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function applyPreset(p) {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    const ranges = {
      lastMonth: [new Date(y, m - 1, 1), new Date(y, m, 0)],
      thisYear: [new Date(y, 0, 1), now],
      lastYear: [new Date(y - 1, 0, 1), new Date(y - 1, 11, 31)]
    };
    const [a, b] = ranges[p] || [null, null];
    panel.querySelector('#sc-docdl-from').value = a ? ymd(a) : '';
    panel.querySelector('#sc-docdl-to').value = b ? ymd(b) : '';
    updateGoButton();
  }

  function openPanel() {
    ensureUi();
    setDisp(panel, 'block');
    setDisp(pill, 'none');
    setTimeout(() => panel.classList.add('show'), 20);
    updateGoButton();
  }

  function closePanel() {
    // Nicht wegwerfen, nur einklappen: Pill bleibt als Wiederoeffner
    panel.classList.remove('show');
    setTimeout(() => {
      setDisp(panel, 'none');
      setDisp(pill, 'flex');
      updatePillCount();
    }, 250);
  }

  function updatePillCount() {
    const cnt = pill?.querySelector('.cnt');
    if (!cnt) return;
    const n = checkedCount();
    setDisp(cnt, n ? 'inline' : 'none');
    setText(cnt, String(n));
  }

  function updateGoButton() {
    if (!panel) return;
    const go = panel.querySelector('#sc-docdl-go');
    const from = panel.querySelector('#sc-docdl-from').value;
    const to = panel.querySelector('#sc-docdl-to').value;
    const n = checkedCount();
    go.classList.toggle('cancel', running);
    setDisp(panel.querySelector('#sc-docdl-clear'), n && !running ? 'inline' : 'none');
    if (running) {
      // Während des Downloads wird der Knopf zum Abbrechen-Knopf
      setDisabled(go, cancelRequested);
      setText(go, cancelRequested ? 'Wird abgebrochen…' : 'Abbrechen');
    } else if (from || to) {
      setDisabled(go, false);
      setText(go, 'PDFs im Zeitraum herunterladen');
    } else {
      setDisabled(go, n === 0);
      setText(go, n ? `${n} ausgewählt – PDFs herunterladen` : 'Erst Zeilen auswählen');
    }
  }

  function updateBadge() {
    // Panel dauerhaft offen; Pill nur sichtbar wenn Panel eingeklappt.
    if (panel && panel.__scDisp === 'none' && pill) {
      setDisp(pill, 'flex');
      updatePillCount();
    }
    updateGoButton();
  }

  function syncSelectionState() {
    updateGoButton();
    updateBadge();
  }

  function setStatus(t, cls) {
    const el = panel?.querySelector('#sc-docdl-status');
    if (el && el.__scTxt !== t) {
      el.__scTxt = t;
      el.textContent = t;
      el.className = 'status' + (cls ? ' ' + cls : '');
    }
  }

  // ============================================================
  // Sammel-Download
  // ============================================================
  let running = false;
  let cancelRequested = false; // gesetzt vom Abbrechen-Knopf, geprüft zwischen den Schritten

  function toEpoch(v, endOfDay = false) {
    if (!v) return null;
    const d = new Date(v + 'T' + (endOfDay ? '23:59:59' : '00:00:00'));
    return Math.floor(d.getTime() / 1000);
  }

  async function onDownload() {
    if (running) return;
    const mode = panel.querySelector('#sc-docdl-mode').value;
    const from = toEpoch(panel.querySelector('#sc-docdl-from').value);
    const to = toEpoch(panel.querySelector('#sc-docdl-to').value, true);
    const rangeMode = !!(from || to);
    const modeLabel = { beides: 'Belege', abrechnung: 'Abrechnungen', dividende: 'Dividendenbelege' }[mode] || 'Belege';
    const warnings = [];

    running = true;
    cancelRequested = false;
    updateGoButton();
    setDisp(panel.querySelector('#sc-docdl-open'), 'none');
    try {
      const stored = await EXT.storage.local.get([SETTINGS_KEY, DONE_KEY]).catch(() => ({}));
      const settings = { ...FILE_DEFAULTS, ...stored[SETTINGS_KEY] };
      const doneIds = new Set(stored[DONE_KEY] || []);

      // ---------- 1) Ziel-Transaktionen bestimmen ----------
      let targets = []; // [{id, tx}]
      if (rangeMode) {
        setStatus('Lade Transaktionen im Zeitraum…');
        const { transactions: txs, total, truncated } = await fetchTransactions({
          fromTime: from || 0,
          toTime: to || Math.floor(Date.now() / 1000) + 86400,
          maxPages: 20,
          onProgress: (n, t) => setStatus(`Lade Transaktionen im Zeitraum… ${n}${t ? '/' + t : ''}`)
        });
        if (truncated) warnings.push(`Nur ${txs.length} von ${total} Transaktionen geladen – bitte Zeitraum verkleinern.`);
        targets = txs.filter(tx => docKindFor(tx, mode).length).map(tx => ({ id: tx.id, tx }));
        setStatus(`${txs.length} Transaktionen im Zeitraum, ${targets.length} mit passenden Belegen…`);
      } else {
        if (!checkedSigs.size) { setStatus('Keine Zeilen ausgewählt.'); return; }
        // Sichtbare Zeilen liefern frische Daten, weggescrollte die eingefrorenen
        for (const row of document.querySelectorAll(ROW_SEL)) {
          const sig = rowSig(row);
          if (checkedSigs.has(sig)) checkedRowData.set(sig, rowData(row));
        }
        const rows = [...checkedSigs].map(sig => ({ sig, data: checkedRowData.get(sig) }));

        // Nur den Zeitraum der markierten Zeilen laden – so werden auch sehr
        // alte Zeilen gefunden, ohne die komplette Historie abzufragen
        const times = rows.map(r => Date.parse(r.data?.when || '')).filter(Number.isFinite);
        const range = times.length === rows.length
          ? { fromTime: Math.floor(Math.min(...times) / 1000) - 86400, toTime: Math.floor(Math.max(...times) / 1000) + 86400, maxPages: 20 }
          : { maxPages: 4 };
        setStatus('Lade Transaktionsliste…');
        const { transactions: txs } = await fetchTransactions(range);

        const taken = new Set();
        const unmatchedLabels = [];
        for (const { sig, data } of rows) {
          const id = data ? matchByData(data, txs, taken) : null;
          if (id) {
            taken.add(id);
            targets.push({ id, tx: txs.find(t => t.id === id), sig });
          } else {
            unmatchedLabels.push(data?.label || sig.slice(0, 40));
          }
        }
        if (unmatchedLabels.length) {
          warnings.push(`${unmatchedLabels.length} Zeile(n) nicht zugeordnet: ${unmatchedLabels.slice(0, 2).join(' · ')}`);
        }
      }

      if (cancelRequested) { setStatus('⏹ Abgebrochen – nichts gespeichert.'); return; }
      if (!targets.length) {
        setStatus(['Keine passenden Transaktionen gefunden.', ...warnings].join('\n'), 'err');
        return;
      }

      // ---------- 2) Details + Dokumente einsammeln ----------
      const collected = new Map(); // docId -> {doc, kind, det, tx}
      let done = 0;
      const skipped = [];
      const failedTx = new Set(); // Transaktionen mit Fehlern – deren Haken bleiben stehen
      const queue = targets.slice();
      const worker = async () => {
        while (queue.length && !cancelRequested) {
          const t = queue.shift();
          try {
            const det = await fetchDetails(t.id);
            if (det) {
              for (const { doc, kind } of pickDocs(det, t.tx, mode)) {
                if (!collected.has(doc.id)) collected.set(doc.id, { doc, kind, det, tx: t.tx, txId: t.id });
              }
            }
          } catch (e) {
            failedTx.add(t.id);
            skipped.push(`${t.tx?.description || t.id}: ${String(e).slice(0, 60)}`);
          }
          done++;
          if (done % 5 === 0 || done === targets.length) {
            setStatus(`Prüfe Belege… ${done}/${targets.length} · ${collected.size} PDFs gefunden`);
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (cancelRequested) { setStatus('⏹ Abgebrochen – nichts gespeichert.'); return; }

      if (!collected.size) {
        setStatus([`Keine ${modeLabel} gefunden.`, ...warnings].join('\n') +
          (skipped.length ? `\nFehler: ${skipped.slice(0, 3).join(' · ')}` : ''), 'err');
        return;
      }

      // ---------- 3) PDFs laden und speichern ----------
      let ok = 0;
      let savedBase = null;
      const errors = [];
      let docItems = [...collected.values()];
      let skippedDone = 0;
      if (settings.skipDone) {
        docItems = docItems.filter(it => !doneIds.has(it.doc.id));
        skippedDone = collected.size - docItems.length;
      }
      if (!docItems.length) {
        setStatus([`Alle ${skippedDone} ${modeLabel} wurden bereits früher geladen.`,
          'Neu laden: im Popup „Verlauf zurücksetzen“.', ...warnings].join('\n'), 'ok');
        clearChecks(targets, failedTx);
        setDisp(panel.querySelector('#sc-docdl-open'), 'block');
        return;
      }
      for (let i = 0; i < docItems.length; i++) {
        if (cancelRequested) {
          // Nicht mehr geladene Belege: Haken dieser Zeilen stehen lassen
          for (const it of docItems.slice(i)) failedTx.add(it.txId);
          break;
        }
        const { doc, kind, det, tx, txId } = docItems[i];
        const errorsBefore = errors.length;
        setStatus(`Lade ${i + 1}/${docItems.length}: ${(det.security?.name || tx.description || doc.label)}…`);
        try {
          const date = (det.lastEventDateTime || '').slice(0, 10);
          const res = await fetchDocPdf(doc.id, date);
          if (!res.ok) { errors.push(`${doc.label}: HTTP ${res.status}${res.error ? ' – ' + res.error : ''}`); continue; }
          const dataUrl = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(res.blob);
          });
          const resp = await API.sendMessage({
            type: 'SC_SAVE_DATAURL',
            folder: kind === 'Dividende' ? 'Dividenden' : 'Abrechnungen',
            year: date.slice(0, 4),
            name: buildFilename(det, tx, kind, settings.dateFirst),
            dataUrl
          }).catch(() => null);
          if (resp?.ok) {
            ok++;
            savedBase = resp.base;
            // Immer merken – auch wenn Überspringen gerade aus ist
            doneIds.add(doc.id);
            await EXT.storage.local.set({ [DONE_KEY]: [...doneIds] }).catch(() => {});
          }
          else errors.push(`${doc.label}: speichern fehlgeschlagen ${resp?.error || ''}`);
        } catch (e) {
          errors.push(`${doc.label || 'Dokument'}: ${String(e).slice(0, 80)}`);
        } finally {
          if (errors.length > errorsBefore) failedTx.add(txId);
        }
      }
      clearChecks(targets, failedTx);
      if (ok) setDisp(panel.querySelector('#sc-docdl-open'), 'block');

      const where = savedBase ? `Downloads/${savedBase}` : 'Downloads';
      const skipNote = skippedDone ? `${skippedDone} bereits geladene übersprungen.` : '';
      const problems = [...warnings, ...errors];
      if (cancelRequested) {
        setStatus([`⏹ Abgebrochen – ${ok} von ${docItems.length} gespeichert in ${where}.`, ...problems.slice(0, 3)].join('\n'));
        return;
      }
      setStatus(errors.length
        ? [`⚠️ ${ok}/${docItems.length} gespeichert in ${where}.`, skipNote, ...problems.slice(0, 4)].filter(Boolean).join('\n')
        : [`✅ ${ok} ${modeLabel} gespeichert in ${where}.`, skipNote, ...warnings].filter(Boolean).join('\n'),
        problems.length ? 'err' : 'ok');
    } catch (e) {
      const msg = String(e);
      const hint = /HTTP 40[13]/.test(msg)
        ? 'Bitte bei Scalable neu einloggen und erneut versuchen.'
        : `Evtl. hat Scalable die Schnittstelle geändert – bitte melden: ${ISSUES_URL}`;
      setStatus(`Fehler: ${msg.slice(0, 160)}\n${hint}`, 'err');
    } finally {
      running = false;
      updateGoButton();
    }
  }

  // Nach dem Download: Haken erfolgreich erledigter Zeilen entfernen. Zeilen mit
  // Fehlern (und nicht zugeordnete) bleiben markiert, damit man sie erneut laden kann.
  function clearChecks(targets, failedTx) {
    for (const t of targets) {
      if (!t.sig || failedTx.has(t.id)) continue;
      checkedSigs.delete(t.sig);
      checkedRowData.delete(t.sig);
    }
    refreshChecks();
  }

  // Checkboxen, Zähler und Knopf an checkedSigs angleichen
  function refreshChecks() {
    for (const it of items.values()) it.cb.checked = checkedSigs.has(it.sig);
    updatePillCount();
    updateGoButton();
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ============================================================
  // Seiten-Erkennung: nur auf /broker/transactions aktiv – und erst, wenn der
  // Haftungshinweis im Popup bestätigt wurde
  // ============================================================
  let accepted = false;
  function onTxPage() { return /\/broker\/transactions\/?$/.test(location.pathname); }
  function isActive() { return accepted && onTxPage(); }
  function isOwnNode(n) {
    if (!n || n.nodeType !== 1) return false;
    if (n.id === 'sc-docdl-panel' || n.id === 'sc-docdl-overlay' || n.id === 'sc-docdl-pill') return true;
    if (n.classList?.contains('sc-docdl-rowcheck')) return true;
    if (n.tagName === 'STYLE' && n.hasAttribute?.('data-sc-docdl')) return true;
    return false;
  }

  let lastOnTx = null;
  function checkLocation() {
    try {
      const on = isActive();
      if (on !== lastOnTx) {
        lastOnTx = on;
        if (on) {
          ensureUi();
          openPanel(); // Panel ist dauerhaft sichtbar auf der Transaktions-Seite
        } else {
          removeOverlay();
          if (panel) { setDisp(panel, 'none'); panel.classList.remove('show'); }
          setDisp(pill, 'none');
        }
      }
      if (on) scheduleSync();
    } catch (e) { log('checkLocation', e); }
  }

  // Observer: reagiert nur auf FREMDE Änderungen (Scalable), nie auf unsere eigenen
  const mo = new MutationObserver((muts) => {
    try {
      for (const m of muts) {
        if (isOwnNode(m.target)) continue;
        const added = m.addedNodes ? [...m.addedNodes] : [];
        const removed = m.removedNodes ? [...m.removedNodes] : [];
        const allOwn = (added.length ? added.every(isOwnNode) : true) &&
                       (removed.length ? removed.every(isOwnNode) : true);
        if (!allOwn) { scheduleSync(); break; }
      }
    } catch {}
  });

  new Promise(res => {
    if (document.body) return res();
    const o = new MutationObserver((m, obs) => { if (document.body) { obs.disconnect(); res(); } });
    o.observe(document.documentElement, { childList: true });
  }).then(() => {
    injectStyles();
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', () => scheduleSync(true), { capture: true, passive: true });
    window.addEventListener('resize', () => scheduleSync(true), { passive: true });
    setInterval(checkLocation, 1200);
    EXT.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && ACCEPT_KEY in changes) {
        accepted = !!changes[ACCEPT_KEY].newValue;
        checkLocation();
      }
    });
    EXT.storage.local.get(ACCEPT_KEY).then((r) => {
      accepted = !!r[ACCEPT_KEY];
      checkLocation();
    }).catch((e) => log('storage', e));
  });

  log('content script aktiv (Overlay-Modus, nur /broker/transactions)');
})();
