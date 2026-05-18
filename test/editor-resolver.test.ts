import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { resolveEditor } from "../src/editor-resolver.js";

describe("resolveEditor", () => {
  let originalVisual: string | undefined;
  let originalEditor: string | undefined;

  beforeEach(() => {
    originalVisual = process.env.VISUAL;
    originalEditor = process.env.EDITOR;
    delete process.env.VISUAL;
    delete process.env.EDITOR;
  });

  afterEach(() => {
    if (originalVisual === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = originalVisual;
    if (originalEditor === undefined) delete process.env.EDITOR;
    else process.env.EDITOR = originalEditor;
  });

  test("returns undefined when nothing is set", () => {
    expect(resolveEditor({})).toBeUndefined();
  });

  test("prefers VISUAL over EDITOR and config", () => {
    process.env.VISUAL = "nvim";
    process.env.EDITOR = "vim";
    expect(resolveEditor({ editor: "nano" })).toBe("nvim");
  });

  test("falls back from VISUAL to EDITOR", () => {
    process.env.EDITOR = "vim";
    expect(resolveEditor({ editor: "nano" })).toBe("vim");
  });

  test("falls back to config when no env vars are set", () => {
    expect(resolveEditor({ editor: "nano" })).toBe("nano");
  });

  test("trims surrounding whitespace from the config value", () => {
    expect(resolveEditor({ editor: "  code -w  " })).toBe("code -w");
  });

  test("ignores an empty-string config editor", () => {
    expect(resolveEditor({ editor: "   " })).toBeUndefined();
  });

  test("ignores an empty-string env editor", () => {
    process.env.VISUAL = "   ";
    expect(resolveEditor({ editor: "nano" })).toBe("nano");
  });
});
