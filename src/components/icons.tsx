/** Inline stroke icons (decorative unless labelled by their parent). */

type P = { size?: number; color?: string; className?: string };
const base = (size: number, color: string, width = 2) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color,
  strokeWidth: width, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
});

export const TrendIcon = ({ size = 16, color = "#FFFFFF" }: P) => (
  <svg {...base(size, color, 2.25)}><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>
);
export const SpinnerIcon = ({ size = 16, color = "currentColor", className = "spin" }: P) => (
  <svg {...base(size, color, 2.5)} className={className}><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
);
export const ChevronRight = ({ size = 16, color = "#667085" }: P) => (
  <svg {...base(size, color)} style={{ marginTop: 2 }}><path d="m9 18 6-6-6-6" /></svg>
);
export const WarningIcon = ({ size = 20, color = "currentColor" }: P) => (
  <svg {...base(size, color)}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
);
export const InfoIcon = ({ size = 20, color = "currentColor" }: P) => (
  <svg {...base(size, color)}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></svg>
);
export const CloseIcon = ({ size = 16, color = "currentColor" }: P) => (
  <svg {...base(size, color)}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
);
export const CheckIcon = ({ size = 18, color = "#75E0A7" }: P) => (
  <svg {...base(size, color, 2.25)}><path d="M20 6 9 17l-5-5" /></svg>
);
export const CheckCircleIcon = ({ size = 28, color = "#17B26A" }: P) => (
  <svg {...base(size, color)}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>
);
export const ClipboardIcon = ({ size = 32, color = "#98A2B3" }: P) => (
  <svg {...base(size, color, 1.75)}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="m9 12 2 2 4-4" /></svg>
);
