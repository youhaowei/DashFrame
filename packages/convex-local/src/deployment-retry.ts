import { setTimeout as delay } from "node:timers/promises";

/** Only deployment control-plane operations may use this retry policy. */
export class DeploymentFailure extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "DeploymentFailure";
  }
}

export function isTransientDeploymentDiagnostic(diagnostic: string): boolean {
  return (
    /Error fetching (?:POST|GET) http:\/\/127\.0\.0\.1:\d+\/\S+ 429(?:\s|:)/.test(
      diagnostic,
    ) ||
    /Hit an error while evaluating your schema: Function execution timed out \(maximum duration: 1s\)/.test(
      diagnostic,
    )
  );
}

/** Three attempts at most; never replay application queries or mutations. */
export async function retryDeployment<T>(
  operation: () => Promise<T>,
  pause: (milliseconds: number) => Promise<unknown> = delay,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof DeploymentFailure) ||
        !error.retryable ||
        attempt >= 2
      )
        throw error;
      await pause(1000 * 2 ** attempt);
    }
  }
}
