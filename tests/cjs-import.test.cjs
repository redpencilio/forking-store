// eslint-disable-next-line @typescript-eslint/no-require-imports
const assert = require("node:assert");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const test = require("node:test");

const {
  default: ForkingStore,
  addGraphFor,
  delGraphFor,
  additionGraphFor,
  deletionGraphFor,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("forking-store");

test("CJS imports work", () => {
  assert.ok(ForkingStore);
  assert.ok(addGraphFor);
  assert.ok(delGraphFor);
  assert.ok(additionGraphFor);
  assert.ok(deletionGraphFor);
});
