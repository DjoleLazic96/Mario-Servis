import type { FastifyReply } from 'fastify';
import type { ErrorCode } from '@karton/shared';

/**
 * Jedinstveni oblik greške (spec §8): { code, message, fields?, warnings?, existingId? }.
 * `message` je na srpskom, `code` je mašinski.
 */
export function sendError(
  reply: FastifyReply,
  status: number,
  code: ErrorCode,
  message: string,
  extra?: { fields?: Record<string, string>; warnings?: string[]; existingId?: number },
): FastifyReply {
  return reply.code(status).send({ code, message, ...extra });
}
