import assert from "node:assert";
import test from "node:test";

import ForkingStore, {
  addGraphFor,
  additionGraphFor,
  deletionGraphFor,
  delGraphFor,
} from "forking-store";

test("ESM imports work", () => {
  assert.ok(ForkingStore);
  // Following two will be removed in next major
  assert.ok(addGraphFor);
  assert.ok(delGraphFor);

  assert.ok(additionGraphFor);
  assert.ok(deletionGraphFor);
});
