import { del, get, list, put } from "@vercel/blob";

// Never turn a storage outage into an empty workspace: callers must be able to
// distinguish missing records from a failed storage service.
function storageError(error, operation) {
  const message = String(error?.message || "");
  if (/suspended|403|forbidden|unauthorized|quota|billing/i.test(message) || error?.statusCode === 403) {
    const failure = new Error("O armazenamento do LeadsPay Connect está indisponível. Os dados existentes foram preservados; verifique o Vercel Blob antes de tentar novamente.");
    failure.statusCode = 503;
    failure.code = "STORAGE_UNAVAILABLE";
    failure.cause = error;
    return failure;
  }
  console.error("Storage operation failed:", operation, error);
  return error;
}

export async function writeJson(pathname, data) {
  try {
    return await put(pathname, JSON.stringify(data), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 0,
    });
  } catch (error) {
    throw storageError(error, "write");
  }
}

export async function readJson(pathname) {
  try {
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode === 404) return null;
    if (result.statusCode !== 200) throw new Error("Erro HTTP " + result.statusCode + " ao ler arquivo.");
    const body = await new Response(result.stream).text();
    return JSON.parse(body);
  } catch (error) {
    if (error?.statusCode === 404 || error?.code === "not_found") return null;
    throw storageError(error, "read");
  }
}

export async function removeJson(pathname) {
  try {
    await del(pathname);
  } catch (error) {
    if (error?.statusCode === 404 || error?.code === "not_found") return;
    throw storageError(error, "delete");
  }
}

export async function listJson(prefix) {
  const items = [];
  let cursor;
  try {
    do {
      const result = await list({ prefix, limit: 100, cursor });
      items.push(...result.blobs);
      cursor = result.cursor || undefined;
    } while (cursor);
    return items;
  } catch (error) {
    throw storageError(error, "list");
  }
}
