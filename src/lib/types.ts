export type Vote = "up" | "down";
export type CollectionMode = "off" | "optional" | "required";

export interface QuorumConfig {
  title: string;
  welcome?: { cta?: string };
  showRanking: boolean;
  maxRankingPicks: number;
  collectName: CollectionMode;
  collectEmail: CollectionMode;
  showThumbnails: boolean;
  reviewsDir: string;
  hideBranding: boolean;
  unsafeAllowSameOrigin: boolean;
}

export interface ReviewOption {
  id: string;
  filename: string;
  name: string;
  kind: "html" | "image";
  url: string;
  thumbnailUrl: string | null;
}

export interface StorageAdapter {
  createSession(input: { projectToken: string; anonymousId: string; name?: string; email?: string; turnstileToken?: string }): Promise<{ sessionId: string }>;
  saveResponse(input: { sessionId: string; optionId: string; vote?: Vote; note?: string }): Promise<void>;
  saveRanking(input: { sessionId: string; picks: string[]; overallNote?: string }): Promise<void>;
  completeSession(sessionId: string): Promise<void>;
}
