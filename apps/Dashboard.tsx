import React from 'react';
import { REGISTERED_APPS } from '../constants';
import { AppID } from '../types';
import { GlassCard } from '../components/ui/GlassCard';

interface DashboardProps {
  onLaunch: (id: AppID) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onLaunch }) => {
  return (
    <div className="flex flex-col gap-8 animate-fade-in">
      <div className="flex flex-col gap-2 mt-8 md:mt-16">
        <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-zinc-200 to-zinc-500">
          Hoşgeldin, Virtüöz.
        </h1>
        <p className="text-zinc-400 text-lg">Bugün hangi stüdyoda çalışmak istersin?</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {REGISTERED_APPS.map((app) => (
          <GlassCard 
            key={app.id} 
            interactive 
            onClick={() => onLaunch(app.id)}
            className="group min-h-[200px] flex flex-col justify-between"
          >
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${app.color} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
              <span className="text-white font-bold text-xl">
                {app.id === AppID.LYRICAL_MASTER ? '🎤' : '🎼'}
              </span>
            </div>
            <div>
              <h3 className="text-xl font-bold text-white mb-2">{app.name}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{app.description}</p>
            </div>
            <div className="mt-4 flex items-center text-xs font-medium text-zinc-500 uppercase tracking-wider group-hover:text-white transition-colors">
              Başlat <span className="ml-2 group-hover:translate-x-1 transition-transform">→</span>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
};
