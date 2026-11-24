import "server-only";

/**
 * A deliberately narrow contract between Ano's durable research workflow and a
 * search provider. Provider credentials and HTTP remain server-side; neither
 * this contract nor the Bedrock planner exposes an execution capability.
 */
export type ProviderSearchResult = {
  providerResultId: string;
  title: string;
  url: string;
  snippet: string | null;
  score: number | null;
  publishedAt: string | null;
};

export type ProviderSearchResponse = {
  requestId: string | null;
  credits: number | null;
  results: ProviderSearchResult[];
};

/** A source retrieval outcome, stored only as a short Ano-generated excerpt. */
export type ProviderExtractResponse = {
  requestId: string | null;
  credits: number | null;
  results: Array<{
    url: string;
    content: string;
    contentType?: string | null;
    publishedAt?: string | null;
  }>;
  failures: Array<{ url: string; message: string; status?: "failed_safe" | "rejected" }>;
};

export class ResearchProviderError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_CONFIGURED" | "RATE_LIMITED" | "REJECTED" | "UNCERTAIN_OUTCOME" | "INVALID_RESPONSE",
    /** Structural metadata only—never source text, credentials, or headers. */
    public readonly diagnostic: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ResearchProviderError";
  }
}
