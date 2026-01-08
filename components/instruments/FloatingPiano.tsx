
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { InstrumentPreset, NoteDef, SongSequence, SavedMidiFile } from '../../types';
import { PRESETS } from '../../services/audio/presets';
import { getClientCoordinates, generateKeyboard, noteToFreq } from '../../services/audio/musicUtils';
import { AudioEngine } from '../../services/audio/AudioEngine';

interface FloatingPianoProps {
  id: string; // Unique Instance ID
  zIndex: number;
  initialPosition: { x: number, y: number };
  initialSize: { width: number, height: number };
  
  // Audio Actions
  activeNotes: Set<string>; // Global active notes (for visualization sync)
  onPlayNote: (note: string, freq: number, preset: InstrumentPreset, transpose: number, panPosition?: number) => void;
  onStopNote: (note: string, freq: number, transpose: number) => void;
  
  // Workspace Actions
  onFocus: () => void;
  onClose: () => void;
  onUpdateConfig: (config: any) => void; // Save state back to parent
  
  // MIDI Support
  midiFiles?: SavedMidiFile[];
  onImportMidi?: () => void;
}

export const FloatingPiano: React.FC<FloatingPianoProps> = ({
  id,
  zIndex,
  initialPosition,
  initialSize,
  activeNotes,
  onPlayNote,
  onStopNote,
  onFocus,
  onClose,
  onUpdateConfig,
  midiFiles = [],
  onImportMidi
}) => {
  // --- LOCAL STATE ---
  const [activePreset, setActivePreset] = useState<InstrumentPreset>(PRESETS.CONCERT_GRAND);
  const [keyWidth, setKeyWidth] = useState(50);
  const [transpose, setTranspose] = useState(0);
  const [volume, setVolume] = useState(AudioEngine.getVolume() * 100);
  
  // Window State
  const [position, setPosition] = useState(initialPosition);
  const [size, setSize] = useState(initialSize);
  
  // UI Toggles
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [showMidiMenu, setShowMidiMenu] = useState(false);
  
  // MIDI Playback State
  const [isPlayingMidi, setIsPlayingMidi] = useState(false);
  const [currentMidi, setCurrentMidi] = useState<SongSequence | null>(null);
  const [midiTempo, setMidiTempo] = useState(100); // Playback speed percentage (100% = normal)
  const [midiPlaybackTime, setMidiPlaybackTime] = useState(0); // Current playback time in seconds
  const midiTimeoutRefs = useRef<number[]>([]);
  const midiStartTimeRef = useRef<number>(0);
  const midiAnimationRef = useRef<number>(0);

  // Refs for interactions
  const dragRef = useRef<{ startX: number, startY: number, initX: number, initY: number } | null>(null);
  const resizeRef = useRef<{ startX: number, startY: number, initW: number, initH: number } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fallingNotesCanvasRef = useRef<HTMLCanvasElement>(null);

  // Generate Local Keyboard (Standard 88 keys range effectively)
  const notes = useMemo(() => generateKeyboard(1, 7), []);

  // --- HANDLERS ---

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button, .no-drag')) return;
    onFocus(); // Bring to front
    const coords = getClientCoordinates(e);
    dragRef.current = {
        startX: coords.x,
        startY: coords.y,
        initX: position.x,
        initY: position.y
    };
  };

  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    onFocus();
    const coords = getClientCoordinates(e);
    resizeRef.current = {
        startX: coords.x,
        startY: coords.y,
        initW: size.width,
        initH: size.height
    };
  };

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
        const coords = getClientCoordinates(e);

        // DRAGGING
        if (dragRef.current) {
            e.preventDefault();
            const dx = coords.x - dragRef.current.startX;
            const dy = coords.y - dragRef.current.startY;
            setPosition({
                x: dragRef.current.initX + dx,
                y: dragRef.current.initY + dy
            });
        }

        // RESIZING
        if (resizeRef.current) {
            e.preventDefault();
            const dx = coords.x - resizeRef.current.startX;
            const dy = coords.y - resizeRef.current.startY;
            
            // Constrain constraints
            const newWidth = Math.max(300, resizeRef.current.initW + dx);
            const newHeight = Math.max(150, resizeRef.current.initH + dy);

            setSize({ width: newWidth, height: newHeight });
        }
    };

    const handleUp = () => {
        dragRef.current = null;
        resizeRef.current = null;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleUp);

    return () => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', handleUp);
    };
  }, []);

  // Initial Scroll to Middle C
  useEffect(() => {
    if (scrollContainerRef.current) {
        // Rough estimate to center
        scrollContainerRef.current.scrollLeft = 1000;
    }
  }, []);

  const handleScroll = (direction: 'left' | 'right') => {
      if (!scrollContainerRef.current) return;
      const amount = keyWidth * 4; // Scroll 4 keys distance
      scrollContainerRef.current.scrollBy({
          left: direction === 'left' ? -amount : amount,
          behavior: 'smooth'
      });
  };

  const handleVolumeChange = (newVolume: number) => {
      setVolume(newVolume);
      AudioEngine.setVolume(newVolume / 100);
  };


  // --- HELPERS ---
  // Calculate pan position based on piano's horizontal center relative to screen width
  const getPanPosition = (): number => {
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const pianoCenterX = position.x + (size.width / 2);
    return Math.max(0, Math.min(1, pianoCenterX / screenWidth));
  };
  
  const playLocal = (note: string, freq: number) => onPlayNote(note, freq, activePreset, transpose, getPanPosition());
  const stopLocal = (note: string, freq: number) => onStopNote(note, freq, transpose);

  // --- MIDI PLAYBACK WITH FALLING NOTES ---
  const playMidi = (sequence: SongSequence) => {
    stopMidi(); // Stop any current playback
    setCurrentMidi(sequence);
    setIsPlayingMidi(true);
    setMidiPlaybackTime(0);
    
    midiStartTimeRef.current = Date.now();
    const pan = getPanPosition();
    const tempoMultiplier = 100 / midiTempo; // 100% = 1x, 50% = 2x slower, 200% = 0.5x faster
    
    sequence.events.forEach(event => {
      // Schedule note on (adjusted by tempo)
      const noteOnTimeout = window.setTimeout(() => {
        const freq = noteToFreq(event.noteName);
        if (freq) {
          onPlayNote(event.noteName, freq, activePreset, transpose, pan);
        }
      }, event.startTime * 1000 * tempoMultiplier);
      
      // Schedule note off (adjusted by tempo)
      const noteOffTimeout = window.setTimeout(() => {
        const freq = noteToFreq(event.noteName);
        if (freq) {
          onStopNote(event.noteName, freq, transpose);
        }
      }, (event.startTime + event.duration) * 1000 * tempoMultiplier);
      
      midiTimeoutRefs.current.push(noteOnTimeout, noteOffTimeout);
    });
    
    // Schedule playback end
    const maxTime = Math.max(...sequence.events.map(e => e.startTime + e.duration));
    const endTimeout = window.setTimeout(() => {
      setIsPlayingMidi(false);
      setCurrentMidi(null);
      setMidiPlaybackTime(0);
      cancelAnimationFrame(midiAnimationRef.current);
    }, maxTime * 1000 * tempoMultiplier + 100);
    midiTimeoutRefs.current.push(endTimeout);
    
    // Start falling notes animation
    startFallingNotesAnimation(tempoMultiplier);
  };
  
  const stopMidi = () => {
    midiTimeoutRefs.current.forEach(t => clearTimeout(t));
    midiTimeoutRefs.current = [];
    cancelAnimationFrame(midiAnimationRef.current);
    setIsPlayingMidi(false);
    setCurrentMidi(null);
    setMidiPlaybackTime(0);
    
    // Clear canvas
    const canvas = fallingNotesCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  };
  
  // Falling notes animation
  const startFallingNotesAnimation = (tempoMultiplier: number) => {
    const animate = () => {
      if (!isPlayingMidi && !currentMidi) return;
      
      const elapsed = (Date.now() - midiStartTimeRef.current) / 1000 / tempoMultiplier;
      setMidiPlaybackTime(elapsed);
      
      renderFallingNotes(elapsed, tempoMultiplier);
      
      midiAnimationRef.current = requestAnimationFrame(animate);
    };
    
    midiAnimationRef.current = requestAnimationFrame(animate);
  };
  
  // Render falling notes on canvas
  const renderFallingNotes = (currentTime: number, tempoMultiplier: number) => {
    const canvas = fallingNotesCanvasRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (!canvas || !scrollContainer || !currentMidi) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Get visible width and actual scroll position
    const visibleWidth = size.width;
    const canvasHeight = size.height - 50; // Leave space for header
    const scrollOffset = scrollContainer.scrollLeft;
    
    // Set canvas size to match VISIBLE area (not scroll area)
    canvas.width = visibleWidth;
    canvas.height = canvasHeight;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Calculate visible time window (notes fall from top)
    const lookAheadTime = 3; // Show notes 3 seconds ahead
    const pixelsPerSecond = (canvasHeight) / lookAheadTime;
    
    // Map MIDI notes to keyboard positions - calculate based on note names
    // C1 starts at position 0, each white key adds keyWidth
    const getNotePosition = (noteName: string): { x: number; width: number; isBlack: boolean } | null => {
      // Parse note name (e.g., "C4", "C#4", "Db4")
      const match = noteName.match(/^([A-G])([#b]?)(\d+)$/);
      if (!match) return null;
      
      const [, letter, accidental, octaveStr] = match;
      const octave = parseInt(octaveStr, 10);
      
      // White key notes: C, D, E, F, G, A, B
      // Black key notes: C#/Db, D#/Eb, F#/Gb, G#/Ab, A#/Bb
      const whiteKeyOrder = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
      const isBlack = accidental === '#' || accidental === 'b';
      
      // Calculate which white key this note is at or adjacent to
      let baseWhiteKeyIndex: number;
      if (isBlack) {
        if (accidental === '#') {
          baseWhiteKeyIndex = whiteKeyOrder.indexOf(letter);
        } else {
          // Flat - it's the note before
          const flatIndex = whiteKeyOrder.indexOf(letter);
          baseWhiteKeyIndex = flatIndex - 1;
          if (baseWhiteKeyIndex < 0) baseWhiteKeyIndex = 6; // Bb is before B
        }
      } else {
        baseWhiteKeyIndex = whiteKeyOrder.indexOf(letter);
      }
      
      // Calculate absolute white key position from C1
      const octaveOffset = (octave - 1) * 7; // 7 white keys per octave
      const whiteKeyPosition = octaveOffset + baseWhiteKeyIndex;
      
      // Calculate X position
      const startPadding = 16; // Same as keyboard padding
      const whiteKeyWidth = keyWidth;
      const blackKeyWidth = keyWidth * 0.65;
      
      if (isBlack) {
        // Black key overlaps between two white keys
        const x = startPadding + (whiteKeyPosition * whiteKeyWidth) + (whiteKeyWidth * 0.675);
        return { x, width: blackKeyWidth, isBlack: true };
      } else {
        const x = startPadding + (whiteKeyPosition * whiteKeyWidth);
        return { x, width: whiteKeyWidth, isBlack: false };
      }
    };
    
    // Render each note
    currentMidi.events.forEach(event => {
      const noteEnd = event.startTime + event.duration;
      
      // Only render notes that are visible in the time window
      if (noteEnd >= currentTime - 0.5 && event.startTime <= currentTime + lookAheadTime) {
        const notePos = getNotePosition(event.noteName);
        if (!notePos) return;
        
        // Calculate Y position (notes fall down toward bottom)
        const timeUntilNote = event.startTime - currentTime;
        const noteHeight = Math.max(4, event.duration * pixelsPerSecond);
        
        // Y position: 0 = top of canvas, notes at currentTime should be at bottom
        // Notes coming up should be at top and fall down
        const yBottom = canvasHeight - (timeUntilNote * pixelsPerSecond);
        const yTop = yBottom - noteHeight;
        
        // Adjust X position for scroll offset
        const x = notePos.x - scrollOffset;
        
        // Only draw if visible in viewport
        if (x + notePos.width > 0 && x < visibleWidth) {
          // Determine color based on note type and state
          const isPlaying = currentTime >= event.startTime && currentTime <= noteEnd;
          
          // Reset shadow for clean drawing
          ctx.shadowBlur = 0;
          ctx.shadowColor = 'transparent';
          
          if (notePos.isBlack) {
            ctx.fillStyle = isPlaying ? '#818cf8' : '#4f46e5'; // Indigo for black keys
          } else {
            ctx.fillStyle = isPlaying ? '#a78bfa' : '#7c3aed'; // Purple for white keys
          }
          
          // Draw rounded rectangle
          const radius = 4;
          const y = Math.max(0, yTop);
          const height = Math.min(noteHeight, canvasHeight - y);
          
          if (height > 0 && y < canvasHeight) {
            ctx.beginPath();
            ctx.roundRect(x + 2, y, notePos.width - 4, height, radius);
            ctx.fill();
            
            // Add glow effect for playing notes
            if (isPlaying) {
              ctx.shadowColor = '#a78bfa';
              ctx.shadowBlur = 15;
              ctx.fillStyle = 'rgba(167, 139, 250, 0.6)';
              ctx.beginPath();
              ctx.roundRect(x + 2, y, notePos.width - 4, height, radius);
              ctx.fill();
              ctx.shadowBlur = 0;
            }
          }
        }
      }
    });
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      midiTimeoutRefs.current.forEach(t => clearTimeout(t));
      cancelAnimationFrame(midiAnimationRef.current);
    };
  }, []);

  // Dynamic Key Height based on window height
  // Header is approx 40px, bottom padding 20px. 
  const keyHeight = Math.max(80, size.height - 70); 

  return (
      <div 
        className="absolute rounded-2xl shadow-2xl flex flex-col border border-white/10 bg-[#1e2029]/95 backdrop-blur-2xl transition-shadow duration-200"
        style={{
            transform: `translate(${position.x}px, ${position.y}px)`,
            width: size.width,
            height: size.height,
            zIndex: zIndex,
            touchAction: 'none'
        }}
        onMouseDown={onFocus}
        onTouchStart={onFocus}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* HEADER BAR */}
        <div 
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
            className="h-10 bg-white/5 border-b border-white/5 flex items-center justify-between px-3 cursor-grab active:cursor-grabbing select-none flex-shrink-0"
        >
             {/* Left: Preset Selector */}
             <div className="flex items-center gap-2">
                <button 
                    onClick={(e) => { e.stopPropagation(); setShowPresetMenu(!showPresetMenu); setShowSettings(false); setShowVolume(false); setShowMidiMenu(false); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="flex items-center gap-2 px-2 py-1 hover:bg-white/10 rounded transition-colors no-drag"
                >
                    <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
                    <span className="text-xs font-bold text-zinc-300 uppercase tracking-wide truncate max-w-[120px]">{activePreset.name}</span>
                    <svg className="w-3 h-3 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
             </div>

             {/* Right: Controls */}
             <div className="flex items-center gap-1">
                {/* MIDI Button */}
                <button 
                    onClick={(e) => { e.stopPropagation(); setShowMidiMenu(!showMidiMenu); setShowSettings(false); setShowVolume(false); setShowPresetMenu(false); }} 
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`p-1.5 rounded hover:bg-white/10 no-drag ${isPlayingMidi ? 'text-green-400 animate-pulse' : showMidiMenu ? 'text-indigo-400' : 'text-zinc-500 hover:text-white'}`} 
                    title={isPlayingMidi ? "Playing MIDI" : "MIDI Files"}
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                </button>
                <button onClick={(e) => { e.stopPropagation(); setShowVolume(!showVolume); setShowSettings(false); setShowMidiMenu(false); setShowPresetMenu(false); }} onMouseDown={(e) => e.stopPropagation()} className={`p-1.5 rounded hover:bg-white/10 no-drag ${showVolume ? 'text-indigo-400' : 'text-zinc-500 hover:text-white'}`} title="Volume">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                </button>
                <button onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); setShowVolume(false); setShowMidiMenu(false); setShowPresetMenu(false); }} onMouseDown={(e) => e.stopPropagation()} className="p-1.5 text-zinc-500 hover:text-white rounded hover:bg-white/10 no-drag">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </button>
                <div className="w-px h-4 bg-white/10 mx-1"></div>
                <button onClick={(e) => { e.stopPropagation(); onClose(); }} onMouseDown={(e) => e.stopPropagation()} className="p-1.5 text-zinc-500 hover:text-red-400 rounded hover:bg-white/10 no-drag">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
             </div>
        </div>

        {/* CONTENT: KEYBOARD */}
        <div className="flex-1 relative bg-black/40 group/keyboard overflow-hidden rounded-b-2xl">
            
            {/* FALLING NOTES CANVAS - Overlays the keyboard */}
            {isPlayingMidi && currentMidi && (
              <canvas
                ref={fallingNotesCanvasRef}
                className="absolute inset-0 z-40 pointer-events-none"
                style={{ 
                  width: '100%', 
                  height: '100%',
                  opacity: 0.9
                }}
              />
            )}
            
            {/* LEFT ARROW */}
            <button 
                onMouseDown={(e) => { e.stopPropagation(); handleScroll('left'); }}
                onTouchStart={(e) => { e.stopPropagation(); handleScroll('left'); }}
                className="no-drag absolute left-0 top-0 bottom-0 w-10 z-[60] bg-gradient-to-r from-black/80 to-transparent flex items-center justify-center text-white/50 hover:text-white hover:bg-black/60 transition-all opacity-0 group-hover/keyboard:opacity-100"
            >
                <svg className="w-8 h-8 drop-shadow-lg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg>
            </button>

            {/* SCROLL AREA */}
            <div 
                ref={scrollContainerRef}
                className="absolute inset-0 overflow-hidden touch-none"
                onMouseDown={(e) => e.stopPropagation()} 
            >
                <div className="flex h-full items-start pt-1 px-4 min-w-max">
                     {notes.map((n, idx) => {
                         if (n.type === 'white') {
                            return (
                                <div key={n.note} className="relative group">
                                    <PianoKey 
                                        noteDef={n}
                                        isActive={activeNotes.has(n.note)}
                                        onPlay={playLocal}
                                        onStop={stopLocal}
                                        height={keyHeight}
                                        width={keyWidth}
                                    />
                                    {notes[idx + 1]?.type === 'black' && (
                                        <div 
                                            className="absolute top-0 left-full z-50 pointer-events-none" 
                                            style={{ transform: 'translateX(-50%)' }}
                                        >
                                            <div className="pointer-events-auto">
                                                <PianoKey 
                                                    noteDef={notes[idx + 1]}
                                                    isActive={activeNotes.has(notes[idx + 1].note)}
                                                    onPlay={playLocal}
                                                    onStop={stopLocal}
                                                    height={keyHeight * 0.6}
                                                    width={keyWidth * 0.65}
                                                    isBlack
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                         }
                         return null;
                     })}
                </div>
            </div>

            {/* RIGHT ARROW */}
            <button 
                onMouseDown={(e) => { e.stopPropagation(); handleScroll('right'); }}
                onTouchStart={(e) => { e.stopPropagation(); handleScroll('right'); }}
                className="no-drag absolute right-0 top-0 bottom-0 w-10 z-[60] bg-gradient-to-l from-black/80 to-transparent flex items-center justify-center text-white/50 hover:text-white hover:bg-black/60 transition-all opacity-0 group-hover/keyboard:opacity-100"
            >
                <svg className="w-8 h-8 drop-shadow-lg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
            </button>
        </div>

        {/* RESIZE HANDLE */}
        <div 
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
            className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-[60] flex items-end justify-end p-1 hover:bg-white/10 rounded-tl-lg no-drag"
        >
            <div className="w-2 h-2 border-r-2 border-b-2 border-zinc-500"></div>
        </div>

        {/* POPUP MENUS - render as absolute within piano container */}
        {showPresetMenu && (
            <div 
              className="absolute w-64 bg-[#18181b] border border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[300px] no-drag"
              style={{ 
                top: 50,
                left: 8,
                zIndex: 99999
              }}
            >
                 <div className="p-3 border-b border-white/5 text-[10px] font-bold text-zinc-500 uppercase">Library</div>
                 <div className="overflow-y-auto flex-1 p-1">
                    {Object.values(PRESETS).map(p => (
                        <button 
                            key={p.id}
                            onClick={() => { setActivePreset(p); setShowPresetMenu(false); }}
                            className={`w-full text-left text-xs py-2 px-3 rounded hover:bg-white/5 flex justify-between group ${activePreset.id === p.id ? 'bg-indigo-500/10 text-indigo-400' : 'text-zinc-400'}`}
                        >
                            <span className="font-medium">{p.name}</span>
                            <span className="opacity-0 group-hover:opacity-100 text-[10px] bg-white/10 px-1 rounded">{p.category}</span>
                        </button>
                    ))}
                 </div>
            </div>
        )}

        {showSettings && (
             <div 
               className="absolute w-56 bg-[#18181b] border border-white/10 rounded-xl shadow-2xl p-4 space-y-4 no-drag"
               style={{ 
                 top: 50,
                 right: 8,
                 zIndex: 99999
               }}
             >
                 <div>
                    <div className="flex justify-between text-xs text-zinc-400 mb-1">
                        <span>Key Width</span>
                        <span>{keyWidth}px</span>
                    </div>
                    <input type="range" min="30" max="80" value={keyWidth} onChange={(e) => setKeyWidth(Number(e.target.value))} className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-indigo-500"/>
                 </div>

                 <div>
                    <div className="flex justify-between text-xs text-zinc-400 mb-1">
                        <span>Transpose</span>
                        <span className={transpose !== 0 ? 'text-indigo-400' : ''}>{transpose > 0 ? `+${transpose}` : transpose}</span>
                    </div>
                    <div className="flex bg-zinc-800 rounded-lg p-1">
                        <button onClick={() => setTranspose(t => t-1)} className="flex-1 hover:bg-zinc-700 rounded text-xs py-1 text-zinc-400">-</button>
                        <button onClick={() => setTranspose(0)} className="flex-1 hover:bg-zinc-700 rounded text-xs py-1 text-zinc-500 border-l border-r border-black/20">0</button>
                        <button onClick={() => setTranspose(t => t+1)} className="flex-1 hover:bg-zinc-700 rounded text-xs py-1 text-zinc-400">+</button>
                    </div>
                 </div>
             </div>
        )}

        {showVolume && (
             <div 
               className="absolute w-48 bg-[#18181b] border border-white/10 rounded-xl shadow-2xl p-4 no-drag"
               style={{ 
                 top: 50,
                 right: 48,
                 zIndex: 99999
               }}
             >
                 <div className="flex justify-between text-xs text-zinc-400 mb-2">
                    <span>Volume</span>
                    <span className="text-indigo-400">{Math.round(volume)}%</span>
                 </div>
                 <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={volume} 
                    onChange={(e) => handleVolumeChange(Number(e.target.value))} 
                    className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-indigo-500"
                 />
                 <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                    <span>0%</span>
                    <span>100%</span>
                 </div>
             </div>
        )}

        {/* MIDI FILES MENU */}
        {showMidiMenu && (
             <div 
               className="absolute w-64 bg-[#18181b] border border-white/10 rounded-xl shadow-2xl no-drag max-h-96 overflow-hidden flex flex-col"
               style={{ 
                 top: 50,
                 right: 80,
                 zIndex: 99999
               }}
             >
                 <div className="flex items-center justify-between p-3 border-b border-white/10">
                    <span className="text-xs font-bold text-zinc-400 uppercase">MIDI Files</span>
                    {isPlayingMidi && (
                        <button onClick={stopMidi} className="text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded hover:bg-red-500/30">
                            Stop
                        </button>
                    )}
                 </div>
                 
                 {/* Tempo Control */}
                 <div className="px-3 py-2 border-b border-white/5 bg-zinc-900/50">
                    <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                        <span>Playback Speed</span>
                        <span className="text-indigo-400 font-medium">{midiTempo}%</span>
                    </div>
                    <input 
                        type="range" 
                        min="25" 
                        max="200" 
                        value={midiTempo} 
                        onChange={(e) => setMidiTempo(Number(e.target.value))} 
                        className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-indigo-500"
                    />
                    <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                        <span>Slow</span>
                        <button onClick={() => setMidiTempo(100)} className="text-indigo-400 hover:underline">Reset</button>
                        <span>Fast</span>
                    </div>
                 </div>
                 
                 <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {midiFiles.length === 0 ? (
                        <div className="text-center text-zinc-500 text-xs py-4">
                            No MIDI files loaded.<br/>Import from toolbar.
                        </div>
                    ) : (
                        midiFiles.map(midi => (
                            <button
                                key={midi.id}
                                onClick={() => {
                                    playMidi(midi.sequence);
                                    setShowMidiMenu(false);
                                }}
                                className={`w-full text-left text-xs p-2 rounded hover:bg-white/10 flex items-center gap-2 ${currentMidi?.id === midi.sequence.id ? 'bg-green-500/20 text-green-400' : 'text-zinc-300'}`}
                            >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                <span className="truncate">{midi.name}</span>
                            </button>
                        ))
                    )}
                 </div>
                 
                 {onImportMidi && (
                    <div className="border-t border-white/10 p-2">
                        <button 
                            onClick={() => { onImportMidi(); setShowMidiMenu(false); }}
                            className="w-full text-xs bg-indigo-500/20 text-indigo-400 py-2 rounded hover:bg-indigo-500/30 flex items-center justify-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                            Import MIDI
                        </button>
                    </div>
                 )}
             </div>
        )}

      </div>
  );
};

// --- INTERNAL PIANO KEY (Unchanged logic, just Memoized) ---
interface PianoKeyProps {
  noteDef: NoteDef;
  isActive: boolean;
  onPlay: (n: string, f: number) => void;
  onStop: (n: string, f: number) => void;
  height: number;
  width: number;
  isBlack?: boolean;
}

const PianoKey: React.FC<PianoKeyProps> = React.memo(({ noteDef, isActive, onPlay, onStop, height, width, isBlack }) => {
    
    const handleDown = (e: React.SyntheticEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onPlay(noteDef.note, noteDef.freq);
    };

    const handleUp = (e: React.SyntheticEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onStop(noteDef.note, noteDef.freq);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    if (isBlack) {
        return (
            <div
                className={`
                    relative rounded-b-lg z-50
                    transition-all duration-75 ease-out
                    ${isActive 
                        ? 'bg-[#27272a] translate-y-1 shadow-[inset_0_4px_10px_rgba(0,0,0,0.8)]' 
                        : 'bg-gradient-to-b from-[#3f3f46] to-[#18181b] shadow-[0_4px_8px_rgba(0,0,0,0.5)]'
                    }
                `}
                onMouseDown={handleDown}
                onMouseUp={handleUp}
                onMouseLeave={handleUp}
                onTouchStart={handleDown}
                onTouchEnd={handleUp}
                onContextMenu={handleContextMenu}
                style={{ height: `${height}px`, width: `${width}px`, touchAction: 'none' }}
            >
            </div>
        )
    }

    return (
        <div 
            className={`
                relative flex-shrink-0 rounded-b-xl z-0 overflow-hidden
                transition-all duration-100 ease-out
                ${isActive 
                    ? 'bg-zinc-300 scale-y-[0.99] shadow-none' 
                    : 'bg-[#f4f4f5] shadow-[0_4px_0_#d4d4d8]' 
                }
                select-none border-x border-b border-black/10
            `}
            style={{ height: `${height}px`, width: `${width}px`, touchAction: 'none' }}
            onMouseDown={handleDown}
            onMouseUp={handleUp}
            onMouseLeave={handleUp}
            onTouchStart={handleDown}
            onTouchEnd={handleUp}
            onContextMenu={handleContextMenu}
        >
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[9px] font-bold text-zinc-400 pointer-events-none opacity-50">
                {noteDef.note}
            </div>
        </div>
    );
});
