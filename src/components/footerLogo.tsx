// src/components/footerLogo.tsx
// Theme-aware brand logo for the footer. Renders both light/dark variants and
// lets CSS toggle visibility off the :root[data-theme] attribute — no JS theme
// state needed, so it drops into any static footer.
import React from "react";

import logoDark from "../images/NEW Master TS Logo Enhancement Set 1-03.png";
import logoLight from "../images/NEW Master TS Logo Enhancement Set 1-01.png";

export default function FooterLogo() {
  return (
    <>
      <img className="ts-footerLogo ts-footerLogo--dark" src={logoDark} alt="Trench Sports" />
      <img className="ts-footerLogo ts-footerLogo--light" src={logoLight} alt="Trench Sports" />
    </>
  );
}
