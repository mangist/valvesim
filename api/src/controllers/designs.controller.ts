/**
 * Business logic for saving/loading schematic designs (JSONB storage).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../config/db.js';

interface DesignBody {
  name: string;
  description?: string;
  schematic?: unknown;
}

interface IdParams {
  id: string;
}

export async function listDesigns(_req: FastifyRequest, reply: FastifyReply) {
  const { rows } = await query(
    `SELECT id, name, description, created_at, updated_at
       FROM designs ORDER BY updated_at DESC LIMIT 100`,
  );
  return reply.send(rows);
}

export async function getDesign(
  req: FastifyRequest<{ Params: IdParams }>,
  reply: FastifyReply,
) {
  const { rows } = await query('SELECT * FROM designs WHERE id = $1', [
    req.params.id,
  ]);
  if (rows.length === 0) {
    return reply.code(404).send({ error: 'design not found' });
  }
  return reply.send(rows[0]);
}

export async function createDesign(
  req: FastifyRequest<{ Body: DesignBody }>,
  reply: FastifyReply,
) {
  const { name, description = '', schematic = {} } = req.body;
  const { rows } = await query(
    `INSERT INTO designs (name, description, schematic)
     VALUES ($1, $2, $3) RETURNING *`,
    [name, description, JSON.stringify(schematic)],
  );
  return reply.code(201).send(rows[0]);
}

export async function updateDesign(
  req: FastifyRequest<{ Params: IdParams; Body: Partial<DesignBody> }>,
  reply: FastifyReply,
) {
  const { name, description, schematic } = req.body;
  const { rows } = await query(
    `UPDATE designs SET
        name        = COALESCE($2, name),
        description = COALESCE($3, description),
        schematic   = COALESCE($4, schematic)
     WHERE id = $1 RETURNING *`,
    [
      req.params.id,
      name ?? null,
      description ?? null,
      schematic === undefined ? null : JSON.stringify(schematic),
    ],
  );
  if (rows.length === 0) {
    return reply.code(404).send({ error: 'design not found' });
  }
  return reply.send(rows[0]);
}

export async function deleteDesign(
  req: FastifyRequest<{ Params: IdParams }>,
  reply: FastifyReply,
) {
  const { rowCount } = await query('DELETE FROM designs WHERE id = $1', [
    req.params.id,
  ]);
  if (!rowCount) {
    return reply.code(404).send({ error: 'design not found' });
  }
  return reply.code(204).send();
}
