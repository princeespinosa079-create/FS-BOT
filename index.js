const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const express = require("express");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const os = require("os");
// ============================================================
// ENV
// ============================================================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = "1302080645987569694";
const BUYER_ROLE_ID = "1545669026020069466";
const PRINCE_ROLE_ID = "1547849774676316181";
const BUYER_COLOR = 0xFFFFFF;
const REGULAR_COLOR = 0x2B2D31;
const PORT = Number(process.env.PORT) || 10000;
if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID.");
  process.exit(1);
}
// ============================================================
// STORAGE
// ============================================================
const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;
const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
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
  try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file); }
  catch (e) { console.error(`❌ Saving ${path.basename(file)}:`, e.message); }
}
let config = readJSON(CONFIG_FILE, { allowedChannelId: null });
if (!config || typeof config !== "object") config = { allowedChannelId: null };
let library = readJSON(LIBRARY_FILE, { files: [] });
if (Array.isArray(library)) library = { files: library };
if (!Array.isArray(library.files)) library.files = [];
// ============================================================
// COOLDOWN TRACKER
// ============================================================
const rnCooldown = new Map();
const RN_COOLDOWN_SEC = 10;
// Unified command cooldowns (regular users only, buyers bypass)
const commandCooldowns = new Map(); // key: "cmd:userId" → expiry timestamp
const COOLDOWNS = {
  upload: 60 * 60,      // 1 hour
  find: 15,             // 15 seconds
  get: 15,              // 15 seconds
  rename: 5 * 60,       // 5 minutes
  dl: 10 * 60,          // 10 minutes
  et: 30 * 60,          // 30 minutes
  obf: 60 * 60,         // 1 hour
  delwh: 10 * 60        // 10 minutes
};
function formatCooldown(remainingSec) {
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
function checkCommandCooldown(userId, cmd, isBuyerUser) {
  if (isBuyerUser) return { onCooldown: false };
  const cdSec = COOLDOWNS[cmd];
  if (!cdSec) return { onCooldown: false };
  const key = `${cmd}:${userId}`;
  const now = Date.now();
  const expiry = commandCooldowns.get(key);
  if (expiry && now < expiry) {
    const remaining = Math.ceil((expiry - now) / 1000);
    return { onCooldown: true, message: `you're on ${formatCooldown(remaining)} cooldown.` };
  }
  commandCooldowns.set(key, now + cdSec * 1000);
  return { onCooldown: false };
}
// ============================================================
// DISCORD CLIENT
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: ["CHANNEL", "MESSAGE"]
});
const runningScans = new Set();
const paginationMenus = new Map();
const extractCarouselMenus = new Map();
const EXPIRY_MS = 5 * 60 * 1000;
let isReady = false;
let lastReady = Date.now();
let registering = false;
let reconnecting = false;
// ============================================================
// BASIC HELPERS
// ============================================================
const saveLibrary = () => writeJSON(LIBRARY_FILE, library);
const saveConfig = () => writeJSON(CONFIG_FILE, config);
function isOwner(userId) {
  return userId === OWNER_ID;
}
async function isBuyer(userId, member) {
  const uid = userId || member?.id;
  if (!uid) return false;
  if (uid === OWNER_ID) return true;
  // Fast path: local guild member check
  if (member?.roles?.cache?.has(BUYER_ROLE_ID)) {
    console.log(`👑 isBuyer: ${uid} → YES (local member)`);
    return true;
  }
  // Main guild fetch
  try {
    let mainGuild = client.guilds.cache.get(GUILD_ID);
    if (!mainGuild) {
      console.log(`👑 isBuyer: fetching guild ${GUILD_ID}...`);
      mainGuild = await client.guilds.fetch(GUILD_ID);
    }
    if (!mainGuild) {
      console.warn(`⚠️ isBuyer: main guild not found`);
      return false;
    }
    // Fetch member with force
    let mainMember = mainGuild.members.cache.get(uid);
    if (!mainMember) {
      console.log(`👑 isBuyer: fetching member ${uid} from main guild...`);
      mainMember = await mainGuild.members.fetch({ user: uid, force: true });
    }
    if (!mainMember) {
      console.log(`👑 isBuyer: ${uid} → NO (not in main guild)`);
      return false;
    }
    // Check roles cache
    if (mainMember.roles.cache.has(BUYER_ROLE_ID)) {
      console.log(`👑 isBuyer: ${uid} → YES (role in cache)`);
      return true;
    }
    // Force fetch roles if cache seems incomplete
    if (mainMember.roles.cache.size <= 1) {
      console.log(`👑 isBuyer: force-fetching roles for ${uid}...`);
      try {
        await mainMember.roles.fetch();
        if (mainMember.roles.cache.has(BUYER_ROLE_ID)) {
          console.log(`👑 isBuyer: ${uid} → YES (roles fetched)`);
          return true;
        }
      } catch (roleErr) {
        console.warn(`⚠️ isBuyer roles fetch: ${roleErr.message}`);
      }
    }
    // Last resort: check via list of role IDs
    const roleIds = [...mainMember.roles.cache.keys()];
    console.log(`👑 isBuyer: ${uid} roles = [${roleIds.join(", ")}] (looking for ${BUYER_ROLE_ID})`);
    if (roleIds.includes(BUYER_ROLE_ID)) {
      console.log(`👑 isBuyer: ${uid} → YES (role ID match)`);
      return true;
    }
    console.log(`👑 isBuyer: ${uid} → NO (buyer role not found)`);
    return false;
  } catch (e) {
    console.warn(`⚠️ isBuyer ERROR for ${uid}: ${e.message}`);
    // Final fallback: check local member if available
    if (member?.roles?.cache?.has(BUYER_ROLE_ID)) {
      console.log(`👑 isBuyer: ${uid} → YES (fallback local)`);
      return true;
    }
    return false;
  }
}
function channelAllowed(target) {
  if (!config.allowedChannelId) return true;
  return target.channelId === config.allowedChannelId;
}
async function hasPrinceStatus(userId) {
  try {
    const mainGuild = await client.guilds.fetch(GUILD_ID);
    const member = await mainGuild.members.fetch(userId, { force: true });
    if (!member?.presence?.activities) return false;
    for (const act of member.presence.activities) {
      if (act.type === 4 && act.state && act.state.toLowerCase().includes(".gg/tbbauzu8cw")) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
async function isInMainGuild(userId) {
  try {
    const mainGuild = await client.guilds.fetch(GUILD_ID);
    await mainGuild.members.fetch(userId, { force: true });
    return true;
  } catch {
    return false;
  }
}
function memberHasPrinceStatus(member) {
  if (!member?.presence?.activities) return false;
  for (const act of member.presence.activities) {
    if (act.type === 4 && act.state && act.state.toLowerCase().includes(".gg/tbbauzu8cw")) {
      return true;
    }
  }
  return false;
}
async function syncPrinceRole(member) {
  try {
    if (!member || member.guild.id !== GUILD_ID) return;
    if (member.user.bot) return;
    const hasStatus = memberHasPrinceStatus(member);
    const hasRole = member.roles.cache.has(PRINCE_ROLE_ID);
    if (hasStatus && !hasRole) {
      await member.roles.add(PRINCE_ROLE_ID, "Prince status detected").catch(() => {});
      console.log(`👑 + Prince role: ${member.user.tag}`);
    } else if (!hasStatus && hasRole) {
      await member.roles.remove(PRINCE_ROLE_ID, "Prince status removed").catch(() => {});
      console.log(`👑 - Prince role: ${member.user.tag}`);
    }
  } catch (e) {
    console.warn(`⚠️ syncPrinceRole: ${e.message}`);
  }
}
async function syncAllPrinceRoles() {
  try {
    const mainGuild = await client.guilds.fetch(GUILD_ID);
    await mainGuild.members.fetch();
    let added = 0, removed = 0, skipped = 0;
    for (const member of mainGuild.members.cache.values()) {
      if (member.user.bot) { skipped++; continue; }
      try {
        const hasStatus = memberHasPrinceStatus(member);
        const hasRole = member.roles.cache.has(PRINCE_ROLE_ID);
        if (hasStatus && !hasRole) {
          await member.roles.add(PRINCE_ROLE_ID, "Startup sync: status detected").catch(() => {});
          added++;
        } else if (!hasStatus && hasRole) {
          await member.roles.remove(PRINCE_ROLE_ID, "Startup sync: no status").catch(() => {});
          removed++;
        }
      } catch (e) {
        console.warn(`⚠️ syncAll member ${member.user?.tag}: ${e.message}`);
      }
    }
    console.log(`👑 Startup role sync done: +${added} -${removed} ~${skipped} bots`);
  } catch (e) {
    console.warn(`⚠️ syncAllPrinceRoles: ${e.message}`);
  }
}
// ============================================================
// PERMISSION CHECK — REGULAR USER COMMANDS
// Owner / Buyer → bypass all
// Regular → status + channel + guild checks
// ============================================================
async function checkRegularPermission(msg, needsFileReply = false) {
  // Owner or Buyer → full bypass
  if (isOwner(msg.author.id) || await isBuyer(msg.author.id, msg.member)) {
    return { allowed: true, isBuyer: true };
  }

  const isDM = !msg.guild;

  // Regular users CANNOT use in DMs
  if (isDM) {
    return { allowed: false, reason: "❌ not here, dumbass.", isBuyer: false };
  }

  // Cross-server check: must be in main guild
  if (msg.guild.id !== GUILD_ID) {
    const inMain = await isInMainGuild(msg.author.id);
    if (!inMain) {
      return { allowed: false, reason: "❌ join in main server first bro `.gg/TBBAUZu8cW`.", isBuyer: false };
    }
  }

  const hasStatus = await hasPrinceStatus(msg.author.id);

  // If channel is restricted
  if (!channelAllowed(msg)) {
    if (hasStatus) {
      return { allowed: false, reason: "❌ not here, dumbass.", isBuyer: false };
    } else {
      return { allowed: false, reason: "❌ put `.gg/TBBAUZu8cW` in your status first bro.", isBuyer: false };
    }
  }

  // Must have status
  if (!hasStatus) {
    return { allowed: false, reason: "❌ put `.gg/TBBAUZu8cW` in your status first bro.", isBuyer: false };
  }

  if (needsFileReply && !isReplyingToFile(msg)) {
    return { allowed: false, reason: "❌ reply to a file or forwarded file, dumbass.", isBuyer: false };
  }

  return { allowed: true, isBuyer: false };
}
function isReplyingToFile(msg) {
  const ref = msg.reference?.messageId;
  if (!ref) return false;
  const channel = msg.channel;
  const repliedMsg = channel.messages.cache.get(ref);
  if (!repliedMsg) return false;
  if (repliedMsg.attachments.size > 0) return true;
  for (const snap of repliedMsg.messageSnapshots?.values?.() || []) {
    if (snap.attachments.size > 0) return true;
  }
  return false;
}
function replyUser(message, payload) {
  const body = typeof payload === "string" ? { content: payload } : { ...payload };
  body.allowedMentions = { ...(body.allowedMentions || {}), repliedUser: true };
  return message.reply(body);
}
function getEmbedColor(isBuyerUser) {
  return REGULAR_COLOR;
}
function getFinderTitle(isBuyerUser) {
  return "Finder Source Results";
}
// ============================================================
// FILE HELPERS
// ============================================================
function normalize(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[^/.]+$/, "").replace(/[_\-.()[\]{}]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeBase(name) {
  let n = normalize(name);
  n = n.replace(/\s*\d+$/, "").trim();
  n = n.replace(/\s*(copy|ver|version|v)\s*\d*$/i, "").trim();
  n = n.replace(/\s+/g, " ").trim();
  return n;
}
function ext(name) {
  const match = String(name || "").match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}
function isImage(name, contentType) {
  return String(contentType || "").toLowerCase().startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|ico|avif|heic|heif)$/i.test(String(name || ""));
}
function isAllowedFileType(name, contentType) {
  const e = ext(name);
  return (e === "txt" || e === "lua") && !isImage(name, contentType);
}
function isZipFile(name, contentType) {
  const e = ext(name);
  return e === "zip" || String(contentType || "").toLowerCase().includes("zip");
}
function isHtmlFile(name, contentType) {
  const e = ext(name);
  return e === "html" || e === "htm" || String(contentType || "").toLowerCase().includes("html");
}
function idForFile() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id;
  do {
    id = "";
    for (let i = 0; i < 4; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (library.files.some(file => file.id === id));
  return id;
}
function getFile(id) {
  return library.files.find(file => file.id === String(id || "").trim()) || null;
}
async function getFreshUrl(file) {
  try {
    const ch = await client.channels.fetch(file.channelId);
    const orig = await ch.messages.fetch(file.messageId);
    let fresh = orig.attachments.get(file.attachmentId);
    if (!fresh) {
      for (const s of orig.messageSnapshots?.values?.() || []) {
        fresh = s.attachments?.get(file.attachmentId);
        if (fresh) break;
      }
    }
    if (fresh?.url) {
      file.url = fresh.url;
      saveLibrary();
      return fresh.url;
    }
  } catch (e) {
    console.warn(`⚠️ Could not refresh URL for ${file.filename}:`, e.message);
  }
  return null;
}
function findFiles(query) {
  query = normalize(query);
  if (!query) return [];
  const tokens = query.split(" ").filter(Boolean);
  const seenNames = new Set();
  return library.files.map(file => {
    const name = normalize(file.filename);
    let score = 0;
    if (name === query) score += 5000;
    if (name.startsWith(query)) score += 2000;
    if (name.includes(query)) score += 1000;
    for (const token of tokens) {
      if (name === token) score += 500;
      else if (name.startsWith(token)) score += 200;
      else if (name.includes(token)) score += 100;
    }
    return { file, score };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter(item => {
      const normName = normalize(item.file.filename);
      if (seenNames.has(normName)) return false;
      seenNames.add(normName);
      return true;
    })
    .map(item => item.file);
}
async function fetchMessages(channel, before) {
  const options = { limit: 100 };
  if (before) options.before = before;
  return await channel.messages.fetch(options);
}
function attachmentsOf(message) {
  const result = [];
  for (const a of message.attachments?.values?.() || []) {
    if (isAllowedFileType(a.name, a.contentType)) {
      result.push({ attachment: a, forwarded: false });
    }
  }
  for (const s of message.messageSnapshots?.values?.() || []) {
    for (const a of s.attachments?.values?.() || []) {
      if (isAllowedFileType(a.name, a.contentType)) {
        result.push({ attachment: a, forwarded: true });
      }
    }
  }
  return result;
}
function allAttachmentsOf(message) {
  const result = [];
  for (const a of message.attachments?.values?.() || []) {
    if (isAllowedFileType(a.name, a.contentType)) result.push(a);
  }
  for (const s of message.messageSnapshots?.values?.() || []) {
    for (const a of s.attachments?.values?.() || []) {
      if (isAllowedFileType(a.name, a.contentType)) result.push(a);
    }
  }
  return result;
}
function zipAttachmentsOf(message) {
  const result = [];
  for (const a of message.attachments?.values?.() || []) {
    if (isZipFile(a.name, a.contentType)) result.push(a);
  }
  for (const s of message.messageSnapshots?.values?.() || []) {
    for (const a of s.attachments?.values?.() || []) {
      if (isZipFile(a.name, a.contentType)) result.push(a);
    }
  }
  return result;
}
function extractAttachmentsOf(message) {
  const result = [];
  for (const a of message.attachments?.values?.() || []) {
    if (isZipFile(a.name, a.contentType)) result.push(a);
  }
  for (const s of message.messageSnapshots?.values?.() || []) {
    for (const a of s.attachments?.values?.() || []) {
      if (isZipFile(a.name, a.contentType)) result.push(a);
    }
  }
  return result;
}
function getMaxFileSize(guild) {
  const tier = guild?.premiumTier || 0;
  if (tier >= 3) return { size: 1000 * 1024 * 1024, label: "1000MB" };
  if (tier >= 2) return { size: 750 * 1024 * 1024, label: "750MB" };
  if (tier >= 1) return { size: 500 * 1024 * 1024, label: "500MB" };
  return { size: 300 * 1024 * 1024, label: "300MB" };
}
async function scanChannel(channel) {
  if (!channel?.isTextBased?.() || !channel.messages) throw new Error("Not a readable text channel.");
  if (runningScans.has(channel.id)) throw new Error("Already scanning.");
  runningScans.add(channel.id);
  try {
    const existingBases = new Set(library.files.map(f => normalizeBase(f.filename)));
    const existingFullNames = new Set(library.files.map(f => normalize(f.filename)));
    const found = [];
    let before = null, messages = 0, pages = 0, skippedDup = 0, replacedDup = 0;
    while (true) {
      const batch = await fetchMessages(channel, before);
      pages++; if (!batch.size) break;
      for (const msg of batch.values()) {
        messages++;
        for (const item of attachmentsOf(msg)) {
          const a = item.attachment;
          const filename = a.name || "unknown_file";
          const baseName = normalizeBase(filename);
          const fullName = normalize(filename);
          const fileSize = Number(a.size || 0);
          const url = a.url || a.proxyURL || a.proxy_url;
          if (!baseName || !url) continue;
          const isDupBase = existingBases.has(baseName);
          const isDupFull = existingFullNames.has(fullName);
          if (isDupBase || isDupFull) {
            skippedDup++;
            continue;
          }
          existingBases.add(baseName);
          existingFullNames.add(fullName);
          found.push({
            id: idForFile(), filename, url, size: fileSize,
            contentType: a.contentType || null, channelId: msg.channelId,
            messageId: msg.id, attachmentId: String(a.id), forwarded: item.forwarded,
            createdTimestamp: msg.createdTimestamp || Date.now(), scannedAt: Date.now()
          });
        }
      }
      const oldest = batch.last();
      if (!oldest || batch.size < 100) break;
      before = oldest.id;
    }
    library.files.push(...found);
    library.files.sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
    saveLibrary();
    const libraryTotal = library.files.length;
    const channelTotal = library.files.filter(f => f.channelId === channel.id).length;
    console.log(`📂 Scan done | #${channel.name} | ${messages} msgs | ${found.length} new | ${replacedDup} replaced | ${skippedDup} skipped | ${pages} pages`);
    return { messages, found: found.length, replaced: replacedDup, skipped: skippedDup, total: libraryTotal, channelTotal };
  } finally { runningScans.delete(channel.id); }
}
async function downloadURL(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function forwardTxt(source, destination) {
  if (!source?.isTextBased?.()) throw new Error("Source not readable.");
  if (!destination?.isTextBased?.()) throw new Error("Dest not writable.");
  let before = null, messages = 0, sent = 0;
  const sendBatch = [];
  while (true) {
    const batch = await fetchMessages(source, before);
    if (!batch.size) break;
    for (const msg of batch.values()) {
      messages++;
      for (const a of allAttachmentsOf(msg)) {
        sendBatch.push(
          downloadURL(a.url)
            .then(buf => destination.send({ files: [new AttachmentBuilder(buf, { name: a.name || "file" })] }))
            .then(() => sent++)
            .catch(e => console.error(`⚠️ Forward: ${e.message}`))
        );
      }
    }
    const oldest = batch.last();
    if (!oldest || batch.size < 100) break;
    before = oldest.id;
  }
  await Promise.allSettled(sendBatch);
  return { messages, sent };
}
// ============================================================
// ZIP EXTRACT HELPERS
// ============================================================
function extractFilesFromZip(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const extractedFiles = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const entryName = path.basename(entry.entryName);
    if (!entryName || entryName.startsWith(".")) continue;
    try {
      const data = entry.getData();
      extractedFiles.push({ name: entryName, data });
    } catch (e) {
      console.warn(`⚠️ Could not extract ${entry.entryName}:`, e.message);
    }
  }
  return extractedFiles;
}
// ============================================================
// LUA SCRIPT CLEANER
// ============================================================
function cleanLuaScript(text) {
  if (!text) return "";
  let cleaned = text;
  // Step 1: Remove multi-line comments --[[ ... ]]
  cleaned = cleaned.replace(/--\[\[[\s\S]*?\]\]/g, "");
  // Step 2: Remove single-line comments --... (but keep the line structure)
  cleaned = cleaned.replace(/--[^\n]*/g, "");
  // Step 3: Remove print statements (whole lines)
  cleaned = cleaned.split("\n").map(line => {
    const trimmed = line.trim();
    if (/^print\s*\(/.test(trimmed) && /\)\s*[;]?$/.test(trimmed)) return "";
    if (/^\s*print\s*\(/.test(line) && /\)\s*;?\s*$/.test(line)) return "";
    return line;
  }).join("\n");
  // Step 4: Remove URLs / links
  cleaned = cleaned.replace(/https?:\/\/[^\s"'()\]]+/g, "");
  cleaned = cleaned.replace(/www\.[^\s"'()\]]+/g, "");
  cleaned = cleaned.replace(/discord\.gg\/[^\s"'()\]]+/g, "");
  // Step 5: Filter — keep lines that look like Lua code
  // Lines starting with Lua keywords (after indentation)
  const LUA_KEYWORD_START = /^\s*(local|function|if|elseif|else|for|while|repeat|until|return|break|do|end|goto|in|then)\b/;
  // Lines that are standalone keywords
  const LUA_STANDALONE = /^\s*(break|end|goto|return|true|false|nil|else|then|do|repeat|until)\s*[;]?\s*$/;
  // Lines with code syntax markers
  const LUA_CODE_MARKERS = /[=+\-*/%^#<>~{}()\[\];:,.]|["']|::|\.\.\.|\.\.|\b\d+\.?\d*\b/;
  cleaned = cleaned.split("\n").filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep blank lines for readability
    if (LUA_STANDALONE.test(trimmed)) return true;
    if (LUA_KEYWORD_START.test(line)) return true;
    if (LUA_CODE_MARKERS.test(trimmed)) return true;
    // Remove: pure text lines with no code structure
    return false;
  }).join("\n");
  // Step 6: Collapse excessive blank lines (max 2 consecutive)
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  // Step 7: Trim trailing whitespace per line, preserve indentation
  cleaned = cleaned.split("\n").map(line => {
    const m = line.match(/^(\s*)(.*?)\s*$/);
    return m ? (m[1] + m[2]) : line.trimEnd();
  }).join("\n");
  // Step 8: Remove leading blank lines at start
  cleaned = cleaned.replace(/^\s*\n+/, "");
  // Step 9: Ensure single trailing newline
  cleaned = cleaned.replace(/\n+\s*$/, "\n");
  return cleaned;
}
// ============================================================
// LUA OBFUSCATOR (Prince Obfuscator — Luarmor/Luraph style)
// ============================================================
function obfuscateLua(source) {
  if (!source) source = "";
  const header = "-- This file was generated using Prince Obfuscator\n";
  // ============================================================
  // Layer 1: Encode source to custom base64-like alphabet
  // ============================================================
  const ALPHABET = "K9xLpRmTnVoQ2WsXeYcZa3DbF4HgJi6KlMnOpQrStUvWwXyYz01578ABCDEFGHIJNPVZ";
  const toCustomB64 = (str) => {
    let bytes = [];
    for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xFF);
    let result = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b1 = bytes[i], b2 = bytes[i+1] || 0, b3 = bytes[i+2] || 0;
      result += ALPHABET[b1 >> 2];
      result += ALPHABET[((b1 & 3) << 4) | (b2 >> 4)];
      result += (i+1 < bytes.length) ? ALPHABET[((b2 & 15) << 2) | (b3 >> 6)] : "=";
      result += (i+2 < bytes.length) ? ALPHABET[b3 & 63] : "=";
    }
    return result;
  };
  const encoded = toCustomB64(source);
  // ============================================================
  // Layer 2: XOR encrypt the encoded string with random key
  // ============================================================
  const xorKey = Math.floor(Math.random() * 254) + 1;
  const encBytes = [];
  for (let i = 0; i < encoded.length; i++) {
    encBytes.push((encoded.charCodeAt(i) ^ (xorKey + i % 7)) & 0xFF);
  }
  // ============================================================
  // Layer 3: Split into chunks and generate random var names
  // ============================================================
  const chunks = [];
  for (let i = 0; i < encBytes.length; i += 120) {
    chunks.push(encBytes.slice(i, i + 120).join(","));
  }
  const dataStr = chunks.join(",");
  const randName = (len) => {
    const c = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let s = c[Math.floor(Math.random() * 52)];
    for (let i = 0; i < (len || 6) + Math.floor(Math.random() * 4); i++) {
      s += c[Math.floor(Math.random() * 52)];
    }
    return s;
  };
  // Random variable names
  const v_data = randName();
  const v_key = randName();
  const v_idx = randName();
  const v_out = randName();
  const v_i = randName();
  const v_c = randName();
  const v_b64 = randName();
  const v_dec = randName();
  const v_junk1 = randName();
  const v_junk2 = randName();
  const v_load = randName();
  const v_check = randName();
  // ============================================================
  // Build the obfuscated Lua script (VM-style decoder)
  // ============================================================
  const lua = `${header}local ${v_data}={${dataStr}};local ${v_key}=${xorKey};local ${v_idx}=0;local ${v_out}={};local ${v_junk1}=function() return ${Math.floor(Math.random()*100)} end;local ${v_junk2}=${v_junk1}();for ${v_i}=1,#${v_data} do local ${v_c}=${v_data}[${v_i}];${v_idx}=${v_idx}+1;${v_out}[${v_i}]=string.char((${v_c}~(${v_key}+${v_idx}%7))%256) end;local ${v_b64}=table.concat(${v_out});local ${v_dec}=(function() local A="${ALPHABET}";local B={};for i=1,#A do B[A:sub(i,i)]=i-1 end;return function(S) local R={};local C=0;for i=1,#S do local ch=S:sub(i,i);if ch~="=" then local v=B[ch];if v then C=C*64+v;if(i%4==0)then R[#R+1]=string.char(math.floor(C/65536)%256);R[#R+1]=string.char(math.floor(C/256)%256);R[#R+1]=string.char(C%256);C=0 end end end;return table.concat(R) end end)();local ${v_check}=${v_dec}(${v_b64});local ${v_load}=loadstring(${v_check});if ${v_load} then ${v_load}() else error("Prince Obfuscator: Load failed") end`;
  return lua;
}
// ============================================================
// SLASH COMMANDS — only /say (global, DM support)
// ============================================================
const commands = [
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send message — Owner Only.")
    .addStringOption(o => o
      .setName("text")
      .setDescription("Message content.")
      .setRequired(true))
    .addStringOption(o => o
      .setName("type")
      .setDescription("Message style.")
      .setRequired(true)
      .addChoices(
        { name: "With Embed", value: "good" },
        { name: "No Embed", value: "none" }
      ))
    .addStringOption(o => o
      .setName("title")
      .setDescription("Optional embed title.")
      .setRequired(false))
].map(c => c.toJSON());
async function registerCommands() {
  if (registering) return;
  registering = true;
  const rest = new REST({ version: "10", timeout: 15000 }).setToken(TOKEN);
  try {
    console.log("🧹 Clearing old guild commands...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
    console.log("🧹 Clearing old global commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    console.log("🧩 Registering global /say command...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Commands registered (global).");
  } catch (e) { registering = false; console.error("❌ Register fail:", e.message); }
}
// ============================================================
// READY
// ============================================================
client.once("ready", async () => {
  isReady = true; lastReady = Date.now();
  console.log("==========================================");
  console.log(`✅ ONLINE: ${client.user.tag}`);
  console.log(`🏠 Guilds: ${client.guilds.cache.size}`);
  console.log(`📚 Files: ${library.files.length}`);
  console.log("⚡ Bot ready!");
  console.log("==========================================");
  registerCommands().catch(e => console.error("❌ Register:", e.message));
  setTimeout(() => syncAllPrinceRoles(), 3000);
});
client.on("shardReady", id => { isReady = true; lastReady = Date.now(); console.log(`🟢 Shard ${id} ready`); });
client.on("shardResume", id => { isReady = true; lastReady = Date.now(); console.log(`🟢 Shard ${id} resumed`); });
client.on("shardReconnecting", id => { isReady = false; console.warn(`🟡 Shard ${id} reconnecting...`); });
client.on("shardDisconnect", (e, id) => { isReady = false; console.warn(`🔴 Shard ${id} down: ${e?.code}`); });
client.on("presenceUpdate", async (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.member) return;
  if (newPresence.guild.id !== GUILD_ID) return;
  await syncPrinceRole(newPresence.member);
});
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (newMember.guild.id !== GUILD_ID) return;
  const hadRole = oldMember?.roles?.cache?.has(PRINCE_ROLE_ID);
  const hasRole = newMember.roles.cache.has(PRINCE_ROLE_ID);
  if (hadRole && !hasRole) {
    if (memberHasPrinceStatus(newMember)) {
      await newMember.roles.add(PRINCE_ROLE_ID, "Status still active — re-adding role").catch(() => {});
      console.log(`👑 ↺ Re-added prince role: ${newMember.user.tag}`);
    }
  }
});
client.on("error", e => console.error("❌ Discord error:", e));
client.on("warn", w => console.warn("⚠️ Discord warn:", w));
// ============================================================
// BUTTON HANDLER
// ============================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  const uid = interaction.user.id;
  // ─── EXTRACT CAROUSEL BUTTONS ───
  if (interaction.customId === "extract_prev" || interaction.customId === "extract_next") {
    if (!extractCarouselMenus.has(uid)) {
      return interaction.reply({ content: "❌ not yours, dumbass.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const menu = extractCarouselMenus.get(uid);
    if (interaction.message.id !== menu.messageId) return;
    if (interaction.user.id !== menu.authorId) {
      return interaction.reply({ content: "❌ not yours, dumbass.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (interaction.customId === "extract_prev") menu.index--;
    if (interaction.customId === "extract_next") menu.index++;
    if (menu.index < 0) menu.index = 0;
    if (menu.index >= menu.files.length) menu.index = menu.files.length - 1;
    const currentFile = menu.files[menu.index];
    const attachment = new AttachmentBuilder(currentFile.data, { name: currentFile.name });
    const pageLabel = `${menu.index + 1}/${menu.files.length}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("extract_prev").setEmoji("⬅️").setStyle(ButtonStyle.Secondary).setDisabled(menu.index <= 0),
      new ButtonBuilder().setCustomId("extract_page").setLabel(pageLabel).setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId("extract_next").setEmoji("➡️").setStyle(ButtonStyle.Secondary).setDisabled(menu.index >= menu.files.length - 1)
    );
    await interaction.update({ content: null, files: [attachment], components: [row] }).catch(() => {});
    extractCarouselMenus.set(uid, menu);
    return;
  }
  // ─── FINDER PAGINATION BUTTONS ───
  if (!paginationMenus.has(uid)) {
    return interaction.reply({ content: "❌ not yours, dumbass.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const menu = paginationMenus.get(uid);
  if (Date.now() - menu.createdAt > EXPIRY_MS) {
    paginationMenus.delete(uid);
    return interaction.reply({ content: "❌ not yours, dumbass.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (interaction.message.id !== menu.messageId) return;
  if (interaction.user.id !== menu.authorId) {
    return interaction.reply({ content: "❌ this is not yours, idiot.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (interaction.customId === "prev_page") menu.page--;
  if (interaction.customId === "next_page") menu.page++;
  if (menu.page < 1) menu.page = 1;
  if (menu.page > menu.totalPages) menu.page = menu.totalPages;
  const start = (menu.page - 1) * 8;
  const pageItems = menu.results.slice(start, start + 8);
  const timeNow = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" });
  const embed = new EmbedBuilder()
    .setColor(menu.isBuyer ? BUYER_COLOR : REGULAR_COLOR)
    .setTitle(getFinderTitle(menu.isBuyer))
    .setDescription(pageItems.map(f => `\`${f.filename}\` — ID: \`${f.id}\``).join("\n"))
    .setFooter({ text: `Pages ${menu.page}/${menu.totalPages} │ Today at ${timeNow}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(menu.page <= 1),
    new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(menu.page >= menu.totalPages)
  );
  await interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
  paginationMenus.set(uid, menu);
});
// ============================================================
// WATCHDOG
// ============================================================
setInterval(async () => {
  if (isReady || reconnecting || Date.now() - lastReady < 60000) return;
  reconnecting = true;
  console.warn("🟡 Reconnecting...");
  try { client.destroy(); await new Promise(r => setTimeout(r, 1500)); await client.login(TOKEN); console.log("🟢 Reconnected."); }
  catch (e) { console.error("❌ Reconnect fail:", e.message); }
  finally { reconnecting = false; }
}, 30000).unref?.();
// ============================================================
// SLASH COMMAND HANDLER — only /say
// ============================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  console.log(`📨 /${interaction.commandName}`);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const isOwnerUser = isOwner(interaction.user.id);
    if (!isOwnerUser) {
      await interaction.editReply({ content: "❌ owner only, dumbass." });
      return;
    }
    if (interaction.commandName === "say") {
      const text = interaction.options.getString("text");
      const type = interaction.options.getString("type") || "good";
      const title = interaction.options.getString("title");
      const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}`;
      await interaction.deleteReply().catch(() => {});
      const targetChannel = interaction.channel || interaction.user.dmChannel || await interaction.user.createDM().catch(() => null);
      if (!targetChannel) {
        await interaction.followUp({ content: "❌ can't send message here.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (type === "none") {
        await targetChannel.send({ content: text });
      } else {
        const embed = new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(text)
          .setFooter({ text: timeFooter });
        if (title) embed.setTitle(title);
        await targetChannel.send({ embeds: [embed] });
      }
      return;
    }
  } catch (e) {
    console.error("❌ Interaction:", e);
    const msg = { content: "❌ An error occurred.", flags: MessageFlags.Ephemeral };
    interaction.deferred || interaction.replied ? await interaction.editReply(msg).catch(() => {}) : await interaction.reply(msg).catch(() => {});
  }
});
// ============================================================
// PREFIX COMMANDS
// ============================================================
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  const txt = (msg.content || "").trim();
  const isDM = !msg.guild;

  // ─────────────────────────────────────────────
  // OWNER-ONLY DOT COMMANDS
  // ─────────────────────────────────────────────
  if (/^\.serverlist$/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const guilds = client.guilds.cache.sort((a, b) => b.memberCount - a.memberCount);
    let lines = []; let num = 1;
    for (const g of guilds.values()) {
      lines.push(`**${num}.** \`${g.name}\`\n   🆔 \`${g.id}\`\n   👥 Members: \`${g.memberCount}\``); num++;
    }
    replyUser(msg, { embeds: [new EmbedBuilder().setColor(0x808080).setTitle(`🌐 Server List — ${guilds.size} total`).setDescription(lines.join("\n\n"))
      .setFooter({ text: `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}` })
    ] }).catch(() => {});
    return;
  }
  // ─────────────────────────────────────────────
  // .altlist — Alt/Suspicious Account Scanner (Owner Only)
  // ─────────────────────────────────────────────
  if (/^\.altlist(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    
    const loadingMsg = await replyUser(msg, "🔍 Scanning server for suspicious accounts...").catch(() => {});
    
    try {
      await msg.guild.members.fetch();
      const now = Date.now();
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      const suspicious = [];
      
      for (const member of msg.guild.members.cache.values()) {
        if (member.user.bot) continue;
        
        let score = 0;
        const flags = [];
        
        // 1. Account created < 30 days ago
        const created = member.user.createdTimestamp;
        const ageDays = (now - created) / (24 * 60 * 60 * 1000);
        if (ageDays < 7) { score += 40; flags.push(`🕐 **${ageDays.toFixed(0)} days old**`); }
        else if (ageDays < 30) { score += 20; flags.push(`🕐 ${ageDays.toFixed(0)} days old`); }
        
        // 2. Joined server < 7 days ago
        const joined = member.joinedTimestamp;
        if (joined) {
          const joinDays = (now - joined) / (24 * 60 * 60 * 1000);
          if (joinDays < 3) { score += 15; flags.push(`🆕 Joined ${joinDays.toFixed(0)}d ago`); }
        }
        
        // 3. Default/no avatar
        if (!member.user.avatar) { score += 20; flags.push("👤 No avatar"); }
        
        // 4. Only @everyone role (no other roles)
        const nonEveryoneRoles = member.roles.cache.filter(r => r.id !== msg.guild.id);
        if (nonEveryoneRoles.size === 0) { score += 15; flags.push("🎭 No roles"); }
        
        // 5. Username ends with lots of numbers (alt pattern)
        const uname = member.user.username;
        const numMatch = uname.match(/(\d{3,})$/);
        if (numMatch && numMatch[1].length >= 4) { score += 10; flags.push(`🔢 Numbers in name`); }
        
        // 6. Display name same as username (generic)
        if (member.displayName === uname && !member.user.avatar) { score += 5; }
        
        // 7. Suspicious: nitro but no avatar / new account contradiction
        if (member.premiumSince && ageDays < 30) { score += 10; flags.push("⚠️ New + boosting"); }
        
        if (score >= 25) {
          suspicious.push({
            member,
            score,
            flags,
            ageDays,
            created
          });
        }
      }
      
      // Sort by suspicion score (highest first)
      suspicious.sort((a, b) => b.score - a.score);
      
      if (loadingMsg) await loadingMsg.delete().catch(() => {});
      
      if (suspicious.length === 0) {
        replyUser(msg, "✅ No suspicious accounts found bro, server looks clean.").catch(() => {});
        return;
      }
      
      // Build pages of results (max 15 per embed)
      const perPage = 15;
      const totalPages = Math.ceil(suspicious.length / perPage);
      const top = suspicious.slice(0, perPage);
      
      const lines = top.map((s, i) => {
        const riskLevel = s.score >= 50 ? "🔴 HIGH" : s.score >= 35 ? "🟠 MED" : "🟡 LOW";
        const createdDate = new Date(s.created).toLocaleDateString("en-US");
        return `**${i + 1}.** ${s.member.user.tag} <@${s.member.id}>\n   ${riskLevel} | Score: \`${s.score}\` | Created: ${createdDate}\n   ${s.flags.join(" │ ")}`;
      });
      
      const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle(`🔍 Suspicious Accounts — ${suspicious.length} found`)
        .setDescription(lines.join("\n\n"))
        .setFooter({ text: `Page 1/${totalPages} │ ${msg.guild.name} │ ${msg.guild.memberCount} total members` });
      
      replyUser(msg, { embeds: [embed] }).catch(() => {});
      
    } catch (e) {
      if (loadingMsg) await loadingMsg.delete().catch(() => {});
      replyUser(msg, `❌ scan failed: ${e.message.slice(0, 100)}`).catch(() => {});
    }
    return;
  }
  if (/^\.getinv(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const serverId = txt.split(/\s+/)[1];
    if (!serverId) { replyUser(msg, "❌ usage: `.getinv <server id>`, dumbass.").catch(() => {}); return; }
    try {
      const guild = await client.guilds.fetch(serverId.trim());
      const channels = await guild.channels.fetch();
      const targetChannel = channels.find(c => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has("CreateInstantInvite"))
        || channels.find(c => c.isTextBased?.() && c.permissionsFor(guild.members.me)?.has("CreateInstantInvite"));
      if (!targetChannel) { replyUser(msg, "❌ no channel with invite permission found, bro.").catch(() => {}); return; }
      const invite = await targetChannel.createInvite({ maxAge: 1800, maxUses: 1, unique: true, reason: "Owner requested" });
      replyUser(msg, `✅ **Invite for \`${guild.name}\`**\n🔗 https://discord.gg/${invite.code}\n⏱️ Expires: **30 min**\n👤 Uses: **1**`).catch(() => {});
    } catch (e) { replyUser(msg, `❌ failed: \`${e.message}\``).catch(() => {}); }
    return;
  }
  if (/^\.leave(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const args = txt.split(/\s+/).slice(1); const target = args[0];
    if (!target) {
      if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
      if (msg.guild.id === GUILD_ID) { replyUser(msg, "❌ can't leave main server, dumbass.").catch(() => {}); return; }
      try { await msg.guild.leave(); replyUser(msg, `✅ left **${msg.guild.name}**, bro.`).catch(() => {}); }
      catch (e) { replyUser(msg, `❌ failed: \`${e.message}\``).catch(() => {}); }
      return;
    }
    if (target.toLowerCase() === "all") {
      let left = 0, failed = 0;
      for (const g of client.guilds.cache.values()) {
        if (g.id === GUILD_ID) continue;
        try { await g.leave(); left++; } catch { failed++; }
      }
      replyUser(msg, `✅ left **${left}** servers${failed ? ` (${failed} failed)` : ""}. Main server safe.`).catch(() => {});
      return;
    }
    try {
      const guild = await client.guilds.fetch(target.trim());
      if (guild.id === GUILD_ID) { replyUser(msg, "❌ can't leave main server, dumbass.").catch(() => {}); return; }
      await guild.leave(); replyUser(msg, `✅ left **${guild.name}**, bro.`).catch(() => {});
    } catch { replyUser(msg, "❌ invalid server id, dumbass.").catch(() => {}); }
    return;
  }
  // ─────────────────────────────────────────────
  // .dm — Owner Only (DM all members with a role or single user)
  // ─────────────────────────────────────────────
  if (/^\.dm(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    // Parse role mention, user mention, or ID
    const roleMention = txt.match(/<@&(\d+)>/);
    const userMention = txt.match(/<@!?(\d+)>/);
    let targetType = null; // "role" or "user"
    let targetId = null;
    let messageStart = 0;
    
    if (roleMention) {
      targetType = "role";
      targetId = roleMention[1];
      messageStart = txt.indexOf(roleMention[0]) + roleMention[0].length;
    } else if (userMention) {
      targetType = "user";
      targetId = userMention[1];
      messageStart = txt.indexOf(userMention[0]) + userMention[0].length;
    } else {
      const args = txt.split(/\s+/).slice(1);
      if (args[0] && /^\d+$/.test(args[0])) {
        targetId = args[0].trim();
        messageStart = txt.indexOf(args[0]) + args[0].length;
        // Try to determine if it's a role or user
        try {
          const roleCheck = await msg.guild.roles.fetch(targetId);
          if (roleCheck) targetType = "role";
        } catch {}
        if (!targetType) {
          try {
            const userCheck = await msg.guild.members.fetch(targetId);
            if (userCheck) targetType = "user";
          } catch {}
        }
      }
    }
    
    if (!targetId || !targetType) { replyUser(msg, "❌ mention a role/user or paste ID, dumbass.").catch(() => {}); return; }
    const messageText = txt.slice(messageStart).trim();
    if (!messageText) { replyUser(msg, "❌ put a message to send, idiot.").catch(() => {}); return; }
    
    if (targetType === "user") {
      // Single user DM
      try {
        const member = await msg.guild.members.fetch(targetId);
        if (!member) { replyUser(msg, "❌ user not found in this server, dumbass.").catch(() => {}); return; }
        const startMsg = await replyUser(msg, `⏳ Sending DM to **${member.user.tag}**...`).catch(() => {});
        try {
          await member.send(messageText);
          const result = `✅ **DM Sent!**\n\n👤 User: **${member.user.tag}**\n✅ Status: \`Sent\`\n📨 Message:\n> ${messageText.slice(0, 1000)}`;
          if (startMsg) startMsg.edit(result).catch(() => {});
          else replyUser(msg, result).catch(() => {});
        } catch {
          const result = `❌ **DM Failed!**\n\n👤 User: **${member.user.tag}**\n❌ Status: \`Failed to send\``;
          if (startMsg) startMsg.edit(result).catch(() => {});
          else replyUser(msg, result).catch(() => {});
        }
      } catch (e) {
        replyUser(msg, `❌ invalid user, dumbass.`).catch(() => {});
      }
      return;
    }
    
    // Role-based DM (original ghostdm behavior)
    let role = null;
    try { role = await msg.guild.roles.fetch(targetId); } catch {}
    if (!role) { replyUser(msg, "❌ invalid role, dumbass.").catch(() => {}); return; }
    const startMsg = await replyUser(msg, `⏳ Sending DMs to **${role.members?.size || "?"}** members with role **${role.name}**...`).catch(() => {});
    let sent = 0, failed = 0;
    try { await msg.guild.members.fetch(); } catch {}
    const membersWithRole = msg.guild.members.cache.filter(m => m.roles.cache.has(targetId) && !m.user.bot);
    for (const member of membersWithRole.values()) {
      try {
        await member.send(messageText);
        sent++;
      } catch {
        failed++;
      }
    }
    const result = `✅ **DM complete!**\n\n👥 Role: **${role.name}**\n✅ Sent: \`${sent}\`\n❌ Failed: \`${failed}\`\n📨 Message:\n> ${messageText.slice(0, 1000)}`;
    if (startMsg) startMsg.edit(result).catch(() => {});
    else replyUser(msg, result).catch(() => {});
    return;
  }
  // ─────────────────────────────────────────────
  // .delwh — Delete Webhook (regular + buyer)
  // ─────────────────────────────────────────────
  if (/^\.delwh(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "delwh", isBuyerUser);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }
    
    const arg = txt.split(/\s+/)[1]?.trim();
    if (!arg) {
      return replyUser(msg, "❌ usage: `.delwh <webhook_url>`, dumbass.").catch(() => {});
    }
    
    let webhookUrl = arg;
    const urlMatch = txt.match(/(https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+)/i);
    if (urlMatch) webhookUrl = urlMatch[1];

    const timeFooter = `Requested by @${msg.author.username}│Webhook Delete`;
    const loadingEmbed = new EmbedBuilder()
      .setColor(getEmbedColor(isBuyerUser))
      .setTitle("Deleting Webhook URL...")
      .setDescription("⏳ Processing...")
      .setFooter({ text: timeFooter });
    const sentMsg = await replyUser(msg, { embeds: [loadingEmbed] }).catch(() => {});

    try {
      const res = await fetch(webhookUrl, { method: "DELETE" });
      
      if (sentMsg) await sentMsg.delete().catch(() => {});
      
      if (res.status === 404) {
        await msg.channel.send("❌ not found.").catch(() => {});
      } else {
        const resultEmbed = new EmbedBuilder()
          .setColor(getEmbedColor(isBuyerUser))
          .setTitle("Result")
          .setFooter({ text: timeFooter });
        
        if (res.ok) {
          resultEmbed.setDescription("✅ delete.");
        } else {
          resultEmbed.setDescription(`❌ failed: HTTP ${res.status}`);
        }
        
        await msg.channel.send({
          content: `<@${msg.author.id}> done, delete the webhook bro!`,
          embeds: [resultEmbed]
        }).catch(() => {});
      }
    } catch (e) {
      if (sentMsg) await sentMsg.delete().catch(() => {});
      replyUser(msg, `❌ error: ${e.message.slice(0,100)}`).catch(() => {});
    }
    return;
  }
  // ─────────────────────────────────────────────
  // .upload — file → Pastefy loadstring (regular + buyer)
  // ─────────────────────────────────────────────
  if (/^\.upload(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "upload", isBuyerUser);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }
    let attachments = [...(msg.attachments?.values() || [])].filter(a => {
      const e = ext(a.name);
      return e === "txt" || e === "lua";
    });
    if (!attachments.length && msg.reference?.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        for (const a of refMsg.attachments?.values?.() || []) {
          const e = ext(a.name);
          if (e === "txt" || e === "lua") attachments.push(a);
        }
        for (const s of refMsg.messageSnapshots?.values?.() || []) {
          for (const a of s.attachments?.values?.() || []) {
            const e = ext(a.name);
            if (e === "txt" || e === "lua") attachments.push(a);
          }
        }
      } catch {}
    }
    if (!attachments.length) { replyUser(msg, "❌ upload a txt or lua file, dumbass.").catch(() => {}); return; }
    const file = attachments[0];
    const sentMsg = await replyUser(msg, "⏳ Uploading...").catch(() => {});
    try {
      const res = await fetch(file.url);
      const content = await res.text();
      const apiKey = process.env.PASTEFY_API_KEY;
      if (!apiKey) throw new Error("PASTEFY_API_KEY not set in env vars");
      // Try Pastefy API v2 with minimal fields
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      };
      const body = {
        title: file.name || "script.lua",
        content: content
      };
      let pastefyRes = await fetch("https://pastefy.app/api/v2/paste", {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      let rawUrl = null;
      if (pastefyRes.ok) {
        try {
          const data = await pastefyRes.json();
          const pid = data?.id || data?._id || data?.paste?.id;
          if (pid) rawUrl = `https://pastefy.app/${pid}/raw`;
        } catch {}
      }
      // Fallback: try v1 endpoint
      if (!rawUrl) {
        const v1Res = await fetch("https://pastefy.app/api/v1/paste", {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        });
        if (v1Res.ok) {
          try {
            const data = await v1Res.json();
            const pid = data?.id || data?._id || data?.paste?.id;
            if (pid) rawUrl = `https://pastefy.app/${pid}/raw`;
          } catch {}
        } else {
          // Show v2 error if both failed
          const errText = await pastefyRes.text();
          throw new Error(`Pastefy v2 HTTP ${pastefyRes.status}: ${errText.slice(0, 150)}`);
        }
      }
      if (!rawUrl) throw new Error("Could not get paste URL from Pastefy response");
      const loadstring = `loadstring(game:HttpGet("${rawUrl}"))()`;
      if (sentMsg) await sentMsg.delete().catch(() => {});
      const embed = new EmbedBuilder()
        .setColor(getEmbedColor(isBuyerUser))
        .setTitle("Script Copy")
        .setDescription(`\`\`\`lua\n${loadstring}\n\`\`\``)
        .setFooter({ text: `Request by @${msg.author.username}│File → Script` });
      await msg.channel.send({
        content: `<@${msg.author.id}> Here is the script bro!`,
        embeds: [embed]
      }).catch(() => {});
    } catch (e) {
      if (sentMsg) await sentMsg.delete().catch(() => {});
      replyUser(msg, `❌ upload failed: ${e.message}`).catch(() => {});
    }
    return;
  }
  // ─────────────────────────────────────────────
  // .obf — Prince Obfuscator (regular + buyer)
  // ─────────────────────────────────────────────
  if (/^\.obf(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "obf", isBuyerUser);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }
    let attachments = [...(msg.attachments?.values() || [])].filter(a => {
      const e = ext(a.name);
      return e === "txt" || e === "lua";
    });
    if (!attachments.length && msg.reference?.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        for (const a of refMsg.attachments?.values?.() || []) {
          const e = ext(a.name);
          if (e === "txt" || e === "lua") attachments.push(a);
        }
        for (const s of refMsg.messageSnapshots?.values?.() || []) {
          for (const a of s.attachments?.values?.() || []) {
            const e = ext(a.name);
            if (e === "txt" || e === "lua") attachments.push(a);
          }
        }
      } catch {}
    }
    if (!attachments.length) { replyUser(msg, "❌ upload a file so i can make it obfuscate file.").catch(() => {}); return; }
    const file = attachments[0];
    const sentMsg = await replyUser(msg, "🔒 Obfuscating...").catch(() => {});
    try {
      const res = await fetch(file.url);
      const source = await res.text();
      // Obfuscate the script
      const obfuscated = obfuscateLua(source);
      // Upload obfuscated to Pastefy
      const apiKey = process.env.PASTEFY_API_KEY;
      if (!apiKey) throw new Error("PASTEFY_API_KEY not set in env vars");
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      };
      const body = {
        title: "obfuscated.lua",
        content: obfuscated
      };
      let pastefyRes = await fetch("https://pastefy.app/api/v2/paste", {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      let rawUrl = null;
      if (pastefyRes.ok) {
        try {
          const data = await pastefyRes.json();
          const pid = data?.id || data?._id || data?.paste?.id;
          if (pid) rawUrl = `https://pastefy.app/${pid}/raw`;
        } catch {}
      }
      if (!rawUrl) {
        const v1Res = await fetch("https://pastefy.app/api/v1/paste", {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        });
        if (v1Res.ok) {
          try {
            const data = await v1Res.json();
            const pid = data?.id || data?._id || data?.paste?.id;
            if (pid) rawUrl = `https://pastefy.app/${pid}/raw`;
          } catch {}
        } else {
          const errText = await pastefyRes.text();
          throw new Error(`Pastefy HTTP ${pastefyRes.status}: ${errText.slice(0, 150)}`);
        }
      }
      if (!rawUrl) throw new Error("Could not get paste URL from Pastefy response");
      const loadstring = `loadstring(game:HttpGet("${rawUrl}"))()`;
      // Create obfuscated file attachment
      const obfFileName = "obfuscated.lua";
      const obfAttachment = new AttachmentBuilder(Buffer.from(obfuscated, "utf-8"), { name: obfFileName });
      if (sentMsg) await sentMsg.delete().catch(() => {});
      await msg.channel.send({
        content: `<@${msg.author.id}>\n\`\`\`lua\n${loadstring}\n\`\`\``,
        files: [obfAttachment]
      }).catch(() => {});
    } catch (e) {
      if (sentMsg) await sentMsg.delete().catch(() => {});
      replyUser(msg, `❌ obfuscate failed: ${e.message}`).catch(() => {});
    }
    return;
  }
  // ─────────────────────────────────────────────
  // .scanchannel — Owner Only
  // ─────────────────────────────────────────────
  if (/^\.scanchannel(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    const args = txt.split(/\s+/).slice(1);
    let ch = null;
    const mentionMatch = txt.match(/<#(\d+)>/);
    if (mentionMatch) {
      try { ch = await client.channels.fetch(mentionMatch[1]); } catch {}
    }
    if (!ch && args[0]) {
      try { ch = await client.channels.fetch(args[0].trim()); } catch {}
    }
    if (!ch) { replyUser(msg, "❌ provide a channel: `.scanchannel #channel` or `.scanchannel channel_id`, dumbass.").catch(() => {}); return; }
    if (!ch?.isTextBased?.()) { replyUser(msg, "❌ not a readable text channel, idiot.").catch(() => {}); return; }
    if (runningScans.has(ch.id)) { replyUser(msg, "⚠️ already scanning that channel, bro.").catch(() => {}); return; }
    const startMsg = await replyUser(msg, `⚡ **Scan started** for <#${ch.id}>...`).catch(() => {});
    scanChannel(ch).then(r => {
      const content = `✅ **Scan complete!**\n📂 <#${ch.id}>\n💬 Messages: \`${r.messages}\`\n📄 New: \`${r.found}\`\n🔄 Replaced: \`${r.replaced || 0}\`\n🚫 Skipped: \`${r.skipped}\`\n📁 Channel Files: \`${r.channelTotal}\`\n📚 Library Total: \`${r.total}\``;
      if (startMsg) startMsg.edit(content).catch(() => {});
      else replyUser(msg, content).catch(() => {});
    }).catch(e => {
      const content = `❌ **Scan failed:**\n\`${e.message.slice(0,1500)}\``;
      if (startMsg) startMsg.edit(content).catch(() => {});
      else replyUser(msg, content).catch(() => {});
    });
    return;
  }
  // ─────────────────────────────────────────────
  // .setchannel — Owner Only
  // ─────────────────────────────────────────────
  if (/^\.setchannel(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    const args = txt.split(/\s+/).slice(1);
    let ch = null;
    const mentionMatch = txt.match(/<#(\d+)>/);
    if (mentionMatch) {
      try { ch = await client.channels.fetch(mentionMatch[1]); } catch {}
    }
    if (!ch && args[0] && args[0] !== ".") {
      try { ch = await client.channels.fetch(args[0].trim()); } catch {}
    }
    if (!ch) { ch = msg.channel; }
    config.allowedChannelId = ch.id;
    saveConfig();
    replyUser(msg, `✅ Allowed channel set to <#${ch.id}>.`).catch(() => {});
    return;
  }
  // ─────────────────────────────────────────────
  // .extract — Owner Only (regular users CANNOT use)
  // ─────────────────────────────────────────────
  if (/^\.extract(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    let attachments = extractAttachmentsOf(msg);
    if (!attachments.length && msg.reference?.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        attachments = extractAttachmentsOf(refMsg);
      } catch {}
    }
    if (!attachments.length) {
      replyUser(msg, "❌ upload a .zip file or reply to one, dumbass.").catch(() => {});
      return;
    }
    const sourceFile = attachments[0];
    const maxInfo = getMaxFileSize(msg.guild);
    if (sourceFile.size > maxInfo.size) {
      replyUser(msg, `❌ max file is ${maxInfo.label}, lol.`).catch(() => {});
      return;
    }
    const sentMsg = await replyUser(msg, "⏳ Processing...").catch(() => {});
    try {
      const buf = await downloadURL(sourceFile.url);
      let files = extractFilesFromZip(buf);
      if (!files.length) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, "❌ zip is empty or has no extractable files, bro.").catch(() => {});
        return;
      }
      if (sentMsg) await sentMsg.delete().catch(() => {});
      const maxPerBatch = 10;
      for (let i = 0; i < files.length; i += maxPerBatch) {
        const batch = files.slice(i, i + maxPerBatch);
        const batchAttachments = batch.map(f => new AttachmentBuilder(f.data, { name: f.name }));
        await msg.channel.send({ files: batchAttachments }).catch(() => {});
      }
    } catch (e) {
      if (sentMsg) await sentMsg.delete().catch(() => {});
      replyUser(msg, `❌ error: ${e.message}`).catch(() => {});
    }
    return;
  }
  // ─────────────────────────────────────────────
  // .scan — Owner Only
  // ─────────────────────────────────────────────
  if (/^\.scan(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    const args = txt.split(/\s+/).slice(1);
    let ch = null;
    const mentionMatch = txt.match(/<#(\d+)>/);
    if (mentionMatch) {
      try { ch = await client.channels.fetch(mentionMatch[1]); } catch {}
    }
    if (!ch && args[0]) {
      try { ch = await client.channels.fetch(args[0].trim()); } catch {}
    }
    if (!ch && !args[0]) { ch = msg.channel; }
    if (!ch) { replyUser(msg, "❌ provide a channel: `.scan #channel` or `.scan channel_id`, dumbass.").catch(() => {}); return; }
    if (!ch?.isTextBased?.()) { replyUser(msg, "❌ not a readable text channel, idiot.").catch(() => {}); return; }
    if (runningScans.has(ch.id)) { replyUser(msg, "⚠️ already scanning that channel, bro.").catch(() => {}); return; }
    const startMsg = await replyUser(msg, `⚡ **Scan started** for <#${ch.id}>...`).catch(() => {});
    scanChannel(ch).then(r => {
      const content = `✅ **Scan complete!**\n📂 <#${ch.id}>\n💬 Messages: \`${r.messages}\`\n📄 New: \`${r.found}\`\n🔄 Replaced: \`${r.replaced || 0}\`\n🚫 Skipped: \`${r.skipped}\`\n📁 Channel Files: \`${r.channelTotal}\`\n📚 Library Total: \`${r.total}\``;
      if (startMsg) startMsg.edit(content).catch(() => {});
      else replyUser(msg, content).catch(() => {});
    }).catch(e => {
      const content = `❌ **Scan failed:**\n\`${e.message.slice(0,1500)}\``;
      if (startMsg) startMsg.edit(content).catch(() => {});
      else replyUser(msg, content).catch(() => {});
    });
    return;
  }
  // ─────────────────────────────────────────────
  // REGULAR USER COMMANDS
  // .find, .get, .rename/.rn, .et, .dl/.download
  // ─────────────────────────────────────────────

  // .et — carousel mode
  if (/^\.et(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg, true);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    if (isDM && !perm.isBuyer) { replyUser(msg, "❌ not here, dumbass.").catch(() => {}); return; }
    const cd = checkCommandCooldown(msg.author.id, "et", perm.isBuyer);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }
    let attachments = extractAttachmentsOf(msg);
    if (!attachments.length && msg.reference?.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        attachments = extractAttachmentsOf(refMsg);
      } catch {}
    }
    if (!attachments.length) {
      replyUser(msg, "❌ upload a .zip file or reply to one, dumbass.").catch(() => {});
      return;
    }
    const sourceFile = attachments[0];
    const maxInfo = getMaxFileSize(msg.guild);
    if (sourceFile.size > maxInfo.size) {
      replyUser(msg, `❌ max file is ${maxInfo.label}, lol.`).catch(() => {});
      return;
    }
    const sentMsg = await replyUser(msg, "⏳ Processing...").catch(() => {});
    try {
      const buf = await downloadURL(sourceFile.url);
      let files = extractFilesFromZip(buf);
      if (!files.length) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, "❌ zip is empty or has no extractable files, bro.").catch(() => {});
        return;
      }
      if (sentMsg) await sentMsg.delete().catch(() => {});
      const firstFile = files[0];
      const attachment = new AttachmentBuilder(firstFile.data, { name: firstFile.name });
      const pageLabel = `1/${files.length}`;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("extract_prev").setEmoji("⬅️").setStyle(ButtonStyle.Secondary).setDisabled(files.length <= 1),
        new ButtonBuilder().setCustomId("extract_page").setLabel(pageLabel).setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId("extract_next").setEmoji("➡️").setStyle(ButtonStyle.Secondary).setDisabled(files.length <= 1)
      );
      const carouselMsg = await msg.channel.send({ files: [attachment], components: [row] }).catch(() => {});
      if (carouselMsg) {
        extractCarouselMenus.set(msg.author.id, {
          files, index: 0, sourceType: "zip",
          messageId: carouselMsg.id, authorId: msg.author.id, createdAt: Date.now()
        });
      }
    } catch (e) {
      if (sentMsg) await sentMsg.delete().catch(() => {});
      replyUser(msg, `❌ error: ${e.message}`).catch(() => {});
    }
    return;
  }
  // .rename / .rn
  if (/^\.(?:rename|rn)$/i.test(txt)) {
    const perm = await checkRegularPermission(msg, false);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "rename", isBuyerUser);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }
    let attachments = [...(msg.attachments?.values() || [])];
    if (!attachments.length && msg.reference?.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        attachments = [...allAttachmentsOf(refMsg)];
      } catch {}
    }
    if (!attachments.length) { replyUser(msg, "❌ bruh, upload file or reply to a file so i can fix it.").catch(() => {}); return; }
    const file = attachments[0];
    const fileExt = ext(file.name);
    if (fileExt !== "lua" && fileExt !== "txt") { replyUser(msg, "❌ only .lua and .txt is working, idiot.").catch(() => {}); return; }
    const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}`;
    const workingEmbed = new EmbedBuilder()
      .setColor(getEmbedColor(isBuyerUser))
      .setTitle("Processing File")
      .setDescription("⏳ Processing...")
      .setFooter({ text: timeFooter });
    const sentMsg = await replyUser(msg, { embeds: [workingEmbed] }).catch(() => {});
    const delay = isBuyerUser ? 0 : 10000;
    setTimeout(async () => {
      try {
        const res = await fetch(file.url);
        const text = await res.text();
        // Extract URLs from original file content
        const urlRegex = /https?:\/\/[^\s"'()\]]+/g;
        const foundUrls = text.match(urlRegex) || [];
        const cleaned = cleanLuaScript(text);
        
        // Stats
        const originalLines = text.split("\n").length;
        const cleanedLines = cleaned.split("\n").length;
        const linesRemoved = originalLines - cleanedLines;
        const originalSize = Buffer.byteLength(text, "utf8");
        const cleanedSize = Buffer.byteLength(cleaned, "utf8");
        
        // Better filename: prefix + random + .lua
        const randChars = "abcdefghijklmnopqrstuvwxyz0123456789";
        let outputName = "fixed_";
        for (let i = 0; i < 12; i++) {
          outputName += randChars.charAt(Math.floor(Math.random() * randChars.length));
        }
        outputName += ".lua";
        
        // Add clean header to output file
        const fileHeader = `-- Cleaned & Fixed by Prince Bot\n-- Original: ${file.name}\n-- Lines removed: ${linesRemoved}\n-- Size reduced: ${((1 - cleanedSize / originalSize) * 100).toFixed(1)}%\n\n`;
        const finalOutput = fileHeader + cleaned;
        
        const allLines = cleaned.split("\n");
        const previewLines = allLines.slice(0, 5);
        let previewText = previewLines.join("\n");
        if (allLines.length > 5) previewText += "\n...";
        // Safety truncation
        if (previewText.length > 3000) previewText = previewText.slice(0, 3000) + "\n...";
        
        // Build description with URL section if links found
        let description = `\`\`\`lua\n${previewText}\n\`\`\``;
        if (foundUrls.length > 0) {
          const uniqueUrls = [...new Set(foundUrls)];
          const urlList = uniqueUrls.slice(0, 10).map(u => `- ${u}`).join("\n");
          let urlSection = `\n\n**URL Found:**\n${urlList}`;
          if (uniqueUrls.length > 10) urlSection += `\n- ...and ${uniqueUrls.length - 10} more`;
          description += urlSection.slice(0, 800);
        }
        // Add file stats
        description += `\n\n📊 **Stats:** ${linesRemoved} lines removed │ ${((1 - cleanedSize / originalSize) * 100).toFixed(0)}% cleaner`;
        
        const resultEmbed = new EmbedBuilder()
          .setColor(getEmbedColor(isBuyerUser))
          .setTitle("File Preview")
          .setDescription(description)
          .setFooter({ text: `Requested by @${msg.author.username} │ Prince Rename` });
        const fixedFile = new AttachmentBuilder(Buffer.from(finalOutput), { name: outputName });
        if (sentMsg) await sentMsg.delete().catch(() => {});
        await msg.channel.send({
          content: `<@${msg.author.id}> **Here is the file bro!**`,
          files: [fixedFile],
          embeds: [resultEmbed]
        }).catch(() => {});
      } catch (e) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, `❌ error: ${e.message}`).catch(() => {});
      }
    }, delay);
    return;
  }
  // .get
  if (/^\.get(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const cd = checkCommandCooldown(msg.author.id, "get", perm.isBuyer);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }
    const id = txt.split(/\s+/)[1];
    if (!id) { replyUser(msg, "❌ put id of file, idiot.").catch(() => {}); return; }
    const file = getFile(id);
    if (!file) { replyUser(msg, "❌ your id is wrong, try find working id, dumbass.").catch(() => {}); return; }
    const freshUrl = await getFreshUrl(file);
    replyUser(msg, { content: "**Here is the file twin!**", files: [{ attachment: freshUrl || file.url, name: file.filename || "file" }] }).catch(() => {});
    return;
  }
  // .dl / .download — gives file from library ID OR downloads from Discord CDN link
  if (/^\.(?:dl|download)(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const arg = txt.split(/\s+/)[1];
    if (!arg) { replyUser(msg, "❌ put file link, idiot.").catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "dl", isBuyerUser);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }

    // Check if input is a URL
    if (/^https?:\/\//i.test(arg) || /cdn\.discordapp\.com/i.test(arg) || /media\.discordapp\.net/i.test(arg)) {
      const sentMsg = await replyUser(msg, "⏳ Processing...").catch(() => {});
      try {
        const buf = await downloadURL(arg);
        // Extract filename from URL
        let fileName = "file";
        const urlMatch = arg.match(/\/([^/?#]+)(?:\?|#|$)/);
        if (urlMatch) fileName = decodeURIComponent(urlMatch[1]);
        const fileExt = ext(fileName);
        if (!fileExt) fileName += ".txt";
        const attachment = new AttachmentBuilder(buf, { name: fileName });
        if (sentMsg) await sentMsg.delete().catch(() => {});
        await msg.channel.send({
          content: `<@${msg.author.id}> **Here is the file bro!**`,
          files: [attachment]
        }).catch(() => {});
      } catch (e) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, `❌ error: ${e.message}`).catch(() => {});
      }
      return;
    }

    // Otherwise treat as file ID from library
    const file = getFile(arg);
    if (!file) { replyUser(msg, "❌ your id is wrong, try find working id, dumbass.").catch(() => {}); return; }
    const freshUrl = await getFreshUrl(file);
    const fileUrl = freshUrl || file.url;
    const embed = new EmbedBuilder()
      .setColor(getEmbedColor(isBuyerUser))
      .setTitle("Download Link")
      .setDescription(`**File:** \`${file.filename}\`\n**ID:** \`${file.id}\`\n\n🔗 **Direct Link:**\n${fileUrl}`)
      .setFooter({ text: `Requested by @${msg.author.username}` });
    replyUser(msg, { embeds: [embed] }).catch(() => {});
    return;
  }
  // .find
  if (/^\.find(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const query = txt.slice(5).trim();
    if (!query) { replyUser(msg, "❌ usage: `.find <file name>`, dumbass.").catch(() => {}); return; }
    const results = findFiles(query);
    if (!results.length) { replyUser(msg, "❌ no matching file name for that, dumbass.").catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "find", isBuyerUser);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }
    const perPage = 8; const totalPages = Math.ceil(results.length / perPage);
    const pageItems = results.slice(0, perPage);
    const timeNow = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" });
    const embed = new EmbedBuilder()
      .setColor(getEmbedColor(isBuyerUser))
      .setTitle(getFinderTitle(isBuyerUser))
      .setDescription(pageItems.map(f => `\`${f.filename}\` — ID: \`${f.id}\``).join("\n"))
      .setFooter({ text: `Pages 1/${totalPages} │ Today at ${timeNow}` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(totalPages <= 1)
    );
    const sent = await replyUser(msg, { embeds: [embed], components: [row] }).catch(() => {});
    if (sent) paginationMenus.set(msg.author.id, {
      results, page: 1, totalPages, messageId: sent.id,
      authorId: msg.author.id, createdAt: Date.now(), isBuyer: isBuyerUser
    });
    return;
  }
});
// ============================================================
// EXPRESS SERVER
// ============================================================
const app = express();
app.get("/", (req, res) => res.status(200).send(isReady ? "✅ ONLINE" : "⏳ Starting..."));
app.get("/health", (req, res) => res.status(200).json({
  process: "online", discord: isReady ? "ready" : "offline", bot: client.user?.tag, guild: GUILD_ID, files: library.files.length
}));
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 Port ${PORT}`));
const keepAliveUrl = process.env.RENDER_EXTERNAL_URL || "";
if (keepAliveUrl) {
  setInterval(() => {
    try { require("https").get(`${keepAliveUrl}/health`).on("error", () => {}); } catch(e) {}
  }, 180000);
}
process.on("unhandledRejection", e => console.error("❌ Rejection:", e));
process.on("uncaughtException", e => console.error("❌ Exception:", e));
console.log("🔑 Connecting...");
client.login(TOKEN).catch(e => { console.error("❌ Login fail:", e); process.exit(1); });
