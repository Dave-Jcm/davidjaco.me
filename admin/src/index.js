import MarkdownIt from "markdown-it";
import {
  ghGetFile,
  ghListDir,
  ghPutFile,
  ghDeleteFile,
} from "./github.js";

import {
  parseFrontmatter,
  stringifyFrontmatter,
} from "./frontmatter.js";

import {
  utf8ToBase64,
  base64ToUtf8,
  bytesToBase64,
} from "./encoding.js";

import {
  slugify,
  todayIso,
  displayDateFor,
  sanitizeFilename,
} from "./slug.js";

// Same config as .eleventy.js, so preview matches the real build.
const md = new MarkdownIt({
  html: true,
  breaks: false,
  linkify: true,
});

const POSTS_DIR = "src/posts";
const IMAGES_DIR = "src/assets/images/posts";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return new Response("Not found", {
        status: 404,
      });
    }

    /*
     * Authentication is handled by Cloudflare Access in front of
     * admin.davidjaco.me.
     *
     * workers.dev is disabled in wrangler.toml, so this Worker is intended
     * to be reached only through the Access-protected custom domain.
     */

    try {
      if (
        url.pathname === "/api/posts" &&
        request.method === "GET"
      ) {
        return json(await listPosts(env));
      }

      const postMatch = url.pathname.match(
        /^\/api\/posts\/([^/]+)$/
      );

      if (
        postMatch &&
        request.method === "GET"
      ) {
        const post = await getPost(
          env,
          postMatch[1]
        );

        return post
          ? json(post)
          : json(
              {
                error: "Not found",
              },
              404
            );
      }

      if (
        url.pathname === "/api/posts" &&
        request.method === "POST"
      ) {
        const body = await request.json();

        return json(
          await createPost(env, body)
        );
      }

      if (
        postMatch &&
        request.method === "PUT"
      ) {
        const body = await request.json();

        return json(
          await updatePost(
            env,
            postMatch[1],
            body
          )
        );
      }

      if (
        postMatch &&
        request.method === "DELETE"
      ) {
        return json(
          await deletePost(
            env,
            postMatch[1]
          )
        );
      }

      if (
        url.pathname === "/api/images" &&
        request.method === "POST"
      ) {
        return json(
          await uploadImage(
            env,
            request
          )
        );
      }

      if (
        url.pathname === "/api/preview" &&
        request.method === "POST"
      ) {
        const { body } =
          await request.json();

        return json({
          html: md.render(body || ""),
        });
      }
    } catch (err) {
      return json(
        {
          error:
            err.message ||
            "Server error",
        },
        500
      );
    }

    return json(
      {
        error: "Not found",
      },
      404
    );
  },
};

async function listPosts(env) {
  const entries = await ghListDir(
    env,
    POSTS_DIR
  );

  const files = entries.filter(
    (entry) =>
      entry.type === "file" &&
      entry.name.endsWith(".md")
  );

  const posts = await Promise.all(
    files.map(async (file) => {
      const slug = file.name.replace(
        /\.md$/,
        ""
      );

      const raw = await ghGetFile(
        env,
        `${POSTS_DIR}/${file.name}`
      );

      const { data } =
        parseFrontmatter(
          base64ToUtf8(raw.content)
        );

      return {
        slug,
        title:
          data.title || slug,
        date:
          data.date || "",
        displayDate:
          data.displayDate || "",
        draft:
          data.draft === true,
      };
    })
  );

  posts.sort((a, b) =>
    a.date < b.date ? 1 : -1
  );

  return posts;
}

async function getPost(env, slug) {
  const raw = await ghGetFile(
    env,
    `${POSTS_DIR}/${slug}.md`
  );

  if (!raw) return null;

  const { data, body } =
    parseFrontmatter(
      base64ToUtf8(raw.content)
    );

  return {
    slug,
    title:
      data.title || "",
    date:
      data.date || "",
    displayDate:
      data.displayDate || "",
    draft:
      data.draft === true,
    body:
      body.trim(),
  };
}

async function createPost(
  env,
  { title }
) {
  if (
    !title ||
    !title.trim()
  ) {
    throw new Error(
      "Title is required"
    );
  }

  const existing =
    await ghListDir(
      env,
      POSTS_DIR
    );

  const existingNames =
    new Set(
      existing.map(
        (entry) =>
          entry.name
      )
    );

  let slug =
    slugify(title);

  let candidate = slug;
  let n = 2;

  while (
    existingNames.has(
      `${candidate}.md`
    )
  ) {
    candidate =
      `${slug}-${n++}`;
  }

  slug = candidate;

  const date =
    todayIso();

  const data = {
    title:
      title.trim(),
    date,
    displayDate:
      displayDateFor(date),
    draft: true,
  };

  const content =
    stringifyFrontmatter(
      data,
      ""
    );

  await ghPutFile(
    env,
    `${POSTS_DIR}/${slug}.md`,
    utf8ToBase64(content),
    `Create draft: ${title.trim()}`
  );

  return {
    slug,
    ...data,
    body: "",
  };
}

async function updatePost(
  env,
  slug,
  {
    title,
    body,
    draft,
  }
) {
  const raw =
    await ghGetFile(
      env,
      `${POSTS_DIR}/${slug}.md`
    );

  if (!raw) {
    throw new Error(
      "Post not found"
    );
  }

  const {
    data: existing,
  } = parseFrontmatter(
    base64ToUtf8(
      raw.content
    )
  );

  const data = {
    title:
      (
        title ??
        existing.title ??
        ""
      ).trim(),

    date:
      existing.date,

    displayDate:
      existing.displayDate,

    draft:
      typeof draft ===
      "boolean"
        ? draft
        : existing.draft ===
          true,
  };

  const newBody =
    (body ?? "").trim();

  const content =
    stringifyFrontmatter(
      data,
      newBody
    );

  const message =
    data.draft
      ? `Update draft: ${data.title}`
      : `Publish: ${data.title}`;

  await ghPutFile(
    env,
    `${POSTS_DIR}/${slug}.md`,
    utf8ToBase64(content),
    message,
    raw.sha
  );

  return {
    slug,
    ...data,
    body: newBody,
  };
}

async function deletePost(
  env,
  slug
) {
  const path =
    `${POSTS_DIR}/${slug}.md`;

  const raw =
    await ghGetFile(
      env,
      path
    );

  if (!raw) {
    throw new Error(
      "Post not found"
    );
  }

  const {
    data,
  } = parseFrontmatter(
    base64ToUtf8(
      raw.content
    )
  );

  const title =
    data.title || slug;

  await ghDeleteFile(
    env,
    path,
    `Delete post: ${title}`,
    raw.sha
  );

  return {
    success: true,
    slug,
  };
}

async function uploadImage(
  env,
  request
) {
  const form =
    await request.formData();

  const file =
    form.get("file");

  if (
    !file ||
    typeof file ===
      "string"
  ) {
    throw new Error(
      "No file provided"
    );
  }

  const filename =
    sanitizeFilename(
      file.name ||
        "image.jpg"
    );

  const buffer =
    await file.arrayBuffer();

  const base64 =
    bytesToBase64(
      new Uint8Array(
        buffer
      )
    );

  const existing =
    await ghListDir(
      env,
      IMAGES_DIR
    ).catch(() => []);

  const existingNames =
    new Set(
      existing.map(
        (entry) =>
          entry.name
      )
    );

  let finalName =
    filename;

  const dot =
    filename.lastIndexOf(
      "."
    );

  const base =
    dot > 0
      ? filename.slice(
          0,
          dot
        )
      : filename;

  const ext =
    dot > 0
      ? filename.slice(
          dot
        )
      : "";

  let n = 2;

  while (
    existingNames.has(
      finalName
    )
  ) {
    finalName =
      `${base}-${n++}${ext}`;
  }

  await ghPutFile(
    env,
    `${IMAGES_DIR}/${finalName}`,
    base64,
    `Add post image: ${finalName}`
  );

  return {
    path:
      `/assets/images/posts/${finalName}`,
  };
}