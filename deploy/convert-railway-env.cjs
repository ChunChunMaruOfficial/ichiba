// Railway Raw Editor export (KEY="value" with \" escapes) -> docker compose env_file (KEY='value', no interpolation).
// Prints variable names only, never values.
const fs = require("fs");
const [src, dst] = process.argv.slice(2);
const skip = /^(RAILWAY_|NODE_ENV$|PORT$|DATABASE_URL$|REDIS_URL$|MEDIA_DIR$|MEDIA_DRIVER$|MEDIA_PUBLIC_URL$|WEB_ORIGIN$|APP_URL$|REALTIME_DRIVER$|TELEGRAM_WEBHOOK_URL$|SMS_|SMTP_PORT$|SMTP_SECURE$)/;
const out = [], dropped = [], bad = [];
for (const raw of fs.readFileSync(src, "utf8").split(/\r?\n/)) {
  if (!raw.trim() || raw.startsWith("#")) continue;
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw);
  if (!m) { bad.push("unparsed line"); continue; }
  let [, k, v] = m;
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(["\\$])/g, "$1");
  if (skip.test(k) || v.includes("${{")) { dropped.push(k); continue; }
  if (v.includes("'") || v.includes("\\n")) { bad.push(k); continue; }
  out.push(`${k}='${v}'`);
}
fs.writeFileSync(dst, out.join("\n") + "\n");
console.log("kept:", out.map((l) => l.split("=")[0]).join(" "));
console.log("dropped:", dropped.join(" "));
console.log("bad:", bad.join(" ") || "none");
for (const k of ["HAND_PASSWORD_HASHES", "TG_PASSWORD_HASHES", "SHOP_PASSWORD_HASHES"]) {
  const l = out.find((x) => x.startsWith(k + "="));
  if (!l) { console.log(k, "absent"); continue; }
  try {
    const o = JSON.parse(l.slice(k.length + 2, -1));
    console.log(k, "valid JSON,", Object.keys(o).length, "accounts, all bcrypt:", Object.values(o).every((h) => /^\$2[aby]\$\d\d\$.{53}$/.test(h)));
  } catch (e) { console.log(k, "INVALID JSON"); }
}
