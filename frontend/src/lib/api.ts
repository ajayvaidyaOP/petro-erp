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

interface ApiResponse<T> {
  data: T;
  meta?: ListMeta;
}

async function requestWithMeta<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 204) return { data: undefined as T };
  const text = await res.text();
  let body: ApiResponse<T> & { error?: ApiErrorShape };
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(res.status, {
      code: 'INVALID_RESPONSE',
      message: res.ok ? 'The server returned an invalid response' : 'The server is unavailable. Please try again.',
    });
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error ?? { code: 'ERROR', message: 'Request failed' },
    );
  }
  return body;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await requestWithMeta<T>(path, options)).data;
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

/** Use this for endpoints whose data contains extra fields alongside a paginated list. */
export function apiGetWithMeta<T>(path: string, signal?: AbortSignal): Promise<ApiResponse<T>> {
  return requestWithMeta<T>(path, { signal });
}

export async function apiList<T>(path: string, signal?: AbortSignal): Promise<ListResponse<T>> {
  const { data, meta } = await requestWithMeta<T[]>(path, { signal });
  if (!Array.isArray(data)) {
    throw new ApiError(200, { code: 'INVALID_RESPONSE', message: 'The server returned an invalid list' });
  }
  // Some endpoints return unpaginated arrays; preserve real pagination whenever
  // the server supplies it instead of mistaking the current page for the total.
  return { data, meta: meta ?? { page: 1, pageSize: data.length, total: data.length, totalPages: 1 } };
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
