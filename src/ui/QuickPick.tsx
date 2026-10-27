import { useEffect, useRef, useState } from 'react';
import { Input, Modal } from 'antd';
import type { InputRef } from 'antd';
import { consume } from './shortcuts';

export interface PickItem { id:string; label:string; detail?:string; run:()=>void; }
export function QuickPick({title, hint, items, onClose}: {title:string; hint:string; items:(query:string)=>PickItem[]; onClose:()=>void}) {
  const [query,setQuery]=useState(''),[index,setIndex]=useState(0);
  const previousFocus=useRef(document.activeElement as HTMLElement|null);
  const input=useRef<InputRef>(null), list=useRef<HTMLDivElement>(null);
  const rows=items(query).slice(0,200), selected=Math.min(index,Math.max(0,rows.length-1));
  useEffect(()=>{list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[selected,query]);
  function choose(item:PickItem){onClose();requestAnimationFrame(item.run);}
  return <Modal open title={title} footer={null} width={760} onCancel={()=>{onClose();requestAnimationFrame(()=>previousFocus.current?.isConnected&&previousFocus.current.focus());}} focusTriggerAfterClose={false} afterOpenChange={open=>{if(open)input.current?.focus();}}>
    <p className="muted">{hint} · ↑↓ 选择，Enter 打开，Esc 关闭 · 最多显示 200 项</p>
    <Input ref={input} autoFocus aria-label={title+'搜索'} placeholder="输入名称、关键字或快捷键…" value={query} onChange={e=>{setQuery(e.target.value);setIndex(0);}} role="combobox" aria-expanded aria-controls="quick-pick-list" aria-activedescendant={rows.length?`quick-pick-${selected}`:undefined} onKeyDown={e=>{
      if(e.nativeEvent.isComposing||e.keyCode===229)return;
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){consume(e);setIndex(rows.length?(selected+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length:0);}
      else if(e.key==='Enter'&&!e.repeat&&!e.ctrlKey&&!e.altKey&&!e.shiftKey){consume(e);if(rows[selected])choose(rows[selected]);}
    }}/>
    <div id="quick-pick-list" className="quick-pick-list" role="listbox" ref={list} aria-label={title}>
      {rows.map((row,i)=><button id={`quick-pick-${i}`} type="button" key={row.id} role="option" aria-selected={selected===i} tabIndex={-1} className="quick-pick-item" onClick={()=>choose(row)}><strong>{row.label}</strong><small>{row.detail}</small></button>)}
      {!rows.length&&<p className="muted">{query?'没有匹配项':'输入内容开始搜索'}</p>}
    </div>
  </Modal>;
}
