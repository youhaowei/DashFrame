import React from "react";

// Vite has no SSR — children always render on the client. Kept as a passthrough
// so legacy call sites continue to compile; remove with the rest of the Next
// compat layer once consumers stop importing it.
export const NoSSR = ({ children }: { children: React.ReactNode }) => (
  <React.Fragment>{children}</React.Fragment>
);
