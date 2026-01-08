/**
 * MP3 to MIDI Converter
 * Uses pitch detection (autocorrelation) to convert audio to MIDI notes.
 * This is a simplified approach that works best with monophonic melodies.
 * 
 * Optimized for browser performance with chunked processing.
 */

import { SavedMidiFile } from '../../types';

interface DetectedNote {
  midiNote: number;
  startTime: number;
  duration: number;
  velocity: number;
}

interface PitchResult {
  frequency: number;
  confidence: number;
}

export class Mp3ToMidiConverter {
  private static readonly SAMPLE_RATE = 44100;
  private static readonly MIN_FREQUENCY = 65.41; // C2
  private static readonly MAX_FREQUENCY = 2093.0; // C7
  private static readonly MIN_CONFIDENCE = 0.8; // Lowered for better detection
  private static readonly FRAME_SIZE = 2048;
  private static readonly HOP_SIZE = 1024; // Increased for faster processing
  private static readonly FRAMES_PER_CHUNK = 50; // Process in smaller chunks to avoid UI freeze
  
  /**
   * Convert an MP3 file to MIDI
   */
  static async convert(file: File, onProgress?: (progress: number) => void): Promise<SavedMidiFile> {
    if (onProgress) onProgress(5);
    
    const audioContext = new AudioContext({ sampleRate: this.SAMPLE_RATE });
    
    try {
      // Decode audio file
      if (onProgress) onProgress(10);
      const arrayBuffer = await file.arrayBuffer();
      
      if (onProgress) onProgress(15);
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      if (onProgress) onProgress(20);
      
      // Get mono audio data
      const audioData = this.getMono(audioBuffer);
      
      // Detect pitches with chunked processing
      const notes = await this.detectNotesChunked(audioData, onProgress);
      
      if (onProgress) onProgress(95);
      
      // Convert to MIDI format
      const midiData = this.notesToMidi(notes, audioBuffer.duration);
      
      // Create SavedMidiFile
      const midiFile: SavedMidiFile = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^/.]+$/, '') + ' (Converted)',
        data: midiData,
        duration: audioBuffer.duration * 1000,
        createdAt: Date.now()
      };
      
      if (onProgress) onProgress(100);
      
      return midiFile;
    } finally {
      await audioContext.close();
    }
  }
  
  /**
   * Convert stereo to mono
   */
  private static getMono(buffer: AudioBuffer): Float32Array {
    if (buffer.numberOfChannels === 1) {
      return buffer.getChannelData(0);
    }
    
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const mono = new Float32Array(left.length);
    
    for (let i = 0; i < left.length; i++) {
      mono[i] = (left[i] + right[i]) / 2;
    }
    
    return mono;
  }
  
  /**
   * Utility to yield to the main thread
   */
  private static async yieldToMainThread(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }
  
  /**
   * Detect notes from audio data with chunked processing to avoid UI freeze
   */
  private static async detectNotesChunked(
    audioData: Float32Array,
    onProgress?: (progress: number) => void
  ): Promise<DetectedNote[]> {
    const notes: DetectedNote[] = [];
    const totalFrames = Math.floor((audioData.length - this.FRAME_SIZE) / this.HOP_SIZE);
    
    let currentNote: DetectedNote | null = null;
    let lastMidiNote = -1;
    let silenceCount = 0;
    const MAX_SILENCE = 3;
    
    // Process in chunks to avoid blocking UI
    for (let frame = 0; frame < totalFrames; frame++) {
      const startSample = frame * this.HOP_SIZE;
      const frameData = audioData.slice(startSample, startSample + this.FRAME_SIZE);
      
      // Calculate RMS (volume)
      const rms = this.calculateRMS(frameData);
      const time = startSample / this.SAMPLE_RATE;
      
      // Yield to main thread every FRAMES_PER_CHUNK frames
      if (frame % this.FRAMES_PER_CHUNK === 0) {
        await this.yieldToMainThread();
        if (onProgress) {
          // Progress from 20% to 90%
          const progressPct = 20 + Math.round((frame / totalFrames) * 70);
          onProgress(progressPct);
        }
      }
      
      // Skip if too quiet
      if (rms < 0.01) {
        silenceCount++;
        if (currentNote && silenceCount > MAX_SILENCE) {
          currentNote.duration = time - currentNote.startTime;
          if (currentNote.duration > 0.05) {
            notes.push(currentNote);
          }
          currentNote = null;
          lastMidiNote = -1;
        }
        continue;
      }
      
      silenceCount = 0;
      
      // Detect pitch
      const pitch = this.detectPitch(frameData);
      
      if (pitch.frequency > 0 && pitch.confidence >= this.MIN_CONFIDENCE) {
        const midiNote = this.frequencyToMidi(pitch.frequency);
        
        // Clamp to valid MIDI range
        if (midiNote >= 21 && midiNote <= 108) {
          const velocity = Math.min(127, Math.round(rms * 1000));
          
          if (midiNote !== lastMidiNote) {
            // End previous note
            if (currentNote) {
              currentNote.duration = time - currentNote.startTime;
              if (currentNote.duration > 0.05) {
                notes.push(currentNote);
              }
            }
            
            // Start new note
            currentNote = {
              midiNote,
              startTime: time,
              duration: 0,
              velocity: Math.max(40, velocity)
            };
            lastMidiNote = midiNote;
          } else if (currentNote) {
            // Update velocity (use average)
            currentNote.velocity = Math.round((currentNote.velocity + Math.max(40, velocity)) / 2);
          }
        }
      }
    }
    
    // End last note
    if (currentNote) {
      currentNote.duration = (audioData.length / this.SAMPLE_RATE) - currentNote.startTime;
      if (currentNote.duration > 0.05) {
        notes.push(currentNote);
      }
    }
    
    return this.cleanupNotes(notes);
  }
  
  /**
   * Calculate RMS (root mean square) of audio frame
   */
  private static calculateRMS(data: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }
  
  /**
   * Detect pitch using autocorrelation
   */
  private static detectPitch(data: Float32Array): PitchResult {
    // Apply Hann window
    const windowed = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (data.length - 1)));
      windowed[i] = data[i] * window;
    }
    
    // Calculate autocorrelation
    const correlation = this.autocorrelate(windowed);
    
    // Find first peak after initial decline
    const minPeriod = Math.floor(this.SAMPLE_RATE / this.MAX_FREQUENCY);
    const maxPeriod = Math.floor(this.SAMPLE_RATE / this.MIN_FREQUENCY);
    
    let bestPeriod = 0;
    let bestCorrelation = 0;
    
    // Find the first significant peak
    let lastValue = correlation[minPeriod];
    let ascending = false;
    
    for (let period = minPeriod + 1; period < Math.min(maxPeriod, correlation.length); period++) {
      const value = correlation[period];
      
      if (value > lastValue) {
        ascending = true;
      } else if (ascending && value < lastValue) {
        // Found a peak at period - 1
        if (correlation[period - 1] > bestCorrelation && correlation[period - 1] > 0.5) {
          bestCorrelation = correlation[period - 1];
          bestPeriod = period - 1;
          break; // Take the first significant peak
        }
        ascending = false;
      }
      
      lastValue = value;
    }
    
    if (bestPeriod === 0) {
      return { frequency: 0, confidence: 0 };
    }
    
    // Parabolic interpolation for better accuracy
    const y1 = correlation[bestPeriod - 1] || 0;
    const y2 = correlation[bestPeriod];
    const y3 = correlation[bestPeriod + 1] || 0;
    
    const refinedPeriod = bestPeriod + (y3 - y1) / (2 * (2 * y2 - y1 - y3));
    const frequency = this.SAMPLE_RATE / refinedPeriod;
    
    return {
      frequency: isFinite(frequency) ? frequency : 0,
      confidence: bestCorrelation
    };
  }
  
  /**
   * Autocorrelation function
   */
  private static autocorrelate(data: Float32Array): Float32Array {
    const n = data.length;
    const result = new Float32Array(n);
    
    // Normalize by the autocorrelation at lag 0
    let r0 = 0;
    for (let i = 0; i < n; i++) {
      r0 += data[i] * data[i];
    }
    
    if (r0 === 0) return result;
    
    for (let lag = 0; lag < n; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) {
        sum += data[i] * data[i + lag];
      }
      result[lag] = sum / r0;
    }
    
    return result;
  }
  
  /**
   * Convert frequency to MIDI note number
   */
  private static frequencyToMidi(frequency: number): number {
    return Math.round(69 + 12 * Math.log2(frequency / 440));
  }
  
  /**
   * Clean up detected notes (merge very short gaps, remove noise)
   */
  private static cleanupNotes(notes: DetectedNote[]): DetectedNote[] {
    if (notes.length === 0) return notes;
    
    const cleaned: DetectedNote[] = [];
    let current = { ...notes[0] };
    
    for (let i = 1; i < notes.length; i++) {
      const note = notes[i];
      const gap = note.startTime - (current.startTime + current.duration);
      
      // Merge if same note and small gap
      if (note.midiNote === current.midiNote && gap < 0.1) {
        current.duration = (note.startTime + note.duration) - current.startTime;
        current.velocity = Math.max(current.velocity, note.velocity);
      } else {
        if (current.duration >= 0.05) {
          cleaned.push(current);
        }
        current = { ...note };
      }
    }
    
    if (current.duration >= 0.05) {
      cleaned.push(current);
    }
    
    return cleaned;
  }
  
  /**
   * Convert detected notes to our MIDI format
   */
  private static notesToMidi(notes: DetectedNote[], totalDuration: number): { notes: Array<{ time: number; note: string; duration: number; velocity: number }> } {
    const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    
    const midiNotes = notes.map(note => {
      const octave = Math.floor(note.midiNote / 12) - 1;
      const noteName = NOTE_NAMES[note.midiNote % 12];
      
      return {
        time: note.startTime * 1000, // Convert to ms
        note: `${noteName}${octave}`,
        duration: note.duration * 1000, // Convert to ms
        velocity: note.velocity
      };
    });
    
    return { notes: midiNotes };
  }
  
  /**
   * Export MIDI file to standard MIDI format (.mid)
   * Creates a Type 0 MIDI file
   */
  static exportToMidiFile(midiFile: SavedMidiFile): Blob {
    const notes = midiFile.data.notes;
    const events: Array<{ time: number; type: 'on' | 'off'; note: number; velocity: number }> = [];
    
    // Convert notes to MIDI events
    for (const note of notes) {
      const midiNote = this.noteNameToMidi(note.note);
      if (midiNote === -1) continue;
      
      events.push({
        time: note.time,
        type: 'on',
        note: midiNote,
        velocity: note.velocity || 80
      });
      
      events.push({
        time: note.time + note.duration,
        type: 'off',
        note: midiNote,
        velocity: 0
      });
    }
    
    // Sort by time
    events.sort((a, b) => a.time - b.time);
    
    // Build MIDI file bytes
    const ticksPerQuarter = 480;
    const tempo = 500000; // 120 BPM = 500000 microseconds per quarter note
    const msPerTick = tempo / ticksPerQuarter / 1000;
    
    // Track data
    const trackData: number[] = [];
    
    // Tempo event
    trackData.push(0x00); // Delta time
    trackData.push(0xFF, 0x51, 0x03); // Tempo meta event
    trackData.push((tempo >> 16) & 0xFF);
    trackData.push((tempo >> 8) & 0xFF);
    trackData.push(tempo & 0xFF);
    
    // Note events
    let lastTime = 0;
    for (const event of events) {
      const ticks = Math.round(event.time / msPerTick);
      const delta = ticks - lastTime;
      lastTime = ticks;
      
      // Variable length delta time
      this.writeVarLen(trackData, delta);
      
      // Note on/off
      if (event.type === 'on') {
        trackData.push(0x90); // Note on, channel 0
      } else {
        trackData.push(0x80); // Note off, channel 0
      }
      trackData.push(event.note);
      trackData.push(event.velocity);
    }
    
    // End of track
    trackData.push(0x00); // Delta time
    trackData.push(0xFF, 0x2F, 0x00); // End of track
    
    // Build complete MIDI file
    const header = [
      0x4D, 0x54, 0x68, 0x64, // "MThd"
      0x00, 0x00, 0x00, 0x06, // Header length (6)
      0x00, 0x00, // Format type 0
      0x00, 0x01, // Number of tracks (1)
      (ticksPerQuarter >> 8) & 0xFF, ticksPerQuarter & 0xFF // Ticks per quarter
    ];
    
    const trackHeader = [
      0x4D, 0x54, 0x72, 0x6B, // "MTrk"
      (trackData.length >> 24) & 0xFF,
      (trackData.length >> 16) & 0xFF,
      (trackData.length >> 8) & 0xFF,
      trackData.length & 0xFF
    ];
    
    const midiBytes = new Uint8Array([...header, ...trackHeader, ...trackData]);
    return new Blob([midiBytes], { type: 'audio/midi' });
  }
  
  /**
   * Write variable length quantity
   */
  private static writeVarLen(arr: number[], value: number): void {
    if (value < 0) value = 0;
    
    const bytes: number[] = [];
    bytes.push(value & 0x7F);
    value >>= 7;
    
    while (value > 0) {
      bytes.push((value & 0x7F) | 0x80);
      value >>= 7;
    }
    
    for (let i = bytes.length - 1; i >= 0; i--) {
      arr.push(bytes[i]);
    }
  }
  
  /**
   * Convert note name (e.g., "C4") to MIDI number
   */
  private static noteNameToMidi(noteName: string): number {
    const match = noteName.match(/^([A-G]#?)(\d+)$/);
    if (!match) return -1;
    
    const NOTE_MAP: Record<string, number> = {
      'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
      'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11
    };
    
    const note = match[1];
    const octave = parseInt(match[2]);
    
    if (NOTE_MAP[note] === undefined) return -1;
    
    return (octave + 1) * 12 + NOTE_MAP[note];
  }
}
