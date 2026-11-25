import { Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { AOC2_NATURES } from '../../data/aoc4Sections.js';
import { Badge } from './FieldRow.jsx';
import { normDate, isFutureDate } from './aoc4Data.js';
import ReportAiPanel from './ReportAiPanel.jsx';

export const AOC2_COLUMNS = [
  { key: 'name', label: 'Name of the related party', width: 'min-w-[180px]' },
  { key: 'id', label: 'PAN (person) / CIN (company)', width: 'min-w-[150px]' },
  { key: 'relationship', label: 'Relationship', width: 'min-w-[170px]' },
  { key: 'nature', label: 'Nature of contract (s.188)', width: 'min-w-[220px]' },
  { key: 'duration', label: 'Duration', width: 'min-w-[150px]' },
  { key: 'terms', label: 'Salient terms (with amount)', width: 'min-w-[220px]' },
  { key: 'approvalDate', label: 'Board approval date', width: 'min-w-[130px]' },
  { key: 'advance', label: 'Advance paid (₹)', width: 'min-w-[110px]' },
];

const blankRow = () => ({ name: '', id: '', relationship: '', nature: '', duration: '', terms: '', approvalDate: '', advance: '0' });

// ROWS answer → array of rows. Accepts a JSON array or text lines "name | id | … | advance". null = no answer yet,
// or an unreadable saved list (see isAoc2Unreadable) — never [] for broken JSON, which would read as "there are none".
export function parseAoc2Rows(raw) {
  if (Array.isArray(raw)) return raw;
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s[0] === '[') { try { const a = JSON.parse(s); return Array.isArray(a) ? a : null; } catch { return null; } }
  return s.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const [name = '', id = '', relationship = '', nature = '', duration = '', terms = '', approvalDate = '', advance = '0'] = line.split('|').map(x => x.trim());
    return { name, id, relationship, nature, duration, terms, approvalDate, advance };
  });
}

// True when a contract list was saved but cannot be read back (e.g. cut off): the table must not show "none".
export function isAoc2Unreadable(raw) {
  if (Array.isArray(raw)) return false;
  const s = String(raw ?? '').trim();
  if (!s || s[0] !== '[') return false;
  try { return !Array.isArray(JSON.parse(s)); } catch { return true; }
}

export function rowProblems(r) {
  const out = [];
  const s = k => String(r[k] ?? '').trim();
  if (!s('name')) out.push('name');
  if (!s('id')) out.push('PAN / CIN');
  if (!s('relationship')) out.push('relationship');
  if (!AOC2_NATURES.includes(s('nature'))) out.push('nature');
  if (!s('duration')) out.push('duration');
  if (!s('terms')) out.push('terms');
  const d = normDate(s('approvalDate'));
  if (!d || isFutureDate(d)) out.push('approval date');
  if (!/^\d{1,15}(\.\d{1,2})?$/.test(s('advance').replace(/[,₹\s]/g, '') || '0')) out.push('advance');
  return out;
}

const CELL = 'w-full rounded-md border border-line-input bg-white px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-600';

// cin / jobId / onReload are optional: they power the "Read from documents (AI)" panel and its refresh after saving.
export default function Aoc2Rows({ rows, onChange, dirty, preview, unreadable, error, cin, jobId, onReload }) {
  const list = rows || [];
  const set = (i, key, v) => onChange(list.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  const add = () => onChange([...list, blankRow()]);
  const remove = i => onChange(list.filter((_, j) => j !== i));
  const bad = list.map(rowProblems);
  const badCount = bad.filter(b => b.length).length;

  return (
    <div className="space-y-4">
      <ReportAiPanel cin={cin} jobId={jobId} formTypes={['aoc2', 'aoc4']} onSaved={onReload} docLabel="the related-party note and AOC-2 annexure" />
      <section className="bg-surface border border-line rounded-xl shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Contracts with related parties at arm’s length (s.188)</h3>
            <p className="text-xs text-ink-muted mt-0.5">One row per contract. The extension builds MCA’s Excel from these rows and uploads it. Leave out a director’s pay as director and loans.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {unreadable
              ? <Badge tone="missing">Unreadable</Badge>
              : rows === null
              ? <Badge tone="missing">Not answered</Badge>
              : <Badge tone={badCount ? 'warn' : 'ok'}>{list.length} contract{list.length === 1 ? '' : 's'}{badCount ? ` · ${badCount} to fix` : ''}</Badge>}
            {dirty && <Badge tone="gold">Edited</Badge>}
          </div>
        </div>

        {unreadable && (
          <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            The saved contract list is unreadable (it may have been cut off when it was saved). Enter the contracts again and press Save.
          </p>
        )}
        {error && <p className="mb-3 text-xs text-rose-700">{error}</p>}

        {list.length > 0 && (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 z-[1] bg-surface text-left font-semibold text-ink-muted pb-2 pr-2">#</th>
                  {AOC2_COLUMNS.map(c => <th key={c.key} className={clsx('text-left font-semibold text-ink-muted pb-2 pr-2', c.width)}>{c.label}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => (
                  <tr key={i} className={clsx(bad[i].length && 'bg-rose-50/40')}>
                    <td className="sticky left-0 z-[1] bg-surface py-1 pr-2 align-top text-ink-muted pt-3">{i + 1}</td>
                    {AOC2_COLUMNS.map(c => (
                      <td key={c.key} className="py-1 pr-2 align-top">
                        {c.key === 'nature' ? (
                          <select className={CELL} value={r.nature || ''} aria-label={`${c.label} — contract ${i + 1}`} onChange={e => set(i, 'nature', e.target.value)}>
                            <option value="">Choose…</option>
                            {r.nature && !AOC2_NATURES.includes(r.nature) && <option value={r.nature}>{r.nature} (not an MCA value)</option>}
                            {AOC2_NATURES.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        ) : (
                          <input className={clsx(CELL, c.key === 'advance' && 'text-right')} value={r[c.key] ?? ''} aria-label={`${c.label} — contract ${i + 1}`}
                            placeholder={c.key === 'approvalDate' ? 'DD/MM/YYYY' : ''}
                            onChange={e => set(i, c.key, e.target.value)} />
                        )}
                      </td>
                    ))}
                    <td className="py-1 align-top">
                      <button type="button" onClick={() => remove(i)} title="Remove this contract" aria-label={`Remove contract ${i + 1}`}
                        className="p-2 rounded-md text-ink-subtle hover:text-rose-700 hover:bg-rose-50"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {badCount > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-rose-700">
                {bad.map((b, i) => b.length ? <li key={i}>Contract {i + 1}: check {b.join(', ')}</li> : null)}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-3">
          <button type="button" onClick={add}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-gold-50">
            <Plus className="w-3.5 h-3.5" /> Add contract
          </button>
          {list.length === 0 && !unreadable && (
            <button type="button" onClick={() => onChange([])}
              className={clsx('rounded-lg border px-3 py-1.5 text-xs font-semibold',
                rows !== null ? 'border-gold-300 bg-gold-50 text-gold-800' : 'border-line bg-white text-ink hover:bg-gold-50')}>
              {rows !== null ? 'Answered: no contracts at arm’s length' : 'There are none'}
            </button>
          )}
        </div>
      </section>

      {preview && (preview.notes?.length > 0 || preview.missing?.length > 0) && (
        <section className="bg-surface border border-line rounded-xl shadow-sm p-5">
          <h3 className="text-sm font-semibold text-ink mb-2">What the extension will see</h3>
          {preview.missing?.length > 0 && (
            <ul className="text-xs text-ink space-y-1 mb-2">
              {preview.missing.map(m => <li key={m.key}><Badge tone={m.optional ? 'neutral' : 'missing'}>{m.optional ? 'Optional' : 'Needed'}</Badge> {m.label || m.key}</li>)}
            </ul>
          )}
          {preview.notes?.length > 0 && (
            <ul className="text-xs text-ink-muted space-y-1 list-disc pl-5">{preview.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
          <p className="text-[11px] text-ink-subtle mt-2">The declaration (resolution number, date, signatory) is shared with Page 2.</p>
        </section>
      )}
    </div>
  );
}
