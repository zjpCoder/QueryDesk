import type { DBObject, Dialect, TableDef } from './types';
import { quoteId, splitSql } from './sql';

type Token = { text:string; upper:string; start:number; end:number; depth:number; quoted:boolean; literal:boolean };
export type Suggestion = { label:string; insertText:string; kind:'keyword'|'snippet'|'table'|'field'|'function'; detail:string; priority:number };
const common = 'SELECT FROM WHERE JOIN LEFT RIGHT INNER OUTER CROSS ON AS AND OR NOT NULL IS IN EXISTS BETWEEN LIKE DISTINCT GROUP BY ORDER HAVING ASC DESC UNION ALL INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP INDEX VIEW WITH CASE WHEN THEN ELSE END COUNT SUM AVG MIN MAX COALESCE CAST'.split(' ');
const dialectWords:Record<Dialect,string[]> = {
  mysql: 'LIMIT OFFSET SHOW EXPLAIN DATABASE USE IFNULL NOW CONCAT DATE_FORMAT REPLACE TRUNCATE'.split(' '),
  oracle: 'ROWNUM SYSDATE SYSTIMESTAMP DUAL NVL NVL2 DECODE TO_CHAR TO_DATE TO_NUMBER MERGE USING MINUS CONNECT START PRIOR NOCYCLE SEQUENCE PACKAGE PROCEDURE RETURNING'.split(' ')
};
const reserved = new Set([...common, ...dialectWords.mysql, ...dialectWords.oracle]);
const isName = (t:Token|undefined):t is Token => !!t && (t.quoted || /^[\p{L}_][\p{L}\p{N}_$#]*$/u.test(t.text) && !reserved.has(t.upper));
const same = (a:string,b:string) => a.toUpperCase()===b.toUpperCase();

// ponytail: 宽容词法扫描仅用于候选与提示，不承担 SQL 语法校验；复杂 CTE/相关子查询仍交给数据库解析。
function scan(sql:string,dialect:Dialect) {
  const tokens:Token[]=[]; const hidden:{start:number;end:number;open:boolean}[]=[];
  let i=0,depth=0;
  while(i<sql.length){
    const start=i,c=sql[i];
    if(/\s/.test(c)){i++;continue;}
    if(sql.startsWith('--',i)||dialect==='mysql'&&c==='#'){
      const end=sql.indexOf('\n',i);i=end<0?sql.length:end;hidden.push({start,end:i,open:end<0});continue;
    }
    if(sql.startsWith('/*',i)){
      const end=sql.indexOf('*/',i+2);i=end<0?sql.length:end+2;hidden.push({start,end:i,open:end<0});continue;
    }
    let text='',quoted=false,literal=false;
    if(dialect==='oracle'&&/[qQ]/.test(c)&&sql[i+1]==="'"&&sql[i+2]){
      const open=sql[i+2],close=({'[':']','{':'}','(':')','<':'>'} as Record<string,string>)[open]??open;
      const end=sql.indexOf(close+"'",i+3);i=end<0?sql.length:end+2;text='?';literal=true;hidden.push({start,end:i,open:end<0});
    }else if(c==="'"||c==='"'||c==='`'){
      quoted=c!=="'";literal=!quoted;let closed=false;i++;
      while(i<sql.length){
        if(dialect==='mysql'&&sql[i]==='\\'){text+=sql.slice(i,i+2);i+=2;continue;}
        if(sql[i]===c){if(sql[i+1]===c){text+=c;i+=2;continue;}i++;closed=true;break;}
        text+=sql[i++];
      }
      if(literal||!closed)hidden.push({start,end:i,open:!closed});
      if(literal)text='?';
    }else{
      const word=/^[\p{L}\p{N}_$#]+/u.exec(sql.slice(i));text=word?.[0]??c;i+=text.length;
    }
    if(text===')')depth=Math.max(0,depth-1);
    tokens.push({text,upper:quoted?text:text.toUpperCase(),start,end:i,depth,quoted,literal});
    if(text==='(')depth++;
  }
  return {tokens,hidden};
}

export function completionContext(sql:string,offset:number,dialect:Dialect,objects:DBObject[],schema='') {
  const {tokens,hidden}=scan(sql,dialect);
  const prefix=/[\p{L}\p{N}_$#]*$/u.exec(sql.slice(0,offset))?.[0]??'';
  const start=offset-prefix.length;
  const blocked=hidden.some(h=>offset>h.start&&(offset<h.end||h.open&&offset===h.end));
  const prevSemi=tokens.filter(t=>t.text===';'&&t.end<=start).at(-1)?.end??0;
  const nextSemi=tokens.find(t=>t.text===';'&&t.start>=offset)?.start??sql.length;
  let statement=tokens.filter(t=>t.start>=prevSemi&&t.start<nextSemi);
  const before=statement.filter(t=>t.end<=start);
  const depth=before.reduce((d,t)=>t.text==='('?t.depth+1:t.depth,0);
  const query=before.filter(t=>!t.quoted&&t.upper==='SELECT'&&t.depth<=depth).at(-1);
  if(query){
    const end=statement.find(t=>t.start>query.start&&t.depth<query.depth)?.start??nextSemi;
    statement=statement.filter(t=>t.start>=query.start&&t.start<end&&t.depth===query.depth);
  }
  const prior=statement.filter(t=>t.end<=start),last=prior.at(-1);
  const qualifier=last?.text==='.'?prior.at(-2)?.text:undefined;
  const relevant=last?.text==='.'?prior.slice(0,-2):prior;
  const tail=relevant.at(-1)?.upper??'';
  const clause=relevant.filter(t=>!t.quoted&&['SELECT','FROM','JOIN','WHERE','ON','SET','HAVING','ORDER','GROUP','VALUES','UPDATE','INTO'].includes(t.upper)).at(-1)?.upper??'';
  const tablePosition=['FROM','JOIN','UPDATE','INTO'].includes(tail)||tail===','&&clause==='FROM';
  const references:{object:DBObject;alias:string;aliasSql:string}[]=[];
  for(let n=0;n<statement.length;n++){
    const t=statement[n];
    if(t.quoted||!['FROM','JOIN','UPDATE','INTO'].includes(t.upper))continue;
    let j=n+1;
    do {
      let name=statement[j++];if(!isName(name))break;
      let owner='';if(statement[j]?.text==='.'){owner=name.text;name=statement[j+1];j+=2;if(!isName(name))break;}
      if(statement[j]?.upper==='AS')j++;
      const aliasToken=isName(statement[j])?statement[j++]:name;
      const alias=aliasToken.text,aliasSql=aliasToken.quoted?quoteId(alias,dialect):alias;
      const object=objects.find(o=>['table','view'].includes(o.kind)&&same(o.name,name.text)&&(!owner||same(o.schema,owner))&& (owner||!schema||same(o.schema,schema)));
      if(object)references.push({object,alias,aliasSql});
      if(statement[j]?.text!==',')break;j++;
    }while(j<statement.length);
  }
  return {prefix,start,blocked,qualifier,tablePosition,references,clause,atStart:prior.length===0,tail};
}

export function sqlSuggestions(sql:string,offset:number,dialect:Dialect,objects:DBObject[],tables:TableDef[],schema=''):Suggestion[] {
  const c=completionContext(sql,offset,dialect,objects,schema);if(c.blocked)return [];
  const items:Suggestion[]=[];
  const add=(label:string,insertText:string,kind:Suggestion['kind'],detail:string,priority:number)=>{
    if(label.toUpperCase().startsWith(c.prefix.toUpperCase()))items.push({label,insertText,kind,detail,priority});
  };
  const id=(name:string)=>dialect==='oracle'&&(!/^[A-Z][A-Z0-9_$#]*$/.test(name)||reserved.has(name))||dialect==='mysql'&&(!/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(name)||reserved.has(name.toUpperCase()))?quoteId(name,dialect):name;
  if(!c.qualifier){
    const likely=c.atStart?['SELECT','INSERT','UPDATE','DELETE','WITH','CREATE','ALTER','EXPLAIN']:c.tail==='ORDER'||c.tail==='GROUP'?['BY']:c.clause==='SELECT'?['FROM','AS','DISTINCT']:c.clause==='FROM'||c.clause==='JOIN'?['WHERE','JOIN','LEFT JOIN','INNER JOIN','ON','ORDER BY','GROUP BY']:['AND','OR','ORDER BY','GROUP BY','HAVING'];
    for(const keyword of [...new Set([...common,...dialectWords[dialect],...likely])])add(keyword,keyword,'keyword','SQL 关键字',likely.includes(keyword)?0:4);
    if(c.atStart){
      const templates:[string,string,string][]=[
        ['SELECT · 查询模板','SELECT ${1:*}\nFROM ${2:table_name}\nWHERE ${3:1 = 1};$0','查询字段、表与条件'],
        ['SELECT · 前 200 行',dialect==='oracle'?'SELECT ${1:*}\nFROM ${2:table_name}\nWHERE ROWNUM <= ${3:200};$0':'SELECT ${1:*}\nFROM ${2:table_name}\nLIMIT ${3:200};$0','限制结果行数'],
        ['INSERT · 插入模板','INSERT INTO ${1:table_name} (${2:column_name})\nVALUES (${3:value});$0','指定字段与值'],
        ['UPDATE · 更新模板','UPDATE ${1:table_name}\nSET ${2:column_name} = ${3:value}\nWHERE ${4:condition};$0','请填写 WHERE 条件后再执行'],
        ['DELETE · 删除模板','DELETE FROM ${1:table_name}\nWHERE ${2:condition};$0','请填写 WHERE 条件后再执行']
      ];
      for(const [label,text,detail] of templates)add(label,text,'snippet',`${detail} · Tab 跳转填写`,1);
    }
    if(!c.tablePosition&&!c.atStart){
      for(const name of ['COUNT','SUM','AVG','MIN','MAX','COALESCE',...(dialect==='oracle'?['NVL','TO_CHAR','TO_DATE']:['IFNULL','CONCAT','DATE_FORMAT'])])add(name+'(…)',name+'(${1:expression})$0','function','函数模板 · Tab 填写参数',3);
    }
  }
  if(c.tablePosition){
    for(const o of objects.filter(o=>['table','view'].includes(o.kind)&&(c.qualifier?same(c.qualifier,o.schema):!schema||same(schema,o.schema))))add(o.name,id(o.name),'table',`${o.schema} · ${o.kind==='table'?'表':'视图'} · ${o.comment??''}`,0);
  }else if(!c.atStart){
    const refs=c.references.filter(r=>!c.qualifier||same(c.qualifier,r.alias)||same(c.qualifier,r.object.name));
    for(const r of refs){
      const t=tables.find(t=>same(t.schema,r.object.schema)&&same(t.name,r.object.name));if(!t)continue;
      for(const col of t.columns){
        const ambiguous=!c.qualifier&&refs.length>1;
        const name=ambiguous?`${r.aliasSql}.${id(col.name)}`:id(col.name);
        // 保留字段名用于前缀过滤；同名字段以 detail 和限定名区分。
        add(col.name,name,'field',`${r.alias} · ${col.type} · ${col.comment??''}`,1);
      }
    }
    if(!c.qualifier)for(const o of objects.filter(o=>o.kind==='function'||dialect==='oracle'&&o.kind==='sequence'))add(o.name,id(o.name),o.kind==='function'?'function':'field',`${o.schema} · ${o.kind}`,3);
    if(c.qualifier&&dialect==='oracle')for(const o of objects.filter(o=>o.kind==='sequence'&&same(o.name,c.qualifier!)))for(const pseudo of ['NEXTVAL','CURRVAL'])add(pseudo,pseudo,'field',`${o.name} · 序列值`,0);
  }
  return items.sort((a,b)=>a.priority-b.priority||a.label.localeCompare(b.label));
}

/** 仅提示明显未完成的普通 DML；不要求分号，也不拦截复杂方言/PLSQL。 */
export function incompleteSql(sql:string,dialect:Dialect):string|undefined {
  for(const statement of splitSql(sql,dialect)){
    const tokens=scan(statement.sql,dialect).tokens.filter(t=>t.text!==';');
    const first=tokens[0]?.upper,last=tokens.at(-1);
    if(!first||!['SELECT','INSERT','UPDATE','DELETE','WITH'].includes(first)||!last||last.quoted||last.literal)continue;
    if(['SELECT','FROM','WHERE','JOIN','ON','SET','HAVING','AND','OR','INTO','VALUES','BY','UNION'].includes(last.upper)||[',','=','+','-','/','<','>'].includes(last.text))return `SQL 可能尚未写完：${last.text} 后缺少内容。`;
  }
}
