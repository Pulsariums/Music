import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AudioEngine } from '../../services/audio/AudioEngine';
import { PRESETS } from '../../services/audio/presets';
import { InstrumentPreset, AudioRecording, SongSequence, WorkspaceItem } from '../../types';
import { Logger } from '../../lib/logger';
import { RecordingRepository } from '../../services/data/RecordingRepository';
import { SimpleMidiParser } from '../../services/midi/SimpleMidiParser';
import { FloatingPiano } from '../../components/instruments/FloatingPiano';

export const VocalLabApp: React.FC = () => {
  // --- WORKSPACE STATE ---
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const [topZIndex, setTopZIndex] = useState(10);
  
  // UI Config
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fallingSpeed, setFallingSpeed] = useState(250);

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

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>();
  const startTimeRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
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
  const startNote = useCallback((note: string, freq: number, preset: InstrumentPreset, transpose: number) => {
    const transposedFreq = freq * Math.pow(2, transpose / 12);
    AudioEngine.playNote(transposedFreq, preset);
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
              if (blob) {
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
              }
          } catch (e) {
              Logger.log('error', 'Failed to save recording', {}, e as Error);
          }
      } else {
          // START
          AudioEngine.startRecording();
          setIsRecording(true);
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
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        try {
            const seq = await SimpleMidiParser.parse(e.target.files[0]);
            setCurrentSequence(seq);
            setPlaybackTime(0);
            setIsPlayingSeq(true);
        } catch(e) { alert("MIDI Error"); }
    }
  };

  // --- INIT ---
  // Moved after function definitions to avoid TDZ issues
  useEffect(() => {
    loadRecordings();
    AudioEngine.init({ latencyHint: 'interactive' });
    
    // Add default piano on start
    addPiano();
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
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 p-1.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl transition-all hover:bg-black/80">
            
            {/* Add Piano Button */}
            <button 
                onClick={addPiano}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all active:scale-95 group"
            >
                <span className="text-lg font-bold">+</span>
                <span className="text-xs font-bold uppercase tracking-wider">Add Piano</span>
            </button>

            <div className="w-px h-6 bg-white/10 mx-2" />

            {/* Recorder Toggle */}
            <button 
                onClick={handleToggleRecording}
                className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${isRecording ? 'bg-red-500/20 text-red-500 border border-red-500/50' : 'hover:bg-white/10 text-zinc-400'}`}
                title={isRecording ? "Stop Recording" : "Start Global Recording"}
            >
                <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-current'}`} />
            </button>

            {/* Recordings Library Toggle */}
            <button 
                onClick={() => setShowLibrary(!showLibrary)}
                className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${showLibrary ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-zinc-400'}`}
                title="Recordings Library"
            >
                 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
            </button>

            {/* MIDI Tools */}
            <button onClick={() => fileInputRef.current?.click()} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/10 text-zinc-400" title="Import MIDI">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            </button>
            <input ref={fileInputRef} type="file" accept=".mid" hidden onChange={handleFileUpload} />

            {currentSequence && (
                <button onClick={() => setIsPlayingSeq(!isPlayingSeq)} className={`w-10 h-10 flex items-center justify-center rounded-xl ${isPlayingSeq ? 'bg-green-500/20 text-green-500' : 'hover:bg-white/10 text-zinc-400'}`}>
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d={isPlayingSeq ? "M6 4h4v16H6zM14 4h4v16h-4z" : "M8 5v14l11-7z"}/></svg>
                </button>
            )}

            <button 
                onClick={() => {
                    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
                    else document.exitFullscreen();
                }}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/10 text-zinc-400"
            >
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
            </button>

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
                                            ⏹
                                         </button>
                                     ) : (
                                         <button 
                                            onClick={() => handlePlayRecording(rec)}
                                            className="p-2 hover:bg-white/10 rounded-lg text-zinc-300 hover:text-white"
                                            title="Play"
                                         >
                                            ►
                                         </button>
                                     )}
                                     {/* Loop Toggle */}
                                     <button 
                                        onClick={() => handleToggleLoop(rec.id)}
                                        className={`p-2 rounded-lg transition-colors ${loopingRecordings.has(rec.id) ? 'bg-green-500/20 text-green-400' : 'hover:bg-white/10 text-zinc-500 hover:text-zinc-300'}`}
                                        title={loopingRecordings.has(rec.id) ? "Disable Loop" : "Enable Loop"}
                                     >
                                        🔁
                                     </button>
                                     {/* Download */}
                                     <button 
                                        onClick={() => handleDownloadRecording(rec)}
                                        className="p-2 hover:bg-white/10 rounded-lg text-zinc-300 hover:text-white"
                                        title="Download"
                                     >
                                        ↓
                                     </button>
                                     {/* Delete */}
                                     <button 
                                        onClick={() => handleDeleteRecording(rec.id)}
                                        className="p-2 hover:bg-red-500/20 rounded-lg text-zinc-500 hover:text-red-400"
                                        title="Delete"
                                     >
                                        🗑
                                     </button>
                                 </div>
                             </div>
                         ))
                     )}
                 </div>
             </div>
        )}

        {/* 4. WORKSPACE ITEMS */}
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
            />
        ))}

    </div>
  );
};