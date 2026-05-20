'use strict';
/**
 * server.js — warm.ge production server (Node 22 + Express + node:sqlite)
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
 *   GET    /api/data/:table                  list with PostgREST-style filters
 *   POST   /api/data/:table                  insert
 *   PATCH  /api/data/:table?id=eq.X          update
 *   DELETE /api/data/:table?id=eq.X          delete
 *
 *   POST   /api/upload                       multipart file upload
 *   GET    /uploads/:filename                static
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
const morgan      = require('morgan');
const multer      = require('multer');
const { nanoid }  = require('nanoid');

const auth        = require('./auth');
const authRoutes  = require('./routes/auth');
const dataRoutes  = require('./routes/data');
const scraperRoutes = require('./routes/scraper');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Middleware ────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.set('etag', 'strong');

app.use(morgan('tiny'));
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(auth.authMiddleware);

// ─── API routes ────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/scraper', scraperRoutes);

// ─── File upload (used by add-listing photo uploader, deal documents, etc.)
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]/g, '_');
    cb(null, `${Date.now()}-${nanoid(6)}-${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/upload', auth.requireAuth, upload.array('files', 10), (req, res) => {
  const files = (req.files || []).map(f => ({
    url:      `/uploads/${f.filename}`,
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
  setHeaders: (res, p) => {
    if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// Friendly URLs
const ROUTES = {
  '/':            'warm_login.html',
  '/login':       'warm_login.html',
  '/app':         'warm.html',
  '/dashboard':   'warm_dashboard.html',
  '/add-lead':    'warm_add_lead.html',
  '/add-listing': 'warm_add_listing.html',
  '/test':        'test_button.html',
};
for (const [url, file] of Object.entries(ROUTES)) {
  app.get(url, (req, res) => res.sendFile(path.join(publicDir, file)));
}

// 404 for unknown API routes
app.use('/api/*', (req, res) => res.status(404).json({ error: 'Not found' }));

// SPA fallback — serve login for any other path (so deep links don't 404)
app.use((req, res) => {
  if (req.accepts('html')) return res.sendFile(path.join(publicDir, 'warm_login.html'));
  res.status(404).json({ error: 'Not found' });
});

// Centralised error handler
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  warm.ge server  →  http://localhost:${PORT}`);
    console.log(`  press Ctrl+C to stop\n`);
  });
}

module.exports = app;
