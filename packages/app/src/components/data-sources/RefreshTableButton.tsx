import { useHostMutation } from "@/data/host";
import type { UUID } from "@dashframe/types";
import { Button } from "@wystack/ui-react";
import { RefreshIcon } from "@wystack/ui-react/icons";
import { useState } from "react";
import { toast } from "sonner";

/** Key this control by table ID so pending state stays with its target. */
export function RefreshTableButton({
  tableId,
  tableName,
}: {
  tableId: UUID;
  tableName: string;
}) {
  const { mutateAsync: refreshDataTable } = useHostMutation("refreshDataTable");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const result = await refreshDataTable({ tableId });
      if (result.status === "failed")
        toast.error(`Could not refresh ${tableName}: ${result.message}`);
      else toast.success(`${tableName} refreshed`);
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
      disabled={isRefreshing}
      onClick={refresh}
    />
  );
}
