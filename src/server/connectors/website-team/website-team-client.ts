import "server-only";

import { createHash } from "node:crypto";
import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { load } from "cheerio";

import type { AccountCandidateDossier } from "@/lib/ano/company-discovery";
import type { BuyingCommitteeCriteria } from "@/lib/ano/people-playbooks";
import type { InvokableChatModel, LlmPlannerConfig } from "@/server/agents/bedrock-contracts";
import { createPlannerChatModel } from "@/server/agents/ollama-chat-model";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const MAX_COMPANIES_PER_RUN = 10;
const MAX_PAGES_PER_COMPANY = 3;
const MAX_TOTAL_PAGES_PER_RUN = 20;
const MAX_PEOPLE_PER_COMPANY = 4;
const MAX_TOTAL_PEOPLE = 25;
const MAX_LLM_FALLBACK_COMPANIES = 5;
const USER_AGENT = "AnoCopilot/1.0 (+https://anocopilot.local)";

type LookupAddress = { address: string; family: number };
type Lookup = (hostname: string) => Promise<LookupAddress[]>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type WebsiteTeamLlmFallback = (input: {
  companyName: string;
  pages: Array<{ url: string; text: string }>;
  criteria?: BuyingCommitteeCriteria;
}) => Promise<Array<{ fullName: string; title: string; sourceUrl?: string }>>;

export type WebsiteTeamPerson = {
  id: string;
  accountId: string;
  accountName: string;
  accountDomain?: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  title: string;
  seniority?: string;
  department?: string;
  linkedInUrl?: string;
  publicEmail?: string;
  publicEmailKind?: "direct_public" | "shared_inbox";
  publicPhone?: string;
  sourceUrl: string;
  location?: string;
  score: number;
};

export type WebsiteTeamCompanyReport = {
  accountId: string;
  accountName: string;
  website: string;
  pagesFetched: number;
  peopleFound: number;
  note?: string;
};

export type WebsiteTeamDiscoveryResult = {
  people: WebsiteTeamPerson[];
  pagesScanned: number;
  companiesScanned: number;
  companyReports: WebsiteTeamCompanyReport[];
};

const TEAM_LINK_REGEX =
  /\b(about|about[- ]us|company|our[- ]company|our[- ]story|team|our[- ]team|leadership|executives|management|people|staff|founders|board|who[- ]we[- ]are|meet[- ]the|partners|directors|attorneys|lawyers|solicitors|advisors|consultants|agents|brokers|architects|engineers|faculty|doctors|dentists|clinicians|practitioners|specialists|contact)\b/i;

const ROLE_PATTERN =
  /\b(chief\s+[a-z]+(?:\s+officer)?|ceo|coo|cto|cfo|cmo|cio|chro|cro|cpo|cso|evp|svp|co-founder|founder|owner|proprietor|president|vice\s+president|vp(?:\s+of)?(?:\s+[a-z\s&]+)?|general\s+counsel|managing\s+director|managing\s+partner|senior\s+partner|partner|principal(?:\s+(?:dentist|architect|engineer|consultant|partner))?|controller|treasurer|head\s+of\s+[a-z\s&]+|plant\s+manager|site\s+manager|store\s+manager|branch\s+manager|regional\s+manager|country\s+manager|account\s+director|creative\s+director|art\s+director|technical\s+director|engineering\s+manager|product\s+manager|project\s+director|supply\s+chain\s+manager|clinical\s+director|medical\s+director|clinic\s+director|practice\s+manager|clinic\s+manager|operations\s+manager|general\s+manager|office\s+manager|superintendent|director(?:\s+of\s+[a-z\s&]+)?|attorney|solicitor|advocate|broker|executive\s+chef|dean|headmaster|lead\s+dentist|senior\s+dentist|orthodontist|endodontist|periodontist|prosthodontist|implantologist|dentist|surgeon|physician|manager)\b/i;

const BOILERPLATE_NAME_REGEX =
  /\b(contact\s+us|book\s+now|book\s+appointment|opening\s+hours|privacy\s+policy|terms\s+of|our\s+services|our\s+clinic|our\s+team|read\s+more|learn\s+more|get\s+in\s+touch|meet\s+the\s+team|dental\s+clinic|dental\s+care|medical\s+centre|medical\s+center|copyright|all\s+rights|follow\s+us|home\s+page|case\s+studies|our\s+work|latest\s+news|blog\s+post|sign\s+up|log\s+in|free\s+trial|request\s+demo|get\s+started)\b/i;

const HONORIFIC_PREFIX = /^(?:dr\.?|prof\.?|dato'?|datuk(?:\s+seri)?|tan\s+sri|mr\.?|mrs\.?|ms\.?)\s+/i;

function isUnsafeIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true;
  }
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}

function isUnsafeIpv6(address: string) {
  const lower = address.toLowerCase();
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("::ffff:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80:") ||
    lower.startsWith("2001:db8:")
  );
}

function canonicalSafeUrl(raw: string): URL {
  const withScheme = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Non-HTTP website scheme rejected.");
  }
  if (url.username || url.password || !url.hostname || isIP(url.hostname)) {
    throw new Error("Unsafe IP or credential URL rejected.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Local/internal host rejected.");
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (port !== "80" && port !== "443") {
    throw new Error("Non-standard port rejected.");
  }
  url.hash = "";
  return url;
}

async function assertPublicHost(url: URL, lookup: Lookup) {
  const addresses = await lookup(url.hostname);
  if (
    !addresses.length ||
    addresses.some((item) =>
      item.family === 4 ? isUnsafeIpv4(item.address) : item.family === 6 ? isUnsafeIpv6(item.address) : true,
    )
  ) {
    throw new Error(`Host ${url.hostname} resolved to a non-public address.`);
  }
}

async function readHtmlWithinLimit(response: Response, maxBytes: number) {
  const headerLen = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(headerLen) && headerLen > maxBytes) {
    return null;
  }
  if (!response.body) {
    return await response.text().catch(() => null);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function fetchSafeHtml(
  rawUrl: string,
  fetcher: FetchLike,
  lookup: Lookup,
): Promise<{ finalUrl: string; html: string } | null> {
  let current = canonicalSafeUrl(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicHost(current, lookup);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetcher(current, {
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
          "User-Agent": USER_AGENT,
        },
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get("location");
      if (!loc || redirectCount === MAX_REDIRECTS) return null;
      current = canonicalSafeUrl(new URL(loc, current).toString());
      continue;
    }

    if (!response.ok) return null;
    const contentType =
      response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (contentType && !contentType.includes("html") && contentType !== "text/plain") {
      return null;
    }

    const html = await readHtmlWithinLimit(response, MAX_RESPONSE_BYTES);
    if (!html) return null;
    return { finalUrl: current.toString(), html };
  }

  return null;
}

export function extractTeamPageLinks(html: string, baseUrl: string): string[] {
  const $ = load(html);
  const base = new URL(baseUrl);
  const scored = new Map<string, number>();

  $("a[href]").each((_idx, el) => {
    const href = $(el).attr("href")?.trim();
    if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) {
      return;
    }
    let resolved: URL;
    try {
      resolved = canonicalSafeUrl(new URL(href, base).toString());
    } catch {
      return;
    }
    const baseRoot = base.hostname.replace(/^www\./i, "").toLowerCase();
    const linkRoot = resolved.hostname.replace(/^www\./i, "").toLowerCase();
    if (baseRoot !== linkRoot) return;
    if (resolved.pathname === "/" && !resolved.search) return;
    if (/\.(pdf|jpg|jpeg|png|webp|svg|gif|zip|mp4)$/i.test(resolved.pathname)) return;

    const label = $(el).text().replace(/\s+/g, " ").trim();
    const combined = `${resolved.pathname} ${label}`;
    if (!TEAM_LINK_REGEX.test(combined)) return;

    let priority = 1;
    if (
      /\b(team|our-team|leadership|executives|management|founders|board|partners|directors|attorneys|lawyers|doctors|dentists|meet)\b/i.test(
        combined,
      )
    ) {
      priority = 3;
    } else if (
      /\b(about|about-us|company|our-company|who-we-are|people|staff|advisors|consultants|practitioners|agents|brokers|architects|engineers|faculty|specialists)\b/i.test(
        combined,
      )
    ) {
      priority = 2;
    }
    const clean = resolved.toString();
    if (clean === base.toString()) return;
    scored.set(clean, Math.max(scored.get(clean) ?? 0, priority));
  });

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PAGES_PER_COMPANY - 1)
    .map(([url]) => url);
}

function splitName(fullName: string) {
  const stripped = fullName.replace(HONORIFIC_PREFIX, "").trim();
  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: undefined, lastName: undefined };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: undefined };
  return {
    firstName: tokens[0],
    lastName: tokens.slice(1).join(" "),
  };
}

function cleanPersonName(raw: string, companyName: string): string | null {
  const normalized = raw.replace(/\s+/g, " ").replace(/^[•\-–|:\s]+|[•\-–|:\s]+$/g, "").trim();
  if (!normalized || normalized.length < 4 || normalized.length > 60) return null;
  if (/[0-9@#$%^&*()_=+[\]{}<>/?\\]/.test(normalized)) return null;
  if (BOILERPLATE_NAME_REGEX.test(normalized)) return null;
  if (normalized.toLowerCase() === companyName.trim().toLowerCase()) return null;

  const withoutHonorific = normalized.replace(HONORIFIC_PREFIX, "").trim();
  const words = withoutHonorific.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return null;

  const looksCapitalized = words.every((w) => /^[A-Z][a-zA-Z'’-]*$|^(bin|binti|al|van|de|der|da)$/i.test(w));
  if (!looksCapitalized) return null;

  return normalized;
}

function inferSeniorityAndDepartment(
  title: string,
  criteria?: BuyingCommitteeCriteria,
): { seniority?: string; department?: string } {
  const lower = title.toLowerCase();
  const seniority =
    /\b(founder|co-founder|owner|proprietor)\b/.test(lower)
      ? "Founder/Owner"
      : /\b(ceo|coo|cto|cfo|cmo|cio|chro|cro|cpo|cso|chief)\b/.test(lower)
        ? "C-Suite"
        : /\b(managing partner|senior partner|partner)\b/.test(lower)
          ? "Partner"
          : /\b(vice president|vp|evp|svp)\b/.test(lower)
            ? "Vice President"
            : /\b(head of|lead)\b/.test(lower)
              ? "Head"
              : /\b(director|principal|general counsel|superintendent|dean|headmaster)\b/.test(lower)
                ? "Director"
                : /\b(manager|controller|treasurer)\b/.test(lower)
                  ? "Manager"
                  : undefined;

  const department =
    /\b(dentist|ortho|endo|perio|prostho|implant|clinical|medical|doctor|surgeon|physician|clinic|health)\b/.test(lower)
      ? "Medical & Health"
      : /\b(legal|general counsel|counsel|attorney|lawyer|solicitor|advocate|compliance)\b/.test(lower)
        ? "Legal"
        : /\b(product|cpo|ux )\b/.test(lower)
          ? "Product"
          : /\b(design|creative|art director|architect)\b/.test(lower)
            ? "Design"
            : /\b(human resources|chro|people|talent|recruiting|hr )\b/.test(lower)
              ? "Human Resources"
              : /\b(education|dean|headmaster|faculty|training|coaching)\b/.test(lower)
                ? "Education & Coaching"
                : /\b(consult|advis|broker|agent)\b/.test(lower)
                  ? "Consulting"
                  : /\b(operations|practice manager|office manager|general manager|plant manager|site manager|store manager|branch manager|supply chain|coo)\b/.test(lower)
                    ? "Operations"
                    : /\b(cto|engineering|developer|technical|software)\b/.test(lower)
                      ? "Engineering & Technical"
                      : /\b(cio|it |information technology|security)\b/.test(lower)
                        ? "Information Technology"
                        : /\b(cfo|finance|accounting|controller|treasury)\b/.test(lower)
                          ? "Finance"
                          : /\b(sales|business development|revenue|cro|account director)\b/.test(lower)
                            ? "Sales"
                            : /\b(marketing|cmo|growth|brand)\b/.test(lower)
                              ? "Marketing"
                              : /\b(managing partner|senior partner|partner)\b/.test(lower)
                                ? criteria?.departments[0] ?? "C-Suite"
                                : /\b(ceo|founder|owner|managing director|president)\b/.test(lower)
                                  ? "C-Suite"
                                  : undefined;

  return { seniority, department };
}

function titleMatchesExclusion(title: string, criteria?: BuyingCommitteeCriteria): boolean {
  if (!criteria || criteria.excludeTitles.length === 0) return false;
  const titleLower = title.toLowerCase();
  const explicitInclude = criteria.includeTitles.some((inc) =>
    titleLower.includes(inc.toLowerCase()),
  );
  if (explicitInclude) return false;
  return criteria.excludeTitles.some((exc) => {
    const token = exc.trim().toLowerCase();
    return token.length >= 3 && titleLower.includes(token);
  });
}

function scoreExtractedPerson(
  title: string,
  seniority: string | undefined,
  department: string | undefined,
  criteria?: BuyingCommitteeCriteria,
): number {
  let score = 40;
  const titleLower = title.toLowerCase();
  if (criteria) {
    if (
      criteria.includeTitles.some((item) => {
        const clean = item.toLowerCase();
        return titleLower.includes(clean) || clean.split(/\s+/).every((w) => w.length >= 3 && titleLower.includes(w));
      })
    ) {
      score += 35;
    }
    if (seniority && criteria.seniorities.some((s) => s.toLowerCase() === seniority.toLowerCase())) {
      score += 15;
    }
    if (department && criteria.departments.some((d) => d.toLowerCase() === department.toLowerCase())) {
      score += 10;
    }
  }
  return Math.min(100, score);
}

function extractMatchingTitle(rawText: string, criteria?: BuyingCommitteeCriteria): string | null {
  const clean = rawText.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 140) return null;

  if (criteria?.includeTitles.length) {
    for (const includeTitle of criteria.includeTitles) {
      if (clean.toLowerCase().includes(includeTitle.toLowerCase())) {
        return clean.length <= 80 ? clean : includeTitle;
      }
    }
  }

  const match = clean.match(ROLE_PATTERN);
  if (!match) return null;
  if (clean.length <= 75) return clean;
  return match[0].trim();
}

function extractJsonLdPeople(
  $: ReturnType<typeof load>,
  companyName: string,
  pageUrl: string,
  criteria?: BuyingCommitteeCriteria,
): Array<{ fullName: string; title: string; linkedInUrl?: string }> {
  const found: Array<{ fullName: string; title: string; linkedInUrl?: string }> = [];

  function inspectNode(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) inspectNode(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    const rawType = String(obj["@type"] ?? "").toLowerCase();
    if (/\b(person|physician|dentist|attorney|author)\b/.test(rawType) && typeof obj.name === "string") {
      const name = cleanPersonName(obj.name, companyName);
      const rawTitle =
        typeof obj.jobTitle === "string"
          ? obj.jobTitle.trim()
          : typeof obj.roleName === "string"
            ? obj.roleName.trim()
            : rawType.includes("dentist")
              ? "Dentist"
              : rawType.includes("physician")
                ? "Physician"
                : rawType.includes("attorney")
                  ? "Attorney"
                  : "";
      const matchedTitle = rawTitle ? extractMatchingTitle(rawTitle, criteria) : null;
      // On explicit Schema.org Person nodes, accept clean explicit jobTitle strings even for niche verticals.
      const title =
        matchedTitle ??
        (rawTitle && rawTitle.length >= 2 && rawTitle.length <= 80 && !/[<>{}]/.test(rawTitle)
          ? rawTitle
          : null);
      if (name && title) {
        const sameAs = Array.isArray(obj.sameAs)
          ? obj.sameAs.find((u): u is string => typeof u === "string" && /linkedin\.com\/in\//i.test(u))
          : typeof obj.sameAs === "string" && /linkedin\.com\/in\//i.test(obj.sameAs)
            ? obj.sameAs
            : typeof obj.url === "string" && /linkedin\.com\/in\//i.test(obj.url)
              ? obj.url
              : undefined;
        found.push({ fullName: name, title, linkedInUrl: sameAs });
      }
    }
    for (const key of [
      "founder",
      "founders",
      "employee",
      "employees",
      "member",
      "members",
      "director",
      "author",
      "@graph",
    ]) {
      if (key in obj) inspectNode(obj[key]);
    }
  }

  $('script[type="application/ld+json"]').each((_idx, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try {
      inspectNode(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON-LD blocks safely.
    }
  });

  void pageUrl;
  return found;
}

const NOISY_EMAIL_DOMAIN_REGEX =
  /(?:example\.com|example\.org|sentry\.io|wixpress\.com|squarespace\.com|wordpress\.org|w3\.org|schema\.org|googleapis\.com|cloudflare\.com|gravatar\.com|facebook\.com|twitter\.com|linkedin\.com|instagram\.com|youtube\.com|tiktok\.com|apple\.com)$/i;

const NOISY_EMAIL_PREFIX_REGEX =
  /^(?:noreply|no-reply|donotreply|do-not-reply|mailer-daemon|webmaster|postmaster|bounce|root|hostmaster)$/i;

const SHARED_INBOX_PREFIX_REGEX =
  /^(?:info|contact|hello|hi|admin|office|reception|enquiries|enquiry|inquiry|inquiries|appointments|appointment|booking|bookings|support|sales|marketing|team|general|help|care|clinic|dental|frontdesk|mail|service|services|billing|accounts|careers|jobs|hr|press|media|legal|privacy|feedback)$/i;

const EMAIL_FINDER_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,12}\b/g;

export type ExtractedPublicEmail = {
  email: string;
  kind: "direct_public" | "shared_inbox";
  matchesDomain: boolean;
};

function cleanValidEmail(raw: string): string | null {
  const cleaned = raw.trim().replace(/^mailto:/i, "").split("?")[0]?.trim().toLowerCase() ?? "";
  if (!cleaned || cleaned.length > 160) return null;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,12}$/.test(cleaned)) return null;
  const [localPart, domain] = cleaned.split("@");
  if (!localPart || !domain) return null;
  if (/\.(png|jpg|jpeg|svg|webp|gif|css|js|ico|woff2?)$/i.test(domain)) return null;
  if (NOISY_EMAIL_DOMAIN_REGEX.test(domain) || NOISY_EMAIL_PREFIX_REGEX.test(localPart)) {
    return null;
  }
  return cleaned;
}

export function extractPublicContactsFromHtml(
  html: string,
  companyDomain?: string | null,
): { emails: ExtractedPublicEmail[]; phones: string[] } {
  const $ = load(html);
  const emailsByAddr = new Map<string, ExtractedPublicEmail>();
  const normalizedHost = companyDomain?.replace(/^www\./i, "").trim().toLowerCase() ?? "";

  const registerEmail = (raw: string) => {
    const email = cleanValidEmail(raw);
    if (!email || emailsByAddr.has(email)) return;
    const [localPart, domain] = email.split("@");
    const matchesDomain = Boolean(
      normalizedHost && (domain === normalizedHost || domain.endsWith(`.${normalizedHost}`)),
    );
    const kind: "direct_public" | "shared_inbox" = SHARED_INBOX_PREFIX_REGEX.test(localPart)
      ? "shared_inbox"
      : "direct_public";
    emailsByAddr.set(email, { email, kind, matchesDomain });
  };

  $('a[href^="mailto:"]').each((_idx, el) => {
    const href = $(el).attr("href");
    if (href) registerEmail(href);
  });

  $("script, style, noscript, svg").remove();
  const visibleText = $("body").text();
  let match: RegExpExecArray | null;
  EMAIL_FINDER_REGEX.lastIndex = 0;
  while ((match = EMAIL_FINDER_REGEX.exec(visibleText)) !== null) {
    registerEmail(match[0]);
  }

  const phonesSet = new Set<string>();
  $('a[href^="tel:"]').each((_idx, el) => {
    const raw = $(el).attr("href")?.replace(/^tel:/i, "").trim() ?? "";
    const normalized = raw.replace(/\s+/g, " ");
    const digits = normalized.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 16 && normalized.length <= 28) {
      phonesSet.add(normalized);
    }
  });

  const sortedEmails = [...emailsByAddr.values()].sort((a, b) => {
    if (a.matchesDomain !== b.matchesDomain) return a.matchesDomain ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "direct_public" ? -1 : 1;
    return 0;
  });

  return {
    emails: sortedEmails.slice(0, 8),
    phones: [...phonesSet].slice(0, 4),
  };
}

function matchPersonEmail(
  person: WebsiteTeamPerson,
  siteEmails: ExtractedPublicEmail[],
): { email: string; kind: "direct_public" | "shared_inbox" } | null {
  if (person.publicEmail) {
    return {
      email: person.publicEmail,
      kind: person.publicEmailKind ?? "direct_public",
    };
  }
  if (siteEmails.length === 0) return null;

  const nameTokens = [person.firstName, person.lastName]
    .filter((t): t is string => Boolean(t))
    .flatMap((t) => t.toLowerCase().split(/\s+/))
    .filter((t) => t.length >= 3);

  for (const item of siteEmails) {
    if (item.kind !== "direct_public") continue;
    const localPart = item.email.split("@")[0]?.toLowerCase() ?? "";
    if (nameTokens.some((token) => localPart.includes(token))) {
      return { email: item.email, kind: "direct_public" };
    }
  }

  const shared = siteEmails.find((item) => item.kind === "shared_inbox" && item.matchesDomain) ??
    siteEmails.find((item) => item.kind === "shared_inbox");
  if (shared) {
    return { email: shared.email, kind: "shared_inbox" };
  }

  const domainDirect = siteEmails.find((item) => item.matchesDomain);
  return domainDirect
    ? { email: domainDirect.email, kind: domainDirect.kind }
    : { email: siteEmails[0].email, kind: siteEmails[0].kind };
}

export function extractPeopleFromHtml(
  html: string,
  pageUrl: string,
  account: Pick<AccountCandidateDossier, "id" | "name" | "domain" | "location">,
  criteria?: BuyingCommitteeCriteria,
): WebsiteTeamPerson[] {
  const $ = load(html);
  const byName = new Map<string, WebsiteTeamPerson>();

  const registerCandidate = (
    fullName: string,
    title: string,
    linkedInUrl?: string,
    cardMailto?: string,
  ) => {
    if (titleMatchesExclusion(title, criteria)) return;
    const key = fullName.toLowerCase();
    const { seniority, department } = inferSeniorityAndDepartment(title, criteria);
    const score = scoreExtractedPerson(title, seniority, department, criteria);
    const existing = byName.get(key);
    const parsedMail = cardMailto ? cleanValidEmail(cardMailto) : null;
    if (existing && existing.score >= score) {
      if (parsedMail && !existing.publicEmail) {
        existing.publicEmail = parsedMail;
        existing.publicEmailKind = SHARED_INBOX_PREFIX_REGEX.test(parsedMail.split("@")[0] ?? "")
          ? "shared_inbox"
          : "direct_public";
      }
      return;
    }
    const { firstName, lastName } = splitName(fullName);
    const idHash = createHash("sha1")
      .update(`${account.id}:${key}`)
      .digest("hex")
      .slice(0, 16);

    byName.set(key, {
      id: idHash,
      accountId: account.id,
      accountName: account.name,
      accountDomain: account.domain ?? undefined,
      fullName,
      firstName,
      lastName,
      title,
      seniority,
      department,
      linkedInUrl: linkedInUrl ?? existing?.linkedInUrl,
      publicEmail: parsedMail ?? existing?.publicEmail,
      publicEmailKind: parsedMail
        ? SHARED_INBOX_PREFIX_REGEX.test(parsedMail.split("@")[0] ?? "")
          ? "shared_inbox"
          : "direct_public"
        : existing?.publicEmailKind,
      sourceUrl: pageUrl,
      location: account.location ?? undefined,
      score,
    });
  };

  for (const person of extractJsonLdPeople($, account.name, pageUrl, criteria)) {
    registerCandidate(person.fullName, person.title, person.linkedInUrl);
  }

  // Strip non-content chrome before inspecting visible headings & team cards.
  $("script, style, noscript, svg, nav, footer, form").remove();

  $("h2, h3, h4, h5, strong").each((_idx, el) => {
    const rawHeading = $(el).text().replace(/\s+/g, " ").trim();
    if (!rawHeading) return;

    // Support "Dr. Mei Ling — Principal Dentist" or "Sarah Tan, Practice Manager" inline headings
    const splitPair = rawHeading.split(/\s+[—–|\-:]\s+|,\s+(?=[A-Z])/);
    if (splitPair.length >= 2) {
      const name = cleanPersonName(splitPair[0], account.name);
      const title = extractMatchingTitle(splitPair.slice(1).join(" "), criteria);
      if (name && title) {
        const container = $(el).closest("article, li, div, section");
        const liHref = container.find('a[href*="linkedin.com/in/"]').first().attr("href");
        const cardMailto = container.find('a[href^="mailto:"]').first().attr("href");
        registerCandidate(name, title, liHref, cardMailto);
        return;
      }
    }

    const name = cleanPersonName(rawHeading, account.name);
    if (!name) return;

    const card = $(el).closest("article, li, [class*='team'], [class*='member'], [class*='doctor'], [class*='staff'], [class*='profile'], div");
    const nextText = $(el).next("p, span, div, small, em").first().text().replace(/\s+/g, " ").trim();
    const fallbackCardTexts = card
      .find("p, span, small, em, .role, .title, .position, .job-title")
      .slice(0, 4)
      .toArray()
      .map((node) => $(node).text().replace(/\s+/g, " ").trim())
      .filter((t) => t && t !== rawHeading);

    const roleCandidates = [nextText, ...fallbackCardTexts].filter(Boolean);
    for (const candidateText of roleCandidates) {
      const title = extractMatchingTitle(candidateText, criteria);
      if (title) {
        const liHref = card.find('a[href*="linkedin.com/in/"]').first().attr("href");
        const cardMailto = card.find('a[href^="mailto:"]').first().attr("href");
        registerCandidate(name, title, liHref, cardMailto);
        break;
      }
    }
  });

  // Pass 3: Extract decision-makers mentioned in narrative /about or /company prose paragraphs.
  const proseFounderRegex =
    /\b(Co-[Ff]ounded|co-founded|[Ff]ounded|[Ee]stablished|[Ss]tarted|[Oo]wned|[Ll]ed|[Hh]eaded|[Mm]anaged|[Rr]un)\s+(?:in\s+\d{4}\s+)?by\s+([A-Z][^.;\n]{3,120})/g;
  const proseInlineRoleRegex =
    /\b([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){1,3})\s*(?:,\s*(?:our|the|a)?\s*|\s+is\s+(?:our|the|a)\s+)([A-Z][a-zA-Z&\s/]{2,65}?)(?=[.,;\n]|(?:\s+(?:who|and|with|at|for|in)\b)|$)/g;

  $("p, li, blockquote").each((_idx, el) => {
    const paragraph = $(el).text().replace(/\s+/g, " ").trim();
    if (!paragraph || paragraph.length < 15 || paragraph.length > 900) return;

    let founderMatch: RegExpExecArray | null;
    proseFounderRegex.lastIndex = 0;
    while ((founderMatch = proseFounderRegex.exec(paragraph)) !== null) {
      const verb = founderMatch[1].toLowerCase();
      const tail = founderMatch[2].trim();
      const defaultTitle =
        verb === "co-founded"
          ? "Co-Founder"
          : verb === "founded" || verb === "established" || verb === "started"
            ? "Founder"
            : verb === "owned"
              ? "Owner"
              : "Managing Director";
      for (const segment of tail.split(/\s+(?:and|&)\s+|,\s+/)) {
        const leadingNameMatch = segment
          .trim()
          .match(
            /^(?:(?:Dr\.?|Prof\.?|Dato'?|Datuk(?:\s+Seri)?|Tan\s+Sri|Mr\.?|Mrs\.?|Ms\.?)\s+)?[A-Z][a-zA-Z'’-]+(?:\s+(?:(?:bin|binti|al|van|de|der|da)\s+)?[A-Z][a-zA-Z'’-]+){1,3}/,
          );
        const candidateName = leadingNameMatch ? leadingNameMatch[0] : segment.trim();
        const name = cleanPersonName(candidateName, account.name);
        if (name) {
          registerCandidate(name, defaultTitle);
        }
      }
    }

    let roleMatch: RegExpExecArray | null;
    proseInlineRoleRegex.lastIndex = 0;
    while ((roleMatch = proseInlineRoleRegex.exec(paragraph)) !== null) {
      const name = cleanPersonName(roleMatch[1].trim(), account.name);
      if (!name) continue;
      const title = extractMatchingTitle(roleMatch[2].trim(), criteria);
      if (title) {
        registerCandidate(name, title);
      }
    }
  });

  return [...byName.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PEOPLE_PER_COMPANY);
}

function extractVisiblePageText(html: string): string {
  const $ = load(html);
  $("script, style, noscript, svg, nav, footer, form").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

export function createWebsiteTeamLlmExtractor(
  config: LlmPlannerConfig,
  modelOverride?: InvokableChatModel,
): WebsiteTeamLlmFallback {
  return async ({ companyName, pages, criteria }) => {
    const model = modelOverride ?? createPlannerChatModel(config, { maxTokens: 500 });
    const snippets = pages
      .map((p) => `URL: ${p.url}\n${p.text.slice(0, 1_500)}`)
      .join("\n\n---\n\n")
      .slice(0, 4_500);
    if (!snippets.trim()) return [];

    const targetRoles = criteria?.includeTitles?.join(", ") || "Founder, CEO, COO, Director, Partner, Manager";
    const systemPrompt = `Extract ONLY real named decision-makers or leadership team members explicitly written in the provided webpage text for ${companyName}.
Return strictly valid JSON: {"people":[{"fullName":"Exact Name From Text","title":"Exact Job Title From Text","sourceUrl":"Page URL"}]}.
Rules:
- Never guess or invent any person name not literally written in the text.
- Prefer decision-makers matching: ${targetRoles}.
- If no named people appear in the text, return {"people":[]}.`;

    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(snippets),
    ]);
    const raw =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content
            .map((part) =>
              typeof part === "string"
                ? part
                : part && typeof part === "object" && "text" in part && typeof part.text === "string"
                  ? part.text
                  : "",
            )
            .join("\n")
          : String(response.content ?? "");

    const fenced = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const cleaned = fenced ? fenced[1].trim() : raw.trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first < 0 || last <= first) return [];
    const parsed = JSON.parse(cleaned.slice(first, last + 1)) as { people?: unknown };
    if (!Array.isArray(parsed.people)) return [];

    return parsed.people
      .filter(
        (item): item is { fullName: string; title: string; sourceUrl?: string } =>
          Boolean(
            item &&
            typeof item === "object" &&
            typeof (item as { fullName?: unknown }).fullName === "string" &&
            typeof (item as { title?: unknown }).title === "string",
          ),
      )
      .slice(0, MAX_PEOPLE_PER_COMPANY);
  };
}

export async function discoverPeopleFromCompanyWebsites(
  shortlistedAccounts: AccountCandidateDossier[],
  criteria?: BuyingCommitteeCriteria,
  dependencies: {
    fetch?: FetchLike;
    lookup?: Lookup;
    llmFallback?: WebsiteTeamLlmFallback;
  } = {},
): Promise<WebsiteTeamDiscoveryResult> {
  const fetcher: FetchLike = dependencies.fetch ?? fetch;
  const lookup: Lookup =
    dependencies.lookup ??
    (async (hostname) => {
      const res = await defaultLookup(hostname, { all: true, verbatim: true });
      return res.map((item) => ({ address: item.address, family: item.family }));
    });

  const targetAccounts = shortlistedAccounts
    .filter((acc) => Boolean(acc.website || acc.domain))
    .slice(0, MAX_COMPANIES_PER_RUN);

  const allPeople: WebsiteTeamPerson[] = [];
  const companyReports: WebsiteTeamCompanyReport[] = [];
  let totalPagesScanned = 0;
  let llmFallbackCalls = 0;

  for (const account of targetAccounts) {
    if (totalPagesScanned >= MAX_TOTAL_PAGES_PER_RUN || allPeople.length >= MAX_TOTAL_PEOPLE) {
      break;
    }

    const startUrl = account.website ?? `https://${account.domain}`;
    let pagesFetchedForCompany = 0;
    const companyPeople = new Map<string, WebsiteTeamPerson>();
    const fetchedPages: Array<{ url: string; text: string }> = [];
    const companyEmails = new Map<string, ExtractedPublicEmail>();
    const companyPhones = new Set<string>();

    const collectPublicContacts = (html: string) => {
      const found = extractPublicContactsFromHtml(html, account.domain);
      for (const item of found.emails) {
        if (!companyEmails.has(item.email)) companyEmails.set(item.email, item);
      }
      for (const phone of found.phones) {
        companyPhones.add(phone);
      }
    };

    try {
      const homepage = await fetchSafeHtml(startUrl, fetcher, lookup);
      if (!homepage) {
        companyReports.push({
          accountId: account.id,
          accountName: account.name,
          website: startUrl,
          pagesFetched: 0,
          peopleFound: 0,
          note: "Website unreachable or returned non-HTML content.",
        });
        continue;
      }

      pagesFetchedForCompany += 1;
      totalPagesScanned += 1;
      collectPublicContacts(homepage.html);
      fetchedPages.push({ url: homepage.finalUrl, text: extractVisiblePageText(homepage.html) });

      for (const person of extractPeopleFromHtml(homepage.html, homepage.finalUrl, account, criteria)) {
        const key = person.fullName.toLowerCase();
        const prev = companyPeople.get(key);
        if (!prev || person.score > prev.score) companyPeople.set(key, person);
      }

      const teamLinks = extractTeamPageLinks(homepage.html, homepage.finalUrl);
      const origin = new URL(homepage.finalUrl).origin;
      const fallbackPaths =
        teamLinks.length === 0 && companyPeople.size === 0
          ? [`${origin}/about`, `${origin}/team`, `${origin}/contact`]
          : teamLinks.length < MAX_PAGES_PER_COMPANY - 1 && companyEmails.size === 0
            ? [`${origin}/contact`]
            : [];

      const secondaryUrls = Array.from(new Set([...teamLinks, ...fallbackPaths])).slice(
        0,
        MAX_PAGES_PER_COMPANY - 1,
      );

      for (const subUrl of secondaryUrls) {
        if (totalPagesScanned >= MAX_TOTAL_PAGES_PER_RUN || pagesFetchedForCompany >= MAX_PAGES_PER_COMPANY) {
          break;
        }
        try {
          const page = await fetchSafeHtml(subUrl, fetcher, lookup);
          if (!page) continue;
          pagesFetchedForCompany += 1;
          totalPagesScanned += 1;
          collectPublicContacts(page.html);
          fetchedPages.push({ url: page.finalUrl, text: extractVisiblePageText(page.html) });
          for (const person of extractPeopleFromHtml(page.html, page.finalUrl, account, criteria)) {
            const key = person.fullName.toLowerCase();
            const prev = companyPeople.get(key);
            if (!prev || person.score > prev.score) companyPeople.set(key, person);
          }
        } catch {
          // Ignore single-subpage failure and continue cleanly.
        }
      }

      // Grounded LLM extraction fallback when deterministic parsing finds 0 people on fetched pages.
      if (
        companyPeople.size === 0 &&
        dependencies.llmFallback &&
        llmFallbackCalls < MAX_LLM_FALLBACK_COMPANIES &&
        fetchedPages.length > 0
      ) {
        llmFallbackCalls += 1;
        const combinedTextLower = fetchedPages
          .map((p) => p.text)
          .join("\n")
          .toLowerCase();
        try {
          const llmCandidates = await dependencies.llmFallback({
            companyName: account.name,
            pages: fetchedPages,
            criteria,
          });
          for (const cand of llmCandidates) {
            const cleanedName = cleanPersonName(cand.fullName, account.name);
            if (!cleanedName) continue;
            // Anti-hallucination guard: the exact extracted name must appear in the fetched page text.
            if (!combinedTextLower.includes(cleanedName.toLowerCase())) continue;
            const cleanTitle = cand.title.replace(/\s+/g, " ").trim().slice(0, 80);
            if (!cleanTitle || titleMatchesExclusion(cleanTitle, criteria)) continue;

            const { seniority, department } = inferSeniorityAndDepartment(cleanTitle, criteria);
            const score = scoreExtractedPerson(cleanTitle, seniority, department, criteria);
            const { firstName, lastName } = splitName(cleanedName);
            const key = cleanedName.toLowerCase();
            const matchedPage =
              fetchedPages.find((p) => p.url === cand.sourceUrl)?.url ?? fetchedPages[0].url;
            const idHash = createHash("sha1")
              .update(`${account.id}:${key}`)
              .digest("hex")
              .slice(0, 16);

            companyPeople.set(key, {
              id: idHash,
              accountId: account.id,
              accountName: account.name,
              accountDomain: account.domain ?? undefined,
              fullName: cleanedName,
              firstName,
              lastName,
              title: cleanTitle,
              seniority,
              department,
              sourceUrl: matchedPage,
              location: account.location ?? undefined,
              score,
            });
          }
        } catch {
          // Never fail website discovery if the optional LLM fallback errors.
        }
      }

      const siteEmailsList = [...companyEmails.values()];
      const primaryPhone = [...companyPhones][0];
      const rankedCompanyPeople = [...companyPeople.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_PEOPLE_PER_COMPANY)
        .map((person) => {
          const matched = matchPersonEmail(person, siteEmailsList);
          return {
            ...person,
            ...(matched
              ? { publicEmail: matched.email, publicEmailKind: matched.kind }
              : {}),
            ...(person.publicPhone ?? primaryPhone
              ? { publicPhone: person.publicPhone ?? primaryPhone }
              : {}),
          };
        });

      for (const person of rankedCompanyPeople) {
        if (allPeople.length >= MAX_TOTAL_PEOPLE) break;
        allPeople.push(person);
      }

      companyReports.push({
        accountId: account.id,
        accountName: account.name,
        website: homepage.finalUrl,
        pagesFetched: pagesFetchedForCompany,
        peopleFound: rankedCompanyPeople.length,
        note: rankedCompanyPeople.length === 0 ? "No named leadership/team profiles matched public pages." : undefined,
      });
    } catch (error) {
      companyReports.push({
        accountId: account.id,
        accountName: account.name,
        website: startUrl,
        pagesFetched: pagesFetchedForCompany,
        peopleFound: 0,
        note: error instanceof Error ? error.message : "Could not scan website safely.",
      });
    }
  }

  return {
    people: allPeople.slice(0, MAX_TOTAL_PEOPLE),
    pagesScanned: totalPagesScanned,
    companiesScanned: companyReports.length,
    companyReports,
  };
}
