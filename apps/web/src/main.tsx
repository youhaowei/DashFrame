import "@dashframe/app/globals.css";

import { HostedAccessScreen } from "@/components/hosted-access/HostedAccessScreen";
import { ThemeProvider } from "@/components/theme-provider";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

import { createBrowserApp } from "./bootstrap/browser-app";
import { SignOutProvider, startHostSession } from "@dashframe/app";

const container = document.getElementById("root");
if (!container) throw new Error("Root container #root not found");
const root = createRoot(container);
const override = import.meta.env?.VITE_DASHFRAME_URL;
const hostUrl = override && !import.meta.env.DEV ? override : location.origin;
const session = startHostSession({
  hostUrl,
  createRuntime: createBrowserApp,
  publish(view) {
    let content;
    if (view.status === "admitted") {
      content = (
        <SignOutProvider onSignOut={view.onSignOut}>
          {view.runtime.element}
        </SignOutProvider>
      );
    } else if (view.status === "local-ready") {
      content = view.runtime.element;
    } else {
      content = (
        <ThemeProvider>
          <HostedAccessScreen {...view} />
        </ThemeProvider>
      );
    }
    // Flush provider cleanup before the controller closes its Convex client.
    flushSync(() => root.render(<StrictMode>{content}</StrictMode>));
  },
  unmount: () => root.unmount(),
});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    return session.teardown();
  });
