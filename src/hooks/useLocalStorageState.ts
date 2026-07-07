import { useEffect, useState } from 'react';

export function useLocalStorageState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;

    try {
      const stored = window.localStorage.getItem(key);
      if (!stored) return initialValue;

      const parsed = JSON.parse(stored) as T;
      if (isPlainObject(initialValue) && isPlainObject(parsed)) {
        return { ...initialValue, ...parsed } as T;
      }

      return parsed;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage may be unavailable in private browsing; keep state in memory.
    }
  }, [key, value]);

  return [value, setValue] as const;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
