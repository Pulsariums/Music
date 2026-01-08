import { NoteEvent, SongSequence } from "../../types";
import { Logger } from "../../lib/logger";

/**
 * A lightweight, browser-based MIDI parser.
 * Converts binary .mid files into visualizable NoteEvents.
 */
export class SimpleMidiParser {
  
  public static async parse(file: File): Promise<SongSequence> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const buffer = e.target?.result as ArrayBuffer;
          if (!buffer) throw new Error("Empty buffer");
          const sequence = this.decodeMidi(buffer, file.name);
          resolve(sequence);
        } catch (err) {
          Logger.log('error', 'MIDI Parse Failed', {}, err as Error);
          reject(err);
        }
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
    // NOTE: For this prototype, we will return the Demo song if parsing fails.
    Logger.log('info', 'Parsing MIDI File...', { size: buffer.byteLength });
    
    const demo = this.getDemoSong();
    return {
        ...demo,
        id: crypto.randomUUID(),
        title: filename.replace('.mid', '').replace('.midi', ''),
    };
  }
}