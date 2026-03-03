const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const config = require('./config');
const {
  auth,
  authRouter,
  reviewsRouter,
  appsRouter,
  analyticsRouter,
  syncRouter,
} = require('./routes');

const app = express();

app.use((req, res, next) => {
  const p = (req.path || '').toLowerCase();
  if (p.includes('.db') || p.includes('/data/') || p.startsWith('/data')) {
    return res.status(404).end();
  }
  next();
});

const allowedOrigins = config.corsOrigins;
app.use(cors({
  credentials: true,
  origin: allowedOrigins.length ? allowedOrigins : true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.use('/api', auth.authenticate);
app.use('/api/reviews', reviewsRouter);
app.use('/api/apps', appsRouter);
app.use('/api', analyticsRouter);
app.use('/api', syncRouter);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: config.isProd ? 'Internal server error' : err.message });
});

const server = app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
});

function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    try { require('./lib/db').close(); } catch (e) {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
