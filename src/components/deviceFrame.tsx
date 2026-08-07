// src/components/deviceFrame.tsx
// Chrome wrappers for the use-case device mockups. LaptopFrame draws a glass
// browser bar (three dots + fake URL chip) with a purple glow; PhoneFrame draws
// a 19.5:9 handset with a notch. Both take a `label` badge (e.g. "LIVE") and
// render arbitrary children — the animated mockups from useCaseVisuals.tsx.
import React from "react";

type FrameProps = {
  children: React.ReactNode;
  /** Small badge in the top-right (e.g. "LIVE"). Omit to hide. */
  label?: string;
  /** Fake URL chip text for the laptop bar. Defaults to the app host. */
  url?: string;
  /** Drop the screen padding so a screenshot sits edge-to-edge under the bar. */
  flush?: boolean;
};

export function LaptopFrame({ children, label, url = "app.trenchsports.ai", flush }: FrameProps) {
  return (
    <div className="ts-uc-laptop">
      <div className="ts-uc-laptopGlow" />
      <div className="ts-uc-laptopInner">
        <div className="ts-uc-laptopBar">
          <span className="ts-uc-dot" />
          <span className="ts-uc-dot" />
          <span className="ts-uc-dot" />
          <span className="ts-uc-urlChip">{url}</span>
          {label && <span className="ts-uc-badge">{label}</span>}
        </div>
        <div className={`ts-uc-laptopScreen ${flush ? "ts-uc-laptopScreen--flush" : ""}`}>{children}</div>
      </div>
    </div>
  );
}

export function PhoneFrame({ children, label, flush }: FrameProps) {
  return (
    <div className="ts-uc-phone">
      <div className="ts-uc-phoneGlow" />
      <div className="ts-uc-phoneInner">
        <div className="ts-uc-phoneNotch" />
        {label && <span className="ts-uc-badge ts-uc-badge--phone">{label}</span>}
        <div className={`ts-uc-phoneScreen ${flush ? "ts-uc-phoneScreen--flush" : ""}`}>{children}</div>
      </div>
    </div>
  );
}
