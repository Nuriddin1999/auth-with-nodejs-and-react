import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CodeStep from "./CodeStep";

function renderStep(props: Partial<Parameters<typeof CodeStep>[0]> = {}) {
  const onVerify = vi.fn().mockResolvedValue(undefined);
  const onResend = vi.fn().mockResolvedValue({ expires_in: 120, code_length: 6 });
  const onBack = vi.fn();
  render(
    <CodeStep email="anna@example.com" codeLength={6} expiresIn={120} onVerify={onVerify} onResend={onResend} onBack={onBack} {...props} />,
  );
  return { onVerify, onResend, onBack, input: screen.getByLabelText("Verification code") };
}

describe("CodeStep", () => {
  it("submits automatically once all digits are typed", async () => {
    const { onVerify, input } = renderStep();
    await userEvent.type(input, "12a3456"); // letters are ignored
    expect(onVerify).toHaveBeenCalledWith("123456");
  });

  it("takes the code out of a pasted message", async () => {
    const { onVerify, input } = renderStep();
    fireEvent.paste(input, { clipboardData: { getData: () => "Your sign-in code: 482913\n\nIt expires in 2 minutes." } });
    await waitFor(() => expect(onVerify).toHaveBeenCalledWith("482913"));
  });

  it("shows the error and clears the field when the code is wrong", async () => {
    const onVerify = vi.fn().mockRejectedValue(new Error("Invalid or expired code"));
    const { input } = renderStep({ onVerify });
    await userEvent.type(input, "000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid or expired code");
    expect(input).toHaveValue("");
  });

  it("enables Continue only for a full code", async () => {
    const { input } = renderStep({ onVerify: vi.fn(() => new Promise(() => {})) });
    const submit = screen.getByRole("button", { name: "Continue" });
    expect(submit).toBeDisabled();
    await userEvent.type(input, "123");
    expect(submit).toBeDisabled();
  });

  it("offers Resend only after the cooldown, and hides it without onResend", () => {
    renderStep();
    expect(screen.getByRole("button", { name: /Resend code in \d+s/ })).toBeDisabled();
    cleanupAndRender();
    expect(screen.queryByRole("button", { name: /Resend/ })).not.toBeInTheDocument();
  });

  it("hides the countdown when the expiry is unknown", () => {
    renderStep({ expiresIn: undefined });
    expect(screen.queryByText(/Code expires in/)).not.toBeInTheDocument();
  });
});

function cleanupAndRender() {
  document.body.innerHTML = "";
  render(<CodeStep email="x" codeLength={6} onVerify={vi.fn()} onBack={vi.fn()} />);
}
