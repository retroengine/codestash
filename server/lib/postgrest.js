/**
 * Thin fetch wrapper around a Supabase project's REST (PostgREST), Auth (GoTrue)
 * and Storage APIs. Every service module gets one of these per Supabase project
 * instead of hand-rolling headers at each call site.
 */
class SupabaseClient {
  constructor({ url, anonKey }) {
    this.url = url;
    this.anonKey = anonKey;
  }

  _headers(token, extra = {}) {
    return {
      apikey: this.anonKey,
      Authorization: `Bearer ${token || this.anonKey}`,
      ...extra,
    };
  }

  /** PostgREST call, e.g. rest('/rest/v1/snippets?id=eq.1', { method: 'PATCH', token, body }) */
  async rest(path, { method = 'GET', token, body, prefer } = {}) {
    const headers = this._headers(token, {
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    });
    const res = await fetch(this.url + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res;
  }

  /** GoTrue (auth) call, e.g. auth('/auth/v1/token?grant_type=password', { body }) */
  async auth(path, { method = 'POST', body } = {}) {
    const res = await fetch(this.url + path, {
      method,
      headers: { apikey: this.anonKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res;
  }

  /** Upload a raw buffer to Supabase Storage. */
  async storageUpload(bucket, objectPath, buffer, contentType) {
    const res = await fetch(`${this.url}/storage/v1/object/${bucket}/${objectPath}`, {
      method: 'POST',
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        'Content-Type': contentType || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: buffer,
    });
    return res;
  }

  publicStorageUrl(bucket, objectPath) {
    return `${this.url}/storage/v1/object/public/${bucket}/${objectPath}`;
  }
}

module.exports = { SupabaseClient };
