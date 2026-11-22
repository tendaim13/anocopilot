import "server-only";

import {
  deriveOsmTagFilters,
  type NormalizedProspeoCompanyInput,
  type OsmResolvedArea,
  type OsmTagFilter,
} from "@/lib/ano/company-discovery";
import { searxngConfiguration, searxngResearchProvider } from "@/server/research/searxng-provider";

const NOMINATIM_API = "https://nominatim.openstreetmap.org/search";
const DEFAULT_NOMINATIM_POI_TIMEOUT_MS = 15_000;
const NOMINATIM_TIMEOUT_MS = 12_000;
const OVERPASS_TIMEOUT_MS = 25_000;

export const OSM_USER_AGENT = "AnoCopilot/0.1 (local business discovery; contact@anocopilot.local)";

export type OsmErrorCode =
  | "LOCATION_NOT_FOUND"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "SERVICE_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "NO_RESULTS"
  | "NETWORK_ERROR";

export class OsmClientError extends Error {
  constructor(
    readonly code: OsmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OsmClientError";
  }
}

type OsmFetcher = typeof fetch;

type NominatimCandidate = {
  osm_type?: string;
  osm_id?: number;
  display_name?: string;
  class?: string;
  type?: string;
  importance?: number;
  boundingbox?: string[];
};

type NominatimPoiItem = {
  place_id?: number;
  osm_type?: "node" | "way" | "relation" | string;
  osm_id?: number;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
};

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

const AGGREGATOR_DOMAINS = new Set([
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "yelp.com",
  "yellowpages.com",
  "yellowpages.com.au",
  "tripadvisor.com",
  "mapcarta.com",
  "foursquare.com",
  "whatclinic.com",
  "healthgrades.com",
  "google.com",
  "waze.com",
  "kompass.com",
  "dnb.com",
  "zoominfo.com",
  "wikipedia.org",
  "openstreetmap.org",
  "doctolib.fr",
  "doctolib.de",
  "hotdoc.com.au",
  "healthengine.com.au",
  "practo.com",
  "bookdoc.com",
  "erufucare.com",
  "myclinic.com.my",
  "clinic.com",
  "dentist.com.au",
  "whitecoat.com.au",
  "dentalcare.com",
]);

const GENERIC_BUSINESS_WORDS = new Set([
  "dental",
  "dentist",
  "clinic",
  "clinics",
  "centre",
  "center",
  "practice",
  "practices",
  "medical",
  "group",
  "care",
  "health",
  "healthcare",
  "surgery",
  "family",
  "smile",
  "pty",
  "ltd",
  "sdn",
  "bhd",
  "inc",
  "llc",
  "and",
  "the",
  "for",
  "klinik",
  "pergigian",
]);

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function escapeOverpassLiteral(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').trim();
}

function parseBoundingBox(raw?: string[]): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const nums = raw.map((item) => Number(item));
  if (nums.some((num) => !Number.isFinite(num))) return null;
  return [nums[0], nums[1], nums[2], nums[3]];
}

function toOverpassAreaId(osmType: string, osmId: number): number | null {
  if (!Number.isInteger(osmId) || osmId <= 0) return null;
  if (osmType === "relation") return 3_600_000_000 + osmId;
  if (osmType === "way") return 2_400_000_000 + osmId;
  return null;
}

function candidateRank(item: NominatimCandidate): number {
  let score = 0;
  if (item.osm_type === "relation") score += 40;
  else if (item.osm_type === "way") score += 20;
  if (item.class === "boundary" || item.type === "administrative") score += 30;
  if (typeof item.importance === "number") score += item.importance * 10;
  return score;
}

export async function resolveOsmLocation(
  query: string,
  fetcher: OsmFetcher = fetch,
): Promise<OsmResolvedArea> {
  const clean = query.trim();
  if (!clean) {
    throw new OsmClientError("LOCATION_NOT_FOUND", "Enter a location for OpenStreetMap search.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
  try {
    const url = `${NOMINATIM_API}?q=${encodeURIComponent(clean)}&format=jsonv2&limit=5&addressdetails=1`;
    const response = await fetcher(url, {
      method: "GET",
      headers: {
        "User-Agent": OSM_USER_AGENT,
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (response.status === 429) {
      throw new OsmClientError(
        "RATE_LIMITED",
        "OpenStreetMap Nominatim rate-limited this location lookup. Wait a moment before trying again.",
      );
    }
    if (!response.ok) {
      throw new OsmClientError(
        "SERVICE_UNAVAILABLE",
        `OpenStreetMap Nominatim returned HTTP ${response.status} for "${clean}".`,
      );
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!Array.isArray(payload)) {
      throw new OsmClientError(
        "INVALID_RESPONSE",
        "OpenStreetMap Nominatim returned an unexpected response.",
      );
    }

    const valid = (payload as NominatimCandidate[]).filter(
      (item) =>
        typeof item.osm_type === "string" &&
        typeof item.osm_id === "number" &&
        typeof item.display_name === "string",
    );
    if (valid.length === 0) {
      throw new OsmClientError(
        "LOCATION_NOT_FOUND",
        `OpenStreetMap could not resolve "${clean}" as a geographic place or region.`,
      );
    }

    const best = [...valid].sort((a, b) => candidateRank(b) - candidateRank(a))[0];
    const osmType = String(best.osm_type);
    const osmId = Number(best.osm_id);

    return {
      requestedQuery: clean,
      displayName: String(best.display_name),
      osmType,
      osmId,
      areaId: toOverpassAreaId(osmType, osmId),
      boundingBox: parseBoundingBox(best.boundingbox),
    };
  } catch (error) {
    if (error instanceof OsmClientError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OsmClientError(
        "TIMEOUT",
        `OpenStreetMap Nominatim timed out while resolving "${clean}".`,
      );
    }
    throw new OsmClientError(
      "NETWORK_ERROR",
      `Ano could not reach OpenStreetMap Nominatim to resolve "${clean}".`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveOsmLocationsSequentially(
  locations: string[],
  fetcher: OsmFetcher = fetch,
  delayMs?: number,
): Promise<OsmResolvedArea[]> {
  const effectiveDelay = delayMs ?? (fetcher === fetch ? 1_050 : 0);
  const resolved: OsmResolvedArea[] = [];
  for (let index = 0; index < locations.length; index += 1) {
    if (index > 0 && effectiveDelay > 0) {
      await sleep(effectiveDelay);
    }
    resolved.push(await resolveOsmLocation(locations[index], fetcher));
  }
  return resolved;
}

export function buildNominatimPoiSearchUrl(
  area: OsmResolvedArea,
  tag: OsmTagFilter,
  limit = 40,
): string {
  const bbox = area.boundingBox;
  if (!bbox) {
    throw new OsmClientError(
      "LOCATION_NOT_FOUND",
      `OpenStreetMap did not return a bounding box for "${area.requestedQuery}".`,
    );
  }
  const safeLimit = Math.max(10, Math.min(40, Math.floor(limit)));
  // Nominatim boundingbox is [south, north, west, east]; viewbox expects left(west),top(north),right(east),bottom(south).
  const viewbox = `${bbox[2]},${bbox[1]},${bbox[3]},${bbox[0]}`;
  const query = `[${tag.key}=${tag.value}]`;
  return `${NOMINATIM_API}?q=${encodeURIComponent(query)}&format=jsonv2&bounded=1&viewbox=${encodeURIComponent(viewbox)}&limit=${safeLimit}&addressdetails=1&extratags=1`;
}

export function buildOverpassQuery(
  area: OsmResolvedArea,
  tags: OsmTagFilter[],
  fetchLimit = 60,
): string {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(fetchLimit)));
  const cleanTags = tags
    .map((tag) => ({
      key: escapeOverpassLiteral(tag.key),
      value: escapeOverpassLiteral(tag.value),
    }))
    .filter((tag) => tag.key && tag.value);

  if (area.areaId) {
    const clauses = cleanTags
      .map((tag) => `  nwr["${tag.key}"="${tag.value}"]["name"](area.searchArea);`)
      .join("\n");
    return `[out:json][timeout:25];\narea(${area.areaId})->.searchArea;\n(\n${clauses}\n);\nout center tags ${safeLimit};`;
  }

  const bbox = area.boundingBox;
  if (!bbox) {
    throw new OsmClientError(
      "LOCATION_NOT_FOUND",
      `OpenStreetMap did not return an area boundary or bounding box for "${area.requestedQuery}".`,
    );
  }
  // Nominatim boundingbox is [south, north, west, east]; Overpass expects (south,west,north,east).
  const bboxExpr = `${bbox[0]},${bbox[2]},${bbox[1]},${bbox[3]}`;
  const clauses = cleanTags
    .map((tag) => `  nwr["${tag.key}"="${tag.value}"]["name"](${bboxExpr});`)
    .join("\n");
  return `[out:json][timeout:25];\n(\n${clauses}\n);\nout center tags ${safeLimit};`;
}

function cleanWebsiteUrl(raw?: string): { website?: string; domain?: string } {
  if (!raw?.trim()) return {};
  const trimmed = raw.trim();
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
      return {};
    }
    const domain = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    return { website: parsed.toString(), domain };
  } catch {
    return {};
  }
}

function formatOsmAddress(tags: Record<string, string>) {
  const streetPart = [tags["addr:housenumber"], tags["addr:street"]]
    .filter(Boolean)
    .join(" ")
    .trim();
  const locality = [
    streetPart || tags["addr:full"] || tags["addr:place"],
    tags["addr:suburb"] || tags["addr:district"],
    tags["addr:city"] || tags["addr:town"],
    tags["addr:state"],
    tags["addr:postcode"],
    tags["addr:country"],
  ]
    .filter((item): item is string => Boolean(item && item.trim()))
    .join(", ");
  return locality || undefined;
}

function extractAreaCountryFallback(displayName: string) {
  const parts = displayName
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    city: parts.length > 1 ? parts[0] : undefined,
    country: parts.length > 0 ? parts[parts.length - 1] : undefined,
  };
}

function inferIndustryFromOsmTags(tags: Record<string, string>) {
  if (tags.amenity === "dentist" || tags.healthcare === "dentist") {
    return "Dental Clinic (OpenStreetMap)";
  }
  if (tags.amenity === "clinic" || tags.healthcare === "clinic") {
    return "Medical Clinic (OpenStreetMap)";
  }
  if (tags.amenity === "doctors" || tags.healthcare === "doctor") {
    return "Medical Practice (OpenStreetMap)";
  }
  if (tags.healthcare) return `Healthcare · ${tags.healthcare} (OpenStreetMap)`;
  if (tags.craft) return `Local Trade · ${tags.craft} (OpenStreetMap)`;
  if (tags.office) return `Professional Practice · ${tags.office} (OpenStreetMap)`;
  if (tags.amenity) return `Local Business · ${tags.amenity} (OpenStreetMap)`;
  if (tags.shop) return `Local Shop · ${tags.shop} (OpenStreetMap)`;
  return "OpenStreetMap Local Business";
}

function normaliseNominatimPoi(
  item: NominatimPoiItem,
  area: OsmResolvedArea,
  fallbackTag: OsmTagFilter,
): { company: NormalizedProspeoCompanyInput; qualityRank: number } | null {
  const name = item.name?.trim() || item.display_name?.split(",")[0]?.trim();
  if (!name) return null;

  const osmId =
    typeof item.osm_id === "number"
      ? item.osm_id
      : typeof item.place_id === "number"
        ? item.place_id
        : null;
  if (osmId === null) return null;

  const osmType = item.osm_type?.trim() || "place";
  const extra = item.extratags ?? {};
  const addr = item.address ?? {};

  const { website, domain } = cleanWebsiteUrl(
    extra.website || extra["contact:website"] || extra.url,
  );
  const phone =
    (extra.phone || extra["contact:phone"] || extra["contact:mobile"])?.trim() || undefined;

  const street = [addr.house_number, addr.road].filter(Boolean).join(" ").trim();
  const addressParts = [
    street,
    addr.suburb || addr.neighbourhood || addr.quarter,
    addr.city || addr.town || addr.village,
    addr.state,
    addr.postcode,
    addr.country,
  ].filter((part): part is string => Boolean(part && part.trim()));
  const address =
    addressParts.length > 0 ? addressParts.join(", ") : item.display_name?.trim() || undefined;

  const areaFallback = extractAreaCountryFallback(area.displayName);
  const city = (
    addr.city ||
    addr.town ||
    addr.village ||
    addr.suburb ||
    areaFallback.city
  )?.trim();
  const state = addr.state?.trim();
  const country = (addr.country || areaFallback.country)?.trim();

  const primaryKey = item.category?.trim() || fallbackTag.key;
  const primaryVal = item.type?.trim() || fallbackTag.value;
  const pickedOsmTags: Record<string, string> = { [primaryKey]: primaryVal };
  for (const key of ["opening_hours", "operator", "brand", "branch", "healthcare"]) {
    if (extra[key]?.trim()) pickedOsmTags[key] = extra[key].trim();
  }

  const osmUrl =
    item.osm_type && typeof item.osm_id === "number"
      ? `https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`
      : undefined;

  const descParts = [
    pickedOsmTags.operator ? `Operator: ${pickedOsmTags.operator}` : null,
    pickedOsmTags.opening_hours ? `Hours: ${pickedOsmTags.opening_hours}` : null,
    phone ? `Phone: ${phone}` : null,
    address ? `Address: ${address}` : null,
  ].filter(Boolean);

  let qualityRank = 0;
  if (website) qualityRank += 30;
  if (phone) qualityRank += 15;
  if (address) qualityRank += 10;
  if (extra["opening_hours"]) qualityRank += 5;

  return {
    qualityRank,
    company: {
      provider: "openstreetmap",
      id: `${osmType}-${osmId}`,
      name,
      website,
      domain,
      industry: inferIndustryFromOsmTags(pickedOsmTags),
      location: {
        city,
        state,
        country,
      },
      phone,
      address,
      description: descParts.join(" · ") || undefined,
      osmUrl,
      osmTags: pickedOsmTags,
      websiteSource: website ? "openstreetmap" : undefined,
    },
  };
}

function normaliseOverpassElement(
  element: OverpassElement,
  area: OsmResolvedArea,
): { company: NormalizedProspeoCompanyInput; qualityRank: number } | null {
  const tags = element.tags ?? {};
  const name = tags.name?.trim();
  if (!name) return null;

  const { website, domain } = cleanWebsiteUrl(
    tags.website || tags["contact:website"] || tags.url,
  );
  const phone =
    (tags.phone || tags["contact:phone"] || tags["contact:mobile"])?.trim() || undefined;
  const address = formatOsmAddress(tags);
  const areaFallback = extractAreaCountryFallback(area.displayName);
  const city = (
    tags["addr:city"] ||
    tags["addr:town"] ||
    tags["addr:suburb"] ||
    areaFallback.city
  )?.trim();
  const state = tags["addr:state"]?.trim();
  const country = (tags["addr:country"] || areaFallback.country)?.trim();
  const osmUrl = `https://www.openstreetmap.org/${element.type}/${element.id}`;

  const pickedOsmTags: Record<string, string> = {};
  for (const key of [
    "amenity",
    "healthcare",
    "craft",
    "office",
    "shop",
    "tourism",
    "leisure",
    "opening_hours",
    "operator",
    "brand",
    "branch",
  ]) {
    if (tags[key]?.trim()) pickedOsmTags[key] = tags[key].trim();
  }

  const descParts = [
    tags.description?.trim(),
    pickedOsmTags.operator ? `Operator: ${pickedOsmTags.operator}` : null,
    pickedOsmTags.opening_hours ? `Hours: ${pickedOsmTags.opening_hours}` : null,
    phone ? `Phone: ${phone}` : null,
    address ? `Address: ${address}` : null,
  ].filter(Boolean);

  let qualityRank = 0;
  if (website) qualityRank += 30;
  if (phone) qualityRank += 15;
  if (address) qualityRank += 10;
  if (tags["opening_hours"]) qualityRank += 5;

  return {
    qualityRank,
    company: {
      provider: "openstreetmap",
      id: `${element.type}-${element.id}`,
      name,
      website,
      domain,
      industry: inferIndustryFromOsmTags(tags),
      location: {
        city,
        state,
        country,
      },
      phone,
      address,
      description: descParts.join(" · ") || undefined,
      osmUrl,
      osmTags: pickedOsmTags,
      websiteSource: website ? "openstreetmap" : undefined,
    },
  };
}

export async function searchOsmBusinesses(
  input: {
    areas: OsmResolvedArea[];
    tags: OsmTagFilter[];
    limit?: number;
    excludedTerms?: string[];
    overpassUrl?: string;
    delayMs?: number;
  },
  fetcher: OsmFetcher = fetch,
): Promise<{
  companies: NormalizedProspeoCompanyInput[];
  totalMatchedRaw: number;
  queriedAreas: number;
}> {
  if (input.areas.length === 0 || input.tags.length === 0) {
    throw new OsmClientError(
      "LOCATION_NOT_FOUND",
      "OpenStreetMap discovery needs at least one resolved area and one category tag.",
    );
  }

  const limit = Math.max(1, Math.min(25, input.limit ?? 25));
  const customOverpassUrl =
    input.overpassUrl?.trim() || process.env.OVERPASS_API_URL?.trim() || "";
  const excludedLower = (input.excludedTerms ?? [])
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const deduped = new Map<string, { company: NormalizedProspeoCompanyInput; qualityRank: number }>();
  let totalMatchedRaw = 0;

  const recordCandidate = (entry: {
    company: NormalizedProspeoCompanyInput;
    qualityRank: number;
  } | null) => {
    if (!entry) return;
    const searchable = `${entry.company.name} ${entry.company.description ?? ""} ${Object.values(entry.company.osmTags ?? {}).join(" ")}`.toLowerCase();
    if (excludedLower.some((term) => searchable.includes(term))) {
      return;
    }
    const dedupeKey = `${entry.company.name.toLowerCase()}::${(entry.company.location?.city ?? "").toLowerCase()}`;
    const existing = deduped.get(dedupeKey);
    if (!existing || entry.qualityRank > existing.qualityRank) {
      deduped.set(dedupeKey, entry);
    }
  };

  if (customOverpassUrl) {
    const perAreaFetchLimit = Math.max(
      25,
      Math.min(100, Math.ceil((limit * 3) / input.areas.length)),
    );
    for (const area of input.areas) {
      const query = buildOverpassQuery(area, input.tags, perAreaFetchLimit);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

      let payload: unknown;
      try {
        const response = await fetcher(customOverpassUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": OSM_USER_AGENT,
            Accept: "application/json",
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal,
          cache: "no-store",
        });

        if (response.status === 429) {
          throw new OsmClientError(
            "RATE_LIMITED",
            "OpenStreetMap Overpass rate-limited this search. Ano did not retry automatically.",
          );
        }
        if (response.status === 504 || response.status === 408) {
          throw new OsmClientError(
            "TIMEOUT",
            `OpenStreetMap Overpass timed out querying "${area.displayName}". Try a narrower city or region.`,
          );
        }
        if (!response.ok) {
          throw new OsmClientError(
            "SERVICE_UNAVAILABLE",
            `OpenStreetMap Overpass returned HTTP ${response.status}. Ano did not retry automatically.`,
          );
        }
        payload = await response.json().catch(() => null);
      } catch (error) {
        if (error instanceof OsmClientError) throw error;
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new OsmClientError(
            "TIMEOUT",
            `OpenStreetMap Overpass timed out for "${area.displayName}". Try querying a specific city.`,
          );
        }
        throw new OsmClientError(
          "NETWORK_ERROR",
          "Ano could not reach OpenStreetMap Overpass. No automatic retry was attempted.",
        );
      } finally {
        clearTimeout(timer);
      }

      const elements =
        payload &&
        typeof payload === "object" &&
        "elements" in payload &&
        Array.isArray((payload as { elements?: unknown }).elements)
          ? (payload as { elements: OverpassElement[] }).elements
          : null;

      if (!elements) {
        throw new OsmClientError(
          "INVALID_RESPONSE",
          "OpenStreetMap Overpass returned a response Ano could not verify.",
        );
      }

      totalMatchedRaw += elements.length;
      for (const element of elements) {
        recordCandidate(normaliseOverpassElement(element, area));
      }
    }
  } else {
    const effectiveDelay = input.delayMs ?? (fetcher === fetch ? 1_050 : 0);
    const primaryTag = input.tags[0];

    for (let index = 0; index < input.areas.length; index += 1) {
      if (index > 0 && effectiveDelay > 0) {
        await sleep(effectiveDelay);
      }
      const area = input.areas[index];
      const url = buildNominatimPoiSearchUrl(area, primaryTag, 40);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_NOMINATIM_POI_TIMEOUT_MS);

      let payload: unknown;
      try {
        const response = await fetcher(url, {
          method: "GET",
          headers: {
            "User-Agent": OSM_USER_AGENT,
            Accept: "application/json",
          },
          signal: controller.signal,
          cache: "no-store",
        });

        if (response.status === 429) {
          throw new OsmClientError(
            "RATE_LIMITED",
            "OpenStreetMap Nominatim rate-limited this search. Wait a moment before running again; Ano did not retry automatically.",
          );
        }
        if (response.status === 504 || response.status === 408) {
          throw new OsmClientError(
            "TIMEOUT",
            `OpenStreetMap Nominatim timed out querying "${area.displayName}".`,
          );
        }
        if (!response.ok) {
          throw new OsmClientError(
            "SERVICE_UNAVAILABLE",
            `OpenStreetMap Nominatim returned HTTP ${response.status}. Ano did not retry automatically.`,
          );
        }

        payload = await response.json().catch(() => null);
      } catch (error) {
        if (error instanceof OsmClientError) throw error;
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new OsmClientError(
            "TIMEOUT",
            `OpenStreetMap Nominatim timed out while searching "${area.displayName}".`,
          );
        }
        throw new OsmClientError(
          "NETWORK_ERROR",
          "Ano could not reach OpenStreetMap Nominatim. No automatic retry was attempted.",
        );
      } finally {
        clearTimeout(timer);
      }

      if (!Array.isArray(payload)) {
        throw new OsmClientError(
          "INVALID_RESPONSE",
          "OpenStreetMap Nominatim returned a response Ano could not verify.",
        );
      }

      totalMatchedRaw += payload.length;
      for (const item of payload as NominatimPoiItem[]) {
        recordCandidate(normaliseNominatimPoi(item, area, primaryTag));
      }
    }
  }

  const ranked = Array.from(deduped.values())
    .sort((a, b) => b.qualityRank - a.qualityRank)
    .slice(0, limit)
    .map((item) => item.company);

  if (ranked.length === 0) {
    throw new OsmClientError(
      "NO_RESULTS",
      "OpenStreetMap returned no matching businesses inside that area for the selected tags.",
    );
  }

  return {
    companies: ranked,
    totalMatchedRaw,
    queriedAreas: input.areas.length,
  };
}

function isAggregatorHostname(hostname: string) {
  const lower = hostname.toLowerCase().replace(/^www\./, "");
  for (const blocked of AGGREGATOR_DOMAINS) {
    if (lower === blocked || lower.endsWith(`.${blocked}`)) {
      return true;
    }
  }
  return false;
}

function extractNameTokens(name: string) {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function matchesOfficialSiteCandidate(
  businessName: string,
  candidateUrl: string,
  candidateTitle?: string | null,
): { website: string; domain: string } | null {
  const parsedInfo = cleanWebsiteUrl(candidateUrl);
  if (!parsedInfo.website || !parsedInfo.domain) return null;
  if (isAggregatorHostname(parsedInfo.domain)) return null;

  const allTokens = extractNameTokens(businessName);
  const distinctiveTokens = allTokens.filter((token) => !GENERIC_BUSINESS_WORDS.has(token));
  const haystack = `${parsedInfo.domain} ${(candidateTitle ?? "").toLowerCase()}`;

  if (distinctiveTokens.length > 0) {
    const hasDistinctiveMatch = distinctiveTokens.some((token) => haystack.includes(token));
    return hasDistinctiveMatch ? { website: parsedInfo.website, domain: parsedInfo.domain } : null;
  }

  const matchedCount = allTokens.filter((token) => haystack.includes(token)).length;
  return matchedCount >= Math.min(2, allTokens.length) && matchedCount > 0
    ? { website: parsedInfo.website, domain: parsedInfo.domain }
    : null;
}

export async function enrichMissingOsmWebsitesWithSearxng(
  businesses: NormalizedProspeoCompanyInput[],
  options?: {
    maxLookups?: number;
    searchFn?: (query: string) => Promise<{
      results: Array<{ url: string; title?: string | null }>;
    }>;
  },
): Promise<{
  businesses: NormalizedProspeoCompanyInput[];
  resolvedCount: number;
  attemptedCount: number;
}> {
  const searchFn =
    options?.searchFn ??
    (searxngConfiguration().available
      ? (query: string) => searxngResearchProvider.search(query)
      : null);

  if (!searchFn) {
    return { businesses, resolvedCount: 0, attemptedCount: 0 };
  }

  const maxLookups = Math.max(0, Math.min(10, options?.maxLookups ?? 10));
  let attemptedCount = 0;
  let resolvedCount = 0;
  const updated: NormalizedProspeoCompanyInput[] = [];

  for (const business of businesses) {
    if (business.website || business.domain || attemptedCount >= maxLookups) {
      updated.push(business);
      continue;
    }

    attemptedCount += 1;
    const locality = [business.location?.city, business.location?.country]
      .filter(Boolean)
      .join(" ");
    const query = `"${business.name}" ${locality} official website`.trim();

    try {
      const response = await searchFn(query);
      let matched: { website: string; domain: string } | null = null;
      for (const result of response.results) {
        matched = matchesOfficialSiteCandidate(business.name, result.url, result.title);
        if (matched) break;
      }

      if (matched) {
        resolvedCount += 1;
        updated.push({
          ...business,
          website: matched.website,
          domain: matched.domain,
          websiteSource: "searxng",
        });
      } else {
        updated.push(business);
      }
    } catch {
      updated.push(business);
    }
  }

  return {
    businesses: updated,
    resolvedCount,
    attemptedCount,
  };
}

export { deriveOsmTagFilters };
