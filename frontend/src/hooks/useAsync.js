import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run an async function and track its state, discarding results from a call
 * that has been superseded. Without the guard, dragging the year slider
 * quickly leaves whichever request finishes last on screen rather than the
 * one for the year now selected.
 */
export function useAsync(fn, deps, { immediate = true } = {}) {
  const [state, setState] = useState({ loading: immediate, data: null, error: null });
  const generation = useRef(0);

  const run = useCallback(
    async (...args) => {
      const mine = ++generation.current;
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await fn(...args);
        if (mine === generation.current) setState({ loading: false, data, error: null });
        return data;
      } catch (error) {
        if (mine === generation.current) setState({ loading: false, data: null, error });
        return null;
      }
    },
    deps, // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (immediate) run();
  }, [run, immediate]);

  return { ...state, run, setData: (data) => setState({ loading: false, data, error: null }) };
}
