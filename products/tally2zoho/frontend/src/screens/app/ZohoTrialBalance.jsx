import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { api, formatAmount } from '../../api';
import { Card, FileButton, Note, StatTile, btnPrimary, btnSecondary, inputClass } from '../../components/ui';

const FORMAT = { csv: 'CSV', xlsx: 'Excel (XLSX)', xls: 'Excel 97-2003 (XLS)' };
// A figure as { amount, side }: shown as "1,234.00 Dr" (Tally and Zoho alike).
const fig = f => (!f ? '—' : f.side ? `${formatAmount(f.amount)} ${f.side === 'Debit' ? 'Dr' : 'Cr'}` : '0.00');

function Rows({ title, rows, columns, empty }) {
  if (!rows?.length) return empty ? <div className="px-4 py-3 text-[14px] text-muted">{empty}</div> : null;
  return (
    <div className="border-t border-line overflow-x-auto table-sticky">
      <table className="w-full text-left text-[13px]">
        <caption className="px-4 pt-3 pb-2 text-left text-[14px] font-semibold text-ink">{title} ({rows.length})</caption>
        <thead className="bg-soft border-y border-line text-[12px] uppercase tracking-wide text-muted">
          <tr>{columns.map(c => <th key={c.label} scope="col" className={`py-2.5 px-4 font-semibold ${c.right ? 'text-right' : ''}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={`${r.account || r.ledger}|${i}`} className="align-top hover:bg-soft">
              {columns.map(c => <td key={c.label} className={`py-2.5 px-4 text-ink ${c.right ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The columns could not be found (or a balance has no Dr / Cr): the user says which columns to use.
function Picker({ pick, onRead, onCancel }) {
  const d = pick.detected || {};
  const [account, setAccount] = useState(d.account || '');
  const [mode, setMode] = useState(d.balance ? 'balance' : 'pair');
  const [debit, setDebit] = useState(''), [credit, setCredit] = useState(''), [balance, setBalance] = useState(d.balance || '');
  const [sign, setSign] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const sel = (value, set, label) => (
    <label className="space-y-1">
      <span className="text-[13px] text-ink">{label}</span>
      <select value={value} onChange={e => set(e.target.value)} className={inputClass}>
        <option value="">Choose…</option>
        {pick.headers.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );
  const ready = account && (mode === 'pair' ? debit && credit && debit !== credit : balance) && (!pick.needsSign || sign);
  const read = async () => {
    setBusy(true); setError('');
    try { await onRead(mode === 'pair' ? { accountColumn: account, debitColumn: debit, creditColumn: credit } : { accountColumn: account, balanceColumn: balance, ...(sign ? { balanceSign: sign } : {}) }); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="px-4 py-3 border-b border-line bg-warning-soft text-[14px] space-y-2">
      <div className="text-ink"><strong>Choose the columns of "{pick.file.name}".</strong> {pick.error}</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {sel(account, setAccount, 'Account name')}
        <label className="space-y-1">
          <span className="text-[13px] text-ink">The figures are in</span>
          <select value={mode} onChange={e => setMode(e.target.value)} className={inputClass}>
            <option value="pair">A debit and a credit column</option>
            <option value="balance">One balance column</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {mode === 'pair' ? <>{sel(debit, setDebit, 'Debit column')}{sel(credit, setCredit, 'Credit column')}</> : <>
          {sel(balance, setBalance, 'Balance column')}
          <label className="space-y-1">
            <span className="text-[13px] text-ink">A figure without Dr or Cr is</span>
            <select value={sign} onChange={e => setSign(e.target.value)} className={inputClass}>
              <option value="">{pick.needsSign ? 'Choose…' : 'Every figure says Dr or Cr'}</option>
              <option value="debit_positive">A debit when positive (a credit is negative)</option>
              <option value="credit_positive">A credit when positive (a debit is negative)</option>
            </select>
          </label>
        </>}
      </div>
      {error && <div role="alert" className="text-danger-ink">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={busy || !ready} onClick={read}>{busy ? 'Reading…' : 'Read the report with these columns'}</button>
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function ZohoTrialBalance({ job, readOnly }) {
  const [data, setData] = useState(null);
  const [basis, setBasis] = useState('closing');
  const [pick, setPick] = useState(null);
  const [error, setError] = useState('');
  const base = `/migrations/${job.id}/zoho-trial-balance`;
  const load = useCallback(async () => { try { const d = await api.get(base); setData(d); if (d.check) setBasis(d.check.basis); } catch (e) { setError(e.message); } }, [base]);
  useEffect(() => { load(); }, [load]);

  const send = async (file, picks = null) => {
    const q = new URLSearchParams({ basis, ...(picks || {}) }).toString();
    try { setData(await api.sendFile(`${base}?${q}`, file)); setPick(null); setError(''); }
    catch (e) {
      if ((e.data?.needsColumns || e.data?.needsSign) && !picks) { setPick({ file, headers: e.data.headers || [], detected: e.data.detected, needsSign: !!e.data.needsSign, error: e.message }); return; }
      throw e;
    }
  };
  const changeBasis = async b => {
    setBasis(b);
    if (!data?.check || readOnly) return;
    try { setData(await api.put(`${base}/basis`, { basis: b })); } catch (e) { setError(e.message); }
  };
  const remove = async () => { try { setData(await api.del(base)); } catch (e) { setError(e.message); } };

  const c = data?.check, cmp = data?.comparison;
  const cols = c?.columns;
  return (
    <Card title="Trial Balance: Zoho Books against Tally"
      subtitle="Upload the Trial Balance exported from Zoho Books. Every account is compared with Tally's ledger-wise Trial Balance, under the names written in the Zoho files."
      right={!readOnly && (
        <div className="flex flex-wrap items-start gap-2">
          <FileButton label={c ? 'Upload a newer Zoho Trial Balance' : 'Upload Zoho Trial Balance'} accept=".csv,.xlsx,.xls,text/csv" onFile={f => send(f)} />
          {c && <button type="button" className={btnSecondary} onClick={remove}><Trash2 className="w-4 h-4" aria-hidden="true" /> Remove</button>}
        </div>
      )}>
      <div className="px-4 py-3 border-b border-line text-[14px] text-muted space-y-2">
        <div>{data?.note}</div>
        <div className="rounded-md border border-warning-line bg-warning-soft px-3 py-2 text-warning-ink"><strong>Export range.</strong> {data?.rangeNote}</div>
        {data?.dateProblem && <div role="alert" className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-danger-ink"><strong>Opening Balance Date.</strong> {data.dateProblem}</div>}
        {data?.periodWarning && <div role="alert" className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-danger-ink">{data.periodWarning}</div>}
        {data?.adjustment && data.adjustment.cause !== 'none' && (
          <div role="alert" className="rounded-md border border-warning-line bg-warning-soft px-3 py-2 text-warning-ink">
            <strong>Opening Balance Adjustments.</strong> {data.adjustment.words}
            {data.adjustment.sources?.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-ink">
                {data.adjustment.sources.map(x => <li key={x.key}>{x.label}: {x.rows.toLocaleString('en-IN')} {x.rows === 1 ? 'balance' : 'balances'}, {x.amount.amount} {x.amount.side} on Opening Balance Adjustments</li>)}
              </ul>
            )}
          </div>
        )}
        {data?.check?.period && !data?.periodWarning && <div>Period of the export: {data.check.period.from} to {data.check.period.to}.</div>}
        {data?.zohoBalanced === false && <div role="alert" className="text-danger-ink">The debit and credit totals of the Zoho file are not equal. Check that the export was not cut off.</div>}
        <div>
          Customers are compared as one Accounts Receivable total and vendors as one Accounts Payable total, as Zoho Books keeps them. A ledger renamed, cleaned, treated as one
          with another, or put on Zoho's own account in Mapping Studio is compared under the name written for it.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink">Compare with Tally's</span>
          {[['closing', 'closing balances'], ['opening', 'opening balances']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={basis === k} disabled={readOnly && !!c} onClick={() => changeBasis(k)}
              className={`min-h-9 px-3 rounded-md border text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${basis === k ? 'bg-brand-soft text-info-ink border-action' : 'bg-white text-ink border-line-strong hover:bg-soft'}`}>{l}</button>
          ))}
        </div>
      </div>
      {error && <div role="alert" className="px-4 py-3 border-b border-danger-line bg-danger-soft text-[14px] text-danger-ink">{error}</div>}
      {pick && <Picker pick={pick} onRead={p => send(pick.file, p)} onCancel={() => setPick(null)} />}
      {!c && <div className="px-4 py-6 text-[14px] text-muted">No Zoho Trial Balance uploaded yet. Use the Upload button above, then the comparison appears here.</div>}
      {c && (
        <div className="px-4 py-3 border-b border-line text-[14px] text-muted">
          Read from {c.fileName ? `"${c.fileName}", ` : ''}{FORMAT[c.format] || c.format}, headings on row {c.headerRow}: {c.zohoAccounts} account(s) under "{cols.account}" ({cols.how?.account}),
          figures from {cols.balance ? `"${cols.balance}"` : `"${cols.debit}" and "${cols.credit}"`} ({cols.how?.figures}){c.balanceSign ? `, a positive figure read as a ${c.balanceSign === 'debit_positive' ? 'debit' : 'credit'}` : ''}.
          {' '}{c.headingsLeftOut.length} heading row(s) and {c.totalsLeftOut.length} total row(s) were left out.
          {c.unreadable.length > 0 && <span className="text-warning-ink"> {c.unreadable.length} row(s) could not be read: {c.unreadable.slice(0, 5).map(u => `${u.name} ("${u.value}")`).join(', ')}.</span>}
          {c.repeated.length > 0 && <span className="text-warning-ink"> Listed more than once and added together: {c.repeated.join(', ')}.</span>}
          {' '}Uploaded by {c.uploadedBy}.
        </div>
      )}
      {c && data.problem && <div className="px-4 py-3"><Note tone="danger">{data.problem}</Note></div>}
      {cmp && (
        <>
          <div className="px-4 py-3 text-[14px] text-muted">{cmp.basisWords}</div>
          <div className="px-4 pb-3 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile label="Agree" value={cmp.counts.matched} tone={cmp.counts.matched ? 'success' : undefined} />
            <StatTile label="Differ" value={cmp.counts.differing} tone={cmp.counts.differing ? 'danger' : undefined} />
            <StatTile label="Only in Tally" value={cmp.counts.onlyTally} tone={cmp.counts.onlyTally ? 'warning' : undefined} />
            <StatTile label="Only in Zoho" value={cmp.counts.onlyZoho} tone={cmp.counts.onlyZoho ? 'warning' : undefined} />
          </div>
          <div className="px-4 pb-3 overflow-x-auto">
            <table className="text-[14px]">
              <thead className="text-[13px] text-muted"><tr><th scope="col" className="py-1 pr-6 text-left font-semibold">Totals</th><th scope="col" className="py-1 pr-6 text-right font-semibold">Debit</th><th scope="col" className="py-1 pr-6 text-right font-semibold">Credit</th></tr></thead>
              <tbody className="text-ink tabular-nums">
                <tr><td className="py-1 pr-6">Tally (accounts compared)</td><td className="py-1 pr-6 text-right">{formatAmount(cmp.totals.tally.debit)}</td><td className="py-1 pr-6 text-right">{formatAmount(cmp.totals.tally.credit)}</td></tr>
                <tr><td className="py-1 pr-6">Zoho Books</td><td className="py-1 pr-6 text-right">{formatAmount(cmp.totals.zoho.debit)}</td><td className="py-1 pr-6 text-right">{formatAmount(cmp.totals.zoho.credit)}</td></tr>
              </tbody>
            </table>
            <div className="mt-3 flex items-start gap-2 text-[14px] font-medium">
              {cmp.totals.agree && !cmp.counts.differing && !cmp.counts.onlyTally && !cmp.counts.onlyZoho
                ? <span className="inline-flex items-start gap-2 text-success-ink"><CheckCircle2 className="w-4 h-4 mt-0.5" aria-hidden="true" /> Every account agrees.</span>
                : <span className="inline-flex items-start gap-2 text-danger-ink"><AlertTriangle className="w-4 h-4 mt-0.5" aria-hidden="true" /> {cmp.counts.differing + cmp.counts.onlyTally + cmp.counts.onlyZoho} account(s) do not agree. They are listed below.</span>}
            </div>
          </div>
          <Rows title="Accounts whose balance differs" rows={cmp.differing} columns={[
            { label: 'Account', render: r => <><div className="font-medium">{r.account}</div>{r.zohoAccount && !r.sameSpelling && <div className="text-[13px] text-muted">In Zoho: "{r.zohoAccount}"</div>}{r.note && <div className="text-[13px] text-muted">{r.note}</div>}</> },
            { label: 'Tally', right: true, render: r => fig(r.tally) }, { label: 'Zoho', right: true, render: r => fig(r.zoho) }, { label: 'Zoho less Tally', right: true, render: r => fig(r.difference) }]} />
          <Rows title="Only in Tally (not found in the Zoho report)" rows={cmp.onlyTally} columns={[
            { label: 'Account', render: r => <><div className="font-medium">{r.account}</div><div className="text-[13px] text-muted">{r.how.join('; ')}{r.ledgerCount > 1 ? ` · ${r.ledgerCount} Tally ledgers` : ''}</div>{r.note && <div className="text-[13px] text-muted">{r.note}</div>}</> },
            { label: 'Tally', right: true, render: r => fig(r.tally) }]} />
          <Rows title="Only in Zoho (no Tally ledger is written to it)" rows={cmp.onlyZoho} columns={[
            { label: 'Account', render: r => <><div className="font-medium">{r.account}</div>{r.note && <div className="text-[13px] text-muted">{r.note}</div>}</> },
            { label: 'Zoho', right: true, render: r => fig(r.zoho) }]} />
          <Rows title="Not compared" rows={cmp.notCompared} columns={[
            { label: 'Tally line', render: r => <span className="font-medium">{r.ledger}</span> }, { label: 'Why', render: r => r.reason }, { label: 'Tally', right: true, render: r => fig(r.amount) }]} />
          {cmp.groupLinesNotCompared?.length > 0 && (
            <div className="px-4 py-3 border-t border-warning-line bg-warning-soft text-[14px] text-ink">
              The Tally Trial Balance shows {cmp.groupLinesNotCompared.length} group(s) without their ledgers ({cmp.groupLinesNotCompared.slice(0, 5).join(', ')}). Export it again with Alt+F5 (detailed) so every ledger is compared.
            </div>
          )}
          {cmp.matched.length > 0 && (
            <details className="border-t border-line">
              <summary className="px-4 py-3 text-[14px] font-semibold text-info-ink cursor-pointer">Accounts that agree ({cmp.matched.length})</summary>
              <Rows title="Accounts that agree" rows={cmp.matched} columns={[
                { label: 'Account', render: r => <><div className="font-medium">{r.account}</div>{r.note && <div className="text-[13px] text-muted">{r.note}</div>}</> },
                { label: 'Tally', right: true, render: r => fig(r.tally) }, { label: 'Zoho', right: true, render: r => fig(r.zoho) }]} />
            </details>
          )}
        </>
      )}
    </Card>
  );
}
