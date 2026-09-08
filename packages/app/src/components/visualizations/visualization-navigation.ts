export function visualizationDetailLink(
  visualizationId: string,
  reportId?: string,
) {
  return {
    to: `/visualizations/${visualizationId}`,
    search: reportId ? { reportId } : {},
  } as const;
}

export function visualizationSourceQuestionLink(
  insightId: string,
  reportId?: string,
) {
  return {
    to: `/insights/${insightId}`,
    search: reportId ? { reportId } : {},
  } as const;
}
