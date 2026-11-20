export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://veyro:veyro@localhost:5432/veyro',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  port: Number(process.env.PORT ?? 4000),
  // A vehicle with no fix for this long is shown as offline.
  offlineAfterMs: 10 * 60_000,
  // A trip ends after the vehicle has been stationary this long (or ignition goes off).
  tripIdleEndMs: 5 * 60_000,
  movingSpeedKmh: 2,
};
if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
