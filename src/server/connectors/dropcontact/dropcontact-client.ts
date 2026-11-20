import "server-only";

import { z } from "zod";

import type { DropcontactPreviewPair, DropcontactProviderState } from "@/lib/ano/people-playbooks";

const DROPCONTACT_API = "https://api.dropcontact.io";
const REQUEST_TIMEOUT_MS = 18_000;

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

const batchResponseSchema = z.object({
  error: z.boolean().optional(),
  success: z.boolean().optional(),
  request_id: z.string().optional(),
  credits_left: z.number().optional(),
  reason: z.string().optional(),
  data: z
    .array(
      z
        .object({
          email: z
            .array(
              z.object({
                email: z.string().optional(),
                qualification: z.string().optional(),
              }),
            )
            .optional(),
          phone: z.string().optional(),
          website: z.string().optional(),
          custom_fields: z
            .object({
              ano_contact_id: z.string().optional(),
            })
            .optional(),
        })
        .passthrough(),
    )
    .optional(),
});

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
 * Selective Dropcontact batch submission (`siren`/`enrichment` only for user-approved
 * pairs). Never retries automatically after uncertain/network failures.
 */
export async function verifyContactsWithDropcontact(
  pairs: DropcontactPreviewPair[],
  fetcher: DropcontactFetcher = fetch,
): Promise<DropcontactBatchVerificationResult> {
  if (pairs.length === 0 || pairs.length > 10) {
    throw new DropcontactClientError(
      "INVALID_REQUEST",
      "Dropcontact requires between 1 and 10 selected contacts per verification batch.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetcher(`${DROPCONTACT_API}/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Token": requireDropcontactKey(),
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
          custom_fields: {
            ano_contact_id: pair.contactId,
          },
        })),
      }),
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
    if (!response.ok || !parsed.success || parsed.data.error === true) {
      throw new DropcontactClientError(
        "INVALID_RESPONSE",
        parsed.success && parsed.data.reason
          ? `Dropcontact error: ${parsed.data.reason}`
          : "Dropcontact returned an unusable response. Ano stopped safely without retrying.",
      );
    }

    const rows = parsed.data.data ?? [];
    const results: DropcontactVerifiedContact[] = pairs.map((pair, index) => {
      const matched =
        rows.find((row) => row.custom_fields?.ano_contact_id === pair.contactId) ??
        rows[index];
      const primaryEmail = matched?.email?.find(
        (entry) => typeof entry.email === "string" && entry.email.includes("@"),
      );
      const email = primaryEmail?.email?.trim() || null;
      return {
        contactId: pair.contactId,
        verified: Boolean(email),
        email,
        emailQualification: primaryEmail?.qualification?.trim() || null,
        phone: typeof matched?.phone === "string" && matched.phone.trim() ? matched.phone.trim() : null,
        verifiedDomain:
          typeof matched?.website === "string" && matched.website.trim()
            ? matched.website.trim().replace(/^https?:\/\//i, "").split("/")[0] || null
            : null,
      };
    });

    return {
      requestId: parsed.data.request_id ?? `dc-${Date.now()}`,
      creditsLeft: typeof parsed.data.credits_left === "number" ? parsed.data.credits_left : null,
      results,
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
