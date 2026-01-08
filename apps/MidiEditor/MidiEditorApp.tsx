import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SavedMidiFile, SongSequence, NoteEvent, InstrumentPreset } from '../../types';
import { SessionRepository } from '../../services/data/SessionRepository';
import { PRESETS } from '../../services/audio/presets';
import { AudioEngine } from '../../services/audio/AudioEngine';
import { noteToFreq, midiToNoteName, noteNameToMidi } from '../../services/audio/musicUtils';
import { Mp3ToMidiConverter } from '../../services/audio/Mp3ToMidiConverter';

// Piano roll constants
const NOTE_HEIGHT = 12;
const BEAT_WIDTH = 80;
const MIN_NOTE_NUMBER = 21;  // A0
const MAX_NOTE_NUMBER = 108; // C8
const TOTAL_NOTES = MAX_NOTE_NUMBER - MIN_NOTE_NUMBER + 1;

interface MidiEditorAppProps {
  onBack?: () => void;
}

export const MidiEditorApp: React.FC<MidiEditorAppProps> = ({ onBack }) => {
  // State
  const [midiFiles, setMidiFiles] = useState<SavedMidiFile[]>([]);
  const [selectedMidi, setSelectedMidi] = useState<SavedMidiFile | null>(null);
  const [editingSequence, setEditingSequence] = useState<SongSequence | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [tempo, setTempo] = useState(120); // BPM
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [selectedNotes, setSelectedNotes] = useState<Set<number>>(new Set());
  const [tool, setTool] = useState<'select' | 'pencil' | 'eraser'>('select');
  
  // Converter state
  const [isConverting, setIsConverting] = useState(false);
  const [convertProgress, setConvertProgress] = useState(0);
  
  // Refs
  const playbackRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const noteTimeoutsRef = useRef<number[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  
  // Active preset for playback
  const [activePreset] = useState<InstrumentPreset>(PRESETS.CONCERT_GRAND);
  
  // Load MIDI files
  useEffect(() => {
    loadMidiFiles();
  }, []);
  
  const loadMidiFiles = async () => {
    try {
      const files = await SessionRepository.getAllMidiFiles();
      setMidiFiles(files);
    } catch (error) {
      console.error('Failed to load MIDI files:', error);
    }
  };
  
  // Calculate grid dimensions
  const gridDimensions = useMemo(() => {
    if (!editingSequence || editingSequence.events.length === 0) {
      return { width: BEAT_WIDTH * 16, height: NOTE_HEIGHT * TOTAL_NOTES };
    }
    
    const maxTime = Math.max(...editingSequence.events.map(e => e.startTime + e.duration));
    const beatsNeeded = Math.ceil(maxTime / (60 / tempo)) + 8;
    
    return {
      width: Math.max(BEAT_WIDTH * beatsNeeded, BEAT_WIDTH * 16),
      height: NOTE_HEIGHT * TOTAL_NOTES
    };
  }, [editingSequence, tempo]);
  
  // Handle MIDI file selection
  const handleSelectMidi = (midi: SavedMidiFile) => {
    stopPlayback();
    setSelectedMidi(midi);
    setEditingSequence(JSON.parse(JSON.stringify(midi.sequence)));
    setTempo(midi.sequence.bpm || 120);
    setPlaybackPosition(0);
    setSelectedNotes(new Set());
  };
  
  // Create new MIDI
  const handleNewMidi = () => {
    stopPlayback();
    const newSequence: SongSequence = {
      id: crypto.randomUUID(),
      title: 'New Song',
      bpm: 120,
      events: []
    };
    setSelectedMidi(null);
    setEditingSequence(newSequence);
    setTempo(120);
    setPlaybackPosition(0);
    setSelectedNotes(new Set());
  };
  
  // Save MIDI
  const handleSaveMidi = async () => {
    if (!editingSequence) return;
    
    const updatedSequence = {
      ...editingSequence,
      bpm: tempo
    };
    
    const midiFile: SavedMidiFile = selectedMidi ? {
      ...selectedMidi,
      sequence: updatedSequence
    } : {
      id: crypto.randomUUID(),
      name: editingSequence.title,
      sequence: updatedSequence
    };
    
    try {
      await SessionRepository.saveMidiFile(midiFile);
      await loadMidiFiles();
      setSelectedMidi(midiFile);
      alert('MIDI saved!');
    } catch (error) {
      console.error('Failed to save MIDI:', error);
      alert('Failed to save MIDI');
    }
  };
  
  // Delete MIDI
  const handleDeleteMidi = async (id: string) => {
    if (!confirm('Delete this MIDI file?')) return;
    try {
      await SessionRepository.deleteMidiFile(id);
      if (selectedMidi?.id === id) {
        setSelectedMidi(null);
        setEditingSequence(null);
      }
      await loadMidiFiles();
    } catch (error) {
      console.error('Failed to delete MIDI:', error);
    }
  };
  
  // Playback controls
  const playMidi = () => {
    if (!editingSequence || editingSequence.events.length === 0) return;
    
    stopPlayback();
    setIsPlaying(true);
    startTimeRef.current = Date.now() - (playbackPosition * 1000);
    
    const tempoFactor = 120 / tempo;
    
    editingSequence.events.forEach((event, index) => {
      const adjustedStart = event.startTime * tempoFactor;
      const adjustedDuration = event.duration * tempoFactor;
      
      if (adjustedStart >= playbackPosition) {
        const noteOnDelay = (adjustedStart - playbackPosition) * 1000;
        const noteOffDelay = (adjustedStart + adjustedDuration - playbackPosition) * 1000;
        
        const onTimeout = window.setTimeout(() => {
          const freq = noteToFreq(event.noteName);
          if (freq) {
            AudioEngine.playNote(event.noteName, freq, activePreset, 0);
          }
        }, noteOnDelay);
        
        const offTimeout = window.setTimeout(() => {
          const freq = noteToFreq(event.noteName);
          if (freq) {
            AudioEngine.stopNote(event.noteName, freq, 0);
          }
        }, noteOffDelay);
        
        noteTimeoutsRef.current.push(onTimeout, offTimeout);
      }
    });
    
    // Update playback position animation
    const updatePosition = () => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      setPlaybackPosition(elapsed);
      
      const maxTime = Math.max(...editingSequence.events.map(e => (e.startTime + e.duration) * (120 / tempo)));
      if (elapsed < maxTime) {
        playbackRef.current = requestAnimationFrame(updatePosition);
      } else {
        stopPlayback();
      }
    };
    playbackRef.current = requestAnimationFrame(updatePosition);
  };
  
  const stopPlayback = () => {
    setIsPlaying(false);
    if (playbackRef.current) {
      cancelAnimationFrame(playbackRef.current);
      playbackRef.current = null;
    }
    noteTimeoutsRef.current.forEach(t => clearTimeout(t));
    noteTimeoutsRef.current = [];
  };
  
  const rewind = () => {
    stopPlayback();
    setPlaybackPosition(0);
  };
  
  // Import MP3 and convert
  const handleImportAudio = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      setIsConverting(true);
      setConvertProgress(0);
      
      try {
        const midiFile = await Mp3ToMidiConverter.convert(file, setConvertProgress);
        await SessionRepository.saveMidiFile(midiFile);
        await loadMidiFiles();
        handleSelectMidi(midiFile);
      } catch (error) {
        console.error('Conversion failed:', error);
        alert('Failed to convert audio file');
      } finally {
        setIsConverting(false);
        setConvertProgress(0);
      }
    };
    
    input.click();
  };
  
  // Import MIDI file
  const handleImportMidi = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      // Basic MIDI import (simplified - real MIDI parsing is complex)
      alert('Standard MIDI import coming soon. Use audio import for now.');
    };
    
    input.click();
  };
  
  // Export MIDI
  const handleExportMidi = () => {
    if (!editingSequence) return;
    
    try {
      const midiData = Mp3ToMidiConverter.exportToMidiFile(editingSequence);
      const blob = new Blob([midiData], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `${editingSequence.title}.mid`;
      a.click();
      
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export MIDI');
    }
  };
  
  // Add note
  const handleAddNote = (e: React.MouseEvent) => {
    if (tool !== 'pencil' || !editingSequence || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + canvasRef.current.scrollLeft;
    const y = e.clientY - rect.top + canvasRef.current.scrollTop;
    
    const midiNote = MAX_NOTE_NUMBER - Math.floor(y / NOTE_HEIGHT);
    const startBeat = Math.floor(x / BEAT_WIDTH);
    const startTime = startBeat * (60 / tempo);
    
    if (midiNote < MIN_NOTE_NUMBER || midiNote > MAX_NOTE_NUMBER) return;
    
    const noteName = midiToNoteName(midiNote);
    const newEvent: NoteEvent = {
      noteName,
      midi: midiNote,
      startTime,
      duration: 60 / tempo, // One beat duration
      velocity: 0.8
    };
    
    setEditingSequence({
      ...editingSequence,
      events: [...editingSequence.events, newEvent]
    });
    
    // Play the note for feedback
    const freq = noteToFreq(noteName);
    if (freq) {
      AudioEngine.playNote(noteName, freq, activePreset, 0);
      setTimeout(() => AudioEngine.stopNote(noteName, freq, 0), 200);
    }
  };
  
  // Delete selected notes
  const handleDeleteSelected = () => {
    if (!editingSequence || selectedNotes.size === 0) return;
    
    setEditingSequence({
      ...editingSequence,
      events: editingSequence.events.filter((_, i) => !selectedNotes.has(i))
    });
    setSelectedNotes(new Set());
  };
  
  // Render note on piano roll
  const renderNote = (event: NoteEvent, index: number) => {
    const midiNote = event.midi || noteNameToMidi(event.noteName);
    const y = (MAX_NOTE_NUMBER - midiNote) * NOTE_HEIGHT;
    const x = (event.startTime / (60 / tempo)) * BEAT_WIDTH;
    const width = (event.duration / (60 / tempo)) * BEAT_WIDTH;
    
    const isSelected = selectedNotes.has(index);
    const isBlackKey = event.noteName.includes('#');
    
    return (
      <div
        key={index}
        className={`absolute rounded cursor-pointer transition-all ${
          isSelected 
            ? 'bg-yellow-400 border-2 border-yellow-600' 
            : isBlackKey 
              ? 'bg-indigo-500 hover:bg-indigo-400' 
              : 'bg-indigo-400 hover:bg-indigo-300'
        }`}
        style={{
          left: x,
          top: y,
          width: Math.max(width, 4),
          height: NOTE_HEIGHT - 1
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (tool === 'select') {
            if (e.shiftKey) {
              const newSelected = new Set(selectedNotes);
              if (newSelected.has(index)) {
                newSelected.delete(index);
              } else {
                newSelected.add(index);
              }
              setSelectedNotes(newSelected);
            } else {
              setSelectedNotes(new Set([index]));
            }
          } else if (tool === 'eraser') {
            setEditingSequence({
              ...editingSequence!,
              events: editingSequence!.events.filter((_, i) => i !== index)
            });
          }
        }}
      />
    );
  };
  
  // Render piano keys on left side
  const renderPianoKeys = () => {
    const keys = [];
    for (let midi = MAX_NOTE_NUMBER; midi >= MIN_NOTE_NUMBER; midi--) {
      const noteName = midiToNoteName(midi);
      const isBlack = noteName.includes('#');
      keys.push(
        <div
          key={midi}
          className={`h-[${NOTE_HEIGHT}px] flex items-center justify-end pr-2 text-[8px] border-b border-zinc-700 ${
            isBlack ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-900 text-zinc-500'
          }`}
          style={{ height: NOTE_HEIGHT }}
        >
          {noteName}
        </div>
      );
    }
    return keys;
  };
  
  // Mobile sidebar toggle
  const [showSidebar, setShowSidebar] = useState(window.innerWidth >= 768);
  
  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900">
      {/* Header */}
      <div className="min-h-[56px] bg-black/30 border-b border-zinc-700 flex flex-wrap items-center justify-between px-2 sm:px-4 py-2 gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-4">
          {onBack && (
            <button
              onClick={onBack}
              className="px-2 sm:px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-xs sm:text-sm text-white"
            >
              ← Back
            </button>
          )}
          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="md:hidden p-2 bg-zinc-700 hover:bg-zinc-600 rounded text-white"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <h1 className="text-base sm:text-xl font-bold text-white hidden xs:block">MIDI Editor</h1>
          {editingSequence && (
            <input
              type="text"
              value={editingSequence.title}
              onChange={(e) => setEditingSequence({ ...editingSequence, title: e.target.value })}
              className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-white text-xs sm:text-sm w-24 sm:w-auto"
            />
          )}
        </div>
        
        <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end">
          {/* Tempo control */}
          <div className="flex items-center gap-1 sm:gap-2 bg-zinc-800 rounded px-1.5 sm:px-2 py-1">
            <span className="text-zinc-400 text-[10px] sm:text-xs">BPM:</span>
            <input
              type="number"
              value={tempo}
              onChange={(e) => setTempo(Math.max(20, Math.min(300, parseInt(e.target.value) || 120)))}
              className="w-10 sm:w-14 bg-transparent text-white text-center text-xs sm:text-sm outline-none"
            />
            <input
              type="range"
              min="20"
              max="300"
              value={tempo}
              onChange={(e) => setTempo(parseInt(e.target.value))}
              className="w-12 sm:w-20 accent-indigo-500 hidden xs:block"
            />
          </div>
          
          {/* Playback controls */}
          <button
            onClick={rewind}
            className="p-1.5 sm:p-2 bg-zinc-700 hover:bg-zinc-600 rounded text-white"
            title="Rewind"
          >
            <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
          </button>
          <button
            onClick={isPlaying ? stopPlayback : playMidi}
            className={`p-1.5 sm:p-2 rounded text-white ${isPlaying ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'}`}
            title={isPlaying ? 'Stop' : 'Play'}
          >
            {isPlaying ? (
              <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            ) : (
              <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          
          {/* Save */}
          <button
            onClick={handleSaveMidi}
            disabled={!editingSequence}
            className="px-2 sm:px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-xs sm:text-sm text-white"
          >
            Save
          </button>
          
          {/* Export */}
          <button
            onClick={handleExportMidi}
            disabled={!editingSequence}
            className="px-2 sm:px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded text-xs sm:text-sm text-white hidden sm:block"
          >
            Export
          </button>
        </div>
      </div>
      
      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left sidebar - File list (collapsible on mobile) */}
        <div className={`${showSidebar ? 'absolute inset-0 z-20 md:relative md:inset-auto' : 'hidden'} md:block w-full md:w-56 lg:w-64 bg-black/95 md:bg-black/20 border-r border-zinc-700 flex flex-col flex-shrink-0`}>
          <div className="p-2 sm:p-3 border-b border-zinc-700">
            <div className="flex justify-between items-center mb-2 md:hidden">
              <span className="text-white font-bold">MIDI Files</span>
              <button onClick={() => setShowSidebar(false)} className="text-zinc-400 hover:text-white">✕</button>
            </div>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => { handleNewMidi(); setShowSidebar(false); }}
                className="flex-1 px-2 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-xs text-white"
              >
                + New
              </button>
              <button
                onClick={handleImportAudio}
                disabled={isConverting}
                className="flex-1 px-2 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-xs text-white"
                title="Convert audio to MIDI"
              >
                {isConverting ? `${convertProgress}%` : '🎵 Audio'}
              </button>
            </div>
            <button
              onClick={handleImportMidi}
              className="w-full px-2 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-xs text-white"
            >
              Import .mid
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2">
            <div className="text-xs text-zinc-500 uppercase mb-2 hidden md:block">MIDI Files</div>
            {midiFiles.length === 0 ? (
              <div className="text-zinc-500 text-sm text-center py-4">No MIDI files</div>
            ) : (
              midiFiles.map(midi => (
                <div
                  key={midi.id}
                  className={`p-2 sm:p-2 rounded mb-1 cursor-pointer flex items-center justify-between group ${
                    selectedMidi?.id === midi.id ? 'bg-indigo-600' : 'bg-zinc-800 hover:bg-zinc-700'
                  }`}
                  onClick={() => { handleSelectMidi(midi); setShowSidebar(false); }}
                >
                  <div className="truncate text-sm text-white">{midi.name}</div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteMidi(midi.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-xs ml-2"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        
        {/* Main editor area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="h-10 bg-zinc-800 border-b border-zinc-700 flex items-center px-2 sm:px-3 gap-1 sm:gap-2 flex-shrink-0">
            <div className="flex gap-0.5 sm:gap-1 bg-zinc-900 rounded p-0.5 sm:p-1">
              <button
                onClick={() => setTool('select')}
                className={`p-1 sm:p-1.5 rounded text-sm ${tool === 'select' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                title="Select (V)"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" /></svg>
              </button>
              <button
                onClick={() => setTool('pencil')}
                className={`p-1 sm:p-1.5 rounded text-sm ${tool === 'pencil' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                title="Pencil (P)"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </button>
              <button
                onClick={() => setTool('eraser')}
                className={`p-1 sm:p-1.5 rounded text-sm ${tool === 'eraser' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                title="Eraser (E)"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
            
            <div className="h-6 w-px bg-zinc-700" />
            
            <button
              onClick={handleDeleteSelected}
              disabled={selectedNotes.size === 0}
              className="px-1.5 sm:px-2 py-1 bg-red-600/50 hover:bg-red-600 disabled:opacity-30 rounded text-[10px] sm:text-xs text-white"
            >
              Delete
            </button>
            
            {editingSequence && (
              <span className="text-zinc-500 text-[10px] sm:text-xs ml-auto">
                {editingSequence.events.length} notes
              </span>
            )}
          </div>
          
          {/* Piano roll */}
          {editingSequence ? (
            <div className="flex-1 flex overflow-hidden touch-pan-x touch-pan-y">
              {/* Piano keys */}
              <div className="w-8 sm:w-12 bg-zinc-900 flex-shrink-0 overflow-y-auto scrollbar-thin">
                {renderPianoKeys()}
              </div>
              
              {/* Note grid */}
              <div
                ref={canvasRef}
                className="flex-1 overflow-auto relative bg-zinc-800 touch-pan-x touch-pan-y"
                onClick={handleAddNote}
              >
                {/* Grid background */}
                <div
                  className="absolute inset-0"
                  style={{
                    width: gridDimensions.width,
                    height: gridDimensions.height,
                    backgroundImage: `
                      linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px),
                      linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)
                    `,
                    backgroundSize: `${BEAT_WIDTH}px ${NOTE_HEIGHT}px`
                  }}
                />
                
                {/* Playback position line */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                  style={{
                    left: (playbackPosition / (60 / tempo)) * BEAT_WIDTH,
                    height: gridDimensions.height
                  }}
                />
                
                {/* Notes */}
                <div className="relative" style={{ width: gridDimensions.width, height: gridDimensions.height }}>
                  {editingSequence.events.map((event, index) => renderNote(event, index))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-500 p-4">
              <div className="text-center">
                <div className="text-4xl sm:text-6xl mb-4">🎹</div>
                <div className="text-lg sm:text-xl mb-2">No MIDI selected</div>
                <div className="text-xs sm:text-sm">Create a new MIDI or select one from the list</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
