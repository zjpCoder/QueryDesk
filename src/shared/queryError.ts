import { maskSql, type Statement } from './sql';
import type { Dialect, QueryFailure } from './types';

export function queryFailure(message:string,part:Statement,index:number,dialect:Dialect):QueryFailure{
  const masked=maskSql(part.sql,dialect);
  const params=[...masked.matchAll(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g)];
  const driverSql=params.reduceRight((s,m)=>s.slice(0,m.index)+'?'+s.slice(m.index!+m[0].length),part.sql);
  const oracle=/ORA-06550:\s*(?:line\s+(\d+),\s*column\s+(\d+)|第\s*(\d+)\s*行[,，]\s*第\s*(\d+)\s*列)/i.exec(message);
  const mysql=/\bat line (\d+)\s*$/i.exec(message);
  const line=Number(oracle?.[1]??oracle?.[3]??mysql?.[1]),column=Number(oracle?.[2]??oracle?.[4]);
  const lines=driverSql.split('\n');
  if(!line||line>lines.length)return {statementIndex:index+1,offset:part.start+Math.max(0,masked.search(/\S/)),precision:'statement'};
  let driverOffset=lines.slice(0,line-1).reduce((n,l)=>n+l.length+1,0);
  if(column&&column<=lines[line-1].length+1)driverOffset+=column-1;
  let offset=driverOffset,removed=0;
  for(const param of params){const bound=param.index!-removed;if(driverOffset<=bound)break;offset+=param[0].length-1;removed+=param[0].length-1;}
  return {statementIndex:index+1,offset:part.start+offset,precision:column&&column<=lines[line-1].length+1?'column':'line'};
}
