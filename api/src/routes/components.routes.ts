import type { FastifyInstance } from 'fastify';
import {
  listComponents,
  getComponent,
} from '../controllers/components.controller.js';

export async function componentRoutes(app: FastifyInstance) {
  app.get('/components', listComponents);
  app.get('/components/:id', getComponent);
}
