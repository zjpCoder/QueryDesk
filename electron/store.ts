import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AISettings, ConnectionProfile, Settings } from '../src/shared/types';
type StoredProfile = ConnectionProfile & { secret?: string };
type Stored = Omit<Settings, 'connections' | 'ai'> & { connections: StoredProfile[]; ai: AISettings & { secret?: string } };
export class Store {
  data: Stored;
  private file: string;
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(this.file)) {
      try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (!Array.isArray(this.data.connections) || !this.data.ai) throw new Error(); }
      catch { throw new Error('配置文件无法读取。请备份并检查应用数据目录中的 settings.json；原文件未覆盖。'); }
    } else this.data = { connections: [], ai: { baseUrl: 'https://api.openai.com/v1', model: '' }, theme: 'dark', history: [] };
  }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2), 'utf8'); fs.renameSync(this.file + '.tmp', this.file); }
  encrypt(value: string) { if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密不可用，未保存密钥'); return safeStorage.encryptString(value).toString('base64'); }
  decrypt(value?: string) { if (!value) return ''; try { return safeStorage.decryptString(Buffer.from(value, 'base64')); } catch { throw new Error('无法解密凭据，请在当前 Windows 账户下重新输入'); } }
  public(): Settings {
    return { ...this.data, connections: this.data.connections.map(({ secret, password, ...p }) => ({ ...p, hasPassword: !!secret })), ai: { baseUrl: this.data.ai.baseUrl, model: this.data.ai.model, hasKey: !!this.data.ai.secret } };
  }
  connection(id: string) { const p = this.data.connections.find(c => c.id === id); if (!p) throw new Error('连接不存在'); const { secret, ...rest } = p; return { ...rest, password: this.decrypt(secret) }; }
  saveConnection(p: ConnectionProfile) {
    const index = this.data.connections.findIndex(c => c.id === p.id); const old = this.data.connections[index];
    const { password, hasPassword, ...rest } = p;
    const value = { ...rest, secret: password === undefined ? old?.secret : password ? this.encrypt(password) : undefined };
    if (index < 0) this.data.connections.push(value); else this.data.connections[index] = value; this.save(); return this.public();
  }
  ai() { return { baseUrl: this.data.ai.baseUrl, model: this.data.ai.model, apiKey: this.decrypt(this.data.ai.secret) }; }
  saveAI(p: AISettings) { this.data.ai = { baseUrl: p.baseUrl, model: p.model, secret: p.apiKey === undefined ? this.data.ai.secret : p.apiKey ? this.encrypt(p.apiKey) : undefined }; this.save(); return this.public(); }
}
