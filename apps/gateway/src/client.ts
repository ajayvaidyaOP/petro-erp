import type { GatewayEvent } from './types.js';

export interface IngestResult {
  eventId: string;
  status: 'PROCESSED' | 'REJECTED' | 'ERROR' | 'DUPLICATE';
  reason?: string;
}

export interface CloudClientOptions {
  baseUrl: string;
  deviceKey: string;
  timeoutMs?: number;
}

/** Authenticated cloud client. Only the device key is persisted locally. */
export class CloudClient {
  private baseUrl: string;
  private deviceKey: string;
  private timeoutMs: number;

  constructor(options: CloudClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.deviceKey = options.deviceKey;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-device-key': this.deviceKey,
          ...(init.headers ?? {}),
        },
      });
      const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
      if (!res.ok) {
        throw new Error(`Cloud API ${res.status}: ${body.error?.message ?? 'request failed'}`);
      }
      return body.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  heartbeat(firmwareVersion: string, buffered: number) {
    return this.request<{ serverTime: string; lastSyncAt: string | null }>('/gateway/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ firmwareVersion, buffered }),
    });
  }

  sendEvents(events: GatewayEvent[]) {
    return this.request<{ accepted: number; rejected: number; duplicates: number; results: IngestResult[] }>(
      '/gateway/events',
      { method: 'POST', body: JSON.stringify({ events }) },
    );
  }

  reportError(code: string, message: string, detail?: string) {
    return this.request<{ recorded: boolean }>('/gateway/errors', {
      method: 'POST',
      body: JSON.stringify({ code, message, detail }),
    });
  }
}
