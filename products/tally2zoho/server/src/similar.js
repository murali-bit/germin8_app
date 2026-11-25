// Finds names that look like a wanted name. Used to suggest the Tally field a file may be using instead of the one
// the platform reads, and the closest entries of the user's Zoho tax list. It only SUGGESTS: nothing is ever
// matched or replaced on the strength of a similarity.

const words = s => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const squash = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const pairs = s => { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; };

// 0 (nothing in common) to 1 (the same apart from capital letters, spaces and punctuation).
export function similarity(a, b) {
  const x = squash(a), y = squash(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  let score = 0;
  // one name inside the other, for example "gstin" in "partygstin"
  if (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))) score = Math.max(score, 0.6 + 0.3 * (Math.min(x.length, y.length) / Math.max(x.length, y.length)));
  // shared whole words
  const wa = new Set(words(a)), wb = new Set(words(b));
  const sharedWords = [...wa].filter(w => wb.has(w)).length;
  if (sharedWords) score = Math.max(score, 0.5 + 0.4 * (sharedWords / Math.max(wa.size, wb.size)));
  // shared letter pairs
  const pa = pairs(x), pb = pairs(y);
  if (pa.length && pb.length) {
    const left = new Map();
    for (const p of pb) left.set(p, (left.get(p) || 0) + 1);
    let shared = 0;
    for (const p of pa) if (left.get(p)) { shared++; left.set(p, left.get(p) - 1); }
    score = Math.max(score, (2 * shared) / (pa.length + pb.length));
  }
  return score;
}

// The candidates most like the wanted name, best first. minScore drops weak likenesses; pass 0 to always get the closest ones.
export function mostSimilar(wanted, candidates, { limit = 5, minScore = 0.45 } = {}) {
  return [...new Set(candidates)]
    .map(name => ({ name, score: similarity(wanted, name) }))
    .filter(c => c.score >= minScore && c.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(c => c.name);
}
