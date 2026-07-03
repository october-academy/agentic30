#!/usr/bin/env bash
# Founder OS Kit — e2e ground-truth capture (Tier 1: existing positive-path screenshots).
# Runs a hermetic UI test subset; screenshots land as XCTAttachments in the .xcresult.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

RESULT=".design-sync/reference-shots/capture.xcresult"
rm -rf "$RESULT"
mkdir -p .design-sync/reference-shots

export AGENTIC30_ALLOW_BLOCKING_UI_E2E=1

bash scripts/xcode-test.sh ui-full \
  -resultBundlePath "$RESULT" \
  -only-testing:agentic30UITests/agentic30UITests/testOpenDesignProjectsPageParitySmoke \
  -only-testing:agentic30UITests/agentic30UITests/testOpenDesignNewsPageParitySmoke \
  -only-testing:agentic30UITests/agentic30UITests/testOpenDesignInterviewsPageParitySmoke \
  -only-testing:agentic30UITests/agentic30UITests/testOpenDesignBipLogPageParitySmoke \
  -only-testing:agentic30UITests/agentic30UITests/testOpenDesignHistoryPrioritizesRetrospectiveAndKeepsEvidenceTimelineCollapsed \
  -only-testing:agentic30UITests/agentic30UITests/testOpenDesignDayPageParitySmoke \
  -only-testing:agentic30UITests/agentic30UITests/testOpenDesignDayHandoffFlowSmoke \
  -only-testing:agentic30UITests/agentic30UITests/testOpenDesignDayAlignmentFinalCardRendersStructuredRows \
  -only-testing:agentic30UITests/agentic30UITests/testOfficeHoursRunningStateShowsLiveStatus \
  -only-testing:agentic30UITests/agentic30UITests/testOfficeHoursCommitmentGateShowsDraftAndRequiresUserConfirmation \
  -only-testing:agentic30UITests/agentic30UITests/testOfficeHoursPastDayShowsCustomerEvidenceReviewSections \
  -only-testing:agentic30UITests/agentic30UITests/testStrategyRailOpensStrategyBusinessCanvasScreenWithMatrixAndSections \
  -only-testing:agentic30UITests/agentic30UITests/testMorningBriefingRailOpensBriefingScreenWithAllSections \
  -only-testing:agentic30UITests/agentic30UITests/testMorningBriefingFailureFixtureShowsStaleNoticeAndFailedSourceStates \
  -only-testing:agentic30UITests/agentic30UITests/testMorningBriefingDrilldownOpensPerSourceScreens \
  -only-testing:agentic30UITests/agentic30UITests/testAgentSettingsModelPickersSaveClaudeCodexAndGeminiModels \
  -only-testing:agentic30UITests/agentic30UITests/testSettingsIntegrationsShowsCompactMcpRowsAndHidesManualFields \
  -only-testing:agentic30UITests/agentic30UITests/testDay1SituationSummaryCardRendersOnWorkspaceSurface \
  -only-testing:agentic30UITests/agentic30UITests/testNewsRailShowsPreparingProgressBeforeFirstStatus

echo "CAPTURE_EXIT=$?"
