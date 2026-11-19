import { useState, type InputHTMLAttributes } from "react";
import { cx, ui } from "../ui";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}

/** Password field with a show/hide toggle. */
export default function PasswordInput({ label, value, onChange, hint, ...props }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <label className={ui.field}>
      <span>{label}</span>
      <div className={ui.inputWithAction}>
        <input
          className={cx(ui.input, "pr-16")}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={128}
          spellCheck={false}
          autoCapitalize="none"
          {...props}
        />
        <button
          type="button"
          className={ui.inputAction}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {hint && <small className={ui.hint}>{hint}</small>}
    </label>
  );
}
