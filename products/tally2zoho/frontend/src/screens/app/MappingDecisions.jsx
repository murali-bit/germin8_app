import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, useStickyState } from '../../api';
import { readableWhen } from '../../components/OutOfDateBanner';
import { Card, btnSecondary, inputClass } from '../../components/ui';
import AcceptAsTally from '../../components/AcceptAsTally';
import { optionWords } from '../../mappingLogic';

const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-IN')} ${n === 1 ? one : many}`;
// Shows names exactly, but makes a hidden line break visible.
const shown = s => String(s ?? '').replace(/\r\n|\r|\n/g, ' [line break] ').trim();

function Message({ error, done }) {
  if (error) return <p role="alert" className="text-[14px] text-danger-ink"><strong>Not saved.</strong> {error}</p>;
  if (done) return <p role="status" className="text-[14px] text-success-ink">{done}</p>;
  return null;
}

// v2: every choice has a default. The option the files use is always shown selected: with a dashed border and the word
// "Default" while nobody chose it, with a solid border and "Your choice" once a person did.
// how: 'default' (selected because it is the default) | 'person' (selected by a person) | null (not selected).
export const optionTone = how => (how === 'person' ? 'border border-action bg-brand-soft ring-1 ring-brand/30'
  : how === 'default' ? 'border border-dashed border-action bg-brand-soft' : 'border border-line bg-white');
export function ChoiceTag({ how, isDefault }) {
  if (how === 'person') return <span className="ml-2 inline-block px-1.5 py-px rounded-full border border-info-line bg-info-soft text-[11px] font-semibold uppercase tracking-wide text-info-ink align-middle">Your choice</span>;
  if (how === 'default' || isDefault) return <span className={`ml-2 inline-block px-1.5 py-px rounded-full border text-[11px] font-semibold uppercase tracking-wide align-middle ${how === 'default' ? 'border-line bg-soft text-muted' : 'border-line bg-white text-subtle'}`}>Default</span>;
  return null;
}
// One radio option as a card. checked + isDefault + !byPerson -> shown as the default.
export function OptionCard({ name, checked, isDefault, byPerson, disabled, onChange, label, text, inline = false }) {
  const how = checked ? (byPerson ? 'person' : 'default') : null;
  return (
    <label className={`${inline ? 'inline-flex items-center h-9 px-3' : 'flex items-start p-2.5'} gap-2 rounded-xl text-[14px] ${optionTone(how)} ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <input type="radio" name={name} className={inline ? '' : 'mt-1'} checked={!!checked} disabled={disabled} onChange={onChange} />
      <span className="min-w-0">
        <span className="font-medium text-ink">{label}</span><ChoiceTag how={how} isDefault={isDefault} />
        {text && <span className="block text-[13px] text-muted">{text}</span>}
      </span>
    </label>
  );
}
export { optionWords };
export const Loading = ({ title, error }) => <Card title={title}><div className="p-4 text-[14px] text-muted" aria-busy={error ? undefined : 'true'}>{error || 'Loading…'}</div></Card>;

// ---------------------------------------------------------------------------------------------------------------
// GST treatment codes (Company Settings). Per firm; only an admin can change it.
export function GstCodesCard({ onChanged }) {
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => { api.get('/settings/gst-codes').then(setView).catch(e => setError(e.message)); }, []);

  const save = async body => {
    setBusy(true); setError(''); setDone('');
    try {
      const r = await api.put('/settings/gst-codes', body);
      setView(r);
      setDone(r.changed ? 'Saved. The Customers and Vendors files created earlier are out of date: create the files again in the Export Center.' : 'Nothing changed.');
      onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (!view) return <Card title="GST treatment codes"><div className="p-4 text-[14px] text-muted">{error || 'Loading…'}</div></Card>;
  const readOnly = !view.canChange;
  const chosen = view.options.find(o => o.id === view.codeSet);

  return (
    <Card title="GST treatment codes"
      subtitle="Zoho publishes two different sets of codes for the GST Treatment column of the Customers and Vendors files, and it is not yet known which one its import accepts. Start with the codes of Zoho's import sample. If Zoho rejects them in the first test import, switch here and create the files again.">
      <fieldset className="p-4 space-y-3" disabled={readOnly || busy}>
        <legend className="sr-only">Which GST treatment codes to write</legend>
        {view.options.map(o => (
          <label key={o.id} className={`flex items-start gap-3 rounded-xl border p-3 ${o.id === view.codeSet ? 'border-action bg-brand-soft' : 'border-line'}`}>
            <input type="radio" name="gst-codes" className="mt-1" checked={o.id === view.codeSet} onChange={() => save({ codeSet: o.id })} />
            <span className="min-w-0">
              <span className="block text-[15px] font-medium text-ink">{o.label}</span>
              <span className="block text-[14px] text-muted">{o.explanation}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="px-4 pb-4 overflow-x-auto">
        <table className="w-full text-[14px]">
          <caption className="text-left text-[14px] font-medium text-ink pb-2">What each kind of party is written as</caption>
          <thead>
            <tr className="text-left text-[13px] text-muted border-b border-line">
              <th className="py-2 pr-4 font-medium">Party in Tally</th>
              {view.options.map(o => <th key={o.id} className="py-2 pr-4 font-medium">{o.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {view.options[0].rows.map((row, i) => (
              <tr key={row.kind} className="border-b border-line align-top">
                <td className="py-2 pr-4 text-ink">{row.meaning}</td>
                {view.options.map(o => (
                  <td key={o.id} className="py-2 pr-4 font-mono text-[13px] text-ink">
                    {o.rows[i].code || <span className="font-sans text-[14px]">Left empty and flagged{o.id === 'help' && view.unregisteredConsumerAs ? ' (unless decided below)' : ''}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {chosen?.notWritten?.length > 0 && (
          <p className="mt-2 text-[13px] text-muted">
            Codes on Zoho's help page that are never written, because no Tally registration type means them: {chosen.notWritten.map(n => `${n.code} (${n.meaning})`).join('; ')}.
          </p>
        )}
      </div>

      {view.codeSet === 'help' && (
        <div className="px-4 pb-4">
          <label className="block text-[14px]">
            <span className="block font-medium text-ink mb-1">A party marked "Unregistered/Consumer" in Tally</span>
            <span className="block text-muted mb-2">Tally does not say whether such a party is an unregistered business or a consumer, and these codes tell the two apart. Decide once for every such party, or leave them empty and flagged.</span>
            <select value={view.unregisteredConsumerAs} disabled={readOnly || busy} onChange={e => save({ unregisteredConsumerAs: e.target.value })} className={`${inputClass} sm:max-w-md`}>
              {view.unregisteredConsumerOptions.map(o => <option key={o.id} value={o.id}>{o.words.charAt(0).toUpperCase() + o.words.slice(1)}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="px-4 py-3 border-t border-line text-[14px] text-muted space-y-1">
        {readOnly && <div>Only an admin can change this setting.</div>}
        {view.updatedBy && <div>Last changed by {view.updatedBy}{readableWhen(view.updatedAt) ? ` on ${readableWhen(view.updatedAt)}` : ''}.</div>}
        <div>Applies to every migration of your firm. Your Tally data is never changed: only the code written in the files.</div>
        <Message error={error} done={done} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Rates (Mapping Studio): selling and purchase rate per stock item, accounts and tax preference.
function ItemRow({ row, view, readOnly, onSave }) {
  const [draft, setDraft] = useState(row);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setDraft(row), [row]);
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const fields = ['rate', 'purchaseRate', 'taxability', 'exemptionReason', 'intraTax', 'interTax', 'taxRate', 'productType'];
  const changed = fields.some(f => String(draft[f] ?? '') !== String(row[f] ?? ''));
  const save = async () => {
    setBusy(true); setError('');
    try { await onSave({ item: row.item, ...Object.fromEntries(fields.map(f => [f, draft[f]])) }); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const taxInput = (k, label) => (view.taxNames.length ? (
    <select value={draft[k]} onChange={e => set(k, e.target.value)} disabled={readOnly} aria-label={`${label} for ${shown(row.item)}`} className={inputClass}>
      <option value="">Choose a tax</option>
      {view.taxNames.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  ) : <input value={draft[k]} onChange={e => set(k, e.target.value)} disabled={readOnly} placeholder="Tax name exactly as in Zoho Books" aria-label={`${label} for ${shown(row.item)}`} className={inputClass} />);

  return (
    <div className="px-4 py-3 text-[14px]">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <span className="lg:w-64 min-w-0">
          <span className="font-medium text-ink break-words">{shown(row.item)}</span>
          <span className="block text-[13px] text-subtle">In Tally: selling {row.tallyRate || 'none'}, purchase {row.tallyPurchaseRate || 'none'}</span>
        </span>
        <label className="lg:w-36"><span className="block text-[13px] text-muted">Selling rate</span>
          <input value={draft.rate} onChange={e => set('rate', e.target.value)} disabled={readOnly} inputMode="decimal" placeholder={row.tallyRate || 'Not set'} className={`${inputClass} ${!row.sellingRateUsed ? 'border-warning' : ''}`} /></label>
        <label className="lg:w-36"><span className="block text-[13px] text-muted">Purchase rate</span>
          <input value={draft.purchaseRate} onChange={e => set('purchaseRate', e.target.value)} disabled={readOnly} inputMode="decimal" placeholder={row.tallyPurchaseRate || 'Not set'} className={inputClass} /></label>
        <span className="flex flex-col gap-1 text-muted">
          {row.sellingRateUsed ? <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-success-ink" /> Rate {row.sellingRateUsed}{row.rate ? ' (entered here)' : ' (from Tally)'}</span>
            : <span className="inline-flex items-center gap-1.5 font-medium text-warning-ink"><AlertTriangle className="w-4 h-4" /> No selling rate</span>}
          <span>Tax: {row.taxability || 'not chosen'}</span>
          <span>Product type: {row.productTypeUsed || 'empty'}{row.productTypeSource === 'item' ? ' (chosen here)' : row.productTypeSource === 'business' ? ' (business type)' : ' (from Tally)'}</span>
        </span>
        {view.productTypes && (
          <label className="lg:w-44"><span className="block text-[13px] text-muted">Product type</span>
            <select value={draft.productType || ''} onChange={e => set('productType', e.target.value)} disabled={readOnly} aria-label={`Product type for ${shown(row.item)}`} className={inputClass}>
              <option value="">As the business type</option>
              {view.productTypes.map(p => <option key={p} value={p}>{p}</option>)}
            </select></label>
        )}
        {!readOnly && (
          <span className="flex flex-wrap gap-2 lg:ml-auto">
            <button type="button" onClick={() => setOpen(o => !o)} className={btnSecondary} aria-expanded={open}>{open ? 'Hide tax' : 'Tax preference'}</button>
            <button type="button" onClick={save} disabled={!changed || busy} className={btnSecondary}>{busy ? 'Saving…' : 'Save'}</button>
          </span>
        )}
      </div>
      {open && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-xl bg-soft p-3">
          <label><span className="block text-[13px] text-muted">Taxability type</span>
            <select value={draft.taxability} onChange={e => set('taxability', e.target.value)} disabled={readOnly} className={inputClass}>
              <option value="">Not chosen (decide in Zoho)</option>
              {view.taxabilityOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select></label>
          {draft.taxability === 'Taxable' && (
            <>
              <label><span className="block text-[13px] text-muted">Tax within the state (intra-state)</span>{taxInput('intraTax', 'Intra-state tax')}</label>
              <label><span className="block text-[13px] text-muted">Tax between states (inter-state)</span>{taxInput('interTax', 'Inter-state tax')}</label>
              <label><span className="block text-[13px] text-muted">GST rate in % (optional)</span>
                <input value={draft.taxRate} onChange={e => set('taxRate', e.target.value)} disabled={readOnly} inputMode="decimal" placeholder="For example 18" className={inputClass} /></label>
            </>
          )}
          {draft.taxability === 'Non-Taxable' && (
            <label className="sm:col-span-2"><span className="block text-[13px] text-muted">Exemption reason</span>
              <input value={draft.exemptionReason} onChange={e => set('exemptionReason', e.target.value)} disabled={readOnly} className={inputClass} /></label>
          )}
        </div>
      )}
      {error && <div className="mt-2"><Message error={error} /></div>}
    </div>
  );
}

// Business type of the migration: services (Tally's items are only descriptions on sales bills) or goods (trading or
// manufacturing). It sets the Product Type of every item that has no type of its own.
function BusinessType({ view, readOnly, busy, onSave }) {
  const b = view.business;
  const [choice, setChoice] = useState(b.source === 'decided' ? b.value : ''); // reset by the key the card gives it
  const current = b.source === 'decided' ? b.value : '';
  const label = v => (v === 'services' ? 'Services' : 'Goods (trading or manufacturing)');
  return (
    <div className="px-4 py-3 border-b border-line text-[14px] flex flex-col lg:flex-row lg:items-end gap-3">
      <div className="min-w-0 lg:flex-1">
        <h4 className="text-[15px] font-semibold text-ink">Business type: {label(b.value)}{b.source === 'default' ? ' (default)' : ''}</h4>
        <p className="text-[13px] text-muted">
          {b.value === 'services'
            ? `Every item is written with Product Type "service": in a service company the Tally items are only descriptions on sales bills. ${view.counts.services} service, ${view.counts.goods} goods.`
            : `The Product Type comes from Tally's type of supply (goods when not set). ${view.counts.services} service, ${view.counts.goods} goods.`}
          {' '}Default: {label(b.defaultValue).toLowerCase()}. {b.defaultReason} HSN/SAC is written only when Tally has it.
        </p>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2">
          <label><span className="block text-[13px] text-muted">Business type</span>
            <select value={choice} onChange={e => setChoice(e.target.value)} className={inputClass} aria-label="Business type">
              <option value="">Default ({label(b.defaultValue).toLowerCase()})</option>
              <option value="services">Services</option>
              <option value="goods">Goods (trading or manufacturing)</option>
            </select></label>
          <button type="button" className={btnSecondary} disabled={!!busy || choice === current} onClick={() => onSave(choice)}>{busy === 'business' ? 'Saving…' : 'Save'}</button>
        </div>
      )}
    </div>
  );
}

export function ItemRatesCard({ jobId, readOnly, onChanged }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [paste, setPaste] = useState('');
  const [def, setDef] = useState({ rate: '', purchaseRate: '' });
  const [acc, setAcc] = useState({ salesAccount: '', purchaseAccount: '' });
  const [busy, setBusy] = useState('');
  const [onlyMissing, setOnlyMissing] = useStickyState(`item-rates:${jobId}:only-missing`, false);
  const [open, setOpen] = useStickyState(`item-rates:${jobId}:open`, false);

  const load = useCallback(async () => {
    try { const v = await api.get(`/migrations/${jobId}/item-rates`); setView(v); setAcc({ salesAccount: v.accounts.sales, purchaseAccount: v.accounts.purchase }); } catch (e) { setError(e.message); }
  }, [jobId]);
  useEffect(() => { load(); }, [load]);

  const run = async (what, fn, message) => {
    setBusy(what); setError(''); setDone('');
    try { const r = await fn(); setView(r); setDone(typeof message === 'function' ? message(r) : message); onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const saveItem = async body => { const r = await api.put(`/migrations/${jobId}/item-rates`, body); setView(r); setDone(''); onChanged?.(); };

  const accept = <AcceptAsTally jobId={jobId} stepKey="item_rates" readOnly={readOnly} onChanged={onChanged} />;
  if (!view) return <Loading title="Rates" error={error} />;
  if (!view.items.length) return <Card title="Rates" right={accept}><div className="p-4 text-[14px] text-muted">No stock items were uploaded.</div></Card>;
  const options = [...view.accountOptions.zohoOwn, ...view.accountOptions.fromChartOfAccounts];
  const rows = onlyMissing ? view.items.filter(x => !x.sellingRateUsed) : view.items;
  const zero = view.counts.withoutSellingRate;
  const salesAccount = view.accounts.sales || 'Sales';
  const summary = zero === view.counts.items
    ? `${plural(view.counts.items, 'item')} get rate 0 and the ${salesAccount} account.`
    : `${plural(view.counts.items, 'item')}: ${zero ? `${zero} get rate 0, ` : ''}${view.counts.items - zero} keep their rate; ${salesAccount} account.`;

  if (!open) {
    return (
      <Card title="Rates" right={accept}>
        <div className="px-4 py-3 flex flex-wrap items-center gap-3 text-[14px]">
          <span className="text-ink">{summary}</span>
          <button type="button" className="text-info-ink hover:underline font-medium" onClick={() => setOpen(true)}>{readOnly ? 'Show' : 'Change'}</button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Rates" subtitle={summary} right={<span className="flex items-center gap-3">{accept}<button type="button" className="underline text-[13px] text-muted hover:text-ink" onClick={() => setOpen(false)}>Close</button></span>}>
      <div className={`px-4 py-2 border-b border-line text-[13px] ${zero ? 'text-warning-ink' : 'text-muted'}`}>
        {zero
          ? <span className="inline-flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {plural(zero, 'item')} without a selling rate: 0.00 is written.</span>
          : <span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-success-ink" /> Every item has a selling rate.</span>}
        {' '}{view.counts.withoutPurchaseRate} without a purchase rate; {view.counts.withoutTaxPreference} without a tax preference.
      </div>

      {view.business && <BusinessType key={`${view.business.source}-${view.business.value}`} view={view} readOnly={readOnly} busy={busy}
        onSave={businessType => run('business', () => api.put(`/migrations/${jobId}/business-type`, { businessType }), 'Business type saved. Create the files again in the Export Center.')} />}

      {!readOnly && (
        <div className="px-4 py-4 border-b border-line grid grid-cols-1 lg:grid-cols-3 gap-6 bg-soft">
          <div>
            <h4 className="text-[15px] font-semibold text-ink">Sales and purchase account</h4>
            <p className="text-[13px] text-muted mb-2">Written to the Account and Purchase Account columns of every item. Type a name or pick one; left empty, Zoho uses its default accounts.</p>
            <datalist id="item-account-options">{options.map(o => <option key={o} value={o} />)}</datalist>
            <label className="block mb-2"><span className="block text-[13px] text-muted">Sales account</span>
              <input list="item-account-options" value={acc.salesAccount} onChange={e => setAcc(a => ({ ...a, salesAccount: e.target.value }))} placeholder="For example Sales" className={inputClass} /></label>
            <label className="block mb-2"><span className="block text-[13px] text-muted">Purchase account</span>
              <input list="item-account-options" value={acc.purchaseAccount} onChange={e => setAcc(a => ({ ...a, purchaseAccount: e.target.value }))} placeholder="For example Cost of Goods Sold" className={inputClass} /></label>
            <button type="button" className={btnSecondary} disabled={!!busy || (acc.salesAccount === view.accounts.sales && acc.purchaseAccount === view.accounts.purchase)}
              onClick={() => run('acc', () => api.put(`/migrations/${jobId}/item-accounts`, acc), 'Accounts saved.')}>{busy === 'acc' ? 'Saving…' : 'Save accounts'}</button>
          </div>
          <div>
            <h4 className="text-[15px] font-semibold text-ink">One rate for every item without one</h4>
            <p className="text-[13px] text-muted mb-2">Fills only items that have no rate in Tally and none typed here. Each item can be changed afterwards.</p>
            <label className="block mb-2"><span className="block text-[13px] text-muted">Default selling rate</span>
              <input value={def.rate} onChange={e => setDef(d => ({ ...d, rate: e.target.value }))} inputMode="decimal" className={inputClass} /></label>
            <label className="block mb-2"><span className="block text-[13px] text-muted">Default purchase rate</span>
              <input value={def.purchaseRate} onChange={e => setDef(d => ({ ...d, purchaseRate: e.target.value }))} inputMode="decimal" className={inputClass} /></label>
            <button type="button" className={btnSecondary} disabled={!!busy || (!def.rate.trim() && !def.purchaseRate.trim())}
              onClick={() => run('def', () => api.post(`/migrations/${jobId}/item-rates/default`, def), r => `${plural(r.changed, 'item')} filled.`)}>{busy === 'def' ? 'Applying…' : 'Apply to items without a rate'}</button>
          </div>
          <div>
            <h4 className="text-[15px] font-semibold text-ink">Paste many rates</h4>
            <p className="text-[13px] text-muted mb-2">Copy two or three columns from a spreadsheet: item name, selling rate and, if you like, purchase rate.</p>
            <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={5} placeholder={'Item name\t1250.00\t900.00'} aria-label="Pasted rates" className={`${inputClass} font-mono text-[14px]`} />
            <button type="button" className={`${btnSecondary} mt-2`} disabled={!!busy || !paste.trim()}
              onClick={() => run('paste', () => api.post(`/migrations/${jobId}/item-rates/paste`, { text: paste }), r => [
                `${plural(r.read, 'line')} read, ${plural(r.changed, 'item')} changed.`,
                r.notFound.length ? ` Not found: ${r.notFound.map(n => `line ${n.line} "${n.name}"`).join(', ')}.` : '',
                r.unreadable.length ? ` Not read: ${r.unreadable.map(n => `line ${n.line} (${n.reason})`).join(' ')}` : '',
                r.repeated.length ? ` Repeated and not used: ${r.repeated.map(n => `line ${n.line}`).join(', ')}.` : '',
              ].join(''))}>{busy === 'paste' ? 'Reading…' : 'Use pasted rates'}</button>
          </div>
        </div>
      )}
      {readOnly && <div className="px-4 py-3 border-b border-line text-[14px] text-muted">Sales account: {view.accounts.sales || 'Zoho default'}. Purchase account: {view.accounts.purchase || 'Zoho default'}.</div>}
      <div className="px-4 py-2"><Message error={error} done={done} /></div>

      <div className="px-4 py-2 border-b border-line text-[14px]">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} /> Show only items without a selling rate</label>
      </div>
      <div className="divide-y divide-line">
        {rows.map(r => <ItemRow key={r.item} row={r} view={view} readOnly={readOnly} onSave={saveItem} />)}
        {!rows.length && <div className="p-4 text-[14px] text-muted">Every item has a selling rate.</div>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Zoho's own accounts (Mapping Studio): Chart of Accounts ledgers whose names are the names of accounts Zoho creates.
// One choice for all: use Zoho's accounts (the default), or rename mine (a text box per account).
const smallCell = 'w-full h-8 px-2 rounded-md border border-line-strong text-[13px] text-ink bg-white focus:outline-none focus:border-brand disabled:bg-soft';

function ClashNameRow({ c, readOnly, onSave }) {
  const current = c.effective === 'rename' ? c.newName || '' : '';
  const [name, setName] = useState(current || c.suggestedName || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setName(current || c.suggestedName || ''), [current, c.suggestedName]);
  const save = async () => { setBusy(true); setError(''); try { await onSave({ ledger: c.ledger, decision: 'rename', newName: name }); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const changed = name.trim() && name.trim() !== current;
  return (
    <tr className="border-b border-line align-middle text-[13px]">
      <td className="px-3 py-1.5 text-ink break-words">{shown(c.ledger)}{c.why && <span className="block text-[12px] text-muted">{c.why}</span>}</td>
      <td className="px-2 py-1.5 text-muted">{c.openingBalance ? `${c.openingBalance.amount} ${c.openingBalance.side}` : '—'}</td>
      <td className="px-2 py-1.5 min-w-[14rem]">
        {c.effective === 'own' ? (
          <span className="flex flex-wrap items-center gap-2"><span className="text-warning-ink">An account of its own (not certain). Zoho may have "{c.zohoAccount}".</span>
            {!readOnly && <button type="button" className="text-info-ink hover:underline font-medium whitespace-nowrap" disabled={busy} onClick={() => { setBusy(true); setError(''); onSave({ ledger: c.ledger, decision: 'zoho' }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Use Zoho's account</button>}</span>
        ) : c.effective !== 'rename' ? <span className="text-muted">Zoho's "{c.zohoAccount}"</span>
          : readOnly ? <span className="text-ink">{current}</span>
            : (
              <span className="flex items-center gap-2">
                <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && changed) save(); }} aria-label={`New name for ${shown(c.ledger)}`} className={smallCell} />
                {changed && <button type="button" className="text-info-ink hover:underline font-medium whitespace-nowrap" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}
              </span>
            )}
        {error && <div role="alert" className="mt-1 text-danger-ink">{error}</div>}
      </td>
    </tr>
  );
}

export function AccountClashesCard({ jobId, readOnly, onChanged }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => { try { setView(await api.get(`/migrations/${jobId}/account-clashes`)); } catch (e) { setError(e.message); } }, [jobId]);
  useEffect(() => { load(); }, [load]);
  const save = async body => { const r = await api.put(`/migrations/${jobId}/account-clashes`, body); setView(r); onChanged?.(); };
  const all = async decision => {
    setBusy(decision); setError('');
    try { const r = await api.post(`/migrations/${jobId}/account-clashes/bulk`, { decision }); setView(r); onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  if (!view) return <Loading title="Zoho's own accounts" error={error} />;
  // with no decision Zoho's own account is used (the default): shown selected, as the default
  const renamed = view.clashes.filter(c => (c.effective || c.decision || 'zoho') === 'rename').length;
  const decidedByPerson = view.clashes.some(c => c.decision || c.byDefault === false);
  const mode = !view.clashes.length ? '' : renamed === 0 ? 'zoho' : renamed === view.clashes.length ? 'rename' : 'mixed';
  const opt = (id, label) => (
    <OptionCard key={id} inline name={`clashes-${jobId}`} checked={mode === id} isDefault={id === 'zoho'} byPerson={decidedByPerson}
      disabled={readOnly || !!busy} onChange={() => all(id)} label={busy === id ? 'Saving…' : label} />
  );
  return (
    <Card title="Zoho's own accounts" subtitle="These ledgers have the name of an account Zoho creates itself, or are GST ledgers that belong on one of Zoho's own tax accounts (found from the duty head in Tally, not from the name). Opening balances move to the opening balance journal."
      right={<AcceptAsTally jobId={jobId} stepKey="builtin_accounts" readOnly={readOnly} onChanged={onChanged} />}>
      {view.clashes.length > 0 ? (
        <>
          <div className="px-4 py-2 border-b border-line flex flex-wrap items-center gap-2">
            {opt('zoho', "Use Zoho's accounts")}
            {opt('rename', 'Rename mine')}
            {mode === 'mixed' && <span className="text-[13px] text-muted">{renamed} of {view.clashes.length} renamed by you</span>}
            {readOnly && <span className="text-[13px] text-muted">View only.</span>}
          </div>
          {error && <div className="px-4 py-2"><Message error={error} /></div>}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-soft border-b border-line text-[12px] text-muted">
                <tr><th className="px-3 py-1.5 font-semibold">Tally ledger</th><th className="px-2 py-1.5 font-semibold">Opening</th><th className="px-2 py-1.5 font-semibold">Written as</th></tr>
              </thead>
              <tbody>{view.clashes.map(c => <ClashNameRow key={c.ledger} c={c} readOnly={readOnly} onSave={save} />)}</tbody>
            </table>
          </div>
        </>
      ) : <div className="p-4 text-[14px] text-muted">No ledger has the name of one of Zoho's own accounts.</div>}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// HSN/SAC corrections (Mapping Studio). Zoho accepts a code of 4, 6 or 8 digits. Any other value in Tally is written
// empty unless a correction says what to write instead. One correction changes every item and line with that value.
function HsnRow({ v, readOnly, onSave }) {
  const [to, setTo] = useState(v.correction ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setTo(v.correction ?? ''), [v.correction]);
  const save = async value => { setBusy(true); setError(''); try { await onSave([{ from: v.value, to: value }]); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return (
    <div className="px-4 py-3 text-[14px]">
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
        <div className="md:w-72 min-w-0">
          <span className="font-mono text-ink">{v.value}</span>
          <span className="block text-[13px] text-muted">{plural(v.items, 'item')}, {plural(v.lines, 'voucher line')}. {v.accepted ? 'Accepted by Zoho as it is.' : 'Not 4, 6 or 8 digits.'}</span>
        </div>
        <div className="md:flex-1 text-muted">Written: <span className="font-mono text-ink">{v.written || '(empty)'}</span>{v.corrected && v.decidedBy ? `, corrected by ${v.decidedBy}` : ''}</div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="New code" inputMode="numeric" aria-label={`New code for ${v.value}`} className={`${inputClass} w-36 font-mono`} />
            <button type="button" className={btnSecondary} disabled={busy || !to.trim() || to.trim() === (v.correction ?? '')} onClick={() => save(to)}>{busy ? 'Saving…' : 'Save'}</button>
            {v.corrected && <button type="button" className="underline text-[13px] text-muted hover:text-ink" disabled={busy} onClick={() => save(null)}>Remove</button>}
          </div>
        )}
      </div>
      {error && <div className="mt-2"><Message error={error} /></div>}
    </div>
  );
}

// A code for the lines that have none in Tally: per income ledger or item. A suggestion is shown highlighted and written
// only as a suggestion (it is listed in the Assumptions); a code you choose replaces it.
function HsnNoCodeRow({ r, readOnly, minDigits, onSave }) {
  const [code, setCode] = useState(r.chosen || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setCode(r.chosen || ''), [r.chosen]);
  const save = async value => { setBusy(true); setError(''); try { await onSave([{ kind: r.kind, name: r.name, code: value }]); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const suggested = r.source === 'suggested';
  return (
    <div className={`px-4 py-3 text-[14px] ${suggested ? 'bg-warning-soft' : ''}`}>
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
        <div className="md:w-72 min-w-0">
          <span className="text-ink break-words">{r.name}</span>
          <span className="block text-[13px] text-muted">{r.kind === 'item' ? 'Stock item' : 'Ledger'}, {plural(r.lines, 'voucher line')}</span>
        </div>
        <div className="md:flex-1 text-muted">
          {r.source === 'chosen' && <>Written: <span className="font-mono text-ink">{r.written}</span> (your choice)</>}
          {suggested && <><span className="font-medium text-warning-ink">Suggested, please confirm:</span> <span className="font-mono text-ink">{r.suggestion.code}</span> {r.suggestion.label}</>}
          {r.source === 'missing' && <span className="font-medium text-danger-ink">No code. Zoho will refuse these lines while HSN/SAC is on.</span>}
          {r.source === 'off' && 'HSN/SAC is off: the cell is left empty.'}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <input value={code} onChange={e => setCode(e.target.value)} placeholder={`${minDigits} to 8 digits`} inputMode="numeric" aria-label={`HSN/SAC code for ${r.name}`} className={`${inputClass} w-36 font-mono`} />
            <button type="button" className={btnSecondary} disabled={busy || !code.trim() || code.trim() === r.chosen} onClick={() => save(code.trim())}>{busy ? 'Saving…' : 'Use this code'}</button>
            {suggested && <button type="button" className={btnSecondary} disabled={busy} onClick={() => save(r.suggestion.code)}>Confirm {r.suggestion.code}</button>}
            {r.chosen && <button type="button" className="text-info-ink hover:underline" disabled={busy} onClick={() => save(null)}>Remove my choice</button>}
          </div>
        )}
      </div>
      {error && <div role="alert" className="mt-1 text-danger-ink">{error}</div>}
    </div>
  );
}

export function HsnCorrectionsCard({ jobId, readOnly, onChanged }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [onlyOpen, setOnlyOpen] = useStickyState(`hsn:${jobId}:only-open`, false);
  useEffect(() => { api.get(`/migrations/${jobId}/hsn-corrections`).then(setView).catch(e => setError(e.message)); }, [jobId]);
  const save = async corrections => { const r = await api.put(`/migrations/${jobId}/hsn-corrections`, { corrections }); setView(r); onChanged?.(); };
  const saveDefaults = async defaults => { const r = await api.put(`/migrations/${jobId}/hsn-defaults`, { defaults }); setView(r); onChanged?.(); };
  if (!view) return <Loading title="HSN/SAC corrections" error={error} />;
  const rows = onlyOpen ? view.values.filter(v => v.status === 'not_written') : view.values;
  return (
    <Card title="HSN/SAC corrections" subtitle={view.rule}
      right={<AcceptAsTally jobId={jobId} stepKey="hsn" readOnly={readOnly} onChanged={onChanged} />}>
      <div className="px-4 py-3 border-b border-line text-[14px] text-muted">
        {plural(view.counts.values, 'value')} in the data: {view.counts.notWritten} written empty, {view.counts.corrected} corrected. A correction changes every item and voucher line that has the old value.
        {view.values.length > 0 && <label className="mt-1 flex items-center gap-2 text-ink"><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> Show only values written empty</label>}
      </div>
      {view.enabled === false
        ? <div className="px-4 py-3 border-b border-line text-[14px] text-muted">The HSN/SAC field is switched off in Zoho Books (Import Wizard, set-up question), so the HSN/SAC cell is left empty everywhere.</div>
        : view.noCode?.length > 0 && (
          <div className="border-b border-line">
            <div className="px-4 py-3 text-[14px]">
              <div className="font-medium text-ink">Lines with no HSN/SAC in Tally</div>
              <div className="text-muted">The HSN/SAC field is on in Zoho Books, which refuses an invoice line without a code of at least {view.minDigits} digits. Choose the code for each ledger or item once. A highlighted code is only a suggestion from the words of the name: confirm it.</div>
            </div>
            <div className="divide-y divide-line">{view.noCode.map(r => <HsnNoCodeRow key={`${r.kind}|${r.name}`} r={r} readOnly={readOnly} minDigits={view.minDigits} onSave={saveDefaults} />)}</div>
          </div>
        )}
      <div className="divide-y divide-line">
        {rows.map(v => <HsnRow key={v.value} v={v} readOnly={readOnly} onSave={save} />)}
        {!rows.length && <div className="p-4 text-[14px] text-muted">{view.values.length ? 'No value is written empty.' : 'The data has no HSN/SAC value.'}</div>}
      </div>
    </Card>
  );
}
