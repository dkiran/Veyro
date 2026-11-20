// In-process pub/sub for live updates, keyed by org. For multi-instance deployments,
// swap publish() for Postgres LISTEN/NOTIFY or Redis pub/sub without touching callers.
type Sock = { send(data: string): void; readyState: number };
const rooms = new Map<string, Set<Sock>>();

export function join(orgId: string, s: Sock) {
  if (!rooms.has(orgId)) rooms.set(orgId, new Set());
  rooms.get(orgId)!.add(s);
}
export function leave(orgId: string, s: Sock) {
  rooms.get(orgId)?.delete(s);
}
export function publish(orgId: string, msg: unknown) {
  const data = JSON.stringify(msg);
  for (const s of rooms.get(orgId) ?? []) if (s.readyState === 1) s.send(data);
}
