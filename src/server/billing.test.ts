import { afterEach, describe, expect, it, vi } from "vitest";
import { billingConnectorStatus, parseBailianBillItems } from "@/server/billing";

afterEach(() => vi.unstubAllEnvs());

describe("billing connectors", () => {
  it("reports connectors unavailable until credentials and filters are configured", () => {
    vi.stubEnv("BAILIAN_BILLING_ACCESS_KEY_ID", "");
    vi.stubEnv("BAILIAN_BILLING_ACCESS_KEY_SECRET", "");
    vi.stubEnv("BAILIAN_BILLING_PRODUCT_CODE", "");
    vi.stubEnv("GOOGLE_BILLING_SERVICE_ACCOUNT_JSON", "");
    vi.stubEnv("GOOGLE_BILLING_SERVICE_ACCOUNT_FILE", "");
    vi.stubEnv("GOOGLE_BILLING_PROJECT_ID", "");
    vi.stubEnv("GOOGLE_BILLING_DATASET", "");
    vi.stubEnv("GOOGLE_BILLING_TABLE", "");
    vi.stubEnv("GOOGLE_BILLING_SERVICE_FILTER", "");
    expect(billingConnectorStatus()).toEqual([
      { provider: "bailian", status: "credentials_missing" },
      { provider: "gemini", status: "credentials_missing" },
    ]);
  });

  it("maps Alibaba bill items to account, item, cycle, and provider-currency records", () => {
    const [line] = parseBailianBillItems("2026-10", [{
      BillAccountID: "123456789",
      ProductCode: "model-studio",
      ProductDetail: "Model Studio",
      BillingItem: "Qwen Image output",
      BillingItemCode: "image-output",
      InstanceID: "account-instance-1",
      AfterDiscountAmount: "12.34",
      PretaxAmount: "12.34",
      Currency: "CNY",
    }]);
    expect(line).toMatchObject({ accountId: "123456789", modelId: "Qwen Image output", amount: 12.34, currency: "CNY" });
    expect(line.sourceId).toMatch(/^[a-f0-9]{64}$/);
    expect(line.raw.periodType).toContain("not an individual image charge");
  });
});
