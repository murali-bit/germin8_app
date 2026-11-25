import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());

// --- API proxies for product backends ---

const TALLY_API = process.env.TALLY_API_URL || 'http://localhost:3001';
const MCA_API = process.env.MCA_API_URL || 'http://localhost:4000';

app.use('/api/tally2zoho', createProxyMiddleware({
  target: TALLY_API,
  changeOrigin: true,
  pathRewrite: { '^/api/tally2zoho': '' },
}));

app.use('/api/mca', createProxyMiddleware({
  target: MCA_API,
  changeOrigin: true,
  pathRewrite: { '^/api/mca': '' },
}));

// --- Serve product frontends ---

const tallyDist = join(__dirname, 'products/tally2zoho/frontend/dist');
if (existsSync(tallyDist)) {
  app.use('/app/tally2zoho', express.static(tallyDist));
  app.get('/app/tally2zoho/*', (_req, res) => {
    res.sendFile(join(tallyDist, 'index.html'));
  });
}

const mcaDist = join(__dirname, 'products/mca-suite/dashboard/dist');
if (existsSync(mcaDist)) {
  app.use('/app/mca', express.static(mcaDist));
  app.get('/app/mca/*', (_req, res) => {
    res.sendFile(join(mcaDist, 'index.html'));
  });
}

// --- Serve marketing website (catch-all) ---

const websiteDist = join(__dirname, 'website/dist');
if (existsSync(websiteDist)) {
  app.use(express.static(websiteDist));
  app.get('*', (_req, res) => {
    res.sendFile(join(websiteDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.json({
      name: 'Germin8 Platform',
      status: 'running',
      products: {
        tally2zoho: '/app/tally2zoho',
        mca: '/app/mca',
      },
      apis: {
        tally2zoho: '/api/tally2zoho',
        mca: '/api/mca',
      },
    });
  });
}

app.listen(PORT, () => {
  console.log(`Germin8 platform running on port ${PORT}`);
});
