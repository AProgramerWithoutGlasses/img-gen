import { useCallback, useEffect, useRef, useState } from "react";
import { useStudio } from "../../state/StudioContext";

// Full history is only read when a history screen is opened, never by the workspace poll.
export function useHistoryLoad() {
  const { actions, currentUser } = useStudio();
  const request = useRef(0);
  const [loading, setLoading] = useState(!!actions.loadHistory);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!actions.loadHistory) return;
    const version = ++request.current;
    setLoading(true);
    setError("");
    try { await actions.loadHistory(); }
    catch (failure) {
      if (request.current === version) setError(failure instanceof Error ? failure.message : "读取历史失败");
    } finally {
      if (request.current === version) setLoading(false);
    }
  }, [actions.loadHistory, currentUser.id]);
  useEffect(() => {
    void reload();
    return () => { request.current++; };
  }, [reload]);
  return { loading, error, reload };
}
