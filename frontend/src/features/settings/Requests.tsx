import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useStudio } from "../../state/StudioContext";
import { Modal } from "../../components/Modal";
import { Icon } from "../../components/Icon";
import { MODELS } from "../../config/models";
import type { Generation, PreviewImage } from "../../types";
import { statusLabel, formatTime, Heading, Field } from "./shared";
import type { Props } from "./types";
import { useHistoryLoad } from "./useHistoryLoad";

interface Filters {
  user: string;
  prompt: string;
  status: string;
  from: string;
  to: string;
}
function emptyFilters(user = ""): Filters {
  return { user, prompt: "", status: "", from: "", to: "" };
}
function dateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

export function Requests({
  requestUserFilter,
  onPreview,
}: Pick<Props, "requestUserFilter" | "onPreview">) {
  const { data } = useStudio();
  const historyLoad = useHistoryLoad();
  const [filters, setFilters] = useState<Filters>(() =>
    emptyFilters(requestUserFilter),
  );
  const [applied, setApplied] = useState<Filters>(() =>
    emptyFilters(requestUserFilter),
  );
  const [filterError, setFilterError] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Generation | null>(null);
  useEffect(() => {
    setFilters(emptyFilters(requestUserFilter));
    setApplied(emptyFilters(requestUserFilter));
    setPage(1);
  }, [requestUserFilter]);
  const requests = useMemo(
    () =>
      data.generations
        .filter((request) => {
          const time = new Date(request.createdAt).getTime();
          return (
            (!applied.user || request.userId === applied.user) &&
            (!applied.prompt ||
              request.prompt
                .toLowerCase()
                .includes(applied.prompt.toLowerCase())) &&
            (!applied.status || request.status === applied.status) &&
            (!applied.from || time >= new Date(applied.from).getTime()) &&
            (!applied.to || time <= new Date(applied.to).getTime())
          );
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.generations, applied],
  );
  const counts = {
    completed: requests.filter((r) => r.status === "completed").length,
    processing: requests.filter((r) => r.status === "processing").length,
    failed: requests.filter((r) => r.status === "failed").length,
  };
  const totalPages = Math.max(1, Math.ceil(requests.length / 8));
  const currentPage = Math.min(page, totalPages);
  function quickRange(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days + 1);
    from.setHours(0, 0, 0, 0);
    setFilters({
      ...filters,
      from: dateInputValue(from),
      to: dateInputValue(to),
    });
  }
  function apply(e: FormEvent) {
    e.preventDefault();
    if (
      filters.from &&
      filters.to &&
      new Date(filters.from) > new Date(filters.to)
    )
      return setFilterError("开始时间不能晚于结束时间。");
    setFilterError("");
    setApplied(filters);
    setPage(1);
    void historyLoad.reload();
  }
  if (historyLoad.loading || historyLoad.error) return <>
    <Heading title="请求记录" />
    <p role={historyLoad.error ? "alert" : "status"}>{historyLoad.error || "加载中…"}</p>
    {historyLoad.error && <button className="btn" onClick={() => void historyLoad.reload()}>重试</button>}
  </>;
  return (
    <>
      <Heading title="请求记录" />
      <form className="request-filters" onSubmit={apply}>
        <div className="request-filter-top">
          <Field label="用户">
            <select
              value={filters.user}
              onChange={(e) => setFilters({ ...filters, user: e.target.value })}
            >
              <option value="">全部用户</option>
              {data.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))}
            </select>
          </Field>
          <Field label="提示词">
            <input
              placeholder="搜索提示词"
              value={filters.prompt}
              onChange={(e) =>
                setFilters({ ...filters, prompt: e.target.value })
              }
            />
          </Field>
          <Field label="状态">
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters({ ...filters, status: e.target.value })
              }
            >
              <option value="">全部状态</option>
              <option value="completed">已完成</option>
              <option value="processing">处理中</option>
              <option value="failed">失败</option>
            </select>
          </Field>
          <Field label="记录范围">
            <select aria-label="记录范围" value="all" disabled>
              <option value="all">全部记录</option>
            </select>
          </Field>
        </div>
        <div className="request-filter-bottom">
          <div className="quick-dates">
            <button className="btn" type="button" onClick={() => quickRange(1)}>
              今天
            </button>
            <button className="btn" type="button" onClick={() => quickRange(3)}>
              3 天
            </button>
            <button className="btn" type="button" onClick={() => quickRange(7)}>
              7 天
            </button>
          </div>
          <input
            type="datetime-local"
            step="1"
            aria-label="开始时间"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
          <span>至</span>
          <input
            type="datetime-local"
            step="1"
            aria-label="结束时间"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
          <button className="btn btn-primary" type="submit">
            筛选
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setFilters(emptyFilters());
              setApplied(emptyFilters());
              setFilterError("");
              setPage(1);
            }}
          >
            清空
          </button>
        </div>
        <span className="field-hint">
          时区：{Intl.DateTimeFormat().resolvedOptions().timeZone}
        </span>
        {filterError && (
          <p className="field-error" role="alert">
            {filterError}
          </p>
        )}
      </form>
      <div className="request-stats">
        <span>
          匹配请求 <strong>{requests.length}</strong>
        </span>
        <span>
          已完成 <strong>{counts.completed}</strong>
        </span>
        <span>
          处理中 <strong>{counts.processing}</strong>
        </span>
        <span>
          失败 <strong>{counts.failed}</strong>
        </span>
      </div>
      <div className="settings-table-wrap">
        <table className="settings-table requests-table">
          <thead>
            <tr>
              <th>用户 / 时间</th>
              <th>输入 / 模型</th>
              <th>耗时</th>
              <th>积分</th>
              <th>状态</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            {requests
              .slice((currentPage - 1) * 8, currentPage * 8)
              .map((request) => (
                <tr key={request.id}>
                  <td>
                    <strong>{request.username}</strong>
                    <small>{formatTime(request.createdAt)}</small>
                  </td>
                  <td>
                    <button
                      className="request-prompt"
                      onClick={() => setDetail(request)}
                    >
                      {request.prompt}
                    </button>
                    <small>
                      {MODELS.find((m) => m.id === request.options.modelId)
                        ?.name ?? request.options.modelId}
                    </small>
                  </td>
                  <td>
                    {request.durationMs !== undefined
                      ? `${(request.durationMs / 1000).toFixed(1)} 秒`
                      : "—"}
                  </td>
                  <td>
                    {request.status !== "processing" ? request.cost : "—"}
                  </td>
                  <td>
                    <span className={`status-chip ${request.status}`}>
                      {statusLabel(request.status)}
                    </span>
                  </td>
                  <td>
                    <button
                      className="request-result"
                      aria-label={`查看 ${request.username} 的请求详情`}
                      onClick={() => setDetail(request)}
                    >
                      {request.imageIds.length ? (
                        <div className="request-thumbnails">
                          {request.imageIds.slice(0, 2).map((id) => {
                            const asset = data.assets.find((a) => a.id === id);
                            return asset ? (
                              <img
                                key={id}
                                src={asset.thumbnailUrl ?? asset.url}
                                alt="生成图片"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : null;
                          })}
                        </div>
                      ) : request.error ? (
                        <span className="request-error-summary">
                          {request.error}
                        </span>
                      ) : (
                        "查看详情"
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            {!requests.length && (
              <tr>
                <td colSpan={6} className="table-empty">
                  没有匹配的请求
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="settings-pagination">
        <span>共 {requests.length} 条请求</span>
        <div>
          <button
            className="icon-button"
            aria-label="上一页请求"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <Icon name="chevronLeft" />
          </button>
          <span>
            {currentPage} / {totalPages}
          </span>
          <button
            className="icon-button"
            aria-label="下一页请求"
            disabled={currentPage === totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>
      {detail && (
        <RequestDetail
          request={data.generations.find((r) => r.id === detail.id) ?? detail}
          onClose={() => setDetail(null)}
          onPreview={onPreview}
        />
      )}
    </>
  );
}

function RequestDetail({
  request,
  onClose,
  onPreview,
}: {
  request: Generation;
  onClose: () => void;
  onPreview: PreviewImage;
}) {
  const { data } = useStudio();
  const images = data.assets.filter((asset) =>
    request.imageIds.includes(asset.id),
  );
  return (
    <Modal
      title="请求详情"
      onClose={onClose}
      className="settings-drawer request-detail"
    >
      <div className="request-detail-meta">
        <span className={`status-chip ${request.status}`}>
          {statusLabel(request.status)}
        </span>
        <dl>
          <dt>用户</dt>
          <dd>{request.username}</dd>
          <dt>请求时间</dt>
          <dd>{formatTime(request.createdAt)}</dd>
          <dt>模型</dt>
          <dd>{MODELS.find((m) => m.id === request.options.modelId)?.name}</dd>
          <dt>参数</dt>
          <dd>
            {[
              request.options.quality,
              request.options.ratio,
              request.options.resolution,
              `${request.options.count} 张`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </dd>
          <dt>耗时</dt>
          <dd>
            {request.durationMs !== undefined
              ? `${(request.durationMs / 1000).toFixed(1)} 秒`
              : "—"}
          </dd>
          <dt>消耗积分</dt>
          <dd>{request.status !== "processing" ? request.cost : "—"}</dd>
        </dl>
      </div>
      <section>
        <h3>提示词</h3>
        <p className="request-full-prompt">{request.prompt}</p>
      </section>
      {request.attachments.length > 0 && (
        <section>
          <h3>参考图片</h3>
          <div className="request-attachment-list">
            {request.attachments.map((attachment) => (
              <img
                key={attachment.id}
                src={attachment.url}
                alt={attachment.name}
              />
            ))}
          </div>
        </section>
      )}
      <section>
        <h3>生成结果</h3>
        {images.length > 0 ? (
          <div className="request-detail-images">
            {images.map((image) => (
              <button
                key={image.id}
                onClick={() => {
                  onClose();
                  onPreview(image, images);
                }}
                aria-label={`查看 ${image.name}`}
              >
                <img
                  src={image.previewUrl ?? image.url}
                  alt={image.name}
                  loading="lazy"
                  decoding="async"
                />
              </button>
            ))}
          </div>
        ) : (
          <p className={request.error ? "field-error" : "settings-muted"}>
            {request.error || "正在生成…"}
          </p>
        )}
      </section>
    </Modal>
  );
}
