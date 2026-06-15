# Agentic30 Business Strategy Data

> Verified at: 2026-06-15 KST
> Public copy rule: do not copy private pilot, customer, transcript, BIP, telemetry, or alignment-cache raw text into public docs or UI. Use anonymized counts and evidence classes only.

This file is the source sheet for the Strategy / Business Canvas screen. Each user-facing strategy claim should be traceable to a public source, a public-safe internal evidence summary, or both.

## Evidence Schema

| Field | Meaning |
|---|---|
| `source` | Public URL, internal module/doc path, or private evidence class. |
| `verifiedAt` | Date the source was checked. |
| `evidenceType` | `public_market`, `public_competitor`, `internal_product`, `internal_private_safe`, or `strategy_rubric`. |
| `publicSafeSummary` | Short statement safe for public repo and product UI. |
| `strategyImplication` | How this changes positioning, canvas, SWOT, or matrix scoring. |

## Scoring Rubric

| Axis | 0-30 | 31-60 | 61-80 | 81-100 |
|---|---|---|---|---|
| `adaptiveScore` | Static content, school, or one-off report. | Workflow, checklist, or AI-generated assets. | Personalized workflow or code/project context. | Local execution records drive repeated next actions. |
| `evidenceScore` | Learning, content, or build output. | Interviews, research, community feedback, or accountability. | Funnel behavior, outreach replies, source-linked demand, or structured validation. | Paid ask, payment record, activation event, or automated customer behavior proof. |

Scores are not market share estimates. They are positioning coordinates for how close each alternative is to Agentic30's intended wedge: local-first adaptive PMF and first-revenue evidence loops for full-time solo developers.

## Market Claims

| Claim | source | verifiedAt | evidenceType | publicSafeSummary | strategyImplication |
|---|---|---|---|---|---|
| AI coding is mainstream among developers. | https://survey.stackoverflow.co/2025/ai | 2026-06-15 | public_market | Stack Overflow 2025 reports 84% of respondents use or plan to use AI tools, and 50.6% of professional developers use them daily. | Agentic30 should assume the ICP already has coding leverage; the product should sell evidence discipline, not coding speed. |
| AI-enabled dev tools are visible in normal IDE workflows. | https://survey.stackoverflow.co/2025/technology | 2026-06-15 | public_market | Stack Overflow 2025 lists Cursor at 19.3% and Claude Code at 10.0% usage among professional developers. | Cursor/Claude Code/Codex are ecosystem partners and build-speed competitors, not the same category as Agentic30. |
| AI output still needs human verification. | https://survey.stackoverflow.co/2025/ai | 2026-06-15 | public_market | Stack Overflow 2025 reports more developers distrust AI accuracy than trust it. | The screen should avoid "AI will decide your strategy"; Agentic30 narrows evidence work and forces verification. |
| Developer output is accelerating. | https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/ | 2026-06-15 | public_market | GitHub Octoverse 2025 reports record activity, including 43.2M merged PRs per month on average and strong growth in AI-related repositories. | The strategic pain is no longer "can I build?" but "did building create customer behavior or revenue evidence?" |
| No-market-need risk remains the core startup failure frame used by competitors. | https://indiefounders.net/ | 2026-06-15 | public_competitor | IndieFounders uses the common startup-failure framing around market need and revenue-first building. | Agentic30 can share the revenue-first diagnosis while differentiating on software-driven daily evidence loops. |

## Competitor Evidence

| Competitor | source | verifiedAt | evidenceType | publicSafeSummary | strategyImplication |
|---|---|---|---|---|---|
| Agentic30 | `docs/SPEC.md`, `docs/ICP.md`, `docs/VALUES.md`, `docs/specs/agentic30-30day-adaptive-program.md` | 2026-06-15 | internal_product | Local macOS app + Node sidecar; reads workspace, interview/BIP/work logs; intended Day 14 measurement and paid ask gates. | Score high on adaptivity and high on intended evidence, but copy must say private pilot / validation stage, not public launch. |
| Spark Claw | https://www.sparkclaw.co.kr/ | 2026-06-15 | public_competitor | SparkLabs program for AI-native solo/small-team founders; includes investment, credits, office hours, group sessions, and community. | Strong overlap with Korean AI solo founders, but people/investment/gate-led rather than local daily software loop. |
| IndieFounders | https://indiefounders.net/ | 2026-06-15 | public_competitor | Korean revenue-first indie founder school/community with lectures and offline sprint roadmap. | Direct message overlap on first revenue; classify as school/community, not software. |
| classbinu | https://www.threads.com/@classbinu | 2026-06-15 | public_competitor | User-designated channel/person context connected to IndieFounders. Treat as operator/channel evidence, not a standalone competitor. | Mention only in source sheet; UI competitor remains IndieFounders. |
| 마켓테스트 | https://www.markettest.kr/ | 2026-06-15 | public_competitor | Tracks ads, purchase clicks, surveys, funnel drop-off, and downloadable reports. | High evidence score for campaign-level demand proof; low adaptivity because it is not a daily project-record loop. |
| Icanpreneur | https://www.icanpreneur.com/ | 2026-06-15 | public_competitor | AI co-founder platform for customer validation, personas, GTM strategy, and launch assets. | Medium-high validation workflow; less local execution-record adaptation. |
| SparkLaunch | https://sparklaun.ch/startup-validation | 2026-06-15 | public_competitor | Startup validation workflow capturing buyer, pain, landing-page demand, outreach, objections, and decision thresholds. | High evidence workflow benchmark; still web workflow rather than macOS local evidence loop. |
| Preuve AI | https://preuve.ai/idea-validation | 2026-06-15 | public_competitor | Source-linked idea validation report using live sources and competitor/demand scans. | Strong report credibility; one-shot report format keeps adaptivity lower. |
| Ship 30 for 30 | https://www.ship30for30.com/ | 2026-06-15 | public_competitor | 30-day writing and audience-building curriculum/community. | Competes on 30-day rhythm and accountability, not PMF or paid evidence. |
| Buildspace | https://buildspace.so/ | 2026-06-15 | public_competitor | Historical builder community now shut down. | Keep as historical benchmark only, not active threat. |
| AI 솔로프리너 클럽 | https://www.solopreneur.co.kr/ | 2026-06-15 | public_competitor | Korean membership with creator, builder, and sales tracks plus community/coaching. | Strong audience/sales execution alternative; not local software. |
| CoFounder.im | https://cofounder.im/ | 2026-06-15 | public_competitor | AI assistant for market research, business modeling, and pitch assets. | Strategy-document automation competitor; lower customer behavior evidence. |
| FounderPal | https://founderpal.ai/ | 2026-06-15 | public_competitor | AI marketing tools for solo founders and indie makers. | GTM asset competitor; low PMF evidence enforcement. |
| Cursor | https://cursor.com/ | 2026-06-15 | public_competitor | AI coding agent/editor across desktop, CLI, web/mobile, Slack, and GitHub contexts. | High codebase adaptivity; low PMF evidence because customer interviews and paid asks stay outside the tool. |
| Replit Agent | https://replit.com/products/agent | 2026-06-15 | public_competitor | Browser IDE and agent for building production-ready apps from prompts. | Strong build-speed alternative; PMF evidence remains outside. |
| Lovable | https://lovable.dev/ | 2026-06-15 | public_competitor | AI app builder for apps, websites, internal tools, and prototypes. | Strong launch/prototype competitor; lower evidence enforcement. |
| YC Startup School | https://www.startupschool.org/ | 2026-06-15 | public_competitor | Free online startup course with weekly progress accountability and co-founder matching. | Strong benchmark for founder education/accountability; static/global relative to Agentic30's local Korean solo-developer loop. |
| 오즈 1인 창업가 캠프 | https://ozcodingschool.com/ozcoding/solofoundercamp | 2026-06-15 | public_competitor | Selected 120-day online solo SaaS founder camp with AI production tools and VC demo day. | Korean education/build-to-production competitor; not 30-day personal evidence OS. |
| 코배투 런칭챌린지 | https://www.cobaetoo.com/oneMonthChallenge | 2026-06-15 | public_competitor | One-month launch challenge with daily logs, weekly Zoom wrap-up, member feedback, and refund incentive. | Strong rhythm/accountability benchmark; evidence comes from group pressure, not local records. |

## Internal Evidence Handling

| Internal evidence class | source | verifiedAt | evidenceType | publicSafeSummary | strategyImplication |
|---|---|---|---|---|---|
| Private alignment cache | `docs/private/alignment/README.md` | 2026-06-15 | internal_private_safe | This folder may contain founder/company planning details and is ignored by git. | Never copy raw contents into public strategy copy. Use only redacted summaries. |
| Product source docs | `docs/SPEC.md`, `docs/ICP.md`, `docs/VALUES.md` | 2026-06-15 | internal_product | Current source docs define full-time solo developer, first revenue, macOS, AI coding tools, and record-sharing willingness. | UI should keep the narrow ICP and avoid broad "AI cofounder" positioning. |
| 30-day program spec | `docs/specs/agentic30-30day-adaptive-program.md` | 2026-06-15 | internal_product | The spec defines paid ask, first_value, PostHog activation, proof-ledger, and final continue/pivot/stop evidence. | Canvas and SWOT should name paid ask and activation evidence instead of generic PMF language. |
| Runtime evidence modules | `sidecar/*evidence*`, `sidecar/program-gate-engine.mjs`, `sidecar/telemetry.mjs` | 2026-06-15 | internal_product | Sidecar has proof/evidence/telemetry modules but the business strategy screen is static reference copy. | Public screen can state the intended evidence model, not claim live market traction unless summarized separately. |

