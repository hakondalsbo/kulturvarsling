import { test } from "node:test";
import assert from "node:assert/strict";
import { PREMIUM_AAR_KR, PREMIUM_MAANED_KR, sparProsentArlig } from "../src/priser.ts";

test("prisene er uendret, og årlig sparing blir 34 prosent", () => {
  assert.equal(PREMIUM_MAANED_KR, 99);
  assert.equal(PREMIUM_AAR_KR, 790);
  // 99 × 12 = 1188. (1188 − 790) / 1188 = 33,5… som rundes til 34.
  assert.equal(99 * 12, 1188);
  assert.equal(sparProsentArlig(), 34);
});
