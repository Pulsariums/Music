import React, { useState, useEffect } from 'react';
import { Shell } from './components/Shell';
import { Dashboard } from './apps/Dashboard';
import { LyricalMasterApp } from './apps/LyricalMaster/LyricalMasterApp';
import { VocalLabApp } from './apps/VocalLab/VocalLabApp';
import { MidiEditorApp } from './apps/MidiEditor/MidiEditorApp';
import { AppID } from './types';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { Logger } from './lib/logger';

const App: React.FC = () => {
  const [activeApp, setActiveApp] = useState<AppID>(AppID.DASHBOARD);

  // Lifecycle logging
  useEffect(() => {
    Logger.log('info', `Navigation System`, { route: activeApp });
  }, [activeApp]);

  const renderActiveApp = () => {
    switch (activeApp) {
      case AppID.LYRICAL_MASTER:
        return <LyricalMasterApp />;
      case AppID.VOCAL_LAB:
        return <VocalLabApp onNavigate={setActiveApp} />;
      case AppID.MIDI_EDITOR:
        return <MidiEditorApp onBack={() => setActiveApp(AppID.VOCAL_LAB)} />;
      case AppID.DASHBOARD:
      default:
        return <Dashboard onLaunch={setActiveApp} />;
    }
  };

  return (
    <ErrorBoundary>
      <Shell activeApp={activeApp} onNavigate={setActiveApp}>
        {renderActiveApp()}
      </Shell>
    </ErrorBoundary>
  );
};

export default App;
