export function readStoredJson<T = unknown>(key: string): T | null;
export function writeStoredJson(key: string, value: unknown): boolean;
export function removeStoredValue(key: string): void;
