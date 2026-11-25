import React, { useEffect, useRef, useState } from 'react';
import { Calendar, Database, FileSpreadsheet, ShieldCheck, Pencil, Plus } from 'lucide-react';
import { api, chooseMigration, notifyMigrationsChanged, useJob } from '../../api';
import { sameCompanyAndYear } from '../../migrationSelection';
import { Card, Field as UiField, Note, PageHeader, btnPrimary, btnSecondary, inputClass, friendlyError } from '../../components/ui';
import WizardNav from '../../components/WizardNav';
import { EDIT_PARAMS, flowPosition } from '../../navigation';
import { readTypedDate, showDate, fyBounds, fyStartYear, fyLabel, fyOfDate } from '../../dates';

// Step 1 of the guided flow. A new migration is created here; coming back (Back from the next step, or "Edit its
// details") opens the current migration's saved details and saves changes to the same migration, never a new one.
const FORM_ID = 'new-migration-form';
// The method is recorded with the migration and shown in the Test Run Report. It does not change which files are
// created: every file is created whatever is chosen, so the descriptions say what to IMPORT.
const METHODS = [
  { id: 'Opening Balances', title: 'Opening balances only', desc: 'Import the masters, contacts, items and opening balances. Do not import the Invoices, Bills or Journals files.' },
  { id: 'Open Transactions', title: 'Open transactions and masters', desc: 'Import the masters, then only the open invoices, unpaid bills and advances.' },
  { id: 'Full Migration', title: 'Full migration', desc: 'Import the masters and every voucher of the financial year, with the Tally voucher numbers.' },
];
const sameName = (a, b) => String(a || '').trim().replace(/\s+/g, ' ').toLowerCase() === String(b || '').trim().replace(/\s+/g, ' ').toLowerCase();
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// The default year of a new migration: the last financial year that has ended.
const defaultYear = () => fyLabel(fyOfDate(todayIso()) - 1);

// Unsaved changes are kept for this viewer only (session storage), so leaving the page does not lose them.
const readDraft = key => { try { const v = JSON.parse(window.sessionStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const writeDraft = (key, v) => { try { if (v) window.sessionStorage.setItem(key, JSON.stringify(v)); else window.sessionStorage.removeItem(key); } catch { /* storage not available: the form still works */ } };

// Label above the control, with an optional hint underneath (the shared Field from ui.jsx).
function Field({ id, label, hint, children }) {
  return <UiField htmlFor={id} label={label} hint={hint}>{children}</UiField>;
}

// The page after this one in the guided flow (the Upload Center): each step is its own page.
const NEXT_STEP = flowPosition('screen-12')?.next?.id || 'screen-15';
const NEXT_TITLE = flowPosition('screen-12')?.next?.title || 'Upload the Tally files';

export default function Screen12_NewMigration({ onNavigate, user, params = {} }) {
  const viewer = user?.role === 'viewer';
  const { job, loading } = useJob();
  const editing = params.edit != null && !!job;

  const [companyName, setCompanyName] = useState('');
  const [gstin, setGstin] = useState('');
  const [financialYear, setFinancialYear] = useState(defaultYear);
  const [dateText, setDateText] = useState(() => showDate(fyBounds(defaultYear()).from));
  const [dateError, setDateError] = useState('');
  const [dateNote, setDateNote] = useState('');
  const [migrationMethod, setMigrationMethod] = useState('Full Migration');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState(null); // the migrations that already have this company and year
  // With a migration selected, the page first asks: edit that one, or create a new one (the form is shown on "new")
  const [startNew, setStartNew] = useState(() => !!readDraft('new-migration-draft:new'));
  const loadedFor = useRef(null);
  const picker = useRef(null);
  const dateInput = useRef(null);
  const allowSecond = useRef(false); // "Create another one" was chosen for a company and year that already have a migration

  const [restored, setRestored] = useState(false);
  const dirty = useRef(false);
  const draftKey = editing ? `new-migration-draft:${job.id}` : params.edit != null ? null : 'new-migration-draft:new';
  const apply = d => {
    if (typeof d.companyName === 'string') setCompanyName(d.companyName);
    if (typeof d.gstin === 'string') setGstin(d.gstin);
    if (typeof d.financialYear === 'string' && fyBounds(d.financialYear)) setFinancialYear(d.financialYear);
    if (typeof d.dateText === 'string') setDateText(d.dateText);
    if (typeof d.migrationMethod === 'string') setMigrationMethod(d.migrationMethod);
  };
  const saved = () => (editing
    ? { companyName: job.company || '', gstin: job.gstin || '', financialYear: job.financial_year, dateText: showDate(job.start_date || fyBounds(job.financial_year)?.from), migrationMethod: job.method || 'Full Migration' }
    : { companyName: '', gstin: '', financialYear: defaultYear(), dateText: showDate(fyBounds(defaultYear()).from), migrationMethod: 'Full Migration' });

  // the saved details (when editing), then any unsaved changes kept for this viewer, once
  useEffect(() => {
    if (!draftKey || loadedFor.current === draftKey) return;
    loadedFor.current = draftKey;
    if (editing) apply(saved());
    const d = readDraft(draftKey);
    if (d) { apply(d); dirty.current = true; setRestored(true); }
  }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep unsaved changes; warn before the tab is closed or reloaded with changes not saved
  useEffect(() => {
    if (!draftKey || !dirty.current || viewer) return;
    writeDraft(draftKey, { companyName, gstin, financialYear, dateText, migrationMethod });
  }, [draftKey, companyName, gstin, financialYear, dateText, migrationMethod, viewer]);
  useEffect(() => {
    const warn = e => { if (dirty.current && !viewer) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [viewer]);
  const touch = () => { dirty.current = true; };
  const discard = () => { writeDraft(draftKey, null); dirty.current = false; setRestored(false); apply(saved()); setDateError(''); setDateNote(''); };

  // The financial year is locked once a file is uploaded (the files were read against it). A server that does not
  // say how many files are uploaded is treated as locked. The company name can still change.
  const yearLocked = editing && !(job.uploads === 0);
  const fileCompanies = editing && Array.isArray(job.fileCompanies) ? job.fileCompanies.filter(c => !sameName(c, companyName)) : [];
  const startText = readTypedDate(dateText, financialYear);
  const notFirstDay = !startText.error && startText.date && fyBounds(financialYear) && startText.date !== fyBounds(financialYear).from;
  const readOnly = viewer;
  const bounds = fyBounds(financialYear);
  const parsed = readTypedDate(dateText, financialYear);
  const yearNow = fyOfDate(todayIso());
  const firstYear = Math.min(2018, fyStartYear(financialYear) ?? 2018);
  const lastYear = Math.max(yearNow + 1, fyStartYear(financialYear) ?? 0);
  const years = [];
  for (let y = lastYear; y >= firstYear; y--) years.push(y);

  const chooseYear = value => {
    touch();
    const y = Number(value);
    const label = fyLabel(y);
    setFinancialYear(label);
    setDuplicate(null);
    allowSecond.current = false;
    const current = readTypedDate(dateText, label);
    if (current.error) {
      const from = fyBounds(label).from;
      setDateText(showDate(from));
      setDateError('');
      setDateNote(`The start date was moved to ${showDate(from)}, the first day of financial year ${label}, because it must be inside the year.`);
    } else setDateNote('');
  };
  const checkDate = () => {
    const r = readTypedDate(dateText, financialYear);
    if (r.error) setDateError(r.error);
    else { setDateError(''); setDateText(showDate(r.date)); }
  };
  const openPicker = () => {
    const el = picker.current;
    if (!el) return;
    try { if (el.showPicker) { el.showPicker(); return; } } catch { /* fall back below */ }
    el.focus(); el.click();
  };

  const save = async e => {
    e.preventDefault();
    setError('');
    if (readOnly) { onNavigate(NEXT_STEP); return; }
    const d = readTypedDate(dateText, financialYear);
    if (d.error) { setDateError(d.error); dateInput.current?.focus(); return; }
    setDateError('');
    setSaving(true);
    try {
      if (editing) {
        const body = {};
        if (companyName.trim() !== job.company) body.company = companyName.trim();
        if (gstin.trim() !== (job.gstin || '')) body.gstin = gstin.trim();
        if (!yearLocked && fyStartYear(financialYear) !== fyStartYear(job.financial_year)) body.financialYear = financialYear;
        if (d.date !== job.start_date) body.startDate = d.date;
        if (migrationMethod !== job.method) body.method = migrationMethod;
        if (Object.keys(body).length) { await api.put(`/migrations/${job.id}`, body); notifyMigrationsChanged(); }
        writeDraft(draftKey, null); dirty.current = false;
        onNavigate(NEXT_STEP);
        return;
      }
      if (!allowSecond.current) {
        const same = sameCompanyAndYear(await api.get('/migrations'), companyName, financialYear);
        if (same.length) { setDuplicate(same); return; }
      }
      const created = await api.post('/migrations', { company: companyName.trim(), gstin: gstin.trim(), financialYear, method: migrationMethod, startDate: d.date });
      writeDraft(draftKey, null); dirty.current = false;
      // the header shows the new migration at once, and every page reads it
      chooseMigration(created.id);
      notifyMigrationsChanged();
      // Back (in the app or the browser) from the next step now opens these saved details, not an empty form.
      onNavigate('screen-12', EDIT_PARAMS, { replace: true });
      onNavigate(NEXT_STEP);
    } catch (err) {
      setError(friendlyError(err.message));
    } finally {
      setSaving(false);
    }
  };

  const openExisting = m => { writeDraft(draftKey, null); dirty.current = false; chooseMigration(m.id); onNavigate('screen-12', EDIT_PARAMS, { replace: true }); };

  if (params.edit != null && loading) return <div role="status" className="p-8 text-[14px] text-muted">Loading the saved details…</div>;

  // a migration is selected and the form was opened to create one: ask first, so its details are not typed again
  const askFirst = !editing && !!job && !readOnly && params.edit == null && !startNew;
  const title = editing ? 'Migration details' : 'New migration';
  const continueLabel = readOnly ? `Continue: ${NEXT_TITLE}` : editing ? 'Save and continue' : 'Create and continue';
  // while asking (edit or new) there is no form: Continue goes on with the selected migration
  const navProps = askFirst
    ? { continueLabel: `Continue: ${NEXT_TITLE}`, onContinue: () => onNavigate(NEXT_STEP) }
    : { continueType: 'submit', form: FORM_ID, continueLabel, busy: saving };

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      <WizardNav screen="screen-12" onNavigate={onNavigate} position="top" {...navProps} />

      <PageHeader
        title={title}
        breadcrumb={[{ label: 'Dashboard', onClick: () => onNavigate('screen-11') }, { label: title }]}
        help={editing
          ? <>The saved details of <span className="font-mono text-ink">{job.id}</span>. Change what you need and continue. Saving changes this migration; it does not create a new one.</>
          : 'Enter the company and the financial year. Each step of the migration has its own page: use Back and Continue to move between them. Your details are saved, and you can come back to change them.'}
      />

      {askFirst && (
        <section aria-label="Edit or create" className="p-5 rounded-lg border border-line border-l-4 border-l-brand bg-white shadow-xs space-y-3">
          <p className="text-[15px] text-ink">You are working on <strong>{job.company}</strong> (<span className="font-mono">{job.id}</span>), financial year {job.financial_year}.</p>
          <p className="text-[14px] text-muted">To change its details, edit it. Create a new migration only for another company or another financial year.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} onClick={() => onNavigate('screen-12', EDIT_PARAMS, { replace: true })}>
              <Pencil className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Edit its details
            </button>
            <button type="button" className={btnSecondary} onClick={() => setStartNew(true)}>
              <Plus className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Create a new migration
            </button>
          </div>
        </section>
      )}
      {!editing && job && !readOnly && startNew && (
        <Note>A new migration is created; <strong>{job.company}</strong> ({job.id}) stays as it is.</Note>
      )}
      {params.edit != null && !job && (
        <Note>No migration is selected, so there are no saved details to show. Fill in the form to create one.</Note>
      )}
      {readOnly && <Note>You have view-only access: you can read these details but not change them.</Note>}

      {!askFirst && <>
      <div className="p-3.5 rounded-md border border-info-line bg-info-soft text-[14px] text-ink flex items-start gap-3">
        <ShieldCheck className="w-[18px] h-[18px] text-info-ink shrink-0 mt-0.5" strokeWidth={1.75} aria-hidden="true" />
        <span>You choose the company and the financial year. Choose the year the Tally files were exported for. They are never taken from or changed by the Tally files.</span>
      </div>

      <form id={FORM_ID} onSubmit={save} noValidate>
        <Card>
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-5 border-b border-line">
              <div className="flex items-start gap-3">
                <Database className="w-5 h-5 text-info-ink shrink-0 mt-0.5" strokeWidth={1.75} aria-hidden="true" />
                <div><div className="text-[14px] font-medium text-ink">From</div><div className="text-[14px] text-muted">TallyPrime, JSON (Data Exchange) exports</div></div>
              </div>
              <div className="flex items-start gap-3">
                <FileSpreadsheet className="w-5 h-5 text-info-ink shrink-0 mt-0.5" strokeWidth={1.75} aria-hidden="true" />
                <div><div className="text-[14px] font-medium text-ink">To</div><div className="text-[14px] text-muted">Zoho Books (India), import files</div></div>
              </div>
            </div>

            {restored && !readOnly && (
              <Note>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <span>Your changes that were not saved are back in the form. Save to keep them.</span>
                  <button type="button" className={`${btnSecondary} shrink-0`} onClick={discard}>Discard the changes</button>
                </div>
              </Note>
            )}
            {yearLocked && (
              <Note>Files are uploaded for this migration, so the financial year can no longer change: the files were read against it. To use another year, start a new migration. The company name can still change: the uploaded files are checked against the new name.</Note>
            )}
            {fileCompanies.length > 0 && !readOnly && (
              <Note>
                <div className="space-y-2">
                  <div>The uploaded Tally {fileCompanies.length === 1 ? 'file names' : 'files name'} a different company: {fileCompanies.map(c => `"${c}"`).join(', ')}.</div>
                  <div className="flex flex-wrap gap-2">
                    {fileCompanies.map(c => (
                      <button key={c} type="button" className={btnSecondary} onClick={() => { touch(); setCompanyName(c); }}>Use the name in the Tally file{fileCompanies.length > 1 ? `: ${c}` : ''}</button>
                    ))}
                  </div>
                </div>
              </Note>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field id="nm-company" label="Company name">
                <input id="nm-company" type="text" required value={companyName} disabled={readOnly}
                  onChange={e => { touch(); setCompanyName(e.target.value); setDuplicate(null); allowSecond.current = false; }} className={inputClass} placeholder="The company name as in Tally" />
              </Field>
              <Field id="nm-gstin" label="GSTIN" hint="Optional.">
                <input id="nm-gstin" type="text" value={gstin} disabled={readOnly} onChange={e => { touch(); setGstin(e.target.value); }} className={`${inputClass} font-mono`} />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field id="nm-year" label="Financial year" hint={bounds ? `${showDate(bounds.from)} to ${showDate(bounds.to)}` : ''}>
                <select id="nm-year" value={String(fyStartYear(financialYear))} disabled={readOnly || yearLocked} onChange={e => chooseYear(e.target.value)} className={inputClass}>
                  {years.map(y => <option key={y} value={String(y)}>{fyLabel(y)} (1 Apr {y} to 31 Mar {y + 1})</option>)}
                </select>
              </Field>

              <div>
                <label htmlFor="nm-start" className="block text-[13px] font-medium text-ink mb-1.5">Migration start date (recorded only)</label>
                <div className="relative flex gap-2">
                  <input
                    id="nm-start" ref={dateInput} type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/yyyy"
                    value={dateText} disabled={readOnly}
                    onChange={e => { touch(); setDateText(e.target.value); setDateError(''); setDateNote(''); }}
                    onBlur={checkDate}
                    aria-invalid={dateError ? 'true' : undefined}
                    aria-describedby="nm-start-hint"
                    className={inputClass}
                  />
                  <button type="button" onClick={openPicker} disabled={readOnly} className={`${btnSecondary} shrink-0`} aria-label="Pick the start date from a calendar">
                    <Calendar className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
                  </button>
                  <input
                    ref={picker} type="date" tabIndex={-1} aria-hidden="true"
                    className="absolute right-0 bottom-0 w-px h-px opacity-0 pointer-events-none"
                    min={bounds?.from} max={bounds?.to}
                    value={parsed.date || bounds?.from || ''}
                    onChange={e => { if (e.target.value) { touch(); setDateText(showDate(e.target.value)); setDateError(''); setDateNote(''); } }}
                  />
                </div>
                <p id="nm-start-hint" className="text-[13px] text-muted mt-1.5">
                  Type it as day/month/year (for example {bounds ? showDate(bounds.from) : '01/04/2024'}) or pick it from the calendar. It must be inside the financial year. It is saved with the migration but not used in the files: they always carry the opening balances as at the first day of the year and every voucher of the year.
                </p>
                {notFirstDay && (
                  <p role="status" className="text-[13px] font-medium text-warning-ink mt-1.5">
                    This is not the first day of the year. The files still start on {showDate(bounds.from)}: opening balances as at that day, and the vouchers from that day on.
                  </p>
                )}
                {dateError && <p role="alert" className="text-[13px] font-medium text-danger-ink mt-1.5">{dateError}</p>}
                {dateNote && <p role="status" className="text-[13px] text-ink mt-1.5">{dateNote}</p>}
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-[13px] font-medium text-ink mb-1.5">Migration method</legend>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {METHODS.map(m => {
                  const on = migrationMethod === m.id;
                  return (
                    <label key={m.id} className={`p-3 rounded-md border cursor-pointer transition-colors ${on ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-line-strong'} ${readOnly ? 'cursor-not-allowed' : ''}`}>
                      <span className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[14px] font-semibold text-ink">{m.title}</span>
                        <input type="radio" name="migrationMethod" checked={on} disabled={readOnly} onChange={() => { touch(); setMigrationMethod(m.id); }} className="accent-action" />
                      </span>
                      <span className="block text-[13px] text-muted">{m.desc}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-[13px] text-muted">A migration covers one financial year. The method is recorded and shown in the Test Run Report; every file is created whatever you choose, so import only the files your method needs.</p>
            </fieldset>

            {duplicate?.length > 0 && (
              <div role="alert" className="p-4 rounded-md border border-warning-line bg-warning-soft text-[14px] text-ink space-y-3">
                <div>
                  {duplicate.length === 1
                    ? <>A migration for <strong>{duplicate[0].company}</strong>, financial year {duplicate[0].financial_year}, already exists (<span className="font-mono">{duplicate[0].id}</span>).</>
                    : <>{duplicate.length} migrations for <strong>{duplicate[0].company}</strong>, financial year {duplicate[0].financial_year}, already exist: {duplicate.map(m => m.id).join(', ')}.</>}
                  {' '}Open one to carry on, or create another only if you really need it.
                </div>
                <div className="flex flex-wrap gap-2">
                  {duplicate.map(m => (
                    <button key={m.id} type="button" className={btnSecondary} onClick={() => openExisting(m)}><Pencil className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Open <span className="font-mono">{m.id}</span></button>
                  ))}
                  <button type="submit" className={btnSecondary} onClick={() => { allowSecond.current = true; }}><Plus className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Create another one</button>
                </div>
              </div>
            )}

            {error && (
              <div role="alert">
                <Note tone="danger">{editing ? 'Could not save the details' : 'Could not create the migration'}: {error}</Note>
              </div>
            )}
          </div>
        </Card>
      </form>
      </>}

      <div className="flex flex-wrap items-center gap-2 text-[14px] text-muted">
        Not exported from Tally yet?
        <button type="button" onClick={() => onNavigate('screen-13')} className="underline text-info-ink">Open the Tally Export Guide</button>
      </div>

      <WizardNav screen="screen-12" onNavigate={onNavigate} position="bottom" {...navProps} />
    </div>
  );
}
