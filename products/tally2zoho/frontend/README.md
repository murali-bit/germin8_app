# UNIVERSAL ACCOUNTING MIGRATION PLATFORM
## High-Fidelity Enterprise SaaS UI & Clickable Prototype (React + Tailwind CSS + Lucide)

> **Pipeline Architecture:** TallyPrime 4.x → Migration Platform Engine → Zoho Books (India Edition)  
> **Target Persona:** Chartered Accountants (CA firms), Audit Partners, Finance Controllers, and Senior Enterprise Accountants.  
> **Visual Aesthetic:** Strictly Monochrome (#FFFFFF background, #111111 main text, #666666 secondary text, #E7E7E7 borders, #F7F7F7 secondary surfaces, Lucide outline icons, Inter/Geist typography). Zero colourful AI gradients or cartoon emojis.

---

## 🌟 Quick Start Instructions

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Run development server:
   ```bash
   npm run dev
   ```
3. Open in browser: `http://localhost:5173`
4. Or build for production:
   ```bash
   npm run build
   ```

---

## 🧭 Complete Catalog of All 35 Screens + Meta Presentation Kits

All 35 requested screens have been individually implemented as modular, high-fidelity desktop frames (1440 × 1024 equivalent) with realistic accounting data clearly identified as demonstration data.

### 1. Public Website Screens (Screens 01 – 10)
- **Screen 01 — Home Page:** Premium SaaS landing page with minimal architectural flow diagram (TallyPrime → Migration Engine → Zoho Books), problem vs solution, 5-step workflow, security commitments, and clean footer.
- **Screen 02 — Features Page:** 10 core capabilities with execution diagrams (JSON Import, Smart Mapping, Classification, Transforms, Templates, Validation, Dependencies, Rejections, Traceability, Reconciliation).
- **Screen 03 — How It Works Page:** 5-step end-to-end migration methodology with key verification checkpoints and CA sign-off prerequisites.
- **Screen 04 — Supported Formats Page:** Compatibility matrix: Tally JSON / JSONEx, Canonical JSON & PostgreSQL store, and Zoho Books CSV / TSV / XLS by module.
- **Screen 05 — Migration Guide:** Standard operating procedure for accountants covering export keystrokes, mandatory 9 datasets, FY cutoff, and error triage.
- **Screen 06 — Pricing Page:** Transparent, predictable usage tiers (Starter, Professional, Enterprise / CA Firm License) with editable placeholder values.
- **Screen 07 — FAQ Page:** Comprehensive answers to all 9 mandatory enterprise accounting and technical questions.
- **Screen 08 — Contact Page:** Enterprise advisory inquiry form with Tally version and annual voucher volume selectors.
- **Screen 09 — Sign In Page:** Minimalist enterprise login with quick-login demo shortcut for Lead Auditor (Rajesh Mehta & Co.).
- **Screen 10 — Registration Page:** Corporate account onboarding with terms approval and GST entity verification.

### 2. Main Application Dashboard Screens (Screens 11 – 18)
- **Screen 11 — Main Dashboard:** Entity switcher, locked FY indicator, key migration KPIs, recent migration table, and live activity log stream.
- **Screen 12 — New Migration:** Guided migration initialization wizard with manual FY selection (2024–25, 2025–26, 2026–27), cutoff date picker, and migration method selection. Includes the mandatory compliance rule warning that company and FY are never auto-overwritten.
- **Screen 13 — Tally Export Guide:** Interactive guide with keystroke routes for Master Data (6 reports), Voucher Data (6 types), Stock Summary, and Trial Balance.
- **Screen 14 — Export Catalogue:** Exhaustive reviewable source dataset list with Mandatory / Conditional / Not Applicable toggles, CA sign-off status, and add-custom-dataset modal.
- **Screen 15 — Tally JSON Upload Center:** 9 dedicated, isolated upload cards with real-time schema validation, file size, status, replace, and remove actions.
- **Screen 16 — Data Completeness Check:** Pre-flight reconciliation between the Export Catalogue and uploaded files, waiver controls, and downloadable missing-data audit report.
- **Screen 17 — Data Processing Status:** 7-stage streaming pipeline (parsing JSON, extracting records, masters, vouchers, stock, balances, canonical normalization) with expandable terminal console.
- **Screen 18 — Data Explorer:** 12-tab inspector (Customers, Vendors, COA, Stock Items, Units, Taxes, Sales, Purchases, Receipts, Payments, Journals, Trial Balance) with side-by-side raw Tally JSON vs Canonical entity inspection.

### 3. Smart Mapping & Processing Screens (Screens 19 – 24)
- **Screen 19 — Smart Mapping Studio:** Precision field mapping table with match scores, bulk approve (≥90%), and detail audit drawer showing sample values and applied transformation expressions.
- **Screen 20 — Transaction Classification:** Classifies Tally vouchers into Zoho modules (Invoices, Bills, Payments, Journals) with a dedicated inspection panel for ambiguous vouchers.
- **Screen 21 — Dependency Manager:** 14-stage Directed Acyclic Graph (DAG) visualizing execution order from Company Config down to Final Reconciliation.
- **Screen 22 — Template Library:** Management workspace for all 10 official Zoho Books modules with accepted formats (CSV/TSV/XLS), versioning, file limits, and sample download.
- **Screen 23 — Template Mapping View:** Side-by-side comparison between Canonical Accounting Fields and Zoho Template Headers with live CSV row preview.
- **Screen 24 — Validation Center:** Triaged issue workbench (READY, NEEDS REVIEW, BLOCKED) with record IDs, root causes, and deterministic fixes.

### 4. Export & Error Correction Screens (Screens 25 – 31)
- **Screen 25 — Export Center:** Hub of 11 Zoho Books certified CSV export files with individual download and batch sequential ZIP export.
- **Screen 26 — Import Instructions:** Ordered step-by-step manual Zoho Books import checklist with menu routes, preview checks, and completion checkboxes.
- **Screen 27 — Import Tracker:** Migration progress matrix tracking generated, downloaded, imported, failed, and pending records with statutory verification caveats.
- **Screen 28 — Zoho Rejection Manager (Key Screen):** 10-step error report analyzer with source attribution, before/after comparison, user approval gate, and delta retry file generation.
- **Screen 29 — Identifier Tracker:** 3-way traceability matrix linking Tally Source ID → Migration Canonical ID → Zoho Destination Reference.
- **Screen 30 — Reconciliation Dashboard:** Dual-system mathematical balance audit comparing Tally closing vs Zoho opening figures with zero variance (₹ 0.00 diff) and CA sign-off certificate.
- **Screen 31 — Migration Reports:** Downloadable executive summaries, traceability matrices, and audit certificates for statutory workpapers.

### 5. Settings & Support Screens (Screens 32 – 35)
- **Screen 32 — Company Settings:** User-controlled legal profile, FY lock, and staging data retention policies.
- **Screen 33 — Mapping Profiles:** Reusable industry templates (Manufacturing, Retail, IT Services, SEZ).
- **Screen 34 — System Settings:** Practice team members, role-based access control, MFA status, and immutable audit trails.
- **Screen 35 — Help & Support:** Documentation links, toll-free CA hotline, and technical support ticket desk.

### 6. Meta Presentation Kits
- **Overview Contact Sheet (`screen-overview`):** High-level thumbnail gallery of all 35 screens with search and jump controls.
- **Design System & Component Kit (`screen-design-system`):** Interactive token showcase, typography scale, buttons, status chips, outline icon gallery, and responsive mobile frame simulation.
