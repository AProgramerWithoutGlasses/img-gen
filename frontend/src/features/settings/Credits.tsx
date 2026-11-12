import { useState } from "react";
import { useStudio } from "../../state/StudioContext";
import { Icon } from "../../components/Icon";
import { MODELS } from "../../config/models";
import type { Notify } from "../../types";
import { statusLabel, formatTime, Heading } from "./shared";
import { useHistoryLoad } from "./useHistoryLoad";

export function Credits({ notify }: { notify: Notify }) {
  const { currentUser, data } = useStudio();
  const historyLoad = useHistoryLoad();
  const [page, setPage] = useState(1);
  const history = data.generations
    .filter((generation) => generation.userId === currentUser.id)
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
  const totalPages = Math.max(1, Math.ceil(history.length / 10));
  const visiblePage = Math.min(page, totalPages);
  if (historyLoad.loading || historyLoad.error) return <>
    <Heading title="积分历史" />
    <p role={historyLoad.error ? "alert" : "status"}>{historyLoad.error || "加载中…"}</p>
    {historyLoad.error && <button className="btn" onClick={() => void historyLoad.reload()}>重试</button>}
  </>;
  return (
    <>
      <Heading title="积分历史" />
      <section className="settings-card credits-balance">
        <div>
          <p>可用积分</p>
          <strong>{currentUser.balance.toLocaleString("zh-CN")}</strong>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => notify("充值服务尚未接入。")}
        >
          积分充值
        </button>
      </section>
      <section className="settings-card credit-history" aria-label="历史用量">
        <h2>历史用量</h2>
        <p>查看每次创作的积分使用情况，未生成成功的图片不扣积分。</p>
        <div className="settings-table-wrap">
          <table className="settings-table credit-history-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>模型</th>
                <th>已生成</th>
                <th>积分</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {history
                .slice((visiblePage - 1) * 10, visiblePage * 10)
                .map((generation) => (
                  <tr key={generation.id}>
                    <td className="settings-date">
                      {formatTime(generation.createdAt)}
                    </td>
                    <td>
                      {MODELS.find(
                        (model) => model.id === generation.options.modelId,
                      )?.name ?? generation.options.modelId}
                    </td>
                    <td>{generation.outputs?.filter(output => output.status === "succeeded").length ?? generation.imageIds.length} 张</td>
                    <td>
                      {generation.status === "processing"
                        ? "结算中"
                        : `${generation.cost.toLocaleString("zh-CN")} 积分`}
                    </td>
                    <td>
                      <span className={`status-chip ${generation.status}`}>
                        {generation.status === "failed" &&
                        (generation.outputs?.filter(output => output.status === "succeeded").length ?? generation.imageIds.length) > 0
                          ? "部分完成"
                          : statusLabel(generation.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="table-empty">
                    暂无用量记录，开始创作后会显示在这里。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="settings-pagination">
          <span>共 {history.length} 条记录</span>
          <div>
            <button
              className="icon-button"
              aria-label="上一页用量"
              disabled={visiblePage <= 1}
              onClick={() => setPage(visiblePage - 1)}
            >
              <Icon name="chevronLeft" size={16} />
            </button>
            <span>
              {visiblePage} / {totalPages}
            </span>
            <button
              className="icon-button"
              aria-label="下一页用量"
              disabled={visiblePage >= totalPages}
              onClick={() => setPage(visiblePage + 1)}
            >
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
