import type { ThreadStatusPill } from "./Sidebar.logic";

export function StatusIndicatorPill({
  indicator,
  hideLabelOnMobile = true,
}: {
  indicator: ThreadStatusPill;
  hideLabelOnMobile?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] ${indicator.colorClass} ${indicator.containerClass ?? ""}`}
      style={indicator.style}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${indicator.dotClass} ${
          indicator.pulse ? "animate-pulse" : ""
        }`}
        style={indicator.dotStyle}
      />
      <span className={hideLabelOnMobile ? "hidden md:inline" : undefined}>{indicator.label}</span>
    </span>
  );
}
