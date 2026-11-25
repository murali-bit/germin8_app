// AOC-4 linked form: Extract of the Auditor's report (standalone), MCA V3 page
// .../extract-of-auditor-standalone.html. Plain browser JS (no modules); loaded by the side panel and
// required by node tests. buildData() is pure: texts the AOC-4 payload supports are built in short plain
// sentences; facts only the signed report holds (Rule 11, emphasis, other matters) are asked, never assumed.
// Any key saved under formType 'eauditor' (same keys as `values`) overrides the built text.
// jobs() turns values into pageFill jobs. The declaration Name box is read-only (MCA fills it from the
// DIN) and is never filled. The only page button this form moves on with is "Proceed" — never Submit.

(function (root) {
  // Field name tails (every name ends "<tail>___jqName"). Tails start at the first distinctive panel
  // so the suffix match does not depend on the outer panel path.
  const T = {
    OPINION:      'panel_1480276982_cop-panel_1860351946_cop_160345464-panel_copy_copy_copy-panel-guidetextbox',
    BASIS:        'panel_1480276982_cop-panel_1860351946_cop_160345464-panel_copy_copy_copy-panel-guidetextbox_2122660506',
    EMPHASIS:     'panel_1480276982_cop-panel_1860351946_cop_160345464-panel_copy_copy_copy-panel-guidetextbox_1787558811',
    KAM:          'panel_1480276982_cop-panel_1860351946_cop_160345464-panel_copy_copy_copy-panel-panel-guidetextbox_9895278',
    OTHER_INFO:   'panel_1480276982_cop-panel_1860351946_cop_160345464-panel_copy_copy_copy-panel-panel_539753119-guidetextbox_8465383',
    QUAL_COUNT:   'panel-panel-panel-panel-panel_copy_copy_copy-panel-panel_1950235866_cop-guidetextbox_copy_co',
    QUAL_TYPE_1:  'panel_1950235866_cop-table_copy_copy_copy_1546127571-Row1-tableItem1',
    QUAL_COMMENT_1: 'panel_1950235866_cop-table_copy_copy_copy_1546127571-Row1-headerItem1623401255929',
    MGMT_RESP:    'panel-panel-panel-panel_1480276982_cop-panel-guidetextbox',
    AUDITOR_RESP: 'panel-panel-panel-panel_1480276982_cop_214140827-panel-guidetextbox',
    RULE11:       'panel_1480276982_cop_1904032734-panel-guidetextbox_copy',
    OTHER_5B:     'panel_1480276982_cop_1904032734-panel-guidetextbox',
    LEGAL_6A:     'panel_1480276982_cop_1904032734-panel-guidetextbox_1829933',
    CARO:         'panel_1480276982_cop_1904032734-panel-guideradiobutton',
    IFC:          'panel_1480276982_cop_1904032734-panel-guidetextbox_1998545194',
    // Declaration. NAME is listed only so tests can prove no job ever targets it.
    NAME:         'panel_1480276982_cop_1955144168-panel-panel_copy-panel_268085455_copy-guidetextbox',
    DECL_DESIGNATION: 'panel_1480276982_cop_1955144168-panel-panel_copy-panel_268085455_copy-guidedropdownlist_66',
    DECL_DIN:     'panel_1480276982_cop_1955144168-panel-panel_copy-panel_268085455_copy-guidetextbox_copy',
  };
  const CARO_TABLE = 'panel_1480276982_cop_1904032734-panel-table-';
  // 6(c) CARO 2020 rows: [label, row id, select cell, detail cell] in page order.
  const CARO_ROWS = [
    ['Property, plant & equipment and intangibles', 'Row1', 'tableItem1', 'headerItem1659942540127'],
    ['Inventories', 'Row2', 'tableItem1', 'headerItem1659942541636'],
    ['Loans and advances given', 'Row1659943254965', 'tableItem1659943254967', 'tableItem1659943254968'],
    ['Loans to directors and investments (s.185/186)', 'Row1659943422043', 'tableItem1659943422045', 'tableItem1659943422046'],
    ['Public deposits', 'Row1659943437633', 'tableItem1659943437635', 'tableItem1659943437636'],
    ['Cost records', 'Row1659943452020', 'tableItem1659943452023', 'tableItem1659943452024'],
    ['Statutory dues', 'Row1659943458764', 'tableItem1659943458766', 'tableItem1659943458767'],
    ['Term loans / default in repayment', 'Row1659943465264', 'tableItem1659943465266', 'tableItem1659943465267'],
    ['Utilisation of funds raised', 'Row1659943472058', 'tableItem1659943472060', 'tableItem1659943472061'],
    ['Fraud', 'Row1659943479150', 'tableItem1659943479152', 'tableItem1659943479153'],
    ['Unrecorded income', 'Row1659943486694', 'tableItem1659943486696', 'tableItem1659943486697'],
    ['Nidhi company', 'Row1659943756869', 'tableItem1659943756871', 'tableItem1659943756872'],
    ['Related party transactions', 'Row1659943763944', 'tableItem1659943763946', 'tableItem1659943763947'],
    ['Private placement / preferential issue', 'Row1659943770573', 'tableItem1659943770575', 'tableItem1659943770576'],
    ['Non-cash transactions with directors', 'Row1659943777908', 'tableItem1659943777910', 'tableItem1659943777911'],
    ['RBI registration (s.45-IA)', 'Row1659943787641', 'tableItem1659943787643', 'tableItem1659943787644'],
    ['Internal audit system', 'Row1719821181132', 'tableItem1719821181134', 'tableItem1719821181135'],
    ['Cash losses', 'Row1719821172680', 'tableItem1719821172682', 'tableItem1719821172683'],
    ['Resignation of statutory auditors', 'Row1719821166274', 'tableItem1719821166276', 'tableItem1719821166277'],
    ['Material uncertainty on meeting liabilities', 'Row1719821126612', 'tableItem1719821126614', 'tableItem1719821126615'],
    ['Unspent CSR amount', 'Row1719817952613', 'tableItem1719817952615', 'tableItem1719817952616'],
  ];
  const CARO_OPTIONS = ['Favourable Remark', 'Unfavourable remark', 'Disclaimer remark', 'Clause not applicable'];
  const QUAL_OPTIONS = ['Qualification', 'Reservation', 'Adverse remarks', 'Disclaimer'];
  const DESIG_OPTIONS = ['Director', 'IRP/RP/Liquidator'];
  const CRORE = 1e7;
  // s.2(85) small company limits (Rule 2(1)(t)): ₹4 crore paid-up / ₹40 crore turnover, raised to ₹10 crore /
  // ₹100 crore by the Companies (Specification of Definitions Details) Amendment Rules, 2025 (G.S.R. 880(E),
  // in force 01-12-2025). The new limits are used only for a year ending on or after that date.
  const SMALL_NEW_FROM = '20251201';

  const sel = (tail, tag = '') => `${tag}[name$="${tail}___jqName"]`;
  const caroSel = (row, cell) => sel(`${CARO_TABLE}${row}-${cell}`);

  // "14,06,500", "(4,74,200)", "₹ -1,00,000", 1406500 → number; blank/unparseable → null.
  function num(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'object') return num(v.current);              // breakup cells are {current, previous}
    let s = String(v).replace(/[₹,\s]|Rs\.?/gi, '');
    if (!s) return null;
    const neg = /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, '');
    const n = Number(s);
    return isFinite(n) ? (neg ? -Math.abs(n) : n) : null;
  }
  const inr = n => (n < 0 ? '-' : '') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
  const sum = (...xs) => xs.some(x => x == null) ? null : xs.reduce((a, b) => a + b, 0);
  const blank = v => v == null || String(v).trim() === '';
  const ddmmyyyy = s => {
    const p = String(s || '').trim().split(/[\/\-.]/);
    if (p.length !== 3) return String(s || '').trim();
    const [d, m, y] = p[0].length === 4 ? [p[2], p[1], p[0]] : p;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y.length === 2 ? '20' + y : y}`;
  };
  // CIN letters 13-15 give the class: PTC/OPC private, PLC public, others (NPL, GOI, ...).
  const cinType = cin => String(cin || '').toUpperCase().slice(12, 15);
  const isPrivate = cin => /^(PTC|OPC)$/.test(cinType(cin));
  // DD/MM/YYYY (or YYYY-MM-DD) → "YYYYMMDD" for comparing; '' when unknown.
  const ymd = s => { const m = ddmmyyyy(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? m[3] + m[2] + m[1] : ''; };
  // A DIN that lost its leading zero (number / Excel import: 1234567) is padded back to 8 digits.
  const dinOf = v => { const d = String(v == null ? '' : v).trim(); return /^\d{7}$/.test(d) ? d.padStart(8, '0') : d; };

  // Holding / subsidiary position for CARO: returns {ok, why}. ok=null when the payload cannot tell.
  function publicGroupTest(c, a) {
    const s = Object.assign({}, c.subsidiary || {}, c.general || {}, c);
    const isSub = a.IS_SUBSIDIARY || s.IS_SUBSIDIARY;
    const hasSub = a.HAS_SUBSIDIARY_OR_JV || s.HAS_SUBSIDIARY_OR_JV;
    if (blank(isSub) && blank(hasSub)) return { ok: null, why: 'holding/subsidiary details not in the AOC-4 data' };
    if (/^y/i.test(isSub || '')) {
      const h = a.HOLDING_CIN || s.HOLDING_CIN;
      if (isPrivate(h)) return { ok: true, why: 'subsidiary of a private company' };
      return { ok: false, why: blank(h) ? 'subsidiary, holding company CIN not given' : 'subsidiary of a public company' };
    }
    if (/^y/i.test(hasSub || '')) return { ok: false, why: 'has subsidiaries/JVs — confirm none is a public company' };
    return { ok: true, why: 'not a holding or subsidiary company' };
  }

  // CARO 2020 para 1(2)(iv): a small company (s.2(85)) is outside CARO. Private (incl. OPC), neither a holding
  // nor a subsidiary of any company (both answers must be known), paid-up ≤ limit, previous-year turnover ≤ limit.
  // Returns the reason text, or null when not shown to be small.
  function smallCompany(c, a) {
    const s = Object.assign({}, c.subsidiary || {}, c.general || {}, c);
    const isSub = a.IS_SUBSIDIARY || s.IS_SUBSIDIARY, hasSub = a.HAS_SUBSIDIARY_OR_JV || s.HAS_SUBSIDIARY_OR_JV;
    if (!isPrivate((c.general && c.general.CIN) || c.CIN) || blank(isSub) || blank(hasSub) || /^y/i.test(isSub) || /^y/i.test(hasSub)) return null;
    const newLimits = ymd(c.general && c.general.FY_TO) >= SMALL_NEW_FROM;   // unknown FY end ('') → old, lower limits
    const capLim = (newLimits ? 10 : 4) * CRORE, toLim = (newLimits ? 100 : 40) * CRORE;
    const paidUp = num(c.balanceSheet && c.balanceSheet.current && c.balanceSheet.current.SHARE_CAPITAL);
    const prevTo = num(c.profitLoss && c.profitLoss.previous && c.profitLoss.previous.REVENUE_OPERATIONS);
    if (paidUp == null || prevTo == null || paidUp > capLim || prevTo > toLim) return null;
    return `small company: paid-up ${inr(paidUp)} ≤ ${inr(capLim)}, previous-year turnover ${inr(prevTo)} ≤ ${inr(toLim)}, not a holding or subsidiary company`;
  }

  // CARO 2020: para 1(2)(iv) small company first; else para 1(2)(v): private company, not holding/subsidiary
  // of a public company, paid-up capital + reserves ≤ ₹1 crore, bank/FI borrowings ≤ ₹1 crore, total
  // revenue ≤ ₹10 crore. Any failed or unknown test → CARO applies ("Yes").
  function caroTest(c, a) {
    const small = smallCompany(c, a);
    if (small) return { applies: false, para: '1(2)(iv)', passes: [small], fails: [] };
    const bs = (c.balanceSheet && c.balanceSheet.current) || {};
    const pl = (c.profitLoss && c.profitLoss.current) || {};
    const br = c.balanceSheetBreakup || {};
    const cin = (c.general && c.general.CIN) || c.CIN;
    const fails = [], passes = [];
    const test = (ok, good, bad) => (ok ? passes : fails).push(ok ? good : bad);
    test(isPrivate(cin), 'private company', `not a private company (CIN class ${cinType(cin) || '?'})`);
    const grp = publicGroupTest(c, a);
    test(grp.ok === true, grp.why, grp.why);
    const capRes = sum(num(bs.SHARE_CAPITAL), num(bs.RESERVES_SURPLUS));
    test(capRes != null && capRes <= CRORE, `paid-up capital + reserves ${capRes != null ? inr(capRes) : ''} ≤ ₹1 crore`,
      capRes == null ? 'share capital / reserves missing' : `paid-up capital + reserves ${inr(capRes)} > ₹1 crore`);
    // Bank/FI borrowings: total borrowings less known non-bank parts (director loans, deposits) is an upper bound.
    const total = sum(num(bs.LONG_TERM_BORROWINGS) || 0, num(bs.SHORT_TERM_BORROWINGS) || 0);
    const nonBank = ['BS_UNSEC_LT_RELATED_PARTIES', 'BS_UNSEC_ST_RELATED_PARTIES', 'BS_UNSEC_LT_DEPOSITS']
      .reduce((t, k) => t + (num(br[k]) || 0), 0);
    const bankKeys = Object.keys(br).filter(k => /BANK/.test(k)).reduce((t, k) => t + (num(br[k]) || 0), 0);
    const bank = Math.max(bankKeys, total - nonBank);
    // No borrowing figure at all is "data missing", not ₹0.
    const known = [bs.LONG_TERM_BORROWINGS, bs.SHORT_TERM_BORROWINGS].some(x => num(x) != null) || Object.keys(br).some(k => /BANK/.test(k));
    test(known && bank <= CRORE, `bank/FI borrowings ${inr(bank)} ≤ ₹1 crore`,
      known ? `bank/FI borrowings may exceed ₹1 crore (${inr(bank)})` : 'borrowings missing');
    const income = num(pl.TOTAL_INCOME) != null ? num(pl.TOTAL_INCOME) : sum(num(pl.REVENUE_OPERATIONS), num(pl.OTHER_INCOME) || 0);
    test(income != null && income <= 10 * CRORE, `total revenue ${income != null ? inr(income) : ''} ≤ ₹10 crore`,
      income == null ? 'total income missing' : `total revenue ${inr(income)} > ₹10 crore`);
    return { applies: fails.length > 0, para: '1(2)(v)', fails, passes };
  }

  // IFC reporting exemption (G.S.R. 583(E), 13-06-2017): private company, turnover < ₹50 crore and
  // borrowings < ₹25 crore. Total borrowings are used (wider than bank/FI/body corporate, so safe).
  function ifcExempt(c) {
    const bs = (c.balanceSheet && c.balanceSheet.current) || {};
    const pl = (c.profitLoss && c.profitLoss.current) || {};
    const turnover = num(pl.REVENUE_OPERATIONS);
    const borrow = (num(bs.LONG_TERM_BORROWINGS) || 0) + (num(bs.SHORT_TERM_BORROWINGS) || 0);
    return isPrivate((c.general && c.general.CIN) || c.CIN) && turnover != null && turnover < 50 * CRORE && borrow < 25 * CRORE;
  }

  // DIN signatory for the declaration. A saved DIN wins when its saved designation is blank or a director
  // ("Managing Director" too); else the first director in signatoriesFS; else any saved 8-digit DIN — that is
  // what the side panel stores when it asks for DECL_DIN, and a stale AOC-4 designation (e.g. CFO) must not
  // make that answer be ignored on every run.
  function signatory(c, a) {
    const dirs = (c.signatoriesFS || []).filter(s => /^\d{8}$/.test(dinOf(s.din)));
    const dir = dirs.find(s => /director/i.test(s.designation || '')) || dirs[0];
    const savedDesig = String(a.DECL_DESIGNATION || '').trim();
    const savedDin = dinOf(a.DECL_DIN);
    const validDin = /^\d{8}$/.test(savedDin);
    if (/irp|liquidator|resolution/i.test(savedDesig) && savedDin) return { desig: 'IRP/RP/Liquidator', din: savedDin };
    if ((!savedDesig || /director/i.test(savedDesig)) && validDin) return { desig: 'Director', din: savedDin };
    if (dir) return { desig: 'Director', din: dinOf(dir.din) };
    return { desig: 'Director', din: validDin ? savedDin : '' };
  }

  function buildData(client, answers) {
    const c = client || {}, a = answers || {};
    const g = c.general || {};
    const name = String(g.COMPANY_NAME || c.COMPANY_NAME || 'the company').trim();
    const cin = String(g.CIN || c.CIN || '').toUpperCase();
    const fyEnd = g.FY_TO ? ddmmyyyy(g.FY_TO) : 'the balance sheet date';
    const pat = num(c.profitLoss && c.profitLoss.current && c.profitLoss.current.PROFIT_AFTER_TAX);
    const result = pat != null && pat < 0 ? 'loss' : 'profit';
    const qualified = /^y/i.test((c.auditorReport && c.auditorReport.QUALIFIED_OPINION) || '');
    const listed = cin[0] === 'L';
    const bs = (c.balanceSheet && c.balanceSheet.current) || {};
    const values = {}, missing = [], notes = [];
    // s.2(40) proviso: no cash flow statement for an OPC, small or dormant company.
    const cfExempt = /OPC/.test(cinType(cin)) || !!smallCompany(c, a);

    // 1. Report on the financial statements.
    values.OPINION = (qualified
      ? 'Qualified opinion. In our opinion, except for the effects of the matter described in the basis for qualified opinion, '
      : 'Unmodified opinion. In our opinion, ')
      + `the financial statements of ${name} give the information required by the Companies Act, 2013 and give a true and fair view, `
      + `in line with accounting principles generally accepted in India, of the state of affairs of the company as at ${fyEnd} `
      + `and of its ${result}` + (cfExempt ? '' : ' and its cash flows') + ' for the year ended on that date.';
    if (!qualified) values.BASIS = 'We audited the financial statements as per the Standards on Auditing under section 143(10) of the Companies Act, 2013. '
      + 'We are independent of the company under the ICAI Code of Ethics. The audit evidence we obtained is sufficient and appropriate for our opinion.';
    // Emphasis of matter (c) and other information (e) are not in the payload: asked below.
    values.KAM = listed ? '' : 'Not applicable';
    values.QUAL_COUNT = qualified ? '' : '0';

    // 3-4. Responsibilities.
    values.MGMT_RESP = `The Board of Directors of ${name} is responsible for preparing financial statements that give a true and fair view `
      + 'as per the accounting standards under section 133, for keeping proper books of account and internal controls, '
      + "and for assessing the company's ability to continue as a going concern.";
    values.AUDITOR_RESP = 'Our objective is to obtain reasonable assurance that the financial statements as a whole are free from material misstatement, '
      + 'whether due to fraud or error, and to issue a report with our opinion. We planned and performed the audit as per the Standards on Auditing.';

    // 5. Rule 11 matters and any other matter are not in the payload: asked below (from the signed report).

    // 6(b)/(c). CARO.
    const caro = caroTest(c, a);
    const caroSaved = /^(yes|no)$/i.test(String(a.CARO || '').trim());
    values.CARO = caroSaved ? (/^y/i.test(a.CARO) ? 'Yes' : 'No') : caro.applies ? 'Yes' : 'No';
    notes.push(caroSaved ? `CARO 2020 set to "${values.CARO}" from the saved answer.`
      : caro.applies ? `CARO 2020 applies: ${caro.fails.join('; ')}. Answer the 21 CARO rows.`
      : `CARO 2020 not applicable (para ${caro.para}): ${caro.passes.join('; ')}.`);

    // 6(d). IFC.
    const exempt = ifcExempt(c);
    if (exempt) values.IFC = 'Not applicable. The company is a private company with turnover below Rs. 50 crore and borrowings below Rs. 25 crore, '
      + 'so reporting on internal financial controls under section 143(3)(i) is exempt as per MCA notification G.S.R. 583(E) dated 13-06-2017.';
    else missing.push({ key: 'IFC', label: "6(d) Auditor's opinion on internal financial controls", type: 'textarea',
      hint: 'The company is not exempt from IFC reporting: give the opinion from the IFC annexure (e.g. "adequate and operating effectively").' });

    // 6(a). Section 143(3) summary. Filled only for an unmodified opinion; for a qualified one it is asked
    // (below, this text as the hint) because (a)-(d) may be exactly what the qualification is about.
    const legal6a = '(a) We obtained all the information and explanations needed for our audit. '
      + '(b) The company has kept proper books of account as required by law. '
      + '(c) The balance sheet and the statement of profit and loss agree with the books of account. '
      + '(d) The financial statements comply with the accounting standards under section 133. '
      + `(e) No director is disqualified under section 164(2) as on ${fyEnd}. `
      + (exempt ? '(f) A report on internal financial controls is not required (exempt under G.S.R. 583(E) dated 13-06-2017). '
                : '(f) Our report on internal financial controls is given separately. ')
      + (isPrivate(cin) ? '(g) Section 197(16) does not apply to a private company.'
                        : '(g) The remuneration paid to directors is within the limits of section 197.');
    if (!qualified) { values.LEGAL_6A = legal6a; notes.push('6(a) is the standard s.143(3) wording: check it against the signed report.'); }
    if (!isPrivate(cin)) notes.push('Public company: check the section 197 sentence in 6(a) against the audit report.');

    // Declaration (Name is read-only on MCA: it comes from the DIN).
    const s = signatory(c, a);
    values.DECL_DESIGNATION = s.desig;
    values.DECL_DIN = s.din;

    // Saved answers for this form win over everything built above.
    const own = ['OPINION', 'BASIS', 'EMPHASIS', 'KAM', 'OTHER_INFO', 'QUAL_COUNT', 'QUAL_TYPE_1', 'QUAL_COMMENT_1', 'MGMT_RESP',
      'AUDITOR_RESP', 'RULE11', 'OTHER_5B', 'LEGAL_6A', 'IFC'];
    CARO_ROWS.forEach((_, i) => own.push(`CARO_${i + 1}`, `CARO_${i + 1}_DETAIL`));
    for (const k of own) if (!blank(a[k])) values[k] = String(a[k]).trim();

    // Whatever is still unknown is asked in the side panel.
    const ask = (key, label, type, extra) => { if (blank(values[key])) missing.push(Object.assign({ key, label, type }, extra || {})); };
    if (qualified) {
      ask('BASIS', '1(b) Basis for qualified opinion — the matter qualified', 'textarea');
      ask('QUAL_COUNT', '2 Number of qualifications / reservations / adverse remarks', 'number');
      if (!(Number(values.QUAL_COUNT) === 0 && !blank(values.QUAL_COUNT))) {
        ask('QUAL_TYPE_1', '2 Remark 1 — type', 'select', { options: QUAL_OPTIONS });
        ask('QUAL_COMMENT_1', "2 Remark 1 — the auditor's comment", 'textarea');
      }
      if (Number(values.QUAL_COUNT) > 1) notes.push('Only the first remark row is filled; add the other rows on MCA.');
    }
    // Facts only the signed audit report has. The usual clean wording is pre-filled (`default`, editable) so the
    // CA confirms it; Rule 11 and the emphasis for a negative net worth are never pre-filled.
    ask('RULE11', '5(a) Rule 11 matters (copy from the audit report)', 'textarea', { hint: '(i) The company has no pending litigation that '
      + 'would impact its financial position. (ii) No long-term contracts, including derivative contracts, with material foreseeable losses. '
      + '(iii) No amount was required to be transferred to the Investor Education and Protection Fund. (iv) Rule 11(e) representations on '
      + 'funds advanced or received through intermediaries: as per the report. (v) Dividend under section 123: as per the report. '
      + '(vi) Audit trail (edit log) under Rule 11(g): as per the report.' });
    const nw = sum(num(bs.SHARE_CAPITAL), num(bs.RESERVES_SURPLUS));
    if (nw != null && nw < 0) ask('EMPHASIS', '1(c) Emphasis of matter (write Nil if none)', 'textarea',
      { hint: `Net worth is negative (${inr(nw)}): check the report for a going-concern emphasis or material uncertainty.` });
    else ask('EMPHASIS', '1(c) Emphasis of matter (write Nil if none)', 'textarea', { default: 'Nil', hint: 'Nil if the report has none.' });
    ask('OTHER_INFO', "1(e) Other information (Board's report)", 'text',
      { default: "The other information is the Board's report. We have read it and have nothing to report." });
    ask('OTHER_5B', '5(b) Any other matter (write None if none)', 'text', { default: 'None' });
    if (qualified) ask('LEGAL_6A', '6(a) Other legal & regulatory requirements (copy from the report — check (a)-(d) against the qualification)',
      'textarea', { hint: legal6a });
    if (listed) ask('KAM', '1(d) Key audit matters (listed company)', 'text', { hint: 'Short description of each key audit matter.' });
    if (values.CARO === 'Yes') {
      const hints = caroHints(c);
      CARO_ROWS.forEach(([label], i) => {
        ask(`CARO_${i + 1}`, `6(c) CARO ${i + 1}. ${label}`, 'select', { options: CARO_OPTIONS, hint: hints[i] || undefined });
        if (blank(values[`CARO_${i + 1}`])) missing.push({ key: `CARO_${i + 1}_DETAIL`, label: `6(c) CARO ${i + 1}. ${label} — details (optional)`, type: 'textarea', optional: true });
      });
    }
    if (!/^\d{8}$/.test(values.DECL_DIN || '') && values.DECL_DESIGNATION === 'Director')
      missing.push({ key: 'DECL_DIN', label: 'Declaration — DIN of the director signing', type: 'text', hint: '8 digits' });
    return { values, missing, notes };
  }

  // Suggestions shown next to CARO rows (the user still chooses).
  function caroHints(c) {
    const bs = (c.balanceSheet && c.balanceSheet.current) || {};
    const pat = num(c.profitLoss && c.profitLoss.current && c.profitLoss.current.PROFIT_AFTER_TAX);
    const zero = k => !num(bs[k]);
    const h = [];
    if (zero('INVENTORIES')) h[1] = 'No inventories in the balance sheet: usually "Clause not applicable".';
    if (zero('NON_CURRENT_INVESTMENTS') && zero('CURRENT_INVESTMENTS')) h[3] = 'No investments in the balance sheet.';
    if (!/^y/i.test((c.costRecords && c.costRecords.MAINTENANCE_MANDATED) || '')) h[5] = 'Cost records not mandated: usually "Clause not applicable".';
    h[11] = 'Not a Nidhi company: usually "Clause not applicable".';
    if (pat != null && pat < 0) h[17] = 'The company made a loss this year: check whether it is a cash loss.';
    if (!/^(y|applicable)/i.test((c.csr && c.csr.CSR_APPLICABILITY) || '')) h[20] = 'CSR not applicable: usually "Clause not applicable".';
    return h;
  }

  // Readable names for the process-status list (the runner shows job.label before its own map).
  const labels = {
    OPINION: '1(a) Opinion', BASIS: '1(b) Basis for opinion', EMPHASIS: '1(c) Emphasis of matter', KAM: '1(d) Key audit matters',
    OTHER_INFO: '1(e) Other information', QUAL_COUNT: '2 Number of qualifications', QUAL_TYPE_1: '2 Remark 1 type', QUAL_COMMENT_1: '2 Remark 1 comment',
    MGMT_RESP: "3 Management's responsibility", AUDITOR_RESP: "4 Auditor's responsibility", RULE11: '5(a) Rule 11 matters',
    OTHER_5B: '5(b) Any other matter', LEGAL_6A: '6(a) Other legal & regulatory requirements', CARO: '6(b) CARO applicable',
    IFC: '6(d) Internal financial controls', DECL_DESIGNATION: 'Declaration — designation', DECL_DIN: 'Declaration — DIN',
  };
  CARO_ROWS.forEach(([l], i) => { labels[`CARO_${i + 1}`] = `6(c) CARO ${i + 1}. ${l}`; labels[`CARO_${i + 1}_DETAIL`] = `6(c) CARO ${i + 1} details`; });

  // pageFill jobs in page order (radios before the fields they enable). Empty values are skipped.
  function jobs(values) {
    const v = values || {}, out = [];
    const add = (id, kind, selector, extra) => { if (!blank(v[id])) out.push(Object.assign({ id, kind, selector, index: 0, value: String(v[id]), label: labels[id] || id }, extra || {})); };
    for (const k of ['OPINION', 'BASIS', 'EMPHASIS', 'KAM', 'OTHER_INFO', 'QUAL_COUNT']) add(k, 'text', sel(T[k]));
    if (Number(v.QUAL_COUNT) > 0) { add('QUAL_TYPE_1', 'select', sel(T.QUAL_TYPE_1, 'select')); add('QUAL_COMMENT_1', 'text', sel(T.QUAL_COMMENT_1)); }
    for (const k of ['MGMT_RESP', 'AUDITOR_RESP', 'RULE11', 'OTHER_5B', 'LEGAL_6A']) add(k, 'text', sel(T[k]));
    // MCA enables the 6(c) table only after 6(b)=Yes; wait (pageFill: up to 10 s) for row 1 to show, or the
    // rows would be reported as "not shown — skipped" instead of failing.
    add('CARO', 'radio', sel(T.CARO, 'input[type="radio"]'), v.CARO === 'Yes' ? { waitForSelector: caroSel('Row1', 'tableItem1') } : null);
    if (v.CARO === 'Yes') CARO_ROWS.forEach(([, row, s, d], i) => {
      add(`CARO_${i + 1}`, 'select', caroSel(row, s));
      add(`CARO_${i + 1}_DETAIL`, 'text', caroSel(row, d));
    });
    add('IFC', 'text', sel(T.IFC));
    // Same order as the AOC-4 declaration (designation, then DIN typed so MCA looks up the name).
    add('DECL_DESIGNATION', 'select', sel(T.DECL_DESIGNATION, 'select'));
    add('DECL_DIN', 'text', sel(T.DECL_DIN), { typeChars: true });
    return out;
  }

  const FORM = {
    id: 'eauditor',
    label: "Auditor's report",
    urlRe: /extract-of-auditor-standalone/i,
    answersForm: 'eauditor',
    nextButton: 'Proceed',
    buildData, jobs, labels,
    // Exposed for tests / the side panel.
    _internal: { T, CARO_ROWS, CARO_OPTIONS, caroTest, ifcExempt, num, dinOf },
  };
  root.LINKED_FORMS = root.LINKED_FORMS || {}; root.LINKED_FORMS[FORM.id] = FORM;
  if (typeof module !== 'undefined') module.exports = FORM;
})(typeof window !== 'undefined' ? window : globalThis);
