import type { UserRole } from '@karton/shared';

/** Ulogovani korisnik zakačen na zahtev kroz requireAuth. */
export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
}

declare module '@fastify/session' {
  interface FastifySessionObject {
    userId?: number;
  }
}
