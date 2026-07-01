// Inline line icons (1.8 stroke, round caps) — matches the Agentic30 mockups.
// Not exported as design-system components; consumed internally by other parts.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

export const CheckIcon = (props: IconProps) => (
  <svg {...base(props)}><path d="M20 6 9 17l-5-5" /></svg>
);

export const PlusIcon = (props: IconProps) => (
  <svg {...base(props)}><path d="M12 5v14M5 12h14" /></svg>
);

export const PencilIcon = (props: IconProps) => (
  <svg {...base(props)}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
);

export const AlertIcon = (props: IconProps) => (
  <svg {...base(props)}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
);

export const ClipboardCheckIcon = (props: IconProps) => (
  <svg {...base(props)}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
);

export const CircleAlertIcon = (props: IconProps) => (
  <svg {...base(props)}><circle cx="12" cy="12" r="9" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
);

export const RefreshIcon = (props: IconProps) => (
  <svg {...base(props)}><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></svg>
);

export const CalendarIcon = (props: IconProps) => (
  <svg {...base(props)}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
);

export const DotsIcon = (props: IconProps) => (
  <svg {...base(props)}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
);

export const ArrowRightIcon = (props: IconProps) => (
  <svg {...base(props)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
