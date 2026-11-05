import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fingerprintProject, publicProject } from "../api/_lib/workflow.js";
import { cleanProject, statusAllowed } from "../api/team.js";

const base = {
  id: "p1",
  title: "Titulo",
  platform: "instagram",
  format: "Reels",
  campaign: "Campanha",
  caption: "legenda",
  tags: ["a"],
  assets: [{ id: "a1", url: "https://example.com/a.jpg", type: "image/jpeg", order: 2 }],
  status: "draft",
};

describe("fingerprintProject", () => {
  it("é determinístico para o mesmo conteúdo", () => {
    assert.equal(fingerprintProject(base), fingerprintProject({ ...base }));
  });
  it("ignora campos fora do fingerprint (título, tags)", () => {
    assert.equal(
      fingerprintProject(base),
      fingerprintProject({ ...base, title: "Outro título", tags: ["x", "y"] })
    );
  });
  it("muda quando a legenda muda", () => {
    assert.notEqual(fingerprintProject(base), fingerprintProject({ ...base, caption: "outra" }));
  });
  it("muda quando a URL de um asset muda", () => {
    const changed = { ...base, assets: [{ id: "a1", url: "https://example.com/b.jpg", type: "image/jpeg", order: 2 }] };
    assert.notEqual(fingerprintProject(base), fingerprintProject(changed));
  });
});

describe("publicProject", () => {
  it("remove campos extras e normaliza tipos", () => {
    const out = publicProject({ ...base, secreto: "não vai", status: "approved" });
    assert.equal(out.secreto, undefined);
    assert.equal(out.status, undefined);
    assert.equal(out.id, "p1");
    assert.equal(out.title, "Titulo");
    assert.deepEqual(out.tags, ["a"]);
  });
  it("ordena os assets por order", () => {
    const out = publicProject({
      ...base,
      assets: [
        { id: "2", url: "u2", order: 2 },
        { id: "1", url: "u1", order: 1 },
      ],
    });
    assert.deepEqual(out.assets.map((a) => a.id), ["1", "2"]);
  });
});

describe("cleanProject", () => {
  it("força status inválido para draft", () => {
    assert.equal(cleanProject({ id: "x", title: "t", status: "bogus" }).status, "draft");
  });
  it("limita o título a 240 caracteres e preserva o dono", () => {
    const out = cleanProject({ id: "x", title: "t".repeat(300), createdByUid: "uid-1" });
    assert.equal(out.title.length, 240);
    assert.equal(out.createdByUid, "uid-1");
  });
});

describe("statusAllowed", () => {
  const admin = { role: "admin" };
  const designer = { role: "designer" };
  it("admin pode qualquer transição", () => {
    assert.equal(statusAllowed(admin, { status: "approved" }, "draft"), true);
  });
  it("designer sem projeto existente só pode draft/review", () => {
    assert.equal(statusAllowed(designer, null, "draft"), true);
    assert.equal(statusAllowed(designer, null, "approved"), false);
  });
  it("designer não muda status de projeto aprovado", () => {
    assert.equal(statusAllowed(designer, { status: "approved" }, "draft"), false);
    assert.equal(statusAllowed(designer, { status: "approved" }, "approved"), true);
  });
  it("designer pode draft -> review e review -> changes", () => {
    assert.equal(statusAllowed(designer, { status: "draft" }, "review"), true);
    assert.equal(statusAllowed(designer, { status: "review" }, "changes"), true);
    assert.equal(statusAllowed(designer, { status: "draft" }, "published"), false);
  });
});
