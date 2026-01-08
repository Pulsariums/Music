
import { type IconType } from 'react-icons';

export enum AppID {
  DASHBOARD = 'dashboard',
  LYRICAL_MASTER = 'lyrical_master',
  VOCAL_LAB = 'vocal_lab',
  SETTINGS = 'settings'
}

export interface AppConfig {
  id: AppID;
  name: string;
  description: string;
  icon: string; // Emoji or icon name
  color: string;
}

export interface LyricLine {
  time?: number; // Estimated timestamp in seconds
  text: string;
  isChorus: boolean;
}

export interface SongAnalysis {
  title: string;
  artist: string;
  bpm: number;
  youtubeId?: string; // NEW: YouTube Video ID (e.g., "dQw4w9WgXcQ")
  lyrics: LyricLine[];
  memorizationTips: string[];
}

export enum ViewState {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR'
}

// --- PHYSICAL AUDIO ENGINE TYPES ---

export enum SustainMode {
  PERCUSSIVE = 'PERCUSSIVE', // Sound dies naturally regardless of hold (Xylophone)
  NATURAL = 'NATURAL',       // Sound sustains while held, damps on release (Piano)
  INFINITE = 'INFINITE'      // Sound loops forever while held (Organ/Pad)
}

export interface PhysicsConfig {
  tension: number;       // FM Harmonic Ratio (Timbre Texture)
  hammerHardness: number;// FM Modulation Index (Brightness/Grit)
  reverbMix: number;     // 0.0 (Dry) to 1.0 (Wet)
  
  // New Envelope Controls (ADSR)
  attackTime: number;    // Seconds until max volume (0.001 = Instant click, 2.0 = Slow swell)
  decayTime: number;     // Seconds from max volume to sustain level
  sustainLevel: number;  // 0.0 to 1.0 (Volume while holding key)
  releaseTime: number;   // Seconds to fade out after key release
}

export interface InstrumentPreset {
  id: string;
  name: string;
  category: string; // To organize the 50+ presets
  sustainMode: SustainMode;
  physics: PhysicsConfig;
}

// --- RECORDING TYPES ---

export interface AudioRecording {
  id: string;
  name: string;
  timestamp: number;
  duration: number; // in seconds
  blob: Blob; // The raw audio data (Opus/WebM)
  format: 'webm' | 'wav';
}

// --- SEQUENCER / EDUCATION TYPES ---

export interface NoteEvent {
  noteName: string; // "C4"
  midi: number;     // 60
  startTime: number; // seconds
  duration: number;  // seconds
  velocity: number; // 0-1
}

export interface SongSequence {
  id: string;
  title: string;
  bpm: number;
  events: NoteEvent[];
}

// --- INSTRUMENT UTILS ---

export interface NoteDef {
  note: string;
  octave: number;
  freq: number;
  type: 'white' | 'black';
  midi: number;
}

// --- WORKSPACE TYPES ---

export interface WorkspaceItem {
  instanceId: string;
  type: 'piano';
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  config: {
    preset: InstrumentPreset;
    keyWidth: number;
    transpose: number;
    startOctave: number;
  };
}
