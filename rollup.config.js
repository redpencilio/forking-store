// rollup.config.js
import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";

export default {
  input: "src/forking-store.ts",
  output: [
    {
      file: "dist/forking-store.js",
      format: "esm",
    },
    {
      file: "dist/forking-store.cjs",
      format: "cjs",
    },
  ],
  external: [/node_modules/],
  plugins: [typescript(), nodeResolve()],
};
