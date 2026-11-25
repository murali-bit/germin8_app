import React from 'react';
import { ActionBar, Stepper } from './ui';
import { FLOW, flowPosition, backTarget, HOME } from '../navigation';

// Back and Next pinned to the bottom of the page, always visible, for a wizard that has its own steps (the Import
// Wizard). The page must be a column as tall as the scrolling area (min-h-full flex flex-col) with this bar last.
export function PinnedStepBar({ index, total, title, backLabel = 'Back', nextLabel = 'Next', onBack, onNext, nextDisabled = false }) {
  return (
    <ActionBar
      onBack={onBack}
      backLabel={backLabel}
      onNext={onNext}
      nextLabel={nextLabel}
      nextDisabled={nextDisabled}
      info={<><span className="block">Step {index + 1} of {total}</span><span className="block font-semibold text-ink truncate">{title}</span></>}
    />
  );
}

// Back and Continue for the guided flow, one step per page (see FLOW in navigation.js).
// position "top": the numbered steps; "bottom": Back on the left and the main action on the right, pinned to the bottom.
// onContinue / continueLabel / continueType / form replace the plain "go to the next page" (New Migration saves first).
export default function WizardNav({ screen, onNavigate, position = 'top', onContinue, continueLabel, continueType = 'button', form, busy = false }) {
  const pos = flowPosition(screen);
  if (!pos) return null;
  const back = backTarget(pos.prev);
  const goBack = () => (back ? onNavigate(back.screen, back.params, { back: true }) : onNavigate(HOME, {}, { back: true }));
  const backLabel = pos.prev ? `Back: ${pos.prev.title}` : 'Back to Dashboard';
  const nextLabel = continueLabel || (pos.next ? `Continue: ${pos.next.title}` : 'Finish: go to Dashboard');
  const goNext = onContinue || (() => onNavigate(pos.next ? pos.next.id : HOME));

  if (position === 'bottom') {
    return (
      <ActionBar
        onBack={goBack}
        backLabel={backLabel}
        onNext={continueType === 'submit' ? undefined : goNext}
        nextType={continueType}
        form={form}
        busy={busy}
        nextLabel={nextLabel}
        info={`Step ${pos.index + 1} of ${pos.total}: ${pos.step.title}`}
      />
    );
  }
  const goStep = i => {
    const step = FLOW[i];
    if (!step) return;
    const target = backTarget({ id: step.id });
    onNavigate(target.screen, target.params, { back: true });
  };
  return (
    <div className="px-4 pt-4 pb-3 rounded-lg border border-line bg-white shadow-xs">
      <Stepper steps={FLOW.map(s => s.title)} current={pos.index} onStepClick={goStep} ariaLabel="Guided steps" />
    </div>
  );
}
