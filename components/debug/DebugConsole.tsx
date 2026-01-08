import React, { useState, useEffect, useRef } from 'react';
import { Logger, LogEntry } from '../../lib/logger';
import { AppID } from '../../types';

interface DebugConsoleProps {
  activeApp: AppID;
}

export const DebugConsole: React.FC<DebugConsoleProps> = ({ activeApp }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'error'>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = Logger.subscribe((updatedLogs) => {
      setLogs(updatedLogs);
    });
    return unsubscribe;
  }, []);

  const filteredLogs = logs.filter(l => filter === 'all' || l.level === 'error' || l.level === 'fatal');
  const errorCount = logs.filter(l => l.level === 'error' || l.level === 'fatal').length;

  return (
    <div className={`fixed bottom-0 left-0 right-0 z-[10000] transition-all duration-300 flex flex-col font-mono text-xs ${isExpanded ? 'h-96' : 'h-8'}`}>
      
      {/* Toolbar / Status Bar */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="h-8 bg-[#007acc] text-white flex items-center justify-between px-4 cursor-pointer hover:bg-[#0062a3] select-none border-t border-white/10"
      >
        <div className="flex items-center gap-4">
          <span className="font-bold">DEBUG CONSOLE</span>
          <span className="opacity-70">|</span>
          <div className="flex items-center gap-2">
             <span className={`w-2 h-2 rounded-full ${errorCount > 0 ? 'bg-red-500 animate-pulse' : 'bg-emerald-400'}`} />
             <span>{errorCount} Errors</span>
          </div>
          <span className="opacity-70">|</span>
          <span className="opacity-80">Context: {activeApp}</span>
        </div>
        <div>
          {isExpanded ? '▼ Collapse' : '▲ Expand'}
        </div>
      </div>

      {/* Console Body */}
      {isExpanded && (
        <div className="flex-1 bg-[#1e1e1e] text-[#d4d4d4] flex overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 bg-[#252526] border-r border-[#3e3e42] flex flex-col">
            <button 
              onClick={() => setFilter('all')}
              className={`px-4 py-2 text-left hover:bg-[#2a2d2e] ${filter === 'all' ? 'bg-[#37373d] text-white' : ''}`}
            >
              All Messages ({logs.length})
            </button>
            <button 
              onClick={() => setFilter('error')}
              className={`px-4 py-2 text-left hover:bg-[#2a2d2e] text-red-400 ${filter === 'error' ? 'bg-[#37373d]' : ''}`}
            >
              Errors Only ({errorCount})
            </button>
            <div className="flex-grow" />
            <button 
              onClick={() => Logger.clear()}
              className="px-4 py-3 text-left hover:bg-[#2a2d2e] border-t border-[#3e3e42] text-zinc-500"
            >
              Clear Console
            </button>
          </div>

          {/* Log Stream */}
          <div className="flex-1 overflow-y-auto p-2" ref={scrollRef}>
            {filteredLogs.length === 0 && (
              <div className="h-full flex items-center justify-center text-zinc-600 italic">
                No active signals intercepted.
              </div>
            )}
            
            {filteredLogs.map((log) => (
              <div key={log.id} className="mb-1 border-b border-[#3e3e42] pb-1 hover:bg-[#2a2d2e] group">
                {/* Log Header */}
                <div className="flex items-start gap-2 py-1">
                  <span className="text-[#569cd6] min-w-[70px]">
                    {new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}
                  </span>
                  <span className={`uppercase font-bold min-w-[50px] ${
                    log.level === 'error' || log.level === 'fatal' ? 'text-[#f48771]' : 
                    log.level === 'warn' ? 'text-[#cca700]' : 'text-[#6a9955]'
                  }`}>
                    [{log.level}]
                  </span>
                  <span className="flex-1 whitespace-pre-wrap font-sans">{log.message}</span>
                </div>

                {/* Structured Context Data */}
                {log.context && (
                  <div className="ml-[130px] mb-1 bg-[#00000030] p-2 rounded border-l-2 border-[#569cd6]">
                    <span className="text-xs text-[#569cd6] block mb-1">State Context:</span>
                    <pre className="text-[10px] text-[#9cdcfe] overflow-x-auto">
                      {JSON.stringify(log.context, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Stack Trace Visualization */}
                {log.frames && log.frames.length > 0 && (
                  <div className="ml-[130px] mt-1">
                    <div className="text-[#f48771] mb-1 text-[10px] uppercase tracking-wider">Call Stack / Trace:</div>
                    {log.frames.map((frame, idx) => (
                      <div key={idx} className="flex gap-2 text-[10px] font-mono hover:bg-[#ffffff10] cursor-pointer p-0.5 rounded">
                        <span className="text-[#dcdcaa]">{frame.method}</span>
                        <span className="text-[#808080]">at</span>
                        <span className="text-[#4ec9b0] underline decoration-dotted" title={frame.raw}>
                          {frame.file}
                        </span>
                        <span className="text-[#b5cea8]">:{frame.line}:{frame.column}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
