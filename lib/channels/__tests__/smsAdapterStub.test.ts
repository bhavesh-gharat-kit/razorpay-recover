import { describe, it, expect } from "vitest";
import { smsAdapterStub } from "../smsAdapterStub";

describe("smsAdapterStub", () => {
  it("reports SENT with a stub- providerRef and never throws", async () => {
    const result = await smsAdapterStub.send({
      channel: "SMS",
      to: { phone: "+919876543210", name: "Test Customer" },
      body: "Acme Store: Your payment link is https://rzp.io/i/abc123",
      metadata: { caseId: "case_1", merchantName: "Acme Store" },
    });

    expect(result.status).toBe("SENT");
    expect(result.providerRef).toMatch(/^stub-/);
  });
});
