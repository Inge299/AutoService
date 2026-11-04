import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import test from "node:test";
import ts from "typescript";
const compiledModule = {exports:{}};
const source = readFileSync(new URL("../src/lib/approval-path.ts", import.meta.url), "utf8");
runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, {module:compiledModule, exports:compiledModule.exports});
const {safeApprovalPath} = compiledModule.exports;
test("approval link permits only a relative application path with an opaque token", () => {
  const token = "aBc_123-".repeat(5);
  assert.equal(safeApprovalPath(`/a/${token}`), `/a/${token}`);
  for (const value of [undefined, [], "javascript:alert(1)", "//evil.example/a/" + token, "https://evil.example/a/" + token, "/a/short", "/a/" + token + "?x=1", "/a/" + token + "%2f..", "/a/" + token + "\n"]) assert.equal(safeApprovalPath(value),null);
});
