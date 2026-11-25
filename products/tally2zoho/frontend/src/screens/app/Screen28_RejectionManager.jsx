import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, FileDown, TriangleAlert } from 'lucide-react';
import { api, useJob, goTo } from '../../api';
import JobHeader from '../../components/JobHeader';
import { sortByImportOrder } from '../../importWizard';
import { Blocked, Card, FileButton, Note, StatusChip, btnPrimary, btnSecondary, btnSmall, inputClass } from '../../components/ui';

const STATUS = { open: 'Needs a decision', corrected: 'Correction approved', retried: 'In the retry file', unlinked: 'Could not be linked' };

// The columns of the file a rejection belongs to. Each column is known by a fixed reference that stays the same
// when its heading is renamed. An older server sends the headings only.
const columnsOf = rej => (rej.columnDefs?.length
  ? rej.columnDefs.map(c => ({ ref: c.id, columnId: c.id, heading: c.heading, identifying: !!c.identifying, accounting: !!c.needsConfirmation }))
  : (rej.columns || []).map(h => ({ ref: h, columnId: null, heading: h, identifying: h === rej.idColumn, accounting: false })));
const valueOf = (row, col) => (col?.columnId != null && row?.valuesById ? row.valuesById[col.columnId] : row?.values?.[col?.heading]) ?? '';

function CorrectionForm({ rej, jobId, onSaved }) {
  const columns = columnsOf(rej);
  const [rowNo, setRowNo] = useState(rej.rows[0]?.rowNo);
  const [ref, setRef] = useState(columns[0]?.ref);
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [askConfirm, setAskConfirm] = useState(false); // the server asked for confirmation
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const row = rej.rows.find(r => r.rowNo === rowNo);
  const col = columns.find(c => c.ref === ref) || columns[0];
  const accounting = !!col?.accounting || askConfirm;
  const current = valueOf(row, col);
  // A line of a document is easiest to recognise by its account, when the file has one.
  const rowLabel = r => r.valuesById?.account ?? r.values?.Account ?? '';

  const pick = value => { setRef(value); setConfirmed(false); setAskConfirm(false); setError(''); };

  const save = async () => {
    setError(''); setBusy(true);
    try {
      await api.post(`/migrations/${jobId}/rejections/${rej.id}/corrections`, {
        rowNo, ...(col.columnId != null ? { columnId: col.columnId } : {}), column: col.heading, newValue, reason, confirmAccountingChange: accounting && confirmed,
      });
      setNewValue(''); setReason(''); setConfirmed(false); setAskConfirm(false);
      await onSaved();
    } catch (e) {
      if (e.data?.needsConfirmation) setAskConfirm(true);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!columns.length || !col) return null;
  return (
    <div className="mt-3 p-3 rounded-md bg-soft border border-line space-y-2">
      <div className="text-[14px] font-medium text-ink">Approve a correction</div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        {rej.rows.length > 1 && (
          <select value={rowNo} onChange={e => setRowNo(Number(e.target.value))} aria-label="Row" className={inputClass}>
            {rej.rows.map(r => <option key={r.rowNo} value={r.rowNo}>Row {r.rowNo}{rowLabel(r) ? `: ${rowLabel(r)}` : ''}</option>)}
          </select>
        )}
        <select value={col.ref} onChange={e => pick(e.target.value)} aria-label="Column" className={inputClass}>
          {columns.map(c => (
            <option key={c.ref} value={c.ref}>{c.heading}{c.identifying ? ' (identifies the record)' : ''}{c.accounting ? ' (accounting value)' : ''}</option>
          ))}
        </select>
        <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder={`New value (now: ${current || 'blank'})`} aria-label="New value" className={inputClass} />
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Reason" className={inputClass} />
      </div>
      {accounting && (
        <div className="p-3 rounded-xl border border-warning-line bg-warning-soft text-[14px] text-ink space-y-2">
          <div className="flex items-start gap-2">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.75} aria-hidden="true" />
            <span>
              <strong>"{col.heading}" carries an accounting value.</strong> Changing it changes what is posted in Zoho Books.
              Now: "{current || 'blank'}". After the correction: "{newValue || 'blank'}".
            </span>
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1 w-4 h-4 accent-action" />
            <span>I confirm that this change to an accounting value is approved.</span>
          </label>
        </div>
      )}
      {error && <div role="alert"><Note tone="danger">{error}</Note></div>}
      <button type="button" onClick={save} disabled={busy || (accounting && !confirmed)} className={btnSecondary}>{busy ? 'Saving…' : 'Approve correction'}</button>
    </div>
  );
}

// The columns could not be found by their headings: the user picks them and the same file is read again.
function ColumnPicker({ pick, onRead, onCancel }) {
  const [idColumn, setIdColumn] = useState(pick.headers.find(h => h === pick.idHeading) || '');
  const [errorColumn, setErrorColumn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const read = async () => {
    setBusy(true); setError('');
    try { await onRead({ idColumn, errorColumn }); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="px-4 py-3 border-b border-line text-[14px] space-y-2">
      <div className="text-ink"><strong>Choose the columns of "{pick.file.name}".</strong> {pick.error}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[13px] text-ink">Column that identifies the record (in your file: "{pick.idHeading}")</span>
          <select value={idColumn} onChange={e => setIdColumn(e.target.value)} className={inputClass}>
            <option value="">Choose…</option>
            {pick.headers.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[13px] text-ink">Column with Zoho's message</span>
          <select value={errorColumn} onChange={e => setErrorColumn(e.target.value)} className={inputClass}>
            <option value="">Choose…</option>
            {pick.headers.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
      </div>
      {error && <div role="alert"><Note tone="danger">{error}</Note></div>}
      <div className="flex gap-2">
        <button type="button" className={btnPrimary} disabled={busy || !idColumn || !errorColumn || idColumn === errorColumn} onClick={read}>{busy ? 'Reading…' : 'Read the file with these columns'}</button>
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

const FORMAT = { csv: 'CSV', xlsx: 'Excel (XLSX)', xls: 'Excel 97-2003 (XLS)' };

// Rejections grouped by cause, each with one suggested action and the place where it is fixed.
function Causes({ data, onNavigate }) {
  if (!data?.groups?.length) return null;
  return (
    <Card title="Rejections by cause" subtitle={`${data.rejected} rejected record(s) in ${data.groups.length} cause(s). Fix a cause once where it is decided, create the files again, then import the retry file.`}>
      {data.runs?.length > 0 && (
        <ul className="px-4 py-3 border-b border-line text-[14px] text-muted space-y-1">
          {data.runs.map(r => (
            <li key={r.key}>
              <span className="text-ink font-medium">{r.module}:</span> {r.fileName ? `"${r.fileName}", ` : ''}{FORMAT[r.format] || r.format}, headings on row {r.headerRow}.
              {' '}Identifying column "{r.idColumn}" ({r.how?.id}); error column "{r.errorColumn}" ({r.how?.error}).
              {r.how?.otherErrorColumns?.length > 0 && ` Other columns that could hold a message: ${r.how.otherErrorColumns.join(', ')}.`}
              {r.rowsWithoutIdentifier > 0 && ` ${r.rowsWithoutIdentifier} row(s) with a message but no identifier were not used.`}
            </li>
          ))}
        </ul>
      )}
      <div className="divide-y divide-line">
        {data.groups.map(g => (
          <div key={`${g.key}|${g.cause}`} className="p-4 text-[14px] flex flex-col md:flex-row md:items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-ink"><span className="font-semibold">{g.module}</span> · {g.records} record(s){g.open !== g.records ? `, ${g.open} still open` : ''}</div>
              <div className="text-ink mt-1">Zoho said, for example: "{g.example}"</div>
              <div className="text-[13px] text-subtle mt-0.5">Records: {g.idents.join(', ')}{g.records > g.idents.length ? ', …' : ''}</div>
              <div className="text-muted mt-1"><strong className="text-ink">Suggested:</strong> {g.action.words}</div>
            </div>
            {g.action.screen && (
              <button type="button" className={`${btnSecondary} ${btnSmall} shrink-0`} onClick={() => goTo(onNavigate, g.action.screen, g.action.anchor)}>
                Open {g.action.place} <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// Zoho's own error files explained by ROOT CAUSE (server: zohoerrors.js, explainErrorRows). Zoho gives one message
// per row; a line that only says "This error is related to Row N" is a follow-on of that row's real error; a row
// refused only because a name it uses was refused in an earlier file (an account in the Chart of Accounts) is a
// cascade: it imports as it is once the earlier file is fixed.
const plural = (k, word) => `${Number(k).toLocaleString('en-IN')} ${word}${k === 1 ? '' : 's'}`;
function Explained({ list, onNavigate }) {
  if (!list?.length) return null;
  return (
    <Card title="Zoho's error files, by root cause" subtitle="Each cause once, with the rows it explains. Follow-on rows (another line of the same document) and rows refused only because an earlier file was refused are counted apart.">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[14px]">
          <thead className="bg-soft border-b border-line text-[12px] uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="py-3 px-4 font-semibold text-right">Rows</th>
              <th scope="col" className="py-3 px-4 font-semibold">Cause</th>
              <th scope="col" className="py-3 px-4"><span className="sr-only">Fix</span></th>
            </tr>
          </thead>
          {list.map(f => (
            <tbody key={f.key} className="divide-y divide-line border-b border-line">
              <tr className="bg-soft">
                <td colSpan={3} className="py-2 px-4 text-[13px] text-muted">
                  <span className="font-semibold text-ink">{f.module}</span>: {plural(f.rows, 'error row')}; {plural(f.realErrors, 'real error')}, {plural(f.followOn, 'follow-on row')}
                  {f.cascadeRows ? `, ${plural(f.cascadeRows, 'row')} refused because of an earlier file` : ''}{f.unassigned ? `, ${plural(f.unassigned, 'row')} without a known cause` : ''}.
                  {f.note && <span className="block mt-1 font-medium text-ink">{f.note}</span>}
                </td>
              </tr>
              {f.causes.map(c => (
                <tr key={c.id}>
                  <td className="py-3 px-4 align-top text-right tabular-nums whitespace-nowrap">
                    {(c.rows + c.followOnRows).toLocaleString('en-IN')}
                    {c.followOnRows > 0 && <div className="text-[12px] text-muted">{c.followOnRows.toLocaleString('en-IN')} follow-on</div>}
                  </td>
                  <td className="py-3 px-4 align-top">
                    <div className="text-ink">
                      {c.cascade && <span className="mr-2"><StatusChip tone="warning">Because of {c.cascade.fromModule}</StatusChip></span>}
                      {!c.assigned && <span className="mr-2"><StatusChip>Unknown message</StatusChip></span>}
                      {c.meaning}
                    </div>
                    <div className="text-[13px] text-muted mt-0.5">
                      Zoho said: "{c.zohoMessage}"{c.column ? ` · column ${c.column}` : ''}{c.documents ? ` · ${plural(c.documents, 'document')}` : ''}
                      {c.rowNumbers?.length ? ` · rows ${c.rowNumbers.join(', ')}${c.rows > c.rowNumbers.length ? ', …' : ''}` : ''}
                    </div>
                    {c.names?.length > 0 && !c.cascade && <div className="text-[13px] mt-0.5"><span className="text-muted">{c.contact ? 'Name on the line' : 'Names'}:</span> {c.names.join('; ')}{c.nameCount > c.names.length ? ', …' : ''}</div>}
                    <div className="mt-1"><strong className="text-ink">Fix:</strong> <span className="text-muted">{c.fix}</span></div>
                  </td>
                  <td className="py-3 px-4 align-top text-right">
                    {c.place?.screen && (
                      <button type="button" className={`${btnSecondary} ${btnSmall} whitespace-nowrap`} onClick={() => goTo(onNavigate, c.place.screen, c.place.anchor, c.place.params)} title={c.place.label}>
                        Fix <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </Card>
  );
}

export default function Screen28_RejectionManager({ onNavigate, user }) {
  const readOnly = user?.role === 'viewer';
  const { job, loading, error } = useJob();
  const [files, setFiles] = useState([]);
  const [rejections, setRejections] = useState([]);
  const [groups, setGroups] = useState(null);
  const [pick, setPick] = useState(null); // { key, file, headers, idHeading, error }
  const [idHeadings, setIdHeadings] = useState({}); // per file: the heading of the identifying column as written in the file
  const [retry, setRetry] = useState({});
  const [actionError, setActionError] = useState('');
  const [importOrder, setImportOrder] = useState([]);

  const load = useCallback(async () => {
    if (!job) return;
    try {
      // one import order everywhere: the server's import list (the Import Wizard's order)
      const [list, order] = await Promise.all([api.get(`/migrations/${job.id}/files`), api.get(`/migrations/${job.id}/imports`).catch(() => [])]);
      setImportOrder(order);
      setFiles(sortByImportOrder(list, order));
      setRejections(await api.get(`/migrations/${job.id}/rejections`));
      setGroups(await api.get(`/migrations/${job.id}/rejections/groups`).catch(() => null));
      // The reconciliation summary names the identifying column of every created file. It is only used for the hint, so a failure is not an error.
      const v = await api.get(`/migrations/${job.id}/verification`).catch(() => []);
      setIdHeadings(Object.fromEntries((Array.isArray(v) ? v : []).filter(m => m.idColumn).map(m => [m.key, m.idColumn])));
    } catch (e) { setActionError(e.message); }
  }, [job]);
  useEffect(() => { load(); }, [load]);

  const makeRetry = async key => {
    setActionError('');
    try { const r = await api.post(`/migrations/${job.id}/rejections/${key}/retry`); setRetry(x => ({ ...x, [key]: r })); await load(); } catch (e) { setActionError(e.message); }
  };
  const byKey = rejections.reduce((m, r) => ((m[r.key] ||= []).push(r), m), {});
  // Sends an error file; when its columns cannot be found by heading, the column picker is shown instead of an error.
  const sendErrors = async (key, file, cols = null) => {
    const q = cols ? `?idColumn=${encodeURIComponent(cols.idColumn)}&errorColumn=${encodeURIComponent(cols.errorColumn)}` : '';
    try {
      await api.sendFile(`/migrations/${job.id}/rejections/${key}${q}`, file);
      setPick(null); setRetry(x => ({ ...x, [key]: null }));
      await load();
    } catch (e) {
      if (e.data?.needsColumns && !cols) { setPick({ key, file, headers: e.data.headers || [], idHeading: e.data.idHeading || idHeadings[key] || '', error: e.message }); return; }
      throw e;
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <JobHeader
        title="Rejection Manager"
        subtitle="Upload the error file Zoho Books gives you. Fix only the rejected records and get a retry file."
        job={job} loading={loading} error={error || actionError} onNavigate={onNavigate}
      />
      <details className="group">
        <summary className="cursor-pointer text-[14px] font-medium text-info-ink rounded-sm focus-visible:outline-2 focus-visible:outline-brand">How this page reads Zoho's error file</summary>
        <div className="mt-2">
      <Note>
        <strong className="text-ink">File format.</strong> Zoho's own error file (ROWNUMBER, ERRORMESSAGE, then the columns of the file you imported) is known from a real import, and is also explained by root cause below.
        Other layouts are read as follows. The file may be CSV or Excel (XLSX or XLS). The heading row may be below a title. The column that identifies each record is found by its heading as written in the file
        you imported, and the message by a heading that contains "error", "reason", "message" or "remark". If either cannot be found, you choose the columns, and the columns used are always shown.
        <div className="mt-2">
          <strong className="text-ink">Grouped by cause.</strong> Rejections with the same message (apart from names, numbers and other values of the record) are one cause.
          Each cause has one suggested action and a button to the place where it is fixed. Fixing a cause there changes only what is written to the Zoho files.
        </div>
        <div className="mt-2">
          <strong className="text-ink">When a file is created again.</strong> If a file is created again and its contents are different,
          its rejections, approved corrections and retry file are removed, because they belong to the earlier file. Reading the data again removes them for every file.
          Each removal is recorded in the audit log.
        </div>
      </Note>
        </div>
      </details>

      {job && files.length === 0 && <Blocked title="No files generated yet" text="Rejections are linked to generated files." button="Open Export Center" onClick={() => onNavigate('screen-25')} />}

      {job && <Explained list={groups?.explained ? sortByImportOrder(groups.explained, importOrder) : null} onNavigate={onNavigate} />}

      {job && <Causes data={groups} onNavigate={onNavigate} />}

      {job && files.map(f => {
        const list = byKey[f.key] || [];
        const linked = list.filter(r => r.status !== 'unlinked');
        const idHeading = idHeadings[f.key] || list[0]?.idColumn;
        return (
          <Card key={f.key} title={f.module} subtitle={list.length ? `${list.length} rejected record(s), ${linked.length} linked to Tally records` : `${f.fileName}: no error file uploaded`}
            right={
              <div className="flex flex-wrap items-start gap-2">
                {!readOnly && <FileButton label="Upload Zoho error file" accept=".csv,.xlsx,.xls,text/csv" onFile={file => sendErrors(f.key, file)} />}
                {!readOnly && linked.length > 0 && <button type="button" onClick={() => makeRetry(f.key)} className={btnPrimary}>Generate retry file</button>}
              </div>
            }>
            {pick?.key === f.key && <ColumnPicker pick={pick} onRead={cols => sendErrors(f.key, pick.file, cols)} onCancel={() => setPick(null)} />}
            {idHeading && (
              <div className="px-4 py-3 border-b border-line text-[14px] text-muted">
                The column that identifies each record is looked for under the heading <strong className="text-ink">"{idHeading}"</strong>, as written in {f.fileName}. If Zoho's file names it differently, you choose it.
                {f.outOfDate && <span className="text-ink"> This file is out of date. When it is created again with different contents, the rejections below are removed.</span>}
              </div>
            )}
            {retry[f.key] && (
              <div className="px-4 py-3 border-b border-line flex flex-wrap items-center justify-between gap-2 text-[14px]">
                <span className="text-ink">Retry file ready: {retry[f.key].records} record(s), {retry[f.key].rows} row(s), {retry[f.key].corrections} correction(s) applied. Other records are untouched.</span>
                <a href={`/api/migrations/${job.id}/rejections/${f.key}/retry/download`} className={btnSecondary}><FileDown className="w-4 h-4" aria-hidden="true" /> Download {retry[f.key].fileName}</a>
              </div>
            )}
            <div className="divide-y divide-line">
              {list.map(r => (
                <div key={r.id} className="p-4 text-[14px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{r.ident}</span>
                    <StatusChip tone={r.status === 'unlinked' ? 'warning' : 'info'}>{STATUS[r.status]}</StatusChip>
                  </div>
                  <div className="text-ink mt-1">Zoho said: {r.error}</div>
                  <div className="text-muted"><strong className="text-ink">{r.category}.</strong> {r.suggestion}</div>
                  {r.status === 'unlinked'
                    ? <div className="text-muted mt-1">No record with this identifier is in the generated file, so it cannot be traced to Tally.</div>
                    : <div className="text-subtle mt-1">Tally record: {r.sourceName} · <span className="font-mono text-[13px]">{r.sourceId}</span> · file row(s) {r.rows.map(x => x.rowNo).join(', ')}</div>}
                  {r.rows.flatMap(x => x.corrections.map(c => (
                    <div key={`${x.rowNo}|${c.columnId ?? c.column}`} className="mt-1 text-ink">
                      Approved: row {x.rowNo}, {c.column}: "{c.original || 'blank'}" changed to "{c.newValue || 'blank'}". Reason: {c.reason}. By {c.approver}.
                    </div>
                  )))}
                  {r.status !== 'unlinked' && !readOnly && <CorrectionForm rej={r} jobId={job.id} onSaved={load} />}
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
