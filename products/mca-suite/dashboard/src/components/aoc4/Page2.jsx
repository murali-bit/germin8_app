import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Paperclip, Upload, Trash2, AlertTriangle, RefreshCw } from 'lucide-react';
import {
  listAttachments, uploadAttachment, deleteAttachment, attachmentContentUrl, fmtMb, MAX_MB, MCA_LIMIT_MB,
} from '../../lib/attachmentsApi.js';
import FieldRow from './FieldRow.jsx';
import { isBlank, isRequired, page2Fields, normDate, isFutureDate } from './aoc4Data.js';

// Page 2 problems beyond the per-field format checks.
export function page2Problems(values) {
  const out = {};
  const d = normDate(values.BOARD_RESOLUTION_DATE);
  if (d && isFutureDate(d)) out.BOARD_RESOLUTION_DATE = 'The date cannot be after today';
  return out;
}

export function page2Stats(valueOf) {
  const fields = page2Fields({ DECL_DESIGNATION: valueOf('DECL_DESIGNATION') });
  let filled = 0, missing = 0;
  for (const f of fields) {
    if (!isBlank(valueOf(f.key))) filled++;
    else if (isRequired(f, valueOf)) missing++;
  }
  return { filled, missing, total: fields.length };
}

const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

const fmtWhen = s => {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (/[zZ+]/.test(String(s)) ? '' : 'Z'));
  return isNaN(d) ? String(s) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// Checks before reading a file into memory: PDF only, at most 10 MB.
function checkFile(f) {
  if (!f) return 'No file chosen';
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return `${f.name}: only PDF files can be attached`;
  if (f.size > MAX_MB * 1048576) return `${f.name} is ${fmtMb(f.size)} — the limit is ${MAX_MB} MB. Compress it first.`;
  return '';
}

function FileLine({ a, onRemove, busy }) {
  const over = a.size > MCA_LIMIT_MB[a.slot] * 1048576;
  return (
    <li className="rounded-lg border border-line bg-white px-3 py-2">
      <div className="flex items-center gap-2 text-sm min-w-0">
        <FileText className="w-4 h-4 text-gold-600 shrink-0" />
        <a href={attachmentContentUrl(a.id)} target="_blank" rel="noreferrer" className="text-ink font-medium truncate hover:underline" title={a.fileName}>{a.fileName}</a>
        <span className="text-[11px] text-ink-muted shrink-0">{fmtMb(a.size)} · {fmtWhen(a.createdAt)}</span>
        <button type="button" onClick={() => onRemove(a)} disabled={busy}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-muted hover:text-rose-700 hover:border-rose-200 disabled:opacity-50 shrink-0">
          <Trash2 className="w-3 h-3" /> Remove
        </button>
      </div>
      {over && (
        <p className="mt-1 text-[11px] text-amber-700 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0" /> {a.warning || `MCA accepts at most ${MCA_LIMIT_MB[a.slot]} MB for (${a.slot}). Compress it, or MCA will refuse it.`}
        </p>
      )}
    </li>
  );
}

function PickButton({ multiple, disabled, onFiles, children }) {
  const ref = useRef(null);
  return (
    <>
      <input ref={ref} type="file" accept="application/pdf,.pdf" multiple={multiple} className="hidden"
        onChange={e => { const fs = [...(e.target.files || [])]; e.target.value = ''; if (fs.length) onFiles(fs); }} />
      <button type="button" disabled={disabled} onClick={() => ref.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-gold-50 disabled:opacity-50 disabled:cursor-not-allowed">
        <Upload className="w-3.5 h-3.5" /> {children}
      </button>
    </>
  );
}

// (a) one PDF and any number of (g) PDFs, stored with the company; the extension uploads them on MCA page 2.
function AttachmentsCard({ cin, jobId, onChange }) {
  const valid = CIN_RE.test(cin || '');
  const [list, setList] = useState([]);
  const [state, setState] = useState({ loading: false, error: null });
  const [busy, setBusy] = useState(null);           // 'a' | 'g' | attachment id
  const [note, setNote] = useState(null);           // {tone, text}
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const load = useCallback(async () => {
    if (!valid) { setList([]); onChangeRef.current?.(null); return; }
    setState({ loading: true, error: null });
    try {
      const l = await listAttachments(cin);
      setList(l); onChangeRef.current?.(l);
      setState({ loading: false, error: null });
    } catch (err) {
      setState({ loading: false, error: `Attachments could not be loaded (${err.message || 'backend offline'}).` });
    }
  }, [cin, valid]);

  useEffect(() => { setNote(null); load(); }, [load]);

  const upload = async (slot, files) => {
    const bad = files.map(checkFile).filter(Boolean);
    const good = files.filter(f => !checkFile(f));
    setNote(bad.length ? { tone: 'error', text: bad.join(' · ') } : null);
    if (!good.length) return;
    setBusy(slot);
    const warnings = [];
    try {
      for (const file of slot === 'a' ? good.slice(0, 1) : good) {
        const r = await uploadAttachment({ cin, jobId, slot, file });
        if (r.warning) warnings.push(`${file.name}: ${r.warning}`);
        if (r.duplicate) warnings.push(`${file.name} was already attached — kept once.`);
      }
      if (!bad.length) setNote(warnings.length ? { tone: 'warn', text: warnings.join(' · ') } : { tone: 'ok', text: slot === 'a' ? '(a) uploaded.' : `${good.length} file(s) added to (g).` });
    } catch (err) {
      setNote({ tone: 'error', text: `Upload failed: ${err.message}` });
    } finally {
      setBusy(null);
      load();
    }
  };

  const remove = async a => {
    if (!window.confirm(`Remove ${a.fileName} from this company's attachments?`)) return;
    setBusy(a.id); setNote(null);
    try { await deleteAttachment(a.id); }
    catch (err) { setNote({ tone: 'error', text: `Could not remove: ${err.message}` }); }
    finally { setBusy(null); load(); }
  };

  const fileA = list.find(x => x.slot === 'a');
  const filesG = list.filter(x => x.slot === 'g');
  const off = !valid || !!busy;

  return (
    <section className="bg-surface border border-line rounded-xl shadow-sm p-5">
      <div className="flex items-start gap-2 justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><Paperclip className="w-4 h-4 text-gold-600" /> Attachments</h3>
          <p className="text-xs text-ink-muted mt-1">These go to MCA when the extension runs page 2. A file picked in the extension's side panel is used instead of these.</p>
        </div>
        {valid && (
          <button type="button" onClick={load} title="Refresh" className="p-1.5 rounded-lg border border-line bg-white text-ink-muted hover:bg-gold-50">
            <RefreshCw className={state.loading ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} />
          </button>
        )}
      </div>

      {!valid && <p className="mt-3 text-xs text-amber-700 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Enter a valid CIN on Page 1 first — attachments are kept per company.</p>}
      {state.error && <p className="mt-3 text-xs text-rose-700">{state.error}</p>}

      <div className="mt-4 space-y-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="font-mono text-xs text-gold-700 bg-gold-50 border border-gold-200 rounded px-1.5 py-0.5 shrink-0">(a)</span>
            <span className="text-sm text-ink">Financial statements + auditor's report + Board's report, one PDF</span>
            <span className="ml-auto text-[11px] font-medium text-rose-700 shrink-0">Required · max {MCA_LIMIT_MB.a} MB on MCA</span>
          </div>
          {fileA
            ? <ul><FileLine a={fileA} onRemove={remove} busy={off} /></ul>
            : valid && !state.loading && <p className="text-xs text-ink-muted mb-2">No (a) PDF yet.</p>}
          <div className="mt-2">
            <PickButton disabled={off} onFiles={fs => upload('a', fs)}>{busy === 'a' ? 'Uploading…' : fileA ? 'Replace (a)' : 'Choose the (a) PDF'}</PickButton>
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="font-mono text-xs text-gold-700 bg-gold-50 border border-gold-200 rounded px-1.5 py-0.5 shrink-0">(g)</span>
            <span className="text-sm text-ink">Any other attachment</span>
            <span className="ml-auto text-[11px] text-ink-subtle shrink-0">Optional · max {MCA_LIMIT_MB.g} MB each on MCA</span>
          </div>
          {filesG.length > 0 && <ul className="space-y-2">{filesG.map(a => <FileLine key={a.id} a={a} onRemove={remove} busy={off} />)}</ul>}
          <div className="mt-2">
            <PickButton multiple disabled={off} onFiles={fs => upload('g', fs)}>{busy === 'g' ? 'Uploading…' : 'Add PDFs'}</PickButton>
          </div>
        </div>
      </div>

      {note && (
        <p className={note.tone === 'ok' ? 'mt-3 text-xs text-emerald-700' : note.tone === 'warn' ? 'mt-3 text-xs text-amber-700' : 'mt-3 text-xs text-rose-700'}>{note.text}</p>
      )}
      <p className="mt-3 text-[11px] text-ink-subtle">(b) Board's report and (c) auditor's report go inside (a). The extension never removes a file already attached on MCA.</p>
    </section>
  );
}

export default function Page2({ valueOf, sourceOf, edits, onEdit, suggestions, cin, jobId, onAttachmentsChange }) {
  const fields = page2Fields({ DECL_DESIGNATION: valueOf('DECL_DESIGNATION') || 'Director' });
  const extra = page2Problems(Object.fromEntries(fields.map(f => [f.key, valueOf(f.key)])));
  const decl = fields.filter(f => !f.key.startsWith('CERT_'));
  const cert = fields.filter(f => f.key.startsWith('CERT_'));

  const row = f => (
    <div key={f.key}>
      <FieldRow field={f} value={valueOf(f.key)} required={isRequired(f, valueOf)} source={sourceOf(f.key)}
        dirty={Object.prototype.hasOwnProperty.call(edits, f.key)} onChange={v => onEdit(f.key, v)}
        suggestion={suggestions[f.key]} onUseSuggestion={() => onEdit(f.key, suggestions[f.key].value)} />
      {extra[f.key] && <p className="mt-1 text-[11px] text-rose-700">{extra[f.key]}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      <AttachmentsCard cin={cin} jobId={jobId} onChange={onAttachmentsChange} />

      <section className="bg-surface border border-line rounded-xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><FileText className="w-4 h-4 text-gold-600" /> Declaration</h3>
        <p className="text-xs text-ink-muted mt-1 mb-3">Also used by AOC-2 and the report extracts — saved once in the company master.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{decl.map(row)}</div>
      </section>

      <section className="bg-surface border border-line rounded-xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-ink">Certificate by the professional</h3>
        <p className="text-xs text-ink-muted mt-1 mb-3">The practising professional who certifies the form.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{cert.map(row)}</div>
      </section>
    </div>
  );
}
