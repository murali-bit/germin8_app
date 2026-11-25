import React, { useState } from 'react';
import { ArrowRight, Check, ChevronDown, X } from 'lucide-react';
import { Card, Note, PageHeader, btnSecondary, btnSmall } from '../../components/ui';
import { FILE_DETAIL_HELP } from './uploadHelp';
import { FLOW } from '../../navigation';

const focusRing = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand';
const detailHelp = Object.fromEntries(FILE_DETAIL_HELP);

// The guided flow is FLOW (navigation.js), so the number of steps here is always the number the flow pages show.
// Only the plain description of each step is written here.
const STEP_TEXT = {
  'screen-12': 'Name the company and the financial year you are moving.',
  'screen-36': 'An overview of the whole migration on one page: what is done and what is still open. Each step also has its own numbered page in the menu.',
  'screen-15': 'Upload the three JSON files exported from TallyPrime: all masters, all transactions for the full year, and the detailed Trial Balance. Every file is checked as it arrives.',
  'screen-16': 'Confirm every required dataset is in, and mark the ones that do not apply.',
  'screen-17': 'The platform reads the files, checks them and lists anything it flagged.',
  'screen-19': 'Every open decision has a safe default. Change names, account types, rates or contact details only where you want something else.',
  'screen-20': 'Each journal goes to Invoice, Bill or Manual Journal. The tool uses its default unless you choose.',
  'screen-25': 'Create one CSV file per Zoho Books module and download them.',
  'screen-40': 'Import the files into Zoho Books by hand, in order. The Import Wizard has its own import steps: where to click and what to record.',
};
const STEPS = FLOW.map(s => [s.title, STEP_TEXT[s.id] || '', s.id]);
// Pages used around the guided flow (not steps of it).
const AFTER = [
  ['Tally Export Guide', 'How to export each file from TallyPrime.', 'screen-13'],
  ['Fix rejections', 'Upload the error file from Zoho Books, approve corrections and get a retry file.', 'screen-28'],
  ['Confirm in Zoho', 'Upload a report from Zoho Books to check that every record arrived.', 'screen-30'],
  ['Report', 'See the one-page report and the record of who did what.', 'screen-31'],
];

const WILL = [
  ['It never changes your Tally values silently.', 'Your uploaded records are kept as they are. A value is changed only in a file going to Zoho Books, only after you approve it with a reason, and the change is recorded.'],
  ['It flags instead of guessing.', 'A voucher whose debits and credits do not agree is flagged and left out of the output. A name on a voucher that is missing from your master files is flagged. Tax treatment is never decided from a percentage.'],
  ['Every decision has a safe default, and yours wins.', 'Where nothing is decided, the tool uses a default that Zoho Books is expected to accept, and lists it under "Assumptions the tool made". A decision you make always replaces the default.'],
];
const WILL_NOT = [
  ['It does not connect to Tally or to Zoho Books.', 'Everything moves as files. You export from Tally, and you import into Zoho Books yourself.'],
  ['It does not clean up or correct the books.', 'It moves what is in Tally. Errors in the books need to be corrected by an accountant, in Tally, before or after the migration.'],
];

const FAQ = [
  {
    q: 'Why is processing blocked?',
    a: (
      <>
        <p>Completeness Check lists the reason. It is always one of these:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>A required dataset has not been uploaded. A voucher dataset such as Purchase is not needed when your "All transactions" file has no vouchers of that type: it is then marked not applicable for you.</li>
          <li>An "if applicable" dataset is neither uploaded nor marked "Not applicable".</li>
          <li>A record count you entered from Tally does not agree with the number of records in the file.</li>
        </ul>
      </>
    ),
    screen: ['Open Completeness Check', 'screen-16'],
  },
  {
    q: 'What does "Count in Tally" do?',
    a: (
      <>
        <p>
          It is optional. For any dataset you can enter how many records Tally shows, for example the number of customer ledgers.
          The platform compares your number with the number of records in the uploaded file.
        </p>
        <p>
          If the two differ, processing and file creation are blocked until you upload the complete file, correct the number, or clear it.
          Leave the box empty if you do not want this check.
        </p>
      </>
    ),
    screen: ['Open Completeness Check', 'screen-16'],
  },
  {
    q: 'What happens to cancelled and optional vouchers?',
    a: (
      <>
        <p>
          A voucher that is cancelled, marked optional or deleted in Tally is not part of the books. The platform keeps it and counts it, and lists it as a flagged item
          of its own kind, but never writes it to a Zoho file. It is also left out of the checks, including the Trial Balance check.
        </p>
        <p>A cancelled or optional journal voucher needs no routing decision.</p>
      </>
    ),
    screen: ['Open Processing Status', 'screen-17'],
  },
  {
    q: 'What does the Trial Balance check do?',
    a: (
      <>
        <p>
          The Trial Balance report from Tally shows, for each ledger and group, the opening balance, the debits and credits of the year, and the closing balance.
          When the data is processed, the platform checks that opening debits equal opening credits and closing debits equal closing credits, that opening balance
          plus the year's movement gives the closing balance, and that the debits and credits of each line equal what your uploaded vouchers add up to.
        </p>
        <p>
          A difference usually means the transactions file covers a shorter period than the Trial Balance, or a voucher type was not uploaded.
          Every difference is listed as a flagged item with the figures. The Data Explorer shows the whole Trial Balance with the result on each line.
        </p>
        <p>
          The Opening Balances file is created only when the report lists every ledger, from its Opening Balance column. If the report lists groups only,
          no Opening Balances file is created, and the reason is shown.
        </p>
      </>
    ),
    screen: ['Open Data Explorer', 'screen-18'],
  },
  {
    q: 'What are "fields not transferred"?',
    a: <p>{detailHelp['Fields not transferred']} They are listed for each uploaded file.</p>,
    screen: ['Open Upload Center', 'screen-15'],
  },
  {
    q: 'Why does a group say "Needs your decision"?',
    a: (
      <>
        <p>
          Each Tally group becomes a Zoho account type. Standard groups are set automatically, and a sub-group you created takes the type of its main group.
          A group says "Needs your decision" when ledgers sit under it and no type could be found for it.
        </p>
        <p>
          Some of Tally's own groups always need your decision, because the right type depends on the business: Sundry Debtors, Sundry Creditors, Bank OCC A/c,
          Branch / Divisions, Suspense A/c and Misc. Expenses (ASSET), and any sub-groups under them.
        </p>
        <p>
          If the Chart of Accounts file has no group records, the platform cannot tell which main group a sub-group belongs to. Export the groups along with the ledgers.
        </p>
      </>
    ),
    screen: ['Open Mapping Studio', 'screen-19'],
  },
  {
    q: 'Why must I create the files again after changing a mapping?',
    a: (
      <>
        <p>
          The files are written using the decisions in place at the moment you create them. A change made afterwards, such as an account type, a tax name,
          a unit or a journal routing, is not in files that already exist.
        </p>
        <p>
          A result recorded in the Import Wizard counts only for a file that comes out unchanged. A Zoho report check in Reconciliation is removed when its file comes out with different contents.
        </p>
      </>
    ),
    screen: ['Open Export Center', 'screen-25'],
  },
  {
    q: 'What is a checksum?',
    a: <p>{detailHelp.Checksum} The files created for Zoho Books carry a checksum too.</p>,
  },
  {
    q: 'What happens when Zoho Books rejects rows?',
    a: (
      <>
        <p>
          Download the error file Zoho Books gives you and upload it in the Rejection Manager, against the file you imported.
          Each rejected record is shown with Zoho's message and, where it can be linked, the Tally record it came from.
        </p>
        <p>
          You approve a correction for each one and give a reason. If the column carries an accounting value, you are asked to confirm the change a second time.
          The platform then creates a retry file containing only the rejected records. Records that were accepted are not touched.
        </p>
        <p>The layout the platform expects for Zoho's error file is assumed and has not been confirmed against a real one.</p>
      </>
    ),
    screen: ['Open Rejection Manager', 'screen-28'],
  },
  {
    q: 'What does "Imported" mean?',
    a: (
      <>
        <p>
          It is your confirmation that you imported the file, not proof from Zoho Books. The platform cannot see inside Zoho Books.
        </p>
        <p>To check that the records really arrived, export a report from Zoho Books and upload it in Reconciliation.</p>
      </>
    ),
    screen: ['Open Reconciliation', 'screen-30'],
  },
  {
    q: 'Who can do what?',
    a: (
      <>
        <p>There are four roles:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Super Admin:</strong> can do everything, sees every firm, and is the only role that can create or change another Super Admin.</li>
          <li><strong>Admin:</strong> can do all migration work and can add users, change their roles and switch off their access, within their own firm.</li>
          <li><strong>Migration Analyst:</strong> can do all migration work, but cannot manage users.</li>
          <li><strong>Client Viewer:</strong> can view but cannot change anything. A viewer who is tied to one company sees only that company's migrations.</li>
        </ul>
        <p>Nobody can change their own role or access. Each firm sees only its own migrations.</p>
      </>
    ),
  },
  {
    q: 'What is not built yet?',
    a: (
      <>
        <ul className="list-disc pl-5 space-y-1">
          <li>Files of their own for Payments Received, Payments Made, Vendor Credits and Credit Notes. By default these vouchers are Manual Journals in the journals file of receipts, payments and contra, with the customer or vendor named, so nothing is held and the balances match Tally. A Payments file is built only from Zoho's import sample, if you choose it in Voucher files. Vouchers of other types are read and kept with no Zoho file.</li>
          <li>An Opening Balances file from a Trial Balance that lists groups only. Export the detailed Trial Balance (Alt+F5 in Tally), so that every ledger is listed.</li>
          <li>Sign-in with Google or Microsoft. Sign in with your email and password.</li>
          <li>Password reset. If you cannot sign in, ask your firm's administrator to create a new account for you.</li>
        </ul>
        <p>Tax Configuration, Units and Stock Summary are also read for checks only. No separate Zoho file is created from them.</p>
      </>
    ),
  },
];

const LIMITS = [
  "Customers, Vendors, Chart of Accounts, Items, Invoices, Bills and Manual Journals: headings match Zoho's sample file (checked). Not yet confirmed by a real import into Zoho Books.",
  'The layouts the platform expects for Zoho\'s error file and for Zoho reports are assumed. They are not yet confirmed against real Zoho Books files.',
  'The way masters, vouchers and the Trial Balance are read was confirmed on one real TallyPrime 7.1 export. The Stock Summary, and item lines on vouchers, still follow sample files from Tally\'s help pages.',
  'The automatic tests use made-up sample data. Real exports of one company were used only to confirm the file structure.',
];

function Question({ item, index, open, onToggle, onNavigate }) {
  const panelId = `help-answer-${index}`;
  const buttonId = `help-question-${index}`;
  return (
    <li>
      <h3>
        <button
          type="button" id={buttonId} aria-expanded={open} aria-controls={panelId} onClick={onToggle}
          className={`w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-soft ${focusRing}`}
        >
          <span className="text-[14px] font-semibold text-ink">{item.q}</span>
          <ChevronDown className={`w-5 h-5 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </h3>
      {open && (
        <div id={panelId} role="region" aria-labelledby={buttonId} className="px-4 pb-5 text-[14px] text-ink space-y-2 max-w-3xl">
          {item.a}
          {item.screen && (
            <button type="button" onClick={() => onNavigate(item.screen[1])} className={`${btnSecondary} ${btnSmall} mt-1`}>
              <span>{item.screen[0]}</span><ArrowRight className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function Points({ items, Icon, good }) {
  return (
    <ul className="space-y-3">
      {items.map(([title, text]) => (
        <li key={title} className="flex items-start gap-3">
          <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${good ? 'bg-success-soft text-success-ink' : 'bg-soft-2 text-muted'}`}>
            <Icon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-ink">{title}</span>
            <span className="block text-[14px] text-muted mt-0.5">{text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Screen35_HelpSupport({ onNavigate, user }) {
  const [open, setOpen] = useState({});
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Help"
        breadcrumb={[{ label: 'Dashboard', onClick: () => onNavigate('screen-11') }, { label: 'Help' }]}
        help="How a migration from TallyPrime to Zoho Books works here, what the platform does and does not do, and answers to common questions."
      />

      <Card title="How it works" subtitle={`One company and one financial year at a time, in ${STEPS.length} steps (the same steps as Back and Continue on each page). Select a step to open its page.`}>
        <ol className="divide-y divide-line">
          {STEPS.map(([title, text, screen], i) => (
            <li key={title}>
              <button type="button" onClick={() => onNavigate(screen)} className={`w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-soft ${focusRing}`}>
                <span className="w-7 h-7 rounded-full bg-brand-soft text-info-ink text-[13px] font-semibold flex items-center justify-center shrink-0" aria-hidden="true">{i + 1}</span>
                <span className="min-w-0 flex-1 flex flex-col md:flex-row md:items-baseline gap-x-4">
                  <span className="md:w-64 shrink-0 text-[14px] font-semibold text-ink">{title}</span>
                  <span className="text-[14px] text-muted">{text}</span>
                </span>
                <ArrowRight className="w-4 h-4 shrink-0 text-muted" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
        <div className="px-4 py-3 border-t border-line text-[14px] text-muted">
          <div className="font-semibold text-ink mb-2">Also useful</div>
          <ul className="flex flex-wrap gap-2">
            {AFTER.map(([title, text, screen]) => (
              <li key={title}><button type="button" title={text} onClick={() => onNavigate(screen)} className={`${btnSecondary} ${btnSmall}`}>{title}</button></li>
            ))}
          </ul>
        </div>
      </Card>

      <Card title="What the platform will and will not do">
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-success-ink mb-3">It will</h3>
            <Points items={WILL} Icon={Check} good />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted mb-3">It will not</h3>
            <Points items={WILL_NOT} Icon={X} />
          </div>
        </div>
      </Card>

      <Card title="Common questions">
        <ul className="divide-y divide-line">
          {FAQ.map((item, i) => (
            <Question key={item.q} item={item} index={i} open={!!open[i]} onToggle={() => setOpen(o => ({ ...o, [i]: !o[i] }))} onNavigate={onNavigate} />
          ))}
        </ul>
      </Card>

      <Card title="Current limits" subtitle="Please read these before using the output on real books.">
        <div className="p-4 space-y-4">
          <ul className="text-[14px] text-ink space-y-2 list-disc pl-5">
            {LIMITS.map(l => <li key={l}>{l}</li>)}
          </ul>
          <Note tone="warning">
            <strong>Test first.</strong> Always import into a Zoho Books test organisation before the live books, and check the result there.
          </Note>
        </div>
      </Card>

      <Card title="Need more help">
        <div className="p-4 text-[14px] text-ink space-y-3">
          <p>
            Contact your firm's administrator. They can add users, change roles and help with access.
            {isAdmin
              ? ' The administrators of your firm are listed under Users and Roles.'
              : ' Administrators can see the list of users and their roles under Users and Roles.'}
          </p>
          <p className="text-muted">There is no separate support desk for this platform at present.</p>
          {isAdmin && (
            <button type="button" onClick={() => onNavigate('screen-34')} className={btnSecondary}>
              <span>Open Users and Roles</span><ArrowRight className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
