import { contextBridge, ipcRenderer } from 'electron';
import type { ExtendedMethod, QueryDeskAPI } from '../src/shared/types';
const api: QueryDeskAPI = {
  async call<T>(method: ExtendedMethod, payload?: unknown): Promise<T> {
    const r = await ipcRenderer.invoke('querydesk:call', method, payload ?? {});
    if (!r.ok) throw new Error(r.error); return r.value as T;
  },
  onAI(listener) { const callback = (_: unknown, data: Parameters<typeof listener>[0]) => listener(data); ipcRenderer.on('querydesk:ai', callback); return () => ipcRenderer.removeListener('querydesk:ai', callback); },
  onExport(listener) { const callback = (_: unknown, data: Parameters<typeof listener>[0]) => listener(data); ipcRenderer.on('querydesk:export', callback); return () => ipcRenderer.removeListener('querydesk:export', callback); },
  onClose(listener) { const callback = () => listener(); ipcRenderer.on('querydesk:close', callback); return () => ipcRenderer.removeListener('querydesk:close', callback); },
  confirmClose() { ipcRenderer.send('querydesk:close-confirmed'); }
};
contextBridge.exposeInMainWorld('querydesk', api);
