import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURES_DIR = resolve(process.cwd(), "src", "test", "fixtures");

export function resolveFixturePath(name: string): string {
  return resolve(FIXTURES_DIR, name);
}

export function loadFixture(name: string): string {
  return readFileSync(resolveFixturePath(name), "utf8");
}

export function renderFixture(html: string): void {
  document.body.innerHTML = html;
  document.head.innerHTML = "<title>Fixture</title>";
}
