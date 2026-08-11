const app = document.getElementById("app");
const newDraftBtn = document.getElementById("new-draft-btn");

let activeTab = "drafts";
let currentSlug = null;
let currentView = "dashboard"; // "dashboard" | "editor"
let savedSnapshot = { title: "", body: "" }; // last saved/loaded state, for dirty checks
let autosaveTimer = null;

newDraftBtn.addEventListener("click", () => {
  openEditor({ slug: null, title: "", body: "", draft: true });
});

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- Dashboard ----------

async function showDashboard(tab = activeTab) {
  activeTab = tab;
  currentView = "dashboard";
  currentSlug = null;

  app.innerHTML = `
    <nav class="section-nav">
      <button data-tab="drafts" class="${tab === "drafts" ? "active" : ""}">Drafts</button>
      <span class="sep">·</span>
      <button data-tab="published" class="${tab === "published" ? "active" : ""}">Published</button>
    </nav>
    <div class="post-list" id="post-list">Loading&hellip;</div>
  `;

  app.querySelectorAll(".section-nav button").forEach((btn) => {
    btn.addEventListener("click", () => showDashboard(btn.dataset.tab));
  });

  try {
    const posts = await api("/api/posts");
    const filtered = posts.filter((p) => (tab === "drafts" ? p.draft : !p.draft));
    renderPostList(filtered, tab);
  } catch (err) {
    document.getElementById("post-list").innerHTML =
      `<div class="empty-state">Couldn't load posts: ${escapeHtml(err.message)}</div>`;
  }
}

function renderPostList(posts, tab) {
  const list = document.getElementById("post-list");
  if (!posts.length) {
    list.innerHTML = `<div class="empty-state">No ${tab} posts yet.</div>`;
    return;
  }
  list.innerHTML = posts
    .map(
      (p) => `
      <button class="post-row" data-slug="${escapeHtml(p.slug)}">
        <span class="post-row-title">${escapeHtml(p.title)}</span>
        <span class="post-row-meta">${escapeHtml(p.displayDate)}</span>
      </button>
    `
    )
    .join("");

  list.querySelectorAll(".post-row").forEach((row) => {
    row.addEventListener("click", async () => {
      row.disabled = true;
      try {
        const post = await api(`/api/posts/${row.dataset.slug}`);
        openEditor(post);
      } catch (err) {
        alert(err.message);
        row.disabled = false;
      }
    });
  });
}

// ---------- Editor ----------

function recoveryKeyFor(slug) {
  return `admin-draft:${slug || "new"}`;
}

function readRecovery(slug) {
  try {
    const raw = localStorage.getItem(recoveryKeyFor(slug));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearRecovery(slug) {
  try {
    localStorage.removeItem(recoveryKeyFor(slug));
  } catch {
    /* ignore */
  }
}

function writeRecovery(slug, title, body) {
  try {
    localStorage.setItem(
      recoveryKeyFor(slug),
      JSON.stringify({ title, body, savedAt: Date.now() })
    );
  } catch {
    /* storage unavailable or full — recovery is best-effort only */
  }
}

function scheduleLocalAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const title = document.getElementById("title-input")?.value ?? "";
    const body = document.getElementById("body-input")?.value ?? "";
    writeRecovery(currentSlug, title, body);
  }, 800);
}

function isDirty() {
  const titleEl = document.getElementById("title-input");
  const bodyEl = document.getElementById("body-input");
  if (!titleEl || !bodyEl) return false;
  return titleEl.value !== savedSnapshot.title || bodyEl.value !== savedSnapshot.body;
}

function openEditor(post) {
  currentSlug = post.slug;
  currentView = "editor";
  savedSnapshot = { title: post.title || "", body: post.body || "" };

  app.innerHTML = `
    <button class="btn-text" id="back-btn">&larr; Back</button>
    <div id="nav-warning"></div>

    <div class="editor-header">
      <span class="status-indicator" id="status-indicator">
        <span class="status-dot ${post.draft ? "draft" : "published"}"></span>
        <span id="status-label">${post.draft ? "Draft" : "Published"}</span>
      </span>
    </div>

    <div id="recovery-slot"></div>

    <div class="field">
      <input id="title-input" type="text" value="${escapeAttr(post.title)}" placeholder="Post title">
    </div>

    <div class="field">
      <span class="field-label">Body (Markdown)</span>
      <textarea id="body-input" placeholder="Write here&hellip;">${escapeHtml(post.body || "")}</textarea>
    </div>

    <div class="toolbar">
      <input type="file" id="image-input" accept="image/*" style="display:none">
      <button id="add-image-btn">Add image</button>
      <button id="preview-btn">Preview</button>
    </div>

    <div id="alt-text-slot"></div>
    <div class="preview-box" id="preview-box" style="display:none"></div>

    <div class="actions" id="actions-container"></div>
    <div class="danger-actions" id="danger-actions"></div>
    <div class="status-line" id="status-line"></div>
  `;

  renderActions(post.draft);
  renderDeleteAction(post.title);
  checkRecovery(post);

  const titleEl = document.getElementById("title-input");
  const bodyEl = document.getElementById("body-input");

  document.getElementById("back-btn").addEventListener("click", handleBack);
  document.getElementById("add-image-btn").addEventListener("click", () =>
    document.getElementById("image-input").click()
  );
  document.getElementById("image-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) uploadAndOfferAltText(file);
    e.target.value = "";
  });
  document.getElementById("preview-btn").addEventListener("click", togglePreview);

  [titleEl, bodyEl].forEach((el) => el.addEventListener("input", scheduleLocalAutosave));

  bodyEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    bodyEl.classList.add("drag-over");
  });
  bodyEl.addEventListener("dragleave", () => bodyEl.classList.remove("drag-over"));
  bodyEl.addEventListener("drop", (e) => {
    e.preventDefault();
    bodyEl.classList.remove("drag-over");
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) uploadAndOfferAltText(file);
  });
  bodyEl.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return; // let normal text paste proceed
    e.preventDefault();
    uploadAndOfferAltText(item.getAsFile());
  });
}

function checkRecovery(post) {
  const recovered = readRecovery(post.slug);
  if (!recovered) return;
  if (recovered.title === post.title && recovered.body === (post.body || "")) {
    clearRecovery(post.slug); // matches saved content, nothing to recover
    return;
  }

  const when = new Date(recovered.savedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  const slot = document.getElementById("recovery-slot");
  slot.innerHTML = `
    <div class="recovery-banner">
      <span>Unsaved changes found from ${when}.</span>
      <span class="actions-inline">
        <button id="restore-btn">Restore</button>
        <button id="discard-recovery-btn">Discard</button>
      </span>
    </div>
  `;

  document.getElementById("restore-btn").addEventListener("click", () => {
    document.getElementById("title-input").value = recovered.title;
    document.getElementById("body-input").value = recovered.body;
    slot.innerHTML = "";
  });
  document.getElementById("discard-recovery-btn").addEventListener("click", () => {
    clearRecovery(post.slug);
    slot.innerHTML = "";
  });
}

function handleBack() {
  if (!isDirty()) {
    showDashboard();
    return;
  }
  const warning = document.getElementById("nav-warning");
  warning.innerHTML = `
    <div class="inline-confirm">
      <span>You have unsaved changes.</span>
      <button class="btn-confirm-danger" id="leave-btn">Leave anyway</button>
      <button class="cancel" id="stay-btn">Stay</button>
    </div>
  `;
  document.getElementById("leave-btn").addEventListener("click", () => showDashboard());
  document.getElementById("stay-btn").addEventListener("click", () => (warning.innerHTML = ""));
}

window.addEventListener("beforeunload", (e) => {
  if (currentView === "editor" && isDirty()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

window.addEventListener("keydown", (e) => {
  const isSaveShortcut = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s";
  if (!isSaveShortcut || currentView !== "editor") return;
  e.preventDefault();
  document.getElementById("save-btn")?.click();
});

function renderActions(draft) {
  const container = document.getElementById("actions-container");
  container.innerHTML = draft
    ? `
      <button class="btn" id="save-btn">Save draft</button>
      <button class="btn btn-primary" id="publish-btn">Publish</button>
    `
    : `
      <button class="btn btn-primary" id="save-btn">Save</button>
      <button class="link-danger" id="unpublish-btn">Unpublish</button>
    `;

  document.getElementById("save-btn").addEventListener("click", () =>
    save(draft, draft
      ? { saving: "Saving draft…", done: "Draft saved." }
      : { saving: "Saving…", done: "Saved." }
    )
  );

  if (draft) {
    document.getElementById("publish-btn").addEventListener("click", () =>
      save(false, { saving: "Publishing…", done: "Published. Live in a minute or two." })
    );
  } else {
    document.getElementById("unpublish-btn").addEventListener("click", () => {
      confirmInline(
        "danger-actions",
        "Unpublish this post? It's removed from the live site on the next deploy.",
        "Unpublish",
        () => save(true, { saving: "Unpublishing…", done: "Unpublished." })
      );
    });
  }
}

function renderDeleteAction(title) {
  const container = document.getElementById("danger-actions");
  if (!currentSlug) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `<button class="link-danger" id="delete-btn">Delete permanently</button>`;
  document.getElementById("delete-btn").addEventListener("click", () => {
    confirmInline(
      "danger-actions",
      `Delete "${title}" permanently? This can't be undone.`,
      "Delete",
      () => deleteCurrentPost()
    );
  });
}

// Replaces the given container's content with an inline confirm/cancel row.
// Restores the danger-action link on cancel.
function confirmInline(containerId, message, confirmLabel, onConfirm) {
  const container = document.getElementById(containerId);
  const restore = container.innerHTML;
  container.innerHTML = `
    <div class="inline-confirm">
      <span>${escapeHtml(message)}</span>
      <button class="btn-confirm-danger" id="inline-confirm-btn">${escapeHtml(confirmLabel)}</button>
      <button class="cancel" id="inline-cancel-btn">Cancel</button>
    </div>
  `;
  document.getElementById("inline-confirm-btn").addEventListener("click", onConfirm);
  document.getElementById("inline-cancel-btn").addEventListener("click", () => {
    container.innerHTML = restore;
    // Re-wire whichever action this container held.
    if (containerId === "danger-actions") {
      const post = { title: document.getElementById("title-input").value, slug: currentSlug };
      if (document.getElementById("delete-btn")) renderDeleteAction(post.title);
    }
  });
}

async function deleteCurrentPost() {
  if (!currentSlug) return;
  setStatus("Deleting…");
  try {
    await api(`/api/posts/${currentSlug}`, { method: "DELETE" });
    clearRecovery(currentSlug);
    currentSlug = null;
    await showDashboard(activeTab);
  } catch (err) {
    setStatus(err.message, true);
  }
}

// ---------- Images ----------

async function uploadAndOfferAltText(file) {
  setStatus("Uploading image…");
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/images", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    setStatus("");
    showAltTextForm(data.path);
  } catch (err) {
    setStatus(err.message, true);
  }
}

function showAltTextForm(path) {
  const slot = document.getElementById("alt-text-slot");
  slot.innerHTML = `
    <div class="alt-text-form">
      <label for="alt-text-input">Alt text</label>
      <input type="text" id="alt-text-input" placeholder="Describe the image for accessibility">
      <button id="insert-image-btn">Insert</button>
    </div>
  `;
  const altInput = document.getElementById("alt-text-input");
  altInput.focus();

  function insert() {
    const alt = altInput.value.trim();
    insertAtCursor(document.getElementById("body-input"), `\n![${alt}](${path})\n`);
    scheduleLocalAutosave();
    slot.innerHTML = "";
  }

  document.getElementById("insert-image-btn").addEventListener("click", insert);
  altInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      insert();
    } else if (e.key === "Escape") {
      insert(); // insert with empty alt rather than losing the upload
    }
  });
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
}

// ---------- Preview ----------

async function togglePreview() {
  const box = document.getElementById("preview-box");
  if (box.style.display !== "none") {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  const body = document.getElementById("body-input").value;
  setStatus("Rendering preview…");
  try {
    const { html } = await api("/api/preview", {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    const iframe = document.createElement("iframe");
    iframe.className = "preview-frame";
    // Empty sandbox = no script execution, no forms, no same-origin access,
    // no popups. Markdown-sourced HTML is rendered visually but can't run.
    iframe.setAttribute("sandbox", "");
    iframe.srcdoc = wrapPreviewHtml(html);
    box.innerHTML = "";
    box.appendChild(iframe);
    box.style.display = "block";
    setStatus("");
  } catch (err) {
    setStatus(err.message, true);
  }
}

function wrapPreviewHtml(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<base href="https://davidjaco.me/">
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #333; line-height: 1.6; margin: 0; padding: 8px; }
  p { margin-top: 0; margin-bottom: 10px; }
  img { display: block; width: 50%; max-width: 100%; margin: 0 auto; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

// ---------- Save ----------

async function save(draft, messages) {
  const title = document.getElementById("title-input").value.trim();
  const body = document.getElementById("body-input").value;

  if (!title) {
    setStatus("Title is required.", true);
    return;
  }

  setStatus(messages.saving);
  try {
    if (!currentSlug) {
      const created = await api("/api/posts", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      clearRecovery(null); // migrate off the "new" recovery key
      currentSlug = created.slug;
    }
    const updated = await api(`/api/posts/${currentSlug}`, {
      method: "PUT",
      body: JSON.stringify({ title, body, draft }),
    });

    savedSnapshot = { title: updated.title, body: updated.body };
    clearRecovery(currentSlug);

    const dot = document.querySelector("#status-indicator .status-dot");
    const label = document.getElementById("status-label");
    dot.className = `status-dot ${updated.draft ? "draft" : "published"}`;
    label.textContent = updated.draft ? "Draft" : "Published";

    renderActions(updated.draft);
    renderDeleteAction(updated.title);

    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    setStatus(`${messages.done} (${time})`);
  } catch (err) {
    setStatus(err.message, true);
  }
}

function setStatus(message, isError = false) {
  const line = document.getElementById("status-line");
  if (!line) return;
  line.textContent = message;
  line.className = `status-line ${isError ? "error" : ""}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

showDashboard();
