import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, CircleCheck, ChevronRight, FileDown } from 'lucide-react';
import { api, downloadFile, useJob, goTo } from '../../api';
import JobHeader from '../../components/JobHeader';
import OutOfDateBanner, { readableWhen } from '../../components/OutOfDateBanner';
import { Blocked, Card, EmptyState, Note, StatTile, StatusChip, btnSecondary, btnSmall } from '../../components/ui';
import { contactFilterForRule } from '../../mappingLogic';
import { HeldNotice } from '../../components/HeldNotice';
import PreSteps from '../../components/PreSteps';

// The Zoho check: every rule Zoho Books applies when it imports a file, applied by the tool to every row of every
// file BEFORE it is downloaded (server: zohocheck.js and zohocheckapi.js). One table of files, then the problems
// grouped by cause, each with its count, why, how sure we are, and a button to the screen where it is fixed.

export const ZOHO_CHECK_SCREEN = 'screen-38';
const n = v => Number(v || 0).toLocaleString('en-IN');
const pct = v => `${Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;

// will: blocks the import (confirmed by our import or by Zoho's documentation); may: blocks only if an assumed rule
// holds; warning: Zoho accepts the row.
const TIER = {
  will: { label: 'Will be refused', tone: 'danger' },
  may: { label: 'May be refused', tone: 'warning' },
  warning: { label: 'Warning', tone: 'neutral' },
};
export const TierBadge = ({ tier }) => (
  <StatusChip tone={(TIER[tier] || TIER.warning).tone} dot>{TIER[tier]?.label || tier}</StatusChip>
);

// The rows behind one cause of one file, a page at a time.
function CauseRows({ jobId, file, cause }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stop = false;
    setError('');
    api.get(`/migrations/${jobId}/zoho-check/rows?file=${encodeURIComponent(file)}&cause=${encodeURIComponent(cause)}&page=${page}&pageSize=25`)
      .then(d => { if (!stop) setData(d); }).catch(e => { if (!stop) setError(e.message); });
    return () => { stop = true; };
  }, [jobId, file, cause, page]);
  if (error) return <Note tone="danger">{error}</Note>;
  if (!data) return <div role="status" className="text-[13px] text-muted">Loading the rows…</div>;
  if (data.wholeFile && !data.total) return <div className="text-[13px] text-muted">This is about the file as a whole, not about single rows.</div>;
  const cols = data.columns.filter(c => c !== data.idColumn);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-soft text-[12px] uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="py-2 px-3 font-semibold whitespace-nowrap">Row</th>
              {data.idColumn && <th scope="col" className="py-2 px-3 font-semibold whitespace-nowrap">{data.idColumn}</th>}
              {cols.map(c => <th key={c} scope="col" className="py-2 px-3 font-semibold whitespace-nowrap">{c}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.rows.map(r => (
              <tr key={`${r.rowNumber}|${r.column}`}>
                <td className="py-2 px-3 tabular-nums">{r.rowNumber}</td>
                {data.idColumn && <td className="py-2 px-3 break-all">{r.ident}</td>}
                {cols.map(c => (
                  <td key={c} className={`py-2 px-3 break-all ${c === r.column ? 'font-semibold text-ink' : 'text-muted'}`}>
                    {c in r.values ? (r.values[c] === '' ? <span className="italic">empty</span> : r.values[c]) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <span>Row numbers count the heading as row 1, as Zoho's error file does. {n(data.total)} row(s){data.pages > 1 ? `, page ${data.page} of ${data.pages}` : ''}.</span>
        {data.pages > 1 && (
          <>
            <button type="button" className={`${btnSecondary} ${btnSmall}`} disabled={data.page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <button type="button" className={`${btnSecondary} ${btnSmall}`} disabled={data.page >= data.pages} onClick={() => setPage(p => p + 1)}>Next</button>
          </>
        )}
      </div>
    </div>
  );
}

// One cause, collapsed to a line; opened, it says why, how to fix it, how sure the rule is, and shows the rows.
function CauseRow({ c, jobId, open, onToggle, onFix, fileFilter }) {
  const files = fileFilter ? c.files.filter(f => f.key === fileFilter) : c.files;
  const [fileKey, setFileKey] = useState(files[0]?.key);
  const shownFile = files.find(f => f.key === fileKey) || files[0];
  const rows = files.reduce((t, f) => t + f.rows, 0);
  const docs = files.reduce((t, f) => t + (f.hasDocuments ? f.documents : 0), 0);
  const fixHere = c.place?.screen === ZOHO_CHECK_SCREEN;
  return (
    <>
      <tr className={`cursor-pointer hover:bg-soft ${open ? 'bg-soft' : ''}`} onClick={onToggle}>
        <td className="py-3 pl-4 pr-1 align-top w-6">
          <button type="button" aria-expanded={open} aria-label={open ? 'Hide the details' : 'Show the details'} onClick={e => { e.stopPropagation(); onToggle(); }} className="text-ink">
            {open ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
          </button>
        </td>
        <td className="py-3 px-3 align-top"><TierBadge tier={c.tier} /></td>
        <td className="py-3 px-3 align-top text-right tabular-nums whitespace-nowrap">{n(rows)}{docs ? <div className="text-[12px] text-muted">{n(docs)} doc.</div> : null}</td>
        <td className="py-3 px-3 align-top min-w-0">
          <div className="text-ink line-clamp-2">{c.message}</div>
          <div className="text-[12px] text-muted mt-0.5">{files.map(f => f.module).join(', ')} · {c.evidenceLabel}</div>
        </td>
        <td className="py-3 px-4 align-top text-right">
          {c.place?.screen && (
            <button type="button" className={`${btnSecondary} ${btnSmall} whitespace-nowrap`} onClick={e => { e.stopPropagation(); onFix(c); }}>
              {fixHere ? 'See cause' : 'Fix'} <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="px-4 pb-4 pt-0 bg-soft">
            <div className="pt-3 space-y-3 text-[14px]">
              <div><span className="font-semibold text-ink">Why. </span>{c.message}</div>
              <div><span className="font-semibold text-ink">Fix. </span>{c.fix}{c.place?.label ? ` (${c.place.label})` : ''}</div>
              {c.tdsTaxes?.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="text-left text-[13px] rounded-xl border border-line bg-white">
                    <caption className="text-left font-semibold text-ink pb-1">TDS taxes to create in Zoho Books, with exactly these names</caption>
                    <thead className="bg-soft text-[12px] uppercase tracking-wide text-muted"><tr><th scope="col" className="py-2 px-3 font-semibold">TDS Name</th><th scope="col" className="py-2 px-3 font-semibold">Section</th><th scope="col" className="py-2 px-3 font-semibold text-right">Rate</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {c.tdsTaxes.map(t => (
                        <tr key={t.name}><td className="py-2 px-3 font-medium text-ink">{t.name}</td><td className="py-2 px-3">{t.section || '–'}</td><td className="py-2 px-3 text-right tabular-nums">{t.rate ? `${t.rate}%` : '–'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="text-[13px] text-muted">
                Rule {c.ruleId}{c.columns?.length ? `, column ${c.columns.join(', ')}` : ''}. How sure: {c.evidenceLabel}.
                {c.tier === 'may' && ' The rule is not confirmed, so Zoho may accept these rows.'}
                {c.tier === 'warning' && ' Zoho is expected to accept these rows; check that the result is what you want.'}
                {c.sourceUrl && <> <a className="underline text-ink" href={c.sourceUrl} target="_blank" rel="noreferrer">Zoho's page</a>.</>}
              </div>
              {files.length > 1 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="File">
                  {files.map(f => (
                    <button key={f.key} type="button" onClick={() => setFileKey(f.key)} aria-pressed={f.key === shownFile?.key}
                      className={`px-3 py-1 rounded-full border text-[13px] ${f.key === shownFile?.key ? 'border-action bg-action text-white' : 'border-line-strong bg-white text-ink'}`}>
                      {f.module} · {n(f.rows)}
                    </button>
                  ))}
                </div>
              )}
              {shownFile && <CauseRows key={`${shownFile.key}|${shownFile.cause}`} jobId={jobId} file={shownFile.key} cause={shownFile.cause} />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// params.file: opened for one file (from the Export Center), showing only its problems.
export default function ZohoCheck({ onNavigate, user, params }) {
  const { job, loading, error, reload } = useJob();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!job) return;
    setLoadError('');
    try { setData(await api.get(`/migrations/${job.id}/zoho-check`)); } catch (e) { setLoadError(e.message); }
  }, [job]);
  useEffect(() => { load(); }, [load]);

  const downloadCsv = async () => {
    setBusy(true); setLoadError('');
    try { await downloadFile(`/api/migrations/${job.id}/zoho-check/findings.csv`, `zoho_check_${job.id}.csv`); } catch (e) { setLoadError(e.message); } finally { setBusy(false); }
  };
  const ready = data?.available;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <JobHeader
        title="Zoho check"
        subtitle="Every row of every Zoho file checked against the rules Zoho Books applies on import, before you download."
        job={job} loading={loading} error={error || loadError} onNavigate={onNavigate}
        action={ready && (
          <button type="button" onClick={downloadCsv} disabled={busy} className={btnSecondary}>
            <FileDown className="w-4 h-4" aria-hidden="true" /> {busy ? 'Downloading…' : 'All findings (CSV)'}
          </button>
        )}
      />

      <OutOfDateBanner job={job} user={user} onDone={async () => { await reload(); await load(); }} onNavigate={onNavigate} />

      {job && data && !ready && (
        <Blocked title="No files to check yet" text={data.message} button="Open Export Center" onClick={() => onNavigate('screen-25')} />
      )}

      {ready && <HeldNotice job={job} onNavigate={onNavigate} lead="The check covers the rows in the files only." />}

      {ready && <ZohoCheckResults data={data} jobId={job.id} initialFile={params?.file || ''} onNavigate={onNavigate} />}
    </div>
  );
}

// The result of the check: the files table, then the problems by cause. data: GET /migrations/:id/zoho-check.
export function ZohoCheckResults({ data, jobId, initialFile = '', onNavigate }) {
  const [open, setOpen] = useState(null);
  const [fileFilter, setFileFilter] = useState(initialFile);
  const [warnings, setWarnings] = useState(false);
  const problems = useRef(null);
  const toProblems = () => setTimeout(() => problems.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  const showFile = key => { setFileFilter(key); setOpen(null); toProblems(); };
  // a cascade is fixed in the file it comes from: this screen shows that file's own causes
  // Fix: the section goes in the address (Mapping Studio scrolls there once it has loaded), with the Fix contacts filter
  // that lists the contacts of this rule
  const fix = c => {
    if (c.place.screen === ZOHO_CHECK_SCREEN) return showFile(c.cascadeFrom || '');
    const filter = c.place.anchor === 'ms-fix-contacts' || c.place.screen === 'screen-19' ? contactFilterForRule(c.ruleId) : '';
    // place.params: the address of the place itself (for example the Import Wizard's set-up step for TDS taxes)
    const params = { ...(c.place.params || {}), ...(c.place.anchor ? { section: c.place.anchor, ...(filter ? { filter } : {}) } : {}) };
    return goTo(onNavigate, c.place.screen, c.place.anchor, params);
  };
  // opened for one file: start at its problems
  useEffect(() => { if (initialFile) toProblems(); }, [initialFile]);
  const inFile = c => !fileFilter || c.files.some(f => f.key === fileFilter);
  const causes = data.causes.filter(c => (warnings || c.tier !== 'warning') && inFile(c));
  const hiddenWarnings = data.causes.filter(c => c.tier === 'warning' && inFile(c)).length;
  const o = data.overall;

  return (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Rows expected to import" value={`${n(o.rows - o.rowsWill)} of ${n(o.rows)}`} tone={o.rowsWill ? 'warning' : 'success'}
              hint={o.rowsMay ? `${pct(o.percentRowsLow)} to ${pct(o.percentRows)}` : pct(o.percentRows)} />
            <StatTile label="Rows that will be refused" value={n(o.rowsWill)} tone={o.rowsWill ? 'danger' : 'success'} />
            <StatTile label="Rows that may be refused" value={n(o.rowsMay)} tone={o.rowsMay ? 'warning' : undefined} hint={o.rowsMay ? 'Only if rules that are not confirmed apply' : undefined} />
            <StatTile label="Documents expected to import" value={`${n(o.documents - o.docsWill)} of ${n(o.documents)}`} hint={pct(o.percentDocuments)} />
          </div>
          <p className="text-[13px] text-muted">
            Checked {readableWhen(data.checkedAt)}{data.outOfDate ? ', for files that are now out of date' : ''}; {n(data.rulesApplied)} rules on every row.
          </p>

          <PreSteps source={data.preSteps} onSee={p => { setWarnings(true); setFileFilter(p.files[0] || ''); setOpen(p.id); toProblems(); }} />

          <Card title="Files" subtitle="Select a file to see only its problems.">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead className="bg-soft border-b border-line text-[13px] text-muted">
                  <tr>
                    <th scope="col" className="py-3 px-4 font-semibold">File</th>
                    <th scope="col" className="py-3 px-4 font-semibold text-right">Rows</th>
                    <th scope="col" className="py-3 px-4 font-semibold text-right">Expected to import</th>
                    <th scope="col" className="py-3 px-4 font-semibold text-right">May be refused</th>
                    <th scope="col" className="py-3 px-4 font-semibold text-right">Will be refused</th>
                    <th scope="col" className="py-3 px-4 font-semibold text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.files.map(f => (
                    <tr key={f.key} id={`zc-file-${f.key}`} tabIndex={0} onClick={() => showFile(fileFilter === f.key ? '' : f.key)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showFile(fileFilter === f.key ? '' : f.key); } }}
                      className={`cursor-pointer hover:bg-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${fileFilter === f.key ? 'bg-soft' : ''}`}>
                      <td className="py-3 px-4">
                        <div className={`text-ink ${fileFilter === f.key ? 'font-semibold' : 'font-medium'}`}>{f.module}</div>
                        <div className="text-[12px] text-muted">{f.hasDocuments ? `${n(f.documents)} documents` : f.fileName}{f.outOfDate ? ' · out of date' : ''}</div>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">{n(f.rows)}</td>
                      <td className="py-3 px-4 text-right tabular-nums">{n(f.rowsOk)}</td>
                      <td className="py-3 px-4 text-right tabular-nums">{f.rowsMay ? n(f.rowsMay) : '–'}</td>
                      <td className={`py-3 px-4 text-right tabular-nums ${f.rowsWill ? 'font-semibold' : ''}`}>{f.rowsWill ? n(f.rowsWill) : '–'}</td>
                      {/* with rows that may be refused the share is a range: certain to import, up to expected to import */}
                      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">{f.rowsMay ? `${pct(f.percentLow)} to ${pct(f.percent)}` : pct(f.percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.filesNotChecked?.length > 0 && (
              <div className="px-4 py-3 border-t border-line text-[13px] text-muted">Not checked: {data.filesNotChecked.map(f => `${f.module} (${f.reason.replace(/\.$/, '')})`).join('; ')}.</div>
            )}
          </Card>

          {data.notes?.length > 0 && (
            <Card title="Good to know" subtitle="These are not problems. Zoho accepts these rows; nothing here is refused.">
              <ul className="divide-y divide-line text-[14px]">
                {data.notes.map(note => (
                  <li key={`${note.file}-${note.rule}`} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <span><strong>{note.module}:</strong> {note.words}</span>
                    {note.place?.screen && (
                      <button type="button" className="underline text-ink shrink-0 text-left" onClick={() => goTo(onNavigate, note.place.screen, note.place.anchor, note.place.params || {})}>{note.place.label || 'Open'}</button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div ref={problems} className="scroll-mt-4">
            <Card
              title={fileFilter ? `Problems in ${data.files.find(f => f.key === fileFilter)?.module || fileFilter}` : 'Problems by cause'}
              subtitle="Zoho reports only one error per row; this check applies every rule. Fix a cause once, then create the files again."
              right={(
                <div className="flex flex-wrap items-center gap-3 text-[14px]">
                  {fileFilter && <button type="button" className="underline text-ink" onClick={() => setFileFilter('')}>All files</button>}
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={warnings} onChange={e => setWarnings(e.target.checked)} className="w-4 h-4 accent-action" />
                    <span>Also show warnings, rows Zoho accepts ({n(hiddenWarnings)})</span>
                  </label>
                </div>
              )}>
              {causes.length === 0 ? (
                <EmptyState icon={CircleCheck} title={hiddenWarnings && !warnings ? 'Nothing Zoho is expected to refuse' : 'No problems found'} text={hiddenWarnings && !warnings ? 'Tick the warnings box above to see the rest.' : 'You can go on and download the files.'} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[14px]">
                    <thead className="bg-soft border-b border-line text-[13px] text-muted">
                      <tr>
                        <th scope="col" className="py-3 pl-4 pr-1"><span className="sr-only">Details</span></th>
                        <th scope="col" className="py-3 px-3 font-semibold">Outcome</th>
                        <th scope="col" className="py-3 px-3 font-semibold text-right">Rows</th>
                        <th scope="col" className="py-3 px-3 font-semibold">Cause</th>
                        <th scope="col" className="py-3 px-4"><span className="sr-only">Fix</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {causes.map(c => (
                        <CauseRow key={`${c.id}|${fileFilter}`} c={c} jobId={jobId} open={open === c.id} onToggle={() => setOpen(x => (x === c.id ? null : c.id))} onFix={fix} fileFilter={fileFilter} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <p className="text-[13px] text-muted">
            Will be refused: the rule was confirmed by our own import or is stated by Zoho. May be refused: the rule is assumed, or only Zoho Books can confirm it (for example a tax name that must exist there).
            A document (invoice, bill, journal) is refused as a whole when one of its lines is. A row that names an account, contact or item refused in an earlier file is refused too; fix the earlier file.
            {' '}Rules version {data.rulesVersion} ({data.rulesDate}); {n(data.rulesNotAboutTheFile)} rules are about Zoho Books settings, not the file, and are not checked here.
          </p>
        </>
  );
}
