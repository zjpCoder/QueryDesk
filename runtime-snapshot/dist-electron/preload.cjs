"use strict";

// electron/preload.ts
var import_electron = require("electron");
var api = {
  async call(method, payload) {
    const r = await import_electron.ipcRenderer.invoke("querydesk:call", method, payload ?? {});
    if (!r.ok) throw new Error(r.error);
    return r.value;
  },
  onAI(listener) {
    const callback = (_, data) => listener(data);
    import_electron.ipcRenderer.on("querydesk:ai", callback);
    return () => import_electron.ipcRenderer.removeListener("querydesk:ai", callback);
  },
  onExport(listener) {
    const callback = (_, data) => listener(data);
    import_electron.ipcRenderer.on("querydesk:export", callback);
    return () => import_electron.ipcRenderer.removeListener("querydesk:export", callback);
  },
  onClose(listener) {
    const callback = () => listener();
    import_electron.ipcRenderer.on("querydesk:close", callback);
    return () => import_electron.ipcRenderer.removeListener("querydesk:close", callback);
  },
  confirmClose() {
    import_electron.ipcRenderer.send("querydesk:close-confirmed");
  }
};
import_electron.contextBridge.exposeInMainWorld("querydesk", api);
//# sourceMappingURL=preload.cjs.map
