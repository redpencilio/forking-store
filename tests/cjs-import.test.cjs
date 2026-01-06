const assert = require("node:assert");
const test = require("node:test");

const {
  default: ForkingStore,
  addGraphFor,
  delGraphFor,
  additionGraphFor,
  deletionGraphFor,
} = require("forking-store");

test("CJS imports work", () => {
  assert.ok(ForkingStore);
  assert.ok(addGraphFor);
  assert.ok(delGraphFor);
  assert.ok(additionGraphFor);
  assert.ok(deletionGraphFor);
});
