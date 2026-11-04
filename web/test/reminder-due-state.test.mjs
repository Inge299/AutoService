import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
const compiledModule = { exports: {} };
const source = readFileSync(new URL("../src/lib/reminder-due-state.ts", import.meta.url), "utf8");
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: compiledModule, exports: compiledModule.exports });
const { reminderDueState } = compiledModule.exports;
test("visit deadline uses its Moscow calendar date rather than the message send time", () => {
  const now = new Date("2026-11-03T20:59:00Z");
  assert.equal(reminderDueState("2026-11-04T09:00:00Z", now), "UPCOMING");
  assert.equal(reminderDueState("2026-11-03T09:00:00Z", now), "TODAY");
  assert.equal(reminderDueState("2026-11-02T09:00:00Z", now), "OVERDUE");
  assert.equal(reminderDueState("2026-11-04T09:00:00Z", new Date("2026-11-03T21:01:00Z")), "TODAY");
});
