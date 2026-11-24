// Load server/.env if present (Node 20.12+/22). Real environment variables take precedence.
try { process.loadEnvFile(); } catch { /* no .env file */ }

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://veyro:veyro@localhost:5432/veyro',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  port: Number(process.env.PORT ?? 4000),
  // Behind a reverse proxy set HOST=127.0.0.1 so the API is not reachable directly from the internet.
  host: process.env.HOST ?? '0.0.0.0',
  // Folder with the built web app (web/dist). When set (or found next to the server in production) the API serves it,
  // so a reverse proxy only has to forward everything to this one port.
  webDist: process.env.WEB_DIST ?? '',
  // Browser origins allowed to call the API cross-origin. Dev: any. Production: none (same-origin via the proxy)
  // unless CORS_ORIGIN lists them, e.g. "https://track.veyrotrack.com".
  corsOrigin: (process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean) : process.env.NODE_ENV === 'production' ? false : true) as boolean | string[],
  // A vehicle with no fix for this long is shown as offline.
  offlineAfterMs: 10 * 60_000,
  // A trip ends after the vehicle has been stationary this long (or ignition goes off).
  tripIdleEndMs: 5 * 60_000,
  movingSpeedKmh: 2,
  // Driver-behaviour thresholds (derived from consecutive GPS fixes; no accelerometer yet).
  overspeedKmh: 80,
  harshKmhPerSec: 8, // ~0.23 g
};
if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
