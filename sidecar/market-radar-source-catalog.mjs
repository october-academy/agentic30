const TRUST_TIER_SCORES = Object.freeze({
  primary: 3,
  practitioner: 2,
  community: 1,
  unknown: 0,
});

export const MARKET_RADAR_TRUSTED_SOURCE_CATALOG = deepFreeze([
  {
    key: "posthog-handbook",
    domain: "posthog.com",
    pathPrefix: "/handbook",
    label: "PostHog Handbook",
    category: "company_handbook",
    trustTier: "primary",
    lanes: ["icp", "problem", "channel", "platform"],
    allowedUse: "Evergreen product and company-building practice; corroborate live market claims with current evidence.",
  },
  {
    key: "paul-graham-essays",
    domain: "paulgraham.com",
    pathPrefix: "",
    label: "Paul Graham Essays",
    category: "founder_essay",
    trustTier: "primary",
    lanes: ["icp", "problem", "channel"],
    allowedUse: "Founder principles and interpretation; not sufficient alone for current market trend claims.",
  },
  {
    key: "yc-library",
    domain: "ycombinator.com",
    pathPrefix: "/library",
    label: "Y Combinator Library",
    category: "accelerator_library",
    trustTier: "primary",
    lanes: ["icp", "problem", "alternatives_pricing", "channel"],
    allowedUse: "Startup operating guidance and repeatable founder patterns.",
  },
  {
    key: "lennys-newsletter",
    domain: "lennysnewsletter.com",
    pathPrefix: "",
    label: "Lenny's Newsletter",
    category: "newsletter",
    trustTier: "practitioner",
    lanes: ["icp", "problem", "alternatives_pricing", "channel"],
    allowedUse: "Product and growth operator synthesis; cite only publicly accessible metadata or excerpts.",
  },
  {
    key: "indie-hackers",
    domain: "indiehackers.com",
    pathPrefix: "",
    label: "Indie Hackers",
    category: "community",
    trustTier: "community",
    lanes: ["icp", "alternatives_pricing", "channel"],
    allowedUse: "Community demand, founder anecdotes, and pricing signals; never enough alone for strong confidence.",
  },
  {
    key: "levels-io",
    domain: "levels.io",
    pathPrefix: "",
    label: "levels.io",
    category: "builder_blog",
    trustTier: "primary",
    lanes: ["problem", "alternatives_pricing", "channel", "platform"],
    allowedUse: "First-person single-builder operating lessons and constraints.",
  },
  {
    key: "a-smart-bear",
    domain: "longform.asmartbear.com",
    pathPrefix: "",
    label: "A Smart Bear Longform",
    category: "pmf_playbook",
    trustTier: "primary",
    lanes: ["icp", "problem", "alternatives_pricing", "channel"],
    allowedUse: "Evergreen SaaS strategy, pricing, and positioning patterns.",
  },
  {
    key: "first-round-review",
    domain: "review.firstround.com",
    pathPrefix: "",
    label: "First Round Review",
    category: "operator_interview",
    trustTier: "practitioner",
    lanes: ["icp", "problem", "channel"],
    allowedUse: "Operator interviews and startup execution playbooks.",
  },
  {
    key: "mom-test",
    domain: "momtestbook.com",
    pathPrefix: "",
    label: "The Mom Test",
    category: "customer_discovery",
    trustTier: "primary",
    lanes: ["icp", "problem"],
    allowedUse: "Customer interview principles and evidence-quality checks.",
  },
  {
    key: "jtbd",
    domain: "jobstobedone.org",
    pathPrefix: "",
    label: "Jobs to be Done",
    category: "customer_discovery",
    trustTier: "primary",
    lanes: ["icp", "problem", "alternatives_pricing"],
    allowedUse: "Demand and switching-behavior framing.",
  },
  {
    key: "rewired-group",
    domain: "therewiredgroup.com",
    pathPrefix: "",
    label: "The Re-Wired Group",
    category: "customer_discovery",
    trustTier: "primary",
    lanes: ["icp", "problem", "alternatives_pricing"],
    allowedUse: "JTBD interview method and switching-buyer analysis.",
  },
  {
    key: "april-dunford",
    domain: "aprildunford.substack.com",
    pathPrefix: "",
    label: "April Dunford",
    category: "positioning_growth",
    trustTier: "practitioner",
    lanes: ["icp", "problem", "channel"],
    allowedUse: "Positioning and category-design guidance.",
  },
  {
    key: "demand-curve-resources",
    domain: "demandcurve.com",
    pathPrefix: "/resources",
    label: "Demand Curve Resources",
    category: "positioning_growth",
    trustTier: "practitioner",
    lanes: ["channel", "alternatives_pricing", "icp"],
    allowedUse: "Growth tactics and acquisition-channel patterns.",
  },
  {
    key: "copyhackers",
    domain: "copyhackers.com",
    pathPrefix: "/blog",
    label: "Copyhackers Blog",
    category: "positioning_growth",
    trustTier: "practitioner",
    lanes: ["problem", "channel"],
    allowedUse: "Conversion copy and customer-language patterns.",
  },
  {
    key: "growth-design",
    domain: "growth.design",
    pathPrefix: "/case-studies",
    label: "Growth.Design Case Studies",
    category: "ux_case_study",
    trustTier: "practitioner",
    lanes: ["problem", "channel", "platform"],
    allowedUse: "UX and onboarding case studies; corroborate market claims separately.",
  },
  {
    key: "shape-up",
    domain: "basecamp.com",
    pathPrefix: "/shapeup",
    label: "Shape Up",
    category: "product_process",
    trustTier: "primary",
    lanes: ["problem", "platform"],
    allowedUse: "Small-team product process and scoping principles.",
  },
  {
    key: "37signals-thoughts",
    domain: "37signals.com",
    pathPrefix: "/thoughts",
    label: "37signals Long Thoughts",
    category: "company_handbook",
    trustTier: "primary",
    lanes: ["problem", "channel", "platform"],
    allowedUse: "Bootstrapped company operating principles and product tradeoffs.",
  },
  {
    key: "bootstrapped-founder",
    domain: "thebootstrappedfounder.com",
    pathPrefix: "",
    label: "The Bootstrapped Founder",
    category: "newsletter",
    trustTier: "practitioner",
    lanes: ["icp", "alternatives_pricing", "channel"],
    allowedUse: "Bootstrapped founder lessons and audience-building patterns.",
  },
  {
    key: "startups-for-rest-of-us",
    domain: "startupsfortherestofus.com",
    pathPrefix: "",
    label: "Startups For the Rest of Us",
    category: "operator_interview",
    trustTier: "practitioner",
    lanes: ["icp", "alternatives_pricing", "channel"],
    allowedUse: "Bootstrapped SaaS operator interviews and examples.",
  },
  {
    key: "microconf",
    domain: "microconf.com",
    pathPrefix: "",
    label: "MicroConf",
    category: "operator_interview",
    trustTier: "practitioner",
    lanes: ["icp", "alternatives_pricing", "channel"],
    allowedUse: "Bootstrapped SaaS talks, examples, and operator guidance.",
  },
  {
    key: "justin-jackson",
    domain: "justinjackson.ca",
    pathPrefix: "",
    label: "Justin Jackson",
    category: "builder_blog",
    trustTier: "primary",
    lanes: ["icp", "problem", "channel"],
    allowedUse: "Founder-owned SaaS and audience-building lessons.",
  },
  {
    key: "mtlynch",
    domain: "mtlynch.io",
    pathPrefix: "",
    label: "mtlynch.io",
    category: "builder_blog",
    trustTier: "primary",
    lanes: ["problem", "alternatives_pricing", "channel", "platform"],
    allowedUse: "Transparent solo-builder retrospectives and product experiments.",
  },
  {
    key: "balsamiq-blog",
    domain: "balsamiq.com",
    pathPrefix: "/blog",
    label: "Balsamiq Blog",
    category: "company_handbook",
    trustTier: "primary",
    lanes: ["problem", "channel", "platform"],
    allowedUse: "Long-running bootstrapped product company lessons.",
  },
  {
    key: "chartmogul-insights",
    domain: "chartmogul.com",
    pathPrefix: "/insights",
    label: "ChartMogul Insights",
    category: "metrics_benchmark",
    trustTier: "primary",
    lanes: ["alternatives_pricing", "icp"],
    allowedUse: "SaaS pricing, subscription metrics, and benchmark evidence.",
  },
  {
    key: "stripe-atlas-guides",
    domain: "stripe.com",
    pathPrefix: "/guides/atlas-guides",
    label: "Stripe Atlas Guides",
    category: "startup_operations",
    trustTier: "primary",
    lanes: ["alternatives_pricing", "platform"],
    allowedUse: "Startup operations, payments, and pricing fundamentals.",
  },
  {
    key: "product-hunt",
    domain: "producthunt.com",
    pathPrefix: "",
    label: "Product Hunt",
    category: "launch_channel",
    trustTier: "community",
    lanes: ["channel", "alternatives_pricing", "icp"],
    allowedUse: "Launch visibility and competitive surface; not sufficient alone for strong confidence.",
  },
  {
    key: "hacker-news-show",
    domain: "news.ycombinator.com",
    pathPrefix: "/show",
    label: "Hacker News Show HN",
    category: "launch_channel",
    trustTier: "community",
    lanes: ["channel", "problem", "platform"],
    allowedUse: "Developer launch feedback and community reactions; not sufficient alone for strong confidence.",
  },
  {
    key: "disquiet",
    domain: "disquiet.io",
    pathPrefix: "",
    label: "Disquiet",
    category: "korea_first_channel",
    trustTier: "community",
    lanes: ["channel", "icp"],
    allowedUse: "Korean-first startup and maker community signal; not sufficient alone for strong confidence.",
  },
  {
    key: "eopla",
    domain: "eopla.net",
    pathPrefix: "",
    label: "EO Planet",
    category: "korea_first_channel",
    trustTier: "community",
    lanes: ["channel", "icp"],
    allowedUse: "Korean-first product/startup community signal; not sufficient alone for strong confidence.",
  },
]);

export function trustedSourcesForLane(laneId = "", { localeProfile = null } = {}) {
  const sources = !laneId
    ? MARKET_RADAR_TRUSTED_SOURCE_CATALOG
    : MARKET_RADAR_TRUSTED_SOURCE_CATALOG.filter((source) => source.lanes.includes(laneId));
  return orderTrustedSourcesForLocale(sources, localeProfile);
}

export function trustedSourcesForMarketRadarPrompt(laneId = "", { localeProfile = null } = {}) {
  return trustedSourcesForLane(laneId, { localeProfile }).map((source) => ({
    key: source.key,
    label: source.label,
    domain: source.domain,
    pathPrefix: source.pathPrefix,
    category: source.category,
    trustTier: source.trustTier,
    lanes: source.lanes,
    allowedUse: source.allowedUse,
  }));
}

export function buildTrustedSourceQueriesForLane({
  laneId = "",
  querySeeds = [],
  localeProfile = null,
  maxQueries = 12,
} = {}) {
  const sources = trustedSourcesForLane(laneId, { localeProfile });
  const seeds = normalizeQuerySeeds(querySeeds).slice(0, 3);
  const queries = [];
  if (seeds.length === 0) return queries;
  for (const source of sources) {
    const site = source.pathPrefix ? `site:${source.domain}${source.pathPrefix}` : `site:${source.domain}`;
    for (const seed of seeds) {
      const query = normalizeQuery(`${site} ${seed}`);
      if (!query || queries.includes(query)) continue;
      queries.push(query);
      if (queries.length >= maxQueries) return queries;
    }
  }
  return queries;
}

function orderTrustedSourcesForLocale(sources = [], localeProfile = null) {
  const primaryLanguage = String(localeProfile?.primaryLanguage || localeProfile?.primary_language || "").toLowerCase();
  if (primaryLanguage !== "ko") {
    return [...sources].sort((a, b) => (
      MARKET_RADAR_TRUSTED_SOURCE_CATALOG.indexOf(a) - MARKET_RADAR_TRUSTED_SOURCE_CATALOG.indexOf(b)
    ));
  }
  return [...sources].sort((a, b) => {
    const koreanDelta = Number(isKoreanFirstTrustedSource(b)) - Number(isKoreanFirstTrustedSource(a));
    if (koreanDelta !== 0) return koreanDelta;
    return MARKET_RADAR_TRUSTED_SOURCE_CATALOG.indexOf(a) - MARKET_RADAR_TRUSTED_SOURCE_CATALOG.indexOf(b);
  });
}

function isKoreanFirstTrustedSource(source = {}) {
  return source.category === "korea_first_channel"
    || source.key === "disquiet"
    || source.key === "eopla";
}

export function annotateMarketRadarSourceTrust(source = {}) {
  const match = findTrustedSourceMatch(source);
  if (!match) {
    return {
      sourceKey: null,
      label: null,
      category: "unknown",
      trustTier: "unknown",
      score: 0,
    };
  }
  return {
    sourceKey: match.key,
    label: match.label,
    category: match.category,
    trustTier: match.trustTier,
    score: TRUST_TIER_SCORES[match.trustTier] || 0,
  };
}

export function marketRadarSourceTrustScore(trustTier = "") {
  return TRUST_TIER_SCORES[trustTier] || 0;
}

function findTrustedSourceMatch(source = {}) {
  const url = String(source.url || "").trim();
  const rawDomain = source.domain || domainFromUrl(url);
  const domain = normalizeDomain(rawDomain);
  if (!domain) return null;
  let pathname = "";
  if (url) {
    try {
      pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
    } catch {
      pathname = "";
    }
  }
  return MARKET_RADAR_TRUSTED_SOURCE_CATALOG.find((candidate) => {
    if (!domainMatches(domain, candidate.domain)) return false;
    if (!candidate.pathPrefix) return true;
    if (!pathname) return false;
    const prefix = candidate.pathPrefix.replace(/\/+$/, "") || "/";
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }) || null;
}

function normalizeQuerySeeds(querySeeds = []) {
  const seeds = [];
  for (const seed of Array.isArray(querySeeds) ? querySeeds : []) {
    const query = normalizeQuery(seed);
    if (!query || seeds.includes(query)) continue;
    seeds.push(query);
  }
  return seeds;
}

function normalizeQuery(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 220);
}

function domainFromUrl(rawUrl = "") {
  try {
    return new URL(String(rawUrl || "")).hostname;
  } catch {
    return "";
  }
}

function normalizeDomain(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^www\./, "").split("/")[0].split(":")[0];
  }
}

function domainMatches(domain = "", candidate = "") {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedCandidate = normalizeDomain(candidate);
  return normalizedDomain === normalizedCandidate || normalizedDomain.endsWith(`.${normalizedCandidate}`);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return Object.freeze(value);
}
