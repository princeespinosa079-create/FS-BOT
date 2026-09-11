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
const ACCESS_ROLE_ID = "1539883004950876160";
const PRINCE_ROLE_ID = "1547849774676316181";
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
// ============================================================
// DISCORD CLIENT
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ]
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
async function hasAccess(member, userId) {
  const uid = userId || member?.id;
  if (uid === OWNER_ID) return true;
  try {
    const mainGuild = await client.guilds.fetch(GUILD_ID);
    const mainMember = await mainGuild.members.fetch(uid);
    return mainMember?.roles?.cache?.has(ACCESS_ROLE_ID);
  } catch {
    return member?.roles?.cache?.has(ACCESS_ROLE_ID) || false;
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
// STANDARD DOT COMMAND PERMISSION CHECK
// ============================================================
async function checkDotCommandPermission(msg, needsFileReply = false) {
  const isOwnerOrAccess = isOwner(msg.author.id) || await hasAccess(msg.member, msg.author.id);
  if (isOwnerOrAccess) return { allowed: true };

  // Cross-server check: must be in main guild
  if (msg.guild.id !== GUILD_ID) {
    const inMain = await isInMainGuild(msg.author.id);
    if (!inMain) {
      return { allowed: false, reason: "❌ join in main server first bro `.gg/TBBAUZu8cW`." };
    }
  }

  const hasStatus = await hasPrinceStatus(msg.author.id);

  // If channel is restricted
  if (!channelAllowed(msg)) {
    if (hasStatus) {
      return { allowed: false, reason: "❌ not here, dumbass." };
    } else {
      return { allowed: false, reason: "❌ put `.gg/TBBAUZu8cW` in your status first bro." };
    }
  }

  // Must have status
  if (!hasStatus) {
    return { allowed: false, reason: "❌ put `.gg/TBBAUZu8cW` in your status first bro." };
  }

  if (needsFileReply && !isReplyingToFile(msg)) {
    return { allowed: false, reason: "❌ reply to a file or forwarded file, dumbass." };
  }

  return { allowed: true };
}
function isReplyingToFile(msg) {
  const ref = msg.reference?.messageId;
  if (!ref) return false;
  const channel = msg.channel;
  const repliedMsg = channel.messages.cache.get(ref);
  if (!repliedMsg) return false;
  if (repliedMsg.attachments.size > 0) return true;
  for (const snap of repliedMsg.messageSnapshots.values()) {
    if (snap.attachments.size > 0) return true;
  }
  return false;
}
function replyUser(message, payload) {
  const body = typeof payload === "string" ? { content: payload } : { ...payload };
  body.allowedMentions = { ...(body.allowedMentions || {}), repliedUser: true };
  return message.reply(body);
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
    const existingSizes = new Set(library.files.map(f => Number(f.size || 0)));
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
          const isDupSize = fileSize > 0 && existingSizes.has(fileSize);
          if (isDupBase || isDupFull || isDupSize) {
            skippedDup++;
            continue;
          }
          existingBases.add(baseName);
          existingFullNames.add(fullName);
          existingSizes.add(fileSize);
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
    const channelTotal = library.files.filter(f => f.channelId === channel.id).length;
    console.log(`📂 Scan done | #${channel.name} | ${messages} msgs | ${found.length} new | ${replacedDup} replaced | ${skippedDup} skipped | ${pages} pages`);
    return { messages, found: found.length, replaced: replacedDup, skipped: skippedDup, total: library.files.length, channelTotal };
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
  // Step 2: Remove single-line comments --... (but preserve --[[ in case already handled)
  cleaned = cleaned.replace(/--[^\n]*/g, "");
  // Step 3: Remove print statements (whole lines that are just print calls)
  // Handles: print("..."), print('...'), print(...), print( [[...]] )
  cleaned = cleaned.split("\n").map(line => {
    const trimmed = line.trim();
    if (/^print\s*\(/.test(trimmed) && /\)\s*[;]?$/.test(trimmed)) {
      return "";
    }
    // Also remove lines that are only print with nothing else
    if (/^\s*print\s*\(/.test(line) && /\)\s*;?\s*$/.test(line)) {
      return "";
    }
    return line;
  }).join("\n");
  // Step 4: Remove URLs / links (http, https, www, discord.gg, etc.)
  // Remove inline URLs from within lines
  cleaned = cleaned.replace(/https?:\/\/[^\s"'()\]]+/g, "");
  cleaned = cleaned.replace(/www\.[^\s"'()\]]+/g, "");
  cleaned = cleaned.replace(/discord\.gg\/[^\s"'()\]]+/g, "");
  // Step 5: Remove lines that are purely non-code text (descriptions, notes, etc.)
  // A line is "code" if it contains code syntax markers OR is a standalone Lua keyword line
  const LUA_STANDALONE = /^\s*(break|end|goto|return|true|false|nil)\s*[;]?\s*$/;
  const LUA_CODE_MARKERS = /[=+\-*/%^#<>~{}()\[\];:,.]|["']|::|\.\.\.|\.\.|\b\d+\.?\d*\b/;
  cleaned = cleaned.split("\n").filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep empty lines for now, we'll collapse later
    // Keep if line is just a standalone Lua keyword (end, return, break, etc.)
    if (LUA_STANDALONE.test(trimmed)) return true;
    // Keep if has code syntax markers (operators, brackets, quotes, numbers, etc.)
    if (LUA_CODE_MARKERS.test(trimmed)) return true;
    // Remove: pure text lines with no code structure
    return false;
  }).join("\n");
  // Step 6: Collapse multiple consecutive empty lines into at most one
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  // Step 7: Trim leading/trailing whitespace from each line but preserve indentation
  cleaned = cleaned.split("\n").map(line => {
    // Keep leading spaces/tabs (indentation), trim trailing
    const m = line.match(/^(\s*)(.*?)\s*$/);
    return m ? (m[1] + m[2]) : line.trimEnd();
  }).join("\n");
  // Step 8: Remove leading blank lines at start of file
  cleaned = cleaned.replace(/^\s*\n+/, "");
  // Step 9: Remove trailing blank lines at end of file
  cleaned = cleaned.replace(/\n+\s*$/, "\n");
  return cleaned;
}
// ============================================================
// SLASH COMMANDS
// ============================================================
const commands = [
  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription("Scan channel — Owner Only.")
    .addChannelOption(o => o
      .setName("channel")
      .setDescription("Channel to scan.")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false))
    .addStringOption(o => o
      .setName("channel_id")
      .setDescription("Or paste raw channel ID.")
      .setRequired(false)),
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
      .setRequired(false)),
  new SlashCommandBuilder()
    .setName("forwardall")
    .setDescription("Forward files — Owner Only.")
    .addChannelOption(o => o
      .setName("source")
      .setDescription("Source channel.")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false))
    .addStringOption(o => o
      .setName("source_id")
      .setDescription("Or raw source ID.")
      .setRequired(false))
    .addChannelOption(o => o
      .setName("destination")
      .setDescription("Destination channel.")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false))
    .addStringOption(o => o
      .setName("destination_id")
      .setDescription("Or raw destination ID.")
      .setRequired(false)),
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set allowed channel — Owner Only.")
].map(c => c.toJSON());
async function registerCommands() {
  if (registering) return;
  registering = true;
  const rest = new REST({ version: "10", timeout: 15000 }).setToken(TOKEN);
  try {
    console.log("🧹 Clearing old commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    console.log("🧩 Registering guild commands...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Commands registered.");
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
  // Sync prince roles for all existing members
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
  // If role was manually removed but user still has status, re-add it
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
    .setColor(0x808080)
    .setTitle("Finder Search Results")
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
// SLASH COMMAND HANDLER — ALL OWNER ONLY
// ============================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  console.log(`📨 /${interaction.commandName}`);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const isOwnerUser = isOwner(interaction.user.id);
    // ALL SLASH COMMANDS: OWNER ONLY
    if (!isOwnerUser) {
      await interaction.editReply({ content: "❌ owner only, dumbass." });
      return;
    }
    if (interaction.commandName === "setchannel") {
      config.allowedChannelId = interaction.channelId; saveConfig();
      await interaction.editReply({ content: `✅ Allowed channel set to <#${interaction.channelId}>.\n\n👑 Owner only can use slash commands.` }); return;
    }
    if (interaction.commandName === "say") {
      const text = interaction.options.getString("text");
      const type = interaction.options.getString("type") || "good";
      const title = interaction.options.getString("title");
      const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}`;
      await interaction.deleteReply().catch(() => {});
      if (type === "none") {
        await interaction.channel.send({ content: text });
      } else {
        const embed = new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(text)
          .setFooter({ text: timeFooter });
        if (title) embed.setTitle(title);
        await interaction.channel.send({ embeds: [embed] });
      }
      return;
    }
    if (interaction.commandName === "scanchannel") {
      let ch = interaction.options.getChannel("channel");
      const chId = interaction.options.getString("channel_id");
      if (!ch && chId) {
        try { ch = await client.channels.fetch(chId.trim()); }
        catch { await interaction.editReply({ content: "❌ Invalid channel ID." }); return; }
      }
      if (!ch) {
        await interaction.editReply({ content: "❌ Provide a channel mention or channel_id." }); return;
      }
      if (!ch?.isTextBased?.()) { await interaction.editReply({ content: "❌ Not a readable text channel." }); return; }
      if (runningScans.has(ch.id)) { await interaction.editReply({ content: "⚠️ Already scanning." }); return; }
      await interaction.editReply({ content: `⚡ **Scan started** for <#${ch.id}>.` });
      scanChannel(ch).then(r => interaction.editReply({
        content: `✅ **Scan complete!**\n📂 <#${ch.id}>\n💬 Messages: \`${r.messages}\`\n📄 New: \`${r.found}\`\n🔄 Replaced: \`${r.replaced || 0}\`\n🚫 Skipped: \`${r.skipped}\`\n📁 Channel Files: \`${r.channelTotal}\`\n📚 Library Total: \`${r.total}\``
      }).catch(() => {})).catch(e => interaction.editReply({ content: `❌ **Scan failed:**\n\`${e.message.slice(0,1500)}\`` }).catch(() => {}));
      return;
    }
    if (interaction.commandName === "forwardall") {
      let src = interaction.options.getChannel("source");
      let dst = interaction.options.getChannel("destination");
      const srcId = interaction.options.getString("source_id");
      const dstId = interaction.options.getString("destination_id");
      if (!src && srcId) try { src = await client.channels.fetch(srcId.trim()); } catch { await interaction.editReply({ content: "❌ Invalid source ID." }); return; }
      if (!dst && dstId) try { dst = await client.channels.fetch(dstId.trim()); } catch { await interaction.editReply({ content: "❌ Invalid destination ID." }); return; }
      if (!src || !dst) { await interaction.editReply({ content: "❌ Provide source + destination." }); return; }
      if (!src?.isTextBased?.() || !dst?.isTextBased?.()) { await interaction.editReply({ content: "❌ Invalid channel type." }); return; }
      await interaction.editReply({ content: `⚡ Forwarding from <#${src.id}> → <#${dst.id}>...` });
      forwardTxt(src, dst).then(r => interaction.editReply({
        content: `✅ **Forward started!**\n📂 <#${src.id}> → <#${dst.id}>\n📄 Found: \`${r.sent}\` files sending...\n⚡ Forward runs in background, use other commands freely.`
      }).catch(() => {})).catch(e => interaction.editReply({ content: `❌ Failed: \`${e.message.slice(0,1500)}\`` }).catch(() => {}));
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
  if (msg.author.bot || !msg.guild) return;
  const txt = (msg.content || "").trim();
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
  // STANDARD DOT COMMANDS (same requirements)
  // Owner / Access Role → bypass
  // Others → allowed channel + prince status
  // ─────────────────────────────────────────────
  // .et — carousel mode (buttons + page counter)
  if (/^\.et(?:\s|$)/i.test(txt)) {
    const perm = await checkDotCommandPermission(msg, true);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
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
    // Dynamic max size based on server boost level
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
      // CAROUSEL MODE: FILE + BUTTONS only
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
          files,
          index: 0,
          sourceType: "zip",
          messageId: carouselMsg.id,
          authorId: msg.author.id,
          createdAt: Date.now()
        });
      }
    } catch (e) {
      if (sentMsg) await sentMsg.delete().catch(() => {});
      replyUser(msg, `❌ error: ${e.message}`).catch(() => {});
    }
    return;
  }
  // .extract — dump all files at once to the channel
  if (/^\.extract(?:\s|$)/i.test(txt)) {
    const perm = await checkDotCommandPermission(msg, true);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
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
    // Dynamic max size based on server boost level
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
      // DUMP MODE: send all files in batches of 10
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
  // .scan
  if (/^\.scan(?:\s|$)/i.test(txt)) {
    const perm = await checkDotCommandPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
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
  // .rename / .rn
  if (/^\.(?:rename|rn)$/i.test(txt)) {
    const perm = await checkDotCommandPermission(msg, true);
    if (!perm.allowed) {
      // Cooldown only applies to non-privileged users
      const isOwnerOrAccess = isOwner(msg.author.id) || await hasAccess(msg.member, msg.author.id);
      if (!isOwnerOrAccess) {
        const now = Date.now();
        if (rnCooldown.has(msg.author.id)) {
          const remaining = Math.ceil((rnCooldown.get(msg.author.id) + RN_COOLDOWN_SEC * 1000 - now) / 1000);
          if (remaining > 0) {
            replyUser(msg, `❌ wait ${remaining}s before using .rn again, bro.`).catch(() => {});
            return;
          }
        }
        rnCooldown.set(msg.author.id, now);
      }
      replyUser(msg, perm.reason).catch(() => {});
      return;
    }
    const isOwnerOrAccess = isOwner(msg.author.id) || await hasAccess(msg.member, msg.author.id);
    if (!isOwnerOrAccess) {
      const now = Date.now();
      if (rnCooldown.has(msg.author.id)) {
        const remaining = Math.ceil((rnCooldown.get(msg.author.id) + RN_COOLDOWN_SEC * 1000 - now) / 1000);
        if (remaining > 0) {
          replyUser(msg, `❌ wait ${remaining}s before using .rn again, bro.`).catch(() => {});
          return;
        }
      }
      rnCooldown.set(msg.author.id, now);
    }
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
      .setColor(0x808080)
      .setTitle("Renaming your File")
      .setDescription("⏳ Processing...")
      .setFooter({ text: timeFooter });
    const sentMsg = await replyUser(msg, { embeds: [workingEmbed] }).catch(() => {});
    const delay = isOwnerOrAccess ? 0 : 10000;
    setTimeout(async () => {
      try {
        const res = await fetch(file.url);
        const text = await res.text();
        const cleaned = cleanLuaScript(text);
        const randChars = "abcdefghijklmnopqrstuvwxyz";
        let outputName = "";
        for (let i = 0; i < 20; i++) {
          outputName += randChars.charAt(Math.floor(Math.random() * randChars.length));
        }
        outputName += ".lua";
        const allLines = cleaned.split("\n");
        const previewLines = allLines.slice(0, 5);
        let previewText = previewLines.join("\n");
        if (allLines.length > 5) previewText += "\n...";
        const resultEmbed = new EmbedBuilder()
          .setColor(0x808080)
          .setTitle("Rename File")
          .setDescription(`\`\`\`lua\n${previewText}\n\`\`\``)
          .setFooter({ text: `Requested by @${msg.author.username} │ Prince Rename` });
        const fixedFile = new AttachmentBuilder(Buffer.from(cleaned), { name: outputName });
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
    const perm = await checkDotCommandPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const id = txt.split(/\s+/)[1];
    if (!id) { replyUser(msg, "❌ put id of file, idiot.").catch(() => {}); return; }
    const file = getFile(id);
    if (!file) { replyUser(msg, "❌ your id is wrong, try find working id, dumbass.").catch(() => {}); return; }
    const freshUrl = await getFreshUrl(file);
    replyUser(msg, { content: "**Here is the file twin!**", files: [{ attachment: freshUrl || file.url, name: file.filename || "file" }] }).catch(() => {});
    return;
  }
  // .find
  if (/^\.find(?:\s|$)/i.test(txt)) {
    const perm = await checkDotCommandPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const query = txt.slice(5).trim();
    if (!query) { replyUser(msg, "❌ usage: `.find <file name>`, dumbass.").catch(() => {}); return; }
    const results = findFiles(query);
    if (!results.length) { replyUser(msg, "❌ no matching file name for that, dumbass.").catch(() => {}); return; }
    const perPage = 8; const totalPages = Math.ceil(results.length / perPage);
    const pageItems = results.slice(0, perPage);
    const timeNow = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" });
    const embed = new EmbedBuilder().setColor(0x808080).setTitle("Finder Search Results")
      .setDescription(pageItems.map(f => `\`${f.filename}\` — ID: \`${f.id}\``).join("\n"))
      .setFooter({ text: `Pages 1/${totalPages} │ Today at ${timeNow}` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(totalPages <= 1)
    );
    const sent = await replyUser(msg, { embeds: [embed], components: [row] }).catch(() => {});
    if (sent) paginationMenus.set(msg.author.id, { results, page: 1, totalPages, messageId: sent.id, authorId: msg.author.id, createdAt: Date.now() });
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
