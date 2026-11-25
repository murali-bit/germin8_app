# Germin8 product website: UX plan

## 1. Who visits, and what they need to decide

| Visitor | What they want to know in the first 10 seconds | What makes them act |
|---|---|---|
| CA / CS firm partner | Can this handle many clients during AOC-4 / MGT-7 season? Does my team stay in control? | Seeing the review step and the multi-client workspace |
| Finance head moving off Tally | Will my balances match after the move? How long does it take? | Seeing the trial balance comparison report |
| Accounts / compliance staff doing the work | What will I actually click? What does the screen look like? | Clear product screens for each step |

## 2. What we learned from other product sites

- **Ramp, Zoho Books, Linear:** the hero is one plain sentence saying what the product does, with a real product screen underneath. No slogans, no abstract art.
- Every feature section pairs a short heading with **a picture of that feature in the product**. The picture explains; the text confirms.
- Headings name the thing ("Trial balance comparison"), not a feeling ("Every migration ends in balance").
- One primary action per screen. A secondary link at most.

## 3. Brand system (colours from germin8.in; copy and content are our own)

| Token | Value | Use |
|---|---|---|
| Charcoal | `#101623` | Text, header, footer, dark sections |
| Mustard | `#D4A216` | Primary buttons (charcoal text on mustard), highlights |
| Mustard dark | `#926C0B` | Mustard **text** on white (passes WCAG AA; `#D4A216` alone does not) |
| Off-white | `#F9F9F6` | Page background, alternating sections |
| Muted grey | `#6B7280` | Secondary text |
| Border | `#E5E7EB` | Card and table lines |
| Heading font | Plus Jakarta Sans 600 / 700 | Headings, numbers, buttons |
| Body font | Inter 400 / 500 | Paragraphs, tables, UI text |
| Radius | 12px | Cards, buttons, product screens |

Status colours are kept for meaning only: green = passed, amber = needs attention, red = failed. They never decorate.

## 4. Page structure

**Home**
1. Hero: what Germin8 does, in one sentence, plus a product screen.
2. Who it is for: three short cards (CA firms, finance teams, compliance staff).
3. Product 1: Tally to Zoho Books, with a migration screen.
4. Product 2: MCA filing, with the review screen.
5. How it works: three steps, each with a small screen.
6. Proof: trial balance comparison.
7. Security in plain terms.
8. One call to action.

**Product pages (Tally to Zoho, MCA, Enterprise migration)**
1. Hero: problem solved + product screen.
2. "What it does": 3 to 4 features, **each with its own screen image**.
3. Step-by-step: numbered, one line each.
4. Full feature list: grouped checklists, scannable.
5. FAQ.
6. Call to action.

## 5. Writing rules (to avoid AI-sounding copy)

- Write like a CA explaining it to a client across the table.
- Say what it does, with the real nouns: Tally, Zoho Books, AOC-4, GSTIN, DIN, trial balance.
- Short sentences. One idea each.
- Banned words: seamless, robust, effortless, unlock, elevate, leverage, empower, journey, cutting-edge, revolutionise, game-changer, "in today's world", "precision", "discretion".
- No slogans in threes ("Fast. Simple. Secure."), no poetic headings, no "No. 01" labels.
- No invented numbers, customers or certifications. Sample data is labelled as sample.
- Buttons say the action: "Book a demo", "See how migration works".

## 6. Images

- **Product screens** (built in code so they stay sharp and on-brand): migration run, ledger mapping, validation checks, trial balance comparison, CIN lookup, MCA review screen, browser extension.
- **Photos** only where they add context: accounting paperwork, tax forms, laptops with financial data. Free Unsplash licence; replace with your own when available.
- Icons: Lucide, 1.75 stroke, never emoji.

## 7. Accessibility and usability checks

- Body text at least 16px; contrast AA or better.
- Everything works at 375px width with no sideways scrolling.
- Wide tables scroll inside their own box on phones.
- Every image has alt text; decorative images have empty alt.
