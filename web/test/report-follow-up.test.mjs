import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import test from "node:test";
import ts from "typescript";
const compiledModule = {exports:{}};
const source = readFileSync(new URL("../src/lib/report-follow-up.ts", import.meta.url), "utf8");
runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, {module:compiledModule, exports:compiledModule.exports});
const {reportFollowUp} = compiledModule.exports;
test("individual deadlines override the visit date; an explicit empty plan has no fallback", () => {
  const finding = {status:"DEFERRED",priority:"PLANNED",followUpConfigured:true};
  assert.equal(reportFollowUp({...finding,followUpDueAt:"2099-11-20T09:00:00Z"},"2099-12-20T09:00:00Z").dueAt,"2099-11-20T09:00:00Z");
  assert.equal(reportFollowUp({...finding,followUpDueAt:null},"2099-12-20T09:00:00Z").dueAt,null);
  assert.equal(reportFollowUp({status:"DEFERRED",priority:"PLANNED"},"2099-12-20T09:00:00Z").dueAt,"2099-12-20T09:00:00Z");
});
test("closed plans and completed or declined work are not presented as future work", () => {
  for (const finding of [{status:"DEFERRED",priority:"PLANNED",followUpState:"DONE"},{status:"DEFERRED",priority:"PLANNED",followUpState:"CANCELLED"},{status:"COMPLETED",priority:"PLANNED"},{status:"DECLINED",priority:"PLANNED"}]) assert.equal(reportFollowUp(finding,null).future,false);
});
