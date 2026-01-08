import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  interactive?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({ children, className = '', onClick, interactive = false }) => {
  return (
    <div 
      onClick={onClick}
      className={`
        bg-zinc-900/60 backdrop-blur-xl border border-white/10 
        rounded-2xl p-6 shadow-2xl relative overflow-hidden group
        ${interactive ? 'cursor-pointer hover:bg-zinc-800/60 hover:border-white/20 transition-all duration-300 hover:scale-[1.01]' : ''}
        ${className}
      `}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      {children}
    </div>
  );
};
