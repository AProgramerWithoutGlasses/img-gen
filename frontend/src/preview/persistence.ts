import type { StudioData } from "../types";

const DB_NAME = "ui-studio-preview-v1";
let connection: Promise<IDBDatabase> | undefined;
function openDatabase() {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      connection = undefined;
      reject(new Error("无法打开本地存储，请允许浏览器保存网站数据。"));
    };
    request.onblocked = () => {
      connection = undefined;
      reject(new Error("请关闭此预览的其他标签后重试。"));
    };
  });
  return connection;
}
export async function loadData(): Promise<StudioData | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("state")
      .objectStore("state")
      .get("snapshot");
    request.onsuccess = () => {
      const value = request.result as StudioData | undefined;
      if (
        value &&
        (value.version !== 1 ||
          !Array.isArray(value.assets) ||
          !Array.isArray(value.users) ||
          !Array.isArray(value.folders))
      )
        reject(new Error("本地预览数据版本不兼容，请使用新的浏览器存储空间。"));
      else resolve(value);
    };
    request.onerror = () => reject(new Error("读取本地数据失败，请重试。"));
  });
}
export async function persistData(value: StudioData): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("state", "readwrite");
    transaction.objectStore("state").put(value, "snapshot");
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () =>
      reject(new Error("本地保存失败，可能存储空间不足。此次更改未保存。"));
  });
}
