import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, ChevronRight, CircleDashed, Download, Landmark, Lock, RotateCcw, Scale, TriangleAlert } from 'lucide-react';
import { api, downloadFile, formatAmount, goTo, useJob } from '../../api';
import { flowPosition } from '../../navigation';
import JobHeader from '../../components/JobHeader';
import { PinnedStepBar } from '../../components/WizardNav';
import CompletenessTable from '../../components/CompletenessTable';
import ExpectedTrialBalance from '../../components/ExpectedTrialBalance';
import { CheckedDownloadButton, DownloadAllButton } from '../../components/CreateFiles';
import { Blocked, FileButton, Note, btnPrimary, btnSecondary, btnSmall, inputClass } from '../../components/ui';
import { stepPosition, stepMark, expectedFromZohoCheck, optionLines, trialBalanceState, count, stepFromParams, withHeldStep, tdsUploadWords, creditGroups, firstCreditFilter, CREDIT_FILTERS, verifyTone, heldWords, openingWords, fileTips, stillOpenRows, WIZARD_SCREEN, HELD_STEP } from '../../importWizard';
import Assumptions from '../../components/Assumptions';
import PreSteps from '../../components/PreSteps';

// The Import Wizard: one step per page, from setting up the Zoho Books organisation to comparing the trial balances.
// Everything it shows comes from GET /import-wizard (the server reads the order, the click paths and the options from
// the researched Zoho rules, and works out what is locked and why). The step the person is on is kept on the server.

const EXPORT_CENTER = 'screen-25';
const REJECTIONS = 'screen-28';
const TRIAL_BALANCE = 'screen-30';
const MAPPING_STUDIO = 'screen-19'; // Voucher files (the route of receipts and payments) is a card of Mapping Studio

// ---------- small pieces ----------
function Box({ n, title, children, muted = false }) {
  return (
    <section className={`rounded-lg border bg-white shadow-xs ${muted ? 'border-success-line' : 'border-line'}`}>
      <h3 className="px-4 pt-4 text-[16px] font-semibold tracking-tight text-ink flex items-center gap-2">
        {n != null && <span className="w-6 h-6 rounded-full bg-action text-white text-[13px] flex items-center justify-center shrink-0">{n}</span>}
        {title}
      </h3>
      <div className="p-4 pt-3 space-y-3 text-[14px] text-ink">{children}</div>
    </section>
  );
}

// "Settings > Organization > Profile" as clickable-looking chips.
function Path({ parts }) {
  if (!parts?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-[14px]">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight className="w-4 h-4 text-subtle shrink-0" aria-hidden="true" />}
          <span className="px-2 py-0.5 rounded-md border border-line-strong bg-soft font-medium">{p}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

// The whole click path of one import, options shown as "Label: value".
function Clicks({ clicks }) {
  if (!clicks?.length) return null;
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[14px]" aria-label="Where to click in Zoho Books">
      {clicks.map((c, i) => (
        <li key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="w-4 h-4 text-subtle shrink-0" aria-hidden="true" />}
          <span className={`px-2 py-0.5 rounded-md border ${c.option ? 'border-info-line bg-info-soft text-info-ink font-semibold' : 'border-line-strong bg-soft font-medium'}`}>{c.text}</span>
        </li>
      ))}
    </ol>
  );
}

// required: a tick the files need (for example SEZ / Overseas Trading when a party is outside India), said in words
function Tick({ checked, disabled, onChange, children, required = false }) {
  return (
    <label className={`flex items-start gap-2.5 py-1 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} className="mt-0.5 w-4 h-4 accent-action shrink-0" />
      <span className={checked ? 'text-muted line-through decoration-subtle' : required ? 'font-medium' : ''}>
        {required && <span className="mr-1.5 px-1.5 py-0.5 rounded border border-warning-line bg-warning-soft text-warning-ink text-[12px] font-semibold no-underline">Required for these files</span>}
        {children}
      </span>
    </label>
  );
}

const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

const MarkIcon = ({ mark, current }) => {
  const base = 'w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0';
  if (mark === 'done') return <span className={`${base} bg-success-ink text-white`}><Check className="w-3.5 h-3.5" aria-label="Done" /></span>;
  if (mark === 'locked') return <span className={`${base} border border-line-strong text-subtle`}><Lock className="w-3 h-3" aria-label="Locked" /></span>;
  if (mark === 'attention') return <span className={`${base} border border-warning-line bg-warning-soft text-warning-ink`}><TriangleAlert className="w-3.5 h-3.5" aria-label="Rows refused" /></span>;
  if (mark === 'held') return <span className={`${base} border border-warning-line bg-warning-soft text-warning-ink`}><CircleDashed className="w-3.5 h-3.5" aria-label="Open item" /></span>;
  return <span className={`${base} ${current ? 'border-2 border-action text-action bg-white' : 'border border-line-strong text-muted'}`} aria-hidden="true"><span className="w-1.5 h-1.5 rounded-full bg-current" /></span>;
};

export function StepList({ steps, current, onGo, progress }) {
  return (
    <nav aria-label="Import steps" className="lg:sticky lg:top-4 self-start">
      <div className="hidden lg:block rounded-lg border border-line bg-white shadow-sm p-2">
        <div className="px-2 pt-1 pb-2 text-[13px] text-muted">{progress.imported} of {progress.files} files imported</div>
        <ol className="space-y-0.5">
          {steps.map(s => {
            const here = s.id === current;
            return (
              <li key={s.id}>
                <button type="button" onClick={() => onGo(s.id)} aria-current={here ? 'step' : undefined}
                  className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 text-[14px] ${here ? 'bg-soft-2 font-semibold text-ink' : 'text-ink hover:bg-soft'}`}>
                  <MarkIcon mark={stepMark(s)} current={here} />
                  <span className="truncate"><span className="tabular-nums text-muted font-normal">{s.n}.</span> {s.short || s.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <label className="lg:hidden block">
        <span className="text-[13px] text-muted">Go to step ({progress.imported} of {progress.files} files imported)</span>
        <select value={current} onChange={e => onGo(e.target.value)} className={inputClass}>
          {steps.map(s => <option key={s.id} value={s.id}>{s.n}. {s.short || s.title}{s.done ? ' (done)' : s.locked ? ' (locked)' : ''}</option>)}
        </select>
      </label>
    </nav>
  );
}

// ---------- the lock ----------
export function LockBox({ step, job, canChange, act, onGo }) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  if (step.override) {
    return (
      <div className="p-4 rounded-md border border-warning-line bg-warning-soft text-[14px] flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div><strong>Opened although locked.</strong> {step.lockReason} <span className="block text-muted">Reason given by {step.override.by}: "{step.override.reason}"</span></div>
        {canChange && <button type="button" className={`${btnSecondary} shrink-0`} onClick={() => act(() => api.del(`/migrations/${job.id}/import-wizard/overrides/${step.id}`))}>Lock again</button>}
      </div>
    );
  }
  if (!step.locked) return null;
  return (
    <div className="p-4 rounded-md border border-warning-line bg-warning-soft text-[14px] space-y-3">
      <div className="flex items-start gap-2.5">
        <Lock className="w-5 h-5 shrink-0 mt-px text-warning-ink" aria-hidden="true" />
        <div><strong>This step is locked.</strong> {step.lockReason}</div>
      </div>
      {step.blockers?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {step.blockers.map(b => (
            <button key={`${b.step}|${b.why}`} type="button" className={btnSecondary} onClick={() => onGo(b.step)}>
              Go to {b.module || (b.step === 'setup' ? 'Set up Zoho Books' : b.step === 'bank' ? 'Bank accounts' : b.step === 'date' ? 'the Migration Date step' : b.step)} <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      {step.hardLocked && <p className="text-[13px]">This lock cannot be opened with a reason: Zoho Books does not let the Migration Date be changed once customer or vendor opening balances are in.</p>}
      {canChange && !step.hardLocked && (open ? (
        <form className="flex flex-col sm:flex-row gap-2" onSubmit={e => { e.preventDefault(); act(() => api.put(`/migrations/${job.id}/import-wizard/overrides/${step.id}`, { reason: reason.trim() })); }}>
          <label className="sr-only" htmlFor={`why-${step.id}`}>Why open this step anyway?</label>
          <input id={`why-${step.id}`} autoFocus value={reason} onChange={e => setReason(e.target.value)} className={inputClass} placeholder="Why open it anyway? This is kept in the audit log." />
          <button type="submit" disabled={reason.trim().length < 10} className={btnPrimary}>Open the step</button>
          <button type="button" className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
        </form>
      ) : <button type="button" className="underline text-info-ink rounded-sm focus-visible:outline-2 focus-visible:outline-brand" onClick={() => setOpen(true)}>Open it anyway, with a reason</button>)}
    </div>
  );
}

// ---------- step 1: set up Zoho Books ----------
export function SetupStep({ step, job, canChange, act, onNavigate, onGo }) {
  const ex = step.existingAccounts;
  return (
    <>
      <p className="text-[15px] text-muted">Do these in Zoho Books before the first import. Tick each one when it is done.</p>
      {(step.questions || []).map(q => <SetupQuestion key={q.id} q={q} canChange={canChange} act={act} />)}
      {step.items.map((item, i) => (
        <Box key={item.id} n={i + 1} title={<>{item.what}{item.optional && <span className="text-[13px] font-normal text-muted">(optional)</span>}</>} muted={item.ticks.length > 0 && item.ticks.every(t => t.done)}>
          {item.paths.map((p, k) => <Path key={k} parts={p} />)}
          {item.hints.map((h, k) => <div key={k} className="font-medium">{h}</div>)}
          {item.ticks.length > 0 && (
            <div>{item.ticks.map(t => (
              <Tick key={t.id} checked={t.done} required={!!t.required} disabled={!canChange} onChange={done => act(() => api.put(`/migrations/${job.id}/import-wizard/ticks`, { step: 'setup', item: t.id, done }))}>{t.text}</Tick>
            ))}</div>
          )}
          {item.upload && (
            <div className="space-y-2">
              {item.lines.map((l, k) => <p key={k}>{l}</p>)}
              <p className="text-muted">
                {ex.source === 'uploaded'
                  ? <>Using Zoho's own list: {count(ex.count)} accounts from "{ex.fileName}".</>
                  : <>No file yet. The tool uses the usual list of {count(ex.count)} accounts Zoho creates.</>}
              </p>
              {canChange && (
                <div className="flex flex-wrap gap-2 items-start">
                  <FileButton label={ex.source === 'uploaded' ? 'Replace the file' : "Upload Zoho's Chart of Accounts"} accept=".csv,.xlsx,.xls,text/csv"
                    onFile={file => act(async () => (await api.sendFile(`/migrations/${job.id}/import-wizard/zoho-accounts`, file)).wizard, true)} />
                  {ex.source === 'uploaded' && <button type="button" className={btnSecondary} onClick={() => act(async () => (await api.del(`/migrations/${job.id}/import-wizard/zoho-accounts`)).wizard)}>Remove the file</button>}
                </div>
              )}
            </div>
          )}
          {item.uploadTds && <TdsUpload item={item} job={job} canChange={canChange} act={act} />}
          {item.notes.length > 0 && <p className="text-[13px] text-muted">{item.notes.join(' ')}</p>}
        </Box>
      ))}
      <Box n={null} title="Before the first import">
        <p>The tool has already worked out the trial balance Zoho Books should show after these files, account by account. It is on the last step, "Compare the trial balances". The list below says which defaults the tool used where nobody decided (for example a supplier taken as outside India, or a TDS ledger entered on Zoho's own TDS account).</p>
        {onGo && <button type="button" className={btnSecondary} onClick={() => onGo('finish')}>See the trial balance Zoho Books should show <ArrowRight className="w-4 h-4" aria-hidden="true" /></button>}
      </Box>
      <Assumptions jobId={job.id} onNavigate={onNavigate} />
      <CompletenessTable job={job} onNavigate={onNavigate} />
    </>
  );
}

// A question about the Zoho Books organisation (for example: is the HSN/SAC field switched on?). The answer is a voucher
// setting (PUT voucher-settings) and the files that depend on it become out of date.
export function SetupQuestion({ q, canChange, act }) {
  const [error, setError] = useState('');
  const choose = async id => {
    setError('');
    try { await act(async () => { await api.put(q.route, { [q.key]: id }); return null; }, true); } catch (e) { setError(e.message); }
  };
  return (
    <Box title={q.text}>
      <p className="text-muted">{q.help}</p>
      <div role="radiogroup" aria-label={q.text} className="flex flex-wrap gap-2">
        {q.options.map(o => (
          <label key={o.id} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[14px] ${q.value === o.id ? 'border-action bg-info-soft font-semibold' : 'border-line-strong bg-white'} ${canChange ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
            <input type="radio" name={`q-${q.id}`} checked={q.value === o.id} disabled={!canChange} onChange={() => choose(o.id)} className="accent-action" /> {o.label}
          </label>
        ))}
      </div>
      {error && <p role="alert" className="text-danger-ink">{error}</p>}
    </Box>
  );
}

// ---------- the Migration Date ----------
// Zoho keeps ONE Migration Date (Opening Balance Date) for every opening balance that is not in a journal: the balances
// of the Customers and Vendors files take it, and Zoho does not let it be changed once they are in. The Chart of
// Accounts import creates the record (one balance stays in that file for this), so the person only edits the date:
// nothing is typed. The step is done when the date Zoho Books SHOWS, typed here, is the Migration Date. No tick.
// In the rare case that no chart row can carry a balance (step.mode 'type'), ONE named balance is typed instead.
export function DateStep({ step, job, canChange, act }) {
  const d = step.date;
  const z = step.zohoDate || {};
  const [value, setValue] = useState(d.value);
  const [seen, setSeen] = useState(z.value || '');
  const [error, setError] = useState('');
  const [seenError, setSeenError] = useState('');
  useEffect(() => setValue(d.value), [d.value]);
  useEffect(() => setSeen(z.value || ''), [z.value]);
  const save = async v => {
    setError('');
    try { await act(async () => { await api.put(d.route, { [d.key]: v }); return null; }, true); } catch (e) { setError(e.message); }
  };
  const check = async v => {
    setSeenError('');
    try { await act(() => api.put(z.route.replace(/^\/api/, ''), { date: v })); } catch (e) { setSeenError(e.message); }
  };
  return (
    <>
      <p className="text-[15px] text-muted">Zoho Books dates some opening balances itself, with one date: the Migration Date. Save it now, before any other file. Later Zoho Books does not let you change it.</p>
      {step.dependsOn?.length > 0 && (
        <Box title="What depends on this date">
          <ul className="list-disc pl-5">{step.dependsOn.map(x => <li key={x.key}>{count(x.rows)} opening {x.rows === 1 ? 'balance' : 'balances'} in {x.module}</li>)}</ul>
          <p className="font-medium">{step.consequence}</p>
          {step.journalDate && <p className="text-muted">Every other opening balance is in the opening balance journal, which is dated {step.journalDate.nice} in its own file. It does not depend on this step.</p>}
        </Box>
      )}
      <Box n={1} title="The Migration Date">
        <p>Use <strong>{d.nice}</strong>{d.chosen ? ' (the date you chose)' : ', the day before the financial year starts'}. The tool dates its opening balance journal with the same day.</p>
        {canChange && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[13px] text-muted">Another date (year-month-day)
              <input value={value} onChange={e => setValue(e.target.value)} placeholder="2025-03-31" className={`${inputClass} w-44 font-mono block`} aria-label="Migration Date" />
            </label>
            <button type="button" className={btnSecondary} disabled={!value.trim() || value.trim() === d.value} onClick={() => save(value.trim())}>Use this date</button>
            {d.chosen && <button type="button" className={btnSecondary} onClick={() => save('')}><RotateCcw className="w-4 h-4" aria-hidden="true" /> Back to {d.niceDefault}</button>}
          </div>
        )}
        {error && <p role="alert" className="text-danger-ink">{error}</p>}
        {d.chosen && <p className="text-[13px] text-muted">Changing the date makes the opening balance journal out of date: create the files again.</p>}
      </Box>
      <Box n={2} title="Save it in Zoho Books">
        {step.paths.map((p, k) => <Path key={k} parts={p} />)}
        <ol className="list-decimal pl-5 space-y-1">{step.lines.map((l, k) => <li key={k}>{l}</li>)}</ol>
        {step.mode === 'edit' && step.chartBalances?.length > 0 && (
          <div>
            <p className="font-medium">{step.chartBalances.length === 1 ? 'The balance Zoho Books lists (it must stay as it is)' : 'The balances Zoho Books lists (they must stay as they are)'}</p>
            <ul className="text-[14px]">{step.chartBalances.map(b => <li key={b.account}>{b.account}: <span className="tabular-nums">{b.amount} {b.side}</span></li>)}</ul>
            <p className="text-[13px] text-muted">Type no balance. You only change the date.</p>
          </div>
        )}
        {step.mode === 'type' && step.balancesToType?.length > 0 && (
          <div>
            <p className="font-medium">The one balance to type</p>
            <ul className="text-[14px]">{step.balancesToType.map(b => <li key={b.account}>{b.account}: <span className="tabular-nums">{b.amount} {b.side}</span></li>)}</ul>
            <p className="text-[13px] text-muted">It is in no file, so it is not counted twice. Do not set it back to 0.</p>
          </div>
        )}
      </Box>
      <Box n={3} title="Check the date Zoho Books shows">
        <p>{z.ask}</p>
        {canChange && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[13px] text-muted">The date Zoho Books shows
              <input type="date" value={seen} onChange={e => setSeen(e.target.value)} disabled={step.locked} className={`${inputClass} w-48 block`} aria-label="The Opening Balance Date Zoho Books shows" />
            </label>
            <button type="button" className={btnPrimary} disabled={step.locked || !seen} onClick={() => check(seen)}>Check this date</button>
            {z.value && <button type="button" className={btnSecondary} onClick={() => check('')}><RotateCcw className="w-4 h-4" aria-hidden="true" /> Clear</button>}
          </div>
        )}
        <p role="status" className={z.value ? (z.matches ? 'font-medium text-success-ink' : 'font-medium text-danger-ink') : 'text-muted'}>{z.words}</p>
        {seenError && <p role="alert" className="text-danger-ink">{seenError}</p>}
        <p className="text-[13px] text-muted">A tick is not enough here: the tool opens the other files only when the date Zoho Books shows is {d.nice}.</p>
      </Box>
    </>
  );
}

// Zoho's TDS taxes export (set-up item "TDS"): More > Export TDS Taxes in Zoho Books, then the file here. Its names
// become the TDS pick list and the names written by default (PUT/DELETE /zoho-tds-taxes); Bills and Invoices are then
// out of date. Optional: without it the files carry the names the tool suggests.
export function TdsUpload({ item, job, canChange, act }) {
  const u = item.uploadTds;
  const [said, setSaid] = useState('');
  const route = `/migrations/${job.id}/zoho-tds-taxes`;
  const upload = async file => {
    const r = await api.sendFile(route, file);
    setSaid(`${count(r.taxes)} TDS ${r.taxes === 1 ? 'tax' : 'taxes'} read.`);
    await act(() => null, true);
  };
  const remove = () => act(async () => { await api.del(route); setSaid("Zoho's TDS export removed: the files use the suggested TDS names again."); return null; });
  return (
    <div className="space-y-2">
      {item.lines.map((l, k) => <p key={k}>{l}</p>)}
      {said && <p role="status" className="font-medium">{said}</p>}
      <p className={u.given ? '' : 'text-muted'}>{tdsUploadWords(u)}</p>
      <TdsToCreate list={item.tdsToCreate} />
      {canChange && (
        <div className="flex flex-wrap gap-2 items-start">
          <FileButton label={u.given ? 'Replace the TDS export' : "Upload Zoho's TDS export"} accept=".csv,.xlsx,.xls,text/csv" onFile={upload} />
          {u.given && <button type="button" className={btnSecondary} onClick={remove}><RotateCcw className="w-4 h-4" aria-hidden="true" /> Remove it (undo)</button>}
        </div>
      )}
    </div>
  );
}

// The TDS taxes the Bills and Invoices files name: create the ones Zoho does not have, with exactly these names, rates and
// section codes. With Zoho's TDS export given, the ones it already has are marked.
export function TdsToCreate({ list }) {
  if (!list?.taxes?.length) return null;
  const rows = list.taxes;
  return (
    <div className="space-y-1">
      <p className="font-medium">TDS taxes your files use</p>
      <p className="text-[13px] text-muted">
        {list.exportGiven
          ? (list.toCreate ? `Create the ${list.toCreate === 1 ? 'tax' : 'taxes'} marked "Create" in Zoho Books, then import the Bills and Invoices.` : "Zoho's TDS export already has all of them.")
          : "Upload Zoho's TDS export above to see which ones Zoho already has. Create the others in Zoho Books."}
        {rows[0]?.payableAccount ? ` Leave the accounts of each tax as Zoho sets them: ${rows[0].payableAccount} and ${rows[0].receivableAccount}.` : ''}
      </p>
      <div className="overflow-x-auto">
        <table className="text-[13px] min-w-full">
          <thead><tr className="text-left text-muted"><th className="pr-3 py-1 font-medium">Name</th><th className="pr-3 font-medium">Rate</th><th className="pr-3 font-medium">Section code</th><th className="pr-3 font-medium">Tax act</th><th className="pr-3 font-medium">Start date</th><th className="font-medium">In Zoho</th></tr></thead>
          <tbody>{rows.map(t => (
            <tr key={`${t.name}|${t.rate}|${t.section}`} className="border-t border-line">
              <td className="pr-3 py-1">{t.name}</td><td className="pr-3">{t.rate}%</td><td className="pr-3">{t.section}</td><td className="pr-3">{t.actWords}</td><td className="pr-3 whitespace-nowrap">{t.startDate ? t.startDate.split('-').reverse().join('/') : ''}</td>
              <td>{t.inZoho === true ? 'Yes' : t.inZoho === false ? <strong>Create</strong> : 'Not known'}
                {t.accountDiffers?.length > 0 && <span className="block text-danger-ink">Posts to {t.accountDiffers.join(' and ')} in Zoho: change it back to {t.payableAccount} or {t.receivableAccount}.</span>}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- a file ----------
export function FileImport({ f, step, job, canChange, act, check, groups, onNavigate, first = 1 }) {
  const [imported, setImported] = useState('');
  const [refused, setRefused] = useState('0');
  const [error, setError] = useState('');
  const expected = expectedFromZohoCheck(check, f.key);
  const lines = optionLines(f.guide);
  const tips = fileTips(f);
  const causes = (groups?.groups || []).filter(g => g.key === f.key);
  const blocked = step.locked || f.outOfDate;

  const record = e => {
    e.preventDefault();
    act(() => api.put(`/migrations/${job.id}/import-wizard/results/${f.key}`, { imported: imported.trim(), refused: refused.trim() || '0' }));
  };
  const sendErrors = async file => {
    try {
      await api.sendFile(`/migrations/${job.id}/rejections/${f.key}`, file);
    } catch (e) {
      if (e.data?.needsColumns) throw new Error("The columns of Zoho's file could not be found. Open the Rejection Manager to choose them.");
      throw e;
    }
    await act(() => null, true);
  };

  return (
    <>
      {f.outOfDate && (
        <div role="alert" className="p-4 rounded-md border border-warning-line bg-warning-soft text-[14px] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="flex items-start gap-2"><TriangleAlert className="w-5 h-5 shrink-0 text-warning-ink" aria-hidden="true" /><span><strong>This file is out of date.</strong> {[...new Set(f.outOfDateReasons || [])].join(' ')}</span></span>
          <button type="button" className={`${btnPrimary} shrink-0`} onClick={() => onNavigate(EXPORT_CENTER)}>Create the files again</button>
        </div>
      )}

      {/* the Chart of Accounts step: the account(s) to create by hand first (createFirst) */}
      <PreSteps source={f.createFirst || step.createFirst} />

      <Box n={first} title="Download the file">
        <div className="flex flex-wrap items-center gap-3">
          <CheckedDownloadButton job={job} file={f} viewer={!canChange} onNavigate={onNavigate} onError={e => setError(e.message)} label={`Download ${f.fileName}`} className={btnPrimary} />
          <span className="text-muted">{plural(f.rows, 'row')}{step.expects?.documents != null ? `, ${plural(step.expects.documents, 'document')}` : ''}</span>
        </div>
        {f.sizeWords && <p className="font-medium">{f.sizeWords}</p>}
        {error && <div role="alert"><Note tone="danger">{error}</Note></div>}
      </Box>

      <Box n={first + 1} title="Import it in Zoho Books">
        <Clicks clicks={(f.guide?.clicks || []).filter(c => !c.option)} />
        {lines.length > 0 && <div className="font-semibold">On Zoho's import screens:</div>}
        {lines.length > 0 && (
          <ul className="space-y-1.5">
            {lines.map(o => (
              <li key={o.label}>
                <span className="font-semibold">{o.label}{o.value ? ':' : ''}</span> {o.value}{o.keep ? <span className="text-muted"> (leave as it is)</span> : null}
                {(o.why || o.others.length > 0) && (
                  <span className="block text-[13px] text-muted">{o.why}{o.others.length > 0 ? ` Do not choose: ${o.others.join(', ')}.` : ''}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {f.guide?.doNotMap?.length > 0 && <p><span className="font-semibold">Do not map these columns:</span> {f.guide.doNotMap.join(', ')}.</p>}
        {f.guide?.mustExistFirst?.length > 0 && <p className="text-[13px] text-muted">Zoho Books must already have: {f.guide.mustExistFirst.join('; ')}.</p>}
        {step.itemsNotNeeded && <p className="text-[13px] text-muted">No line of this file names an item, so it does not wait for the Items file.</p>}
        {tips.length > 0 && (
          <div>
            <div className="font-semibold">Good to know (from the test imports)</div>
            <ul className="list-disc pl-5 space-y-1 text-[14px]">{tips.map(t => <li key={t.id} className={t.general ? 'text-muted' : ''}>{t.text}</li>)}</ul>
          </div>
        )}
      </Box>

      <Box n={first + 2} title="What Zoho should say">
        <ul className="space-y-1">
          <li>Rows in the file: <strong>{count(step.expects?.rows ?? f.rows)}</strong>{step.expects?.documents != null && <> ({plural(step.expects.documents, 'document')})</>}</li>
          {step.expects?.records != null && <li>After the import Zoho Books must show <strong>{count(step.expects.records)}</strong> {f.verify ? (step.expects.records === 1 ? f.verify.one : f.verify.many) : step.expects.records === 1 ? 'document' : 'documents'} from this file. The preview's "ready" figure is not enough: read the figure after the import.</li>}
          {expected && (
            <li>The Zoho check expects: <strong>{count(expected.accepted)}</strong> to import, <strong>{count(expected.refused)}</strong> will be refused{expected.mayBeRefused != null && <>, <strong>{count(expected.mayBeRefused)}</strong> may be refused</>}.
              {(expected.refused > 0 || expected.mayBeRefused > 0) && <button type="button" className="ml-2 underline text-info-ink" onClick={() => onNavigate(check?.screen || 'screen-38', { file: f.key })}>See the problems</button>}
            </li>
          )}
          {step.expects?.alreadyInZoho?.count > 0 && (
            <li>Zoho already has <strong>{count(step.expects.alreadyInZoho.count)}</strong> of these accounts{step.expects.alreadyInZoho.source === 'default' ? ' (from the usual list)' : ''}. Zoho skips them as duplicates; that is expected.</li>
          )}
        </ul>
      </Box>

      {f.verify && <VerifyBox v={f.verify} n={first + 3} canChange={canChange} act={act} />}

      <Box n={first + (f.verify ? 4 : 3)} title="What happened in Zoho?">
        {f.stateWords && <Note tone="warning">{f.stateWords}</Note>}
        {f.result && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>
              {f.result.fromTracker ? <>Marked as imported{f.result.note ? `: ${f.result.note}` : ''}.</>
                : <>Recorded: <strong>{count(f.result.imported)}</strong> imported, <strong>{count(f.result.refused)}</strong> refused{f.result.by ? ` (by ${f.result.by})` : ''}.</>}
              {f.refusedFromErrorFile > 0 && <> {count(f.refusedFromErrorFile)} rows of Zoho's error file are not fixed yet.</>}
            </span>
            {canChange && <button type="button" className={`${btnSecondary} shrink-0`} onClick={() => act(() => api.del(`/migrations/${job.id}/import-wizard/results/${f.key}`))}><RotateCcw className="w-4 h-4" aria-hidden="true" /> Undo</button>}
          </div>
        )}
        {f.previous && <p className="text-muted">An earlier file was recorded ({count(f.previous.imported)} imported, {count(f.previous.refused)} refused). The file changed since, so import it again.</p>}
        {canChange && (
          <form onSubmit={record} className="flex flex-col sm:flex-row sm:items-end gap-2">
            <label className="flex-1">
              <span className="text-[13px] text-muted">Imported (the figure Zoho Books shows after the import, not the preview)</span>
              <input inputMode="numeric" value={imported} onChange={e => setImported(e.target.value.replace(/[^\d]/g, ''))} className={inputClass} disabled={blocked} />
            </label>
            <label className="flex-1">
              <span className="text-[13px] text-muted">Rows refused</span>
              <input inputMode="numeric" value={refused} onChange={e => setRefused(e.target.value.replace(/[^\d]/g, ''))} className={inputClass} disabled={blocked} />
            </label>
            <button type="submit" disabled={blocked || !imported.trim()} className={btnPrimary}><Check className="w-4 h-4" aria-hidden="true" /> Mark as imported</button>
          </form>
        )}
        {canChange && (
          <div className="flex flex-wrap items-start gap-2">
            <FileButton label="Upload Zoho's error file" accept=".csv,.xlsx,.xls,text/csv" onFile={sendErrors} />
            {(f.refused > 0 || causes.length > 0) && <button type="button" className={btnSecondary} onClick={() => onNavigate(REJECTIONS)}>Open the Rejection Manager</button>}
          </div>
        )}
        {causes.length > 0 && (
          <ul className="divide-y divide-line rounded-md border border-line">
            {causes.map(g => (
              <li key={g.cause} className="p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                <span><strong>{count(g.records)} rows:</strong> "{g.example}"<span className="block text-muted">{g.action?.words}</span></span>
                {g.action?.screen && <button type="button" className={`${btnSecondary} ${btnSmall} shrink-0`} onClick={() => goTo(onNavigate, g.action.screen, g.action.anchor)}>Open {g.action.place}</button>}
              </li>
            ))}
          </ul>
        )}
        {f.importState === 'missing_in_zoho' || f.importState === 'short' ? null
          : f.importState === 'refused' || f.importState === 'failed'
          ? <Note tone="warning">Rows were refused. Fix them, import the retry file, then type the new numbers. The next steps stay locked until nothing is refused.</Note>
          : f.imported ? <Note tone="success">Imported. Click Next.</Note> : null}
      </Box>
    </>
  );
}

// ---------- did every record arrive? ----------
// Zoho's preview can say "ready" for a row it then does not create (third test import: one customer). So after a master
// file is imported, Zoho's own export of that list is compared with the file, name by name (server zohoverify.js).
// A missing record keeps the next steps locked, and a file with only the missing rows is offered.
export function VerifyBox({ v, n, canChange, act }) {
  const [error, setError] = useState('');
  const route = v.uploadRoute.replace(/^\/api/, '');
  const upload = async file => {
    const r = await api.sendFile(route, file);
    await act(() => r.wizard, true);
  };
  const missingFile = async () => {
    setError('');
    try { await downloadFile(v.missingRoute, v.missingFileName); } catch (e) { setError(e.message); }
  };
  const tone = verifyTone(v);
  const from = v.source === 'zoho_api' ? 'the list read from Zoho Books' : `Zoho's export${v.fileName ? ` "${v.fileName}"` : ''}`;
  return (
    <Box n={n} title={`Check that every ${v.one} arrived`}>
      <p className={tone === 'success' ? 'font-medium text-success-ink' : tone === 'warning' ? 'font-medium text-warning-ink' : ''}>{v.words}</p>
      {v.given && <p className="text-[13px] text-muted">Checked against {from}{v.by ? `, given by ${v.by}` : ''}. Names are compared without the spaces around them and without capital letters.</p>}
      {!v.given && <p className="text-[13px] text-muted">Without the export, type below the figure Zoho Books shows after the import: a figure lower than {count(v.expected)} keeps the next steps locked.</p>}
      {v.missingCount > 0 && (
        <>
          <div className="overflow-x-auto max-h-72 overflow-y-auto border border-line rounded-md">
            <table className="w-full text-[14px]">
              <thead className="bg-soft sticky top-0"><tr className="text-left text-[12px] uppercase tracking-wide text-muted border-b border-line">
                <th className="py-2 px-3 font-semibold">Row of the file</th><th className="py-2 px-3 font-semibold">{v.column}</th><th className="py-2 px-3 font-semibold text-right">Opening balance</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {v.missing.map(m => (
                  <tr key={m.rowNo}><td className="py-2 px-3 tabular-nums">{m.fileRow}</td><td className="py-2 px-3 break-words">{m.name}</td><td className="py-2 px-3 text-right tabular-nums">{m.openingBalance ? formatAmount(m.openingBalance) : '–'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {v.missingCount > v.missing.length && <p className="text-[13px] text-muted">Showing {count(v.missing.length)} of {count(v.missingCount)}. The file below has every one.</p>}
          {v.balanceWords && <p className="font-medium">{v.balanceWords}</p>}
          {v.usedBy?.length > 0 && <p>Later files that name a missing {v.one}: {v.usedBy.map(u => `${u.module} (${plural(u.rows, 'row')})`).join(', ')}. Zoho Books would refuse those rows.</p>}
          <button type="button" className={btnPrimary} onClick={missingFile}><Download className="w-4 h-4" aria-hidden="true" /> Download {v.missingFileName} ({plural(v.missingCount, 'row')})</button>
          <p className="text-[13px] text-muted">It has the same columns and values as the file you imported, the opening balance too. Import it with the same choices, then export from Zoho Books again and upload the new export here.</p>
        </>
      )}
      {v.balanceDiffers?.length > 0 && <p className="text-[13px]">Opening balance different in Zoho's export: {v.balanceDiffers.slice(0, 10).map(b => `${b.name} (file ${b.file}, Zoho ${b.zoho})`).join('; ')}.</p>}
      {canChange && (
        <div className="flex flex-wrap items-start gap-2">
          <FileButton label={v.given ? `Upload a new export of the ${v.many}` : `Upload Zoho's export of the ${v.many}`} accept=".csv,.xlsx,.xls,text/csv" onFile={upload} />
          {v.given && <button type="button" className={btnSecondary} onClick={() => act(() => api.del(route).then(r => r.wizard))}><RotateCcw className="w-4 h-4" aria-hidden="true" /> Forget this export</button>}
        </div>
      )}
      {error && <div role="alert"><Note tone="danger">{error}</Note></div>}
    </Box>
  );
}

// ---------- bank accounts ----------
export function BankStep({ step, job, canChange, act }) {
  return (
    <>
      <p className="text-[15px] text-muted">Journals post to these accounts. Zoho refuses every journal line of a bank account it does not have.</p>
      <Box n={1} title="Check each account in Zoho Books">
        {step.paths.map((p, k) => <Path key={k} parts={p} />)}
        {step.lines.map((l, k) => <p key={k}>{l}</p>)}
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-soft"><tr className="text-left text-[12px] uppercase tracking-wide text-muted border-b border-line">
              <th className="py-2 px-3 font-semibold">In Zoho Books</th><th className="py-2 px-3 font-semibold">Account</th><th className="py-2 px-3 font-semibold">Type</th><th className="py-2 px-3 font-semibold text-right">Opening balance</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {step.accounts.map(a => (
                <tr key={a.id}>
                  <td className="py-2 px-3"><input type="checkbox" aria-label={`${a.account} is in Zoho Books`} checked={!!a.done} disabled={!canChange || step.locked} onChange={e => act(() => api.put(`/migrations/${job.id}/import-wizard/ticks`, { step: 'bank', item: a.id, done: e.target.checked }))} className="w-4 h-4 accent-action" /></td>
                  <td className="py-2 px-3 break-words">{a.account}</td>
                  <td className="py-2 px-3">{a.accountType}</td>
                  <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{a.amount ? `${a.amount} ${a.side}` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] text-muted">
          {step.balancesIn === 'opening_balance_file' ? 'Balances: from the opening balance journal file.' : step.balancesIn === 'ledgers' ? 'Balances: worked out from the Tally bank ledgers.' : ''}
          {' '}Do not type a balance when you add an account here; the Migration Date and Opening balances steps deal with that.
        </p>
      </Box>
    </>
  );
}

// ---------- opening balances ----------
// The opening balance journal (OB-1, and OB-2 when contacts have advances) is the plan: nothing is typed. The list of
// balances to type is shown as the plan only when there is no journal file, and otherwise only when Zoho Books refused
// the journal (or on request), so a balance is never entered twice.
export function OpeningStep({ step, job, canChange, act, check, groups, onNavigate }) {
  const words = openingWords(step);
  const [showList, setShowList] = useState(false);
  const listShown = words.typing === 'plan' || words.typing === 'refused' || (words.typing === 'hidden' && showList);
  return (
    <>
      <p className="text-[15px] text-muted">{words.intro}</p>
      {step.file && <FileImport f={step.file} step={{ ...step, expects: step.file.expects || { rows: step.file.rows } }} job={job} canChange={canChange} act={act} check={check} groups={groups} onNavigate={onNavigate} />}
      {words.typing === 'hidden' && (
        <p className="text-[13px] text-muted">
          <button type="button" className="underline text-info-ink" aria-expanded={showList} onClick={() => setShowList(!showList)}>{showList ? 'Hide the list of balances' : 'Show the same balances as a list'}</button>
          {' '}Only if Zoho Books refuses the journal. Do not type them while the journal is imported, or they count twice.
        </p>
      )}
      {listShown && step.lines.length > 0 && (
        <Box n={step.file ? null : 1} title={words.typeTitle}>
          {step.typePaths.map((p, k) => <Path key={k} parts={p} />)}
          {step.typeClicks.length > 0 && <Clicks clicks={step.typeClicks.map(t => ({ text: t, option: false }))} />}
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead className="bg-soft"><tr className="text-left text-[12px] uppercase tracking-wide text-muted border-b border-line">
                <th className="py-2 px-3 font-semibold">Typed</th><th className="py-2 px-3 font-semibold">Account</th><th className="py-2 px-3 font-semibold">Debit or Credit</th><th className="py-2 px-3 font-semibold text-right">Amount</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {step.lines.map(l => (
                  <tr key={l.id}>
                    <td className="py-2 px-3"><input type="checkbox" aria-label={`Balance of ${l.account} typed`} checked={!!l.typed?.done} disabled={!canChange || step.locked} onChange={e => act(() => api.put(`/migrations/${job.id}/import-wizard/ticks`, { step: 'opening', item: l.id, done: e.target.checked }))} className="w-4 h-4 accent-action" /></td>
                    <td className="py-2 px-3 break-words">{l.account}{l.bank && <Landmark className="inline w-3.5 h-3.5 ml-1.5 text-muted" aria-label="Bank account" />}</td>
                    <td className="py-2 px-3">{l.side}</td>
                    <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{l.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {step.sourceWords && <p className="text-[13px] text-muted">{step.sourceWords}</p>}
        </Box>
      )}
      {step.contactCreditWords && <p className="text-[13px] text-muted">{step.contactCreditWords}</p>}
      {step.bothWays && <div role="alert"><Note tone="warning">The journal is imported and balances are ticked as typed. Enter each balance only once, or it counts twice: remove the typed balances in Zoho Books, or undo the import of the journal.</Note></div>}
    </>
  );
}

// ---------- apply the credits ----------
// After the journals: a receipt from a customer or a payment to a vendor written as a Manual Journal is a credit of
// that contact in Zoho Books. The list (from Tally's bill-wise details) says which invoice or bill each one pays.
// Nothing is imported here and the trial balance does not depend on it.
export function CreditsStep({ step, job, canChange, act }) {
  const [list, setList] = useState(null);
  const [total, setTotal] = useState(0);
  const [show, setShow] = useState(() => firstCreditFilter(step.counts));
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api.get(`/migrations/${job.id}/credits-to-apply?limit=5000`).then(r => { if (live) { setList(r.list || []); setTotal(r.total || 0); } }).catch(e => { if (live) { setList([]); setError(e.message); } });
    return () => { live = false; };
  }, [job.id, step.rows]);
  const download = async () => {
    setError('');
    try { await downloadFile(step.downloadRoute, step.fileName); } catch (e) { setError(e.message); }
  };
  const groups = creditGroups(list, show);
  const shown = groups.reduce((t, g) => t + g.rows.length, 0);
  return (
    <>
      <p className="text-[15px] text-muted">{step.intro} {step.why}</p>
      <div className="p-4 rounded-md border border-success-line bg-success-soft text-[14px] flex items-start gap-2.5">
        <Check className="w-5 h-5 shrink-0 mt-px text-success-ink" aria-hidden="true" />
        <span><strong>Nothing to import and no balance to type.</strong> The balances and the trial balance are already right. This step only marks the paid invoices and bills as paid.</span>
      </div>
      <Box n={1} title="Download the list">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-soft"><tr className="text-left text-[12px] uppercase tracking-wide text-muted border-b border-line">
              <th className="py-2 px-3 font-semibold">What</th><th className="py-2 px-3 font-semibold text-right">Rows</th><th className="py-2 px-3 font-semibold text-right">Amount</th><th className="py-2 px-3 font-semibold">Note</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {step.counts.map(c => (
                <tr key={c.id}>
                  <td className="py-2 px-3">{c.label}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{count(c.rows)}</td>
                  <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{formatAmount(c.amount)}</td>
                  <td className="py-2 px-3 text-muted">{c.words}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className={btnSecondary} onClick={download}><Download className="w-4 h-4" aria-hidden="true" /> Download {step.fileName} ({plural(step.rows, 'row')})</button>
        <p className="text-[13px] text-muted">This list is not an import file. It is also in the zip, in the folder not_for_import.</p>
        {error && <div role="alert"><Note tone="danger">{error}</Note></div>}
      </Box>
      <Box n={2} title="Apply each credit in Zoho Books">
        {step.paths.map((p, k) => <Path key={k} parts={p} />)}
        {step.how.map((l, k) => <p key={k}>{l}</p>)}
      </Box>
      <Box n={3} title="The credits">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Which rows to show">
          {CREDIT_FILTERS.map(f => (
            <button key={f.id} type="button" aria-pressed={show === f.id} onClick={() => setShow(f.id)}
              className={`${show === f.id ? btnPrimary : btnSecondary} ${btnSmall}`}>{f.label}{f.id !== 'all' ? ` (${count(step.counts.find(c => c.id === f.id)?.rows ?? 0)})` : ''}</button>
          ))}
        </div>
        {list === null ? <p className="text-muted">Reading the list.</p> : shown === 0 ? <p className="text-muted">No rows of this kind.</p> : (
          <div className="overflow-x-auto max-h-[28rem] overflow-y-auto border border-line rounded-md">
            <table className="w-full text-[14px]">
              <thead className="bg-soft sticky top-0"><tr className="text-left text-[12px] uppercase tracking-wide text-muted border-b border-line">
                <th className="py-2 px-3 font-semibold">Journal</th><th className="py-2 px-3 font-semibold">Date</th><th className="py-2 px-3 font-semibold">What to do</th><th className="py-2 px-3 font-semibold">Invoice or bill</th><th className="py-2 px-3 font-semibold text-right">Amount</th>
              </tr></thead>
              {groups.map(g => (
                <tbody key={`${g.contactType}-${g.contact}`} className="divide-y divide-line">
                  <tr className="bg-soft"><th colSpan={4} scope="colgroup" className="py-2 px-3 text-left font-semibold break-words">{g.contactType}: {g.contact}</th><td className="py-2 px-3 text-right tabular-nums font-semibold whitespace-nowrap">{formatAmount(g.amount)}</td></tr>
                  {g.rows.map((r, k) => (
                    <tr key={k} title={r.Note || undefined}>
                      <td className="py-2 px-3 whitespace-nowrap">{r['Journal Number']}</td>
                      <td className="py-2 px-3 whitespace-nowrap">{r['Journal Date']}</td>
                      <td className="py-2 px-3">{r['What To Do']}</td>
                      <td className="py-2 px-3 break-words">{r['Invoice or Bill Number'] || '–'}</td>
                      <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{formatAmount(r.Amount)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
        {list !== null && total > list.length && <p className="text-[13px] text-muted">Showing the first {count(list.length)} of {count(total)} rows. The downloaded list has all of them.</p>}
        {step.notes.map((t, k) => <p key={k} className="text-[13px] text-muted">{t}</p>)}
      </Box>
      <Box n={4} title="When you are done">
        {step.ticks.map(t => (
          <Tick key={t.id} checked={t.done} disabled={!canChange || step.locked} onChange={done => act(() => api.put(`/migrations/${job.id}/import-wizard/ticks`, { step: 'credits', item: t.id, done }))}>{t.text}</Tick>
        ))}
        <p className="text-[13px] text-muted">{step.later}</p>
      </Box>
    </>
  );
}

// ---------- vouchers in no file yet ----------
// What the uploaded sample gave for a held module (held-vouchers m.file, heldfiles.js): a file ready to download, or
// the exact reason it cannot be built yet.
const heldFileWords = m => {
  const name = m.sampleReceived?.fileName ? ` ("${m.sampleReceived.fileName}")` : '';
  if (m.file?.buildable) return `Sample received${name}. The file is ready: ${plural(m.file.vouchers, 'voucher')} in ${plural(m.file.rows, 'row')}.`;
  return `Sample received${name}. ${m.file?.why || 'The file cannot be built from it yet.'}`;
};
function HeldModule({ m, job, canChange, onChanged }) {
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
  const list = async () => {
    setError('');
    try { await downloadFile(`/api/migrations/${job.id}/held-vouchers/${m.key}.csv`, `not_in_any_file_${m.key}.csv`); } catch (e) { setError(e.message); }
  };
  const sample = async file => {
    const r = await api.sendFile(`/migrations/${job.id}/zoho-samples/${m.key}`, file);
    setSaid(r.message || 'Sample received.');
    onChanged(r.held);
  };
  const built = async () => {
    setError('');
    try { await downloadFile(`/api/migrations/${job.id}/held-vouchers/${m.key}/zoho-file`, `${m.key}_from_your_zoho_sample.csv`); } catch (e) { setError(e.message); }
  };
  const got = m.sampleReceived;
  return (
    <Box n={null} title={<>{m.module}: {plural(m.vouchers, 'voucher')} <span className="text-[14px] font-normal text-muted">({formatAmount(m.amount)})</span></>}>
      <p>{m.what ? `${m.what[0].toUpperCase()}${m.what.slice(1)}. ` : ''}{m.file?.buildable ? `The ${m.module} file is built from Zoho's sample you added. Import it after the ${m.importAfterModule} file.` : `No ${m.module} file can be made yet: it needs Zoho's import sample. With the default route (Manual Journals, in Voucher files) these vouchers are in the journals file instead.`}</p>
      <p className="text-[13px] text-muted">Sample needed: {m.sample}.</p>
      <div className="flex flex-wrap items-start gap-2">
        <button type="button" className={btnSecondary} onClick={list}><Download className="w-4 h-4" aria-hidden="true" /> List of these vouchers (CSV)</button>
        {canChange && <FileButton label={got ? 'Replace Zoho\'s sample' : "Add Zoho's sample for this module"} accept=".csv,.xlsx" onFile={sample} />}
      </div>
      {(said || got) && <p className="font-medium flex items-center gap-1.5 text-success-ink"><Check className="w-4 h-4" aria-hidden="true" /> {said || heldFileWords(m)}</p>}
      {m.file?.buildable && <button type="button" className={btnSecondary} onClick={built}><Download className="w-4 h-4" aria-hidden="true" /> Download the {m.module} file ({plural(m.file.vouchers, 'voucher')})</button>}
      <p className="text-[13px] text-muted">The list has the date, number, party and amount of each voucher, to check them. Nothing has to be typed in Zoho Books: choose Manual Journals in Voucher files and these vouchers are in the journals file. A file built from the sample is imported after the {m.importAfterModule} file.</p>
      {error && <div role="alert"><Note tone="danger">{error}</Note></div>}
    </Box>
  );
}

export function HeldStep({ step, job, canChange, onHeldChanged, onNavigate }) {
  const h = step.held;
  return (
    <>
      <div className="p-4 rounded-md border border-warning-line bg-warning-soft text-[14px] flex items-start gap-2.5">
        <CircleDashed className="w-5 h-5 shrink-0 mt-px text-warning-ink" aria-hidden="true" />
        <div className="space-y-2">
          <p><strong>{h.words}.</strong> These vouchers were read from Tally but are in no Zoho file, so the trial balances cannot agree yet. {heldWords(h)}</p>
          {h.modules?.some(m => !m.file?.buildable) && (
            <button type="button" className={btnSecondary} onClick={() => goTo(onNavigate, MAPPING_STUDIO, 'payments-route')}>Open Voucher files: choose Manual Journals <ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
          )}
        </div>
      </div>
      {h.modules.map(m => <HeldModule key={m.key} m={m} job={job} canChange={canChange} onChanged={onHeldChanged} />)}
    </>
  );
}

// ---------- the last step ----------
export function FinishStep({ step, job, canChange, act, onNavigate, held, onGo, steps }) {
  const [tb, setTb] = useState(null);
  useEffect(() => { api.get(`/migrations/${job.id}/zoho-trial-balance`).then(setTb).catch(() => setTb(null)); }, [job.id]);
  const s = trialBalanceState(tb);
  const open = stillOpenRows(step, steps);
  return (
    <>
      <div className={`p-5 rounded-lg border shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${s.state === 'agrees' ? 'border-success-line bg-success-soft' : 'border-line bg-white'}`}>
        <div className="flex items-start gap-3">
          <Scale className={`w-6 h-6 shrink-0 ${s.state === 'agrees' ? 'text-success-ink' : 'text-muted'}`} aria-hidden="true" />
          <div>
            <div className="text-[17px] font-semibold">
              {s.state === 'agrees' ? 'Finished: the trial balances agree.' : s.state === 'differs' ? `${count(s.accounts)} accounts differ.` : s.state === 'problem' ? 'The trial balances cannot be compared yet.' : 'Not compared yet.'}
            </div>
            <div className="text-[14px] text-muted">
              {s.state === 'agrees' ? 'Every account in Zoho Books has the Tally balance. The difference is zero.' : s.state === 'differs' ? 'Open the comparison to see which.' : s.state === 'problem' ? tb?.problem : "Export Zoho's Trial Balance and upload it on the comparison page. The migration is finished when the difference is zero."}
            </div>
          </div>
        </div>
        <button type="button" className={`${btnPrimary} shrink-0`} onClick={() => goTo(onNavigate, TRIAL_BALANCE, 'trial-balance')}>Open the Trial Balance comparison <ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
      </div>
      {open.length > 0 && s.state !== 'agrees' && (
        <Box n={null} title="Still open before the trial balances can agree">
          <ul className="divide-y divide-line">
            {open.map(o => (
              <li key={o.step} className="py-1.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span>{o.words}</span>
                {o.canGo && onGo && <button type="button" className={`${btnSecondary} ${btnSmall} shrink-0`} onClick={() => onGo(o.step)}>Go to the step</button>}
              </li>
            ))}
          </ul>
        </Box>
      )}
      {held?.notInAnyFile > 0 && (
        <div className="p-4 rounded-md border border-warning-line bg-warning-soft text-[14px] flex items-start gap-2.5">
          <CircleDashed className="w-5 h-5 shrink-0 mt-px text-warning-ink" aria-hidden="true" />
          <span><strong>{held.words}.</strong> The difference cannot reach zero until those vouchers are in Zoho Books (step "Not in any file yet"). {heldWords(held)}</span>
        </div>
      )}
      {tb?.dateProblem && (
        <div role="alert" className="p-4 rounded-md border border-danger-line bg-danger-soft text-[14px] flex items-start gap-2.5">
          <CircleDashed className="w-5 h-5 shrink-0 mt-px text-danger-ink" aria-hidden="true" />
          <span><strong>Check the Opening Balance Date first.</strong> {tb.dateProblem}</span>
        </div>
      )}
      {tb?.adjustment && tb.adjustment.cause !== 'none' && (
        <div className="p-4 rounded-md border border-warning-line bg-warning-soft text-[14px] flex items-start gap-2.5">
          <CircleDashed className="w-5 h-5 shrink-0 mt-px text-warning-ink" aria-hidden="true" />
          <span><strong>Opening Balance Adjustments is not zero.</strong> {tb.adjustment.words}</span>
        </div>
      )}
      <ExpectedTrialBalance job={job} />
      {(step.paths.length > 0 || step.ticks.length > 0) && (
        <Box n={null} title="Last checks">
          {step.paths.map((p, k) => <Path key={k} parts={p} />)}
          {step.openingDate?.words && <p className="font-medium">{step.openingDate.words}</p>}
          {step.ticks.map(t => (
            <Tick key={t.id} checked={t.done} disabled={!canChange} onChange={done => act(() => api.put(`/migrations/${job.id}/import-wizard/ticks`, { step: 'finish', item: t.id, done }))}>{t.text}</Tick>
          ))}
        </Box>
      )}
      <CompletenessTable job={job} onNavigate={onNavigate} defaultOpen />
    </>
  );
}

// ---------- the screen ----------
export default function Screen40_ImportWizard({ onNavigate, user, params = {} }) {
  const { job, loading, error } = useJob();
  const [w, setW] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [check, setCheck] = useState(null);
  const [groups, setGroups] = useState(null);
  const [held, setHeld] = useState(null);
  const jobId = job?.id || null;

  const show = useCallback(view => { if (view) setW(view); }, []);
  const readExtras = useCallback(() => {
    if (!jobId) return;
    // optional: the Zoho check, Zoho's error files and the vouchers in no file; nothing is said when they are not there
    api.get(`/migrations/${jobId}/zoho-check`).then(setCheck).catch(() => setCheck(null));
    api.get(`/migrations/${jobId}/rejections/groups`).then(setGroups).catch(() => setGroups(null));
    api.get(`/migrations/${jobId}/held-vouchers`).then(setHeld).catch(() => setHeld(null));
  }, [jobId]);
  const load = useCallback(async () => {
    if (!jobId) return;
    try { show(await api.get(`/migrations/${jobId}/import-wizard`)); setLoadError(''); } catch (e) { setLoadError(e.message); }
    readExtras();
  }, [jobId, show, readExtras]);
  useEffect(() => { load(); }, [load]);

  // act(fn, rethrow): runs one change. fn returns the new wizard (most routes answer with it), or nothing, and then
  // the wizard is read again. An error is shown at the top, or handed back (rethrow) to a file button that shows it.
  const act = useCallback(async (fn, rethrow = false) => {
    setActionError('');
    try {
      const view = await fn();
      if (view && view.steps) show(view); else await load();
      readExtras();
    } catch (e) {
      if (rethrow) throw e;
      setActionError(e.message);
    }
  }, [show, load, readExtras]);

  const canChange = !!w?.canChange && user?.role !== 'viewer';
  const available = !!w?.available;
  // the server's steps, with "Not in any file yet" before the trial balance comparison while vouchers are held
  const steps = available ? withHeldStep(w.steps, held?.available ? held : null) : [];
  // The step shown is in the address (#/import-wizard?step=customers), so the browser's Back and Forward move between
  // steps and a reload stays on the step. Without one, the step the server remembers is shown and put in the address.
  const current = available ? stepFromParams(steps, params, w.current) : null;
  const wantedStep = params.step;
  useEffect(() => {
    if (current && wantedStep !== current) onNavigate(WIZARD_SCREEN, { step: current }, { replace: true });
  }, [current, wantedStep, onNavigate]);
  useEffect(() => { if (current) document.getElementById('main-content')?.scrollTo(0, 0); }, [current]);
  // moving to a step: a new entry in the browser history, and remembered on the server (viewers move without saving)
  const go = useCallback(id => {
    onNavigate(WIZARD_SCREEN, { step: id });
    if (canChange && jobId && id !== HELD_STEP) api.put(`/migrations/${jobId}/import-wizard/current`, { step: id }).catch(() => {});
  }, [canChange, jobId, onNavigate]);

  const pos = available && current ? stepPosition(steps, current) : null;
  const step = pos?.step;
  const flow = flowPosition(WIZARD_SCREEN);

  const body = () => {
    if (!step) return null;
    const common = { step, job, canChange, act, check, groups, onNavigate, onGo: go, steps };
    if (step.kind === 'setup') return <SetupStep {...common} />;
    if (step.kind === 'bank') return <BankStep {...common} />;
    if (step.kind === 'date') return <DateStep {...common} />;
    if (step.kind === 'opening') return <OpeningStep {...common} />;
    if (step.kind === 'credits') return <CreditsStep {...common} />;
    if (step.kind === 'held') return <HeldStep {...common} onHeldChanged={h => (h ? setHeld(h) : readExtras())} />;
    if (step.kind === 'finish') return <FinishStep {...common} held={held} />;
    return <FileImport key={`body-${step.id}`} f={step} {...common} />;
  };

  return (
    <div className="min-h-full flex flex-col">
      <div className="flex-1 w-full p-6 md:p-8 max-w-6xl mx-auto space-y-6">
        {flow && <div className="text-[13px] text-muted">Guided flow: step {flow.index + 1} of {flow.total}, {flow.step.title}</div>}
        <JobHeader title="Import Wizard" subtitle="One step at a time: do what the step says in Zoho Books, then click Next."
          job={job} loading={loading} error={error || loadError || actionError} onNavigate={onNavigate}
          action={available ? <DownloadAllButton job={job} viewer={!canChange} onNavigate={onNavigate} /> : null} />

        {job && w && !available && (
          <Blocked title="No files to import yet" text={w.message} button="Open the Export Center" onClick={() => onNavigate(EXPORT_CENTER)} />
        )}

        {available && step && (
          <div className="grid grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)] gap-6">
            <StepList steps={steps} current={step.id} onGo={go} progress={w.progress} />
            <div className="space-y-4 min-w-0">
              <div>
                <div className="text-[13px] text-muted">Import step {pos.index + 1} of {pos.total}</div>
                <h2 className="text-[24px] font-semibold tracking-tight text-ink">{step.title}</h2>
                {!canChange && <p className="text-[14px] text-muted">View only: you can follow the steps but not tick or record anything.</p>}
              </div>
              {w.filesOutOfDate && step.kind === 'setup' && (
                <div className="p-4 rounded-md border border-warning-line bg-warning-soft text-[14px]">Some files are out of date. <button type="button" className="underline font-medium" onClick={() => onNavigate(EXPORT_CENTER)}>Create the files again</button> before importing them.</div>
              )}
              <LockBox key={`lock-${step.id}`} step={step} job={job} canChange={canChange} act={act} onGo={go} />
              {body()}
            </div>
          </div>
        )}
      </div>

      {(available && pos) ? (
        <PinnedStepBar index={pos.index} total={pos.total} title={step?.title}
          backLabel={pos.prev ? `Back: ${pos.prev.short || pos.prev.title}` : 'Back: create the files'}
          nextLabel={pos.next ? `Next: ${pos.next.short || pos.next.title}` : 'Open the Trial Balance comparison'}
          onBack={() => (pos.prev ? go(pos.prev.id) : onNavigate(EXPORT_CENTER, {}, { back: true }))}
          onNext={() => (pos.next ? go(pos.next.id) : goTo(onNavigate, TRIAL_BALANCE, 'trial-balance'))} />
      ) : (
        <PinnedStepBar index={0} total={1} title="Import Wizard" backLabel="Back: create the files" nextLabel="Open the Export Center"
          onBack={() => onNavigate(EXPORT_CENTER, {}, { back: true })} onNext={() => onNavigate(EXPORT_CENTER)} />
      )}
    </div>
  );
}
