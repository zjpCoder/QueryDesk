import { forwardRef, lazy, Suspense } from 'react';
import type { AgGridReact, AgGridReactProps } from 'ag-grid-react';
const LoadedGrid = lazy(() => import('./GridCore').then(m => ({ default: m.Grid })));
export const Grid = forwardRef<AgGridReact, AgGridReactProps & { dark: boolean }>(function Grid(props, ref) {
  return <Suspense fallback={<div className="muted">正在加载数据表格…</div>}><LoadedGrid {...props} ref={ref}/></Suspense>;
});
