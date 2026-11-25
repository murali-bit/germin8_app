// Board's report extract — AOC-4 linked form (…/form-extract-of-boards-report.html).
// buildData() turns the AOC-4 payload + saved company answers into a value for every field;
// jobs() turns those values into pageFill jobs; pre[] adds the board-meeting table rows first.
// This page's buttons are Previous / Save / Submit. Only Save may be clicked (by the caller),
// so nextButton is null and nothing here ever clicks a button.
(function (root) {
  // ── selectors ──────────────────────────────────────────────────────────────
  // Field names are "guideContainer-rootPanel-<path>___jqName". The leading "-" keeps each tail on a
  // segment boundary, so "...-panel-panel-panel-guidetextbox" never matches "...-panel-panel-panel-panel-guidetextbox".
  const T = tail => `[name$="-${tail}___jqName"]`;
  const B = 'panel_1665650438-panel_526419145-panel-panel-panel-';
  const R = 'panel_2115028168-';                       // Rule 8 block (ids are unique, B prefix not needed)
  const E = 'panel1634057462326_c-';                   // declaration
  const RADIO = tail => `input[type="radio"]${T(tail)}`;
  // Board-meeting table: every row instance keeps the row id in its name; the committee table's rows
  // are "table_47856561_copy__197747959-Row…", which does not contain "copy_-Row".
  const ROW = 'table_47856561_copy_-Row1642490503674';
  const CELL = item => `[name*="${ROW}"]${T(item)}`;
  const SEL = {
    WEBSITE: T('panel_20395728-guidetextbox'),
    SMALL_CO: RADIO('panel_892374834-guideradiobutton_cop'),
    BM_COUNT: T('panel_892374834-guidetextbox'),
    BM_DATE: CELL('tableItem1642490503676'), BM_TOTAL: CELL('tableItem1642490503677'),
    BM_ATTENDED: CELL('tableItem1642490503678'), BM_PCT: CELL('tableItem1642490503679'),
    CM_COUNT: T('panel_892374834-guidetextbox_1601964588'),
    DRS: T(B + 'panel-guidetextbox'),
    FRAUDS: T('panel-guidetextbox_678662623'),
    ID_DECL: T('panel-guidetextbox_776880800'),
    S178: T('panel-guidetextbox_433696601'),
    S186_GIVEN: RADIO('panel_359247065-guideradiobutton'),
    S186_B: RADIO('panel_359247065-guideradiobutton_931734815'),   // 9(b): shown by MCA only when 9(a) is Yes
    S186_REPORTABLE: RADIO('panel_359247065-guideradiobutton_28427114'),
    S186_DETAILS: T('panel_359247065-guidetextbox'),
    RPT_COUNT: T('panel_1986292804-guidetextbox'),
    STATE_OF_AFFAIRS: T('panel_1665650438-panel_526419145-panel-panel-panel-guidetextbox'),
    RESERVES_DESC: T('panel_1159321043-guidetextbox_1155662995'),
    RESERVES_AMT: T('panel_1159321043-guidetextbox_1606013672'),
    DIVIDEND_DESC: T('panel_1159321043-guidetextbox_1330996963'),
    DIVIDEND_AMT: T('panel_1159321043-guidetextbox_280412745'),
    MATERIAL_CHANGES: T('panel_1665650438-panel_526419145-panel-panel-panel-guidetextbox_2029873'),
    RISK: T('panel_1665650438-panel_526419145-panel-panel-panel-guidetextbox_1666541'),
    TECH: T(R + 'guidetextbox'), ENERGY: T(R + 'guidetextbox_1729187724'), FOREX: T(R + 'guidetextbox_16495779'),
    ID_INTEGRITY: T(R + 'guidetextbox_1313880'), IFC: T(R + 'guidetextbox_1313880_281340593'),
    COST_RECORDS: T(R + 'guidetextbox_1313880_1876612761'), IBC: T(R + 'guidetextbox_1313880_1463766221'),
    OTS: T(R + 'guidetextbox_1313880_66255878'), FIN_SUMMARY: T(R + 'guidetextbox_1313880320'),
    NATURE_CHANGE: T(R + 'guidetextbox_724037653'), DIRECTOR_CHANGES: T(R + 'guidetextbox_23171735'),
    ORDERS: T(R + 'guidetextbox_1508126227'), EVALUATION: T(R + 'guidetextbox_2054341819'),
    POSH_STATEMENT: T(R + 'guidetextbox_2054341'),
    POSH_RECEIVED: T(R + 'guidetextbox_2054341_1195835138'), POSH_DISPOSED: T(R + 'guidetextbox_2054341_382577391'),
    POSH_PENDING90: T(R + 'guidetextbox_2054341_963786679'),
    MATERNITY: T(R + 'guidetextbox_2054341_578766345'),
    EMP_FEMALE: T(R + 'guidetextbox_2054341_33495648'), EMP_MALE: T(R + 'guidetextbox_2054341_3432480'),
    EMP_TRANSGENDER: T(R + 'guidetextbox_2054341_4534272'),
    OTHER_MATTERS: T(R + 'guidetextbox_2054341_564968698'),
    DECL_RES_NO: T(E + 'guidetextbox_1814224970'), DECL_RES_DATE: T(E + 'guidetextbox_1256508639'),
    DECL_ROLE: T(E + 'guidetextbox_1592552661'),       // a <select> despite its name
    DECL_DIN: T(E + 'guidetextbox_1410159061'),
  };
  // Rule 8(5)(v) deposits (f)(i)…(ix), in page order.
  const DEP_IDS = ['586588836', '852355712', '2114398262', '202394133', '376959027', '321235249', '1528298031', '2090900673', '445648030'];
  DEP_IDS.forEach((id, i) => { SEL['DEPOSIT_' + (i + 1)] = T(R + 'guidetextbox_' + id); });

  // Page order of the plain (non-table) fields after the meeting table. [key, pageFill kind]
  const ORDER = [
    ['CM_COUNT', 'number'], ['DRS', 'text'], ['FRAUDS', 'text'], ['ID_DECL', 'text'], ['S178', 'text'],
    ['S186_GIVEN', 'radio'], ['S186_B', 'radio'], ['S186_REPORTABLE', 'radio'], ['S186_DETAILS', 'text'], ['RPT_COUNT', 'number'],
    // Amount before its description: MCA's rule on the amount box clears the description box.
    ['STATE_OF_AFFAIRS', 'text'], ['RESERVES_AMT', 'number'], ['RESERVES_DESC', 'text'],
    ['DIVIDEND_AMT', 'number'], ['DIVIDEND_DESC', 'text'], ['MATERIAL_CHANGES', 'text'], ['RISK', 'text'],
    ['TECH', 'text'], ['ENERGY', 'text'], ['FOREX', 'text'], ['ID_INTEGRITY', 'text'], ['IFC', 'text'],
    ['COST_RECORDS', 'text'], ['IBC', 'text'], ['OTS', 'text'], ['FIN_SUMMARY', 'text'],
    ['NATURE_CHANGE', 'text'], ['DIRECTOR_CHANGES', 'text'],
    ...DEP_IDS.map((_, i) => ['DEPOSIT_' + (i + 1), 'number']),
    ['ORDERS', 'text'], ['EVALUATION', 'text'], ['POSH_STATEMENT', 'text'],
    ['POSH_RECEIVED', 'number'], ['POSH_DISPOSED', 'number'], ['POSH_PENDING90', 'number'], ['MATERNITY', 'text'],
    ['EMP_FEMALE', 'number'], ['EMP_MALE', 'number'], ['EMP_TRANSGENDER', 'number'], ['OTHER_MATTERS', 'number'],
    ['DECL_RES_NO', 'text'], ['DECL_RES_DATE', 'date'], ['DECL_ROLE', 'select'], ['DECL_DIN', 'text'],
  ];

  // ── pure helpers ───────────────────────────────────────────────────────────
  const num = v => {
    if (v && typeof v === 'object') v = v.current;       // {current, previous} pairs
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[,\s₹]/g, '').replace(/^\((.*)\)$/, '-$1'));
    return Number.isFinite(n) ? n : null;
  };
  const crore = 1e7;
  // Indian digit grouping: 1537800 → "15,37,800"; negatives keep the sign.
  function fmtINR(v) {
    const n = num(v);
    if (n === null) return '';
    const [int, dec] = Math.abs(n).toFixed(Number.isInteger(n) ? 0 : 2).split('.');
    const grouped = int.length <= 3 ? int : int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + int.slice(-3);
    return (n < 0 ? '-' : '') + grouped + (dec ? '.' + dec : '');
  }
  const rs = v => 'Rs. ' + fmtINR(Math.abs(num(v)));
  function ddmmyyyy(s) {
    const p = String(s || '').trim().split(/[\/\-.]/);
    if (p.length !== 3) return '';
    let [d, m, y] = p[0].length === 4 ? [p[2], p[1], p[0]] : p;
    if (y.length === 2) y = '20' + y;
    const out = `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    const dt = new Date(+y, +m - 1, +d);
    return /^\d{2}\/\d{2}\/\d{4}$/.test(out) && dt.getDate() === +d && dt.getMonth() === +m - 1 ? out : '';
  }
  const dateKey = s => s.split('/').reverse().join('');  // DD/MM/YYYY → YYYYMMDD for comparing
  const pct = (attended, total) => String(Math.round(attended / total * 100));

  // Meetings come as a JSON array of {date,total,attended} or as text lines "DD/MM/YYYY | total | attended".
  function parseMeetings(raw) {
    const rows = [], errors = [];
    if (raw === null || raw === undefined || raw === '') return { rows, errors };
    let list = raw;
    if (typeof raw === 'string') {
      try { list = JSON.parse(raw); } catch (_) {
        list = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
          const [date, total, attended] = l.split(/\s*[|\t,;]\s*/);
          return { date, total, attended, line: l };
        });
      }
    }
    if (!Array.isArray(list)) return { rows, errors: ['Board meetings must be a list.'] };
    list.forEach((m, i) => {
      const date = ddmmyyyy(m && m.date), total = num(m && m.total), attended = num(m && m.attended);
      const where = `Meeting ${i + 1}${m && m.line ? ` ("${m.line}")` : ''}`;
      if (!date) errors.push(`${where}: date must be DD/MM/YYYY.`);
      else if (!(Number.isInteger(total) && total > 0)) errors.push(`${where}: total directors must be a whole number above 0.`);
      else if (!(Number.isInteger(attended) && attended >= 0 && attended <= total)) errors.push(`${where}: directors attended must be between 0 and ${total}.`);
      else rows.push({ date, total, attended, pct: pct(attended, total) });
    });
    rows.sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
    return { rows, errors };
  }

  // Small company u/s 2(85): paid-up ≤ ₹4 crore and turnover ≤ ₹40 crore, not a holding/subsidiary company.
  // The turnover test uses the IMMEDIATELY PRECEDING year's P&L (s.2(85)(ii)); current year only as a flagged fallback.
  // OPCs count too (the question is "OPC/Small company").
  function smallCompany(client) {
    const cin = String(client.general?.CIN || '').toUpperCase();
    const bs = client.balanceSheet?.current || {};
    const paidUp = num(client.shareCapital?.PAID_UP_NOMINAL) ?? num(bs.SHARE_CAPITAL);
    const prevT = num(client.profitLoss?.previous?.REVENUE_OPERATIONS);
    const turnover = prevT ?? num(client.profitLoss?.current?.REVENUE_OPERATIONS);
    const tWhich = prevT !== null ? 'previous-year turnover' : 'turnover (previous-year figure missing, current used, check)';
    if (/OPC/.test(cin)) return { value: 'Yes', why: 'One Person Company' };
    if (!/PTC/.test(cin)) return { value: 'No', why: 'not a private company' };
    if (client.subsidiary?.IS_SUBSIDIARY === 'Yes') return { value: 'No', why: 'it is a subsidiary company' };
    if (client.subsidiary?.HAS_SUBSIDIARY_OR_JV === 'Yes') return { value: 'No', why: 'it has a subsidiary/JV (check: only a holding company is excluded)' };
    if (paidUp === null || turnover === null) return { value: 'No', why: 'paid-up capital or turnover missing in the AOC-4 data — check' };
    // G.S.R. 880(E): limits raised to Rs. 10 crore / Rs. 100 crore from 01-12-2025.
    const fyTo = ddmmyyyy(client.general?.FY_TO);
    const newLim = fyTo ? dateKey(fyTo) >= '20251201' : false;
    const capC = newLim ? 10 : 4, toC = newLim ? 100 : 40;
    const ok = paidUp <= capC * crore && turnover <= toC * crore;
    return { value: ok ? 'Yes' : 'No', why: `paid-up ${rs(paidUp)} ${paidUp <= capC * crore ? '≤' : '>'} ${capC} crore, ${tWhich} ${rs(turnover)} ${turnover <= toC * crore ? '≤' : '>'} ${toC} crore` };
  }

  // s.186: Yes only when the company has given loans/guarantees or made investments (current year).
  function s186(client) {
    const bs = client.balanceSheet?.current || {}, br = client.balanceSheetBreakup || {};
    const parts = [['non-current investments', num(bs.NON_CURRENT_INVESTMENTS)], ['current investments', num(bs.CURRENT_INVESTMENTS)]];
    for (const k of Object.keys(br)) {
      if (/^BS_(LT|ST)_LOANS_(GOOD|DOUBTFUL)_(RELATED_PARTIES|DIRECTORS)$/.test(k)) parts.push([k.toLowerCase().replace(/^bs_|_/g, ' ').trim(), num(br[k])]);
    }
    const hit = parts.filter(([, v]) => v > 0);
    return { value: hit.length ? 'Yes' : 'No', hit };
  }

  // ── buildData ──────────────────────────────────────────────────────────────
  function buildData(client, answers) {
    client = client || {}; answers = answers || {};
    const has = k => Object.prototype.hasOwnProperty.call(answers, k) && answers[k] !== null && answers[k] !== undefined;
    const g = client.general || {};
    const pl = client.profitLoss?.current || {}, plp = client.profitLoss?.previous || {};
    const bs = client.balanceSheet?.current || {}, br = client.balanceSheetBreakup || {};
    const name = g.COMPANY_NAME || 'The company';
    const fyEnd = ddmmyyyy(g.FY_TO) || '';
    const listed = /^L/i.test(g.CIN || '');
    const isPrivate = /PTC|OPC/i.test(g.CIN || '');
    const values = {}, missing = [], notes = [];

    // 1. Website (optional; empty means none).
    values.WEBSITE = has('WEBSITE') ? String(answers.WEBSITE).trim() : '';
    if (!has('WEBSITE')) missing.push({ key: 'WEBSITE', label: 'Company website (leave empty if none)', type: 'text', default: '', optional: true });

    // 2(a) Small company.
    const sc = smallCompany(client);
    values.SMALL_CO = sc.value;
    notes.push(`OPC/Small company: ${sc.value} (${sc.why}).`);

    // 2(b) Board meetings.
    const mt = parseMeetings(answers.BOARD_MEETINGS);
    values.MEETINGS = mt.rows;
    if (mt.rows.length) values.BM_COUNT = String(mt.rows.length);
    if (!mt.rows.length || mt.errors.length) {
      missing.push({ key: 'BOARD_MEETINGS', label: 'Board meetings held during the year', type: 'textarea',
        hint: 'One meeting per line: DD/MM/YYYY | total directors | directors attended', errors: mt.errors,
        // Checked when the answer is collected; stored as the JSON array the spec asks for.
        parse: v => {
          const r = parseMeetings(v);
          if (r.errors.length) throw new Error(r.errors[0]);
          if (!r.rows.length) throw new Error('enter at least one meeting');
          return r.rows.map(({ date, total, attended }) => ({ date, total, attended }));
        } });
    }
    if (mt.rows.length) {
      const from = ddmmyyyy(g.FY_FROM), to = ddmmyyyy(g.FY_TO);
      const outside = from && to ? mt.rows.filter(m => dateKey(m.date) < dateKey(from) || dateKey(m.date) > dateKey(to)) : [];
      if (outside.length) notes.push(`Check: meeting date(s) ${outside.map(m => m.date).join(', ')} fall outside the financial year ${from}–${to}.`);
      const minNeeded = sc.value === 'Yes' ? 2 : 4;
      if (mt.rows.length < minNeeded) notes.push(`Check: only ${mt.rows.length} board meeting(s); section 173 needs at least ${minNeeded}${sc.value === 'Yes' ? ' (one in each half of the calendar year, at least 90 days apart)' : ''}.`);
      if (mt.rows.length >= 2) {
        // Gaps in days between consecutive meetings (rows are sorted by date).
        const ds = mt.rows.map(m => { const [d, mo, y] = m.date.split('/'); return Date.UTC(+y, +mo - 1, +d); });
        const gaps = ds.slice(1).map((t, i) => (t - ds[i]) / 864e5);
        if (sc.value === 'Yes' && Math.max(...gaps) < 90) notes.push('Check: section 173(5) needs at least 90 days between the two meetings.');
        if (sc.value !== 'Yes' && Math.max(...gaps) > 120) notes.push('Check: section 173(1) allows at most 120 days between two board meetings.');
      }
    }
    // 2(c) Committee meetings: none for a company without mandatory committees.
    if (isPrivate) values.CM_COUNT = '0';
    else if (has('CM_COUNT') && /^\d+$/.test(String(answers.CM_COUNT).trim())) values.CM_COUNT = String(answers.CM_COUNT).trim();
    else missing.push({ key: 'CM_COUNT', label: 'Number of committee meetings held during the year', type: 'number' });

    // 3. Directors' responsibility statement (s.134(5)) in own words; the IFC point applies to listed companies only.
    const lossWord = (num(pl.PROFIT_AFTER_TAX) ?? 0) < 0 ? 'loss' : 'profit';
    const drs = [
      'applicable accounting standards were followed in preparing the annual accounts, with no material departures',
      `accounting policies were applied consistently and judgements and estimates were reasonable and prudent, to give a true and fair view of the state of affairs at ${fyEnd || 'the year end'} and of the ${lossWord} for the year`,
      'proper care was taken to keep adequate accounting records as required by the Act, to safeguard the assets and to prevent and detect fraud',
      'the annual accounts were prepared on a going concern basis',
      ...(listed ? ['internal financial controls were laid down, were adequate and operated effectively'] : []),
      'proper systems were in place to ensure compliance with all applicable laws, and they were adequate and operated effectively',
    ];
    values.DRS = 'The Directors confirm that: ' + drs.map((t, i) => `(${String.fromCharCode(97 + i)}) ${t}`).join('; ') + '.';

    // 4–6.
    const confirm = (key, dflt, label) => {
      values[key] = has(key) && String(answers[key]).trim() ? String(answers[key]).trim() : dflt;
      if (!has(key)) missing.push({ key, label, type: 'textarea', default: dflt, optional: true });
    };
    confirm('FRAUDS', 'Nil', 'Frauds reported by the auditor under section 143(12)');
    values.ID_DECL = 'Not applicable';   // independent directors / s.178 committee: not required for a private company
    values.S178 = 'Not applicable';
    if (!isPrivate) notes.push('Public company: check items 5 (independent directors) and 6 (s.178 policy).');

    // 9. Section 186.
    const s = s186(client);
    values.S186_GIVEN = s.value; values.S186_REPORTABLE = s.value;
    if (s.value === 'Yes') {
      // 9(b) appears on MCA only when 9(a) is Yes; its answer is not in the payload, so ask (no job for No).
      const b = has('S186_B') ? String(answers.S186_B).trim() : '';
      if (/^(Yes|No)$/.test(b)) values.S186_B = b;
      else missing.push({ key: 'S186_B', label: 'Item 9(b) under section 186 (answer as asked on the MCA page)', type: 'select', options: ['Yes', 'No'] });
      if (has('S186_DETAILS')) values.S186_DETAILS = String(answers.S186_DETAILS);
      else missing.push({ key: 'S186_DETAILS', label: 'Brief particulars of loans, guarantees and investments under section 186', type: 'textarea',
        hint: s.hit.map(([k, v]) => `${k}: ${rs(v)}`).join('; ') });
      notes.push('Section 186: Yes — ' + s.hit.map(([k, v]) => `${k} ${rs(v)}`).join(', ') + '.');
    } else {
      // 9(d) "Brief details as to why transaction is not reportable" (required by MCA when 9(a) and 9(c) are No).
      values.S186_DETAILS = has('S186_DETAILS') && String(answers.S186_DETAILS).trim() ? String(answers.S186_DETAILS).trim()
        : 'The company has not given any loan or guarantee, provided any security or made any investment covered by section 186 during the year.';
      notes.push('Section 186: No/No — no loans given, guarantees, securities or investments on the balance sheet.');
    }

    // 10. s.188(1) contracts: must match the AOC-2 count. A director's pay as director is not a s.188 contract
    // (Explanation (a) to s.188(1)), nor are loans to or from directors. Default: AOC-2 rows if those answers are loaded,
    // or 0 when the AOC-4 data says there were no related-party transactions; otherwise ask.
    let rptDefault = null;
    if (/^no$/i.test(client.relatedParty?.ANY_TRANSACTION || '')) rptDefault = 0;
    else if (has('ROWS')) { try { const r = JSON.parse(answers.ROWS); if (Array.isArray(r)) rptDefault = r.length; } catch (_) { rptDefault = String(answers.ROWS).split(/\r?\n/).filter(l => l.trim()).length; } }
    const rptBlank = !has('RPT_COUNT') || String(answers.RPT_COUNT).trim() === '';
    const rpt = rptBlank ? rptDefault : num(answers.RPT_COUNT);
    if (Number.isInteger(rpt) && rpt >= 0) values.RPT_COUNT = String(rpt);
    if (!has('RPT_COUNT') || (rptBlank && rptDefault === null) || (!rptBlank && !(Number.isInteger(rpt) && rpt >= 0))) {
      missing.push({ key: 'RPT_COUNT', label: 'Contracts with related parties under section 188(1) (same number as in AOC-2)', type: 'number',
        ...(rptDefault !== null ? { default: String(rptDefault), optional: true } : {}),
        hint: "Count only s.188(1)(a)-(g) contracts, the same ones listed in AOC-2. Do not count a director's pay as director, or loans to or from directors." });
    }

    // 11. State of affairs.
    const rev = num(pl.REVENUE_OPERATIONS), revP = num(plp.REVENUE_OPERATIONS);
    const ti = num(pl.TOTAL_INCOME), pat = num(pl.PROFIT_AFTER_TAX), patP = num(plp.PROFIT_AFTER_TAX);
    const pnl = (v, prev) => `${v < 0 ? 'a loss' : 'a profit'} of ${rs(v)} after tax${prev === null ? '' : ` (previous year ${prev < 0 ? 'loss' : 'profit'} ${rs(prev)})`}`;
    const business = client.principalProducts?.HIGHEST_DESC || client.principalProducts?.CATEGORY_DESC || '';
    const soa = [
      business ? `The company is engaged in ${String(business).replace(/\.$/, '').replace(/^./, c => c.toLowerCase())}.` : '',
      rev !== null ? `Revenue from operations was ${rs(rev)}${revP !== null ? ` (previous year ${rs(revP)})` : ''}.` : '',
      ti !== null ? `Total income was ${rs(ti)}.` : '',
      pat !== null ? `The company made ${pnl(pat, patP)}.` : '',
    ].filter(Boolean).join(' ');
    if (soa) values.STATE_OF_AFFAIRS = soa;
    else missing.push({ key: 'STATE_OF_AFFAIRS', label: 'State of company affairs', type: 'textarea' });

    // 12–15.
    values.RESERVES_DESC = 'No amount transferred to reserves'; values.RESERVES_AMT = '0';
    values.DIVIDEND_DESC = 'No dividend recommended'; values.DIVIDEND_AMT = '0';
    // 14. Material changes after the year end up to the report date: not in the payload, so ask (default "None").
    values.MATERIAL_CHANGES = has('MATERIAL_CHANGES') && String(answers.MATERIAL_CHANGES).trim() ? String(answers.MATERIAL_CHANGES).trim() : 'None';
    if (!has('MATERIAL_CHANGES')) missing.push({ key: 'MATERIAL_CHANGES', label: 'Material changes after the year end up to the report date', type: 'textarea', default: 'None', optional: true });
    // 15. Risk: a company with negative net worth must not say no risk threatens its existence.
    const nwKnown = num(bs.SHARE_CAPITAL) !== null || num(bs.RESERVES_SURPLUS) !== null;
    const nw = (num(bs.SHARE_CAPITAL) ?? 0) + (num(bs.RESERVES_SURPLUS) ?? 0);
    const dirLoanAmt = num(br.BS_UNSEC_LT_RELATED_PARTIES);
    values.RISK = nwKnown && nw < 0
      ? `The company has accumulated losses and a negative net worth of ${rs(nw)}.` + (dirLoanAmt > 0 ? ' It depends on continued funding from its directors.' : '') + ' The Board reviews this and other business risks regularly.'
      : 'The Board reviews the risks to the business regularly. No risk is seen that threatens the existence of the company.';

    // Rule 8 block.
    values.TECH = 'Not applicable'; values.ENERGY = 'Not applicable';
    const fx = client.foreignExchange || {};
    const sumFx = re => Object.keys(fx).filter(k => re.test(k) && !/_PREV(IOUS)?$/.test(k)).reduce((t, k) => t + (num(fx[k]) || 0), 0);
    const fxIn = sumFx(/^FX_IN_/), fxOut = sumFx(/^FX_OUT_/);
    values.FOREX = `Foreign exchange earnings: ${fxIn ? rs(fxIn) : 'Nil'}. Foreign exchange outgo: ${fxOut ? rs(fxOut) : 'Nil'}.`;
    values.ID_INTEGRITY = 'Not applicable';
    values.IFC = 'The company has internal financial controls suited to its size and business, and they worked well during the year.';
    const costMandated = client.costRecords?.MAINTENANCE_MANDATED === 'Yes';
    values.COST_RECORDS = costMandated
      ? 'The company is required to maintain cost records under section 148(1) and has maintained them.'
      : 'Not applicable. The company is not required to maintain cost records under section 148(1).';
    confirm('IBC', 'No application was made and no proceeding is pending under the Insolvency and Bankruptcy Code, 2016.', 'Applications or proceedings under the Insolvency and Bankruptcy Code, 2016');
    values.OTS = 'Not applicable. There was no one-time settlement with any bank or financial institution.';
    const eps = num(pl.EPS_BASIC);
    values.FIN_SUMMARY = [
      rev !== null ? `Revenue from operations ${rs(rev)}${revP !== null ? ` (previous year ${rs(revP)})` : ''}` : '',
      ti !== null ? `total income ${rs(ti)}` : '',
      pat !== null ? `${pat < 0 ? 'loss' : 'profit'} after tax ${rs(pat)}${patP !== null ? ` (previous year ${patP < 0 ? 'loss' : 'profit'} ${rs(patP)})` : ''}` : '',
      eps !== null ? (eps < 0 ? `loss per share Rs. ${Math.abs(eps).toFixed(2)}` : `earnings per share Rs. ${eps.toFixed(2)}`) : '',
    ].filter(Boolean).join('; ') + '.';
    confirm('NATURE_CHANGE', 'There was no change in the nature of business.', 'Change in the nature of business during the year');
    values.DIRECTOR_CHANGES = has('DIRECTOR_CHANGES') && String(answers.DIRECTOR_CHANGES).trim() ? String(answers.DIRECTOR_CHANGES).trim() : 'None';
    if (!has('DIRECTOR_CHANGES')) missing.push({ key: 'DIRECTOR_CHANGES', label: 'Directors / KMP appointed or resigned during the year', type: 'textarea', default: 'None', optional: true });

    // Deposits. Money from directors is not a deposit under Rule 2(1)(c)(viii) only if each director declared in
    // writing that it was not borrowed; the proviso also requires the Board's report to disclose it. Only the
    // related-party breakup counts as "from directors" (total long-term borrowings may be from anyone).
    const dl = br.BS_UNSEC_LT_RELATED_PARTIES;
    const dirLoan = num(dl), dirLoanPrev = dl && typeof dl === 'object' ? num(dl.previous) : null;
    let depositsNil = true;
    if (dirLoan > 0) {
      const decl = has('DIRECTOR_LOAN_DECLARATION') ? String(answers.DIRECTOR_LOAN_DECLARATION).trim() : '';
      if (!/^(Yes|No)$/.test(decl)) missing.push({ key: 'DIRECTOR_LOAN_DECLARATION', type: 'select', options: ['Yes', 'No'],
        label: `Did each director who lent money (${rs(dirLoan)} outstanding) declare in writing that it was not borrowed?` });
      const disclose = `Unsecured loans from directors stood at ${rs(dirLoan)}${dirLoanPrev !== null ? ` (previous year ${rs(dirLoanPrev)})` : ''}.`;
      if (decl === 'Yes') {
        if (values.STATE_OF_AFFAIRS) values.STATE_OF_AFFAIRS += ` ${disclose} The directors declared that this money was not borrowed by them, so it is not a deposit.`;
        notes.push(`Deposits shown as 0: the loan of ${rs(dirLoan)} from directors is not a deposit under Rule 2(1)(c)(viii) (declaration given); disclosed in the state of affairs.`);
      } else {
        depositsNil = false;   // unknown or No: do not file "0" for deposits
        notes.push(decl === 'No'
          ? `No director declaration: the loan of ${rs(dirLoan)} from directors may be a deposit — fill the deposit items (f)(i)–(ix) on MCA yourself.`
          : `Deposit items are left empty until the Rule 2(1)(c)(viii) declaration for the ${rs(dirLoan)} loan from directors is confirmed.`);
      }
    }
    if (depositsNil) DEP_IDS.forEach((_, i) => { values['DEPOSIT_' + (i + 1)] = '0'; });

    confirm('ORDERS', 'None', 'Significant orders passed by regulators, courts or tribunals');
    values.EVALUATION = 'Not applicable';
    if (listed) notes.push('Listed company: write the annual evaluation statement (h) on MCA.');

    // POSH and employees.
    const emp = {};
    for (const [k, label, dflt] of [['EMP_FEMALE', 'Number of women employees', null], ['EMP_MALE', 'Number of men employees', null], ['EMP_TRANSGENDER', 'Number of transgender employees', 0]]) {
      // A blank saved answer means "use the default" (lfCollectMissing stores '' for a cleared optional box).
      const blank = !has(k) || String(answers[k]).trim() === '';
      const v = blank ? dflt : num(answers[k]);
      if (Number.isInteger(v) && v >= 0) { emp[k] = v; values[k] = String(v); }
      if (!has(k) || (blank && dflt === null) || (!blank && !(Number.isInteger(v) && v >= 0))) missing.push({ key: k, label, type: 'number', ...(dflt !== null ? { default: String(dflt), optional: true } : {}) });
    }
    const known = ['EMP_FEMALE', 'EMP_MALE', 'EMP_TRANSGENDER'].every(k => k in emp);
    const headcount = known ? emp.EMP_FEMALE + emp.EMP_MALE + emp.EMP_TRANSGENDER : null;
    const poshDefault = headcount === null ? '' : headcount >= 10
      ? 'The company has set up an Internal Complaints Committee under the POSH Act, 2013.'
      : 'The company has fewer than 10 employees, so an Internal Complaints Committee is not required under the POSH Act, 2013.';
    // Always optional: a blank answer means "use the statement built from the employee count". Asked once only;
    // while the counts are unknown the EMP_* items stay missing, so the next build computes the default.
    const poshAns = has('POSH_STATEMENT') ? String(answers.POSH_STATEMENT).trim() : '';
    if (poshAns) values.POSH_STATEMENT = poshAns;
    else if (poshDefault) values.POSH_STATEMENT = poshDefault;
    if (!has('POSH_STATEMENT')) missing.push({ key: 'POSH_STATEMENT', label: 'POSH Act statement', type: 'textarea', default: poshDefault, optional: true,
      hint: 'Leave empty to use the statement built from the employee count.' });
    values.POSH_RECEIVED = '0'; values.POSH_DISPOSED = '0'; values.POSH_PENDING90 = '0';
    // Maternity Benefit Act applies to establishments with 10 or more employees (s.2(1)(b)); no claim while counts are unknown.
    if (headcount !== null) values.MATERNITY = emp.EMP_FEMALE === 0
      ? 'Not applicable, as the company has no women employees.'
      : headcount < 10 ? 'Not applicable, as the company has fewer than 10 employees.'
        : 'The company has complied with the Maternity Benefit Act, 1961.';
    values.OTHER_MATTERS = '0';

    // Declaration (shared answers under formType 'aoc4' first).
    const s0 = (Array.isArray(client.signatoriesFS) && client.signatoriesFS[0]) || {};
    values.DECL_RES_NO = has('BOARD_RESOLUTION_NO') ? String(answers.BOARD_RESOLUTION_NO).trim() : '';
    if (!values.DECL_RES_NO) { delete values.DECL_RES_NO; missing.push({ key: 'BOARD_RESOLUTION_NO', label: 'Declaration — board resolution number', type: 'text' }); }
    const resDate = ddmmyyyy(answers.BOARD_RESOLUTION_DATE) || ddmmyyyy(g.BOARD_REPORT_DATE) || ddmmyyyy(g.BOARD_MEETING_DATE);
    if (resDate) values.DECL_RES_DATE = resDate;
    else missing.push({ key: 'BOARD_RESOLUTION_DATE', label: 'Declaration — board resolution date', type: 'date' });
    // This list only offers Director or Liquidator/IRP/RP.
    values.DECL_ROLE = /liquidator|irp|\brp\b|resolution/i.test(answers.DECL_DESIGNATION || '') ? 'Liquidator/IRP/RP' : 'Director';
    const d0 = String(answers.DECL_DIN || s0.din || '').trim().toUpperCase();
    const din = /^\d{7}$/.test(d0) ? d0.padStart(8, '0') : d0;
    if (/^\d{8}$/.test(din)) values.DECL_DIN = din;
    else missing.push({ key: 'DECL_DIN', label: 'Declaration — DIN of the signing director (8 digits)', type: 'text' });

    // Saved answers win for the Board's-report text boxes (e.g. the verbatim text of the signed report saved by the
    // dashboard's "Report text (verbatim)" step), over the wording built above. Numbers and radios that are
    // calculated (amounts, deposits, POSH counts, small company, s.186) are not in this list.
    const own = ['DRS', 'STATE_OF_AFFAIRS', 'RISK', 'TECH', 'ENERGY', 'FOREX', 'IFC', 'COST_RECORDS', 'IBC', 'NATURE_CHANGE',
      'MATERIAL_CHANGES', 'FRAUDS', 'RESERVES_DESC', 'DIVIDEND_DESC', 'FIN_SUMMARY', 'DIRECTOR_CHANGES', 'ID_DECL', 'S178',
      'ID_INTEGRITY', 'OTS', 'EVALUATION', 'MATERNITY', 'ORDERS'];
    for (const k of own) {
      if (!has(k) || !String(answers[k]).trim()) continue;
      values[k] = String(answers[k]).trim();
      for (let i = missing.length - 1; i >= 0; i--) if (missing[i].key === k) missing.splice(i, 1);
    }

    return { values, missing, notes };
  }

  // ── jobs ───────────────────────────────────────────────────────────────────
  const filled = v => v !== null && v !== undefined && String(v) !== '';
  function jobs(values) {
    values = values || {};
    const out = [];
    // index k = k-th visible instance of the row; ids get the 1-based row number.
    const add = (key, kind, value, k) => {
      if (filled(value)) out.push({ id: 'EB_' + key + (k === undefined ? '' : '_' + (k + 1)), kind, selector: SEL[key], index: k || 0, value: String(value) });
    };
    add('WEBSITE', 'text', values.WEBSITE);
    add('SMALL_CO', 'radio', values.SMALL_CO);
    add('BM_COUNT', 'number', values.BM_COUNT);
    (values.MEETINGS || []).forEach((m, k) => {
      add('BM_DATE', 'date', m.date, k);
      add('BM_TOTAL', 'number', m.total, k);
      add('BM_ATTENDED', 'number', m.attended, k);
      add('BM_PCT', 'number', m.pct ?? pct(m.attended, m.total), k);   // pageFill skips it if MCA computes it (read-only)
    });
    for (const [key, kind] of ORDER) add(key, kind, values[key]);
    return out;
  }

  // ── page function (MCA tab, world MAIN; self-contained) ───────────────────
  // Sets the board-meeting count, then adds row instances via AEM's instanceManager until n rows exist.
  // Never clicks anything. Returns { ok, rows, added, via }.
  async function pageEboardEnsureRows(n, waitMs = 15000) {
    const pause = ms => new Promise(r => setTimeout(r, ms));
    const ROW = 'table_47856561_copy_-Row1642490503674';
    const countSel = '[name$="-panel_892374834-guidetextbox___jqName"]';
    const cellSel = `[name*="${ROW}"][name$="-tableItem1642490503676___jqName"]`;
    const shown = el => el.getClientRects().length > 0;
    const rows = () => { const all = [...document.querySelectorAll(cellSel)]; const vis = all.filter(shown); return (vis.length ? vis : all).length; };
    n = Math.max(0, Math.min(99, Number(n) || 0));
    if (!n) return { ok: true, rows: rows(), added: 0, via: 'none' };
    const gb = window.guideBridge;
    // 1. Count field: DOM value + AEM model, so MCA's own rule can create the rows.
    const box = [...document.querySelectorAll(countSel)].find(shown) || document.querySelector(countSel);
    if (box && String(box.value).trim() !== String(n) && !box.readOnly && !box.disabled) {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      d.set.call(box, String(n));
      for (const t of ['input', 'change']) box.dispatchEvent(new Event(t, { bubbles: true }));
      box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      try {
        const id = (box.id || '').replace(/_widget$/, '');
        if (gb && gb.visit) gb.visit(c => { if (c && c.id === id) c.value = String(n); });
      } catch (_) { }
      for (let w = 0; w < 10 && rows() < n; w++) await pause(300);
    }
    if (rows() >= n) return { ok: true, rows: rows(), added: 0, via: 'count' };
    // 2. Add instances through the row's instanceManager.
    let im = null;
    try { if (gb && gb.visit) gb.visit(c => { if (!im && c && c.id && c.id.indexOf(ROW) >= 0 && c.instanceManager) im = c.instanceManager; }); } catch (_) { }
    if (!im || typeof im.addInstance !== 'function') return { ok: false, rows: rows(), added: 0, via: 'none', reason: 'row instanceManager not found' };
    let added = 0;
    const t0 = Date.now();
    while (rows() < n && Date.now() - t0 < waitMs) {
      const have = typeof im.instanceCount === 'number' ? im.instanceCount : rows();
      if (have < n) { try { im.addInstance(); added++; } catch (e) { return { ok: false, rows: rows(), added, via: 'instanceManager', reason: e.message }; } }
      await pause(250);
    }
    const got = rows();
    return { ok: got >= n, rows: got, added, via: 'instanceManager', reason: got >= n ? undefined : 'rows did not appear in time' };
  }

  const FORM = {
    id: 'eboard',
    label: "Board's report",
    urlRe: /form-extract-of-boards-report/i,
    answersForm: 'eboard',
    extraAnswers: ['aoc2'],                 // AOC-2 ROWS gives the s.188 count default
    nextButton: null,                       // the page's next button is Submit — forbidden
    buildData,
    jobs,
    pre: [{ label: 'Board meeting rows', func: pageEboardEnsureRows, args: v => [((v && v.MEETINGS) || []).length] }],
    SEL,
    helpers: { parseMeetings, fmtINR, smallCompany, s186, ddmmyyyy, pageEboardEnsureRows },
  };
  root.LINKED_FORMS = root.LINKED_FORMS || {}; root.LINKED_FORMS[FORM.id] = FORM;
  if (typeof module !== 'undefined') module.exports = FORM;
})(typeof window !== 'undefined' ? window : globalThis);
