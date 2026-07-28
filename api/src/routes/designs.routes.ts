import type { FastifyInstance } from 'fastify';
import {
  listDesigns,
  getDesign,
  createDesign,
  updateDesign,
  deleteDesign,
} from '../controllers/designs.controller.js';

export async function designRoutes(app: FastifyInstance) {
  app.get('/designs', listDesigns);
  app.get('/designs/:id', getDesign);
  app.post('/designs', createDesign);
  app.put('/designs/:id', updateDesign);
  app.delete('/designs/:id', deleteDesign);
}
