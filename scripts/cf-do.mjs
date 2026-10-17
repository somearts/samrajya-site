// Probe the Cloudflare API for Durable Object namespaces, using the existing
// Wrangler OAuth token. The token is read from disk and never printed.
//
//   node scripts/cf-do.mjs list
//   node scripts/cf-do.mjs delete <namespace-id>

import { readFile } from "node:fs/promises";

const ACCOUNT = "e8521ba894baeb2c69c17dbc48f4eaa7";
const CF = "https://api.cloudflare.com/client/v4";

const token = await wranglerToken();

async function wranglerToken() {
  const path =
    process.env.APPDATA + "\\xdg.config\\.wrangler\\config\\default.toml";
  const text = await readFile(path, "utf8");
  const m = text.match(/^\s*oauth_token\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error("no oauth_token in the wrangler config");
  return m[1];
}

async function call(method, path, body) {
  const res = await fetch(CF + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* shown as-is */
  }
  return { status: res.status, json, text };
}

const action = process.argv[2] || "list";

if (action === "list") {
  const r = await call(
    "GET",
    `/accounts/${ACCOUNT}/workers/durable_objects/namespaces?per_page=100`,
  );
  console.log(`status ${r.status}  success ${r.json?.success}`);
  console.log(JSON.stringify(r.json?.result, null, 1));
  if (r.json?.errors) console.log("errors:", JSON.stringify(r.json.errors));
} else if (action === "sweep") {
  // Everything in the account that could be holding Samrajya state.
  const workers = await call("GET", `/accounts/${ACCOUNT}/workers/scripts`);
  console.log(`\nWorkers  (${workers.json?.result?.length ?? "?"})\n`);
  for (const w of workers.json?.result ?? []) {
    console.log(`  ${w.id}`);
    console.log(
      `     created ${w.created_on ?? "?"}   modified ${w.modified_on ?? "?"}` +
        (w.deployment_id ? `   deployment ${w.deployment_id}` : ""),
    );
    for (const b of w.bindings ?? []) {
      console.log(`     binding ${b.name} -> ${b.type}${b.namespace_id ? " " + b.namespace_id : ""}`);
    }
  }

  const ns = await call("GET", `/accounts/${ACCOUNT}/workers/durable_objects/namespaces?per_page=100`);
  console.log(`\nDurable Object namespaces  (${ns.json?.result?.length ?? "?"})\n`);
  for (const n of ns.json?.result ?? []) {
    console.log(`  ${n.id}  ${n.name}  script=${n.script}  class=${n.class}`);
  }

  const kv = await call("GET", `/accounts/${ACCOUNT}/storage/kv/namespaces?per_page=100`);
  console.log(`\nKV namespaces  (${kv.json?.result?.length ?? "?"})\n`);
  for (const n of kv.json?.result ?? []) console.log(`  ${n.title ?? n.id}`);

  const r2 = await call("GET", `/accounts/${ACCOUNT}/r2/buckets?per_page=100`);
  console.log(`\nR2 buckets  (${r2.json?.result?.length ?? "?"})\n`);
  for (const n of r2.json?.result ?? []) console.log(`  ${n.name}`);

  const d1 = await call("GET", `/accounts/${ACCOUNT}/d1/database?per_page=100`);
  console.log(`\nD1 databases  (${d1.json?.result?.length ?? "?"})\n`);
  for (const n of d1.json?.result ?? []) console.log(`  ${n.uuid}  ${n.name}`);
  console.log();
} else if (action === "inspect") {
  const id = process.argv[3];
  if (!id) throw new Error("usage: inspect <namespace-id>");
  const r = await call(
    "GET",
    `/accounts/${ACCOUNT}/workers/durable_objects/namespaces/${id}`,
  );
  console.log(`GET  ${id}`);
  console.log(`  status  ${r.status}`);
  console.log(`  success ${r.json?.success}`);
  console.log(`  result  ${JSON.stringify(r.json?.result)}`);
  console.log(`  errors  ${JSON.stringify(r.json?.errors)}`);
} else if (action === "delete") {
  const id = process.argv[3];
  if (!id) throw new Error("usage: delete <namespace-id>");
  const r = await call("DELETE", `/accounts/${ACCOUNT}/workers/durable_objects/namespaces/${id}`);
  console.log(`DELETE ${id}`);
  console.log("status:", r.status);
  console.log("success:", r.json?.success);
  if (r.json?.errors) console.log("errors:", JSON.stringify(r.json.errors, null, 1));
} else if (action === "whoami") {
  const r = await call("GET", "/user/tokens/verify");
  console.log("token status:", r.status, JSON.stringify(r.json?.result ?? r.text).slice(0, 300));
}