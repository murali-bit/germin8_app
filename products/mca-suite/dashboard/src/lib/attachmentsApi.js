// Dashboard attachments (AOC-4 page 2: (a) one PDF, (g) optional PDFs). Stored by the backend per company (CIN);
// the extension's autopilot downloads them for page 2 when its side panel has no file chosen.
import { API_ORIGIN } from './api.js';

const BASE = `${API_ORIGIN}/api/attachments`;

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

// File → base64 (no data: prefix), read off the main thread by the browser.
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || '').replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error || new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

export async function listAttachments(cin, formType = 'aoc4') {
  const q = new URLSearchParams({ cin: String(cin || '').toUpperCase(), formType });
  const data = await json(await fetch(`${BASE}?${q}`));
  return data.attachments || [];
}

// → { attachment, replaced, warning, duplicate }
export async function uploadAttachment({ cin, jobId, formType = 'aoc4', slot, file }) {
  const base64 = await fileToBase64(file);
  return json(await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cin, jobId: jobId || undefined, formType, slot, fileName: file.name, mime: file.type || 'application/pdf', base64 }),
  }));
}

export async function deleteAttachment(id) {
  return json(await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

export const attachmentContentUrl = id => `${BASE}/${encodeURIComponent(id)}/content`;

export const MAX_MB = 10;
export const MCA_LIMIT_MB = { a: 6, g: 2 };
export const fmtMb = n => `${((n || 0) / 1048576).toFixed(1)} MB`;
