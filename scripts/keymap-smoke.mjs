import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';

export async function keymapSmoke({page,work,sqlLog}){
  const editor=page.locator('.tab-page:visible .editor-area .monaco-editor');
  const edit=async text=>{await editor.click();await page.keyboard.press('Control+a');await page.keyboard.insertText(text);await page.keyboard.press('Escape');};
  const content=()=>page.evaluate(()=>window.querydesk.call('workspace.get').then(w=>w.tabs.find(t=>t.id===w.activeId)?.sql));
  const pick=async(title,query)=>{const input=page.getByRole('combobox',{name:title+'搜索'});await expect(input).toBeFocused();await input.fill(query);};
  await page.getByRole('button',{name:'新建查询',exact:true}).click();await expect(editor).toBeVisible();
  await edit('SELECT 1;\nSELECT 2;');await page.keyboard.press('Control+Home');await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect.poll(content).toBe('SELECT 2;\nSELECT 1;');await page.keyboard.press('Control+z');await expect.poll(content).toBe('SELECT 1;\nSELECT 2;');
  await edit('select name from customers');await page.keyboard.press('Control+a');await page.keyboard.press('Control+Shift+u');await expect.poll(content).toBe('SELECT NAME FROM CUSTOMERS');
  await page.keyboard.press('Control+z');await expect.poll(content).toBe('select name from customers');
  await edit('SELECT 1\nFROM customers;');await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+a');await pick('查找操作','合并行');await page.keyboard.press('Enter');await expect.poll(content).toBe('SELECT 1 FROM customers;');
  await edit('SELECT\n  id,\n  name\nFROM customers;');await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Minus');await expect(editor.locator('.codicon-folding-collapsed')).toHaveCount(1);await page.keyboard.press('Control+Shift+Equal');await expect(editor.locator('.codicon-folding-collapsed')).toHaveCount(0);
  await edit('name name name');await page.keyboard.press('Control+Home');await page.keyboard.press('Alt+j');await page.keyboard.press('Alt+j');await page.keyboard.insertText('id');await expect.poll(content).toBe('id id name');
  await edit('SELECT 1\nFROM customers\nWHERE id = 1;');await page.keyboard.press('Control+Home');await page.keyboard.press('Control+f');await expect(editor.locator('.find-widget')).toHaveClass(/visible/);await page.keyboard.press('Escape');
  const beforeNavigate=sqlLog.length;
  await page.keyboard.press('Control+F12');await pick('当前 SQL 结构','FROM');await expect(page.getByRole('option')).toHaveCount(2);await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toHaveCount(0);await page.keyboard.insertText('/*定位*/');await expect.poll(content).toBe('SELECT 1\n/*定位*/FROM customers\nWHERE id = 1;');assert.equal(sqlLog.length,beforeNavigate);
  await edit("SELECT 'needle_keymap_2026';\nSELECT 'second_marker';");
  const firstTitle=await page.locator('.ant-tabs-tab-active .tab-name').innerText();
  const tabs=await page.locator('.workspace-tabs .ant-tabs-tab').count();await page.keyboard.press('Control+Shift+F10');await expect(page.locator('.workspace-tabs .ant-tabs-tab')).toHaveCount(tabs+1);await expect(editor).toBeVisible();await editor.click();
  await page.keyboard.press('Control+Shift+f');await pick('在所有 SQL 标签中查找','needle_keymap_2026');await expect(page.getByRole('option')).toHaveCount(1);
  const queries=sqlLog.length;await page.keyboard.press('Control+Enter');assert.equal(sqlLog.length,queries);await page.keyboard.press('Control+F4');await expect(page.locator('.workspace-tabs .ant-tabs-tab')).toHaveCount(tabs+1);
  await page.keyboard.press('Enter');await expect(page.locator('.ant-tabs-tab-active .tab-name')).toHaveText(firstTitle);await expect(page.getByRole('dialog')).toHaveCount(0);await page.keyboard.insertText('replaced_marker');await expect.poll(content).toBe("SELECT 'replaced_marker';\nSELECT 'second_marker';");assert.equal(sqlLog.filter(sql=>/needle_keymap_2026|second_marker|replaced_marker/.test(sql)).length,0);
  await page.keyboard.press('Control+e');await pick('最近打开的标签',firstTitle);await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  await editor.click();await page.keyboard.press('Control+Shift+a');await pick('查找操作','大小写');await page.keyboard.press('Escape');
  await editor.click();await page.keyboard.press('Control+n');await pick('搜索数据库对象','客户');await expect(page.getByRole('option')).toContainText('customers');
  await page.keyboard.press('Enter');await expect(page.locator('.tab-page:visible .data-browser')).toBeVisible();
  const cell=page.locator('.tab-page:visible .ag-cell[col-id="name"]').first();await expect(cell).toContainText('陈小北');await cell.click();
  const gridQueries=sqlLog.length;
  await page.keyboard.press('Control+f');await pick('查找已加载数据','林夏');await expect(page.getByRole('option')).toHaveCount(1);await page.keyboard.press('Enter');await expect(page.locator('.tab-page:visible .ag-cell-focus')).toHaveText('林夏');assert.equal(sqlLog.length,gridQueries);
  await page.keyboard.press('Control+F12');await pick('字段列表','balance');await expect(page.getByRole('option')).toHaveCount(1);await page.keyboard.press('Enter');await expect(page.locator('.tab-page:visible .ag-cell-focus')).toHaveAttribute('col-id','balance');assert.equal(sqlLog.length,gridQueries);
  await page.getByRole('button',{name:'快捷键',exact:true}).click();await page.getByRole('textbox',{name:'搜索快捷键'}).fill('Ctrl+F12');await expect(page.getByRole('dialog').locator('.ant-table-tbody .ant-table-row')).toHaveCount(1);await page.keyboard.press('Escape');
  await page.locator('.tab-page:visible .ag-cell[col-id="name"]').first().click();await page.keyboard.press('Control+F12');await pick('字段列表','');await page.screenshot({path:path.join(work,'expanded-keymap.png')});await page.keyboard.press('Escape');
  return ['新增行移动大小写及撤销键位','多光标 Alt+J 实际编辑多个匹配项','Ctrl+F SQL 查找与 Escape','Ctrl+F12 SQL 子句导航且不执行','Ctrl+Shift+F 跨标签匹配选中替换且不执行','搜索弹窗隔离执行关闭快捷键','Ctrl+Shift+F10 新建控制台与 Ctrl+E 最近标签','Ctrl+Shift+A 中文操作搜索及执行合并行','DataGrip 折叠区域与展开全部','Ctrl+N 注释搜索对象并回车打开数据','Ctrl+F 表格本地查找不查询数据库','Ctrl+F12 字段筛选与焦点定位','快捷键帮助按键位过滤'];
}
