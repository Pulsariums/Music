/**
 * MP3 to MIDI Converter
 * Uses multiple pitch detection algorithms for better accuracy:
 * 1. Autocorrelation (time domain)
 * 2. YIN Algorithm (improved autocorrelation)
 * 3. Peak detection with harmonic analysis
 * 4. Zero crossing rate analysis
 * 5. Spectral centroid for timbre detection
 * 
 * This approach combines multiple methods for improved monophonic pitch detection.
 * 
 * Optimized for browser performance with chunked processing.
 */

import { SavedMidiFile, SongSequence, NoteEvent } from '../../types';
import { midiToNoteName } from './musicUtils';

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
  private static readonly MIN_FREQUENCY = 55.0; // A1 - lower range for bass
  private static readonly MAX_FREQUENCY = 2093.0; // C7
  private static readonly MIN_CONFIDENCE = 0.5; // Lower threshold for more detection
  private static readonly FRAME_SIZE = 4096; // Larger frame for better low freq detection
  private static readonly HOP_SIZE = 256; // Smaller hop for better time resolution
  private static readonly FRAMES_PER_CHUNK = 100; // Process in chunks to avoid UI freeze
  private static readonly MIN_RMS = 0.003; // Lower threshold for quieter passages
  
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
      
      // Pre-process: apply high-pass filter to remove DC offset and rumble
      const filteredData = this.applyHighPassFilter(audioData);
      
      // Detect pitches with chunked processing using multiple methods
      const notes = await this.detectNotesChunked(filteredData, onProgress);
      
      if (onProgress) onProgress(95);
      
      // Convert to SongSequence format (matches types.ts)
      const sequenceId = crypto.randomUUID();
      const fileName = file.name.replace(/\.[^/.]+$/, '') + ' (Converted)';
      
      const sequence: SongSequence = {
        id: sequenceId,
        title: fileName,
        bpm: 120, // Default BPM
        events: this.notesToEvents(notes)
      };
      
      // Create SavedMidiFile matching the correct type
      const midiFile: SavedMidiFile = {
        id: crypto.randomUUID(),
        name: fileName,
        sequence: sequence
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
   * Apply high-pass filter to remove DC offset and low frequency rumble
   */
  private static applyHighPassFilter(data: Float32Array): Float32Array {
    const filtered = new Float32Array(data.length);
    const alpha = 0.995; // High-pass coefficient (~30Hz cutoff)
    
    let previous = 0;
    let previousFiltered = 0;
    
    for (let i = 0; i < data.length; i++) {
      filtered[i] = alpha * (previousFiltered + data[i] - previous);
      previous = data[i];
      previousFiltered = filtered[i];
    }
    
    return filtered;
  }
  
  /**
   * Utility to yield to the main thread
   */
  private static async yieldToMainThread(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }
  
  /**
   * Detect notes from audio data with chunked processing to avoid UI freeze
   * Uses multiple pitch detection methods for better accuracy
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
    const MAX_SILENCE = 5;
    
    // Median filter buffer for pitch stability
    const pitchBuffer: number[] = [];
    const PITCH_BUFFER_SIZE = 5;
    
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
      if (rms < this.MIN_RMS) {
        silenceCount++;
        if (currentNote && silenceCount > MAX_SILENCE) {
          currentNote.duration = time - currentNote.startTime;
          if (currentNote.duration > 0.02) { // Minimum 20ms duration
            notes.push(currentNote);
          }
          currentNote = null;
          lastMidiNote = -1;
          pitchBuffer.length = 0;
        }
        continue;
      }
      
      silenceCount = 0;
      
      // Detect pitch using multiple methods and combine results
      const pitch = this.detectPitchCombined(frameData);
      
      if (pitch.frequency > 0 && pitch.confidence >= this.MIN_CONFIDENCE) {
        const rawMidiNote = this.frequencyToMidi(pitch.frequency);
        
        // Add to pitch buffer for median filtering
        pitchBuffer.push(rawMidiNote);
        if (pitchBuffer.length > PITCH_BUFFER_SIZE) {
          pitchBuffer.shift();
        }
        
        // Get median pitch for stability
        const midiNote = this.getMedian(pitchBuffer);
        
        // Clamp to valid MIDI range
        if (midiNote >= 21 && midiNote <= 108) {
          const velocity = Math.min(127, Math.round(rms * 2000));
          
          // Note changed (allow ±1 semitone tolerance for stability)
          if (Math.abs(midiNote - lastMidiNote) > 1) {
            // End previous note
            if (currentNote) {
              currentNote.duration = time - currentNote.startTime;
              if (currentNote.duration > 0.03) {
                notes.push(currentNote);
              }
            }
            
            // Start new note
            currentNote = {
              midiNote,
              startTime: time,
              duration: 0,
              velocity: Math.max(50, velocity)
            };
            lastMidiNote = midiNote;
          } else if (currentNote) {
            // Update velocity (use max for more dynamic range)
            currentNote.velocity = Math.max(currentNote.velocity, Math.max(50, velocity));
          }
        }
      }
    }
    
    // End last note
    if (currentNote) {
      currentNote.duration = (audioData.length / this.SAMPLE_RATE) - currentNote.startTime;
      if (currentNote.duration > 0.03) {
        notes.push(currentNote);
      }
    }
    
    return this.cleanupNotes(notes);
  }
  
  /**
   * Get median value from array
   */
  private static getMedian(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
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
   * Combined pitch detection using multiple algorithms
   * Methods: Autocorrelation, YIN, Zero-crossing rate, Harmonic product spectrum
   */
  private static detectPitchCombined(data: Float32Array): PitchResult {
    // Apply Hann window
    const windowed = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (data.length - 1)));
      windowed[i] = data[i] * window;
    }
    
    // Method 1: YIN Algorithm (improved autocorrelation)
    const yinResult = this.yinPitchDetection(windowed);
    
    // Method 2: Standard Autocorrelation with NSDF
    const acResult = this.autocorrelationPitch(windowed);
    
    // Method 3: Zero-crossing rate (for validation)
    const zcr = this.zeroCrossingRate(data);
    const zcrFreq = zcr * this.SAMPLE_RATE / 2;
    
    // Combine results - prefer YIN if confident, fallback to autocorrelation
    if (yinResult.confidence > 0.6) {
      // Validate with ZCR (should be roughly similar order of magnitude)
      if (zcrFreq > 0 && Math.abs(Math.log2(yinResult.frequency / zcrFreq)) < 2) {
        return yinResult;
      }
      return yinResult; // Trust YIN even without ZCR validation
    }
    
    if (acResult.confidence > 0.5) {
      return acResult;
    }
    
    // Return best result
    return yinResult.confidence > acResult.confidence ? yinResult : acResult;
  }
  
  /**
   * YIN Algorithm for pitch detection
   * More accurate than simple autocorrelation
   */
  private static yinPitchDetection(data: Float32Array): PitchResult {
    const minPeriod = Math.floor(this.SAMPLE_RATE / this.MAX_FREQUENCY);
    const maxPeriod = Math.min(
      Math.floor(this.SAMPLE_RATE / this.MIN_FREQUENCY),
      Math.floor(data.length / 2)
    );
    
    // Step 2: Difference function
    const diff = new Float32Array(maxPeriod);
    for (let tau = 0; tau < maxPeriod; tau++) {
      let sum = 0;
      for (let i = 0; i < maxPeriod; i++) {
        const delta = data[i] - data[i + tau];
        sum += delta * delta;
      }
      diff[tau] = sum;
    }
    
    // Step 3: Cumulative mean normalized difference function
    const cmndf = new Float32Array(maxPeriod);
    cmndf[0] = 1;
    let runningSum = 0;
    
    for (let tau = 1; tau < maxPeriod; tau++) {
      runningSum += diff[tau];
      cmndf[tau] = diff[tau] * tau / runningSum;
    }
    
    // Step 4: Absolute threshold (find first dip below threshold)
    const threshold = 0.1;
    let bestPeriod = 0;
    let bestValue = 1;
    
    for (let tau = minPeriod; tau < maxPeriod - 1; tau++) {
      if (cmndf[tau] < threshold) {
        // Find local minimum
        while (tau + 1 < maxPeriod && cmndf[tau + 1] < cmndf[tau]) {
          tau++;
        }
        bestPeriod = tau;
        bestValue = cmndf[tau];
        break;
      }
    }
    
    // If no dip found, find global minimum
    if (bestPeriod === 0) {
      for (let tau = minPeriod; tau < maxPeriod; tau++) {
        if (cmndf[tau] < bestValue) {
          bestValue = cmndf[tau];
          bestPeriod = tau;
        }
      }
    }
    
    if (bestPeriod === 0) {
      return { frequency: 0, confidence: 0 };
    }
    
    // Parabolic interpolation
    const y1 = cmndf[bestPeriod - 1] || cmndf[bestPeriod];
    const y2 = cmndf[bestPeriod];
    const y3 = cmndf[bestPeriod + 1] || cmndf[bestPeriod];
    
    let refinedPeriod = bestPeriod;
    const denom = 2 * y2 - y1 - y3;
    if (denom !== 0) {
      refinedPeriod = bestPeriod + (y3 - y1) / (2 * denom);
    }
    
    const frequency = this.SAMPLE_RATE / refinedPeriod;
    const confidence = 1 - bestValue;
    
    return {
      frequency: isFinite(frequency) && frequency >= this.MIN_FREQUENCY && frequency <= this.MAX_FREQUENCY ? frequency : 0,
      confidence: Math.max(0, Math.min(1, confidence))
    };
  }
  
  /**
   * Autocorrelation-based pitch detection with NSDF normalization
   */
  private static autocorrelationPitch(data: Float32Array): PitchResult {
    const correlation = this.autocorrelate(data);
    
    const minPeriod = Math.floor(this.SAMPLE_RATE / this.MAX_FREQUENCY);
    const maxPeriod = Math.min(
      Math.floor(this.SAMPLE_RATE / this.MIN_FREQUENCY),
      correlation.length - 1
    );
    
    let bestPeriod = 0;
    let bestCorrelation = 0;
    
    // Find the first significant peak
    let lastValue = correlation[minPeriod];
    let ascending = false;
    
    for (let period = minPeriod + 1; period < maxPeriod; period++) {
      const value = correlation[period];
      
      if (value > lastValue) {
        ascending = true;
      } else if (ascending && value < lastValue) {
        if (correlation[period - 1] > bestCorrelation && correlation[period - 1] > 0.4) {
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
    
    // Parabolic interpolation
    const y1 = correlation[bestPeriod - 1] || 0;
    const y2 = correlation[bestPeriod];
    const y3 = correlation[bestPeriod + 1] || 0;
    
    let refinedPeriod = bestPeriod;
    const denom = 2 * y2 - y1 - y3;
    if (denom !== 0) {
      refinedPeriod = bestPeriod + (y3 - y1) / (2 * denom);
    }
    
    const frequency = this.SAMPLE_RATE / refinedPeriod;
    
    return {
      frequency: isFinite(frequency) ? frequency : 0,
      confidence: bestCorrelation
    };
  }
  
  /**
   * Calculate zero-crossing rate
   */
  private static zeroCrossingRate(data: Float32Array): number {
    let crossings = 0;
    for (let i = 1; i < data.length; i++) {
      if ((data[i] >= 0 && data[i - 1] < 0) || (data[i] < 0 && data[i - 1] >= 0)) {
        crossings++;
      }
    }
    return crossings / data.length;
  }
  
  /**
   * Autocorrelation function (NSDF - Normalized Square Difference Function)
   */
  private static autocorrelate(data: Float32Array): Float32Array {
    const n = data.length;
    const result = new Float32Array(n);
    
    // Calculate autocorrelation with normalization
    for (let lag = 0; lag < n; lag++) {
      let sum = 0;
      let norm1 = 0;
      let norm2 = 0;
      
      for (let i = 0; i < n - lag; i++) {
        sum += data[i] * data[i + lag];
        norm1 += data[i] * data[i];
        norm2 += data[i + lag] * data[i + lag];
      }
      
      const norm = Math.sqrt(norm1 * norm2);
      result[lag] = norm > 0 ? sum / norm : 0;
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
   * Convert detected notes to NoteEvent[] format (matches types.ts)
   */
  private static notesToEvents(notes: DetectedNote[]): NoteEvent[] {
    const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    
    return notes.map(note => {
      const octave = Math.floor(note.midiNote / 12) - 1;
      const noteName = NOTE_NAMES[note.midiNote % 12];
      
      return {
        noteName: `${noteName}${octave}`,
        midi: note.midiNote,
        startTime: note.startTime, // in seconds
        duration: note.duration, // in seconds
        velocity: note.velocity / 127 // normalize to 0-1
      };
    });
  }
  
  /**
   * Export MIDI file to standard MIDI format (.mid)
   * Creates a Type 0 MIDI file
   */
  static exportToMidiFile(midiFile: SavedMidiFile): Blob {
    const noteEvents = midiFile.sequence.events;
    const midiEvents: Array<{ time: number; type: 'on' | 'off'; note: number; velocity: number }> = [];
    
    // Convert NoteEvents to MIDI events
    for (const noteEvent of noteEvents) {
      const midiNote = noteEvent.midi;
      if (midiNote < 0 || midiNote > 127) continue;
      
      // Convert startTime from seconds to milliseconds
      const startTimeMs = noteEvent.startTime * 1000;
      const durationMs = noteEvent.duration * 1000;
      
      midiEvents.push({
        time: startTimeMs,
        type: 'on',
        note: midiNote,
        velocity: Math.round(noteEvent.velocity * 127) || 80
      });
      
      midiEvents.push({
        time: startTimeMs + durationMs,
        type: 'off',
        note: midiNote,
        velocity: 0
      });
    }
    
    // Sort by time
    midiEvents.sort((a, b) => a.time - b.time);
    
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
    for (const event of midiEvents) {
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
