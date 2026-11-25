import React, { useEffect, useState } from 'react';
import { ArrowRight, CircleDashed } from 'lucide-react';
import { api } from '../api';
import { heldWords } from '../importWizard';

// Vouchers in no Zoho file yet (GET held-vouchers): an open item, shown wherever a screen could otherwise look done.
// lead: a short sentence put first (what this screen's numbers cover). Shows nothing when every voucher is in a file.
export function HeldNotice({ job, onNavigate, lead = '' }) {
  const [held, setHeld] = useState(null);
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId) return undefined;
    let live = true;
    api.get(`/migrations/${jobId}/held-vouchers`).then(h => { if (live) setHeld(h); }).catch(() => { if (live) setHeld(null); });
    return () => { live = false; };
  }, [jobId, job?.updated_at]);
  if (!held?.available || !(held.notInAnyFile > 0)) return null;
  return (
    <div role="status" className="p-4 rounded-lg border border-warning-line bg-warning-soft text-[14px] text-ink flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <span className="flex items-start gap-2.5">
        <CircleDashed className="w-5 h-5 shrink-0 mt-px" aria-hidden="true" />
        <span>
          {lead ? `${lead} ` : ''}<strong>Open item: {held.words}.</strong>{' '}
          {heldWords(held)}
        </span>
      </span>
      {onNavigate && (
        <button type="button" onClick={() => onNavigate('screen-40', { step: 'held' })} className="shrink-0 inline-flex items-center gap-1.5 underline font-medium">
          What to do <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default HeldNotice;
