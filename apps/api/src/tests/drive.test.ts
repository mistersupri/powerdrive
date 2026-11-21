import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { googleEditor } from "../routes/files.ts";

describe("google editors", () => {
  it("picks the editor from the extension or Google's own mime type", () => {
    assert.equal(googleEditor("Laporan.DOCX", "application/octet-stream"), "document");
    assert.equal(googleEditor("anggaran.xlsx", ""), "spreadsheets");
    assert.equal(googleEditor("slide.pptx", ""), "presentation");
    assert.equal(googleEditor("tanpa-ekstensi", "application/vnd.google-apps.spreadsheet"), "spreadsheets");
    assert.equal(googleEditor("foto.jpg", "image/jpeg"), null);
  });
});
