import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '../../api';
import { Card, Note, PageHeader, StatusChip, Table, btnPrimary, btnSecondary, btnSmall, friendlyError } from '../../components/ui';
import { readableWhen } from '../../components/OutOfDateBanner';

// Template Mapping opens on the file named here.
const TEMPLATE_TO_OPEN = 'templateMappingFile';

export default function Screen22_TemplateLibrary({ onNavigate, user }) {
  const canEdit = ['super_admin', 'admin'].includes(user?.role);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/templates').then(setTemplates).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  const unverified = templates.filter(t => !t.verified).length;
  const inCodeList = templates.filter(t => t.verifiedInCode).map(t => t.module);
  const inCode = inCodeList.length;
  const names = list => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);
  const customised = templates.filter(t => t.customised).length;

  const open = key => {
    try { if (key) sessionStorage.setItem(TEMPLATE_TO_OPEN, key); else sessionStorage.removeItem(TEMPLATE_TO_OPEN); } catch { /* ignore */ }
    onNavigate('screen-23');
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <PageHeader
        title="Template Library"
        help="The Zoho Books import files the platform creates, one per module, and whether its headings match Zoho's sample file. The standard layouts were accepted by Zoho Books in the test imports; a layout changed here is not tested."
        actions={<button type="button" onClick={() => open(null)} className={btnPrimary}><span>Template Mapping</span><ArrowRight className="w-4 h-4" aria-hidden="true" /></button>}
      />
      {error && <div role="alert"><Note tone="danger">{friendlyError(error)}</Note></div>}
      {!loading && !error && templates.length > 0 && (
        <Note>
          {unverified > 0
            ? <><strong className="text-ink">{unverified} of {templates.length} files are not confirmed against an official Zoho sample.</strong>{' '}
              {inCode > 0 ? `The headings of ${inCode} ${inCode === 1 ? 'file' : 'files'} (${names(inCodeList)}) match Zoho's sample file (checked by the platform). ` : ''}
              For the others, an admin can compare the columns with the official sample file from the Import page of that module in Zoho Books, and mark the file as matching in Template Mapping. The Opening Balances file is a reference report and is not imported.</>
            : <><strong className="text-ink">The headings of every file match Zoho's sample file.</strong> {inCode > 0 ? `${names(inCodeList)}: checked by the platform` : ''}{inCode > 0 && inCode < templates.length ? '; any other mark is the statement of the admin who made it' : ''}.</>}
          {' '}{customised > 0 ? `${customised} ${customised === 1 ? 'file has' : 'files have'} columns changed from the standard layout.` : 'No file has been changed from the standard layout.'}
          {' '}The standard layouts were accepted by Zoho Books in the test imports. Payments Received, Payments Made, Credit Notes and Vendor Credits have no file of their own: by default those vouchers are Manual Journals in the journals file of receipts, payments and contra.
        </Note>
      )}
      <Card title="Files" subtitle={canEdit ? 'Open a file to rename, reorder, add or remove its columns.' : 'Open a file to see its columns. Only an admin can change them.'}>
        {loading ? <p role="status" className="px-4 py-6 text-[14px] text-muted">Loading the files…</p> : (
          <Table
            rowKey={t => t.key}
            rows={templates}
            empty="No files to show."
            columns={[
              { key: 'module', label: 'Zoho module', render: t => <span className="font-medium text-ink">{t.module}</span> },
              { key: 'fileName', label: 'Output file' },
              { key: 'source', label: 'Filled from' },
              { key: 'idColumn', label: 'Identifying column' },
              { key: 'cols', label: 'Columns', align: 'right', render: t => t.columns.length },
              { key: 'layout', label: 'Layout', render: t => (
                <span>
                  {t.customised ? <StatusChip tone="info">Changed from standard</StatusChip> : <StatusChip>Standard</StatusChip>}
                  {t.customised && t.updatedBy && <span className="block text-[13px] text-muted">by {t.updatedBy}{readableWhen(t.updatedAt) ? `, ${readableWhen(t.updatedAt)}` : ''}</span>}
                </span>
              ) },
              { key: 'verified', label: 'Official Zoho sample', render: t => (
                <span>
                  <span className="inline-flex items-center">
                    {t.verifiedInCode
                      ? <StatusChip tone="success" dot>Headings match (checked)</StatusChip>
                      : t.verified
                        ? <StatusChip tone="success" dot>Marked as matching</StatusChip>
                        : <StatusChip tone="warning" dot>Not confirmed</StatusChip>}
                  </span>
                  {t.verified && t.verification && (
                    <span className="block text-[13px] text-muted">
                      {t.verifiedInCode ? `"${t.verification.sampleFileName}". Not yet confirmed by a real import.` : <>"{t.verification.sampleFileName}", by {t.verification.by}{readableWhen(t.verification.at) ? `, ${readableWhen(t.verification.at)}` : ''}</>}
                    </span>
                  )}
                  {!t.verified && t.officialSampleFile && <span className="block text-[13px] text-muted">Changed from the standard layout of "{t.officialSampleFile}"</span>}
                </span>
              ) },
              { key: 'open', label: '', align: 'right', render: t => (
                <button type="button" onClick={() => open(t.key)} className={`${btnSecondary} ${btnSmall}`} aria-label={`${canEdit ? 'Edit' : 'View'} the columns of the ${t.module} file`}>
                  {canEdit ? 'Edit columns' : 'View columns'}
                </button>
              ) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
