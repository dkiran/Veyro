import { config } from './config.js';

export type LiveStatus = 'moving' | 'idle' | 'stopped' | 'offline' | 'unknown';

export function liveStatus(s: { ts: Date | string; speed_kmh: number; ignition: boolean | null } | null, now = Date.now()): LiveStatus {
  if (!s) return 'unknown';
  if (now - new Date(s.ts).getTime() > config.offlineAfterMs) return 'offline';
  if (s.ignition !== false && s.speed_kmh >= config.movingSpeedKmh) return 'moving';
  if (s.ignition === true) return 'idle';
  return 'stopped';
}
