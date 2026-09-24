/** Retry the brief 429 window while a Convex deployment becomes available. */
export async function retryConvexMutation<T>(
  run: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
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
