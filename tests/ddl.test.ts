import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDDL, tableFingerprint } from '../src/shared/ddl';
import type { TableDef } from '../src/shared/types';
const table = ():TableDef=>({schema:'app',name:'orders',comment:"订单's",columns:[{name:'id',type:'BIGINT',nullable:false,defaultValue:'',comment:'编号',primary:true},{name:'label',type:'VARCHAR(100)',nullable:true,defaultValue:"'draft'",comment:'名称',primary:false}],indexes:[{name:'uq_label',columns:['label'],unique:true}],foreignKeys:[]});
test('MySQL 建表包括注释、默认值、主键和唯一索引',()=>{
  const plan=buildDDL(null,table(),'mysql'); assert.match(plan.statements[0],/PRIMARY KEY \(`id`\)/);assert.match(plan.statements[0],/COMMENT='订单''s'/);assert.match(plan.statements[1],/CREATE UNIQUE INDEX/);assert.equal(plan.warnings.length,1);
});
test('Oracle 11g 建表不生成 IDENTITY，并单独设置注释',()=>{
  const def=table();def.columns[0].type='NUMBER(19)';def.columns[1].type='VARCHAR2(100 CHAR)';const plan=buildDDL(null,def,'oracle');assert.ok(!plan.statements.join('\n').includes('IDENTITY'));assert.match(plan.statements[0],/"id" NUMBER\(19\)/);assert.ok(plan.statements.some(s=>s.startsWith('COMMENT ON TABLE')));
});
test('删除字段和缩短类型发出数据损失提示',()=>{const before=table(),after=table();after.columns.splice(1,1);after.indexes=[];after.columns[0].type='INT';const p=buildDDL(before,after,'mysql');assert.ok(p.warnings.some(w=>w.includes('删除字段 label')));assert.ok(p.warnings.some(w=>w.includes('类型')));assert.ok(p.statements[0].startsWith('DROP INDEX'));});
test('相同结构无变更；元数据约束顺序不产生冲突',()=>{const before=table();assert.equal(buildDDL(before,structuredClone(before),'mysql').statements.length,0);const copy=structuredClone(before);copy.indexes.reverse();assert.equal(tableFingerprint(copy),tableFingerprint(before));});
test('外键按照字段顺序生成并处理删除行为',()=>{const def=table();def.foreignKeys=[{name:'fk_test',columns:['label'],refSchema:'app',refTable:'labels',refColumns:['name'],onDelete:'SET NULL'}];assert.match(buildDDL(null,def,'mysql').statements[0],/FOREIGN KEY \(`label`\) REFERENCES `app`.`labels` \(`name`\) ON DELETE SET NULL/);});
test('阻止类型和默认值中的多语句注入',()=>{const def=table();def.columns[0].type='INT); DROP TABLE users; --';assert.throws(()=>buildDDL(null,def,'mysql'),/类型/);def.columns[0].type='BIGINT';def.columns[0].defaultValue='0); DROP TABLE users;';assert.throws(()=>buildDDL(null,def,'mysql'),/表达式/);});
test('阻止重复字段、无效引用和 Oracle 过长标识符',()=>{const def=table();def.columns[1].name='ID';assert.throws(()=>buildDDL(null,def,'mysql'),/重复/);const bad=table();bad.indexes[0].columns=['missing'];assert.throws(()=>buildDDL(null,bad,'mysql'),/不存在/);const ora=table();ora.name='表'.repeat(11);assert.throws(()=>buildDDL(null,ora,'oracle'),/30 字节/);});
test('已有生成列变更被拒绝，不会覆盖生成表达式',()=>{const a=table();a.columns[0].generated=true;const b=structuredClone(a);b.columns[0].type='INT';assert.throws(()=>buildDDL(a,b,'mysql'),/生成列/);});
test('Oracle 唯一索引配套可被外键引用的唯一约束',()=>{const t=table();t.columns[0].type='NUMBER(19)';t.columns[1].type='VARCHAR2(100 CHAR)';const statements=buildDDL(null,t,'oracle').statements;assert.ok(statements.some(s=>s.includes('ADD CONSTRAINT "uq_label" UNIQUE')));const a=structuredClone(t);a.indexes[0].constraintName='uq_constraint';const b=structuredClone(a);b.indexes=[];const remove=buildDDL(a,b,'oracle').statements;assert.equal(remove[0],'ALTER TABLE "app"."orders" DROP CONSTRAINT "uq_constraint" KEEP INDEX');assert.match(remove[1],/^DROP INDEX/);});
