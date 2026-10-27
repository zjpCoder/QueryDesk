import { qualified, quoteId } from './sql';
import type { Cell, Column, Dialect, Filter, TableDef } from './types';

export function valuePlaceholder(dialect:Dialect,column:Column,name:string){
  if(dialect==='oracle'){
    if(column.type==='DATE')return `TO_DATE(:${name}, 'YYYY-MM-DD HH24:MI:SS')`;
    if(/^TIMESTAMP.*TIME ZONE/.test(column.type))return `TO_TIMESTAMP_TZ(:${name}, 'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM')`;
    if(/^TIMESTAMP/.test(column.type))return `TO_TIMESTAMP(:${name}, 'YYYY-MM-DD HH24:MI:SS.FF')`;
  }
  return `:${name}`;
}
export function tableSelect(def:TableDef,dialect:Dialect,filters:Filter[]=[],mode:'and'|'or'='and',sort?:{column:string;direction:'asc'|'desc'}){
  if(filters.length>20||!['and','or'].includes(mode))throw new Error('筛选条件无效');
  const values:Record<string,Cell>={};
  const conditions=filters.map((f,i)=>{
    const column=def.columns.find(c=>c.name===f.column);if(!column)throw new Error('筛选字段不存在');
    const q=quoteId(column.name,dialect),key=`f${i}`;
    if(f.op==='is null'||f.op==='is not null')return `${q} ${f.op.toUpperCase()}`;
    if(!['=','<>','>','<','>=','<=','contains'].includes(f.op))throw new Error('筛选操作无效');
    values[key]=f.op==='contains'?'%'+f.value.replace(/[!%_]/g,c=>'!'+c)+'%':f.value;
    return `${q} ${f.op==='contains'?'LIKE':f.op} ${valuePlaceholder(dialect,column,key)}${f.op==='contains'?" ESCAPE '!'":''}`;
  });
  if(sort&&(!def.columns.some(c=>c.name===sort.column)||!['asc','desc'].includes(sort.direction)))throw new Error('排序字段或方向无效');
  const order=sort?`${quoteId(sort.column,dialect)} ${sort.direction}`:def.columns.filter(c=>c.primary).map(c=>quoteId(c.name,dialect)).join(', ');
  return {sql:`SELECT ${def.columns.map(c=>quoteId(c.name,dialect)).join(', ')} FROM ${qualified(def.schema,def.name,dialect)}${conditions.length?' WHERE ('+conditions.join(mode==='or'?' OR ':' AND ')+')':''}${order?' ORDER BY '+order:''}`,values};
}
