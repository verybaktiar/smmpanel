'use strict';

// Security middleware untuk API protection
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');

/**
 * Setup security middleware untuk Express app
 * @param {object} app - Express app instance
 */
function setupSecurity(app) {
  // Helmet untuk security headers
  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
  }));

  // CORS configuration
  const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
  const corsOptions = {
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: allowedOrigin !== '*',
  };
  app.use(cors(corsOptions));

  // Mode lokal: DISABLE_RATE_LIMIT=1 mematikan semua limiter (jangan dipakai di VPS publik)
  if (process.env.DISABLE_RATE_LIMIT === '1') {
    console.log('  [security] rate limit DIMATIKAN (DISABLE_RATE_LIMIT=1)');
    return { strictLimiter: (req, res, next) => next() };
  }

  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.API_RATE_LIMIT || 300),
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    // Farm monitor polling intensif (tiap 3 dtk) — punya limiter sendiri
    skip: (req) => req.path.startsWith('/farm/'),
  });
  app.use('/api/', globalLimiter);

  const farmLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.FARM_RATE_LIMIT || 1500),
    message: { error: 'Farm polling terlalu cepat' },
    standardHeaders: false,
    legacyHeaders: false,
  });
  app.use('/api/farm/', farmLimiter);

  const strictLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: Number(process.env.SENSITIVE_RATE_LIMIT || 30),
    message: { error: 'Too many requests to sensitive endpoint' },
  });

  return { strictLimiter };
}

/**
 * API Key authentication middleware
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Next middleware
 */
function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const validApiKey = process.env.API_KEY;

  // Jika API_KEY tidak di-set di .env, skip validation (development mode)
  if (!validApiKey) {
    console.warn('  [security] API_KEY not set in .env, skipping validation');
    return next();
  }

  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  next();
}

/**
 * Optional API key middleware (hanya warning jika tidak ada)
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Next middleware
 */
function optionalApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const validApiKey = process.env.API_KEY;

  if (validApiKey && apiKey !== validApiKey) {
    console.warn('  [security] Invalid API key attempted');
  }

  req.authenticated = (apiKey === validApiKey);
  next();
}

module.exports = {
  setupSecurity,
  requireApiKey,
  optionalApiKey,
};
