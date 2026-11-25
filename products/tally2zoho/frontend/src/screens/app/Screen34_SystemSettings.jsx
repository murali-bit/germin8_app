import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { Card, Field, Note, PageHeader, StatusChip, Table, btnPrimary, btnSecondary, btnSmall, friendlyError, inputClass } from '../../components/ui';

const ROLES = [
  ['super_admin', 'Super Admin', 'Sees every firm. Manages all users.'],
  ['admin', 'Admin', "Manages this firm's users and all its migrations."],
  ['analyst', 'Migration Analyst', 'Uploads, maps, generates and tracks migrations. Cannot manage users.'],
  ['viewer', 'Client Viewer', 'Can only view. Sees only their own company when one is set.'],
];
const roleName = r => ROLES.find(x => x[0] === r)?.[1] || r;
const EMPTY = { name: '', email: '', password: '', role: 'analyst', company: '' };

export default function Screen34_SystemSettings({ user }) {
  const isAdmin = ['super_admin', 'admin'].includes(user.role);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(() => { if (isAdmin) api.get('/users').then(setUsers).catch(e => setError(e.message)); }, [isAdmin]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, done) => { setError(''); setMessage(''); try { await fn(); if (done) setMessage(done); load(); } catch (e) { setError(e.message); } };
  const add = e => { e.preventDefault(); act(async () => { await api.post('/users', form); setForm(EMPTY); }, 'User added.'); };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Users and Roles"
        help={<>You are signed in as <span className="text-ink font-medium">{user.name}</span> ({roleName(user.role)}) at {user.firm}.</>}
      />
      {error && <div role="alert"><Note tone="danger">{friendlyError(error)}</Note></div>}
      {message && <div role="status"><Note tone="success">{message}</Note></div>}

      <Card title="What each role can do">
        <dl className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-[14px]">
          {ROLES.map(([k, n, d]) => <div key={k}><dt className="font-medium text-ink">{n}</dt><dd className="text-muted">{d}</dd></div>)}
        </dl>
        <div className="px-4 py-3 border-t border-line text-[14px] text-muted">Each firm sees only its own migrations. Multi-year migration is switched off in this release.</div>
      </Card>

      {!isAdmin && <Card title="Team"><div className="p-4 text-[14px] text-muted">Only an admin can see and manage users. Ask your admin if you need a change to your access.</div></Card>}

      {isAdmin && (
        <>
          <Card title="Team members">
            <Table
              rows={users}
              rowKey={u => u.id}
              columns={[
                { key: 'name', label: 'Name', render: u => <span className="font-medium">{u.name}{u.id === user.id ? ' (you)' : ''}</span> },
                { key: 'email', label: 'Email' },
                { key: 'role', label: 'Role', render: u => (u.id === user.id || (u.role === 'super_admin' && user.role !== 'super_admin') ? roleName(u.role) : (
                  <select value={u.role} onChange={e => act(() => api.put(`/users/${u.id}`, { role: e.target.value }), 'Role changed.')} aria-label={`Role for ${u.name}`} className={`${inputClass} w-48`}>
                    {ROLES.filter(([k]) => k !== 'super_admin' || user.role === 'super_admin').map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                  </select>
                )) },
                { key: 'company', label: 'Company (viewers)', render: u => u.company || '' },
                { key: 'active', label: 'Access', render: u => <StatusChip tone={u.active ? 'success' : 'neutral'} dot>{u.active ? 'Active' : 'Disabled'}</StatusChip> },
                { key: 'act', label: '', render: u => (u.id === user.id || (u.role === 'super_admin' && user.role !== 'super_admin') ? '' : (
                  <button className={`${btnSecondary} ${btnSmall}`} onClick={() => act(() => api.put(`/users/${u.id}`, { active: !u.active }), u.active ? 'User disabled.' : 'User enabled.')}>{u.active ? 'Disable' : 'Enable'}</button>
                )) },
              ]}
            />
          </Card>

          <Card title="Add a user">
            <form onSubmit={add} className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-[14px]">
              <Field label="Name" required>{id => <input id={id} required value={form.name} onChange={e => set('name', e.target.value)} className={inputClass} />}</Field>
              <Field label="Email" required>{id => <input id={id} required type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputClass} />}</Field>
              <Field label="Temporary password" required hint="Use 10 or more characters.">{id => <input id={id} required type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={e => set('password', e.target.value)} className={inputClass} />}</Field>
              <Field label="Role">{id => (
                <select id={id} value={form.role} onChange={e => set('role', e.target.value)} className={inputClass}>
                  {ROLES.filter(([k]) => k !== 'super_admin' || user.role === 'super_admin').map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                </select>
              )}</Field>
              {form.role === 'viewer' && <Field label="Company they may view" hint="Type the company name exactly as it is in the migration.">{id => <input id={id} value={form.company} onChange={e => set('company', e.target.value)} placeholder="Exact company name" className={inputClass} />}</Field>}
              <div className="md:col-span-2 lg:col-span-3"><button type="submit" className={btnPrimary}>Add user</button></div>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
