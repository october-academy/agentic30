import { QuestionCard } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const wrap = { ...canvas, maxWidth: 620 };

const highlight = (text: string) => (
  <span
    style={{
      background: "var(--ds-accent-dim)",
      border: "1px solid var(--ds-accent-line)",
      color: "var(--ds-accent)",
      borderRadius: "var(--ds-r-chip)",
      padding: "1px 8px",
      whiteSpace: "nowrap",
    }}
  >
    {text}
  </span>
);

export const DemandQuestion = () => (
  <div style={wrap}>
    <QuestionCard
      eyebrow="질문 1 · DEMAND · 1 / 6"
      question={<>가장 강한 수요 증거가 뭐야? 관심 말고, 없어지면 실제로 곤란해지는 {highlight("행동이나 돈의 증거")}.</>}
      options={["돈을 냈거나 제안함", "업무에 이미 의존함", "강한 workaround 있음", "아직 실제 증거 없음"]}
      selectedIndex={0}
      hint="예: 3명이 매주 같은 수작업을 하고 있고 1명은 유료 파일럿을 물어봤어요."
    />
  </div>
);

export const Freeform = () => (
  <div style={wrap}>
    <QuestionCard
      eyebrow="질문 2 · SPECIFICITY · 2 / 6"
      question="그 고객이 지금 이 문제를 어떻게 억지로 해결하고 있어?"
      hint="구체적인 툴·사람·시간을 그대로 적어 주세요."
      freeform
    />
  </div>
);

export const Submitted = () => (
  <div style={wrap}>
    <QuestionCard
      eyebrow="질문 1 · DEMAND · 1 / 6"
      question={<>가장 강한 수요 증거가 뭐야? 관심 말고, 없어지면 실제로 곤란해지는 {highlight("행동이나 돈의 증거")}.</>}
      options={["돈을 냈거나 제안함", "업무에 이미 의존함", "강한 workaround 있음", "아직 실제 증거 없음"]}
      selectedIndex={1}
      submitted
      hint="제출됨 · 다음 질문으로 넘어갑니다."
    />
  </div>
);
