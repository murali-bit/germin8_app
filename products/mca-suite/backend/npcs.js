// National Product Classification for Services (NPCS 2010) — search and service-type suggestions.
// Data: backend/data/npcs-services.json = {source, count, codes:[{code, level, category, desc, categoryDesc, page}]}
// (4-digit categories and 8-digit products). Loaded once, lazily.
//   search(q)     — manual lookup by code prefix ("9983", "998311") or by words ("human resources consulting").
//   suggest(text) — keyword scoring of a business description against product descriptions.
import fs from 'node:fs';

const DATA_URL = new URL('./data/npcs-services.json', import.meta.url);

let INDEX = null;

// Light stemming so "services"/"service", "trading"/"trade", "leasing"/"lease", "consultants"/"consultant" meet.
export function stem(word) {
  let w = String(word || '').toLowerCase();
  if (w.length <= 3 || /^\d+$/.test(w)) return w;
  const strip = (suffix, min = 3) => {
    if (w.endsWith(suffix) && w.length - suffix.length >= min) { w = w.slice(0, -suffix.length); return true; }
    return false;
  };
  if (/(ss|x|ch|sh)es$/.test(w)) strip('es');
  else strip('ions') || strip('ion') || strip('ing') || strip('ed') || (!w.endsWith('ss') && strip('s'));
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

const tokenize = s => String(s || '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean);

// Words that say nothing about the kind of service. ("technology" alone is too vague; "IT" is expanded to
// "information technology" first, and "information" carries it.)
const STOP = new Set([
  'services', 'service', 'company', 'companies', 'private', 'limited', 'ltd', 'pvt', 'other', 'others', 'and', 'of', 'the', 'for',
  'a', 'an', 'in', 'on', 'to', 'by', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'its', 'it', 'we', 'our', 'their', 'which',
  'that', 'this', 'these', 'those', 'from', 'as', 'at', 'or', 'such', 'including', 'include', 'includes', 'etc', 'nec', 'n',
  'e', 'c', 'into', 'all', 'any', 'also', 'has', 'have', 'had', 'not', 'related', 'relating', 'provide', 'provides', 'provided',
  'providing', 'provider', 'engaged', 'engage', 'business', 'businesses', 'activity', 'activities', 'principal', 'main',
  'primarily', 'mainly', 'india', 'indian', 'during', 'year', 'financial', 'operations', 'operation', 'carry', 'carrying',
  'carries', 'like', 'various', 'kind', 'kinds', 'type', 'types', 'products', 'product', 'customer', 'customers',
  'client', 'clients', 'objects', 'object', 'incorporated', 'registered', 'office', 'llp', 'inc', 'corporation', 'technologies',
  'technology', 'chartered', 'students', 'student', 'platform', 'solutions', 'solution', 'enterprises', 'ventures', 'group',
  'industries', 'via', 'through', 'per', 'under', 'multi', 'speciality', 'specialty', 'agency', 'firm', 'end', 'domestic',
]);
const STOP_STEMS = new Set([...STOP].map(stem));

// Business words → the words NPCS uses. Applied to lower-case tokens (IT / HR handled on the raw text first).
const SYNONYMS = {
  consultancy: ['consulting'], consultant: ['consulting'], consultants: ['consulting'], advisory: ['consulting'],
  software: ['software', 'computer', 'programming'], saas: ['software', 'application'],
  trading: ['wholesale', 'retail', 'trade'], trader: ['wholesale', 'trade'], traders: ['wholesale', 'trade'],
  rent: ['rental', 'leasing'], renting: ['rental', 'leasing'],
  pharma: ['pharmaceutical'], hospital: ['inpatient', 'health', 'medical'], hospitals: ['inpatient', 'health', 'medical'],
  clinic: ['medical', 'health'], clinics: ['medical', 'health'], healthcare: ['health'],
  accountant: ['accounting'], accountants: ['accounting'], accountancy: ['accounting'],
  tutoring: ['education', 'tutoring'], tutor: ['education'], coaching: ['education', 'coaching'],
  restaurant: ['food', 'restaurant'], restaurants: ['food', 'restaurant'], cafe: ['food', 'beverage'],
  hotel: ['accommodation', 'hotel'], hotels: ['accommodation', 'hotel'],
  edtech: ['education', 'online'], tuition: ['education', 'coaching'], training: ['training', 'education'],
  logistics: ['logistic', 'freight', 'transport'], ecommerce: ['online', 'retail'],
  ca: ['accounting', 'auditing'], audit: ['auditing'], bookkeeping: ['bookkeeping', 'accounting'],
  staffing: ['human', 'resources', 'placement'], recruitment: ['recruitment', 'placement', 'personnel'],
  manpower: ['manpower', 'personnel', 'placement'],
  realty: ['real', 'estate'], builder: ['construction'], builders: ['construction'], contractor: ['construction'],
  app: ['application', 'software'], apps: ['application', 'software'], website: ['web', 'website'],
};

// Families that describe a different trade than their wording suggests ("Construction services of hospitals",
// "Public administrative services related to … restaurants"): only suggested when the text asks for them.
const NEEDS_CONTEXT = [
  { cats: ['9953', '9954'], words: /^(construct|build|civil|contract|infrastructur|erect)/ },
  { cats: ['9991'], words: /^(public|government|administrat|regulat)/ },
  { desc: /^forex/i, words: /^(forex|foreign|exchang|currenc)/ },
];
const needsContext = (n, p) => (n.cats ? n.cats.includes(p.category) : n.desc.test(p.desc));

function load() {
  if (INDEX) return INDEX;
  const raw = JSON.parse(fs.readFileSync(DATA_URL, 'utf8'));
  const codes = (raw.codes || []).map(c => ({
    ...c, descTokens: tokenize(c.desc).map(stem), catTokens: tokenize(c.categoryDesc).map(stem),
  }));
  const products = codes.filter(c => c.level === 'product');
  // Document frequency over product descriptions, for inverse-frequency weights.
  const df = new Map();
  for (const p of products) for (const t of new Set(p.descTokens)) df.set(t, (df.get(t) || 0) + 1);
  const categories = new Map(codes.filter(c => c.level === 'category').map(c => [c.code, c]));
  INDEX = { source: raw.source, codes, products, df, categories, N: products.length };
  return INDEX;
}

const pub = c => ({ code: c.code, level: c.level, category: c.category, desc: c.desc, categoryDesc: c.categoryDesc });

// Query stem q hits a description token when equal, or as a word start (q of 4+ letters, so tax ≠ taxi).
function hitIn(tokens, q) {
  for (const t of tokens) if (t === q || (q.length >= 4 && t.startsWith(q))) return t;
  return null;
}

/**
 * Manual search. Digits = code prefix; words = every word must appear in the description or its category.
 * Ranked: exact code, then word hits at the start of the description, more hits, shorter descriptions.
 * Returns [{code, level, category, desc, categoryDesc}].
 */
export function search(q, { limit = 20 } = {}) {
  const { codes } = load();
  const text = String(q || '').trim();
  const max = Math.max(1, Math.min(200, Number(limit) || 20));
  if (!text) return [];
  const words = tokenize(text);
  const digits = words.filter(w => /^\d+$/.test(w));
  const terms = words.filter(w => !/^\d+$/.test(w)).map(stem);
  const useful = terms.filter(t => !STOP_STEMS.has(t));
  const qs = [...new Set(useful.length ? useful : terms)];

  const scored = [];
  for (const c of codes) {
    if (digits.length && !digits.every(d => c.code.startsWith(d))) continue;
    let score = 0;
    if (digits.some(d => c.code === d)) score += 1000;
    if (digits.length) score += 100 - c.code.length; // shorter codes (categories) first
    let ok = true, hits = 0;
    for (const t of qs) {
      const d = hitIn(c.descTokens, t);
      if (d) {
        hits++;
        score += 10 + (d === t ? 3 : 0) + (c.descTokens[0] === d ? 5 : 0);
        continue;
      }
      if (hitIn(c.catTokens, t)) { score += 2; continue; }
      ok = false; break;
    }
    if (!ok) continue;
    if (qs.length && c.level === 'category' && hits === qs.length) score += 4;
    scored.push({ c, score, len: c.desc.length });
  }
  scored.sort((a, b) => b.score - a.score || a.len - b.len || a.c.code.localeCompare(b.c.code));
  return scored.slice(0, max).map(s => pub(s.c));
}

// Business text → query words: [{word (as written), stems:[{stem, weight}]}]. The word itself weighs 1,
// a synonym 0.7, so "software" still prefers descriptions that say software over ones that say computer.
export function queryWords(text) {
  // Upper-case IT only: lower-case "it" is an ordinary word.
  const s = String(text || '')
    .replace(/\bI\.?T\.?(?![A-Za-z])/g, ' information technology ')
    .replace(/\bITES\b/g, ' information technology enabled ')
    .replace(/\bH\.?R\.?(?![A-Za-z])/gi, ' human resources ')
    .replace(/\bBPO\b/gi, ' business process outsourcing bpo ')
    .replace(/\bon-line\b/gi, ' online ');
  const out = new Map();
  for (const w of tokenize(s)) {
    if (/^\d+$/.test(w) || w.length < 2) continue;
    const expanded = SYNONYMS[w] ? SYNONYMS[w].map(e => [e, e === w ? 1 : 0.7]) : [[w, 1]];
    if (SYNONYMS[w] && !STOP.has(w) && !SYNONYMS[w].includes(w)) expanded.unshift([w, 1]);
    for (const [e, weight] of expanded) {
      const st = stem(e);
      if (STOP.has(e) || STOP_STEMS.has(st) || st.length < 2) continue;
      if (!out.has(w)) out.set(w, new Map());
      const m = out.get(w);
      m.set(st, Math.max(m.get(st) || 0, weight));
    }
  }
  return [...out].map(([word, m]) => ({ word, stems: [...m].map(([st, weight]) => ({ stem: st, weight })) }));
}

/**
 * Suggests NPCS product codes for a business description.
 * Returns { suggestions:[{code, desc, category, categoryDesc, score, matched:[words]}], categories:[{code, desc, score}] }.
 * score is relative to the best suggestion (1 = best).
 */
export function suggestDetailed(text, { limit = 8 } = {}) {
  const { products, df, N, categories } = load();
  const max = Math.max(1, Math.min(50, Number(limit) || 8));
  const words = queryWords(text);
  if (!words.length) return { suggestions: [], categories: [] };

  const idfCache = new Map();
  const idf = t => {
    if (idfCache.has(t)) return idfCache.get(t);
    let n = df.get(t) || 0;
    if (t.length >= 4) { n = 0; for (const [k, v] of df) if (k.startsWith(t)) n += v; }
    const w = Math.log(1 + N / (1 + n));
    idfCache.set(t, w);
    return w;
  };
  // The same word written twice counts once.
  const seen = new Set();
  const qwords = words.filter(w => {
    const key = w.stems.map(x => x.stem).sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const allStems = [...new Set(qwords.flatMap(w => w.stems.map(x => x.stem)))];
  const asked = NEEDS_CONTEXT.filter(n => allStems.some(st => n.words.test(st)));

  const scored = [];
  for (const p of products) {
    let score = 0, hits = 0, catHits = 0;
    const matched = [];
    const used = new Set(); // one description word is credited once, even if two query words reach it
    for (const { word, stems } of qwords) {
      let best = 0, bestTok = null, inDesc = false;
      for (const { stem: st, weight } of stems) {
        const t = hitIn(p.descTokens, st);
        if (t && !used.has(t)) {
          const v = idf(st) * weight;
          if (!inDesc || v > best) { best = v; bestTok = t; inDesc = true; }
        } else if (!inDesc && hitIn(p.catTokens, st)) best = Math.max(best, idf(st) * weight * 0.25);
      }
      if (!best) continue;
      if (bestTok) used.add(bestTok);
      score += best;
      matched.push(word);
      if (inDesc) hits++; else catHits++;
    }
    if (!hits) continue;
    // Several words hitting the same code is much stronger than one word.
    score *= 1 + 0.6 * (hits - 1);
    // A query word naming the family but not in the description ("food" for a restaurant, "health" for a
    // hospital) is an independent confirmation.
    if (allStems.some(st => hitIn(p.catTokens, st) && !hitIn(p.descTokens, st))) score *= 1.3;
    // Prefer focused descriptions over long catch-all ones.
    score /= 1 + 0.015 * p.descTokens.length;
    if (/\bn\.?e\.?c\b|^other /i.test(p.desc)) score *= 0.9;
    if (NEEDS_CONTEXT.some(n => needsContext(n, p) && !asked.includes(n))) score *= 0.5;
    scored.push({ p, score, matched });
  }
  scored.sort((a, b) => b.score - a.score || a.p.desc.length - b.p.desc.length);
  const top = scored.slice(0, max);
  const best = top.length ? top[0].score : 1;

  // Categories: the strongest products vote (squared, so one clear match beats many weak ones).
  const catScore = new Map();
  for (const s of scored.slice(0, 10)) catScore.set(s.p.category, (catScore.get(s.p.category) || 0) + (s.score / best) ** 2);
  const cats = [...catScore].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([code, sc]) => ({
    code, desc: categories.get(code)?.desc || '', score: Math.round(sc * 100) / 100,
  }));

  return {
    suggestions: top.map(s => ({
      code: s.p.code, desc: s.p.desc, category: s.p.category, categoryDesc: s.p.categoryDesc,
      score: Math.round((s.score / best) * 100) / 100, matched: s.matched,
    })),
    categories: cats,
  };
}

export function suggest(text, opts = {}) {
  return suggestDetailed(text, opts).suggestions;
}

// The category the suggestions point to, or null.
export function suggestCategory(text, opts = {}) {
  const { suggestions, categories } = suggestDetailed(text, opts);
  if (!suggestions.length) return null;
  const c = categories[0] || { code: suggestions[0].category, desc: suggestions[0].categoryDesc };
  return { code: c.code, desc: c.desc };
}

// Every code (categories and products), public shape.
export function allCodes() { return load().codes.map(pub); }

export function getCode(code) {
  const c = load().codes.find(x => x.code === String(code || '').trim());
  return c ? pub(c) : null;
}

export function info() {
  const { source, codes, products } = load();
  return { source, total: codes.length, products: products.length, categories: codes.length - products.length };
}
