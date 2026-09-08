import { expect, test } from "../lib/test-fixtures";
import { query, mutate, hostCall } from "../lib/native-api";
const USER_TOKEN = process.env.E2E_USER_TOKEN ?? "dashframe-e2e-user";

/** Mint a service credential — the stand-in for an external API caller. */
async function issueServiceToken(): Promise<string> {
  const issued = await hostCall<{ accessCredential: string }>(
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
 * A batch drafted by a service principal: three commands that create nodes, one
 * dashboard the reviewer is expected to remove, and — unless `lateBound` is
 * turned off — a filter carrying an unbound placeholder, which blocks publish.
 * Pass `{ lateBound: false }` when the test needs a draft that can publish
 * as-is.
 */
async function seedDraft({
  lateBound = true,
}: { lateBound?: boolean } = {}): Promise<SeededDraft> {
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
    ...(lateBound
      ? [
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
        ]
      : []),
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

test.describe("draft review", () => {
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
    await expect(page).toHaveURL(new RegExp(`${workerBaseURL}/dashboards/?$`));

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
      page.getByText("No changes waiting for review", { exact: true }),
    ).toBeVisible();
  });

  test("a service credential can draft but can neither commit nor revise", async () => {
    const { draftId, serviceToken } = await seedDraft();

    const review = await query<{ logSignature: string }>("draftPublishReview", {
      draftId,
    });

    await expect(
      mutate("commitBatch", { commands: [] }, serviceToken),
    ).rejects.toThrow();
    await expect(
      mutate(
        "reviseDraft",
        {
          draftId,
          expectedLogSignature: review.logSignature,
          ops: [{ type: "removeCommand", commandIndex: 4 }],
        },
        serviceToken,
      ),
    ).rejects.toThrow();
    expect(
      (await query<{ logSignature: string }>("draftPublishReview", { draftId }))
        .logSignature,
    ).toBe(review.logSignature);

    // Production Convex hides plain server error messages. Verify the denials
    // left state intact, then prove these same payloads are valid for a user.
    expect(await query<unknown[]>("listDataSources", {})).toHaveLength(0);
    await mutate("commitBatch", { commands: [] }, USER_TOKEN);
    await mutate(
      "reviseDraft",
      {
        draftId,
        expectedLogSignature: review.logSignature,
        ops: [{ type: "removeCommand", commandIndex: 4 }],
      },
      USER_TOKEN,
    );
    expect(
      (await query<{ logSignature: string }>("draftPublishReview", { draftId }))
        .logSignature,
    ).not.toBe(review.logSignature);
    expect(await query<unknown[]>("listDataSources", {})).toHaveLength(0);
  });

  test("the inbox and nav badge react to a new API draft without a reload", async ({
    page,
    workerBaseURL,
  }) => {
    await page.goto(`${workerBaseURL}/drafts`);
    await expect(
      page.getByText("No changes waiting for review", { exact: true }),
    ).toBeVisible();

    // The list query is already mounted. An external service mutation must
    // invalidate it over the live subscription — no navigation, no reload.
    await seedDraft();

    await expect(page.getByRole("link", { name: /Drafts 1/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /5 changes/ })).toBeVisible();
  });

  test("a lifecycle exit elsewhere clears the inbox without a reload", async ({
    page,
    workerBaseURL,
  }) => {
    // Observe lifecycle mutations from an already-mounted native subscription.
    // No reload or explicit query invalidation may be needed in this tab.
    const publishable = await seedDraft({ lateBound: false });
    const discardable = await seedDraft({ lateBound: false });

    await page.goto(`${workerBaseURL}/drafts`);
    await expect(page.getByRole("link", { name: /4 changes/ })).toHaveCount(2);
    await expect(page.getByLabel("2 drafts waiting for review")).toBeVisible();

    await mutate("publishDraft", { draftId: publishable.draftId }, USER_TOKEN);
    await expect(page.getByLabel("1 draft waiting for review")).toBeVisible();

    await mutate("discardDraft", { draftId: discardable.draftId }, USER_TOKEN);
    await expect(
      page.getByText("No changes waiting for review", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel(/waiting for review/)).toHaveCount(0);
  });
});
