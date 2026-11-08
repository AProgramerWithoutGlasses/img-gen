import { useEffect, useRef, useState } from "react";
import { useStudio } from "../../state/StudioContext";
import { Modal } from "../../components/Modal";
import { Icon } from "../../components/Icon";
import { MODELS } from "../../config/models";
import type { ModelId } from "../../types";
import { formatTime, messageOf, Heading } from "./shared";
import type { Props } from "./types";

export function Prices({
  notify,
  onDirtyChange,
}: Pick<Props, "notify" | "onDirtyChange">) {
  const { data, actions } = useStudio();
  const [draft, setDraft] = useState<Record<ModelId, string>>(
    () =>
      Object.fromEntries(
        MODELS.map((model) => [model.id, String(data.prices[model.id])]),
      ) as Record<ModelId, string>,
  );
  const [saving, setSaving] = useState<ModelId | null>(null);
  const [error, setError] = useState<Partial<Record<ModelId, string>>>({});
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const priceVersions = useRef({ ...data.priceVersions });
  const dirtyCount = MODELS.filter(
    (model) => draft[model.id] !== String(data.prices[model.id]),
  ).length;
  useEffect(() => {
    onDirtyChange?.(dirtyCount > 0);
    return () => onDirtyChange?.(false);
  }, [dirtyCount, onDirtyChange]);
  useEffect(() => {
    if (!dirtyCount) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirtyCount]);
  async function refresh() {
    let latest = data;
    try {
      latest = (await actions.refreshData?.()) ?? data;
    } catch (cause) {
      notify(messageOf(cause));
      return;
    }
    priceVersions.current = { ...latest.priceVersions };
    setDraft(
      Object.fromEntries(
        MODELS.map((model) => [model.id, String(latest.prices[model.id])]),
      ) as Record<ModelId, string>,
    );
    setError({});
    setConfirmRefresh(false);
  }
  async function save(id: ModelId) {
    const amount = Number(draft[id]);
    if (!draft[id].trim() || !Number.isSafeInteger(amount) || amount < 0)
      return setError({ ...error, [id]: "请输入非负整数。" });
    setSaving(id);
    setError((previous) => ({ ...previous, [id]: undefined }));
    try {
      const version = priceVersions.current?.[id];
      await actions.savePrice(id, amount, version);
      if (version !== undefined && priceVersions.current)
        priceVersions.current[id] = version + 1;
      setDraft((previous) => ({ ...previous, [id]: String(amount) }));
      notify("价格已保存");
    } catch (cause) {
      setError((previous) => ({ ...previous, [id]: messageOf(cause) }));
    } finally {
      setSaving(null);
    }
  }
  const orderedModels = [...MODELS].sort(
    (a, b) =>
      [
        "gemini-3-pro-image",
        "gemini-3.1-flash-image",
        "gpt-image-1.5",
        "gpt-image-2",
        "gpt-image-2.5-sunburst",
      ].indexOf(a.id) -
      [
        "gemini-3-pro-image",
        "gemini-3.1-flash-image",
        "gpt-image-1.5",
        "gpt-image-2",
        "gpt-image-2.5-sunburst",
      ].indexOf(b.id),
  );
  return (
    <>
      <Heading
        title="模型价格"
        action={
          <button
            className="btn"
            disabled={!!saving}
            onClick={() => (dirtyCount ? setConfirmRefresh(true) : refresh())}
          >
            <Icon name="refresh" />
            刷新价格
          </button>
        }
      />
      <p className="price-note">
        按张计费；非负整数，0 表示免费。修改仅影响之后提交的任务。
      </p>
      <div className="settings-table-wrap">
        <table className="settings-table prices-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>单张积分</th>
              <th>最近修改</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {orderedModels.map((model) => {
              const changed = draft[model.id] !== String(data.prices[model.id]);
              return (
                <tr key={model.id}>
                  <td>
                    <strong>{model.name}</strong>
                    <small>{model.id}</small>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      aria-label={`${model.name} 单张积分`}
                      value={draft[model.id]}
                      disabled={saving === model.id}
                      onChange={(event) =>
                        setDraft({ ...draft, [model.id]: event.target.value })
                      }
                    />
                    {changed && <small>已保存：{data.prices[model.id]}</small>}
                    {error[model.id] && (
                      <span className="field-error" role="alert">
                        {error[model.id]}
                      </span>
                    )}
                  </td>
                  <td className="settings-date">
                    {formatTime(data.priceUpdatedAt[model.id])}
                  </td>
                  <td>
                    <button
                      className={`btn ${changed ? "btn-primary" : ""}`}
                      disabled={!changed || !!saving}
                      onClick={() => save(model.id)}
                    >
                      {saving === model.id ? "保存中…" : "保存价格"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dirtyCount > 0 && (
        <p className="settings-muted">有 {dirtyCount} 项价格尚未保存</p>
      )}
      {confirmRefresh && (
        <Modal
          title="放弃未保存的修改？"
          onClose={() => setConfirmRefresh(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmRefresh(false)}>
                继续编辑
              </button>
              <button className="btn btn-primary" onClick={refresh}>
                放弃修改
              </button>
            </>
          }
        >
          <p>刷新后将使用已保存的价格。</p>
        </Modal>
      )}
    </>
  );
}
