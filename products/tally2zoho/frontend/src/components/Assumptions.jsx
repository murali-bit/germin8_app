import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Info, RefreshCw } from 'lucide-react';
import { api, goTo } from '../api';
import { Card, btnSecondary } from './ui';

const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-IN')} ${n === 1 ? one : many}`;

// "Assumptions the tool made": every default the tool used because no decision was made, with a count per kind and a
// button to the place where it can be changed. A default is never silent: each one is also a flagged item on its
// record and an entry in the audit log. refreshKey: change it to read the list again (for example after the files
// were created).
export default function Assumptions({ jobId, onNavigate, refreshKey = 0 }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!jobId) return;
    setBusy(true);
    try { setView(await api.get(`/migrations/${jobId}/assumptions`)); setError(''); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, [jobId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const refresh = <button type="button" onClick={load} disabled={busy} className={btnSecondary}><RefreshCw className="w-4 h-4" /> {busy ? 'Reading…' : 'Read again'}</button>;
  if (!view) return <Card title="Assumptions the tool made" right={refresh}><div className="p-4 text-[14px] text-muted">{error || 'Loading…'}</div></Card>;
  if (!view.available) return <Card title="Assumptions the tool made"><div className="p-4 text-[14px] text-muted">{view.reason}</div></Card>;
  const list = view.assumptions;
  return (
    <Card title="Assumptions the tool made" right={refresh}
      subtitle="Where you made no decision, the tool used a safe default so the files can still be imported. Nothing is hidden: each default is listed here. Open one to change it.">
      <div className="px-4 py-3 border-b border-line text-[14px] text-ink">
        {list.length
          ? <>{plural(view.total, 'default')} in {plural(list.length, 'kind')}. {view.toCheck ? `${plural(view.toCheck, 'one needs', 'need')} a look.` : ''} {view.blocking ? `${plural(view.blocking, 'row')} would still be refused by Zoho.` : 'None blocks the import.'}</>
          : 'No default was needed: every decision was made.'}
        {view.inFiles && view.sameAsFiles === false && <span className="block text-muted">The files created last were built with an earlier list. Create the files again to use the current one.</span>}
      </div>
      <ul className="divide-y divide-line">
        {list.map(a => (
          <li key={a.kind} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 text-[14px]">
            <span className="shrink-0 w-16 text-[20px] font-semibold tabular-nums text-ink">{Number(a.count).toLocaleString('en-IN')}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-ink">{a.title}</span>
              <span className="block text-muted">{a.words}</span>
              <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                {a.blocking && <span className="inline-flex items-center gap-1 font-medium text-danger-ink"><AlertTriangle className="w-4 h-4" /> Zoho will refuse these rows</span>}
                {!a.blocking && a.check && <span className="inline-flex items-center gap-1 font-medium text-warning-ink"><Info className="w-4 h-4" /> Please check</span>}
                {a.unconfirmed && <span className="inline-flex items-center gap-1 text-muted"><Info className="w-4 h-4" /> Not confirmed until the next test import</span>}
                {!a.blocking && !a.check && !a.unconfirmed && <span className="inline-flex items-center gap-1 text-success-ink"><CheckCircle2 className="w-4 h-4" /> Safe default</span>}
              </span>
            </span>
            {a.where && onNavigate && (
              <button type="button" className={`${btnSecondary} shrink-0 self-start`} onClick={() => goTo(onNavigate, a.where.screen, a.where.anchor)}>
                Open and change <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {view.note && <div className="px-4 py-3 border-t border-line text-[13px] text-muted">{view.note}</div>}
    </Card>
  );
}

// The opening balances of the bank accounts as a plain list. Zoho does not take them in the Chart of Accounts file:
// they are in the opening balance journal, and can be typed in Zoho Books under Settings > Opening Balances instead.
export function BankOpeningBalances({ jobId, refreshKey = 0 }) {
  const [view, setView] = useState(null);
  useEffect(() => { if (jobId) api.get(`/migrations/${jobId}/bank-opening-balances`).then(setView).catch(() => setView(null)); }, [jobId, refreshKey]);
  if (!view || !view.accounts.length) return null;
  return (
    <div id="bank-opening-balances" tabIndex={-1} className="scroll-mt-4 focus:outline-none">
      <Card title="Bank opening balances" subtitle={view.note}>
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-wide text-muted bg-soft border-b border-line">
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Debit or Credit</th>
                <th className="px-4 py-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {view.accounts.map(a => (
                <tr key={a.id || a.account} className="border-b border-line">
                  <td className="px-4 py-2 text-ink break-words">{a.account}</td>
                  <td className="px-4 py-2">{a.side}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{a.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 text-[13px] text-muted">In the file {view.inFile}, as one journal dated {view.openingJournalDate}. Total debit {view.totalDebit}, total credit {view.totalCredit}.</div>
      </Card>
    </div>
  );
}
