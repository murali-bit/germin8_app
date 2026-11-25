// Dates typed on New Migration. Plain JavaScript, tested with node (frontend/test/dates.test.js).
// Dates are kept as "yyyy-mm-dd" strings and shown as "dd/mm/yyyy"; no time zone is involved.

const pad = n => String(n).padStart(2, '0');

// "2024-25" or "2024–25" -> 2024
export const fyStartYear = fy => { const m = /^(\d{4})/.exec(String(fy || '')); return m ? Number(m[1]) : null; };
// 2024 -> "2024–25"
export const fyLabel = y => `${y}–${pad((y + 1) % 100)}`;
// "2024-25" -> { from: '2024-04-01', to: '2025-03-31' }
export const fyBounds = fy => { const y = fyStartYear(fy); return y == null ? null : { from: `${y}-04-01`, to: `${y + 1}-03-31` }; };
// The financial year (April to March) a date falls in, as its first year.
export const fyOfDate = iso => { const [y, m] = String(iso).split('-').map(Number); return m >= 4 ? y : y - 1; };

// "2024-04-01" -> "01/04/2024"
export const showDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

const real = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

// Reads a typed date. Accepted: dd/mm/yyyy (also with - or . and one-digit day or month), yyyy-mm-dd, and dd/mm with
// no year (the year is taken from the financial year: April to December in its first year, January to March in the
// second). Returns { date: 'yyyy-mm-dd' } or { error } in plain words. A date outside the financial year is an error too.
export function readTypedDate(text, fy) {
  const s = String(text || '').trim();
  const bounds = fyBounds(fy);
  const y0 = fyStartYear(fy);
  const example = bounds ? showDate(bounds.from) : '01/04/2024';
  if (!s) return { error: `Enter the start date, for example ${example}.` };
  let y; let m; let d;
  let r;
  if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) { d = +r[1]; m = +r[2]; y = +r[3]; }
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})$/.exec(s)) && y0 != null) { d = +r[1]; m = +r[2]; y = m >= 4 ? y0 : y0 + 1; }
  else return { error: `"${s}" is not a full date. Type it as day/month/year, for example ${example}, or pick it from the calendar.` };
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31) || !real(y, m, d)) return { error: `"${s}" is not a date in the calendar. Type it as day/month/year, for example ${example}.` };
  const date = `${y}-${pad(m)}-${pad(d)}`;
  if (bounds && (date < bounds.from || date > bounds.to)) {
    return { error: `${showDate(date)} is outside financial year ${fyLabel(y0)} (${showDate(bounds.from)} to ${showDate(bounds.to)}). Choose a date inside the year, or change the financial year.` };
  }
  return { date };
}
