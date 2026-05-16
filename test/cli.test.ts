import { describe, expect, test } from "vitest";
import { createCli } from "../src/cli.js";

describe("CLI scaffold", () => {
  test("exposes the MVP command surfaces in help output", () => {
    const help = createCli().helpInformation();

    expect(help).toContain("onix");
    expect(help).toContain("start");
    expect(help).toContain("close");
    expect(help).toContain("review");
    expect(help).toContain("apply");
    expect(help).toContain("status");
  });
});
