
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { InstrumentPreset, NoteDef } from '../../types';
import { PRESETS } from '../../services/audio/presets';
import { getClientCoordinates, generateKeyboard } from '../../services/audio/musicUtils';
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
  onUpdateConfig
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

  // Refs for interactions
  const dragRef = useRef<{ startX: number, startY: number, initX: number, initY: number } | null>(null);
  const resizeRef = useRef<{ startX: number, startY: number, initW: number, initH: number } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  // Dynamic Key Height based on window height
  // Header is approx 40px, bottom padding 20px. 
  const keyHeight = Math.max(80, size.height - 70); 

  return (
      <div 
        className="absolute rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-white/10 bg-[#1e2029]/95 backdrop-blur-2xl transition-shadow duration-200"
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
                    onClick={() => setShowPresetMenu(!showPresetMenu)}
                    className="flex items-center gap-2 px-2 py-1 hover:bg-white/10 rounded transition-colors no-drag"
                >
                    <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
                    <span className="text-xs font-bold text-zinc-300 uppercase tracking-wide truncate max-w-[120px]">{activePreset.name}</span>
                    <svg className="w-3 h-3 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
             </div>

             {/* Right: Controls */}
             <div className="flex items-center gap-1">
                <button onClick={() => setShowVolume(!showVolume)} className={`p-1.5 rounded hover:bg-white/10 no-drag ${showVolume ? 'text-indigo-400' : 'text-zinc-500 hover:text-white'}`} title="Volume">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                </button>
                <button onClick={() => setShowSettings(!showSettings)} className="p-1.5 text-zinc-500 hover:text-white rounded hover:bg-white/10 no-drag">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </button>
                <div className="w-px h-4 bg-white/10 mx-1"></div>
                <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-red-400 rounded hover:bg-white/10 no-drag">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
             </div>
        </div>

        {/* CONTENT: KEYBOARD */}
        <div className="flex-1 relative bg-black/40 group/keyboard">
            
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

        {/* POPUP MENUS */}
        {showPresetMenu && (
            <div className="absolute top-10 left-2 w-64 bg-[#18181b] border border-white/10 rounded-xl shadow-2xl z-[70] flex flex-col max-h-[300px] no-drag">
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
             <div className="absolute top-10 right-2 w-56 bg-[#18181b] border border-white/10 rounded-xl shadow-2xl z-[70] p-4 space-y-4 no-drag">
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
             <div className="absolute top-10 right-12 w-48 bg-[#18181b] border border-white/10 rounded-xl shadow-2xl z-[70] p-4 no-drag">
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
