import React, { useState, useEffect, useMemo } from 'react';
import { SqlNode } from '../types';

interface SqlInputProps {
  value: string;
  onChange: (val: string) => void;
  onAnalyze: () => void;
  isLoading: boolean;
  nodes?: SqlNode[];
  hoveredNodeId?: string | null;
  onHoverNode?: (id: string | null) => void;
  selectedNodeId?: string | null;
  onSelectNode?: (id: string | null) => void;
}

export const SqlInput: React.FC<SqlInputProps> = ({ 
  value, 
  onChange, 
  onAnalyze, 
  isLoading, 
  nodes = [],
  hoveredNodeId,
  onHoverNode,
  selectedNodeId,
  onSelectNode
}) => {
  const [isEditing, setIsEditing] = useState(true);

  // Auto-switch to view mode when loading finishes (if nodes exist)
  useEffect(() => {
    if (!isLoading && nodes.length > 0) {
      setIsEditing(false);
    }
  }, [isLoading, nodes.length]);

  const handleAnalyzeClick = () => {
    onAnalyze();
    // setIsEditing(false) is handled by effect when data arrives
  };

  // Generate highlighted text segments
  const highlightedContent = useMemo(() => {
    if (!nodes.length) return value;

    // Filter nodes with valid locations and sort by start position
    const sortedNodes = [...nodes]
        .filter(n => n.location)
        .sort((a, b) => a.location!.start - b.location!.start);
    
    const segments: React.ReactNode[] = [];
    let currentIdx = 0;

    sortedNodes.forEach((node, i) => {
      const { start, end } = node.location!;
      
      // Safety check for overlapping or out of bounds (naive)
      if (start < currentIdx) return; 

      // Push plain text before
      if (start > currentIdx) {
        segments.push(<span key={`text-${i}`}>{value.slice(currentIdx, start)}</span>);
      }

      // Determine color based on type
      // Using a "Chip" style for better visibility on the new high-contrast editor background
      let colorClass = "";
      
      if (node.type === 'CTE') {
          // Emerald for CTE
          colorClass = "bg-emerald-50 text-emerald-700 border-b-2 border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-600";
      } else if (node.type === 'SUBQUERY') {
          // Amber for Subquery
          colorClass = "bg-amber-50 text-amber-700 border-b-2 border-amber-400 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-600";
      } else {
          // Unified Table Color (Main & Join) - Teal
          colorClass = "bg-teal-50 text-teal-700 border-b-2 border-teal-400 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-600";
      }

      // Highlight if hovered or selected
      const isHovered = hoveredNodeId === node.id;
      const isSelected = selectedNodeId === node.id;
      
      if (isHovered || isSelected) {
          // Add a distinct border or ring for selected state in text too
          colorClass = colorClass + " ring-2 ring-teal-500/50 dark:ring-white/40 shadow-sm z-10 relative";
          if (isSelected) {
             colorClass = colorClass + " ring-offset-1 ring-amber-400 dark:ring-amber-500";
          }
      }

      // Push highlighted node text
      segments.push(
        <span 
          key={`node-${node.id}-${i}`} 
          className={`rounded px-1 mx-[1px] transition-all duration-200 cursor-pointer font-medium ${colorClass}`}
          onMouseEnter={() => onHoverNode && onHoverNode(node.id)}
          onMouseLeave={() => onHoverNode && onHoverNode(null)}
          onClick={(e) => {
              e.stopPropagation();
              onSelectNode && onSelectNode(node.id);
          }}
          title={`${node.type}: ${node.tableName}`}
        >
          {value.slice(start, end)}
        </span>
      );

      currentIdx = end;
    });

    // Push remaining text
    if (currentIdx < value.length) {
      segments.push(<span key="text-end">{value.slice(currentIdx)}</span>);
    }

    return segments;
  }, [value, nodes, hoveredNodeId, selectedNodeId, onHoverNode, onSelectNode]);


  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#051312] rounded-lg shadow-xl border-2 border-slate-300 dark:border-[#1e4e4a] overflow-hidden relative group transition-colors duration-300">
      {/* Toolbar */}
      <div className="bg-slate-100 dark:bg-[#0b2522] px-4 py-3 border-b-2 border-slate-300 dark:border-[#1e4e4a] flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isEditing ? 'bg-amber-400 animate-pulse' : 'bg-teal-500'}`}></div>
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                {isEditing ? 'EDITOR' : 'VIEWER'}
            </h2>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
            {!isEditing ? (
                 <button 
                    onClick={() => setIsEditing(true)}
                    className="h-[34px] px-4 flex items-center justify-center text-xs font-bold bg-white dark:bg-[#113835] hover:bg-slate-50 dark:hover:bg-[#1e4e4a] text-slate-600 dark:text-slate-300 rounded-lg border border-slate-300 dark:border-[#2d6a62] transition-colors shadow-sm tracking-wider"
                >
                    EDIT
                </button>
            ) : (
                <button
                onClick={handleAnalyzeClick}
                disabled={isLoading || !value.trim()}
                className={`h-[34px] px-4 flex items-center justify-center text-xs rounded-lg font-bold transition-all duration-200 tracking-wider
                    ${isLoading || !value.trim() 
                    ? 'bg-slate-200 dark:bg-[#1e4e4a] text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-300 dark:border-[#2d6a62]' 
                    : 'bg-teal-600 hover:bg-teal-500 text-white shadow shadow-teal-500/30'
                    }`}
                >
                {isLoading ? 'PROCESSING...' : 'VISUALIZE'}
                </button>
            )}
        </div>
      </div>
      
      {/* Content Area */}
      <div 
        className="flex-1 relative overflow-auto custom-scrollbar bg-white dark:bg-[#051312]"
        onClick={() => onSelectNode && onSelectNode(null)}
      >
        {isEditing ? (
            <textarea
                className="w-full h-full bg-transparent text-slate-800 dark:text-slate-200 p-4 resize-none focus:outline-none text-sm font-mono whitespace-pre leading-relaxed"
                placeholder="Paste your SELECT statement here..."
                value={value}
                onChange={(e) => onChange(e.target.value)}
                spellCheck={false}
                onClick={(e) => e.stopPropagation()}
            />
        ) : (
            <div className="w-full h-full p-4 text-sm font-mono text-slate-500 dark:text-slate-400 whitespace-pre leading-relaxed">
                {highlightedContent}
            </div>
        )}
      </div>
    </div>
  );
};