import React from 'react';
import { AppID } from '../types';

interface ShellProps {
  children: React.ReactNode;
  activeApp: AppID;
  onNavigate: (id: AppID) => void;
}

export const Shell: React.FC<ShellProps> = ({ children, activeApp, onNavigate }) => {
  const isDashboard = activeApp === AppID.DASHBOARD;

  return (
    <div className="h-screen bg-black text-white font-sans overflow-hidden flex flex-col">
      
      {/* Dynamic Background */}
      <div className={`fixed inset-0 transition-opacity duration-1000 ${isDashboard ? 'opacity-100' : 'opacity-20'}`}>
         <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-800 via-black to-black" />
      </div>

      {/* Main Content */}
      <main className="relative z-10 w-full flex-1">
         {children}
      </main>

      {/* Persistent Dock (Only visible when NOT in Dashboard for easy switching) */}
      {!isDashboard && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 mb-4 bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-full px-6 py-2 flex gap-6 shadow-2xl z-50 transition-transform hover:scale-105">
            <NavIcon 
                active={false} 
                icon="home" 
                onClick={() => onNavigate(AppID.DASHBOARD)} 
            />
            <div className="w-px bg-white/10 h-6 self-center" />
            <NavIcon 
                active={activeApp === AppID.LYRICAL_MASTER} 
                icon="mic" 
                onClick={() => onNavigate(AppID.LYRICAL_MASTER)} 
            />
            <NavIcon 
                active={activeApp === AppID.VOCAL_LAB} 
                icon="piano" 
                onClick={() => onNavigate(AppID.VOCAL_LAB)} 
            />
        </div>
      )}
    </div>
  );
};

const NavIcon = ({ active, icon, onClick }: { active: boolean, icon: string, onClick: () => void }) => (
    <button 
        onClick={onClick}
        className={`p-2 rounded-lg transition-colors ${active ? 'text-white bg-white/10' : 'text-zinc-500 hover:text-white'}`}
    >
        {icon === 'home' && <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>}
        {icon === 'mic' && <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>}
        {icon === 'piano' && <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>}
    </button>
);