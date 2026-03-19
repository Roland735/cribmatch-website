import { afterEach, describe, expect, test } from "vitest";
import {
  authorizePhoneCredentials,
  getSeedCredentialProfile,
  normalizePhoneNumber,
} from "./auth";

describe("seed credentials", () => {
  test("resolves seed profiles from configured ranges", () => {
    expect(getSeedCredentialProfile("+263770000001")?.role).toBe("admin");
    expect(getSeedCredentialProfile("+263771000001")?.role).toBe("agent");
    expect(getSeedCredentialProfile("+263772000001")?.role).toBe("user");
  });

  test("normalizes local Zimbabwe numbers to seed-compatible format", () => {
    expect(normalizePhoneNumber("0771000001")).toBe("+263771000001");
    expect(normalizePhoneNumber("0772000001")).toBe("+263772000001");
  });
});

describe("authorize fallback without database", () => {
  const originalMongoUri = process.env.MONGODB_URI;

  afterEach(() => {
    if (typeof originalMongoUri === "string" && originalMongoUri.length) {
      process.env.MONGODB_URI = originalMongoUri;
      return;
    }
    delete process.env.MONGODB_URI;
  });

  test("allows seed login when MONGODB_URI is missing", async () => {
    delete process.env.MONGODB_URI;
    const user = await authorizePhoneCredentials({
      phoneNumber: "+263771000001",
      password: "agent12345",
    });
    expect(user?.phoneNumber).toBe("+263771000001");
    expect(user?.role).toBe("agent");
  });

  test("rejects wrong password when MONGODB_URI is missing", async () => {
    delete process.env.MONGODB_URI;
    const user = await authorizePhoneCredentials({
      phoneNumber: "+263771000001",
      password: "wrong-password",
    });
    expect(user).toBeNull();
  });
});
