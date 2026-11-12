import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  PrinterOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { api } from '../api';

const { Title, Text, Paragraph } = Typography;

const SECTION_OPTIONS = [
  { value: 'exam', label: 'Экзамен' },
  { value: 'credit', label: 'Зачёт' },
  { value: 'coursework', label: 'Курсовая' },
  { value: 'practice', label: 'Практика' },
  { value: 'gia', label: 'ГИА / сертификат' },
  { value: 'state_exam', label: 'Госэкзамен' },
  { value: 'demo_exam', label: 'Демоэкзамен' },
];

const SECTION_LABEL = Object.fromEntries(SECTION_OPTIONS.map((o) => [o.value, o.label]));

function fmtDate(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString('ru-RU');
  } catch {
    return String(v);
  }
}

function EntryFormFields() {
  return (
    <>
      <Form.Item name="section" label="Раздел" rules={[{ required: true }]}>
        <Select options={SECTION_OPTIONS} />
      </Form.Item>
      <Form.Item name="academic_year" label="Учебный год (например 2025/2026)">
        <Input placeholder="2025/2026" />
      </Form.Item>
      <Space wrap style={{ width: '100%' }} size="middle">
        <Form.Item name="semester" label="Семестр" style={{ minWidth: 120 }}>
          <Select
            allowClear
            options={[
              { value: 1, label: '1' },
              { value: 2, label: '2' },
            ]}
          />
        </Form.Item>
        <Form.Item name="course_num" label="Курс" style={{ minWidth: 120 }}>
          <InputNumber min={1} max={11} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="hours" label="Часы / з.ед." style={{ minWidth: 140 }}>
          <Input placeholder="36" />
        </Form.Item>
      </Space>
      <Form.Item name="subject" label="Наименование предмета / курса" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="topic" label="Тема / комментарий">
        <Input.TextArea rows={2} />
      </Form.Item>
      <Space wrap style={{ width: '100%' }} size="middle">
        <Form.Item name="grade" label="Оценка" style={{ minWidth: 140 }}>
          <Input placeholder="5 / зачтено" />
        </Form.Item>
        <Form.Item name="graded_at" label="Дата (ГГГГ-ММ-ДД)" style={{ minWidth: 160 }}>
          <Input placeholder="2026-03-15" />
        </Form.Item>
        <Form.Item name="teacher_name" label="Преподаватель" style={{ minWidth: 180 }}>
          <Input />
        </Form.Item>
      </Space>
      <Form.Item name="place" label="Место проведения (для практики)">
        <Input />
      </Form.Item>
      <Form.Item name="sort_order" label="Порядок в списке">
        <InputNumber style={{ width: '100%' }} />
      </Form.Item>
    </>
  );
}

function ViewTable({ rows, columns }) {
  if (!rows?.length) {
    return <Paragraph type="secondary">Записей пока нет</Paragraph>;
  }
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="id"
      dataSource={rows}
      columns={columns}
      className="zk-table"
    />
  );
}

export default function RecordBookPage() {
  const [students, setStudents] = useState([]);
  const [contactId, setContactId] = useState(null);
  const [data, setData] = useState(null);
  const [canEditFlag, setCanEditFlag] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [defaultSection, setDefaultSection] = useState('credit');
  const [busy, setBusy] = useState(false);
  const [metaForm] = Form.useForm();
  const [entryForm] = Form.useForm();

  async function loadStudents() {
    const d = await api('/record-book/students');
    setStudents(d.students || []);
    setCanEditFlag(!!d.canEdit);
    if (!contactId && d.students?.length) {
      setContactId(d.students[0].id);
    }
    return d;
  }

  async function loadBook(id) {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const d = await api(`/record-book/${id}`);
      setData(d);
      setCanEditFlag(!!d.canEdit);
    } catch (e) {
      setError(e.message || 'Ошибка загрузки');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStudents().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (contactId) loadBook(contactId);
  }, [contactId]);

  const canEdit = canEditFlag || !!data?.canEdit;
  const book = data?.book;
  const contact = data?.contact;
  const allEntries = data?.entries || [];

  const viewCols = useMemo(
    () => [
      { title: '№', width: 44, render: (_v, _r, i) => i + 1 },
      { title: 'Наименование', dataIndex: 'subject' },
      { title: 'Час./з.ед.', dataIndex: 'hours', width: 90 },
      { title: 'Оценка', dataIndex: 'grade', width: 80 },
      { title: 'Дата', dataIndex: 'graded_at', width: 100, render: fmtDate },
      { title: 'Преподаватель', dataIndex: 'teacher_name', width: 140 },
    ],
    []
  );

  function openAdd(section = 'credit') {
    setEditingEntry(null);
    setDefaultSection(section);
    entryForm.resetFields();
    entryForm.setFieldsValue({
      section,
      semester: 1,
      academic_year: data?.semesters?.[0]?.academic_year || '',
      course_num: book?.course_year || contact?.grade || undefined,
      teacher_name: '',
      sort_order: allEntries.length,
    });
    setEntryOpen(true);
  }

  function openEdit(row) {
    setEditingEntry(row);
    entryForm.setFieldsValue({
      section: row.section,
      academic_year: row.academic_year,
      semester: row.semester,
      course_num: row.course_num,
      subject: row.subject,
      topic: row.topic,
      hours: row.hours,
      grade: row.grade,
      graded_at: row.graded_at ? String(row.graded_at).slice(0, 10) : '',
      teacher_name: row.teacher_name,
      place: row.place,
      sort_order: row.sort_order,
    });
    setEntryOpen(true);
  }

  async function saveMeta(values) {
    setBusy(true);
    try {
      const d = await api(`/record-book/${contactId}`, { method: 'PATCH', body: values });
      setData({ ...d, canEdit: true });
      message.success('Титул сохранён');
      setMetaOpen(false);
    } catch (e) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEntry(values) {
    setBusy(true);
    try {
      let d;
      if (editingEntry) {
        d = await api(`/record-book/${contactId}/entries/${editingEntry.id}`, {
          method: 'PATCH',
          body: values,
        });
        message.success('Запись обновлена');
      } else {
        d = await api(`/record-book/${contactId}/entries`, {
          method: 'POST',
          body: values,
        });
        message.success('Запись добавлена');
      }
      setData({ ...d, canEdit: true });
      setEntryOpen(false);
      setEditingEntry(null);
      entryForm.resetFields();
    } catch (e) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(id) {
    setBusy(true);
    try {
      const d = await api(`/record-book/${contactId}/entries/${id}`, { method: 'DELETE' });
      setData({ ...d, canEdit: true });
      message.success('Запись удалена');
    } catch (e) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    try {
      const d = await api(`/record-book/${contactId}/sync`, { method: 'POST' });
      setData({ ...d, canEdit: true });
      message.success('Синхронизировано (ручные правки сохранены)');
    } catch (e) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const editorColumns = [
    {
      title: 'Раздел',
      dataIndex: 'section',
      width: 120,
      render: (v) => SECTION_LABEL[v] || v,
    },
    { title: 'Год', dataIndex: 'academic_year', width: 110 },
    { title: 'Сем.', dataIndex: 'semester', width: 60 },
    { title: 'Курс', dataIndex: 'course_num', width: 60 },
    { title: 'Предмет / курс', dataIndex: 'subject', ellipsis: true },
    { title: 'Тема', dataIndex: 'topic', ellipsis: true, width: 160 },
    { title: 'Часы', dataIndex: 'hours', width: 70 },
    {
      title: 'Оценка',
      dataIndex: 'grade',
      width: 90,
      render: (v) => <Text strong>{v || '—'}</Text>,
    },
    {
      title: 'Дата',
      dataIndex: 'graded_at',
      width: 100,
      render: fmtDate,
    },
    { title: 'Преподаватель', dataIndex: 'teacher_name', width: 130, ellipsis: true },
    {
      title: '',
      dataIndex: 'source',
      width: 80,
      render: (v) =>
        v === 'auto' ? <Tag>авто</Tag> : <Tag color="purple">ручн.</Tag>,
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      fixed: 'right',
      render: (_v, row) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(row)}
            aria-label="Изменить"
          />
          <Popconfirm
            title="Удалить запись?"
            okText="Удалить"
            cancelText="Отмена"
            onConfirm={() => removeEntry(row.id)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="Удалить" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (error && !data) return <Alert type="error" message={error} showIcon />;

  return (
    <div className="zk-page">
      <div className="zk-toolbar no-print">
        <div>
          <Title level={2} style={{ marginBottom: 4 }}>
            Электронная зачётная книжка
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Образец приказа Минпросвещения РФ от 30.03.2026 № 217.
            {canEdit
              ? ' Учитель и админ могут править титул, оценки и строки разделов.'
              : ' Режим просмотра.'}
          </Paragraph>
        </div>
        <Space wrap>
          <Select
            style={{ minWidth: 220 }}
            value={contactId}
            options={students.map((s) => ({
              value: s.id,
              label: `${s.name}${s.grade ? ` (${s.grade} кл.)` : ''}`,
            }))}
            onChange={setContactId}
            placeholder="Ученик"
          />
          {canEdit && (
            <>
              <Button
                type={editMode ? 'primary' : 'default'}
                icon={<EditOutlined />}
                onClick={() => setEditMode((v) => !v)}
              >
                {editMode ? 'Режим правки: вкл' : 'Редактировать'}
              </Button>
              {editMode && (
                <>
                  <Button icon={<PlusOutlined />} onClick={() => openAdd('exam')}>
                    Добавить запись
                  </Button>
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => {
                      metaForm.setFieldsValue(book);
                      setMetaOpen(true);
                    }}
                  >
                    Титул
                  </Button>
                  <Button icon={<ReloadOutlined />} loading={busy} onClick={sync}>
                    Синхронизировать
                  </Button>
                </>
              )}
            </>
          )}
          <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
            Печать
          </Button>
        </Space>
      </div>

      {canEdit && editMode && (
        <div className="zk-editor no-print">
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Редактор для учителя / админа"
            description="Добавляйте экзамены, зачёты, практику и оценки. После правки авто-строка становится ручной и не затирается синхронизацией."
          />
          <Space wrap style={{ marginBottom: 12 }}>
            <Button size="small" onClick={() => openAdd('exam')}>
              + Экзамен
            </Button>
            <Button size="small" onClick={() => openAdd('credit')}>
              + Зачёт
            </Button>
            <Button size="small" onClick={() => openAdd('coursework')}>
              + Курсовая
            </Button>
            <Button size="small" onClick={() => openAdd('practice')}>
              + Практика
            </Button>
            <Button size="small" onClick={() => openAdd('gia')}>
              + ГИА
            </Button>
          </Space>
          <Table
            size="small"
            rowKey="id"
            loading={loading || busy}
            dataSource={allEntries}
            columns={editorColumns}
            pagination={{ pageSize: 12, hideOnSinglePage: true }}
            scroll={{ x: 1100 }}
            locale={{ emptyText: 'Пока пусто — добавьте первую запись' }}
          />
        </div>
      )}

      {loading && !data ? (
        <Alert type="info" message="Загрузка…" />
      ) : (
        <div className="zk-book">
          <section className="zk-spread zk-cover">
            <div className="zk-page-half zk-cover-back" />
            <div className="zk-page-half zk-cover-front">
              <p className="zk-org">{book?.org_name || 'IT-Scool'}</p>
              <h1>ЗАЧЁТНАЯ КНИЖКА</h1>
              <p className="zk-muted">электронная · образец приказа № 217</p>
            </div>
          </section>

          <section className="zk-spread">
            <div className="zk-page-half">
              <div className="zk-photo">
                {book?.photo_url ? (
                  <img src={book.photo_url} alt="" />
                ) : (
                  <span>Место для фото</span>
                )}
              </div>
              <p className="zk-stamp">М.П.</p>
              <p>Подпись студента ________________</p>
              <p className="zk-pagenum">1</p>
            </div>
            <div className="zk-page-half">
              <p className="zk-line">{book?.org_founder || '—'}</p>
              <p className="zk-caption">(учредитель)</p>
              <p className="zk-line strong">{book?.org_name}</p>
              <p className="zk-caption">(полное наименование образовательной организации)</p>
              <Title level={3} style={{ textAlign: 'center', margin: '16px 0' }}>
                ЗАЧЁТНАЯ КНИЖКА № {book?.book_number}
              </Title>
              <p className="zk-line strong">{contact?.name}</p>
              <p className="zk-caption">(фамилия, имя, отчество студента)</p>
              <p>
                Специальность (профессия): <strong>{book?.specialty || '—'}</strong>
              </p>
              <p>
                Форма обучения: <strong>{book?.study_form || '—'}</strong>
              </p>
              <p>
                Зачислен приказом: <strong>{book?.enrolled_order || '—'}</strong>
                {book?.enrolled_at ? ` от ${fmtDate(book.enrolled_at)}` : ''}
              </p>
              <p style={{ marginTop: 24 }}>
                Руководитель: <strong>{book?.director_name || '—'}</strong>
              </p>
              <p>Дата выдачи: {fmtDate(book?.issued_at)}</p>
              {canEdit && editMode && (
                <Button
                  className="no-print"
                  size="small"
                  style={{ marginTop: 12 }}
                  onClick={() => {
                    metaForm.setFieldsValue(book);
                    setMetaOpen(true);
                  }}
                >
                  Править титул
                </Button>
              )}
              <p className="zk-pagenum">2</p>
            </div>
          </section>

          {(data?.semesters || []).map((sem, idx) => (
            <section className="zk-spread" key={`${sem.academic_year}-${sem.semester}-${idx}`}>
              <div className="zk-page-half">
                <div className="zk-sem-head">
                  <strong>
                    {sem.semester}-й семестр {sem.academic_year} учебного года
                  </strong>
                  <span>КУРС {sem.course_num || contact?.grade || '—'}</span>
                </div>
                <Space style={{ marginBottom: 8 }}>
                  <Text strong>Экзамены</Text>
                  {canEdit && editMode && (
                    <Button size="small" type="link" onClick={() => openAdd('exam')}>
                      + добавить
                    </Button>
                  )}
                </Space>
                <ViewTable rows={sem.exams} columns={viewCols} />
              </div>
              <div className="zk-page-half">
                <div className="zk-sem-head">
                  <span>{contact?.name}</span>
                </div>
                <Space style={{ marginBottom: 8 }}>
                  <Text strong>Зачёты</Text>
                  {canEdit && editMode && (
                    <Button size="small" type="link" onClick={() => openAdd('credit')}>
                      + добавить
                    </Button>
                  )}
                </Space>
                <ViewTable rows={sem.credits} columns={viewCols} />
                <p className="zk-sign">Заместитель руководителя ______________</p>
              </div>
            </section>
          ))}

          {!data?.semesters?.length && (
            <section className="zk-spread">
              <div className="zk-page-half">
                <Alert
                  type="info"
                  showIcon
                  message="Семестровых записей пока нет"
                  description={
                    canEdit
                      ? 'Включите «Редактировать» и добавьте экзамен/зачёт или нажмите «Синхронизировать».'
                      : 'Попросите преподавателя заполнить зачётку.'
                  }
                />
              </div>
              <div className="zk-page-half" />
            </section>
          )}

          <section className="zk-spread">
            <div className="zk-page-half zk-fullspan">
              <Space style={{ marginBottom: 8 }}>
                <Title level={4} style={{ margin: 0 }}>
                  Курсовые проекты (работы)
                </Title>
                {canEdit && editMode && (
                  <Button size="small" type="link" onClick={() => openAdd('coursework')}>
                    + добавить
                  </Button>
                )}
              </Space>
              <ViewTable
                rows={data?.coursework}
                columns={[
                  { title: '№', width: 44, render: (_v, _r, i) => i + 1 },
                  { title: 'Предмет / курс', dataIndex: 'subject' },
                  { title: 'Тема', dataIndex: 'topic' },
                  { title: 'Оценка', dataIndex: 'grade', width: 100 },
                  { title: 'Дата', dataIndex: 'graded_at', width: 100, render: fmtDate },
                  { title: 'Преподаватель', dataIndex: 'teacher_name', width: 140 },
                ]}
              />
            </div>
          </section>

          <section className="zk-spread">
            <div className="zk-page-half zk-fullspan">
              <Space style={{ marginBottom: 8 }}>
                <Title level={4} style={{ margin: 0 }}>
                  Практика
                </Title>
                {canEdit && editMode && (
                  <Button size="small" type="link" onClick={() => openAdd('practice')}>
                    + добавить
                  </Button>
                )}
              </Space>
              <ViewTable
                rows={data?.practice}
                columns={[
                  { title: 'Курс', dataIndex: 'course_num', width: 70 },
                  { title: 'Семестр', dataIndex: 'semester', width: 80 },
                  { title: 'Вид практики', dataIndex: 'subject' },
                  { title: 'Место', dataIndex: 'place' },
                  { title: 'Час./з.ед.', dataIndex: 'hours', width: 90 },
                  { title: 'Оценка', dataIndex: 'grade', width: 100 },
                  { title: 'Дата', dataIndex: 'graded_at', width: 100, render: fmtDate },
                ]}
              />
            </div>
          </section>

          <section className="zk-spread">
            <div className="zk-page-half">
              <Space style={{ marginBottom: 8 }}>
                <Title level={4} style={{ margin: 0 }}>
                  Результаты ГИА / сертификаты
                </Title>
                {canEdit && editMode && (
                  <Button size="small" type="link" onClick={() => openAdd('gia')}>
                    + добавить
                  </Button>
                )}
              </Space>
              <p className="zk-caption">{contact?.name}</p>
              <ViewTable
                rows={data?.gia}
                columns={[
                  { title: 'Тема / курс', dataIndex: 'subject' },
                  { title: 'Описание', dataIndex: 'topic' },
                  { title: 'Оценка', dataIndex: 'grade', width: 90 },
                  { title: 'Дата', dataIndex: 'graded_at', width: 100, render: fmtDate },
                ]}
              />
            </div>
            <div className="zk-page-half">
              <Title level={4}>Присвоение квалификации</Title>
              <p>
                Специальность: <strong>{book?.specialty || '—'}</strong>
              </p>
              <p>
                По итогам освоения программы IT-Scool ученику{' '}
                <strong>{contact?.name}</strong> подтверждаются результаты обучения в электронной
                зачётной книжке.
              </p>
              <p style={{ marginTop: 24 }}>
                Руководитель: <strong>{book?.director_name || '—'}</strong>
              </p>
              <p className="zk-stamp">М.П.</p>
            </div>
          </section>
        </div>
      )}

      <Modal
        title="Титульный лист"
        open={metaOpen}
        onCancel={() => setMetaOpen(false)}
        onOk={() => metaForm.submit()}
        okText="Сохранить"
        confirmLoading={busy}
        destroyOnHidden
        width={560}
      >
        <Form form={metaForm} layout="vertical" onFinish={saveMeta}>
          <Form.Item name="book_number" label="Номер книжки" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="org_founder" label="Учредитель">
            <Input />
          </Form.Item>
          <Form.Item name="org_name" label="Организация">
            <Input />
          </Form.Item>
          <Form.Item name="specialty" label="Специальность (профессия)">
            <Input />
          </Form.Item>
          <Form.Item name="study_form" label="Форма обучения">
            <Input />
          </Form.Item>
          <Form.Item name="enrolled_order" label="Приказ о зачислении">
            <Input />
          </Form.Item>
          <Form.Item name="enrolled_at" label="Дата зачисления (ГГГГ-ММ-ДД)">
            <Input />
          </Form.Item>
          <Form.Item name="issued_at" label="Дата выдачи">
            <Input />
          </Form.Item>
          <Form.Item name="director_name" label="Руководитель">
            <Input />
          </Form.Item>
          <Form.Item name="course_year" label="Курс">
            <InputNumber min={1} max={11} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="photo_url" label="URL фото">
            <Input placeholder="/uploads/..." />
          </Form.Item>
          <Form.Item name="notes" label="Заметки">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingEntry ? 'Изменить запись' : `Новая запись · ${SECTION_LABEL[defaultSection] || ''}`}
        open={entryOpen}
        onCancel={() => {
          setEntryOpen(false);
          setEditingEntry(null);
        }}
        onOk={() => entryForm.submit()}
        okText={editingEntry ? 'Сохранить' : 'Добавить'}
        confirmLoading={busy}
        destroyOnHidden
        width={640}
      >
        <Form form={entryForm} layout="vertical" onFinish={saveEntry}>
          <EntryFormFields />
        </Form>
      </Modal>
    </div>
  );
}
