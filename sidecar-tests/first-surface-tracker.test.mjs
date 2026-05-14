import test from "node:test";
import assert from "node:assert/strict";

import {
  FIRST_SURFACE_TRACKER_SCHEMA_VERSION,
  hasFeatureSurfaced,
  makeDefaultFirstSurfaceRegistry,
  normalizeFirstSurfaceRegistry,
  recordFeatureSurfaceOnce,
  recordFirstSurface,
} from "../sidecar/first-surface-tracker.mjs";

test("recordFirstSurface returns true only for the first appearance of a feature", () => {
  const first = recordFirstSurface(makeDefaultFirstSurfaceRegistry(), {
    featureId: "action.auto_verification",
    surfacedAt: "2026-05-14T09:00:00.000Z",
    metadata: {
      dayId: 2,
      surface: "action_day_card",
    },
  });
  const repeat = recordFirstSurface(first.registry, {
    featureId: "action.auto_verification",
    surfacedAt: "2026-05-14T09:10:00.000Z",
  });

  assert.equal(first.registry.schemaVersion, FIRST_SURFACE_TRACKER_SCHEMA_VERSION);
  assert.equal(first.firstAppearance, true);
  assert.equal(first.isFirstAppearance, true);
  assert.equal(first.alreadySurfaced, false);
  assert.equal(first.reason, "first_appearance");
  assert.equal(first.surfaceRecord.firstSurfacedAt, "2026-05-14T09:00:00.000Z");
  assert.equal(first.surfaceRecord.metadata.dayId, 2);
  assert.equal(repeat.firstAppearance, false);
  assert.equal(repeat.is_first_appearance, false);
  assert.equal(repeat.alreadySurfaced, true);
  assert.equal(repeat.reason, "already_surfaced");
  assert.equal(
    repeat.registry.surfacedFeatures["action.auto_verification"].firstSurfacedAt,
    "2026-05-14T09:00:00.000Z",
  );
});

test("recordFirstSurface tracks each feature independently", () => {
  const firstAction = recordFirstSurface({}, {
    featureId: "action.auto_verification",
    surfacedAt: "2026-05-14T09:00:00.000Z",
  });
  const firstReview = recordFirstSurface(firstAction.registry, {
    featureId: "review.summary_dashboard",
    surfacedAt: "2026-05-14T09:05:00.000Z",
  });
  const repeatAction = recordFirstSurface(firstReview.registry, {
    featureId: "action.auto_verification",
    surfacedAt: "2026-05-14T09:06:00.000Z",
  });

  assert.equal(firstAction.firstAppearance, true);
  assert.equal(firstReview.firstAppearance, true);
  assert.equal(repeatAction.firstAppearance, false);
  assert.deepEqual(
    Object.keys(repeatAction.registry.surfacedFeatures).sort(),
    [
      "action.auto_verification",
      "review.summary_dashboard",
    ],
  );
});

test("recordFeatureSurfaceOnce stores the registry inside progress state", () => {
  const first = recordFeatureSurfaceOnce(
    {
      workspaceId: "workspace-a",
    },
    {
      featureId: "education.interactive_worksheet",
      surfacedAt: "2026-05-14T09:00:00.000Z",
    },
  );
  const repeat = recordFeatureSurfaceOnce(first.state, {
    featureId: "education.interactive_worksheet",
    surfacedAt: "2026-05-14T10:00:00.000Z",
  });

  assert.equal(first.firstAppearance, true);
  assert.equal(first.state.workspaceId, "workspace-a");
  assert.equal(first.state.firstSurfaceRegistry, first.state.first_surface_registry);
  assert.equal(repeat.firstAppearance, false);
  assert.equal(
    repeat.state.firstSurfaceRegistry.surfacedFeatures["education.interactive_worksheet"].firstSurfacedAt,
    "2026-05-14T09:00:00.000Z",
  );
});

test("legacy seen feature state is treated as already surfaced", () => {
  const registry = normalizeFirstSurfaceRegistry({
    seenFeatureIds: ["workspace.settings"],
    first_surfaces: {
      "workspace.switcher": true,
      "workspace.help": {
        seen: true,
        seenAt: "2026-05-14T08:30:00.000Z",
      },
    },
  });
  const settings = recordFirstSurface(registry, {
    featureId: "workspace.settings",
    surfacedAt: "2026-05-14T09:00:00.000Z",
  });
  const help = recordFirstSurface(registry, {
    featureId: "workspace.help",
    surfacedAt: "2026-05-14T09:00:00.000Z",
  });

  assert.equal(hasFeatureSurfaced(registry, "workspace.settings"), true);
  assert.equal(hasFeatureSurfaced(registry, "workspace.switcher"), true);
  assert.equal(hasFeatureSurfaced(registry, "workspace.help"), true);
  assert.equal(settings.firstAppearance, false);
  assert.equal(help.firstAppearance, false);
  assert.equal(help.surfaceRecord.firstSurfacedAt, "2026-05-14T08:30:00.000Z");
});

test("missing feature id does not mutate state or report first appearance", () => {
  const initial = makeDefaultFirstSurfaceRegistry("2026-05-14T08:00:00.000Z");
  const result = recordFirstSurface(initial, {
    featureId: "   ",
    surfacedAt: "2026-05-14T09:00:00.000Z",
  });

  assert.equal(result.firstAppearance, false);
  assert.equal(result.alreadySurfaced, false);
  assert.equal(result.reason, "missing_feature_id");
  assert.deepEqual(result.registry.surfacedFeatures, {});
});
