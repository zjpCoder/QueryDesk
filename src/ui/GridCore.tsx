import { forwardRef, useRef, useState } from 'react';
import type { GridApi } from 'ag-grid-community';
import { QuickPick, type PickItem } from './QuickPick';
import { shortcut, consume } from './shortcuts';
import { matchesSearch } from '../shared/navigation';
import { AgGridReact } from 'ag-grid-react';
import { colorSchemeDark, themeQuartz, ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import type { AgGridReactProps } from 'ag-grid-react';
ModuleRegistry.registerModules([AllCommunityModule]);
export const Grid = forwardRef<AgGridReact, AgGridReactProps & { dark: boolean }>(function Grid({ dark, ...props }, ref) {
  const api=useRef<GridApi|null>(null),[picker,setPicker]=useState<'find'|'columns'>();
  function items(query:string):PickItem[]{
    const grid=api.current;if(!grid||grid.isDestroyed())return [];
    const columns=grid.getAllDisplayedColumns().filter(c=>!c.getColId().startsWith('ag-Grid'));
    const result:PickItem[]=[];
    const focus=(row:number,column:string)=>{grid.ensureColumnVisible(column);if(grid.getDisplayedRowCount()){const index=Math.min(row,grid.getDisplayedRowCount()-1);grid.ensureIndexVisible(index,'middle');grid.setFocusedCell(index,column);}}
    if(picker==='columns')return columns.filter(c=>matchesSearch(query,c.getColDef().headerName,c.getColId(),c.getColDef().headerTooltip)).map(c=>({id:c.getColId(),label:c.getColDef().headerName??c.getColId(),detail:c.getColDef().headerTooltip,run:()=>focus(grid.getFocusedCell()?.rowIndex??0,c.getColId())}));
    if(!query)return [];
    for(let row=0;row<grid.getDisplayedRowCount()&&result.length<200;row++){
      const node=grid.getDisplayedRowAtIndex(row);if(!node)continue;
      for(const column of columns){
        const value=grid.getCellValue({rowNode:node,colKey:column,useFormatter:true});
        if(matchesSearch(query,String(value??''))){const rowIndex=row;result.push({id:`${row}:${column.getColId()}`,label:`第 ${row+1} 行 · ${column.getColDef().headerName??column.getColId()}`,detail:String(value??'').slice(0,240),run:()=>focus(rowIndex,column.getColId())});if(result.length>=200)break;}
      }
    }return result;
  }
  const theme = (dark ? themeQuartz.withPart(colorSchemeDark) : themeQuartz).withParams({ fontFamily: "'Segoe UI', 'Microsoft YaHei', sans-serif", fontSize: 12, headerFontSize: 11, rowHeight: 34, headerHeight: 36, borderColor: dark ? '#2a303c' : '#e3e7ee', backgroundColor: dark ? '#141820' : '#ffffff', foregroundColor: dark ? '#d9dee7' : '#25304a', headerBackgroundColor: dark ? '#1b202a' : '#f4f6fa', accentColor: '#8b86fc', selectedRowBackgroundColor: dark ? '#30304c' : '#edecff' });
  return <div style={{height:'100%',minHeight:0}} onKeyDownCapture={event=>{
    if((event.target as HTMLElement).closest('.ant-modal')||api.current?.getEditingCells().length)return;
    if(shortcut(event,'KeyF',true)){consume(event);setPicker('find');}
    else if(shortcut(event,'F12',true)){consume(event);setPicker('columns');}
  }}><AgGridReact ref={ref} theme={theme} localeText={{noRowsToShow:'暂无数据',loadingOoo:'正在加载…',selectAll:'全选',searchOoo:'搜索…',sortAscending:'升序',sortDescending:'降序',sortUnSort:'取消排序',ariaRowSelect:'选择此行',ariaRowDeselect:'取消选择此行',ariaHeaderSelection:'选择全部行'}} defaultColDef={{ resizable: true, minWidth: 110, width: 160, sortable: true, suppressHeaderMenuButton: true, cellClassRules: { 'null-value': p => p.value === null }, valueFormatter: p => p.value === null ? 'NULL' : p.value === undefined ? '' : String(p.value) }} animateRows={false} enableCellTextSelection ensureDomOrder suppressCellFocus={false} {...props} onGridReady={event=>{api.current=event.api;props.onGridReady?.(event);}} />
    {picker&&<QuickPick title={picker==='find'?'查找已加载数据':'字段列表'} hint={picker==='find'?'仅查找当前表格已加载的行，不查询数据库、不改变筛选':'选择字段后定位对应列'} items={items} onClose={()=>setPicker(undefined)}/>}
  </div>;
});
