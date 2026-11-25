import { useCallback, useEffect, useRef, useState } from 'react';
import { createOnceCache, keepStoredId } from './migrationSelection';
import { apiUrl } from './apiUrl';

const JOB_KEY = 'currentMigrationId';
const SERVER_DOWN = 'Cannot reach the migration server. Start it with "npm start" in the server folder.';

// Events on window: the list of migrations changed (one was created or its details saved), and another migration was
// chosen (the page stays where it is and shows the chosen migration).
export const MIGRATIONS_CHANGED = 'migrations-changed';
export const MIGRATION_SELECTED = 'migration-selected';

// One request for the selected migration per page, shared by every part of the page that needs it (useJob).
const jobCache = createOnceCache(2000);
export const clearJobCache = () => jobCache.clear();

export const getCurrentJobId = () => { try { return localStorage.getItem(JOB_KEY); } catch { return null; } };
export const setCurrentJobId = id => {
  try { if (id) localStorage.setItem(JOB_KEY, id); else localStorage.removeItem(JOB_KEY); } catch { /* ignore */ }
  jobCache.clear();
};
export const clearCurrentJobId = () => setCurrentJobId(null);

// The server answers a request it has no route for with { error: 'Not Found', message: 'Route GET:/api/... not found' }.
// That means the running server is older than this page (or the address is wrong), not that the migration is missing.
export const OLD_SERVER = 'The server that is running does not have this function yet. It is probably an older version: restart the server, then try again.';
export const isMissingRoute = (status, data) => status === 404 && /^Route \S+ not found/i.test(String(data?.message || ''));
const errorText = (status, data) => (isMissingRoute(status, data) ? OLD_SERVER
  : data.error || (status >= 500 ? SERVER_DOWN : `Request failed (${status})`));

// '/migrations/1/x' and '/api/migrations/1/x' (a route the server sends whole, e.g. in the Import Wizard) both become
// '/api/migrations/1/x', so a route is never sent as '/api/api/...'.
export { apiUrl };

async function request(method, url, body, headers = {}) {
  let res;
  try {
    res = await fetch(apiUrl(url), {
      method,
      headers: body instanceof Blob ? headers : body ? { 'content-type': 'application/json', ...headers } : headers,
      body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(SERVER_DOWN);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/auth/login') window.dispatchEvent(new Event('auth-required'));
  if (!res.ok) {
    const err = new Error(errorText(res.status, data));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const fileHeaders = file => ({ 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) });

export const api = {
  get: url => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: url => request('DELETE', url),
  upload: (jobId, slot, file) => request('PUT', `/migrations/${jobId}/uploads/${slot}`, file, fileHeaders(file)),
  sendFile: (url, file) => request('PUT', url, file, fileHeaders(file)),
  downloadUrl: (jobId, key) => `/api/migrations/${jobId}/files/${key}/download`,
};

// Fetches a file and saves it, so that a refused download shows a message instead of a blank error page.
// Throws an Error (with status and data) when the server refuses.
export async function downloadFile(url, fallbackName = 'download.csv') {
  let res;
  try { res = await fetch(url); } catch { throw new Error(SERVER_DOWN); }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) window.dispatchEvent(new Event('auth-required'));
    const err = new Error(errorText(res.status, data));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  const blob = await res.blob();
  const name = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href; a.download = name; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}

// Every useJob of the page hears the answer of a reload made by any of them, so the parts of a page agree.
const jobListeners = new Set();
const shareJob = (id, value) => { for (const l of jobListeners) l(id, value); };

// Loads the current migration job (with completeness) and exposes a reload function. The parts of one page share one
// request (jobCache); reload() always reads it again and passes the answer to the other parts of the page.
export function useJob() {
  const [state, setState] = useState({ job: null, loading: true, error: '' });
  const read = useCallback(async fresh => {
    const id = getCurrentJobId();
    if (!id) return setState({ job: null, loading: false, error: '' });
    if (fresh) jobCache.clear(id);
    try {
      const job = await jobCache.get(id, () => api.get(`/migrations/${id}`));
      if (getCurrentJobId() !== id) return undefined; // another migration was chosen meanwhile
      const next = { job, loading: false, error: '' };
      if (fresh) shareJob(id, next); else setState(next);
    } catch (e) {
      // a migration that is gone, or belongs to another firm (the server answers 404 for both), is "none selected":
      // the stored id is dropped so no other screen asks for it again
      if (e.status === 404 || e.status === 403) { if (getCurrentJobId() === id) setCurrentJobId(null); setState({ job: null, loading: false, error: '' }); }
      else setState({ job: null, loading: false, error: e.message });
    }
    return undefined;
  }, []);
  useEffect(() => {
    const hear = (id, value) => { if (getCurrentJobId() === id) setState(value); };
    jobListeners.add(hear);
    read(false);
    return () => { jobListeners.delete(hear); };
  }, [read]);
  const reload = useCallback(() => read(true), [read]);
  return { ...state, reload };
}

// Another migration is chosen: stored, and the page shows it (App remounts the screen), without a reload.
export const chooseMigration = id => {
  setCurrentJobId(id);
  window.dispatchEvent(new CustomEvent(MIGRATION_SELECTED, { detail: { id } }));
};
// The list of migrations changed (created, details saved): the header list and the Dashboard read it again.
export const notifyMigrationsChanged = () => {
  jobCache.clear();
  window.dispatchEvent(new Event(MIGRATIONS_CHANGED));
};
// After sign-in: the stored migration is kept only when it was chosen by this same user and this user can see it, so
// one person never lands on another person's last migration. Returns the id kept, or null.
const JOB_USER_KEY = 'currentMigrationUser';
export async function checkStoredMigration(userEmail) {
  let owner = null;
  try { owner = localStorage.getItem(JOB_USER_KEY); localStorage.setItem(JOB_USER_KEY, userEmail || ''); } catch { /* ignore */ }
  if (owner != null && owner !== (userEmail || '')) setCurrentJobId(null);
  const stored = getCurrentJobId();
  if (!stored) return null;
  let list;
  try { list = await api.get('/migrations'); } catch { return stored; } // cannot tell now: keep it, useJob drops a 404
  const keep = keepStoredId(stored, list);
  if (!keep) setCurrentJobId(null);
  return keep;
}

export const isProcessed = job => !!job && ['processed', 'generated'].includes(job.status);

// A piece of screen state (the page, a filter, the tab chosen) that is kept when the page is reloaded and when the
// user comes back to the screen. It lives in the browser tab only (session storage); key says which screen and what.
export function useStickyState(key, initial) {
  const storageKey = `keep:${key}`;
  const [value, setValue] = useState(() => {
    try { const raw = sessionStorage.getItem(storageKey); return raw == null ? initial : JSON.parse(raw); } catch { return initial; }
  });
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* not kept: the screen still works */ } }, [storageKey, value]);
  return [value, setValue];
}

// Processing runs in the background. These states mean a run is waiting to start or under way.
export const PROCESS_ACTIVE = ['queued', 'running'];
export const isProcessing = job => !!job && (job.status === 'processing' || PROCESS_ACTIVE.includes(job.processing?.state));

// Reads the processing progress of a migration and keeps reading it about once a second while a run is
// queued or running. onFinish(status) is called once when a run that was being watched ends (done or failed).
// Pass jobId null to stop watching. Polling stops when the screen is left.
export function useProcessStatus(jobId, onFinish) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  const finish = useRef(onFinish);
  useEffect(() => { finish.current = onFinish; }, [onFinish]);

  useEffect(() => {
    if (!jobId) { setStatus(null); setError(''); return undefined; }
    let stopped = false;
    let timer = null;
    let watching = false;
    const read = async () => {
      try {
        const s = await api.get(`/migrations/${jobId}/process-status`);
        if (stopped) return;
        setStatus(s); setError('');
        if (PROCESS_ACTIVE.includes(s.state)) {
          watching = true;
          timer = setTimeout(read, 1000);
        } else if (watching) {
          watching = false;
          finish.current?.(s);
        }
      } catch (e) {
        if (stopped) return;
        setError(e.message);
        if (watching && e.status !== 401 && e.status !== 404) timer = setTimeout(read, 3000); // keep trying while a run is being watched
      }
    };
    read();
    return () => { stopped = true; clearTimeout(timer); };
  }, [jobId, round]);

  // Reads the progress again, for example right after a run was started on the same screen.
  const refresh = useCallback(() => setRound(n => n + 1), []);
  return { status, error, refresh };
}

// 75 -> "1 minute 15 seconds"
export const formatDuration = seconds => {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '';
  const total = Math.max(0, Math.round(Number(seconds)));
  const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (total < 60) return unit(total, 'second');
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  if (h) return `${unit(h, 'hour')}${m ? ` ${unit(m, 'minute')}` : ''}`;
  return `${unit(m, 'minute')}${s ? ` ${unit(s, 'second')}` : ''}`;
};
export const formatSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} bytes`);

// Indian number format with two decimals, for example 1,45,000.00
export const formatAmount = v => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
};
// Tally stores debits as negative amounts.
export const drCr = v => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return !Number.isFinite(n) || n === 0 ? '' : `${formatAmount(n)} ${n < 0 ? 'Dr' : 'Cr'}`;
};
// "20240612" -> "12 Jun 2024"
export const formatTallyDate = d => {
  const s = String(d || '');
  if (!/^\d{8}$/.test(s)) return s;
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Opening a screen at one of its sections (for example from the Prepare migration checklist): the section's element id
// is kept for the next screen, which scrolls to it with useScrollTarget once the element is on the page.
const TARGET_KEY = 'scrollTarget';
// goTo(onNavigate, screen, anchor, params): params go into the address (for example { section, filter }), so the
// browser's Back and a reload open the same section with the same filter.
export const goTo = (onNavigate, screen, anchor, params) => {
  try { if (anchor) sessionStorage.setItem(TARGET_KEY, anchor); else sessionStorage.removeItem(TARGET_KEY); } catch { /* ignore */ }
  onNavigate(screen, params || {});
};
// Scrolls to the section asked for (the `section` param of the address, else the anchor kept by goTo) once it is on the
// page AND the page has finished loading: nothing above it is still loading (aria-busy) and the page height has not
// changed for about 300 ms. Gives up after about 10 seconds.
export function useScrollTarget(section) {
  useEffect(() => {
    let target = section || null;
    if (!target) { try { target = sessionStorage.getItem(TARGET_KEY); } catch { return undefined; } }
    if (!target) return undefined;
    let tries = 0, lastHeight = -1, stableFor = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(target);
      const main = document.getElementById('main-content') || document.body;
      const height = main.scrollHeight;
      stableFor = height === lastHeight ? stableFor + 1 : 0;
      lastHeight = height;
      const busy = !!main.querySelector('[aria-busy="true"]');
      if ((!el || busy || stableFor < 3) && ++tries < 100) return;
      clearInterval(timer);
      try { sessionStorage.removeItem(TARGET_KEY); } catch { /* ignore */ }
      if (el) { el.scrollIntoView({ behavior: 'auto', block: 'start' }); el.focus?.({ preventScroll: true }); }
    }, 100);
    return () => clearInterval(timer);
  }, [section]);
}
