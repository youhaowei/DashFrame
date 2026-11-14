#!/usr/bin/env node
// CI-only: keep one bot-owned issue comment. Never execute PR strings.
const marker = "<!-- dashframe-test-growth -->";
const repo = process.env.REPOSITORY;
const root = "https://api.github.com/repos/" + repo;

function readInputs() {
  const number = Number(process.env.PR_NUMBER);
  const sha = (value) =>
    typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "") ||
    !/^[1-9]\d*$/.test(process.env.PR_NUMBER ?? "") ||
    !Number.isSafeInteger(number) ||
    !sha(process.env.BASE_SHA) ||
    !sha(process.env.HEAD_SHA)
  ) {
    throw new Error("Invalid pull request context");
  }
  const result = JSON.parse(process.env.TEST_DELTA ?? "null");
  if (result?.skipped === true) return { number, result };
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  if (
    !result ||
    !sha(result.base) ||
    !sha(result.head) ||
    !sha(result.mergeBase) ||
    result.base !== process.env.BASE_SHA ||
    result.head !== process.env.HEAD_SHA ||
    !Number.isSafeInteger(result.delta) ||
    !Array.isArray(result.files) ||
    !result.files.every(
      (file) =>
        file &&
        typeof file.file === "string" &&
        file.file.length > 0 &&
        (file.previousFile === undefined ||
          typeof file.previousFile === "string") &&
        count(file.before) &&
        count(file.after) &&
        Number.isSafeInteger(file.delta) &&
        file.delta === file.after - file.before,
    ) ||
    result.files.reduce((sum, file) => sum + file.delta, 0) !== result.delta
  ) {
    throw new Error("Invalid test delta result");
  }
  return { number, result };
}

async function api(path, method = "GET", body) {
  const response = await fetch(root + path, {
    method,
    headers: {
      Authorization: "Bearer " + process.env.GH_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error("GitHub " + method + ": HTTP " + response.status);
  return response.status === 204 ? undefined : response.json();
}

try {
  const { number, result } = readInputs();
  // A queued older push must not overwrite a newer notice.
  const pr = result.skipped ? undefined : await api("/pulls/" + number);
  if (result.skipped) {
    console.log(
      "Skipping notice because test counting failed; existing comments left untouched",
    );
  } else if (pr.head.sha !== result.head || pr.base.sha !== result.base) {
    console.log("Skipping stale pull request snapshot");
  } else {
    const comments = [];
    for (let page = 1; ; page++) {
      const batch = await api(
        "/issues/" + number + "/comments?per_page=100&page=" + page,
      );
      comments.push(...batch);
      if (batch.length < 100) break;
    }
    const existing = comments.filter(
      (comment) =>
        comment.user.login === "github-actions[bot]" &&
        comment.body.includes(marker),
    );
    if (result.delta >= 20) {
      // Code spans suppress mentions, references, links and HTML. Pad the
      // content so leading/trailing backticks cannot join the delimiter.
      const safeName = (name) => {
        const text = name
          .replaceAll("\r", "\\r")
          .replaceAll("\n", "\\n")
          .slice(0, 160);
        const runs = text.match(/`+/g) ?? [];
        const delimiter = "`".repeat(
          1 + Math.max(0, ...runs.map((run) => run.length)),
        );
        return delimiter + " " + text + " " + delimiter;
      };
      const top = result.files
        .filter(({ delta }) => delta > 0)
        .slice(0, 5)
        .map(({ file, delta }) => "- " + safeName(file) + ": +" + delta)
        .join("\n");
      const body =
        marker +
        "\nThis pull request adds **" +
        result.delta +
        " net test cases** (static estimate).\n\nLargest increases:\n" +
        top +
        "\n\nEach new test should catch a defect no existing test catches; fold cases into existing tests or tables where possible. State in the pull request description why this growth is needed. See [Tests](https://github.com/" +
        repo +
        "/blob/" +
        result.base +
        "/AGENTS.md#tests).";
      if (existing.length)
        await api("/issues/comments/" + existing[0].id, "PATCH", { body });
      else await api("/issues/" + number + "/comments", "POST", { body });
      for (const duplicate of existing.slice(1))
        await api("/issues/comments/" + duplicate.id, "DELETE");
    } else {
      for (const comment of existing)
        await api("/issues/comments/" + comment.id, "DELETE");
    }
  }
} catch (error) {
  console.warn("Test growth notice unavailable: " + error.message);
}
