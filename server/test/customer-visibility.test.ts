import { describe, expect, it } from "vitest";
import { customerVisibleMediaIds, reportMediaAssociations, projectReportFindings, withoutPrivateGeneratedRecommendations } from "../src/domain/customer-visibility.js";

describe("customer report visibility", () => {
  it("keeps general and visible media using immutable associations, but never private media", () => {
    const projection = projectReportFindings([{ id: "private", title: "Draft", status: "DRAFT" }, { id: "visible", title: "Done", status: "COMPLETED" }]);
    const ids = ["general", "hidden", "shown"];
    const manifest = [{ id: "general", findingId: null }, { id: "hidden", findingId: "private" }, { id: "shown", findingId: "visible" }];
    expect(customerVisibleMediaIds(ids, manifest, projection.visibleIds, projection.hasHidden, [])).toEqual(["general", "shown"]);
    const current = [{ id: "general", findingId: null }, { id: "hidden", findingId: "private" }, { id: "shown", findingId: "visible" }];
    expect(customerVisibleMediaIds(ids, null, projection.visibleIds, projection.hasHidden, current)).toEqual(["shown"]);
    expect(customerVisibleMediaIds(ids, [{ id: "general", findingId: null }], projection.visibleIds, projection.hasHidden, current)).toEqual(["shown"]);
  });
  it("groups only by intact snapshot associations and leaves legacy or malformed media general", () => {
    const ids = ["general", "shown", "hidden"];
    const visible = new Set(["work"]);
    const valid = [{ id: "general", findingId: null }, { id: "shown", findingId: "work" }, { id: "hidden", findingId: "private" }];
    expect([...reportMediaAssociations(ids, valid, visible)]).toEqual([["general", null], ["shown", "work"], ["hidden", null]]);
    for (const invalid of [null, [], [valid[0], valid[0], valid[2]], [{ id: "general", findingId: null }]]) {
      expect([...reportMediaAssociations(ids, invalid, visible)]).toEqual([["general", null], ["shown", null], ["hidden", null]]);
    }
  });

  it("publishes only explicitly selected draft text as a recommendation, never its private media", () => {
    const projection = projectReportFindings([
      { id: "chosen", title: "Plan", status: "DRAFT", reportRecommendation: true, description: "Replace", internalComment: "secret" },
      { id: "hidden", title: "Hidden", status: "DRAFT" },
    ]);
    expect(projection.visible).toEqual([{ id: "chosen", title: "Plan", status: "RECOMMENDED", description: "Replace" }]);
    expect(projection.visibleIds.has("chosen")).toBe(true);
    expect(projection.mediaVisibleIds.has("chosen")).toBe(false);
    const manifest = [{ id: "chosen-photo", findingId: "chosen" }, { id: "general", findingId: null }];
    expect(customerVisibleMediaIds(["chosen-photo", "general"], manifest, projection.mediaVisibleIds, projection.hasHidden, []))
      .toEqual(["general"]);
  });

  it("does not expose arbitrary snapshot fields and flags malformed private titles", () => {
    const projection = projectReportFindings([{ id: "visible", status: "COMPLETED", title: "Done", internalComment: "private" }, { status: "DRAFT", title: "line\nbreak" }]);
    expect(projection.visible).toEqual([{ id: "visible", status: "COMPLETED", title: "Done" }]);
    expect(projection.canSanitize).toBe(false);
    expect(projectReportFindings(null).canSanitize).toBe(false);
  });
  it("does not erase unrelated manual notes when removing private generated lines", () => {
    const notes = "Своя рекомендация\nНе выполнено в этот визит: Draft. Необходимо выполнить в дальнейшем. Срок необходимо согласовать с мастерской.";
    expect(withoutPrivateGeneratedRecommendations(notes, ["Draft"])).toBe("Своя рекомендация");
    const overlapping = "Не выполнено в этот визит: Draft. Другой пункт. Необходимо выполнить в дальнейшем. Срок необходимо согласовать с мастерской.";
    expect(withoutPrivateGeneratedRecommendations(overlapping, ["Draft"])).toBe(overlapping);
  });
});
