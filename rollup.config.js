// rollup.config.js
import typescript from "@rollup/plugin-typescript";

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
  external: ["rdflib"],
  plugins: [typescript()],
};
