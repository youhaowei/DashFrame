import { ThemePanel } from "@wystack/ui-react/views";

import { SettingsSection } from "./SettingsSection";

/** Theme mode and style preset, stdui's own controls, stored per device. */
export function AppearanceSection() {
  return (
    <SettingsSection
      id="appearance"
      title="Appearance"
      description="How DashFrame looks on this device."
    >
      <ThemePanel isOpen inline />
    </SettingsSection>
  );
}
