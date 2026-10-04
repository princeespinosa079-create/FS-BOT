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
const OpenAI = require("openai");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const openaiClient = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
// ============================================================
// ENV
// ============================================================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = "1302080645987569694";
const BUYER_ROLE_ID = "1553385966629158963";
const PRINCE_ROLE_ID = "1547849774676316181";
const BUYER_COLOR = 0xFFFFFF;
const REGULAR_COLOR = 0x2B2D31; // black gray
const BLURPLE = 0x5865F2; // Discord blurple
const GRAY_COLOR = 0x99AAB5; // light gray (not black-gray)
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
let config = readJSON(CONFIG_FILE, { allowedChannelId: null, liveScanChannelIds: [] });
if (!config || typeof config !== "object") config = { allowedChannelId: null, liveScanChannelIds: [] };
if (!Array.isArray(config.liveScanChannelIds)) config.liveScanChannelIds = [];
let library = readJSON(LIBRARY_FILE, { files: [] });
if (Array.isArray(library)) library = { files: library };
if (!Array.isArray(library.files)) library.files = [];

// ============================================================
// KEY SYSTEM (Premium Keys)
// ============================================================
const KEYS_FILE = path.join(DATA_DIR, "keys.json");
let keyStore = readJSON(KEYS_FILE, { keys: [] });
if (!Array.isArray(keyStore.keys)) keyStore.keys = [];

// ============================================================
// TOKEN SYSTEM (regular users — max 10, daily refill when empty)
// Premium / Owner = unlimited
// ============================================================
const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");
const MAX_REGULAR_TOKENS = 10;
const PH_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Manila = UTC+8
let tokenStore = readJSON(TOKENS_FILE, { users: {} });
if (!tokenStore || typeof tokenStore !== "object") tokenStore = { users: {} };
if (!tokenStore.users || typeof tokenStore.users !== "object") tokenStore.users = {};
const saveTokens = () => writeJSON(TOKENS_FILE, tokenStore);

/** YYYY-MM-DD in Asia/Manila */
function getPHDateKey(ms = Date.now()) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

/** Next 12:00 AM Philippine time (epoch ms) */
function getNextMidnightPHMs(fromMs = Date.now()) {
  const phNow = fromMs + PH_OFFSET_MS;
  const d = new Date(phNow);
  const nextPhMidnightAsUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
  return nextPhMidnightAsUtc - PH_OFFSET_MS;
}

function getUserTokenData(userId) {
  const id = String(userId);
  if (!tokenStore.users[id]) {
    tokenStore.users[id] = { tokens: MAX_REGULAR_TOKENS, lastResetDate: getPHDateKey(), nextRefillAt: null };
    saveTokens();
  }
  return tokenStore.users[id];
}

/** At 12 AM PH every day → tokens reset to 10 (gifts after reset can go above 10) */
function ensureDailyTokenReset(userId) {
  const data = getUserTokenData(userId);
  const today = getPHDateKey();
  if (data.lastResetDate !== today) {
    data.tokens = MAX_REGULAR_TOKENS;
    data.lastResetDate = today;
    data.nextRefillAt = null;
    saveTokens();
  }
  return data;
}

function formatTokenWait(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}H ${m}M ${s}S`;
}

function tokenWaitEmbed(waitUntil) {
  return new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle("Input Error")
    .setDescription(`You need to wait ${formatTokenWait(waitUntil - Date.now())}`);
}

function tokenLeftLine(tokensLeft, unlimited) {
  if (unlimited) return "-# You have Unlimited Tokens left.";
  return `-# You have ${tokensLeft} Tokens left.`;
}

/** Consume 1 token for regular users. Buyers/owners unlimited. Daily reset 12 AM PH. */
function tryConsumeToken(userId, isBuyerUser) {
  if (isBuyerUser || isOwner(userId)) {
    return { ok: true, unlimited: true, tokens: null };
  }
  const data = ensureDailyTokenReset(userId);
  if (data.tokens <= 0) {
    const waitUntil = getNextMidnightPHMs();
    data.nextRefillAt = waitUntil;
    saveTokens();
    return { ok: false, waitUntil, tokens: 0 };
  }
  data.tokens = Math.max(0, data.tokens - 1);
  if (data.tokens <= 0) data.nextRefillAt = getNextMidnightPHMs();
  else data.nextRefillAt = null;
  saveTokens();
  return { ok: true, unlimited: false, tokens: data.tokens };
}

function peekTokens(userId, isBuyerUser) {
  if (isBuyerUser || isOwner(userId)) return { unlimited: true, tokens: null };
  const data = ensureDailyTokenReset(userId);
  return { unlimited: false, tokens: data.tokens, nextRefillAt: data.nextRefillAt || getNextMidnightPHMs() };
}

/** Gift tokens — can go above 10 (e.g. 20). Daily 12 AM PH still resets to 10. */
function addToken(userId, amount) {
  const data = ensureDailyTokenReset(userId);
  // Cap at 10 — never above max (gifts / coinflip / etc.)
  data.tokens = Math.min(MAX_REGULAR_TOKENS, Math.max(0, data.tokens + amount));
  if (data.tokens > 0) data.nextRefillAt = null;
  else data.nextRefillAt = getNextMidnightPHMs();
  saveTokens();
  return data.tokens;
}

/** Subtract tokens from a regular user. Returns { ok, tokens, need? }. */
function subtractTokens(userId, amount) {
  const data = ensureDailyTokenReset(userId);
  if (data.tokens < amount) {
    return { ok: false, tokens: data.tokens, need: amount };
  }
  data.tokens = Math.max(0, data.tokens - amount);
  if (data.tokens <= 0) data.nextRefillAt = getNextMidnightPHMs();
  else data.nextRefillAt = null;
  saveTokens();
  return { ok: true, tokens: data.tokens };
}

async function logFinderPanel(user, action, detail) {
  try {
    const chId = config.logChannelId ? String(config.logChannelId) : null;
    if (!chId) return;
    const ch = await client.channels.fetch(chId).catch(() => null);
    if (!ch || !ch.isTextBased?.()) return;
    const embed = new EmbedBuilder()
      .setColor(REGULAR_COLOR)
      .setTitle("Finder Panel Log")
      .setDescription(
        `**User:** <@${user.id}> (\`@${user.username}\` / \`${user.id}\`)\n` +
        `**Action:** ${action}\n` +
        `**Detail:** ${detail || "—"}\n` +
        `**Time:** <t:${Math.floor(Date.now() / 1000)}:F>`
      );
    await ch.send({ embeds: [embed] }).catch(() => {});
  } catch (e) {
    console.warn("⚠️ logFinderPanel:", e.message);
  }
}

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
const commandCooldowns = new Map(); // legacy — unused (tokens replace cooldowns)
const COOLDOWNS = {}; // all timed cooldowns removed — token system used instead
/** Free commands (no token cost): redeem, help, find (prefix). Finder panel Find button DOES cost. */
const TOKEN_FREE_CMDS = new Set(["redeem", "help", "find"]);
function formatCooldown(remainingSec) {
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
/**
 * Token gate (replaces timed cooldowns).
 * Returns { onCooldown, noTokens, waitUntil, tokensLeft, unlimited }
 * onCooldown=true only when out of tokens (wait for daily refill).
 */
const pendingTokenLine = new Map(); // userId -> "-# You have XX Tokens left." (regular only — never premium)
/** Token line for message TEXT only (never embed). Empty for premium. */
function tokensResultSuffix(isBuyerUser, tokensLeft) {
  if (isBuyerUser || tokensLeft === null || tokensLeft === undefined) return "";
  return `\n-# You have ${tokensLeft} Tokens left.`;
}
function checkCommandCooldown(userId, cmd, isBuyerUser) {
  const free = TOKEN_FREE_CMDS.has(cmd);
  // Premium / owner: never show token line, never consume
  if (isBuyerUser || isOwner(userId)) {
    pendingTokenLine.delete(String(userId));
    return { onCooldown: false, unlimited: true, tokensLeft: null, free };
  }
  if (free) {
    const peek = peekTokens(userId, false);
    pendingTokenLine.set(String(userId), tokenLeftLine(peek.tokens, false));
    return { onCooldown: false, unlimited: false, tokensLeft: peek.tokens, free: true };
  }
  const r = tryConsumeToken(userId, false);
  if (!r.ok) {
    pendingTokenLine.delete(String(userId));
    return { onCooldown: true, noTokens: true, waitUntil: r.waitUntil, tokensLeft: 0 };
  }
  pendingTokenLine.set(String(userId), tokenLeftLine(r.tokens, false));
  return { onCooldown: false, unlimited: false, tokensLeft: r.tokens, free: false };
}
/** Reply helper when out of tokens — never attach tokens left */
function replyNoTokens(msg, waitUntil) {
  pendingTokenLine.delete(String(msg.author.id));
  return replyUser(msg, { embeds: [tokenWaitEmbed(waitUntil)] });
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
const renamePanels = new Map(); // messageId -> { authorId, fileUrl, fileName, isBuyerUser }
const finderPanelCooldowns = new Map(); // "find:userId" | "get:userId" → expiry timestamp
const FINDER_PANEL_CD_MS = 60 * 1000; // 1 minute per Find / Get use
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
  // ONLY Owner + BUYER_ROLE_ID count as buyer.
  // PRINCE_ROLE_ID (Server Tag role) does NOT grant buyer/DM access.
  const uid = userId || member?.id;
  if (!uid) return false;
  if (uid === OWNER_ID) return true;
  // Fast path: local guild member check — BUYER role only (never Prince role)
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
    // Always re-read from disk so .set changes apply immediately and survive restarts
    try {
      const fresh = readJSON(CONFIG_FILE, { allowedChannelId: null });
      if (fresh && typeof fresh === "object") {
        config.allowedChannelId = fresh.allowedChannelId ? String(fresh.allowedChannelId) : null;
      }
    } catch {}
    const chId = String(msg.channel?.id || msg.channelId || msg.channel_id || "");
    // ONLY the channel set by .set — no hardcoded fallback
    const allowed = config.allowedChannelId ? String(config.allowedChannelId) : "";
    if (!chId || !allowed) return false;
    return chId === allowed;
  } catch (e) {
    return false;
  }
}
// Check if a user/member has adopted THIS server's Server Tag (primary guild identity)
function memberHasServerTag(member) {
  if (!member?.user) return false;
  try {
    const pg = member.user.primaryGuild;
    if (!pg) return false;
    // Must be displaying the tag AND it must be for our guild
    return pg.identityEnabled === true && String(pg.identityGuildId) === String(GUILD_ID);
  } catch {
    return false;
  }
}
function hasServerTag(member) {
  return memberHasServerTag(member);
}
// Async — fetch member from main guild then check Server Tag
async function hasPrinceStatus(userId) {
  try {
    const mainGuild = await client.guilds.fetch(GUILD_ID);
    const member = await mainGuild.members.fetch(userId, { force: true });
    return memberHasServerTag(member);
  } catch {
    return false;
  }
}
// Alias used by older call sites
function memberHasPrinceStatus(member) {
  return memberHasServerTag(member);
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
// Auto-give / remove PRINCE role based on Server Tag
async function syncPrinceRole(member) {
  try {
    if (!member || member.guild.id !== GUILD_ID) return;
    if (member.user.bot) return;
    // Force-fetch to get latest user data (primaryGuild / Server Tag)
    try { member = await member.guild.members.fetch(member.id, { force: true }); } catch {}
    const hasTag = memberHasServerTag(member);
    const hasRole = member.roles.cache.has(PRINCE_ROLE_ID);
    console.log(`👑 Check ${member.user.tag}: hasServerTag=${hasTag} hasRole=${hasRole}`);
    if (hasTag && !hasRole) {
      await member.roles.add(PRINCE_ROLE_ID, "Server Tag adopted").catch(() => {});
      console.log(`👑 + Prince role (Server Tag): ${member.user.tag}`);
    } else if (!hasTag && hasRole) {
      await member.roles.remove(PRINCE_ROLE_ID, "Server Tag removed").catch(() => {});
      console.log(`👑 - Prince role (Server Tag): ${member.user.tag}`);
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
        const hasTag = memberHasServerTag(member);
        const hasRole = member.roles.cache.has(PRINCE_ROLE_ID);
        if (hasTag && !hasRole) {
          await member.roles.add(PRINCE_ROLE_ID, "Startup sync: Server Tag detected").catch(() => {});
          added++;
        } else if (!hasTag && hasRole) {
          await member.roles.remove(PRINCE_ROLE_ID, "Startup sync: no Server Tag").catch(() => {});
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
Key Active: ${activeKey ? "\`" + activeKey.key + "\`" : "❌ No active key."}`
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
    const redeemIsBuyer = isOwner(msg.author.id) || await isBuyer(msg.author.id, msg.member);
    const cd = checkCommandCooldown(msg.author.id, "redeem", redeemIsBuyer);
    if (cd.onCooldown) {
      if (cd.noTokens) { replyNoTokens(msg, cd.waitUntil).catch(() => {}); return; }
      replyUser(msg, `❌ you're on ${cd.remaining} cooldown.`).catch(() => {}); return;
    }
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
      replyUser(msg, "❌ this key was already redeem.").catch(() => {});
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
    replyUser(msg, "✅ key redeemed successfully.").catch(() => {});
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

  // Server Tag requirement — regular users MUST adopt this server's Server Tag
  const hasTag = await hasPrinceStatus(msg.author.id);
  if (!hasTag) {
    const tagEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle("Input Error")
      .setDescription("**Tips:**\n- Go on your profile, click `Edit Profile` then scroll down, you’ll see the `Select a Server Tag` click it then use our Server Tag.");
    replyUser(msg, { embeds: [tagEmbed] }).catch(() => {});
    return { allowed: false, reason: null, silent: true, isBuyer: false };
  }
  // Channel lock — has tag but wrong channel → tell them
  if (!channelAllowed(msg)) {
    const chEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle("Input Error")
      .setDescription("**Tips:**\n- Use command in allowed channel, and use server tag if you don’t have it so you can use command there.");
    replyUser(msg, { embeds: [chEmbed] }).catch(() => {});
    return { allowed: false, reason: null, silent: true, isBuyer: false };
  }
  // Auto-give role when they have the tag (in case sync missed them)
  try {
    if (msg.member && msg.guild?.id === GUILD_ID) {
      await syncPrinceRole(msg.member);
    }
  } catch {}
  if (needsFileReply && !isReplyingToFile(msg)) {
    return { allowed: false, reason: "❌ reply to a file or forwarded file, dumbass.", isBuyer: false };
  }

  // All checks passed — regular user allowed
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
/** True if this reply is an error / tips / fail / loading — never attach tokens left */
function isErrorPayload(body) {
  const contentStr = typeof body.content === "string" ? body.content : "";
  const errRe = /❌|no found for that|not found|failed:|upload failed|scan failed|forward failed|invalid key|owner only|usage:|put (?:file|id|a file)|you're on|need to wait|buy access|buy premium|join in main server|reply to a file|already got a key|already redeem|can't send|not yours|adopt the Server Tag|max \d+ id|wrong, try|empty response|rate limited|input error|dumbass/i;
  if (errRe.test(contentStr)) return true;
  if (body.embeds && body.embeds.length) {
    for (const emb of body.embeds) {
      const d = emb?.data || emb;
      const title = String(d?.title || "");
      const desc = String(d?.description || "");
      if (title === "Input Error") return true;
      if (/error|failed|deleting/i.test(title)) return true;
      if (errRe.test(desc) || errRe.test(title)) return true;
      if (/processing|fetching|deleting|loading/i.test(title) || /⏳/.test(desc) || /⏳/.test(title)) return true;
    }
  }
  return false;
}
function replyUser(message, payload) {
  const body = typeof payload === "string" ? { content: payload } : { ...payload };
  body.allowedMentions = { ...(body.allowedMentions || {}), repliedUser: true };
  // Token balance ONLY in message text — never inside embeds
  try {
    const line = pendingTokenLine.get(String(message.author?.id));
    if (line) {
      if (isErrorPayload(body)) {
        pendingTokenLine.delete(String(message.author.id));
      } else {
        if (body.content) body.content = `${body.content}\n${line}`;
        else body.content = line;
        pendingTokenLine.delete(String(message.author.id));
      }
    }
  } catch {}
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
  return (e === "txt" || e === "lua" || e === "zip" || String(contentType || "").toLowerCase().includes("zip")) && !isImage(name, contentType);
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
  if (f && Number(f.size || 0) === 36) {
    // Unavailable/expired (36-byte Discord placeholder) — delete from library permanently
    library.files = library.files.filter(file => file.id !== f.id);
    saveLibrary();
    console.log(`🗑️ Deleted unavailable 36-byte file: ${f.filename} (${f.id})`);
    return null;
  }
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
    // Message exists but attachment is gone → file expired/unavailable — delete from library
    library.files = library.files.filter(f => f.id !== file.id);
    saveLibrary();
    console.log(`🗑️ Deleted expired/unavailable file (attachment gone): ${file.filename} (${file.id})`);
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
  // Purge unavailable/expired files (36-byte Discord placeholder) from library permanently
  const beforePurge = library.files.length;
  library.files = library.files.filter(file => Number(file.size || 0) !== 36);
  if (library.files.length !== beforePurge) {
    saveLibrary();
    console.log(`🗑️ Purged ${beforePurge - library.files.length} unavailable 36-byte file(s) from library`);
  }
  return library.files
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
    if (isZipFile(a.name, a.contentType) || isHtmlFile(a.name, a.contentType)) result.push(a);
  }
  for (const s of message.messageSnapshots?.values?.() || []) {
    for (const a of s.attachments?.values?.() || []) {
      if (isZipFile(a.name, a.contentType) || isHtmlFile(a.name, a.contentType)) result.push(a);
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
/** Live-scan: index allowed attachments from a single message into the library */
function indexMessageFiles(msg) {
  if (!msg) return 0;
  const existingBases = new Set(library.files.map(f => normalizeBase(f.filename)));
  const existingFullNames = new Set(library.files.map(f => normalize(f.filename)));
  const found = [];
  for (const item of attachmentsOf(msg)) {
    const a = item.attachment;
    const filename = a.name || "unknown_file";
    const baseName = normalizeBase(filename);
    const fullName = normalize(filename);
    const fileSize = Number(a.size || 0);
    const url = a.url || a.proxyURL || a.proxy_url;
    if (!baseName || !url) continue;
    if (fileSize === 36) continue;
    if (existingBases.has(baseName) || existingFullNames.has(fullName)) continue;
    existingBases.add(baseName);
    existingFullNames.add(fullName);
    found.push({
      id: idForFile(), filename, url, size: fileSize,
      contentType: a.contentType || null, channelId: msg.channelId,
      messageId: msg.id, attachmentId: String(a.id), forwarded: item.forwarded,
      createdTimestamp: msg.createdTimestamp || Date.now(), scannedAt: Date.now()
    });
  }
  if (!found.length) return 0;
  library.files.push(...found);
  library.files.sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
  saveLibrary();
  return found.length;
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

/** Pull every embedded script / code / base64 payload out of an HTML dump */
function extractFilesFromHtml(htmlBuffer, sourceName) {
  const html = Buffer.isBuffer(htmlBuffer) ? htmlBuffer.toString("utf8") : String(htmlBuffer || "");
  const files = [];
  let n = 0;
  const push = (name, data) => {
    if (!data || !data.length) return;
    n++;
    const safe = String(name || `part_${n}`).replace(/[^\w.\-]+/g, "_").slice(0, 80);
    files.push({ name: safe, data: Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8") });
  };
  const decodeEntities = (s) => String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");

  // <script> blocks
  try {
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      const body = decodeEntities(m[1]).trim();
      if (body.length < 5) continue;
      const isLua = /\b(local|function|game|workspace|Instance|task\.|FireServer)\b/.test(body);
      push(`script_${n + 1}.${isLua ? "lua" : "js"}`, body);
    }
  } catch {}

  // <pre> / <code> / <textarea>
  try {
    const re = /<(pre|code|textarea)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = re.exec(html))) {
      const body = decodeEntities(m[2]).trim();
      if (body.length < 8) continue;
      const isLua = /\b(local|function|game|workspace)\b/.test(body);
      push(`block_${n + 1}.${isLua ? "lua" : "txt"}`, body);
    }
  } catch {}

  // data-* / inline base64 payloads
  try {
    const re = /(?:data:text\/(?:plain|lua|javascript);base64,|base64[:=]\s*["']?)([A-Za-z0-9+/]{48,}={0,2})/gi;
    let m;
    while ((m = re.exec(html))) {
      try {
        const decoded = Buffer.from(m[1], "base64");
        if (decoded.length < 8) continue;
        const str = decoded.toString("utf8");
        const isLua = /\b(local|function|game|workspace)\b/.test(str);
        push(`decoded_${n + 1}.${isLua ? "lua" : "txt"}`, decoded);
      } catch {}
    }
  } catch {}

  // ```lua fences sometimes inside HTML text
  try {
    const re = /```(?:lua|luau)?\s*([\s\S]*?)```/gi;
    let m;
    while ((m = re.exec(html))) {
      const body = m[1].trim();
      if (body.length < 8) continue;
      push(`fenced_${n + 1}.lua`, body);
    }
  } catch {}

  // loadstring(...) blobs as standalone files
  try {
    const re = /loadstring\s*\(\s*([`'"])([\s\S]*?)\1\s*\)\s*\(\s*\)/gi;
    let m;
    while ((m = re.exec(html))) {
      const body = m[2].trim();
      if (body.length < 8) continue;
      push(`loadstring_${n + 1}.lua`, body);
    }
  } catch {}

  // Always keep original HTML too so nothing is lost
  const base = (sourceName && String(sourceName).replace(/[^\w.\-]+/g, "_")) || "export.html";
  push(base.endsWith(".html") || base.endsWith(".htm") ? base : base + ".html", Buffer.from(html, "utf8"));

  // Dedupe by content hash (simple length+prefix)
  const seen = new Set();
  const unique = [];
  for (const f of files) {
    const key = `${f.data.length}:${f.data.slice(0, 64).toString("hex")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(f);
  }
  return unique.length ? unique : [{ name: base, data: Buffer.from(html, "utf8") }];
}

// ============================================================
// VARIABLE RENAMER — readable renamer (renames only generic/ambiguous names)
// ============================================================
function renameVariables(source) {
  if (!source || typeof source !== "string") return source;
  const reserved = new Set(["string","math","table","io","os","debug","pcall","xpcall","pairs","ipairs","type","tostring","tonumber","loadstring","load","setfenv","getfenv","setmetatable","getmetatable","rawget","rawset","next","error","warn","print","select","unpack","require","game","workspace","script","bit","bit32","true","false","nil","and","or","not","if","then","else","elseif","end","for","while","do","repeat","until","return","function","local","in","break","self"]);
  
  // Generic name → descriptive replacement dictionary
  const genericMap = {
    parent: "container", child: "childElement", old: "existingInstance", new: "newInstance",
    value: "val", data: "payload", result: "output", handle: "element", index: "idx",
    count: "total", flag: "state", obj: "object", arr: "list", tbl: "tableRef",
    cb: "callback", fn: "callbackFunc", tmp: "tempVal", temp: "tempVal",
    str: "text", num: "numberVal", bool: "flagState", pos: "position", vel: "velocity",
    acc: "accumulator", len: "length", wid: "width", hgt: "height", btn: "button",
    lbl: "label", img: "image", snd: "sound", sfx: "soundEffect", mus: "music",
    vol: "volumeVal", spd: "speedVal", cfg: "config", settings: "AppSettings",
    config: "appConfig", opts: "options", args: "params", arg: "param",
    input: "userInput", output: "resultOutput", msg: "message", err: "errorMsg",
    res: "response", req: "request", url: "link", path: "filePath",
    frame: "uiFrame", panel: "uiPanel", gui: "uiContainer", screen: "screenGui",
    scroll: "scrollFrame", list: "itemList", items: "itemList", tracks: "TrackList",
    players: "playerList", id: "identifier", key: "mapKey", val: "mapValue",
    dragStart: "dragStartInputPos", startPos: "dragStartFramePos",
    dragging: "isDragging", running: "isRunning", active: "isActive", visible: "isVisible",
    enabled: "isEnabled", loaded: "isLoaded", playing: "isPlaying", paused: "isPaused",
    selected: "isSelected", hovered: "isHovered", clicked: "isClicked",
    open: "isOpen", closed: "isClosed", ready: "isReady", done: "isDone",
    exists: "doesExist", valid: "isValid", invalid: "isInvalid",
    success: "didSucceed", failed: "didFail", ok: "isOk",
    parentFrame: "parentContainer", childFrame: "childContainer",
    mainFrame: "mainContainer", titleBar: "titleBarFrame",
    closeBtn: "closeButton", playBtn: "playButton", stopBtn: "stopButton",
    menu: "menuPanel", tab: "tabPanel", page: "pageView",
    current: "currentItem", previous: "previousItem", next: "nextItem",
    first: "firstItem", last: "lastItem", target: "targetElement",
    source: "sourceRef", dest: "destinationRef", from: "fromRef", to: "toRef",
    x: "xCoord", y: "yCoord", z: "zCoord", w: "widthVal", h: "heightVal",
    dx: "deltaX", dy: "deltaY", dt: "deltaTime", t: "timeVal",
    i: "i", j: "j", k: "k", v: "itemValue", e: "eventData", event: "eventData",
    hit: "didHit", touch: "didTouch", click: "didClick",
    mouse: "mouseInput", keyboard: "keyboardInput", touchInput: "touchInput",
    camera: "cameraRef", player: "playerRef", char: "characterRef",
    humanoid: "humanoidRef", root: "rootPart", torso: "torsoPart",
    head: "headPart", arm: "armPart", leg: "legPart",
    tool: "toolRef", weapon: "weaponRef", ammo: "ammoCount",
    health: "healthVal", maxHealth: "maxHealthVal", shield: "shieldVal",
    mana: "manaVal", stamina: "staminaVal", xp: "experience", level: "levelNum",
    gold: "goldAmount", coins: "coinAmount", cash: "cashAmount",
    score: "scoreVal", time: "timeElapsed", timer: "timerRef",
    cooldown: "cooldownTime", delay: "delayTime", duration: "durationTime",
    interval: "intervalTime", rate: "rateVal", speed: "speedVal",
    distance: "distanceVal", range: "rangeVal", radius: "radiusVal",
    angle: "angleVal", rotation: "rotationVal", scale: "scaleVal",
    size: "sizeVal", position: "positionVal", velocity: "velocityVal",
    acceleration: "accelerationVal", force: "forceVal", mass: "massVal",
    color: "colorVal", colour: "colorVal", transparency: "transparencyVal",
    opacity: "opacityVal", brightness: "brightnessVal", contrast: "contrastVal",
    saturation: "saturationVal", hue: "hueVal",
    title: "titleText", subtitle: "subtitleText", text: "textContent",
    label: "labelText", caption: "captionText", description: "descText",
    tooltip: "tooltipText", placeholder: "placeholderText",
    icon: "iconImage", logo: "logoImage", banner: "bannerImage",
    thumbnail: "thumbnailImage", avatar: "avatarImage",
    username: "userName", password: "passWord", email: "emailAddress",
    token: "authToken", session: "sessionId", cookie: "cookieData",
    cache: "cacheStore", storage: "storageRef", database: "dbRef",
    api: "apiEndpoint", endpoint: "apiUrl", host: "hostAddress",
    port: "portNumber", protocol: "protocolType", domain: "domainName",
  };
  
  // Boolean suffixes that indicate a boolean variable
  const boolIndicators = ["ing", "ed", "able", "ible", "ent", "ant"];
  const boolPrefixes = ["is", "has", "can", "should", "will", "did", "was", "were"];
  
  function isBooleanName(name) {
    const lower = name.toLowerCase();
    for (const p of boolPrefixes) if (lower.startsWith(p)) return true;
    return /(ing|ed|able|ible)$/.test(name) && name.length > 4;
  }
  
  function getBetterName(name) {
    const lower = name.toLowerCase();
    // Check generic map (case-insensitive match, preserve original case style)
    if (genericMap[lower]) {
      const replacement = genericMap[lower];
      // Preserve original capitalization
      if (name[0] === name[0].toUpperCase() && name[1] && name[1] === name[1].toLowerCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    }
    // Boolean names get "is" prefix
    if (isBooleanName(name) && !name.toLowerCase().startsWith("is")) {
      return "is" + name.charAt(0).toUpperCase() + name.slice(1);
    }
    // Plural generic collections get "List" suffix (only short names)
    if (name.length <= 8 && name.endsWith("s") && !name.endsWith("ss") && !name.endsWith("us") && !name.endsWith("is")) {
      const singular = name.slice(0, -1);
      if (genericMap[singular.toLowerCase()]) {
        return name + "List";
      }
    }
    return null; // keep original name
  }
  
  const varMap = new Map();
  
  // Find local variable declarations
  const localRegex = /\blocal\s+(?:function\s+)?([a-zA-Z_]\w*)/g;
  let m;
  while ((m = localRegex.exec(source)) !== null) {
    const name = m[1];
    if (reserved.has(name) || varMap.has(name)) continue;
    const better = getBetterName(name);
    if (better && better !== name) varMap.set(name, better);
  }
  
  // Find function parameters
  const paramRegex = /function[\s\w.:]*\(\s*([^)]*)\)/g;
  while ((m = paramRegex.exec(source)) !== null) {
    const params = m[1].split(",").map(p => p.trim().split("=")[0].trim()).filter(Boolean);
    for (const p of params) {
      if (!/^[a-zA-Z_]\w*$/.test(p) || reserved.has(p) || varMap.has(p)) continue;
      const better = getBetterName(p);
      if (better && better !== p) varMap.set(p, better);
    }
  }
  
  // Also detect for-loop variables: for <var> = ... or for <var> in ...
  const forRegex = /\bfor\s+([a-zA-Z_]\w*)\s*(?:=|in)/g;
  while ((m = forRegex.exec(source)) !== null) {
    const name = m[1];
    if (reserved.has(name) || varMap.has(name)) continue;
    const better = getBetterName(name);
    if (better && better !== name) varMap.set(name, better);
  }
  
  // Replace all occurrences (longest first to avoid partial matches)
  let result = source;
  const sorted = [...varMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [oldName, newName] of sorted) {
    const re = new RegExp("\\b" + oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g");
    result = result.replace(re, newName);
  }
  return result;
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
    //    -- full line, --[[ blocks, watermarks / leak credits, // style
    if (t.indexOf("--") === 0 || t.indexOf("--[[") === 0 || t.indexOf("--[=") === 0) {
      if (!isSafeUrl(t)) continue;
    }
    if (/^\[?\s*(LEAKED\s+BY|GOATED|GRABBED\s+BY|COPIED\s+BY|MADE\s+BY|CREDITS?\s*:)/i.test(t)) continue;
    if (/^\s*\/\//.test(t)) continue;
    if (/^\s*\/\*/.test(t) || /^\s*\*\//.test(t)) continue;
    if (/LEAKED\s+BY|\[\s*GOATED\s*\]|GUI\s*Copier/i.test(t) && t.indexOf("--") !== -1) continue;

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

// ============================================================
// LUA BLOCK BALANCER — auto-adds missing `end` / `until`
// ============================================================
function balanceLuaBlocks(code) {
  if (!code || typeof code !== "string") return code;
  const lines = code.split("\n");
  const stack = []; // each entry: "end" or "until"
  let pendingIf = false, pendingForWhile = false;
  for (let line of lines) {
    // Strip long strings [[...]]
    let s = line.replace(/\[\[[\s\S]*?\]\]/g, "");
    // Strip quoted strings
    s = s.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
    // Strip comments
    const ci = s.indexOf("--");
    if (ci >= 0) s = s.slice(0, ci);
    // Tokenize block keywords
    const tokens = s.match(/\b(function|if|then|for|while|do|repeat|end|until|elseif|else)\b/g) || [];
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (t === "function") {
        stack.push("end");
      } else if (t === "repeat") {
        stack.push("until");
      } else if (t === "if") {
        // Look ahead for `then` on same line
        let j = i + 1;
        while (j < tokens.length && tokens[j] !== "then" && tokens[j] !== "end" && tokens[j] !== "until" && tokens[j] !== "function" && tokens[j] !== "if" && tokens[j] !== "for" && tokens[j] !== "while" && tokens[j] !== "repeat") j++;
        if (tokens[j] === "then") { stack.push("end"); i = j; }
        else { pendingIf = true; }
      } else if (t === "then") {
        if (pendingIf) { stack.push("end"); pendingIf = false; }
      } else if (t === "for" || t === "while") {
        let j = i + 1;
        while (j < tokens.length && tokens[j] !== "do" && tokens[j] !== "end" && tokens[j] !== "until" && tokens[j] !== "function" && tokens[j] !== "if" && tokens[j] !== "for" && tokens[j] !== "while" && tokens[j] !== "repeat") j++;
        if (tokens[j] === "do") { stack.push("end"); i = j; }
        else { pendingForWhile = true; }
      } else if (t === "do") {
        if (pendingForWhile) { stack.push("end"); pendingForWhile = false; }
        else { stack.push("end"); } // standalone do
      } else if (t === "end") {
        if (stack.length) stack.pop();
      } else if (t === "until") {
        if (stack.length) stack.pop();
      }
      // else / elseif — ignore
      i++;
    }
  }
  if (!stack.length) return code;
  // Append missing closers — innermost (last pushed) closes first
  let appended = "";
  while (stack.length) {
    const closer = stack.pop();
    appended += closer === "until" ? "\nuntil true" : "\nend";
  }
  return code + appended;
}

// ============================================================
// RENAMER HELPERS — preview builder, URL stripper
// ============================================================
function buildPreviewText(finalOutput) {
  const allLines = finalOutput.split("\n");
  const previewWords = [];
  let wordCount = 0, lineCount = 0;
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
  if (previewText.length > 1000) previewText = previewText.slice(0, 1000) + "\n...";
  return previewText;
}

function buildRenamerDescription(previewText) {
  // Only File Preview (5 lines) — no URL list, no removed message
  return "```lua\n" + previewText + "\n```";
}

// Detect bytecode dumps / non-executable / broken scripts that need full reconstruction
function looksLikeBytecodeOrBroken(src) {
  if (!src || typeof src !== "string") return true;
  const s = src.trim();
  if (s.length < 8) return true;
  // High density of \x hex escapes (classic bytecode dump)
  const hexEscapes = (s.match(/\\x[0-9a-fA-F]{2}/g) || []).length;
  if (hexEscapes >= 15) return true;
  if (hexEscapes >= 5 && s.length < 500) return true;
  // string.dump usage
  if (/string\.dump\s*\(/.test(s)) return true;
  // Lots of non-printable / control characters
  const nonPrintable = (s.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
  if (nonPrintable > 8) return true;
  // Existing detector says Bytecode with decent confidence
  try {
    const det = detectObfuscator(s);
    if (det && det.name === "Bytecode" && det.confidence >= 25) return true;
    if (det && det.name === "VM-Obfuscated" && det.confidence >= 40 && hexEscapes >= 3) return true;
  } catch {}
  // Almost no Lua keywords but has escape sequences = broken / dump
  const luaKeywords = (s.match(/\b(local|function|if|then|else|end|for|while|do|return|and|or|not)\b/g) || []).length;
  if (s.length > 150 && luaKeywords < 3 && /\\x[0-9a-fA-F]{2}|\\[0-9]{1,3}/.test(s)) return true;
  // Pure number / garbage short file
  if (/^[\d\s\\x]+$/i.test(s) && s.length < 200) return true;
  return false;
}

/** True when content is heavy obfuscation / protection and is NOT readable Lua */
function isObfuscatedOrProtectionNotLua(src) {
  if (!src || typeof src !== "string") return true;
  const s = src.trim();
  if (s.length < 5) return true;
  const luaSignals = (s.match(/\b(local|function|end|then|elseif|else|for|while|do|return|game|workspace|Instance\.new|getgenv|task\.|UDim2|Vector3|CFrame|Color3|Players)\b/g) || []).length;
  const hasReadableLua = luaSignals >= 4;
  if (hasReadableLua) return false;
  try {
    const det = detectObfuscator(s);
    const heavyNames = new Set(["Luraph", "Prometheus", "IronBrew", "MoonSec V3", "VM-Obfuscated", "Bytecode", "Luarmor", "PolSec", "WeAreDevs", "DarkEccentric", "Axon"]);
    if (det && heavyNames.has(det.name) && det.confidence >= 35) return true;
  } catch {}
  if (looksLikeBytecodeOrBroken(s)) return true;
  // Protection-style wrapper with little real Lua
  if (/return\s*\(\s*function\s*\(/.test(s.slice(0, 800)) && /\\x[0-9a-fA-F]{2}/.test(s) && luaSignals < 4) return true;
  if (/loadstring\s*\(\s*["'][\s\S]{80,}["']\s*\)/.test(s) && luaSignals < 3) return true;
  const nonAscii = (s.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []).length;
  if (s.length > 100 && nonAscii / s.length > 0.25) return true;
  return false;
}

// Remove ONLY script loaders + IP loggers — Discord webhooks & normal URLs are KEPT
function removeDangerousLines(code) {
  if (!code) return code;
  const lines = code.split("\n");
  const cleaned = lines.filter(line => {
    // Keep Discord webhooks — ALWAYS allowed
    if (/discord(?:app)?\.com\/api\/webhooks/i.test(line)) return true;
    // Script loaders
    if (/loadstring\s*\(\s*(?:game|_G|env|HttpService)\s*[:.]\s*HttpGet/i.test(line)) return false;
    if (/loadstring\s*\(\s*HttpGet/i.test(line)) return false;
    if (/\bHttpGet\s*\(\s*["']http/i.test(line)) return false;
    if (/getcustomasset|getsynasset/i.test(line)) return false;
    if (/synapse|script-?ware|krnl|fluxus|delta|celery|electron|comet|vega\s*x|ironbrew/i.test(line)) return false;
    if (/loadlib|loadfile|dofile.*http/i.test(line)) return false;
    if (/syn\s*\.\s*request\s*\(/i.test(line)) return false;
    // IP loggers / grabbers + more comment/watermark noise lines
    if (/iplogger|ipgrablog|ipify|whatismyip|grabify|logmyip|ipgrabber|stealip|ip-api\.com|icanhazip|ifconfig\.(co|me)|ipinfo\.io|freegeoip/i.test(line)) return false;
    if (/webhook\.site|hook\.billy|iplog\.xyz|blasze|nipiscan|spiderip/i.test(line)) return false;
    if (/^\s*--/.test(line) && !/discord\.(gg|com\/invite)/i.test(line)) return false;
    if (/LEAKED\s+BY|\[\s*GOATED\s*\]|Grabbed by|Copied by|GUI\s*Copier/i.test(line)) return false;
    if (/\/api\/v[0-9]+\/track|\/log\?|\/grab\?/i.test(line)) return false;
    if (/ip\s*[=:]\s*["']?\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i.test(line)) return false;
    if (/(?:new\s+)?WebSocket\s*\(/i.test(line)) return false;
    return true;
  });
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Check if text contains any script loader or IP logger (webhooks excluded)
function hasDangerousContent(text) {
  if (!text) return false;
  for (const line of text.split("\n")) {
    if (/discord(?:app)?\.com\/api\/webhooks/i.test(line)) continue;
    if (/loadstring\s*\(\s*(?:game|_G|env|HttpService)\s*[:.]\s*HttpGet/i.test(line)) return true;
    if (/loadstring\s*\(\s*HttpGet/i.test(line)) return true;
    if (/\bHttpGet\s*\(\s*["']http/i.test(line)) return true;
    if (/getcustomasset|getsynasset/i.test(line)) return true;
    if (/synapse|script-?ware|krnl|fluxus|delta|celery|electron|comet|vega\s*x|ironbrew/i.test(line)) return true;
    if (/loadlib|loadfile|dofile.*http/i.test(line)) return true;
    if (/syn\s*\.\s*request\s*\(/i.test(line)) return true;
    if (/iplogger|ipgrablog|ipify|whatismyip|grabify|logmyip|ipgrabber|stealip/i.test(line)) return true;
    if (/webhook\.site|hook\.billy|iplog\.xyz/i.test(line)) return true;
    if (/\/api\/v[0-9]+\/track|\/log\?|\/grab\?/i.test(line)) return true;
    if (/ip\s*[=:]\s*["']?\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i.test(line)) return true;
    if (/(?:new\s+)?WebSocket\s*\(/i.test(line)) return true;
  }
  return false;
}

// Precise check: returns true ONLY when actual script-loader URLs or IP-logger URLs are found.
// Unlike hasDangerousContent, this does NOT trigger on executor names (synapse/fluxus/krnl/etc.),
// WebSocket constructors, or bare IP-address patterns — only on URL-based loaders & loggers.
function hasScriptLoaderOrIpLogger(text) {
  if (!text) return false;
  const urlRegex = /https?:\/\/[^\s"'()\]]+/gi;
  const urls = text.match(urlRegex) || [];
  const ipLoggerDomains = [
    "iplogger.org","iplogger.com","iplogger.ru","iplogger.info","iplogger.net",
    "grabify.link","grabify.xyz","grabify.tk","nipiscan.com","spiderip.com",
    "blasze.tk","blasze.com","ip-api.com","ipify.org","icanhazip.com","ifconfig.co","ifconfig.me",
    "whatismyip.com","ipinfo.io","ipgeolocation.io","freegeoip.net","freegeoip.app",
    "checkip.amazonaws.com","webhook.site","hook.billy","iplog.xyz","logmyip.com",
    "ipgrabber","stealip","ip-logger","ipgrab","iplog","logger","grabip","trackip",
    "ip-tracker","ip-trace","ipgrabbed","iplogged","ip-grabber","iplogger","grabify"
  ];
  // 1) Check every URL found in the text against known IP-logger / grabber domains
  for (const u of urls) {
    const lower = u.toLowerCase();
    // Discord webhooks & safe CDN links are always allowed
    if (/discord(?:app)?\.com\/api\/webhooks/i.test(lower)) continue;
    if (/discord\.(gg|com\/invite)\//i.test(lower)) continue;
    if (/files\.catbox\.moe\//i.test(lower)) continue;
    for (const dom of ipLoggerDomains) {
      if (lower.includes(dom)) return true;
    }
    // URL shorteners often hide loggers — flag them
    if (/^(?:https?:\/\/)?(?:bit\.ly|tinyurl\.com|is\.gd|t\.co|ow\.ly|rb\.gy|cutt\.ly|bc\.vc|adf\.ly|linkvertise\.com|shorte\.st|bcvc\.one)\/?/i.test(lower)) return true;
  }
  // 2) Check for script-loader patterns that fetch from a URL (webhooks excluded)
  for (const line of text.split("\n")) {
    if (/discord(?:app)?\.com\/api\/webhooks/i.test(line)) continue;
    // loadstring(game:HttpGet("http...")) / loadstring(HttpGet("http..."))
    if (/loadstring\s*\(\s*(?:game|_G|env|HttpService)\s*[:.]\s*HttpGet\s*\(\s*["']https?:\/\//i.test(line)) return true;
    if (/loadstring\s*\(\s*HttpGet\s*\(\s*["']https?:\/\//i.test(line)) return true;
    if (/\bHttpGet\s*\(\s*["']https?:\/\//i.test(line)) return true;
    // HttpService:GetAsync("http...")
    if (/HttpService\s*[:.]\s*GetAsync\s*\(\s*["']https?:\/\//i.test(line)) return true;
    // syn.request({ Url = "http..." }) / http.get("http...")
    if (/syn\s*\.\s*request\s*\([^)]*https?:\/\//i.test(line)) return true;
    if (/http\s*\.\s*(?:get|request)\s*\(\s*["']https?:\/\//i.test(line)) return true;
    // require("http...") / loadlib / loadfile / dofile with http
    if (/require\s*\(\s*["']https?:\/\//i.test(line)) return true;
    if (/(?:loadlib|loadfile|dofile)\s*\([^)]*https?:\/\//i.test(line)) return true;
    // pcall/xpcall wrapping loadstring with a URL fetch
    if (/(?:pcall|xpcall)\s*\(\s*loadstring[^)]*https?:\/\//i.test(line)) return true;
  }
  return false;
}

// ============================================================
// GROQ AI CLEANER — smart renaming + fixing via Groq API
// ============================================================

// Strip GUI Copier header blocks (non-comment junk injected at the top of grabbed scripts).
// e.g.:
//   Clean Speed Bypass  (ScreenGui)
//       Grabbed by Xavi GUI Copier v6.4.4 on 2026-09-27 14:37:38
//       Discord: https://discord.gg/...
//       56 instances
// These lines are NOT Lua comments and would cause syntax errors — always remove them.
function stripGuiCopierHeader(source) {
  if (!source || typeof source !== "string") return source;
  // First: remove big --[[ ... ]] documentation / reconstruction header blocks
  source = source.replace(/--\s*\[\[([\s\S]*?)\]\]/g, (block, inner) => {
    const t = String(inner || "");
    // Doc/reconstruction banners — delete entire block
    if (
      /reconstructed/i.test(t) ||
      /execution\s+log/i.test(t) ||
      /ScreenGui\s*:/i.test(t) ||
      /Root\s*:/i.test(t) ||
      /Layout\s*:/i.test(t) ||
      /ModeToggle/i.test(t) ||
      /CollapsedBtn/i.test(t) ||
      /={5,}/.test(t) ||
      /-{5,}/.test(t) ||
      /deob\s+by/i.test(t) ||
      /1:1\s+from/i.test(t)
    ) {
      return "";
    }
    // Keep real long-string style comments that are short functional notes
    return block;
  });
  const lines = source.split(/\r?\n/);
  const instanceTypes = "(?:ScreenGui|Frame|TextLabel|TextButton|ImageLabel|ImageButton|ScrollingFrame|TextBox|UIListLayout|UIPadding|UICorner|UIScale|UIStroke|UIGradient|UIAspectRatioConstraint|UISizeConstraint|UITextSizeConstraint|CanvasGroup|VideoFrame|ViewportFrame|BillboardGui|SurfaceGui)";
  const headerPatterns = [
    new RegExp("^\\s*.*\\(" + instanceTypes + "\\)\\s*$", "i"),
    /^\s*Grabbed\s+by\s+.*$/i,
    /^\s*Discord\s*:.*$/i,
    /^\s*\d+\s+instances?\s*$/i,
    /^\s*Copied\s+by\s+.*$/i,
    /^\s*Grabbed\s+from\s+.*$/i,
    /^\s*--\s*deob\s+by\s+/i,
    /^\s*--\s*rename\s+by\s+/i,
    /^\s*ScreenGui\s*:/i,
    /^\s*Root\s*:/i,
    /^\s*Layout\s*:/i,
    /^\s*Discord\s*:/i,
    /\[?\s*LEAKED\s+BY\s+[^\]]*\]?/i,
    /\[?\s*GOATED\s*\]?/i,
    /^\s*--\s*\[?\s*LEAKED\s+BY/i,
    /^\s*--\s*\[?\s*GOATED/i,
    /^\s*-{5,}\s*$/,
    /^\s*={5,}\s*$/,
  ];
  const realCodeStart = /^\s*(local|function|if|while|for|repeat|return|do|game|workspace|script|getgenv|gethui|loadstring|require|pcall|xpcall|task|spawn|Instance|print|warn|assert|error|setreadonly|hookfunction|hookmetamethod|getrawmetatable|getnamecallmethod|getconnections|firesignal|fireclickdetector|writefile|readfile|makefolder|delfolder|loadfile|dofile|TweenService|UserInputService|RunService|ReplicatedStorage|StarterGui|CoreGui|Lighting|TeleportService|MarketplaceService|HttpService|InsertService)\b/;
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }
    if (realCodeStart.test(lines[i])) break;
    let matched = false;
    for (const pat of headerPatterns) {
      if (pat.test(lines[i])) { matched = true; break; }
    }
    // Also strip pure comment lines at top that are doc-like
    if (!matched && /^\s*--/.test(lines[i]) && (/reconstructed|ScreenGui\s*:|Root\s*:|Layout\s*:|execution\s+log|={3,}|-{3,}/i.test(lines[i]))) {
      matched = true;
    }
    if (matched) { i++; continue; }
    break;
  }
  return lines.slice(i).join("\n").replace(/^\s*\n+/, "");
}

// Post-cleanup: strip any remaining lines that are clearly not Lua code
// (GUI Copier remnants, bare text, markdown, headers, junk comments that slipped through).
// Preserves real Lua code, Discord webhooks, and valid URLs inside strings.
function stripNonLuaJunk(code) {
  if (!code || typeof code !== "string") return code;
  const lines = code.split(/\r?\n/);
  // Lines that look like real Lua (keywords, comments, assignments, calls, table/index syntax)
  const looksLikeLua = (line) => {
    const t = line.trim();
    if (!t) return true; // keep blank lines (cleaned later)
    // Lua comments
    if (/^\s*--/.test(line)) return true;
    // Long string open/close
    if (/\[\[|\]\]/.test(line)) return true;
    // Common Lua / Roblox keywords & globals at start of statement
    if (/^\s*(local|function|if|then|else|elseif|end|for|while|do|repeat|until|return|break|and|or|not|in|nil|true|false)\b/.test(line)) return true;
    if (/^\s*(game|workspace|script|Instance|getgenv|gethui|getrenv|getrawmetatable|setreadonly|hookfunction|hookmetamethod|getnamecallmethod|getconnections|firesignal|fireclickdetector|writefile|readfile|makefolder|delfolder|loadfile|dofile|loadstring|require|pcall|xpcall|task|spawn|delay|wait|print|warn|assert|error|tonumber|tostring|type|typeof|pairs|ipairs|next|select|unpack|rawget|rawset|setmetatable|getmetatable|string|table|math|os|io|debug|coroutine|bit|bit32|utf8|buffer)\b/.test(line)) return true;
    if (/^\s*(TweenService|UserInputService|RunService|ReplicatedStorage|StarterGui|CoreGui|Lighting|TeleportService|MarketplaceService|HttpService|InsertService|Players|Debris|CollectionService|PathfindingService|SoundService|Chat|TextService|ProximityPromptService)\b/.test(line)) return true;
    // Assignment / method call / indexing
    if (/[=():{}\[\].]/.test(line) && /[a-zA-Z_]/.test(line)) return true;
    // String-only line (could be continuation)
    if (/^["'`].*["'`]$/.test(t)) return true;
    // Discord webhook URLs kept (functional)
    if (/discord(?:app)?\.com\/api\/webhooks/i.test(line)) return true;
    // http(s) URLs inside possible lua string context
    if (/^https?:\/\//i.test(t) && /discord|paste|raw|github|catbox|roblox/i.test(t)) return true;
    return false;
  };
  const junkPatterns = [
    /^\s*Grabbed\s+by\s+/i,
    /^\s*Copied\s+by\s+/i,
    /^\s*Grabbed\s+from\s+/i,
    /\[?\s*LEAKED\s+BY\s+[^\]]*\]?/i,
    /\[?\s*GOATED\s*\]?/i,
    /^\s*--\s*\[?\s*LEAKED\s+BY/i,
    /^\s*--\s*\[?\s*GOATED/i,
    /^\s*Discord\s*:/i,
    /^\s*\d+\s+instances?\s*$/i,
    /^\s*Script\s+Copier/i,
    /^\s*GUI\s+Copier/i,
    /^\s*Copier\s+v?\d/i,
    /^\s*```(?:lua)?\s*$/i,
    /^\s*```\s*$/i,
    /^\s*.*\((?:ScreenGui|Frame|TextLabel|TextButton|ImageLabel|ImageButton|ScrollingFrame|TextBox|UIListLayout|UIPadding|UICorner|UIScale|UIStroke|UIGradient|CanvasGroup|BillboardGui|SurfaceGui)\)\s*$/i,
    /^\s*#\s/,
    /^\s*\*\*.*\*\*\s*$/,
    /^\s*Note:|^\s*Here\s+is|^\s*This\s+(?:script|code)|^\s*I\s+(?:have|added|removed)/i,
  ];
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { out.push(line); continue; }
    let isJunk = false;
    for (const pat of junkPatterns) {
      if (pat.test(line)) { isJunk = true; break; }
    }
    // Delete any line that does not look like Lua
    if (!isJunk && !looksLikeLua(line)) isJunk = true;
    if (!isJunk) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function aiCleanScript(source, mode) {
  // Always strip GUI Copier header blocks first (junk comments — always safe to remove)
  source = stripGuiCopierHeader(source);
  // Fallback to regex methods if OpenAI not configured
  if (!openaiClient) {
    console.warn("⚠️ OPENAI_API_KEY not set — falling back to regex.");
    let out = mode === "var" ? renameVariables(source) : balanceLuaBlocks(cleanLuaScript(source));
    return stripNonLuaJunk(out);
  }
  try {
    const varPrompt = `You are a Lua/Roblox variable renaming expert. Rename variables in the script below with these rules:
1. Rename ALL variables, functions, and parameters from generic/obfuscated names to meaningful descriptive names
2. Keep the EXACT same logic, structure, and behavior — do NOT add, remove, or change any functionality
3. CRITICAL: Do NOT remove ANY script loaders, HttpGet, URLs, webhooks, IP loggers, or any functional code. Loader/logger removal is handled separately — you MUST preserve them exactly.
4. Do NOT add or remove functional lines. DELETE watermark / credit / leak comments such as: [ LEAKED BY SOLAR ], [ GOATED ], "LEAKED BY ...", "GOATED", Grabbed by..., Discord:..., N instances, and any similar non-code noise.
5. Output MUST be valid Roblox-executable Lua (Luau-compatible): balanced if/then/end, function/end, correct Instance.new / game:GetService usage. No Python/JS syntax.
6. Output ONLY the renamed Lua code — no explanations, no markdown fences, no extra text

SCRIPT:
${source}`;

    const readablePrompt = `You are an elite Luau/Roblox RECONSTRUCTION engineer. Your job is behavior-preserving source reconstruction — NOT pretty-printing, NOT minifying, NOT guessing.

MISSION: Turn the input into valid, readable, 100% executable Luau that runs in a Roblox executor (Synapse, Wave, Delta, etc.) with the SAME behavior as the original.

RECONSTRUCTION PIPELINE (FOLLOW IN ORDER):
1. Identify every remaining VM dispatcher / control-flow-flattening layer.
2. Reconstruct the original control-flow graph.
3. Recover if/elseif/else, while, repeat, and for structures where evidence supports them.
4. Resolve constant/table indirection and remaining encoded values.
5. Trace VM registers/state variables back into meaningful local variables.
6. Rename variables/functions based only on their actual usage.
7. Remove dead VM scaffolding after proving it is unreachable.
8. Preserve Roblox API calls, RemoteEvents, UI behavior, callbacks, metatables, and side effects exactly.
9. Do not remove functionality merely because it looks suspicious.
10. Do not guess. If something cannot be reconstructed, leave a clearly marked comment explaining exactly what information is missing (e.g. -- MISSING: unresolved dispatcher state 14).
11. Produce valid, readable Luau source rather than pseudocode.
12. Compare the reconstructed control flow against the original dispatcher so every removed state has a documented destination.

ROBLOX / LUAU EXECUTION RULES (MANDATORY):
- Output MUST parse and run as Luau in Roblox. No Python, JS, or pseudocode.
- Balance EVERY if/then/end, function/end, do/end, repeat/until. Zero dangling or missing ends.
- Correct APIs only: game:GetService("Name"), Instance.new("ClassName"), UDim2.new / UDim2.fromScale, Vector3.new, CFrame.new, Color3.fromRGB, task.wait, task.spawn, task.defer.
- Keep FireServer / InvokeServer / :Connect / :Once / AncestryChanged / ChildAdded and all real side effects.
- Prefer locals. Do not invent globals the original did not use.
- Indentation: 2 spaces.

DELETE JUNK / WATERMARKS (ALWAYS):
- [ LEAKED BY SOLAR ], [ GOATED ], LEAKED BY ..., GOATED, Grabbed by..., Copied by..., Discord header spam
- GUI Copier headers, reconstruction doc banners, markdown fences, bare non-Lua prose
- Dead VM scaffolding only AFTER step 7 proves it unreachable

PRESERVE:
- All real loaders, HttpGet, remotes, webhooks, UI, metatables, hooks, and logic
- Replace Discord invite links with: https://discord.gg/TBBAUZu8cW

OUTPUT RULES (ABSOLUTE):
- Output ONLY pure Luau source — nothing else
- No markdown, no \`\`\` fences, no explanations before/after the code
- No "Here is the script" prose
- No big --[[ documentation headers ]]
- Goal is behavior-preserving source reconstruction, not merely pretty-printing

SCRIPT TO RECONSTRUCT:
${source}`;

    const cleanupPrompt = `You are a Luau/Roblox script CLEANER only.
Your ONLY job:
1. Remove ALL comments (full-line and inline): -- comments, --[[ multi-line ]], --[=[ ]=]
2. Remove IP loggers / grabbers (iplogger, grabify, ip-api, bit.ly used for tracking, etc.)
3. Remove Script Loaders: loadstring(...), game:HttpGet, HttpService:GetAsync used to load remote scripts, require("https://...")
4. Remove watermark / leak credit lines: [ LEAKED BY ... ], [ GOATED ], Grabbed by..., Copied by..., Discord spam headers
5. Remove empty leftover blank lines (collapse 3+ newlines to 2)

DO NOT:
- Deobfuscate, rename variables, reconstruct control flow, or rewrite logic
- Remove real game logic, remotes, UI, or legitimate HttpGet that is not a loader pattern if unsure — when it looks like loadstring/HttpGet loader, remove it
- Add new code or explanations

OUTPUT: ONLY the cleaned Luau source. No markdown fences. No prose.

SCRIPT:
${source}`;

    const prompt = mode === "var" ? varPrompt : mode === "cleanup" ? cleanupPrompt : readablePrompt;

    const completion = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: mode === "readable" ? 0.2 : 0.3,
      max_tokens: 16000,
    });
    let output = completion.choices[0]?.message?.content || "";
    // Strip markdown fences if AI added them
    output = output.replace(/^```(?:lua)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    if (!output) throw new Error("Empty AI response");
    // Strip watermark / leak credit comments the model might leave
    output = output
      .replace(/\[?\s*LEAKED\s+BY\s+[^\]]*\]?/gi, "")
      .replace(/\[?\s*GOATED\s*\]?/gi, "")
      .replace(/^\s*--\s*\[?\s*LEAKED\s+BY.*$/gim, "")
      .replace(/^\s*--\s*\[?\s*GOATED.*$/gim, "");
    // Final pass: strip any non-Lua junk that slipped through
    output = stripNonLuaJunk(output);
    // Balance if/function/do/end so reconstructed output is more likely to execute in Roblox
    if (mode === "readable") output = balanceLuaBlocks(output);
    return output;
  } catch (e) {
    console.warn("⚠️ OpenAI clean failed, falling back to regex:", e.message?.slice(0, 120));
    let out = mode === "var" ? renameVariables(source) : balanceLuaBlocks(cleanLuaScript(source));
    return stripNonLuaJunk(out);
  }
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
    .addStringOption(o => o
      .setName("footer")
      .setDescription("Optional embed footer (omit for no footer).")
      .setRequired(false))
    .addStringOption(o => o
      .setName("color")
      .setDescription("Optional embed color hex (e.g. #5865F2 or blurple).")
      .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("finderpanel")
    .setDescription("Post Finder Source Panel — Owner Only.")
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
    console.log("🧩 Registering global slash commands...");
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
  const liveN = Array.isArray(config.liveScanChannelIds) ? config.liveScanChannelIds.length : 0;
  console.log(`📡 LiveScan channels: ${liveN}${liveN ? " → " + config.liveScanChannelIds.map(String).join(", ") : ""}`);
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
// Server Tag changes arrive via userUpdate / guildMemberUpdate
client.on("userUpdate", async (oldUser, newUser) => {
  try {
    const oldPg = oldUser?.primaryGuild;
    const newPg = newUser?.primaryGuild;
    const changed =
      String(oldPg?.identityGuildId || "") !== String(newPg?.identityGuildId || "") ||
      Boolean(oldPg?.identityEnabled) !== Boolean(newPg?.identityEnabled);
    if (!changed) return;
    const mainGuild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!mainGuild) return;
    const member = await mainGuild.members.fetch(newUser.id).catch(() => null);
    if (member) await syncPrinceRole(member);
  } catch (e) {
    console.warn(`⚠️ userUpdate tag sync: ${e.message}`);
  }
});
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (!newMember || newMember.guild.id !== GUILD_ID) return;
  await syncPrinceRole(newMember);
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
    .setColor(BLURPLE)
    .setDescription(
`**\`.rename\`** [\`.rn\`] Remove comments, IP loggers, script loaders.

**\`.obf\`** Obfuscate your script — encrypt strings, Anti-Debug, Anti-Dump, make code unreadable.

**\`.download\`** [\`.dl\`] File link, TikTok Video, using link, etc.`
    ),
  new EmbedBuilder()
    .setTitle("Help Menu")
    .setColor(BLURPLE)
    .setDescription(
`**\`.et\`** Extract files from zip archives.

**\`.upload\`** Turn your file into Script Loader.

**\`.get\`** Get file using ID.`
    ),
  new EmbedBuilder()
    .setTitle("Help Menu")
    .setColor(BLURPLE)
    .setDescription(
`**\`.find\`** Search files by name.

**\`.delwh\`** Delete a webhook using its URL.

**\`.whs\`** Webhook Spammer — Raid a Webhook using its URL.`
    ),
  new EmbedBuilder()
    .setTitle("Help Menu")
    .setColor(BLURPLE)
    .setDescription(
`**\`.coinflip\`** Flip a coin — win or lose **1 token**.

Regular users start with **10 tokens**/day. Most commands cost **1 token**.
\`.help\` · \`.find\` · \`.redeem\` are free.`
    ),
  // Yellow premium page — always last
  new EmbedBuilder()
    .setTitle("Help Menu")
    .setColor(YELLOW_COLOR)
    .setDescription(
`**\`.redeem\`** [\`.red\`] - Redeem a premium key.

> Premium users can use all commands in DMs.
> Premium users have unlimited tokens.`
    )
];
const helpSessions = new Map();

// ============================================================
// BUTTON HANDLER
// ============================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  const uid = interaction.user.id;
  // ─── RENAME MODE BUTTONS ───
  if (interaction.customId?.startsWith("rename_")) {
    const parts = interaction.customId.split("_");
    const mode = parts[1]; // "var" or "readable"
    const ownerId = parts.slice(2).join("_");
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: "❌ not yours, bro.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const ctx = renamePanels.get(interaction.message.id);
    if (!ctx) {
      return interaction.reply({ content: "loading, please wait...", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    renamePanels.delete(interaction.message.id);
    
    // Edit to loading embed
    const loadingEmbed = new EmbedBuilder()
      .setColor(GRAY_COLOR)
      .setTitle("Renaming...")
      .setDescription("⏳ Processing...");
    await interaction.update({ embeds: [loadingEmbed], components: [] }).catch(() => {});
    
    // Process in background
    (async () => {
      try {
        // Use pre-downloaded content if available (avoids expired CDN URLs)
        let text = ctx.fileContent;
        if (!text) {
          const res = await fetch(ctx.fileUrl);
          if (!res.ok) throw new Error(`File link expired (HTTP ${res.status}) — run .rename again`);
          text = await res.text();
        }
        if (!text || text.trim().length < 5) throw new Error("File is empty or unreadable, bro");
        // Reject pure obfuscation / protection that is not readable Lua
        if (isObfuscatedOrProtectionNotLua(text)) {
          await interaction.message.delete().catch(() => {});
          await interaction.channel.send({ content: `<@${interaction.user.id}> ❌ this is obufscated or protection code, try another.` }).catch(() => {});
          return;
        }
        // Always strip GUI Copier header blocks (they're junk comments, not loaders/loggers)
        text = stripGuiCopierHeader(text);
        const urlRegex = /https?:\/\/[^\s"'()\]]+/g;
        const foundUrls = text.match(urlRegex) || [];
        
        // If script looks like bytecode / non-executable / broken → force full Reconstruction
        let effectiveMode = mode;
        if (looksLikeBytecodeOrBroken(text)) {
          effectiveMode = "readable";
          console.log("⚡ Bytecode/broken script detected → forcing Reconstruction mode");
        }
        
        const startTime = Date.now();
        let finalOutput = await aiCleanScript(text, effectiveMode);
        if (!finalOutput || !finalOutput.trim()) throw new Error("Processing returned empty output — try the other rename mode, bro");
        const finishSec = ((Date.now() - startTime) / 1000).toFixed(1);
        
        const randChars = "abcdefghijklmnopqrstuvwxyz";
        let outputName = "";
        for (let i = 0; i < 20; i++) outputName += randChars.charAt(Math.floor(Math.random() * randChars.length));
        outputName += ".lua";
        
        // AUTO-REMOVE script loaders & IP loggers
        const uniqueUrls = [...new Set(foundUrls)];
        finalOutput = removeDangerousLines(finalOutput);

        // Build result with URL Found report
        const previewText = buildPreviewText(finalOutput);
        let description = buildRenamerDescription(previewText);
        if (uniqueUrls.length > 0) {
          const urlList = uniqueUrls.slice(0, 10).map(u => `- ${u}`).join("\n");
          description += `\n\n**URL Found:**\n${urlList}${uniqueUrls.length > 10 ? `\n- ...and ${uniqueUrls.length - 10} more` : ""}`;
        }
        // Tokens left go in message text only — not embed
        const resultEmbed = new EmbedBuilder()
          .setColor(BLURPLE)
          .setTitle("File Preview")
          .setDescription(description)
          .setFooter({ text: `Request by @${interaction.user.username}│Prince Renamer`, iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 128 }) });
        const fixedFile = new AttachmentBuilder(Buffer.from(finalOutput, "utf-8"), { name: outputName });
        
        await interaction.message.delete().catch(() => {});
        await interaction.channel.send({
          content: `<@${interaction.user.id}> Here you go twin!\n**Finish in:** \`${finishSec}s\``,
          files: [fixedFile],
          embeds: [resultEmbed]
        }).catch(() => {});
      } catch (e) {
        await interaction.message.delete().catch(() => {});
        interaction.channel.send(`❌ error: ${e.message.slice(0, 150)}`).catch(() => {});
      }
    })();
    return;
  }

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
    .setColor(REGULAR_COLOR)
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
    const embed = new EmbedBuilder()
      .setColor(BLURPLE)
      .setTitle(getFinderTitle(menu.isBuyer))
      .setDescription(pageItems.map(f => `\`${f.filename}\` — ID: \`${f.id}\``).join("\n"))
      .setFooter({ text: `Pages ${menu.page}/${menu.totalPages} │ Prince Finder` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(menu.page <= 1),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(menu.page >= menu.totalPages)
    );
    await interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
    paginationMenus.set(uid, menu);
    return;
  }
  // ─── FINDER PANEL BUTTONS (never expire) — tokens charged on modal submit ───
  if (interaction.customId === "finderpanel_redeem") {
    const modal = new ModalBuilder()
      .setCustomId("finderpanel_redeem_modal")
      .setTitle("Redeem Premium Key");
    const keyInput = new TextInputBuilder()
      .setCustomId("finderpanel_key")
      .setLabel("Premium Key")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("PRINCE-XXXXXXXXXXXX")
      .setRequired(true)
      .setMaxLength(80);
    modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
    return interaction.showModal(modal).catch(() => {});
  }
  if (interaction.customId === "finderpanel_find" || interaction.customId === "finderpanel_get") {
    const uid = interaction.user.id;
    // Server Tag required for non-owner / non-buyer
    const buyer = isOwner(uid) || await isBuyer(uid, interaction.member);
    if (!buyer) {
      const hasTag = await hasPrinceStatus(uid);
      if (!hasTag) {
        const tagEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle("Input Error")
          .setDescription("**Tips:**\n- Go on your profile, click `Edit Profile` then scroll down, you’ll see the `Select a Server Tag` click it then use our Server Tag.");
        return interaction.reply({ embeds: [tagEmbed], flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    if (interaction.customId === "finderpanel_find") {
      const modal = new ModalBuilder()
        .setCustomId("finderpanel_find_modal")
        .setTitle("Find Source");
      const queryInput = new TextInputBuilder()
        .setCustomId("finderpanel_query")
        .setLabel("File name")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Type the file name to search...")
        .setRequired(true)
        .setMaxLength(100);
      modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
      return interaction.showModal(modal).catch(() => {});
    }
    // Get
    const modal = new ModalBuilder()
      .setCustomId("finderpanel_get_modal")
      .setTitle("Get Source by ID");
    const idInput = new TextInputBuilder()
      .setCustomId("finderpanel_ids")
      .setLabel(buyer ? "File ID(s) — premium: up to 10" : "File ID — 1 only")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(buyer ? "id1 id2 ..." : "single file id")
      .setRequired(true)
      .setMaxLength(120);
    modal.addComponents(new ActionRowBuilder().addComponents(idInput));
    return interaction.showModal(modal).catch(() => {});
  }
  // ─── WHS START BUTTON ───
  if (interaction.customId === "whs_start") {
    // Works in DMs and servers — no member check needed
    // Only the person who ran .whs can click Start
    const ownerId = whsPanelOwners.get(interaction.message.id);
    if (ownerId && interaction.user.id !== ownerId) {
      return interaction.reply({ content: "❌ not yours, bro.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    
    // Build modal — matches Webhook Spam Settings form
    const modal = new ModalBuilder()
      .setCustomId("whs_modal")
      .setTitle("Webhook Spam Settings");
    
    const urlInput = new TextInputBuilder()
      .setCustomId("whs_url")
      .setLabel("Webhook URL")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Place webhook here")
      .setRequired(true)
      .setMaxLength(300);
    
    const timeInput = new TextInputBuilder()
      .setCustomId("whs_time")
      .setLabel("Time (seconds)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Max 60 seconds")
      .setRequired(true)
      .setMaxLength(2);
    
    const msgInput = new TextInputBuilder()
      .setCustomId("whs_message")
      .setLabel("Message")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Enter message (max 2000 chars)")
      .setRequired(true)
      .setMaxLength(2000);
    
    const delInput = new TextInputBuilder()
      .setCustomId("whs_delete")
      .setLabel("Delete after process (y/n)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("y or n")
      .setRequired(true)
      .setMaxLength(3)
      .setValue("y");
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(urlInput),
      new ActionRowBuilder().addComponents(timeInput),
      new ActionRowBuilder().addComponents(msgInput),
      new ActionRowBuilder().addComponents(delInput)
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

  // ── Finder Panel: Redeem modal ──
  if (interaction.customId === "finderpanel_redeem_modal") {
    const key = (interaction.fields.getTextInputValue("finderpanel_key") || "").trim();
    if (!key) {
      return interaction.reply({ content: "❌ put a key.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const redeemIsBuyer = isOwner(interaction.user.id) || await isBuyer(interaction.user.id, interaction.member);
    if (redeemIsBuyer && !isOwner(interaction.user.id)) {
      return interaction.reply({ content: "❌ you already got a key, lol.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const rec = keyStore.keys.find(k => k.key === key);
    if (!rec) {
      return interaction.reply({ content: "❌ Invalid key.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (rec.redeemedBy) {
      return interaction.reply({ content: "❌ this key was already redeem.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    rec.redeemedBy = interaction.user.id;
    rec.redeemedAt = Date.now();
    if (rec.durationMs) rec.expiresAt = Date.now() + rec.durationMs;
    else rec.expiresAt = null;
    const tmp = `${KEYS_FILE}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(keyStore, null, 2)); fs.renameSync(tmp, KEYS_FILE); } catch {}
    try {
      const g = await client.guilds.fetch(GUILD_ID);
      const m = await g.members.fetch(interaction.user.id);
      await m.roles.add(BUYER_ROLE_ID);
    } catch (e) {
      return interaction.reply({ content: "❌ Key saved but failed to assign role: " + e.message, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return interaction.reply({ content: "✅ key redeemed successfully.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  // ── Finder Panel: Find modal (costs 1 token for regulars) ──
  if (interaction.customId === "finderpanel_find_modal") {
    const query = (interaction.fields.getTextInputValue("finderpanel_query") || "").trim();
    if (!query) {
      return interaction.reply({ content: "❌ put a file name.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const isBuyerUser = isOwner(interaction.user.id) || await isBuyer(interaction.user.id, interaction.member);
    if (!isBuyerUser) {
      const hasTag = await hasPrinceStatus(interaction.user.id);
      if (!hasTag) {
        return interaction.reply({ content: "❌ adopt the Server Tag first.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    // Token cost (panel Find always costs — unlike prefix .find)
    const tok = tryConsumeToken(interaction.user.id, isBuyerUser);
    if (!tok.ok) {
      return interaction.reply({ embeds: [tokenWaitEmbed(tok.waitUntil)], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    logFinderPanel(interaction.user, "Find", `Query: \`${query}\``).catch(() => {});
    const results = findFiles(query);
    if (!results.length) {
      // Error — no tokens left line
      return interaction.reply({
        content: `❌ no found for that, dumbass.`,
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
    // Finder source embeds — never show tokens left
    const perPage = 8;
    const totalPages = Math.ceil(results.length / perPage);
    const pageItems = results.slice(0, perPage);
    const desc = pageItems.map(f => `\`${f.filename}\` — ID: \`${f.id}\``).join("\n");
    const embed = new EmbedBuilder()
      .setColor(BLURPLE)
      .setTitle(getFinderTitle(isBuyerUser))
      .setDescription(desc)
      .setFooter({ text: `Pages 1/${totalPages} │ Prince Finder` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(totalPages <= 1)
    );
    await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral }).catch(() => {});
    const replyMsg = await interaction.fetchReply().catch(() => null);
    if (replyMsg) {
      paginationMenus.set(interaction.user.id, {
        results, page: 1, totalPages, messageId: replyMsg.id,
        authorId: interaction.user.id, createdAt: Date.now(), isBuyer: isBuyerUser
      });
    }
    return;
  }

  // ── Finder Panel: Get modal (costs 1 token for regulars) ──
  if (interaction.customId === "finderpanel_get_modal") {
    const raw = (interaction.fields.getTextInputValue("finderpanel_ids") || "").trim();
    if (!raw) {
      return interaction.reply({ content: "❌ put id of file, idiot.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const isBuyerUser = isOwner(interaction.user.id) || await isBuyer(interaction.user.id, interaction.member);
    if (!isBuyerUser) {
      const hasTag = await hasPrinceStatus(interaction.user.id);
      if (!hasTag) {
        return interaction.reply({ content: "❌ adopt the Server Tag first.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    const args = raw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    if (!args.length) {
      return interaction.reply({ content: "❌ put id of file, idiot.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const maxGetIds = isBuyerUser ? 10 : 1;
    if (args.length > maxGetIds) {
      return interaction.reply({
        content: isBuyerUser ? "❌ max 10 id only, dumbass." : "❌ buy premium if you want multiple id.",
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
    const tok = tryConsumeToken(interaction.user.id, isBuyerUser);
    if (!tok.ok) {
      return interaction.reply({ embeds: [tokenWaitEmbed(tok.waitUntil)], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    logFinderPanel(interaction.user, "Get", `ID(s): \`${args.join(", ")}\``).catch(() => {});
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const filesToSend = [];
    const notFound = [];
    for (const id of args) {
      const file = getFile(id);
      if (!file) { notFound.push(id); continue; }
      const freshUrl = await getFreshUrl(file);
      filesToSend.push({ attachment: freshUrl || file.url, name: file.filename || "file" });
    }
    if (!filesToSend.length) {
      // Error — no tokens left line
      await interaction.editReply({
        content: `❌ your id is wrong, try find working id, dumbass.`
      }).catch(() => {});
      return;
    }
    const tokSuffix = isBuyerUser ? "" : `\n${tokenLeftLine(tok.tokens, false)}`;
    for (let i = 0; i < filesToSend.length; i += 10) {
      const batch = filesToSend.slice(i, i + 10);
      const content = i === 0
        ? "**Here you go!**" + (notFound.length ? `\n❌ Not found: \`${notFound.join("`, `")}\`` : "") + tokSuffix
        : null;
      if (i === 0) {
        await interaction.editReply({ content, files: batch }).catch(() => {});
      } else {
        await interaction.followUp({ content, files: batch, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    return;
  }

  if (interaction.customId === "whs_modal") {
    const webhookUrl = (interaction.fields.getTextInputValue("whs_url") || "").trim();
    const timeRaw = (interaction.fields.getTextInputValue("whs_time") || "").trim();
    const spamMsg = (interaction.fields.getTextInputValue("whs_message") || "").trim();
    const delRaw = (interaction.fields.getTextInputValue("whs_delete") || "n").trim().toLowerCase();
    const avatarURL = interaction.user.displayAvatarURL({ dynamic: true, size: 128 });
    const deleteAfter = delRaw === "y" || delRaw === "yes";

    let durationSec = parseInt(timeRaw, 10);
    if (!Number.isFinite(durationSec) || durationSec < 1) {
      return interaction.reply({ content: "❌ Time must be 1–60 seconds.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (durationSec > 60) durationSec = 60;
    if (!webhookUrl || !spamMsg) {
      return interaction.reply({ content: "❌ Webhook URL and Message are required.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    // Quick webhook validation
    const probe = await fetch(webhookUrl, { method: "GET" }).catch(() => null);
    if (!probe || probe.status === 404) {
      return interaction.reply({ content: "❌ Not Found.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const totalMs = durationSec * 1000;
    const barLen = 15;
    const makeBar = (leftMs) => {
      const done = Math.min(1, Math.max(0, 1 - leftMs / totalMs));
      const filled = Math.round(done * barLen);
      return "■".repeat(filled) + "□".repeat(Math.max(0, barLen - filled));
    };
    const progressEmbed = (leftMs) => {
      const leftSec = Math.max(0, leftMs / 1000);
      return new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("Webhook Spam In Progress")
        .setDescription(`**Time Remaining**\n${makeBar(leftMs)}\n**${leftSec.toFixed(1)}s left**`);
    };

    await interaction.reply({ embeds: [progressEmbed(totalMs)], flags: MessageFlags.Ephemeral }).catch(() => {});

    let sent = 0, failed = 0;
    const startAt = Date.now();
    let lastEdit = 0;
    // Ultra-fast (~1ms waves, 40 concurrent) — STOP when time is up
    const CONCURRENCY = 40;
    const INTERVAL_MS = 1;
    const payload = JSON.stringify({ content: spamMsg });
    let stopped = false;

    function fireOne() {
      if (stopped) return;
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
      }).then(res => {
        if (res.status === 204 || res.status === 200) sent++;
        else failed++;
      }).catch(() => { failed++; });
    }

    while (Date.now() - startAt < totalMs) {
      if (stopped) break;
      for (let i = 0; i < CONCURRENCY; i++) fireOne();
      const left = totalMs - (Date.now() - startAt);
      if (Date.now() - lastEdit > 500 || left <= 0) {
        lastEdit = Date.now();
        await interaction.editReply({ embeds: [progressEmbed(Math.max(0, left))] }).catch(() => {});
      }
      await new Promise(r => setTimeout(r, INTERVAL_MS));
    }
    stopped = true; // time done → no more spam requests

    let deleted = false;
    if (deleteAfter) {
      try {
        const delRes = await fetch(webhookUrl, { method: "DELETE" });
        deleted = delRes.ok || delRes.status === 204 || delRes.status === 404;
      } catch {}
    }

    // No "Webhook Raid Complete" embed — just clear the progress message
    await interaction.deleteReply().catch(async () => {
      await interaction.editReply({ content: "\u200b", embeds: [], components: [] }).catch(() => {});
    });
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
// SLASH COMMAND HANDLER — /say, /finderpanel (Owner Only)
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
      const footer = interaction.options.getString("footer");
      const colorRaw = (interaction.options.getString("color") || "").trim();
      await interaction.deleteReply().catch(() => {});
      const targetChannel = interaction.channel || interaction.user.dmChannel || await interaction.user.createDM().catch(() => null);
      if (!targetChannel) {
        await interaction.followUp({ content: "❌ can't send message here.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (type === "none") {
        await targetChannel.send({ content: text });
      } else {
        let color = BLURPLE;
        if (colorRaw) {
          const named = { blurple: BLURPLE, gray: GRAY_COLOR, grey: GRAY_COLOR, red: 0xED4245, green: 0x57F287, yellow: 0xF1C40F, black: REGULAR_COLOR };
          const key = colorRaw.toLowerCase().replace(/^#/, "");
          if (named[colorRaw.toLowerCase()]) color = named[colorRaw.toLowerCase()];
          else if (/^[0-9a-fA-F]{6}$/.test(key)) color = parseInt(key, 16);
          else if (/^[0-9a-fA-F]{3}$/.test(key)) color = parseInt(key[0]+key[0]+key[1]+key[1]+key[2]+key[2], 16);
        }
        const embed = new EmbedBuilder()
          .setColor(color)
          .setDescription(text);
        if (title) embed.setTitle(title);
        // Footer only if owner provided one — otherwise no footer
        if (footer) embed.setFooter({ text: footer });
        await targetChannel.send({ embeds: [embed] });
      }
      return;
    }
    if (interaction.commandName === "finderpanel") {
      const targetChannel = interaction.channel;
      if (!targetChannel || !targetChannel.isTextBased?.()) {
        await interaction.editReply({ content: "❌ use this in a text channel." });
        return;
      }
      const panelEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Finder Source Panel")
        .setDescription("This panel is only for where you can find old source that you can’t find.")
        .setFooter({ text: `Sent by @${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 128 }) });
      const panelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("finderpanel_find").setLabel("Find").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("finderpanel_get").setLabel("Get").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("finderpanel_redeem").setLabel("Redeem").setStyle(ButtonStyle.Secondary)
      );
      await targetChannel.send({ embeds: [panelEmbed], components: [panelRow] });
      await interaction.editReply({ content: "✅ Finder Source Panel posted." });
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

  // ── Live scan: auto-index new uploads in watched channels (no .scan needed) ──
  try {
    const liveIds = Array.isArray(config.liveScanChannelIds) ? config.liveScanChannelIds.map(String) : [];
    const chId = String(msg.channelId || msg.channel?.id || "");
    if (chId && liveIds.includes(chId)) {
      const added = indexMessageFiles(msg);
      if (added > 0) {
        console.log(`📡 LiveScan +${added} file(s) in #${msg.channel?.name || chId} | library=${library.files.length}`);
      }
    }
  } catch (e) {
    console.warn(`⚠️ LiveScan: ${e.message}`);
  }

  const txt = (msg.content || "").trim();
  if (txt === ".") return; // ignore single dot messages — bot stays silent
  const isDM = !msg.guild;
  // DM access: ONLY Owner + Buyer Role. Prince / Server Tag role CANNOT use commands in DMs.
  // Exceptions: .help and .redeem/.red work for everyone.
  if (isDM && !isOwner(msg.author.id)) {
    const buyerInDm = await isBuyer(msg.author.id, msg.member);
    if (!buyerInDm && !/^\.help(?:\s|$)/i.test(txt) && !/^\.(?:redeem|red)(?:\s|$)/i.test(txt)) {
      replyUser(msg, "❌ buy access if you want to use the command here.").catch(() => {});
      return;
    }
  }

  // Channel lock for regulars — Owner + Buyer bypass. Commands only work in the .set channel.
  // Exceptions: .help .profile .prof .redeem .red work everywhere.
  if (msg.guild && txt.startsWith(".") && !isOwner(msg.author.id)) {
    const isBuyerUser = await isBuyer(msg.author.id, msg.member);
    if (!isBuyerUser && !/^\.(?:help|profile|prof|redeem|red)(?:\s|$)/i.test(txt)) {
      if (!channelAllowed(msg)) {
        const chEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle("Input Error")
          .setDescription("**Tips:**\n- Use command in allowed channel, and use server tag if you don’t have it so you can use command there.");
        replyUser(msg, { embeds: [chEmbed] }).catch(() => {});
        return;
      }
    }
  }

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
Key Active: ${activeKey ? "\`" + activeKey.key + "\`" : "❌ No active key."}`
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
    const redeemIsBuyer = isOwner(msg.author.id) || await isBuyer(msg.author.id, msg.member);
    const cd = checkCommandCooldown(msg.author.id, "redeem", redeemIsBuyer);
    if (cd.onCooldown) {
      if (cd.noTokens) { replyNoTokens(msg, cd.waitUntil).catch(() => {}); return; }
      replyUser(msg, `❌ you're on ${cd.remaining} cooldown.`).catch(() => {}); return;
    }
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
      replyUser(msg, "❌ this key was already redeem.").catch(() => {});
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
    replyUser(msg, "✅ key redeemed successfully.").catch(() => {});
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
        .setColor(REGULAR_COLOR)
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
  // .set / .sc — Owner Only (set allowed channel) — improved
  // ─────────────────────────────────────────────
  if (/^\.(?:set|sc)(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    const args = txt.split(/\s+/).slice(1);
    const oldChannelId = config.allowedChannelId || null;
    let ch = null;
    const mentionMatch = txt.match(/<#(\d+)>/);
    if (mentionMatch) { try { ch = await client.channels.fetch(mentionMatch[1]); } catch {} }
    if (!ch && args[0] && /^\d+$/.test(args[0].trim())) { try { ch = await client.channels.fetch(args[0].trim()); } catch {} }
    if (!ch) { ch = msg.channel; }
    if (!ch || !ch.isTextBased?.()) {
      replyUser(msg, "❌ invalid channel, mention a text channel or paste its ID.").catch(() => {});
      return;
    }
    config.allowedChannelId = String(ch.id);
    saveConfig();
    // Verify it actually saved
    try {
      const verify = readJSON(CONFIG_FILE, {});
      if (String(verify?.allowedChannelId || "") !== String(ch.id)) {
        config.allowedChannelId = String(ch.id);
        writeJSON(CONFIG_FILE, config);
      }
    } catch {}
    const setEmbed = new EmbedBuilder()
      .setColor(REGULAR_COLOR)
      .setTitle("✅ Allowed Channel Updated")
      .setDescription(
        `**Old Channel:** ${oldChannelId ? `<#${oldChannelId}>` : "None"}\n` +
        `**New Channel:** <#${ch.id}> (\`${ch.id}\`)\n` +
        `**Channel Name:** ${ch.name || "unknown"}\n\n` +
        `Regular users can now only use commands in <#${ch.id}>.\n` +
        `Wrong channel → bot replies with Input Error embed.`
      )
      .setFooter({ text: `Set by @${msg.author.username}`, iconURL: msg.author.displayAvatarURL({ dynamic: true, size: 128 }) });
    replyUser(msg, { embeds: [setEmbed] }).catch(() => {});
    return;
  }
  // ─────────────────────────────────────────────
  // .forward — Owner Only (forward all files from source to dest channel)
  // ─────────────────────────────────────────────
  if (/^\.forward(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    const idMatches = txt.match(/\d{17,20}/g);
    if (!idMatches || idMatches.length < 2) {
      replyUser(msg, "❌ usage: `.forward <source_channel_id> <destination_channel_id>`").catch(() => {});
      return;
    }
    const [sourceId, destId] = idMatches;
    let sourceCh, destCh;
    try { sourceCh = await client.channels.fetch(sourceId.trim()); } catch {}
    try { destCh = await client.channels.fetch(destId.trim()); } catch {}
    if (!sourceCh || !sourceCh.isTextBased?.()) { replyUser(msg, "❌ invalid source channel.").catch(() => {}); return; }
    if (!destCh || !destCh.isTextBased?.()) { replyUser(msg, "❌ invalid destination channel.").catch(() => {}); return; }
    const statusMsg = await replyUser(msg, `⚡ Forwarding files from <#${sourceCh.id}> → <#${destCh.id}>...`).catch(() => {});
    let sent = 0, skipped = 0, before = null;
    const isForwardable = (name, contentType) => {
      const e = (String(name || "").match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
      return e === "txt" || e === "lua" || e === "zip";
    };
    // Collect existing filenames in destination (normalized) — only forward files not already there
    const existingNames = new Set();
    try {
      let destBefore = null;
      while (true) {
        const opts = { limit: 100 };
        if (destBefore) opts.before = destBefore;
        const batch = await destCh.messages.fetch(opts);
        if (!batch.size) break;
        for (const m of batch.values()) {
          for (const a of m.attachments?.values?.() || []) {
            if (a.name) existingNames.add(String(a.name).toLowerCase());
          }
          for (const s of m.messageSnapshots?.values?.() || []) {
            for (const a of s.attachments?.values?.() || []) {
              if (a.name) existingNames.add(String(a.name).toLowerCase());
            }
          }
        }
        const oldest = batch.last();
        if (!oldest || batch.size < 100) break;
        destBefore = oldest.id;
      }
    } catch (e) {
      console.warn("⚠️ Forward dest scan:", e.message);
    }
    try {
      while (true) {
        const opts = { limit: 100 };
        if (before) opts.before = before;
        const batch = await sourceCh.messages.fetch(opts);
        if (!batch.size) break;
        const sendTasks = [];
        for (const m of batch.values()) {
          const atts = [];
          for (const a of m.attachments?.values?.() || []) {
            if (isForwardable(a.name, a.contentType)) atts.push(a);
          }
          for (const s of m.messageSnapshots?.values?.() || []) {
            for (const a of s.attachments?.values?.() || []) {
              if (isForwardable(a.name, a.contentType)) atts.push(a);
            }
          }
          for (const a of atts) {
            const fname = String(a.name || "file").toLowerCase();
            if (existingNames.has(fname)) {
              skipped++;
              continue;
            }
            existingNames.add(fname); // avoid dupes within same forward run
            sendTasks.push(
              fetch(a.url).then(r => r.arrayBuffer()).then(buf =>
                destCh.send({ files: [new AttachmentBuilder(Buffer.from(buf), { name: a.name || "file" })] })
                  .then(() => { sent++; })
                  .catch(() => { skipped++; })
              ).catch(() => { skipped++; })
            );
          }
        }
        await Promise.allSettled(sendTasks);
        const oldest = batch.last();
        if (!oldest || batch.size < 100) break;
        before = oldest.id;
      }
      const result = `✅ **Forward complete!**\n📂 Source: <#${sourceCh.id}>\n📥 Dest: <#${destCh.id}>\n📄 Sent: \`${sent}\`\n🚫 Skipped (already in dest / failed): \`${skipped}\``;
      if (statusMsg) statusMsg.edit(result).catch(() => {});
      else replyUser(msg, result).catch(() => {});
    } catch (e) {
      const err = `❌ Forward failed: ${e.message.slice(0, 150)}`;
      if (statusMsg) statusMsg.edit(err).catch(() => {});
      else replyUser(msg, err).catch(() => {});
    }
    return;
  }
  // ─────────────────────────────────────────────
  // .logs — Owner Only (set channel for Finder Panel usage logs)
  // ─────────────────────────────────────────────
  if (/^\.logs(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const arg = txt.split(/\s+/)[1]?.replace(/[<#>]/g, "").trim();
    if (!arg) {
      const cur = config.logChannelId ? `<#${config.logChannelId}> (\`${config.logChannelId}\`)` : "None";
      replyUser(msg, `📋 **Finder Panel logs channel:** ${cur}\nUsage: \`.logs <channel id>\``).catch(() => {});
      return;
    }
    if (!/^\d{17,20}$/.test(arg)) {
      replyUser(msg, "❌ invalid channel id.").catch(() => {});
      return;
    }
    let ch = null;
    try { ch = await client.channels.fetch(arg); } catch {}
    if (!ch || !ch.isTextBased?.()) {
      replyUser(msg, "❌ invalid text channel id.").catch(() => {});
      return;
    }
    config.logChannelId = String(ch.id);
    saveConfig();
    replyUser(msg, `✅ Finder Panel logs will go to <#${ch.id}> (\`${ch.id}\`).`).catch(() => {});
    return;
  }
  // ─────────────────────────────────────────────
  // .livescan — Owner Only (auto-index new uploads in a channel forever)
  // Usage: .livescan <channel id|#mention> | .livescan list | .livescan off [id]
  // ─────────────────────────────────────────────
  if (/^\.livescan(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (!Array.isArray(config.liveScanChannelIds)) config.liveScanChannelIds = [];
    const args = txt.split(/\s+/).slice(1);
    const sub = (args[0] || "").toLowerCase();

    // list active live-scan channels
    if (!args.length || sub === "list" || sub === "status") {
      const ids = config.liveScanChannelIds.map(String);
      if (!ids.length) {
        replyUser(msg, "📡 **LiveScan:** no channels watching.\nUsage: `.livescan <channel id>` or `.livescan #channel`").catch(() => {});
        return;
      }
      const lines = ids.map(id => `• <#${id}> (\`${id}\`)`).join("\n");
      replyUser(msg, `📡 **LiveScan active on ${ids.length} channel(s):**\n${lines}\n\nStop one: \`.livescan off <id>\`\nStop all: \`.livescan off\``).catch(() => {});
      return;
    }

    // off / stop
    if (sub === "off" || sub === "stop" || sub === "disable") {
      const target = args[1]?.replace(/[<#>]/g, "").trim();
      if (!target) {
        const n = config.liveScanChannelIds.length;
        config.liveScanChannelIds = [];
        saveConfig();
        replyUser(msg, `✅ LiveScan **stopped** on all channels (${n} removed).`).catch(() => {});
        return;
      }
      if (!/^\d{17,20}$/.test(target)) {
        replyUser(msg, "❌ invalid channel id.").catch(() => {});
        return;
      }
      const before = config.liveScanChannelIds.length;
      config.liveScanChannelIds = config.liveScanChannelIds.filter(id => String(id) !== target);
      saveConfig();
      if (config.liveScanChannelIds.length === before) {
        replyUser(msg, `❌ <#${target}> was not on LiveScan.`).catch(() => {});
      } else {
        replyUser(msg, `✅ LiveScan **stopped** on <#${target}>.`).catch(() => {});
      }
      return;
    }

    // enable / toggle channel (id or mention)
    let chId = null;
    const mentionMatch = txt.match(/<#(\d+)>/);
    if (mentionMatch) chId = mentionMatch[1];
    else if (/^\d{17,20}$/.test(args[0])) chId = args[0].trim();
    if (!chId) {
      replyUser(msg, "❌ usage: `.livescan <channel id>` or `.livescan #channel`\nAlso: `.livescan list` · `.livescan off [id]`").catch(() => {});
      return;
    }

    let ch = null;
    try { ch = await client.channels.fetch(chId); } catch {}
    if (!ch || !ch.isTextBased?.()) {
      replyUser(msg, "❌ invalid text channel id.").catch(() => {});
      return;
    }

    const idStr = String(ch.id);
    const already = config.liveScanChannelIds.map(String).includes(idStr);
    if (already) {
      // toggle off if already watching
      config.liveScanChannelIds = config.liveScanChannelIds.filter(id => String(id) !== idStr);
      saveConfig();
      replyUser(msg, `✅ LiveScan **stopped** on <#${ch.id}> (\`${ch.id}\`).`).catch(() => {});
      return;
    }

    config.liveScanChannelIds.push(idStr);
    saveConfig();
    replyUser(msg, `📡 **LiveScan ON** for <#${ch.id}> (\`${ch.id}\`)\nNew \`.txt\` / \`.lua\` / \`.zip\` uploads there are indexed into the finder automatically.\nRun again on the same channel (or \`.livescan off ${ch.id}\`) to stop.`).catch(() => {});
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
    if (!attachments.length) { replyUser(msg, "❌ upload a .zip or .html file or reply to one, dumbass.").catch(() => {}); return; }
    const sourceFile = attachments[0];
    const maxInfo = getMaxFileSize(msg.guild);
    if (sourceFile.size > maxInfo.size) { replyUser(msg, `❌ max file is ${maxInfo.label}, lol.`).catch(() => {}); return; }
    const sentMsg = await replyUser(msg, "⏳ Processing...").catch(() => {});
    try {
      const buf = await downloadURL(sourceFile.url);
      let files;
      if (isHtmlFile(sourceFile.name, sourceFile.contentType)) {
        // Standalone HTML — extract ALL embedded scripts / code / base64 + original
        files = extractFilesFromHtml(buf, sourceFile.name);
      } else {
        files = extractFilesFromZip(buf);
      }
      if (!files.length) { if (sentMsg) await sentMsg.delete().catch(() => {}); replyUser(msg, "❌ file is empty or has no extractable content, bro.").catch(() => {}); return; }
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
    if (!perm.allowed) {
      if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return;
    }
    const cd = checkCommandCooldown(msg.author.id, "delwh", perm.isBuyer);
    if (cd.onCooldown) {
      if (cd.noTokens) { replyNoTokens(msg, cd.waitUntil).catch(() => {}); return; }
      replyUser(msg, `❌ you're on ${cd.remaining} cooldown.`).catch(() => {}); return;
    }
    const isBuyerUser = perm.isBuyer;
    
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
        const tokLine = isBuyerUser ? "" : tokensResultSuffix(false, peekTokens(msg.author.id, false).tokens);
        await msg.channel.send({
          content: `<@${msg.author.id}> done, delete the webhook bro!` + tokLine,
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
    if (!perm.allowed) {
      if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return;
    }
    const cd = checkCommandCooldown(msg.author.id, "whs", perm.isBuyer);
    if (cd.onCooldown) {
      if (cd.noTokens) { replyNoTokens(msg, cd.waitUntil).catch(() => {}); return; }
      replyUser(msg, `❌ you're on ${cd.remaining} cooldown.`).catch(() => {}); return;
    }
    
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
    if (!perm.allowed) {
      if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return;
    }
    const cd = checkCommandCooldown(msg.author.id, "upload", perm.isBuyer);
    if (cd.onCooldown) {
      if (cd.noTokens) { replyNoTokens(msg, cd.waitUntil).catch(() => {}); return; }
      replyUser(msg, `❌ you're on ${cd.remaining} cooldown.`).catch(() => {}); return;
    }
    const isBuyerUser = perm.isBuyer;
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
    const maxUploadSize = isBuyerUser ? 1024 * 1024 : 200 * 1024;
    const maxUploadLabel = isBuyerUser ? "1MB" : "200KB";
    if (file.size > maxUploadSize) { replyUser(msg, `❌ max is ${maxUploadLabel} lol.`).catch(() => {}); return; }
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
        .setFooter({ text: `Request by @${msg.author.username}│Prince Loader`, iconURL: msg.author.displayAvatarURL({ dynamic: true, size: 128 }) });
      const tokLine = isBuyerUser ? "" : tokensResultSuffix(false, peekTokens(msg.author.id, false).tokens);
      pendingTokenLine.delete(String(msg.author.id));
      await replyUser(msg, {
        content: `<@${msg.author.id}> Here you go!` + tokLine,
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
    if (!perm.allowed) {
      if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return;
    }
    const cd = checkCommandCooldown(msg.author.id, "obf", perm.isBuyer);
    if (cd.onCooldown) {
      if (cd.noTokens) { replyNoTokens(msg, cd.waitUntil).catch(() => {}); return; }
      replyUser(msg, `❌ you're on ${cd.remaining} cooldown.`).catch(() => {}); return;
    }
    const isBuyerUser = perm.isBuyer;
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
    const maxObfSize = isBuyerUser ? 1024 * 1024 : 200 * 1024;
    const maxObfLabel = isBuyerUser ? "1MB" : "200KB";
    if (file.size > maxObfSize) { replyUser(msg, `❌ max is ${maxObfLabel} lol.`).catch(() => {}); return; }
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
    if (!perm.allowed) {
      if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return;
    }
    const cd = checkCommandCooldown(msg.author.id, "et", perm.isBuyer);
    if (cd.onCooldown) {
      if (cd.noTokens) { replyNoTokens(msg, cd.waitUntil).catch(() => {}); return; }
      replyUser(msg, `❌ you're on ${cd.remaining} cooldown.`).catch(() => {}); return;
    }
    if (isDM && !perm.isBuyer) { replyUser(msg, "❌ not here, dumbass.").catch(() => {}); return; }
    let attachments = extractAttachmentsOf(msg);
    if (!attachments.length && msg.reference?.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        attachments = extractAttachmentsOf(refMsg);
      } catch {}
    }
    if (!attachments.length) {
      replyUser(msg, "❌ upload a .zip or .html file or reply to one, dumbass.").catch(() => {});
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
      let files;
      if (isHtmlFile(sourceFile.name, sourceFile.contentType)) {
        // Standalone HTML — extract ALL embedded scripts / code / base64 + original
        files = extractFilesFromHtml(buf, sourceFile.name);
      } else {
        files = extractFilesFromZip(buf);
      }
      if (!files.length) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, "❌ file is empty or has no extractable content, bro.").catch(() => {});
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
  // .rename / .rn — mode selection panel
  if (/^\.(?:rename|rn)$/i.test(txt)) {
    const perm = await checkRegularPermission(msg, false);
    if (!perm.allowed) {
      if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return;
    }
    const cd = checkCommandCooldown(msg.author.id, "rename", perm.isBuyer);
    if (cd.onCooldown) {
      if (cd.noTokens) { replyNoTokens(msg, cd.waitUntil).catch(() => {}); return; }
      replyUser(msg, `❌ you're on ${cd.remaining} cooldown.`).catch(() => {}); return;
    }
    const isBuyerUser = perm.isBuyer;
    let attachments = [...(msg.attachments?.values() || [])].filter(a => {
      const e = ext(a.name);
      return e === "lua" || e === "txt" || e === "luau";
    });
    if (!attachments.length && msg.reference?.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        const all = [];
        for (const a of refMsg.attachments?.values?.() || []) {
          const e = ext(a.name);
          if (e === "lua" || e === "txt" || e === "luau") all.push(a);
        }
        for (const s of refMsg.messageSnapshots?.values?.() || []) {
          for (const a of s.attachments?.values?.() || []) {
            const e = ext(a.name);
            if (e === "lua" || e === "txt" || e === "luau") all.push(a);
          }
        }
        attachments = all;
      } catch {}
    }
    if (!attachments.length) {
      const errEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("Input Error")
        .setDescription("**Tips:**\n- Attach a .lua .txt or .luau file.\n- Reply to a message with a file, or forward message");
      replyUser(msg, { embeds: [errEmbed] }).catch(() => {});
      return;
    }
    const file = attachments[0];
    // Download file content NOW so button clicks never hit expired Discord CDN URLs
    let fileContent = null;
    try {
      const dlRes = await fetch(file.url);
      if (!dlRes.ok) throw new Error(`HTTP ${dlRes.status}`);
      fileContent = await dlRes.text();
    } catch (dlErr) {
      replyUser(msg, `❌ couldn't read that file (link expired or invalid). Re-upload it and try again, bro.`).catch(() => {});
      return;
    }
    if (!fileContent || fileContent.trim().length < 5) {
      replyUser(msg, "❌ file is empty or too small, bro.").catch(() => {});
      return;
    }
    if (isObfuscatedOrProtectionNotLua(fileContent)) {
      replyUser(msg, "❌ this is obufscated or protection code, try another.").catch(() => {});
      return;
    }
    const fileExt = ext(file.name);
    if (fileExt !== "lua" && fileExt !== "txt" && fileExt !== "luau") {
      const errEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("Input Error")
        .setDescription("**Tips:**\n- Attach a .lua .txt or .luau file.\n- Reply to a message with a file, or forward message");
      replyUser(msg, { embeds: [errEmbed] }).catch(() => {});
      return;
    }
    
    // Process immediately — remove comments, IP loggers, script loaders only (no panel)
    const loadingEmbed = new EmbedBuilder()
      .setColor(GRAY_COLOR)
      .setTitle("Renaming...")
      .setDescription("⏳ Processing...");
    const loadingMsg = await replyUser(msg, { embeds: [loadingEmbed] }).catch(() => {});
    const startTime = Date.now();
    try {
      let text = String(fileContent || "");
      try { text = stripGuiCopierHeader(text); } catch {}
      const urlRegex = /https?:\/\/[^\s"'()\]]+/g;
      const foundUrls = text.match(urlRegex) || [];
      // Local clean: comments + IP loggers + script loaders (+ expanded junk comment lines)
      let finalOutput = cleanLuaScript(text);
      finalOutput = removeDangerousLines(finalOutput);
      // Light AI pass: only strip comments / loaders / IP if API available
      try {
        if (typeof openaiClient !== "undefined" && openaiClient) {
          const cleaned = await aiCleanScript(finalOutput, "cleanup");
          if (cleaned && cleaned.trim().length > 10) finalOutput = cleaned;
        }
      } catch (aiErr) {
        console.warn("⚠️ rename AI cleanup skipped:", aiErr.message?.slice(0, 80));
      }
      finalOutput = removeDangerousLines(finalOutput);
      if (!finalOutput || !finalOutput.trim()) throw new Error("empty output after clean");

      const finishSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const randChars = "abcdefghijklmnopqrstuvwxyz";
      let outputName = "";
      for (let i = 0; i < 20; i++) outputName += randChars.charAt(Math.floor(Math.random() * randChars.length));
      outputName += ".lua";

      const uniqueUrls = [...new Set(foundUrls)];
      const previewText = buildPreviewText(finalOutput);
      let description = buildRenamerDescription(previewText);
      if (uniqueUrls.length > 0) {
        const urlList = uniqueUrls.slice(0, 10).map(u => `- ${u}`).join("\n");
        description += `\n\n**URL Found:**\n${urlList}${uniqueUrls.length > 10 ? `\n- ...and ${uniqueUrls.length - 10} more` : ""}`;
      }
      const resultEmbed = new EmbedBuilder()
        .setColor(BLURPLE)
        .setTitle("File Preview")
        .setDescription(description)
        .setFooter({ text: `Request by @${msg.author.username}│Prince Renamer`, iconURL: msg.author.displayAvatarURL({ dynamic: true, size: 128 }) });
      const fixedFile = new AttachmentBuilder(Buffer.from(finalOutput, "utf-8"), { name: outputName });
      const tokLine = isBuyerUser ? "" : tokensResultSuffix(false, cd.tokensLeft ?? peekTokens(msg.author.id, false).tokens);
      if (loadingMsg) await loadingMsg.delete().catch(() => {});
      pendingTokenLine.delete(String(msg.author.id));
      await replyUser(msg, {
        content: `<@${msg.author.id}> Here you go!\n**Finish in:** \`${finishSec}s\`` + tokLine,
        files: [fixedFile],
        embeds: [resultEmbed]
      }).catch(() => {});
    } catch (e) {
      if (loadingMsg) await loadingMsg.delete().catch(() => {});
      replyUser(msg, `❌ failed: ${e.message.slice(0, 150)}`).catch(() => {});
    }
    return;
  }
  // .get — regular: 1 ID max, buyer: up to 10 IDs
  if (/^\.get(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) {
      if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return;
    }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "get", isBuyerUser);
    if (cd.onCooldown) {
      if (cd.noTokens) { replyNoTokens(msg, cd.waitUntil).catch(() => {}); return; }
      replyUser(msg, `❌ you're on ${cd.remaining} cooldown.`).catch(() => {}); return;
    }
    const args = txt.split(/\s+/).slice(1).filter(Boolean);
    if (!args.length) { replyUser(msg, "❌ put id of file, idiot.").catch(() => {}); return; }
    const maxGetIds = isBuyerUser ? 10 : 1;
    if (args.length > maxGetIds) {
      replyUser(msg, isBuyerUser ? "❌ max 10 id only, dumbass." : "❌ buy premium if you want multiple id.").catch(() => {});
      return;
    }
    const filesToSend = [];
    const notFound = [];
    for (const id of args) {
      const file = getFile(id);
      if (!file) { notFound.push(id); continue; }
      const freshUrl = await getFreshUrl(file);
      filesToSend.push({ attachment: freshUrl || file.url, name: file.filename || "file" });
    }
    if (!filesToSend.length) { replyUser(msg, "❌ your id is wrong, try find working id, dumbass.").catch(() => {}); return; }
    // Send in batches of 10 (Discord file limit per message)
    for (let i = 0; i < filesToSend.length; i += 10) {
      const batch = filesToSend.slice(i, i + 10);
      const content = i === 0
        ? "**Here you go!**" + (notFound.length ? `\n❌ Not found: \`${notFound.join("`, `")}\`` : "")
        : null;
      if (i === 0) {
        await replyUser(msg, { content, files: batch }).catch(() => {});
      } else {
        await msg.channel.send({ content, files: batch }).catch(() => {});
      }
    }
    return;
  }
  // .dl / .download — gives file from library ID OR downloads from Discord CDN link
  if (/^\.(?:dl|download)(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) {
      if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return;
    }
    const cd = checkCommandCooldown(msg.author.id, "dl", perm.isBuyer);
    if (cd.onCooldown) {
      if (cd.noTokens) { replyNoTokens(msg, cd.waitUntil).catch(() => {}); return; }
      replyUser(msg, `❌ you're on ${cd.remaining} cooldown.`).catch(() => {}); return;
    }
    const arg = txt.split(/\s+/)[1];
    if (!arg) { replyUser(msg, "❌ put file link, idiot.").catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const startTime = Date.now();

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
      content: `<@${msg.author.id}> **Here you go!**`,
      files: [fileAttachment]
    }).catch(() => {});
    return;
  }
  // .renew — Owner Only: silent fast clone (same name/perms/position), delete old — no messages
  if (/^\.renew(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) return;
    if (!msg.guild || !msg.channel || msg.channel.isDMBased?.()) return;
    const ch = msg.channel;
    if (!ch.isTextBased?.() || ch.isThread?.()) return;
    try {
      const position = ch.rawPosition ?? ch.position;
      const cloned = await ch.clone({
        name: ch.name,
        reason: `renew:${msg.author.id}`,
      });
      // Parallel-ish: position then delete old ASAP
      await Promise.all([
        cloned.setPosition(position).catch(() => {}),
        (async () => {
          try {
            const edit = {};
            if (ch.topic != null) edit.topic = ch.topic;
            if (typeof ch.nsfw === "boolean") edit.nsfw = ch.nsfw;
            if (typeof ch.rateLimitPerUser === "number") edit.rateLimitPerUser = ch.rateLimitPerUser;
            if (Object.keys(edit).length) await cloned.edit(edit).catch(() => {});
          } catch {}
        })()
      ]);
      await ch.delete(`renew:${msg.author.id}`).catch(() => {});
    } catch (e) {
      console.warn("⚠️ renew:", e.message);
    }
    return;
  }
  // .coinflip — win or lose 1 token (regular users)
  if (/^\.coinflip(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg, false);
    if (!perm.allowed) {
      if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return;
    }
    if (perm.isBuyer || isOwner(msg.author.id)) {
      replyUser(msg, "❌ premium already has unlimited tokens, no need to flip.").catch(() => {});
      return;
    }
    const peek = peekTokens(msg.author.id, false);
    if (peek.tokens <= 0) {
      const waitUntil = peek.nextRefillAt || getNextMidnightPHMs();
      replyNoTokens(msg, waitUntil).catch(() => {});
      return;
    }
    // Cost -1 token to play; win gives +2 tokens
    const spent = tryConsumeToken(msg.author.id, false);
    if (!spent.ok) {
      replyNoTokens(msg, spent.waitUntil).catch(() => {});
      return;
    }
    const win = Math.random() < 0.5;
    let finalTokens = spent.tokens;
    if (win) {
      finalTokens = addToken(msg.author.id, 2); // +2 reward after -1 cost
    }
    const embed = new EmbedBuilder()
      .setColor(win ? 0x57F287 : 0xED4245)
      .setTitle(win ? "🪙 You won!" : "🪙 You lost!")
      .setDescription(
        win
          ? `Heads! You **won +2 tokens** (cost was −1).\n\n${tokenLeftLine(finalTokens, false)}`
          : `Tails! You **lost 1 token**.\n\n${tokenLeftLine(finalTokens, false)}`
      );
    replyUser(msg, { embeds: [embed] }).catch(() => {});
    return;
  }
  // .find
  if (/^\.find(?:\s|$)/i.test(txt)) {

    const perm = await checkRegularPermission(msg, false);
    if (!perm.allowed) {
      if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return;
    }
    const cd = checkCommandCooldown(msg.author.id, "find", perm.isBuyer);
    if (cd.onCooldown) {
      if (cd.noTokens) { replyNoTokens(msg, cd.waitUntil).catch(() => {}); return; }
      replyUser(msg, `❌ you're on ${cd.remaining} cooldown.`).catch(() => {}); return;
    }
    const query = txt.slice(5).trim();
    if (!query) { replyUser(msg, "❌ usage: `.find <file name>`, dumbass.").catch(() => {}); return; }
    const results = findFiles(query);
    if (!results.length) { replyUser(msg, "❌ no found for that, dumbass.").catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const perPage = 8; const totalPages = Math.ceil(results.length / perPage);
    const pageItems = results.slice(0, perPage);
    // Finder source embeds — never show tokens left
    const findDesc = pageItems.map(f => `\`${f.filename}\` — ID: \`${f.id}\``).join("\n");
    const embed = new EmbedBuilder()
      .setColor(BLURPLE)
      .setTitle(getFinderTitle(isBuyerUser))
      .setDescription(findDesc)
      .setFooter({ text: `Pages 1/${totalPages} │ Prince Finder` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(totalPages <= 1)
    );
    // Clear pending so replyUser doesn't append tokens on finder embeds
    pendingTokenLine.delete(String(msg.author.id));
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
