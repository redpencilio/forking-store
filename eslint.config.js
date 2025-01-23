import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import nodePlugin from "eslint-plugin-n";


/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ["dist", "declarations"]
  },
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  { languageOptions: { globals: globals['shared-node-browser']} },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  nodePlugin.configs["flat/recommended-script"],
];
