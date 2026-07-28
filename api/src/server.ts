/**
 * Valvesim API — Fastify service entry point.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import 'dotenv/config';
import { isDbUp } from './config/db.js';
import { designRoutes } from './routes/designs.routes.js';
import { componentRoutes } from './routes/components.routes.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({
  logger: {
    transport:
      process.env.NODE_ENV === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } },
  },
});

await app.register(cors, {
  origin: [/localhost:\d+$/, 'https://valvesim.com'],
});

app.get('/health', async () => ({
  status: 'ok',
  db: (await isDbUp()) ? 'up' : 'down',
}));

await app.register(designRoutes, { prefix: '/api' });
await app.register(componentRoutes, { prefix: '/api' });

// Surface DB connectivity problems as 503 rather than opaque 500s
app.setErrorHandler<Error & { code?: string; statusCode?: number }>((err, _req, reply) => {
  app.log.error(err);
  const code = err.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return reply
      .code(503)
      .send({ error: 'database unavailable', detail: err.message });
  }
  return reply
    .code(err.statusCode ?? 500)
    .send({ error: err.message ?? 'internal error' });
});

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
