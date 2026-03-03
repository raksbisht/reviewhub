const express = require('express');
const db = require('../lib/db');
const scraper = require('../lib/scraper');

const router = express.Router();

router.get('/analytics', (req, res) => {
  try {
    const { appId } = req.query;
    const whereClause = appId ? 'WHERE appId = ?' : '';
    const params = appId ? [appId] : [];

    const totalReviews = db.prepare(`SELECT COUNT(*) as count FROM reviews ${whereClause}`).get(...params);
    const avgRating = db.prepare(`SELECT AVG(score) as avg FROM reviews ${whereClause}`).get(...params);
    const ratingDistribution = db.prepare(`
      SELECT score, COUNT(*) as count
      FROM reviews
      ${whereClause}
      GROUP BY score
      ORDER BY score DESC
    `).all(...params);

    const reviewsByMonth = db.prepare(`
      SELECT
        strftime('%Y-%m', date) as month,
        COUNT(*) as count,
        AVG(score) as avgRating
      FROM reviews
      ${whereClause}
      GROUP BY strftime('%Y-%m', date)
      ORDER BY month DESC
      LIMIT 12
    `).all(...params);

    const recentReviews = db.prepare(`
      SELECT r.*, a.name as appName, a.icon as appIcon
      FROM reviews r
      LEFT JOIN apps a ON r.appId = a.appId
      ${whereClause ? whereClause.replace('WHERE', 'WHERE r.') : ''}
      ORDER BY r.date DESC
      LIMIT 10
    `).all(...params);

    const sentimentBreakdown = db.prepare(`
      SELECT
        COALESCE(sentiment,
          CASE
            WHEN score >= 4 THEN 'positive'
            WHEN score = 3 THEN 'neutral'
            ELSE 'negative'
          END
        ) as sentiment,
        COUNT(*) as count
      FROM reviews
      ${whereClause}
      GROUP BY sentiment
    `).all(...params);

    const emotionWhereClause = whereClause ? `${whereClause} AND emotions IS NOT NULL` : 'WHERE emotions IS NOT NULL';
    const emotionStats = db.prepare(`
      SELECT emotions FROM reviews ${emotionWhereClause}
    `).all(...params);

    const emotionCounts = {};
    emotionStats.forEach((row) => {
      try {
        const emotions = JSON.parse(row.emotions || '[]');
        emotions.forEach((e) => {
          emotionCounts[e.emotion] = (emotionCounts[e.emotion] || 0) + 1;
        });
      } catch (err) {}
    });

    const responseStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN replyText IS NOT NULL AND replyText != '' THEN 1 ELSE 0 END) as replied,
        AVG(CASE
          WHEN replyDate IS NOT NULL AND date IS NOT NULL
          THEN julianday(replyDate) - julianday(date)
          ELSE NULL
        END) as avgResponseDays
      FROM reviews
      ${whereClause}
    `).get(...params);

    const responseByRating = db.prepare(`
      SELECT
        score,
        COUNT(*) as total,
        SUM(CASE WHEN replyText IS NOT NULL AND replyText != '' THEN 1 ELSE 0 END) as replied
      FROM reviews
      ${whereClause}
      GROUP BY score
      ORDER BY score DESC
    `).all(...params);

    res.json({
      totalReviews: totalReviews.count,
      averageRating: avgRating.avg ? avgRating.avg.toFixed(2) : 0,
      ratingDistribution,
      reviewsByMonth: reviewsByMonth.reverse(),
      recentReviews,
      sentimentBreakdown,
      emotionBreakdown: Object.entries(emotionCounts)
        .map(([emotion, count]) => ({ emotion, count }))
        .sort((a, b) => b.count - a.count),
      responseMetrics: {
        totalReviews: responseStats.total,
        repliedReviews: responseStats.replied,
        responseRate: responseStats.total > 0
          ? ((responseStats.replied / responseStats.total) * 100).toFixed(1)
          : 0,
        avgResponseDays: responseStats.avgResponseDays
          ? responseStats.avgResponseDays.toFixed(1)
          : null,
        byRating: responseByRating.map((r) => ({
          score: r.score,
          total: r.total,
          replied: r.replied,
          rate: r.total > 0 ? ((r.replied / r.total) * 100).toFixed(1) : 0,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/analyze-sentiment', (req, res) => {
  try {
    const { appId } = req.body;
    const count = scraper.analyzeExistingReviews(appId);
    res.json({ success: true, message: `Analyzed sentiment for ${count} reviews` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/app-info/:appId', async (req, res) => {
  try {
    const { appId } = req.params;
    const app = db.prepare('SELECT platform FROM apps WHERE appId = ?').get(appId);
    const info = await scraper.getAppInfo(appId, app?.platform || 'android');
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/platform-stats', (req, res) => {
  try {
    const platforms = ['android', 'ios'];
    const stats = {};

    for (const platform of platforms) {
      const appCount = db.prepare(`
        SELECT COUNT(*) as count FROM apps WHERE platform = ?
      `).get(platform);

      const reviewStats = db.prepare(`
        SELECT
          COUNT(*) as totalReviews,
          AVG(r.score) as avgRating,
          SUM(CASE WHEN r.sentiment = 'positive' THEN 1 ELSE 0 END) as positive,
          SUM(CASE WHEN r.sentiment = 'negative' THEN 1 ELSE 0 END) as negative
        FROM reviews r
        JOIN apps a ON r.appId = a.appId
        WHERE a.platform = ?
      `).get(platform);

      stats[platform] = {
        apps: appCount.count,
        reviews: reviewStats.totalReviews || 0,
        avgRating: reviewStats.avgRating ? reviewStats.avgRating.toFixed(2) : '0.00',
        positive: reviewStats.positive || 0,
        negative: reviewStats.negative || 0,
        positiveRate: reviewStats.totalReviews > 0
          ? ((reviewStats.positive / reviewStats.totalReviews) * 100).toFixed(1)
          : '0',
      };
    }

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
