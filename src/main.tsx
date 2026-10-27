import React from 'react';
import ReactDOM from 'react-dom/client';
import { unstableSetRender } from 'antd';
import { App } from './ui/App';
import './style.css';
// Ant Design 5 的静态确认框和消息需要显式使用 React 19 的客户端渲染入口。
const roots = new WeakMap<Element | DocumentFragment, ReturnType<typeof ReactDOM.createRoot>>();
unstableSetRender((node, container) => {
  const root = roots.get(container) ?? ReactDOM.createRoot(container);
  roots.set(container, root);
  root.render(node);
  return async () => { await new Promise(resolve => setTimeout(resolve, 0)); root.unmount(); roots.delete(container); };
});
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
