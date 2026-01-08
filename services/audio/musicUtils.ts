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