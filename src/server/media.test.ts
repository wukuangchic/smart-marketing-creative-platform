import { describe, expect, it } from "vitest";
import { storageUsage } from "@/server/media";

describe("image storage thresholds", () => {
  it("warns at 80 percent and blocks new tasks at 95 percent", () => {
    const warning = storageUsage(1000, 200, 80, 95);
    const blocked = storageUsage(1000, 50, 80, 95);
    const belowWarning = storageUsage(1000, 201, 80, 95);
    expect(warning).toMatchObject({ usedPercent: 80, warning: true, blocked: false });
    expect(blocked).toMatchObject({ usedPercent: 95, warning: true, blocked: true });
    expect(belowWarning).toMatchObject({ usedPercent: 79.9, warning: false, blocked: false });
  });
});
