// IndexedDB Promise 封装（不依赖第三方库）
// 库名 xingmeng，版本 2，包含两个 objectStore：
//  - conversations（keyPath 'id'）
//  - settings（keyPath 'key'，存 { key, value } 结构）
import type { ProviderId } from '../types';

const DB_NAME = 'xingmeng';
// v2：会话数据结构可能不兼容（历史版本遗留的字段缺失），升级时丢弃旧 store 重建
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

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

/** 按主键读取单条记录；不存在则返回 undefined */
export async function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

/** 写入单条记录（覆盖相同主键） */
export async function dbPut<T>(store: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 读取 store 内全部记录 */
export async function dbAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

/** 清空 store */
export async function dbClear(store: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 按主键删除单条记录 */
export async function dbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// 导出该类型以澄清 settings 的 value 约定为 { model: ProviderId }
export interface SettingsRecord {
  key: 'global';
  value: { model: ProviderId };
}