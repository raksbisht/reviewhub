const auth = require('../lib/auth');
const authRouter = require('./auth');
const reviewsRouter = require('./reviews');
const appsRouter = require('./apps');
const analyticsRouter = require('./analytics');
const syncRouter = require('./sync');

module.exports = {
  auth,
  authRouter,
  reviewsRouter,
  appsRouter,
  analyticsRouter,
  syncRouter,
};
