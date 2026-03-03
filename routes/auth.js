const express = require('express');
const config = require('../config');
const db = require('../lib/db');
const auth = require('../lib/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const result = auth.login(username, password);

  if (!result.success) {
    return res.status(401).json({ error: result.error });
  }

  res.cookie('token', result.token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({
    success: true,
    user: result.user,
    requirePasswordChange: result.requirePasswordChange || false
  });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

router.get('/check', (req, res) => {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.json({ authenticated: false });
  }

  const decoded = auth.verifyToken(token);
  if (!decoded) {
    return res.json({ authenticated: false });
  }

  const user = db.prepare('SELECT id, username, email, role, password FROM users WHERE id = ?').get(decoded.id);
  if (!user) {
    return res.json({ authenticated: false });
  }

  const requirePasswordChange = auth.requiresPasswordChange(user.password);
  res.json({
    authenticated: true,
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
    requirePasswordChange
  });
});

router.post('/change-password', auth.authenticate, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const result = auth.changePassword(req.user.id, currentPassword, newPassword);

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true, message: 'Password changed successfully' });
});

module.exports = router;
