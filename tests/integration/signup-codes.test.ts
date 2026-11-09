import { afterAll, describe, expect, it } from "vitest";
import { checkCode, createPending, MAX_SENDS, MAX_TRIES, newCodeFor } from "@/server/auth/signup-codes";
import { admin, app } from "./helpers";

const email = `code-${Date.now()}@example.org`;
const payload = { name: "Cody", orgName: "Code Co", passwordHash: "x" };
afterAll(async () => {
  await admin.pendingSignup.deleteMany({ where: { email } });
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("sign-up codes", () => {
  it("stores only a hash, allows limited tries, expires, and works once", async () => {
    const { id, code } = await createPending({ email, channel: "EMAIL", phone: null, payload });
    expect(code).toMatch(/^\d{6}$/);
    const row = await admin.pendingSignup.findUniqueOrThrow({ where: { id } });
    expect(row.codeHash).not.toContain(code);
    const wrong = code === "123456" ? "654321" : "123456";
    for (let i = 0; i < MAX_TRIES; i++) await expect(checkCode(id, wrong)).rejects.toThrow(/isn't right|Too many/);
    await expect(checkCode(id, code)).rejects.toThrow(/Too many wrong codes/);
    const again = await newCodeFor(id);
    await expect(checkCode(id, again.code, new Date(Date.now() + 16 * 60_000))).rejects.toThrow(/expired/);
    const p = await checkCode(id, ` ${again.code.slice(0, 3)}-${again.code.slice(3)} `); // spaces/dashes are fine
    expect(p.email).toBe(email);
    await expect(checkCode(id, again.code)).rejects.toThrow(/expired/); // used up
  });
  it("limits how many times a code can be re-sent", async () => {
    const { id } = await createPending({ email, channel: "EMAIL", phone: null, payload });
    for (let i = 1; i < MAX_SENDS; i++) await newCodeFor(id);
    await expect(newCodeFor(id)).rejects.toThrow(/a few times/);
  });
});
