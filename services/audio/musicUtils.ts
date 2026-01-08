import React from 'react';
import { NoteDef } from "../../types";

export const generateKeyboard = (startOctave: number, endOctave: number): NoteDef[] => {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const generated: NoteDef[] = [];
  
  for (let oct = startOctave; oct <= endOctave; oct++) {
    for (let i = 0; i < notes.length; i++) {
      const noteName = notes[i];
      const midi = oct * 12 + i + 12;
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      
      generated.push({
        note: `${noteName}${oct}`,
        octave: oct,
        freq: freq,
        type: noteName.includes('#') ? 'black' : 'white',
        midi: midi
      });
    }
  }
  return generated;
};

// Helper to get coordinates from either mouse or touch event
export const getClientCoordinates = (e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
    if ('touches' in e) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
};

// Convert note name (e.g., "C4") to frequency
export const noteToFreq = (noteName: string): number | null => {
    const match = noteName.match(/^([A-G]#?)(\d+)$/);
    if (!match) return null;
    
    const noteMap: Record<string, number> = {
        'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
        'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11
    };
    
    const note = match[1];
    const octave = parseInt(match[2], 10);
    const semitone = noteMap[note];
    
    if (semitone === undefined) return null;
    
    const midi = octave * 12 + semitone + 12;
    return 440 * Math.pow(2, (midi - 69) / 12);
};

// Convert MIDI number to frequency
export const midiToFreq = (midi: number): number => {
    return 440 * Math.pow(2, (midi - 69) / 12);
};

// Convert MIDI number to note name (e.g., 60 -> "C4")
export const midiToNoteName = (midi: number): string => {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor((midi - 12) / 12);
    const noteIndex = (midi - 12) % 12;
    return `${notes[noteIndex]}${octave}`;
};

// Convert note name to MIDI number (e.g., "C4" -> 60)
export const noteNameToMidi = (noteName: string): number => {
    const match = noteName.match(/^([A-G]#?)(\d+)$/);
    if (!match) return 60; // Default to C4
    
    const noteMap: Record<string, number> = {
        'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
        'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11
    };
    
    const note = match[1];
    const octave = parseInt(match[2], 10);
    const semitone = noteMap[note];
    
    if (semitone === undefined) return 60;
    
    return octave * 12 + semitone + 12;
};