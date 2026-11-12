const db = require('../db');
const {
  canViewStudent,
  canEditSchoolDiary,
  listAccessibleStudents,
  studentContactByUser,
  buildStudentDiary,
  defaultPeriodKey,
} = require('./diary');

const EXAM_CRITERIA = new Set(['quiz', 'project', 'oral']);
const CREDIT_CRITERIA = new Set(['homework', 'extra', 'activity']);

function academicYearFromPeriod(periodKey) {
  if (!periodKey || !/^\d{4}-\d{2}$/.test(periodKey)) {
    const y = new Date().getFullYear();
    const m = new Date().getMonth() + 1;
    return m >= 9 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
  }
  const [y, m] = periodKey.split('-').map(Number);
  return m >= 9 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

function semesterFromPeriod(periodKey) {
  if (!periodKey || !/^\d{4}-\d{2}$/.test(periodKey)) return 1;
  const m = Number(periodKey.split('-')[1]);
  return m >= 2 && m <= 7 ? 2 : 1;
}

function ensureBook(contactId) {
  const contact = db.prepare(`SELECT * FROM contacts WHERE id = ? AND type = 'student'`).get(contactId);
  if (!contact) return null;

  let book = db.prepare('SELECT * FROM record_books WHERE contact_id = ?').get(contactId);
  if (book) return book;

  const year = new Date().getFullYear();
  const bookNumber = `ЗК-${String(contactId).padStart(4, '0')}-${year}`;
  const firstCourse = db
    .prepare(
      `SELECT co.title, co.category
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       LEFT JOIN courses co ON co.id = g.course_id
       WHERE gm.contact_id = ? AND gm.status = 'active'
       ORDER BY g.id LIMIT 1`
    )
    .get(contactId);

  const info = db
    .prepare(
      `INSERT INTO record_books
       (contact_id, book_number, org_name, specialty, study_form, enrolled_at, issued_at, course_year, director_name)
       VALUES (?, ?, 'IT-Scool', ?, 'очная', date('now'), date('now'), ?, 'Администратор IT-Scool')`
    )
    .run(
      contactId,
      bookNumber,
      firstCourse?.category || firstCourse?.title || 'IT / программирование',
      contact.grade || null
    );

  book = db.prepare('SELECT * FROM record_books WHERE id = ?').get(info.lastInsertRowid);
  syncAutoEntries(book.id, contactId);
  return db.prepare('SELECT * FROM record_books WHERE id = ?').get(book.id);
}

function clearAutoEntries(bookId) {
  db.prepare(`DELETE FROM record_book_entries WHERE book_id = ? AND source = 'auto'`).run(bookId);
}

function insertEntry(bookId, row) {
  db.prepare(
    `INSERT INTO record_book_entries
     (book_id, section, semester, academic_year, course_num, subject, hours, grade, graded_at,
      teacher_name, topic, place, meta_json, sort_order, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bookId,
    row.section,
    row.semester ?? null,
    row.academic_year || '',
    row.course_num ?? null,
    row.subject || '',
    row.hours || '',
    row.grade || '',
    row.graded_at || null,
    row.teacher_name || '',
    row.topic || '',
    row.place || '',
    JSON.stringify(row.meta || {}),
    row.sort_order || 0,
    row.source || 'manual'
  );
}

/** Rebuild auto rows from diary, certificates, portfolio — keeps manual rows */
function syncAutoEntries(bookId, contactId) {
  clearAutoEntries(bookId);
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
  const book = db.prepare('SELECT * FROM record_books WHERE id = ?').get(bookId);
  if (!contact || !book) return;

  const memberships = db
    .prepare(
      `SELECT g.id as group_id, g.name as group_name, g.course_id, co.title as course_title
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       LEFT JOIN courses co ON co.id = g.course_id
       WHERE gm.contact_id = ? AND gm.status = 'active'`
    )
    .all(contactId);

  let sort = 0;
  for (const m of memberships) {
    const periodKeys = db
      .prepare(
        `SELECT DISTINCT period_key FROM diary_entries
         WHERE group_id = ? AND contact_id = ? AND period_key != ''
         ORDER BY period_key`
      )
      .all(m.group_id, contactId)
      .map((r) => r.period_key);

    const keys = periodKeys.length ? periodKeys : [defaultPeriodKey()];
    for (const pk of keys) {
      const diary = buildStudentDiary({
        groupId: m.group_id,
        contactId,
        periodKey: pk,
      });
      if (!diary) continue;
      const year = academicYearFromPeriod(pk);
      const sem = semesterFromPeriod(pk);
      const courseNum = contact.grade || book.course_year || 1;

      for (const e of diary.entries) {
        const section = EXAM_CRITERIA.has(e.criteria_code)
          ? 'exam'
          : CREDIT_CRITERIA.has(e.criteria_code)
            ? 'credit'
            : 'credit';
        if (e.criteria_code === 'late') continue;
        insertEntry(bookId, {
          section,
          semester: sem,
          academic_year: year,
          course_num: courseNum,
          subject: e.title || e.criteria_name || m.course_title || m.group_name,
          hours: '',
          grade: e.score != null ? String(e.score) : '',
          graded_at: (e.graded_at || '').slice(0, 10),
          teacher_name: e.teacher_name || '',
          topic: e.detail || '',
          sort_order: sort++,
          source: 'auto',
          meta: { criteria: e.criteria_code, period_key: pk, group_id: m.group_id },
        });
      }

      if (diary.breakdown?.total_display != null || diary.breakdown?.total != null) {
        insertEntry(bookId, {
          section: 'exam',
          semester: sem,
          academic_year: year,
          course_num: courseNum,
          subject: `Итог периода: ${m.course_title || m.group_name}`,
          hours: '',
          grade: String(diary.breakdown.total_display ?? diary.breakdown.total),
          graded_at: `${pk}-01`,
          teacher_name: '',
          topic: diary.breakdown.formula_text || '',
          sort_order: sort++,
          source: 'auto',
          meta: { period_key: pk, kind: 'period_total' },
        });
      }
    }
  }

  const projects = db
    .prepare(
      `SELECT p.*, co.title as course_title
       FROM portfolio_projects p
       LEFT JOIN courses co ON co.id = p.course_id
       WHERE p.contact_id = ? OR p.user_id = ?
       ORDER BY p.id DESC`
    )
    .all(contactId, contact.user_id || -1);

  for (const p of projects) {
    insertEntry(bookId, {
      section: 'coursework',
      semester: null,
      academic_year: academicYearFromPeriod(defaultPeriodKey()),
      course_num: contact.grade || book.course_year || null,
      subject: p.course_title || 'Портфолио',
      hours: '',
      grade: p.status === 'published' ? 'зачтено' : p.status || 'зачтено',
      graded_at: (p.created_at || '').slice(0, 10),
      teacher_name: '',
      topic: p.title || '',
      sort_order: sort++,
      source: 'auto',
      meta: { portfolio_id: p.id },
    });
  }

  const certs = contact.user_id
    ? db
        .prepare(
          `SELECT c.*, co.title as course_title, co.category
           FROM certificates c
           JOIN courses co ON co.id = c.course_id
           WHERE c.user_id = ?
           ORDER BY c.issued_at DESC`
        )
        .all(contact.user_id)
    : [];

  for (const c of certs) {
    insertEntry(bookId, {
      section: 'gia',
      semester: null,
      academic_year: academicYearFromPeriod((c.issued_at || '').slice(0, 7)),
      course_num: contact.grade || null,
      subject: c.course_title || c.title,
      hours: '',
      grade: 'сдан',
      graded_at: (c.issued_at || '').slice(0, 10),
      teacher_name: '',
      topic: c.title || 'Сертификат курса',
      sort_order: sort++,
      source: 'auto',
      meta: { certificate_id: c.id },
    });
  }
}

function listEntries(bookId) {
  return db
    .prepare(
      `SELECT * FROM record_book_entries WHERE book_id = ? ORDER BY
         CASE section
           WHEN 'exam' THEN 1 WHEN 'credit' THEN 2 WHEN 'coursework' THEN 3
           WHEN 'practice' THEN 4 WHEN 'gia' THEN 5 WHEN 'state_exam' THEN 6
           WHEN 'demo_exam' THEN 7 ELSE 8 END,
         academic_year, semester, sort_order, id`
    )
    .all(bookId);
}

function groupSemesters(entries) {
  const map = new Map();
  for (const e of entries.filter((x) => x.section === 'exam' || x.section === 'credit')) {
    const key = `${e.academic_year || '—'}|${e.semester || 1}|${e.course_num || ''}`;
    if (!map.has(key)) {
      map.set(key, {
        academic_year: e.academic_year || '—',
        semester: e.semester || 1,
        course_num: e.course_num,
        exams: [],
        credits: [],
      });
    }
    const block = map.get(key);
    if (e.section === 'exam') block.exams.push(e);
    else block.credits.push(e);
  }
  return [...map.values()];
}

function buildPayload(contactId) {
  const book = ensureBook(contactId);
  if (!book) return null;
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
  const entries = listEntries(book.id);
  return {
    book,
    contact,
    entries,
    semesters: groupSemesters(entries),
    coursework: entries.filter((e) => e.section === 'coursework'),
    practice: entries.filter((e) => e.section === 'practice'),
    gia: entries.filter((e) => e.section === 'gia'),
    state_exam: entries.filter((e) => e.section === 'state_exam'),
    demo_exam: entries.filter((e) => e.section === 'demo_exam'),
  };
}

module.exports = {
  canViewStudent,
  canEditSchoolDiary,
  listAccessibleStudents,
  studentContactByUser,
  ensureBook,
  syncAutoEntries,
  insertEntry,
  listEntries,
  buildPayload,
  academicYearFromPeriod,
  semesterFromPeriod,
};
