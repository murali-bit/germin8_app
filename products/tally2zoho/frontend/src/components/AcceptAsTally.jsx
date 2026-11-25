import React, { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import { readableWhen } from './OutOfDateBanner';
import { btnSecondary } from './ui';

// The reviews of a migration (GET /reviews) are read ONCE for all the cards of a page: every card on the page shares
// one request and one answer, and a change made on one card is shown on every card at once. An answer older than
// 30 seconds is read again the next time a card asks (for example when the page is opened again later).
const cache = new Map(); // jobId -> { value, at, promise, listeners: Set }
const entry = jobId => {
  if (!cache.has(jobId)) cache.set(jobId, { value: undefined, at: 0, promise: null, listeners: new Set() });
  return cache.get(jobId);
};
const publish = (jobId, value) => {
  const e = entry(jobId);
  e.value = value; e.at = Date.now();
  for (const fn of e.listeners) fn(value);
};
function readReviews(jobId) {
  const e = entry(jobId);
  if (e.promise) return e.promise;
  if (e.value !== undefined && Date.now() - e.at < 30000) return Promise.resolve(e.value);
  e.promise = api.get(`/migrations/${jobId}/reviews`)
    .then(r => { publish(jobId, r); return r; })
    .catch(() => { publish(jobId, null); return null; })
    .finally(() => { e.promise = null; });
  return e.promise;
}

// "Accept as per Tally" on a decision card: records that the step was reviewed and that the defaults and Tally's
// values stand. Nothing in the files changes. stepKey: account_types, builtin_accounts, names, duplicates,
// contact_fixes, tax_mapping, tds_mapping, item_rates, units, voucher_files, hsn, journal_routing.
export default function AcceptAsTally({ jobId, stepKey, readOnly, onChanged }) {
  const [all, setAll] = useState(() => entry(jobId).value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const e = entry(jobId);
    e.listeners.add(setAll);
    readReviews(jobId).then(setAll);
    return () => { e.listeners.delete(setAll); };
  }, [jobId]);
  // undefined: loading or not available; null: not accepted
  const review = all === undefined || all === null ? undefined : all?.steps?.[stepKey] || null;
  const set = async accepted => {
    setBusy(true); setError('');
    try {
      const r = await api.put(`/migrations/${jobId}/reviews/${stepKey}`, { accepted });
      publish(jobId, r);
      onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (review === undefined) return null;
  if (review) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>Accepted{review.by ? ` by ${review.by}` : ''}{readableWhen(review.at) ? `, ${readableWhen(review.at)}` : ''}{review.beforeReprocess ? ' (accepted before the files were read again)' : ''}</span>
        {!readOnly && <button type="button" className="underline hover:text-ink" disabled={busy} onClick={() => set(false)}>Undo</button>}
        {error && <span role="alert" className="text-ink">{error}</span>}
      </span>
    );
  }
  if (readOnly) return <span className="text-[13px] text-muted">Not reviewed yet</span>;
  return (
    <span className="inline-flex flex-col items-start sm:items-end gap-1">
      <button type="button" className={`${btnSecondary} whitespace-nowrap`} disabled={busy} onClick={() => set(true)}>{busy ? 'Saving…' : 'Accept as per Tally'}</button>
      {error && <span role="alert" className="text-[13px] text-ink">{error}</span>}
    </span>
  );
}
