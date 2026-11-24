import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './migrate.js';

await migrate();
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const auto = resolve(process.cwd(), '../web/dist');
const webDist = config.webDist || (process.env.NODE_ENV === 'production' && existsSync(auto) ? auto : '');
const app = await buildApp({ webDist });
await app.listen({ port: config.port, host: config.host });
