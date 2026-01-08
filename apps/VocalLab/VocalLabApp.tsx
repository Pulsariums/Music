import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AudioEngine } from '../../services/audio/AudioEngine';
import { PRESETS } from '../../services/audio/presets';
import { InstrumentPreset, AudioRecording, SongSequence, WorkspaceItem, SavedMidiFile, WorkspaceSession, AppID } from '../../types';
import { Logger } from '../../lib/logger';
import { RecordingRepository } from '../../services/data/RecordingRepository';
import { SessionRepository } from '../../services/data/SessionRepository';
import { SimpleMidiParser } from '../../services/midi/SimpleMidiParser';
import { Mp3ToMidiConverter } from '../../services/audio/Mp3ToMidiConverter';
import { FloatingPiano } from '../../components/instruments/FloatingPiano';

interface VocalLabAppProps {
  onNavigate?: (app: AppID) => void;
}

export const VocalLabApp: React.FC<VocalLabAppProps> = ({ onNavigate }) => {
  // --- WORKSPACE STATE ---
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const [topZIndex, setTopZIndex] = useState(10);
  
  // UI Config
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fallingSpeed, setFallingSpeed] = useState(250);
  const [showAudioSettings, setShowAudioSettings] = useState(false);
  const [softModeEnabled, setSoftModeEnabled] = useState(false);
  const [spatialAudioEnabled, setSpatialAudioEnabled] = useState(false);

  // Recording
  const [isRecording, setIsRecording] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [recordings, setRecordings] = useState<AudioRecording[]>([]);
  const [playingRecordings, setPlayingRecordings] = useState<Set<string>>(new Set());
  const [loopingRecordings, setLoopingRecordings] = useState<Set<string>>(new Set());
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Sequencer
  const [currentSequence, setCurrentSequence] = useState<SongSequence | null>(null);
  const [isPlayingSeq, setIsPlayingSeq] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);

  // MIDI Files
  const [midiFiles, setMidiFiles] = useState<SavedMidiFile[]>([]);
  const [showMidiLibrary, setShowMidiLibrary] = useState(false);
  
  // Session Management
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // MP3 to MIDI Converter
  const [showMp3Converter, setShowMp3Converter] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [isConverting, setIsConverting] = useState(false);
  const mp3FileInputRef = useRef<HTMLInputElement>(null);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>();
  const startTimeRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const midiFileInputRef = useRef<HTMLInputElement>(null);
  const sessionFileInputRef = useRef<HTMLInputElement>(null);
  
  const playingSequenceNotes = useRef<Map<number, number>>(new Map());

  // --- WORKSPACE MANAGEMENT ---
  const addPiano = () => {
    const newId = crypto.randomUUID();
    const offset = items.length * 30; // Cascade effect
    
    // Initial Size Calculation: 70vw width, max 280px height
    const initialWidth = Math.min(window.innerWidth * 0.7, 1200);
    
    const newItem: WorkspaceItem = {
        instanceId: newId,
        type: 'piano',
        position: { x: (window.innerWidth - initialWidth) / 2 + offset, y: window.innerHeight - 350 - offset },
        size: { width: initialWidth, height: 280 },
        zIndex: topZIndex + 1,
        config: {
            preset: PRESETS.CONCERT_GRAND,
            keyWidth: 50,
            transpose: 0,
            startOctave: 2
        }
    };
    
    setTopZIndex(z => z + 1);
    setItems(prev => [...prev, newItem]);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.instanceId !== id));
  };

  const focusItem = (id: string) => {
      setTopZIndex(z => z + 1);
      setItems(prev => prev.map(i => i.instanceId === id ? { ...i, zIndex: topZIndex + 1 } : i));
  };

  // --- AUDIO ACTIONS ---
  const startNote = useCallback((note: string, freq: number, preset: InstrumentPreset, transpose: number, panPosition?: number) => {
    const transposedFreq = freq * Math.pow(2, transpose / 12);
    AudioEngine.playNote(transposedFreq, preset, panPosition);
    setActiveNotes(prev => new Set(prev).add(note));
  }, []);

  const stopNote = useCallback((note: string, freq: number, transpose: number) => {
    const transposedFreq = freq * Math.pow(2, transpose / 12);
    AudioEngine.stopNote(transposedFreq);
    setActiveNotes(prev => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });
  }, []);

  // --- RECORDING LOGIC ---
  const loadRecordings = async () => {
    try {
        const list = await RecordingRepository.getAllRecordings();
        setRecordings(list);
    } catch (e) { Logger.log('error', 'Failed load recordings'); }
  };

  const handleToggleRecording = async () => {
      if (isRecording) {
          // STOP
          setIsRecording(false);
          try {
              const blob = await AudioEngine.stopRecording();
              if (blob && blob.size > 0) {
                  const newRec: AudioRecording = {
                      id: crypto.randomUUID(),
                      name: `Session ${new Date().toLocaleTimeString()}`,
                      timestamp: Date.now(),
                      duration: 0, // TODO: Track duration
                      blob: blob,
                      format: 'webm'
                  };
                  await RecordingRepository.saveRecording(newRec);
                  await loadRecordings();
                  setShowLibrary(true); // Auto open library to show result
                  Logger.log('info', 'Recording saved successfully', { size: blob.size });
              } else {
                  Logger.log('warn', 'Recording was empty or failed');
              }
          } catch (e) {
              Logger.log('error', 'Failed to save recording', {}, e as Error);
          }
      } else {
          // START - first play a silent note to ensure AudioContext is ready
          try {
              const success = await AudioEngine.startRecording();
              if (success) {
                  setIsRecording(true);
                  Logger.log('info', 'Recording started successfully');
              } else {
                  Logger.log('error', 'Failed to start recording');
              }
          } catch (e) {
              Logger.log('error', 'Recording start exception', {}, e as Error);
          }
      }
  };

  const handleDeleteRecording = async (id: string) => {
      await RecordingRepository.deleteRecording(id);
      loadRecordings();
  };

  const handleDownloadRecording = (rec: AudioRecording) => {
      const url = URL.createObjectURL(rec.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${rec.name}.webm`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const handlePlayRecording = (rec: AudioRecording) => {
      let audio = audioRefs.current.get(rec.id);
      
      if (!audio) {
          audio = new Audio(URL.createObjectURL(rec.blob));
          audio.addEventListener('ended', () => {
              if (!loopingRecordings.has(rec.id)) {
                  setPlayingRecordings(prev => {
                      const next = new Set(prev);
                      next.delete(rec.id);
                      return next;
                  });
              }
          });
          audioRefs.current.set(rec.id, audio);
      }
      
      audio.loop = loopingRecordings.has(rec.id);
      audio.play();
      setPlayingRecordings(prev => new Set(prev).add(rec.id));
  };

  const handleStopRecording = (recId: string) => {
      const audio = audioRefs.current.get(recId);
      if (audio) {
          audio.pause();
          audio.currentTime = 0;
      }
      setPlayingRecordings(prev => {
          const next = new Set(prev);
          next.delete(recId);
          return next;
      });
  };

  const handleToggleLoop = (recId: string) => {
      setLoopingRecordings(prev => {
          const next = new Set(prev);
          if (next.has(recId)) {
              next.delete(recId);
          } else {
              next.add(recId);
          }
          // Update audio element loop property if it exists
          const audio = audioRefs.current.get(recId);
          if (audio) {
              audio.loop = next.has(recId);
          }
          return next;
      });
  };

  const handleToggleSoftMode = () => {
      const newValue = !softModeEnabled;
      setSoftModeEnabled(newValue);
      AudioEngine.setSoftMode(newValue);
  };

  const handleToggleSpatialAudio = () => {
      const newValue = !spatialAudioEnabled;
      setSpatialAudioEnabled(newValue);
      AudioEngine.setSpatialAudio(newValue);
  };

  // --- SEQUENCER LOGIC (Simplified for Visualization) ---
  const animate = useCallback((time: number) => {
    if (!isPlayingSeq || !currentSequence) return;

    const now = Date.now();
    const elapsed = (now - startTimeRef.current) / 1000;
    const prevElapsed = lastFrameTimeRef.current;
    setPlaybackTime(elapsed);

    // Play MIDI events through default engine (using first active piano preset or default)
    // For simplicity, sequencer uses a fixed generic piano sound in this architecture unless we map tracks to instances
    const defaultPreset = PRESETS.CONCERT_GRAND; 

    currentSequence.events.forEach(event => {
        if (event.startTime >= prevElapsed && event.startTime < elapsed) {
            const freq = 440 * Math.pow(2, (event.midi - 69) / 12);
            AudioEngine.playNote(freq, defaultPreset);
            playingSequenceNotes.current.set(event.midi, event.startTime + event.duration);
        }
    });

    // Cleanup ended notes
    const activeMap = playingSequenceNotes.current;
    for (const [midi, endTime] of activeMap.entries()) {
        if (elapsed >= endTime) {
            const freq = 440 * Math.pow(2, (midi - 69) / 12);
            AudioEngine.stopNote(freq);
            activeMap.delete(midi);
        }
    }
    
    // Check end
    const lastNote = currentSequence.events[currentSequence.events.length - 1];
    if (lastNote && elapsed > lastNote.startTime + lastNote.duration + 2.0) {
        setIsPlayingSeq(false);
        setPlaybackTime(0);
        playingSequenceNotes.current.clear();
    }

    renderCanvas(elapsed);
    lastFrameTimeRef.current = elapsed;
    requestRef.current = requestAnimationFrame(animate);
  }, [isPlayingSeq, currentSequence]);

  useEffect(() => {
    if (isPlayingSeq) {
        AudioEngine.resume();
        startTimeRef.current = Date.now() - (playbackTime * 1000);
        lastFrameTimeRef.current = playbackTime;
        requestRef.current = requestAnimationFrame(animate);
    } else {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [isPlayingSeq, animate]);

  // --- VISUALIZER ---
  const renderCanvas = (currentTime: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !currentSequence) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const pixelsPerSecond = fallingSpeed;

      // Draw active notes from sequencer
      currentSequence.events.forEach(note => {
          const timeToHit = note.startTime - currentTime;
          if (timeToHit < -1 || timeToHit > 5) return;
          
          const y = canvas.height - (timeToHit * pixelsPerSecond) - 100; // Generic bottom offset
          // Simple visualization since we don't have fixed keys anymore
          // Map MIDI 21-108 to Screen Width
          const x = ((note.midi - 21) / 88) * canvas.width;
          const w = (canvas.width / 88) * 0.8;
          const h = note.duration * pixelsPerSecond;

          ctx.fillStyle = '#6366f1';
          ctx.fillRect(x, y - h, w, h);
      });
  };

  useEffect(() => {
      if (canvasRef.current) {
          canvasRef.current.width = window.innerWidth;
          canvasRef.current.height = window.innerHeight;
      }
  }, []);


  // --- GENERIC HANDLERS ---
  // Import MIDI to library (doesn't auto-play)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    Logger.log('info', 'handleFileUpload triggered', { hasFiles: !!e.target.files, fileCount: e.target.files?.length });
    if (e.target.files && e.target.files[0]) {
        try {
            const file = e.target.files[0];
            Logger.log('info', 'Processing MIDI file', { name: file.name, size: file.size, type: file.type });
            const seq = await SimpleMidiParser.parse(file);
            const midiFile: SavedMidiFile = {
              id: crypto.randomUUID(),
              name: file.name.replace('.mid', '').replace('.midi', ''),
              sequence: seq,
              createdAt: Date.now()
            };
            Logger.log('info', 'Saving MIDI to DB', { id: midiFile.id, name: midiFile.name, eventCount: seq.events.length });
            await SessionRepository.saveMidiFile(midiFile);
            await loadMidiFiles();
            Logger.log('info', 'MIDI file added to library', { name: midiFile.name });
            alert(`MIDI file "${midiFile.name}" added to library! Open any piano's MIDI menu to play it.`);
        } catch(err) { 
            Logger.log('error', 'MIDI import failed', {}, err as Error);
            alert("Failed to import MIDI file: " + (err as Error).message); 
        }
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- MIDI FILE MANAGEMENT ---
  const loadMidiFiles = async () => {
    try {
      Logger.log('info', 'Loading MIDI files from DB');
      const files = await SessionRepository.getAllMidiFiles();
      Logger.log('info', 'MIDI files loaded', { count: files.length });
      setMidiFiles(files);
    } catch (e) {
      Logger.log('error', 'Failed to load MIDI files', {}, e as Error);
    }
  };

  const handleMidiImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    Logger.log('info', 'handleMidiImport triggered', { hasFiles: !!e.target.files, fileCount: e.target.files?.length });
    if (e.target.files && e.target.files[0]) {
      try {
        const file = e.target.files[0];
        Logger.log('info', 'Processing MIDI file (from library modal)', { name: file.name, size: file.size, type: file.type });
        const seq = await SimpleMidiParser.parse(file);
        const midiFile: SavedMidiFile = {
          id: crypto.randomUUID(),
          name: file.name.replace('.mid', '').replace('.midi', ''),
          sequence: seq,
          createdAt: Date.now()
        };
        Logger.log('info', 'Saving MIDI to DB', { id: midiFile.id, name: midiFile.name, eventCount: seq.events.length });
        await SessionRepository.saveMidiFile(midiFile);
        await loadMidiFiles();
        Logger.log('info', 'MIDI file imported', { name: midiFile.name });
      } catch (err) {
        Logger.log('error', 'MIDI import failed (from library modal)', {}, err as Error);
        alert("Failed to import MIDI file: " + (err as Error).message);
      }
    }
    // Reset input
    if (midiFileInputRef.current) midiFileInputRef.current.value = '';
  };

  const handleMidiExport = (sequence: SongSequence) => {
    const json = SessionRepository.exportMidiToJSON(sequence);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sequence.title || 'midi'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteMidiFile = async (id: string) => {
    try {
      await SessionRepository.deleteMidiFile(id);
      setMidiFiles(prev => prev.filter(m => m.id !== id));
      Logger.log('info', 'MIDI file deleted', { id });
    } catch (e) {
      Logger.log('error', 'Failed to delete MIDI file', { id }, e as Error);
    }
  };

  // --- SESSION MANAGEMENT ---
  const loadSessions = async () => {
    try {
      const list = await SessionRepository.getAllSessions();
      setSessions(list);
    } catch (e) {
      Logger.log('error', 'Failed to load sessions');
    }
  };

  const saveCurrentSession = async (name?: string) => {
    const session: WorkspaceSession = {
      id: currentSessionId || crypto.randomUUID(),
      name: name || `Session ${new Date().toLocaleString()}`,
      createdAt: currentSessionId ? sessions.find(s => s.id === currentSessionId)?.createdAt || Date.now() : Date.now(),
      updatedAt: Date.now(),
      items: items,
      audioSettings: {
        volume: AudioEngine.getVolume(),
        softMode: softModeEnabled,
        spatialAudio: spatialAudioEnabled
      },
      midiFiles: midiFiles
    };
    
    await SessionRepository.saveSession(session);
    setCurrentSessionId(session.id);
    await loadSessions();
    Logger.log('info', 'Session saved', { id: session.id });
  };

  const loadSession = async (session: WorkspaceSession) => {
    setItems(session.items);
    setCurrentSessionId(session.id);
    
    // Apply audio settings
    if (session.audioSettings) {
      AudioEngine.setVolume(session.audioSettings.volume);
      setSoftModeEnabled(session.audioSettings.softMode);
      setSpatialAudioEnabled(session.audioSettings.spatialAudio);
      AudioEngine.setSoftMode(session.audioSettings.softMode);
      AudioEngine.setSpatialAudio(session.audioSettings.spatialAudio);
    }
    
    // Load MIDI files from session
    if (session.midiFiles) {
      setMidiFiles(session.midiFiles);
    }
    
    setShowSessionMenu(false);
    Logger.log('info', 'Session loaded', { id: session.id });
  };

  const exportSession = async () => {
    const session: WorkspaceSession = {
      id: currentSessionId || crypto.randomUUID(),
      name: `Export ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      items: items,
      audioSettings: {
        volume: AudioEngine.getVolume(),
        softMode: softModeEnabled,
        spatialAudio: spatialAudioEnabled
      },
      midiFiles: midiFiles
    };
    
    const json = SessionRepository.exportSession(session);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `soundsphere-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSessionImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      try {
        const text = await e.target.files[0].text();
        const session = SessionRepository.importSession(text);
        await SessionRepository.saveSession(session);
        await loadSessions();
        loadSession(session);
      } catch (e) {
        alert("Failed to import session");
      }
    }
    if (sessionFileInputRef.current) sessionFileInputRef.current.value = '';
  };

  // --- MP3 TO MIDI CONVERTER ---
  const handleMp3Upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setIsConverting(true);
      setConversionProgress(0);
      
      try {
        const midiFile = await Mp3ToMidiConverter.convert(file, (progress) => {
          setConversionProgress(progress);
        });
        
        if (!midiFile.sequence.events || midiFile.sequence.events.length === 0) {
          setIsConverting(false);
          setConversionProgress(0);
          alert('No notes detected. Try a clearer audio file with a single melody (piano solo, vocal, etc.).');
          return;
        }
        
        // Add to local state immediately for UI responsiveness
        setMidiFiles(prev => [...prev, midiFile]);
        setShowMp3Converter(false);
        setIsConverting(false);
        setConversionProgress(0);
        
        // Save to DB in background (non-blocking)
        SessionRepository.saveMidiFile(midiFile).catch(err => {
          console.warn('Failed to save MIDI to DB:', err);
        });
        
        alert(`Conversion complete! "${midiFile.name}" added to MIDI library with ${midiFile.sequence.events.length} notes detected.`);
      } catch (error) {
        console.error('MP3 to MIDI conversion failed:', error);
        setIsConverting(false);
        setConversionProgress(0);
        alert('Failed to convert audio to MIDI. Try a clearer audio file with a single melody.');
      }
    }
    if (mp3FileInputRef.current) mp3FileInputRef.current.value = '';
  };

  const handleExportConvertedMidi = async (midiFile: SavedMidiFile) => {
    try {
      const blob = Mp3ToMidiConverter.exportToMidiFile(midiFile);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${midiFile.name}.mid`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('MIDI export failed:', error);
      alert('Failed to export MIDI file.');
    }
  };

  // --- INIT ---
  // Moved after function definitions to avoid TDZ issues
  useEffect(() => {
    loadRecordings();
    loadMidiFiles();
    loadSessions();
    AudioEngine.init({ latencyHint: 'interactive' });
    
    // Add default piano on start
    addPiano();
    
    // Cleanup: stop all audio when navigating away or unmounting
    return () => {
      AudioEngine.stopAllNotes();
      // Also stop any recording playback
      audioRefs.current.forEach((audio) => {
        audio.pause();
        audio.currentTime = 0;
      });
      audioRefs.current.clear();
    };
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full bg-[#0f1115] relative overflow-hidden font-sans text-white select-none">
        
        {/* 1. BACKGROUND LAYER */}
        <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#1a1c24] to-[#000]">
            <canvas ref={canvasRef} className="absolute bottom-0 opacity-30" />
            
            {items.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
                    <div className="text-center">
                        <h1 className="text-6xl font-bold tracking-tighter text-zinc-800">EMPTY WORKSPACE</h1>
                        <p className="text-zinc-600">Add an instrument to begin</p>
                    </div>
                </div>
            )}
        </div>

        {/* 2. TOP TOOLBAR */}
        <div className="absolute top-2 left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[100] flex flex-wrap items-center justify-center gap-1 sm:gap-2 p-1.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl sm:rounded-2xl shadow-2xl transition-all hover:bg-black/80 max-w-full overflow-x-auto">
            
            {/* Add Piano Button */}
            <button 
                onClick={addPiano}
                className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg sm:rounded-xl transition-all active:scale-95 group"
            >
                <span className="text-base sm:text-lg font-bold">+</span>
                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider hidden xs:inline">Piano</span>
            </button>

            <div className="hidden sm:block w-px h-6 bg-white/10 mx-1 sm:mx-2" />

            {/* Recorder Toggle */}
            <button 
                onClick={handleToggleRecording}
                className={`w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg sm:rounded-xl transition-all flex-shrink-0 ${isRecording ? 'bg-red-500/20 text-red-500 border border-red-500/50' : 'hover:bg-white/10 text-zinc-400'}`}
                title={isRecording ? "Stop Recording" : "Start Global Recording"}
            >
                <div className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-current'}`} />
            </button>

            {/* Recordings Library Toggle */}
            <button 
                onClick={() => setShowLibrary(!showLibrary)}
                className={`w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg sm:rounded-xl transition-all flex-shrink-0 ${showLibrary ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-zinc-400'}`}
                title="Recordings Library"
            >
                 <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
            </button>

            {/* MIDI Library Toggle */}
            <button 
                onClick={() => setShowMidiLibrary(!showMidiLibrary)}
                className={`w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg sm:rounded-xl transition-all flex-shrink-0 ${showMidiLibrary ? 'bg-indigo-500/30 text-indigo-400' : 'hover:bg-white/10 text-zinc-400'}`}
                title="MIDI Library"
            >
                 <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            </button>

            {/* MP3 to MIDI Converter */}
            <button 
                onClick={() => setShowMp3Converter(!showMp3Converter)}
                className={`w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg sm:rounded-xl transition-all flex-shrink-0 ${showMp3Converter ? 'bg-purple-500/30 text-purple-400' : 'hover:bg-white/10 text-zinc-400'}`}
                title="MP3 to MIDI Converter"
            >
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
            </button>

            {/* MIDI Tools */}
            <button onClick={() => fileInputRef.current?.click()} className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg sm:rounded-xl hover:bg-white/10 text-zinc-400 flex-shrink-0" title="Import MIDI">
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            </button>
            <input ref={fileInputRef} type="file" accept=".mid,.midi" hidden onChange={handleFileUpload} />

            {currentSequence && (
                <button onClick={() => setIsPlayingSeq(!isPlayingSeq)} className={`w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg sm:rounded-xl flex-shrink-0 ${isPlayingSeq ? 'bg-green-500/20 text-green-500' : 'hover:bg-white/10 text-zinc-400'}`}>
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24"><path d={isPlayingSeq ? "M6 4h4v16H6zM14 4h4v16h-4z" : "M8 5v14l11-7z"}/></svg>
                </button>
            )}

            <button 
                onClick={() => {
                    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
                    else document.exitFullscreen();
                }}
                className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg sm:rounded-xl hover:bg-white/10 text-zinc-400 flex-shrink-0 hidden sm:flex"
            >
                 <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
            </button>

            <div className="hidden sm:block w-px h-6 bg-white/10 mx-1 sm:mx-2" />

            {/* Session Management */}
            <button 
                onClick={() => setShowSessionMenu(!showSessionMenu)}
                className={`w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg sm:rounded-xl transition-all flex-shrink-0 ${showSessionMenu ? 'bg-indigo-500/30 text-indigo-400' : 'hover:bg-white/10 text-zinc-400'}`}
                title="Session Manager"
            >
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
            </button>

            {/* MIDI Editor */}
            {onNavigate && (
                <button 
                    onClick={() => onNavigate(AppID.MIDI_EDITOR)}
                    className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg sm:rounded-xl hover:bg-white/10 text-zinc-400 flex-shrink-0"
                    title="MIDI Editor"
                >
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
            )}

        </div>

        {/* SESSION MENU DROPDOWN */}
        {showSessionMenu && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[110] w-80 bg-[#18181b]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between p-3 border-b border-white/10">
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Session Manager</span>
                    <button onClick={() => setShowSessionMenu(false)} className="text-zinc-500 hover:text-white">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                
                {/* Quick Actions */}
                <div className="p-3 grid grid-cols-2 gap-2 border-b border-white/10">
                    <button 
                        onClick={() => saveCurrentSession()}
                        className="flex items-center justify-center gap-2 py-2 bg-indigo-500/20 text-indigo-400 rounded-lg hover:bg-indigo-500/30 text-xs font-medium"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                        Save Session
                    </button>
                    <button 
                        onClick={exportSession}
                        className="flex items-center justify-center gap-2 py-2 bg-white/10 text-zinc-300 rounded-lg hover:bg-white/20 text-xs font-medium"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        Export
                    </button>
                    <button 
                        onClick={() => sessionFileInputRef.current?.click()}
                        className="flex items-center justify-center gap-2 py-2 bg-white/10 text-zinc-300 rounded-lg hover:bg-white/20 text-xs font-medium col-span-2"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        Import Session
                    </button>
                </div>
                
                {/* Saved Sessions */}
                <div className="max-h-48 overflow-y-auto p-2">
                    {sessions.length === 0 ? (
                        <div className="text-center text-zinc-500 text-xs py-4">No saved sessions</div>
                    ) : (
                        sessions.map(s => (
                            <button
                                key={s.id}
                                onClick={() => loadSession(s)}
                                className={`w-full text-left p-2 rounded-lg hover:bg-white/10 mb-1 ${currentSessionId === s.id ? 'bg-indigo-500/20 border border-indigo-500/30' : ''}`}
                            >
                                <div className="text-sm text-white font-medium truncate">{s.name}</div>
                                <div className="text-[10px] text-zinc-500">
                                    {new Date(s.updatedAt).toLocaleString()} • {s.items.length} instruments
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
        )}

        {/* Hidden file inputs */}
        <input ref={midiFileInputRef} type="file" accept=".mid,.midi" hidden onChange={handleMidiImport} />
        <input ref={sessionFileInputRef} type="file" accept=".json" hidden onChange={handleSessionImport} />
        <input ref={mp3FileInputRef} type="file" accept=".mp3,.wav,.m4a,.ogg,.flac" hidden onChange={handleMp3Upload} />

        {/* MP3 TO MIDI CONVERTER MODAL */}
        {showMp3Converter && (
            <div className="absolute top-24 left-1/2 -translate-x-1/2 w-[90vw] max-w-md bg-[#18181b]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-[200] overflow-hidden animate-fade-in">
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                    <h3 className="font-bold text-white flex items-center gap-2">
                        <span className="text-purple-400">●</span> MP3 to MIDI Converter
                    </h3>
                    <button onClick={() => setShowMp3Converter(false)} className="text-zinc-500 hover:text-white">✕</button>
                </div>
                
                <div className="p-4 space-y-4">
                    {isConverting ? (
                        <div className="space-y-3">
                            <div className="text-sm text-zinc-400 text-center">Converting audio to MIDI...</div>
                            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-300"
                                    style={{ width: `${conversionProgress}%` }}
                                />
                            </div>
                            <div className="text-xs text-zinc-500 text-center">{conversionProgress}%</div>
                        </div>
                    ) : (
                        <>
                            <div className="text-sm text-zinc-400">
                                Upload an audio file to convert it to MIDI. Works best with:
                                <ul className="mt-2 text-xs text-zinc-500 list-disc list-inside space-y-1">
                                    <li>Single melody lines (monophonic)</li>
                                    <li>Clear, isolated instruments</li>
                                    <li>Piano or vocal recordings</li>
                                </ul>
                            </div>
                            
                            <button 
                                onClick={() => mp3FileInputRef.current?.click()}
                                className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                Upload Audio File
                            </button>
                            
                            <div className="text-[10px] text-zinc-600 text-center">
                                Supports: MP3, WAV, M4A, OGG, FLAC
                            </div>
                        </>
                    )}
                    
                    {/* Converted MIDI Files with Export */}
                    {midiFiles.filter(m => m.name.includes('(Converted)')).length > 0 && (
                        <div className="border-t border-white/10 pt-4 mt-4">
                            <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Converted Files</div>
                            <div className="space-y-2 max-h-40 overflow-y-auto">
                                {midiFiles.filter(m => m.name.includes('(Converted)')).map(midi => (
                                    <div key={midi.id} className="flex items-center justify-between p-2 bg-white/5 rounded-lg">
                                        <div className="text-sm text-white truncate flex-1">{midi.name}</div>
                                        <div className="flex gap-1">
                                            <button 
                                                onClick={() => handleExportConvertedMidi(midi)}
                                                className="p-1.5 hover:bg-white/10 rounded text-zinc-400 hover:text-white"
                                                title="Export as .mid file"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                </svg>
                                            </button>
                                            <button 
                                                onClick={async () => {
                                                    await SessionRepository.deleteMidiFile(midi.id);
                                                    setMidiFiles(prev => prev.filter(m => m.id !== midi.id));
                                                }}
                                                className="p-1.5 hover:bg-red-500/20 rounded text-zinc-400 hover:text-red-400"
                                                title="Delete"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* AUDIO SETTINGS (Top Right) */}
        <div className="absolute top-4 right-4 z-[100]">
            <button 
                onClick={() => setShowAudioSettings(!showAudioSettings)}
                className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${showAudioSettings ? 'bg-indigo-500/30 text-indigo-400' : 'bg-black/60 hover:bg-black/80 text-zinc-400 hover:text-white'} backdrop-blur-xl border border-white/10`}
                title="Audio Settings"
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
            </button>

            {showAudioSettings && (
                <div className="absolute top-12 right-0 w-56 bg-[#18181b]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-3 space-y-3">
                    <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Audio Effects</div>
                    
                    {/* Soft Mode Toggle */}
                    <button 
                        onClick={handleToggleSoftMode}
                        className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${softModeEnabled ? 'bg-indigo-500/20 border border-indigo-500/30' : 'bg-white/5 hover:bg-white/10'}`}
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🎵</span>
                            <div className="text-left">
                                <div className="text-sm font-medium text-white">Soft Mode</div>
                                <div className="text-[10px] text-zinc-500">Smoother, warmer sound</div>
                            </div>
                        </div>
                        <div className={`w-8 h-4 rounded-full transition-colors ${softModeEnabled ? 'bg-indigo-500' : 'bg-zinc-700'}`}>
                            <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${softModeEnabled ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'}`} />
                        </div>
                    </button>

                    {/* Spatial Audio Toggle */}
                    <button 
                        onClick={handleToggleSpatialAudio}
                        className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${spatialAudioEnabled ? 'bg-indigo-500/20 border border-indigo-500/30' : 'bg-white/5 hover:bg-white/10'}`}
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🎧</span>
                            <div className="text-left">
                                <div className="text-sm font-medium text-white">Spatial Audio</div>
                                <div className="text-[10px] text-zinc-500">L/R based on position</div>
                            </div>
                        </div>
                        <div className={`w-8 h-4 rounded-full transition-colors ${spatialAudioEnabled ? 'bg-indigo-500' : 'bg-zinc-700'}`}>
                            <div className={`w-3 h-3 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${spatialAudioEnabled ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'}`} />
                        </div>
                    </button>
                </div>
            )}
        </div>

        {/* 3. RECORDINGS LIBRARY MODAL */}
        {showLibrary && (
             <div className="absolute top-24 left-1/2 -translate-x-1/2 w-[90vw] max-w-md bg-[#18181b]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-[200] flex flex-col max-h-[60vh] overflow-hidden animate-fade-in">
                 <div className="flex items-center justify-between p-4 border-b border-white/10">
                     <h3 className="font-bold text-white flex items-center gap-2">
                        <span className="text-indigo-400">●</span> Recording Library
                     </h3>
                     <button onClick={() => setShowLibrary(false)} className="text-zinc-500 hover:text-white">✕</button>
                 </div>
                 
                 <div className="flex-1 overflow-y-auto p-2 space-y-2">
                     {recordings.length === 0 ? (
                         <div className="text-center p-8 text-zinc-500 text-sm">
                             No recordings found.<br/>Press the red button to start capturing.
                         </div>
                     ) : (
                         recordings.map(rec => (
                             <div key={rec.id} className={`rounded-lg p-3 flex items-center gap-3 group transition-colors ${playingRecordings.has(rec.id) ? 'bg-indigo-500/20 border border-indigo-500/30' : 'bg-white/5 hover:bg-white/10'}`}>
                                 <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${playingRecordings.has(rec.id) ? 'bg-indigo-500/30 text-indigo-300' : 'bg-indigo-500/20 text-indigo-400'}`}>
                                     {playingRecordings.has(rec.id) ? '🔊' : '♫'}
                                 </div>
                                 <div className="flex-1 min-w-0">
                                     <div className="text-sm font-medium text-white truncate flex items-center gap-2">
                                         {rec.name}
                                         {loopingRecordings.has(rec.id) && <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">LOOP</span>}
                                     </div>
                                     <div className="text-xs text-zinc-500">{new Date(rec.timestamp).toLocaleString()}</div>
                                 </div>
                                 <div className="flex items-center gap-1">
                                     {/* Play/Stop Button */}
                                     {playingRecordings.has(rec.id) ? (
                                         <button 
                                            onClick={() => handleStopRecording(rec.id)}
                                            className="p-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-red-400"
                                            title="Stop"
                                         >
                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" /></svg>
                                         </button>
                                     ) : (
                                         <button 
                                            onClick={() => handlePlayRecording(rec)}
                                            className="p-2 hover:bg-white/10 rounded-lg text-zinc-300 hover:text-white"
                                            title="Play"
                                         >
                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                         </button>
                                     )}
                                     {/* Loop Toggle */}
                                     <button 
                                        onClick={() => handleToggleLoop(rec.id)}
                                        className={`p-2 rounded-lg transition-colors ${loopingRecordings.has(rec.id) ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'hover:bg-white/10 text-zinc-500 hover:text-zinc-300'}`}
                                        title={loopingRecordings.has(rec.id) ? "Disable Loop" : "Enable Loop"}
                                     >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                     </button>
                                     {/* Download */}
                                     <button 
                                        onClick={() => handleDownloadRecording(rec)}
                                        className="p-2 hover:bg-white/10 rounded-lg text-zinc-300 hover:text-white"
                                        title="Download"
                                     >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                     </button>
                                     {/* Delete */}
                                     <button 
                                        onClick={() => handleDeleteRecording(rec.id)}
                                        className="p-2 hover:bg-red-500/20 rounded-lg text-zinc-500 hover:text-red-400"
                                        title="Delete"
                                     >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                     </button>
                                 </div>
                             </div>
                         ))
                     )}
                 </div>
             </div>
        )}

        {/* 4. MIDI LIBRARY MODAL */}
        {showMidiLibrary && (
             <div className="absolute top-24 left-1/2 -translate-x-1/2 w-[90vw] max-w-md bg-[#18181b]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-[200] flex flex-col max-h-[60vh] overflow-hidden animate-fade-in">
                 <div className="flex items-center justify-between p-4 border-b border-white/10">
                     <h3 className="font-bold text-white flex items-center gap-2">
                        <span className="text-indigo-400">●</span> MIDI Library
                     </h3>
                     <button onClick={() => setShowMidiLibrary(false)} className="text-zinc-500 hover:text-white">✕</button>
                 </div>
                 
                 {/* Quick Actions */}
                 <div className="p-3 border-b border-white/10 flex gap-2">
                     <button 
                         onClick={() => fileInputRef.current?.click()}
                         className="flex-1 flex items-center justify-center gap-2 py-2 bg-indigo-500/20 text-indigo-400 rounded-lg hover:bg-indigo-500/30 text-xs font-medium"
                     >
                         <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                         Import MIDI
                     </button>
                 </div>
                 
                 <div className="flex-1 overflow-y-auto p-2 space-y-2">
                     {midiFiles.length === 0 ? (
                         <div className="text-center p-8 text-zinc-500 text-sm">
                             No MIDI files found.<br/>Import a .mid or .midi file to get started.
                         </div>
                     ) : (
                         midiFiles.map(midi => (
                             <div key={midi.id} className="rounded-lg p-3 flex items-center gap-3 group transition-colors bg-white/5 hover:bg-white/10">
                                 <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-indigo-500/20 text-indigo-400">
                                     🎹
                                 </div>
                                 <div className="flex-1 min-w-0">
                                     <div className="text-sm font-medium text-white truncate">
                                         {midi.name}
                                     </div>
                                     <div className="text-xs text-zinc-500">{midi.sequence.events.length} notes • {midi.sequence.bpm || 120} BPM</div>
                                 </div>
                                 <div className="flex items-center gap-1">
                                     {/* Export as JSON */}
                                     <button 
                                        onClick={() => handleMidiExport(midi.sequence)}
                                        className="p-2 hover:bg-white/10 rounded-lg text-zinc-300 hover:text-white"
                                        title="Export as JSON"
                                     >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                     </button>
                                     {/* Delete */}
                                     <button 
                                        onClick={() => handleDeleteMidiFile(midi.id)}
                                        className="p-2 hover:bg-red-500/20 rounded-lg text-zinc-500 hover:text-red-400"
                                        title="Delete"
                                     >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                     </button>
                                 </div>
                             </div>
                         ))
                     )}
                 </div>
             </div>
        )}

        {/* 5. WORKSPACE ITEMS */}
        {items.map(item => (
            <FloatingPiano 
                key={item.instanceId}
                id={item.instanceId}
                zIndex={item.zIndex}
                initialPosition={item.position}
                initialSize={item.size}
                activeNotes={activeNotes}
                onPlayNote={startNote}
                onStopNote={stopNote}
                onFocus={() => focusItem(item.instanceId)}
                onClose={() => removeItem(item.instanceId)}
                onUpdateConfig={() => {}}
                midiFiles={midiFiles}
                onImportMidi={() => midiFileInputRef.current?.click()}
            />
        ))}

    </div>
  );
};