import React from 'react';
import { ChevronRight, Hand } from 'lucide-react';
import { preStepList } from '../importWizard';

// "Do this first in Zoho Books": what must be done by hand in Zoho Books before a file is imported (for example the one
// account created by hand, then the Chart of Accounts imported with Skip Duplicates). No rule asks for one at present.
// source: the Zoho check's preSteps, or the wizard's createFirst (importWizard.js preStepList reads both).
// onSee(step): optional, a button to the rows behind the step (Zoho check).
export default function PreSteps({ source, onSee, title = 'Do this first in Zoho Books' }) {
  const list = preStepList(source);
  if (!list.length) return null;
  return (
    <section aria-label={title} className="p-4 rounded-lg border border-line border-l-4 border-l-brand bg-white text-[14px] text-ink space-y-3">
      <h3 className="text-[16px] font-semibold tracking-tight flex items-center gap-2"><Hand className="w-5 h-5 shrink-0" aria-hidden="true" /> {title}</h3>
      <ol className="space-y-3 list-decimal pl-5">
        {list.map((p, i) => (
          <li key={i} className="space-y-1.5">
            <div>{p.what}</div>
            {p.path.length > 0 && (
              <div className="flex flex-wrap items-center gap-1" aria-label="Where in Zoho Books">
                {p.path.map((part, k) => (
                  <React.Fragment key={k}>
                    {k > 0 && <ChevronRight className="w-4 h-4 text-subtle shrink-0" aria-hidden="true" />}
                    <span className="px-2 py-0.5 rounded-md border border-line-strong bg-soft font-medium">{part}</span>
                  </React.Fragment>
                ))}
              </div>
            )}
            {p.accounts.length > 0 && (
              <ul className="list-disc pl-5">
                {p.accounts.map((a, k) => <li key={k}><span className="font-medium break-words">{a.account}</span>{a.accountType ? <span className="text-muted"> (Account Type {a.accountType})</span> : null}</li>)}
              </ul>
            )}
            {p.then && <div><span className="font-semibold">Then: </span>{p.then}</div>}
            {onSee && p.rows > 0 && (
              <button type="button" className="underline text-[13px]" onClick={() => onSee(p)}>See the {p.rows === 1 ? 'row' : `${p.rows.toLocaleString('en-IN')} rows`}</button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
