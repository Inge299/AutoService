import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function source(path) {
  return ts.createSourceFile(path, readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function elements(root, name) {
  const found = [];
  function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText() === name) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

function attribute(element, name) {
  return element.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText() === name)?.initializer?.getText();
}

test("visit search uses the shared layout and retains the selected status", () => {
  const forms = elements(source("app/(workshop)/visits/page.tsx"), "ListSearch");
  assert.equal(forms.length, 1);
  assert.equal(attribute(forms[0], "query"), "{params.q}");
  assert.equal(attribute(forms[0], "status"), "{activeStatus}");
});

test("customer search uses the shared layout", () => {
  const forms = elements(source("app/(workshop)/customers/page.tsx"), "ListSearch");
  assert.equal(forms.length, 1);
  assert.equal(attribute(forms[0], "query"), "{q}");
});

test("visit details render confirmed media instead of decorative placeholders", () => {
  const page = source("app/(workshop)/visits/[id]/page.tsx");
  const media = elements(page, "VisitMediaSection");
  assert.equal(media.length, 1);
  assert.equal(attribute(media[0], "visitId"), "{visit.id}");
  assert.equal(attribute(media[0], "total"), "{visit.mediaCount}");
  assert.ok(!elements(page, "div").some(node => attribute(node, "className")?.includes("media-placeholder")));
});

test("search button is outside the input wrapper and status is a hidden field", () => {
  const component = source("components/list-search.tsx");
  const label = elements(component, "label")[0];
  assert.ok(label);
  assert.equal(elements(label.parent, "Button").length, 0);
  assert.equal(elements(component, "Button").length, 1);
  assert.ok(elements(component, "input").some(node => attribute(node, "type") === '"hidden"' && attribute(node, "name") === '"status"'));
});
