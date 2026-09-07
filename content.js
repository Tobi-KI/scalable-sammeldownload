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

  const API = (window.chrome ?? window.browser)?.runtime;
  const MINT = '#28ebcf';
  const MINT_DARK = '#19c9b2';
  const DARK = '#101112';
  const DARK_2 = '#191a1c';
  const GRAY = '#9aa3ad';
  const ROW_SEL = 'button[class*="transactionItemButton"]';

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

  let gqlSeq = 0;
  async function gql(op, query, variables) {
    const res = await fetch('/broker/api/data', {
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

  // Ganzen Zeitraum (oder erste maxPages Seiten) laden
  async function fetchTransactions({ fromTime, toTime, maxPages = 10, pageSize = 100, onProgress }) {
    const all = [];
    let cursor;
    for (let page = 0; page < maxPages; page++) {
      const input = { pageSize };
      if (fromTime) input.fromTime = fromTime;
      if (toTime) input.toTime = toTime;
      if (cursor) input.cursor = cursor;
      const mt = await fetchTxPage(input);
      all.push(...mt.transactions);
      onProgress?.(all.length, mt.total);
      cursor = mt.cursor;
      if (!cursor || !mt.transactions.length) break;
    }
    return all;
  }

  async function fetchDetails(txId) {
    const data = await gql('getTransactionDetails', DET_Q, { personId: 'me', transactionId: txId, portfolioId: portfolioId() });
    return data?.account?.brokerPortfolio?.transactionDetails || null;
  }

  // PDF über den echten App-Endpunkt laden: /broker/api/download/<YYYY-MM-DD>?id=<docId>
  async function fetchDocPdf(docId, date) {
    const res = await fetch(`/broker/api/download/${date}?id=${encodeURIComponent(docId)}`, { credentials: 'include' });
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

  function buildFilename(det, tx, kind) {
    const date = (det.lastEventDateTime || tx.lastEventDateTime || '').slice(0, 10).replaceAll('-', '');
    const isin = (det.security?.isin || tx.isin || tx.relatedIsin || '').trim();
    const name = (det.security?.name || tx.description || '')
      .replace(/[^\w\-ÄÖÜäöüß&. ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 50);
    const isSparplan = tx.securityTransactionType === 'SAVINGS_PLAN' ||
      /sparplan/i.test(tx.nonTradeSecurityTransactionType || '');
    const kindLabel = kind === 'Dividende' ? 'Dividende' : (isSparplan ? 'Abrechnung_Sparplan' : 'Abrechnung');
    const parts = [name, isin, kindLabel, date].filter(Boolean);
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

  function matchByData(data, txList) {
    let candidates = txList;
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
    return candidates[0]?.id || null;
  }

  function matchTxId(row, txList) {
    return matchByData({
      when: rowDateTime(row),
      amount: rowAmount(row),
      kind: rowKind(row)
    }, txList);
  }

  // ============================================================
  // Overlay-Checkboxen (eigenes fixed Layer, NICHT in Scalables DOM)
  // ============================================================
  let overlay = null;
  const items = new Map();          // rowEl -> { wrap, cb, sig }
  const checkedSigs = new Set();    // Auswahl überlebt Neu-Renders der Zeilen
  const checkedRowData = new Map(); // sig -> {when, amount, kind, label} (für Matching nach Unmount)

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

  // Zeilendaten beim Anhaken einfrieren (Zeilen können beim Scrollen verschwinden)
  function rememberRowData(row) {
    const sig = rowSig(row);
    checkedRowData.set(sig, {
      when: rowDateTime(row),
      amount: rowAmount(row),
      kind: rowKind(row),
      label: (row.innerText || '').replace(/\s+/g, ' ').slice(0, 40)
    });
  }

  function syncOverlay() {
    if (!onTxPage()) { removeOverlay(); return; }
    const ov = ensureOverlay();
    const live = new Set();
    const vh = window.innerHeight;
    const HEADER_H = 196; // Sticky-Header der App (verifiziert: bottom ~192px)
    const scrollY = window.scrollY;

    const rowsAll = [...document.querySelectorAll(ROW_SEL)];
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
            checkedSigs.add(it.sig);
            rememberRowData(row);
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
      #sc-docdl-panel .hint { font-size:11px; color:${GRAY}; margin-top:6px; }
      #sc-docdl-panel .go {
        width:100%; margin-top:13px; padding:10px 0; border:none; border-radius:8px;
        background:${MINT}; color:${DARK}; font:700 13.5px system-ui,sans-serif;
        cursor:pointer; transition:background .15s ease;
      }
      #sc-docdl-panel .go:hover { background:${MINT_DARK}; }
      #sc-docdl-panel .go:disabled { background:#3a3f45; color:#8a9199; cursor:not-allowed; }
      #sc-docdl-panel .status {
        margin-top:9px; font-size:11.5px; color:${GRAY}; white-space:pre-line; max-height:110px; overflow:auto;
      }
      #sc-docdl-panel .status.ok { color:${MINT}; }
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
        <div class="hint">Ohne Zeitraum werden die ausgewählten Zeilen geladen. Mit Zeitraum alle passenden Belege im Zeitraum – auch alte.</div>
        <button class="go" id="sc-docdl-go">PDFs herunterladen</button>
        <div class="status" id="sc-docdl-status"></div>
      `;
      document.body.appendChild(panel);
      panel.querySelector('.close').addEventListener('click', closePanel);
      panel.querySelector('#sc-docdl-go').addEventListener('click', onDownload);
      panel.querySelector('#sc-docdl-from').addEventListener('change', updateGoButton);
      panel.querySelector('#sc-docdl-to').addEventListener('change', updateGoButton);
      panel.querySelector('#sc-docdl-mode').addEventListener('change', updateGoButton);
    }
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
    if (from || to) {
      setDisabled(go, running);
      setText(go, 'PDFs im Zeitraum herunterladen');
    } else {
      setDisabled(go, running || n === 0);
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

    running = true;
    updateGoButton();
    try {
      // ---------- 1) Ziel-Transaktionen bestimmen ----------
      let targets = []; // [{id, tx}]
      if (rangeMode) {
        setStatus('Lade Transaktionen im Zeitraum…');
        const txs = await fetchTransactions({
          fromTime: from || 0,
          toTime: to || Math.floor(Date.now() / 1000) + 86400,
          maxPages: 20
        });
        targets = txs.filter(tx => docKindFor(tx, mode).length).map(tx => ({ id: tx.id, tx }));
        setStatus(`${txs.length} Transaktionen im Zeitraum, ${targets.length} mit passenden Belegen…`);
      } else {
        if (!checkedSigs.size) { setStatus('Keine Zeilen ausgewählt.'); return; }
        setStatus('Lade Transaktionsliste…');
        const txs = await fetchTransactions({ maxPages: 4, pageSize: 100 });
        // 1) Sichtbare Zeilen zuerst (frische Daten)
        const matchedIds = new Set();
        const matchedSigs = new Set();
        const unmatchedLabels = [];
        for (const row of document.querySelectorAll(ROW_SEL)) {
          const sig = rowSig(row);
          if (!checkedSigs.has(sig)) continue;
          const id = matchTxId(row, txs);
          if (id) {
            matchedIds.add(id);
            matchedSigs.add(sig);
            targets.push({ id, tx: txs.find(t => t.id === id) });
          }
        }
        // 2) Übrige (ggf. weggescrollte) Haken über die eingefrorenen Zeilendaten
        for (const sig of checkedSigs) {
          if (matchedSigs.has(sig)) continue;
          const data = checkedRowData.get(sig);
          const id = data ? matchByData(data, txs) : null;
          if (id && !matchedIds.has(id)) {
            matchedIds.add(id);
            targets.push({ id, tx: txs.find(t => t.id === id) });
          } else if (!id) {
            unmatchedLabels.push(data?.label || sig.slice(0, 40));
          }
        }
        if (unmatchedLabels.length) {
          setStatus(`⚠️ ${unmatchedLabels.length} Zeile(n) nicht zugeordnet (z. B. anderer Filter).`);
          await sleep(1200);
        }
      }

      if (!targets.length) { setStatus('Keine passenden Transaktionen gefunden.'); return; }

      // ---------- 2) Details + Dokumente einsammeln ----------
      const collected = new Map(); // docId -> {doc, kind, det, tx}
      let done = 0;
      const skipped = [];
      const queue = targets.slice();
      const worker = async () => {
        while (queue.length) {
          const t = queue.shift();
          try {
            const det = await fetchDetails(t.id);
            if (det) {
              for (const { doc, kind } of pickDocs(det, t.tx, mode)) {
                if (!collected.has(doc.id)) collected.set(doc.id, { doc, kind, det, tx: t.tx });
              }
            }
          } catch (e) {
            skipped.push(`${t.tx?.description || t.id}: ${String(e).slice(0, 60)}`);
          }
          done++;
          if (done % 5 === 0 || done === targets.length) {
            setStatus(`Prüfe Belege… ${done}/${targets.length} · ${collected.size} PDFs gefunden`);
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);

      if (!collected.size) {
        setStatus(`Keine ${mode === 'dividende' ? 'Dividendenbelege' : 'Abrechnungen'} gefunden.` +
          (skipped.length ? `\nFehler: ${skipped.slice(0, 3).join(' · ')}` : ''), 'err');
        return;
      }

      // ---------- 3) PDFs laden und speichern ----------
      let ok = 0;
      const errors = [];
      const docItems = [...collected.values()];
      for (let i = 0; i < docItems.length; i++) {
        const { doc, kind, det, tx } = docItems[i];
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
            name: buildFilename(det, tx, kind),
            dataUrl
          }).catch(() => null);
          if (resp?.ok) ok++; else errors.push(`${doc.label}: speichern fehlgeschlagen ${resp?.error || ''}`);
        } catch (e) {
          errors.push(`${doc.label || 'Dokument'}: ${String(e).slice(0, 80)}`);
        }
      }

      const kindLabel = mode === 'dividende' ? 'Belege' : 'Abrechnungen';
      setStatus(errors.length
        ? `⚠️ ${ok}/${docItems.length} gespeichert.\n${errors.slice(0, 4).join('\n')}`
        : `✅ ${ok} ${kindLabel} gespeichert (Downloads/scalable-dokumente/Abrechnungen bzw. /Dividenden).`, errors.length ? 'err' : 'ok');
    } catch (e) {
      setStatus(`Fehler: ${String(e).slice(0, 160)}`, 'err');
    } finally {
      running = false;
      updateGoButton();
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ============================================================
  // Seiten-Erkennung: nur auf /broker/transactions aktiv
  // ============================================================
  function onTxPage() { return /\/broker\/transactions\/?$/.test(location.pathname); }
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
      const on = onTxPage();
      if (on !== lastOnTx) {
        lastOnTx = on;
        if (on) {
          ensureUi();
          openPanel(); // Panel ist dauerhaft sichtbar auf der Transaktions-Seite
        } else {
          removeOverlay();
          if (panel) { setDisp(panel, 'none'); panel.classList.remove('show'); }
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
    checkLocation();
  });

  log('content script aktiv (Overlay-Modus, nur /broker/transactions)');
})();
