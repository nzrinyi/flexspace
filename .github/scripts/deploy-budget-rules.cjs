const fs = require("node:fs");
const crypto = require("node:crypto");
function mergeBudgetRules(source, block) {
  const cleaned = source.replace(
    /\n[ \t]*\/\/ BEGIN FLOWBUDGET CLOUD[\s\S]*?\/\/ END FLOWBUDGET CLOUD\n?/g,
    "\n",
  );
  const match = /match\s+\/databases\/\{database\}\/documents\s*\{/.exec(
    cleaned,
  );
  if (!match)
    throw new Error(
      "The active Firestore rules have an unsupported root; no rules were changed.",
    );
  let depth = 1,
    quote = "",
    lineComment = false,
    blockComment = false;
  for (let i = match.index + match[0].length; i < cleaned.length; i++) {
    const c = cleaned[i],
      n = cleaned[i + 1];
    if (lineComment) {
      if (c === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === "*" && n === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) quote = "";
      continue;
    }
    if (c === "/" && n === "/") {
      lineComment = true;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0)
      return (
        cleaned.slice(0, i).trimEnd() +
        "\n\n" +
        block.trim() +
        "\n  " +
        cleaned.slice(i)
      );
  }
  throw new Error(
    "Could not find the Firestore document root; no rules were changed.",
  );
}
async function deploy() {
  const credentials = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "null",
  );
  if (!credentials?.client_email || !credentials?.private_key)
    throw new Error("Firebase service-account credentials are unavailable.");
  const project = "flexspace-1",
    now = Math.floor(Date.now() / 1000),
    enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const signing =
    enc({ alg: "RS256", typ: "JWT" }) +
    "." +
    enc({
      iss: credentials.client_email,
      scope:
        "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const assertion =
    signing +
    "." +
    crypto
      .sign("RSA-SHA256", Buffer.from(signing), credentials.private_key)
      .toString("base64url");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!tokenResponse.ok)
    throw new Error(
      "Could not authenticate for the budget rules deployment: HTTP " +
        tokenResponse.status,
    );
  const { access_token } = await tokenResponse.json();
  async function api(path, options = {}) {
    const response = await fetch(
      "https://firebaserules.googleapis.com/v1/" + path,
      {
        ...options,
        headers: {
          Authorization: "Bearer " + access_token,
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(
        "Firebase Rules API HTTP " +
          response.status +
          ": " +
          String(result.error?.message || "Request failed").slice(0, 400),
      );
    }
    return response.json();
  }
  const releaseName = `projects/${project}/releases/cloud.firestore`,
    release = await api(releaseName),
    active = await api(release.rulesetName);
  const files = active.source?.files;
  if (
    !Array.isArray(files) ||
    files.length !== 1 ||
    typeof files[0].content !== "string"
  )
    throw new Error(
      "Unsupported active rules source; existing rules were preserved.",
    );
  const block = fs.readFileSync("firestore.budget.rules", "utf8");
  const merged = mergeBudgetRules(files[0].content, block);
  const ruleset = await api(`projects/${project}/rulesets`, {
    method: "POST",
    body: JSON.stringify({
      source: {
        files: [{ name: files[0].name || "firestore.rules", content: merged }],
      },
    }),
  });
  await api(releaseName, {
    method: "PATCH",
    body: JSON.stringify({
      release: { name: releaseName, rulesetName: ruleset.name },
    }),
  });
  const verified = await api(releaseName);
  if (verified.rulesetName !== ruleset.name)
    throw new Error("The active budget rules release could not be verified.");
  console.log(
    "::notice::Budget Firestore rules active and verified. Existing app rules preserved.",
  );
}
module.exports = { mergeBudgetRules };
if (require.main === module)
  deploy().catch((error) => {
    console.error("::error::" + error.message.replace(/[\r\n]/g, " "));
    process.exitCode = 1;
  });
