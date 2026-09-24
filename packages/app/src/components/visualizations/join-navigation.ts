/** The join configuration page for a chart open in a report. */
export function joinTableConfigurationLink(
  reportId: string,
  insightId: string,
  tableId: string,
  chartId?: string,
) {
  return {
    to: `/dashboards/${reportId}/join/${insightId}/${tableId}`,
    search: chartId ? { chart: chartId } : {},
  } as const;
}
