import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { api, useJob, formatAmount, useScrollTarget, useStickyState } from '../../api';
import JobHeader from '../../components/JobHeader';
import OutOfDateBanner from '../../components/OutOfDateBanner';
import { Blocked, Card, StatusChip, btnPrimary, btnSecondary, btnSmall, inputClass } from '../../components/ui';
import AcceptAsTally from '../../components/AcceptAsTally';
import { journalRoute, fallbackSentence } from '../../mappingLogic';

const AUTO_ROUTES = [
  { slot: 'sales', name: 'Sales vouchers', dest: 'Invoices', built: true },
  { slot: 'purchase', name: 'Purchase vouchers', dest: 'Bills', built: true },
  // By default (Voucher files: Manual Journals) every receipt, payment and note is a Manual Journal, the customer or
  // vendor named on Accounts Receivable or Payable. Only when Payments files are chosen there do some wait for a sample.
  { slot: 'receipt', name: 'Receipt vouchers', dest: 'Manual Journals (from customers: on Accounts Receivable with the customer named)', built: true },
  { slot: 'payment', name: 'Payment vouchers', dest: 'Manual Journals (to vendors: on Accounts Payable with the vendor named)', built: true },
  { slot: 'contra', name: 'Contra vouchers', dest: 'Manual Journals (bank and cash transfers)', built: true },
  { slot: 'debit_note', name: 'Debit notes', dest: 'Manual Journals (the party on Accounts Payable or Receivable)', built: true },
  { slot: 'credit_note', name: 'Credit notes', dest: 'Manual Journals (the party on Accounts Receivable or Payable)', built: true },
  { slot: 'other_vouchers', name: 'Other voucher types', dest: 'No Zoho file yet', built: false },
];
const DESTINATIONS = ['Invoice', 'Bill', 'Manual Journal'];
const DEFAULT_FILTERS = { state: 'undecided', review: '', suggestion: '', decision: '', party: '', ledger: '', pattern: '', q: '', min: '', max: '', from: '', to: '', sort: 'date', dir: 'asc', pageSize: '50' };
const FILTER_KEY = 'journalReviewFilters';
const loadFilters = () => { try { return { ...DEFAULT_FILTERS, ...JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}') }; } catch { return DEFAULT_FILTERS; } };
const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-IN')} ${n === 1 ? one : many}`;
const isTyping = el => el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
const labelCls = 'block text-[13px] font-medium text-muted mb-1';
const smallInput = `${inputClass} !min-h-10 !text-[14px]`;

// Review tag of a journal, in words.
const reviewTag = j => (j.notPosted ? null : j.clear === false ? 'No clear pattern' : j.needsCheck ? 'Would carry a negative row' : null);

export default function Screen20_TransactionClassification({ onNavigate, user }) {
  useScrollTarget();
  const readOnly = user?.role === 'viewer';
  const { job, loading, error, reload } = useJob();
  const [counts, setCounts] = useState({});
  const [filters, setFilters] = useState(loadFilters);
  const [draft, setDraft] = useState(() => { const f = loadFilters(); return { q: f.q, min: f.min, max: f.max }; });
  const [page, setPage] = useStickyState('journal-review:page', 1); // kept after a decision, a reload or a visit elsewhere
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [focus, setFocus] = useState(0);
  const [plan, setPlan] = useState(null);     // the preview of a decision for many journals, waiting for confirmation
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const rowRefs = useRef([]);
  const searchRef = useRef(null);
  const processed = job && ['processed', 'generated'].includes(job.status);

  useEffect(() => { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch { /* ignore */ } }, [filters]);
  const query = useMemo(() => {
    const q = Object.fromEntries(Object.entries(filters).filter(([k, v]) => v !== '' && !(k === 'state' && v === 'all')));
    return new URLSearchParams({ ...q, page: String(page) }).toString();
  }, [filters, page]);

  const load = useCallback(async () => {
    if (!job || !processed) return;
    try {
      const [r, s] = await Promise.all([api.get(`/migrations/${job.id}/journals/review?${query}`), api.get(`/migrations/${job.id}/summary`)]);
      setData(r);
      setCounts(Object.fromEntries(s.bySlot.map(x => [x.slot, x.n])));
      setActionError('');
    } catch (e) { setActionError(e.message); }
  }, [job, processed, query]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setFocus(f => Math.min(f, Math.max(0, (data?.items.length || 1) - 1))); }, [data]);
  // a kept page beyond the last one (fewer journals now) is shown as the last page
  useEffect(() => { if (data && page > data.pages) setPage(data.pages); }, [data]); // only when a new answer arrives

  // filters typed in a box are applied a moment after typing stops
  useEffect(() => {
    const t = setTimeout(() => {
      if (draft.q !== filters.q || draft.min !== filters.min || draft.max !== filters.max) { setFilters(f => ({ ...f, ...draft })); setPage(1); }
    }, 400);
    return () => clearTimeout(t);
  }, [draft, filters.q, filters.min, filters.max]);
  const setFilter = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1); };
  const clearFilters = () => { setFilters(DEFAULT_FILTERS); setDraft({ q: '', min: '', max: '' }); setPage(1); };

  const after = async (fn, message) => {
    setActionError(''); setNotice('');
    try { await fn(); if (message) setNotice(message); await reload(); } catch (e) { setActionError(e.message); await load(); }
  };
  const choose = (j, decision) => after(() => api.put(`/migrations/${job.id}/journals/${j.id}`, { decision }));
  // back to the tool's default (audited on the server)
  const clearDecision = j => after(async () => {
    const r = await api.del(`/migrations/${job.id}/journals/${j.id}`);
    setNotice(`Decision on ${j.number} cleared: the default (${r.defaultDecision || 'Manual Journal'}) is used again.`);
  });
  const acceptGroup = group => after(async () => {
    const r = await api.post(`/migrations/${job.id}/journals/accept-suggestions`, { group });
    setNotice(`${plural(r.accepted, 'suggestion')} accepted.`);
  });

  // ----- decisions for many journals: preview first, then confirm with the count -----
  const preview = async (kind, decision, extra = {}) => {
    setActionError(''); setNotice(''); setBusy(true);
    try {
      const body = kind === 'bulk' ? { ids: [...selected], decision, preview: true } : { recordId: extra.recordId, decision, includeDecided: !!extra.includeDecided, preview: true };
      const r = await api.post(`/migrations/${job.id}/journals/${kind}`, body);
      setPlan({ kind, body, ...r, journal: extra.journal || null });
    } catch (e) { setActionError(e.message); } finally { setBusy(false); }
  };
  const confirmPlan = async () => {
    setBusy(true); setActionError('');
    try {
      const r = await api.post(`/migrations/${job.id}/journals/${plan.kind}`, { ...plan.body, preview: false, confirmCount: plan.counts.change });
      setNotice(`${plural(r.changed, 'journal voucher')} routed to ${r.decision}. Each one is recorded in the audit log.`);
      setPlan(null);
      if (plan.kind === 'bulk') setSelected(new Set());
      await reload();
    } catch (e) {
      // the numbers changed since the preview: show the new preview
      if (e.status === 409 && e.data?.counts) setPlan(p => ({ ...p, ...e.data }));
      setActionError(e.message);
    } finally { setBusy(false); }
  };

  const items = data?.items || [];
  const toggle = id => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pageIds = items.filter(j => !j.notPosted).map(j => j.id);
  const allOnPage = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const togglePage = () => setSelected(s => { const n = new Set(s); if (allOnPage) pageIds.forEach(id => n.delete(id)); else pageIds.forEach(id => n.add(id)); return n; });

  // ----- keyboard -----
  useEffect(() => {
    if (!processed) return undefined;
    const onKey = e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { if (plan) setPlan(null); else if (isTyping(document.activeElement)) document.activeElement.blur(); return; }
      if (isTyping(document.activeElement) || plan) return;
      // The decision keys and the arrow keys act only while a journal row (or something inside it) has the focus, so a
      // key pressed elsewhere on the page never routes a journal, and the arrow keys still scroll the page.
      const row = rowRefs.current.findIndex(r => r && (r === document.activeElement || r.contains(document.activeElement)));
      const onRow = row >= 0;
      const j = onRow ? items[row] : null;
      const at = onRow ? row : focus;
      const move = d => { e.preventDefault(); const n = onRow ? Math.max(0, Math.min(items.length - 1, at + d)) : Math.min(focus, items.length - 1); setFocus(n); rowRefs.current[n]?.focus(); };
      if (e.key === 'j' || (onRow && e.key === 'ArrowDown')) move(1);
      else if (e.key === 'k' || (onRow && e.key === 'ArrowUp')) move(-1);
      else if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === ']' && data && page < data.pages) setPage(page + 1);
      else if (e.key === '[' && page > 1) setPage(page - 1);
      else if (!j || j.notPosted || readOnly) return;
      else if (e.key === 'x' || (e.key === ' ' && document.activeElement === rowRefs.current[row])) { e.preventDefault(); toggle(j.id); }
      else if (['1', '2', '3'].includes(e.key)) { e.preventDefault(); choose(j, DESTINATIONS[Number(e.key) - 1]); }
      else if (e.key === 'a') { e.preventDefault(); choose(j, j.suggested); }
      else if (e.key === 'p') { e.preventDefault(); preview('pattern', j.decision || j.defaultDecision || j.suggested, { recordId: j.id, journal: j }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const c = data?.counts;
  const openClear = c?.undecidedByReview.clear || 0, openNeedsCheck = c?.undecidedByReview.needsCheck || 0, openNotClear = c?.undecidedByReview.notClear || 0;
  const filtersOn = Object.entries(filters).some(([k, v]) => !['sort', 'dir', 'pageSize'].includes(k) && v !== DEFAULT_FILTERS[k]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <JobHeader
        title="Voucher Classification"
        subtitle="Most vouchers go to their Zoho module automatically. Every journal voucher has a default; change only the ones you want written another way."
        job={job} loading={loading} error={error || actionError} onNavigate={onNavigate}
        action={
          <button type="button" onClick={() => onNavigate('screen-25')} className={`${btnPrimary} self-start`}>
            <span>Continue to Export Center</span><ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        }
      />

      <OutOfDateBanner job={job} user={user} onDone={reload} onNavigate={onNavigate} />

      {job && !processed && (
        <Blocked title="Data has not been processed yet" text="Upload the Tally files and run processing first." button="Open Completeness Check" onClick={() => onNavigate('screen-16')} />
      )}

      {job && processed && (
        <>
          <details className="border border-line rounded-lg bg-white shadow-xs">
            <summary className="cursor-pointer list-none p-4 flex items-center justify-between gap-3">
              <span>
                <span className="block text-[16px] font-semibold text-ink">Routed automatically</span>
                <span className="block text-[14px] text-muted">Sales, purchase and other vouchers have only one correct destination, so no action is needed.</span>
              </span>
              <span className="text-[13px] text-muted shrink-0">Show list</span>
            </summary>
            <div className="divide-y divide-soft border-t border-line">
              {AUTO_ROUTES.filter(r => r.built || ['receipt', 'payment'].includes(r.slot) || counts[r.slot]).map(r => (
                <div key={r.slot} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-[14px]">
                  <span className="text-ink font-medium w-48">{r.name}</span>
                  <span className="text-muted tabular-nums w-28">{(counts[r.slot] || 0).toLocaleString('en-IN')} vouchers</span>
                  <span className="flex items-center gap-2 text-muted flex-1 min-w-48"><ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {r.dest}</span>
                  {r.built ? <StatusChip tone="success" dot>Routed</StatusChip>
                    : r.part ? <span className="text-muted">Routed; some wait for a Zoho sample (see Export Center)</span>
                    : <span className="text-muted">Read and kept; no Zoho file yet</span>}
                </div>
              ))}
            </div>
          </details>

          <div id="journal-review" tabIndex={-1} className="scroll-mt-4 focus:outline-none space-y-4">
            <Card
              title="Journal vouchers"
              subtitle="In Tally a sale or purchase is sometimes entered as a journal. Each journal is written by the tool's default (the clear suggestion, else a Manual Journal) unless you choose another destination. Your choice always wins and is recorded in the audit log with your name."
              right={c && (
                <div className="sm:text-right shrink-0 text-[14px]">
                  <div className="text-ink font-semibold tabular-nums">{(c.onDefault ?? c.undecided).toLocaleString('en-IN')} use the default, {(c.byPerson ?? c.decided).toLocaleString('en-IN')} decided by you</div>
                  {c.onDefaultAs && (c.onDefault ?? c.undecided) > 0 && (
                    <div className="text-[13px] text-muted">Default: {DESTINATIONS.filter(d => c.onDefaultAs[d]).map(d => `${c.onDefaultAs[d].toLocaleString('en-IN')} ${d}`).join(', ')}.</div>
                  )}
                  {c.notPosted > 0 && <div className="text-[13px] text-muted">{plural(c.notPosted, 'more is', 'more are')} cancelled, optional or deleted in Tally: never written, no decision needed.</div>}
                  {job && <div className="mt-2"><AcceptAsTally jobId={job.id} stepKey="journal_routing" readOnly={readOnly} /></div>}
                </div>
              )}
            >
              {c && !readOnly && (openClear > 0 || openNeedsCheck > 0) && (
                <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-3 text-[14px]">
                  {openClear > 0 && <button type="button" onClick={() => acceptGroup('clear')} className={`${btnSecondary} ${btnSmall}`}>Make the {plural(openClear, 'clear suggestion')} your decision</button>}
                  {openNeedsCheck > 0 && (
                    <button type="button" className={`${btnSecondary} ${btnSmall}`}
                      onClick={() => { if (window.confirm(`${plural(openNeedsCheck, 'suggested bill or invoice carries', 'suggested bills or invoices carry')} a negative row (for example tax deducted at source, a discount or a round-off). Each reason says so. Accept ${openNeedsCheck === 1 ? 'it' : 'them all'} as suggested?`)) acceptGroup('needs_check'); }}>
                      Accept the {plural(openNeedsCheck, 'suggestion')} with a negative row
                    </button>
                  )}
                  {openNotClear > 0 && <span className="text-muted">{plural(openNotClear, 'journal')} with no clear pattern {openNotClear === 1 ? 'is a' : 'are'} Manual Journal{openNotClear === 1 ? '' : 's'} by default. Filter by "No clear pattern" to change them, alone or by pattern.</span>}
                </div>
              )}

              {/* ----- filters ----- */}
              <div className="p-4 border-b border-line space-y-3" role="search" aria-label="Filter journal vouchers">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Which journals">
                  {[['undecided', 'On the default', c?.onDefault ?? c?.undecided], ['decided', 'Decided by you', c?.byPerson ?? c?.decided], ['all', 'All', c?.all], ['not_posted', 'Cancelled or optional', c?.notPosted]].map(([v, l, n]) => (
                    <button key={v} type="button" aria-pressed={filters.state === v} onClick={() => setFilter('state', v)}
                      className={`min-h-9 px-3.5 rounded-md border text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${filters.state === v ? 'bg-action text-white border-action' : 'bg-white text-ink border-line-strong hover:bg-soft'}`}>
                      {l}{n != null && <span className="tabular-nums"> ({n.toLocaleString('en-IN')})</span>}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="lg:col-span-2">
                    <label htmlFor="jr-q" className={labelCls}>Search number, narration or ledger (press / to jump here)</label>
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-3 text-muted" aria-hidden="true" />
                      <input id="jr-q" ref={searchRef} value={draft.q} onChange={e => setDraft(d => ({ ...d, q: e.target.value }))} className={`${smallInput} pl-9`} placeholder="For example rent" />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="jr-review" className={labelCls}>Needs a look</label>
                    <select id="jr-review" value={filters.review} onChange={e => setFilter('review', e.target.value)} className={smallInput}>
                      <option value="">Any</option>
                      <option value="clear">Clear suggestion ({c?.clear ?? 0})</option>
                      <option value="needs_check">Would carry a negative row ({c?.needsCheck ?? 0})</option>
                      <option value="not_clear">No clear pattern ({c?.notClear ?? 0})</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="jr-sugg" className={labelCls}>Suggested as</label>
                    <select id="jr-sugg" value={filters.suggestion} onChange={e => setFilter('suggestion', e.target.value)} className={smallInput}>
                      <option value="">Any</option>
                      {DESTINATIONS.map(d => <option key={d} value={d}>{d} ({c?.bySuggestion[d] ?? 0})</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="jr-dec" className={labelCls}>Decided as</label>
                    <select id="jr-dec" value={filters.decision} onChange={e => setFilter('decision', e.target.value)} className={smallInput}>
                      <option value="">Any</option>
                      {DESTINATIONS.map(d => <option key={d} value={d}>{d} ({c?.byDecision[d] ?? 0})</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="jr-party" className={labelCls}>Customer or vendor on it</label>
                    <select id="jr-party" value={filters.party} onChange={e => setFilter('party', e.target.value)} className={smallInput}>
                      <option value="">Any</option>
                      <option value="vendor">A vendor ({c?.byParty.vendor ?? 0})</option>
                      <option value="customer">A customer ({c?.byParty.customer ?? 0})</option>
                      <option value="both">Both ({c?.byParty.both ?? 0})</option>
                      <option value="none">Neither ({c?.byParty.none ?? 0})</option>
                    </select>
                  </div>
                  <div className="lg:col-span-2">
                    <label htmlFor="jr-ledger" className={labelCls}>Ledger used</label>
                    <select id="jr-ledger" value={filters.ledger} onChange={e => setFilter('ledger', e.target.value)} className={smallInput}>
                      <option value="">Any ledger</option>
                      {(data?.ledgers || []).map(l => <option key={l.ledger} value={l.ledger}>{l.name} ({l.journals})</option>)}
                    </select>
                  </div>
                  <div className="lg:col-span-2">
                    <label htmlFor="jr-pattern" className={labelCls}>Pattern (Tally groups debited and credited)</label>
                    <select id="jr-pattern" value={filters.pattern} onChange={e => setFilter('pattern', e.target.value)} className={smallInput}>
                      <option value="">Any pattern</option>
                      {(data?.patterns || []).map(p => <option key={p.key} value={p.key}>{p.words} ({p.undecided} of {p.journals} on the default)</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="jr-min" className={labelCls}>Amount from</label>
                    <input id="jr-min" inputMode="decimal" value={draft.min} onChange={e => setDraft(d => ({ ...d, min: e.target.value }))} className={smallInput} placeholder="0" />
                  </div>
                  <div>
                    <label htmlFor="jr-max" className={labelCls}>Amount up to</label>
                    <input id="jr-max" inputMode="decimal" value={draft.max} onChange={e => setDraft(d => ({ ...d, max: e.target.value }))} className={smallInput} placeholder="Any" />
                  </div>
                  <div>
                    <label htmlFor="jr-from" className={labelCls}>Date from</label>
                    <input id="jr-from" type="date" value={filters.from} onChange={e => setFilter('from', e.target.value)} className={smallInput} />
                  </div>
                  <div>
                    <label htmlFor="jr-to" className={labelCls}>Date up to</label>
                    <input id="jr-to" type="date" value={filters.to} onChange={e => setFilter('to', e.target.value)} className={smallInput} />
                  </div>
                  <div>
                    <label htmlFor="jr-sort" className={labelCls}>Sort by</label>
                    <select id="jr-sort" value={`${filters.sort}:${filters.dir}`} onChange={e => { const [s, d] = e.target.value.split(':'); setFilters(f => ({ ...f, sort: s, dir: d })); setPage(1); }} className={smallInput}>
                      <option value="date:asc">Date, oldest first</option>
                      <option value="date:desc">Date, newest first</option>
                      <option value="amount:desc">Amount, largest first</option>
                      <option value="amount:asc">Amount, smallest first</option>
                      <option value="number:asc">Voucher number</option>
                      <option value="suggestion:asc">Suggestion</option>
                      <option value="decision:asc">Decision</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    {filtersOn && <button type="button" onClick={clearFilters} className={`${btnSecondary} w-full`}><X className="w-4 h-4" aria-hidden="true" /> Clear the filters</button>}
                  </div>
                </div>
                <p className="text-[13px] text-muted">
                  Keys (click a journal first; they act only on the journal that has the focus): j / k or the arrow keys move between journals, x selects, 1 Invoice, 2 Bill, 3 Manual Journal, a accepts the suggestion,
                  p applies a decision to every journal with the same pattern, [ and ] change the page, Esc closes a confirmation.
                </p>
              </div>

              {/* ----- selection and the confirmation ----- */}
              {!readOnly && (selected.size > 0 || (data && data.total > 0)) && (
                <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2 text-[14px] bg-soft">
                  <span className="font-semibold text-ink mr-1">{selected.size ? `${plural(selected.size, 'journal')} selected` : 'Nothing selected'}</span>
                  {data && data.matchingIds.length > 0 && data.matchingIds.some(id => !selected.has(id)) && (
                    <button type="button" className="font-medium text-info-ink hover:underline" onClick={() => setSelected(s => new Set([...s, ...data.matchingIds]))}>Select all {data.matchingIds.length.toLocaleString('en-IN')} that match the filters</button>
                  )}
                  {selected.size > 0 && (
                    <>
                      <span className="text-muted ml-2">Route the selected to:</span>
                      {DESTINATIONS.map(d => <button key={d} type="button" disabled={busy} onClick={() => preview('bulk', d)} className={`${btnSecondary} ${btnSmall}`}>{d}</button>)}
                      <button type="button" className="text-muted hover:underline ml-1" onClick={() => setSelected(new Set())}>Clear the selection</button>
                    </>
                  )}
                </div>
              )}
              {notice && <div role="status" className="px-4 py-3 border-b border-success-line bg-success-soft text-[14px] text-success-ink flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" /> {notice}</div>}
              {plan && <PlanPanel plan={plan} busy={busy} onConfirm={confirmPlan} onCancel={() => setPlan(null)}
                onChange={(decision, includeDecided) => preview(plan.kind, decision, { recordId: plan.body.recordId, includeDecided, journal: plan.journal })} />}

              {/* ----- the list ----- */}
              {data && data.total === 0 && (
                <div className="p-6 text-[14px] text-muted">
                  {c?.all === 0 ? 'No journal vouchers were uploaded.' : filters.state === 'undecided' && !filtersOn ? 'No journal is on the default: every one was decided by a person.' : 'No journal voucher matches these filters.'}
                </div>
              )}
              {data && data.total > 0 && (
                <div className="px-4 py-2 border-b border-line flex flex-wrap items-center gap-3 text-[14px] text-muted">
                  {!readOnly && (
                    <label className="inline-flex items-center gap-2 text-ink">
                      <input type="checkbox" className="w-4 h-4 accent-action" checked={allOnPage} onChange={togglePage} /> Select this page
                    </label>
                  )}
                  <span>{plural(data.total, 'journal')} match{data.total === 1 ? 'es' : ''}</span>
                </div>
              )}
              <ul className="divide-y divide-line" aria-label="Journal vouchers">
                {items.map((j, i) => (
                  <JournalRow key={j.id} j={j} focused={i === focus} readOnly={readOnly} selected={selected.has(j.id)}
                    rowRef={el => { rowRefs.current[i] = el; }} onFocus={() => setFocus(i)}
                    onToggle={() => toggle(j.id)} onChoose={d => choose(j, d)} onClear={() => clearDecision(j)}
                    onPattern={() => preview('pattern', j.decision || j.defaultDecision || j.suggested, { recordId: j.id, journal: j })} />
                ))}
              </ul>

              {data && data.pages > 1 && (
                <nav aria-label="Pages" className="px-4 py-3 border-t border-line flex flex-wrap items-center justify-between gap-3 text-[14px]">
                  <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className={btnSecondary}><ChevronLeft className="w-4 h-4" aria-hidden="true" /> Previous</button>
                  <span className="text-muted tabular-nums">Page {data.page} of {data.pages}</span>
                  <label className="inline-flex items-center gap-2 text-muted">Per page
                    <select value={filters.pageSize} onChange={e => setFilter('pageSize', e.target.value)} className={`${smallInput} !w-24`}>
                      {['25', '50', '100', '200'].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <button type="button" disabled={page >= data.pages} onClick={() => setPage(page + 1)} className={btnSecondary}>Next <ChevronRight className="w-4 h-4" aria-hidden="true" /></button>
                </nav>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function JournalRow({ j, focused, readOnly, selected, rowRef, onFocus, onToggle, onChoose, onPattern, onClear }) {
  const tag = reviewTag(j);
  const route = journalRoute(j);
  return (
    <li ref={rowRef} tabIndex={0} onFocus={onFocus} aria-label={`Journal ${j.number}, ${j.decision ? `decided as ${j.decision}` : `default: ${route.to}`}`}
      className={`p-4 flex flex-col gap-3 focus:outline-none ${focused ? 'bg-soft ring-2 ring-inset ring-brand' : ''}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        {!readOnly && !j.notPosted && (
          <input type="checkbox" checked={selected} onChange={onToggle} className="w-4 h-4 mt-1 accent-action" aria-label={`Select journal ${j.number}`} />
        )}
        <span className="font-mono font-semibold text-ink text-[14px]">{j.number}</span>
        <span className="text-[14px] text-muted">{j.date}</span>
        <span className="text-[14px] text-ink tabular-nums">{formatAmount(j.total)}</span>
        {j.narration && <span className="text-[14px] text-muted min-w-0 break-words">{j.narration}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[14px]">
          <thead className="text-[12px] uppercase tracking-wide text-muted">
            <tr><th scope="col" className="py-1 pr-3 font-medium">Ledger</th><th scope="col" className="py-1 pr-3 font-medium">Tally group</th><th scope="col" className="py-1 pr-3 font-medium text-right">Debit</th><th scope="col" className="py-1 font-medium text-right">Credit</th></tr>
          </thead>
          <tbody>
            {j.lines.map((l, i) => (
              <tr key={i} className="border-t border-soft">
                <td className="py-1 pr-3 text-ink">
                  {l.name}
                  {l.written && l.written !== l.name && <span className="block text-[13px] text-muted">Written in Zoho as {l.written}</span>}
                  {l.name !== l.ledger && <span className="block text-[13px] text-muted">Hidden characters in Tally's name are not shown</span>}
                </td>
                <td className="py-1 pr-3 text-muted">{l.group || 'Not in the masters'}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{l.debit ? formatAmount(l.debit) : ''}</td>
                <td className="py-1 text-right tabular-nums">{l.credit ? formatAmount(l.credit) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {j.notPosted
        ? <div className="text-[14px] text-muted"><StatusChip tone="neutral">Not posted</StatusChip> {j.notPostedReason} Not written to any file, so no decision is needed.</div>
        : (
          <div className="text-[14px] text-muted">
            <span className="text-ink">Suggested: <strong>{j.suggested}</strong>.</span> {j.reason}
            {tag && <span className="ml-2 align-middle"><StatusChip tone="warning" dot>{tag}</StatusChip></span>}
          </div>
        )}
      {!j.balanced && !j.notPosted && (
        <div className="flex items-start gap-2 text-[14px] text-danger-ink">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /><span>{j.problem}. This voucher will be left out of the output file whatever you decide.</span>
        </div>
      )}

      {!j.notPosted && (
        <div className="flex flex-wrap items-center gap-3">
          {readOnly
            ? <span className="text-[14px] text-ink">{route.how === 'person' ? `Decided: ${route.to}` : `Default: ${route.to}`}</span>
            : (
              <div className="inline-flex rounded-md border border-line-strong overflow-hidden" role="group" aria-label={`Destination for ${j.number}`}>
                {DESTINATIONS.map((d, i) => {
                  const on = route.to === d;
                  // a person's decision: solid black; the default in use: dashed outline and the word "default"
                  const look = on && route.how === 'person' ? 'bg-action text-white'
                    : on ? 'bg-soft text-ink outline-2 outline-dashed -outline-offset-4 outline-action' : 'bg-white text-ink hover:bg-soft';
                  return (
                    <button key={d} type="button" onClick={() => onChoose(d)} aria-pressed={on} disabled={!!j.refused?.[d]}
                      title={j.refused?.[d] ? `Not possible: ${j.refused[d]}` : on && route.how === 'default' ? `The default. Click to make it your decision (key ${i + 1})` : `Key ${i + 1}`}
                      className={`min-h-9 px-4 text-[13px] font-medium border-r border-line-strong last:border-r-0 disabled:opacity-40 disabled:cursor-not-allowed ${look}`}>
                      {d}{on && route.how === 'default' && <span className="ml-1.5 text-[12px] font-normal">(default)</span>}
                    </button>
                  );
                })}
              </div>
            )}
          {!readOnly && j.decision && <button type="button" onClick={onClear} className="text-[13px] font-medium text-info-ink hover:underline">Clear decision</button>}
          {!readOnly && <button type="button" onClick={onPattern} className="text-[13px] font-medium text-info-ink hover:underline">Same decision for this pattern…</button>}
          {j.decision && <span className="text-[13px] text-muted">Your choice{j.decidedBy ? ` (${j.decidedBy})` : ''}{j.defaultDecision && j.defaultDecision !== j.decision ? `; default would be ${j.defaultDecision}` : ''}</span>}
          {!j.decision && j.defaultWords && <span className="text-[13px] text-muted">{j.defaultWords}</span>}
        </div>
      )}
      {!j.notPosted && fallbackSentence(j) && (
        <div className="flex items-start gap-2 text-[14px] text-warning-ink"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /><span>{fallbackSentence(j)}</span></div>
      )}
      {!j.notPosted && Object.keys(j.notParty || {}).length > 0 && (
        <div className="text-[13px] text-muted">{Object.values(j.notParty).join(' ')}</div>
      )}
      {!j.notPosted && Object.keys(j.refused || {}).length > 0 && (
        <div className="text-[13px] text-muted">{Object.entries(j.refused).map(([d, why]) => `Cannot be ${d === 'Invoice' ? 'an invoice' : 'a bill'}: ${why}`).join(' ')}</div>
      )}
    </li>
  );
}

// The preview of a decision for many journals: what would change, what is refused, and a confirmation with the count.
function PlanPanel({ plan, busy, onConfirm, onCancel, onChange }) {
  const confirmRef = useRef(null);
  useEffect(() => { confirmRef.current?.focus(); }, [plan]);
  const c = plan.counts;
  return (
    <section role="dialog" aria-label="Confirm the decision" className="m-4 p-4 rounded-lg border-2 border-action bg-white shadow-md space-y-3 text-[14px]">
      <h4 className="text-[16px] font-semibold text-ink">
        {plan.kind === 'pattern' ? `Every journal with the same pattern as ${plan.journal?.number || 'this one'}` : 'The selected journals'}
      </h4>
      {plan.pattern && <p className="text-muted">{plan.pattern.words} {plural(plan.pattern.journals, 'journal has', 'journals have')} this pattern.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Route to:</span>
        {DESTINATIONS.map(d => (
          <button key={d} type="button" aria-pressed={plan.decision === d} disabled={busy} onClick={() => onChange(d, plan.body.includeDecided)}
            className={`min-h-9 px-3.5 rounded-md border text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${plan.decision === d ? 'bg-action text-white border-action' : 'bg-white text-ink border-line-strong hover:bg-soft'}`}>{d}</button>
        ))}
      </div>
      {plan.kind === 'pattern' && (
        <label className="inline-flex items-center gap-2 text-ink">
          <input type="checkbox" className="w-4 h-4 accent-action" checked={!!plan.body.includeDecided} onChange={e => onChange(plan.decision, e.target.checked)} />
          Also change journals of this pattern that already have another decision{!plan.body.includeDecided && c.keptOtherDecision ? ` (${c.keptOtherDecision})` : ''}
        </label>
      )}
      <p className="text-ink">{plan.words}</p>
      {plan.refused.length > 0 && (
        <details><summary className="cursor-pointer font-medium text-info-ink">Why {plural(c.refused, 'journal')} cannot go to {plan.decision}</summary>
          <ul className="mt-2 list-disc pl-5 text-muted space-y-1">{plan.refused.map(r => <li key={r.id}><span className="font-mono">{r.number}</span>: {r.reason}</li>)}</ul>
        </details>
      )}
      {plan.leftOutAnyway.length > 0 && (
        <details><summary className="cursor-pointer font-medium text-info-ink">Why {plural(c.leftOutAnyway, 'journal')} will still be left out of the file</summary>
          <ul className="mt-2 list-disc pl-5 text-muted space-y-1">{plan.leftOutAnyway.map(r => <li key={r.id}><span className="font-mono">{r.number}</span>: {r.reason}</li>)}</ul>
        </details>
      )}
      {plan.notParty?.length > 0 && (
        <details><summary className="cursor-pointer font-medium text-info-ink">Why {plural(c.notParty, 'journal')} would be made out to the wrong kind of ledger</summary>
          <ul className="mt-2 list-disc pl-5 text-muted space-y-1">{plan.notParty.map(r => <li key={r.id}><span className="font-mono">{r.number}</span>: {r.reason}</li>)}</ul>
        </details>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button ref={confirmRef} type="button" disabled={busy || c.change === 0} onClick={onConfirm} className={btnPrimary}>
          {c.change === 0 ? 'Nothing to change' : `Route ${plural(c.change, 'journal')} to ${plan.decision}`}
        </button>
        <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>
      </div>
    </section>
  );
}
