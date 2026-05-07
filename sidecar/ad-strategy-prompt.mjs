/**
 * Builds a system prompt for the /analyze-ads command.
 *
 * @param {string} url - The landing page URL being analyzed
 * @param {object} metaData - Report from MetaAdsClient.fetchFullReport()
 * @param {boolean} posthogAvailable - Whether PostHog MCP is configured
 * @returns {string} System prompt for Claude
 */
export function buildAdStrategyPrompt(url, metaData, posthogAvailable) {
  const metaSection = formatMetaData(metaData);
  const posthogSection = posthogAvailable
    ? POSTHOG_INSTRUCTIONS
    : "PostHog is not configured. Analysis will rely on Meta Ads data only.";

  return `You are an expert digital advertising strategist and performance marketing analyst.
Your task is to analyze ad performance data for a landing page and produce a comprehensive improvement strategy.

## Target Landing Page
${url}

## Meta Ads Performance Data
${metaSection}

## PostHog Analytics
${posthogSection}

## Required Analysis Sections

Produce your analysis in the following structure, using markdown formatting:

### 1. Executive Summary
- 3-sentence overview of overall ad performance
- Highlight the most critical finding and top opportunity

### 2. UTM Parameter Analysis
- Traffic source breakdown (which utm_source / utm_medium drive the most quality traffic)
- Campaign attribution analysis
- Channel-level performance comparison
${posthogAvailable ? "- Use PostHog HogQL to query: SELECT properties.$utm_source, properties.$utm_medium, count() as visits, countIf(event = 'sign_up' OR event = '$autocapture') as conversions FROM events WHERE properties.$current_url LIKE '%${url}%' AND timestamp >= now() - INTERVAL 30 DAY GROUP BY 1, 2 ORDER BY visits DESC" : "- (Skipped: PostHog not configured)"}

### 3. Scroll Depth Analysis
- Content engagement metrics for the landing page
- Average scroll depth by traffic source
- Correlation between scroll depth and conversion
${posthogAvailable ? "- Use PostHog HogQL to query scroll_depth events filtered by page_url containing the target URL" : "- (Skipped: PostHog not configured)"}

### 4. Conversion Funnel Analysis
- Step-by-step conversion funnel (pageview → engagement → conversion)
- Drop-off rates at each stage
- Funnel performance by campaign/source
${posthogAvailable ? "- Use PostHog to create funnel analysis from $pageview → key engagement event → conversion event" : "- (Skipped: PostHog not configured)"}

### 5. Campaign Performance Metrics
- CPC, CTR, CPM, ROAS analysis per campaign
- Identify top-performing and underperforming campaigns
- Spend efficiency analysis
- Benchmark comparison (industry averages: CTR ~0.9%, CPC ~$1.72, CVR ~9.21% for Facebook)

### 6. Demographic & Placement Insights
- Age and gender performance breakdown
- Platform performance (Facebook vs Instagram vs Audience Network)
- Device breakdown (mobile vs desktop)
- Identify highest-ROI audience segments

### 7. Actionable Recommendations
Provide 5-7 specific, prioritized recommendations:
- Each must reference actual data points from the analysis
- Include expected impact (high/medium/low)
- Specify implementation steps
- Categorize: Quick Wins (1-2 days), Medium-term (1-2 weeks), Strategic (1+ month)

## Guidelines
- Be specific with numbers. Always cite actual metrics.
- If data is missing or incomplete, note it clearly and adjust analysis scope.
- Focus on actionable insights, not generic advice.
- Use tables for metric comparisons where appropriate.
- Write in Korean (한국어) since the user communicates in Korean.`;
}

function formatMetaData(metaData) {
  if (!metaData || (metaData.campaigns.length === 0 && metaData.ads.length === 0)) {
    return "No Meta Ads data was found for this URL. The analysis will be based on general best practices and any PostHog data available.";
  }

  const lines = [];

  if (metaData.errors.length > 0) {
    lines.push(`### Data Collection Notes`);
    lines.push(`Some API calls encountered issues: ${metaData.errors.join("; ")}`);
    lines.push("");
  }

  lines.push(`### Campaigns (${metaData.campaigns.length})`);
  lines.push("```json");
  lines.push(JSON.stringify(metaData.campaigns, null, 2));
  lines.push("```");

  if (metaData.ads.length > 0) {
    lines.push("");
    lines.push(`### Ads (${metaData.ads.length})`);
    lines.push("```json");
    lines.push(JSON.stringify(metaData.ads, null, 2));
    lines.push("```");
  }

  return lines.join("\n");
}

const POSTHOG_INSTRUCTIONS = `You have access to PostHog analytics via MCP tools. Use them proactively to enrich your analysis:

1. **UTM Traffic Data** — Query HogQL for pageview events with UTM properties for the target URL
2. **Scroll Depth** — Query for scroll_depth custom events to measure content engagement
3. **Conversion Events** — Query for sign_up, purchase, or other conversion events
4. **Funnel Analysis** — Create funnels from pageview → engagement → conversion
5. **Session Duration** — Analyze time-on-page metrics by traffic source

Use the PostHog MCP query tools to run HogQL queries. Example:
\`\`\`sql
SELECT
  properties.$utm_source AS source,
  properties.$utm_campaign AS campaign,
  count() AS sessions,
  avg(toFloat64OrNull(properties.max_scroll_pct)) AS avg_scroll_depth,
  countIf(event = 'sign_up') AS conversions
FROM events
WHERE
  properties.$current_url LIKE '%TARGET_URL%'
  AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY source, campaign
ORDER BY sessions DESC
\`\`\`

Query PostHog BEFORE writing your analysis so you can include real data.`;
