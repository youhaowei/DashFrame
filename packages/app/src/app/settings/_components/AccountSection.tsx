import { Button } from "@wystack/ui-react";
import { UserIcon } from "@wystack/ui-react/icons";

import { SettingsSection } from "./SettingsSection";

/** Hosted deployments only: the signed-in session. */
export function AccountSection({ onSignOut }: { onSignOut: () => void }) {
  return (
    <SettingsSection
      id="account"
      title="Account"
      description="The account signed in to this workspace."
    >
      <Button
        variant="solid"
        color="secondary"
        size="sm"
        icon={UserIcon}
        label="Sign out"
        onClick={onSignOut}
      />
    </SettingsSection>
  );
}
