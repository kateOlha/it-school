const express = require('express');
const db = require('../db');
const { authRequired, requirePermission } = require('../middleware/auth');
const {
  canViewStudent,
  canEditSchoolDiary,
  listAccessibleStudents,
  ensureBook,
  syncAutoEntries,
  buildPayload,
  insertEntry,
} = require('../services/recordBook');

const router = express.Router();
const readers = [authRequired, requirePermission('diary.access')];
const staff = [authRequired, requirePermission('diary.manage')];

router.get('/students', ...readers, (req, res) => {
  const students = listAccessibleStudents(req.user).map((s) => {
    const book = db.prepare('SELECT id, book_number FROM record_books WHERE contact_id = ?').get(s.id);
    return { ...s, book_number: book?.book_number || null, has_book: !!book };
  });
  res.json({ students, canEdit: canEditSchoolDiary(req.user) });
});

router.get('/:contactId', ...readers, (req, res) => {
  const contactId = Number(req.params.contactId);
  if (!canViewStudent(req.user, contactId)) {
    return res.status(403).json({ error: 'Нет доступа к зачётной книжке этого ученика' });
  }
  const payload = buildPayload(contactId);
  if (!payload) return res.status(404).json({ error: 'Ученик не найден' });
  res.json({ ...payload, canEdit: canEditSchoolDiary(req.user) });
});

router.post('/:contactId/sync', ...staff, (req, res) => {
  const contactId = Number(req.params.contactId);
  if (!canViewStudent(req.user, contactId)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const book = ensureBook(contactId);
  if (!book) return res.status(404).json({ error: 'Ученик не найден' });
  syncAutoEntries(book.id, contactId);
  res.json(buildPayload(contactId));
});

router.patch('/:contactId', ...staff, (req, res) => {
  const contactId = Number(req.params.contactId);
  if (!canViewStudent(req.user, contactId)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const book = ensureBook(contactId);
  if (!book) return res.status(404).json({ error: 'Ученик не найден' });

  const fields = [
    'book_number',
    'org_founder',
    'org_name',
    'specialty',
    'study_form',
    'enrolled_order',
    'enrolled_at',
    'issued_at',
    'director_name',
    'course_year',
    'photo_url',
    'notes',
  ];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (req.body?.[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push(req.body[f]);
    }
  }
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    vals.push(book.id);
    db.prepare(`UPDATE record_books SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  res.json(buildPayload(contactId));
});

router.post('/:contactId/entries', ...staff, (req, res) => {
  const contactId = Number(req.params.contactId);
  if (!canViewStudent(req.user, contactId)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const book = ensureBook(contactId);
  if (!book) return res.status(404).json({ error: 'Ученик не найден' });

  const section = req.body?.section || 'credit';
  const allowed = new Set([
    'exam',
    'credit',
    'coursework',
    'practice',
    'gia',
    'state_exam',
    'demo_exam',
  ]);
  if (!allowed.has(section)) {
    return res.status(400).json({ error: 'Неверный раздел' });
  }

  insertEntry(book.id, {
    section,
    semester: req.body.semester != null ? Number(req.body.semester) : null,
    academic_year: req.body.academic_year || '',
    course_num: req.body.course_num != null ? Number(req.body.course_num) : null,
    subject: (req.body.subject || '').trim(),
    hours: req.body.hours || '',
    grade: req.body.grade || '',
    graded_at: req.body.graded_at || null,
    teacher_name: req.body.teacher_name || '',
    topic: req.body.topic || '',
    place: req.body.place || '',
    sort_order: Number(req.body.sort_order) || 0,
    source: 'manual',
    meta: req.body.meta || {},
  });
  res.status(201).json(buildPayload(contactId));
});

router.patch('/:contactId/entries/:entryId', ...staff, (req, res) => {
  const contactId = Number(req.params.contactId);
  const entryId = Number(req.params.entryId);
  if (!canViewStudent(req.user, contactId)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const book = ensureBook(contactId);
  if (!book) return res.status(404).json({ error: 'Ученик не найден' });

  const existing = db
    .prepare('SELECT * FROM record_book_entries WHERE id = ? AND book_id = ?')
    .get(entryId, book.id);
  if (!existing) return res.status(404).json({ error: 'Запись не найдена' });

  const allowed = new Set([
    'exam',
    'credit',
    'coursework',
    'practice',
    'gia',
    'state_exam',
    'demo_exam',
  ]);
  if (req.body?.section && !allowed.has(req.body.section)) {
    return res.status(400).json({ error: 'Неверный раздел' });
  }

  const fields = [
    'section',
    'semester',
    'academic_year',
    'course_num',
    'subject',
    'hours',
    'grade',
    'graded_at',
    'teacher_name',
    'topic',
    'place',
    'sort_order',
  ];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (req.body?.[f] !== undefined) {
      sets.push(`${f} = ?`);
      let v = req.body[f];
      if (f === 'semester' || f === 'course_num' || f === 'sort_order') {
        v = v === null || v === '' ? null : Number(v);
      }
      vals.push(v);
    }
  }
  // Editing an auto row makes it manual so sync won't wipe custom edits
  if (existing.source === 'auto' && sets.length) {
    sets.push(`source = 'manual'`);
  }
  if (!sets.length) {
    return res.json(buildPayload(contactId));
  }
  vals.push(entryId, book.id);
  db.prepare(
    `UPDATE record_book_entries SET ${sets.join(', ')} WHERE id = ? AND book_id = ?`
  ).run(...vals);
  res.json(buildPayload(contactId));
});

router.delete('/:contactId/entries/:entryId', ...staff, (req, res) => {
  const contactId = Number(req.params.contactId);
  const entryId = Number(req.params.entryId);
  if (!canViewStudent(req.user, contactId)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const book = ensureBook(contactId);
  if (!book) return res.status(404).json({ error: 'Ученик не найден' });
  db.prepare('DELETE FROM record_book_entries WHERE id = ? AND book_id = ?').run(entryId, book.id);
  res.json(buildPayload(contactId));
});

module.exports = router;
