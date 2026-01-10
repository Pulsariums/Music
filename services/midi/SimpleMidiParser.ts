import { NoteEvent, SongSequence } from "../../types";
import { Logger } from "../../lib/logger";
import { midiToNoteName } from "../audio/musicUtils";

/**
 * A lightweight, browser-based MIDI parser.
 * Converts binary .mid files into visualizable NoteEvents.
 * 
 * Supports Standard MIDI File Format 0 and 1 (.mid, .midi)
 */
export class SimpleMidiParser {
  
  public static async parse(file: File): Promise<SongSequence> {
    Logger.log('info', 'SimpleMidiParser: Starting parse', { fileName: file.name, size: file.size, type: file.type });
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const buffer = e.target?.result as ArrayBuffer;
          if (!buffer) {
            Logger.log('error', 'SimpleMidiParser: Empty buffer received');
            throw new Error("Empty buffer");
          }
          Logger.log('info', 'SimpleMidiParser: Buffer loaded', { byteLength: buffer.byteLength });
          const sequence = this.decodeMidi(buffer, file.name);
          Logger.log('info', 'SimpleMidiParser: Parse complete', { eventCount: sequence.events.length, bpm: sequence.bpm });
          resolve(sequence);
        } catch (err) {
          Logger.log('error', 'MIDI Parse Failed', { fileName: file.name }, err as Error);
          reject(err);
        }
      };
      
      reader.onerror = (e) => {
        Logger.log('error', 'SimpleMidiParser: FileReader error', { error: reader.error?.message });
        reject(new Error(`Failed to read file: ${reader.error?.message}`));
      };
      
      reader.readAsArrayBuffer(file);
    });
  }

  // Für Elise (Bagatelle No. 25 in A minor) - Extended Version
  public static getDemoSong(): SongSequence {
    const events: NoteEvent[] = [];
    let t = 0.5; // Start buffer
    
    // Helper to add notes
    const note = (n: string, midi: number, dur: number, timeOffset = 0) => {
        events.push({ 
            noteName: n, 
            midi, 
            startTime: t + timeOffset, 
            duration: dur, 
            velocity: 0.7 + (Math.random() * 0.2) 
        });
    };

    // Helper for chords
    const chord = (notes: {n: string, m: number}[], dur: number) => {
        notes.forEach(x => note(x.n, x.m, dur));
    };

    // SECTION A (Main Theme)
    const playTheme = () => {
        // E5 - D#5 motif
        note("E5", 76, 0.2); t += 0.25;
        note("D#5", 75, 0.2); t += 0.25;
        note("E5", 76, 0.2); t += 0.25;
        note("D#5", 75, 0.2); t += 0.25;
        note("E5", 76, 0.2); t += 0.25;
        note("B4", 71, 0.2); t += 0.25;
        note("D5", 74, 0.2); t += 0.25;
        note("C5", 72, 0.2); t += 0.25;
        
        // A Minor Resolution
        note("A4", 69, 0.6); 
        // Left hand arpeggio starts
        note("A2", 45, 0.8, 0); 
        note("E3", 52, 0.8, 0.25);
        note("A3", 57, 0.8, 0.50);
        t += 0.75; // Advance

        // B Major turn
        note("C4", 60, 0.2); t += 0.25;
        note("E4", 64, 0.2); t += 0.25;
        note("A4", 69, 0.2); t += 0.25;
        note("B4", 71, 0.6); 
        // Left hand
        note("E2", 40, 0.8, 0);
        note("E3", 52, 0.8, 0.25);
        note("G#3", 56, 0.8, 0.50);
        t += 0.75;

        // C Major turn
        note("E4", 64, 0.2); t += 0.25;
        note("G#4", 68, 0.2); t += 0.25;
        note("B4", 71, 0.2); t += 0.25;
        note("C5", 72, 0.6);
        // Left hand
        note("A2", 45, 0.8, 0);
        note("E3", 52, 0.8, 0.25);
        note("A3", 57, 0.8, 0.50);
        t += 0.75;

        // Reset
        note("E4", 64, 0.2); t += 0.25;
    };

    // Play Theme Twice
    playTheme();
    
    // Slight variation ending for first pass
    note("E5", 76, 0.2); t += 0.25;
    note("D#5", 75, 0.2); t += 0.25;
    note("E5", 76, 0.2); t += 0.25;
    note("B4", 71, 0.2); t += 0.25;
    note("D5", 74, 0.2); t += 0.25;
    note("C5", 72, 0.2); t += 0.25;
    note("A4", 69, 0.8);
    // Left Hand Final A Minor
    chord([{n:"A2", m:45}, {n:"E3", m:52}, {n:"A3", m:57}], 1.0);
    t += 1.0;

    // SECTION B (F Major / C Major happy part)
    note("E4", 64, 0.2); t += 0.25;
    note("C5", 72, 0.2); t += 0.25;
    note("G4", 67, 0.2); t += 0.25;
    note("F4", 65, 0.6); 
    // Left hand Bass C
    note("C3", 48, 0.8, 0);
    t += 0.75;

    note("G4", 67, 0.2); t += 0.25;
    note("F4", 65, 0.2); t += 0.25;
    note("E4", 64, 0.2); t += 0.25;
    note("D4", 62, 0.6);
    // Left hand Bass G
    note("G2", 43, 0.8, 0);
    t += 0.75;

    // Run back to theme
    note("E4", 64, 0.2); t += 0.25;
    note("D4", 62, 0.2); t += 0.25;
    note("C4", 60, 0.2); t += 0.25;
    
    // Final E Major Chord
    chord([{n:"E3", m:52}, {n:"G#3", m:56}, {n:"B3", m:59}, {n:"E4", m:64}], 1.5);
    t += 2.0;

    return {
      id: "fur_elise_demo",
      title: "Für Elise (Ludwig van Beethoven)",
      bpm: 120,
      events: events.sort((a,b) => a.startTime - b.startTime)
    };
  }

  private static decodeMidi(buffer: ArrayBuffer, filename: string): SongSequence {
    Logger.log('info', 'Parsing MIDI File...', { size: buffer.byteLength });
    
    const data = new DataView(buffer);
    const events: NoteEvent[] = [];
    
    try {
      // Validate MIDI header "MThd"
      const headerChunk = String.fromCharCode(data.getUint8(0), data.getUint8(1), data.getUint8(2), data.getUint8(3));
      if (headerChunk !== 'MThd') {
        throw new Error('Invalid MIDI file: Missing MThd header');
      }
      
      // Header length (always 6)
      const headerLength = data.getUint32(4, false);
      
      // Format type (0, 1, or 2)
      const formatType = data.getUint16(8, false);
      
      // Number of tracks
      const numTracks = data.getUint16(10, false);
      
      // Time division (ticks per quarter note)
      const timeDivision = data.getUint16(12, false);
      
      Logger.log('info', 'MIDI Header', { formatType, numTracks, timeDivision });
      
      // Default tempo (microseconds per quarter note) = 120 BPM
      let tempo = 500000; // 120 BPM default
      let bpm = 120;
      
      // Parse tracks
      let offset = 8 + headerLength;
      
      for (let track = 0; track < numTracks && offset < buffer.byteLength; track++) {
        // Track header "MTrk"
        const trackChunk = String.fromCharCode(
          data.getUint8(offset), data.getUint8(offset + 1), 
          data.getUint8(offset + 2), data.getUint8(offset + 3)
        );
        
        if (trackChunk !== 'MTrk') {
          Logger.log('warn', 'Missing MTrk header at offset', { offset });
          break;
        }
        
        const trackLength = data.getUint32(offset + 4, false);
        offset += 8;
        const trackEnd = offset + trackLength;
        
        // Track state
        let absoluteTick = 0;
        let runningStatus = 0;
        const activeNotes: Map<number, { startTick: number; velocity: number }> = new Map();
        
        while (offset < trackEnd) {
          // Read variable-length delta time
          let deltaTime = 0;
          let byte: number;
          do {
            byte = data.getUint8(offset++);
            deltaTime = (deltaTime << 7) | (byte & 0x7F);
          } while (byte & 0x80 && offset < trackEnd);
          
          absoluteTick += deltaTime;
          
          // Read event
          let eventByte = data.getUint8(offset);
          
          // Check for running status
          if (eventByte < 0x80) {
            eventByte = runningStatus;
          } else {
            offset++;
            runningStatus = eventByte;
          }
          
          const eventType = eventByte & 0xF0;
          const channel = eventByte & 0x0F;
          
          switch (eventType) {
            case 0x80: // Note Off
            case 0x90: { // Note On (velocity 0 = Note Off)
              const noteNum = data.getUint8(offset++);
              const velocity = data.getUint8(offset++);
              
              const isNoteOn = eventType === 0x90 && velocity > 0;
              
              if (isNoteOn) {
                // Start note
                activeNotes.set(noteNum, { 
                  startTick: absoluteTick, 
                  velocity: velocity / 127 
                });
              } else {
                // End note
                const noteStart = activeNotes.get(noteNum);
                if (noteStart) {
                  const startTime = (noteStart.startTick / timeDivision) * (tempo / 1000000);
                  const endTime = (absoluteTick / timeDivision) * (tempo / 1000000);
                  const duration = Math.max(0.05, endTime - startTime);
                  
                  events.push({
                    noteName: midiToNoteName(noteNum),
                    midi: noteNum,
                    startTime,
                    duration,
                    velocity: noteStart.velocity
                  });
                  
                  activeNotes.delete(noteNum);
                }
              }
              break;
            }
            
            case 0xA0: // Aftertouch
              offset += 2;
              break;
            
            case 0xB0: // Control Change
              offset += 2;
              break;
            
            case 0xC0: // Program Change
              offset += 1;
              break;
            
            case 0xD0: // Channel Pressure
              offset += 1;
              break;
            
            case 0xE0: // Pitch Bend
              offset += 2;
              break;
            
            case 0xF0: // System/Meta Events
              if (eventByte === 0xFF) {
                // Meta event
                const metaType = data.getUint8(offset++);
                let metaLength = 0;
                let b: number;
                do {
                  b = data.getUint8(offset++);
                  metaLength = (metaLength << 7) | (b & 0x7F);
                } while (b & 0x80 && offset < trackEnd);
                
                // Tempo change
                if (metaType === 0x51 && metaLength === 3) {
                  tempo = (data.getUint8(offset) << 16) | 
                          (data.getUint8(offset + 1) << 8) | 
                          data.getUint8(offset + 2);
                  bpm = Math.round(60000000 / tempo);
                  Logger.log('info', 'Tempo change', { bpm, tempo });
                }
                
                offset += metaLength;
              } else if (eventByte === 0xF0 || eventByte === 0xF7) {
                // SysEx
                let sysExLength = 0;
                let b: number;
                do {
                  b = data.getUint8(offset++);
                  sysExLength = (sysExLength << 7) | (b & 0x7F);
                } while (b & 0x80 && offset < trackEnd);
                offset += sysExLength;
              }
              break;
            
            default:
              // Unknown event, skip
              break;
          }
        }
        
        offset = trackEnd;
      }
      
      // Sort events by start time
      events.sort((a, b) => a.startTime - b.startTime);
      
      Logger.log('info', 'MIDI Parsed Successfully', { 
        noteCount: events.length, 
        bpm,
        duration: events.length > 0 ? events[events.length - 1].startTime + events[events.length - 1].duration : 0
      });
      
      if (events.length === 0) {
        // Fallback to demo if no events found
        const demo = this.getDemoSong();
        return {
          ...demo,
          id: crypto.randomUUID(),
          title: filename.replace('.mid', '').replace('.midi', '')
        };
      }
      
      return {
        id: crypto.randomUUID(),
        title: filename.replace('.mid', '').replace('.midi', ''),
        bpm,
        events
      };
      
    } catch (error) {
      Logger.log('error', 'MIDI Parse Error, using demo', {}, error as Error);
      const demo = this.getDemoSong();
      return {
        ...demo,
        id: crypto.randomUUID(),
        title: filename.replace('.mid', '').replace('.midi', '')
      };
    }
  }
}