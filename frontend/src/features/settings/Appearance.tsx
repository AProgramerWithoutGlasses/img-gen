import { useState } from "react";
import { useStudio } from "../../state/StudioContext";
import { Icon } from "../../components/Icon";
import type { Notify, Theme } from "../../types";
import { messageOf, Heading } from "./shared";

export function Appearance({ notify }: { notify: Notify }) {
  const { data, actions } = useStudio();
  const [busy, setBusy] = useState(false);
  async function update(patch: { theme?: Theme; enterToSend?: boolean }) {
    setBusy(true);
    try {
      await actions.setPreferences(patch);
    } catch (cause) {
      notify(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="外观与输入" />
      <section className="settings-card">
        <h2>主题</h2>
        <div className="theme-options" role="group" aria-label="主题">
          {(
            [
              { id: "light", name: "浅色", icon: "sun" },
              { id: "dark", name: "深色", icon: "moon" },
              { id: "system", name: "跟随系统", icon: "grid" },
            ] as const
          ).map((theme) => (
            <button
              key={theme.id}
              className={`theme-option ${data.preferences.theme === theme.id ? "selected" : ""}`}
              aria-pressed={data.preferences.theme === theme.id}
              disabled={busy}
              onClick={() => update({ theme: theme.id })}
            >
              <span className={`theme-swatch theme-${theme.id}`}>
                <span />
                <span />
                <span />
              </span>
              <span className="theme-option-label">
                <Icon name={theme.icon} />
                {theme.name}
                {data.preferences.theme === theme.id && <Icon name="check" />}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="settings-card settings-row">
        <div>
          <h2>Enter 发送</h2>
          <p>
            {data.preferences.enterToSend
              ? "Enter 发送，Shift + Enter 换行。"
              : "Enter 换行，点击发送按钮提交。"}
          </p>
        </div>
        <button
          type="button"
          className={`settings-switch ${data.preferences.enterToSend ? "on" : ""}`}
          role="switch"
          aria-label="Enter 发送"
          aria-checked={data.preferences.enterToSend}
          disabled={busy}
          onClick={() => update({ enterToSend: !data.preferences.enterToSend })}
        >
          <span />
        </button>
      </section>
    </>
  );
}
