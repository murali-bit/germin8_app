import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, Search } from 'lucide-react';
import { AOC4_PHASES } from '../../data/aoc4Sections.js';
import NpcsPicker from '../npcs/NpcsPicker.jsx';
import FieldRow, { Badge } from './FieldRow.jsx';
import { isBlank, isRequired } from './aoc4Data.js';

// Per-phase filled / missing counts for the summary bar and accordion headers.
export function phaseStats(phase, valueOf) {
  let filled = 0, missing = 0;
  for (const f of phase.fields) {
    const empty = isBlank(valueOf(f.key));
    if (!empty) filled++;
    else if (isRequired(f, valueOf)) missing++;
  }
  return { filled, missing, total: phase.fields.length };
}

function groupFields(fields) {
  const groups = [];
  for (const f of fields) {
    const name = f.group || '';
    let g = groups[groups.length - 1];
    if (!g || g.name !== name) { g = { name, fields: [] }; groups.push(g); }
    g.fields.push(f);
  }
  return groups;
}

export default function Page1({ valueOf, sourceOf, edits, onEdit, suggestText }) {
  const [open, setOpen] = useState(() => new Set([1]));
  const [onlyNeeded, setOnlyNeeded] = useState(false);
  const [query, setQuery] = useState('');

  const stats = useMemo(() => Object.fromEntries(AOC4_PHASES.map(p => [p.phase, phaseStats(p, valueOf)])), [valueOf]);
  const q = query.trim().toLowerCase();

  const toggle = id => setOpen(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const visible = f => {
    if (q && !f.label.toLowerCase().includes(q) && !f.key.toLowerCase().includes(q)) return false;
    if (onlyNeeded) return isBlank(valueOf(f.key)) && isRequired(f, valueOf);
    return true;
  };

  const npcsValue = {
    categoryCode: valueOf('CATEGORY_CODE') ?? '', categoryDesc: valueOf('CATEGORY_DESC') ?? '',
    productCode: valueOf('HIGHEST_CODE') ?? '', productDesc: valueOf('HIGHEST_DESC') ?? '',
  };
  const onNpcs = v => {
    if (!v) return;
    if ('categoryCode' in v) onEdit('CATEGORY_CODE', v.categoryCode ?? '');
    if ('categoryDesc' in v) onEdit('CATEGORY_DESC', v.categoryDesc ?? '');
    if ('productCode' in v) onEdit('HIGHEST_CODE', v.productCode ?? '');
    if ('productDesc' in v) onEdit('HIGHEST_DESC', v.productDesc ?? '');
    // IV: a chosen category means at least one product/service category.
    if (v.categoryCode && !String(valueOf('TOTAL_CATEGORIES') ?? '').trim()) onEdit('TOTAL_CATEGORIES', '1');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
        <p className="text-sm text-ink-muted">
          Every field the extension fills on AOC-4 Page 1, in MCA order. Change anything here, then <span className="font-medium text-ink">Save</span>.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-ink-subtle absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a field" aria-label="Find a field"
              className="w-44 rounded-lg border border-line-input bg-white pl-8 pr-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-600" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-ink-muted whitespace-nowrap cursor-pointer">
            <input type="checkbox" checked={onlyNeeded} onChange={e => setOnlyNeeded(e.target.checked)} className="accent-gold-600" />
            Only missing
          </label>
        </div>
      </div>

      {AOC4_PHASES.map(phase => {
        const s = stats[phase.phase];
        const isOpen = open.has(phase.phase) || !!q || onlyNeeded;
        const fields = phase.fields.filter(visible);
        if ((q || onlyNeeded) && !fields.length) return null;
        return (
          <section key={phase.phase} className="bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
            <button type="button" onClick={() => toggle(phase.phase)} aria-expanded={isOpen} aria-controls={`phase-${phase.phase}`}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gold-50/50">
              <span className={clsx('w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0',
                s.missing ? 'bg-gold-100 text-gold-800' : 'bg-emerald-50 text-emerald-700')}>{phase.phase}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-ink truncate">{phase.title}</span>
                <span className="block text-xs text-ink-muted">{s.filled} of {s.total} filled</span>
              </span>
              {s.missing ? <Badge tone="missing">{s.missing} missing</Badge> : <Badge tone="ok">Required done</Badge>}
              <ChevronDown className={clsx('w-4 h-4 text-ink-subtle transition-transform', isOpen && 'rotate-180')} />
            </button>
            {isOpen && (
              <div id={`phase-${phase.phase}`} className="border-t border-line px-4 py-4 space-y-5">
                {phase.phase === 7 && !q && !onlyNeeded && (
                  <div className="rounded-xl border border-gold-200 bg-gold-50/50 p-4">
                    <h4 className="text-sm font-semibold text-ink mb-1">Service type (NPCS code)</h4>
                    <p className="text-xs text-ink-muted mb-3">Search by code or words, or pick a suggestion. This sets the category code and the highest-turnover product code below.</p>
                    <NpcsPicker value={npcsValue} onChange={onNpcs} suggestText={suggestText} />
                  </div>
                )}
                {groupFields(fields).map(g => (
                  <div key={g.name || '_'}>
                    {g.name && <h4 className="text-xs font-semibold uppercase tracking-wide text-gold-700 mb-2">{g.name}</h4>}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {g.fields.map(f => (
                        <FieldRow key={f.key} field={f} value={valueOf(f.key)}
                          required={isRequired(f, valueOf)}
                          source={sourceOf(f.key)}
                          dirty={Object.prototype.hasOwnProperty.call(edits, f.key)}
                          onChange={v => onEdit(f.key, v)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
