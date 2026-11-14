#!/usr/bin/env node
// CI-only: keep one bot-owned issue comment. Never execute PR strings.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const marker = "<!-- dashframe-test-growth -->";
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const result = JSON.parse(
  readFileSync(join(process.env.RUNNER_TEMP, "test-delta.json"), "utf8"),
);
const repo = process.env.GITHUB_REPOSITORY;
const root = "https://api.github.com/repos/" + repo;

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
  // A queued older push must not overwrite a newer notice.
  const pr = result.skipped
    ? undefined
    : await api("/pulls/" + event.pull_request.number);
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
        "/issues/" + pr.number + "/comments?per_page=100&page=" + page,
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
      // Escape markdown/HTML and cap pathological names to keep notices short.
      const safeName = (name) =>
        name
          .slice(0, 160)
          .replace(
            /[&<>`@:[\]\\\r\n]/g,
            (char) => "&#" + char.charCodeAt(0) + ";",
          );
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
        pr.base.sha +
        "/AGENTS.md#tests).";
      if (existing.length)
        await api("/issues/comments/" + existing[0].id, "PATCH", { body });
      else await api("/issues/" + pr.number + "/comments", "POST", { body });
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
