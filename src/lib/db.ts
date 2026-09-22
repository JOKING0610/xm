// IndexedDB Promise 封装（不依赖第三方库）
// 库名 xingmeng，版本 2，包含两个 objectStore：
//  - conversations（keyPath 'id'）
//  - settings（keyPath 'key'，存 { key, value } 结构）
//
// 容错：若 IndexedDB 不可用（非安全上下文、隐私模式禁用、浏览器限制等），
// 自动回退到 localStorage（键前缀 xingmeng:<store>:<key>），对外接口保持不变。
import type { ProviderId } from '../types';

const DB_NAME = 'xingmeng';
// v2：会话数据结构可能不兼容（历史版本遗留的字段缺失），升级时丢弃旧 store 重建
const DB_VERSION = 2;

const LS_PREFIX = 'xingmeng:';

let dbPromise: Promise<IDBDatabase> | null = null;
// IndexedDB 是否可用；初始按能力检测，运行时打开/操作失败也会置 false 永久回退
let idbUsable: boolean | null = null;

function idbAvailable(): boolean {
  if (idbUsable === null) {
    try {
      idbUsable =
        typeof indexedDB !== 'undefined' && typeof IDBKeyRange !== 'undefined';
    } catch {
      idbUsable = false;
    }
  }
  return idbUsable;
}

/** 打开（或复用）数据库连接；首次打开创建两个 store，版本升级时重建 */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;
      // 来自旧版本的库（结构不再兼容）→ 删除旧 store 重建，避免脏数据流入
      if (oldVersion > 0 && oldVersion < DB_VERSION) {
        if (db.objectStoreNames.contains('conversations')) {
          db.deleteObjectStore('conversations');
        }
        if (db.objectStoreNames.contains('settings')) {
          db.deleteObjectStore('settings');
        }
      }
      if (!db.objectStoreNames.contains('conversations')) {
        db.createObjectStore('conversations', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/* ---------------- localStorage 实现 ---------------- */

/** 从入库对象中取主键：conversations 用 id，settings 用 key */
function primaryKeyOf(value: unknown): string {
  const v = value as { id?: string; key?: string };
  return (v.id ?? v.key ?? '') as string;
}

function lsGet<T>(store: string, key: string): T | undefined {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${store}:${key}`);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function lsPut(store: string, value: unknown): void {
  localStorage.setItem(
    `${LS_PREFIX}${store}:${primaryKeyOf(value)}`,
    JSON.stringify(value),
  );
}

function lsAll<T>(store: string): T[] {
  const prefix = `${LS_PREFIX}${store}:`;
  const out: T[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        const raw = localStorage.getItem(k);
        if (raw) {
          try {
            out.push(JSON.parse(raw) as T);
          } catch {
            /* 忽略损坏记录 */
          }
        }
      }
    }
  } catch {
    /* localStorage 不可用则返回空 */
  }
  return out;
}

function lsClear(store: string): void {
  const prefix = `${LS_PREFIX}${store}:`;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
}

function lsDelete(store: string, key: string): void {
  localStorage.removeItem(`${LS_PREFIX}${store}:${key}`);
}

/* ---------------- 对外接口（带回退） ---------------- */

/** 按主键读取单条记录；不存在则返回 undefined */
export async function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  if (!idbAvailable()) return lsGet<T>(store, key);
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    idbUsable = false;
    dbPromise = null;
    return lsGet<T>(store, key);
  }
}

/** 写入单条记录（覆盖相同主键） */
export async function dbPut<T>(store: string, value: T): Promise<void> {
  if (!idbAvailable()) {
    lsPut(store, value);
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    idbUsable = false;
    dbPromise = null;
    lsPut(store, value);
  }
}

/** 读取 store 内全部记录 */
export async function dbAll<T>(store: string): Promise<T[]> {
  if (!idbAvailable()) return lsAll<T>(store);
  try {
    const db = await openDb();
    return await new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    idbUsable = false;
    dbPromise = null;
    return lsAll<T>(store);
  }
}

/** 清空 store */
export async function dbClear(store: string): Promise<void> {
  if (!idbAvailable()) {
    lsClear(store);
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    idbUsable = false;
    dbPromise = null;
    lsClear(store);
  }
}

/** 按主键删除单条记录 */
export async function dbDelete(store: string, key: string): Promise<void> {
  if (!idbAvailable()) {
    lsDelete(store, key);
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    idbUsable = false;
    dbPromise = null;
    lsDelete(store, key);
  }
}

// 导出该类型以澄清 settings 的 value 约定为 { model: ProviderId }
export interface SettingsRecord {
  key: 'global';
  value: { model: ProviderId };
}