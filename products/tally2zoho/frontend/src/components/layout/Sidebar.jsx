import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  LayoutDashboard,
  PlusCircle,
  Download,
  Table,
  Upload,
  Database,
  GitBranch,
  Tag,
  AlertTriangle,
  FileSpreadsheet,
  FileDown,
  Activity,
  AlertCircle,
  FileText,
  Link2,
  Scale,
  Building,
  FolderArchive,
  Settings,
  HelpCircle,
  ShieldCheck,
  ClipboardCheck,
  Columns,
  ListChecks,
  Route,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import { flowStepNumber } from '../../navigation';

export default function Sidebar({ currentScreen, onNavigate, user, open = false, onClose }) {
  // People who can only view cannot create a migration, so that entry is left out for them.
  const viewer = user?.role === 'viewer';
  // From 1024 px the menu can be folded to icons only; the choice is remembered in this browser.
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem('menu-folded') === '1'; } catch { return false; } });
  const toggleFold = () => setFolded(f => { const n = !f; try { localStorage.setItem('menu-folded', n ? '1' : '0'); } catch { /* not kept */ } return n; });
  const allSections = [
    {
      title: "Workspace",
      items: [
        { id: "screen-11", label: "Dashboard", icon: LayoutDashboard },
        { id: "screen-12", label: "New Migration", icon: PlusCircle },
        { id: "screen-36", label: "Progress checklist", icon: Route },
      ]
    },
    {
      title: "1. Get your Tally data",
      items: [
        { id: "screen-13", label: "Tally Export Guide", icon: Download },
        { id: "screen-14", label: "Export Catalogue", icon: Table },
        { id: "screen-15", label: "Upload Center", icon: Upload },
        { id: "screen-16", label: "Completeness Check", icon: ClipboardCheck },
        { id: "screen-17", label: "Processing Status", icon: Activity },
        { id: "screen-18", label: "Data Explorer", icon: Database },
      ]
    },
    {
      title: "2. Mapping",
      items: [
        { id: "screen-19", label: "Mapping Studio", icon: GitBranch },
        { id: "screen-20", label: "Voucher Classification", icon: Tag },
      ]
    },
    {
      title: "3. Output",
      items: [
        { id: "screen-22", label: "Template Library", icon: FileSpreadsheet },
        { id: "screen-23", label: "Template Mapping", icon: Columns },
        { id: "screen-24", label: "Validation Center", icon: AlertTriangle },
        { id: "screen-25", label: "Export Center", icon: FileDown },
        { id: "screen-38", label: "Zoho check", icon: ShieldCheck },
        { id: "screen-37", label: "Voucher Reconciliation", icon: ListTree },
      ]
    },
    {
      title: "4. Import and Resolve",
      items: [
        { id: "screen-40", label: "Import Wizard", icon: ListChecks },
        { id: "screen-28", label: "Rejection Manager", icon: AlertCircle },
      ]
    },
    {
      title: "5. Verify",
      items: [
        { id: "screen-29", label: "Identifier Tracker", icon: Link2 },
        { id: "screen-30", label: "Reconciliation", icon: Scale },
        { id: "screen-31", label: "Reports and Audit", icon: FileText },
      ]
    },
    {
      title: "Settings",
      items: [
        { id: "screen-32", label: "Company Settings", icon: Building },
        { id: "screen-33", label: "Mapping Profiles", icon: FolderArchive },
        { id: "screen-34", label: "Users and Roles", icon: Settings },
        { id: "screen-35", label: "Help", icon: HelpCircle },
      ]
    }
  ];
  const navSections = viewer
    ? allSections.map(section => ({ ...section, items: section.items.filter(item => item.id !== 'screen-12') }))
    : allSections;

  // Below 1024 px the menu is a drawer over the page: opened with the header's menu button, closed with the close
  // button, Escape, a click beside it, or by choosing a page. From 1024 px it is always shown beside the page.
  const closeRef = useRef(null);
  const returnTo = useRef(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return undefined;
    returnTo.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = e => { if (e.key === 'Escape') close.current?.(); };
    window.addEventListener('keydown', onKey);
    // the drawer closes by itself when the window becomes wide enough to show the menu beside the page
    const wide = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 1024px)') : null;
    const onWide = () => { if (wide?.matches) close.current?.(); };
    wide?.addEventListener?.('change', onWide);
    return () => {
      window.removeEventListener('keydown', onKey);
      wide?.removeEventListener?.('change', onWide);
      const back = returnTo.current;
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus();
    };
  }, [open]);

  // the drawer is always wide; only the menu beside the page (from 1024 px) folds
  const slim = folded;
  return (
    <>
    {open && <div className="lg:hidden fixed inset-0 z-40 bg-ink/40" onClick={onClose} aria-hidden="true" />}
    <aside
      id="main-menu"
      aria-label="Menu"
      className={`bg-chrome text-chrome-text border-r border-chrome-line h-screen flex-col shrink-0 select-none w-[248px] max-w-[85vw] ${slim ? 'lg:w-[68px]' : 'lg:w-[248px]'}
        transition-[width] duration-150 lg:flex lg:static lg:shadow-none
        ${open ? 'flex fixed inset-y-0 left-0 z-50 shadow-xl' : 'hidden'}`}
    >
      <div className={`h-14 px-4 flex items-center gap-3 border-b border-chrome-line shrink-0 ${slim ? 'lg:justify-center lg:px-0' : ''}`}>
        <svg viewBox="0 0 48 44" className="w-8 h-7 shrink-0" aria-hidden="true">
          <path d="M24 2 4 42h9.5L24 20l10.5 22H44L24 2Z" fill="#408dfb" />
          <path d="M20 42 30 42 25 32Z" fill="#ffffff" />
        </svg>
        <div className={`leading-tight min-w-0 ${slim ? 'lg:hidden' : ''}`}>
          <div className="text-[15px] font-semibold tracking-tight text-ink">Accounting Migration</div>
          <div className="text-[11px] text-chrome-muted truncate">TallyPrime to Zoho Books</div>
        </div>
        {open && (
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close the menu"
            className="lg:hidden ml-auto inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-md text-ink hover:bg-chrome-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <X className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>

      <nav aria-label="Main menu" className="scroll-dark flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {navSections.map((section, sIdx) => (
          <div key={sIdx} role="group" aria-label={section.title}>
            <div className={`px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-chrome-muted ${slim ? 'lg:hidden' : ''}`}>
              {section.title}
            </div>
            {sIdx > 0 && <div className={`hidden mx-2 mb-2 border-t border-chrome-line ${slim ? 'lg:block' : ''}`} aria-hidden="true" />}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const IconComponent = item.icon;
                const isActive = currentScreen === item.id;
                const screenTarget = item.targetScreen || item.id;
                // pages that are a step of the guided flow show their step number, so the menu and the steps strip agree
                const stepNo = flowStepNumber(item.id);
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => onNavigate(screenTarget)}
                    aria-current={isActive ? 'page' : undefined}
                    title={slim ? item.label : undefined}
                    className={`relative w-full min-h-10 flex items-center justify-between gap-2 px-3 py-2 rounded-md text-[14px] text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand ${slim ? 'lg:justify-center lg:px-0' : ''} ${
                      isActive
                        ? 'bg-chrome-active text-info-ink font-semibold'
                        : 'font-medium text-chrome-text hover:text-ink hover:bg-chrome-hover'
                    }`}
                  >
                    {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-brand" aria-hidden="true" />}
                    <span className="flex items-center gap-3 min-w-0">
                      <IconComponent className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
                      <span className={`truncate ${slim ? 'lg:sr-only' : ''}`}>{item.label}</span>
                    </span>
                    {stepNo && !item.badge && (
                      <span title={`Step ${stepNo} of the guided steps`} aria-label={`step ${stepNo}`}
                        className={`min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full text-[11px] font-semibold leading-none shrink-0 ${slim ? 'lg:hidden' : ''} ${isActive ? 'bg-action text-white' : 'bg-chrome-hover text-chrome-muted border border-chrome-line'}`}>
                        {stepNo}
                      </span>
                    )}
                    {item.badge && (
                      <span className={`min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-action text-white text-[11px] font-semibold leading-none shrink-0 ${slim ? 'lg:hidden' : ''}`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-chrome-line shrink-0">
        <div className={`px-4 pt-3 flex items-center gap-2.5 ${slim ? 'lg:hidden' : ''}`}>
          <ShieldCheck className="w-4 h-4 text-chrome-muted shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span className="text-[12px] leading-snug text-chrome-muted">Your Tally files are read, never changed.</span>
        </div>
        <button
          type="button"
          onClick={toggleFold}
          aria-label={slim ? 'Expand the menu' : 'Fold the menu to icons'}
          aria-pressed={slim}
          title={slim ? 'Expand the menu' : 'Fold the menu'}
          className={`hidden lg:flex m-2 min-h-10 items-center gap-3 px-3 rounded-md text-[13px] text-chrome-text hover:text-ink hover:bg-chrome-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand ${slim ? 'justify-center px-0 w-[calc(100%-1rem)]' : 'w-[calc(100%-1rem)]'}`}
        >
          {slim ? <PanelLeftOpen className="w-[18px] h-[18px]" strokeWidth={1.75} aria-hidden="true" /> : <><PanelLeftClose className="w-[18px] h-[18px]" strokeWidth={1.75} aria-hidden="true" /> Fold menu</>}
        </button>
      </div>
    </aside>
    </>
  );
}
