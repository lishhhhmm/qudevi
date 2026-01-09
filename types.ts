export interface SqlNode {
  id: string;
  tableName: string;
  alias?: string;
  type: 'MAIN' | 'JOIN' | 'SUBQUERY' | 'CTE';
  columns?: string[];
  location?: { start: number; end: number };
}

export interface SqlLink {
  source: string;
  target: string;
  joinType: string;
  condition: string;
}

export interface SqlGraphData {
  nodes: SqlNode[];
  links: SqlLink[];
}

export enum AnalysisStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}

// For D3 Simulation, nodes and links get mutated
export interface SimulationNode extends SqlNode {
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface SimulationLink extends Omit<SqlLink, 'source' | 'target'> {
  source: SimulationNode;
  target: SimulationNode;
}