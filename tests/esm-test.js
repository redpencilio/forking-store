import assert from "node:assert";
import test from "node:test";

// eslint-disable-next-line n/no-missing-import
import ForkingStore, { addGraphFor, delGraphFor } from "forking-store";

test("ESM imports work", () => {
  assert.ok(ForkingStore);
  assert.ok(addGraphFor);
  assert.ok(delGraphFor);
});
