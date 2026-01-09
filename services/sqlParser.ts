import { SqlGraphData, SqlNode, SqlLink } from "../types";

export const parseSqlQuery = async (query: string): Promise<SqlGraphData> => {
  return new Promise((resolve) => {
    try {
        const result = parse(query);
        resolve(result);
    } catch (e) {
        console.error("Parse error", e);
        resolve({ nodes: [], links: [] });
    }
  });
};

function maskComments(sql: string): string {
    // Replace block comments /* ... */ with spaces
    let masked = sql.replace(/\/\*[\s\S]*?\*\//g, match => ' '.repeat(match.length));
    // Replace line comments -- ... with spaces
    masked = masked.replace(/--.*$/gm, match => ' '.repeat(match.length));
    return masked;
}

function parse(query: string): SqlGraphData {
    const nodes: SqlNode[] = [];
    const links: SqlLink[] = [];
    const cteNames = new Set<string>();

    // 1. Mask comments to preserve indices but ignore commented code
    const sql = maskComments(query);

    // Helper to find balanced parens
    const findBalancedParen = (str: string, startIndex: number): number => {
        let count = 0;
        for (let i = startIndex; i < str.length; i++) {
            if (str[i] === '(') count++;
            if (str[i] === ')') count--;
            if (count === 0) return i;
        }
        return -1;
    };

    const normalize = (s: string) => s.toUpperCase();

    // 2. Extract CTEs
    const withRegex = /WITH\s+/i; // Removed ^ to allow WITH not being at absolute start if there's junk
    const withMatch = sql.match(withRegex);
    let mainQueryStart = 0;
    
    if (withMatch) {
        // Only consider it a CTE block if it's effectively at the start (ignoring initial whitespace)
        // regex match index gives us position.
        
        let cursor = withMatch.index! + withMatch[0].length;
        let parsing = true;
        
        while (parsing) {
            const remaining = sql.slice(cursor);
            // Match identifier AS (
            const match = remaining.match(/^\s*([a-zA-Z0-9_$]+)\s+AS\s*\(/i);
            
            if (!match) {
                parsing = false;
                mainQueryStart = cursor;
                break;
            }
            
            const cteName = match[1];
            const cteId = normalize(cteName);
            cteNames.add(cteId);
            
            // Calculate location of the CTE Name definition
            // cursor + match.index + ...
            // match[0] is "  name AS ("
            // match[1] is "name"
            const matchIndex = match.index || 0;
            // Find start of name within match[0]
            const nameStartInMatch = match[0].indexOf(cteName);
            const absoluteStart = cursor + matchIndex + nameStartInMatch;
            const absoluteEnd = absoluteStart + cteName.length;

            // Add CTE node
            if (!nodes.find(n => n.id === cteId)) {
                nodes.push({
                    id: cteId,
                    tableName: cteName,
                    alias: cteName,
                    type: 'CTE',
                    columns: [],
                    location: { start: absoluteStart, end: absoluteEnd }
                });
            }
            
            // Find body
            // match[0] ends with '('
            const startParen = cursor + matchIndex + match[0].length - 1;
            const endParen = findBalancedParen(sql, startParen);
            
            if (endParen === -1) {
                parsing = false; 
                break; 
            }
            
            const cteBody = sql.slice(startParen + 1, endParen);
            const cteBodyOffset = startParen + 1;
            
            // Analyze the body of the CTE
            analyzeScope(cteBody, cteBodyOffset, nodes, links, cteId, cteNames);
            
            cursor = endParen + 1;
            
            // Check for comma
            const nextSlice = sql.slice(cursor);
            const commaMatch = nextSlice.match(/^\s*,/);
            
            if (commaMatch) {
                cursor += commaMatch[0].length;
            } else {
                parsing = false;
                mainQueryStart = cursor;
            }
        }
    }
    
    // 3. Analyze Main Query
    const mainQuery = sql.slice(mainQueryStart);
    analyzeScope(mainQuery, mainQueryStart, nodes, links, null, cteNames);
    
    return { nodes, links };
}

function analyzeScope(
    scopeSql: string, 
    offset: number,
    nodes: SqlNode[], 
    links: SqlLink[], 
    scopeOwner: string | null,
    knownCtes: Set<string>
) {
    const normalize = (s: string) => s.toUpperCase();

    // Regex to capture JOIN/FROM clauses
    // Matches: KEYWORD table_name alias?
    const regex = /\b(FROM|JOIN|INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL OUTER JOIN|CROSS JOIN)\s+([a-zA-Z0-9_$.]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_$]+))?/gi;
    
    const keywords = new Set(['ON', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'JOIN', 'UNION', 'SELECT', 'WITH', 'LIMIT', 'OFFSET']);
    
    let match;
    const scopeAliases: {[key: string]: string} = {}; 
    
    while ((match = regex.exec(scopeSql)) !== null) {
        const type = match[1].toUpperCase();
        let tableName = match[2];
        let potentialAlias = match[3];

        if (keywords.has(tableName.toUpperCase())) continue;
        
        if (potentialAlias && keywords.has(potentialAlias.toUpperCase())) {
            potentialAlias = undefined;
        }

        if (!potentialAlias && tableName.includes('.')) {
             const parts = tableName.split('.');
             potentialAlias = parts[parts.length - 1];
        }

        const alias = potentialAlias || tableName;
        const aliasNorm = normalize(alias);
        const tableNorm = normalize(tableName);
        
        const isCte = knownCtes.has(tableNorm);
        const nodeId = aliasNorm;
        
        scopeAliases[aliasNorm] = nodeId;
        
        const existingNode = nodes.find(n => n.id === nodeId);
        
        // Calculate Location
        // match.index is relative to scopeSql
        // We want to highlight the ALIAS if it exists, otherwise the TableName
        let locStart = 0;
        let locEnd = 0;
        
        if (potentialAlias) {
             // Alias is in group 3.
             // We need to find its position in the full match string
             // match[0] is the full string "JOIN table alias"
             // This is a bit tricky because regex groups don't give indices directly in JS without /d flag (ES2022)
             // We'll search for the alias string starting after the table name in match[0]
             const fullMatch = match[0];
             const tableIndexInMatch = fullMatch.indexOf(tableName); // simplistic
             // Start searching for alias after table
             const aliasIndexInMatch = fullMatch.indexOf(potentialAlias, tableIndexInMatch + tableName.length);
             
             locStart = offset + match.index + aliasIndexInMatch;
             locEnd = locStart + potentialAlias.length;
        } else {
             // Use table name location
             const fullMatch = match[0];
             const tableIndexInMatch = fullMatch.indexOf(tableName);
             locStart = offset + match.index + tableIndexInMatch;
             locEnd = locStart + tableName.length;
        }


        if (!existingNode) {
            let nodeType: 'MAIN' | 'JOIN' | 'CTE' | 'SUBQUERY' = 'JOIN';
            if (type === 'FROM' && !scopeOwner) nodeType = 'MAIN';
            if (isCte) nodeType = 'JOIN'; 

            nodes.push({
                id: nodeId,
                tableName: tableName,
                alias: alias,
                type: nodeType,
                location: { start: locStart, end: locEnd }
            });
        } else if (!existingNode.location) {
             // If node exists (e.g. from CTE definition) but this is the first time we see it used?
             // Actually CTE definition adds the node.
             // If we find an alias that reuses a table/node ID?
        }

        // Links...
        if (scopeOwner) {
            if (!links.some(l => l.source === nodeId && l.target === scopeOwner && l.joinType === 'CTE_DEF')) {
                links.push({
                    source: nodeId,
                    target: scopeOwner,
                    joinType: 'CTE_DEF',
                    condition: 'defines'
                });
            }
        }
        
        if (isCte) {
            if (tableNorm !== nodeId) {
                 if (!links.some(l => l.source === tableNorm && l.target === nodeId && l.joinType === 'INSTANCE')) {
                    links.push({
                        source: tableNorm,
                        target: nodeId,
                        joinType: 'INSTANCE',
                        condition: 'usage'
                    });
                 }
            }
        }
    }
    
    const onRegex = /([a-zA-Z0-9_$]+)\.[a-zA-Z0-9_$]+\s*(=|<>|!=)\s*([a-zA-Z0-9_$]+)\.[a-zA-Z0-9_$]+/g;
    let onMatch;
    
    while ((onMatch = onRegex.exec(scopeSql)) !== null) {
        const alias1 = normalize(onMatch[1]);
        const alias2 = normalize(onMatch[3]); 
        
        const node1 = scopeAliases[alias1];
        const node2 = scopeAliases[alias2];

        if (node1 && node2) {
             const linkExists = links.some(l => 
                (l.source === node1 && l.target === node2) ||
                (l.source === node2 && l.target === node1)
             );
             
             if (!linkExists) {
                 links.push({
                     source: node1,
                     target: node2,
                     joinType: 'JOIN',
                     condition: onMatch[0]
                 });
             }
        }
    }
}