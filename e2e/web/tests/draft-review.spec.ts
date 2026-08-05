import { expect, test } from "../lib/test-fixtures";
import { API_URL } from "../playwright.config";

const USER_TOKEN = process.env.E2E_USER_TOKEN ?? "dashframe-e2e-user";

async function mutate<T>(
  path: string,
  args: unknown,
  token: string,
): Promise<T> {
  const response = await fetch(`${API_URL}/api/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    throw new Error(
      `${path} failed: ${response.status} ${await response.text()}`,
    );
  }
  return ((await response.json()) as { data: T }).data;
}

async function query<T>(
  path: string,
  args: unknown,
  token = USER_TOKEN,
): Promise<T> {
  const response = await fetch(
    `${API_URL}/api/${path}?args=${encodeURIComponent(JSON.stringify(args))}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(
      `${path} failed: ${response.status} ${await response.text()}`,
    );
  }
  return ((await response.json()) as { data: T }).data;
}

/** Mint a service credential — the stand-in for an external API caller. */
async function issueServiceToken(): Promise<string> {
  const issued = await mutate<{ accessCredential: string }>(
    "issueAccessCredential",
    { name: "draft review fixture" },
    USER_TOKEN,
  );
  return issued.accessCredential;
}

interface SeededDraft {
  draftId: string;
  serviceToken: string;
  sourceId: string;
  insightId: string;
}

/**
 * Five commands drafted by a service principal: three that create nodes, one
 * carrying an unbound placeholder (blocks publish), and one dashboard the
 * reviewer is expected to remove.
 */
async function seedDraft(): Promise<SeededDraft> {
  const serviceToken = await issueServiceToken();
  const sourceId = crypto.randomUUID();
  const tableId = crypto.randomUUID();
  const insightId = crypto.randomUUID();
  const dashboardId = crypto.randomUUID();
  const commands = [
    {
      path: "createDataSource",
      args: {
        id: sourceId,
        type: "csv",
        name: "Review source",
        createdBy: { kind: "agent" },
      },
    },
    {
      path: "createDataTable",
      args: {
        id: tableId,
        dataSourceId: sourceId,
        name: "Review table",
        table: "review.csv",
      },
    },
    {
      path: "createInsightCmd",
      args: {
        id: insightId,
        name: "Review insight",
        source: { sourceType: "dataTable", sourceId: tableId },
      },
    },
    {
      path: "setInsightFilter",
      args: {
        id: insightId,
        filters: [
          {
            field: "region",
            operator: "eq",
            value: {
              kind: "lateBound",
              ref: { type: "placeholder", prompt: "Region" },
            },
          },
        ],
      },
    },
    {
      path: "createDashboardCmd",
      args: { id: dashboardId, name: "Remove me" },
    },
  ];

  const drafted = await mutate<{ draftId: string }>(
    "draftBatch",
    { commands },
    serviceToken,
  );
  return { draftId: drafted.draftId, serviceToken, sourceId, insightId };
}

/**
 * `clearAllData` resets canonical state but leaves the draft registry standing,
 * so open drafts would otherwise leak from one test into the next and break the
 * empty-inbox assertions. Sweep them explicitly.
 */
async function discardAllDrafts(): Promise<void> {
  const drafts = await query<Array<{ draftId: string }>>("listDrafts", {});
  for (const draft of drafts) {
    await mutate("discardDraft", { draftId: draft.draftId }, USER_TOKEN);
  }
}

test.describe("draft review", () => {
  test.beforeEach(async () => {
    await discardAllDrafts();
  });

  test("an API draft never touches canonical until the reviewer publishes it", async ({
    page,
    workerBaseURL,
  }) => {
    const { draftId, sourceId, insightId } = await seedDraft();

    expect(await query<unknown[]>("listDataSources", {})).toHaveLength(0);
    expect(await query<unknown[]>("listInsights", {})).toHaveLength(0);

    await page.goto(`${workerBaseURL}/drafts`);
    await page.getByRole("link", { name: /5 changes/ }).click();
    await expect(page).toHaveURL(new RegExp(`/drafts/${draftId}/?$`));

    await expect(
      page.getByRole("heading", { name: "Review changes" }),
    ).toBeVisible();
    await expect(
      page.getByText("Review source", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Review table", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Review insight", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Remove me", { exact: true })).toBeVisible();
    await expect(
      page.getByText("1 values still need to be filled in before publishing."),
    ).toBeVisible();

    // Fix in place: bind the placeholder, then drop the unwanted dashboard.
    const valueInput = page.getByRole("textbox", { name: /Value.*Region/ });
    await valueInput.fill("EMEA");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(
      page.getByText("1 values still need to be filled in before publishing."),
    ).not.toBeVisible();

    const dashboardCommand = page.getByTestId("draft-command-4");
    await dashboardCommand.getByRole("button", { name: "Remove" }).click();
    await expect(
      dashboardCommand.getByText("Remove this change from the draft?"),
    ).toBeVisible();
    await dashboardCommand
      .getByRole("button", { name: "Remove" })
      .last()
      .click();
    await expect(page.getByText("4 commands")).toBeVisible();

    // Still nothing in canonical — revision is not publication.
    expect(await query<unknown[]>("listDataSources", {})).toHaveLength(0);
    expect(await query<unknown[]>("listInsights", {})).toHaveLength(0);

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${workerBaseURL}/?$`));

    const sources = await query<Array<{ id: string }>>("listDataSources", {});
    const insights = await query<
      Array<{
        id: string;
        filters: Array<{ value: { kind: string; v: unknown } }>;
      }>
    >("listInsights", {});
    expect(sources.map((source) => source.id)).toContain(sourceId);
    expect(
      insights.find((insight) => insight.id === insightId)?.filters,
    ).toMatchObject([{ value: { kind: "value", v: "EMEA" } }]);

    await page.goto(`${workerBaseURL}/drafts`);
    await expect(
      page.getByText("No changes waiting for review."),
    ).toBeVisible();
  });

  test("a service credential can draft but can neither commit nor revise", async () => {
    const { draftId, serviceToken } = await seedDraft();

    const review = await query<{ logSignature: string }>("draftPublishReview", {
      draftId,
    });

    const deniedCommit = await fetch(`${API_URL}/api/commitBatch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ commands: [] }),
    });
    expect(deniedCommit.status).toBe(403);

    const deniedRevision = await fetch(`${API_URL}/api/reviseDraft`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({
        draftId,
        expectedLogSignature: review.logSignature,
        ops: [{ type: "removeCommand", commandIndex: 4 }],
      }),
    });
    expect(deniedRevision.status).toBe(403);

    // The denials left the draft intact and canonical untouched.
    expect(await query<unknown[]>("listDataSources", {})).toHaveLength(0);
  });

  test("the inbox and nav badge react to a new API draft without a reload", async ({
    page,
    workerBaseURL,
  }) => {
    await page.goto(`${workerBaseURL}/drafts`);
    await expect(
      page.getByText("No changes waiting for review."),
    ).toBeVisible();

    // The list query is already mounted. An external service mutation must
    // invalidate it over the live subscription — no navigation, no reload.
    await seedDraft();

    await expect(page.getByRole("link", { name: /Review 1/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /5 changes/ })).toBeVisible();
  });
});
