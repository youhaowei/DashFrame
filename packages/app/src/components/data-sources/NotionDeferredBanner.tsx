import { Surface } from "@wystack/ui";

/**
 * Replaces the Notion-specific UI in DataSourceControls / DataSourceDisplay
 * while the Notion integration is moved off web tRPC. Mounted whenever a
 * stored Notion data source is opened so users see explicit messaging
 * instead of dead controls that 404 against `/api/trpc`.
 *
 * Tracking: https://www.notion.so/360d48ccaf5481749ae1f0eeed29361b
 */
export function NotionDeferredBanner() {
  return (
    <div className="p-4">
      <Surface
        elevation="raised"
        className="space-y-2 p-4 text-sm text-neutral-fg-subtle"
      >
        <p className="font-medium text-neutral-fg">
          Notion is temporarily unavailable
        </p>
        <p>
          The Notion connector is being moved off the web app and into the
          desktop server. Your data source isn&apos;t affected — it&apos;ll be
          reachable once the new integration lands. Other data sources work
          normally.
        </p>
      </Surface>
    </div>
  );
}

/**
 * Feature flag — `true` now that the Notion router is hosted in the desktop
 * server and the connector is wired via the auth-blind server seam.
 */
export const NOTION_ENABLED = true;
