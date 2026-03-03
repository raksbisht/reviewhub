const express = require('express');
const db = require('../lib/db');
const scraper = require('../lib/scraper');

const router = express.Router();

router.get('/sync-status', (req, res) => {
  try {
    const { appId } = req.query;
    if (appId) {
      res.json(scraper.getSyncStatus(appId));
    } else {
      res.json(scraper.getAllSyncStatus());
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const { appId } = req.body;
    if (!appId) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const currentStatus = scraper.getSyncStatus(appId);
    if (currentStatus.status === 'syncing') {
      return res.json({ success: false, message: 'Sync already in progress', status: currentStatus });
    }

    const app = db.prepare('SELECT platform FROM apps WHERE appId = ?').get(appId);
    scraper.scrapeInBackground(appId, app?.platform || 'android');
    res.json({ success: true, message: 'Background sync started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/sync-all', async (req, res) => {
  try {
    const apps = db.prepare('SELECT appId, platform FROM apps').all();
    let startedCount = 0;

    for (const app of apps) {
      const currentStatus = scraper.getSyncStatus(app.appId);
      if (currentStatus.status !== 'syncing') {
        scraper.scrapeInBackground(app.appId, app.platform || 'android');
        startedCount++;
      }
    }

    res.json({ success: true, message: `Started sync for ${startedCount} apps` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/scrape', async (req, res) => {
  try {
    const { appId, background } = req.body;
    if (!appId) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const app = db.prepare('SELECT platform FROM apps WHERE appId = ?').get(appId);
    const platform = app?.platform || 'android';

    if (background) {
      scraper.scrapeInBackground(appId, platform);
      res.json({ success: true, message: 'Background sync started' });
    } else {
      const count = await scraper.scrapeReviews(appId, platform);
      res.json({ success: true, message: `Scraped ${count} reviews` });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/scrape-all', async (req, res) => {
  try {
    const { background } = req.body;
    const apps = db.prepare('SELECT appId, platform FROM apps').all();

    if (background) {
      for (const app of apps) {
        scraper.scrapeInBackground(app.appId, app.platform || 'android');
      }
      res.json({ success: true, message: `Started background sync for ${apps.length} apps` });
    } else {
      let totalCount = 0;
      for (const app of apps) {
        const count = await scraper.scrapeReviews(app.appId, app.platform || 'android');
        totalCount += count;
      }
      res.json({ success: true, message: `Scraped ${totalCount} reviews from ${apps.length} apps` });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
