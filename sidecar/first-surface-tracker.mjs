export const FIRST_SURFACE_TRACKER_SCHEMA_VERSION = 1;

export function makeDefaultFirstSurfaceRegistry(now = null) {
  return {
    schemaVersion: FIRST_SURFACE_TRACKER_SCHEMA_VERSION,
    schema: "agentic30.first_surface_tracker.v1",
    createdAt: now ? toIso(now) : "",
    created_at: now ? toIso(now) : "",
    surfacedFeatures: {},
    surfaced_features: {},
  };
}

export function normalizeFirstSurfaceRegistry(value = {}) {
  const raw = objectOrEmpty(value);
  const defaults = makeDefaultFirstSurfaceRegistry();
  const rawRecords = objectOrEmpty(
    raw.surfacedFeatures
      ?? raw.surfaced_features
      ?? raw.firstSurfaces
      ?? raw.first_surfaces
      ?? raw.features,
  );
  const legacyFeatureIds = normalizeStringArray(
    raw.surfacedFeatureIds
      ?? raw.surfaced_feature_ids
      ?? raw.seenFeatureIds
      ?? raw.seen_feature_ids
      ?? raw.seenFeatures
      ?? raw.seen_features,
  );
  const surfacedFeatures = {};

  for (const featureId of legacyFeatureIds) {
    surfacedFeatures[featureId] = normalizeSurfaceRecord({
      featureId,
      surfaced: true,
    });
  }

  for (const [rawFeatureId, rawRecord] of Object.entries(rawRecords)) {
    const rawRecordObject = rawRecord === true ? { surfaced: true } : objectOrEmpty(rawRecord);
    const featureId = normalizeFeatureId(rawRecordObject.featureId ?? rawRecordObject.feature_id ?? rawFeatureId);
    if (!featureId) continue;
    surfacedFeatures[featureId] = normalizeSurfaceRecord({
      ...rawRecordObject,
      featureId,
    });
  }

  return {
    ...defaults,
    ...raw,
    schemaVersion: FIRST_SURFACE_TRACKER_SCHEMA_VERSION,
    schema: "agentic30.first_surface_tracker.v1",
    surfacedFeatures,
    surfaced_features: surfacedFeatures,
  };
}

export function hasFeatureSurfaced(registry = {}, featureId = "") {
  const normalized = normalizeFirstSurfaceRegistry(registry);
  const targetFeatureId = normalizeFeatureId(featureId);
  return Boolean(targetFeatureId && normalized.surfacedFeatures[targetFeatureId]?.surfaced === true);
}

export function recordFirstSurface(
  registry = {},
  {
    featureId = "",
    surfacedAt = new Date(),
    metadata = {},
  } = {},
) {
  const normalized = normalizeFirstSurfaceRegistry(registry);
  const targetFeatureId = normalizeFeatureId(featureId);
  if (!targetFeatureId) {
    return {
      registry: normalized,
      featureId: "",
      feature_id: "",
      firstAppearance: false,
      first_appearance: false,
      isFirstAppearance: false,
      is_first_appearance: false,
      alreadySurfaced: false,
      already_surfaced: false,
      surfaceRecord: null,
      surface_record: null,
      reason: "missing_feature_id",
    };
  }

  const existingRecord = normalized.surfacedFeatures[targetFeatureId];
  const alreadySurfaced = existingRecord?.surfaced === true;
  const timestamp = toIso(surfacedAt);
  const surfaceRecord = alreadySurfaced
    ? existingRecord
    : normalizeSurfaceRecord({
        featureId: targetFeatureId,
        surfaced: true,
        firstSurfacedAt: timestamp,
        surfaceCount: 1,
        metadata,
      });
  const surfacedFeatures = alreadySurfaced
    ? normalized.surfacedFeatures
    : {
        ...normalized.surfacedFeatures,
        [targetFeatureId]: surfaceRecord,
      };
  const nextRegistry = alreadySurfaced
    ? normalized
    : normalizeFirstSurfaceRegistry({
        ...normalized,
        updatedAt: timestamp,
        updated_at: timestamp,
        surfacedFeatures,
        surfaced_features: surfacedFeatures,
      });
  const firstAppearance = !alreadySurfaced;

  return {
    registry: nextRegistry,
    featureId: targetFeatureId,
    feature_id: targetFeatureId,
    firstAppearance,
    first_appearance: firstAppearance,
    isFirstAppearance: firstAppearance,
    is_first_appearance: firstAppearance,
    alreadySurfaced,
    already_surfaced: alreadySurfaced,
    surfaceRecord,
    surface_record: surfaceRecord,
    reason: firstAppearance ? "first_appearance" : "already_surfaced",
  };
}

export function recordFeatureSurfaceOnce(
  state = {},
  {
    featureId = "",
    surfacedAt = new Date(),
    registryKey = "firstSurfaceRegistry",
    metadata = {},
  } = {},
) {
  const rawState = objectOrEmpty(state);
  const rawRegistry = rawState[registryKey]
    ?? rawState.firstSurfaceRegistry
    ?? rawState.first_surface_registry
    ?? rawState.firstSurfaceTracker
    ?? rawState.first_surface_tracker
    ?? {};
  const result = recordFirstSurface(rawRegistry, {
    featureId,
    surfacedAt,
    metadata,
  });
  const firstSurfaceRegistry = result.registry;

  return {
    ...result,
    state: {
      ...rawState,
      [registryKey]: firstSurfaceRegistry,
      firstSurfaceRegistry,
      first_surface_registry: firstSurfaceRegistry,
    },
  };
}

function normalizeSurfaceRecord(value = {}) {
  const raw = objectOrEmpty(value);
  const featureId = normalizeFeatureId(raw.featureId ?? raw.feature_id);
  const firstSurfacedAt = stringOrDefault(
    raw.firstSurfacedAt
      ?? raw.first_surfaced_at
      ?? raw.surfacedAt
      ?? raw.surfaced_at
      ?? raw.seenAt
      ?? raw.seen_at,
    "",
  );
  const surfaced = raw.surfaced === true
    || raw.seen === true
    || raw.hasSurfaced === true
    || raw.has_surfaced === true
    || Boolean(firstSurfacedAt);
  const surfaceCount = normalizePositiveInteger(
    raw.surfaceCount ?? raw.surface_count ?? raw.seenCount ?? raw.seen_count,
    surfaced ? 1 : 0,
  );

  return {
    ...raw,
    featureId,
    feature_id: featureId,
    surfaced,
    firstSurfacedAt,
    first_surfaced_at: firstSurfacedAt,
    surfaceCount,
    surface_count: surfaceCount,
    metadata: objectOrEmpty(raw.metadata),
  };
}

function normalizeFeatureId(value) {
  return String(value ?? "").trim();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeFeatureId(entry))
    .filter(Boolean);
}

function normalizePositiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrDefault(value, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
