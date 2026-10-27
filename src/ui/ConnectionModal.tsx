import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Tabs, Typography, message } from 'antd';
import { FolderOpenOutlined, LinkOutlined } from '@ant-design/icons';
import type { ConnectionProfile, SessionInfo, Settings } from '../shared/types';
const api = window.querydesk;
export function ConnectionModal({ value, onClose, onSaved }: { value: Partial<ConnectionProfile> | null; onClose: () => void; onSaved: (s:Settings) => void }) {
  const [form] = Form.useForm(); const dialect = Form.useWatch('dialect', form); const tls = Form.useWatch('tls', form);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState<{ ok: boolean; text: string }>();
  useEffect(() => { if (value) { form.resetFields(); form.setFieldsValue({ id: crypto.randomUUID(), name: '', group: '我的连接', dialect: 'mysql', host: 'localhost', port: 3306, user: '', database: '', oracleMode: 'service', clientPath: '', tls: false, caPath: '', ...value, password: undefined }); setStatus(undefined); } }, [value, form]);
  const collect = async () => { const data = await form.validateFields(); return { ...data, id: form.getFieldValue('id'), group: data.group || '我的连接', database: data.database || '', clientPath: data.clientPath || '', caPath: data.caPath || '', tls: !!data.tls, oracleMode: data.oracleMode || 'service', ...(data.password === '' && value?.hasPassword ? { password: undefined } : {}) } as ConnectionProfile; };
  async function test() { setBusy(true); setStatus(undefined); try { const info = await api.call<SessionInfo>('connection.test', await collect()); setStatus({ ok: true, text: `连接成功 · ${info.version} · ${info.schema || '未指定默认库'}` }); } catch (e) { setStatus({ ok: false, text: (e as Error).message }); } finally { setBusy(false); } }
  async function save() { try { setBusy(true); onSaved(await api.call<Settings>('connection.save', await collect())); onClose(); message.success('连接已保存'); } catch (e) { message.error((e as Error).message); } finally { setBusy(false); } }
  return <Modal open={!!value} title={<Space><LinkOutlined />{value?.id ? '编辑连接' : '新建数据库连接'}</Space>} onCancel={onClose} width={650} destroyOnHidden footer={<Space><Button onClick={test} loading={busy}>测试连接</Button><Button onClick={onClose}>取消</Button><Button type="primary" onClick={save} loading={busy}>保存连接</Button></Space>}>
    <Form form={form} layout="vertical" requiredMark={false} className="connection-form">
      <Form.Item name="id" hidden><Input /></Form.Item>
      <div className="form-pair"><Form.Item name="dialect" label="数据库类型"><Select onChange={d => form.setFieldsValue({ port: d === 'mysql' ? 3306 : 1521 })} options={[{ value: 'mysql', label: 'MySQL' }, { value: 'oracle', label: 'Oracle · 含 11gR2' }]} /></Form.Item><Form.Item name="group" label="连接分组"><Input placeholder="我的连接" /></Form.Item></div>
      <Form.Item name="name" label="连接名称" rules={[{ required: true, message: '请输入名称' }]}><Input placeholder="例如：开发环境 / 订单数据库" /></Form.Item>
      <Tabs items={[{ key: 'connection', label: '连接参数', forceRender: true, children: <>
        <div className="host-port"><Form.Item name="host" label="主机" rules={[{ required: true }]}><Input placeholder="localhost" /></Form.Item><Form.Item name="port" label="端口" rules={[{ required: true }]}><InputNumber min={1} max={65535} style={{ width: '100%' }} /></Form.Item></div>
        <div className="form-pair"><Form.Item name="user" label="用户名" rules={[{ required: true }]}><Input autoComplete="off" /></Form.Item><Form.Item name="password" label="密码"><Input.Password autoComplete="new-password" placeholder={value?.hasPassword ? '已加密保存，留空保持不变' : '数据库密码'} /></Form.Item></div>
        <div className={dialect === 'oracle' ? 'form-pair' : ''}>{dialect === 'oracle' && <Form.Item name="oracleMode" label="连接方式"><Select options={[{ value: 'service', label: 'Service Name' }, { value: 'sid', label: 'SID' }]} /></Form.Item>}<Form.Item name="database" label={dialect === 'oracle' ? '服务名称 / SID' : '默认数据库（可选）'} rules={dialect === 'oracle' ? [{ required: true }] : []}><Input placeholder={dialect === 'oracle' ? 'ORCL' : '可在连接后选择'} /></Form.Item></div>
      </> }, { key: 'advanced', label: dialect === 'oracle' ? 'JDBC 驱动' : 'TLS 安全连接', forceRender: true, children: dialect === 'oracle' ? <>
        <Alert type="info" showIcon message="Oracle JDBC Thin · 支持 11gR2" description="已内置 JDBC 驱动和 Java 运行时，无需安装 Java 或 Oracle Instant Client。填写连接参数即可测试连接。" />
        <Button style={{ marginTop: 16 }} onClick={async () => { setBusy(true); try { const r = await api.call<{ message:string }>('client.inspect', { path: '' }); setStatus({ ok: true, text: r.message }); } catch (e) { setStatus({ ok: false, text: (e as Error).message }); } finally { setBusy(false); } }} loading={busy}>检测内置驱动</Button>
      </> : <><Form.Item name="tls" label="启用 TLS，并验证服务端证书" valuePropName="checked"><Switch /></Form.Item><Form.Item name="caPath" label="CA 证书文件（可选，默认系统信任链）"><Input disabled={!tls} addonAfter={<FolderOpenOutlined onClick={async () => { const p = await api.call<string>('dialog.file'); if (p) form.setFieldValue('caPath', p); }} />} /></Form.Item></> }]} />
      {status && <Alert style={{ marginTop: 16 }} showIcon type={status.ok ? 'success' : 'error'} message={status.text} />}
      <Typography.Paragraph className="muted" style={{ marginTop: 18, marginBottom: 0 }}>密码仅保存在当前 Windows 用户的加密存储中。</Typography.Paragraph>
    </Form>
  </Modal>;
}
