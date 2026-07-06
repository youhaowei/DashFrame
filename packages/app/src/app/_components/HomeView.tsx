import { QuickLinksSection } from "./QuickLinksSection";
import { RecentInsightsSection } from "./RecentInsightsSection";
import { RecentVisualizationsSection } from "./RecentVisualizationsSection";

/**
 * HomeView - Main view for returning users with existing data
 *
 * Displays recent visualizations, insights, and quick navigation links.
 */
export function HomeView() {
  return (
    <>
      <RecentVisualizationsSection />
      <RecentInsightsSection />
      <QuickLinksSection />
    </>
  );
}
