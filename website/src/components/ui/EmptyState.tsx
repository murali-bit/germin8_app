import React from 'react';
import { SearchX } from 'lucide-react';

/** Shared "nothing here" state for searches and lists. */
export const EmptyState: React.FC<{
  title: string;
  body?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}> = ({ title, body, action, icon }) => (
  <div className="mx-auto flex max-w-md flex-col items-center rounded-3xl bg-[#F7F6F2] px-6 py-14 text-center ring-1 ring-[#171717]/10">
    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FFFFFF] text-[#C9A332] ring-1 ring-[#171717]/10">
      {icon ?? <SearchX className="h-6 w-6" strokeWidth={1.6} aria-hidden />}
    </span>
    <h3 className="mt-5 font-display text-[20px] font-semibold tracking-[-0.02em] text-[#171717]">{title}</h3>
    {body && <p className="mt-2 text-[15px] leading-relaxed text-[#171717]/65">{body}</p>}
    {action && <div className="mt-6">{action}</div>}
  </div>
);
