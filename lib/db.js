const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('../config');

const dbPath = config.database.path;
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
}

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'admin',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    lastLogin TEXT
  )
`);

const usersExist = db.prepare('SELECT COUNT(*) as count FROM users').get();
if (usersExist.count === 0) {
  const username = config.admin.initialUsername;
  const initialPassword = config.admin.initialPassword;
  const hashedPassword = bcrypt.hashSync(initialPassword, 10);
  const email = `${username}@reviewhub.local`;
  db.prepare(`
    INSERT INTO users (username, password, email, role)
    VALUES (?, ?, ?, 'admin')
  `).run(username, hashedPassword, email);
  console.log(`Initial admin user created. Sign in with username=${username} and the initial password; you will be asked to set a new password.`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appId TEXT UNIQUE NOT NULL,
    name TEXT,
    platform TEXT DEFAULT 'android',
    icon TEXT,
    developer TEXT,
    playStoreUrl TEXT,
    lastScrape TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    appId TEXT NOT NULL,
    userName TEXT,
    userImage TEXT,
    date TEXT,
    score INTEGER,
    scoreText TEXT,
    url TEXT,
    title TEXT,
    text TEXT,
    replyDate TEXT,
    replyText TEXT,
    version TEXT,
    thumbsUp INTEGER,
    criterias TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appId) REFERENCES apps(appId)
  )
`);

try {
  db.exec(`ALTER TABLE reviews ADD COLUMN sentiment TEXT`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE reviews ADD COLUMN sentimentScore REAL`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE reviews ADD COLUMN emotions TEXT`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE apps ADD COLUMN productId TEXT`);
} catch (e) {}

module.exports = db;
