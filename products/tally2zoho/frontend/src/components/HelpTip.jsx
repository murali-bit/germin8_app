import React, { useEffect, useId, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';

// A small "!" button. The help panel opens on hover and on keyboard focus, and stays open when clicked
// (so it also works on touch screens). Escape or clicking elsewhere closes it.
// The panel is positioned against the nearest positioned ancestor (give the card "relative"), so it
// spans the card and can never run off the edge of the page.
export default function HelpTip({ label, children }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrap = useRef(null);
  const id = useId();
  const open = hover || pinned;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') { setHover(false); setPinned(false); } };
    const onDown = e => { if (wrap.current && !wrap.current.contains(e.target)) { setHover(false); setPinned(false); } };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  return (
    <span ref={wrap} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="inline-flex shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setPinned(p => !p)}
        onFocus={() => setHover(true)}
        onBlur={e => { if (!wrap.current?.contains(e.relatedTarget)) setHover(false); }}
        className="w-6 h-6 rounded-full inline-flex items-center justify-center text-subtle hover:text-ink hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <CircleAlert className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={id}
          role="region"
          aria-label={label}
          className="absolute left-3 right-3 top-11 z-30 max-h-[22rem] overflow-y-auto rounded-lg border border-line bg-white p-4 text-left shadow-lg"
        >
          {children}
        </div>
      )}
    </span>
  );
}
