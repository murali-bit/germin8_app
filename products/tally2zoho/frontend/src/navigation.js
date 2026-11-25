// Every screen of the app, its address in the browser bar, and the guided flow (one step per page).
// Plain JavaScript with no React, so it can be tested with node (frontend/test/navigation.test.js).

export const SCREEN_LIST = [
  { id: 'screen-11', slug: 'dashboard', label: 'Dashboard' },
  { id: 'screen-12', slug: 'new-migration', label: 'New Migration' },
  { id: 'screen-13', slug: 'tally-export-guide', label: 'Tally Export Guide' },
  { id: 'screen-14', slug: 'export-catalogue', label: 'Export Catalogue' },
  { id: 'screen-15', slug: 'upload-center', label: 'Upload Center' },
  { id: 'screen-16', slug: 'completeness-check', label: 'Completeness Check' },
  { id: 'screen-17', slug: 'processing-status', label: 'Processing Status' },
  { id: 'screen-18', slug: 'data-explorer', label: 'Data Explorer' },
  { id: 'screen-19', slug: 'mapping-studio', label: 'Mapping Studio' },
  { id: 'screen-20', slug: 'voucher-classification', label: 'Voucher Classification' },
  // 21, 26 and 27: old addresses only (the screens are gone); they open the Import Wizard (App.jsx ImportWizardRedirect)
  { id: 'screen-21', slug: 'dependency-manager', label: 'Import Wizard' },
  { id: 'screen-22', slug: 'template-library', label: 'Template Library' },
  { id: 'screen-23', slug: 'template-mapping', label: 'Template Mapping' },
  { id: 'screen-24', slug: 'validation-center', label: 'Validation Center' },
  { id: 'screen-25', slug: 'export-center', label: 'Export Center' },
  { id: 'screen-26', slug: 'import-instructions', label: 'Import Wizard' },
  { id: 'screen-27', slug: 'import-tracker', label: 'Import Wizard' },
  { id: 'screen-28', slug: 'rejection-manager', label: 'Rejection Manager' },
  { id: 'screen-29', slug: 'identifier-tracker', label: 'Identifier Tracker' },
  { id: 'screen-30', slug: 'reconciliation', label: 'Reconciliation' },
  { id: 'screen-31', slug: 'reports', label: 'Reports and Audit' },
  { id: 'screen-32', slug: 'company-settings', label: 'Company Settings' },
  { id: 'screen-33', slug: 'mapping-profiles', label: 'Mapping Profiles' },
  { id: 'screen-34', slug: 'users', label: 'Users and Roles' },
  { id: 'screen-35', slug: 'help', label: 'Help' },
  { id: 'screen-36', slug: 'prepare-migration', label: 'Progress checklist' },
  { id: 'screen-37', slug: 'voucher-reconciliation', label: 'Voucher Reconciliation' },
  { id: 'screen-38', slug: 'zoho-check', label: 'Zoho check' },
  // the Import Wizard replaces Dependency Manager, Import Instructions and Import Tracker (their addresses open it)
  { id: 'screen-40', slug: 'import-wizard', label: 'Import Wizard' },
];

export const HOME = 'screen-11';
export const NOT_FOUND = 'not-found';
const byId = Object.fromEntries(SCREEN_LIST.map(s => [s.id, s]));
const bySlug = Object.fromEntries(SCREEN_LIST.map(s => [s.slug, s]));

export const isKnownScreen = id => Object.prototype.hasOwnProperty.call(byId, id);
export const screenLabel = id => byId[id]?.label || '';

// The guided flow, one step per page. Back and Continue move along this list. Every step is its own page, and the
// side menu shows the step number next to that page (flowStepNumber). The Progress checklist (screen-36) is an overview
// of all steps, not a step itself.
export const FLOW = [
  { id: 'screen-12', title: 'Migration details' },
  { id: 'screen-15', title: 'Upload the Tally files' },
  { id: 'screen-16', title: 'Completeness Check' },
  { id: 'screen-17', title: 'Read the Tally data' },
  { id: 'screen-19', title: 'Check names, accounts and rates' },
  { id: 'screen-20', title: 'Decide where each journal goes' },
  { id: 'screen-25', title: 'Create and download the files' },
  { id: 'screen-40', title: 'Import into Zoho Books' },
];

// 1-based step number of a screen in the guided flow, or null when the screen is not a step (side menu badges).
export const flowStepNumber = id => { const i = FLOW.findIndex(s => s.id === id); return i < 0 ? null : i + 1; };

// { index, total, step, prev, next } for a screen in the flow, or null for any other screen.
export function flowPosition(id) {
  const index = FLOW.findIndex(s => s.id === id);
  if (index < 0) return null;
  return { index, total: FLOW.length, step: FLOW[index], prev: FLOW[index - 1] || null, next: FLOW[index + 1] || null };
}

// The flow as a progress strip (Dashboard): one entry per FLOW step, so every screen counts the same steps.
// done: { [screen id]: true when that step is done }. A step counts as done only when every step before it is done;
// the first step not done is 'current'. Returns [{ id, title, n, state: 'done' | 'current' | 'todo' }].
export function flowProgress(done = {}) {
  let open = true;
  let currentSet = false;
  return FLOW.map((s, i) => {
    let state = 'todo';
    if (open && done[s.id]) state = 'done';
    else if (!currentSet) { state = 'current'; currentSet = true; open = false; }
    return { id: s.id, title: s.title, n: i + 1, state };
  });
}

// Going back to New Migration from the flow opens the current migration's saved details, never an empty form.
export const EDIT_PARAMS = { edit: '1' };
export const backTarget = prev => (prev?.id === 'screen-12' ? { screen: 'screen-12', params: EDIT_PARAMS } : prev ? { screen: prev.id, params: {} } : null);

// How an in-app move changes the browser history. Each pushed entry remembers the address it was opened from
// (history.state.from). An in-app Back to the page this one was opened from is the browser's Back ('back'); any other
// in-app Back replaces this entry ('replace'), so browser Back afterwards does not return to the page just left.
// options: { replace, back }. Returns 'back' | 'replace' | 'push' | 'none'.
export function historyMove(currentHash, targetHash, state, options = {}) {
  if (options.back && state && state.from === targetHash) return 'back';
  if (options.replace || options.back) return 'replace';
  return currentHash === targetHash ? 'none' : 'push';
}

const cleanParams = params => {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '' && /^[a-z]+$/.test(k)) out[k] = String(v);
  return out;
};

// screen id (+ params) -> "#/upload-center" or "#/new-migration?edit=1"
export function buildHash(screen, params) {
  const s = byId[screen];
  if (!s) return `#/${encodeURIComponent(String(screen || ''))}`;
  const q = new URLSearchParams(cleanParams(params)).toString();
  return `#/${s.slug}${q ? `?${q}` : ''}`;
}

// "#/upload-center" -> { screen: 'screen-15', params: {} }. An empty hash is the Dashboard. Old style "#/screen-15" works too.
// Anything else -> { screen: 'not-found', params: {}, unknown: '<what was asked for>' }.
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  if (!raw) return { screen: HOME, params: {} };
  const [pathPart, query = ''] = raw.split('?');
  let name = pathPart.replace(/\/+$/, '');
  try { name = decodeURIComponent(name); } catch { /* keep as written */ }
  const params = cleanParams(Object.fromEntries(new URLSearchParams(query)));
  if (bySlug[name]) return { screen: bySlug[name].id, params };
  if (byId[name]) return { screen: name, params };
  return { screen: NOT_FOUND, params: {}, unknown: name };
}

// Params that only move within a page (the Import Wizard's step): changing them adds a browser history entry but does
// not reload the screen. screenKey is the key a screen is mounted under: the same for every value of those params.
export const IN_PAGE_PARAMS = { 'screen-40': ['step'] };
export function screenKey(screen, params) {
  const keep = { ...(params || {}) };
  for (const p of IN_PAGE_PARAMS[screen] || []) delete keep[p];
  return buildHash(screen, keep);
}

export const sameRoute = (a, b) => !!a && !!b && a.screen === b.screen
  && JSON.stringify(cleanParams(a.params)) === JSON.stringify(cleanParams(b.params));
