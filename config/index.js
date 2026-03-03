const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

module.exports = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd,

  jwt: {
    secret: process.env.JWT_SECRET || (isProd ? null : 'dev-only-secret-change-in-production'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  admin: {
    /** Initial admin username (dev and prod). Override with ADMIN_INITIAL_USERNAME. */
    initialUsername: (process.env.ADMIN_INITIAL_USERNAME || 'admin').trim() || 'admin',
    /** Single first-time password for both dev and prod. User must change after first login. */
    initialPassword: process.env.ADMIN_INITIAL_PASSWORD || 'admin123',
  },

  database: {
    path: process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'reviews.db'),
  },

  corsOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : [],

  csvExportLimit: Number(process.env.CSV_EXPORT_LIMIT) || 50000,
};
