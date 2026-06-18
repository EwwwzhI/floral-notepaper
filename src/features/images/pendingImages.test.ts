import { describe, expect, test } from "vitest";
import { extractPendingImageIds, replacePendingImageRefs } from "./pendingImages";

describe("pending images", () => {
  test("extracts unique pending image ids", () => {
    const content = "![](pending-image://a)\ntext\n![](pending-image://b)\n![](pending-image://a)";
    expect(extractPendingImageIds(content)).toEqual(["a", "b"]);
  });

  test("replaces pending refs with persisted paths", () => {
    const content = "![](pending-image://a)\n![](pending-image://b)";
    expect(replacePendingImageRefs(content, { a: "images/note/a.png" })).toBe(
      "![](images/note/a.png)\n![](pending-image://b)",
    );
  });
});
