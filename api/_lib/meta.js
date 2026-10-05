import { readJson, removeJson, writeJson } from "./blob-store.js";

const CONNECTION_PATH = "meta/connection.json";

function metaError(data, fallback = "Falha na API do Instagram.") {
  const detail = data && data.error ? data.error : null;
  const message = detail && detail.message ? detail.message : fallback;
  const error = new Error(message);
  error.status = 502;
  error.meta = data;
  error.code = detail && detail.code;
  error.subcode = detail && detail.error_subcode;
  return error;
}

async function metaRequest(path, params) {
  const body = new URLSearchParams(params);
  const response = await fetch("https://graph.instagram.com/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json();
  if (!response.ok || data.error) throw metaError(data);
  return data;
}

async function metaGet(path, params = {}) {
  const url = new URL("https://graph.instagram.com/" + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await response.json();
  if (!response.ok || data.error) throw metaError(data);
  return data;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForContainer(containerId, accessToken, options = {}) {
  const timeoutMs = Math.max(5000, Number(options.timeoutMs || 45000));
  const intervalMs = Math.max(700, Number(options.intervalMs || 1500));
  const startedAt = Date.now();
  let lastStatus = "IN_PROGRESS";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await metaGet(String(containerId), {
        fields: "status_code",
        access_token: accessToken,
      });
      lastStatus = String(status.status_code || "IN_PROGRESS").toUpperCase();

      if (lastStatus === "FINISHED" || lastStatus === "PUBLISHED") {
        return status;
      }
      if (lastStatus === "ERROR" || lastStatus === "EXPIRED") {
        const err = new Error("O Instagram não conseguiu processar uma das mídias. Verifique o arquivo e tente novamente.");
        err.status = 502;
        err.meta = status;
        throw err;
      }
    } catch (error) {
      // Some image containers can become publishable before status lookup stabilizes.
      // Keep polling on transient lookup failures, but preserve terminal errors.
      if (error && error.meta && error.meta.status_code && ["ERROR", "EXPIRED"].includes(String(error.meta.status_code).toUpperCase())) {
        throw error;
      }
    }
    await sleep(intervalMs);
  }

  const err = new Error("A mídia ainda está sendo preparada pelo Instagram. Aguarde alguns segundos e tente publicar novamente.");
  err.status = 409;
  err.meta = { containerId, status_code: lastStatus };
  throw err;
}

function isMediaNotReady(error) {
  const detail = error && error.meta && error.meta.error;
  return Number(detail && detail.code) === 9007 ||
    Number(detail && detail.error_subcode) === 2207027 ||
    /media id is not available|media is not ready/i.test(String(error && error.message || ""));
}

async function publishContainer(igId, creationId, accessToken) {
  const deadline = Date.now() + 30000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await metaRequest(igId + "/media_publish", {
        creation_id: creationId,
        access_token: accessToken,
      });
    } catch (error) {
      if (!isMediaNotReady(error)) throw error;
      lastError = error;
      await sleep(1800);
    }
  }

  const err = new Error("O Instagram ainda está preparando a mídia. Aguarde alguns segundos e tente novamente.");
  err.status = 409;
  err.meta = lastError && lastError.meta;
  throw err;
}

export async function validateMetaToken(accessToken) {
  const url = new URL("https://graph.instagram.com/me");
  url.searchParams.set("fields", "id,username,account_type");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await response.json();
  if (!response.ok || data.error || !data.id) return null;
  return { id: data.id, username: data.username || "", account_type: data.account_type || "" };
}

export async function saveMetaConnection(accessToken, expiresIn) {
  const profile = await validateMetaToken(accessToken);
  if (!profile) throw Object.assign(new Error("Não foi possível validar a conta do Instagram."), { status: 502 });
  const now = Date.now();
  const record = {
    accessToken,
    profile,
    connectedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + Math.max(3600, Number(expiresIn || 5184000)) * 1000).toISOString(),
  };
  await writeJson(CONNECTION_PATH, record);
  return record;
}

export async function getMetaConnection() {
  return readJson(CONNECTION_PATH);
}

export async function disconnectMeta() {
  await removeJson(CONNECTION_PATH);
}

function ensurePublishable(project) {
  if (project.platform !== "instagram") {
    throw Object.assign(new Error("Somente conteúdos do Instagram podem ser publicados aqui."), { status: 400 });
  }
  if (!project.assets.length) {
    throw Object.assign(new Error("Adicione pelo menos uma imagem antes de publicar."), { status: 400 });
  }
  const missing = project.assets.find((a) => !a.url || !/^https:\/\//i.test(a.url));
  if (missing) {
    throw Object.assign(new Error("Todas as imagens precisam estar no armazenamento compartilhado antes da publicação."), { status: 409 });
  }
}

export async function publishInstagram(project) {
  ensurePublishable(project);
  const connection = await getMetaConnection();
  if (!connection || !connection.accessToken || !connection.profile || !connection.profile.id) {
    throw Object.assign(new Error("A conta do Instagram não está conectada ao LeadsPay Connect."), { status: 409 });
  }

  const token = connection.accessToken;
  const igId = connection.profile.id;
  const caption = project.caption || "";
  const format = String(project.format || "").toLowerCase();
  let creationId;

  if (format.includes("story")) {
    if (project.assets.length !== 1) {
      throw Object.assign(new Error("Stories precisam ter exatamente uma imagem por publicação."), { status: 400 });
    }
    const container = await metaRequest(igId + "/media", {
      image_url: project.assets[0].url,
      media_type: "STORIES",
      access_token: token,
    });
    creationId = container.id;
    await waitForContainer(creationId, token);
  } else if (project.assets.length > 1 || format.includes("carrossel")) {
    if (project.assets.length < 2) {
      throw Object.assign(new Error("Um carrossel precisa de pelo menos 2 imagens."), { status: 400 });
    }
    if (project.assets.length > 10) {
      throw Object.assign(new Error("O Instagram aceita no máximo 10 itens neste carrossel."), { status: 400 });
    }

    // Create carousel children in parallel to reduce waiting time.
    const children = await Promise.all(project.assets.map((asset) =>
      metaRequest(igId + "/media", {
        image_url: asset.url,
        is_carousel_item: "true",
        access_token: token,
      })
    ));
    const childIds = children.map((child) => child.id);

    // Meta must finish processing every child before the carousel container is created/published.
    await Promise.all(childIds.map((id) => waitForContainer(id, token)));

    const parent = await metaRequest(igId + "/media", {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption,
      access_token: token,
    });
    creationId = parent.id;
    await waitForContainer(creationId, token);
  } else {
    const container = await metaRequest(igId + "/media", {
      image_url: project.assets[0].url,
      caption,
      access_token: token,
    });
    creationId = container.id;
    await waitForContainer(creationId, token);
  }

  const published = await publishContainer(igId, creationId, token);

  return {
    mediaId: published.id,
    containerId: creationId,
    username: connection.profile.username,
    publishedAt: new Date().toISOString(),
  };
}
