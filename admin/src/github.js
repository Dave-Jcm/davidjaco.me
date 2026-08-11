const API = "https://api.github.com";

function ghHeaders(env, extra = {}) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "davidjaco-admin-worker",
    ...extra,
  };
}

function repoPath(env, path) {
  return `${API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
}

export async function ghGetFile(env, path) {
  const res = await fetch(`${repoPath(env, path)}?ref=${env.GITHUB_BRANCH}`, {
    headers: ghHeaders(env),
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new Error(`GitHub GET ${path} failed: ${res.status}`);
  }

  return res.json();
}

export async function ghListDir(env, path) {
  const res = await fetch(`${repoPath(env, path)}?ref=${env.GITHUB_BRANCH}`, {
    headers: ghHeaders(env),
  });

  if (res.status === 404) return [];

  if (!res.ok) {
    throw new Error(`GitHub list ${path} failed: ${res.status}`);
  }

  return res.json();
}

export async function ghPutFile(env, path, base64Content, message, sha) {
  const res = await fetch(repoPath(env, path), {
    method: "PUT",
    headers: ghHeaders(env, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      message,
      content: base64Content,
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();

    throw new Error(
      `GitHub write ${path} failed: ${res.status} ${text}`
    );
  }

  return res.json();
}

export async function ghDeleteFile(env, path, message, sha) {
  const res = await fetch(repoPath(env, path), {
    method: "DELETE",
    headers: ghHeaders(env, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      message,
      sha,
      branch: env.GITHUB_BRANCH,
    }),
  });

  if (!res.ok) {
    const text = await res.text();

    throw new Error(
      `GitHub delete ${path} failed: ${res.status} ${text}`
    );
  }

  return res.json();
}