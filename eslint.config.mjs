import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      complexity: ["error", 15],
    },
  },
  {
    files: ["convex/**/*.ts"],
    ignores: ["convex/functions.ts", "convex/householdCounts.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "./_generated/server",
              importNames: ["mutation", "internalMutation"],
              message: "Import mutation and internalMutation from ./functions so table triggers (household counts) run.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "convex/_generated/**",
    // The Remotion promo has its own package, tsconfig and lint.
    "video/**",
    // The Forge app has its own package and tests.
    "atlassian/**",
  ]),
]);

export default eslintConfig;
