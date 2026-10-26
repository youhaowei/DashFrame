import { useHostMutation } from "@/data/host";
import { CONNECTOR_SIGN_IN_EXPIRED, type UUID } from "@dashframe/types";
import { Button } from "@wystack/ui-react";
import { RefreshIcon } from "@wystack/ui-react/icons";
import { useState } from "react";
import { toast } from "sonner";

/** Key this control by table ID so pending state stays with its target. */
export function RefreshTableButton({
  tableId,
  tableName,
  size,
  onSignInExpired,
}: {
  tableId: UUID;
  tableName: string;
  size?: "sm";
  /** Offered from the failure when the source's sign-in has expired. */
  onSignInExpired?: () => void;
}) {
  const { mutateAsync: refreshDataTable } = useHostMutation("refreshDataTable");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const result = await refreshDataTable({ tableId });
      if (result.status === "failed") {
        const message = `Could not refresh ${tableName}: ${result.message}`;
        if (result.code === CONNECTOR_SIGN_IN_EXPIRED && onSignInExpired)
          toast.error(message, {
            action: { label: "Sign in again", onClick: onSignInExpired },
          });
        else toast.error(message);
      } else toast.success(`${tableName} refreshed`);
    } catch {
      toast.error(
        `Could not refresh ${tableName}. Check the connection and try again.`,
      );
    } finally {
      setIsRefreshing(false);
    }
  };
  return (
    <Button
      label={isRefreshing ? "Refreshing…" : "Refresh"}
      icon={RefreshIcon}
      variant="outline"
      size={size}
      disabled={isRefreshing}
      onClick={refresh}
    />
  );
}
