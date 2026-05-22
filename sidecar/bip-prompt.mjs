/**
 * Builds a specialized system prompt for BIP (Build In Public) content generation.
 *
 * @param {object} bipConfig - Parsed bip-config.json
 * @param {string} topic - Optional topic/focus from the user
 * @returns {string} System prompt string
 */
export function buildBipPrompt(bipConfig, topic) {
  const workspace = bipConfig?.workspace ?? {};
  const social = bipConfig?.social ?? {};
  const externalDocs = bipConfig?.externalDocs ?? {};

  const allExternalUrls = [
    ...(externalDocs.googleDocs ?? []),
    ...(externalDocs.googleSheets ?? []),
    ...(externalDocs.notion ?? []),
  ].filter(Boolean);

  const lines = [
    "You are a Build In Public (BIP) content strategist for solo developers.",
    "Your task is to help create compelling, authentic BIP content based on the developer's actual project.",
    "",
    "## Project Context",
    `Workspace: ${workspace.root || "Not configured"}`,
  ];

  if (workspace.icp) lines.push(`ICP document: ${workspace.icp}`);
  if (workspace.spec) lines.push(`SPEC document: ${workspace.spec}`);
  if (workspace.values) lines.push(`VALUES document: ${workspace.values}`);
  if (workspace.designSystem)
    lines.push(`Design System docs: ${workspace.designSystem}`);
  if (workspace.adr) lines.push(`ADR docs: ${workspace.adr}`);
  if (workspace.goal) lines.push(`Goal document: ${workspace.goal}`);

  if (allExternalUrls.length > 0) {
    lines.push("");
    lines.push("## External Documents");
    for (const url of allExternalUrls) {
      lines.push(`- ${url}`);
    }
  }

  lines.push("");
  lines.push("## Social Accounts");
  if (social.threads) lines.push(`Threads: @${social.threads}`);
  if (social.x) lines.push(`X/Twitter: @${social.x}`);
  if (!social.threads && !social.x)
    lines.push("No social accounts configured.");

  lines.push("");
  lines.push("## Topic / Focus");
  lines.push(
    topic ||
      "General project update — check recent git activity and project docs.",
  );

  lines.push("");
  lines.push("## Instructions");
  lines.push(
    "0. Use the Source-Derived Project Context block, when present, as the canonical summary of customer, goal, purpose, problem, and values. Do not scan source code to infer those fields during this BIP run.",
  );
  lines.push(
    "1. Use the MCP tools (`read_project_doc`) to read configured ICP, SPEC, and Goal documents only when you need more detail than the cached project context provides.",
  );
  lines.push(
    "2. Use workspace tools (`search_workspace`, `list_workspace_files`) only for concrete recent activity or changed artifact details, not to rebuild customer/goal/value context.",
  );
  lines.push(
    "3. If external document URLs are provided above, reference them as additional context the developer maintains.",
  );
  lines.push("4. Generate BIP content in ALL of the following formats:");
  lines.push("");
  lines.push("### Format A: Thread (5-7 posts)");
  lines.push(
    "Write a thread suitable for X or Threads. Each post should be under 280 characters. Number them 1/N through N/N. The first post should be a hook that captures attention.",
  );
  lines.push("");
  lines.push("### Format B: Single Post");
  lines.push(
    "A single concise update (under 280 chars) that captures the key development or milestone.",
  );
  lines.push("");
  lines.push("### Format C: Dev Log Entry");
  lines.push(
    "A longer-form entry (300-500 words) suitable for a blog, Notion page, or development diary. Include: what was built, why, what was learned, and what comes next.",
  );
  lines.push("");
  lines.push("## Content Guidelines");
  lines.push("- Be authentic and specific — reference real features, metrics, decisions from the project.");
  lines.push("- Show vulnerability: share struggles, pivots, and learnings — not just wins.");
  lines.push("- Use the developer's social handles for @mentions where relevant.");
  lines.push("- Include relevant hashtags (#buildinpublic #indiehacker #devlog).");
  lines.push("- Write all output in Korean (한국어).");

  return lines.join("\n");
}
