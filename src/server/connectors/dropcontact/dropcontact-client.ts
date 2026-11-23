import "server-only";

import { z } from "zod";

import type { DropcontactPreviewPair, DropcontactProviderState } from "@/lib/ano/people-playbooks";

const DROPCONTACT_API = "https://api.dropcontact.io";
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 20;

export type DropcontactVerificationOptions = {
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  requestTimeoutMs?: number;
};

export class DropcontactClientError extends Error {
  constructor(
    readonly code:
      | "DROPCONTACT_KEY_UNCONFIGURED"
      | "INVALID_API_KEY"
      | "INSUFFICIENT_CREDITS"
      | "RATE_LIMITED"
      | "INVALID_REQUEST"
      | "TIMEOUT_NO_RETRY"
      | "INVALID_RESPONSE"
      | "NETWORK_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "DropcontactClientError";
  }
}

export type DropcontactVerifiedContact = {
  contactId: string;
  verified: boolean;
  email: string | null;
  emailQualification: string | null;
  phone: string | null;
  verifiedDomain: string | null;
};

export type DropcontactBatchVerificationResult = {
  requestId: string;
  creditsLeft: number | null;
  results: DropcontactVerifiedContact[];
};

type DropcontactFetcher = typeof fetch;

const dropcontactEmailEntrySchema = z
  .object({
    email: z.string().optional(),
    qualification: z.string().optional(),
  })
  .passthrough();

const dropcontactRowSchema = z
  .object({
    email: z.union([z.array(dropcontactEmailEntrySchema), z.string()]).optional(),
    qualification: z.string().optional(),
    phone: z.string().optional(),
    mobile_phone: z.string().optional(),
    website: z.string().optional(),
    custom_fields: z
      .object({
        ano_contact_id: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type DropcontactRow = z.infer<typeof dropcontactRowSchema>;

const batchResponseSchema = z.object({
  error: z.boolean().optional(),
  success: z.boolean().optional(),
  request_id: z.string().optional(),
  credits_left: z.number().optional(),
  reason: z.string().optional(),
  data: z.array(dropcontactRowSchema).optional(),
});

type DropcontactBatchPayload = z.infer<typeof batchResponseSchema>;

const DISQUALIFIED_QUALIFICATION_REGEX = /\b(fail|invalid|not_valid|bounced)\b/i;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isPendingDropcontactResponse(status: number, payload: DropcontactBatchPayload) {
  if (status < 200 || status >= 400) {
    return false;
  }
  const reason = payload.reason?.toLowerCase() ?? "";
  if (
    reason.includes("not ready") ||
    reason.includes("processing") ||
    reason.includes("in progress") ||
    reason.includes("pending")
  ) {
    return true;
  }
  return status === 202 || (!payload.data && payload.error !== true);
}

function rankQualification(qualification: string | null): number {
  if (!qualification) return 0;
  const q = qualification.toLowerCase();
  if (q === "nominative@pro") return 4;
  if (q.includes("nominative")) return 3;
  if (q.includes("catch_all")) return 2;
  if (q.includes("generic")) return 1;
  return 0.5;
}

export function extractBestDropcontactEmail(row?: DropcontactRow): {
  email: string | null;
  emailQualification: string | null;
} {
  if (!row) {
    return { email: null, emailQualification: null };
  }

  const rowQual = row.qualification?.trim() || null;

  if (typeof row.email === "string") {
    if (rowQual && DISQUALIFIED_QUALIFICATION_REGEX.test(rowQual)) {
      return { email: null, emailQualification: null };
    }
    const candidate = row.email
      .split(/[\s,;]+/)
      .map((part) => part.trim())
      .find((part) => part.includes("@"));
    return candidate
      ? { email: candidate, emailQualification: rowQual }
      : { email: null, emailQualification: null };
  }

  if (!Array.isArray(row.email)) {
    return { email: null, emailQualification: null };
  }

  let best: { email: string; qualification: string | null; rank: number } | null = null;
  for (const entry of row.email) {
    if (typeof entry.email !== "string" || !entry.email.includes("@")) continue;
    const candidateEmail = entry.email.trim();
    const qualification = (entry.qualification ?? rowQual)?.trim() || null;
    if (qualification && DISQUALIFIED_QUALIFICATION_REGEX.test(qualification)) {
      continue;
    }
    const rank = rankQualification(qualification);
    if (!best || rank > best.rank) {
      best = { email: candidateEmail, qualification, rank };
    }
  }

  return best
    ? { email: best.email, emailQualification: best.qualification }
    : { email: null, emailQualification: null };
}

async function fetchDropcontactJson(
  url: string,
  init: RequestInit,
  fetcher: DropcontactFetcher,
  requestTimeoutMs: number,
): Promise<{ status: number; ok: boolean; parsed: DropcontactBatchPayload }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetcher(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });

    const payload = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) {
      throw new DropcontactClientError(
        "INVALID_API_KEY",
        "Dropcontact rejected the configured server API token.",
      );
    }
    if (response.status === 402) {
      throw new DropcontactClientError(
        "INSUFFICIENT_CREDITS",
        "Dropcontact reports insufficient credits for this verification batch.",
      );
    }
    if (response.status === 429) {
      throw new DropcontactClientError(
        "RATE_LIMITED",
        "Dropcontact is rate-limiting requests. Ano did not retry automatically.",
      );
    }

    const parsed = batchResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new DropcontactClientError(
        "INVALID_RESPONSE",
        "Dropcontact returned an unusable response. Ano stopped safely without retrying.",
      );
    }

    return {
      status: response.status,
      ok: response.ok,
      parsed: parsed.data,
    };
  } catch (error) {
    if (error instanceof DropcontactClientError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new DropcontactClientError(
        "TIMEOUT_NO_RETRY",
        "Dropcontact verification timed out before confirmation. Ano stopped for manual review without retrying.",
      );
    }
    throw new DropcontactClientError(
      "NETWORK_ERROR",
      "Ano could not reach Dropcontact. No automatic retry was attempted.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function dropcontactConfiguration(): DropcontactProviderState {
  return {
    provider: "dropcontact",
    available: Boolean(process.env.DROPCONTACT_API_KEY?.trim()),
    pricingNote:
      "Selective verification submits only the named people you check (no bulk enrichment). Each verified lookup discloses estimated credits upfront.",
  };
}

function requireDropcontactKey() {
  const key = process.env.DROPCONTACT_API_KEY?.trim();
  if (!key) {
    throw new DropcontactClientError(
      "DROPCONTACT_KEY_UNCONFIGURED",
      "Add DROPCONTACT_API_KEY on the server before verifying contacts with Dropcontact.",
    );
  }
  return key;
}

/**
 * Selective Dropcontact batch submission (`POST /batch`) followed by bounded
 * asynchronous polling (`GET /batch/{request_id}`). Never re-submits `/batch`
 * automatically so credits are never spent twice.
 */
export async function verifyContactsWithDropcontact(
  pairs: DropcontactPreviewPair[],
  fetcher: DropcontactFetcher = fetch,
  options: DropcontactVerificationOptions = {},
): Promise<DropcontactBatchVerificationResult> {
  if (pairs.length === 0 || pairs.length > 10) {
    throw new DropcontactClientError(
      "INVALID_REQUEST",
      "Dropcontact requires between 1 and 10 selected contacts per verification batch.",
    );
  }

  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const apiKey = requireDropcontactKey();

  const postRes = await fetchDropcontactJson(
    `${DROPCONTACT_API}/batch`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Token": apiKey,
      },
      body: JSON.stringify({
        siren: false,
        language: "en",
        data: pairs.map((pair) => ({
          ...(pair.firstName ? { first_name: pair.firstName } : {}),
          ...(pair.lastName ? { last_name: pair.lastName } : {}),
          full_name: pair.fullName,
          company: pair.companyName,
          ...(pair.website ? { website: pair.website } : {}),
          ...(pair.linkedInUrl ? { linkedin: pair.linkedInUrl } : {}),
          custom_fields: {
            ano_contact_id: pair.contactId,
          },
        })),
      }),
    },
    fetcher,
    requestTimeoutMs,
  );

  if (!postRes.ok || postRes.parsed.error === true) {
    throw new DropcontactClientError(
      "INVALID_RESPONSE",
      postRes.parsed.reason
        ? `Dropcontact error: ${postRes.parsed.reason}`
        : "Dropcontact returned an unusable response. Ano stopped safely without retrying.",
    );
  }

  let finalPayload: DropcontactBatchPayload | null =
    Array.isArray(postRes.parsed.data) &&
    (postRes.parsed.data.length > 0 || !postRes.parsed.request_id)
      ? postRes.parsed
      : null;

  const requestId = postRes.parsed.request_id?.trim() || null;

  if (!finalPayload) {
    if (!requestId) {
      throw new DropcontactClientError(
        "INVALID_RESPONSE",
        "Dropcontact did not return batch data or a request_id for polling.",
      );
    }

    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      if (pollIntervalMs > 0) {
        await delay(pollIntervalMs);
      }

      const pollRes = await fetchDropcontactJson(
        `${DROPCONTACT_API}/batch/${encodeURIComponent(requestId)}`,
        {
          method: "GET",
          headers: {
            "X-Access-Token": apiKey,
          },
        },
        fetcher,
        requestTimeoutMs,
      );

      if (isPendingDropcontactResponse(pollRes.status, pollRes.parsed)) {
        continue;
      }

      if (!pollRes.ok || pollRes.parsed.error === true) {
        throw new DropcontactClientError(
          "INVALID_RESPONSE",
          pollRes.parsed.reason
            ? `Dropcontact error: ${pollRes.parsed.reason}`
            : "Dropcontact returned an unusable polling response. Ano stopped safely without retrying.",
        );
      }

      if (Array.isArray(pollRes.parsed.data)) {
        finalPayload = pollRes.parsed;
        break;
      }
    }

    if (!finalPayload) {
      throw new DropcontactClientError(
        "TIMEOUT_NO_RETRY",
        `Dropcontact batch ${requestId} is still processing after polling. No extra credits were spent and Ano did not re-submit the batch.`,
      );
    }
  }

  const rows = finalPayload.data ?? [];
  const results: DropcontactVerifiedContact[] = pairs.map((pair, index) => {
    const matched =
      rows.find((row) => row.custom_fields?.ano_contact_id === pair.contactId) ??
      rows[index];
    const { email, emailQualification } = extractBestDropcontactEmail(matched);
    const phone =
      typeof matched?.phone === "string" && matched.phone.trim()
        ? matched.phone.trim()
        : typeof matched?.mobile_phone === "string" && matched.mobile_phone.trim()
          ? matched.mobile_phone.trim()
          : null;
    return {
      contactId: pair.contactId,
      verified: Boolean(email),
      email,
      emailQualification,
      phone,
      verifiedDomain:
        typeof matched?.website === "string" && matched.website.trim()
          ? matched.website.trim().replace(/^https?:\/\//i, "").split("/")[0] || null
          : null,
    };
  });

  const initialCreditsLeft =
    typeof postRes.parsed.credits_left === "number" ? postRes.parsed.credits_left : null;

  return {
    requestId: finalPayload.request_id ?? requestId ?? `dc-${Date.now()}`,
    creditsLeft:
      typeof finalPayload.credits_left === "number"
        ? finalPayload.credits_left
        : initialCreditsLeft,
    results,
  };
}
