import { describe, expect, it } from "vitest";
import { resolveCloudConfig } from "../../src/server/cloud/config.js";

describe("resolveCloudConfig", () => {
  it("normalizes a standard Supabase project URL", () => {
    const config = resolveCloudConfig({
      isPackaged: true,
      url: "https://xyzcompany.supabase.co",
      publishableKey: "sb_publishable_testkey123",
      forceFake: false,
    });
    expect(config.kind).toBe("supabase");
    if (config.kind === "supabase") {
      expect(config.url).toBe("https://xyzcompany.supabase.co");
      expect(config.publishableKey).toBe("sb_publishable_testkey123");
    }
  });

  it("normalizes a Supabase URL with trailing /rest/v1/ copied from dashboard", () => {
    const config = resolveCloudConfig({
      isPackaged: true,
      url: "https://xyivjkfzfpeuusrciyxe.supabase.co/rest/v1/",
      publishableKey: "sb_publishable_m8K2p6WDnOZQpVyvsZjt0w_GLC5znak",
      forceFake: false,
    });
    expect(config.kind).toBe("supabase");
    if (config.kind === "supabase") {
      expect(config.url).toBe("https://xyivjkfzfpeuusrciyxe.supabase.co");
    }
  });

  it("normalizes a Supabase URL with trailing slash", () => {
    const config = resolveCloudConfig({
      isPackaged: true,
      url: "https://xyzcompany.supabase.co/",
      publishableKey: "sb_publishable_testkey123",
      forceFake: false,
    });
    expect(config.kind).toBe("supabase");
    if (config.kind === "supabase") {
      expect(config.url).toBe("https://xyzcompany.supabase.co");
    }
  });

  it("rejects non-https URLs", () => {
    const config = resolveCloudConfig({
      isPackaged: true,
      url: "http://xyzcompany.supabase.co",
      publishableKey: "sb_publishable_testkey123",
      forceFake: false,
    });
    expect(config.kind).toBe("missing");
  });
});
