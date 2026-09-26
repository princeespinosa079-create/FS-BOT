const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits
} = require("discord.js");
const express = require("express");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const os = require("os");
const crypto = require("crypto");
// ============================================================
// ENV
// ============================================================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = "1302080645987569694";
const BUYER_ROLE_ID = "1553385966629158963";
const ALLOWED_CHANNEL_ID = "1553461663313829968"; // regular users can ONLY use commands here
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
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmp, jsonStr, "utf8");
    // Force flush to disk
    try {
      const fd = fs.openSync(tmp, "r+");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch {}
    fs
  .renameSync(tmp, file);
    // Verify file was written correctly
    const verify = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(data?.files) && Array.isArray(verify?.files)) {
      console.log(`💾 Saved ${path.basename(file)}: ${verify.files.length} files`);
    }
  } catch (e) {
    console.error(`❌ Saving ${path.basename(file)}:`, e.message);
    // Emergency: try direct write
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); } catch {}
  }
}
let config = readJSON(CONFIG_FILE, { allowedChannelId: null });
if (!config || typeof config !== "object") config = { allowedChannelId: null };
let library = readJSON(LIBRARY_FILE, { files: [] });
if (Array.isArray(library)) library = { files: library };
if (!Array.isArray(library.files)) library.files = [];

// ============================================================
// KEY SYSTEM (Premium Keys)
// ============================================================
const KEYS_FILE = path.join(DATA_DIR, "keys.json");
let keyStore = readJSON(KEYS_FILE, { keys: [] });
if (!Array.isArray(keyStore.keys)) keyStore.keys = [];

function parseDuration(str) {
  if (!str || str === "" || str === "infinite" || str === "0") return null;
  const match = String(str).match(/^(\d+)([smhdw])$/i);
  if (!match) return null;
  const num = parseInt(match[1]);
  const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return num * ms[match[2].toLowerCase()];
}
function generateKey() {
  return "PRINCE-" + crypto.randomBytes(10).toString("hex").toUpperCase();
}
function findActiveKeyForUser(userId) {
  return keyStore.keys.find(k =>
    k.redeemedBy === userId && (k.expiresAt === null || k.expiresAt > Date.now())
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
  if (changed) {
    const tmp = `${KEYS_FILE}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(keyStore, null, 2)); fs.renameSync(tmp, KEYS_FILE); } catch {}
  }
}
setInterval(cleanupExpiredKeys, 10 * 1000);

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
  fetch: 15,            // 15 seconds
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
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Channel],
});
const runningScans = new Set();
const paginationMenus = new Map();
const obfTemp = new Map(); // userId -> { source, fileName, isBuyerUser }
const whsWebhookUrls = new Map(); // messageId -> webhookUrl
const whsPanelOwners = new Map(); // messageId -> authorId
const altListMenus = new Map();
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

// Auto-role for alt accounts: remove all roles, add ALT role
async function applyAltRole(member) {
  if (!member || !member.roles) return;
  try {
    const ALT_ROLE_ID = "1537881754185113670";
    const rolesToRemove = member.roles.cache.filter(r => r.id !== member.guild.id);
    for (const [roleId] of rolesToRemove) {
      try { await member.roles.remove(roleId); } catch {}
    }
    try { await member.roles.add(ALT_ROLE_ID); } catch {}
    console.log("✅ Alt role applied to: " + member.user.tag);
  } catch (e) {
    console.error("Alt role error:", e.message);
  }
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
function channelAllowed(msg) {
  try {
    const chId = msg.channel?.id || msg.channelId || msg.channel_id;
    return String(chId) === String(ALLOWED_CHANNEL_ID);
  } catch (e) {
    return false;
  }
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
// Check if user has Server Tag (guild-specific avatar = server identity/profile)
function hasServerTag(member) {
  // Legacy wrapper — now checks status requirement
  return memberHasPrinceStatus(member);
}
// Check if guild supports Server Tag feature
function guildSupportsServerTag(guild) {
  if (!guild) return false;
  // Server Identity/Tag feature is available in all guilds that have it enabled
  // Check for common features that indicate server identity support
  const features = guild.features || [];
  return features.includes("GUILD_SERVER_GUIDE") || 
         features.includes("MEMBER_VERIFICATION_GATE_ENABLED") ||
         features.includes("NEWS") ||
         true; // Most modern guilds support server identity
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
    // Force-fetch to get latest server avatar data (no stale cache)
    try { member = await member.guild.members.fetch(member.id, { force: true }); } catch {}
    const hasStatus = memberHasPrinceStatus(member);
    const hasRole = member.roles.cache.has(PRINCE_ROLE_ID);
    console.log(`👑 Check ${member.user.tag}: hasStatus=${hasStatus} hasRole=${hasRole}`);
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
  try {
  // Owner → full bypass, can use ANYWHERE
  if (isOwner(msg.author.id)) {
    return { allowed: true, isBuyer: true, isOwner: true };
  }

  // Buyer → bypass cooldowns, can use in DMs
  if (await isBuyer(msg.author.id, msg.member)) {
    return { allowed: true, isBuyer: true };
  }

  const isDM = !msg.guild;

  // .help — works EVERYWHERE for EVERYONE
  if (/^\.help(?:\s|$)/i.test(txt)) {
    const page = 0;
    helpSessions.set(msg.author.id, page);
    const embed = EmbedBuilder.from(helpPages[page])
      .setFooter({ text: `Request by @${msg.author.username}│Help Menu`, iconURL: msg.author.displayAvatarURL({ dynamic: true, size: 128 }) });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`help_${msg.author.id}_prev`).setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`help_${msg.author.id}_next`).setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(helpPages.length === 1)
    );
    replyUser(msg, { embeds: [embed], components: [row] }).catch(() => {});
    return;
  }

  // .profile / .prof — works EVERYWHERE for EVERYONE
  if (/^\.profile(?:\s|$)|^\.prof(?:\s|$)/i.test(txt)) {
    let targetId = msg.author.id;
    const mention = msg.mentions.users.first();
    if (mention) targetId = mention.id;
    else {
      const idMatch = txt.match(/(\d{17,20})/);
      if (idMatch) targetId = idMatch[1];
    }
    const activeKey = findActiveKeyForUser(targetId);
    let displayName = `<@${targetId}>`;
    try {
      const u = await client.users.fetch(targetId);
      if (u) displayName = `@${u.username}`;
    } catch {}
    const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
    const embed = new EmbedBuilder()
      .setTitle("Profile Status")
      .setDescription(
`User: ${displayName} (\`${targetId}\`)
Key Active: ${activeKey ? "\`" + activeKey.key + "\`" : "❌ No active key"}`
      )
      .setColor(REGULAR_COLOR)
      .setFooter({ text: timeFooter });
    replyUser(msg, { embeds: [embed] }).catch(() => {});
    return;
  }

  // .generatekey — Owner Only
  if (/^\.generatekey(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const rest = txt.replace(/^\.generatekey\s+/i, "").trim();
    const parts = rest.split(/\s+/);
    const timeStr = parts[0] || "";
    const amountStr = parts[1] || "1";
    const durMs = parseDuration(timeStr);
    const amount = Math.max(1, Math.min(50, parseInt(amountStr) || 1));
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
    const tmp = `${KEYS_FILE}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(keyStore, null, 2)); fs.renameSync(tmp, KEYS_FILE); } catch {}
    const timeText = durMs === null ? "♾️ INFINITE" : `${timeStr}`;
    const keyList = generatedKeys.map(k => `\`${k}\``).join("\n");
    replyUser(msg, `✅ Generated ${amount} key(s) — ${timeText} expiry:\n${keyList}`).catch(() => {});
    return;
  }


  // .removekey — Owner Only (removes key + strips buyer role)
  if (/^\.removekey(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const key = txt.replace(/^\.removekey\s+/i, "").trim();
    if (!key) { replyUser(msg, "❌ usage: \`.removekey <key>\`").catch(() => {}); return; }
    const rec = keyStore.keys.find(k => k.key === key);
    if (!rec) { replyUser(msg, "❌ key not found.").catch(() => {}); return; }
    const redeemedBy = rec.redeemedBy;
    // Remove from keyStore
    keyStore.keys = keyStore.keys.filter(k => k.key !== key);
    const tmp = `${KEYS_FILE}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(keyStore, null, 2)); fs.renameSync(tmp, KEYS_FILE); } catch {}
    // Strip buyer role from user if redeemed
    if (redeemedBy) {
      try {
        const g = await client.guilds.fetch(GUILD_ID);
        const m = await g.members.fetch(redeemedBy);
        await m.roles.remove(BUYER_ROLE_ID);
        replyUser(msg, `✅ Key removed! Buyer role stripped from <@${redeemedBy}>.`).catch(() => {});
      } catch (e) {
        replyUser(msg, `✅ Key removed! (Failed to strip role: ${e.message.slice(0,80)})`).catch(() => {});
      }
    } else {
      replyUser(msg, `✅ Key removed! (was not redeemed yet)`).catch(() => {});
    }
    return;
  }

  // .redeem / .red — EVERYONE can use
  if (/^\.redeem(?:\s|$)|^\.red(?:\s|$)/i.test(txt)) {
    const key = txt.replace(/^\.redeem\s+|^\.red\s+/i, "").trim();
    if (!key) { replyUser(msg, "❌ Usage: \`.redeem <key>\`").catch(() => {}); return; }
    // Check if user already has active key
    if (findActiveKeyForUser(msg.author.id)) {
      replyUser(msg, "❌ you already got a key, lol.").catch(() => {});
      return;
    }
    const rec = keyStore.keys.find(k => k.key === key);
    if (!rec) { replyUser(msg, "❌ Invalid key.").catch(() => {}); return; }
    if (rec.redeemedBy || (rec.expiresAt !== null && rec.expiresAt < Date.now())) {
      replyUser(msg, "❌ this key was already redeem or expired.").catch(() => {});
      return;
    }
    rec.redeemedBy = msg.author.id;
    const tmp = `${KEYS_FILE}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(keyStore, null, 2)); fs.renameSync(tmp, KEYS_FILE); } catch {}
    try {
      const g = await client.guilds.fetch(GUILD_ID);
      const m = await g.members.fetch(msg.author.id);
      await m.roles.add(BUYER_ROLE_ID);
    } catch (e) {
      replyUser(msg, "❌ Key saved but failed to assign role: " + e.message).catch(() => {});
      return;
    }
    replyUser(msg, "✅ Key redeemed! Buyer role applied.").catch(() => {});
    return;
  }


  // Regular user in DMs → tell them to buy access
  if (isDM) {
    return { allowed: false, reason: "❌ buy access if you want to use the command here.", isBuyer: false };
  }

  // Cross-server check: must be in main guild
  if (msg.guild.id !== GUILD_ID) {
    const inMain = await isInMainGuild(msg.author.id);
    if (!inMain) {
      return { allowed: false, reason: "❌ join in main server first bro `.gg/TBBAUZu8cW`.", isBuyer: false };
    }
  }

  // If channel is restricted → SILENT (no response at all)
  if (!channelAllowed(msg)) {
    return { allowed: false, reason: null, silent: true, isBuyer: false };
  }

  // Status requirement — regular users MUST have .gg/TBBAUZu8cW in status
  const hasStatus = await hasPrinceStatus(msg.author.id);
  if (!hasStatus) {
    return { allowed: false, reason: "❌ put `.gg/TBBAUZu8cW` in your status first bro.", isBuyer: false };
  }
  if (needsFileReply && !isReplyingToFile(msg)) {
    return { allowed: false, reason: "❌ reply to a file or forwarded file, dumbass.", isBuyer: false };
  }

  return { allowed: true, isBuyer: false };
  } catch (e) {
    console.error("❌ checkRegularPermission error:", e.message);
    // Fail OPEN — don't block users on error
    return { allowed: true, isBuyer: false, error: e.message };
  }
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

// Detect obfuscator type and confidence
function detectObfuscator(src) {
  if (!src || typeof src !== "string") return { name: "Unknown", confidence: 0 };
  const s = src;
  let sc = {};
  sc.Luraph = 0; sc.WeAreDevs = 0; sc.Prometheus = 0; sc.Luarmor = 0;
  sc.PolSec = 0; sc["25ms"] = 0; sc.Moonveil = 0; sc["MoonSec V3"] = 0;
  sc.Solara = 0; sc.Hydrogen = 0; sc.Wave = 0; sc.Evon = 0;
  sc["Synapse X"] = 0; sc["Script-Ware"] = 0; sc.Krnl = 0; sc.Fluxus = 0;
  sc.Delta = 0; sc.Celery = 0; sc.Electron = 0; sc.Comet = 0;
  sc["Vega X"] = 0; sc.IronBrew = 0; sc.DarkEccentric = 0; sc.Axon = 0;
  sc.ProtoSmasher = 0; sc.Elysian = 0; sc.SirHurt = 0; sc.CocoZ = 0;
  sc.Zaptosis = 0; sc["Obfuscator.Lua"] = 0; sc.LuaMinify = 0;
  sc["Base64-Encoded"] = 0; sc["XOR-Encrypted"] = 0; sc.Bytecode = 0;
  sc["VM-Obfuscated"] = 0; sc.Unobfuscate = 0;
  
  // ── Luraph ──
  if (/Luraph|luraph/i.test(s)) sc.Luraph += 50;
  if (/\[=\[[\s\S]{200,}\]\]/.test(s)) sc.Luraph += 20;
  if (/loadstring\s*\(\s*[A-Za-z0-9+/=]{200,}\s*\)/.test(s)) sc.Luraph += 15;
  if (/setmetatable\s*\(\s*\{\s*\}\s*,\s*\{\s*__index/.test(s)) sc.Luraph += 10;
  
  // ── WeAreDevs ──
  if (/WeAreDevs|WAD_|wad_|wearedevs/i.test(s)) sc.WeAreDevs += 50;
  if (/--\s*\/\/?\s*WeAreDevs/i.test(s)) sc.WeAreDevs += 30;
  if (/M\s*\(\s*-?\d+\s*[+\-*]\s*-?\d+\s*\)/.test(s)) sc.WeAreDevs += 25;
  if (/local\s+[A-Za-z_]+\s*=\s*\{(?:"\{(?:\\.|[^"\\])*"\s*[,;]\s*){5,}/.test(s)) sc.WeAreDevs += 20;
  if (/\bz\s*\[\s*[A-Za-z_][A-Za-z0-9_]*\s*\]/.test(s)) sc.WeAreDevs += 15;
  if (/return\s*\(\s*function\s*\(/.test(s)) sc.WeAreDevs += 10;
  
  // ── Prometheus ──
  if (/Prometheus|prometheus/i.test(s)) sc.Prometheus += 50;
  if (/--\s*This file was generated using/i.test(s)) sc.Prometheus += 30;
  if (/loadstring\s*\(\s*function\s*\(\s*\)\s*return\s*["']/.test(s)) sc.Prometheus += 20;
  if (/string\.char\s*\(\s*\d+\s*(?:,\s*\d+\s*){5,}\)/.test(s)) sc.Prometheus += 15;
  if (/pcall\s*\(\s*loadstring/.test(s)) sc.Prometheus += 10;
  
  // ── Luarmor ──
  if (/Luarmor|luarmor/i.test(s)) sc.Luarmor += 50;
  if (/_G\s*\[\s*["']luarmor/i.test(s)) sc.Luarmor += 30;
  if (/string\.dump\s*\(/.test(s)) sc.Luarmor += 20;
  if (/luarmor\.net|luarmor\.gg/i.test(s)) sc.Luarmor += 20;
  
  // ── PolSec ──
  if (/PolSec|polsec/i.test(s)) sc.PolSec += 50;
  if (/polsec\.gg/i.test(s)) sc.PolSec += 30;
  if (/PolSecure|polsecure/i.test(s)) sc.PolSec += 20;
  
  // ── 25ms ──
  if (/\b25ms\b|25MS/.test(s)) sc["25ms"] += 50;
  if (/25ms\.to|25ms\.gg/i.test(s)) sc["25ms"] += 25;
  
  // ── Moonveil ──
  if (/Moonveil|moonveil/i.test(s)) sc.Moonveil += 50;
  if (/moonveil\.gg/i.test(s)) sc.Moonveil += 25;
  
  // ── MoonSec V3 ──
  if (/MoonSec|moonsec|MoonSec V3/i.test(s)) sc["MoonSec V3"] += 50;
  if (/moonsec\.net|moonsec\.gg/i.test(s)) sc["MoonSec V3"] += 25;
  
  // ── Solara ──
  if (/Solara|solara/i.test(s)) sc.Solara += 50;
  if (/solara\.gg|solara\.app/i.test(s)) sc.Solara += 25;
  
  // ── Hydrogen ──
  if (/Hydrogen|hydrogen/i.test(s)) sc.Hydrogen += 50;
  if (/hydrogen\.gg|hydrogen\.exe/i.test(s)) sc.Hydrogen += 25;
  
  // ── Wave ──
  if (/\bWave\b|wave\.exe/i.test(s)) sc.Wave += 45;
  
  // ── Evon ──
  if (/Evon|evon/i.test(s)) sc.Evon += 45;
  if (/evon\.gg/i.test(s)) sc.Evon += 25;
  
  // ── Synapse X ──
  if (/Synapse|synapse|Synapse X/i.test(s)) sc["Synapse X"] += 45;
  if (/syn\.|synapse\.cc/i.test(s)) sc["Synapse X"] += 25;
  
  // ── Script-Ware ──
  if (/Script-Ware|ScriptWare|script-ware/i.test(s)) sc["Script-Ware"] += 45;
  if (/sw\.|scriptware/i.test(s)) sc["Script-Ware"] += 20;
  
  // ── Krnl ──
  if (/Krnl|krnl/i.test(s)) sc.Krnl += 45;
  if (/krnl\.gg|krnl\.ca/i.test(s)) sc.Krnl += 25;
  
  // ── Fluxus ──
  if (/Fluxus|fluxus/i.test(s)) sc.Fluxus += 45;
  if (/fluxteam|fluxus\.gg/i.test(s)) sc.Fluxus += 25;
  
  // ── Delta ──
  if (/Delta|delta/i.test(s)) sc.Delta += 40;
  if (/delta\.gg|deltaexec/i.test(s)) sc.Delta += 25;
  
  // ── Celery ──
  if (/Celery|celery/i.test(s)) sc.Celery += 40;
  if (/celery\.gg|celeryexec/i.test(s)) sc.Celery += 25;
  
  // ── Electron ──
  if (/Electron|electron/i.test(s)) sc.Electron += 40;
  if (/electron\.gg/i.test(s)) sc.Electron += 25;
  
  // ── Comet ──
  if (/Comet|comet/i.test(s)) sc.Comet += 40;
  if (/comet\.gg/i.test(s)) sc.Comet += 25;
  
  // ── Vega X ──
  if (/Vega X|VegaX|vegax/i.test(s)) sc["Vega X"] += 40;
  if (/vegax\.gg/i.test(s)) sc["Vega X"] += 25;
  
  // ── More Obfuscators ──
  // ── IronBrew ──
  if (/IronBrew|ironbrew|IB2|IB_/i.test(s)) sc.IronBrew += 50;
  if (/ironbrew\.io/i.test(s)) sc.IronBrew += 25;
  
  // ── DarkEccentric ──
  if (/DarkEccentric|darkeccentric|DE_/i.test(s)) sc.DarkEccentric += 50;
  
  // ── Axon ──
  if (/\bAxon\b|axon\.exe/i.test(s)) sc.Axon += 45;
  
  // ── ProtoSmasher ──
  if (/ProtoSmasher|protosmasher/i.test(s)) sc.ProtoSmasher += 45;
  
  // ── Elysian ──
  if (/Elysian|elysian/i.test(s)) sc.Elysian += 45;
  
  // ── SirHurt ──
  if (/SirHurt|sirhurt/i.test(s)) sc.SirHurt += 45;
  
  // ── CocoZ ──
  if (/CocoZ|cocoz/i.test(s)) sc.CocoZ += 45;
  
  // ── Zaptosis ──
  if (/Zaptosis|zaptosis/i.test(s)) sc.Zaptosis += 45;
  
  // ── Obfuscator.Lua ──
  if (/Obfuscator\.Lua|obfuscator\.lua/i.test(s)) sc["Obfuscator.Lua"] += 45;
  
  // ── LuaMinify ──
  if (/luamin|lua_min|minified\slua/i.test(s)) sc.LuaMinify += 35;
  
  // ── Base64-Encoded ──
  if (/loadstring\s*\(\s*game:HttpGet.*base64|base64decode|base64_decode/i.test(s)) sc["Base64-Encoded"] += 35;
  
  // ── XOR-Encrypted ──
  if (/xor\s*\(|bit\.bxor|string\.char\s*\(\s*\d+\s*%/i.test(s)) sc["XOR-Encrypted"] += 30;
  
  // ── Bytecode ──
  if (/string\.dump|loadstring\s*\(\s*\\x/i.test(s)) sc.Bytecode += 40;
  if (/\\x[0-9a-fA-F]{2}.*\\x[0-9a-fA-F]{2}.*\\x[0-9a-fA-F]{2}/.test(s)) sc.Bytecode += 20;
  
  // ── VM-Obfuscated (general fallback) ──
  let vmScore = 0;
  if (/loadstring\s*\(/.test(s)) vmScore += 10;
  if (/\\x[0-9a-fA-F]{2}/.test(s)) vmScore += 10;
  if (/string\.char\s*\(/.test(s)) vmScore += 10;
  if (/setmetatable|getmetatable/.test(s)) vmScore += 5;
  if (/pcall\s*\(|xpcall\s*\(/.test(s)) vmScore += 5;
  if (/\bassert\s*\(/.test(s)) vmScore += 5;
  sc["VM-Obfuscated"] = vmScore;
  
  // ── Unobfuscate (clean script) ──
  const allObfScores = Object.values(sc).reduce((a, b) => a + b, 0) - (sc.Unobfuscate || 0);
  if (allObfScores < 15) {
    if (/function\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(s)) sc.Unobfuscate += 25;
    if (/--\s*\[/.test(s)) sc.Unobfuscate += 10;
    if (/local\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=/.test(s) && !/local\s+[A-Za-z_]+\s*=\s*\{/.test(s)) sc.Unobfuscate += 10;
    if (/print\s*\(|warn\s*\(|error\s*\(/.test(s)) sc.Unobfuscate += 5;
  }
  
  // Cap scores
  for (const k of Object.keys(sc)) sc[k] = Math.min(sc[k], 100);
  
  // Sort and return best
  const entries = Object.entries(sc).map(([name, score]) => ({ name, score }));
  entries.sort((a, b) => b.score - a.score);
  
  const best = entries[0];
  if (best.score < 15) return { name: "Unknown", confidence: 0 };
  return { name: best.name, confidence: best.score };
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
  const f = library.files.find(file => file.id === String(id || "").trim()) || null;
  if (f && Number(f.size || 0) === 36) return null; // skip unavailable placeholder files
  return f;
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
  return library.files
    .filter(file => Number(file.size || 0) !== 36) // skip unavailable placeholder files
    .map(file => {
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
          // Skip files that are unavailable (exactly 36 bytes = Discord unavailable placeholder)
          if (fileSize === 36) continue;
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
  if (typeof text !== "string") { try { text = String(text); } catch { return ""; } }
  var trimmed = text.trim();
  if (!trimmed) return text;

  var linesArr;
  try { linesArr = trimmed.split(/\r?\n/); } catch { linesArr = [trimmed]; }
  if (!linesArr || !linesArr.length) return text;

  var cleaned = [];

  // IP logger/grabber domains
  var ipGrabberDomains = ["iplogger.org","iplogger.com","grabify.link","grabify.xyz","nipiscan.com","spiderip.com","blasze.tk","blasze.com","ip-api.com","ipify.org","icanhazip.com","ifconfig.co","ifconfig.me","whatismyip.com","ipinfo.io","ipgeolocation.io","freegeoip.net","freegeoip.app","checkip.amazonaws.com","bit.ly","tinyurl.com","is.gd","t.co","ow.ly","rb.gy","cutt.ly","bc.vc","adf.ly","linkvertise.com","shorte.st","bcvc.one","pornhub.com","discord.media","iplogger","grabify","logmyip","ipgrabber","stealip","ip-logger","ipgrab","iplog","logger","grabip","trackip","ip-tracker","ip-trace","ipgrabbed","iplogged","ip-logger","ip-grabber"];

  function isGrabber(text) {
    if (!text) return false;
    for (var i = 0; i < ipGrabberDomains.length; i++) {
      if (text.indexOf(ipGrabberDomains[i]) !== -1) return true;
    }
    return false;
  }

  function isSafeUrl(text) {
    if (!text) return false;
    try { if (/discord\.(gg|com\/invite)\//i.test(text)) return true; } catch {}
    try { if (/files\.catbox\.moe\//i.test(text)) return true; } catch {}
    try { if (/rbxassetid:\/\/\d+/i.test(text)) return true; } catch {}
    try { if (/rbxthumb:\/\//i.test(text)) return true; } catch {}
    return false;
  }

  // Script loader patterns
  var loaderPatterns = [
    /loadstring\s*\([^)]*\)\s*\(\s*\)/gi,
    /loadstring\s*\([^)]*\)/gi,
    /game\s*:\s*HttpGet\s*\([^)]*\)/gi,
    /HttpService\s*:\s*GetAsync\s*\([^)]*\)/gi,
    /syn\s*\.\s*request\s*\([^)]*\)/gi,
    /http\s*\.\s*get\s*\([^)]*\)/gi,
    /pcall\s*\(\s*loadstring[^)]*\)/gi,
    /xpcall\s*\(\s*loadstring[^)]*\)/gi,
    /identifyexecutor\s*\([^)]*\)/gi,
    /load\s*\([^)]+\)/gi,
    /require\s*\(\s*["']https?:\/\/[^"']+["']\s*\)/gi,
    /socket\s*\.\s*(connect|tcp|udp)\s*\(/gi,
  ];

  function hasLoader(text) {
    if (!text) return false;
    for (var i = 0; i < loaderPatterns.length; i++) {
      try { if (loaderPatterns[i].test(text)) return true; } catch {}
    }
    return false;
  }

  // Junk/obfuscation patterns (Luraph-style)
  var junkPatterns = [
    /["'][A-Za-z0-9]{2,6}["']\s*\/\s*\(\s*\d+\s*-\s*["'][A-Za-z0-9]{3,8}["']\s*\^\s*\d+/,
    /return\s+["'][A-Za-z0-9]{2,6}["']\s*\/\s*\(/,
    /local\s+[a-z]\d*\s*=\s*random\(/,
    /local\s+[a-z]\d*\s*=\s*math\.random\(/,
    /local\s+[a-z]\d*\s*=\s*gmatch/,
    /local\s+_\s*=\s*table\.concat/,
    /local\s+[a-z]\d*\s*=\s*unpack/,
    /local\s+[a-z]\d*\s*=\s*table\.unpack/,
    /error\(["'][A-Za-z0-9]+["']\s*,\s*0\)/,
    /You Are Lost/,
    /local\s+[a-z]+\d*\s*=\s*random\(\d+,\s*\d+\)\s*==\s*1/,
    /\^\s*\d{5,}/,
    /:\(%d*\):/,
    // More aggressive: simple junk aliases
    /^\s*local\s+[a-z]\d*\s*=\s*[a-z]+\.?[a-z]*\d*\s*$/,  // local v1 = string.gmatch
    /^\s*local\s+[a-z]\d*\s*=\s*(true|false|0|nil|{})\s*$/,  // local u2 = true
    /^\s*local\s+[a-z]\d*\s*=\s*[a-z]+\d*\s*or\s+[a-z]+\.?[a-z]*\d*/,  // local v1 = unpack or table.unpack
    /local\s+[a-z]\d*\s*=\s*tonumber\(.*tostring/,  // local num = tonumber(v5(tostring(...)))
    /tostring\(result\)/,  // junk parsing
    /local\s+[a-z]\d*\s*=\s*\{\s*pcall\(function/,  // local t2 = { pcall(function()
    /if\s+not\s+pcall\(function\(\)\s*$/,  // if not pcall(function()
    /if\s+[a-z]\d*\s+then\s*$/,  // if v19 then
    /[a-z]\d*\s*=\s*[a-z]\d*\s*and\s+[a-z]\d*/,  // u2 = u2 and t2[1]
    /[a-z]\d*\s*=\s*\([a-z]\d*\s*\+\s*[a-z]\d*\)\s*%\s*256/,  // n1 = (n1 + t2[...]) % 256
    /repeat\s+task\.wait\(\)\s+until\s+game:IsLoaded\(\)/,  // keep this, it's real
  ];

  function isJunkLine(text) {
    if (!text) return false;
    for (var i = 0; i < junkPatterns.length; i++) {
      try { if (junkPatterns[i].test(text)) return true; } catch {}
    }
    return false;
  }

  var luaKw = ["local","function","if","then","end","return","for","while","repeat","until","do","print","warn","game","workspace","script","Players","Instance","Vector3","CFrame","Color3","UDim2","Enum","task","spawn","pcall","xpcall","require","loadstring","getgenv","gethui","hookfunction","hookmetamethod","getrawmetatable","setreadonly","getnamecallmethod","getconnections","firesignal","fireclickdetector","getobjects","isnetworkowner","setclipboard","writefile","readfile","listfiles","isfolder","makefolder","delfolder","delfile","loadfile","dofile","TweenService","UserInputService","RunService","ReplicatedStorage","StarterGui","CoreGui","Lighting","TeleportService","MarketplaceService","HttpService","InsertService","Selection","RbxUtility","MegaMorph","Valkyrie","Synapse","ScriptWare","KRNL","Fluxus","Delta","Hydrogen","Codex","Wave"];

  function isLuaLine(text) {
    if (!text) return false;
    for (var i = 0; i < luaKw.length; i++) {
      if (text.indexOf(luaKw[i]) !== -1) return true;
    }
    if (/=|==|~=|<=|>=|<|>/.test(text)) return true;
    if (/\(|\)|\{|\}/.test(text)) return true;
    if (/local\s+\w+/.test(text)) return true;
    if (/function\s*\(/.test(text)) return true;
    if (/:\w+\(/.test(text)) return true;
    return false;
  }

  for (var li = 0; li < linesArr.length; li++) {
    var raw = linesArr[li];
    if (raw === null || raw === undefined) continue;
    var originalLine = String(raw);
    var t = originalLine.trim();
    if (!t) { cleaned.push(""); continue; }

    // 1. DELETE comment lines (keep if safe discord invite)
    if (t.indexOf("--") === 0) {
      if (!isSafeUrl(t)) continue;
    }

    // 2. DELETE IP logger/grabber lines
    if (isGrabber(t)) continue;

    // 3. DELETE script loader lines
    if (hasLoader(t)) continue;

    // 4. DELETE junk/obfuscation lines (anti-tamper, Luraph-style)
    if (isJunkLine(t)) continue;

    // 5. DELETE scrambled/garbage (not Lua)
    if (!isLuaLine(t) && t.length > 3) {
      if (!/\s/.test(t) && t.length > 20 && !/^https?:\/\//.test(t)) {
        if (!isSafeUrl(t) && !/^["'].*["']$/.test(t)) continue;
      }
    }

    // 6. Remove inline comments (preserve indent)
    var inStrS = false, inStrD = false;
    var cutAt = -1;
    for (var ci = 0; ci < originalLine.length - 1; ci++) {
      var c = originalLine.charAt(ci), nx = originalLine.charAt(ci + 1);
      if (c === "\\" && (inStrS || inStrD)) { ci++; continue; }
      if (c === '"' && !inStrS) inStrD = !inStrD;
      if (c === "'" && !inStrD) inStrS = !inStrS;
      if (!inStrS && !inStrD && c === "-" && nx === "-") { cutAt = ci; break; }
    }
    var lineToKeep = originalLine;
    if (cutAt >= 0) lineToKeep = originalLine.substring(0, cutAt).replace(/\s+$/, "");
    if (!lineToKeep.trim()) continue;

    // 7. Remove any remaining loader code inline
    for (var pi = 0; pi < loaderPatterns.length; pi++) {
      try { lineToKeep = lineToKeep.replace(loaderPatterns[pi], ""); } catch {}
    }
    if (!lineToKeep.trim() || lineToKeep.trim().length < 3) continue;
    if (/^[\s();,{}]+$/.test(lineToKeep.trim())) continue;

    // 8. Change ALL print/warn to leak message
    try {
      lineToKeep = lineToKeep.replace(/\bprint\s*\([^)]*\)/g, 'print("prince")');
      lineToKeep = lineToKeep.replace(/\bwarn\s*\([^)]*\)/g, 'print("prince")');
    } catch {}

    // 9. Replace Discord invites
    try {
      lineToKeep = lineToKeep.replace(/(https?:\/\/)?discord\.(gg|com\/invite)\/[a-zA-Z0-9-]+/gi, "https://discord.gg/TBBAUZu8cW");
    } catch {}

    if (!lineToKeep.trim()) continue;
    cleaned.push(lineToKeep);
  }

  var result = cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return result || "";
}


// GOOFYSCATOR Obfuscator
// ============================================================
function goofyscator(source, settings) {
  const s = settings || {};
  let out = source;
  
  // Helper: random string generator
  const randStr = (len) => {
    const c = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let r = "_";
    for (let i = 0; i < len; i++) r += c[Math.floor(Math.random() * c.length)];
    return r;
  };
  
  // Helper: XOR encrypt a string
  const xorStr = (str, key) => {
    let result = [];
    for (let i = 0; i < str.length; i++) {
      result.push(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result.join(",");
  };
  
  // encryptStrings: Find and encrypt string literals
  if (s.encryptStrings !== false) {
    const key = randStr(8);
    out = out.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g, (match) => {
      const inner = match.slice(1, -1);
      if (inner.length < 2) return match;
      const encrypted = xorStr(inner, key);
      return `(function() local k="${key}" local e={${encrypted}} local r="" for i=1,#e do r=r..string.char(bit.bxor(e[i],k:byte((i-1)%#k+1))) end return r end)()`;
    });
  }
  
  // proxifyLocals: Wrap local declarations
  if (s.proxifyLocals !== false) {
    const proxyName = randStr(6);
    out = `local ${proxyName} = setmetatable({}, {__index = function(_,k) return rawget(_G,k) end, __newindex = function(_,k,v) rawset(_G,k,v) end})\n` + out;
    out = out.replace(/\blocal\s+(\w+)/g, (m, name) => {
      if (name === proxyName) return m;
      return m;
    });
  }
  
  // proxifyFunctions: Wrap function calls
  if (s.proxifyFunctions !== false) {
    const funcProxy = randStr(6);
    out = `local ${funcProxy} = function(f,...) return f(...) end\n` + out;
  }
  
  // antiTamper: Add anti-edit check
  if (s.antiTamper !== false) {
    const tamperCheck = `-- Anti-Tamper\nlocal _orig = checkcaller or function() return true end\nif not _orig() then error("Tampered") end\n`;
    out = tamperCheck + out;
  }
  
  // controlFlowFlattening: Basic control flow flattening with switch
  if (s.controlFlowFlattening !== false) {
    const dispatcher = randStr(6);
    const lines = out.split("\n");
    if (lines.length > 3) {
      const wrapped = [];
      wrapped.push(`local ${dispatcher} = 1`);
      wrapped.push(`while true do`);
      wrapped.push(`  if ${dispatcher} == 1 then`);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) {
          wrapped.push(`    ${lines[i]}`);
          if (i < lines.length - 1) {
            wrapped.push(`    ${dispatcher} = ${i + 2}`);
            wrapped.push(`  elseif ${dispatcher} == ${i + 2} then`);
          }
        }
      }
      wrapped.push(`  else break end`);
      wrapped.push(`end`);
      out = wrapped.join("\n");
    }
  }
  
  // loaderVMDepth: Nest in VM loaders
  const depth = s.loaderVMDepth || 1;
  for (let i = 0; i < depth; i++) {
    const vmKey = randStr(10);
    const encoded = Buffer.from(out, "utf8").toString("base64");
    out = `-- Goofyscator Layer ${i + 1}\nlocal ${vmKey} = loadstring(game:HttpGet and game:HttpGet("") or "${encoded}") or loadstring(require(game:GetService("HttpService")).Base64Decode("${encoded}"))()\n`;
  }
  
  return out;
}
// ============================================================
// LUA OBFUSCATOR (Prince Obfuscator — Luarmor/Luraph style)
// ============================================================
function obfuscateLua(source) {
  if (!source || typeof source !== "string") return source;
  const crypto = require("crypto");
  
  const XOR_KEY = crypto.randomBytes(16).toString("hex");
  const randStr = (len) => crypto.randomBytes(len).toString("hex").slice(0, len);
  
  const usedNames = new Set();
  const genName = () => {
    let n;
    do { n = "_" + randStr(6 + Math.floor(Math.random() * 6)); } while (usedNames.has(n));
    usedNames.add(n);
    return n;
  };
  
  const encryptStr = (str, key) => {
    let out = [];
    for (let i = 0; i < str.length; i++) {
      out.push(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return Buffer.from(new Uint8Array(out)).toString("base64");
  };
  
  // Step 1: Encrypt strings
  const stringTable = [];
  let code = source.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g, (m) => {
    const inner = m.slice(1, -1);
    if (inner.length < 2) return m;
    const idx = stringTable.length;
    stringTable.push(encryptStr(inner, XOR_KEY));
    return genName() + "[" + idx + "]";
  });
  
  // Step 2: Scramble local vars
  const varMap = new Map();
  code = code.replace(/\blocal\s+(function\s+)?([a-zA-Z_]\w*)/g, (m, isFunc, name) => {
    const reserved = ["string","math","table","io","os","debug","pcall","xpcall","pairs","ipairs","type","tostring","tonumber","loadstring","load","setfenv","getfenv","setmetatable","getmetatable","rawget","rawset","next","error","warn","print","select","unpack","require","game","workspace","script","bit","bit32"];
    if (reserved.includes(name) || varMap.has(name)) return m;
    varMap.set(name, genName());
    return isFunc ? "local function " + varMap.get(name) : "local " + varMap.get(name);
  });
  for (const [old, n] of varMap) {
    const re = new RegExp("\\b" + old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g");
    code = code.replace(re, n);
  }
  
  // Step 3: Encode entire code as base64 (simple, works in Roblox)
  const encoded = Buffer.from(code, "utf8").toString("base64");
  
  // Step 4: Generate VM variable names
  const v_key = genName(), v_tab = genName(), v_dec = genName();
  const v_b64 = genName(), v_dec2 = genName(), v_env = genName();
  const v_fn = genName(), v_s = genName(), v_k = genName(), v_r = genName();
  const v_i = genName();
  
  const tableStr = "{" + stringTable.map(s => '"' + s + '"').join(",") + "}";
  
  // Build Roblox-compatible output
  // Uses bit32.bxor, proper base64 decode via HttpService pattern
  const header = "-- This file was generated using Prince Obfuscator\n";
  
  const output = header +
    "local " + v_key + '="' + XOR_KEY + '"\n' +
    "local " + v_tab + "=" + tableStr + "\n" +
    "local " + v_dec + "=function(" + v_s + "," + v_k + ")local " + v_r + '=""for ' + v_i + "=1,#" + v_s + "do " + v_r + "=" + v_r + "..string.char(bit32.bxor(" + v_s + ":byte(" + v_i + ")," + v_k + ":byte((" + v_i + "-1)%" + "#" + v_k + "+1)))end return " + v_r + " end\n" +
    "local " + v_b64 + '="' + encoded + '"\n' +
    "local " + v_dec2 + "=function(s)local b='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'local r=''s=s:gsub('[^A-Za-z0-9%+%/]','')for i=1,#s,4 do local a,b,c,d=b:find(s:sub(i,i)),b:find(s:sub(i+1,i+1))or 1,b:find(s:sub(i+2,i+2))or 1,b:find(s:sub(i+3,i+3))or 1 a=a-1 b=b-1 c=c-1 d=d-1 r=r..string.char(bit32.band(bit32.rshift(bit32.lshift(a,2),2)+bit32.rshift(b,4),255)) if s:sub(i+2,i+2)~='=' then r=r..string.char(bit32.band(bit32.lshift(bit32.band(b,15),4)+bit32.rshift(c,2),255)) end if s:sub(i+3,i+3)~='=' then r=r..string.char(bit32.band(bit32.lshift(bit32.band(c,3),6)+d,255)) end end return r end\n" +
    "local " + v_env + "=setmetatable({},{__index=function(t,k)return _G[k]end})\n" +
    "v_env[" + v_dec + "]=" + v_dec + "\n" +
    "local " + v_fn + "=loadstring(" + v_dec2 + "(" + v_b64 + "))\n" +
    "if " + v_fn + " then setfenv(" + v_fn + "," + v_env + ") return " + v_fn + "(...) end";
  
  return output;
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
    .toJSON()
].map(c => c);
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


client.on("error", e => console.error("❌ Discord error:", e));
client.on("warn", w => console.warn("⚠️ Discord warn:", w));

// ============================================================
// HELP MENU PAGES
// ============================================================
const YELLOW_COLOR = 0xF1C40F;
const helpPages = [
  new EmbedBuilder()
    .setTitle("Help Menu")
    .setColor(REGULAR_COLOR)
    .setDescription(
`**\`.rename\`** [\`.rn\`] Remove comments, IP loggers, script loaders.

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

> Premium users can use all commands in DMs.
> Premium users bypass cooldown.`
    )
];
const helpSessions = new Map();

// ============================================================
// BUTTON HANDLER
// ============================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  const uid = interaction.user.id;
  // ─── HELP PAGINATION BUTTONS ───
  if (interaction.customId?.startsWith("help_")) {
    const parts = interaction.customId.split("_");
    const uid = parts[1];
    const dir = parts[2];
    if (interaction.user.id !== uid) {
      return interaction.reply({ content: "❌ not yours, do `.help` so you can have yours.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    let page = helpSessions.get(uid) || 0;
    if (dir === "prev") page = Math.max(0, page - 1);
    if (dir === "next") page = Math.min(helpPages.length - 1, page + 1);
    helpSessions.set(uid, page);
    const embed = EmbedBuilder.from(helpPages[page])
      .setFooter({ text: `Request by @${interaction.user.username}│Help Menu`, iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 128 }) });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`help_${uid}_prev`).setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`help_${uid}_next`).setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(page === helpPages.length - 1)
    );
    await interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
    return;
  }
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
// ─── ALTLIST PAGINATION BUTTONS ───
if (interaction.customId === "alt_prev" || interaction.customId === "alt_next") {
  if (!altListMenus.has(uid)) {
    return interaction.reply({ content: "⏳ scan expired bro, run `.altlist` again.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const altMenu = altListMenus.get(uid);
  if (Date.now() - altMenu.createdAt > EXPIRY_MS) {
    altListMenus.delete(uid);
    return interaction.reply({ content: "⏳ scan expired bro, run `.altlist` again.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (interaction.message.id !== altMenu.messageId) return;
  if (interaction.user.id !== altMenu.authorId) {
    return interaction.reply({ content: "❌ not yours, run `.altlist` so you can have yours.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (interaction.customId === "alt_prev") altMenu.page--;
  if (interaction.customId === "alt_next") altMenu.page++;
  if (altMenu.page < 1) altMenu.page = 1;
  if (altMenu.page > altMenu.totalPages) altMenu.page = altMenu.totalPages;
  const altStart = (altMenu.page - 1) * 5;
  const altPageItems = altMenu.results.slice(altStart, altStart + 5);
  const altLines = altPageItems.map((s, i) => {
    const idx = altStart + i + 1;
    const riskLevel = s.score >= 50 ? "🔴 HIGH" : s.score >= 35 ? "🟠 MED" : "🟡 LOW";
    const createdDate = new Date(s.created).toLocaleDateString("en-US");
    return `**${idx}.** ${s.member.user.tag} <@${s.member.id}>\n   ${riskLevel} | Score: \`${s.score}\` | Created: ${createdDate}\n   ${s.flags.join(" │ ")}`;
  });
  const altEmbed = new EmbedBuilder()
    .setColor(0x2B2D31)
    .setTitle(`🔍 Suspicious Accounts — ${altMenu.results.length} found`)
    .setDescription(altLines.join("\n\n"))
    .setFooter({ text: `Page ${altMenu.page}/${altMenu.totalPages} │ ${altMenu.guildName} │ ${altMenu.memberCount} total members` });
  const altRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("alt_prev").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(altMenu.page <= 1),
    new ButtonBuilder().setCustomId("alt_next").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(altMenu.page >= altMenu.totalPages)
  );
  await interaction.update({ embeds: [altEmbed], components: [altRow] }).catch(() => {});
  altListMenus.set(uid, altMenu);
  return;
}
  // ─── FINDER PAGINATION BUTTONS ───
  if (interaction.customId === "prev_page" || interaction.customId === "next_page") {
    if (!paginationMenus.has(uid)) {
      return interaction.reply({ content: "❌ not yours, do `.find` so you can have yours.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const menu = paginationMenus.get(uid);
    if (Date.now() - menu.createdAt > EXPIRY_MS) {
      paginationMenus.delete(uid);
      return interaction.reply({ content: "❌ not yours, do `.find` so you can have yours.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (interaction.message.id !== menu.messageId) return;
    if (interaction.user.id !== menu.authorId) {
      return interaction.reply({ content: "❌ not yours, do `.find` so you can have yours.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (interaction.customId === "prev_page") menu.page--;
    if (interaction.customId === "next_page") menu.page++;
    if (menu.page < 1) menu.page = 1;
    if (menu.page > menu.totalPages) menu.page = menu.totalPages;
    const start = (menu.page - 1) * 8;
    const pageItems = menu.results.slice(start, start + 8);
    const timeNow = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" });
    const embed = new EmbedBuilder()
      .setColor(REGULAR_COLOR)
      .setTitle(getFinderTitle(menu.isBuyer))
      .setDescription(pageItems.map(f => `\`${f.filename}\` — ID: \`${f.id}\``).join("\n"))
      .setFooter({ text: `Pages ${menu.page}/${menu.totalPages} │ Today at ${timeNow}` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(menu.page <= 1),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(menu.page >= menu.totalPages)
    );
    await interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
    paginationMenus.set(uid, menu);
    return;
  }
  // ─── WHS START BUTTON ───
  if (interaction.customId === "whs_start") {
    if (!interaction.member) {
      return interaction.reply({ content: "❌ use in server.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    // Only the person who ran .whs can click Start
    const ownerId = whsPanelOwners.get(interaction.message.id);
    if (ownerId && interaction.user.id !== ownerId) {
      return interaction.reply({ content: "❌ not yours, bro.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    
    // Build modal
    const modal = new ModalBuilder()
      .setCustomId("whs_modal")
      .setTitle("Webhook Spammer");
    
    const urlInput = new TextInputBuilder()
      .setCustomId("whs_url")
      .setLabel("Webhook URL")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("The Webhook URL...")
      .setRequired(true);
    
    const msgInput = new TextInputBuilder()
      .setCustomId("whs_message")
      .setLabel("Spam Message")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Your message...")
      .setRequired(true);
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(urlInput),
      new ActionRowBuilder().addComponents(msgInput)
    );
    
    // Show modal FIRST — this is critical, must happen before any reply/update
    await interaction.showModal(modal).catch(() => {});
    
    // Then disable the button separately (doesn't consume the interaction)
    try {
      const disabledRow = new ActionRowBuilder().addComponents(
        ButtonBuilder.from(interaction.message.components[0].components[0])
          .setDisabled(true)
      );
      await interaction.message.edit({ components: [disabledRow] }).catch(() => {});
    } catch {}
    
    return;
  }

});

// ============================================================

// ============================================================
// MODAL SUBMIT HANDLER — Robux ticket creation
// ============================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId === "whs_modal") {
    const webhookUrl = interaction.fields.getTextInputValue("whs_url");
    const spamMsg = interaction.fields.getTextInputValue("whs_message");
    const avatarURL = interaction.user.displayAvatarURL({ dynamic: true, size: 128 });
    
    // Quick webhook validation
    const probe = await fetch(webhookUrl, { method: "GET" }).catch(() => null);
    if (!probe || probe.status === 404) {
      return interaction.reply({ content: "❌ Not Found.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    
    let sent = 0, failed = 0;
    const maxMessages = 200;
    
    for (let i = 0; i < maxMessages; i++) {
      const contentMsg = spamMsg;
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: contentMsg })
        });
        if (res.status === 204) sent++;
        else if (res.status === 429) {
          try {
            const rl = await res.json();
            await new Promise(r => setTimeout(r, Math.min((rl.retry_after || 0.5) * 1000, 1000)));
          } catch {}
        } else failed++;
      } catch { failed++; }
      await new Promise(r => setTimeout(r, 30));
    }
    
    const resultEmbed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setTitle("Webhook Raid Complete")
      .setDescription(`✅ **Sent:** ${sent}\n❌ **Failed:** ${failed}\n🌐 **Status:** Done`)
      .setFooter({ text: `Request by @${interaction.user.username}│Webhook Spammer`, iconURL: avatarURL });
    
    const removeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("whs_remove")
        .setLabel("Remove")
        .setStyle(ButtonStyle.Danger)
    );
    
    // Use followUp to ensure components show properly
    // Store webhook URL for Remove button handler
    const resultMsg = await interaction.followUp({ 
      embeds: [resultEmbed], 
      components: [removeRow], 
      flags: MessageFlags.Ephemeral 
    }).catch(() => {});
    if (resultMsg) {
      whsWebhookUrls.set(resultMsg.id, webhookUrl);
      // Auto-cleanup after 1 hour
      setTimeout(() => whsWebhookUrls.delete(resultMsg.id), 60 * 60 * 1000);
    }
    return;
  }
});

// ============================================================
// WHS REMOVE BUTTON HANDLER
// ============================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId === "whs_remove") {
    const webhookUrl = whsWebhookUrls.get(interaction.message.id);
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, { method: "DELETE" });
      } catch {}
      whsWebhookUrls.delete(interaction.message.id);
    }
    await interaction.message.delete().catch(() => {});
    return interaction.reply({ content: "✅ Webhook removed.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
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
          .setColor(REGULAR_COLOR)
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

  // .help — works EVERYWHERE for EVERYONE
  if (/^\.help(?:\s|$)/i.test(txt)) {
    const page = 0;
    helpSessions.set(msg.author.id, page);
    const embed = EmbedBuilder.from(helpPages[page])
      .setFooter({ text: `Request by @${msg.author.username}│Help Menu`, iconURL: msg.author.displayAvatarURL({ dynamic: true, size: 128 }) });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`help_${msg.author.id}_prev`).setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`help_${msg.author.id}_next`).setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(helpPages.length === 1)
    );
    replyUser(msg, { embeds: [embed], components: [row] }).catch(() => {});
    return;
  }

  // .profile / .prof — works EVERYWHERE for EVERYONE
  if (/^\.profile(?:\s|$)|^\.prof(?:\s|$)/i.test(txt)) {
    let targetId = msg.author.id;
    const mention = msg.mentions.users.first();
    if (mention) targetId = mention.id;
    else {
      const idMatch = txt.match(/(\d{17,20})/);
      if (idMatch) targetId = idMatch[1];
    }
    const activeKey = findActiveKeyForUser(targetId);
    let displayName = `<@${targetId}>`;
    try {
      const u = await client.users.fetch(targetId);
      if (u) displayName = `@${u.username}`;
    } catch {}
    const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
    const embed = new EmbedBuilder()
      .setTitle("Profile Status")
      .setDescription(
`User: ${displayName} (\`${targetId}\`)
Key Active: ${activeKey ? "\`" + activeKey.key + "\`" : "❌ No active key"}`
      )
      .setColor(REGULAR_COLOR)
      .setFooter({ text: timeFooter });
    replyUser(msg, { embeds: [embed] }).catch(() => {});
    return;
  }

  // .generatekey — Owner Only
  if (/^\.generatekey(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const rest = txt.replace(/^\.generatekey\s+/i, "").trim();
    const parts = rest.split(/\s+/);
    const timeStr = parts[0] || "";
    const amountStr = parts[1] || "1";
    const durMs = parseDuration(timeStr);
    const amount = Math.max(1, Math.min(50, parseInt(amountStr) || 1));
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
    const tmp = `${KEYS_FILE}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(keyStore, null, 2)); fs.renameSync(tmp, KEYS_FILE); } catch {}
    const timeText = durMs === null ? "♾️ INFINITE" : `${timeStr}`;
    const keyList = generatedKeys.map(k => `\`${k}\``).join("\n");
    replyUser(msg, `✅ Generated ${amount} key(s) — ${timeText} expiry:\n${keyList}`).catch(() => {});
    return;
  }


  // .removekey — Owner Only (removes key + strips buyer role)
  if (/^\.removekey(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const key = txt.replace(/^\.removekey\s+/i, "").trim();
    if (!key) { replyUser(msg, "❌ usage: \`.removekey <key>\`").catch(() => {}); return; }
    const rec = keyStore.keys.find(k => k.key === key);
    if (!rec) { replyUser(msg, "❌ key not found.").catch(() => {}); return; }
    const redeemedBy = rec.redeemedBy;
    // Remove from keyStore
    keyStore.keys = keyStore.keys.filter(k => k.key !== key);
    const tmp = `${KEYS_FILE}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(keyStore, null, 2)); fs.renameSync(tmp, KEYS_FILE); } catch {}
    // Strip buyer role from user if redeemed
    if (redeemedBy) {
      try {
        const g = await client.guilds.fetch(GUILD_ID);
        const m = await g.members.fetch(redeemedBy);
        await m.roles.remove(BUYER_ROLE_ID);
        replyUser(msg, `✅ Key removed! Buyer role stripped from <@${redeemedBy}>.`).catch(() => {});
      } catch (e) {
        replyUser(msg, `✅ Key removed! (Failed to strip role: ${e.message.slice(0,80)})`).catch(() => {});
      }
    } else {
      replyUser(msg, `✅ Key removed! (was not redeemed yet)`).catch(() => {});
    }
    return;
  }

  // .redeem / .red — EVERYONE can use
  if (/^\.redeem(?:\s|$)|^\.red(?:\s|$)/i.test(txt)) {
    const key = txt.replace(/^\.redeem\s+|^\.red\s+/i, "").trim();
    if (!key) { replyUser(msg, "❌ Usage: \`.redeem <key>\`").catch(() => {}); return; }
    // Check if user already has active key
    if (findActiveKeyForUser(msg.author.id)) {
      replyUser(msg, "❌ you already got a key, lol.").catch(() => {});
      return;
    }
    const rec = keyStore.keys.find(k => k.key === key);
    if (!rec) { replyUser(msg, "❌ Invalid key.").catch(() => {}); return; }
    if (rec.redeemedBy || (rec.expiresAt !== null && rec.expiresAt < Date.now())) {
      replyUser(msg, "❌ this key was already redeem or expired.").catch(() => {});
      return;
    }
    rec.redeemedBy = msg.author.id;
    const tmp = `${KEYS_FILE}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(keyStore, null, 2)); fs.renameSync(tmp, KEYS_FILE); } catch {}
    try {
      const g = await client.guilds.fetch(GUILD_ID);
      const m = await g.members.fetch(msg.author.id);
      await m.roles.add(BUYER_ROLE_ID);
    } catch (e) {
      replyUser(msg, "❌ Key saved but failed to assign role: " + e.message).catch(() => {});
      return;
    }
    replyUser(msg, "✅ Key redeemed! Buyer role applied.").catch(() => {});
    return;
  }

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
    
    // Check if user provided a specific user ID/mention
    const targetArg = txt.split(/\s+/)[1]?.trim();
    let targetUserId = null;
    if (targetArg) {
      const mentionMatch = targetArg.match(/<@!?(\d+)>/);
      if (mentionMatch) targetUserId = mentionMatch[1];
      else if (/^\d+$/.test(targetArg)) targetUserId = targetArg;
    }
    
    // Single user check mode
    if (targetUserId) {
      try {
        const targetMember = await msg.guild.members.fetch(targetUserId).catch(() => null);
        if (!targetMember || targetMember.user.bot) {
          replyUser(msg, "❌ user not found or is a bot, dumbass.").catch(() => {});
          return;
        }
        const now = Date.now();
        let score = 0;
        const flags = [];
        const created = targetMember.user.createdTimestamp;
        const ageDays = (now - created) / (24 * 60 * 60 * 1000);
        
        if (ageDays < 7) { score += 40; flags.push(`🕐 **${ageDays.toFixed(0)} days old**`); }
        else if (ageDays < 30) { score += 20; flags.push(`🕐 ${ageDays.toFixed(0)} days old`); }
        
        const joined = targetMember.joinedTimestamp;
        if (joined) {
          const joinDays = (now - joined) / (24 * 60 * 60 * 1000);
          if (joinDays < 3) { score += 15; flags.push(`🆕 Joined ${joinDays.toFixed(0)}d ago`); }
        }
        
        if (!targetMember.user.avatar) { score += 20; flags.push("👤 No avatar"); }
        
        const nonEveryoneRoles = targetMember.roles.cache.filter(r => r.id !== msg.guild.id);
        if (nonEveryoneRoles.size === 0) { score += 15; flags.push("🎭 No roles"); }
        
        const uname = targetMember.user.username;
        const numMatch = uname.match(/(\d{3,})$/);
        if (numMatch && numMatch[1].length >= 4) { score += 10; flags.push(`🔢 Numbers in name`); }
        
        if (targetMember.displayName === uname && !targetMember.user.avatar) { score += 5; }
        
        if (targetMember.premiumSince && ageDays < 30) { score += 10; flags.push("⚠️ New + boosting"); }
        
        const riskLevel = score >= 50 ? "🔴 HIGH RISK" : score >= 35 ? "🟠 MEDIUM RISK" : score >= 25 ? "🟡 LOW RISK" : "✅ CLEAN";
        const createdDate = new Date(created).toLocaleDateString("en-US");
        const joinDate = joined ? new Date(joined).toLocaleDateString("en-US") : "Unknown";
        
        const userEmbed = new EmbedBuilder()
          .setColor(score >= 25 ? 0x2B2D31 : 0x2B2D31)
          .setTitle(`🔍 Account Check — ${targetMember.user.tag}`)
          .setThumbnail(targetMember.user.avatarURL({ dynamic: true }) || null)
          .setDescription(
            `**User:** <@${targetMember.id}>\n` +
            `**ID:** \`${targetMember.id}\`\n` +
            `**Risk:** ${riskLevel} (Score: \`${score}\`)\n` +
            `**Created:** ${createdDate} (${ageDays.toFixed(0)} days ago)\n` +
            `**Joined:** ${joinDate}\n` +
            `**Avatar:** ${targetMember.user.avatar ? "✅ Has avatar" : "❌ No avatar"}\n` +
            `**Roles:** ${nonEveryoneRoles.size}\n\n` +
            (flags.length > 0 ? `**Flags:**\n${flags.map(f => `• ${f}`).join("\n")}` : "**Flags:** None — account looks clean ✅")
          )
          .setFooter({ text: `Suspicion score: ${score}/100+` });
        
        if (score >= 25) { await applyAltRole(targetMember); }
        replyUser(msg, { embeds: [userEmbed] }).catch(() => {});
        return;
      } catch (e) {
        replyUser(msg, `❌ error: ${e.message.slice(0, 100)}`).catch(() => {});
        return;
      }
    }
    
    // Full server scan mode
    const loadingMsg = await replyUser(msg, "🔍 Scanning server for suspicious accounts...").catch(() => {});
    
    try {
      // Fetch members with rate limit retry
      try {
        await msg.guild.members.fetch().catch(async (e) => {
          // If rate limited, wait and retry once
          const retryMatch = e?.message?.match(/Retry after ([\d.]+) seconds?/);
          const waitSec = retryMatch ? parseFloat(retryMatch[1]) + 1 : 12;
          console.log(`⚠️ Altlist rate limited, waiting ${waitSec}s...`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
          try { await msg.guild.members.fetch(); } catch {}
        });
      } catch {}
      // If cache is still empty, try fetch with limit
      if (msg.guild.members.cache.size < 5) {
        try { await msg.guild.members.fetch({ limit: 1000 }); } catch {}
      }
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
          await applyAltRole(member);
        }
      }
      
      // Sort by suspicion score (highest first)
      suspicious.sort((a, b) => b.score - a.score);
      
      if (loadingMsg) await loadingMsg.delete().catch(() => {});
      
      if (suspicious.length === 0) {
        replyUser(msg, "✅ No suspicious accounts found bro, server looks clean.").catch(() => {});
        return;
      }
      
      // Build pages of results (max 5 per embed)
      const perPage = 5;
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
      
      const altRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("alt_prev").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("alt_next").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(totalPages <= 1)
      );
      
      const sent = await replyUser(msg, { embeds: [embed], components: [altRow] }).catch(() => {});
      if (sent) {
        altListMenus.set(msg.author.id, {
          results: suspicious, page: 1, totalPages, messageId: sent.id,
          authorId: msg.author.id, guildName: msg.guild.name, memberCount: msg.guild.memberCount,
          createdAt: Date.now()
        });
      }
      
    } catch (e) {
      if (loadingMsg) await loadingMsg.delete().catch(() => {});
      const errMsg = e.message.includes("rate limited") || e.message.includes("opcode 8") 
        ? "⏳ Discord rate limited, try again in 1-2 minutes bro."
        : `❌ scan failed: ${e.message.slice(0, 80)}`;
      replyUser(msg, errMsg).catch(() => {});
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
    if (mentionMatch) { try { ch = await client.channels.fetch(mentionMatch[1]); } catch {} }
    if (!ch && args[0]) { try { ch = await client.channels.fetch(args[0].trim()); } catch {} }
    if (!ch && !args[0]) { ch = msg.channel; }
    if (!ch) { replyUser(msg, "❌ provide a channel: `.scanchannel #channel` or `.scanchannel channel_id`, dumbass.").catch(() => {}); return; }
    if (!ch?.isTextBased?.()) { replyUser(msg, "❌ not a readable text channel, idiot.").catch(() => {}); return; }
    if (runningScans.has(ch.id)) { replyUser(msg, "⚠️ already scanning that channel, bro.").catch(() => {}); return; }
    const startMsg = await replyUser(msg, `⚡ **Scan started** for <#${ch.id}>...`).catch(() => {});
    scanChannel(ch).then(r => {
      const out = `✅ **Scan complete!**\n📂 <#${ch.id}>\n💬 Messages: \`${r.messages}\`\n📄 New: \`${r.found}\`\n🔄 Replaced: \`${r.replaced || 0}\`\n🚫 Skipped: \`${r.skipped}\`\n📁 Channel Files: \`${r.channelTotal}\`\n📚 Library Total: \`${r.total}\``;
      if (startMsg) startMsg.edit(out).catch(() => {});
      else replyUser(msg, out).catch(() => {});
    }).catch(e => {
      const out = `❌ **Scan failed:**\n\`${e.message.slice(0,1500)}\``;
      if (startMsg) startMsg.edit(out).catch(() => {});
      else replyUser(msg, out).catch(() => {});
    });
    return;
  }
  // ─────────────────────────────────────────────
  // .scan — Owner Only (supports multiple channels: .scan #ch1 #ch2)
  // ─────────────────────────────────────────────
  if (/^\.scan(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    const chans = msg.mentions.channels.size ? [...msg.mentions.channels.values()] : [msg.channel];
    let totalNew = 0, totalSkipped = 0, totalMsgs = 0;
    for (const ch of chans) {
      if (!ch?.isTextBased?.()) { await msg.channel.send(`❌ <#${ch.id}> not text`).catch(() => {}); continue; }
      if (runningScans.has(ch.id)) { await msg.channel.send(`⚠️ <#${ch.id}> already scanning`).catch(() => {}); continue; }
      try {
        await msg.channel.send(`⚡ Scanning <#${ch.id}>...`).catch(() => {});
        const r = await scanChannel(ch);
        totalNew += r.found; totalSkipped += r.skipped; totalMsgs += r.messages;
        await msg.channel.send(`✅ <#${ch.name}> — 💬 ${r.messages} msgs | 📄 ${r.found} new | 🚫 ${r.skipped} skipped | 📁 Total File: ${r.total}`).catch(() => {});
      } catch (e) {
        await msg.channel.send(`❌ <#${ch.id}> failed: ${e.message.slice(0,80)}`).catch(() => {});
      }
    }
    if (chans.length > 1) {
      replyUser(msg, `📊 **Scan Complete:** ${chans.length} channels | 💬 ${totalMsgs} msgs | 📄 ${totalNew} new | 🚫 ${totalSkipped} skipped | 📁 Library Total: ${library.files.length}`).catch(() => {});
    }
    return;
  }
  // ─────────────────────────────────────────────
  // .dm — Owner Only (DM role or user)
  // ─────────────────────────────────────────────
  if (/^\.dm(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const roleMatch = txt.match(/<@&(\d+)>/);
    const userMatch = txt.match(/<@!?(\d+)>/);
    const idMatch = txt.match(/\s(\d{17,})/);
    const message = txt.replace(/^\.dm\s+/, "").replace(/<@&?\d+>/g, "").replace(/\s\d{17,}\s?/, "").trim();
    if (!message) { replyUser(msg, "❌ usage: `.dm @role/@user/ID message here`").catch(() => {}); return; }
    let targets = [];
    if (roleMatch && msg.guild) {
      try {
        const role = await msg.guild.roles.fetch(roleMatch[1]);
        if (role) targets = [...role.members.values()];
      } catch {}
    } else if (userMatch) {
      try { const m = await msg.guild?.members.fetch(userMatch[1]); if (m) targets = [m]; } catch {}
    } else if (idMatch) {
      try { const u = await client.users.fetch(idMatch[1]); if (u) targets = [{ user: u, send: (p) => u.send(p) }]; } catch {}
    }
    if (!targets.length) { replyUser(msg, "❌ no valid targets found.").catch(() => {}); return; }
    let sent = 0, failed = 0;
    const statusMsg = await replyUser(msg, `📨 Sending to ${targets.length} targets...`).catch(() => {});
    for (const t of targets) {
      try { await (t.send ? t.send(message) : t.user.send(message)); sent++; }
      catch { failed++; }
      await new Promise(r => setTimeout(r, 300));
    }
    if (statusMsg) statusMsg.edit(`✅ Done! Sent: ${sent} | Failed: ${failed}`).catch(() => {});
    else replyUser(msg, `✅ Done! Sent: ${sent} | Failed: ${failed}`).catch(() => {});
    return;
  }
  // ─────────────────────────────────────────────
  // .extract — Owner Only
  // ─────────────────────────────────────────────
  if (/^\.extract(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    let attachments = extractAttachmentsOf(msg);
    if (!attachments.length && msg.reference?.messageId) {
      try { const ref = await msg.channel.messages.fetch(msg.reference.messageId); attachments = extractAttachmentsOf(ref); } catch {}
    }
    if (!attachments.length) { replyUser(msg, "❌ upload a .zip file or reply to one, dumbass.").catch(() => {}); return; }
    const sourceFile = attachments[0];
    const maxInfo = getMaxFileSize(msg.guild);
    if (sourceFile.size > maxInfo.size) { replyUser(msg, `❌ max file is ${maxInfo.label}, lol.`).catch(() => {}); return; }
    const sentMsg = await replyUser(msg, "⏳ Processing...").catch(() => {});
    try {
      const buf = await downloadURL(sourceFile.url);
      let files = extractFilesFromZip(buf);
      if (!files.length) { if (sentMsg) await sentMsg.delete().catch(() => {}); replyUser(msg, "❌ zip is empty or has no extractable files, bro.").catch(() => {}); return; }
      if (sentMsg) await sentMsg.delete().catch(() => {});
      for (let i = 0; i < files.length; i += 10) {
        const batch = files.slice(i, i + 10);
        const atts = batch.map(f => new AttachmentBuilder(f.data, { name: f.name }));
        await msg.channel.send({ files: atts }).catch(() => {});
      }
    } catch (e) { if (sentMsg) await sentMsg.delete().catch(() => {}); replyUser(msg, `❌ error: ${e.message}`).catch(() => {}); }
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
    if (!perm.allowed) { if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "whs", isBuyerUser);
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
        await msg.channel.send(`<@${msg.author.id}> ❌ Not Found`).catch(() => {});
      } else {
        const resultEmbed = new EmbedBuilder()
          .setColor(getEmbedColor(isBuyerUser))
          .setTitle("Result")
          .setFooter({ text: timeFooter });
        
        if (res.ok) {
          resultEmbed.setDescription("✅ Delete");
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
  // ─────────────────────────────────────────────
  // ─────────────────────────────────────────────
  // .whs — Webhook Spammer (with Start button + modal)
  // ─────────────────────────────────────────────
  if (/^\.whs(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return; }
    
    const panelEmbed = new EmbedBuilder()
      .setColor(getEmbedColor(perm.isBuyer))
      .setDescription("Click `Start` button below to start.");
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("whs_start")
        .setLabel("Start")
        .setStyle(ButtonStyle.Success)
    );
    
    const panelMsg = await replyUser(msg, { embeds: [panelEmbed], components: [row] }).catch(() => {});
    if (panelMsg) {
      whsPanelOwners.set(panelMsg.id, msg.author.id);
      setTimeout(() => whsPanelOwners.delete(panelMsg.id), 10 * 60 * 1000);
    }
    return;
  }

  // .upload — file → Pastefy loadstring (regular + buyer)
  // ─────────────────────────────────────────────

  if (/^\.upload(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return; }
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
    if (file.size > 200 * 1024) { replyUser(msg, "❌ max is 200kb lol.").catch(() => {}); return; }
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
        .setFooter({ text: `Request by @${msg.author.username}│File → Script`, iconURL: msg.author.displayAvatarURL({ dynamic: true, size: 128 }) });
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
    if (!perm.allowed) { if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return; }
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
    if (file.size > 200 * 1024) { replyUser(msg, "❌ max is 200kb lol.").catch(() => {}); return; }
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

  // .find, .get, .rename/.rn, .et, .dl/.download
  // ─────────────────────────────────────────────

  // .et — carousel mode
  if (/^\.et(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg, true);
    if (!perm.allowed) { if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return; }
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
    if (!perm.allowed) { if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return; }
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
    if (!attachments.length) { replyUser(msg, "❌ bruh, upload file or reply to a file.").catch(() => {}); return; }
    const file = attachments[0];
    const fileExt = ext(file.name);
    if (fileExt !== "lua" && fileExt !== "txt") { replyUser(msg, "❌ only .lua and .txt is working, idiot.").catch(() => {}); return; }
    const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}`;
    const workingEmbed = new EmbedBuilder()
      .setColor(getEmbedColor(isBuyerUser))
      .setTitle("Renaming...")
      .setDescription("⏳ Processing...")
      .setFooter({ text: timeFooter });
    const startTime = Date.now();
    const sentMsg = await replyUser(msg, { embeds: [workingEmbed] }).catch(() => {});
    // NO DELAY — FAST response
    (async () => {
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
        
        // Filename: 20 random chars + .lua
        const randChars = "abcdefghijklmnopqrstuvwxyz";
        let outputName = "";
        for (let i = 0; i < 20; i++) {
          outputName += randChars.charAt(Math.floor(Math.random() * randChars.length));
        }
        outputName += ".lua";
        
        const finalOutput = cleaned;
        
        const allLines = cleaned.split("\n");
        // Limit preview to MAX 50 words (or 5 lines, whichever comes first)
        let previewWords = [];
        let wordCount = 0;
        let lineCount = 0;
        for (const line of allLines) {
          if (lineCount >= 5 || wordCount >= 50) break;
          const words = line.trim().split(/\s+/).filter(Boolean);
          for (const w of words) {
            if (wordCount >= 50) break;
            previewWords.push(w);
            wordCount++;
          }
          previewWords.push("\n");
          lineCount++;
        }
        let previewText = previewWords.join(" ").replace(/ \n /g, "\n").trim();
        if (previewText.endsWith("\n")) previewText = previewText.slice(0, -1);
        if (wordCount >= 50 || lineCount >= 5) previewText += "\n...";
        // Safety truncation
        if (previewText.length > 1000) previewText = previewText.slice(0, 1000) + "\n...";
        
        // Build description with URL section if links found
        let description = `\`\`\`lua\n${previewText}\n\`\`\``;
        if (foundUrls.length > 0) {
          const uniqueUrls = [...new Set(foundUrls)];
          const urlList = uniqueUrls.slice(0, 10).map(u => `- ${u}`).join("\n");
          let urlSection = `\n\n**URL Found:**\n${urlList}`;
          if (uniqueUrls.length > 10) urlSection += `\n- ...and ${uniqueUrls.length - 10} more`;
          description += urlSection.slice(0, 800);
        }
        
        const avatarURL = msg.author.displayAvatarURL({ dynamic: true, size: 128 });
        const resultEmbed = new EmbedBuilder()
          .setColor(getEmbedColor(isBuyerUser))
          .setTitle("File Preview")
          .setDescription(description)
          .setFooter({ text: `Request by @${msg.author.username}│Clean & Fixed`, iconURL: avatarURL });
        const fixedFile = new AttachmentBuilder(Buffer.from(finalOutput), { name: outputName });
        if (sentMsg) await sentMsg.delete().catch(() => {});
        const elapsed = Date.now() - startTime;
        await msg.channel.send({
          content: `<@${msg.author.id}> **Here you go bro!**\n**Finish in:** \`${elapsed}ms\``,
          files: [fixedFile],
          embeds: [resultEmbed]
        }).catch(() => {});
      } catch (e) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, `❌ error: ${e.message}`).catch(() => {});
      }
    })();
    return;
  }
  // .get
  if (/^\.get(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return; }
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
    if (!perm.allowed) { if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return; }
    const arg = txt.split(/\s+/)[1];
    if (!arg) { replyUser(msg, "❌ put file link, idiot.").catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "dl", isBuyerUser);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }

    // Check if Instagram URL
    if (/instagram\.com|instagr\.am|ig\.me/i.test(arg)) {
      const sentMsg = await replyUser(msg, "⏳ Processing...").catch(() => {});
      try {
        let downloadUrl = null;
        let mediaType = "Media";
        try {
          const apiRes = await fetch("https://api.cobalt.tools/api/json", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ url: arg })
          });
          if (!apiRes.ok) throw new Error("API " + apiRes.status);
          const data = await apiRes.json();
          
          if (data?.url) {
            downloadUrl = data.url;
            mediaType = data.audio ? "Audio" : "Video/Photo";
          } else if (data?.audio) {
            downloadUrl = data.audio;
            mediaType = "Audio";
          } else if (data?.picker && Array.isArray(data.picker) && data.picker.length > 0) {
            downloadUrl = data.picker[0].url;
            mediaType = "Photo (1/" + data.picker.length + ")";
          }
        } catch {}
        
        if (!downloadUrl) throw new Error("Failed to get Instagram media");
        
        const resEmbed = new EmbedBuilder()
          .setColor(getEmbedColor(isBuyerUser))
          .setTitle("📥 Instagram Download")
          .setDescription("**Type:** " + mediaType + "\n🔗 **Download:** [Click Here](" + downloadUrl + ")")
          .setFooter({ text: "Request by @" + msg.author.username + "│Instagram DL", iconURL: msg.author.displayAvatarURL({ dynamic: true, size: 128 }) });
        
        if (sentMsg) await sentMsg.delete().catch(() => {});
        const elapsed = Date.now() - startTime;
        await msg.channel.send({
          content: `<@${msg.author.id}> **Here you go bro!**\n**Finish in:** \`${elapsed}ms\``,
          embeds: [resEmbed]
        }).catch(() => {});
      } catch (e) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, "❌ failed — link may be private, expired, or not a post/reel.").catch(() => {});
      }
      return;
    }

    // Check if TikTok URL — NO WATERMARK
    if (/tiktok\.com|vm\.tiktok\.com/i.test(arg)) {
      const sentMsg = await replyUser(msg, "⏳ Processing...").catch(() => {});
      try {
        // Try cobalt.tools first (clean, no watermark)
        let videoUrl = null;
        try {
          const apiRes = await fetch("https://api.cobalt.tools/api/json", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ url: arg })
          });
          const data = await apiRes.json();
          if (data?.url) videoUrl = data.url;
        } catch {}
        
        // Fallback: tikwm
        if (!videoUrl) {
          try {
            const api2 = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(arg)}`);
            const d2 = await api2.json();
            if (d2?.data?.play) videoUrl = d2.data.play;
          } catch {}
        }
        
        if (!videoUrl) throw new Error("Failed to get video");
        
        const resEmbed = new EmbedBuilder()
          .setColor(getEmbedColor(isBuyerUser))
          .setTitle("📥 TikTok Download")
          .setDescription(`🔗 **Download:** [Click Here](${videoUrl})`)
          .setFooter({ text: `Request by @${msg.author.username}│TikTok DL`, iconURL: msg.author.displayAvatarURL({ dynamic: true, size: 128 }) });
        
        if (sentMsg) await sentMsg.delete().catch(() => {});
        const elapsed = Date.now() - startTime;
        await msg.channel.send({
          content: `<@${msg.author.id}> **Here you go bro!**\n**Finish in:** \`${elapsed}ms\``,
          embeds: [resEmbed]
        }).catch(() => {});
      } catch (e) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, `❌ failed: ${e.message.slice(0, 80)}`).catch(() => {});
      }
      return;
    }

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
        const elapsed = Date.now() - startTime;
        await msg.channel.send({
          content: `<@${msg.author.id}> **Here you go bro!**\n**Finish in:** \`${elapsed}ms\``,
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
    const fileAttachment = { attachment: fileUrl, name: file.filename || "file.lua" };
    
    await msg.channel.send({
      content: `<@${msg.author.id}> **Here is the file twin!**`,
      files: [fileAttachment]
    }).catch(() => {});
    return;
  }
  // .find
  if (/^\.find(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return; }
    const query = txt.slice(5).trim();
    if (!query) { replyUser(msg, "❌ usage: `.find <file name>`, dumbass.").catch(() => {}); return; }
    const results = findFiles(query);
    if (!results.length) { replyUser(msg, "❌ no found for that, dumbass.").catch(() => {}); return; }
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
