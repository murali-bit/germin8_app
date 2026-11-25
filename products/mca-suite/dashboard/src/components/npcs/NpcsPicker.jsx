import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Search, Sparkles, X } from 'lucide-react';
import clsx from 'clsx';
import { searchNpcs, suggestNpcs } from '../../lib/api';

// NPCS 2010 service-type picker (AOC-4 Segment IV: 4-digit category + 8-digit highest-contributing product).
// value: { categoryCode, categoryDesc, productCode, productDesc }
// onChange(next): called with the whole next value.
// suggestText: business description to suggest codes from (optional).
// Picking a product sets the product AND its category; picking a category sets the category only
// (a product from another category is cleared so the pair never disagrees).

const EMPTY = { categoryCode: '', categoryDesc: '', productCode: '', productDesc: '' };

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function CodeChip({ code, level }) {
  return (
    <span className={clsx(
      'font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded-md border shrink-0',
      level === 'category' ? 'bg-gold-50 text-gold-800 border-gold-200' : 'bg-white text-ink border-line',
    )}>
      {code}
    </span>
  );
}

export default function NpcsPicker({ value, onChange, suggestText }) {
  const v = { ...EMPTY, ...(value || {}) };
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [ai, setAi] = useState(null);           // {text, reason, error} of the last Claude pick
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState(null);
  const reqId = useRef(0);

  // Manual search (code prefix or words).
  useEffect(() => {
    if (!dq) return undefined;
    const id = ++reqId.current;
    let alive = true;
    setSearching(true);
    searchNpcs(dq, 25)
      .then(r => { if (alive && id === reqId.current) { setResults(r.results || []); setSearchError(null); } })
      .catch(err => { if (alive && id === reqId.current) { setResults([]); setSearchError(err.message === 'Failed to fetch' ? 'Backend not reachable' : err.message); } })
      .finally(() => { if (alive && id === reqId.current) setSearching(false); });
    return () => { alive = false; setSearching(false); };
  }, [dq]);

  // Suggestions from the business description.
  const st = String(suggestText || '').trim();
  const dst = useDebounced(st, 400);
  useEffect(() => {
    if (!dst) return undefined;
    let alive = true;
    setSuggesting(true);
    suggestNpcs(dst, 6)
      .then(r => { if (alive) { setSuggestions(r.suggestions || []); setSuggestError(null); } })
      .catch(err => { if (alive) { setSuggestions([]); setSuggestError(err.message === 'Failed to fetch' ? 'Backend not reachable' : err.message); } })
      .finally(() => { if (alive) setSuggesting(false); });
    return () => { alive = false; setSuggesting(false); };
  }, [dst]);

  // Shown lists follow the current inputs; stale replies for an emptied box are ignored.
  const shownResults = dq ? results : [];
  const shownSearchError = dq ? searchError : null;
  const aiShown = !!(ai && ai.text);
  const shownSuggestions = dst || aiShown ? suggestions : [];
  const shownSuggestError = dst || aiShown ? suggestError : null;

  // Claude picks from the NPCS list for the business description, or for the words typed in the search box.
  const aiText = String(st || q || '').trim();
  const askAi = () => {
    if (!aiText) return;
    setSuggesting(true); setSuggestError(null);
    suggestNpcs(aiText, 6, { useAi: true })
      .then(r => { setSuggestions(r.suggestions || []); setAi({ text: aiText, reason: r.ai?.reason || '', error: r.aiError || '' }); })
      .catch(err => { setSuggestError(err.message === 'Failed to fetch' ? 'Backend not reachable' : err.message); setAi({ text: aiText, error: err.message }); })
      .finally(() => setSuggesting(false));
  };

  const pickProduct = r => onChange?.({
    categoryCode: r.category, categoryDesc: r.categoryDesc, productCode: r.code, productDesc: r.desc,
  });
  const pickCategory = r => {
    const keep = v.productCode && String(v.productCode).startsWith(r.code);
    onChange?.({
      categoryCode: r.code, categoryDesc: r.desc,
      productCode: keep ? v.productCode : '', productDesc: keep ? v.productDesc : '',
    });
  };
  const pick = r => (r.level === 'category' ? pickCategory(r) : pickProduct(r));
  const clear = () => onChange?.({ ...EMPTY });
  const hasValue = v.categoryCode || v.productCode;

  return (
    <div className="bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
      {/* Current choice */}
      <div className="px-4 py-3 border-b border-line bg-gold-50/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Service type (NPCS 2010)</p>
            {hasValue ? (
              <>
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-ink-muted w-20 shrink-0 pt-0.5">Category</span>
                  {v.categoryCode
                    ? <><CodeChip code={v.categoryCode} level="category" /><span className="text-ink">{v.categoryDesc}</span></>
                    : <span className="text-rose-700">not chosen</span>}
                </div>
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-ink-muted w-20 shrink-0 pt-0.5">Main service</span>
                  {v.productCode
                    ? <><CodeChip code={v.productCode} /><span className="text-ink">{v.productDesc}</span></>
                    : <span className="text-amber-700">not chosen — pick an 8-digit code</span>}
                </div>
              </>
            ) : (
              <p className="text-xs text-ink-muted">Nothing chosen yet. Use a suggestion or search by code or words.</p>
            )}
          </div>
          {hasValue && (
            <button type="button" onClick={clear} title="Clear" aria-label="Clear service type"
              className="p-1.5 rounded-lg border border-line bg-white text-ink-muted hover:bg-gold-50 hover:text-ink cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Suggestions */}
      {aiText && (
        <div className="px-4 pt-3 flex items-center justify-between gap-2">
          <p className="text-[11px] text-ink-muted truncate">AI picks the code from the NPCS list for {st ? 'the business description' : `“${aiText}”`}.</p>
          <button type="button" onClick={askAi} disabled={suggesting}
            className="px-2.5 py-1 rounded-lg border border-gold-300 bg-gold-50 hover:bg-gold-100 text-gold-800 text-[11px] font-semibold flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-60">
            <Sparkles className="w-3 h-3" /> AI pick
          </button>
        </div>
      )}
      {(st || aiShown) && (
        <div className="px-4 py-3 border-b border-line">
          <p className="text-xs font-semibold text-ink flex items-center gap-1.5 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-gold-600" /> {aiShown && !ai.error ? 'AI suggestion (Claude, from the NPCS list)' : 'Suggested from the business description'}
            {suggesting && <Loader2 className="w-3 h-3 animate-spin text-ink-subtle" />}
          </p>
          {aiShown && ai.reason && <p className="text-[11px] text-ink-muted mb-1.5">Why: {ai.reason}</p>}
          {aiShown && ai.error && <p className="text-[11px] text-amber-700 mb-1.5">AI not available ({ai.error}) — showing keyword matches.</p>}
          <div aria-live="polite">
            {shownSuggestError && <p className="text-[11px] text-rose-700">Could not suggest: {shownSuggestError}</p>}
            {!suggesting && !shownSuggestError && shownSuggestions.length === 0 && (
              <p className="text-[11px] text-ink-muted">No match for this description — search below.</p>
            )}
          </div>
          <ul className="space-y-1">
            {shownSuggestions.map(s => {
              const chosen = s.code === v.productCode;
              return (
                <li key={s.code} className={clsx('flex items-center gap-2 rounded-lg px-2 py-1.5', chosen ? 'bg-gold-50' : 'hover:bg-page')}>
                  <CodeChip code={s.code} />
                  {s.ai && !s.alternative && <span className="text-[9px] font-bold uppercase tracking-wide text-gold-800 bg-gold-100 rounded px-1">AI</span>}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-ink truncate" title={s.desc}>{s.desc}</p>
                    <p className="text-[10px] text-ink-subtle truncate">
                      {s.category} · {s.categoryDesc}{s.matched?.length ? ` · matched: ${s.matched.join(', ')}` : ''}
                    </p>
                  </div>
                  {chosen ? (
                    <span className="text-[11px] font-semibold text-gold-800 flex items-center gap-1"><Check className="w-3 h-3" /> In use</span>
                  ) : (
                    <button type="button" onClick={() => pickProduct(s)}
                      className="px-2.5 py-1 rounded-lg bg-gold-700 hover:bg-gold-800 text-white text-[11px] font-semibold cursor-pointer shrink-0">
                      Use
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Manual search */}
      <div className="px-4 py-3">
        <label className="relative block">
          <Search className="w-3.5 h-3.5 text-ink-subtle absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Code (9983) or words" aria-label="Search NPCS service codes"
            className="w-full pl-8 pr-8 py-2 text-xs text-ink bg-white border border-line-input rounded-lg focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-600" />
          {searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-subtle absolute right-2.5 top-1/2 -translate-y-1/2" />}
        </label>
        <div aria-live="polite">
          {shownSearchError && <p className="text-[11px] text-rose-700 mt-2">Search failed: {shownSearchError}</p>}
          {dq && !searching && !shownSearchError && shownResults.length === 0 && (
            <p className="text-[11px] text-ink-muted mt-2">No NPCS code matches “{dq}”.</p>
          )}
        </div>
        {shownResults.length > 0 && (
          <ul className="mt-2 max-h-64 overflow-y-auto divide-y divide-line border border-line rounded-lg">
            {shownResults.map(r => {
              const chosen = r.level === 'category' ? r.code === v.categoryCode : r.code === v.productCode;
              return (
                <li key={r.code}>
                  <button type="button" onClick={() => pick(r)}
                    className={clsx('w-full text-left flex items-center gap-2 px-2.5 py-2 cursor-pointer', chosen ? 'bg-gold-50' : 'hover:bg-page')}>
                    <CodeChip code={r.code} level={r.level} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-ink truncate" title={r.desc}>{r.desc}</span>
                      <span className="block text-[10px] text-ink-subtle truncate">
                        {r.level === 'category' ? 'Category — sets the 4-digit code only' : `${r.category} · ${r.categoryDesc}`}
                      </span>
                    </span>
                    {chosen && <Check className="w-3.5 h-3.5 text-gold-700 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
