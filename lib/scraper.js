const db = require('./db');
const { analyzeReview } = require('./sentiment');

let gplayModule = null;
let appStoreModule = null;

async function getGplay() {
  if (!gplayModule) gplayModule = (await import('google-play-scraper')).default;
  return gplayModule;
}

async function getAppStore() {
  if (!appStoreModule) appStoreModule = (await import('app-store-scraper')).default;
  return appStoreModule;
}

const syncStatus = new Map();

function detectPlatform(url) {
  if (url.includes('play.google.com')) return 'android';
  if (url.includes('apps.apple.com') || url.includes('itunes.apple.com')) return 'ios';
  return null;
}

function extractAppIdFromUrl(url) {
  const platform = detectPlatform(url);

  if (platform === 'android') {
    const match = url.match(/id=([^&]+)/);
    return match ? { appId: match[1], platform } : null;
  }

  if (platform === 'ios') {
    const match = url.match(/\/id(\d+)/);
    return match ? { appId: match[1], platform } : null;
  }

  return null;
}

function getSyncStatus(appId) {
  return syncStatus.get(appId) || { status: 'idle', progress: 0, total: 0, message: '' };
}

function getAllSyncStatus() {
  const result = {};
  syncStatus.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

async function scrapeAndroidReviews(appId, onProgress) {
  const gplay = await getGplay();
  const reviewsMap = new Map();
  const maxPagesPerSort = 100;

  const appInfo = await gplay.app({ appId });
  const estimatedTotal = appInfo.reviews || 0;

  const sortMethods = [
    { sort: gplay.sort.NEWEST, name: 'newest' },
    { sort: gplay.sort.RATING, name: 'rating' },
    { sort: gplay.sort.HELPFULNESS, name: 'helpful' }
  ];

  for (const sortMethod of sortMethods) {
    let nextToken = null;
    let pageCount = 0;

    syncStatus.set(appId, {
      status: 'syncing',
      progress: reviewsMap.size,
      total: estimatedTotal,
      message: `Fetching ${sortMethod.name} reviews (${reviewsMap.size} unique so far)...`,
      startedAt: syncStatus.get(appId)?.startedAt || new Date().toISOString()
    });

    while (pageCount < maxPagesPerSort) {
      const result = await gplay.reviews({
        appId: appId,
        sort: sortMethod.sort,
        num: 150,
        paginate: true,
        nextPaginationToken: nextToken
      });

      if (!result.data || result.data.length === 0) break;

      for (const review of result.data) {
        if (!reviewsMap.has(review.id)) {
          reviewsMap.set(review.id, {
            id: review.id,
            userName: review.userName,
            userImage: review.userImage,
            date: review.date,
            score: review.score,
            scoreText: review.scoreText,
            url: review.url,
            title: review.title,
            text: review.text,
            replyDate: review.replyDate,
            replyText: review.replyText,
            version: review.version,
            thumbsUp: review.thumbsUp,
            criterias: review.criterias
          });
        }
      }

      pageCount++;
      nextToken = result.nextPaginationToken;

      syncStatus.set(appId, {
        status: 'syncing',
        progress: reviewsMap.size,
        total: estimatedTotal,
        message: `Fetching ${sortMethod.name} reviews (${reviewsMap.size} unique, page ${pageCount})...`,
        startedAt: syncStatus.get(appId)?.startedAt
      });

      if (onProgress) onProgress(reviewsMap.size, estimatedTotal);
      if (!nextToken) break;

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return Array.from(reviewsMap.values());
}

async function scrapeIOSReviews(appId, onProgress) {
  const reviewsMap = new Map();
  const maxPages = 10;

  syncStatus.set(appId, {
    status: 'syncing',
    progress: 0,
    total: 0,
    message: 'Fetching iOS reviews...',
    startedAt: syncStatus.get(appId)?.startedAt || new Date().toISOString()
  });

  try {
    const appStore = await getAppStore();
    const sortMethods = [
      { sort: appStore.sort.RECENT, name: 'recent' },
      { sort: appStore.sort.HELPFUL, name: 'helpful' }
    ];

    for (const sortMethod of sortMethods) {
      for (let page = 1; page <= maxPages; page++) {
        try {
          const reviews = await appStore.reviews({
            id: appId,
            sort: sortMethod.sort,
            page: page,
            country: 'us'
          });

          if (!reviews || reviews.length === 0) break;

          for (const review of reviews) {
            const reviewId = `ios_${review.id}`;
            if (!reviewsMap.has(reviewId)) {
              reviewsMap.set(reviewId, {
                id: reviewId,
                userName: review.userName,
                userImage: null,
                date: review.updated,
                score: review.score,
                scoreText: `${review.score}/5`,
                url: review.url,
                title: review.title,
                text: review.text,
                replyDate: null,
                replyText: null,
                version: review.version,
                thumbsUp: review.voteSum || 0,
                criterias: []
              });
            }
          }

          syncStatus.set(appId, {
            status: 'syncing',
            progress: reviewsMap.size,
            total: reviewsMap.size,
            message: `Fetching ${sortMethod.name} reviews (${reviewsMap.size} found, page ${page})...`,
            startedAt: syncStatus.get(appId)?.startedAt
          });

          if (onProgress) onProgress(reviewsMap.size, reviewsMap.size);

          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (pageError) {
          break;
        }
      }
    }
  } catch (error) {
    console.error('iOS reviews error:', error);
  }

  return Array.from(reviewsMap.values());
}

async function scrapeAllReviews(appId, platform = 'android', onProgress) {
  syncStatus.set(appId, {
    status: 'syncing',
    progress: 0,
    total: 0,
    message: 'Starting sync...',
    startedAt: new Date().toISOString()
  });

  try {
    let allReviews;

    if (platform === 'ios') {
      allReviews = await scrapeIOSReviews(appId, onProgress);
    } else {
      allReviews = await scrapeAndroidReviews(appId, onProgress);
    }

    syncStatus.set(appId, {
      status: 'saving',
      progress: allReviews.length,
      total: allReviews.length,
      message: `Analyzing sentiment and saving ${allReviews.length} reviews...`,
      startedAt: syncStatus.get(appId).startedAt
    });

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO reviews
      (id, appId, userName, userImage, date, score, scoreText, url, title, text, replyDate, replyText, version, thumbsUp, criterias, sentiment, sentimentScore, emotions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const batchSize = 500;
    for (let i = 0; i < allReviews.length; i += batchSize) {
      const batch = allReviews.slice(i, i + batchSize);
      const insertBatch = db.transaction((reviews) => {
        for (const review of reviews) {
          const sentimentData = analyzeReview(review.text, review.score);
          insertStmt.run(
            review.id,
            appId,
            review.userName,
            review.userImage,
            review.date ? new Date(review.date).toISOString() : null,
            review.score,
            review.scoreText,
            review.url,
            review.title,
            review.text,
            review.replyDate ? new Date(review.replyDate).toISOString() : null,
            review.replyText,
            review.version,
            review.thumbsUp,
            JSON.stringify(review.criterias || []),
            sentimentData.sentiment,
            sentimentData.sentimentScore,
            JSON.stringify(sentimentData.emotions)
          );
        }
      });
      insertBatch(batch);
    }

    db.prepare('UPDATE apps SET lastScrape = ? WHERE appId = ?')
      .run(new Date().toISOString(), appId);

    syncStatus.set(appId, {
      status: 'completed',
      progress: allReviews.length,
      total: allReviews.length,
      message: `Synced ${allReviews.length} reviews successfully`,
      completedAt: new Date().toISOString(),
      startedAt: syncStatus.get(appId).startedAt
    });

    return allReviews.length;
  } catch (error) {
    console.error('Scrape error:', error);
    syncStatus.set(appId, {
      status: 'error',
      progress: 0,
      total: 0,
      message: `Error: ${error.message}`,
      error: error.message
    });
    throw error;
  }
}

async function scrapeReviews(appId, platform = 'android') {
  return scrapeAllReviews(appId, platform);
}

async function scrapeInBackground(appId, platform = 'android') {
  scrapeAllReviews(appId, platform).catch(err => {
    console.error(`Background sync failed for ${appId}:`, err);
  });
  return { started: true, appId, platform };
}

async function getAppInfo(appId, platform = 'android') {
  try {
    if (platform === 'ios') {
      const appStore = await getAppStore();
      const info = await appStore.app({ id: appId, country: 'us' });

      db.prepare(`
        UPDATE apps SET name = ?, icon = ?, developer = ? WHERE appId = ?
      `).run(info.title, info.icon, info.developer, appId);

      return {
        title: info.title,
        description: info.description?.substring(0, 200),
        score: info.score,
        ratings: info.ratings,
        reviews: info.reviews,
        installs: null,
        developer: info.developer,
        icon: info.icon,
        updated: info.updated,
        version: info.version,
        platform: 'ios'
      };
    } else {
      const gplay = await getGplay();
      const info = await gplay.app({ appId: appId });

      db.prepare(`
        UPDATE apps SET name = ?, icon = ?, developer = ? WHERE appId = ?
      `).run(info.title, info.icon, info.developer, appId);

      return {
        title: info.title,
        description: info.summary,
        score: info.score,
        ratings: info.ratings,
        reviews: info.reviews,
        installs: info.installs,
        developer: info.developer,
        icon: info.icon,
        updated: info.updated,
        version: info.version,
        platform: 'android'
      };
    }
  } catch (error) {
    console.error('App info error:', error);
    throw error;
  }
}

async function addApp(storeUrl, productId = null) {
  const extracted = extractAppIdFromUrl(storeUrl);
  if (!extracted) {
    throw new Error('Invalid App Store or Play Store URL');
  }

  const { appId, platform } = extracted;

  const existing = db.prepare('SELECT * FROM apps WHERE appId = ?').get(appId);
  if (existing) {
    throw new Error('App already exists');
  }

  let info;
  if (platform === 'ios') {
    const appStore = await getAppStore();
    info = await appStore.app({ id: appId, country: 'us' });
  } else {
    const gplay = await getGplay();
    info = await gplay.app({ appId: appId });
  }

  db.prepare(`
    INSERT INTO apps (appId, name, platform, icon, developer, playStoreUrl, productId)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(appId, info.title, platform, info.icon, info.developer, storeUrl, productId);

  scrapeInBackground(appId, platform);

  return {
    appId,
    name: info.title,
    icon: info.icon,
    developer: info.developer,
    platform,
    productId,
    syncStarted: true
  };
}

async function addAppProduct({ androidUrl = null, iosUrl = null }) {
  const trimmedAndroid = (androidUrl && typeof androidUrl === 'string') ? androidUrl.trim() : null;
  const trimmedIos = (iosUrl && typeof iosUrl === 'string') ? iosUrl.trim() : null;
  if (!trimmedAndroid && !trimmedIos) {
    throw new Error('Provide at least one URL (Android and/or iOS).');
  }
  const productId = `product_${Date.now()}`;
  const added = [];
  const errors = [];
  if (trimmedAndroid) {
    try {
      const app = await addApp(trimmedAndroid, productId);
      added.push(app);
    } catch (e) {
      errors.push({ platform: 'android', error: e.message });
    }
  }
  if (trimmedIos) {
    try {
      const app = await addApp(trimmedIos, productId);
      added.push(app);
    } catch (e) {
      errors.push({ platform: 'ios', error: e.message });
    }
  }
  if (added.length === 0) {
    const msg = errors.map((e) => `${e.platform}: ${e.error}`).join('; ');
    throw new Error(msg || 'Failed to add app(s).');
  }
  return { productId, apps: added, errors: errors.length ? errors : undefined };
}

function analyzeExistingReviews(appId = null) {
  let reviews;
  if (appId) {
    reviews = db.prepare('SELECT id, text, score FROM reviews WHERE appId = ? AND sentiment IS NULL').all(appId);
  } else {
    reviews = db.prepare('SELECT id, text, score FROM reviews WHERE sentiment IS NULL').all();
  }

  if (reviews.length === 0) return 0;

  const updateStmt = db.prepare(`
    UPDATE reviews SET sentiment = ?, sentimentScore = ?, emotions = ? WHERE id = ?
  `);

  const updateBatch = db.transaction((reviewsToUpdate) => {
    for (const review of reviewsToUpdate) {
      const sentimentData = analyzeReview(review.text, review.score);
      updateStmt.run(
        sentimentData.sentiment,
        sentimentData.sentimentScore,
        JSON.stringify(sentimentData.emotions),
        review.id
      );
    }
  });

  updateBatch(reviews);
  return reviews.length;
}

function clearSyncStatus(appId) {
  syncStatus.delete(appId);
}

module.exports = {
  scrapeReviews,
  scrapeAllReviews,
  scrapeInBackground,
  getAppInfo,
  addApp,
  addAppProduct,
  extractAppIdFromUrl,
  detectPlatform,
  getSyncStatus,
  getAllSyncStatus,
  clearSyncStatus,
  analyzeExistingReviews
};
