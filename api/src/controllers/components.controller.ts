/**
 * Business logic for the component library (model lookup).
 * Components: tubes, transformers, passives — each with a symbol,
 * pin map, and SPICE model.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../config/db.js';

interface ListQuery {
  kind?: string;
}

interface IdParams {
  id: string;
}

export async function listComponents(
  req: FastifyRequest<{ Querystring: ListQuery }>,
  reply: FastifyReply,
) {
  const { kind } = req.query;
  const { rows } = kind
    ? await query(
        `SELECT id, kind, name, manufacturer, pin_map, params
           FROM components WHERE kind = $1 ORDER BY name`,
        [kind],
      )
    : await query(
        `SELECT id, kind, name, manufacturer, pin_map, params
           FROM components ORDER BY kind, name`,
      );
  return reply.send(rows);
}

export async function getComponent(
  req: FastifyRequest<{ Params: IdParams }>,
  reply: FastifyReply,
) {
  const { rows } = await query('SELECT * FROM components WHERE id = $1', [
    req.params.id,
  ]);
  if (rows.length === 0) {
    return reply.code(404).send({ error: 'component not found' });
  }
  return reply.send(rows[0]);
}
