'use strict';
/**
 * server.js — AtlasCRM production server (Node 22 + Express + node:sqlite)
 *
 *   PORT          env var (default 3000)
 *   JWT_SECRET    env var (set this in real prod)
 *
 * Routes:
 *   POST   /api/auth/signup
 *   POST   /api/auth/login
 *   POST   /api/auth/logout
 *   GET    /api/auth/session
 *   GET    /api/auth/me
 *
 *   POST   /api/auth/create-agent     manager only; counts against the plan's seat limit
 *   POST   /api/auth/change-password  signs out other devices
 *   POST   /api/auth/set-user-password manager resets a teammate: {user_id, password}
 *   POST   /api/auth/forgot-password  always answers the same, by design
 *   POST   /api/auth/reset-password   token is single-use, 1h TTL
 *   POST   /api/auth/send-verification emails a verification link to the current user
 *   POST   /api/auth/verify-email     24h TTL
 *
 *   GET    /api/data/:table?col=eq.X&order=col.desc&limit=N            list
 *   GET    /api/data/:table?select=*,fk(*)&id=eq.X                     with foreign-key embed
 *   GET    /api/data/:table?count=exact&head=true                      just the count
 *   POST   /api/data/:table                                            insert (body = row or rows[])
 *   PATCH  /api/data/:table?id=eq.X                                    update (body = patch)
 *   DELETE /api/data/:table?id=eq.X                                    delete
 *
 *   POST   /api/upload                                               multipart, field name `files`, up to 10×10MB
 *   GET    /uploads/:filename                                        static
 *
 *   /                                         redirects to /login
 *   /login    /dashboard    /add-lead    /add-listing       static HTML
 *   /js/*    /uploads/*    /*.html                          static
 */
const path        = require('path');
const fs          = require('fs');
const express     = require('express');
const cookieParser= require('cookie-parser');
const cors        = require('cors');
const compression = require('compression');
const morgan      = require('morgan');
const multer      = require('multer');
const { nanoid }  = require('nanoid');

const auth        = require('./auth');
const authRoutes  = require('./routes/auth');
const dataRoutes  = require('./routes/data');
const scraperRoutes = require('./routes/scraper');
const importRoutes = require('./routes/import');
const ratesRoutes = require('./routes/rates');
const marketingRoutes = require('./routes/marketing');
const financeRoutes = require('./routes/finance');
const messagingRoutes = require('./routes/messaging');
const adminRoutes = require('./routes/admin');
const contactRoutes = require('./routes/contact');
const analyticsRoutes = require('./routes/analytics');
const teamRoutes  = require('./routes/team');
const chatRoutes  = require('./routes/chat');
const meetingsRoutes = require('./routes/meetings');
const exportRoutes = require('./routes/export');
const billingRoutes = require('./routes/billing');
const { WebSocketServer } = require('ws');
const { fail } = require('./routes/_errors');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Middleware ────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.set('etag', 'strong');
// Railway/Render/Fly terminate TLS upstream. Without this, req.secure is always
// false and req.ip is the proxy's — which breaks both the Secure session cookie
// and the per-IP login throttle.
app.set('trust proxy', 1);

app.use(morgan('tiny'));
app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(auth.authMiddleware);

// ─── Health check ──────────────────────────────────────────────────────
// Unauthenticated and cheap: hosting platforms poll this to decide whether a
// deploy is live and whether to restart a wedged container. It touches the DB
// so a readable-but-broken database reports unhealthy instead of OK.
app.get('/healthz', (req, res) => {
  try {
    const { db } = require('./db');
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', uptime_s: Math.round(process.uptime()) });
  } catch (e) {
    // Unauthenticated endpoint — the platform needs the signal, not the detail.
    console.error('[healthz]', e);
    res.status(503).json({ status: 'error' });
  }
});

// ─── API routes ────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/scraper', scraperRoutes);
app.use('/api/messaging', messagingRoutes);
app.use('/api/import', importRoutes);
app.use('/api/rates', ratesRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/meetings', meetingsRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/billing', billingRoutes);

// ─── File upload (used by add-listing photo uploader, deal documents, etc.)
let actualUploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
try {
  fs.mkdirSync(actualUploadsDir, { recursive: true });
} catch (e) {
  // Fallback to /tmp if the original path is not writable (e.g., on Vercel)
  const fallbackUploadsDir = path.join('/tmp', 'uploads');
  console.warn(`[upload] Failed to create directory at ${actualUploadsDir}: ${e.message}. Falling back to ${fallbackUploadsDir}`);
  actualUploadsDir = fallbackUploadsDir;
  fs.mkdirSync(actualUploadsDir, { recursive: true });
}
const uploadsDir = actualUploadsDir;
// Files are filed under <company>/<YYYY-MM>/ at the moment they arrive. Writing
// everything flat into one directory is what produced the pile this had to be
// dug out of (see scripts/uploads.js) — the layout has to be maintained on the
// way in, not repaired afterwards.
function uploadSubdir(req) {
  const company = req.user && req.user.company_id;
  // company_id is a server-issued nanoid, never client input; the fallback and
  // the character filter keep a surprising value from escaping the directory.
  const safeCompany = String(company || '_unassigned').replace(/[^A-Za-z0-9_-]/g, '') || '_unassigned';
  const d = new Date();
  return `${safeCompany}/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsDir, uploadSubdir(req));
    fs.mkdir(dir, { recursive: true }, err => cb(err, dir));
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]/g, '_');
    cb(null, `${Date.now()}-${nanoid(6)}-${safe}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/upload', auth.requireAuth, upload.array('files', 10), (req, res) => {
  const sub = uploadSubdir(req);
  const files = (req.files || []).map(f => ({
    // Relative, always. An absolute URL bakes in the hostname and breaks the
    // moment the app moves to a custom domain or behind a different origin.
    url:      `/uploads/${sub}/${f.filename}`,
    name:     f.originalname,
    size:     f.size,
    type:     f.mimetype,
  }));
  res.json({ data: files });
});
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d' }));

// ─── Static frontend ──────────────────────────────────────────────────
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, {
  extensions: ['html'],
  etag: true,
  setHeaders: (res, p) => {
    if (p.endsWith('.html')) {
      // HTML must always be fresh so new ?v= asset URLs are picked up.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (/\.(js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|ico)$/i.test(p)) {
      // Versioned via ?v= in the HTML, so cache aggressively — this is the
      // single biggest win: agents stop re-downloading ~1 MB every load.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// Friendly URLs
const ROUTES = {
  '/':            'landing.html',
  '/login':       'warm_login.html',
  '/app':         'warm.html',
  '/add-lead':    'warm_add_lead.html',
  '/add-listing': 'warm_add_listing.html',
  '/extension':   'warm_extension.html',
  '/admin':       'admin.html',
  '/reset-password': 'reset_password.html',
  '/legal':       'legal.html',
  '/terms':       'legal.html',
  '/privacy':     'legal.html',
};

// Cache-busting build id — changes on every deploy (Railway commit SHA) or, as a
// fallback, on every process start. Injected into the ?v= of every asset URL so
// browsers ALWAYS fetch the latest JS/CSS after a deploy (no manual version bumps).
const BUILD_ID = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.BUILD_ID || String(Date.now());
const _htmlCache = {};
function sendHtml(res, file) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    if (_htmlCache[file] === undefined) {
      let html = fs.readFileSync(path.join(publicDir, file), 'utf8');
      // Replace cache-busting token
      html = html.replace(/\?v=[\w.\-]+/g, '?v=' + BUILD_ID);
      // Replace Mapbox token placeholder
      const mapboxToken = process.env.MAPBOX_TOKEN || '';
      html = html.replace(/\{\{MAPBOX_TOKEN\}\}/g, mapboxToken);
      _htmlCache[file] = html;
    }
    res.send(_htmlCache[file]);
  } catch (e) {
    res.sendFile(path.join(publicDir, file));
  }
}
for (const [url, file] of Object.entries(ROUTES)) {
  app.get(url, (req, res) => sendHtml(res, file));
}
// Old standalone dashboard page was superseded by the "dashboard" nav-page
// built into /app — keep the URL alive as a redirect for old bookmarks/links.
app.get('/dashboard', (req, res) => res.redirect('/app'));

// 404 for unknown API routes
app.use('/api/*', (req, res) => res.status(404).json({ error: 'Not found' }));

// SPA fallback — serve login for any other path (so deep links don't 404)
app.use((req, res) => {
  if (req.accepts('html')) return sendHtml(res, 'warm_login.html');
  res.status(404).json({ error: 'Not found' });
});

// Centralised error handler. Anything a route throws lands here, including
// database writes that failed — routes/_errors.js turns constraint violations
// into something the caller can act on and keeps everything else in the log
// rather than in the response body.
app.use((err, req, res, next) => {
  fail(res, err, {
    status: err.status || 500,
    context: `${req.method} ${req.originalUrl}`,
    message: 'Server error',
  });
});

if (require.main === module) {
  const http = require('http');
  const { db } = require('./db');
  const server = http.createServer(app);

  // ── Chat WebSocket: real-time push for group channels + DMs. ──
  // Auth reuses the SAME session cookie as the rest of the app (parsed manually
  // here since the WS upgrade request doesn't go through Express's cookie-parser
  // middleware). REST endpoints remain the single source of truth for writes;
  // this only pushes new messages to already-connected members.
  const wss = new WebSocketServer({ server, path: '/ws/chat' });
  const chatSockets = new Map(); // userId -> Set<ws>

  function parseCookie(header, name) {
    if (!header) return null;
    const m = header.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  wss.on('connection', (ws, req) => {
    const token = parseCookie(req.headers.cookie, 'atlas_session');
    const user = token ? auth.userFromToken(token) : null;
    if (!user) { ws.close(4001, 'unauthorized'); return; }
    ws.userId = user.id;
    if (!chatSockets.has(user.id)) chatSockets.set(user.id, new Set());
    chatSockets.get(user.id).add(ws);

    // Live presence: freshen last_seen_at right away (don't wait for the next
    // HTTP request's throttled update) and tell everyone currently connected
    // this user just came online — so a DM's green dot updates instantly
    // instead of waiting for the next 20s channel-list poll.
    // Best-effort: presence is decoration, and losing it must not drop the socket.
    try { db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), user.id); }
    catch (e) { console.error('[ws] presence update failed for', user.id, '-', e.message); }
    const presencePayload = JSON.stringify({ type: 'presence', userId: user.id, status: 'online' });
    for (const sockets of chatSockets.values()) for (const peer of sockets) { try { peer.send(presencePayload); } catch (e) {} }

    ws.on('message', (raw) => {
      // Only 'typing' indicators travel client→server over the socket; actual
      // messages are sent via POST /api/chat/channels/:id/messages.
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'typing' && msg.channelId) {
          const memberIds = db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ?').all(msg.channelId).map(r => r.user_id);
          const payload = JSON.stringify({ type: 'typing', channelId: msg.channelId, userId: user.id, isTyping: !!msg.isTyping });
          for (const uid of memberIds) {
            if (uid === user.id) continue;
            const set = chatSockets.get(uid);
            if (!set) continue;
            for (const peer of set) { try { peer.send(payload); } catch (e) {} }
          }
        }
      } catch (e) {}
    });
    ws.on('close', () => {
      const set = chatSockets.get(user.id);
      if (set) {
        set.delete(ws);
        if (!set.size) {
          chatSockets.delete(user.id);
          // Only announce "offline" once ALL of this user's sockets are gone —
          // otherwise a second open tab would flicker the first tab's indicator.
          const offlinePayload = JSON.stringify({ type: 'presence', userId: user.id, status: 'offline' });
          for (const sockets of chatSockets.values()) for (const peer of sockets) { try { peer.send(offlinePayload); } catch (e) {} }
        }
      }
    });
  });

  // Exposed for routes/chat.js to push new-message events without importing the
  // WS internals there (keeps the WS transport layer isolated to server.js).
  global.__chatBroadcast = (userIds, payload) => {
    const json = JSON.stringify(payload);
    for (const uid of userIds) {
      const set = chatSockets.get(uid);
      if (!set) continue;
      for (const ws of set) { try { ws.send(json); } catch (e) {} }
    }
  };

  // Automatic database snapshots. Started here rather than at module load so
  // that importing server.js (tests, tooling) doesn't spin up a scheduler.
  require('./backup').scheduleBackups();
  // Keep stored subscription state honest (expired trials, lapsed invoices).
  require('./billing').scheduleBillingSweep();
  // Deadline alerts: due-today and overdue tasks raise a notification instead of
  // waiting to be noticed on the Tasks page.
  require('./task-alerts').scheduleTaskAlerts();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  AtlasCRM server  →  http://0.0.0.0:${PORT}`);
    console.log(`  press Ctrl+C to stop\n`);
  });
}

module.exports = app;