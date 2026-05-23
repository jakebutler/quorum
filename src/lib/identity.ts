const key = "quorum_session";

function randomId() {
  return crypto.randomUUID ? crypto.randomUUID() : `anon_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function getAnonymousId() {
  const cookie = document.cookie.split("; ").find((row) => row.startsWith(`${key}=`));
  if (cookie) return decodeURIComponent(cookie.split("=")[1]);
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const id = randomId();
  localStorage.setItem(key, id);
  document.cookie = `${key}=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
  return id;
}
