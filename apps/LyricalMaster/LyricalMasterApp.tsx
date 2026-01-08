
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SongRepository } from '../../services/data/SongRepository';
import { SongAnalysis, ViewState } from '../../types';
import { Logger } from '../../lib/logger';
import { AudioEngine } from '../../services/audio/AudioEngine';
import { PRESETS } from '../../services/audio/presets';

export const LyricalMasterApp: React.FC = () => {
  const [viewState, setViewState] = useState<ViewState>(ViewState.IDLE);
  const [searchTerm, setSearchTerm] = useState('');
  const [data, setData] = useState<SongAnalysis | null>(null);
  
  // Editor State
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editLyrics, setEditLyrics] = useState('');
  const [editYoutubeId, setEditYoutubeId] = useState('');

  // Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [maskLevel, setMaskLevel] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0); 
  
  // Audio Mode: 'NONE' | 'METRONOME' | 'YOUTUBE'
  const [audioMode, setAudioMode] = useState<'METRONOME' | 'YOUTUBE'>('YOUTUBE');

  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const playbackInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Handlers ---

  const handleSearch = async (query: string) => {
    setViewState(ViewState.LOADING);
    try {
      const result = await SongRepository.searchSong(query);
      if (result) {
          setData(result);
          // Auto-select mode based on availability
          setAudioMode(result.youtubeId ? 'YOUTUBE' : 'METRONOME');
          
          await new Promise(r => setTimeout(r, 600));
          setViewState(ViewState.ACTIVE);
          startPlayback(result);
      } else {
          setEditTitle(query);
          setIsEditing(true);
          setViewState(ViewState.IDLE);
      }
    } catch (e: any) {
      Logger.log('error', 'Song load failed', { error: e.message });
      setViewState(ViewState.ERROR);
    }
  };

  const handleCreateSong = () => {
      const newSong = SongRepository.createFromText(editTitle || "Yeni Şarkı", "Ben", editLyrics, editYoutubeId);
      setData(newSong);
      setAudioMode(newSong.youtubeId ? 'YOUTUBE' : 'METRONOME');
      setIsEditing(false);
      setViewState(ViewState.ACTIVE);
      startPlayback(newSong);
  };

  const startPlayback = (songData: SongAnalysis) => {
    AudioEngine.resume(); 
    setIsPlaying(true);
    setCurrentLineIndex(0);
    startTimer(songData.bpm);
  };

  const startTimer = (bpm: number) => {
      if (playbackInterval.current) clearInterval(playbackInterval.current);
      
      const baseSpeed = 60000 / bpm; // ms per beat
      // Assume average line length corresponds to 4 beats (1 bar)
      const speedMs = baseSpeed * 4 * (1 / playbackSpeed); 

      playbackInterval.current = setInterval(() => {
          // METRONOME LOGIC: Play a tick if in metronome mode
          if (audioMode === 'METRONOME' && isPlaying) {
             // Play a soft tick sound (Woodblock style)
             AudioEngine.playNote(800, PRESETS.XYLOPHONE); 
          }

          setCurrentLineIndex(prev => {
              if (!data) return 0;
              if (prev >= data.lyrics.length - 1) {
                  stopPlayback();
                  return prev;
              }
              return prev + 1;
          });
      }, speedMs);
  };

  const stopPlayback = () => {
    setIsPlaying(false);
    if (playbackInterval.current) clearInterval(playbackInterval.current);
  };

  const togglePlay = () => {
      if (isPlaying) {
          stopPlayback();
      } else {
          setIsPlaying(true);
          if (data) startTimer(data.bpm);
      }
  };

  // Speed/Mode Change
  useEffect(() => {
      if (isPlaying && data) {
          startTimer(data.bpm);
      }
  }, [playbackSpeed, audioMode]);

  useEffect(() => {
      return () => {
          if (playbackInterval.current) clearInterval(playbackInterval.current);
      }
  }, []);

  // Auto-Scroll
  useEffect(() => {
      if (isPlaying && lineRefs.current[currentLineIndex] && scrollRef.current) {
          lineRefs.current[currentLineIndex]?.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
          });
      }
  }, [currentLineIndex, isPlaying]);

  const getMaskedText = useCallback((text: string) => {
    if (maskLevel === 0) return text;
    const words = text.split(' ');
    if (maskLevel === 1) return words.map((w, i) => (i + text.length) % 3 === 0 ? '_____' : w).join(' ');
    if (maskLevel === 2) return words.map(w => w.length > 1 ? `_${w.slice(1)}` : '_').join(' ');
    if (maskLevel === 3) return words.map(w => w.length > 0 ? `${w[0]}____` : '').join(' ');
    return text;
  }, [maskLevel]);


  // --- VIEWS ---

  // 1. CREATE / EDIT VIEW
  if (isEditing) {
      return (
        <div className="flex flex-col h-full max-w-2xl mx-auto p-6 animate-fade-in">
            <h2 className="text-3xl font-bold mb-6 text-white">Yeni Şarkı Ekle</h2>
            
            <div className="space-y-4 flex-1 flex flex-col">
                <div>
                    <label className="text-xs text-zinc-400 uppercase font-bold">Şarkı Adı</label>
                    <input 
                        className="w-full bg-zinc-800 border border-zinc-700 p-3 rounded-xl text-white focus:border-indigo-500 outline-none"
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        placeholder="Örn: Güzel Günler Göreceğiz"
                    />
                </div>
                 <div>
                    <label className="text-xs text-zinc-400 uppercase font-bold">YouTube ID (Opsiyonel)</label>
                    <div className="flex gap-2">
                        <span className="p-3 bg-zinc-900 border border-zinc-700 rounded-l-xl text-zinc-500 text-sm">youtube.com/watch?v=</span>
                        <input 
                            className="flex-1 bg-zinc-800 border border-zinc-700 p-3 rounded-r-xl text-white focus:border-indigo-500 outline-none font-mono"
                            value={editYoutubeId}
                            onChange={e => setEditYoutubeId(e.target.value)}
                            placeholder="Kz39lq55Cq4"
                        />
                    </div>
                </div>
                
                <div className="flex-1 flex flex-col">
                    <label className="text-xs text-zinc-400 uppercase font-bold mb-2">Şarkı Sözleri (Yapıştır)</label>
                    <textarea 
                        className="flex-1 w-full bg-zinc-800 border border-zinc-700 p-4 rounded-xl text-white focus:border-indigo-500 outline-none resize-none font-mono text-sm leading-relaxed"
                        value={editLyrics}
                        onChange={e => setEditLyrics(e.target.value)}
                        placeholder="Sözleri buraya yapıştır..."
                    />
                </div>

                <div className="flex gap-4 pt-4">
                    <button onClick={() => setIsEditing(false)} className="flex-1 py-3 rounded-xl border border-zinc-600 hover:bg-zinc-800 text-zinc-300">İptal</button>
                    <button onClick={handleCreateSong} className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold">Kaydet ve Başla</button>
                </div>
            </div>
        </div>
      );
  }

  // 2. SEARCH / HOME VIEW
  if (viewState === ViewState.IDLE) {
    return (
      <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto animate-fade-in px-4">
        <div className="text-center mb-12">
            <h1 className="text-5xl md:text-7xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-white to-zinc-600 tracking-tighter mb-4">
                Lyrical
            </h1>
            <p className="text-zinc-400 text-lg">Müzik hafızanı güçlendir.</p>
        </div>

        <div className="w-full relative group z-10">
            <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            <input 
                type="text" 
                placeholder="Şarkı ara veya 'Enter' ile yeni oluştur..."
                className="w-full bg-zinc-900 border border-zinc-700 text-white text-xl p-6 rounded-full focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all text-center relative z-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchTerm)}
            />
        </div>

        {/* Quick Suggestions */}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
            {['Gönül Dağı', 'Uzun İnce', 'Elfida', 'Sarı Gelin'].map(song => (
                <button 
                    key={song}
                    onClick={() => handleSearch(song)}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-full text-zinc-300 text-sm transition-colors border border-zinc-700"
                >
                    {song}
                </button>
            ))}
        </div>
      </div>
    );
  }

  // 3. ACTIVE PLAYER VIEW
  return (
    <div className="flex flex-col h-[calc(100vh-80px)] md:h-[calc(100vh-40px)] animate-fade-in relative overflow-hidden bg-black">
        
        {/* Top Bar: Controls */}
        <div className="flex-shrink-0 h-16 flex items-center justify-between px-6 z-20 border-b border-white/10 bg-[#0a0a0a]">
            <button onClick={() => { stopPlayback(); setViewState(ViewState.IDLE); }} className="text-zinc-400 hover:text-white flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                <span className="hidden md:inline">Kütüphane</span>
            </button>
            
            <div className="text-center">
                <h2 className="font-bold text-white text-lg leading-none">{data?.title}</h2>
                <span className="text-xs text-indigo-400 font-mono tracking-widest">{data?.artist}</span>
            </div>

            <div className="flex items-center gap-2">
                 {/* Mode Selection */}
                 {data?.youtubeId && (
                     <button 
                        onClick={() => setAudioMode(audioMode === 'YOUTUBE' ? 'METRONOME' : 'YOUTUBE')}
                        className={`hidden md:flex items-center gap-2 px-3 py-1 rounded text-xs font-bold border transition-colors ${audioMode === 'YOUTUBE' ? 'bg-red-500/20 border-red-500 text-red-400' : 'border-zinc-700 text-zinc-500'}`}
                     >
                        {audioMode === 'YOUTUBE' ? '▶ YOUTUBE' : '⏱ METRONOM'}
                     </button>
                 )}

                 {/* Speed Control */}
                 <div className="hidden md:flex items-center bg-zinc-800 rounded-lg mr-2">
                    <button onClick={() => setPlaybackSpeed(s => Math.max(0.5, s - 0.25))} className="px-2 py-1 hover:bg-zinc-700 text-zinc-400">-</button>
                    <span className="text-xs font-mono w-12 text-center">{playbackSpeed.toFixed(2)}x</span>
                    <button onClick={() => setPlaybackSpeed(s => Math.min(2.0, s + 0.25))} className="px-2 py-1 hover:bg-zinc-700 text-zinc-400">+</button>
                 </div>

                 {/* Masking Toggle */}
                 <button 
                    onClick={() => setMaskLevel(prev => (prev + 1) % 4)}
                    className={`px-3 py-1 rounded text-xs font-bold border transition-colors ${maskLevel > 0 ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'border-zinc-700 text-zinc-500'}`}
                 >
                    {maskLevel === 0 ? 'GİZLEME: YOK' : `SEVİYE: ${maskLevel}`}
                 </button>
            </div>
        </div>

        {/* Main Lyrics Area */}
        <div 
            ref={scrollRef}
            className="flex-grow overflow-y-auto no-scrollbar relative z-10 scroll-smooth bg-[#0a0a0a]"
        >
            <div className="min-h-[40vh]" /> {/* Top padding */}
            
            <div className="flex flex-col items-center px-4 md:px-20 pb-40 gap-8">
                {data?.lyrics.map((line, idx) => {
                    const isActive = idx === currentLineIndex;
                    const isPast = idx < currentLineIndex;
                    
                    return (
                        <div 
                            key={idx}
                            ref={el => { lineRefs.current[idx] = el; }}
                            onClick={() => setCurrentLineIndex(idx)}
                            className={`transition-all duration-500 ease-out text-center max-w-5xl cursor-pointer p-4 rounded-2xl
                                ${isActive ? 'scale-110 bg-white/5 shadow-2xl ring-1 ring-white/10' : 'scale-95 hover:bg-white/5'}
                                ${isPast ? 'opacity-30 blur-[1px]' : 'opacity-60'}
                                ${isActive ? '!opacity-100 !blur-0' : ''}
                            `}
                        >
                            <p 
                                className={`
                                    text-2xl md:text-4xl lg:text-5xl font-bold leading-tight tracking-tight transition-colors duration-300
                                    ${line.isChorus ? 'text-indigo-100' : 'text-zinc-100'}
                                    ${isActive ? 'text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-200 to-indigo-400' : ''}
                                `}
                            >
                                {isActive ? getMaskedText(line.text) : (maskLevel > 0 ? '...' : line.text)}
                            </p>
                        </div>
                    )
                })}
            </div>

            <div className="min-h-[50vh]" /> {/* Bottom padding */}
        </div>

        {/* YOUTUBE EMBED (Floating) */}
        {audioMode === 'YOUTUBE' && data?.youtubeId && (
            <div className="absolute bottom-6 right-6 z-40 w-64 md:w-80 shadow-2xl rounded-xl overflow-hidden border border-white/20 bg-black">
                <div className="aspect-video relative">
                    <iframe 
                        width="100%" 
                        height="100%" 
                        src={`https://www.youtube.com/embed/${data.youtubeId}?autoplay=${isPlaying ? 1 : 0}&controls=1&modestbranding=1&rel=0`} 
                        title="YouTube video player" 
                        frameBorder="0" 
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                        allowFullScreen
                    ></iframe>
                </div>
                <div className="p-2 bg-zinc-900 flex justify-between items-center text-[10px] text-zinc-500">
                    <span>Orijinal Kayıt</span>
                    <button onClick={() => setAudioMode('METRONOME')} className="hover:text-white">✕ Kapat</button>
                </div>
            </div>
        )}

        {/* Floating Play/Pause (Only for Metronome mode or global control) */}
        {audioMode === 'METRONOME' && (
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-30">
                <button 
                    onClick={togglePlay}
                    className={`w-20 h-20 rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(0,0,0,0.5)] transition-all transform hover:scale-105 active:scale-95 ${isPlaying ? 'bg-zinc-800 text-red-500 border border-red-500/20' : 'bg-indigo-600 text-white'}`}
                >
                    {isPlaying ? (
                        <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                    ) : (
                        <svg className="w-8 h-8 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    )}
                </button>
            </div>
        )}

    </div>
  );
};
