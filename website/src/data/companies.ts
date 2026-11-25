/**
 * Company database: SAMPLE RECORDS ONLY.
 *
 * These companies, CINs, DINs and people are invented for the design preview.
 * To go live, replace `COMPANIES` (or the functions at the bottom of this file)
 * with calls to your real company data source. The pages only use the
 * functions exported here, so nothing else needs to change.
 */

export interface Director {
  name: string;
  din: string;
  designation: string;
  appointed: string; // ISO date
  kyc: 'Filed' | 'Due';
}

export interface Company {
  slug: string;
  name: string;
  cin: string;
  status: 'Active' | 'Strike off' | 'Under liquidation';
  category: string;
  companyClass: 'Private' | 'Public' | 'One Person Company';
  industry: string;
  incorporated: string; // ISO date
  roc: string;
  state: string;
  city: string;
  authorisedCapital: number;
  paidUpCapital: number;
  lastAgm: string; // ISO date
  lastBalanceSheet: string; // ISO date
  directors: Director[];
}

export const COMPANIES: Company[] = [
  {
    slug: 'lumenpath-lending-technologies',
    name: 'Lumenpath Lending Technologies Private Limited',
    cin: 'U65999KA2019PTC000101',
    status: 'Active',
    category: 'Company limited by shares',
    companyClass: 'Private',
    industry: 'Fintech and lending',
    incorporated: '2019-03-14',
    roc: 'RoC Bengaluru',
    state: 'Karnataka',
    city: 'Bengaluru',
    authorisedCapital: 50000000,
    paidUpCapital: 32500000,
    lastAgm: '2026-09-26',
    lastBalanceSheet: '2026-03-31',
    directors: [
      { name: 'Aarav Menon', din: '00000101', designation: 'Managing Director', appointed: '2019-03-14', kyc: 'Filed' },
      { name: 'Ishita Varma', din: '00000102', designation: 'Director', appointed: '2019-03-14', kyc: 'Filed' },
      { name: 'Kabir Sethi', din: '00000103', designation: 'Nominee Director', appointed: '2022-08-01', kyc: 'Due' },
    ],
  },
  {
    slug: 'northwind-analytics',
    name: 'Northwind Analytics Private Limited',
    cin: 'U72200MH2019PTC000102',
    status: 'Active',
    category: 'Company limited by shares',
    companyClass: 'Private',
    industry: 'Software and data',
    incorporated: '2019-07-02',
    roc: 'RoC Mumbai',
    state: 'Maharashtra',
    city: 'Mumbai',
    authorisedCapital: 10000000,
    paidUpCapital: 10000000,
    lastAgm: '2026-09-28',
    lastBalanceSheet: '2026-03-31',
    directors: [
      { name: 'Rohit Mehta', din: '00000111', designation: 'Director', appointed: '2019-07-02', kyc: 'Filed' },
      { name: 'Anita Rao', din: '00000112', designation: 'Director', appointed: '2019-07-02', kyc: 'Filed' },
      { name: 'Vikram Shah', din: '00000113', designation: 'Additional Director', appointed: '2024-01-15', kyc: 'Due' },
    ],
  },
  {
    slug: 'quillstone-fintech',
    name: 'Quillstone Fintech Private Limited',
    cin: 'U67100DL2021PTC000103',
    status: 'Active',
    category: 'Company limited by shares',
    companyClass: 'Private',
    industry: 'Fintech and payments',
    incorporated: '2021-01-19',
    roc: 'RoC Delhi',
    state: 'Delhi',
    city: 'New Delhi',
    authorisedCapital: 20000000,
    paidUpCapital: 8400000,
    lastAgm: '2026-09-30',
    lastBalanceSheet: '2026-03-31',
    directors: [
      { name: 'Meera Kapoor', din: '00000121', designation: 'Managing Director', appointed: '2021-01-19', kyc: 'Filed' },
      { name: 'Dev Arora', din: '00000122', designation: 'Director', appointed: '2021-01-19', kyc: 'Filed' },
      { name: 'Anita Rao', din: '00000112', designation: 'Independent Director', appointed: '2023-04-10', kyc: 'Filed' },
    ],
  },
  {
    slug: 'tamarind-loop-foods',
    name: 'Tamarind Loop Foods Private Limited',
    cin: 'U15400TN2017PTC000104',
    status: 'Active',
    category: 'Company limited by shares',
    companyClass: 'Private',
    industry: 'Food and beverages',
    incorporated: '2017-11-06',
    roc: 'RoC Chennai',
    state: 'Tamil Nadu',
    city: 'Chennai',
    authorisedCapital: 15000000,
    paidUpCapital: 12000000,
    lastAgm: '2026-09-22',
    lastBalanceSheet: '2026-03-31',
    directors: [
      { name: 'Lakshmi Narayan', din: '00000131', designation: 'Director', appointed: '2017-11-06', kyc: 'Filed' },
      { name: 'Arjun Pillai', din: '00000132', designation: 'Whole-time Director', appointed: '2018-04-01', kyc: 'Filed' },
      { name: 'Aarav Menon', din: '00000101', designation: 'Director', appointed: '2021-11-22', kyc: 'Filed' },
    ],
  },
  {
    slug: 'bluekettle-exports',
    name: 'Bluekettle Exports Private Limited',
    cin: 'U51909GJ2015PTC000105',
    status: 'Active',
    category: 'Company limited by shares',
    companyClass: 'Private',
    industry: 'Trading and exports',
    incorporated: '2015-05-21',
    roc: 'RoC Ahmedabad',
    state: 'Gujarat',
    city: 'Ahmedabad',
    authorisedCapital: 5000000,
    paidUpCapital: 5000000,
    lastAgm: '2026-09-18',
    lastBalanceSheet: '2026-03-31',
    directors: [
      { name: 'Harsh Patel', din: '00000141', designation: 'Director', appointed: '2015-05-21', kyc: 'Filed' },
      { name: 'Nidhi Patel', din: '00000142', designation: 'Director', appointed: '2015-05-21', kyc: 'Due' },
    ],
  },
  {
    slug: 'ferrowick-steelworks',
    name: 'Ferrowick Steelworks Limited',
    cin: 'U27100WB2009PLC000106',
    status: 'Active',
    category: 'Company limited by shares',
    companyClass: 'Public',
    industry: 'Manufacturing',
    incorporated: '2009-02-11',
    roc: 'RoC Kolkata',
    state: 'West Bengal',
    city: 'Kolkata',
    authorisedCapital: 250000000,
    paidUpCapital: 184000000,
    lastAgm: '2026-09-12',
    lastBalanceSheet: '2026-03-31',
    directors: [
      { name: 'Subhash Banerjee', din: '00000151', designation: 'Chairman', appointed: '2009-02-11', kyc: 'Filed' },
      { name: 'Ritu Agarwal', din: '00000152', designation: 'Independent Director', appointed: '2016-09-30', kyc: 'Filed' },
      { name: 'Sanjay Ghosh', din: '00000153', designation: 'Whole-time Director', appointed: '2012-06-15', kyc: 'Filed' },
      { name: 'Farah Khan', din: '00000154', designation: 'Company Secretary', appointed: '2020-02-01', kyc: 'Filed' },
    ],
  },
];

/* ---------- Data access (swap these for real API calls) ---------- */

export const getCompany = (slug: string) => COMPANIES.find((c) => c.slug === slug);

export const searchCompanies = (query: string, status?: string) => {
  const q = query.trim().toLowerCase();
  return COMPANIES.filter((c) => {
    if (status && status !== 'All' && c.status !== status) return false;
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.cin.toLowerCase().includes(q) ||
      c.city.toLowerCase().includes(q) ||
      c.industry.toLowerCase().includes(q) ||
      c.directors.some((d) => d.name.toLowerCase().includes(q) || d.din.includes(q))
    );
  });
};

export interface DirectorProfile {
  name: string;
  din: string;
  kyc: Director['kyc'];
  roles: { company: Company; designation: string; appointed: string }[];
}

/** Every director, merged across companies by DIN. */
export const allDirectors = (): DirectorProfile[] => {
  const map = new Map<string, DirectorProfile>();
  for (const c of COMPANIES) {
    for (const d of c.directors) {
      const p = map.get(d.din) ?? { name: d.name, din: d.din, kyc: d.kyc, roles: [] };
      p.roles.push({ company: c, designation: d.designation, appointed: d.appointed });
      if (d.kyc === 'Due') p.kyc = 'Due';
      map.set(d.din, p);
    }
  }
  return [...map.values()];
};

export const getDirector = (din: string) => allDirectors().find((d) => d.din === din);

/** Count records by a key, largest first. */
export const countBy = <T,>(items: T[], key: (t: T) => string) => {
  const m = new Map<string, number>();
  items.forEach((i) => m.set(key(i), (m.get(key(i)) ?? 0) + 1));
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
};

/* ---------- Formatting helpers ---------- */

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const formatRupees = (n: number) => `₹ ${n.toLocaleString('en-IN')}`;

const addDays = (iso: string, days: number) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const today = () => new Date().toISOString().slice(0, 10);

/** Annual filing due dates, counted from the AGM date, marked passed or upcoming. */
export const filingDueDates = (c: Company) =>
  [
    { form: 'ADT-1', name: 'Auditor appointment', due: addDays(c.lastAgm, 15) },
    { form: 'AOC-4', name: 'Financial statements', due: addDays(c.lastAgm, 30) },
    { form: 'MGT-7', name: 'Annual return', due: addDays(c.lastAgm, 60) },
  ].map((f) => ({ ...f, passed: f.due < today() }));
