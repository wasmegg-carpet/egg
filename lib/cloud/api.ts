/**
 * A typed client for the cloud library worker (repo joobrainie/joo-cloudflare; its README documents each
 * route). Stateless: the caller holds the session token. Every failure is a CloudError carrying the worker's
 * error `code`, so callers branch on codes, not messages.
 */
import type { LibrarySettings } from './crypto';

/** The worker's base URL: VITE_CLOUD_API_URL when set (e.g. http://localhost:8787 for `wrangler dev`). */
export const CLOUD_API_URL: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_CLOUD_API_URL ??
  'https://joo-cloudflare.joo-cloudflare.workers.dev';

export type CloudErrorCode =
  | 'not_found'
  | 'bad_request'
  | 'too_large'
  | 'unauthorized'
  | 'forbidden'
  | 'no_library'
  | 'wrong_pin'
  | 'throttled'
  | 'rate_limited'
  | 'library_exists'
  | 'invalid_eid'
  | 'eid_not_found'
  | 'marker_mismatch'
  | 'precondition_required'
  | 'conflict'
  | 'quota_exceeded'
  | 'busy'
  | 'upstream_error'
  | 'misconfigured'
  | 'origin_not_allowed'
  | 'internal'
  /** Client-side: the PIN doesn't fit the library's PIN type (CloudError.message says how). */
  | 'pin_format'
  /** No answer at all: offline, DNS, CORS, or a blocker. */
  | 'network'
  /** An answer that isn't the worker's JSON error. */
  | 'unexpected';

export class CloudError extends Error {
  constructor(
    readonly code: CloudErrorCode,
    message: string,
    readonly status = 0,
    /** Seconds, from Retry-After, when the worker sent one. */
    readonly retryAfter?: number,
    /** The current etag, on a 412 conflict. */
    readonly etag?: string
  ) {
    super(message);
    this.name = 'CloudError';
  }
}

export type ShareKind = 'once' | 'multi';

export interface SharePreview {
  kind: ShareKind;
  /** The plan's name, encrypted with the link key (base64). */
  title: string;
  created: number;
  expires: number;
  size: number;
}

export interface Session {
  token: string;
  /** Unix seconds. */
  expires: number;
}

type Body = Uint8Array<ArrayBuffer>;

/** An etag without quotes (R2 sends `"…"` in headers and bare in JSON). */
function bareEtag(value: string | null | undefined): string {
  return (value ?? '').replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
}

export class CloudApi {
  constructor(
    readonly baseUrl: string = CLOUD_API_URL,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args)
  ) {}

  private async send(path: string, init: RequestInit & { session?: Session; etag?: string } = {}): Promise<Response> {
    const { session, etag, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    if (etag) headers.set('If-Match', `"${etag}"`);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, { ...rest, headers });
    } catch (err) {
      throw new CloudError('network', `could not reach the cloud library (${err instanceof Error ? err.message : err})`);
    }
    if (res.ok) return res;
    const retryAfter = Number(res.headers.get('Retry-After')) || undefined;
    let code: CloudErrorCode = 'unexpected';
    let message = `HTTP ${res.status}`;
    try {
      const parsed = (await res.json()) as { error?: { code?: CloudErrorCode; message?: string } };
      if (parsed.error?.code) {
        code = parsed.error.code;
        message = parsed.error.message ?? message;
      }
    } catch {
      // not the worker's JSON
    }
    throw new CloudError(code, message, res.status, retryAfter, res.headers.get('ETag') ? bareEtag(res.headers.get('ETag')) : undefined);
  }

  private async json<T>(path: string, init: RequestInit & { session?: Session; etag?: string } = {}): Promise<T> {
    return (await (await this.send(path, init)).json()) as T;
  }

  private static jsonBody(value: unknown): RequestInit {
    return { body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' } };
  }

  /** The library's settings, or null when this EID has none. */
  async getMarker(marker: string): Promise<LibrarySettings | null> {
    try {
      return await this.json<LibrarySettings>(`/v1/marker/${marker}`);
    } catch (err) {
      if (err instanceof CloudError && err.code === 'no_library') return null;
      throw err;
    }
  }

  /** Create a library; `replace` replaces this EID's existing one (a forgotten PIN). */
  async createLibrary(input: { eid: string; marker: string; main: string; settings: LibrarySettings; body: Body; replace?: boolean }): Promise<{ etag: string; session: Session }> {
    const form = new FormData();
    if (input.replace) form.append('replace', 'true');
    form.append('eid', input.eid);
    form.append('marker', input.marker);
    form.append('main', input.main);
    form.append('settings', JSON.stringify(input.settings));
    form.append('body', new Blob([input.body]), 'main');
    const out = await this.json<{ etag: string; token: string; expires: number }>('/v1/library', { method: 'POST', body: form });
    return { etag: out.etag, session: { token: out.token, expires: out.expires } };
  }

  /** The main file and a session. Throws CloudError `wrong_pin`, `no_library` or `throttled`. */
  async unlock(marker: string, main: string): Promise<{ body: Body; etag: string; session: Session }> {
    const res = await this.send('/v1/unlock', { method: 'POST', ...CloudApi.jsonBody({ marker, main }) });
    const token = res.headers.get('X-Session-Token');
    const expires = Number(res.headers.get('X-Session-Expires'));
    if (!token || !expires) throw new CloudError('unexpected', 'the unlock answer had no session (check the worker exposes X-Session-* headers)');
    return { body: new Uint8Array(await res.arrayBuffer()), etag: bareEtag(res.headers.get('ETag')), session: { token, expires } };
  }

  /** Re-read the main file with a session (no unlock, so no marker writes). */
  async getMain(session: Session, marker: string, main: string): Promise<{ body: Body; etag: string }> {
    const res = await this.send(`/v1/lib/${marker}/${main}`, { session });
    return { body: new Uint8Array(await res.arrayBuffer()), etag: bareEtag(res.headers.get('ETag')) };
  }

  /** Replace the main file; throws CloudError `conflict` (with `etag`) when it changed since `etag`. */
  async putMain(session: Session, marker: string, main: string, etag: string, body: Body): Promise<string> {
    const out = await this.json<{ etag: string }>(`/v1/lib/${marker}/${main}`, { method: 'PUT', session, etag, body });
    return out.etag;
  }

  async rekey(session: Session, marker: string, main: string, etag: string, next: { main: string; settings: LibrarySettings; body: Body }): Promise<string> {
    const form = new FormData();
    form.append('main', next.main);
    form.append('settings', JSON.stringify(next.settings));
    form.append('body', new Blob([next.body]), 'main');
    const out = await this.json<{ etag: string }>(`/v1/lib/${marker}/${main}/rekey`, { method: 'POST', session, etag, body: form });
    return out.etag;
  }

  async deleteLibrary(session: Session, marker: string, main: string): Promise<void> {
    await this.send(`/v1/lib/${marker}/${main}`, { method: 'DELETE', session });
  }

  async createPlan(session: Session, body: Body): Promise<{ id: string; etag: string }> {
    return this.json('/v1/plans', { method: 'POST', session, body });
  }

  /** The stored plan, or null if it's gone. */
  async getPlan(id: string): Promise<Body | null> {
    try {
      return new Uint8Array(await (await this.send(`/v1/plan/${id}`)).arrayBuffer());
    } catch (err) {
      if (err instanceof CloudError && err.code === 'not_found') return null;
      throw err;
    }
  }

  async putPlan(session: Session, id: string, body: Body): Promise<string> {
    return (await this.json<{ etag: string }>(`/v1/plan/${id}`, { method: 'PUT', session, body })).etag;
  }

  /** Delete a plan; already gone counts as done. */
  async deletePlan(session: Session, id: string): Promise<void> {
    try {
      await this.send(`/v1/plan/${id}`, { method: 'DELETE', session });
    } catch (err) {
      if (!(err instanceof CloudError && err.code === 'not_found')) throw err;
    }
  }

  // ---- Shares ----

  async createShare(session: Session, input: { kind: ShareKind; title: string; body: Body }): Promise<{ id: string; revokeToken: string; expires: number }> {
    const form = new FormData();
    form.append('kind', input.kind);
    form.append('title', input.title);
    form.append('body', new Blob([input.body]), 'share');
    return this.json('/v1/shares', { method: 'POST', session, body: form });
  }

  /** A share's preview, or null when it's gone (expired, revoked, or a one-time link already used). */
  async previewShare(id: string): Promise<SharePreview | null> {
    try {
      return await this.json<SharePreview>(`/v1/share/${id}`);
    } catch (err) {
      if (err instanceof CloudError && err.code === 'not_found') return null;
      throw err;
    }
  }

  /** Import a share (a one-time share is gone afterwards), or null when it's gone. */
  async claimShare(id: string): Promise<Body | null> {
    try {
      return new Uint8Array(await (await this.send(`/v1/share/${id}/claim`, { method: 'POST' })).arrayBuffer());
    } catch (err) {
      if (err instanceof CloudError && err.code === 'not_found') return null;
      throw err;
    }
  }

  async revokeShare(id: string, revokeToken: string): Promise<void> {
    try {
      await this.send(`/v1/share/${id}`, { method: 'DELETE', headers: { 'X-Revoke-Token': revokeToken } });
    } catch (err) {
      if (!(err instanceof CloudError && err.code === 'not_found')) throw err;
    }
  }

  /** Keep the library alive; answers which of `ids` no longer exist. Batches of at most 100. */
  async touch(session: Session, main: string, ids: string[]): Promise<{ missing: string[] }> {
    const missing: string[] = [];
    for (let i = 0; i === 0 || i < ids.length; i += 100) {
      const out = await this.json<{ missing: string[] }>('/v1/touch', { method: 'POST', session, ...CloudApi.jsonBody({ main, ids: ids.slice(i, i + 100) }) });
      missing.push(...out.missing);
    }
    return { missing };
  }
}
