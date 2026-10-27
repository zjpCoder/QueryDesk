import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { _electron } from '@playwright/test';
import { root, verifySnapshot } from './verify-snapshot.mjs';

verifySnapshot();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'querydesk-release-smoke-'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ connections: [{ id: 'demo', name: '隔离演示', dialect: 'oracle', host: 'demo.invalid', port: 1521, database: 'APP', user: 'APP' }], ai: { model: '', baseUrl: 'https://example.invalid/v1' }, theme: 'champagne', history: [] }));
const env = { ...process.env, QUERYDESK_TEST_USER_DATA: profile, QUERYDESK_JDBC_ROOT: path.join(root, 'runtime') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.QUERYDESK_DEV_URL;
let app;
try {
  app = await _electron.launch({ executablePath: electron, args: [root], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('querydesk:call');
    globalThis.smokeBrowses = [];
    ipcMain.removeHandler('querydesk:call');
    ipcMain.handle('querydesk:call', (event, method, payload) => {
      let value;
      if (['session.open', 'session.state'].includes(method)) value = { connected: true, autoCommit: true, readOnly: false, dirty: false, needsRollback: false, schema: 'APP', version: '隔离演示' };
      else if (method === 'session.close') value = {};
      else if (method === 'schema.list') value = ['APP'];
      else if (method === 'object.list') value = [{ name: 'DEMO_TABLE', schema: 'APP', kind: 'table' }];
      else if (method === 'table.browse') {
        globalThis.smokeBrowses.push(payload);
        value = { def: { name: 'DEMO_TABLE', schema: 'APP', columns: [{ name: 'ID', type: 'NUMBER', nullable: false, primary: true, comment: '编号' }], indexes: [], foreignKeys: [] }, rows: [{ ID: '1' }], hasMore: false, editable: false, reason: '隔离演示数据' };
      } else return original(event, method, payload);
      return { ok: true, value };
    });
  });
  await page.locator('.connection-main').click();
  await page.getByPlaceholder('搜索数据库对象…', { exact: true }).fill('DEMO_TABLE');
  await page.locator('.object-title').filter({ hasText: 'DEMO_TABLE' }).dblclick();
  await page.getByRole('combobox', { name: '排序字段', exact: true }).waitFor();
  for (const name of ['设为 NULL', '导出本页', '导出整表']) assert.equal(await page.locator('.data-toolbar').getByRole('button', { name, exact: true }).count(), 0);
  await page.getByRole('button', { name: '升序 ID', exact: true }).click();
  await page.getByRole('button', { name: '降序 ID', exact: true }).waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.smokeBrowses.at(-1).sort), { column: 'ID', direction: 'asc' });
  assert.deepEqual(errors, []);
  fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
  await page.screenshot({ path: path.join(root, '.cache/release-smoke.png') });
  console.log('发布路线启动、最新工具栏与服务端排序验证通过；未连接数据库或模型服务。');
} finally {
  if (app) await app.close();
  if (!profile.startsWith(path.join(os.tmpdir(), 'querydesk-release-smoke-'))) throw new Error('测试目录不合法');
  fs.rmSync(profile, { recursive: true, force: true });
}
