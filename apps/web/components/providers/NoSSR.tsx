"use client";

import dynamic from "next/dynamic";
import React from "react";

const ClientOnlyWrapper = (props: { children: React.ReactNode }) => (
  <React.Fragment>{props.children}</React.Fragment>
);

export const NoSSR = dynamic(() => Promise.resolve(ClientOnlyWrapper), {
  ssr: false,
});
