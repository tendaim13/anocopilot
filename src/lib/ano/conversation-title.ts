import { isOpenMarketRecommendationIntent } from "./autopilot";

export const DEFAULT_CONVERSATION_TITLE = "New Sales Research";

export type FriendlyConversationTitleInput = {
  openingMessage?: string | null;
  brief?: {
    offer?: string | null;
    goal?: string | null;
    targetMarkets?: string[] | null;
    marketHints?: string[] | null;
    locationHints?: string[] | null;
    businessLocation?: string | null;
  } | null;
  lockedMarketName?: string | null;
  lockedIndustryName?: string | null;
  productSourceLabels?: string[];
  productSourceSummaries?: string[];
};

const ACRONYMS = new Set([
  "ai",
  "ml",
  "b2b",
  "b2c",
  "d2c",
  "c2c",
  "saas",
  "paas",
  "iaas",
  "crm",
  "erp",
  "hr",
  "hrm",
  "hris",
  "api",
  "sdk",
  "it",
  "pos",
  "sms",
  "seo",
  "sem",
  "roi",
  "kpi",
  "smb",
  "smbs",
  "sme",
  "smes",
  "ev",
  "evs",
  "led",
  "iot",
  "rfid",
  "hvac",
  "cnc",
  "esg",
  "fmcg",
  "cpg",
  "oem",
  "odm",
  "3pl",
  "uk",
  "us",
  "usa",
  "uae",
  "eu",
  "apac",
  "emea",
  "latam",
  "mena",
  "asean",
  "sea",
  "kl",
  "nz",
  "hk",
  "sg",
  "gdp",
  "bpo",
  "kpo",
  "rpa",
  "gtm",
]);

const SPECIAL_CASE_WORDS: Record<string, string> = {
  ai: "AI",
  ml: "ML",
  b2b: "B2B",
  b2c: "B2C",
  d2c: "D2C",
  c2c: "C2C",
  saas: "SaaS",
  paas: "PaaS",
  iaas: "IaaS",
  crm: "CRM",
  erp: "ERP",
  hr: "HR",
  hrm: "HRM",
  hris: "HRIS",
  api: "API",
  sdk: "SDK",
  it: "IT",
  pos: "POS",
  sms: "SMS",
  seo: "SEO",
  sem: "SEM",
  roi: "ROI",
  kpi: "KPI",
  smb: "SMB",
  smbs: "SMBs",
  sme: "SME",
  smes: "SMEs",
  ev: "EV",
  evs: "EVs",
  led: "LED",
  iot: "IoT",
  rfid: "RFID",
  hvac: "HVAC",
  cnc: "CNC",
  esg: "ESG",
  fmcg: "FMCG",
  cpg: "CPG",
  oem: "OEM",
  odm: "ODM",
  "3pl": "3PL",
  uk: "UK",
  us: "US",
  usa: "USA",
  uae: "UAE",
  eu: "EU",
  apac: "APAC",
  emea: "EMEA",
  latam: "LATAM",
  mena: "MENA",
  asean: "ASEAN",
  sea: "Southeast Asia",
  kl: "Kuala Lumpur",
  ios: "iOS",
  macos: "macOS",
  ecommerce: "eCommerce",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  shopify: "Shopify",
  devops: "DevOps",
  fintech: "FinTech",
  edtech: "EdTech",
  medtech: "MedTech",
  healthtech: "HealthTech",
  proptech: "PropTech",
  agritech: "AgriTech",
  martech: "MarTech",
  cleantech: "CleanTech",
  insurtech: "InsurTech",
  regtech: "RegTech",
  legaltech: "LegalTech",
};

const MINOR_LOWER_WORDS = new Set([
  "of",
  "for",
  "and",
  "or",
  "in",
  "on",
  "to",
  "with",
  "by",
  "at",
  "from",
  "a",
  "an",
  "the",
  "&",
]);

const EXACT_MARKET_ALIASES: Record<string, string> = {
  "south east asia": "Southeast Asia",
  "south-east asia": "Southeast Asia",
  "south eat asia": "Southeast Asia",
  "southeast asia": "Southeast Asia",
  "se asia": "Southeast Asia",
  sea: "Southeast Asia",
  asean: "ASEAN",
  apac: "APAC",
  "asia pacific": "APAC",
  "asia-pacific": "APAC",
  emea: "EMEA",
  latam: "Latin America",
  "latin america": "Latin America",
  mena: "Middle East",
  "middle east": "Middle East",
  "north america": "North America",
  uk: "UK",
  "u.k.": "UK",
  "u.k": "UK",
  "united kingdom": "UK",
  "great britain": "UK",
  us: "US",
  "u.s.": "US",
  "u.s": "US",
  usa: "US",
  "u.s.a.": "US",
  "u.s.a": "US",
  "united states": "US",
  "united states of america": "US",
  uae: "UAE",
  "u.a.e.": "UAE",
  "u.a.e": "UAE",
  "united arab emirates": "UAE",
  eu: "EU",
  "european union": "EU",
  kl: "Kuala Lumpur",
  "kuala lumpur": "Kuala Lumpur",
  sg: "Singapore",
  my: "Malaysia",
  au: "Australia",
  nz: "New Zealand",
  hk: "Hong Kong",
  jp: "Japan",
  kr: "South Korea",
};

const OPEN_MARKET_OR_PLACEHOLDER_PATTERN =
  /^(?:tbd|to be determined|unknown|unspecified|n\/a|none|primary target market)$/i;

const GENERIC_HEAD_NOUNS = new Set([
  "software",
  "platform",
  "tool",
  "tools",
  "app",
  "application",
  "solution",
  "solutions",
  "service",
  "services",
  "system",
  "systems",
  "product",
  "products",
  "marketplace",
  "agency",
  "consultancy",
]);

const NON_GEOGRAPHY_WORDS = new Set([
  "find",
  "get",
  "sell",
  "buy",
  "grow",
  "scale",
  "help",
  "make",
  "build",
  "save",
  "reduce",
  "increase",
  "boost",
  "automate",
  "manage",
  "improve",
  "book",
  "convert",
  "reach",
  "target",
  "generate",
  "expand",
  "launch",
  "create",
  "use",
  "try",
  "win",
  "close",
  "drive",
  "support",
  "handle",
  "solve",
  "fix",
  "work",
  "turn",
  "keep",
  "bring",
  "send",
  "give",
  "take",
  "my",
  "our",
  "their",
  "your",
  "the",
  "a",
  "an",
  "this",
  "that",
  "all",
  "any",
  "more",
  "new",
  "best",
  "top",
  "clients",
  "customers",
  "buyers",
  "businesses",
  "companies",
  "clinics",
  "teams",
  "people",
  "users",
  "founders",
  "owners",
  "managers",
  "directors",
  "executives",
  "execs",
  "doctors",
  "dentists",
  "lawyers",
  "accountants",
  "engineers",
  "developers",
  "smbs",
  "smes",
  "enterprises",
  "startups",
  "agencies",
  "restaurants",
  "hotels",
  "schools",
  "hospitals",
  "stores",
  "shops",
  "brands",
  "retailers",
  "distributors",
  "wholesalers",
  "merchants",
  "vendors",
  "suppliers",
  "partners",
  "brokers",
  "agents",
  "consultants",
  "contractors",
  "manufacturers",
  "factories",
  "warehouses",
  "offices",
  "organizations",
  "organisations",
  "markets",
  "market",
  "industries",
  "industry",
  "sectors",
  "sector",
  "verticals",
  "vertical",
  "retail",
  "wholesale",
  "bulk",
  "cash",
  "english",
  "production",
  "scale",
  "house",
  "general",
  "particular",
  "demand",
  "stock",
  "vitro",
  "person",
  "depth",
  "detail",
  "addition",
  "return",
  "case",
  "fact",
  "order",
  "mind",
  "need",
  "progress",
  "touch",
  "effect",
  "place",
  "part",
  "full",
  "short",
  "long",
  "total",
  "beta",
  "stealth",
  "cloud",
  "saas",
  "b2b",
  "b2c",
  "d2c",
  "sales",
  "marketing",
  "revenue",
  "growth",
  "realtime",
  "real-time",
  "days",
  "weeks",
  "months",
  "years",
  "hours",
  "minutes",
  "time",
  "recommend",
  "suggest",
  "recommendations",
]);

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function titleCaseToken(token: string, isEdge: boolean): string {
  if (!token) return token;
  if (token.includes("-")) {
    const parts = token.split("-");
    return parts
      .map((part, idx) =>
        titleCaseToken(part, isEdge && (idx === 0 || idx === parts.length - 1)),
      )
      .join("-");
  }
  const cleanPunct = token.match(/^([^a-zA-Z0-9]*)([a-zA-Z0-9'’]+)([^a-zA-Z0-9]*)$/);
  if (!cleanPunct) return token;
  const [, leading, core, trailing] = cleanPunct;
  const lower = core.toLowerCase();

  if (SPECIAL_CASE_WORDS[lower]) {
    const mapped = SPECIAL_CASE_WORDS[lower];
    return `${leading}${mapped}${trailing}`;
  }
  if (ACRONYMS.has(lower)) {
    return `${leading}${lower.toUpperCase()}${trailing}`;
  }
  if (!isEdge && MINOR_LOWER_WORDS.has(lower)) {
    return `${leading}${lower}${trailing}`;
  }
  // Preserve intentional camelCase / mixed-case brand words such as SaaS / iPhone / AcmeAI
  const hasInternalUpper = /[a-z][A-Z]/.test(core);
  if (hasInternalUpper) {
    return `${leading}${core}${trailing}`;
  }

  return `${leading}${core.charAt(0).toUpperCase()}${core.slice(1).toLowerCase()}${trailing}`;
}

export function toSmartTitleCase(value: string): string {
  const compact = collapseWhitespace(value);
  if (!compact) return "";
  const tokens = compact.split(" ");
  return tokens
    .map((token, idx) =>
      titleCaseToken(token, idx === 0 || idx === tokens.length - 1),
    )
    .join(" ");
}

function stripLeadingArticleThe(value: string): string {
  return value.replace(/^the\s+/i, "").trim();
}

function isValidMarketCandidate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = collapseWhitespace(raw)
    .replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, "")
    .replace(/^the\s+/i, "")
    .replace(/\s+(?:markets?|regions?|territories|countries)$/i, "")
    .trim();
  if (!compact) return null;
  if (OPEN_MARKET_OR_PLACEHOLDER_PATTERN.test(compact)) return null;
  if (isOpenMarketRecommendationIntent(compact)) return null;
  if (/^https?:\/\//i.test(compact) || /^www\./i.test(compact)) return null;
  if (compact.length > 60) {
    // Trim parenthetical caveats if long, e.g. "Singapore (high digital readiness...)"
    const withoutParens = collapseWhitespace(compact.replace(/\([^)]*\)/g, ""));
    if (!withoutParens || withoutParens.length > 60) {
      return null;
    }
    return stripLeadingArticleThe(withoutParens);
  }
  return compact;
}

export function normalizeMarketName(raw: string | null | undefined): string | null {
  const valid = isValidMarketCandidate(raw);
  if (!valid) return null;

  const strippedParens = collapseWhitespace(
    valid.length > 24 ? valid.replace(/\([^)]*\)/g, "") : valid,
  );
  const base = strippedParens || valid;
  const lower = base.toLowerCase();

  if (EXACT_MARKET_ALIASES[lower]) {
    return EXACT_MARKET_ALIASES[lower];
  }

  // Handle "Malaysia and Singapore" or "Malaysia & Singapore" inside a single market string
  const paired = base.match(/^(.+?)\s+(?:and|&)\s+(.+)$/i);
  if (paired) {
    const left = normalizeSingleMarketSegment(paired[1]);
    const right = normalizeSingleMarketSegment(paired[2]);
    if (left && right) {
      return `${left} & ${right}`;
    }
  }

  return normalizeSingleMarketSegment(base);
}

function normalizeSingleMarketSegment(raw: string): string | null {
  const clean = collapseWhitespace(raw)
    .replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, "")
    .trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  if (EXACT_MARKET_ALIASES[lower]) {
    return EXACT_MARKET_ALIASES[lower];
  }
  const titled = toSmartTitleCase(
    clean.replace(/\b(?:south\s+eat|souteast|southeats)\s+asia\b/gi, "southeast asia"),
  );
  // Market alias helper handles "sea" -> "Southeast Asia" as an exact match,
  // while toSmartTitleCase uses SPECIAL_CASE_WORDS; avoid turning country/city words oddly.
  return titled;
}

function stripUrls(text: string): string {
  return collapseWhitespace(
    text
      .replace(/https?:\/\/[^\s)>\]]+/gi, " ")
      .replace(/\bwww\.[^\s)>\]]+/gi, " "),
  );
}

function extractBrandFromUrl(raw: string): string | null {
  const match = raw.match(/(?:https?:\/\/|www\.)([^\s)>\]]+)/i);
  if (!match) return null;
  const hostAndPath = match[0].startsWith("http") ? match[0] : `https://${match[0]}`;
  try {
    const parsed = new URL(hostAndPath);
    const host = parsed.hostname.replace(/^www\./i, "");
    const parts = host.split(".").filter(Boolean);
    if (parts.length === 0) return null;
    // Drop common TLD suffixes (.com, .co.uk, .com.my, .io, .ai, .net, .org, .sg, .my)
    const stripped =
      parts.length >= 3 &&
      ["co", "com", "org", "net"].includes(parts[parts.length - 2].toLowerCase())
        ? parts.slice(0, -2)
        : parts.length >= 2
          ? parts.slice(0, -1)
          : parts;
    const base = stripped.join(" ").replace(/[-_]+/g, " ");
    const clean = collapseWhitespace(base);
    return clean ? toSmartTitleCase(clean) : null;
  } catch {
    return null;
  }
}

export function cleanSourceLabel(label: string): string | null {
  const trimmed = collapseWhitespace(label);
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed)) {
    return extractBrandFromUrl(trimmed);
  }
  const withoutExt = trimmed.replace(/\.(?:pdf|docx?|txt|csv|md)$/i, "");
  const normalized = collapseWhitespace(
    withoutExt
      .replace(/[-_]+/g, " ")
      .replace(/\b(?:final|draft|v\d+|copy|updated)\b$/gi, ""),
  );
  if (!normalized) return null;
  return toSmartTitleCase(normalized);
}

function isPureGeographyPhrase(raw: string): boolean {
  const clean = collapseWhitespace(raw)
    .replace(/^the\s+/i, "")
    .replace(/\s+(?:markets?|regions?|area)$/i, "")
    .trim();
  if (!clean) return false;
  if (EXACT_MARKET_ALIASES[clean.toLowerCase()]) return true;
  if (/\d/.test(clean)) return false;

  // Handle "Malaysia and Singapore"
  const andMatch = clean.match(/^(.+?)\s+(?:and|&)\s+(.+)$/i);
  if (andMatch) {
    return isPureGeographyPhrase(andMatch[1]) && isPureGeographyPhrase(andMatch[2]);
  }

  const words = clean.split(/\s+/);
  if (words.length === 0 || words.length > 4) return false;

  const firstLower = words[0].toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
  if (!firstLower || NON_GEOGRAPHY_WORDS.has(firstLower)) return false;

  for (const word of words) {
    const bare = word.toLowerCase().replace(/^[^a-z-]+|[^a-z-]+$/g, "");
    if (!bare) return false;
    if (NON_GEOGRAPHY_WORDS.has(bare)) return false;
  }

  // Reject single short generic non-country lowercase tokens that look like prepositions/conjunctions
  if (
    words.length === 1 &&
    ["here", "there", "now", "soon", "today", "line", "future"].includes(firstLower)
  ) {
    return false;
  }

  return true;
}

function stripLeadingLeadIns(text: string): string {
  let current = collapseWhitespace(text);
  const patterns: RegExp[] = [
    /^(?:hi|hey|hello|good\s+(?:morning|afternoon|evening))[\s,!.:-]*/i,
    /^(?:please\s+|could\s+you\s+|can\s+you\s+|would\s+you\s+)/i,
    /^(?:help\s+(?:me|us)\s+(?:find\s+(?:buyers|customers|clients|leads)\s+for|sell|reach|grow|market|launch|promote|pitch|get)?)\s*/i,
    /^(?:i['’]?m|i\s+am|we['’]?re|we\s+are)\s+(?:(?:currently|looking\s+to|trying\s+to|planning\s+to|hoping\s+to|aiming\s+to)\s+)?/i,
    /^(?:(?:i|we)\s+)?(?:would\s+like\s+to|want\s+to|trying\s+to|looking\s+to|planning\s+to|hoping\s+to|aiming\s+to|interested\s+in)\s+/i,
    /^(?:i|we)\s+(?:sell|selling|offer|offering|build|building|make|making|provide|providing|supply|supplying|run|running|have|developed|created)\s+/i,
    /^(?:selling|offering|providing)\s+/i,
    /^(?:my|our)\s+(?:company|business|startup|product|service|platform|team)\s+(?:sells|offers|builds|provides|makes|is|runs|helps\s+(?:people|companies|businesses|teams)?\s*(?:with)?)\s+/i,
    /^(?:find(?:ing)?\s+(?:b2b\s+)?(?:buyers|customers|clients|leads|distributors|retailers|accounts)\s+for)\s+/i,
    /^(?:target(?:ing)?|prospect(?:ing)?\s+for)\s+/i,
    /^(?:a|an|the|my|our)\s+/i,
  ];

  for (let pass = 0; pass < 5; pass += 1) {
    const before = current;
    for (const pattern of patterns) {
      current = collapseWhitespace(current.replace(pattern, ""));
    }
    if (current === before) break;
  }
  return current;
}

function stripAttachmentWrapper(raw: string): {
  text: string;
  hadAttachmentWrapper: boolean;
  inlineAttachmentLabel: string | null;
} {
  const match = raw.match(
    /^analyze\s+my\s+attached\s+product\s+source\(s\)\s*:\s*(.+)$/i,
  );
  if (!match) {
    return { text: raw, hadAttachmentWrapper: false, inlineAttachmentLabel: null };
  }
  const rest = collapseWhitespace(match[1]);
  const firstLabel = rest.split(",")[0]?.trim() ?? "";
  return {
    text: "",
    hadAttachmentWrapper: true,
    inlineAttachmentLabel: firstLabel ? cleanSourceLabel(firstLabel) : null,
  };
}

function firstClause(text: string): string {
  const strippedTrailingIntent = text.replace(
    /[,;]\s*(?:and\s+)?(?:(?:i|we)\s+(?:am|are|'m|'re)?\s*(?:want(?:ing)?|would\s+like|looking|trying|planning|hoping|aiming)\s+to\s+sell.*)$/i,
    "",
  );
  // Break at sentence terminators followed by space/end
  const sentenceMatch = strippedTrailingIntent.match(/^(.+?)(?:[.!?\n]+(?:\s|$)|$)/);
  return collapseWhitespace(sentenceMatch?.[1] ?? strippedTrailingIntent);
}

function extractInlineMarketAndOffer(rawText: string): {
  offerText: string;
  inlineMarket: string | null;
} {
  const cleanedUrls = stripUrls(rawText);
  if (!cleanedUrls) {
    return { offerText: "", inlineMarket: null };
  }

  let clause = firstClause(cleanedUrls);
  clause = stripLeadingLeadIns(clause);
  if (!clause) {
    return { offerText: "", inlineMarket: null };
  }

  let inlineMarket: string | null = null;
  const prepRegex = /\b(to|into|across|in|targeting)\b/gi;
  const matches: Array<{ index: number; word: string }> = [];
  let found: RegExpExecArray | null;
  while ((found = prepRegex.exec(clause)) !== null) {
    matches.push({ index: found.index, word: found[1] });
  }

  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const current = matches[i];
    const afterStart = current.index + current.word.length;
    const candidateRaw = collapseWhitespace(
      clause
        .slice(afterStart)
        .replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, ""),
    );
    if (candidateRaw && isPureGeographyPhrase(candidateRaw)) {
      const normalized = normalizeMarketName(candidateRaw);
      if (normalized) {
        inlineMarket = normalized;
        clause = collapseWhitespace(clause.slice(0, current.index));
        break;
      }
    }
  }

  // If removing geography left a trailing buyer audience like "shoes to retailers",
  // trim trailing "to <audience>" so "Shoes" remains crisp.
  clause = collapseWhitespace(
    clause
      .replace(
        /\s+\b(?:to|for)\s+(?:local\s+)?(?:retailers|distributors|wholesalers|buyers|customers|clients|businesses|companies|clinics|enterprises|smbs|smes|startups|stores|shops)\s*$/i,
        "",
      )
      .replace(/\s+\b(?:to|into|across|in|for|targeting|with|and|or)\s*$/i, ""),
  );

  // Strip one more pass of articles/lead-ins in case stripping tail exposed them
  clause = stripLeadingLeadIns(clause);
  return { offerText: clause, inlineMarket };
}

function cleanSourceSummaryToOffer(summary: string): string {
  const sentence = firstClause(stripUrls(summary));
  // Strip "<Brand> makes/offers/provides/builds/is a ..."
  const withoutSubjectVerb = sentence.replace(
    /^[A-Z0-9][A-Za-z0-9&.'-]{0,24}(?:\s+[A-Z0-9][A-Za-z0-9&.'-]{0,24}){0,2}\s+(?:is|makes|manufactures|offers|provides|builds|sells|delivers|creates|develops|specializes\s+in|helps)\s+(?:an?\s+|the\s+)?/i,
    "",
  );
  return withoutSubjectVerb || sentence;
}

function shortenProductPhrase(rawProduct: string, maxWords: number, maxChars: number): string {
  let clean = collapseWhitespace(rawProduct)
    .replace(/^[-–—:,.\s"'`]+|[-–—:,.\s"'`]+$/g, "");
  if (!clean) return "";

  // Cut at verbose relative clauses or dashes/parentheticals
  clean = clean
    .replace(/\s+\([^)]*\)\s*/g, " ")
    .replace(/\s+(?:that|which|who|where|while|because|helping|designed|built|aimed|using|focused)\b.*$/i, "")
    .replace(/\s*[—;].*$/, "")
    .replace(/\s+-\s+.*$/, "");

  // Handle "X for Y" / "X to Y"
  const forMatch = clean.match(/^(.+?)\s+(for|to)\s+(.+)$/i);
  if (forMatch) {
    const left = collapseWhitespace(forMatch[1]);
    const prep = forMatch[2].toLowerCase();
    const right = collapseWhitespace(forMatch[3]);
    const leftWords = left.split(/\s+/).filter(Boolean);
    const rightWords = right.split(/\s+/).filter(Boolean);
    const keepPhrase =
      prep === "for" &&
      leftWords.length <= 2 &&
      GENERIC_HEAD_NOUNS.has(leftWords[leftWords.length - 1]?.toLowerCase() ?? "") &&
      rightWords.length <= 3 &&
      leftWords.length + 1 + rightWords.length <= maxWords;
    const isFixedToPhrase = /^(?:direct\s+to\s+consumer|business\s+to\s+business|end\s+to\s+end|peer\s+to\s+peer|farm\s+to\s+table)$/i.test(
      clean,
    );
    if (!keepPhrase && !isFixedToPhrase && leftWords.length >= 1) {
      clean = left;
    }
  }

  // Strip trailing dangling connectors
  clean = collapseWhitespace(
    clean.replace(/\s+\b(?:for|to|in|into|of|with|and|or|&)\s*$/i, ""),
  );

  // Trim by maxWords and maxChars on word boundaries
  let words = clean.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    words = words.slice(0, maxWords);
  }
  while (
    words.length > 1 &&
    MINOR_LOWER_WORDS.has(words[words.length - 1].toLowerCase())
  ) {
    words.pop();
  }

  let joined = words.join(" ");
  while (joined.length > maxChars && words.length > 1) {
    words.pop();
    while (
      words.length > 1 &&
      MINOR_LOWER_WORDS.has(words[words.length - 1].toLowerCase())
    ) {
      words.pop();
    }
    joined = words.join(" ");
  }

  if (joined.length > maxChars) {
    joined = joined.slice(0, maxChars).trim();
  }

  return toSmartTitleCase(joined);
}

function selectTargetMarket(input: FriendlyConversationTitleInput, inlineMarkets: Array<string | null>): string | null {
  const locked = normalizeMarketName(input.lockedMarketName);
  if (locked) return clampMarket(locked);

  const briefMarkets = (input.brief?.targetMarkets ?? [])
    .map((m) => normalizeMarketName(m))
    .filter((m): m is string => Boolean(m));
  if (briefMarkets.length > 0) {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const m of briefMarkets) {
      const key = m.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(m);
      }
    }
    if (unique.length >= 2) {
      const paired = `${unique[0]} & ${unique[1]}`;
      if (paired.length <= 26) return paired;
    }
    return clampMarket(unique[0]);
  }

  for (const candidate of inlineMarkets) {
    if (candidate) return clampMarket(candidate);
  }

  const locationHints = (input.brief?.locationHints ?? [])
    .map((m) => normalizeMarketName(m))
    .filter((m): m is string => Boolean(m));
  if (locationHints.length > 0) {
    return clampMarket(locationHints[0]);
  }

  // Note: input.brief?.businessLocation is intentionally ignored here because
  // the user's home office location is often NOT their target export market.
  return null;
}

function clampMarket(market: string): string {
  const clean = collapseWhitespace(market);
  if (clean.length <= 26) return clean;
  const words = clean.split(/\s+/);
  let out = words[0];
  for (let i = 1; i < words.length; i += 1) {
    if (`${out} ${words[i]}`.length <= 26) {
      out = `${out} ${words[i]}`;
    } else {
      break;
    }
  }
  return out;
}

export function buildFriendlyConversationTitle(
  input: FriendlyConversationTitleInput,
): string {
  const rawOpening = collapseWhitespace(input.openingMessage ?? "");
  const wrapper = stripAttachmentWrapper(rawOpening);

  const briefOfferParsed = input.brief?.offer
    ? extractInlineMarketAndOffer(input.brief.offer)
    : { offerText: "", inlineMarket: null };

  const openingParsed =
    !wrapper.hadAttachmentWrapper && rawOpening
      ? extractInlineMarketAndOffer(rawOpening)
      : { offerText: "", inlineMarket: null };

  const goalParsed = input.brief?.goal
    ? extractInlineMarketAndOffer(input.brief.goal)
    : { offerText: "", inlineMarket: null };

  const summarySource = input.productSourceSummaries?.[0]?.trim()
    ? cleanSourceSummaryToOffer(input.productSourceSummaries[0])
    : "";
  const summaryParsed = summarySource
    ? extractInlineMarketAndOffer(summarySource)
    : { offerText: "", inlineMarket: null };

  const market = selectTargetMarket(input, [
    briefOfferParsed.inlineMarket,
    openingParsed.inlineMarket,
    summaryParsed.inlineMarket,
    goalParsed.inlineMarket,
  ]);

  let rawProductCandidate = "";
  if (briefOfferParsed.offerText) {
    rawProductCandidate = briefOfferParsed.offerText;
  } else if (openingParsed.offerText) {
    rawProductCandidate = openingParsed.offerText;
  } else if (summarySource) {
    rawProductCandidate = summaryParsed.offerText || summarySource;
  } else if (input.productSourceLabels?.[0]?.trim()) {
    rawProductCandidate = cleanSourceLabel(input.productSourceLabels[0]) ?? "";
  } else if (wrapper.inlineAttachmentLabel) {
    rawProductCandidate = wrapper.inlineAttachmentLabel;
  } else if (rawOpening) {
    rawProductCandidate = extractBrandFromUrl(rawOpening) ?? "";
  }

  const productMaxChars = market ? Math.max(24, 61 - market.length) : 54;
  const product = rawProductCandidate
    ? shortenProductPhrase(rawProductCandidate, 5, productMaxChars)
    : "";

  if (product && market) {
    if (
      product.toLowerCase() === market.toLowerCase() ||
      product.toLowerCase().endsWith(market.toLowerCase())
    ) {
      return product.slice(0, 64);
    }
    const combined = `${product} — ${market}`;
    if (combined.length <= 64) return combined;
    const tightenedProduct = shortenProductPhrase(
      rawProductCandidate,
      4,
      Math.max(18, 61 - market.length),
    );
    return tightenedProduct ? `${tightenedProduct} — ${market}` : `Sales Research — ${market}`;
  }

  if (product) return product.slice(0, 64);
  if (market) return `Sales Research — ${market}`;
  return DEFAULT_CONVERSATION_TITLE;
}

export function needsFriendlyTitleRefresh(
  currentTitle: string,
  candidateTitle?: string,
): boolean {
  const current = collapseWhitespace(currentTitle);
  const candidate = candidateTitle ? collapseWhitespace(candidateTitle) : undefined;

  if (candidate !== undefined) {
    if (candidate === current) return false;
    if (
      candidate === DEFAULT_CONVERSATION_TITLE &&
      current.length > 0 &&
      !/^https?:\/\//i.test(current) &&
      !/^www\./i.test(current) &&
      !/^analyze\s+my\s+attached\s+product/i.test(current)
    ) {
      return false;
    }
  }

  if (!current) return true;
  if (/^(?:untitled|new\s+research|new\s+sales\s+research|research\s+conversation)$/i.test(current)) {
    return true;
  }
  if (/primary\s+target\s+market/i.test(current)) return true;
  if (/https?:\/\/|\bwww\./i.test(current)) return true;
  if (/^analyze\s+my\s+attached\s+product/i.test(current)) return true;
  if (/\.(?:pdf|docx?|txt)$/i.test(current)) return true;
  if (current.length > 56 || /(?:\.\.\.|…)$/.test(current)) return true;
  if (
    /^(?:hi|hey|hello|i|i['’]?m|we|we['’]?re|my|our|selling|sell|looking|trying|planning|help|want|please|can\s+you|could\s+you)\b/i.test(
      current,
    )
  ) {
    return true;
  }
  if (/[?!]|\.\s+[a-zA-Z]/.test(current)) return true;
  if (/[a-z]/.test(current) && current === current.toLowerCase()) return true;

  if (candidate && candidate.includes(" — ") && !current.includes(" — ")) {
    return true;
  }

  return false;
}
