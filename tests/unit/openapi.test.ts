import fs from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

type OpenApi = {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: { securitySchemes: Record<string, unknown> };
};

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

function routePath(file: string): string {
  const relative = path.relative(path.join(process.cwd(), "app"), path.dirname(file));
  return `/${relative.split(path.sep).map((segment) => (segment.startsWith("[") && segment.endsWith("]") ? `{${segment.slice(1, -1)}}` : segment)).join("/")}`;
}

describe("OpenAPI contract", () => {
  const spec = load(fs.readFileSync(path.join(process.cwd(), "docs", "openapi.yaml"), "utf8")) as OpenApi;
  const routes = walk(path.join(process.cwd(), "app", "api"));

  it("parses as OpenAPI 3.1 with a bearer scheme", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.components.securitySchemes.bearerToken).toBeTruthy();
    expect(Object.keys(spec.paths).length).toBeGreaterThanOrEqual(60);
  });

  it("documents every route handler path and method", () => {
    const missing: string[] = [];
    for (const file of routes) {
      const route = routePath(file);
      const source = fs.readFileSync(file, "utf8");
      const documented = spec.paths[route];
      if (!documented) {
        missing.push(`${route} (path)`);
        continue;
      }
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        if (new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(source) && !documented[method.toLowerCase()]) {
          missing.push(`${method} ${route}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
