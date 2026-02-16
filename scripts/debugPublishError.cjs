const fs = require("node:fs");
const path = require("node:path");
const { MongoClient } = require("mongodb");

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), name);
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = String(line || "").trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex <= 0) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      let value = trimmed.slice(equalsIndex + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj?.[k];
  return out;
}

async function main() {
  loadEnv();
  const ref = process.argv[2];
  if (!ref) {
    process.stderr.write("Usage: node scripts/debugPublishError.cjs <REF>\n");
    process.exit(2);
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    process.stderr.write("MONGODB_URI not set\n");
    process.exit(2);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const messages = db.collection("messages");

  let doc = await messages.findOne({ "meta.publishError.ref": ref });
  if (!doc) {
    doc = await messages.findOne({
      "meta.publishError.ref": { $regex: String(ref).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), $options: "i" },
    });
  }
  if (!doc) {
    const recent = await messages
      .find({ "meta.publishError.ref": { $exists: true } }, { projection: { _id: 1, phone: 1, wa_message_id: 1, createdAt: 1, "meta.publishError": 1 } })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();
    process.stdout.write(`No message found for ref ${ref}\n`);
    process.stdout.write(`recent_refs: ${JSON.stringify(recent.map((d) => d?.meta?.publishError?.ref).filter(Boolean))}\n`);
    await client.close();
    return;
  }

  const publishError = doc?.meta?.publishError || null;
  process.stdout.write(`publishError: ${JSON.stringify(publishError)}\n`);
  process.stdout.write(`message: ${JSON.stringify(pick(doc, ["_id", "phone", "wa_message_id", "type", "createdAt"]))}\n`);

  const responseJson = doc?.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.interactive?.nfm_reply?.response_json;
  if (typeof responseJson === "string") {
    process.stdout.write(`response_json_first_400: ${responseJson.slice(0, 400)}\n`);
    try {
      const parsed = JSON.parse(responseJson);
      process.stdout.write(`response_json_keys: ${JSON.stringify(Object.keys(parsed || {}))}\n`);
      const data = parsed?.data && typeof parsed.data === "object" ? parsed.data : null;
      if (data) process.stdout.write(`response_json_data_keys: ${JSON.stringify(Object.keys(data))}\n`);
    } catch (e) {
      process.stdout.write(`response_json_parse_error: ${String(e?.message || e)}\n`);
    }
  } else {
    process.stdout.write("response_json_not_found\n");
  }

  await client.close();
}

main().catch((e) => {
  process.stderr.write(`${String(e?.stack || e)}\n`);
  process.exit(1);
});
