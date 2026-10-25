import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

for (const path of ['app/staff/change-password/page.tsx', 'app/(workshop)/admin/users/page.tsx', 'app/customer/register/page.tsx']) {
  test(`password fields permit five characters in ${path}`, () => {
    const text = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let checked = 0;
    function visit(node) {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'input') {
        const attrs = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(item => [item.name.getText(), item.initializer?.getText()]));
        if (attrs.type === '"password"' && attrs.name !== '"currentPassword"') {
          assert.equal(attrs.minLength, '{5}');
          assert.equal(attrs.maxLength, '{256}');
          checked++;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.ok(checked > 0);
  });
}
