// Small rules of Mapping Studio and Voucher Classification. Plain JavaScript with no React, so they can be tested with
// node (frontend/test/mappingLogic.test.js).

// GST Treatment codes in words (the files keep the code). The server also sends written.gstTreatmentLabel; this map is
// the one place in the screens that turns a code into words.
export const GST_TREATMENT_WORDS = {
  business_gst: 'Registered (regular)', business_registered_regular: 'Registered (regular)', business_registered_composition: 'Registered (composition)',
  business_sez: 'SEZ', business_none: 'Unregistered', business_unregistered: 'Unregistered', consumer: 'Consumer', overseas: 'Overseas',
  deemed_export: 'Deemed export', tax_deductor: 'Tax deductor', sez_developer: 'SEZ developer',
};
export const gstTreatmentWords = code => (code ? GST_TREATMENT_WORDS[code] || code : '');

// A GST tax ledger that needs a person: the same rule as the server's taxLedgersToDecide (taxes.js), which Prepare
// migration counts, so both screens give one number. Only a ledger used as a tax row on vouchers counts.
export const taxNeedsPerson = t => !!t && (t.kind ?? 'gst') === 'gst' && !t.notGst && !t.mapped && t.source !== 'explicit' && t.source !== 'auto'
  && (t.needsPerson ?? !t.zohoTax) && (t.taxRowVouchers ?? t.vouchers ?? 0) > 0;

// A Zoho check rule about a contact (CUS-..., VEN-...) -> the Fix contacts filter that lists the contacts it is about,
// so "Fix" opens Mapping Studio at Fix contacts with that filter. '' when no filter fits.
export function contactFilterForRule(ruleId) {
  const id = String(ruleId || '');
  if (!/^(CUS|VEN)-/.test(id)) return '';
  if (/GSTIN-REQUIRED-WHEN-REGISTERED/.test(id)) return 'registered_without_gstin';
  if (/GSTIN-FORMAT/.test(id)) return 'gstin_format';
  if (/GST-TREATMENT/.test(id)) return 'treatment_other';
  if (/STATE|PLACE|SUPPLY/.test(id)) return 'state_missing';
  return '';
}

// "left out of the files (the default)" -> "Left out of the files": the option's tag already says it is the default.
export const optionWords = w => { const s = String(w || '').replace(/\s*\(the default\)/i, '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };

// The destination a journal is written to now and how: 'person' (a decision) or 'default' (the tool's default, v2).
export const journalRoute = j => (j?.decision ? { to: j.decision, how: 'person' } : { to: j?.defaultDecision || 'Manual Journal', how: 'default' });

// Why a journal is a Manual Journal by default although the suggestion was a Bill or an Invoice (the server's
// defaultFallbackWords, for example "it would have lines Zoho refuses (...)"). Only while no person decided and the
// default really is a Manual Journal; otherwise ''.
export function fallbackSentence(j) {
  if (!j || j.decision || !j.defaultFallbackWords) return '';
  if ((j.defaultDecision || 'Manual Journal') !== 'Manual Journal') return '';
  const was = j.suggested && j.suggested !== 'Manual Journal' ? `the suggested ${j.suggested}` : 'a Bill or Invoice';
  return `Manual Journal by default, not ${was}: ${String(j.defaultFallbackWords).replace(/\.\s*$/, '')}.`;
}

// "Accepted as per Tally" in words (a review of GET /reviews: { by, at, beforeReprocess }), without the time.
export function reviewWords(review) {
  if (!review) return '';
  return `Accepted as per Tally${review.by ? ` by ${review.by}` : ''}${review.beforeReprocess ? ' (accepted before the files were read again)' : ''}`;
}

// Fix contacts: the rows matching the problem list (filter) and the search (name or GSTIN), plus the rows saved since
// the list or the search last changed (pinned), so a saved row stays on screen with its Undo even when it no longer
// matches. filter: '' (all listed), 'corrected', 'filled', or a problem id.
export const contactKey = r => `${r.section}|${r.ledger}`;
export function contactRowsShown(rows, filter, search, pinned = new Set(), keyOf = contactKey) {
  const q = String(search || '').trim().toLowerCase();
  const matchFilter = r => (filter === 'corrected' ? !!r.fix
    : filter === 'filled' ? !!(r.assumptions?.length || r.pan?.source === 'gstin')
      : filter ? (r.problems || []).includes(filter) : true);
  const matchSearch = r => !q || [r.visible, r.ledger, r.written?.gstin, r.fix?.gstin, r.tally?.gstin].some(v => String(v || '').toLowerCase().includes(q));
  return (rows || []).filter(r => pinned.has(keyOf(r)) || (matchFilter(r) && matchSearch(r)));
}

// The out-of-date reasons, each said once: the same sentence recorded twice is one line, with the latest person and
// time and how many times it happened. Returns [{ reason, by, at, times }] in the order first seen.
export function uniqueReasons(list) {
  const out = new Map();
  for (const r of Array.isArray(list) ? list : []) {
    const text = String(r?.reason ?? r ?? '').trim();
    if (!text) continue;
    const had = out.get(text);
    if (had) { had.times++; if (r?.at && (!had.at || r.at > had.at)) { had.at = r.at; had.by = r.by || had.by; } } else out.set(text, { reason: text, by: r?.by || null, at: r?.at || null, times: 1 });
  }
  return [...out.values()];
}

// What happens to a TDS ledger with no Zoho TDS tax, read as prepare.js reads it: true when it is deducted on purchase or
// sales vouchers (a bill or invoice then carries a negative line Zoho may refuse); false when only journals deduct it
// (Manual Journals by default, nothing refused). taxes: GET /tax-mappings; not loaded yet (null) counts as true.
export const tdsOnDocuments = (taxes, ledger) => (!Array.isArray(taxes) ? true : taxes.some(t => t.ledger === ledger && (t.salesPurchaseVouchers || 0) > 0));
