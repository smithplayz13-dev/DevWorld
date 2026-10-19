// DW-01: demo entry -> country selection with inspector + breadcrumbs.
// DW-04: deep link reload preserves time and selection.
// DW-07: the same journey works by keyboard in the DOM atlas.
import { expect, test } from "@playwright/test";

test("DW-01 country selection shows inspector and breadcrumbs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("DEVWORLD")).toBeVisible();
  await page.getByTitle("DOM atlas").click();
  const tree = page.getByRole("tree");
  await expect(tree).toBeVisible({ timeout: 15_000 });
  const first = tree.getByRole("treeitem").first();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("›", {
    timeout: 10_000,
  });
  await expect(page.getByLabel("Inspector")).toBeVisible();
});

test("DW-04 deep link preserves snapshot and selection", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("DOM atlas").click();
  const tree = page.getByRole("tree");
  await expect(tree).toBeVisible({ timeout: 15_000 });
  await tree.getByRole("treeitem").first().focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => page.url()).toContain("e=");
  const url = page.url();
  expect(url).toContain("s=");
  await page.reload();
  await expect(page.getByText("CHRONOSCOPE")).toBeVisible();
  await expect(page.getByLabel("Inspector")).toBeVisible();
});

test("DW-07 atlas keyboard journey mirrors the globe", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("DOM atlas").click();
  const tree = page.getByRole("tree");
  await expect(tree).toBeVisible({ timeout: 15_000 });
  await tree.getByRole("treeitem").first().focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByText("CHRONOSCOPE")).toBeVisible();
});
