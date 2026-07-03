import { ProviderCard, Badge } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const col = { ...canvas, display: "flex", flexDirection: "column" as const, gap: 10, maxWidth: 460 };

export const Providers = () => (
  <div style={col}>
    <ProviderCard
      name="Claude"
      detail="Claude Code 로그인 · Opus 4.8"
      icon="✳"
      connected
      status={<Badge tone="accent" dot>연결됨</Badge>}
    />
    <ProviderCard
      name="Codex"
      detail="GPT-5.5 · 웹 검색 도구"
      icon="◇"
      connected
      status={<Badge tone="accent" dot>연결됨</Badge>}
    />
    <ProviderCard
      name="GitHub"
      detail="9개 레포 watch · 소스 루트"
      icon="⌥"
      status={<Badge neutral>대기</Badge>}
    />
  </div>
);

export const Integrations = () => (
  <div style={col}>
    <ProviderCard
      name="PostHog"
      detail="release 빌드만 전송 · DEBUG 무전송"
      connected
      status={<Badge tone="accent" mono>측정 중</Badge>}
    />
    <ProviderCard
      name="Cloudflare"
      detail="OAuth 미연결"
      status={<Badge tone="amber" mono>연결 필요</Badge>}
    />
    <ProviderCard
      name="Notion"
      detail="인증 실패 · 토큰 만료"
      status={<Badge tone="rose" dot>오류</Badge>}
    />
  </div>
);
