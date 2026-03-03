<p align="center">
  <img src="public/images/logo.png" alt="ReviewHub" width="420">
</p>

<p align="center">
  One place to track <strong>your and your competitors'</strong> <strong>Android</strong> (Google Play) and <strong>iOS</strong> (App Store) app reviews.<br>
  Self-hosted dashboard for ratings, sentiment, and trends with optional auth.
</p>

---

## Features

- **Multi-store**: Add apps from Google Play and the App Store by URL
- **Dashboard**: Total reviews, average rating, sentiment breakdown, response rate
- **Charts**: Rating distribution, trends over time, sentiment and emotion analysis
- **Reviews**: Search, filter by rating/sentiment/emotion, sort, paginate
- **Export**: Download reviews as CSV
- **Sync**: Fetch latest reviews on demand or in the background
- **Auth**: Optional login (JWT) to protect the dashboard

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: SQLite (better-sqlite3)
- **Frontend**: Vanilla JS, Chart.js
- **Scraping**: google-play-scraper, app-store-scraper
- **Sentiment**: sentiment + custom emotion keywords

## Installation

```bash
git clone https://github.com/raksbisht/reviewhub.git
cd reviewhub
npm install
```

## Configuration

Copy the example env and adjust:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: `3000`) |
| `NODE_ENV` | `development` or `production` |
| `JWT_SECRET` | **Required in production.** Min 32 characters. |
| `JWT_EXPIRES_IN` | Token expiry (default: `7d`) |
| `ADMIN_INITIAL_USERNAME` | Optional. First-time admin username (default: `admin`). |
| `ADMIN_INITIAL_PASSWORD` | Optional. First-time admin password (default: `admin123`). User must change it after first login. |
| `DATABASE_PATH` | Optional. Path to SQLite file (default: `./data/reviews.db`). |
| `ALLOWED_ORIGINS` | Optional. Comma-separated CORS origins (default: allow all in dev). |
| `CSV_EXPORT_LIMIT` | Optional. Max rows in CSV export (default: `50000`). |

**First run:** If no users exist, an initial admin is created:

- Username: `admin` (or `ADMIN_INITIAL_USERNAME`)  
- Password: `admin123` (or `ADMIN_INITIAL_PASSWORD`)

This same first-time password is used in both development and production. **After first login, the user is required to set a new password** before continuing.


**Production:** Set `NODE_ENV=production` and a long, random `JWT_SECRET`.

**Database security:** The app stores SQLite in `data/reviews.db` by default (created on first run). The `data/` directory is not served by the app, and requests for `.db` files or `/data/` are blocked. Keep `DATABASE_PATH` outside any web-served directory. If you have an existing `reviews.db` in the project root, set `DATABASE_PATH=./reviews.db` or move it to `data/reviews.db`.

## Usage

```bash
npm start
```

Open http://localhost:3000 (or your `PORT`). Sign in, then add apps via their store URLs and use “Sync” to fetch reviews.

## API (protected by auth except login/check/logout)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login (body: `username`, `password`) |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/check` | Current session |
| GET | `/api/apps` | List apps with review counts |
| POST | `/api/apps` | Add app (body: `playStoreUrl`) |
| DELETE | `/api/apps/:appId` | Remove app and its reviews |
| GET | `/api/reviews` | List reviews (query: page, limit, appId, score, search, sort, order, sentiment, emotion, hasReply) |
| GET | `/api/reviews/export/csv` | Export CSV (query: appId) |
| GET | `/api/analytics` | Dashboard analytics (query: appId) |
| POST | `/api/analyze-sentiment` | Re-run sentiment on reviews (body: appId) |
| GET | `/api/sync-status` | Sync status (query: appId) |
| POST | `/api/sync` | Start sync for one app (body: appId) |
| POST | `/api/sync-all` | Start sync for all apps |
| GET | `/api/app-info/:appId` | App metadata from store |
| GET | `/api/platform-stats` | Aggregates by Android/iOS |

## Project structure

```
├── server.js              # Entry point: Express app, config, routes
├── config/
│   └── index.js           # Env-based config (port, jwt, db path, etc.)
├── lib/                   # Core logic (no HTTP)
│   ├── db.js              # SQLite schema and seed
│   ├── auth.js            # JWT, login, change-password
│   ├── scraper.js         # Play Store / App Store fetch and sync
│   └── sentiment.js       # Sentiment and emotion analysis
├── routes/
│   ├── index.js           # Re-exports all routers and auth
│   ├── auth.js
│   ├── reviews.js
│   ├── apps.js
│   ├── analytics.js
│   └── sync.js
├── public/
│   ├── index.html
│   ├── login.html
│   ├── app.js
│   └── styles.css
├── .env.example
└── README.md
```

## License

MIT — see [LICENSE](LICENSE).
