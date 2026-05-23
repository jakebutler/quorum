import type { StorageAdapter } from "./types";

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
  async createSession(input: { projectToken: string; anonymousId: string; name?: string; email?: string }) {
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

export class LocalBrowserAdapter implements StorageAdapter {
  async createSession(input: { projectToken: string; anonymousId: string; name?: string; email?: string }) {
    const sessionId = `local_${crypto.randomUUID()}`;
    const sessions = JSON.parse(localStorage.getItem("quorum_local_sessions") || "[]");
    sessions.push({ id: sessionId, ...input, startedAt: Date.now() });
    localStorage.setItem("quorum_local_sessions", JSON.stringify(sessions));
    return { sessionId };
  }
  async saveResponse(input: { sessionId: string; optionId: string; vote?: "up" | "down"; note?: string }) {
    upsert("quorum_local_responses", (row) => row.sessionId === input.sessionId && row.optionId === input.optionId, { ...input, updatedAt: Date.now() });
  }
  async saveRanking(input: { sessionId: string; picks: string[]; overallNote?: string }) {
    upsert("quorum_local_rankings", (row) => row.sessionId === input.sessionId, { ...input, updatedAt: Date.now() });
  }
  async completeSession(sessionId: string) {
    upsert("quorum_local_completions", (row) => row.sessionId === sessionId, { sessionId, completedAt: Date.now() });
  }
}

function upsert(key: string, match: (row: any) => boolean, row: unknown) {
  const rows = JSON.parse(localStorage.getItem(key) || "[]");
  const index = rows.findIndex(match);
  if (index >= 0) rows[index] = { ...rows[index], ...row };
  else rows.push(row);
  localStorage.setItem(key, JSON.stringify(rows));
}
