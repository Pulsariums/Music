
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
  const [isPausedMidi, setIsPausedMidi] = useState(false); // Paused for training mode
  const [currentMidi, setCurrentMidi] = useState<SongSequence | null>(null);
  const [midiTempo, setMidiTempo] = useState(100); // Playback speed percentage (100% = normal)
  const [midiPlaybackTime, setMidiPlaybackTime] = useState(0); // Current playback time in seconds
  const [midiStartPosition, setMidiStartPosition] = useState(0); // Position in seconds where we started playback from
  const midiTimeoutRefs = useRef<number[]>([]);
  const midiStartTimeRef = useRef<number>(0);
  const midiAnimationRef = useRef<number>(0);
  const midiTempoRef = useRef(midiTempo); // Ref for tempo to use in animation
  
  // Refs to avoid stale closure in animation loop
  const isPlayingMidiRef = useRef(false);
  const isPausedMidiRef = useRef(false);
  const currentMidiRef = useRef<SongSequence | null>(null);
  const showFallingNotesRef = useRef(true);
  const trainingModeEnabledRef = useRef(false);
  const keyWidthRef = useRef(keyWidth);
  const sizeRef = useRef(size);
  const pendingNotesRef = useRef<Set<string>>(new Set()); // Notes waiting to be played in training mode
  const nextEventIndexRef = useRef(0); // Track which event is next in training mode

  // Training Mode State
  const [showFallingNotes, setShowFallingNotes] = useState(true); // Visibility toggle for falling notes overlay
  // TODO: trainingModeEnabled will pause MIDI playback until user presses the correct key
  const [trainingModeEnabled, setTrainingModeEnabled] = useState(false); // Wait for user input mode (not yet implemented)

  // Refs for interactions
  const dragRef = useRef<{ startX: number, startY: number, initX: number, initY: number } | null>(null);
  const resizeRef = useRef<{ startX: number, startY: number, initW: number, initH: number } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fallingNotesCanvasRef = useRef<HTMLCanvasElement>(null);

  // Sync refs with state to avoid stale closures in animation loop
  useEffect(() => { isPlayingMidiRef.current = isPlayingMidi; }, [isPlayingMidi]);
  useEffect(() => { isPausedMidiRef.current = isPausedMidi; }, [isPausedMidi]);
  useEffect(() => { currentMidiRef.current = currentMidi; }, [currentMidi]);
  useEffect(() => { showFallingNotesRef.current = showFallingNotes; }, [showFallingNotes]);
  useEffect(() => { trainingModeEnabledRef.current = trainingModeEnabled; }, [trainingModeEnabled]);
  useEffect(() => { keyWidthRef.current = keyWidth; }, [keyWidth]);
  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => { midiTempoRef.current = midiTempo; }, [midiTempo]);

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
  
  const playLocal = (note: string, freq: number) => {
    // Check training mode - if we're waiting for this note, handle it
    if (trainingModeEnabledRef.current && isPausedMidiRef.current) {
      checkTrainingNote(note);
    }
    onPlayNote(note, freq, activePreset, transpose, getPanPosition());
  };
  const stopLocal = (note: string, freq: number) => onStopNote(note, freq, transpose);

  // --- MIDI PLAYBACK WITH FALLING NOTES ---
  // Training mode: store sorted events for waiting on user input
  const sortedEventsRef = useRef<typeof currentMidi extends { events: infer E } ? E : never[]>([]);
  const trainingPauseTimeRef = useRef<number>(0); // When we paused for training
  const trainingAccumulatedPauseRef = useRef<number>(0); // Total time spent paused
  
  const playMidi = (sequence: SongSequence, fromPosition: number = 0) => {
    stopMidi(); // Stop any current playback
    
    // Update refs IMMEDIATELY (before state updates) to avoid stale closure issues
    currentMidiRef.current = sequence;
    isPlayingMidiRef.current = true;
    isPausedMidiRef.current = false;
    pendingNotesRef.current = new Set();
    nextEventIndexRef.current = 0;
    trainingAccumulatedPauseRef.current = 0;
    
    setCurrentMidi(sequence);
    setIsPlayingMidi(true);
    setIsPausedMidi(false);
    setMidiPlaybackTime(fromPosition);
    setMidiStartPosition(fromPosition);
    
    midiStartTimeRef.current = Date.now() - (fromPosition * 1000 * (100 / midiTempo));
    const pan = getPanPosition();
    const tempoMultiplier = 100 / midiTempo; // 100% = 1x, 50% = 2x slower, 200% = 0.5x faster
    
    // Sort events by start time for training mode
    const sortedEvents = [...sequence.events].sort((a, b) => a.startTime - b.startTime);
    sortedEventsRef.current = sortedEvents;
    
    // Filter events that haven't happened yet
    const futureEvents = sortedEvents.filter(event => event.startTime >= fromPosition);
    
    // In training mode, don't schedule notes - wait for user input
    if (!trainingModeEnabledRef.current) {
      futureEvents.forEach((event, index) => {
        // Calculate adjusted time based on position offset
        const adjustedStartTime = event.startTime - fromPosition;
        const adjustedEndTime = adjustedStartTime + event.duration;
        
        // Schedule note on (adjusted by tempo)
        const noteOnTimeout = window.setTimeout(() => {
          const freq = noteToFreq(event.noteName);
          if (freq) {
            onPlayNote(event.noteName, freq, activePreset, transpose, pan);
          }
        }, adjustedStartTime * 1000 * tempoMultiplier);
        
        // Schedule note off (adjusted by tempo)
        const noteOffTimeout = window.setTimeout(() => {
          const freq = noteToFreq(event.noteName);
          if (freq) {
            onStopNote(event.noteName, freq, transpose);
          }
        }, adjustedEndTime * 1000 * tempoMultiplier);
        
        midiTimeoutRefs.current.push(noteOnTimeout, noteOffTimeout);
      });
      
      // Schedule playback end
      const maxTime = Math.max(...sequence.events.map(e => e.startTime + e.duration));
      const remainingTime = maxTime - fromPosition;
      const endTimeout = window.setTimeout(() => {
        isPlayingMidiRef.current = false;
        isPausedMidiRef.current = false;
        currentMidiRef.current = null;
        setIsPlayingMidi(false);
        setIsPausedMidi(false);
        setCurrentMidi(null);
        setMidiPlaybackTime(0);
        setMidiStartPosition(0);
        cancelAnimationFrame(midiAnimationRef.current);
      }, remainingTime * 1000 * tempoMultiplier + 100);
      midiTimeoutRefs.current.push(endTimeout);
    } else {
      // Training mode - find the first event after fromPosition
      const firstFutureIndex = sortedEvents.findIndex(e => e.startTime >= fromPosition);
      nextEventIndexRef.current = firstFutureIndex >= 0 ? firstFutureIndex : sortedEvents.length;
      
      // Build pending notes for the current time point
      updatePendingNotes();
    }
    
    // Start falling notes animation after a short delay to allow canvas to mount
    setTimeout(() => {
      startFallingNotesAnimation(tempoMultiplier);
    }, 50);
  };
  
  // Update pending notes based on current playback time (for training mode)
  const updatePendingNotes = () => {
    if (!trainingModeEnabledRef.current || !currentMidiRef.current) return;
    
    const currentTime = midiPlaybackTime;
    const events = sortedEventsRef.current;
    
    // Find all notes that should be played at the current time (within a small tolerance)
    pendingNotesRef.current = new Set();
    
    for (let i = nextEventIndexRef.current; i < events.length; i++) {
      const event = events[i];
      // Include notes that are about to be played (within 0.1 seconds)
      if (event.startTime <= currentTime + 0.1) {
        pendingNotesRef.current.add(normalizeNoteName(event.noteName));
      } else {
        break; // Events are sorted, so we can stop here
      }
    }
    
    // If there are pending notes, pause until user presses them
    if (pendingNotesRef.current.size > 0 && !isPausedMidiRef.current) {
      trainingPauseTimeRef.current = Date.now();
      isPausedMidiRef.current = true;
      setIsPausedMidi(true);
    }
  };
  
  // Normalize note name (e.g., "Db4" -> "C#4")
  const normalizeNoteName = (noteName: string): string => {
    const flatToSharp: Record<string, string> = {
      'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'
    };
    
    const match = noteName.match(/^([A-G])([#b]?)(\d+)$/);
    if (!match) return noteName;
    
    const [, letter, accidental, octave] = match;
    if (accidental === 'b') {
      const sharpEquiv = flatToSharp[letter + 'b'];
      if (sharpEquiv) {
        return sharpEquiv + octave;
      }
    }
    return noteName;
  };
  
  // Check if a user-pressed note matches pending notes (called from PianoKey press)
  const checkTrainingNote = (noteName: string) => {
    if (!trainingModeEnabledRef.current || !isPausedMidiRef.current) return;
    
    const normalizedNote = normalizeNoteName(noteName);
    
    if (pendingNotesRef.current.has(normalizedNote)) {
      pendingNotesRef.current.delete(normalizedNote);
      
      // If all pending notes have been pressed, resume playback
      if (pendingNotesRef.current.size === 0) {
        // Calculate how long we were paused
        const pauseDuration = Date.now() - trainingPauseTimeRef.current;
        trainingAccumulatedPauseRef.current += pauseDuration;
        
        // Adjust start time to account for pause
        midiStartTimeRef.current += pauseDuration;
        
        // Move to next event(s)
        const events = sortedEventsRef.current;
        const currentEventTime = events[nextEventIndexRef.current]?.startTime;
        
        // Skip all events at the same time point
        while (nextEventIndexRef.current < events.length && 
               events[nextEventIndexRef.current].startTime === currentEventTime) {
          nextEventIndexRef.current++;
        }
        
        // Resume playback
        isPausedMidiRef.current = false;
        setIsPausedMidi(false);
        
        // Check if we've reached the end
        if (nextEventIndexRef.current >= events.length) {
          // End playback after a short delay
          setTimeout(() => {
            stopMidi();
          }, 500);
        }
      }
    }
  };
  
  // Seek functions for MIDI transport controls
  const seekMidi = (offsetSeconds: number) => {
    if (!currentMidi) return;
    
    const maxTime = Math.max(...currentMidi.events.map(e => e.startTime + e.duration));
    const newPosition = Math.max(0, Math.min(maxTime - 0.1, midiPlaybackTime + offsetSeconds));
    
    playMidi(currentMidi, newPosition);
  };
  
  const restartMidi = () => {
    if (!currentMidi) return;
    playMidi(currentMidi, 0);
  };
  
  // Restart playback with new tempo when tempo changes during playback
  const handleTempoChange = (newTempo: number) => {
    setMidiTempo(newTempo);
    
    // If currently playing, restart from current position with new tempo
    if (isPlayingMidi && currentMidi) {
      // Save current position before tempo change
      const currentPos = midiPlaybackTime;
      
      // Use setTimeout to ensure state update completes
      setTimeout(() => {
        playMidi(currentMidi, currentPos);
      }, 10);
    }
  };
  
  const stopMidi = () => {
    midiTimeoutRefs.current.forEach(t => clearTimeout(t));
    midiTimeoutRefs.current = [];
    cancelAnimationFrame(midiAnimationRef.current);
    
    // Update refs immediately
    isPlayingMidiRef.current = false;
    isPausedMidiRef.current = false;
    currentMidiRef.current = null;
    pendingNotesRef.current = new Set();
    
    setIsPlayingMidi(false);
    setIsPausedMidi(false);
    setCurrentMidi(null);
    setMidiPlaybackTime(0);
    setMidiStartPosition(0);
    
    // Stop all currently playing notes from this MIDI
    AudioEngine.stopAllNotes();
    
    // Clear canvas
    const canvas = fallingNotesCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  };
  
  // Falling notes animation - uses refs to avoid stale closure
  const startFallingNotesAnimation = (tempoMultiplier: number) => {
    const animate = () => {
      // Use refs instead of state to avoid stale closure
      if (!isPlayingMidiRef.current && !currentMidiRef.current) return;
      
      // Don't update time if paused in training mode
      let elapsed: number;
      if (isPausedMidiRef.current && trainingModeEnabledRef.current) {
        // Keep showing the same time while paused
        elapsed = (trainingPauseTimeRef.current - midiStartTimeRef.current) / 1000 / tempoMultiplier;
      } else {
        elapsed = (Date.now() - midiStartTimeRef.current) / 1000 / tempoMultiplier;
        setMidiPlaybackTime(elapsed);
        
        // In training mode, check if we need to pause for pending notes
        if (trainingModeEnabledRef.current && !isPausedMidiRef.current) {
          const events = sortedEventsRef.current;
          const nextIdx = nextEventIndexRef.current;
          
          if (nextIdx < events.length) {
            const nextEvent = events[nextIdx];
            // If we've reached or passed the next note's time, pause and wait for input
            if (elapsed >= nextEvent.startTime - 0.05) {
              // Collect all notes that should be played at this time point
              pendingNotesRef.current = new Set();
              const targetTime = nextEvent.startTime;
              
              for (let i = nextIdx; i < events.length; i++) {
                if (Math.abs(events[i].startTime - targetTime) < 0.05) {
                  pendingNotesRef.current.add(normalizeNoteName(events[i].noteName));
                } else {
                  break;
                }
              }
              
              if (pendingNotesRef.current.size > 0) {
                trainingPauseTimeRef.current = Date.now();
                isPausedMidiRef.current = true;
                setIsPausedMidi(true);
              }
            }
          }
        }
      }
      
      // Only render if falling notes are visible (use ref)
      if (showFallingNotesRef.current) {
        renderFallingNotes(elapsed, tempoMultiplier);
      }
      
      midiAnimationRef.current = requestAnimationFrame(animate);
    };
    
    midiAnimationRef.current = requestAnimationFrame(animate);
  };
  
  // Render falling notes on canvas - notes fall from above the piano and land on the keys
  const renderFallingNotes = (currentTime: number, tempoMultiplier: number) => {
    const canvas = fallingNotesCanvasRef.current;
    const scrollContainer = scrollContainerRef.current;
    const midi = currentMidiRef.current; // Use ref instead of state
    if (!canvas || !scrollContainer || !midi) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Use refs for current values (avoid stale closures)
    const currentKeyWidth = keyWidthRef.current;
    const currentSize = sizeRef.current;
    
    // Get visible width and actual scroll position
    const visibleWidth = currentSize.width;
    const pianoKeyboardHeight = currentSize.height - 50; // Height of the keyboard area (below header)
    const scrollOffset = scrollContainer.scrollLeft;
    
    // Set canvas size to match VISIBLE area
    canvas.width = visibleWidth;
    canvas.height = pianoKeyboardHeight;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Falling notes configuration
    // Notes should fall from above the piano and "hit" the keys at the bottom
    // The "hit line" is where notes reach when it's time to play them
    // White keys hit at the very bottom, black keys hit at about 65% height (since black keys are shorter)
    const whiteKeyHitLineY = pianoKeyboardHeight; // White keys hit at the very bottom
    const blackKeyHitLineY = pianoKeyboardHeight * 0.65; // Black keys are about 65% the height of white keys
    const lookAheadTime = 3.0; // Show notes 3 seconds before they should be played (increased for more visibility)
    const pixelsPerSecond = pianoKeyboardHeight / lookAheadTime; // Speed of falling
    
    // Note height scale factor - reduce heights to show more notes at once
    const noteHeightScale = 0.6; // 60% of original height
    
    // Map MIDI notes to keyboard positions - must match the actual keyboard rendering
    // The keyboard starts at px-4 (16px) padding and uses the current keyWidth
    const getNotePosition = (noteName: string): { x: number; width: number; isBlack: boolean } | null => {
      // Parse note name (e.g., "C4", "C#4", "Db4")
      const match = noteName.match(/^([A-G])([#b]?)(\d+)$/);
      if (!match) return null;
      
      const [, letter, accidental, octaveStr] = match;
      const octave = parseInt(octaveStr, 10);
      
      // White key notes: C, D, E, F, G, A, B
      const whiteKeyOrder = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
      const isBlack = accidental === '#' || accidental === 'b';
      
      // Calculate which white key this note is at or adjacent to
      let baseWhiteKeyIndex: number;
      if (isBlack) {
        if (accidental === '#') {
          baseWhiteKeyIndex = whiteKeyOrder.indexOf(letter);
        } else {
          // Flat - use the equivalent sharp
          const flatToSharp: Record<string, string> = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };
          const sharpEquiv = flatToSharp[letter + 'b'];
          if (sharpEquiv) {
            baseWhiteKeyIndex = whiteKeyOrder.indexOf(sharpEquiv[0]);
          } else {
            baseWhiteKeyIndex = whiteKeyOrder.indexOf(letter) - 1;
            if (baseWhiteKeyIndex < 0) baseWhiteKeyIndex = 6;
          }
        }
      } else {
        baseWhiteKeyIndex = whiteKeyOrder.indexOf(letter);
      }
      
      // Calculate absolute white key position from C1
      // The keyboard renders octaves 1-7 (generateKeyboard(1, 7))
      const octaveOffset = (octave - 1) * 7; // 7 white keys per octave
      const whiteKeyPosition = octaveOffset + baseWhiteKeyIndex;
      
      // Calculate X position matching the keyboard layout exactly
      const startPadding = 16; // px-4 = 16px padding in the keyboard
      const whiteKeyWidth = currentKeyWidth;
      const blackKeyWidth = currentKeyWidth * 0.65;
      
      if (isBlack) {
        // Black key is positioned between two white keys, offset by 67.5% of the white key
        // This matches: style={{ transform: 'translateX(-50%)' }} on the black key container
        const x = startPadding + (whiteKeyPosition * whiteKeyWidth) + (whiteKeyWidth * 0.675);
        return { x, width: blackKeyWidth, isBlack: true };
      } else {
        const x = startPadding + (whiteKeyPosition * whiteKeyWidth);
        return { x, width: whiteKeyWidth, isBlack: false };
      }
    };
    
    // Render each note - notes fall from top (off-screen) toward the bottom (hit line)
    midi.events.forEach(event => {
      const noteEnd = event.startTime + event.duration;
      
      // Only render notes that are visible in the time window
      // Notes before currentTime-0.5 have already passed, notes after currentTime+lookAheadTime are too far
      if (noteEnd >= currentTime - 0.3 && event.startTime <= currentTime + lookAheadTime) {
        const notePos = getNotePosition(event.noteName);
        if (!notePos) return;
        
        // Use different hit lines for black and white keys
        const hitLineY = notePos.isBlack ? blackKeyHitLineY : whiteKeyHitLineY;
        
        // Calculate Y position
        // timeUntilNote > 0: note is in the future, should be above the hit line
        // timeUntilNote < 0: note is being played/has passed, should be at/below hit line
        const timeUntilNote = event.startTime - currentTime;
        
        // Note height based on duration (minimum 6px for visibility, scaled down for more visibility)
        const noteHeight = Math.max(6, event.duration * pixelsPerSecond * noteHeightScale);
        
        // Y position: the BOTTOM of the note bar
        // When timeUntilNote = 0, the bottom of the note should be at hitLineY
        // When timeUntilNote = lookAheadTime, the bottom should be at Y = 0 (top of canvas)
        const noteBottomY = hitLineY - (timeUntilNote * pixelsPerSecond);
        const noteTopY = noteBottomY - noteHeight;
        
        // Adjust X position for scroll offset
        const x = notePos.x - scrollOffset;
        
        // Only draw if visible in viewport (horizontally)
        if (x + notePos.width > 0 && x < visibleWidth) {
          // Determine if note is currently playing
          const isPlaying = currentTime >= event.startTime && currentTime <= noteEnd;
          
          // Check if this note is pending in training mode
          const normalizedEventNote = normalizeNoteName(event.noteName);
          const isPending = trainingModeEnabledRef.current && 
                           isPausedMidiRef.current && 
                           pendingNotesRef.current.has(normalizedEventNote);
          
          // Clamp note to visible canvas area
          const drawY = Math.max(-noteHeight, noteTopY); // Can start slightly above canvas
          const drawHeight = Math.min(noteBottomY, pianoKeyboardHeight) - Math.max(0, noteTopY);
          
          // Skip if completely off-screen
          if (drawHeight <= 0 || noteBottomY < 0) return;
          
          // Reset shadow
          ctx.shadowBlur = 0;
          ctx.shadowColor = 'transparent';
          
          // Color based on key type, playing state, and pending state (training mode)
          if (isPending) {
            // Pending notes in training mode - highlight with green/yellow
            ctx.fillStyle = '#22c55e'; // Green for pending notes
            ctx.shadowColor = '#22c55e';
            ctx.shadowBlur = 15;
          } else if (notePos.isBlack) {
            ctx.fillStyle = isPlaying ? '#818cf8' : '#4f46e5'; // Brighter when playing
          } else {
            ctx.fillStyle = isPlaying ? '#a78bfa' : '#7c3aed'; // Purple for white keys
          }
          
          // Draw the note bar
          const padding = 2; // Small padding on sides
          const radius = Math.min(4, notePos.width / 4);
          const drawX = x + padding;
          const drawWidth = notePos.width - padding * 2;
          const finalY = Math.max(0, noteTopY);
          
          ctx.beginPath();
          ctx.roundRect(drawX, finalY, drawWidth, drawHeight, radius);
          ctx.fill();
          
          // Add glow effect for notes being played or pending
          if (isPlaying || isPending) {
            ctx.shadowColor = isPending ? '#22c55e' : '#a78bfa';
            ctx.shadowBlur = 12;
            ctx.fillStyle = isPending ? 'rgba(34, 197, 94, 0.5)' : 'rgba(167, 139, 250, 0.5)';
            ctx.beginPath();
            ctx.roundRect(drawX, finalY, drawWidth, drawHeight, radius);
            ctx.fill();
            ctx.shadowBlur = 0;
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
            
            {/* FALLING NOTES CANVAS - Overlays the keyboard (above black keys z-50) */}
            {showFallingNotes && (
              <canvas
                ref={fallingNotesCanvasRef}
                className="absolute inset-0 pointer-events-none"
                style={{ 
                  width: '100%', 
                  height: '100%',
                  opacity: 0.9,
                  zIndex: 55, // Above black keys (z-50)
                  display: isPlayingMidi && currentMidi ? 'block' : 'none'
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

                 {/* Training Mode Section */}
                 <div className="border-t border-white/10 pt-3">
                    <div className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Training Mode</div>
                    
                    {/* Falling Notes Toggle */}
                    <div className="flex items-center justify-between mb-2">
                       <span className="text-xs text-zinc-400">Falling Notes</span>
                       <button 
                         onClick={() => setShowFallingNotes(!showFallingNotes)}
                         className={`relative w-10 h-5 rounded-full transition-colors ${showFallingNotes ? 'bg-indigo-500' : 'bg-zinc-700'}`}
                       >
                         <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${showFallingNotes ? 'translate-x-5' : 'translate-x-0.5'}`}></div>
                       </button>
                    </div>
                    <p className="text-[9px] text-zinc-600 mb-2">Shows visual guides when playing MIDI files</p>
                    
                    {/* Training Mode Toggle */}
                    <div className="flex items-center justify-between">
                       <span className="text-xs text-zinc-400">Wait for Input</span>
                       <button 
                         onClick={() => setTrainingModeEnabled(!trainingModeEnabled)}
                         className={`relative w-10 h-5 rounded-full transition-colors ${trainingModeEnabled ? 'bg-green-500' : 'bg-zinc-700'}`}
                         title="When enabled, MIDI playback will wait for you to press the correct key"
                       >
                         <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${trainingModeEnabled ? 'translate-x-5' : 'translate-x-0.5'}`}></div>
                       </button>
                    </div>
                    <p className="text-[9px] text-zinc-600 mt-1">Pauses until you press the correct key</p>
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
                 
                 {/* Transport Controls - Show when MIDI is playing */}
                 {isPlayingMidi && currentMidi && (
                   <div className="px-3 py-2 border-b border-white/5 bg-indigo-500/5">
                     <div className="flex items-center justify-center gap-4">
                       {/* Rewind 5 seconds */}
                       <button 
                         onClick={() => seekMidi(-5)}
                         className="p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                         title="Rewind 5 seconds"
                       >
                         <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
                         </svg>
                       </button>
                       
                       {/* Restart from beginning */}
                       <button 
                         onClick={restartMidi}
                         className="p-2 text-zinc-400 hover:text-green-400 hover:bg-green-500/10 rounded-full transition-colors"
                         title="Restart from beginning"
                       >
                         <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                         </svg>
                       </button>
                       
                       {/* Fast forward 5 seconds */}
                       <button 
                         onClick={() => seekMidi(5)}
                         className="p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                         title="Forward 5 seconds"
                       >
                         <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
                         </svg>
                       </button>
                     </div>
                     
                     {/* Playback time display */}
                     <div className="text-center text-[10px] text-zinc-500 mt-1">
                       {formatTime(midiPlaybackTime)} / {formatTime(Math.max(...currentMidi.events.map(e => e.startTime + e.duration)))}
                     </div>
                   </div>
                 )}
                 
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
                        onChange={(e) => handleTempoChange(Number(e.target.value))} 
                        className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-indigo-500"
                    />
                    <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                        <span>Slow</span>
                        <button onClick={() => handleTempoChange(100)} className="text-indigo-400 hover:underline">Reset</button>
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

// Helper function to format time in MM:SS format
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
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
