import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {runInNewContext} from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";

function load(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiledModule = {exports:{}};
  const actualRequire = createRequire(import.meta.url);
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {module:compiledModule,exports:compiledModule.exports,require:name=>name==="@/components/icons"?{Icon:()=>null}:actualRequire(name)});
  return compiledModule.exports;
}
const {isValidNewPassword}=load("../src/lib/password-policy.ts");
const {CustomerContact}=load("../src/components/customer-contact.tsx");
test("new passwords accept the five-character boundary and retain the maximum",()=>{
  assert.equal(isValidNewPassword("1234"),false); assert.equal(isValidNewPassword("12345"),true);
  assert.equal(isValidNewPassword("x".repeat(256)),true); assert.equal(isValidNewPassword("x".repeat(257)),false);
});
test("contact help offers an existing phone, never a vanished decision action",()=>{
  const html=renderToStaticMarkup(React.createElement(CustomerContact,{phone:"+7 (999) 123-45-67"}));
  assert(html.includes('href="tel:+79991234567"')); assert(!html.includes("Нужен звонок"));
  assert.equal(renderToStaticMarkup(React.createElement(CustomerContact,{phone:null})),"");
});
