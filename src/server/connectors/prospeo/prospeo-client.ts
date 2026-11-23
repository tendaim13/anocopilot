import "server-only";

import { z } from "zod";

import { recordInternalApiUsage } from "@/server/telemetry/internal-api-usage";

const PROSPEO_API = "https://api.prospeo.io";
const REQUEST_TIMEOUT_MS = 12_000;

export type ProspeoRateLimit = {
  dailyRequestsLeft?: number;
  minuteRequestsLeft?: number;
  dailyResetSeconds?: number;
  minuteResetSeconds?: number;
};

export type ProspeoAccount = {
  plan: string;
  remainingCredits: number;
  usedCredits: number;
  renewalDate?: string;
  renewalDays?: number;
};

export type ProspeoLocationSuggestion = {
  name: string;
  type: "COUNTRY" | "STATE" | "CITY" | "ZONE" | string;
};

export type ProspeoCompany = {
  id: string;
  name: string;
  website?: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  employeeRange?: string;
  location?: {
    country?: string;
    state?: string;
    city?: string;
  };
  description?: string;
  linkedInUrl?: string;
};

export type ProspeoCompanySearch = {
  free: boolean;
  companies: ProspeoCompany[];
  totalCount?: number;
  rateLimit: ProspeoRateLimit;
};

export type ProspeoPerson = {
  id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  seniority?: string;
  department?: string;
  linkedInUrl?: string;
  location?: string;
  companyId?: string;
  companyName?: string;
  companyDomain?: string;
};

export type ProspeoPersonSearch = {
  free: boolean;
  people: ProspeoPerson[];
  totalCount?: number;
  rateLimit: ProspeoRateLimit;
};

export type ProspeoEnrichPersonInput = {
  contactId: string;
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  website?: string | null;
  linkedInUrl?: string | null;
  prospeoPersonId?: string | null;
};

export type ProspeoEnrichPersonResult = {
  contactId: string;
  verified: boolean;
  email: string | null;
  emailStatus: string | null;
  emailQualification: string | null;
  phone: string | null;
  verifiedDomain: string | null;
  freeEnrichment: boolean;
};

export type ProspeoBulkEnrichResponse = {
  creditsCharged: number;
  results: ProspeoEnrichPersonResult[];
  rateLimit: ProspeoRateLimit;
};

export class ProspeoClientError extends Error {
  constructor(
    readonly code: "PROSPEO_KEY_UNCONFIGURED" | "INVALID_API_KEY" | "RATE_LIMITED" | "INSUFFICIENT_CREDITS" | "INVALID_FILTERS" | "PLAN_REQUIRED" | "NO_RESULTS" | "SERVICE_UNAVAILABLE" | "INVALID_RESPONSE" | "NETWORK_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ProspeoClientError";
  }
}

type ProspeoFetcher = typeof fetch;

const errorPayloadSchema = z.object({
  error: z.literal(true).optional(),
  error_code: z.string().optional(),
}).passthrough();

const accountPayloadSchema = z.object({
  error: z.literal(false),
  response: z.object({
    current_plan: z.string(),
    remaining_credits: z.number(),
    used_credits: z.number(),
    next_quota_renewal_days: z.number().optional(),
    next_quota_renewal_date: z.string().optional(),
  }),
});

const locationPayloadSchema = z.object({
  error: z.literal(false),
  location_suggestions: z.array(z.object({ name: z.string(), type: z.string() })).nullable(),
});

const industryPayloadSchema = z.object({
  error: z.literal(false),
  industry_suggestions: z.array(z.string()).nullable(),
});

const jobTitlePayloadSchema = z.object({
  error: z.literal(false),
  job_title_suggestions: z.array(z.string()).nullable(),
});

const companyPayloadSchema = z.object({
  error: z.literal(false),
  free: z.boolean().optional().default(false),
  results: z.array(z.object({ company: z.unknown() })),
  pagination: z.object({ total_count: z.number().optional() }).optional(),
});

const personPayloadSchema = z.object({
  error: z.literal(false),
  free: z.boolean().optional().default(false),
  results: z.array(
    z.object({
      person: z.unknown().optional(),
      company: z.unknown().optional(),
    }).passthrough(),
  ),
  pagination: z.object({ total_count: z.number().optional() }).optional(),
});

function requireProspeoKey() {
  const key = process.env.PROSPEO_KEY?.trim();
  if (!key) throw new ProspeoClientError("PROSPEO_KEY_UNCONFIGURED", "Ano’s server does not have a Prospeo key configured.");
  return key;
}

function numberHeader(headers: Headers, key: string) {
  const value = headers.get(key);
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function rateLimit(headers: Headers): ProspeoRateLimit {
  return {
    dailyRequestsLeft: numberHeader(headers, "x-daily-request-left"),
    minuteRequestsLeft: numberHeader(headers, "x-minute-request-left"),
    dailyResetSeconds: numberHeader(headers, "x-daily-reset-seconds"),
    minuteResetSeconds: numberHeader(headers, "x-minute-reset-seconds"),
  };
}

function errorFrom(status: number, payload: unknown) {
  const parsed = errorPayloadSchema.safeParse(payload);
  const code = parsed.success ? parsed.data.error_code : undefined;
  if (status === 429) return new ProspeoClientError("RATE_LIMITED", "Prospeo is rate-limiting this request. Ano did not retry it.");
  if (code === "INVALID_API_KEY") return new ProspeoClientError("INVALID_API_KEY", "Prospeo rejected the configured key.");
  if (code === "INSUFFICIENT_CREDITS") return new ProspeoClientError("INSUFFICIENT_CREDITS", "Prospeo reports that this workspace does not have enough credits for this search.");
  if (code === "INVALID_FILTERS") return new ProspeoClientError("INVALID_FILTERS", "Prospeo rejected Ano’s search filters. No automatic retry was attempted.");
  if (code === "PLAN_REQUIRED") return new ProspeoClientError("PLAN_REQUIRED", "The proposed Prospeo filter requires a different plan. No automatic retry was attempted.");
  if (code === "NO_RESULTS") return new ProspeoClientError("NO_RESULTS", "Prospeo found no companies for this approved search.");
  if (code === "SERVICE_TEMPORARILY_UNAVAILABLE" || code === "INTERNAL_ERROR") return new ProspeoClientError("SERVICE_UNAVAILABLE", "Prospeo could not complete this request. Ano marked it for review instead of retrying it.");
  return new ProspeoClientError("INVALID_RESPONSE", "Prospeo returned a response Ano could not safely use.");
}

async function prospeoRequest(path: string, init: RequestInit, fetcher: ProspeoFetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(`${PROSPEO_API}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-KEY": requireProspeoKey(),
        ...init.headers,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || (typeof payload === "object" && payload !== null && "error" in payload && (payload as { error?: unknown }).error === true)) {
      throw errorFrom(response.status, payload);
    }
    return { payload, rateLimit: rateLimit(response.headers) };
  } catch (error) {
    if (error instanceof ProspeoClientError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new ProspeoClientError("NETWORK_ERROR", "Prospeo did not respond before Ano’s safe timeout.");
    throw new ProspeoClientError("NETWORK_ERROR", "Ano could not reach Prospeo. No automatic retry was attempted.");
  } finally {
    clearTimeout(timer);
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normaliseCompany(value: unknown): ProspeoCompany | null {
  if (!value || typeof value !== "object") return null;
  const company = value as Record<string, unknown>;
  const id = optionalString(company.company_id);
  const name = optionalString(company.name);
  if (!id || !name) return null;
  const rawLocation = company.location && typeof company.location === "object" ? company.location as Record<string, unknown> : {};
  return {
    id,
    name,
    website: optionalString(company.website),
    domain: optionalString(company.domain),
    industry: optionalString(company.industry),
    employeeCount: optionalNumber(company.employee_count),
    employeeRange: optionalString(company.employee_range),
    location: {
      country: optionalString(rawLocation.country),
      state: optionalString(rawLocation.state),
      city: optionalString(rawLocation.city),
    },
    description: optionalString(company.description_ai) ?? optionalString(company.description_seo) ?? optionalString(company.description),
    linkedInUrl: optionalString(company.linkedin_url),
  };
}

function recordProspeoCallError(
  operation: string,
  endpoint: string,
  startedAt: number,
  error: unknown,
  metadata?: Record<string, unknown>,
) {
  const code = error instanceof ProspeoClientError ? error.code : "NETWORK_ERROR";
  recordInternalApiUsage({
    provider: "prospeo",
    operation,
    modelOrEndpoint: endpoint,
    status: code === "RATE_LIMITED" ? "rate_limited" : "error",
    creditsUsed: 0,
    durationMs: Date.now() - startedAt,
    metadata: { ...metadata, errorCode: code },
  });
}

export async function checkProspeoAccount(fetcher?: ProspeoFetcher): Promise<{ account: ProspeoAccount; rateLimit: ProspeoRateLimit }> {
  const startedAt = Date.now();
  try {
    const response = await prospeoRequest("/account-information", { method: "GET" }, fetcher);
    const parsed = accountPayloadSchema.safeParse(response.payload);
    if (!parsed.success) throw new ProspeoClientError("INVALID_RESPONSE", "Prospeo returned an account response Ano could not verify.");
    const account: ProspeoAccount = {
      plan: parsed.data.response.current_plan,
      remainingCredits: parsed.data.response.remaining_credits,
      usedCredits: parsed.data.response.used_credits,
      renewalDays: parsed.data.response.next_quota_renewal_days,
      renewalDate: parsed.data.response.next_quota_renewal_date,
    };
    recordInternalApiUsage({
      provider: "prospeo",
      operation: "account_information",
      modelOrEndpoint: "/account-information",
      status: "success",
      httpStatus: 200,
      creditsUsed: 0,
      creditsRemaining: account.remainingCredits,
      durationMs: Date.now() - startedAt,
      metadata: { plan: account.plan },
    });
    return {
      account,
      rateLimit: response.rateLimit,
    };
  } catch (error) {
    recordProspeoCallError("account_information", "/account-information", startedAt, error);
    throw error;
  }
}

/** Free canonicalization request. It never calls Prospeo's credit-bearing company search. */
export async function suggestProspeoLocations(location: string, fetcher?: ProspeoFetcher): Promise<ProspeoLocationSuggestion[]> {
  const startedAt = Date.now();
  try {
    const response = await prospeoRequest("/search-suggestions", { method: "POST", body: JSON.stringify({ location_search: location }) }, fetcher);
    const parsed = locationPayloadSchema.safeParse(response.payload);
    if (!parsed.success) throw new ProspeoClientError("INVALID_RESPONSE", "Prospeo returned location suggestions Ano could not verify.");
    const suggestions = parsed.data.location_suggestions ?? [];
    recordInternalApiUsage({
      provider: "prospeo",
      operation: "suggest_locations",
      modelOrEndpoint: "/search-suggestions",
      status: "success",
      httpStatus: 200,
      creditsUsed: 0,
      durationMs: Date.now() - startedAt,
      metadata: { suggestionCount: suggestions.length },
    });
    return suggestions;
  } catch (error) {
    recordProspeoCallError("suggest_locations", "/search-suggestions", startedAt, error);
    throw error;
  }
}

/** Free industry canonicalization request against Prospeo's controlled industry taxonomy. */
export async function suggestProspeoIndustries(industry: string, fetcher?: ProspeoFetcher): Promise<string[]> {
  const startedAt = Date.now();
  try {
    const response = await prospeoRequest("/search-suggestions", { method: "POST", body: JSON.stringify({ industry_search: industry }) }, fetcher);
    const parsed = industryPayloadSchema.safeParse(response.payload);
    if (!parsed.success) throw new ProspeoClientError("INVALID_RESPONSE", "Prospeo returned industry suggestions Ano could not verify.");
    const suggestions = parsed.data.industry_suggestions ?? [];
    recordInternalApiUsage({
      provider: "prospeo",
      operation: "suggest_industries",
      modelOrEndpoint: "/search-suggestions",
      status: "success",
      httpStatus: 200,
      creditsUsed: 0,
      durationMs: Date.now() - startedAt,
      metadata: { suggestionCount: suggestions.length },
    });
    return suggestions;
  } catch (error) {
    recordProspeoCallError("suggest_industries", "/search-suggestions", startedAt, error);
    throw error;
  }
}

/** Free job-title canonicalization request ($0 credits) via Prospeo Search Suggestions API. */
export async function suggestProspeoJobTitles(query: string, fetcher?: ProspeoFetcher): Promise<string[]> {
  const startedAt = Date.now();
  try {
    const response = await prospeoRequest("/search-suggestions", { method: "POST", body: JSON.stringify({ job_title_search: query }) }, fetcher);
    const parsed = jobTitlePayloadSchema.safeParse(response.payload);
    if (!parsed.success) throw new ProspeoClientError("INVALID_RESPONSE", "Prospeo returned job-title suggestions Ano could not verify.");
    const suggestions = parsed.data.job_title_suggestions ?? [];
    recordInternalApiUsage({
      provider: "prospeo",
      operation: "suggest_job_titles",
      modelOrEndpoint: "/search-suggestions",
      status: "success",
      httpStatus: 200,
      creditsUsed: 0,
      durationMs: Date.now() - startedAt,
      metadata: { suggestionCount: suggestions.length },
    });
    return suggestions;
  } catch (error) {
    recordProspeoCallError("suggest_job_titles", "/search-suggestions", startedAt, error);
    throw error;
  }
}

/** This is intentionally bounded to page 1 (25 companies max). */
export async function searchProspeoCompanies(filters: Record<string, unknown>, fetcher?: ProspeoFetcher): Promise<ProspeoCompanySearch> {
  const startedAt = Date.now();
  try {
    const response = await prospeoRequest("/search-company", { method: "POST", body: JSON.stringify({ page: 1, filters }) }, fetcher);
    const parsed = companyPayloadSchema.safeParse(response.payload);
    if (!parsed.success) throw new ProspeoClientError("INVALID_RESPONSE", "Prospeo returned company data Ano could not verify.");
    const companies = parsed.data.results.map((item) => normaliseCompany(item.company)).filter((item): item is ProspeoCompany => item !== null).slice(0, 25);
    recordInternalApiUsage({
      provider: "prospeo",
      operation: "search_company",
      modelOrEndpoint: "/search-company",
      status: "success",
      httpStatus: 200,
      creditsUsed: parsed.data.free ? 0 : 1,
      durationMs: Date.now() - startedAt,
      metadata: { companyCount: companies.length, free: parsed.data.free },
    });
    return {
      free: parsed.data.free,
      companies,
      totalCount: parsed.data.pagination?.total_count,
      rateLimit: response.rateLimit,
    };
  } catch (error) {
    recordProspeoCallError("search_company", "/search-company", startedAt, error);
    throw error;
  }
}

function normalisePerson(entry: { person?: unknown; company?: unknown } & Record<string, unknown>): ProspeoPerson | null {
  const rawPerson =
    entry.person && typeof entry.person === "object"
      ? (entry.person as Record<string, unknown>)
      : entry;
  const rawCompany =
    entry.company && typeof entry.company === "object"
      ? (entry.company as Record<string, unknown>)
      : {};

  const firstName = optionalString(rawPerson.first_name);
  const lastName = optionalString(rawPerson.last_name);
  const fullName =
    optionalString(rawPerson.full_name) ??
    optionalString(rawPerson.name) ??
    ([firstName, lastName].filter(Boolean).join(" ").trim() || undefined);
  const id =
    optionalString(rawPerson.person_id) ??
    optionalString(rawPerson.id) ??
    optionalString(rawPerson.linkedin_url);

  if (!id || !fullName) return null;

  const rawLocation =
    rawPerson.location && typeof rawPerson.location === "object"
      ? (rawPerson.location as Record<string, unknown>)
      : {};
  const locationText =
    optionalString(rawPerson.location_text) ??
    ([optionalString(rawLocation.city), optionalString(rawLocation.state), optionalString(rawLocation.country)]
      .filter(Boolean)
      .join(", ") || undefined);

  return {
    id,
    fullName,
    firstName,
    lastName,
    title: optionalString(rawPerson.current_job_title) ?? optionalString(rawPerson.title) ?? optionalString(rawPerson.job_title),
    seniority: optionalString(rawPerson.seniority),
    department: optionalString(rawPerson.department),
    linkedInUrl: optionalString(rawPerson.linkedin_url),
    location: locationText,
    companyId: optionalString(rawCompany.company_id) ?? optionalString(rawPerson.company_id),
    companyName: optionalString(rawCompany.name) ?? optionalString(rawPerson.company_name),
    companyDomain: optionalString(rawCompany.domain) ?? optionalString(rawPerson.company_domain),
  };
}

/**
 * Bounded 1-page (25-person max) named-person discovery for shortlisted companies.
 * Never returns or fabricates verified contact emails or phone numbers.
 */
export async function searchProspeoPeople(
  filters: Record<string, unknown>,
  fetcher?: ProspeoFetcher,
): Promise<ProspeoPersonSearch> {
  const startedAt = Date.now();
  try {
    const response = await prospeoRequest(
      "/search-person",
      { method: "POST", body: JSON.stringify({ page: 1, filters }) },
      fetcher,
    );
    const parsed = personPayloadSchema.safeParse(response.payload);
    if (!parsed.success) {
      throw new ProspeoClientError("INVALID_RESPONSE", "Prospeo returned person data Ano could not verify.");
    }
    const people = parsed.data.results
      .map((item) => normalisePerson(item))
      .filter((item): item is ProspeoPerson => item !== null)
      .slice(0, 25);
    recordInternalApiUsage({
      provider: "prospeo",
      operation: "search_person",
      modelOrEndpoint: "/search-person",
      status: "success",
      httpStatus: 200,
      creditsUsed: parsed.data.free ? 0 : 1,
      durationMs: Date.now() - startedAt,
      metadata: { peopleCount: people.length, free: parsed.data.free },
    });
    return {
      free: parsed.data.free,
      people,
      totalCount: parsed.data.pagination?.total_count,
      rateLimit: response.rateLimit,
    };
  } catch (error) {
    recordProspeoCallError("search_person", "/search-person", startedAt, error);
    throw error;
  }
}

function cleanWebsiteHost(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const u = /^https?:\/\//i.test(raw.trim()) ? new URL(raw.trim()) : new URL(`https://${raw.trim()}`);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * Selective 1-batch (max 10 contacts) Prospeo `/bulk-enrich-person` call.
 * Requests verified emails only (`only_verified_email: true`, `enrich_mobile: false`),
 * costing 1 credit per found email and 0 credits on misses or 90-day repeats.
 */
export async function enrichProspeoPeople(
  pairs: ProspeoEnrichPersonInput[],
  fetcher?: ProspeoFetcher,
): Promise<ProspeoBulkEnrichResponse> {
  if (pairs.length === 0 || pairs.length > 10) {
    throw new ProspeoClientError(
      "INVALID_FILTERS",
      "Select between 1 and 10 contacts per selective Prospeo enrichment batch.",
    );
  }

  const data = pairs.map((pair) => {
    const companyWebsite = cleanWebsiteHost(pair.website);
    return {
      identifier: pair.contactId,
      ...(pair.prospeoPersonId ? { person_id: pair.prospeoPersonId } : {}),
      ...(pair.firstName ? { first_name: pair.firstName } : {}),
      ...(pair.lastName ? { last_name: pair.lastName } : {}),
      ...(!pair.firstName && !pair.lastName ? { full_name: pair.fullName } : {}),
      ...(companyWebsite ? { company_website: companyWebsite } : {}),
      ...(pair.companyName ? { company_name: pair.companyName } : {}),
      ...(pair.linkedInUrl ? { linkedin_url: pair.linkedInUrl } : {}),
    };
  });

  const startedAt = Date.now();
  let rawPayload: unknown;
  let headersRateLimit: ProspeoRateLimit = {};
  try {
    const response = await prospeoRequest(
      "/bulk-enrich-person",
      {
        method: "POST",
        body: JSON.stringify({
          only_verified_email: true,
          enrich_mobile: false,
          data,
        }),
      },
      fetcher,
    );
    rawPayload = response.payload;
    headersRateLimit = response.rateLimit;
  } catch (error) {
    if (error instanceof ProspeoClientError && error.code === "NO_RESULTS") {
      recordInternalApiUsage({
        provider: "prospeo",
        operation: "bulk_enrich_person",
        modelOrEndpoint: "/bulk-enrich-person",
        status: "success",
        httpStatus: 200,
        creditsUsed: 0,
        durationMs: Date.now() - startedAt,
        metadata: { batchSize: pairs.length, matchedCount: 0, noResults: true },
      });
      return {
        creditsCharged: 0,
        rateLimit: headersRateLimit,
        results: pairs.map((pair) => ({
          contactId: pair.contactId,
          verified: false,
          email: null,
          emailStatus: "NO_RESULTS",
          emailQualification: null,
          phone: null,
          verifiedDomain: null,
          freeEnrichment: true,
        })),
      };
    }
    recordProspeoCallError("bulk_enrich_person", "/bulk-enrich-person", startedAt, error, {
      batchSize: pairs.length,
    });
    throw error;
  }

  const payloadObj =
    rawPayload && typeof rawPayload === "object" ? (rawPayload as Record<string, unknown>) : {};
  const matchedList = Array.isArray(payloadObj.matched)
    ? payloadObj.matched
    : Array.isArray(payloadObj.results)
      ? payloadObj.results
      : [];

  const matchedById = new Map<string, ProspeoEnrichPersonResult>();
  let creditsCharged = 0;

  for (const item of matchedList) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const identifier =
      optionalString(entry.identifier) ??
      optionalString((entry.data as Record<string, unknown> | undefined)?.identifier);
    if (!identifier) continue;

    const person =
      entry.person && typeof entry.person === "object"
        ? (entry.person as Record<string, unknown>)
        : entry;
    const company =
      entry.company && typeof entry.company === "object"
        ? (entry.company as Record<string, unknown>)
        : {};
    const emailObj =
      person.email && typeof person.email === "object"
        ? (person.email as Record<string, unknown>)
        : {};
    const mobileObj =
      person.mobile && typeof person.mobile === "object"
        ? (person.mobile as Record<string, unknown>)
        : {};

    const email =
      optionalString(emailObj.email) ??
      (typeof person.email === "string" ? optionalString(person.email) : undefined) ??
      null;
    const emailStatus = optionalString(emailObj.status) ?? null;
    const verificationMethod = optionalString(emailObj.verification_method) ?? null;
    const freeEnrichment = entry.free_enrichment === true;
    const verified =
      Boolean(email) && (!emailStatus || /^(verified|valid)$/i.test(emailStatus));
    const domain =
      optionalString(company.domain) ??
      (email && email.includes("@") ? email.split("@")[1] : undefined) ??
      null;
    const phone = optionalString(mobileObj.mobile) ?? null;

    if (verified && email && !freeEnrichment) {
      creditsCharged += 1;
    }

    matchedById.set(identifier, {
      contactId: identifier,
      verified,
      email: email ? email.toLowerCase() : null,
      emailStatus,
      emailQualification: verificationMethod
        ? `${emailStatus ?? "VERIFIED"} (${verificationMethod})`
        : emailStatus,
      phone,
      verifiedDomain: domain,
      freeEnrichment,
    });
  }

  const results = pairs.map(
    (pair) =>
      matchedById.get(pair.contactId) ?? {
        contactId: pair.contactId,
        verified: false,
        email: null,
        emailStatus: "NOT_MATCHED",
        emailQualification: null,
        phone: null,
        verifiedDomain: null,
        freeEnrichment: true,
      },
  );
  const matchedCount = results.filter((item) => item.verified).length;
  recordInternalApiUsage({
    provider: "prospeo",
    operation: "bulk_enrich_person",
    modelOrEndpoint: "/bulk-enrich-person",
    status: "success",
    httpStatus: 200,
    creditsUsed: creditsCharged,
    durationMs: Date.now() - startedAt,
    metadata: { batchSize: pairs.length, matchedCount },
  });

  return {
    creditsCharged,
    rateLimit: headersRateLimit,
    results,
  };
}
