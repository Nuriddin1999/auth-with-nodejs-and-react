import { describe, expect, it } from "vitest";
import { extractCode, isEmail, isFilled, isNewPasswordValid, passwordLengthHint } from "./validation";

describe("isEmail", () => {
  it("accepts a normal address, ignoring spaces around it", () => {
    expect(isEmail(" anna@example.com ")).toBe(true);
  });

  it.each(["", "anna", "anna@", "anna@example", "an na@example.com"])("rejects %j", (value) => {
    expect(isEmail(value)).toBe(false);
  });
});

describe("isFilled", () => {
  it("needs every value to have non-space text", () => {
    expect(isFilled("a", "b")).toBe(true);
    expect(isFilled("a", "  ")).toBe(false);
  });
});

describe("new password", () => {
  it("must be 8+ characters and match the confirmation", () => {
    expect(isNewPasswordValid("Str0ng-pass", "Str0ng-pass")).toBe(true);
    expect(isNewPasswordValid("short", "short")).toBe(false);
    expect(isNewPasswordValid("Str0ng-pass", "Str0ng-pas")).toBe(false);
  });

  it("hints how many characters are missing, but not for an empty field", () => {
    expect(passwordLengthHint("")).toBe("");
    expect(passwordLengthHint("abc")).toBe("At least 8 characters (5 more)");
    expect(passwordLengthHint("abcdefgh")).toBe("");
  });
});

describe("extractCode", () => {
  it.each([
    ["482913", "482913"],
    ["482 913", "482913"],
    ["482-913", "482913"],
    ["Your sign-in code: 482913\n\nIt expires in 2 minutes.", "482913"],
  ])("finds the code in %j", (text, code) => {
    expect(extractCode(text, 6)).toBe(code);
  });

  it.each(["12345", "1234567", "hello", ""])("returns nothing for %j", (text) => {
    expect(extractCode(text, 6)).toBe("");
  });
});
