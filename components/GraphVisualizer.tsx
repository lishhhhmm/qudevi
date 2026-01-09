import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { SqlGraphData, SimulationNode, SimulationLink } from '../types';

interface GraphVisualizerProps {
  data: SqlGraphData | null;
  hoveredNodeId?: string | null;
  onHoverNode?: (id: string | null) => void;
  selectedNodeId?: string | null;
  onSelectNode?: (id: string | null) => void;
  isDarkMode: boolean;
}

export const GraphVisualizer: React.FC<GraphVisualizerProps> = ({ 
    data, 
    hoveredNodeId, 
    onHoverNode, 
    selectedNodeId, 
    onSelectNode,
    isDarkMode 
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [isLegendOpen, setIsLegendOpen] = useState(false);

  // Derived selected node for popup
  const selectedNode = data?.nodes.find(n => n.id === selectedNodeId) || null;

  // Define Colors based on mode
  const colors = {
      bg: isDarkMode ? '#081e1c' : '#f1f5f9', // Darkest teal in dark mode
      nodeStroke: isDarkMode ? '#0b2522' : '#fff', 
      linkDefault: isDarkMode ? '#2d6a62' : '#cbd5e1',
      linkInstance: isDarkMode ? '#4a8e84' : '#94a3b8',
      textMain: isDarkMode ? '#e2e8f0' : '#1e293b',
      textSub: isDarkMode ? '#94a3b8' : '#64748b',
      highlightStroke: isDarkMode ? '#2dd4bf' : '#0f766e', // Teal accent
      selectionStroke: '#f59e0b', // Amber 500
      arrowHead: isDarkMode ? '#4a8e84' : '#64748b',
      // Node fills
      tableNode: isDarkMode ? '#2dd4bf' : '#0ea5e9', // Teal/Blue for all tables
      cteNode: '#10b981', // Emerald
      subNode: '#f59e0b', // Amber
  };

  // Effect to handle external hover and selection states
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    
    // Reset all nodes to base state
    svg.selectAll(".node-circle")
       .attr("stroke", colors.nodeStroke)
       .attr("stroke-width", 3)
       .attr("filter", null);

    // Apply Highlight (Hover) - Lower priority
    if (hoveredNodeId && hoveredNodeId !== selectedNodeId) {
        const node = svg.select(`#node-${hoveredNodeId}`);
        node.attr("stroke", colors.highlightStroke)
            .attr("stroke-width", 4)
            .attr("filter", isDarkMode ? "drop-shadow(0px 0px 8px rgba(45, 212, 191, 0.4))" : "drop-shadow(0px 0px 8px rgba(0,0,0,0.3))");
    }

    // Apply Selection - Higher priority
    if (selectedNodeId) {
        const node = svg.select(`#node-${selectedNodeId}`);
        node.attr("stroke", colors.selectionStroke)
            .attr("stroke-width", 5)
            .attr("filter", isDarkMode ? "drop-shadow(0px 0px 12px rgba(245, 158, 11, 0.5))" : "drop-shadow(0px 0px 10px rgba(245, 158, 11, 0.4))");
        
        // Bring to front
        node.raise();
    }
  }, [hoveredNodeId, selectedNodeId, isDarkMode, colors]);

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g");
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    
    zoomBehaviorRef.current = zoom;
    svg.call(zoom);

    const nodes: SimulationNode[] = data.nodes.map(n => ({ ...n }));
    const links: SimulationLink[] = data.links.map(l => ({ 
      ...l, 
      source: nodes.find(n => n.id === l.source) as SimulationNode, 
      target: nodes.find(n => n.id === l.target) as SimulationNode 
    })).filter(l => l.source && l.target);

    // Enhanced Force Simulation for "Less Spaghetti"
    // 1. Stronger Repulsion (Charge) to spread nodes apart
    // 2. Longer Link Distance to allow connections to breathe
    // 3. Larger Collision Radius to prevent node overlapping
    const simulation = d3.forceSimulation<SimulationNode>(nodes)
      .force("link", d3.forceLink<SimulationNode, SimulationLink>(links)
        .id(d => d.id)
        .distance(50) // Increased from 150
        .strength(0.8) // Stiff links
      )
      .force("charge", d3.forceManyBody()
        .strength(-5000) // Significantly increased repulsion from -500
        .distanceMax(1000) // Don't repel things infinitely far away, helps with stability
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(80).iterations(2)) // Larger radius and more iterations
      .force("x", d3.forceX(width / 2).strength(0.02)) // Gentle guidance to center x
      .force("y", d3.forceY(height / 2).strength(0.02)); // Gentle guidance to center y

    const defs = svg.append("defs");
    
    defs.append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 32)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", colors.arrowHead);
      
    defs.append("marker")
      .attr("id", "arrowhead-cte")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 32)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#10b981");

    const link = g.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", d => d.joinType === 'INSTANCE' ? 1.5 : 2)
      .attr("stroke", d => {
        if (d.joinType === 'CTE_DEF') return "#10b981";
        if (d.joinType === 'INSTANCE') return colors.linkInstance;
        return colors.linkDefault;
      })
      .attr("stroke-opacity", d => d.joinType === 'INSTANCE' ? 0.4 : 0.6)
      .attr("stroke-dasharray", d => {
        if (d.joinType === 'CTE_DEF') return "5,5";
        if (d.joinType === 'INSTANCE') return "2,2";
        return null;
      })
      .attr("marker-end", d => {
          if (d.joinType === 'CTE_DEF') return "url(#arrowhead-cte)";
          if (d.joinType === 'INSTANCE') return "none";
          return "url(#arrowhead)";
      });

    const linkLabel = g.append("g")
        .selectAll("text")
        .data(links)
        .enter().append("text")
        .attr("dy", -5)
        .attr("text-anchor", "middle")
        .style("font-size", "9px")
        .style("fill", d => d.joinType === 'CTE_DEF' ? "#10b981" : colors.arrowHead)
        .style("font-family", "JetBrains Mono")
        .text(d => d.joinType);

    const nodeGroup = g.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        if (onHoverNode) onHoverNode(d.id);
        d3.select(event.currentTarget).select("circle")
           .transition().duration(200)
           .attr("r", 28);
      })
      .on("mouseleave", (event, d) => {
        if (onHoverNode) onHoverNode(null);
        d3.select(event.currentTarget).select("circle")
           .transition().duration(200)
           .attr("r", 25);
      })
      .call(d3.drag<SVGGElement, SimulationNode>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));

    nodeGroup.append("circle")
      .attr("id", d => `node-${d.id}`)
      .attr("class", "node-circle")
      .attr("r", 25)
      .attr("fill", d => {
        switch(d.type) {
          case 'CTE': return colors.cteNode;
          case 'SUBQUERY': return colors.subNode;
          default: return colors.tableNode; // Unified Table Color
        }
      })
      .attr("stroke", colors.nodeStroke)
      .attr("stroke-width", 3)
      .on("click", (event, d) => {
        event.stopPropagation();
        if (onSelectNode) onSelectNode(d.id);
      });

    nodeGroup.append("text")
      .attr("dy", 40)
      .attr("text-anchor", "middle")
      .text(d => d.alias || d.tableName)
      .attr("fill", colors.textMain)
      .style("font-size", "12px")
      .style("font-weight", "500")
      .style("pointer-events", "none");
    
    nodeGroup.append("text")
      .attr("dy", 54)
      .attr("text-anchor", "middle")
      .text(d => d.alias && d.alias !== d.tableName ? `(${d.tableName})` : "")
      .attr("fill", colors.textSub)
      .style("font-size", "10px")
      .style("pointer-events", "none");

    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x!)
        .attr("y1", d => d.source.y!)
        .attr("x2", d => d.target.x!)
        .attr("y2", d => d.target.y!);

      linkLabel
        .attr("x", d => (d.source.x! + d.target.x!) / 2)
        .attr("y", d => (d.source.y! + d.target.y!) / 2);

      nodeGroup
        .attr("transform", d => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event: d3.D3DragEvent<SVGGElement, SimulationNode, unknown>, d: SimulationNode) {
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: d3.D3DragEvent<SVGGElement, SimulationNode, unknown>, d: SimulationNode) {
      simulation.alphaTarget(0.3).restart();
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: d3.D3DragEvent<SVGGElement, SimulationNode, unknown>, d: SimulationNode) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    svg.on("click", () => {
        if (onSelectNode) onSelectNode(null);
    });

    return () => {
      simulation.stop();
    };
  }, [data, isDarkMode]);

  const handleRecenter = () => {
      if (!svgRef.current || !zoomBehaviorRef.current || !containerRef.current) return;

      const svg = d3.select(svgRef.current);
      // Select actual nodes from DOM to get current simulated positions
      const circles = svg.selectAll<SVGCircleElement, SimulationNode>('.node-circle');
      
      if (circles.empty()) {
          // Fallback if no nodes
           svg.transition()
             .duration(750)
             .call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
           return;
      }

      const nodes = circles.data();
      const xExtent = d3.extent(nodes, d => d.x);
      const yExtent = d3.extent(nodes, d => d.y);

      if (xExtent[0] === undefined || yExtent[0] === undefined) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      const padding = 60; // Padding around the graph

      const x0 = xExtent[0]!;
      const x1 = xExtent[1]!;
      const y0 = yExtent[0]!;
      const y1 = yExtent[1]!;

      const graphWidth = x1 - x0;
      const graphHeight = y1 - y0;

      // Calculate scale to fit
      // Prevent division by zero
      const targetScale = Math.min(
          (width - padding * 2) / Math.max(graphWidth, 1),
          (height - padding * 2) / Math.max(graphHeight, 1)
      );

      // Clamp scale to reasonable bounds to avoid excessive zoom in/out
      const constrainedScale = Math.min(Math.max(targetScale, 0.2), 1.5);

      // Calculate translation to center
      const tx = (width - graphWidth * constrainedScale) / 2 - x0 * constrainedScale;
      const ty = (height - graphHeight * constrainedScale) / 2 - y0 * constrainedScale;
      
      const transform = d3.zoomIdentity.translate(tx, ty).scale(constrainedScale);

      svg.transition()
         .duration(750)
         .call(zoomBehaviorRef.current.transform, transform);
  };

  if (!data) return (
      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 space-y-4">
        
      </div>
  );

  return (
    <div className="relative w-full h-full bg-slate-100 dark:bg-[#081e1c] rounded-xl shadow-lg border border-slate-200 dark:border-[#2d6a62] overflow-hidden" ref={containerRef}>
      <svg ref={svgRef} className="w-full h-full bg-slate-50/50 dark:bg-[#081e1c]/50 block"></svg>
      
      {/* Top Left Controls: Legend & Recenter */}
      <div className="absolute top-4 left-4 z-10 flex flex-row items-start gap-2">
          
          {/* Legend */}
          <div className="bg-white/90 dark:bg-[#113835]/90 backdrop-blur-sm rounded-lg border border-slate-200 dark:border-[#2d6a62] shadow-xl overflow-hidden transition-all duration-300 w-32">
            <button 
                className="w-full h-[32px] px-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-[#1e4e4a] transition-colors"
                onClick={() => setIsLegendOpen(!isLegendOpen)}
            >
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase select-none tracking-wide">LEGEND</span>
                <span className={`text-slate-400 text-[10px] transform transition-transform duration-300 ${isLegendOpen ? 'rotate-180' : ''}`}>▼</span>
            </button>
            
            <div className={`transition-[max-height,opacity] duration-300 ease-in-out overflow-hidden ${isLegendOpen ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="px-3 pb-3 space-y-2 border-t border-slate-100 dark:border-[#1e4e4a] pt-2">
                    <div className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${isDarkMode ? 'bg-teal-400' : 'bg-blue-500'}`}></span>
                        <span className="text-xs text-slate-600 dark:text-slate-300">TABLE</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                        <span className="text-xs text-slate-600 dark:text-slate-300">CTE</span>
                    </div>
                </div>
            </div>
          </div>

          {/* Recenter Button */}
          <button 
                onClick={handleRecenter}
                className="bg-white/90 dark:bg-[#113835]/90 backdrop-blur text-slate-600 dark:text-slate-300 px-3 rounded-lg border border-slate-200 dark:border-[#2d6a62] shadow-xl hover:bg-slate-50 dark:hover:bg-[#1e4e4a] transition-colors h-[34px] flex items-center justify-center"
                title="Fit Graph to Screen"
            >
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">RECENTER</span>
          </button>
       </div>

       {selectedNode && (
        <div className="absolute bottom-4 right-4 w-64 bg-white/95 dark:bg-[#113835]/90 backdrop-blur p-4 rounded-lg border border-slate-200 dark:border-[#2d6a62] shadow-2xl z-20">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white truncate">{selectedNode.alias}</h3>
            <button onClick={() => onSelectNode && onSelectNode(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">✕</button>
          </div>
          <div>
            <span className="text-xs text-slate-400 uppercase font-bold">Table</span>
            <p className="text-sm text-slate-600 dark:text-slate-200">{selectedNode.tableName}</p>
          </div>
        </div>
      )}
    </div>
  );
};