export interface ApiErrorShape {
  code: string;
  message: string;
  details?: { issues?: { path: string; message: string }[] } & Record<string, unknown>;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: ApiErrorShape['details'];

  constructor(status: number, error: ApiErrorShape) {
    super(error.message);
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }

  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const issue of this.details?.issues ?? []) {
      if (!out[issue.path]) out[issue.path] = issue.message;
    }
    return out;
  }
}

const BASE = '/api/v1';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body.error as ApiErrorShape) ?? { code: 'ERROR', message: 'Request failed' },
    );
  }
  return body.data as T;
}

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ListResponse<T> {
  data: T[];
  meta: ListMeta;
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { signal });
}

export function apiList<T>(path: string, signal?: AbortSignal): Promise<ListResponse<T>> {
  return request<ListResponse<T> | T[]>(path, { signal }).then((body) => {
    if (Array.isArray(body)) {
      return { data: body, meta: { page: 1, pageSize: body.length, total: body.length, totalPages: 1 } };
    }
    return body as ListResponse<T>;
  });
}

export function apiPost<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

export function queryString(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function idempotencyKey(prefix = 'ui') {
  return `${prefix}-${crypto.randomUUID()}`;
}
