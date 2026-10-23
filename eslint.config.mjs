import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "generated/**",
    "playwright-report/**",
    "test-results/**",
    "data/**",
    "coverage/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "react/no-unescaped-entities": "off",
      // Data-fetch effects intentionally set loading/data state after mount.
      // Server state is fetched by route handlers, not synchronised in render.
      "react-hooks/set-state-in-effect": "off",
      // Full-page auth redirects must leave the SPA so the server can read the
      // refreshed session cookie; client routing is the wrong primitive here.
      "@next/next/no-location-assign-relative-destination": "warn",
    },
  },
]);
