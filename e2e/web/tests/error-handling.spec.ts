/**
 * Error Handling Tests
 *
 * Tests for invalid files, empty files, and unsupported formats
 */
import { expect, test } from "../lib/test-fixtures";

test.describe("Error Handling", () => {
  test("shows error for empty CSV", async ({
    page,
    homePage,
    uploadBuffer,
  }) => {
    await homePage();

    await uploadBuffer("empty.csv", "", "text/csv");

    // Should show error message
    await expect(page.getByText(/empty|no data/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("shows error for invalid JSON", async ({
    page,
    homePage,
    uploadBuffer,
  }) => {
    await homePage();

    await uploadBuffer(
      "invalid.json",
      "{invalid json syntax}",
      "application/json",
    );

    // Should show error message
    await expect(page.getByText(/invalid|parse|error/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("shows error for unsupported file type", async ({
    page,
    homePage,
    uploadBuffer,
  }) => {
    await homePage();

    await uploadBuffer("document.txt", "This is plain text", "text/plain");

    // Should show unsupported format error
    await expect(page.getByText(/unsupported|not supported/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
