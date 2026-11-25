// Login, sessions, roles and firm separation.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ROLES = ['super_admin', 'admin', 'analyst', 'viewer'];
const SESSION_HOURS = 12;

const hash = (password, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
const verify = (password, stored) => {
  const [salt, h] = String(stored).split(':');
  const a = Buffer.from(h || '', 'hex');
  const b = scryptSync(password, salt || '', 32);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function setupAuth(app, { db, ROOT, now, audit }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS firms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL, role TEXT NOT NULL, company TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL);
  `);

  // First start: create the firm and test users from seed-users.json (test accounts only).
  if (!db.prepare('SELECT COUNT(*) n FROM users').get().n) {
    const seedFile = [path.join(ROOT, 'seed-users.json'), path.join(ROOT, 'seed-users.example.json')].find(f => fs.existsSync(f));
    const seed = seedFile ? JSON.parse(fs.readFileSync(seedFile, 'utf8')) : { firm: 'Demo Firm', users: [] };
    const firmId = db.prepare('INSERT INTO firms (name) VALUES (?)').run(seed.firm).lastInsertRowid;
    for (const u of seed.users) {
      db.prepare('INSERT INTO users (firm_id, name, email, password, role, company, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(firmId, u.name, u.email.toLowerCase(), hash(u.password), u.role, u.company || null, now());
    }
  }

  const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, firmId: u.firm_id, company: u.company, active: !!u.active });
  const cookieToken = req => (String(req.headers.cookie || '').match(/(?:^|;\s*)sid=([a-f0-9]{64})/) || [])[1];
  const sessionUser = req => {
    const token = cookieToken(req);
    if (!token) return null;
    const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!s || s.expires_at < now()) return null;
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(s.user_id);
    return u || null;
  };

  // Every /api route needs a signed-in user, except health and login. Viewers can only read.
  app.addHook('preHandler', (req, reply, done) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api') || url === '/api/health' || url === '/api/auth/login') return done();
    const user = sessionUser(req);
    if (!user) { reply.code(401).send({ error: 'Please sign in.' }); return; }
    req.user = user;
    if (user.role === 'viewer' && req.method !== 'GET' && url !== '/api/auth/logout') {
      reply.code(403).send({ error: 'Your role can view but not change this.' }); return;
    }
    done();
  });

  app.post('/api/auth/login', (req, reply) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const u = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
    if (!u || !verify(String(req.body?.password || ''), u.password)) {
      audit(null, 'login_failed', email, 'anonymous');
      return reply.code(401).send({ error: 'Email or password is not correct.' });
    }
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, u.id, expires);
    audit(null, 'login', u.email, u.email);
    reply.header('set-cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
    return publicUser(u);
  });

  app.post('/api/auth/logout', (req, reply) => {
    const token = cookieToken(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    reply.header('set-cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return { ok: true };
  });

  app.get('/api/auth/me', req => ({ ...publicUser(req.user), firm: db.prepare('SELECT name FROM firms WHERE id = ?').get(req.user.firm_id)?.name }));

  // ----- user management (admins only) -----
  const adminOnly = (req, reply) => {
    if (['super_admin', 'admin'].includes(req.user.role)) return true;
    reply.code(403).send({ error: 'Only an admin can manage users.' });
    return false;
  };
  const visibleUsers = user => (user.role === 'super_admin'
    ? db.prepare('SELECT * FROM users ORDER BY id').all()
    : db.prepare('SELECT * FROM users WHERE firm_id = ? ORDER BY id').all(user.firm_id));

  app.get('/api/users', (req, reply) => { if (!adminOnly(req, reply)) return; return visibleUsers(req.user).map(publicUser); });

  app.post('/api/users', (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!b.name || !/^\S+@\S+\.\S+$/.test(email)) return reply.code(400).send({ error: 'Name and a valid email are required.' });
    if (String(b.password || '').length < 10) return reply.code(400).send({ error: 'Password must be at least 10 characters.' });
    if (!ROLES.includes(b.role)) return reply.code(400).send({ error: 'Choose a role.' });
    if (b.role === 'super_admin' && req.user.role !== 'super_admin') return reply.code(403).send({ error: 'Only a Super Admin can create another Super Admin.' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return reply.code(409).send({ error: 'A user with this email already exists.' });
    db.prepare('INSERT INTO users (firm_id, name, email, password, role, company, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.firm_id, String(b.name).trim(), email, hash(b.password), b.role, b.company || null, now());
    audit(null, 'user_created', `${email} as ${b.role}`);
    return reply.code(201).send({ ok: true });
  });

  app.put('/api/users/:uid', (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const target = visibleUsers(req.user).find(u => u.id === Number(req.params.uid));
    if (!target) return reply.code(404).send({ error: 'User not found.' });
    if (target.id === req.user.id) return reply.code(400).send({ error: 'You cannot change your own role or access.' });
    if (target.role === 'super_admin' && req.user.role !== 'super_admin') return reply.code(403).send({ error: 'Only a Super Admin can change a Super Admin.' });
    const b = req.body || {};
    if (b.role !== undefined) {
      if (!ROLES.includes(b.role) || (b.role === 'super_admin' && req.user.role !== 'super_admin')) return reply.code(400).send({ error: 'That role is not allowed.' });
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, target.id);
      audit(null, 'user_role_changed', `${target.email}: ${target.role} -> ${b.role}`);
    }
    if (b.active !== undefined) {
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, target.id);
      if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      audit(null, b.active ? 'user_enabled' : 'user_disabled', target.email);
    }
    return { ok: true };
  });

  // Can this user see this migration? Firms are separated; viewers see only their own company.
  return function canSee(user, job) {
    if (user.role === 'super_admin') return true;
    if (job.firm_id !== user.firm_id) return false;
    if (user.role === 'viewer' && user.company) return job.company.trim().toLowerCase() === user.company.trim().toLowerCase();
    return true;
  };
}
