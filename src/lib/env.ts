export function env(name: string) {
  const value = import.meta.env[name];
  return typeof value === "string" ? value : "";
}

export const projectToken = env("VITE_QUORUM_PROJECT_TOKEN") || env("QUORUM_PROJECT_TOKEN");
export const storageAdapterName = env("VITE_QUORUM_STORAGE_ADAPTER") || env("QUORUM_STORAGE_ADAPTER") || "corvo";
