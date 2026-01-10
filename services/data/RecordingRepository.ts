import { AudioRecording } from "../../types";
import { Logger } from "../../lib/logger";

const DB_NAME = "SoundSphereDB";
const STORE_NAME = "recordings";
const DB_VERSION = 2; // Must match SessionRepository version

/**
 * Handles persistent storage of large audio blobs using IndexedDB.
 * LocalStorage is too small (5MB limit) for audio.
 */
class RecordingService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor() {
    this.initDB();
  }

  private initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // Create all stores to be consistent with SessionRepository
        // Store names must match those in SessionRepository.ts
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
        // SessionRepository stores - must be created here too for DB upgrade consistency
        if (!db.objectStoreNames.contains("sessions")) {
          db.createObjectStore("sessions", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("midiFiles")) {
          db.createObjectStore("midiFiles", { keyPath: "id" });
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        Logger.log('error', 'IndexedDB initialization failed', {}, (event.target as any).error);
        reject((event.target as any).error);
      };
    });

    return this.dbPromise;
  }

  public async saveRecording(recording: AudioRecording): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(recording);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public async getAllRecordings(): Promise<AudioRecording[]> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        // Sort by timestamp desc
        const result = request.result as AudioRecording[];
        result.sort((a, b) => b.timestamp - a.timestamp);
        resolve(result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  public async deleteRecording(id: string): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export const RecordingRepository = new RecordingService();