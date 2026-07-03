import { MorningBriefingScreen } from "../mirror/src/components/screens/MorningBriefingScreen";

// FULL-SCREEN preview — MorningBriefingScreen composes the entire 오늘 아침 브리핑
// window: rail + scroll-spy 브리핑 outline sidebar + titlebar + (판정 → 소스 근거 →
// 증거 퍼널) main + (30일 진행 · 동기화 소스 · 이상 신호 · 어제 대비 · 다음) meta.
// Faithful mirror of the app's MorningBriefing* surface, verified against
// reference-shots/Morning_Briefing_Screen.png (connected) and
// Morning_Briefing_Failed_Source_States.png (Cloudflare 수집 실패).
// Takes only an optional `height` + a `failed` flag. Frame at a realistic window size.
const canvas = {
  background: "var(--ds-page)",
  padding: 0,
  width: 1360,
  fontFamily: "var(--ds-sans)",
};

// Default — all four sources connected; the overnight digest reads normally.
export const Connected = () => (
  <div style={canvas}>
    <MorningBriefingScreen height={900} />
  </div>
);

// Failed-source variant — Cloudflare collection fails: a sync-failed banner joins
// the digest, the Cloudflare source card falls to a SurfaceState error, the chip
// row + meta panel mark Cloudflare 수집 실패 / 미연결.
export const FailedSource = () => (
  <div style={canvas}>
    <MorningBriefingScreen height={900} failed />
  </div>
);
