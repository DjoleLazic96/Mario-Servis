import type { ApiError } from '@karton/shared';

/**
 * Tanak API klijent. Automatski dodaje X-CSRF-Token iz XSRF-TOKEN kolačića
 * na sve mutacione zahteve (double-submit ugovor iz OpenAPI).
 */
const BASE = '/api/v1';

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError,
  ) {
    super(body.message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const isMutation = method !== 'GET' && method !== 'HEAD';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (isMutation) headers['X-CSRF-Token'] = csrfToken();

  const res = await fetch(BASE + path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Istekla/ubijena sesija: javi celoj aplikaciji da vrati korisnika na prijavu.
  // Bez ovoga ekran ostane zaglavljen na „Učitavanje…" (promise pukne, niko ga ne uhvati).
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    window.dispatchEvent(new Event('karton:unauthorized'));
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(res.status, data as ApiError);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
