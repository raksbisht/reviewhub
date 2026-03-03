const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('./db');

if (config.isProd && (!config.jwt.secret || config.jwt.secret.length < 32)) {
  console.error('Fatal: JWT_SECRET must be set and at least 32 characters in production.');
  process.exit(1);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (error) {
    return null;
  }
}

function authenticate(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(decoded.id);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  req.user = user;
  next();
}

function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user) {
    return { success: false, error: 'Invalid credentials' };
  }

  const validPassword = bcrypt.compareSync(password, user.password);
  if (!validPassword) {
    return { success: false, error: 'Invalid credentials' };
  }

  db.prepare('UPDATE users SET lastLogin = ? WHERE id = ?')
    .run(new Date().toISOString(), user.id);

  const token = generateToken(user);

  return {
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    },
    requirePasswordChange: requiresPasswordChange(user.password)
  };
}

function changePassword(userId, currentPassword, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  if (!user) {
    return { success: false, error: 'User not found' };
  }

  const validPassword = bcrypt.compareSync(currentPassword, user.password);
  if (!validPassword) {
    return { success: false, error: 'Current password is incorrect' };
  }

  const hashedPassword = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, userId);

  return { success: true };
}

function requiresPasswordChange(passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compareSync(config.admin.initialPassword, passwordHash);
}

module.exports = {
  authenticate,
  login,
  changePassword,
  generateToken,
  verifyToken,
  requiresPasswordChange
};
