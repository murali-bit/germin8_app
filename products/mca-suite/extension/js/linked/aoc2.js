// AOC-2 linked form (form-aoc2.html, opened from AOC-4).
// Data: the related-party contracts (saved answers formType 'aoc2', key ROWS) + the shared declaration.
// Page order matters: MCA rejects the Excel when its record count differs from the count field, so
//   pre 1 sets both counts, pre 2 uploads the Excel built by the backend (POST /api/aoc2/excel),
//   then jobs re-assert the counts and fill the declaration. The runner clicks Save, then Proceed.
// Nothing here ever clicks Submit. Page functions are self-contained (executeScript, world MAIN).

(function (root) {
  const API = 'http://localhost:4000';
  const A = 'panel_1665650438-panel_526419145-panel-panel-';
  const D = A + 'panel_copy_copy-panel_1978902971_cop-panel1634051861580-panel1634057462326_c-';
  const tail = t => `[name$="${t}___jqName"]`;
  const SEL = {
    notAtArmCount: 'input' + tail(A + 'panel-guidetextbox'),
    atArmCount: 'input' + tail(A + 'panel_copy_copy-panel_885569515-guidetextbox'),
    atArmData: tail('panel_885569515-panel_copy-guidetextbox'),
    resNo: 'input' + tail(D + 'guidetextbox_1814224970'),
    resDate: 'input' + tail(D + 'guidetextbox_1256508639'),
    desig: 'select' + tail(D + 'guidedropdownlist_66'),
    din: 'input' + tail(D + 'guidetextbox'),
  };
  // Lookup!A4:A10 of MCA's Excel, verbatim.
  const NATURES = [
    'Appointment of any agent for purchase or sale of goods, materials, services or property',
    'Availing or rendering of any services',
    'Leasing of property',
    'Related party appointment to any office or place of profit in the company, its subsidiary company or associate company',
    'Sale or purchase of Goods',
    'Sale or purchase of property',
    'Underwriting the subscription of any securities or derivatives thereof, of the company',
  ];
  const DESIGNATIONS = ['Director', 'Manager', 'Secretary', 'CEO', 'CFO', 'IRP/RP/Liquidator'];
  const ROW_FORMAT = 'name | PAN (person) / CIN (company) | relationship | nature | duration | terms | approvalDate | advance';
  // Name of a body corporate (its 8-digit ID may be a foreign registration no., e.g. a UK company number).
  const BODY_CORP = /\b(ltd|limited|llp|inc|corp|corporation|gmbh|plc|pte|company|co)\b/i;

  // ───────────────────────── pure helpers ─────────────────────────

  const squash = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

  // Forgiving match to one of the 7 values: number 1-7, exact, containment, then keywords.
  function matchNature(raw) {
    const s = squash(raw);
    if (!s) return null;
    if (/^[1-7]$/.test(s)) return NATURES[+s - 1];
    const exact = NATURES.find(n => squash(n) === s);
    if (exact) return exact;
    const part = NATURES.find(n => squash(n).startsWith(s) || s.startsWith(squash(n)));
    if (part) return part;
    const KEYS = [[/\bagent/, 0], [/underwrit/, 6], [/\blease|leasing|\brent/, 2],
      [/place of profit|office|salary|remuneration|employment|appoint/, 3],
      [/servic|consult|professional fee/, 1], [/goods|material|purchase of stock/, 4], [/property|land|building/, 5]];
    const k = KEYS.find(([re]) => re.test(s));
    return k ? NATURES[k[1]] : null;
  }

  // Any of 2026-09-30 / 30-9-2026 / 30.09.26 -> 30/09/2026 ('' if not a real date).
  function toDDMMYYYY(v) {
    const p = String(v || '').trim().split(/[\/\-.]/);
    if (p.length !== 3) return '';
    let [d, m, y] = p[0].length === 4 ? [p[2], p[1], p[0]] : p;
    if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^(\d{2}|\d{4})$/.test(y)) return '';
    if (y.length === 2) y = '20' + y;
    const dt = new Date(+y, +m - 1, +d);
    if (isNaN(dt) || dt.getDate() !== +d || dt.getMonth() !== +m - 1) return '';
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  }
  const dateNum = ddmmyyyy => { const [d, m, y] = ddmmyyyy.split('/'); return +(y + m + d); };
  const todayNum = t => t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate();

  // ROWS answer -> array of raw rows. Accepts a JSON array, or text lines "name | id | … | advance".
  function parseRows(raw) {
    if (Array.isArray(raw)) return raw;
    const s = String(raw || '').trim();
    if (!s) return [];
    if (s[0] === '[') { try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch (_) { return null; } }
    return s.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
      const p = line.split('|').map(x => x.trim());
      if (p.length < 7 || p.length > 8) return { _bad: line };
      const [name, id, relationship, nature, duration, terms, approvalDate, advance] = p;
      return { name, id, relationship, nature, duration, terms, approvalDate, advance };
    });
  }

  // Normalises one row and lists its problems (same limits as MCA's Excel validations).
  function cleanRow(r, i, today = new Date()) {
    const at = `Contract ${i + 1}`;
    if (!r || r._bad) return { row: null, errors: [`${at}: expected 8 parts "${ROW_FORMAT}" — got "${String(r && r._bad).slice(0, 60)}"`] };
    const s = k => String(r[k] ?? '').replace(/\s+/g, ' ').trim();
    const row = {
      id: s('id').toUpperCase(), name: s('name'), relationship: s('relationship'),
      nature: matchNature(r.nature) || '', duration: s('duration'), terms: s('terms'),
      // "Rs. 1,000.50/-", "INR 500", "₹ 0" -> plain number.
      approvalDate: toDDMMYYYY(r.approvalDate), advance: s('advance').replace(/\/-$/, '').replace(/[,₹\s]|rs\.?|inr/gi, '') || '0',
    };
    const errors = [];
    // MCA's column B: CIN/FCRN/LLPIN/FLLPIN, or PAN/passport for individuals. DIN is not listed.
    if (!row.id) errors.push(`${at}: PAN of the person (or CIN/LLPIN of the company) is required`);
    else if (row.id.length > 50) errors.push(`${at}: ID is over 50 characters`);
    else if (/^\d{8}$/.test(row.id) && !BODY_CORP.test(row.name)) errors.push(`${at}: ${row.id} is a DIN. MCA asks for the PAN (or passport no.) of a person, or the CIN/LLPIN of a company`);
    if (!row.name) errors.push(`${at}: name of the related party is required`);
    else if (row.name.length > 160) errors.push(`${at}: name is over 160 characters`);
    if (!row.relationship) errors.push(`${at}: nature of relationship is required`);
    else if (row.relationship.length > 160) errors.push(`${at}: relationship is over 160 characters`);
    if (!row.nature) errors.push(/loan|interest|deposit|guarantee|reimburs/i.test(s('nature'))
      ? `${at}: ${s('nature')} is not a s.188 contract. Loans and interest are shown in AOC-4 / notes, not AOC-2. Remove this line`
      : `${at}: nature "${s('nature')}" is not one of MCA's 7 values (e.g. "Availing or rendering of any services")`);
    if (!row.duration) errors.push(`${at}: duration is required`);
    else if (row.duration.length > 160) errors.push(`${at}: duration is over 160 characters`);
    if (!row.terms) errors.push(`${at}: salient terms (with amount) are required`);
    else if (row.terms.length > 500) errors.push(`${at}: salient terms are over 500 characters`);
    if (!row.approvalDate) errors.push(`${at}: board approval date "${s('approvalDate')}" is not a date`);
    else if (dateNum(row.approvalDate) > todayNum(today)) errors.push(`${at}: board approval date ${row.approvalDate} is in the future`);
    if (!/^\d{1,15}(\.\d{1,2})?$/.test(row.advance)) errors.push(`${at}: advance "${s('advance')}" must be a number`);
    return { row, errors };
  }

  function cleanRows(raw, today) {
    const list = parseRows(raw);
    if (list === null) return { rows: [], errors: ['The saved contract list is not valid JSON'] };
    const out = list.map((r, i) => cleanRow(r, i, today));
    return { rows: out.map(o => o.row).filter(Boolean), errors: out.flatMap(o => o.errors) };
  }

  function matchDesignation(v) {
    const s = squash(v);
    if (!s) return '';
    if (/secretary|\bcs\b/.test(s)) return 'Secretary';
    if (/irp|liquidator|resolution prof/.test(s)) return 'IRP/RP/Liquidator';
    if (/\bceo\b|chief executive/.test(s)) return 'CEO';
    if (/\bcfo\b|chief financial/.test(s)) return 'CFO';
    if (/manager/.test(s) && !/managing/.test(s)) return 'Manager';
    if (/director/.test(s)) return 'Director';
    return DESIGNATIONS.find(d => squash(d) === s) || '';
  }

  // ───────────────────────── contract: buildData / jobs ─────────────────────────

  function buildData(client, answers, today = new Date()) {
    const a = answers || {};
    const g = (client && client.general) || {};
    const sig = (client && Array.isArray(client.signatoriesFS) && client.signatoriesFS[0]) || {};
    const values = {}, missing = [], notes = [];

    // '[]' (or an empty array) is an explicit "none at arm's length" answer, not a missing one.
    const explicitNone = Array.isArray(a.ROWS) ? !a.ROWS.length : String(a.ROWS ?? '').trim() === '[]';
    const hasRows = explicitNone || (a.ROWS != null && String(a.ROWS).trim() !== '');
    const at = cleanRows(a.ROWS, today);
    const notAt = cleanRows(a.NOT_AT_ARM_ROWS || '[]', today);
    if (!hasRows) {
      missing.push({ key: 'ROWS', label: 'Related-party contracts at arm’s length (one per line)', type: 'textarea',
        hint: `${ROW_FORMAT}\ne.g. Asha Rao | ABCPR1234K | Wife of director Ravi Rao | Leasing of property | 01/04/2025 to 31/03/2026 | Office rent Rs 20,000 a month | <date the board approved it> | 0\n`
          + 'Only s.188 contracts go here. Leave out a director’s pay as director (Explanation (a) to s.188(1)) and loans to or from directors.\n'
          + 'Enter [] if there are none at arm’s length.' });
    } else if (at.errors.length) {
      missing.push({ key: 'ROWS', label: 'Fix the related-party contract list', type: 'textarea', hint: at.errors.join('\n') + `\nFormat: ${ROW_FORMAT}` });
    }
    if (notAt.errors.length) missing.push({ key: 'NOT_AT_ARM_ROWS', label: 'Fix the not-at-arm’s-length contract list', type: 'textarea', hint: notAt.errors.join('\n') });
    values.ROWS = at.rows;
    values.NOT_AT_ARM_ROWS = notAt.rows;
    values.AT_ARM_COUNT = hasRows && !at.errors.length ? String(at.rows.length) : '';
    values.NOT_AT_ARM_COUNT = String(notAt.rows.length);
    if (notAt.rows.length) notes.push(`${notAt.rows.length} contract(s) not at arm’s length: MCA’s Excel for them is not built here — upload it on MCA yourself.`);
    if (explicitNone && !notAt.rows.length) notes.push('No s.188 contracts entered — AOC-2 is needed only when there are some.');
    // matchNature maps salary/remuneration to "office or place of profit"; flag a director's own pay.
    [[at.rows, ''], [notAt.rows, 'Not-at-arm’s-length ']].forEach(([list, tag]) => list.forEach((r, i) => {
      if (r.nature === NATURES[3] && /director/i.test(r.relationship) && /salary|remuneration/i.test(r.terms)) {
        notes.push(`${tag}Contract ${i + 1}: a director’s pay as director is not a s.188 contract (Explanation (a) to s.188(1)). Keep it only if it is extra pay for another office.`);
      }
    }));
    if (client && client.relatedParty && /^\s*no\s*$/i.test(String(client.relatedParty.ANY_TRANSACTION || ''))) notes.push('AOC-4 says there were no related-party transactions — check whether AOC-2 is needed at all.');

    // Declaration (shared with AOC-4 step 2).
    values.BOARD_RESOLUTION_NO = String(a.BOARD_RESOLUTION_NO || '').trim();
    if (!values.BOARD_RESOLUTION_NO) missing.push({ key: 'BOARD_RESOLUTION_NO', label: 'Declaration — board resolution number', type: 'text' });
    values.BOARD_RESOLUTION_DATE = toDDMMYYYY(a.BOARD_RESOLUTION_DATE || g.BOARD_MEETING_DATE || g.BOARD_REPORT_DATE);
    if (!a.BOARD_RESOLUTION_DATE && values.BOARD_RESOLUTION_DATE) notes.push(`Resolution date taken from the board meeting date ${values.BOARD_RESOLUTION_DATE}.`);
    if (!values.BOARD_RESOLUTION_DATE || dateNum(values.BOARD_RESOLUTION_DATE) > todayNum(today)) {
      values.BOARD_RESOLUTION_DATE = '';
      missing.push({ key: 'BOARD_RESOLUTION_DATE', label: 'Declaration — board resolution date', type: 'date', hint: 'DD/MM/YYYY, not after today' });
    }
    values.DECL_DESIGNATION = matchDesignation(a.DECL_DESIGNATION || sig.designation) || 'Director';
    // Director declares with DIN, Secretary with ICSI membership no., everyone else with PAN.
    const isDir = values.DECL_DESIGNATION === 'Director', isCS = values.DECL_DESIGNATION === 'Secretary';
    const rawId = String(a.DECL_DIN || (isDir ? sig.din : '') || '').trim().toUpperCase();
    values.DECL_DIN = isDir && /^\d{7}$/.test(rawId) ? rawId.padStart(8, '0') : rawId;   // leading zero lost in a number import
    const okId = isDir ? /^\d{8}$/ : isCS ? /^[AF]?\d{1,6}$/ : /^[A-Z]{5}\d{4}[A-Z]$/;
    if (!okId.test(values.DECL_DIN)) {
      missing.push({ key: 'DECL_DIN', type: 'text',
        label: isDir ? 'Declaration — DIN of the signing director' : isCS ? 'Declaration — membership no. of the company secretary' : `Declaration — PAN of the ${values.DECL_DESIGNATION}`,
        hint: isDir ? '8 digits' : isCS ? 'e.g. A12345 or F1234' : 'e.g. ABCDE1234F' });
      values.DECL_DIN = '';
    }
    return { values, missing, notes };
  }

  function countJobs(v) {
    const out = [];
    if (v.NOT_AT_ARM_COUNT !== '' && v.NOT_AT_ARM_COUNT != null) out.push({ id: 'AOC2_NOT_AT_ARM_COUNT', kind: 'text', selector: SEL.notAtArmCount, index: 0, value: String(v.NOT_AT_ARM_COUNT) });
    if (v.AT_ARM_COUNT !== '' && v.AT_ARM_COUNT != null) out.push({ id: 'AOC2_AT_ARM_COUNT', kind: 'text', selector: SEL.atArmCount, index: 0, value: String(v.AT_ARM_COUNT) });
    return out;
  }

  function jobs(v) {
    const out = countJobs(v);
    if (v.BOARD_RESOLUTION_NO) out.push({ id: 'AOC2_RES_NO', kind: 'text', selector: SEL.resNo, index: 0, value: v.BOARD_RESOLUTION_NO });
    if (v.BOARD_RESOLUTION_DATE) out.push({ id: 'AOC2_RES_DATE', kind: 'date', selector: SEL.resDate, index: 0, value: v.BOARD_RESOLUTION_DATE });
    if (v.DECL_DESIGNATION) out.push({ id: 'AOC2_DESIGNATION', kind: 'select', selector: SEL.desig, index: 0, value: v.DECL_DESIGNATION });
    if (v.DECL_DIN) out.push({ id: 'AOC2_DIN', kind: 'text', selector: SEL.din, index: 0, value: v.DECL_DIN, typeChars: true });
    return out;
  }

  // Side panel: asks the backend to build MCA's .xlsm for these rows.
  // Times out (default 30 s) so a stuck backend cannot hang the run on "preparing…".
  async function fetchAoc2Excel(rows, base = API, timeoutMs = 30000) {
    const aborted = e => e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    let r, body;
    try {
      r = await fetch(`${base}/api/aoc2/excel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }), signal: AbortSignal.timeout(timeoutMs) });
      body = await r.json().catch(e => { if (aborted(e)) throw e; return {}; });
    } catch (e) {
      if (aborted(e)) throw new Error(`AOC-2 Excel not built: backend did not answer in ${Math.round(timeoutMs / 1000)} s`);
      throw new Error('AOC-2 Excel not built: backend not reachable (' + ((e && e.message) || e) + ')');
    }
    if (!r.ok || !body.ok || !body.base64) throw new Error('AOC-2 Excel not built: ' + ((body.errors || []).join(' · ') || body.message || `HTTP ${r.status}`));
    return { base64: body.base64, fileName: body.fileName || 'AOC-2_Contracts_at_arm_length.xlsm' };
  }

  // ───────────────────────── page function (MCA tab) ─────────────────────────

  // Clicks the panel's "Upload" ('atArm' | 'notAtArm') and feeds the Excel to the file chooser MCA
  // creates on that click. expected = number of records; spec overrides the built-in locators.
  // Returns {ok, records, intercepted, dialogs, reason}.
  async function pageAoc2Upload(base64, fileName, panel = 'atArm', expected = null, waitMs = 90000, spec = null) {
    const P = 'panel_1665650438-panel_526419145-panel-panel-';
    spec = spec || (panel === 'notAtArm'
      ? { tail: 'panel-panel-panel-panel-panel_copy-saveguidedraft_919477717', not: 'panel_885569515', count: `input[name$="${P}panel-guidetextbox___jqName"]`, data: 'notAtArmSubmitData' }
      : { tail: 'panel_885569515-panel_copy-panel-panel_copy-saveguidedraft_919477717', not: '', count: `input[name$="${P}panel_copy_copy-panel_885569515-guidetextbox___jqName"]`,
        data: 'atArmSubmitData', dataSel: '[name$="panel_885569515-panel_copy-guidetextbox___jqName"]' });
    const pause = ms => new Promise(r => setTimeout(r, ms));
    const visible = el => !!el && el.getClientRects().length > 0;
    const text = el => String(el?.innerText || el?.textContent || el?.value || '').replace(/\s+/g, ' ').trim();
    // A popup counts only when really on screen: MCA keeps hidden popup templates in the DOM (visibility:hidden,
    // opacity:0, aria-hidden, zero size) that still have client rects. Popup text comes from innerText only.
    const styleHidden = el => {
      for (let x = el; x && x.nodeType === 1; x = x.parentElement) {
        if (x.getAttribute && x.getAttribute('aria-hidden') === 'true') return true;
        if (typeof getComputedStyle === 'function') {
          const cs = getComputedStyle(x);
          if (cs && (cs.display === 'none' || (x === el && (cs.visibility === 'hidden' || cs.visibility === 'collapse')) || parseFloat(cs.opacity) === 0)) return true;
        }
      }
      return false;
    };
    const shown = el => {
      if (!el || el.getClientRects().length === 0 || styleHidden(el)) return false;
      const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (r && (r.width < 2 || r.height < 2)) return false;
      return String(el.innerText || '').trim().length > 0;
    };
    const live = el => !!el && el.getClientRects().length > 0 && !styleHidden(el);
    const popText = el => String(el.innerText || '').replace(/\s+/g, ' ').trim();
    const dialogs = [];
    const saved = { alert: window.alert, confirm: window.confirm };
    window.alert = m => { dialogs.push(String(m)); };
    window.confirm = m => { dialogs.push(String(m)); return true; };
    const proto = HTMLInputElement.prototype;
    const orig = { click: proto.click, showPicker: proto.showPicker };
    // click lives on HTMLElement.prototype: restore must delete our own copy, not leave a shadow.
    const own = { click: Object.prototype.hasOwnProperty.call(proto, 'click'), showPicker: Object.prototype.hasOwnProperty.call(proto, 'showPicker') };
    let observer = null, intercepted = 0;
    const hooked = [];
    const restore = () => {
      for (const k of ['click', 'showPicker']) { if (own[k]) proto[k] = orig[k]; else delete proto[k]; }
      if (observer) { observer.disconnect(); observer = null; }
      while (hooked.length) { const [el, fn] = hooked.pop(); el.removeEventListener('click', fn, true); }
    };
    try {
      // 1. The Upload button of this panel: by its AEM path, else the Upload nearest the count field.
      let btn = null;
      for (const box of document.querySelectorAll(`[id*="${spec.tail}"], [name*="${spec.tail}"]`)) {
        if (spec.not && ((box.id || '') + (box.getAttribute('name') || '')).includes(spec.not)) continue;
        const inner = box.matches('button, input[type="button"]') ? [box] : [...box.querySelectorAll('button, input[type="button"]')];
        const b = inner.find(x => /^upload$/i.test(text(x))) || inner[0];
        if (b && visible(b)) { btn = b; break; }
      }
      if (!btn) {
        const count = [...document.querySelectorAll(spec.count)].find(visible);
        for (let p = count && count.parentElement; p && p !== document.body && !btn; p = p.parentElement) {
          btn = [...p.querySelectorAll('button, input[type="button"]')].find(b => visible(b) && /^upload$/i.test(text(b))) || null;
        }
      }
      if (!btn) return { ok: false, reason: 'no-upload-button' };
      if (/submit/i.test(text(btn))) return { ok: false, reason: 'refused-submit' };
      if (!/^upload$/i.test(text(btn))) return { ok: false, reason: 'unexpected-button', label: text(btn).slice(0, 40) };
      if (btn.disabled) return { ok: false, reason: 'upload-disabled' };

      // 2. The file to hand over.
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], fileName, { type: 'application/vnd.ms-excel.sheet.macroEnabled.12', lastModified: Date.now() });
      const feed = input => {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        intercepted++;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };

      // 3. Intercept the chooser: input.click()/showPicker() and inputs appended then clicked via events.
      proto.click = function () { if (this.type === 'file') { feed(this); return; } return orig.click.apply(this, arguments); };
      if (orig.showPicker) proto.showPicker = function () { if (this.type === 'file') { feed(this); return; } return orig.showPicker.apply(this, arguments); };
      const hook = input => {
        const fn = e => { e.preventDefault(); input.removeEventListener('click', fn, true); feed(input); };
        input.addEventListener('click', fn, true);
        hooked.push([input, fn]);
      };
      observer = new MutationObserver(muts => {
        for (const m of muts) for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches('input[type="file"]')) hook(n);
          n.querySelectorAll && n.querySelectorAll('input[type="file"]').forEach(hook);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });

      // The records JSON MCA writes after an upload (raw string, or null when not found).
      const rawValue = () => {
        let v = null;
        const el = document.querySelector(`[aria-label="${spec.data}"]`) || (spec.dataSel && document.querySelector(spec.dataSel));
        if (el) v = el.value;
        const gb = window.guideBridge;
        if (!v && gb && gb.visit) {
          try { gb.visit(c => { if (c && c.name === spec.data && c.value) v = c.value; }); } catch (_) { /* ignore */ }
        }
        return v == null ? null : String(v);
      };
      const countOf = v => { try { const a = JSON.parse(v); return Array.isArray(a) ? a.length : null; } catch (_) { return null; } };
      // On a re-run the field already holds the earlier upload: only a changed value (or a success dialog) counts.
      const before = rawValue();

      btn.scrollIntoView({ block: 'center' });
      btn.click();
      for (let i = 0; i < 25 && !intercepted; i++) await pause(200);
      restore();
      if (!intercepted) return { ok: false, reason: 'no-file-chooser', dialogs };

      // 4. Wait for MCA: close OK dialogs, stop on an error, succeed when the JSON holds every record.
      const readData = () => countOf(rawValue());
      const t0 = Date.now();
      while (Date.now() - t0 < waitMs) {
        await pause(500);
        for (const d of [...document.querySelectorAll('[role="dialog"], .modal-dialog, .ui-dialog, .swal2-popup')].filter(shown)) {
          const msg = popText(d);
          if (!msg) continue;
          if (!dialogs.includes(msg.slice(0, 240))) dialogs.push(msg.slice(0, 240));
          const ok = [...d.querySelectorAll('button, [role="button"]')].find(b => live(b) && /^(ok|okay|close)$/i.test(text(b)));
          if (ok) ok.click();
        }
        const bad = dialogs.find(m => /do\s*not\s*match|error|invalid|fail|not allowed|incorrect|mismatch/i.test(m) && !/success/i.test(m));
        if (bad) return { ok: false, reason: 'mca-error', dialogs, intercepted };
        const raw = rawValue(), n = countOf(raw);
        const success = dialogs.some(m => /success/i.test(m));
        if (n != null && (expected == null || n === expected) && (raw !== before || success)) return { ok: true, records: n, dialogs, intercepted, waitedMs: Date.now() - t0 };
        if (n == null && success && Date.now() - t0 > 3000) return { ok: true, records: null, unverified: true, dialogs, intercepted };
      }
      const raw = rawValue();
      return { ok: false, reason: 'timeout', records: countOf(raw), unchanged: raw === before, dialogs, intercepted };
    } finally {
      restore();
      window.alert = saved.alert; window.confirm = saved.confirm;
    }
  }

  // ───────────────────────── module ─────────────────────────

  const FORM = {
    id: 'aoc2',
    label: 'AOC-2',
    urlRe: /form-aoc2\.html/i,
    answersForm: 'aoc2',
    nextButton: 'Proceed',
    buildData,
    jobs,
    pre: [
      // Counts first: MCA checks the Excel's record count against them.
      { label: 'Number of contracts', get func() { return root.pageFill; }, args: v => [countJobs(v)] },
      {
        label: 'Upload the contracts Excel',
        func: pageAoc2Upload,
        skip: v => !v.ROWS || !v.ROWS.length,
        // Runner: `await step.prepare(values)` before args(values). Fetches the .xlsm from the backend.
        prepare: async v => { v.__AOC2_EXCEL = await fetchAoc2Excel(v.ROWS); return v.__AOC2_EXCEL; },
        args: v => [v.__AOC2_EXCEL && v.__AOC2_EXCEL.base64, v.__AOC2_EXCEL && v.__AOC2_EXCEL.fileName, 'atArm', v.ROWS.length, 90000],
      },
    ],
    // Exposed for the runner and tests.
    SEL, NATURES, DESIGNATIONS, ROW_FORMAT,
    matchNature, matchDesignation, parseRows, cleanRow, cleanRows, toDDMMYYYY, countJobs, fetchAoc2Excel, pageAoc2Upload,
  };
  root.LINKED_FORMS = root.LINKED_FORMS || {};
  root.LINKED_FORMS[FORM.id] = FORM;
  root.fetchAoc2Excel = fetchAoc2Excel;
  if (typeof module !== 'undefined') module.exports = FORM;
})(typeof window !== 'undefined' ? window : globalThis);
