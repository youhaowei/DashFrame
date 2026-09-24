/** Retry the brief 429 window while a Convex deployment becomes available. */
export async function retryConvexMutation(
  run: () => Promise<unknown>,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await run();
      return;
    } catch (error) {
      if (
        attempt >= 5 ||
        !(error instanceof Error) ||
        !error.message.includes("429")
      )
        throw error;
      await new Promise((resolve) => {
        setTimeout(resolve, 100 * 2 ** attempt);
      });
    }
  }
}
