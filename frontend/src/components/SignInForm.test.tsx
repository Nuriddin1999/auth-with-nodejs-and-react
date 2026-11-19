import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SignInForm from "./SignInForm";

const loginWithPassword = vi.fn();
// A plain function in between: Vitest 5 reports a rejection from vi.fn() as unhandled
// even when the component catches it.
let failWith: Error | null = null;
vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({
    loginWithPassword: async (email: string, password: string) => {
      loginWithPassword(email, password);
      if (failWith) throw failWith;
      return {};
    },
  }),
}));

function renderForm(onDone = vi.fn()) {
  render(
    <MemoryRouter>
      <SignInForm onDone={onDone} />
    </MemoryRouter>,
  );
  return {
    onDone,
    email: screen.getByLabelText("Email"),
    password: screen.getByLabelText("Password"),
    submit: screen.getByRole("button", { name: "Sign in" }),
  };
}

describe("SignInForm", () => {
  beforeEach(() => {
    loginWithPassword.mockReset();
    failWith = null;
  });

  it("keeps Sign in disabled until the email and password are filled in", async () => {
    const { email, password, submit } = renderForm();
    expect(submit).toBeDisabled();
    await userEvent.type(email, "anna@example");
    await userEvent.type(password, "secret");
    expect(submit).toBeDisabled(); // not a full email yet
    await userEvent.type(email, ".com");
    expect(submit).toBeEnabled();
  });

  it("signs in and reports success", async () => {
    const { email, password, submit, onDone } = renderForm();
    await userEvent.type(email, " anna@example.com ");
    await userEvent.type(password, "Str0ng-pass-42");
    await userEvent.click(submit);
    expect(loginWithPassword).toHaveBeenCalledWith("anna@example.com", "Str0ng-pass-42");
    expect(onDone).toHaveBeenCalled();
  });

  it("shows the error and clears the password on failure", async () => {
    failWith = new Error("Invalid email or password");
    const { email, password, submit, onDone } = renderForm();
    await userEvent.type(email, "anna@example.com");
    await userEvent.type(password, "wrong-pass");
    await userEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(password).toHaveValue("");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("can show the password", async () => {
    const { password } = renderForm();
    expect(password).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
  });
});
