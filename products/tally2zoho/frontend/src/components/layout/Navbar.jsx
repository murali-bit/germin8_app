import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Plus, LogOut, Menu, Search, Settings, X } from 'lucide-react';
import { api, chooseMigration, getCurrentJobId, MIGRATIONS_CHANGED } from '../../api';
import { SCREEN_LIST } from '../../navigation';

const ROLE = { super_admin: 'Super Admin', admin: 'Admin', analyst: 'Migration Analyst', viewer: 'Client Viewer' };

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

// Extra words that find a screen in the search box (the screen name always works). Keyed by the screen's address name.
const KEYWORDS = {
  'upload-center': 'upload files tally json csv',
  'completeness-check': 'missing files check',
  'zoho-check': 'predict refuse errors before download tds gst hsn',
  'export-center': 'download create files zoho csv',
  'import-wizard': 'import zoho steps',
  'rejection-manager': 'refused errors rejected rows',
  'reconciliation': 'trial balance compare',
  'voucher-reconciliation': 'voucher compare count',
  'reports': 'report audit log',
  'users': 'people roles account',
  'help': 'support guide',
  'mapping-studio': 'ledger group map accounts',
  'voucher-classification': 'voucher type bill invoice journal',
  'company-settings': 'company gst state',
};

// Screens the search can open: one entry per name (the old addresses that all open the Import Wizard are left out).
const searchable = viewer => {
  const seen = new Map();
  for (const s of SCREEN_LIST) seen.set(s.label, s);
  return [...seen.values()].filter(s => !(viewer && s.slug === 'new-migration'));
};

// Global search: type a screen name, choose with the arrow keys or the mouse, and the page opens.
function GlobalSearch({ onNavigate, viewer, autoFocus = false, onDone }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef(null);
  const input = useRef(null);
  const items = useMemo(() => searchable(viewer), [viewer]);
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return items
      .map(s => {
        const name = s.label.toLowerCase();
        const score = name.startsWith(term) ? 0 : name.includes(term) ? 1 : (KEYWORDS[s.slug] || '').includes(term) ? 2 : 9;
        return { s, score };
      })
      .filter(r => r.score < 9)
      .sort((a, b) => a.score - b.score)
      .slice(0, 7)
      .map(r => r.s);
  }, [q, items]);

  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);
  // "/" focuses the search from anywhere that is not a text field
  useEffect(() => {
    const onKey = e => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !e.target?.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const go = s => { setQ(''); setOpen(false); input.current?.blur(); onDone?.(); onNavigate(s.id); };
  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (results[active]) { e.preventDefault(); go(results[active]); } }
    else if (e.key === 'Escape') { if (open || q) { e.stopPropagation(); setOpen(false); setQ(''); } else onDone?.(); }
  };
  const showList = open && q.trim().length > 0;

  return (
    <div ref={wrap} className="relative w-full">
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-chrome-muted pointer-events-none" strokeWidth={1.75} aria-hidden="true" />
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label="Search screens"
        aria-expanded={showList}
        aria-controls="global-search-list"
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `gs-${results[active].id}` : undefined}
        value={q}
        onChange={e => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search screens (press / to start)"
        autoComplete="off"
        className="w-full h-9 rounded-md bg-chrome-2 border border-chrome-line text-[14px] text-ink placeholder:text-chrome-muted pl-9 pr-3 hover:bg-chrome-hover focus:outline-none focus:bg-white focus:text-ink focus:placeholder:text-subtle focus:border-brand focus:ring-2 focus:ring-brand/40"
      />
      {showList && (
        <ul id="global-search-list" role="listbox" aria-label="Screens found" className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-line rounded-lg shadow-lg z-40 py-1 text-ink">
          {results.length === 0 && <li role="option" aria-selected="false" aria-disabled="true" className="px-3 py-2 text-[14px] text-muted">No screen matches "{q.trim()}".</li>}
          {results.map((s, i) => (
            <li
              key={s.id}
              id={`gs-${s.id}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={e => { e.preventDefault(); go(s); }}
              className={`px-3 py-2 text-[14px] cursor-pointer ${i === active ? 'bg-brand-soft text-info-ink font-medium' : ''}`}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// jobKey: the migration chosen now (App); the list is read again when it changes and when a migration is created
// or its details are saved (MIGRATIONS_CHANGED).
export default function Navbar({ onNavigate, user, onLogout, onMenu, menuOpen = false, jobKey = null }) {
  const [open, setOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [searching, setSearching] = useState(false); // below 640 px the search replaces the bar while it is open
  const [jobs, setJobs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef(null);
  const switchRef = useRef(null);
  const userWrap = useRef(null);
  const userBtn = useRef(null);
  const currentId = jobKey ?? getCurrentJobId();
  const current = jobs.find(j => j.id === currentId);
  const viewer = user.role === 'viewer';

  const loadJobs = useCallback(() => api.get('/migrations').then(list => { setJobs(Array.isArray(list) ? list : []); setLoaded(true); }).catch(() => setLoaded(true)), []);
  useEffect(() => { loadJobs(); }, [loadJobs, jobKey]);
  useEffect(() => {
    window.addEventListener(MIGRATIONS_CHANGED, loadJobs);
    return () => window.removeEventListener(MIGRATIONS_CHANGED, loadJobs);
  }, [loadJobs]);

  // Close the lists with the Escape key or by clicking anywhere outside them.
  useEffect(() => {
    if (!open && !userOpen) return undefined;
    const onKey = e => {
      if (e.key !== 'Escape') return;
      if (open) { setOpen(false); switchRef.current?.focus(); }
      if (userOpen) { setUserOpen(false); userBtn.current?.focus(); }
    };
    const onDown = e => {
      if (open && !wrapRef.current?.contains(e.target)) setOpen(false);
      if (userOpen && !userWrap.current?.contains(e.target)) setUserOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, userOpen]);

  // the page stays where it is and shows the chosen migration (App remounts it)
  const choose = id => { setOpen(false); if (id !== currentId) chooseMigration(id); switchRef.current?.focus(); };
  const initials = user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  // a stored id the list does not have (not loaded yet) shows the id rather than "No migration selected"
  const title = current ? current.company : currentId && !loaded ? 'Loading…' : 'No migration selected';
  const subtitle = current ? `${current.id} · FY ${current.financial_year}` : 'Choose or create a migration';
  const iconBtn = `inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-md text-ink hover:bg-chrome-hover ${focusRing}`;

  if (searching) {
    return (
      <header className="relative z-20 h-14 shrink-0 bg-chrome border-b border-chrome-line px-3 flex items-center gap-2">
        <GlobalSearch onNavigate={onNavigate} viewer={viewer} autoFocus onDone={() => setSearching(false)} />
        <button type="button" onClick={() => setSearching(false)} aria-label="Close search" className={iconBtn}><X className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></button>
      </header>
    );
  }

  return (
    <header className="relative z-20 whitespace-nowrap h-14 shrink-0 bg-chrome text-ink border-b border-chrome-line px-3 sm:px-4 flex items-center gap-2 sm:gap-3">
      {onMenu && (
        <button type="button" onClick={onMenu} aria-label="Open the menu" aria-expanded={menuOpen} aria-controls="main-menu" className={`lg:hidden ${iconBtn}`}>
          <Menu className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}

      <div ref={wrapRef} className="relative min-w-0 shrink">
        <button
          ref={switchRef}
          type="button"
          onClick={() => { setOpen(!open); loadJobs(); }}
          aria-expanded={open}
          aria-controls="migration-switcher-list"
          aria-label={current ? `Current migration: ${current.company}. Switch migration` : 'Choose or create a migration'}
          className={`flex items-center gap-2.5 max-w-full bg-chrome-2 hover:bg-chrome-hover border border-chrome-line pl-2 pr-3 h-10 rounded-md transition-colors ${focusRing}`}
        >
          <span className="w-6 h-6 rounded bg-brand text-white flex items-center justify-center shrink-0"><Building2 className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" /></span>
          <span className="text-left leading-tight min-w-0">
            <span className="block text-[13px] font-semibold text-ink truncate max-w-[110px] sm:max-w-[200px]">{title}</span>
            <span className="hidden sm:block text-[11px] text-chrome-text truncate max-w-[200px]">{subtitle}</span>
          </span>
          <ChevronDown className={`w-4 h-4 text-chrome-text shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {open && (
          <div id="migration-switcher-list" className="absolute left-0 top-full mt-2 w-[340px] max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto bg-white text-ink border border-line rounded-lg shadow-lg z-30 p-1.5 whitespace-normal">
            <div className="px-3 pt-1.5 pb-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">Switch migration</div>
            {jobs.length === 0 && <div className="px-3 py-2.5 text-[14px] text-muted">No migrations yet.</div>}
            {jobs.map(j => {
              const active = j.id === currentId;
              return (
                <button
                  type="button"
                  key={j.id}
                  onClick={() => choose(j.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`w-full min-h-11 flex items-center justify-between gap-3 text-left px-3 py-2 rounded-md hover:bg-soft ${focusRing} ${active ? 'bg-brand-soft' : ''}`}
                >
                  <span className="min-w-0 leading-tight">
                    <span className="block text-[12px] font-mono text-subtle truncate">{j.id}</span>
                    <span className={`block text-[14px] text-ink truncate ${active ? 'font-semibold' : 'font-medium'}`}>{j.company}</span>
                    <span className="block text-[12px] text-muted truncate">Financial year {j.financial_year}</span>
                  </span>
                  {active && <Check className="w-4 h-4 text-info-ink shrink-0" strokeWidth={2} aria-hidden="true" />}
                </button>
              );
            })}
            {!viewer && (
              <div className="border-t border-line mt-1.5 pt-1.5">
                <button
                  type="button"
                  onClick={() => { setOpen(false); onNavigate('screen-12'); }}
                  className={`w-full min-h-11 flex items-center gap-2 text-left px-3 py-2 rounded-md text-[14px] text-info-ink font-semibold hover:bg-brand-soft ${focusRing}`}
                >
                  <Plus className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Create a new migration
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="hidden sm:flex flex-1 justify-center min-w-0">
        <div className="w-full max-w-xl"><GlobalSearch onNavigate={onNavigate} viewer={viewer} /></div>
      </div>
      <div className="flex-1 sm:hidden" />

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button type="button" onClick={() => setSearching(true)} aria-label="Search screens" className={`sm:hidden ${iconBtn}`}>
          <Search className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
        </button>
        {!viewer && (
          <button
            type="button"
            onClick={() => onNavigate('screen-12')}
            aria-label="New Migration"
            className={`inline-flex items-center gap-1.5 h-9 bg-action hover:bg-action-hover text-white text-[14px] font-semibold px-3 rounded-md transition-colors ${focusRing}`}
          >
            <Plus className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
            <span className="hidden md:inline">New Migration</span>
          </button>
        )}
        <div ref={userWrap} className="relative">
          <button
            ref={userBtn}
            type="button"
            onClick={() => setUserOpen(!userOpen)}
            aria-haspopup="menu"
            aria-expanded={userOpen}
            aria-label={`${user.name}, ${ROLE[user.role]}. Account menu`}
            className={`flex items-center gap-2 rounded-md hover:bg-chrome-hover pl-1 pr-1 xl:pr-2.5 h-10 transition-colors ${focusRing}`}
          >
            <span className="w-8 h-8 rounded-full bg-action text-white text-[12px] font-semibold flex items-center justify-center shrink-0">{initials}</span>
            <span className="hidden xl:block text-left leading-tight">
              <span className="block text-[13px] font-semibold text-ink">{user.name}</span>
              <span className="block text-[11px] text-chrome-text">{ROLE[user.role]}</span>
            </span>
            <ChevronDown className="hidden xl:block w-4 h-4 text-chrome-text" strokeWidth={1.75} aria-hidden="true" />
          </button>
          {userOpen && (
            <div role="menu" aria-label="Account" className="absolute right-0 top-full mt-2 w-64 bg-white text-ink border border-line rounded-lg shadow-lg z-30 p-1.5 whitespace-normal">
              <div className="px-3 py-2 border-b border-line mb-1.5">
                <div className="text-[14px] font-semibold truncate">{user.name}</div>
                <div className="text-[12px] text-muted truncate">{ROLE[user.role]} · {user.firm}</div>
              </div>
              <button type="button" role="menuitem" onClick={() => { setUserOpen(false); onNavigate('screen-34'); }} className={`w-full min-h-10 flex items-center gap-2 text-left px-3 py-2 rounded-md text-[14px] hover:bg-soft ${focusRing}`}>
                <Settings className="w-4 h-4 text-muted" strokeWidth={1.75} aria-hidden="true" /> Users and Roles
              </button>
              <button type="button" role="menuitem" onClick={() => { setUserOpen(false); onLogout(); }} aria-label="Sign out" className={`w-full min-h-10 flex items-center gap-2 text-left px-3 py-2 rounded-md text-[14px] hover:bg-soft ${focusRing}`}>
                <LogOut className="w-4 h-4 text-muted" strokeWidth={1.75} aria-hidden="true" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
