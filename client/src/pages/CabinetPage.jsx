import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import { EditOutlined, UserOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useAuth } from '../auth';
import { CabinetGrid, CabinetShell } from '../components/CabinetShell';

const { Title, Paragraph, Text } = Typography;

function money(v) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(Number(v) || 0);
}

function fmtWhen(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(v);
  }
}

function kpiDisplay(item) {
  if (item.key === 'overdue' || String(item.label).includes('₽')) {
    return money(item.value);
  }
  return item.value;
}

export default function CabinetPage() {
  const { user, setUser } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();

  function load() {
    api('/cabinet/me')
      .then(setData)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
  }, [user?.id, user?.role]);

  async function saveProfile(values) {
    setBusy(true);
    try {
      const body = { name: values.name, avatar: values.avatar || '' };
      if (values.password) body.password = values.password;
      const res = await api('/cabinet/profile', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (res.user) setUser(res.user);
      if (res.cabinet) setData(res.cabinet);
      else load();
      message.success('Профиль сохранён');
      setProfileOpen(false);
    } catch (e) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert type="error" showIcon message={error} />;
  if (!data) return <Card loading />;

  const profile = data.profile || {};
  const lists = data.lists || {};

  return (
    <CabinetShell title={data.title} subtitle={data.subtitle}>
      <Card className="cabinet-card cabinet-profile">
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={14}>
            <Space align="start" size={16}>
              <div className="cabinet-avatar">
                {profile.avatar ? (
                  <img src={profile.avatar} alt="" />
                ) : (
                  <UserOutlined style={{ fontSize: 28 }} />
                )}
              </div>
              <div>
                <Title level={3} style={{ margin: 0 }}>
                  {profile.name}
                </Title>
                <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  {profile.email}
                </Paragraph>
                <Space wrap>
                  <Tag color="purple">{profile.role_label}</Tag>
                  {profile.grade ? <Tag>{profile.grade} класс</Tag> : null}
                  {data.meta?.book_number ? (
                    <Tag>Зачётка {data.meta.book_number}</Tag>
                  ) : null}
                </Space>
              </div>
            </Space>
          </Col>
          <Col xs={24} md={10} style={{ textAlign: 'right' }}>
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                form.setFieldsValue({
                  name: profile.name,
                  avatar: profile.avatar || '',
                  password: '',
                });
                setProfileOpen(true);
              }}
            >
              Редактировать профиль
            </Button>
          </Col>
        </Row>
      </Card>

      {(data.kpis || []).length > 0 && (
        <CabinetGrid columns={Math.min(4, data.kpis.length) || 2}>
          {data.kpis.map((k) => (
            <Card key={k.key} className="cabinet-card">
              <Statistic title={k.label} value={kpiDisplay(k)} />
            </Card>
          ))}
        </CabinetGrid>
      )}

      <Card className="cabinet-card" title="Быстрые разделы">
        <Space wrap>
          {(data.links || []).map((l) => (
            <Link key={l.to} to={l.to}>
              <Button type={l.to === '/cabinet' ? 'default' : 'primary'}>{l.label}</Button>
            </Link>
          ))}
        </Space>
      </Card>

      <CabinetGrid columns={2}>
        {lists.courses ? (
          <Card className="cabinet-card" title="Курсы">
            {lists.courses.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Пока нет курсов" />
            ) : (
              <List
                dataSource={lists.courses}
                renderItem={(c) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Link to={c.id ? `/courses/${c.id}` : '/courses'}>
                          {c.icon ? `${c.icon} ` : ''}
                          {c.title}
                        </Link>
                      }
                      description={
                        c.progress != null
                          ? `Прогресс: ${c.progress}%`
                          : c.category || null
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        ) : null}

        {lists.children ? (
          <Card className="cabinet-card" title="Дети">
            <List
              dataSource={lists.children}
              locale={{ emptyText: 'Дети не привязаны' }}
              renderItem={(c) => (
                <List.Item>
                  <List.Item.Meta
                    title={c.name}
                    description={c.grade ? `${c.grade} класс` : '—'}
                  />
                  <Link to="/parent">Открыть</Link>
                </List.Item>
              )}
            />
          </Card>
        ) : null}

        {lists.upcoming ? (
          <Card className="cabinet-card" title="Ближайшие занятия">
            {lists.upcoming.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет занятий" />
            ) : (
              <List
                dataSource={lists.upcoming}
                renderItem={(s) => (
                  <List.Item>
                    <List.Item.Meta
                      title={s.title || s.group_name}
                      description={`${fmtWhen(s.starts_at)}${
                        s.child_name ? ` · ${s.child_name}` : ''
                      }${s.group_name ? ` · ${s.group_name}` : ''}`}
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        ) : null}

        {lists.recent_users ? (
          <Card className="cabinet-card" title="Недавние пользователи">
            <List
              dataSource={lists.recent_users}
              renderItem={(u) => (
                <List.Item>
                  <List.Item.Meta
                    title={u.name}
                    description={`${u.email} · ${u.role}`}
                  />
                </List.Item>
              )}
            />
          </Card>
        ) : null}
      </CabinetGrid>

      <Modal
        title="Профиль"
        open={profileOpen}
        onCancel={() => setProfileOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={busy}
        okText="Сохранить"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={saveProfile}>
          <Form.Item name="name" label="Имя" rules={[{ required: true, min: 2 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="avatar" label="URL аватара">
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item name="password" label="Новый пароль (необязательно)">
            <Input.Password placeholder="Оставьте пустым, чтобы не менять" />
          </Form.Item>
          <Paragraph type="secondary">Email меняется только через администратора.</Paragraph>
        </Form>
      </Modal>
    </CabinetShell>
  );
}
