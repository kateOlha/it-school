const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { permissionsForRole, hasPermission } = require('../services/rbac');
const { buildCabinet } = require('../services/cabinet');

const router = express.Router();

function publicUser(row) {
  const permissions = permissionsForRole(row.role);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    grade: row.grade,
    avatar: row.avatar,
    active: row.active !== 0,
    created_at: row.created_at,
    permissions,
    flags: {
      office: hasPermission(row.role, 'office.access'),
      admin: hasPermission(row.role, 'admin.users', 'admin.roles'),
      content: hasPermission(row.role, 'content.teach', 'content.builder'),
      diary: hasPermission(row.role, 'diary.access'),
      diaryManage: hasPermission(row.role, 'diary.manage'),
      parent: hasPermission(row.role, 'parent.portal'),
      student: hasPermission(row.role, 'student.learn'),
      search: hasPermission(row.role, 'search.access'),
      messages: hasPermission(row.role, 'messages.access'),
      portfolio: hasPermission(row.role, 'portfolio.access'),
      documents: hasPermission(row.role, 'documents.access'),
      marketing: hasPermission(row.role, 'marketing.landings'),
    },
  };
}

router.get('/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || user.active === 0) {
    return res.status(403).json({ error: 'Аккаунт недоступен' });
  }
  res.json(buildCabinet(user));
});

router.patch('/profile', authRequired, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || user.active === 0) {
    return res.status(403).json({ error: 'Аккаунт недоступен' });
  }

  const name = req.body?.name != null ? String(req.body.name).trim() : null;
  const avatar = req.body?.avatar != null ? String(req.body.avatar).trim() : null;
  const password = req.body?.password != null ? String(req.body.password) : null;

  if (name !== null) {
    if (name.length < 2) return res.status(400).json({ error: 'Укажите имя' });
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
    db.prepare(
      `UPDATE contacts SET name = ? WHERE user_id = ? AND type IN ('student','parent')`
    ).run(name, user.id);
  }
  if (avatar !== null) {
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, user.id);
  }
  if (password) {
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль не короче 6 символов' });
    }
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({
    user: publicUser(updated),
    cabinet: buildCabinet(updated),
  });
});

module.exports = router;
