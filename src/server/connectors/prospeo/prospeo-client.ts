import "server-only";

import { z } from "zod";

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

const companyPayloadSchema = z.object({
  error: z.literal(false),
  free: z.boolean().optional().default(false),
  results: z.array(z.object({ company: z.unknown() })),
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

export async function checkProspeoAccount(fetcher?: ProspeoFetcher): Promise<{ account: ProspeoAccount; rateLimit: ProspeoRateLimit }> {
  const response = await prospeoRequest("/account-information", { method: "GET" }, fetcher);
  const parsed = accountPayloadSchema.safeParse(response.payload);
  if (!parsed.success) throw new ProspeoClientError("INVALID_RESPONSE", "Prospeo returned an account response Ano could not verify.");
  return {
    account: {
      plan: parsed.data.response.current_plan,
      remainingCredits: parsed.data.response.remaining_credits,
      usedCredits: parsed.data.response.used_credits,
      renewalDays: parsed.data.response.next_quota_renewal_days,
      renewalDate: parsed.data.response.next_quota_renewal_date,
    },
    rateLimit: response.rateLimit,
  };
}

/** Free canonicalization request. It never calls Prospeo's credit-bearing company search. */
export async function suggestProspeoLocations(location: string, fetcher?: ProspeoFetcher): Promise<ProspeoLocationSuggestion[]> {
  const response = await prospeoRequest("/search-suggestions", { method: "POST", body: JSON.stringify({ location_search: location }) }, fetcher);
  const parsed = locationPayloadSchema.safeParse(response.payload);
  if (!parsed.success) throw new ProspeoClientError("INVALID_RESPONSE", "Prospeo returned location suggestions Ano could not verify.");
  return parsed.data.location_suggestions ?? [];
}

/** This is intentionally the only credit-bearing method in the client. */
export async function searchProspeoCompanies(filters: Record<string, unknown>, fetcher?: ProspeoFetcher): Promise<ProspeoCompanySearch> {
  const response = await prospeoRequest("/search-company", { method: "POST", body: JSON.stringify({ page: 1, filters }) }, fetcher);
  const parsed = companyPayloadSchema.safeParse(response.payload);
  if (!parsed.success) throw new ProspeoClientError("INVALID_RESPONSE", "Prospeo returned company data Ano could not verify.");
  return {
    free: parsed.data.free,
    companies: parsed.data.results.map((item) => normaliseCompany(item.company)).filter((item): item is ProspeoCompany => item !== null).slice(0, 25),
    totalCount: parsed.data.pagination?.total_count,
    rateLimit: response.rateLimit,
  };
}
