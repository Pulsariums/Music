import React, { useState, useEffect } from 'react';
import { Shell } from './components/Shell';
import { Dashboard } from './apps/Dashboard';
import { LyricalMasterApp } from './apps/LyricalMaster/LyricalMasterApp';
import { VocalLabApp } from './apps/VocalLab/VocalLabApp';
import { AppID } from './types';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { DebugConsole } from './components/debug/DebugConsole';
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
        return <VocalLabApp />;
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
      <DebugConsole activeApp={activeApp} />
    </ErrorBoundary>
  );
};

export default App;
