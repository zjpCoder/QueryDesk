import { lazy, Suspense, type ComponentProps } from 'react';
const Editor = lazy(() => import('./EditorCore').then(m => ({ default: m.SqlEditor })));
const Diff = lazy(() => import('./EditorCore').then(m => ({ default: m.SqlDiff })));
export function SqlEditor(props: ComponentProps<typeof Editor>) {
  return <Suspense fallback={<div className="muted">正在加载 SQL 编辑器…</div>}><Editor {...props}/></Suspense>;
}
export function SqlDiff(props: ComponentProps<typeof Diff>) {
  return <Suspense fallback={<div className="muted">正在加载 SQL 差异…</div>}><Diff {...props}/></Suspense>;
}
