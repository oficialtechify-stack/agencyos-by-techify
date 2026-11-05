#!/usr/bin/env node
// One-off Blob -> Firestore migration for LeadsPay Connect.
//
// DRY-RUN BY DEFAULT: lists every JSON record in the Blob, reads it, and
// reports counts only. Nothing is written unless --write is passed.
//
// --write requirements (checked before any write):
//   - CONNECT_STORAGE_BACKEND=firestore
//   - FIREBASE_SERVICE_ACCOUNT_JSON set (the script has no user token, so
//     writes go through the Admin SDK in record-store.js)
//   - BLOB_READ_WRITE_TOKEN set (to list/read the Blob)
//
// Usage:
//   BLOB_READ_WRITE_TOKEN=... node scripts/migrate-blob-to-firestore.mjs
//   BLOB_READ_WRITE_TOKEN=... CONNECT_STORAGE_BACKEND=firestore \
//     FIREBASE_SERVICE_ACCOUNT_JSON='...' \
//     node scripts/migrate-blob-to-firestore.mjs --write [--prefix <p>]
//
// Records are written as connectRecords documents with the same id rule as
// record-store.js (base64url of the path) and fields {path, json, updatedAt,
// ownerUid, ownerRole}. ownerUid comes from the record's createdByUid when
// present (project author); otherwise the record is stamped as system.
// Binary files (chat/files/, content/files/) are NOT migrated: they stay in
// the Blob and keep being served from there (see api/team.js `file` and
// api/meta/publish.js GET ?media=).
import { listJson, readJson } from "../api/_lib/blob-store.js";
import { writeRecord } from "../api/_lib/record-store.js";

const PREFIXES = ["workspace/", "workflow/", "chat/", "meta/", "push/"];
const args = process.argv.slice(2);
const write = args.includes("--write");
const prefixIndex = args.indexOf("--prefix");
const prefixArg = prefixIndex >= 0 ? args[prefixIndex + 1] : "";
const prefixes = prefixArg ? [prefixArg] : PREFIXES;

if (write && process.env.CONNECT_STORAGE_BACKEND !== "firestore") {
  console.error("Refusing to write: set CONNECT_STORAGE_BACKEND=firestore first.");
  process.exit(2);
}
if (write && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  console.error("Refusing to write: FIREBASE_SERVICE_ACCOUNT_JSON is required (no user token in this script).");
  process.exit(2);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is required to list the Blob.");
  process.exit(2);
}

const summary = { mode: write ? "write" : "dry-run", total: 0, written: 0, skipped: 0, failed: 0, perPrefix: {} };
for (const prefix of prefixes) {
  const items = await listJson(prefix);
  const jsonItems = items.filter(b => typeof b.pathname === "string" && b.pathname.endsWith(".json"));
  const stat = { listed: items.length, json: jsonItems.length, written: 0, failed: 0, skipped: 0, withOwner: 0 };
  summary.perPrefix[prefix] = stat;
  for (const item of jsonItems) {
    summary.total++;
    let data = null;
    try {
      data = await readJson(item.pathname);
    } catch (e) {
      console.error("read failed", item.pathname, e?.message || e);
      summary.failed++;
      stat.failed++;
      continue;
    }
    if (data === null) {
      summary.skipped++;
      stat.skipped++;
      continue;
    }
    const authorUid = typeof data?.createdByUid === "string" && data.createdByUid ? data.createdByUid : "";
    if (authorUid) stat.withOwner++;
    const owner = authorUid ? { uid: authorUid } : { uid: "system", role: "system" };
    if (!write) continue;
    try {
      await writeRecord(item.pathname, data, undefined, owner);
      summary.written++;
      stat.written++;
    } catch (e) {
      console.error("write failed", item.pathname, e?.message || e);
      summary.failed++;
      stat.failed++;
    }
  }
}
console.log(JSON.stringify(summary, null, 2));
if (!write) console.log("Dry run only. Re-run with --write to migrate.");
