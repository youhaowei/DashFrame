import React, { lazy } from "react";

const ClientOnlyWrapper = (props: { children: React.ReactNode }) => (
  <React.Fragment>{props.children}</React.Fragment>
);

export const NoSSR = lazy(() =>
  Promise.resolve({ default: ClientOnlyWrapper }),
);
