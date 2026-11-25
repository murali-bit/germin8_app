# Germin8 Enterprise Web Application

> "Intelligent Automation. Smarter Business."

Enterprise-grade, fully responsive, multi-page web platform for **Germin8**, specialized in AI-powered financial data migration, accounting automation, and regulatory compliance workflows.

---

## Flagship Products

1. **Tally to Zoho Books Migration Automation (`/products/tally-to-zoho`)**
   - End-to-end data extraction, recursive field mapping, and validated sequential import.
   - Guaranteed trial balance parity with verified **₹0.00** Opening Balance Adjustment suspense.
   - Preserves customer & vendor GSTINs, HSN/SAC codes, inventory valuations, and open vouchers.

2. **MCA Compliance & Form Automation (`/products/mca-automation`)**
   - Automates Ministry of Corporate Affairs (MCA) V3 filings: **Form AOC-4**, **Form ADT-1**, and **Form MGT-7**.
   - Automatic CIN master lookup, PDF Schedule III optical extraction, and pre-scrutiny checks.
   - Secure browser helper extension pre-fills web forms in seconds with mandatory human CA/CS review.

---

## Technical Architecture

- **Framework:** React 19 + TypeScript + Vite
- **Routing:** React Router v7 with route-level code splitting (`React.lazy` + `Suspense`)
- **Styling & Design System:** Tailwind CSS v3 with brand colors (Navy `#101C35`, Electric Blue `#246BFD`, Sky Blue `#65A5FF`, Background `#F7F9FC`)
- **Typography:** Manrope (Headings), Inter (Body)
- **Iconography:** Lucide React exclusively (Strictly **zero emoji**, zero AI robot clip-art)
- **Forms & State:** React Hook Form, Zod schema validation, interactive trial balance simulators
- **Documentation Platform:** `DocsLayout` featuring left navigation sidebar, search filter, on-page table of contents, last-updated tags, and copyable code blocks

---

## Complete Sitemap & Verified Routes (60+ Routes)

### A. Home
- `/` – Homepage (All 10 sections: Hero with simulation terminal, 4 capability cards, 2 product showcases, balance reconciliation comparison demo, 4-step workflow pipeline, solutions by audience, 6 differentiators, interactive code sandbox, latest insights, CTA banner, and 4-column footer)

### B. About Us
- `/about` – Company Overview
- `/about/our-story` – The Germin8 Journey & Milestones
- `/about/mission-vision` – Mission, Vision & Core Values
- `/about/our-team` – Team & Leadership Structures
- `/careers` – Open Engineering & Product Positions
- `/about/partners` – Practice & Technology Partnerships

### C. Products
- `/products` – Products Overview
- `/products/tally-to-zoho` – Tally to Zoho Books Migration Engine
- `/products/mca-automation` – MCA Form Automation (AOC-4, ADT-1, MGT-7)
- `/products/financial-data-migration` – Multi-Entity Migration Architecture
- `/products/accounting-automation` – Accounting Workflow Engine
- `/products/future-products` – Public Engineering Roadmap

### D. Automation
- `/automation` – Automation Capabilities Overview
- `/automation/ai-agents` – Constrained Financial AI Agents
- `/automation/financial-automation` – Financial Workflows & Trial Balances
- `/automation/accounting-automation` – Operational Accounting Automation
- `/automation/document-processing` – Intelligent PDF Schedule III Extraction
- `/automation/data-reconciliation` – Automated Debit/Credit Reconciliation
- `/automation/browser-automation` – Secure Browser Helper Extension

### E. Solutions
- `/solutions` – Solutions Overview
- `/solutions/ca-firms` – Solutions for CA Firms & Practitioners
- `/solutions/accounting-teams` – Solutions for In-House Accounting Teams
- `/solutions/small-businesses` – Solutions for Growing SMBs
- `/solutions/enterprises` – Solutions for Enterprise Conglomerates

### F. Industries
- `/industries` – Sector Specializations Overview
- `/industries/accounting` – Accounting & Bookkeeping Practices
- `/industries/financial-services` – FinTech & Financial Services
- `/industries/professional-services` – Consultancies & Legal Practices
- `/industries/corporate-compliance` – Corporate Secretarial Teams

### G. Resources
- `/resources` – Knowledge & Resource Centre
- `/blog` – Technical Insights Blog
- `/blog/:slug` – Individual Technical Article
- `/case-studies` – Customer Case Studies & Benchmarks
- `/case-studies/:slug` – Detailed Benchmark Breakdown
- `/webinars` – Live & Recorded Masterclasses
- `/faq` – Searchable Multi-Category FAQ

### H. User Guides
- `/guides` – User Guide Centre
- `/guides/tally-to-zoho-migration` – Step-by-Step Tally Migration Manual
- `/guides/mca-automation` – Step-by-Step MCA V3 Filing Manual
- `/guides/account-setup` – Organization & Tenant Setup Guide
- `/guides/getting-started` – Pre-Migration Checklist
- `/guides/troubleshooting` – User Diagnostic Procedures
- `/guides/data-validation` – Data Validation & Discrepancies Guide

### I. Technical Documentation
- `/docs` – Technical Documentation Home
- `/docs/tally-migration` – Tally Schema & Field Mapping Specification
- `/docs/mca-automation` – MCA V3 Payload Schema Specification
- `/docs/installation` – Installation & Prerequisites
- `/docs/browser-extension` – Browser Extension Architecture
- `/docs/workflows` – State Machines & Pipeline Execution
- `/docs/integrations` – ERP & Zoho Books Connectors
- `/docs/troubleshooting` – Technical Error Code Taxonomy

### J. Contact & Business Pages
- `/contact` – Contact Us (Interactive inquiry form)
- `/book-a-demo` – Schedule Tailored Live Demonstration
- `/support` – Priority SLA Support
- `/privacy-policy` – Data Privacy & Ephemeral Processing Policy
- `/terms-and-conditions` – Terms & Conditions of Service
- `/cookie-policy` – Minimal First-Party Cookie Policy
- `/security` – Enterprise Data Security & Trust Architecture
- `/sitemap` – Complete HTML Index of All Pages

---

## Local Development & Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Server
```bash
npm run dev
```
The application will launch on `http://localhost:5173`.

### 3. Production Build
```bash
npm run build
```
Generates an optimized production build in the `/dist` directory in ~2.2s.

### 4. Preview Production Build
```bash
npm run preview
```

---

## Deployment Instructions

### Vercel Deployment (Recommended)
1. Push repository to GitHub / GitLab / Bitbucket.
2. Import project into Vercel.
3. Framework Preset: **Vite**.
4. Build Command: `npm run build`.
5. Output Directory: `dist`.
6. Add SPA rewrite rule in `vercel.json`:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

---

© 2024 Germin8 Technologies Private Limited. All rights reserved.
