import { SOLUTIONS } from './solutions';

/**
 * Pricing config. Edit this file only; the /pricing page reads from it.
 *
 *  - weekly / monthly / yearly: price in INR. Leave as `null` to show "Contact us for pricing".
 *    `yearly` is the price per MONTH when billed yearly (so you can show the saving).
 *  - buyUrl: a payment link (for example a Razorpay payment link) for each billing period.
 *    Leave as `null` and the button opens the demo form for that product instead.
 */

export interface PricingProduct {
  slug: string;
  name: string;
  tagline: string;
  href: string;
  features: string[];
  weekly: number | null;
  monthly: number | null;
  yearly: number | null;
  buyUrl: { weekly: string | null; monthly: string | null; yearly: string | null };
}

const migration = SOLUTIONS.find((s) => s.slug === 'tally-to-zoho');
const roc = SOLUTIONS.find((s) => s.slug === 'incorporation-roc');

export const PRICING_PRODUCTS: PricingProduct[] = [
  {
    slug: 'tally-to-zoho',
    name: 'Tally to Zoho migration',
    tagline: migration?.short ?? 'Move your books to Zoho Books, with balances that match.',
    href: '/products/tally-to-zoho',
    features: migration?.automates ?? [],
    // DUMMY PRICE: replace before launch
    weekly: 1499,
    monthly: 4999,
    yearly: 3999,
    buyUrl: { weekly: null, monthly: null, yearly: null },
  },
  {
    slug: 'mca-automation',
    name: 'MCA filing automation',
    tagline: roc?.short ?? 'ROC filings, prepared with less typing.',
    href: '/products/mca-automation',
    features: roc?.automates ?? [],
    // DUMMY PRICE: replace before launch
    weekly: 899,
    monthly: 2999,
    yearly: 2399,
    buyUrl: { weekly: null, monthly: null, yearly: null },
  },
];

/** Organisation plan: always "Contact us". Edit the feature list as you like. */
export const ORG_PLAN = {
  name: 'Organisation',
  tagline: 'For firms and companies with many clients, entities or teams.',
  features: [
    'Both products, set up together',
    'Custom automation built around your process',
    'Multiple entities, clients and team members',
    'Onboarding and support planned with you',
  ],
};
