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

    // Regex to capture JOIN/FROM clauses - just the keyword and table name
    // We'll handle alias detection separately below
    const regex = /(FULL\s+OUTER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|CROSS\s+JOIN|FROM|JOIN)\s+([a-zA-Z0-9_$]+(?:\.[a-zA-Z0-9_$]+)?)/gi;
    
    const keywords = new Set(['ON', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'JOIN', 'UNION', 'SELECT', 'WITH', 'LIMIT', 'OFFSET']);
    
    let match;
    const scopeAliases: {[key: string]: string} = {}; 
    
    // Reset regex state before looping
    regex.lastIndex = 0;
    
    while ((match = regex.exec(scopeSql)) !== null) {
        const type = match[1].toUpperCase();
        let tableName = match[2];
        let potentialAlias: string | undefined = undefined;
        
        // Extract what comes after the table name in the original SQL
        const matchEnd = match.index + match[0].length;
        const afterTable = scopeSql.slice(matchEnd).trimLeft();
        
        // Check if the next token is an identifier (potential alias)
        const aliasMatch = afterTable.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s/);
        if (aliasMatch) {
            potentialAlias = aliasMatch[1];
        }

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
             // Search for the alias in the SQL starting from after the match
             const matchEnd = offset + match.index + match[0].length;
             const aliasPos = scopeSql.indexOf(potentialAlias, match.index + match[0].length);
             if (aliasPos !== -1) {
                 locStart = offset + aliasPos;
                 locEnd = locStart + potentialAlias.length;
             } else {
                 // Fallback: highlight the table name
                 const tablePos = scopeSql.indexOf(tableName, match.index);
                 locStart = offset + tablePos;
                 locEnd = locStart + tableName.length;
             }
        } else {
             // Use table name location - find it in the match
             const tablePos = match[0].indexOf(tableName);
             locStart = offset + match.index + tablePos;
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