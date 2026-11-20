import type { RecordingMeta, StorageStats } from "../types";

const DB_NAME = "echovault_db";
const DB_VERSION = 1;
const STORE_META = "recordings";
const STORE_BLOBS = "audioBlobs";
const FOLDERS_KEY = "echovault_folders";

const DEFAULT_FOLDERS = ["General", "Meetings", "Ideas", "Interviews", "AI Voices"];

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        const metaStore = db.createObjectStore(STORE_META, { keyPath: "id" });
        metaStore.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB."));
  });
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readonly");
    const store = tx.objectStore(STORE_META);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result as RecordingMeta[]) || [];
      items.sort((a, b) => b.createdAt - a.createdAt);
      resolve(items);
    };
    req.onerror = () => reject(req.error || new Error("Failed to list recordings."));
  });
}

export async function saveRecordingWithBlob(
  meta: RecordingMeta,
  blob: Blob
): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_META, STORE_BLOBS], "readwrite");
    tx.objectStore(STORE_META).put(meta);
    tx.objectStore(STORE_BLOBS).put(blob, meta.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to save recording."));
  });
}

export async function updateRecordingMeta(meta: RecordingMeta): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readwrite");
    tx.objectStore(STORE_META).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to update recording."));
  });
}

export async function getRecordingBlob(id: string): Promise<Blob | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, "readonly");
    const req = tx.objectStore(STORE_BLOBS).get(id);
    req.onsuccess = () => resolve((req.result as Blob) || null);
    req.onerror = () => reject(req.error || new Error("Failed to load audio blob."));
  });
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_META, STORE_BLOBS], "readwrite");
    tx.objectStore(STORE_META).delete(id);
    tx.objectStore(STORE_BLOBS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to delete recording."));
  });
}

export async function deleteRecordingsBulk(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_META, STORE_BLOBS], "readwrite");
    const metaStore = tx.objectStore(STORE_META);
    const blobStore = tx.objectStore(STORE_BLOBS);
    for (const id of ids) {
      metaStore.delete(id);
      blobStore.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to delete recordings."));
  });
}

export async function getStorageStats(recordings: RecordingMeta[]): Promise<StorageStats> {
  const totalAudioBytes = recordings.reduce((acc, r) => acc + (r.sizeBytes || 0), 0);
  let browserUsedBytes: number | undefined;
  let browserQuotaBytes: number | undefined;
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      browserUsedBytes = est.usage;
      browserQuotaBytes = est.quota;
    } catch {
      // Ignore storage estimate failure
    }
  }
  return {
    recordingCount: recordings.length,
    totalAudioBytes,
    browserUsedBytes,
    browserQuotaBytes,
  };
}

export function loadFolders(): string[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    if (!raw) return DEFAULT_FOLDERS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return Array.from(new Set([...DEFAULT_FOLDERS, ...parsed.filter((x) => typeof x === "string")]));
    }
  } catch {
    // Ignore localStorage parse errors
  }
  return DEFAULT_FOLDERS;
}

export function saveFolders(folders: string[]): string[] {
  const unique = Array.from(new Set(folders.map((f) => f.trim()).filter(Boolean)));
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(unique));
  } catch {
    // Ignore
  }
  return unique;
}
