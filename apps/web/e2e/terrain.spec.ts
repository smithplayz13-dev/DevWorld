import { test, expect } from "@playwright/test";

test("terrain, streamed city and deep-link camera survive a country journey", async ({ page }) => {
  await page.goto("/");
  const tour = page.getByRole("button", { name: "Start exploring" });
  if (await tour.isVisible()) await tour.click();
  await page.getByRole("button", { name: "Explore storefront", exact: true }).click();
  const canvas = page.locator("canvas");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-streamed-buildings")))
    .toBeGreaterThan(100);
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-terrain-triangles")))
    .toBeGreaterThan(1000);
  await page.getByRole("button", { name: "components · state", exact: true }).click();
  await page.getByRole("button", { name: "cart · district", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "catalog_fetch_006.tsx · building", exact: true }),
  ).toBeVisible();
  const snapshot = new URL(page.url()).searchParams.get("s");
  const entity = new URL(page.url()).searchParams.get("e");
  await page.reload();
  await expect(page.getByRole("heading", { name: "cart", exact: true })).toBeVisible();
  await expect(page.getByText(/ALT 1.35/)).toBeVisible();
  expect(new URL(page.url()).searchParams.get("s")).toBe(snapshot);
  expect(new URL(page.url()).searchParams.get("e")).toBe(entity);
});
