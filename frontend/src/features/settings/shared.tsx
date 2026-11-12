import type { ReactNode } from "react";
import type { Generation, StudioUser } from "../../types";
import { passwordLengthError } from "../../lib/auth";

export const roleLabel = (role: StudioUser["role"]) =>
  role === "admin" ? "管理员" : "普通用户";
export const statusLabel = (status: Generation["status"]) =>
  ({ completed: "已完成", processing: "处理中", failed: "失败" })[status];
export const formatTime = (value?: string) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试。";
export const validPassword = (password: string) => !passwordLengthError(password);

export function Heading({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="settings-heading">
      <h1>{title}</h1>
      {action}
    </div>
  );
}

export function Field({
  label,
  children,
  error,
  hint,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="settings-field">
      <label>
        <span>{label}</span>
        {children}
      </label>
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </div>
  );
}
