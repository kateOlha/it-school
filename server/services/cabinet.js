const db = require('../db');
const { hasPermission } = require('./rbac');
const {
  studentContactByUser,
  parentContactByUser,
  childrenContactIds,
} = require('./diary');

const ROLE_LABELS = {
  admin: 'Администратор',
  teacher: 'Преподаватель',
  methodist: 'Методист',
  student: 'Ученик',
  parent: 'Родитель',
  accountant: 'Бухгалтер',
  hr: 'HR',
  analyst: 'Аналитик',
  marketer: 'Маркетолог',
};

function count(sql, ...params) {
  return db.prepare(sql).get(...params)?.c || 0;
}

function moneySum(sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.s || 0);
}

function profileBlock(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    role_label: ROLE_LABELS[user.role] || user.role,
    grade: user.grade,
    avatar: user.avatar || '',
    created_at: user.created_at,
  };
}

function studentCabinet(user) {
  const contact = studentContactByUser(user.id);
  const contactId = contact?.id;
  const enrollments = count('SELECT COUNT(*) as c FROM enrollments WHERE user_id = ?', user.id);
  const certificates = count('SELECT COUNT(*) as c FROM certificates WHERE user_id = ?', user.id);
  const homeworkOpen = contactId
    ? count(
        `SELECT COUNT(*) as c FROM homework_submissions
         WHERE contact_id = ? AND status IN ('assigned','submitted')`,
        contactId
      )
    : 0;
  const unread = count(
    `SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    user.id
  );
  const upcoming = contactId
    ? db
        .prepare(
          `SELECT s.id, s.starts_at, s.title, g.name as group_name
           FROM schedule_sessions s
           JOIN groups g ON g.id = s.group_id
           JOIN group_members gm ON gm.group_id = g.id AND gm.contact_id = ? AND gm.status = 'active'
           WHERE datetime(s.starts_at) >= datetime('now')
           ORDER BY s.starts_at LIMIT 5`
        )
        .all(contactId)
    : [];
  const courses = db
    .prepare(
      `SELECT c.id, c.title, c.icon, c.category,
         (
           SELECT ROUND(
             CASE WHEN (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) = 0 THEN 0
             ELSE 100.0 * (
               SELECT COUNT(*) FROM lesson_progress lp
               JOIN lessons l2 ON l2.id = lp.lesson_id
               WHERE lp.user_id = e.user_id AND l2.course_id = c.id AND lp.completed = 1
             ) / (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id)
             END
           )
         ) as progress
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = ?
       ORDER BY e.id DESC LIMIT 6`
    )
    .all(user.id);

  const book = contactId
    ? db.prepare('SELECT book_number FROM record_books WHERE contact_id = ?').get(contactId)
    : null;

  return {
    kind: 'student',
    title: 'Личный кабинет ученика',
    subtitle: 'Обучение, ДЗ, зачётка и сообщения',
    kpis: [
      { key: 'courses', label: 'Курсы', value: enrollments },
      { key: 'hw', label: 'Открытые ДЗ', value: homeworkOpen },
      { key: 'certs', label: 'Сертификаты', value: certificates },
      { key: 'unread', label: 'Уведомления', value: unread },
    ],
    links: [
      { to: '/dashboard', label: 'Моё обучение' },
      { to: '/diary', label: 'Дневник' },
      { to: '/record-book', label: 'Зачётка' },
      { to: '/portfolio', label: 'Портфолио' },
      { to: '/messages', label: 'Сообщения' },
      { to: '/courses', label: 'Каталог курсов' },
    ],
    lists: {
      courses,
      upcoming,
    },
    meta: {
      contact_id: contactId || null,
      grade: contact?.grade || user.grade,
      book_number: book?.book_number || null,
    },
  };
}

function parentCabinet(user) {
  const parent = parentContactByUser(user.id);
  const childIds = parent ? childrenContactIds(parent.id) : [];
  const children = childIds.length
    ? db
        .prepare(
          `SELECT id, name, grade, user_id FROM contacts
           WHERE id IN (${childIds.map(() => '?').join(',')})`
        )
        .all(...childIds)
    : [];

  let pendingBills = 0;
  let overdueSum = 0;
  let openHw = 0;
  if (childIds.length) {
    pendingBills = count(
      `SELECT COUNT(*) as c FROM payments
       WHERE contact_id IN (${childIds.map(() => '?').join(',')})
         AND status IN ('pending','overdue')`,
      ...childIds
    );
    overdueSum = moneySum(
      `SELECT COALESCE(SUM(amount),0) as s FROM payments
       WHERE contact_id IN (${childIds.map(() => '?').join(',')}) AND status = 'overdue'`,
      ...childIds
    );
    openHw = count(
      `SELECT COUNT(*) as c FROM homework_submissions
       WHERE contact_id IN (${childIds.map(() => '?').join(',')})
         AND status IN ('assigned','submitted')`,
      ...childIds
    );
  }

  const upcoming = childIds.length
    ? db
        .prepare(
          `SELECT s.id, s.starts_at, s.title, g.name as group_name, c.name as child_name
           FROM schedule_sessions s
           JOIN groups g ON g.id = s.group_id
           JOIN group_members gm ON gm.group_id = g.id AND gm.status = 'active'
           JOIN contacts c ON c.id = gm.contact_id
           WHERE gm.contact_id IN (${childIds.map(() => '?').join(',')})
             AND datetime(s.starts_at) >= datetime('now')
           ORDER BY s.starts_at LIMIT 6`
        )
        .all(...childIds)
    : [];

  return {
    kind: 'parent',
    title: 'Личный кабинет родителя',
    subtitle: 'Дети, оплаты, посещаемость и связь со школой',
    kpis: [
      { key: 'children', label: 'Дети', value: children.length },
      { key: 'bills', label: 'Счета к оплате', value: pendingBills },
      { key: 'overdue', label: 'Просрочено ₽', value: overdueSum },
      { key: 'hw', label: 'Открытые ДЗ', value: openHw },
    ],
    links: [
      { to: '/parent', label: 'Кабинет родителя' },
      { to: '/diary', label: 'Дневник' },
      { to: '/record-book', label: 'Зачётка' },
      { to: '/messages', label: 'Сообщения' },
      { to: '/documents', label: 'Документы' },
    ],
    lists: {
      children,
      upcoming,
    },
    meta: { parent_contact_id: parent?.id || null },
  };
}

function teacherCabinet(user) {
  const myCourses = count(
    `SELECT COUNT(*) as c FROM courses WHERE teacher_id = ? OR teacher_id IS NULL`,
    user.id
  );
  const lessons = count('SELECT COUNT(*) as c FROM lessons');
  const pendingHw = count(
    `SELECT COUNT(*) as c FROM homework_submissions WHERE status = 'submitted'`
  );
  const upcoming = db
    .prepare(
      `SELECT s.id, s.starts_at, s.title, g.name as group_name
       FROM schedule_sessions s
       JOIN groups g ON g.id = s.group_id
       WHERE datetime(s.starts_at) >= datetime('now')
       ORDER BY s.starts_at LIMIT 6`
    )
    .all();
  const courses = db
    .prepare(
      `SELECT id, title, icon, category FROM courses
       ORDER BY id DESC LIMIT 8`
    )
    .all();

  return {
    kind: 'teacher',
    title: 'Личный кабинет преподавателя',
    subtitle: 'Группы, контент, журнал и сообщения ученикам',
    kpis: [
      { key: 'courses', label: 'Мои курсы', value: myCourses },
      { key: 'lessons', label: 'Уроки', value: lessons },
      { key: 'hw', label: 'ДЗ на проверке', value: pendingHw },
      { key: 'upcoming', label: 'Ближайшие занятия', value: upcoming.length },
    ],
    links: [
      { to: '/teacher', label: 'Контент' },
      { to: '/teacher/blocks', label: 'Конструктор блоков' },
      { to: '/office/gradebook', label: 'Журнал' },
      { to: '/office/homework', label: 'Домашки' },
      { to: '/diary', label: 'Дневник' },
      { to: '/record-book', label: 'Зачётки' },
      { to: '/office', label: 'Офис' },
      { to: '/messages', label: 'Сообщения' },
    ],
    lists: { courses, upcoming },
    meta: {},
  };
}

function methodistCabinet(user) {
  const courses = count('SELECT COUNT(*) as c FROM courses');
  const lessons = count('SELECT COUNT(*) as c FROM lessons');
  const sections = count('SELECT COUNT(*) as c FROM course_sections');
  const blocks = count('SELECT COUNT(*) as c FROM lesson_blocks');
  const recent = db
    .prepare(
      `SELECT id, title, icon, category, created_at FROM courses
       ORDER BY id DESC LIMIT 8`
    )
    .all();

  return {
    kind: 'methodist',
    title: 'Личный кабинет методиста',
    subtitle: 'Программы, блоки уроков и проверочные материалы',
    kpis: [
      { key: 'courses', label: 'Курсы', value: courses },
      { key: 'lessons', label: 'Уроки', value: lessons },
      { key: 'sections', label: 'Секции', value: sections },
      { key: 'blocks', label: 'Блоки', value: blocks },
    ],
    links: [
      { to: '/teacher/blocks', label: 'Конструктор блоков' },
      { to: '/teacher', label: 'Контент' },
      { to: '/diary', label: 'Дневник' },
      { to: '/courses', label: 'Каталог' },
    ],
    lists: { courses: recent },
    meta: {},
  };
}

function adminCabinet(user) {
  const students = count(`SELECT COUNT(*) as c FROM contacts WHERE type = 'student'`);
  const teachers = count(`SELECT COUNT(*) as c FROM users WHERE role = 'teacher' AND active = 1`);
  const users = count(`SELECT COUNT(*) as c FROM users WHERE active = 1`);
  const overdue = moneySum(
    `SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE status = 'overdue'`
  );
  const upcoming = count(
    `SELECT COUNT(*) as c FROM schedule_sessions WHERE datetime(starts_at) >= datetime('now') AND datetime(starts_at) <= datetime('now', '+7 days')`
  );
  const leads = count(`SELECT COUNT(*) as c FROM leads WHERE status IN ('new','contacted','trial')`);

  return {
    kind: 'admin',
    title: 'Личный кабинет администратора',
    subtitle: 'Управление школой, ролями и операциями',
    kpis: [
      { key: 'students', label: 'Ученики', value: students },
      { key: 'teachers', label: 'Преподаватели', value: teachers },
      { key: 'users', label: 'Активные аккаунты', value: users },
      { key: 'leads', label: 'Активные заявки', value: leads },
      { key: 'upcoming', label: 'Занятия (7 дней)', value: upcoming },
      { key: 'overdue', label: 'Просрочено ₽', value: overdue },
    ],
    links: [
      { to: '/admin/guide', label: 'Гид платформы' },
      { to: '/admin/users', label: 'Люди' },
      { to: '/admin/roles', label: 'Роли' },
      { to: '/office', label: 'Офис' },
      { to: '/office/analytics', label: 'Аналитика' },
      { to: '/teacher', label: 'Контент' },
      { to: '/record-book', label: 'Зачётки' },
      { to: '/product', label: 'Презентация' },
    ],
    lists: {
      recent_users: db
        .prepare(
          `SELECT id, name, email, role, created_at FROM users
           ORDER BY id DESC LIMIT 6`
        )
        .all(),
    },
    meta: {},
  };
}

function officeStaffCabinet(user) {
  const pending = count(`SELECT COUNT(*) as c FROM payments WHERE status = 'pending'`);
  const overdue = moneySum(
    `SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE status = 'overdue'`
  );
  const leads = count(`SELECT COUNT(*) as c FROM leads WHERE status = 'new'`);
  const groups = count('SELECT COUNT(*) as c FROM groups');

  return {
    kind: 'office',
    title: `Личный кабинет · ${ROLE_LABELS[user.role] || user.role}`,
    subtitle: 'Операционные данные офиса школы',
    kpis: [
      { key: 'groups', label: 'Группы', value: groups },
      { key: 'leads', label: 'Новые заявки', value: leads },
      { key: 'pending', label: 'Счета pending', value: pending },
      { key: 'overdue', label: 'Просрочено ₽', value: overdue },
    ],
    links: [
      { to: '/office', label: 'Офис' },
      { to: '/office/leads', label: 'CRM' },
      { to: '/office/payments', label: 'Оплаты' },
      { to: '/office/schedule', label: 'Расписание' },
      { to: '/messages', label: 'Сообщения' },
    ],
    lists: {},
    meta: {},
  };
}

function buildCabinet(user) {
  const profile = profileBlock(user);
  let body;
  if (user.role === 'admin') body = adminCabinet(user);
  else if (user.role === 'teacher') body = teacherCabinet(user);
  else if (user.role === 'methodist') body = methodistCabinet(user);
  else if (user.role === 'student') body = studentCabinet(user);
  else if (user.role === 'parent') body = parentCabinet(user);
  else if (hasPermission(user.role, 'office.access', 'office.dashboard')) {
    body = officeStaffCabinet(user);
  } else if (hasPermission(user.role, 'content.builder')) {
    body = methodistCabinet(user);
  } else if (hasPermission(user.role, 'content.teach')) {
    body = teacherCabinet(user);
  } else if (hasPermission(user.role, 'student.learn')) {
    body = studentCabinet(user);
  } else if (hasPermission(user.role, 'parent.portal')) {
    body = parentCabinet(user);
  } else {
    body = {
      kind: 'generic',
      title: 'Личный кабинет',
      subtitle: 'Ваш профиль на платформе IT-Scool',
      kpis: [],
      links: [{ to: '/courses', label: 'Курсы' }],
      lists: {},
      meta: {},
    };
  }

  return {
    profile,
    ...body,
    generated_at: new Date().toISOString(),
  };
}

module.exports = { buildCabinet, ROLE_LABELS };
