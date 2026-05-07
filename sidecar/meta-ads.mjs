const API_VERSION = "v22.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

export class MetaAdsClient {
  #accessToken;
  #adAccountId;
  #signal;

  constructor({ accessToken, adAccountId, signal }) {
    this.#accessToken = accessToken;
    this.#adAccountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    this.#signal = signal;
  }

  // ---------- Public API ----------

  async fetchFullReport(url) {
    const report = {
      url,
      fetchedAt: new Date().toISOString(),
      campaigns: [],
      adSets: [],
      ads: [],
      errors: [],
    };

    // 1. Find ads linking to this URL
    const ads = await this.#findAdsByUrl(url);
    if (ads.error) {
      report.errors.push(ads.error);
      // Try fetching all active campaigns as fallback
      const campaigns = await this.#listActiveCampaigns();
      if (campaigns.error) {
        report.errors.push(campaigns.error);
        return report;
      }
      report.campaigns = await this.#enrichCampaigns(campaigns.data, report.errors);
      return report;
    }

    report.ads = ads.data;

    // 2. Collect unique campaign IDs from found ads
    const campaignIds = [...new Set(ads.data.map((ad) => ad.campaign_id).filter(Boolean))];

    if (campaignIds.length === 0) {
      // No campaigns linked — try listing all active campaigns
      const campaigns = await this.#listActiveCampaigns();
      if (campaigns.error) {
        report.errors.push(campaigns.error);
      } else {
        report.campaigns = await this.#enrichCampaigns(campaigns.data, report.errors);
      }
      return report;
    }

    // 3. Fetch campaign details and insights in parallel
    report.campaigns = await this.#enrichCampaigns(
      campaignIds.map((id) => ({ id })),
      report.errors,
    );

    // 4. Fetch ad-level insights
    for (const ad of report.ads) {
      const insights = await this.#getInsights(ad.id, "ad");
      if (insights.error) {
        report.errors.push(insights.error);
      } else {
        ad.insights = insights.data;
      }
    }

    return report;
  }

  // ---------- Private Helpers ----------

  async #findAdsByUrl(url) {
    const filtering = JSON.stringify([
      {
        field: "effective_object_story_spec.link_data.link",
        operator: "CONTAIN",
        value: url,
      },
    ]);

    const fields = "id,name,status,creative{effective_object_story_id,object_story_spec},campaign_id,adset_id";
    const params = new URLSearchParams({
      fields,
      filtering,
      limit: "100",
      access_token: this.#accessToken,
    });

    return this.#request(`${BASE_URL}/${this.#adAccountId}/ads?${params}`);
  }

  async #listActiveCampaigns() {
    const params = new URLSearchParams({
      fields: "id,name,status,objective,daily_budget,lifetime_budget",
      effective_status: '["ACTIVE","PAUSED"]',
      limit: "50",
      access_token: this.#accessToken,
    });

    return this.#request(`${BASE_URL}/${this.#adAccountId}/campaigns?${params}`);
  }

  async #enrichCampaigns(campaigns, errors) {
    const enriched = [];

    for (const campaign of campaigns) {
      const entry = { ...campaign, insights: null, demographics: null, placements: null };

      // Fetch overall insights
      const overall = await this.#getInsights(campaign.id, "campaign");
      if (overall.error) {
        errors.push(overall.error);
      } else {
        entry.insights = overall.data;
      }

      // Fetch demographic breakdown
      const demo = await this.#getInsights(campaign.id, "campaign", "age,gender");
      if (demo.error) {
        errors.push(demo.error);
      } else {
        entry.demographics = demo.data;
      }

      // Fetch placement breakdown
      const placement = await this.#getInsights(campaign.id, "campaign", "publisher_platform,device_platform");
      if (placement.error) {
        errors.push(placement.error);
      } else {
        entry.placements = placement.data;
      }

      enriched.push(entry);
    }

    return enriched;
  }

  async #getInsights(objectId, level, breakdowns) {
    const fields = [
      "impressions",
      "clicks",
      "ctr",
      "cpc",
      "cpm",
      "spend",
      "actions",
      "cost_per_action_type",
      "purchase_roas",
      "reach",
      "frequency",
    ].join(",");

    const params = new URLSearchParams({
      fields,
      date_preset: "last_30d",
      level,
      access_token: this.#accessToken,
    });

    if (breakdowns) {
      params.set("breakdowns", breakdowns);
    }

    return this.#request(`${BASE_URL}/${objectId}/insights?${params}`);
  }

  async #request(url, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, { signal: this.#signal });

        if (response.status === 429 && attempt < retries) {
          const wait = Math.pow(2, attempt + 1) * 1000;
          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }

        const json = await response.json();

        if (json.error) {
          const code = json.error.code;
          let message = `Meta API error (${code}): ${json.error.message}`;
          if (code === 190) {
            message = "Meta access token expired or invalid. Please update in Settings (Cmd+,).";
          }
          return { error: message, data: [] };
        }

        return { data: json.data || [], error: null };
      } catch (error) {
        if (error.name === "AbortError") throw error;
        if (attempt === retries) {
          return { error: `Meta API request failed: ${error.message}`, data: [] };
        }
      }
    }

    return { error: "Meta API request failed after retries.", data: [] };
  }
}
