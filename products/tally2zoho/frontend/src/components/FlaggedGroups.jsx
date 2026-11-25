import React, { useState } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { kindLabel } from '../screens/app/TestRunReport';

// Flagged items grouped by kind: one line per kind with its count, opened to show the first 20, then "Show all".
// items: [{ id?, kind, name, slotName, message, warning? }]. fix(item) -> [label, screen] | null (a button per kind).
const FIRST = 20;

export function groupByKind(items) {
  const groups = [];
  const by = new Map();
  for (const e of items || []) {
    const k = e.kind || 'other';
    if (!by.has(k)) { const g = { kind: k, items: [], warning: !!e.warning }; by.set(k, g); groups.push(g); }
    by.get(k).items.push(e);
  }
  return groups.sort((a, b) => b.items.length - a.items.length);
}

function KindGroup({ g, fix, onNavigate }) {
  const [all, setAll] = useState(false);
  const shown = all ? g.items : g.items.slice(0, FIRST);
  const action = fix ? fix(g.items[0]) : null;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none px-4 py-2.5 flex flex-wrap items-center gap-3 text-[14px]">
        <ChevronRight className="w-4 h-4 shrink-0 text-muted group-open:rotate-90 transition-transform" aria-hidden="true" />
        <span className="font-medium text-ink flex-1 min-w-0">{kindLabel(g.kind)}{g.warning && <span className="font-normal text-subtle"> · warning, not blocking</span>}</span>
        <span className="tabular-nums text-ink">{g.items.length.toLocaleString('en-IN')}</span>
        {action && onNavigate && (
          <button type="button" className="underline font-medium text-ink" onClick={e => { e.preventDefault(); onNavigate(action[1]); }}>{action[0]}</button>
        )}
      </summary>
      <div className="px-4 pb-3 pl-11 space-y-2 text-[14px]">
        {shown.map((e, i) => (
          <div key={e.id ?? i} className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-muted" aria-hidden="true" />
            <div className="min-w-0 break-words">
              <span className="text-ink font-medium">{e.name}</span>{e.slotName && <span className="text-subtle"> · {e.slotName}</span>}
              <div className="text-muted">{e.message}</div>
            </div>
          </div>
        ))}
        {g.items.length > FIRST && (
          <button type="button" className="underline text-ink" onClick={() => setAll(v => !v)}>
            {all ? `Show the first ${FIRST}` : `Show all ${g.items.length.toLocaleString('en-IN')}`}
          </button>
        )}
      </div>
    </details>
  );
}

export default function FlaggedGroups({ items, fix, onNavigate, empty = 'Nothing flagged.' }) {
  const groups = groupByKind(items);
  if (!groups.length) return <div className="p-4 text-[14px] text-muted">{empty}</div>;
  return <div className="divide-y divide-line">{groups.map(g => <KindGroup key={g.kind} g={g} fix={fix} onNavigate={onNavigate} />)}</div>;
}
