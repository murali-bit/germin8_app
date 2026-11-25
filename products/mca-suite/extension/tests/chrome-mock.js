// Fake chrome.* for opening popup.html in a normal tab. Storage persists in localStorage so a
// reload behaves like closing and reopening the side panel.
(function () {
  const KEY = '__mockStore';
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const save = s => localStorage.setItem(KEY, JSON.stringify(s));
  if (!localStorage.getItem(KEY)) save({
    importedClients: {
      u01100ka2019ptc000001_31032025: { general: { CIN: 'U01100KA2019PTC000001', FY_FROM: '01/04/2024', FY_TO: '31/03/2025' }, displayName: 'Demo Terra Technology Private Limited' },
      u01100ka2019ptc000002_31032025: { general: { CIN: 'U01100KA2019PTC000002', FY_FROM: '01/04/2024', FY_TO: '31/03/2025' }, displayName: 'Sample Labs Private Limited' },
    },
    jobsSynced: { recent: [{ jobId: 'j1', name: 'Demo Terra Technology Private Limited (AOC-4)', formType: 'aoc4', at: Date.now() - 60000 }], unseen: 1 },
    jobsStatus: { ok: true, checkedAt: Date.now() },
    jobLinks: { u01100ka2019ptc000001_31032025: { jobId: 'j1', formType: 'aoc4', clientKey: 'u01100ka2019ptc000001_31032025' } },
  });
  const listeners = [];
  const get = async keys => { const s = load(); if (keys == null) return s; const ks = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys); const o = {}; ks.forEach(k => { if (k in s) o[k] = s[k]; }); return o; };
  const set = async obj => { const s = load(); const ch = {}; for (const k in obj) { ch[k] = { oldValue: s[k], newValue: obj[k] }; s[k] = obj[k]; } save(s); listeners.forEach(f => f(ch, 'local')); };
  const remove = async k => { const s = load(); [].concat(k).forEach(x => delete s[x]); save(s); };
  const cbify = f => (a, cb) => { const p = f(a); if (cb) p.then(cb); return p; };
  window.chrome = {
    storage: { local: { get: cbify(get), set: cbify(set), remove: cbify(remove) }, onChanged: { addListener: f => listeners.push(f) } },
    runtime: { sendMessage: async m => ({ ok: true }), getURL: p => '/' + p, getManifest: () => ({ version: 'test', name: 'Germin8' }), onMessage: { addListener() {} }, lastError: null },
    tabs: { query: async () => [], onActivated: { addListener() {} }, onUpdated: { addListener() {} }, sendMessage: async () => ({}) },
    scripting: { executeScript: async () => [] },
    sidePanel: null,
  };
})();
