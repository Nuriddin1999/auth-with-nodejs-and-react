import type { ReactNode } from "react";
import { ui } from "../ui";

interface Props {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export default function AuthCard({ title, subtitle, children, footer }: Props) {
  return (
    <main className={ui.card}>
      <h1 className={ui.title}>{title}</h1>
      {subtitle && <p className={ui.subtitle}>{subtitle}</p>}
      <div className="mt-6">{children}</div>
      {footer && <p className="mt-6 text-center text-[0.95rem] text-muted">{footer}</p>}
    </main>
  );
}
