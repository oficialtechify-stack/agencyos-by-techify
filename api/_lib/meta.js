import { readJson, removeJson, writeJson } from "./blob-store.js";

const CONNECTION_PATH = "meta/connection.json";

async function metaRequest(path, params) {
  const body = new URLSearchParams(params);
  const response = await fetch("https://graph.instagram.com/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    const message = data && data.error && data.error.message ? data.error.message : "Falha na API do Instagram.";
    const error = new Error(message);
    error.status = 502;
    error.meta = data;
    throw error;
  }
  return data;
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
  } else if (project.assets.length > 1 || format.includes("carrossel")) {
    if (project.assets.length < 2) {
      throw Object.assign(new Error("Um carrossel precisa de pelo menos 2 imagens."), { status: 400 });
    }
    if (project.assets.length > 10) {
      throw Object.assign(new Error("O Instagram aceita no máximo 10 itens neste carrossel."), { status: 400 });
    }

    const childIds = [];
    for (const asset of project.assets) {
      const child = await metaRequest(igId + "/media", {
        image_url: asset.url,
        is_carousel_item: "true",
        access_token: token,
      });
      childIds.push(child.id);
    }

    const parent = await metaRequest(igId + "/media", {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption,
      access_token: token,
    });
    creationId = parent.id;
  } else {
    const container = await metaRequest(igId + "/media", {
      image_url: project.assets[0].url,
      caption,
      access_token: token,
    });
    creationId = container.id;
  }

  const published = await metaRequest(igId + "/media_publish", {
    creation_id: creationId,
    access_token: token,
  });

  return {
    mediaId: published.id,
    containerId: creationId,
    username: connection.profile.username,
    publishedAt: new Date().toISOString(),
  };
}
