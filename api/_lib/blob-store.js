import { del, get, list, put } from "@vercel/blob";

export async function writeJson(pathname, data) {
  return put(pathname, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
}

export async function readJson(pathname) {
  try {
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200) return null;
    const text = await new Response(result.stream).text();
    return JSON.parse(text);
  } catch (error) {
    if (error && (error.statusCode === 404 || error.code === "not_found")) return null;
    console.warn("Blob read failed", pathname, error);
    return null;
  }
}

export async function removeJson(pathname) {
  try {
    await del(pathname);
  } catch (error) {
    console.warn("Blob delete failed", pathname, error);
  }
}

export async function listJson(prefix) {
  const items = [];
  let cursor;
  do {
    const result = await list({ prefix, limit: 100, cursor });
    items.push(...result.blobs);
    cursor = result.cursor || undefined;
  } while (cursor);
  return items;
}
