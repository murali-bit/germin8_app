import React, { useState } from 'react';
import { ArrowRight, Download, TriangleAlert } from 'lucide-react';
import { api, downloadFile } from '../api';
import { WIZARD_SCREEN, refusedFiles, refusedWords, downloadAddress } from '../importWizard';

const ZOHO_CHECK_SCREEN = 'screen-38';
import { btnPrimary, btnSecondary } from './ui';

// "Create files" is the same button wherever it is shown (top of the Export Center, bottom of the Export Center,
// Prepare migration). After the files exist, one next action is offered: start the import wizard.

// The button itself. canCreate: the data is processed and nothing blocks; hasFiles: files exist already.
// onDone(result) after the files were created; onError(error) when the server refuses (the caller shows it).
export function CreateFilesButton({ job, canCreate, hasFiles, viewer, onDone, onError, quiet = false }) {
  const [busy, setBusy] = useState(false);
  if (viewer) return null;
  const create = async () => {
    setBusy(true);
    try {
      const result = await api.post(`/migrations/${job.id}/generate`);
      if (onDone) await onDone(result);
    } catch (e) {
      if (onError) await onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={create} disabled={!job || !canCreate || busy} className={quiet ? btnSecondary : btnPrimary}>
      {busy ? 'Creating the files…' : hasFiles ? 'Create the files again' : 'Create files'}
    </button>
  );
}

// The same confirmation as the Export Center: a file with rows the Zoho check says Zoho Books will refuse is downloaded
// only after "Download anyway", which is written to the audit log (POST /zoho-check/acknowledge; not for viewers).
// The check is read when the button is clicked, so it is never older than the files; when there is none, the
// download goes ahead.
function RefusedConfirm({ files, onSee, onAnyway, onCancel }) {
  const onlyDate = files.every(f => f.waitsForDate && !(f.rowsWill > 0));
  return (
    <div role="alertdialog" aria-label="Download anyway?" className="w-full p-3 rounded-xl border border-warning-line bg-warning-soft text-[14px] text-ink flex flex-col gap-2">
      <span className="flex items-start gap-2">
        <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>{refusedWords(files).join(' ')}</span>
      </span>
      <span className="flex flex-wrap gap-2">
        <button type="button" onClick={onSee} className="px-3 py-1.5 bg-action text-white rounded-md font-medium">{onlyDate ? 'Go to the Migration Date step' : 'See the problems'}</button>
        <button type="button" onClick={onAnyway} className="px-3 py-1.5 border border-line-strong bg-white rounded-md font-medium">Download anyway</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-md underline">Cancel</button>
      </span>
    </div>
  );
}

// download(confirmed): the download itself (confirmed: "Download anyway" was clicked); keys: the files it holds (null:
// every current file).
function useCheckedDownload({ job, keys, viewer, onNavigate, onError, download }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // files Zoho will refuse rows of, waiting for "Download anyway"
  const fail = e => { if (onError) onError(e); else setError(e.message); };
  const go = async files => {
    setConfirm(null); setBusy(true); setError('');
    try {
      // a viewer cannot record the confirmation: the download itself carries it (downloadAddress, ?confirmed=1)
      if (files.length && !viewer) for (const f of files) await api.post(`/migrations/${job.id}/zoho-check/acknowledge`, { key: f.key }).catch(() => {});
      await download(files.length > 0);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const start = async () => {
    setError('');
    const check = await api.get(`/migrations/${job.id}/zoho-check`).catch(() => null);
    const refused = refusedFiles(check, keys);
    if (refused.length) setConfirm(refused); else await go([]);
  };
  const box = confirm && (
    <RefusedConfirm files={confirm} onCancel={() => setConfirm(null)} onAnyway={() => go(confirm)}
      onSee={() => { const onlyDate = confirm.every(f => f.waitsForDate && !(f.rowsWill > 0)); setConfirm(null); if (onNavigate) onNavigate(onlyDate ? WIZARD_SCREEN : ZOHO_CHECK_SCREEN, onlyDate ? { step: 'date' } : confirm.length === 1 ? { file: confirm[0].key } : {}); }} />
  );
  return { busy, error, start, box };
}

// One file, with the confirmation. file: { key, fileName, module, outOfDate }.
export function CheckedDownloadButton({ job, file, viewer = false, onNavigate, onError, onDone, label, className = btnSecondary }) {
  const d = useCheckedDownload({ job, keys: [file.key], viewer, onNavigate, onError,
    download: async confirmed => { await downloadFile(downloadAddress(api.downloadUrl(job.id, file.key), { viewer, confirmed }), file.fileName); if (onDone) await onDone(); } });
  return (
    <span className="inline-flex flex-col items-start gap-2 max-w-full">
      <button type="button" onClick={d.start} disabled={!job || file.outOfDate || d.busy} className={className} aria-label={`Download the ${file.module || file.fileName} file`}>
        <Download className="w-4 h-4" aria-hidden="true" /> {d.busy ? 'Downloading…' : label || 'Download'}
      </button>
      {d.box}
      {d.error && <span role="alert" className="text-[13px] text-ink max-w-md">{d.error}</span>}
    </span>
  );
}

// One zip of every current file, numbered in import order, with READ_ME_IMPORT_ORDER.txt.
export function DownloadAllButton({ job, viewer = false, onNavigate, onError, primary = false }) {
  const d = useCheckedDownload({ job, keys: null, viewer, onNavigate, onError,
    download: confirmed => downloadFile(downloadAddress(`/api/migrations/${job.id}/download-all`, { viewer, confirmed }), `zoho-import-${job.id}.zip`) });
  return (
    <span className="inline-flex flex-col items-start gap-2 max-w-full whitespace-normal">
      <button type="button" onClick={d.start} disabled={!job || d.busy} className={primary ? btnPrimary : btnSecondary}>
        <Download className="w-4 h-4" aria-hidden="true" /> {d.busy ? 'Preparing the zip…' : 'Download all (zip)'}
      </button>
      {d.box}
      {d.error && <span role="alert" className="text-[13px] text-ink max-w-md">{d.error}</span>}
    </span>
  );
}

// The bar at the bottom of a page: Create files, and once they exist the next action.
// files: the generated files (any list with outOfDate); outOfDate: at least one of them is out of date.
export default function CreateFilesBar({ job, user, canCreate, files = [], onDone, onError, onNavigate }) {
  const viewer = user?.role === 'viewer';
  const hasFiles = files.length > 0;
  const outOfDate = files.some(f => f.outOfDate);
  const ready = hasFiles && !outOfDate;
  if (!job) return null;
  return (
    <section aria-label="Create the files" className="p-4 rounded-lg border border-line border-l-4 border-l-brand bg-white shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
      <div className="text-[15px] text-ink min-w-0">
        {ready ? <><span className="font-semibold">The files are ready.</span> Next: import them into Zoho Books, one step at a time.</>
          : hasFiles ? <><span className="font-semibold">The files are out of date.</span> Create them again, then import.</>
            : canCreate ? <><span className="font-semibold">Next: create the files for Zoho Books.</span></>
              : <span className="text-muted">The files can be created once the Tally files have been read.</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <CreateFilesButton job={job} canCreate={canCreate} hasFiles={hasFiles} viewer={viewer} onDone={onDone} onError={onError} quiet={ready} />
        {ready && <DownloadAllButton job={job} viewer={viewer} onNavigate={onNavigate} />}
        {ready && (
          <button type="button" onClick={() => onNavigate(WIZARD_SCREEN)} className={btnPrimary}>
            Start the import wizard <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
