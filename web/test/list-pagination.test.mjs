import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/list-pagination.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const compiledModule = { exports: {} };
runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, require: createRequire(import.meta.url), URLSearchParams });
const { parsePage, paginationHref } = compiledModule.exports;

test("page numbers reject malformed or excessive inputs", () => {
  for (const value of [undefined, "", "0", "-1", "1.5", "abc", "1000001"]) assert.equal(parsePage(value), 1);
  assert.equal(parsePage("9"), 9);
});

test("page navigation preserves phone plus signs, Cyrillic queries and visit status", () => {
  const url = new URL(paginationHref("/visits", 3, "+7999 А123АА77", "IN_REPAIR"), "https://example.test");
  assert.equal(url.pathname, "/visits"); assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("q"), "+7999 А123АА77"); assert.equal(url.searchParams.get("status"), "IN_REPAIR");
});

test("customer history keeps the car and the other independent page", () => {
  const url = new URL(paginationHref("/customers/test", 3, undefined, undefined, {vehicleId:"car", page:"2"}, "futurePage"), "https://example.test");
  assert.equal(url.searchParams.get("vehicleId"), "car"); assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("futurePage"), "3");
});
