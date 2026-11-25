import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ATTACHMENTS_DDL } from './routes/attachments.js';
import { AUDIT_FIRMS_DDL } from './routes/scan-enrich.js';
import { REPORT_TEXTS_DDL } from './report-verbatim.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'germin8.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for concurrency and performance
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    email TEXT,
    role TEXT DEFAULT 'staff',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS otps (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    verified INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    cin TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    address TEXT,
    pan TEXT,
    fy TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS adt1_drafts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    cin TEXT NOT NULL,
    form_data TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    payment_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    draft_id TEXT NOT NULL,
    form_type TEXT DEFAULT 'ADT-1',
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'INR',
    status TEXT DEFAULT 'pending',
    order_id TEXT UNIQUE NOT NULL,
    payment_id TEXT,
    signature TEXT,
    method TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (draft_id) REFERENCES adt1_drafts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS extension_jobs (
    id TEXT PRIMARY KEY,
    form_type TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_name TEXT,
    payload TEXT NOT NULL,
    status TEXT DEFAULT 'ready',
    phase INTEGER DEFAULT 0,
    result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- AI Scanner results: the extraction as returned (result) and the reviewed values (data).
  CREATE TABLE IF NOT EXISTS saved_scans (
    id TEXT PRIMARY KEY,
    form_type TEXT NOT NULL,
    file_name TEXT,
    company_name TEXT,
    cin TEXT,
    model TEXT,
    schema TEXT,
    field_count INTEGER DEFAULT 0,
    seconds INTEGER,
    result TEXT NOT NULL,
    data TEXT NOT NULL,
    status TEXT DEFAULT 'scanned',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Company master: facts the user confirmed during a fill (AGM date, books in electronic form,
  -- product codes, e-mail …) that the scanned documents did not contain. One row per company,
  -- form and field; the extension reads them back as approved data on the next run.
  CREATE TABLE IF NOT EXISTS company_answers (
    cin TEXT NOT NULL,
    form_type TEXT NOT NULL,
    field_key TEXT NOT NULL,
    label TEXT,
    value TEXT,
    source TEXT DEFAULT 'extension',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cin, form_type, field_key)
  );
`);

// Dashboard attachments (AOC-4 page 2 (a)/(g) PDFs): metadata here, the files under data/attachments/<CIN>/.
db.exec(ATTACHMENTS_DDL);

// Audit firms (FRN -> firm PAN) remembered for the AOC-4 scanner's enrich step.
db.exec(AUDIT_FIRMS_DDL);

// Verbatim transcriptions of scanned reports (report-verbatim.js), by file sha256: a report is never paid for twice.
db.exec(REPORT_TEXTS_DDL);

export default db;

