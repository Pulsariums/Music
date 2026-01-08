import { WorkspaceSession, SavedMidiFile, SongSequence } from "../../types";
import { Logger } from "../../lib/logger";

const DB_NAME = "SoundSphereDB";
const SESSIONS_STORE = "sessions";
const MIDI_STORE = "midiFiles";
const DB_VERSION = 2; // Bump version for new stores

/**
 * Handles persistent storage of workspace sessions and MIDI files.
 */
class SessionService {
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
        
        // Create recordings store if not exists (from v1)
        if (!db.objectStoreNames.contains("recordings")) {
          db.createObjectStore("recordings", { keyPath: "id" });
        }
        
        // Create sessions store
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          db.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
        }
        
        // Create MIDI files store
        if (!db.objectStoreNames.contains(MIDI_STORE)) {
          db.createObjectStore(MIDI_STORE, { keyPath: "id" });
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        Logger.log('error', 'SessionRepository: IndexedDB init failed', {}, (event.target as any).error);
        reject((event.target as any).error);
      };
    });

    return this.dbPromise;
  }

  // --- SESSION METHODS ---

  public async saveSession(session: WorkspaceSession): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SESSIONS_STORE], "readwrite");
      const store = transaction.objectStore(SESSIONS_STORE);
      const request = store.put(session); // put = upsert

      request.onsuccess = () => {
        Logger.log('info', 'Session saved', { id: session.id, name: session.name });
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  public async getAllSessions(): Promise<WorkspaceSession[]> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SESSIONS_STORE], "readonly");
      const store = transaction.objectStore(SESSIONS_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const result = request.result as WorkspaceSession[];
        result.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  public async getSession(id: string): Promise<WorkspaceSession | null> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SESSIONS_STORE], "readonly");
      const store = transaction.objectStore(SESSIONS_STORE);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  public async deleteSession(id: string): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SESSIONS_STORE], "readwrite");
      const store = transaction.objectStore(SESSIONS_STORE);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- MIDI FILE METHODS ---

  public async saveMidiFile(midiFile: SavedMidiFile): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([MIDI_STORE], "readwrite");
      const store = transaction.objectStore(MIDI_STORE);
      const request = store.put(midiFile);

      request.onsuccess = () => {
        Logger.log('info', 'MIDI file saved', { id: midiFile.id, name: midiFile.name });
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  public async getAllMidiFiles(): Promise<SavedMidiFile[]> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([MIDI_STORE], "readonly");
      const store = transaction.objectStore(MIDI_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result as SavedMidiFile[]);
      request.onerror = () => reject(request.error);
    });
  }

  public async deleteMidiFile(id: string): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([MIDI_STORE], "readwrite");
      const store = transaction.objectStore(MIDI_STORE);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- EXPORT/IMPORT ---

  public exportSession(session: WorkspaceSession): string {
    return JSON.stringify(session, null, 2);
  }

  public importSession(jsonString: string): WorkspaceSession {
    const parsed = JSON.parse(jsonString) as WorkspaceSession;
    // Generate new ID to avoid conflicts
    parsed.id = crypto.randomUUID();
    parsed.updatedAt = Date.now();
    return parsed;
  }

  public exportMidiToJSON(sequence: SongSequence): string {
    return JSON.stringify(sequence, null, 2);
  }
}

export const SessionRepository = new SessionService();
