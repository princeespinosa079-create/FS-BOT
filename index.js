const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  Partials
} = require("discord.js");
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ============================================================
// ENV
// ============================================================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = "1302080645987569694";
const BUYER_ROLE_ID = "1553385966629158963";
const PRINCE_ROLE_ID = "1547849774676316181";
const ALT_ROLE_ID = "1537881754185113670";
const REGULAR_COLOR = 0x2B2D31;
const YELLOW_COLOR = 0xF1C40F;
const PORT = Number(process.env.PORT) || 10000;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing env vars");
  process.exit(1);
}

// ============================================================
// STORAGE
// ============================================================
const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;
const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const ALTLIST_FILE = path.join(DATA_DIR, "altlist.json");
const KEYS_FILE = path.join(DATA_DIR, "keys.json");

function readJSON(file, fallback) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
  } catch (e) {
    console.error(`❌ ${path.basename(file)}:`, e.message);
    return fallback;
  }
}
function writeJSON(file, data) {
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error(`❌ Saving ${path.basename(file)}:`, e.message);
  }
}

let config = readJSON(CONFIG_FILE, { allowedChannelId: null });
if (!config || typeof config !== "object") config = { allowedChannelId: null };
let library = readJSON(LIBRARY_FILE, { files: [] });
if (Array.isArray(library)) library = { files: library };
if (!Array.isArray(library.files)) library.files = [];
let altlist = readJSON(ALTLIST_FILE, { scores: {} });
if (!altlist.scores) altlist.scores = {};
let keyStore = readJSON(KEYS_FILE, { keys: [] });
if (!Array.isArray(keyStore.keys)) keyStore.keys = [];

// ============================================================
// KEY SYSTEM HELPERS
// ============================================================
function parseDuration(str) {
  if (!str || str === "" || str === "infinite" || str === "0") return null;
  const match = String(str).match(/^(\d+)([smhdw])$/i);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return num * ms[unit];
}
function generateKey() {
  return "PRINCE-" + crypto.randomBytes(10).toString("hex").toUpperCase();
}
function findKeyRecord(keyStr) {
  return keyStore.keys.find(k => k.key === keyStr);
}
function findActiveKeyForUser(userId) {
  return keyStore.keys.find(k =>
    k.redeemedBy === userId &&
    (k.expiresAt === null || k.expiresAt > Date.now())
  );
}
function cleanupExpiredKeys() {
  const now = Date.now();
  let changed = false;
  keyStore.keys = keyStore.keys.filter(k => {
    if (k.redeemedBy && k.expiresAt !== null && k.expiresAt < now) {
      client.guilds.fetch(GUILD_ID).then(g =>
        g.members.fetch(k.redeemedBy).then(m =>
          m.roles.remove(BUYER_ROLE_ID).catch(() => {})
        ).catch(() => {})
      ).catch(() => {});
      changed = true;
      return false;
    }
    return true;
  });
  if (changed) writeJSON(KEYS_FILE, keyStore);
}
setInterval(cleanupExpiredKeys, 10 * 1000);

// ============================================================
// HELPERS
// ============================================================
function isOwner(userId) { return userId === OWNER_ID; }
async function isBuyer(userId, member) {
  const uid = userId || member?.id;
  if (!uid) return false;
  if (uid === OWNER_ID) return true;
  try {
    const g = await client.guilds.fetch(GUILD_ID);
    const m = await g.members.fetch(uid, { force: true });
    return m.roles.cache.has(BUYER_ROLE_ID);
  } catch { return false; }
}
function replyUser(msg, payload) {
  const body = typeof payload === "string" ? { content: payload } : { ...payload };
  body.allowedMentions = { repliedUser: true };
  return msg.reply(body);
}
function randomName(len = 20) {
  const c = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
async function downloadURL(url) {
  try {
    if (url.includes("github.com") && url.includes("/blob/")) {
      url = url.replace("/blob/", "/raw/");
    }
    if (url.includes("pastebin.com") && !url.includes("/raw/")) {
      url = url.replace("pastebin.com/", "pastebin.com/raw/");
    }
    if (url.includes("pastefy.app") && !url.includes("/raw/")) {
      url = url.replace("pastefy.app/", "pastefy.app/raw/");
    }
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer()).toString("utf8");
  } catch (e) {
    throw new Error(`Download failed: ${e.message}`);
  }
}
function formatTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}
function formatFooterTime() {
  const d = new Date();
  return `Today at ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
}

// ============================================================
// ALT ROLE APPLY
// ============================================================
async function applyAltRole(member) {
  if (!member || !member.guild) return;
  try {
    await member.roles.remove(member.roles.cache.filter(r => r.id !== member.guild.roles.everyone.id));
    await member.roles.add(ALT_ROLE_ID);
  } catch (e) {
    console.error(`❌ ALT role: ${e.message}`);
  }
}

// ============================================================
// STATUS CHECK
// ============================================================
function hasRequiredStatus(presence) {
  if (!presence?.activities) return false;
  for (const act of presence.activities) {
    if (act.state?.includes(".gg/TBBAUZu8cW")) return true;
    if (act.details?.includes(".gg/TBBAUZu8cW")) return true;
    if (act.name?.includes(".gg/TBBAUZu8cW")) return true;
  }
  return false;
}
async function syncPrinceRoleFromPresence(member) {
  if (!member || !member.guild) return;
  try {
    const fresh = await member.guild.members.fetch(member.id, { force: true });
    const presence = client.presences?.cache.get(fresh.id);
    const hasStatus = hasRequiredStatus(presence);
    const hasRole = fresh.roles.cache.has(PRINCE_ROLE_ID);
    if (hasStatus && !hasRole) {
      await fresh.roles.add(PRINCE_ROLE_ID);
    } else if (!hasStatus && hasRole) {
      await fresh.roles.remove(PRINCE_ROLE_ID);
    }
  } catch {}
}

// ============================================================
// CLEAN LUA
// ============================================================
function cleanLuaScript(code) {
  if (!code || typeof code !== "string") return code || "";
  
  const lines = code.split(/\r?\n/);
  const cleaned = [];
  const seen = new Set();

  const headerPatterns = [
    /hub|version|complete|script|ui|menu/i,
    /leaked\s+by|leak\s*:/i,
    /discord\.gg\/[a-zA-Z0-9-]+/,
    /^[-=*_#]+$/,
    /^\s*$/,
    /anti-?\w*\s*\+/i,
    /lock|background|minimize|jump|inf\s*jump/i
  ];

  const luaKeywords = [
    "local", "function", "if ", "then", "end", "return", "for ", "while", "repeat", "until",
    "do ", "and ", "or ", "not ", "true", "false", "nil", "print", "pairs", "ipairs",
    "game", "workspace", "script", "task", "coroutine", "pcall", "require", "getfenv",
    "setfenv", "loadstring", "string.", "math.", "table.", "os.", "debug.",
    "Vector3", "CFrame", "Instance", "Color3", "UDim2", "Raycast", "tostring", "tonumber"
  ];

  const ipDomains = ["iplogger.org", "grabify.link", "nipiscan.com", "bit.ly", "tinyurl.com", "is.gd", "cutt.ly", "adf.ly", "linkvertise.com", "iplogger", "grabify"];
  const loaderPatterns = [/loadstring\s*\(/gi, /game\s*:\s*HttpGet\s*\(/gi, /HttpService\s*:\s*GetAsync\s*\(/gi, /syn\s*\.\s*request\s*\(/gi];

  for (let line of lines) {
    const t = line.trim();
    
    if (!t) continue;
    if (seen.has(t)) continue;

    let isHeader = false;
    for (const p of headerPatterns) {
      if (p.test(t) && t.length < 100) {
        const hasKeyword = luaKeywords.some(k => t.includes(k));
        if (!hasKeyword) {
          isHeader = true;
          break;
        }
      }
    }
    if (isHeader) continue;

    if (t.startsWith("--")) continue;

    let skip = false;
    for (const p of loaderPatterns) if (p.test(t)) { skip = true; break; }
    if (ipDomains.some(d => t.includes(d))) skip = true;
    if (skip) continue;

    if (/^\s*(print|warn)\s*\(.*\)\s*;?\s*$/i.test(t) && !t.includes('"prince"')) {
      const newLine = 'print("prince")';
      if (!seen.has(newLine)) {
        cleaned.push(newLine);
        seen.add(newLine);
      }
      continue;
    }

    const looksLikeLua = luaKeywords.some(k => t.includes(k)) ||
                         /[A-Za-z_]\w*\s*[=:]\s*/.test(t) ||
                         /\.(Position|CFrame|Size|Color|Transparency|Visible|Enabled|Parent|Name)\s*=/.test(t) ||
                         /\b(if|for|while|function)\b/.test(t) ||
                         /[=+\-*/%&|^<>]=?\s*[\w"']/.test(t) ||
                         /\b(Instance|Vector3|Color3|UDim2)\b/.test(t);

    if (looksLikeLua) {
      seen.add(t);
      cleaned.push(line);
    }
  }

  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ============================================================
// OBFUSCATOR
// ============================================================
function generateVarName() {
  return "_" + crypto.randomBytes(8).toString("hex");
}
function obfuscateLua(code) {
  if (!code || typeof code !== "string") return code || "";
  const KEY = crypto.randomBytes(12).toString("hex");
  const strings = [];
  code = code.replace(/"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'/g, (m, g1, _, g3) => {
    const content = g1 !== undefined ? g1 : g3;
    if (content.length < 4) return m;
    let enc = "";
    for (let i = 0; i < content.length; i++) {
      enc += String.fromCharCode(content.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
    }
    const idx = strings.push(Buffer.from(enc).toString("base64")) - 1;
    return `__S[${idx}]`;
  });
  const renamed = new Map();
  code = code.replace(/\blocal\s+([a-zA-Z_]\w*)/g, (full, name) => {
    const protect = ["string", "math", "table", "pcall", "pairs", "game", "workspace", "print", "task"];
    if (protect.includes(name)) return full;
    if (!renamed.has(name)) renamed.set(name, generateVarName());
    return `local ${renamed.get(name)}`;
  });
  return `-- Prince Obfuscator V15
-- Generated ${Date.now()}
if debug and debug.traceback and debug.traceback():find("pcall") then return end
local __K="${KEY}"
local __D=function(d)local r=""for i=1,#d do r=r..string.char(string.byte(d,i)~string.byte(__K,((i-1)%#__K)+1))end return r end
local __S=(function(){local t={};local d=${JSON.stringify(strings)};for i=1,#d do t[i-1]=__D(d[i])end return t end)()
${code}
`;
}

// ============================================================
// COOLDOWNS
// ============================================================
const commandCooldowns = new Map();
const COOLDOWNS = { rename: 10, scan: 60, whs: 1200, obf: 15, upload: 10, dl: 15, get: 10, generatekey: 0, redeem: 5, profile: 5 };
function checkCooldown(userId, cmd, bypass = false) {
  if (bypass) return { ok: true };
  const sec = COOLDOWNS[cmd];
  if (!sec) return { ok: true };
  const key = `${cmd}:${userId}`;
  const exp = commandCooldowns.get(key);
  if (exp && Date.now() < exp) {
    const rem = Math.ceil((exp - Date.now()) / 1000);
    return { ok: false, msg: `⏳ ${rem}s cooldown` };
  }
  commandCooldowns.set(key, Date.now() + sec * 1000);
  return { ok: true };
}

// ============================================================
// PERMISSION SYSTEM
// ============================================================
async function checkRegularPermission(msg, silent = false) {
  if (isOwner(msg.author.id)) return true;
  const isBuyerUser = isOwnerUser || await isBuyer(msg.author.id, msg.member);
  if (isBuyerUser && !msg.guild) return true;
  if (!msg.guild) {
    if (!silent) replyUser(msg, "❌ buy source access if you want to use the command here.");
    return false;
  }
  if (isBuyerUser) return true;
  const allowed = config.allowedChannelId;
  if (!allowed) return true;
  if (msg.channel.id === allowed) return true;
  return false;
}

// ============================================================
// CLIENT
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages
  ],
  partials: ["CHANNEL"]
});

client.on("presenceUpdate", (_, newPresence) => {
  if (newPresence.userId) {
    client.guilds.fetch(GUILD_ID).then(g => g.members.fetch(newPresence.userId)).then(m => syncPrinceRoleFromPresence(m)).catch(() => {});
  }
});

client.once("ready", async () => {
  console.log(`✅ ONLINE: ${client.user.tag}`);
  const g = await client.guilds.fetch(GUILD_ID);
  const members = await g.members.list({ limit: 200 });
  for (const [_, m] of members) syncPrinceRoleFromPresence(m);
  cleanupExpiredKeys();
  console.log("✅ Ready — key cleanup every 10s");
});

// ============================================================
// HELP PAGINATION
// ============================================================
const helpPages = [
  new EmbedBuilder()
    .setTitle("Help Menu")
    .setColor(REGULAR_COLOR)
    .setDescription(
`**\`.rename\`** [\`.rn\`] Remove comments, IP loggers, script loaders, headers & spam.

**\`.obf\`** Obfuscate your script — encrypt strings, Anti-Debug, Anti-Dump, make code unreadable.

**\`.download\`** [\`.dl\`] File link, TikTok Video, using link, etc.`
    ),
  new EmbedBuilder()
    .setTitle("Help Menu")
    .setColor(REGULAR_COLOR)
    .setDescription(
`**\`.et\`** Extract files from zip archives.

**\`.upload\`** Turn your file into Script Loader.

**\`.get\`** Get file using ID.`
    ),
  new EmbedBuilder()
    .setTitle("Help Menu")
    .setColor(REGULAR_COLOR)
    .setDescription(
`**\`.find\`** Search files by name.

**\`.delwh\`** Delete a webhook using its URL.

**\`.whs\`** Webhook Spammer — Raid a Webhook using its URL.`
    ),
  new EmbedBuilder()
    .setTitle("Help Menu")
    .setColor(YELLOW_COLOR)
    .setDescription(
`**\`.redeem\`** [\`.red\`] - Redeem a premium key.

**\`.profile\`** [\`.prof\`] - Check profile & active key.

> Premium users can use all commands in DMs.
> Premium users bypass cooldown.`
    )
];

// ============================================================
// SLASH COMMANDS
// ============================================================
const commands = [
  {
    name: "say",
    description: "Send a message",
    options: [
      { name: "text", type: 3, description: "Message content", required: true },
      { name: "title", type: 3, description: "Embed title" },
      { name: "footer", type: 3, description: "Footer text" },
      {
        name: "type",
        type: 3,
        description: "Message style",
        choices: [
          { name: "With Embed", value: "embed" },
          { name: "No Embed", value: "plain" }
        ]
      }
    ]
  }
];

const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Slash commands registered");
  } catch (e) { console.error("❌ Slash cmd:", e); }
})();

const whsInitiators = new Map();
const helpSessions = new Map();

client.on("interactionCreate", async interaction => {
  if (interaction.customId?.startsWith("help_")) {
    const [_, uid, dir] = interaction.customId.split("_");
    if (interaction.user.id !== uid) {
      return interaction.reply({ content: "❌ Not yours.", ephemeral: true });
    }
    let page = helpSessions.get(uid) || 0;
    if (dir === "prev") page = Math.max(0, page - 1);
    if (dir === "next") page = Math.min(helpPages.length - 1, page + 1);
    helpSessions.set(uid, page);
    const embed = EmbedBuilder.from(helpPages[page])
      .setFooter({ text: `Request by @${interaction.user.username}│Help Menu`, iconURL: interaction.user.displayAvatarURL() });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`help_${uid}_prev`).setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`help_${uid}_next`).setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(page === helpPages.length - 1)
    );
    await interaction.update({ embeds: [embed], components: [row] });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "say") {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ content: "❌ Only owner", ephemeral: true });
    }
    const text = interaction.options.getString("text", true);
    const title = interaction.options.getString("title");
    const footerText = interaction.options.getString("footer");
    const type = interaction.options.getString("type") || "plain";
    if (type === "embed") {
      const embed = new EmbedBuilder().setColor(REGULAR_COLOR).setDescription(text);
      if (title) embed.setTitle(title);
      if (footerText) embed.setFooter({ text: footerText, iconURL: interaction.user.displayAvatarURL() });
      await interaction.reply({ embeds: [embed] });
    } else {
      await interaction.reply({ content: text });
    }
    return;
  }

  if (interaction.customId === "whs_start") {
    const initiatorId = whsInitiators.get(interaction.message.id);
    if (!initiatorId || interaction.user.id !== initiatorId) {
      return interaction.reply({ content: "❌ Not yours bro.", ephemeral: true });
    }
    const modal = new ModalBuilder().setCustomId("whs_modal").setTitle("Webhook Spammer")
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("webhook_url").setLabel("Webhook URL").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("https://discord.com/api/webhooks/...")),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("spam_message").setLabel("Message").setStyle(TextInputStyle.Paragraph).setRequired(true))
      );
    await interaction.showModal(modal);
    return;
  }
  if (interaction.customId === "whs_modal") {
    await interaction.deferReply({ ephemeral: true });
    const webhookUrl = interaction.fields.getTextInputValue("webhook_url").trim();
    const message = interaction.fields.getTextInputValue("spam_message").trim();
    if (!webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
      return interaction.editReply("❌ Not Found.");
    }
    let sent = 0, failed = 0;
    for (let i = 0; i < 200; i++) {
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: message })
        });
        if (res.ok) sent++; else failed++;
      } catch { failed++; }
      await new Promise(r => setTimeout(r, 30));
    }
    const resEmbed = new EmbedBuilder().setTitle("✅ Spam Complete")
      .addFields({ name: "Sent", value: `${sent}`, inline: true }, { name: "Failed", value: `${failed}`, inline: true })
      .setColor(REGULAR_COLOR);
    await interaction.editReply({ embeds: [resEmbed] });
    return;
  }
});

// ============================================================
// MESSAGE COMMANDS
// ============================================================
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  const txt = msg.content.trim();
  const isOwnerUser = isOwner(msg.author.id);
  const isBuyerUser = isOwnerUser || await isBuyer(msg.author.id, msg.member);

  // .help — ALWAYS works everywhere
  if (/^\.help(?:\s|$)/i.test(txt)) {
    const page = 0;
    helpSessions.set(msg.author.id, page);
    const embed = EmbedBuilder.from(helpPages[page])
      .setFooter({ text: `Request by @${msg.author.username}│Help Menu`, iconURL: msg.author.displayAvatarURL() });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`help_${msg.author.id}_prev`).setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`help_${msg.author.id}_next`).setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(helpPages.length === 1)
    );
    return replyUser(msg, { embeds: [embed], components: [row] });
  }

  // .profile / .prof — works for everyone
  if (/^\.profile(?:\s|$)|^\.prof(?:\s|$)/i.test(txt)) {
    const cd = checkCooldown(msg.author.id, "profile", isBuyerUser);
    if (!cd.ok) return replyUser(msg, cd.msg);
    
    let targetId = msg.author.id;
    const mention = msg.mentions.users.first();
    if (mention) targetId = mention.id;
    else {
      const idMatch = txt.match(/(\d{17,20})/);
      if (idMatch) targetId = idMatch[1];
    }

    const activeKey = findActiveKeyForUser(targetId);
    const targetUser = await client.users.fetch(targetId).catch(() => null);
    const displayName = targetUser ? `@${targetUser.username}` : `<@${targetId}>`;

    const embed = new EmbedBuilder()
      .setTitle("Profile Status")
      .setDescription(
`User: ${displayName} (\`${targetId}\`)
Key Active: ${activeKey ? `\`${activeKey.key}\`` : "❌ No active key"}`
      )
      .setColor(REGULAR_COLOR)
      .setFooter({ text: formatFooterTime() });

    return replyUser(msg, { embeds: [embed] });
  }

  // .generatekey — Owner Only
  if (/^\.generatekey(?:\s|$)/i.test(txt)) {
    if (!isOwnerUser) return;
    const rest = txt.replace(/^\.generatekey\s+/i, "").trim();
    const parts = rest.split(/\s+/);
    
    let timeStr = parts[0] || "";
    let amountStr = parts[1] || "1";
    
    const durMs = parseDuration(timeStr);
    const amount = parseInt(amountStr) || 1;
    
    if (amount < 1 || amount > 50) {
      return replyUser(msg, "❌ Amount must be 1–50");
    }

    const generatedKeys = [];
    for (let i = 0; i < amount; i++) {
      const key = generateKey();
      keyStore.keys.push({
        key,
        createdAt: Date.now(),
        expiresAt: durMs === null ? null : Date.now() + durMs,
        redeemedBy: null
      });
      generatedKeys.push(key);
    }
    writeJSON(KEYS_FILE, keyStore);

    const timeText = durMs === null ? "♾️ INFINITE" : `${timeStr}`;
    const keyList = generatedKeys.map(k => `\`${k}\``).join("\n");
    
    return replyUser(msg, 
      `✅ Generated ${amount} key(s) — ${timeText} expiry:\n${keyList}`
    );
  }

  // .redeem / .red — EVERYONE
  if (/^\.redeem(?:\s|$)|^\.red(?:\s|$)/i.test(txt)) {
    const arg = txt.replace(/^\.redeem\s+|^\.red\s+/i, "").trim();
    if (!arg) return replyUser(msg, "❌ Usage: `.redeem <key>`");
    
    const existing = findActiveKeyForUser(msg.author.id);
    if (existing) {
      return replyUser(msg, "❌ you already got a key, lol.");
    }

    const rec = findKeyRecord(arg);
    if (!rec) return replyUser(msg, "❌ Invalid key.");
    if (rec.redeemedBy || (rec.expiresAt !== null && rec.expiresAt < Date.now())) {
      return replyUser(msg, "❌ this key was already redeem or expired.");
    }

    rec.redeemedBy = msg.author.id;
    writeJSON(KEYS_FILE, keyStore);
    try {
      const g = await client.guilds.fetch(GUILD_ID);
      const m = await g.members.fetch(msg.author.id);
      await m.roles.add(BUYER_ROLE_ID);
    } catch (e) {
      return replyUser(msg, "❌ Key saved but failed to assign role: " + e.message);
    }
    return replyUser(msg, "✅ Key redeemed! Buyer role applied.");
  }

  // Permission check for all below
  const hasAccess = await checkRegularPermission(msg, true);
  if (!hasAccess) return;

  // .set
  if (/^\.set(?:$|\s+)|^\.sc(?:$|\s+)/i.test(txt)) {
    if (!isOwnerUser) return;
    const ch = msg.mentions.channels.first() || msg.channel;
    config.allowedChannelId = ch.id;
    writeJSON(CONFIG_FILE, config);
    return replyUser(msg, `✅ Channel set to ${ch}`);
  }

  // .rename / .rn
  if (/^\.rn(?:$|\s+)|^\.rename(?:$|\s+)/i.test(txt)) {
    const cd = checkCooldown(msg.author.id, "rename", isBuyerUser);
    if (!cd.ok) return replyUser(msg, cd.msg);
    let file = msg.attachments.first();
    if (!file && msg.reference) {
      const ref = await msg.fetchReference();
      file = ref.attachments.first();
    }
    if (!file) return replyUser(msg, "❌ bruh, upload file or reply to a file.");

    const startTime = Date.now();
    const loadingEmbed = new EmbedBuilder().setTitle("Renaming...").setDescription("⏳ Cleaning headers & spam...").setColor(REGULAR_COLOR);
    const loadMsg = await replyUser(msg, { embeds: [loadingEmbed] });

    try {
      const code = await downloadURL(file.url);
      const cleaned = cleanLuaScript(code);
      if (!cleaned || !cleaned.trim()) throw new Error("No valid Lua code found");
      
      const elapsed = Date.now() - startTime;
      const outName = `${randomName()}.lua`;
      const outFile = new AttachmentBuilder(Buffer.from(cleaned), { name: outName });
      const preview = cleaned.split(/\s+/).slice(0, 30).join(" ") + "...";

      const resEmbed = new EmbedBuilder()
        .setTitle("✅ Cleaned & Ready")
        .setDescription(`\`\`\`lua\n${preview}\n\`\`\``)
        .setColor(REGULAR_COLOR)
        .setFooter({ text: `Request by @${msg.author.username} │ ${formatTime()}` });

      await loadMsg.delete().catch(() => {});
      return replyUser(msg, {
        content: `<@${msg.author.id}> Here you go bro!\n**Finish in:** \`${elapsed}ms\``,
        embeds: [resEmbed],
        files: [outFile]
      });
    } catch (e) {
      await loadMsg.edit({ content: `❌ ${e.message}`, embeds: [] });
    }
    return;
  }

  // .obf
  if (/^\.obf(?:\s|$)/i.test(txt)) {
    const cd = checkCooldown(msg.author.id, "obf", isBuyerUser);
    if (!cd.ok) return replyUser(msg, cd.msg);
    let file = msg.attachments.first();
    if (!file && msg.reference) {
      const ref = await msg.fetchReference();
      file = ref.attachments.first();
    }
    if (!file) return replyUser(msg, "❌ attach file or reply to a file");
    if (file.size > 200 * 1024) return replyUser(msg, "❌ max is 200kb");

    const loading = new EmbedBuilder().setTitle("🔒 Obfuscating...").setDescription("⏳ Applying Prince V15...").setColor(REGULAR_COLOR);
    const loadMsg = await replyUser(msg, { embeds: [loading] });
    try {
      const code = await downloadURL(file.url);
      const obfuscated = obfuscateLua(code);
      const outName = `${randomName()}.lua`;
      const outFile = new AttachmentBuilder(Buffer.from(obfuscated), { name: outName });
      const resEmbed = new EmbedBuilder().setDescription(`🔒 V15 — Anti-Debug • Anti-Dump • Encrypted`).setColor(REGULAR_COLOR);
      await loadMsg.delete().catch(() => {});
      return replyUser(msg, { content: `<@${msg.author.id}> Here you go bro!`, embeds: [resEmbed], files: [outFile] });
    } catch (e) {
      await loadMsg.edit({ content: `❌ ${e.message}`, embeds: [] });
    }
    return;
  }

  // .download / .dl
  if (/^\.download(?:\s|$)|^\.dl(?:\s|$)/i.test(txt)) {
    const cd = checkCooldown(msg.author.id, "dl", isBuyerUser);
    if (!cd.ok) return replyUser(msg, cd.msg);
    let url = txt.replace(/^\.download\s+|^\.dl\s+/i, "").trim().replace(/^<|>$/g, "");
    if (!url) return replyUser(msg, "❌ usage: `.dl <url>`");
    const loading = new EmbedBuilder().setTitle("📥 Downloading...").setDescription("⏳ Fetching...").setColor(REGULAR_COLOR);
    const loadMsg = await replyUser(msg, { embeds: [loading] });
    try {
      const apiRes = await fetch(`https://api.cobalt.tools/api/json`, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      if (!apiRes.ok) throw new Error("API failed");
      const data = await apiRes.json();
      const dUrl = data.url || data.audio || (data.picker && data.picker[0]?.url);
      if (!dUrl) throw new Error("No link");
      const resEmbed = new EmbedBuilder()
        .setTitle("📥 Download Ready")
        .setDescription(`**Download:** [Click Here](${dUrl})`)
        .setColor(REGULAR_COLOR);
      await loadMsg.delete().catch(() => {});
      return replyUser(msg, { embeds: [resEmbed] });
    } catch {
      await loadMsg.edit({ content: "❌ Failed — link may be private or expired.", embeds: [] });
    }
    return;
  }

  // .et — extract
  if (/^\.et(?:\s|$)/i.test(txt)) {
    const AdmZip = require("adm-zip");
    let file = msg.attachments.first();
    if (!file && msg.reference) {
      const ref = await msg.fetchReference();
      file = ref.attachments.first();
    }
    if (!file) return replyUser(msg, "❌ attach .zip file");
    const loading = await replyUser(msg, "⏳ Extracting...");
    try {
      const buf = Buffer.from(await (await fetch(file.url)).arrayBuffer());
      const zip = new AdmZip(buf);
      const entries = zip.getEntries().filter(e => !e.isDirectory);
      if (!entries.length) throw new Error("Empty zip");
      const files = [];
      for (const e of entries.slice(0, 5)) {
        files.push(new AttachmentBuilder(e.getData(), { name: e.name || randomName() }));
      }
      await loading.delete().catch(() => {});
      return replyUser(msg, { content: `✅ Extracted ${entries.length} file(s)`, files });
    } catch (e) {
      await loading.edit(`❌ ${e.message}`);
    }
    return;
  }

  // .upload
  if (/^\.upload(?:\s|$)/i.test(txt)) {
    const cd = checkCooldown(msg.author.id, "upload", isBuyerUser);
    if (!cd.ok) return replyUser(msg, cd.msg);
    let file = msg.attachments.first();
    if (!file && msg.reference) {
      const ref = await msg.fetchReference();
      file = ref.attachments.first();
    }
    if (!file) return replyUser(msg, "❌ attach file or reply to a file");
    library.files.push({
      id: randomName(12), name: file.name, url: file.url, size: file.size,
      authorId: msg.author.id, timestamp: msg.createdTimestamp
    });
    writeJSON(LIBRARY_FILE, library);
    return replyUser(msg, `✅ Saved! ID: \`${library.files.at(-1).id}\`\nTotal: ${library.files.length}`);
  }

  // .get
  if (/^\.get(?:\s|$)/i.test(txt)) {
    const cd = checkCooldown(msg.author.id, "get", isBuyerUser);
    if (!cd.ok) return replyUser(msg, cd.msg);
    const q = txt.replace(/^\.get\s+/i, "").trim().toLowerCase();
    if (!q) return replyUser(msg, "❌ usage: `.get <id/name>`");
    const found = library.files.filter(f => f.id === q || f.name.toLowerCase().includes(q)).slice(-1)[0];
    if (!found) return replyUser(msg, "❌ no found for that, dumbass.");
    const code = await downloadURL(found.url);
    const out = new AttachmentBuilder(Buffer.from(code), { name: found.name });
    return replyUser(msg, { content: `<@${msg.author.id}> Here you go:`, files: [out] });
  }

  // .find
  if (/^\.find(?:\s|$)/i.test(txt)) {
    const q = txt.replace(/^\.find\s+/i, "").trim().toLowerCase();
    const results = library.files.filter(f => f.name.toLowerCase().includes(q)).slice(0, 10);
    if (!results.length) return replyUser(msg, "❌ no found for that, dumbass.");
    const list = results.map(f => `• \`${f.id}\` — ${f.name}`).join("\n");
    return replyUser(msg, `Found ${results.length}:\n${list}`);
  }

  // .delwh
  if (/^\.delwh(?:\s|$)/i.test(txt)) {
    if (!isOwnerUser) return;
    const url = txt.replace(/^\.delwh\s+/i, "").trim().replace(/^<|>$/g, "");
    if (!url) return replyUser(msg, "❌ usage: `.delwh <url>`");
    try {
      const res = await fetch(url, { method: "DELETE" });
      return replyUser(msg, res.ok ? "✅ Deleted." : "❌ Not Found.");
    } catch { return replyUser(msg, "❌ Not Found."); }
  }

  // .whs
  if (/^\.whs(?:\s|$)/i.test(txt)) {
    if (!isOwnerUser) return;
    const startEmbed = new EmbedBuilder().setTitle("Webhook Spammer").setDescription("Click Start below").setColor(REGULAR_COLOR);
    const startBtn = new ButtonBuilder().setCustomId("whs_start").setLabel("Start").setStyle(ButtonStyle.Success);
    const row = new ActionRowBuilder().addComponents(startBtn);
    const sent = await replyUser(msg, { embeds: [startEmbed], components: [row] });
    whsInitiators.set(sent.id, msg.author.id);
    return;
  }

  // .getinv
  if (/^\.getinv(?:\s|$)/i.test(txt)) {
    const g = await client.guilds.fetch(GUILD_ID);
    const inv = await g.invites.create(g.systemChannel || g.channels.cache.first(), { maxAge: 0 });
    return replyUser(msg, `✅ Invite: ${inv.url}`);
  }
});

// ============================================================
// EXPRESS
// ============================================================
const app = express();
app.get("/", (_, res) => res.send("Bot Online ✅"));
app.listen(PORT, () => console.log(`✅ Port ${PORT}`));

client.login(TOKEN).catch(e => console.error("❌ Login failed:", e));
