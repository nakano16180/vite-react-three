import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";
import pluginSecurity from "eslint-plugin-security";
import vitest from "@vitest/eslint-plugin";
import { globalIgnores } from "eslint/config";

export default tseslint.config([
  globalIgnores(["dist", ".emdash/**"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs["recommended-latest"],
      reactRefresh.configs.vite,
      prettierConfig,
      pluginSecurity.configs.recommended,
    ],
    plugins: {
      prettier,
    },
    rules: {
      "prettier/prettier": "error",
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: ["playwright.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    ...vitest.configs.recommended,
    files: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
]);
