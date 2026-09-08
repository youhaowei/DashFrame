export function joinTableConfigurationLink(
  insightId: string,
  tableId: string,
  reportId?: string,
) {
  return {
    to: `/insights/${insightId}/join/${tableId}`,
    search: reportId ? { reportId } : {},
  } as const;
}
