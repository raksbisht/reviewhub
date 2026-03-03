const express = require('express');
const db = require('../lib/db');
const scraper = require('../lib/scraper');
const { clearSyncStatus } = scraper;

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const apps = db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM reviews r WHERE r.appId = a.appId) as reviewCount
      FROM apps a
      ORDER BY a.createdAt DESC
    `).all();

    const appsWithStatus = apps.map((app) => ({
      ...app,
      syncStatus: scraper.getSyncStatus(app.appId),
    }));

    res.json(appsWithStatus);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { playStoreUrl } = req.body;
    if (!playStoreUrl || typeof playStoreUrl !== 'string' || !playStoreUrl.trim()) {
      return res.status(400).json({ error: 'Store URL is required (Google Play or App Store)' });
    }
    const newApp = await scraper.addApp(playStoreUrl.trim());
    res.json({ success: true, app: newApp, message: 'App added. Background sync started.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:appId', (req, res) => {
  try {
    const { appId } = req.params;
    db.prepare('DELETE FROM reviews WHERE appId = ?').run(appId);
    const result = db.prepare('DELETE FROM apps WHERE appId = ?').run(appId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'App not found' });
    }
    if (clearSyncStatus) clearSyncStatus(appId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
