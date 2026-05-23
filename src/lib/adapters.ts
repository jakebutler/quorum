import type { StorageAdapter } from "./types";
import { localAdapterBase } from "./env";

const apiBase = "https://quorum.corvolabs.com";

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export class CorvoCloudAdapter implements StorageAdapter {
  async createSession(input: { projectToken: string; anonymousId: string; name?: string; email?: string; turnstileToken?: string }) {
    return post<{ sessionId: string }>("/api/sessions", input);
  }
  async saveResponse(input: { sessionId: string; optionId: string; vote?: "up" | "down"; note?: string }) {
    await post("/api/responses", input);
  }
  async saveRanking(input: { sessionId: string; picks: string[]; overallNote?: string }) {
    await post("/api/rankings", input);
  }
  async completeSession(sessionId: string) {
    await post("/api/complete", { sessionId });
  }
}

export class LocalSqliteAdapter implements StorageAdapter {
  async createSession(input: { projectToken: string; anonymousId: string; name?: string; email?: string; turnstileToken?: string }) {
    return localPost<{ sessionId: string }>("/api/sessions", input);
  }
  async saveResponse(input: { sessionId: string; optionId: string; vote?: "up" | "down"; note?: string }) {
    await localPost("/api/responses", input);
  }
  async saveRanking(input: { sessionId: string; picks: string[]; overallNote?: string }) {
    await localPost("/api/rankings", input);
  }
  async completeSession(sessionId: string) {
    await localPost("/api/complete", { sessionId });
  }
}

async function localPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${localAdapterBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Local SQLite request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}
