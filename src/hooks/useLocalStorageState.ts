import { useEffect, useState } from "react";

export function useLocalStorageState<T>(key: string, initialValue: T) {
  const [storageError, setStorageError] = useState("");
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;

    try {
      const stored = window.localStorage.getItem(key);
      if (!stored) return initialValue;

      const parsed = JSON.parse(stored) as T;
      if (isPlainObject(initialValue) && !isPlainObject(parsed))
        return initialValue;
      if (isPlainObject(initialValue) && isPlainObject(parsed)) {
        return { ...initialValue, ...parsed } as T;
      }

      if (
        Array.isArray(initialValue)
          ? !Array.isArray(parsed)
          : typeof parsed !== typeof initialValue || parsed === null
      )
        return initialValue;
      return parsed;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      setStorageError("");
    } catch {
      setStorageError(
        "Device storage is unavailable or full. Changes remain in this tab only.",
      );
    }
  }, [key, value]);

  return [value, setValue, storageError] as const;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
