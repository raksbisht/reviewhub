const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const config = require('../config');

function escapeLike(str) {
  return str.replace(/[%_\\]/g, '\\$&');
}

router.get('/', (req, res) => {
  try {
    const { score, search, sort = 'date', order = 'DESC', appId, sentiment, emotion, hasReply } = req.query;
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 20;
    if (page < 1) page = 1;
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params = [];

    if (appId) {
      whereClause += ' AND r.appId = ?';
      params.push(String(appId));
    }

    if (score) {
      const s = parseInt(score);
      if (s >= 1 && s <= 5) {
        whereClause += ' AND r.score = ?';
        params.push(s);
      }
    }

    const validSentiments = ['positive', 'neutral', 'negative'];
    if (sentiment && validSentiments.includes(sentiment)) {
      whereClause += ' AND r.sentiment = ?';
      params.push(sentiment);
    }

    const validEmotions = ['happy', 'satisfied', 'frustrated', 'disappointed', 'confused'];
    if (emotion && validEmotions.includes(emotion)) {
      whereClause += " AND r.emotions LIKE ? ESCAPE '\\'";
      params.push(`%"${escapeLike(emotion)}"%`);
    }

    if (hasReply === 'replied') {
      whereClause += " AND r.replyText IS NOT NULL AND r.replyText != ''";
    } else if (hasReply === 'no-reply') {
      whereClause += " AND (r.replyText IS NULL OR r.replyText = '')";
    }

    if (search && typeof search === 'string' && search.trim()) {
      whereClause += " AND (r.text LIKE ? ESCAPE '\\' OR r.userName LIKE ? ESCAPE '\\')";
      const term = `%${escapeLike(search.trim())}%`;
      params.push(term, term);
    }

    const validSorts = { date: 'r.date', score: 'r.score', thumbsUp: 'r.thumbsUp', userName: 'r.userName' };
    const sortColumn = validSorts[sort] || 'r.date';
    const sortOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const total = db.prepare(`SELECT COUNT(*) as total FROM reviews r WHERE ${whereClause}`).get(...params).total;

    const reviews = db.prepare(`
      SELECT r.*, a.name as appName, a.icon as appIcon
      FROM reviews r
      LEFT JOIN apps a ON r.appId = a.appId
      WHERE ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      reviews,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/export/csv', (req, res) => {
  try {
    const { appId } = req.query;
    let query = `
      SELECT r.*, a.name as appName 
      FROM reviews r 
      LEFT JOIN apps a ON r.appId = a.appId
    `;
    const params = [];

    if (appId) {
      query += ' WHERE r.appId = ?';
      params.push(String(appId));
    }
    query += ` ORDER BY r.date DESC LIMIT ?`;
    params.push(config.csvExportLimit);

    const reviews = db.prepare(query).all(...params);

    const headers = ['App', 'ID', 'User', 'Date', 'Score', 'Title', 'Review', 'Version', 'Thumbs Up'];
    const csvRows = [headers.join(',')];

    reviews.forEach(r => {
      const row = [
        `"${(r.appName || '').replace(/"/g, '""')}"`,
        r.id,
        `"${(r.userName || '').replace(/"/g, '""')}"`,
        r.date,
        r.score,
        `"${(r.title || '').replace(/"/g, '""')}"`,
        `"${(r.text || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
        r.version,
        r.thumbsUp
      ];
      csvRows.push(row.join(','));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=reviews.csv');
    res.send(csvRows.join('\n'));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    res.json(review);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
