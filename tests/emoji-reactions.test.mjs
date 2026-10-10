import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

test("Emoji duplicate toggles share one write; Edge writes keep cancelling the last count at zero and failed writes can retry", async () => {
  const folder = await mkdtemp(join(tmpdir(), "astro-paper-emoji-test-"));
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    client: globalThis.__emojiClient,
  };
  const store = new Map();
  let calls = 0,
    release,
    failing = false;
  try {
    globalThis.window = {};
    globalThis.document = {};
    globalThis.localStorage = {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: key => store.delete(key),
    };
    globalThis.__emojiClient = {
      functions: {
        invoke: async (name, { body }) => {
          assert.equal(name, "diary-comment");
          assert.deepEqual(body, {
            action: "emoji",
            content_id: "entry",
            emoji: "👍",
            emoji_user_hash: "viewer",
          });
          calls++;
          if (failing)
            return {
              data: null,
              error: {
                context: Response.json(
                  { error: "temporary failure" },
                  { status: 503 }
                ),
              },
            };
          if (calls === 1)
            return new Promise(resolve => {
              release = () =>
                resolve({
                  data: { emoji: "👍", new_count: 0, is_active: false },
                  error: null,
                });
            });
          return {
            data: { emoji: "👍", new_count: 1, is_active: true },
            error: null,
          };
        },
      },
      rpc: () => {
        throw new Error("Browser must not call the old emoji write RPC");
      },
    };
    const source = await readFile(
      new URL("../src/db/supabase.ts", import.meta.url),
      "utf8"
    );
    const code = ts
      .transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      })
      .outputText.replace(
        /import\s*\{\s*createClient\s*\}\s*from\s*["']@supabase\/supabase-js["'];/,
        "const createClient=()=>globalThis.__emojiClient;"
      )
      .replace(
        /import\s*\{[^}]+\}\s*from\s*["']astro:env\/client["'];/,
        "const SUPABASE_URL='https://example.test', SUPABASE_KEY='fake-public';"
      )
      .replace(
        '"../utils/browserStorage.mjs"',
        JSON.stringify(
          new URL("../src/utils/browserStorage.mjs", import.meta.url).href
        )
      );
    const load = async name => {
      const path = join(folder, `${name}.mjs`);
      await writeFile(path, code);
      return import(pathToFileURL(path).href);
    };
    const client = await load("client");
    const first = client.toggleEmojiReaction("entry", "👍", "viewer");
    const duplicate = client.toggleEmojiReaction("entry", "👍", "viewer");
    assert.equal(calls, 1);
    release();
    const [a, b] = await Promise.all([first, duplicate]);
    assert.deepEqual(a, { emoji: "👍", new_count: 0, is_active: false });
    assert.deepEqual(b, a);
    assert.equal(
      client.getCachedContentReactions("entry", "viewer")[0].count,
      0
    );
    const reloaded = await load("reload");
    assert.equal(
      reloaded.getCachedContentReactions("entry", "viewer")[0].count,
      0
    );
    assert.equal(calls, 1);
    failing = true;
    await assert.rejects(
      () => client.toggleEmojiReaction("entry", "👍", "viewer"),
      /temporary/
    );
    failing = false;
    assert.equal(
      (await client.toggleEmojiReaction("entry", "👍", "viewer")).new_count,
      1
    );
    assert.equal(calls, 3);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const target = key === "client" ? "__emojiClient" : key;
      if (value === undefined) delete globalThis[target];
      else globalThis[target] = value;
    }
    await rm(folder, { recursive: true, force: true });
  }
});
