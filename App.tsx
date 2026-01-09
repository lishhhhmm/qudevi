import React, { useState, useEffect, useCallback } from 'react';
import { SqlInput } from './components/SqlInput';
import { GraphVisualizer } from './components/GraphVisualizer';
import { parseSqlQuery } from './services/sqlParser';
import { SqlGraphData, AnalysisStatus } from './types';

const App: React.FC = () => {
  const [query, setQuery] = useState<string>('');
  
  const [graphData, setGraphData] = useState<SqlGraphData | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  
  // Shared hover state
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  // Shared selection state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // System Theme Detection for D3
  const [isDarkMode, setIsDarkMode] = useState<boolean>(
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  // Resizing State
  // Initialize width/height safely
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
     if (typeof window !== 'undefined') return Math.min(450, window.innerWidth * 0.4);
     return 450;
  });
  
  const [leftPanelHeight, setLeftPanelHeight] = useState(() => {
     if (typeof window !== 'undefined') return Math.min(300, window.innerHeight * 0.35); // Start closer to 35% on mobile
     return 300;
  });

  const [isDragging, setIsDragging] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true); // Default assumption, updated by effect

  useEffect(() => {
    // Theme listener
    const mediaQueryDark = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChangeDark = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
    mediaQueryDark.addEventListener('change', handleChangeDark);

    // Desktop listener
    const mediaQueryDesktop = window.matchMedia('(min-width: 768px)');
    const handleChangeDesktop = (e: MediaQueryListEvent) => {
        setIsDesktop(e.matches);
        // Reset/Adjust dimensions when switching modes if needed
        if (e.matches) {
            // Switched to Desktop
            setLeftPanelWidth(Math.min(450, window.innerWidth * 0.4));
        } else {
            // Switched to Mobile
            setLeftPanelHeight(Math.min(300, window.innerHeight * 0.35));
        }
    };
    
    // Initial check
    setIsDesktop(mediaQueryDesktop.matches); 
    
    // Add listeners
    mediaQueryDesktop.addEventListener('change', handleChangeDesktop);

    // Orientation/Resize listener to clamp values
    const handleResize = () => {
        if (window.innerWidth >= 768) {
             // Desktop Clamp
             setLeftPanelWidth(prev => Math.min(prev, window.innerWidth - 300));
        } else {
             // Mobile Clamp
             setLeftPanelHeight(prev => Math.min(prev, window.innerHeight - 150));
        }
    };
    window.addEventListener('resize', handleResize);

    return () => {
        mediaQueryDark.removeEventListener('change', handleChangeDark);
        mediaQueryDesktop.removeEventListener('change', handleChangeDesktop);
        window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Resizing Logic
  const startResize = useCallback(() => {
    setIsDragging(true);
    document.body.style.cursor = isDesktop ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [isDesktop]);

  const stopResize = useCallback(() => {
    setIsDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const doResize = useCallback((e: MouseEvent | TouchEvent) => {
    if (isDragging) {
       let clientX, clientY;
       if ('touches' in e) {
           clientX = e.touches[0].clientX;
           clientY = e.touches[0].clientY;
       } else {
           clientX = (e as MouseEvent).clientX;
           clientY = (e as MouseEvent).clientY;
       }

       if (isDesktop) {
           const newWidth = Math.max(300, Math.min(window.innerWidth - 300, clientX));
           setLeftPanelWidth(newWidth);
       } else {
           const maxH = window.innerHeight - 150; // Leave 150px for graph
           const newHeight = Math.max(150, Math.min(maxH, clientY)); // Min 150px for editor
           setLeftPanelHeight(newHeight);
       }
    }
  }, [isDragging, isDesktop]);

  useEffect(() => {
      if (isDragging) {
          window.addEventListener('mousemove', doResize);
          window.addEventListener('mouseup', stopResize);
          window.addEventListener('touchmove', doResize, { passive: false });
          window.addEventListener('touchend', stopResize);
      } else {
          window.removeEventListener('mousemove', doResize);
          window.removeEventListener('mouseup', stopResize);
          window.removeEventListener('touchmove', doResize);
          window.removeEventListener('touchend', stopResize);
      }
      return () => {
          window.removeEventListener('mousemove', doResize);
          window.removeEventListener('mouseup', stopResize);
          window.removeEventListener('touchmove', doResize);
          window.removeEventListener('touchend', stopResize);
      }
  }, [isDragging, doResize, stopResize]);

  const handleAnalyze = async () => {
    setStatus(AnalysisStatus.LOADING);
    setError(null);
    setSelectedNodeId(null);
    try {
      const data = await parseSqlQuery(query);
      setGraphData(data);
      setStatus(AnalysisStatus.SUCCESS);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "An unknown error occurred");
      setStatus(AnalysisStatus.ERROR);
    }
  };

  return (
    <div className="h-[100dvh] w-screen bg-slate-50 dark:bg-[#0b2522] text-slate-800 dark:text-slate-200 overflow-hidden flex flex-col transition-colors duration-300">
      {/* (Header removed) */}

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Panel: Input */}
        <div 
            style={{ 
                width: isDesktop ? leftPanelWidth : '100%',
                height: isDesktop ? '100%' : leftPanelHeight
            }}
            className="min-w-[300px] md:min-w-[300px] min-h-[150px] border-b md:border-b-0 border-slate-200 dark:border-[#1e4e4a] p-4 flex flex-col z-10 bg-white dark:bg-[#113835] shadow-xl shrink-0"
        >
          <SqlInput 
            value={query} 
            onChange={setQuery} 
            onAnalyze={handleAnalyze} 
            isLoading={status === AnalysisStatus.LOADING}
            nodes={graphData?.nodes}
            hoveredNodeId={hoveredNodeId}
            onHoverNode={setHoveredNodeId}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
          
          {/* Status / Error Message */}
          {status === AnalysisStatus.ERROR && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-200 text-sm flex items-start gap-3">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <div className="flex-1">
                    <h3 className="font-bold text-red-700 dark:text-red-400">Analysis Failed</h3>
                    <p className="opacity-90 mt-1">{error}</p>
                </div>
            </div>
          )}
        </div>

        {/* Resizer Handle (Desktop Only) */}
        <div
            className="hidden md:flex w-1 bg-slate-200 dark:bg-[#1e4e4a] hover:bg-teal-400 active:bg-teal-500 cursor-col-resize z-20 items-center justify-center transition-colors shadow-sm"
            onMouseDown={startResize}
        >
            {/* Grip Handle Visual */}
            <div className="h-8 w-0.5 bg-slate-300 dark:bg-[#2d6a62] rounded-full"></div>
        </div>

        {/* Resizer Handle (Mobile Only) */}
        <div
            className="flex md:hidden h-4 w-full bg-slate-100 dark:bg-[#0b2522] hover:bg-teal-50 dark:hover:bg-[#1e4e4a] active:bg-teal-100 cursor-row-resize z-20 items-center justify-center transition-colors border-y border-slate-200 dark:border-[#1e4e4a] shrink-0"
            onMouseDown={startResize}
            onTouchStart={startResize}
        >
            {/* Grip Handle Visual Horizontal */}
            <div className="w-8 h-1 bg-slate-300 dark:bg-[#2d6a62] rounded-full"></div>
        </div>

        {/* Right Panel: Visualization */}
        <div className="flex-1 md:h-full bg-slate-100 dark:bg-[#081e1c] p-4 overflow-hidden relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-slate-200 via-slate-100 to-slate-100 dark:from-[#0b2522] dark:via-[#081e1c] dark:to-[#081e1c] opacity-50 pointer-events-none"></div>
            <GraphVisualizer 
                data={graphData} 
                hoveredNodeId={hoveredNodeId} 
                onHoverNode={setHoveredNodeId}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                isDarkMode={isDarkMode}
            />
        </div>
      </main>

      <footer className="border-t border-slate-200 dark:border-[#1e4e4a] px-4 py-2 text-right text-xs text-slate-500 dark:text-slate-400">
        <p className="inline-block">qudevi © 2026 - <a href="https://github.com/lishhhhmm/qudevi" target="_blank" rel="noopener noreferrer" className="text-teal-600 dark:text-teal-400 hover:underline">lishhhhmm/qudevi</a></p>
      </footer>
    </div>
  );
};

export default App;