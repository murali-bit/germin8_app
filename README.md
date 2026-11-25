# Germin8 Platform

**Intelligent Automation. Smarter Business.**

Germin8 is an enterprise platform for AI-powered financial data migration, accounting automation, and regulatory compliance.

## Products

### 1. Tally2Zoho Migrator (`/products/tally2zoho`)
End-to-end migration from TallyPrime to Zoho Books with guaranteed trial balance parity. Handles masters, vouchers, GST data, inventory, and multi-year migrations.

### 2. MCA Compliance Suite (`/products/mca-suite`)
Automates Ministry of Corporate Affairs filings — Form AOC-4, ADT-1, and MGT-7. Includes a dashboard for CAs, a Node.js backend, and a Chrome extension for MCA portal automation.

### Marketing Website (`/website`)
The public-facing website with product pages, pricing, blog, guides, company database, and documentation.

## Architecture

```
germin8_app/
├── server.js              # Express gateway (serves all frontends, proxies APIs)
├── website/               # Marketing site (React + Vite)
├── products/
│   ├── tally2zoho/        # Migration tool (React frontend + Fastify API)
│   └── mca-suite/         # MCA compliance (React dashboard + Node API + Chrome ext)
├── Dockerfile             # Multi-stage Docker build for AWS
└── .env.example           # Environment config
```

## Quick Start

```bash
# Install all dependencies
npm run install:all

# Build all frontends
npm run build:all

# Start the platform server
npm start

# Or start product backends individually
npm run start:tally2zoho   # Port 3001
npm run start:mca-backend  # Port 4000
```

## AWS Deployment

### Using Docker
```bash
docker build -t germin8-platform .
docker run -p 3000:3000 germin8-platform
```

### Using AWS App Runner / ECS
1. Push this repo to GitHub
2. Connect to AWS App Runner or create an ECS service
3. Set the build command: `docker build -t germin8 .`
4. Set the start command: `node server.js`
5. Configure environment variables from `.env.example`

## Routes

| Path | Serves |
|------|--------|
| `/` | Marketing website |
| `/app/tally2zoho` | Tally2Zoho migration app |
| `/app/mca` | MCA compliance dashboard |
| `/api/tally2zoho/*` | Tally2Zoho backend API |
| `/api/mca/*` | MCA backend API |

## Tech Stack

- **Gateway**: Express + compression + helmet
- **Marketing**: React 19, TypeScript, Vite, Tailwind CSS
- **Tally2Zoho**: React 19, Vite, Fastify
- **MCA Suite**: React, Vite, Node.js, SQLite, Firebase Auth
