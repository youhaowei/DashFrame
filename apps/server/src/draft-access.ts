import type { Principal } from "@wystack/identity";

import { principalKey } from "./app-context";
import type { DraftController } from "./draft-controller";

export const DRAFT_UNAVAILABLE = "draft is unavailable";

/** Users own review; services may access only their exact durable owner row. */
export async function assertDraftAccess(
  controller: DraftController,
  principal: Principal | undefined,
  draftId: string,
): Promise<void> {
  if (principal?.kind === "user") return;
  const key = principalKey(principal);
  if (key === null || !(await controller.draftOwnedBy(draftId, key))) {
    throw new Error(DRAFT_UNAVAILABLE);
  }
}
