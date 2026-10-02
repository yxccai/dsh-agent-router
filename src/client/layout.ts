export interface Position { id: string; x: number; y: number; width: number; parentId: string | null }
export interface Layout { nodes: Position[]; width: number; height: number }

/** Lay out a real parent-child tree in stable catalog order without shrinking text. */
export function layoutTree(rows: { sessionId: string; parentId: string | null }[], available: number): Layout {
  const nodeWidth = Math.max(76, Math.min(160, Math.floor((available - 40) / 3)));
  const gap = 14;
  const children = new Map<string | null, typeof rows>();
  const ids = new Set(rows.map(row => row.sessionId));
  for (const row of rows) {
    const parent = row.parentId && ids.has(row.parentId) ? row.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(row); children.set(parent, siblings);
  }
  const seen = new Set<string>();
  const nodes: Position[] = [];
  let cursor = 12;
  function visit(row: typeof rows[number], depth: number): number {
    if (seen.has(row.sessionId)) return cursor;
    seen.add(row.sessionId);
    const start = cursor;
    const descendants = (children.get(row.sessionId) ?? []).filter(item => !seen.has(item.sessionId));
    const centers = descendants.map(child => visit(child, depth + 1));
    const center = centers.length ? (centers[0] + centers[centers.length - 1]) / 2 : cursor + nodeWidth / 2;
    if (!descendants.length) cursor = start + nodeWidth + gap;
    nodes.push({ id: row.sessionId, x: center, y: depth * 126 + 20, width: nodeWidth, parentId: row.parentId });
    return center;
  }
  for (const row of children.get(null) ?? []) visit(row, 0);
  for (const row of rows) if (!seen.has(row.sessionId)) visit(row, 0);
  const width = Math.max(available, cursor - gap + 12);
  const shift = (width - (cursor - gap + 12)) / 2;
  return { nodes: nodes.map(node => ({ ...node, x: node.x + shift })), width, height: Math.max(160, ...nodes.map(node => node.y + 96)) };
}

/** A directed call edge ends just above the target box. */
export function edgePath(from: Position, to: Position): string {
  const top = from.y + 76, end = to.y - 6, middle = (top + end) / 2;
  if (Math.abs(from.x - to.x) < 1) return `M${from.x},${top}V${end}`;
  const direction = Math.sign(to.x - from.x), radius = 6;
  return `M${from.x},${top}V${middle - radius}Q${from.x},${middle} ${from.x + direction * radius},${middle}H${to.x - direction * radius}Q${to.x},${middle} ${to.x},${middle + radius}V${end}`;
}
