import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Building2, ArrowRight } from 'lucide-react';
import { searchCompanies } from '@/data/companies';
import { cn } from '@/lib/utils';

/** Search box with live suggestions. Enter opens the full results page. */
export const CompanySearch: React.FC<{ initial?: string; size?: 'md' | 'lg'; className?: string }> = ({
  initial = '',
  size = 'lg',
  className,
}) => {
  const [q, setQ] = useState(initial);
  const [focused, setFocused] = useState(false);
  const navigate = useNavigate();
  const matches = q.trim().length >= 2 ? searchCompanies(q).slice(0, 5) : [];
  const open = focused && q.trim().length >= 2;

  return (
    <div className={cn('relative', className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(`/companies?q=${encodeURIComponent(q.trim())}`);
        }}
        className={cn(
          'flex items-center gap-2 rounded-full bg-white ring-1 ring-ink-300 focus-within:ring-2 focus-within:ring-mustard-500 shadow-[0_20px_40px_-24px_rgba(23,23,22,0.35)] transition-shadow',
          size === 'lg' ? 'h-16 pl-6 pr-2' : 'h-[52px] pl-5 pr-1.5'
        )}
      >
        <Search className="w-5 h-5 text-ink-400 shrink-0" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Company name, CIN or director"
          aria-label="Search companies"
          className="flex-1 min-w-0 bg-transparent text-[16px] text-ink-950 placeholder:text-ink-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        <button
          type="submit"
          className={cn(
            'rounded-full bg-mustard-500 hover:bg-mustard-400 text-ink-950 font-bold font-display inline-flex items-center gap-2 transition-colors',
            size === 'lg' ? 'h-12 px-6 text-[15px]' : 'h-10 px-5 text-[14px]'
          )}
        >
          Search
          <ArrowRight className="w-4 h-4 hidden sm:block" />
        </button>
      </form>

      {open && (
        <div className="absolute z-20 left-0 right-0 mt-2 rounded-2xl bg-white ring-1 ring-ink-200 shadow-[0_32px_64px_-24px_rgba(23,23,22,0.35)] overflow-hidden text-left">
          {matches.length === 0 ? (
            <p className="px-5 py-4 text-[14px] text-ink-500">No company found for “{q.trim()}”.</p>
          ) : (
            <ul>
              {matches.map((c) => (
                <li key={c.slug} className="border-b border-ink-100 last:border-b-0">
                  <Link to={`/company/${c.slug}`} className="flex items-center gap-3 px-5 py-3 hover:bg-ink-50 transition-colors">
                    <span className="w-9 h-9 rounded-xl bg-ink-50 ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold text-ink-950 truncate">{c.name}</span>
                      <span className="block text-[12.5px] text-ink-500 font-mono truncate">{c.cin}</span>
                    </span>
                    <span className="hidden sm:block text-[12.5px] text-ink-500">{c.city}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
