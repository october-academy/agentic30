import { Titlebar } from "founder-os-kit";

// Full-width window titlebar; set an explicit width so the centered breadcrumb
// and right-aligned tool actions separate the way they do in the app window.
const canvas = {
  background: "var(--ds-page)",
  padding: 0,
  width: 900,
  fontFamily: "var(--ds-sans)",
};

// Projects screen: "프로젝트 / 포트폴리오 + 소스 루트" + default search/refresh/sidebar icons.
export const Projects = () => (
  <div style={canvas}>
    <Titlebar breadcrumb={{ page: "프로젝트", detail: "포트폴리오 + 소스 루트" }} />
  </div>
);

// News screen: "뉴스 / 안 읽음 17건".
export const News = () => (
  <div style={canvas}>
    <Titlebar breadcrumb={{ page: "뉴스", detail: "안 읽음 17건" }} />
  </div>
);
