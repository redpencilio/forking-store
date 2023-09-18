const assert = require("node:assert");
const test = require("node:test");

const {
  default: ForkingStore,
  addGraphFor,
  delGraphFor,
} = require("forking-store"); // eslint-disable-line n/no-missing-require

test("CJS imports work", () => {
  assert.ok(ForkingStore);
  assert.ok(addGraphFor);
  assert.ok(delGraphFor);
});
