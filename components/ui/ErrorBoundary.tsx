import React, { ErrorInfo, ReactNode } from 'react';
import { Logger } from '../../lib/logger';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    Logger.log('error', 'CRITICAL UI FAILURE', { stack: errorInfo.componentStack }, error);
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black text-red-500 font-mono flex flex-col items-center justify-center p-8 text-center">
          <div className="w-24 h-24 border-2 border-red-500 rounded-full flex items-center justify-center mb-8 animate-pulse">
            <span className="text-4xl">⚠️</span>
          </div>
          <h1 className="text-4xl font-bold mb-4 tracking-tighter">SYSTEM FAILURE</h1>
          <p className="text-zinc-400 mb-8 max-w-md">
            The navigational matrix has encountered an unrecoverable anomaly. The Sentinel logger has captured the event.
          </p>
          <div className="bg-zinc-900 p-4 rounded text-left max-w-2xl w-full overflow-x-auto mb-8 border border-red-900/30">
            <code className="text-xs text-red-400">
              {this.state.error?.message}
            </code>
            <pre className="text-[10px] text-zinc-600 mt-4">
              {this.state.error?.stack}
            </pre>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-red-600 text-black font-bold uppercase tracking-widest hover:bg-red-500 transition-colors rounded"
          >
            Reboot System
          </button>
        </div>
      );
    }

    return (this as any).props.children;
  }
}