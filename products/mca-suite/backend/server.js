import http from 'node:http';
import crypto from 'node:crypto';
import db from './db.js';
import {
  filesureLookupCin,
  filesureSubmitFiling,
  filesureResolve,
  filesureCompany,
  filesureFilings,
  filesureDirectorResolve,
  filesureDirector,
  claudeExtractAdt1,
  extractForForm,
  extractVision,
  npcsAiPick,
  createRazorpayOrder,
  verifyRazorpaySignature,
  GATEWAY_CONFIG
} from './gateway.js';
import { AOC4_FIELD_LABELS } from './scanner-schemas.js';
import { MGT7_FIELD_LABELS, MGT7_FIELD_GROUPS } from './mgt7-schema.js';
import { buildAoc2Excel } from './aoc2-excel.js';
import { search as npcsSearch, suggestDetailed as npcsSuggest, allCodes as npcsAll } from './npcs.js';
import { buildLinkedPreview } from './linked-preview.js';
import { handle as scanFilesRoutes } from './routes/scan-files.js';
import { handle as attachmentRoutes } from './routes/attachments.js';
import { handle as reportAiRoutes } from './routes/report-ai.js';
import { handle as scanEnrichRoutes } from './routes/scan-enrich.js';
import { handle as reportVerbatimRoutes } from './routes/report-verbatim.js';
import { answerSource } from './report-verbatim.js';

// Saved scans keep either the AOC-4 client shape (general.*) or a flat form object.
const scanCompanyName = d => String(d?.general?.COMPANY_NAME || d?.companyName || d?.companyNameFyEnd || d?.companyNameFilingDate || d?.name || '').slice(0, 200);
const scanCin = d => String(d?.general?.CIN || d?.cin || '').toUpperCase().slice(0, 30);

const PORT = process.env.PORT || 4000;

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON format'));
      }
    });
    req.on('error', reject);
  });
}

function getAuthUser(req) {
  const authHeader = req.headers['authorization'] || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1];

  const now = new Date().toISOString();
  const session = db.prepare(`
    SELECT s.user_id, u.id, u.phone, u.name, u.email, u.role
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, now);

  return session || null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  try {
    // Feature route modules (multi-file scan, attachments, AI report fields). Each returns true when it answered.
    {
      const ctx = { url, pathname, method, db, sendJson, parseJsonBody };
      for (const h of [scanFilesRoutes, attachmentRoutes, reportAiRoutes, scanEnrichRoutes, reportVerbatimRoutes]) if (await h(req, res, ctx)) return;
    }
    // -------------------------------------------------------------
    // Health Check
    // -------------------------------------------------------------
    if (pathname === '/api/health' && method === 'GET') {
      return sendJson(res, 200, { ok: true, time: new Date().toISOString(), server: 'Germin8 MCA Backend' });
    }

    // -------------------------------------------------------------
    // Auth: Send OTP
    // -------------------------------------------------------------
    if (pathname === '/api/auth/send-otp' && method === 'POST') {
      const { phone } = await parseJsonBody(req);
      const cleanPhone = String(phone || '').replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        return sendJson(res, 400, { ok: false, message: 'Valid 10-digit mobile number required' });
      }

      // Generate 6-digit OTP (e.g. 123456 or random)
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const otpId = 'otp_' + crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      db.prepare(`
        INSERT INTO otps (id, phone, code, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(otpId, cleanPhone, otpCode, expiresAt);

      console.log(`\x1b[32m[AUTH OTP]\x1b[0m Mobile: +91-${cleanPhone} -> OTP: \x1b[1m${otpCode}\x1b[0m (valid for 5 mins)`);

      return sendJson(res, 200, {
        ok: true,
        message: `OTP sent successfully to +91-${cleanPhone}`,
        phone: cleanPhone,
        testOtp: otpCode // returned directly for seamless testing/dev
      });
    }

    // -------------------------------------------------------------
    // Auth: Verify OTP
    // -------------------------------------------------------------
    if (pathname === '/api/auth/verify-otp' && method === 'POST') {
      const { phone, otp } = await parseJsonBody(req);
      const cleanPhone = String(phone || '').replace(/\D/g, '');
      const cleanOtp = String(otp || '').trim();

      if (!cleanPhone || !cleanOtp) {
        return sendJson(res, 400, { ok: false, message: 'Phone and OTP are required' });
      }

      const now = new Date().toISOString();
      const validOtp = db.prepare(`
        SELECT * FROM otps
        WHERE phone = ? AND code = ? AND verified = 0 AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1
      `).get(cleanPhone, cleanOtp, now);

      // Support master test OTP 123456 as fallback for testing
      const isMasterTest = (cleanOtp === '123456');

      if (!validOtp && !isMasterTest) {
        return sendJson(res, 400, { ok: false, message: 'Invalid or expired OTP' });
      }

      if (validOtp) {
        db.prepare(`UPDATE otps SET verified = 1 WHERE id = ?`).run(validOtp.id);
      }

      // Find or create user
      let user = db.prepare(`SELECT * FROM users WHERE phone = ?`).get(cleanPhone);
      if (!user) {
        const userId = 'usr_' + crypto.randomUUID().slice(0, 8);
        db.prepare(`
          INSERT INTO users (id, phone, name, email, role)
          VALUES (?, ?, ?, ?, ?)
        `).run(userId, cleanPhone, `Staff (${cleanPhone.slice(-4)})`, `staff_${cleanPhone.slice(-4)}@germin8.in`, 'staff');
        user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
      }

      // Create Session
      const token = 'g8_tok_' + crypto.randomBytes(24).toString('hex');
      const sessionExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

      db.prepare(`
        INSERT INTO sessions (token, user_id, expires_at)
        VALUES (?, ?, ?)
      `).run(token, user.id, sessionExpiry);

      return sendJson(res, 200, {
        ok: true,
        message: 'Authentication successful',
        token,
        user: {
          id: user.id,
          phone: user.phone,
          name: user.name,
          email: user.email,
          role: user.role
        }
      });
    }

    // -------------------------------------------------------------
    // Auth: Get Current Profile
    // -------------------------------------------------------------
    if (pathname === '/api/auth/me' && method === 'GET') {
      const user = getAuthUser(req);
      if (!user) {
        return sendJson(res, 401, { ok: false, message: 'Unauthorized session' });
      }
      return sendJson(res, 200, { ok: true, user });
    }

    // -------------------------------------------------------------
    // Auth: Logout
    // -------------------------------------------------------------
    if (pathname === '/api/auth/logout' && method === 'POST') {
      const authHeader = req.headers['authorization'] || '';
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match) {
        db.prepare(`DELETE FROM sessions WHERE token = ?`).run(match[1]);
      }
      return sendJson(res, 200, { ok: true, message: 'Logged out successfully' });
    }

    // -------------------------------------------------------------
    // Clients: List
    // -------------------------------------------------------------
    if (pathname === '/api/clients' && method === 'GET') {
      const clients = db.prepare(`SELECT * FROM clients ORDER BY name ASC`).all();
      return sendJson(res, 200, { ok: true, clients });
    }

    // -------------------------------------------------------------
    // Clients: Create
    // -------------------------------------------------------------
    if (pathname === '/api/clients' && method === 'POST') {
      const { cin, name, email, address, pan, fy } = await parseJsonBody(req);
      if (!cin || !name) {
        return sendJson(res, 400, { ok: false, message: 'CIN and company name are required' });
      }
      const id = 'client_' + crypto.randomUUID().slice(0, 8);
      db.prepare(`
        INSERT OR REPLACE INTO clients (id, cin, name, email, address, pan, fy)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, cin.trim().toUpperCase(), name.trim(), email || '', address || '', pan || '', fy || '2025-26');

      const created = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id);
      return sendJson(res, 201, { ok: true, client: created });
    }

    // -------------------------------------------------------------
    // ADT-1 Drafts: List
    // -------------------------------------------------------------
    if (pathname === '/api/adt1/drafts' && method === 'GET') {
      const drafts = db.prepare(`
        SELECT d.*, c.name as client_name, p.status as payment_status, p.amount as payment_amount
        FROM adt1_drafts d
        JOIN clients c ON d.client_id = c.id
        LEFT JOIN payments p ON p.id = (
          SELECT p2.id FROM payments p2
          WHERE p2.draft_id = d.id AND p2.status = 'success'
          ORDER BY p2.created_at DESC LIMIT 1
        )
        ORDER BY d.updated_at DESC
      `).all();

      const parsed = drafts.map(d => ({
        ...d,
        formData: JSON.parse(d.form_data || '{}')
      }));

      return sendJson(res, 200, { ok: true, drafts: parsed });
    }

    // -------------------------------------------------------------
    // ADT-1 Drafts: Get Single
    // -------------------------------------------------------------
    if (pathname.startsWith('/api/adt1/drafts/') && !pathname.endsWith('/extension-payload') && method === 'GET') {
      const parts = pathname.split('/');
      const draftId = parts[4];

      const draft = db.prepare(`
        SELECT d.*, c.name as client_name, p.status as payment_status, p.payment_id as verified_payment_id
        FROM adt1_drafts d
        JOIN clients c ON d.client_id = c.id
        LEFT JOIN payments p ON d.id = p.draft_id AND p.status = 'success'
        WHERE d.id = ?
      `).get(draftId);

      if (!draft) {
        return sendJson(res, 404, { ok: false, message: 'ADT-1 draft not found' });
      }

      return sendJson(res, 200, {
        ok: true,
        draft: {
          ...draft,
          formData: JSON.parse(draft.form_data || '{}')
        }
      });
    }

    // -------------------------------------------------------------
    // ADT-1 Drafts: Upsert (Save/Update)
    // -------------------------------------------------------------
    if (pathname === '/api/adt1/drafts' && method === 'POST') {
      const { id, clientId, cin, formData } = await parseJsonBody(req);
      if (!clientId || !cin || !formData) {
        return sendJson(res, 400, { ok: false, message: 'clientId, cin, and formData are required' });
      }

      const user = getAuthUser(req) || { id: 'usr_staff_01' };
      const draftId = id || ('draft_' + crypto.randomUUID().slice(0, 8));
      const now = new Date().toISOString();

      const existing = db.prepare(`SELECT * FROM adt1_drafts WHERE id = ?`).get(draftId);

      if (existing) {
        db.prepare(`
          UPDATE adt1_drafts
          SET form_data = ?, cin = ?, updated_at = ?
          WHERE id = ?
        `).run(JSON.stringify(formData), cin, now, draftId);
      } else {
        db.prepare(`
          INSERT INTO adt1_drafts (id, user_id, client_id, cin, form_data, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)
        `).run(draftId, user.id, clientId, cin, JSON.stringify(formData), now, now);
      }

      const saved = db.prepare(`SELECT * FROM adt1_drafts WHERE id = ?`).get(draftId);
      return sendJson(res, 200, {
        ok: true,
        message: 'Draft saved successfully',
        draft: {
          ...saved,
          formData: JSON.parse(saved.form_data)
        }
      });
    }

    // -------------------------------------------------------------
    // Payment: Create Order (Testing Purpose)
    // -------------------------------------------------------------
    if (pathname === '/api/payments/create-order' && method === 'POST') {
      const { draftId, amount = 500, currency = 'INR' } = await parseJsonBody(req);
      if (!draftId) {
        return sendJson(res, 400, { ok: false, message: 'draftId is required' });
      }

      const draft = db.prepare(`SELECT * FROM adt1_drafts WHERE id = ?`).get(draftId);
      if (!draft) {
        return sendJson(res, 404, { ok: false, message: 'ADT-1 draft not found' });
      }

      const user = getAuthUser(req) || { id: draft.user_id };
      const paymentId = 'pay_rec_' + crypto.randomUUID().slice(0, 8);
      const orderId = 'order_test_' + crypto.randomBytes(6).toString('hex');

      db.prepare(`
        INSERT INTO payments (id, user_id, draft_id, form_type, amount, currency, status, order_id)
        VALUES (?, ?, ?, 'ADT-1', ?, ?, 'pending', ?)
      `).run(paymentId, user.id, draftId, amount, currency, orderId);

      console.log(`\x1b[34m[PAYMENT ORDER]\x1b[0m Order: ${orderId} for Draft: ${draftId} -> Amount: ₹${amount}`);

      return sendJson(res, 200, {
        ok: true,
        message: 'Payment order created for testing',
        orderId,
        amount,
        currency,
        draftId,
        key: 'rzp_test_germin8'
      });
    }

    // -------------------------------------------------------------
    // Payment: Verify (Testing Purpose)
    // -------------------------------------------------------------
    if (pathname === '/api/payments/verify' && method === 'POST') {
      const { orderId, paymentId, signature, method: payMethod = 'UPI Test' } = await parseJsonBody(req);

      if (!orderId) {
        return sendJson(res, 400, { ok: false, message: 'orderId is required' });
      }

      const payment = db.prepare(`SELECT * FROM payments WHERE order_id = ?`).get(orderId);
      if (!payment) {
        return sendJson(res, 404, { ok: false, message: 'Payment record not found for this order' });
      }

      const verifiedPayId = paymentId || ('pay_test_' + crypto.randomBytes(6).toString('hex'));
      const verifiedSig = signature || ('sig_test_' + crypto.randomBytes(12).toString('hex'));

      // Update payment record to success
      db.prepare(`
        UPDATE payments
        SET status = 'success', payment_id = ?, signature = ?, method = ?
        WHERE id = ?
      `).run(verifiedPayId, verifiedSig, payMethod, payment.id);

      // Update draft status to 'paid'
      db.prepare(`
        UPDATE adt1_drafts
        SET status = 'paid', payment_id = ?
        WHERE id = ?
      `).run(verifiedPayId, payment.draft_id);

      // Log audit
      db.prepare(`
        INSERT INTO audit_logs (id, user_id, action, details)
        VALUES (?, ?, ?, ?)
      `).run(
        'audit_' + crypto.randomUUID().slice(0, 8),
        payment.user_id,
        'PAYMENT_VERIFIED',
        JSON.stringify({ orderId, paymentId: verifiedPayId, amount: payment.amount, formType: 'ADT-1' })
      );

      console.log(`\x1b[32m[PAYMENT VERIFIED]\x1b[0m Order: ${orderId} -> Payment ID: ${verifiedPayId} -> Status: PAID`);

      return sendJson(res, 200, {
        ok: true,
        message: 'Payment verified successfully for ADT-1 filing!',
        paymentId: verifiedPayId,
        orderId,
        draftId: payment.draft_id,
        draftStatus: 'paid'
      });
    }

    // -------------------------------------------------------------
    // ADT-1: Export Payload for Chrome Extension (Checks Payment Status!)
    // -------------------------------------------------------------
    if (pathname.startsWith('/api/adt1/drafts/') && pathname.endsWith('/extension-payload') && method === 'GET') {
      const draftId = pathname.split('/')[4];
      const draft = db.prepare(`
        SELECT d.*, c.name as client_name, c.cin as client_cin, p.status as payment_status
        FROM adt1_drafts d
        JOIN clients c ON d.client_id = c.id
        LEFT JOIN payments p ON d.id = p.draft_id AND p.status = 'success'
        WHERE d.id = ?
      `).get(draftId);

      if (!draft) {
        return sendJson(res, 404, { ok: false, message: 'Draft not found' });
      }

      const isPaid = (draft.status === 'paid' || draft.payment_status === 'success');

      return sendJson(res, 200, {
        ok: true,
        isPaid,
        paymentStatus: draft.payment_status || draft.status,
        payload: {
          formType: 'adt1',
          clientInfo: {
            id: draft.client_id,
            name: draft.client_name,
            cin: draft.client_cin
          },
          formData: JSON.parse(draft.form_data || '{}')
        }
      });
    }

    // -------------------------------------------------------------
    // Gateway: Live Status & Configuration Check
    // -------------------------------------------------------------
    if (pathname === '/api/gateway/status' && method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        gateway: 'Germin8 MCA Gateway v1.0',
        config: GATEWAY_CONFIG,
        pricing: {
          filesure_cin_lookup: '₹1.00 / call',
          filesure_company_unlock_annual: '₹330.00 / yr',
          claude_3_5_haiku_input: '$0.10 / M tokens (~₹0.02 / form)',
          claude_3_5_haiku_output: '$0.50 / M tokens (~₹0.04 / form)',
          razorpay_gateway_fee: '2% + GST',
          free_otp_providers: ['Firebase Auth (10,000 free SMS/mo)', 'Resend/Gmail SMTP (3,000 free emails/mo)', 'Telegram Bot (Unlimited Free)']
        }
      });
    }

    // -------------------------------------------------------------
    // Gateway: FileSure CIN Master Data Lookup
    // -------------------------------------------------------------
    if (pathname === '/api/gateway/filesure/cin-lookup' && method === 'POST') {
      const { cin } = await parseJsonBody(req);
      if (!cin) {
        return sendJson(res, 400, { ok: false, message: 'CIN is required' });
      }
      console.log(`\x1b[36m[FILESURE GATEWAY]\x1b[0m Looking up CIN: ${cin}`);
      try {
        const result = await filesureLookupCin(cin);
        return sendJson(res, 200, result);
      } catch (e) {
        // FileSure not configured / unreachable: a clear message, not a 500 (the dashboard lets the CA type the name).
        return sendJson(res, 502, { ok: false, message: 'Company lookup is not available right now: ' + e.message });
      }
    }

    // -------------------------------------------------------------
    // Gateway: FileSure MCA Form Submission
    // -------------------------------------------------------------
    if (pathname === '/api/gateway/filesure/submit' && method === 'POST') {
      const { formCode = 'ADT-1', payload } = await parseJsonBody(req);
      console.log(`\x1b[36m[FILESURE GATEWAY]\x1b[0m Submitting ${formCode} to MCA`);
      const result = await filesureSubmitFiling(formCode, payload);
      return sendJson(res, 200, result);
    }

    // -------------------------------------------------------------
    // Gateway: Company Search (resolve by name)
    // -------------------------------------------------------------
    if (pathname === '/api/gateway/resolve' && method === 'POST') {
      const { q } = await parseJsonBody(req);
      if (!q) return sendJson(res, 400, { ok: false, message: 'Search query (q) is required' });
      console.log(`\x1b[36m[GATEWAY]\x1b[0m Resolving company: ${q}`);
      try {
        const result = await filesureResolve(q);
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        return sendJson(res, 502, { ok: false, message: err.message });
      }
    }

    // -------------------------------------------------------------
    // Gateway: Full Company Master Data (by CIN)
    // -------------------------------------------------------------
    if (pathname === '/api/gateway/company' && method === 'POST') {
      const { cin } = await parseJsonBody(req);
      if (!cin) return sendJson(res, 400, { ok: false, message: 'CIN is required' });
      console.log(`\x1b[36m[GATEWAY]\x1b[0m Company lookup: ${cin}`);
      try {
        const result = await filesureCompany(cin);
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        return sendJson(res, 502, { ok: false, message: err.message });
      }
    }

    // -------------------------------------------------------------
    // Gateway: Filing History (by CIN)
    // -------------------------------------------------------------
    if (pathname === '/api/gateway/filings' && method === 'POST') {
      const { cin } = await parseJsonBody(req);
      if (!cin) return sendJson(res, 400, { ok: false, message: 'CIN is required' });
      console.log(`\x1b[36m[GATEWAY]\x1b[0m Filings lookup: ${cin}`);
      try {
        const result = await filesureFilings(cin);
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        return sendJson(res, 502, { ok: false, message: err.message });
      }
    }

    // -------------------------------------------------------------
    // Gateway: Director Search (resolve by name)
    // -------------------------------------------------------------
    if (pathname === '/api/gateway/director-resolve' && method === 'POST') {
      const { q } = await parseJsonBody(req);
      if (!q) return sendJson(res, 400, { ok: false, message: 'Search query (q) is required' });
      console.log(`\x1b[36m[GATEWAY]\x1b[0m Resolving director: ${q}`);
      try {
        const result = await filesureDirectorResolve(q);
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        return sendJson(res, 502, { ok: false, message: err.message });
      }
    }

    // -------------------------------------------------------------
    // Gateway: Director Details (by DIN)
    // -------------------------------------------------------------
    if (pathname === '/api/gateway/director' && method === 'POST') {
      const { din } = await parseJsonBody(req);
      if (!din) return sendJson(res, 400, { ok: false, message: 'DIN is required' });
      console.log(`\x1b[36m[GATEWAY]\x1b[0m Director lookup: ${din}`);
      try {
        const result = await filesureDirector(din);
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        return sendJson(res, 502, { ok: false, message: err.message });
      }
    }

    // -------------------------------------------------------------
    // Gateway: Claude AI OCR & Document Extraction (ADT-1)
    // -------------------------------------------------------------
    if (pathname === '/api/gateway/claude/extract' && method === 'POST') {
      const { text, formType } = await parseJsonBody(req);
      if (!text) {
        return sendJson(res, 400, { ok: false, message: 'Document text is required for AI extraction' });
      }
      const form = formType || 'ADT-1';
      console.log(`\x1b[35m[CLAUDE GATEWAY]\x1b[0m Extracting ${form} fields from document (${text.length} chars)`);
      const result = await extractForForm(text, form);
      return sendJson(res, 200, result);
    }

    // Claude Vision: Extract from PDF/image file (base64)
    if (pathname === '/api/gateway/claude/vision' && method === 'POST') {
      const { fileBase64, mimeType, formType } = await parseJsonBody(req);
      if (!fileBase64) {
        return sendJson(res, 400, { ok: false, message: 'fileBase64 is required' });
      }
      const form = formType || 'ADT-1';
      const mime = mimeType || 'application/pdf';
      const sizeKB = Math.round((fileBase64.length * 3) / 4 / 1024);
      console.log(`\x1b[35m[CLAUDE VISION]\x1b[0m Extracting ${form} fields from ${mime} (${sizeKB} KB)`);
      const result = await extractVision(fileBase64, mime, form);
      return sendJson(res, 200, result);
    }

    // -------------------------------------------------------------
    // Razorpay: Real / Test Order Creation
    // -------------------------------------------------------------
    if (pathname === '/api/payments/razorpay/create-order' && method === 'POST') {
      const { draftId = 'draft_lessonboard_adt1', amount = 500 } = await parseJsonBody(req);
      console.log(`\x1b[34m[RAZORPAY GATEWAY]\x1b[0m Creating order for Draft: ${draftId} (₹${amount})`);
      const rzpOrder = await createRazorpayOrder(amount, draftId);

      // Record in SQLite payments table
      const paymentId = 'pay_rec_' + crypto.randomUUID().slice(0, 8);
      const user = getAuthUser(req) || { id: 'usr_staff_01' };

      db.prepare(`
        INSERT INTO payments (id, user_id, draft_id, form_type, amount, currency, status, order_id)
        VALUES (?, ?, ?, 'ADT-1', ?, 'INR', 'pending', ?)
      `).run(paymentId, user.id, draftId, amount, rzpOrder.orderId);

      return sendJson(res, 200, rzpOrder);
    }

    // -------------------------------------------------------------
    // Razorpay: Signature Verification (HMAC-SHA256)
    // -------------------------------------------------------------
    if (pathname === '/api/payments/razorpay/verify' && method === 'POST') {
      const { orderId, paymentId, signature } = await parseJsonBody(req);

      if (!orderId || !paymentId) {
        return sendJson(res, 400, { ok: false, message: 'orderId and paymentId are required' });
      }

      console.log(`\x1b[34m[RAZORPAY GATEWAY]\x1b[0m Verifying signature for Order: ${orderId}, Payment: ${paymentId}`);
      const check = verifyRazorpaySignature(orderId, paymentId, signature);

      if (!check.verified) {
        return sendJson(res, 400, { ok: false, message: 'Invalid payment signature. Verification failed.' });
      }

      const payment = db.prepare(`SELECT * FROM payments WHERE order_id = ?`).get(orderId);
      if (payment) {
        db.prepare(`
          UPDATE payments
          SET status = 'success', payment_id = ?, signature = ?, method = ?
          WHERE id = ?
        `).run(paymentId, signature || 'test_sig', check.method, payment.id);

        db.prepare(`
          UPDATE adt1_drafts
          SET status = 'paid', payment_id = ?
          WHERE id = ?
        `).run(paymentId, payment.draft_id);

        db.prepare(`
          INSERT INTO audit_logs (id, user_id, action, details)
          VALUES (?, ?, ?, ?)
        `).run(
          'audit_' + crypto.randomUUID().slice(0, 8),
          payment.user_id,
          'RAZORPAY_PAYMENT_VERIFIED',
          JSON.stringify({ orderId, paymentId, method: check.method })
        );
      }

      console.log(`\x1b[32m[RAZORPAY VERIFIED]\x1b[0m Order: ${orderId} -> Payment ID: ${paymentId} -> Verification: SUCCESS`);

      return sendJson(res, 200, {
        ok: true,
        message: 'Razorpay payment verified successfully!',
        paymentId,
        orderId,
        method: check.method,
        draftStatus: 'paid'
      });
    }

    // -------------------------------------------------------------
    // AI Scanner: saved scan results
    // -------------------------------------------------------------
    if (pathname === '/api/scans' && method === 'POST') {
      const { formType, fileName, result, data, fieldCount, seconds } = await parseJsonBody(req);
      if (!formType || !result?.extractedFields) return sendJson(res, 400, { ok: false, message: 'formType and result.extractedFields are required' });
      const values = data || result.extractedFields;
      const { fieldLabels, fieldGroups, ...stored } = result;  // re-attached from the schema on read
      const id = 'scan_' + crypto.randomUUID().slice(0, 12);
      db.prepare(`INSERT INTO saved_scans (id, form_type, file_name, company_name, cin, model, schema, field_count, seconds, result, data)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, formType, fileName || '', scanCompanyName(values), scanCin(values), result.model || '', result.schema || 'flat',
          Number(fieldCount) || 0, Number(seconds) || null, JSON.stringify(stored), JSON.stringify(values));
      return sendJson(res, 200, { ok: true, id });
    }

    if (pathname === '/api/scans' && method === 'GET') {
      const rows = db.prepare(`SELECT id, form_type, file_name, company_name, cin, model, schema, field_count, seconds, status, created_at, updated_at
                               FROM saved_scans ORDER BY created_at DESC LIMIT 200`).all();
      return sendJson(res, 200, { ok: true, scans: rows });
    }

    if (pathname.startsWith('/api/scans/') && method === 'GET') {
      const row = db.prepare('SELECT * FROM saved_scans WHERE id = ?').get(pathname.split('/').pop());
      if (!row) return sendJson(res, 404, { ok: false, message: 'Saved scan not found' });
      const result = JSON.parse(row.result);
      if (row.schema === 'aoc4-client') result.fieldLabels = AOC4_FIELD_LABELS;
      if (row.schema === 'mgt7-grouped') { result.fieldLabels = MGT7_FIELD_LABELS; result.fieldGroups = MGT7_FIELD_GROUPS; }
      return sendJson(res, 200, { ok: true, scan: { ...row, result, data: JSON.parse(row.data) } });
    }

    if (pathname.startsWith('/api/scans/') && method === 'PUT') {
      const id = pathname.split('/').pop();
      const { data, status } = await parseJsonBody(req);
      if (!db.prepare('SELECT id FROM saved_scans WHERE id = ?').get(id)) return sendJson(res, 404, { ok: false, message: 'Saved scan not found' });
      const sets = ['updated_at = CURRENT_TIMESTAMP'];
      const vals = [];
      if (data) {
        sets.push('data = ?', 'company_name = ?', 'cin = ?');
        vals.push(JSON.stringify(data), scanCompanyName(data), scanCin(data));
      }
      if (status) { sets.push('status = ?'); vals.push(status); }
      db.prepare(`UPDATE saved_scans SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
      return sendJson(res, 200, { ok: true, id });
    }

    // -------------------------------------------------------------
    // Company master: values the user confirmed in the extension
    // GET  /api/company-answers?cin=…&form=aoc4
    // POST /api/company-answers { cin, formType, answers: [{ key, label, value }] }
    // -------------------------------------------------------------
    if (pathname === '/api/company-answers' && method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      const cin = String(q.get('cin') || '').trim().toUpperCase();
      if (!cin) return sendJson(res, 400, { ok: false, message: 'cin is required' });
      const form = String(q.get('form') || '').trim();
      const rows = form
        ? db.prepare('SELECT field_key, label, value, updated_at FROM company_answers WHERE cin = ? AND form_type = ? ORDER BY field_key').all(cin, form)
        : db.prepare('SELECT form_type, field_key, label, value, updated_at FROM company_answers WHERE cin = ? ORDER BY form_type, field_key').all(cin);
      return sendJson(res, 200, { ok: true, cin, answers: rows });
    }

    if (pathname === '/api/company-answers' && method === 'POST') {
      const { cin, formType, answers } = await parseJsonBody(req);
      const c = String(cin || '').trim().toUpperCase();
      if (!/^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/.test(c)) return sendJson(res, 400, { ok: false, message: 'a valid CIN is required' });
      if (!formType || !Array.isArray(answers) || !answers.length) return sendJson(res, 400, { ok: false, message: 'formType and answers[] are required' });
      // `source` records who owns the answer: a value typed or changed here is the CA's ('ca'), which the report
      // readers (report-ai / report-verbatim) never overwrite without force, whatever its label still says.
      // Re-sending an unchanged value keeps the row's source.
      const up = db.prepare(`INSERT INTO company_answers (cin, form_type, field_key, label, value, source, updated_at)
                             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                             ON CONFLICT(cin, form_type, field_key) DO UPDATE SET label = excluded.label, value = excluded.value,
                               source = excluded.source, updated_at = CURRENT_TIMESTAMP`);
      const cur = db.prepare('SELECT value, source FROM company_answers WHERE cin = ? AND form_type = ? AND field_key = ?');
      // Values are never cut silently: a truncated JSON answer (e.g. the AOC-2 contract list) would be lost unreadable.
      const MAX_ANSWER_CHARS = 200000;
      const tooLong = answers.find(a => String(a?.value ?? '').length > MAX_ANSWER_CHARS);
      if (tooLong) return sendJson(res, 413, { ok: false, message: `The answer "${String(tooLong.label || tooLong.key || '').slice(0, 80)}" is too long (over ${MAX_ANSWER_CHARS} characters) — nothing was saved.` });
      let saved = 0;
      for (const a of answers) {
        const key = String(a?.key || '').trim().slice(0, 200);
        if (!key) continue;
        const value = String(a.value ?? '');
        up.run(c, String(formType), key, String(a.label || '').slice(0, 300), value, answerSource(cur.get(c, String(formType), key), a.label, value));
        saved++;
      }
      return sendJson(res, 200, { ok: true, saved });
    }

    // -------------------------------------------------------------
    // AOC-2: builds MCA's "Contracts at arm length" .xlsm from rows
    // POST /api/aoc2/excel { rows: [{id,name,relationship,nature,duration,terms,approvalDate,advance}], notAtArm? }
    // -------------------------------------------------------------
    if (pathname === '/api/aoc2/excel' && method === 'POST') {
      const { rows, notAtArm } = (await parseJsonBody(req)) || {};
      if (notAtArm) return sendJson(res, 400, { ok: false, message: 'The not-at-arm-length Excel template is not available — prepare that file on MCA and upload it yourself.' });
      try {
        const buf = buildAoc2Excel(rows);
        return sendJson(res, 200, { ok: true, fileName: 'AOC-2_Contracts_at_arm_length.xlsm', rows: rows.length, base64: buf.toString('base64') });
      } catch (err) {
        return sendJson(res, 400, { ok: false, message: err.message, errors: err.errors || [err.message] });
      }
    }

    // -------------------------------------------------------------
    // NPCS service codes (National Product Classification for Services 2010)
    // GET  /api/npcs/search?q=&limit=       → { ok, results:[{code, level, category, desc, categoryDesc}] }
    // POST /api/npcs/suggest { text, limit } → { ok, suggestions:[…, score, matched], categories, category:{code,desc}|null }
    // -------------------------------------------------------------
    if (pathname === '/api/npcs/search' && method === 'GET') {
      const q = String(url.searchParams.get('q') || '').slice(0, 200);
      const limit = Number(url.searchParams.get('limit')) || 20;
      return sendJson(res, 200, { ok: true, results: npcsSearch(q, { limit }) });
    }

    if (pathname === '/api/npcs/suggest' && method === 'POST') {
      const { text, limit, useAi } = (await parseJsonBody(req)) || {};
      const t = String(text || '').slice(0, 20000);
      if (!t.trim()) return sendJson(res, 400, { ok: false, message: 'text is required' });
      const n = Number(limit) || 8;
      const r = npcsSuggest(t, { limit: n });
      let suggestions = r.suggestions, ai = null, aiError = null;
      // useAi: Claude (G8 gateway / API key) picks from the keyword candidates plus every product of the 3 best
      // categories — codes always come from the NPCS list. Falls back to the keyword list when Claude is unavailable.
      if (useAi && GATEWAY_CONFIG.hasClaude) {
        try {
          const all = npcsAll();
          const cats = all.filter(c => c.level === 'category');
          const wide = npcsSuggest(t, { limit: 40 });
          const topCats = new Set(wide.categories.slice(0, 3).map(c => c.code));
          const pool = new Map(wide.suggestions.map(s => [s.code, s]));
          for (const c of all) if (c.level === 'product' && topCats.has(c.category) && pool.size < 160) pool.set(c.code, c);
          const pick = await npcsAiPick(t, [...pool.values()], cats);
          const byCode = new Map(all.map(c => [c.code, c]));
          const asSug = (code, extra) => { const c = byCode.get(code); return c ? { code: c.code, desc: c.desc, category: c.category, categoryDesc: c.categoryDesc, score: 1, matched: [], ...extra } : null; };
          const picked = [asSug(pick.productCode, { ai: true, reason: pick.reason }), ...pick.alternatives.map(a => asSug(a, { ai: true, alternative: true }))].filter(Boolean);
          const seen = new Set(picked.map(s => s.code));
          suggestions = [...picked, ...suggestions.filter(s => !seen.has(s.code))].slice(0, Math.max(n, picked.length));
          const cat = byCode.get(pick.categoryCode);
          ai = { productCode: pick.productCode, categoryCode: pick.categoryCode, categoryDesc: cat ? cat.desc : '', reason: pick.reason, model: pick.model };
        } catch (e) { aiError = e.message; }
      } else if (useAi) aiError = 'Claude is not configured (G8 gateway or ANTHROPIC_API_KEY in backend/.env)';
      const top = ai && ai.categoryCode ? { code: ai.categoryCode, desc: ai.categoryDesc } : r.categories[0];
      return sendJson(res, 200, { ok: true, suggestions, categories: r.categories, category: top ? { code: top.code, desc: top.desc } : null, ai, aiError });
    }

    // -------------------------------------------------------------
    // AOC-4 linked forms preview: AOC-2, Auditor's report, Board's report values built like the extension does
    // POST /api/aoc4/linked-preview { cin, jobId } → { ok, cin, jobId, aoc2:{values,missing,notes}, eauditor, eboard }
    // -------------------------------------------------------------
    if (pathname === '/api/aoc4/linked-preview' && method === 'POST') {
      const { cin, jobId } = (await parseJsonBody(req)) || {};
      let job = null;
      if (jobId) {
        job = db.prepare('SELECT id, payload FROM extension_jobs WHERE id = ?').get(String(jobId));
        if (!job) return sendJson(res, 404, { ok: false, message: 'Job not found' });
      }
      let client = null;
      try { client = job ? JSON.parse(job.payload || '{}') : null; } catch { client = null; }
      const c = String(cin || client?.general?.CIN || '').trim().toUpperCase();
      if (!c && !client) return sendJson(res, 400, { ok: false, message: 'cin or jobId is required' });
      if (c && !/^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/.test(c)) return sendJson(res, 400, { ok: false, message: 'a valid CIN is required' });
      if (!client && c) {
        // No job given: the latest AOC-4 job of this company, if any.
        const rows = db.prepare("SELECT id, payload FROM extension_jobs WHERE form_type = 'aoc4' AND payload LIKE ? ORDER BY created_at DESC LIMIT 5").all('%' + c + '%');
        for (const r of rows) {
          try {
            const p = JSON.parse(r.payload || '{}');
            if (String(p?.general?.CIN || '').toUpperCase() === c) { client = p; job = r; break; }
          } catch { /* skip unreadable payloads */ }
        }
      }
      const preview = buildLinkedPreview(db, c, client || { general: { CIN: c } });
      return sendJson(res, 200, { ok: true, cin: c, jobId: job ? job.id : null, ...preview });
    }

    // -------------------------------------------------------------
    // Extension: Push job from dashboard
    // -------------------------------------------------------------
    if (pathname === '/api/extension/push' && method === 'POST') {
      const { formType, clientId, clientName, payload } = await parseJsonBody(req);
      if (!formType || !payload) return sendJson(res, 400, { ok: false, message: 'formType and payload are required' });
      const id = 'job_' + crypto.randomUUID().slice(0, 12);
      db.prepare(`INSERT INTO extension_jobs (id, form_type, client_id, client_name, payload, status) VALUES (?, ?, ?, ?, ?, 'ready')`)
        .run(id, formType, clientId || '', clientName || '', typeof payload === 'string' ? payload : JSON.stringify(payload));
      console.log(`\x1b[33m[EXTENSION]\x1b[0m Job pushed: ${id} (${formType} / ${clientName || clientId})`);
      return sendJson(res, 200, { ok: true, jobId: id });
    }

    // -------------------------------------------------------------
    // Extension: Poll for pending jobs
    // -------------------------------------------------------------
    if (pathname === '/api/extension/jobs' && method === 'GET') {
      // Dashboard view: latest jobs of any status, without the (large) payloads.
      if (url.searchParams.get('scope') === 'recent') {
        // Optional ?formType=aoc4 and ?limit=N (default 20, max 500).
        const ft = String(url.searchParams.get('formType') || '').trim().toLowerCase() || null;
        const lim = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 20));
        const recent = db.prepare(`SELECT id, form_type, client_id, client_name, status, phase, result, created_at, updated_at
          FROM extension_jobs WHERE (? IS NULL OR LOWER(form_type) = ?) ORDER BY created_at DESC LIMIT ?`).all(ft, ft, lim);
        const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
        return sendJson(res, 200, { ok: true, jobs: recent.map(r => ({ ...r, result: parse(r.result) })) });
      }
      const rows = db.prepare(`SELECT * FROM extension_jobs WHERE status IN ('ready', 'started') ORDER BY created_at DESC`).all();
      const jobs = rows.map(r => ({ ...r, payload: JSON.parse(r.payload || '{}') }));
      return sendJson(res, 200, { ok: true, jobs });
    }

    // -------------------------------------------------------------
    // Extension: replace a job's payload (dashboard AOC-4 workspace edits); status is kept
    // PUT /api/extension/jobs/:id/payload { payload }
    // -------------------------------------------------------------
    if (/^\/api\/extension\/jobs\/[^/]+\/payload$/.test(pathname) && method === 'PUT') {
      const jobId = decodeURIComponent(pathname.split('/')[4]);
      const { payload } = await parseJsonBody(req);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return sendJson(res, 400, { ok: false, message: 'payload (object) is required' });
      const row = db.prepare('SELECT id FROM extension_jobs WHERE id = ?').get(jobId);
      if (!row) return sendJson(res, 404, { ok: false, message: 'Job not found' });
      db.prepare('UPDATE extension_jobs SET payload = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(payload), jobId);
      return sendJson(res, 200, { ok: true, jobId });
    }

    // -------------------------------------------------------------
    // Extension: Get specific job
    // -------------------------------------------------------------
    if (pathname.startsWith('/api/extension/jobs/') && method === 'GET') {
      const jobId = pathname.split('/').pop();
      const row = db.prepare(`SELECT * FROM extension_jobs WHERE id = ?`).get(jobId);
      if (!row) return sendJson(res, 404, { ok: false, message: 'Job not found' });
      let result = null;
      try { result = row.result ? JSON.parse(row.result) : null; } catch { result = row.result; }
      return sendJson(res, 200, { ok: true, job: { ...row, payload: JSON.parse(row.payload || '{}'), result } });
    }

    // -------------------------------------------------------------
    // Extension: Update job status
    // -------------------------------------------------------------
    if (pathname.startsWith('/api/extension/jobs/') && method === 'PUT') {
      const jobId = pathname.split('/').pop();
      const { status, phase, result } = await parseJsonBody(req);
      const row = db.prepare(`SELECT id FROM extension_jobs WHERE id = ?`).get(jobId);
      if (!row) return sendJson(res, 404, { ok: false, message: 'Job not found' });
      const sets = ['updated_at = CURRENT_TIMESTAMP'];
      const vals = [];
      if (status) { sets.push('status = ?'); vals.push(status); }
      if (phase != null) { sets.push('phase = ?'); vals.push(phase); }
      if (result) { sets.push('result = ?'); vals.push(typeof result === 'string' ? result : JSON.stringify(result)); }
      vals.push(jobId);
      db.prepare(`UPDATE extension_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return sendJson(res, 200, { ok: true, jobId });
    }

    // 404 Fallback
    return sendJson(res, 404, { ok: false, message: `Route ${method} ${pathname} not found` });

  } catch (err) {
    console.error('Server error:', err);
    return sendJson(res, 500, { ok: false, message: err.message || 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Germin8 Backend running at http://localhost:${PORT}`);
  console.log(`📁 Database: SQLite (WAL mode, data/germin8.db)`);
  console.log(`🔑 Auth: Phone OTP verification enabled`);
  console.log(`💳 Payments: Test payment order & verification ready`);
  console.log(`📄 Form: ADT-1 End-to-End Pipeline active`);
  console.log(`==================================================\n`);
});

