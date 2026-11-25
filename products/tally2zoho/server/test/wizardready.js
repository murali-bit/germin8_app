// Test helper (not a test file): does in the Import Wizard what a person must do before a file can be marked imported:
// ticks the set-up and the bank check, and confirms the Migration Date once that step is open. The older route
// PUT /imports/:key follows the wizard's locks, so tests that use it call this first.
// call: ({ method, url, payload }) => Fastify inject response.
export async function wizardReady(call, base) {
  const read = async () => (await call({ url: `${base}/import-wizard` })).json();
  let w = await read();
  if (!w?.available) return w;
  for (const id of ['setup', 'bank']) {
    const s = w.steps.find(x => x.id === id);
    if (!s || s.locked) continue;
    const ticks = [...(s.ticks || []), ...(s.items || []).flatMap(i => i.ticks || [])];
    for (const t of ticks) if (!t.done) await call({ method: 'PUT', url: `${base}/import-wizard/ticks`, payload: { step: id, item: t.id, done: true } });
  }
  w = await read();
  const d = w.steps.find(x => x.id === 'date');
  if (d && !d.done && !d.locked && d.date?.value) {
    await call({ method: 'PUT', url: `${base}/import-wizard/zoho-opening-date`, payload: { date: d.date.value } });
    w = await read();
  }
  return w;
}
