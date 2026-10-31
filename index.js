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

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = "1302080645987569694";
const BUYER_ROLE_ID = "1553385966629158963";
const PRINCE_ROLE_ID = "1547849774676316181";
const BUYER_COLOR = 0xFFFFFF;
const REGULAR_COLOR = 0x2B2D31; 
const BLURPLE = 0x5865F2; 
const GRAY_COLOR = 0x99AAB5; 
const PORT = Number(process.env.PORT) || 10000;
if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID.");
  process.exit(1);
}

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
    
    try {
      const fd = fs.openSync(tmp, "r+");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch {}
    fs
  .renameSync(tmp, file);
    
    const verify = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(data?.files) && Array.isArray(verify?.files)) {
      console.log(`💾 Saved ${path.basename(file)}: ${verify.files.length} files`);
    }
  } catch (e) {
    console.error(`❌ Saving ${path.basename(file)}:`, e.message);
    
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); } catch {}
  }
}
let config = readJSON(CONFIG_FILE, { allowedChannelId: null, liveScanChannelIds: [], userToken: "" });
if (!config || typeof config !== "object") config = { allowedChannelId: null, liveScanChannelIds: [], userToken: "" };
if (!Array.isArray(config.liveScanChannelIds)) config.liveScanChannelIds = [];
if (typeof config.userToken !== "string") config.userToken = "";
const saveConfig = () => writeJSON(CONFIG_FILE, config);

async function userDiscordApi(path, opts = {}) {
  const tok = normalizeUserToken(config.userToken || "");
  if (!tok) throw new Error("no user token — run /login first");
  const res = await fetch("https://discord.com/api/v10" + path, {
    method: opts.method || "GET",
    headers: {
      Authorization: tok,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Content-Type": "application/json",
      "X-Super-Properties": "eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6ImVuLVVTIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEyMC4wLjAuMCBTYWZhcmkvNTM3LjM2IiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTIwLjAuMC4wIiwib3NfdmVyc2lvbiI6IjEwIiwicmVmZXJyZXIiOiIiLCJyZWZlcnJpbmdfZG9tYWluIjoiIiwicmVmZXJyZXJfY3VycmVudCI6IiIsInJlbGVhc2VfY2hhbm5lbCI6InN0YWJsZSIsImNsaWVudF9idWlsZF9udW1iZXIiOjI1NjIzMSwiY2xpZW50X2V2ZW50X3NvdXJjZSI6bnVsbH0=",
      ...(opts.headers || {})
    },
    body: opts.body != null ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.message || json?.raw || ("HTTP " + res.status);
    throw new Error(String(msg).slice(0, 200));
  }
  return json;
}

function normalizeUserToken(raw) {
  let t = String(raw || "").trim();
  if (!t) return "";
  
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const j = JSON.parse(t);
      if (Array.isArray(j) && j.length) {
        const first = j[0];
        if (typeof first === "string") t = first;
        else if (first && typeof first === "object")
          t = first.token || first.Token || first.userToken || first.authorization || t;
      } else if (j && typeof j === "object") {
        t = j.token || j.Token || j.userToken || j.user_token || j.authorization || j.auth || t;
      }
      if (typeof t !== "string") t = String(raw || "");
    } catch {}
  }
  t = String(t).trim();
  
  t = t.replace(/^["'`]+|["'`]+$/g, "");
  
  t = t.replace(/^(Bearer|Bot)\s+/i, "");
  t = t.replace(/^Token\s*[:=]\s*/i, "");
  t = t.replace(/^authorization\s*[:=]\s*/i, "");
  
  if ((t.match(/:/g) || []).length >= 2) {
    const parts = t.split(":");
    const last = parts[parts.length - 1].trim();
    if (last.length > 30 && last.includes(".")) t = last;
  }
  
  const m = String(t).match(/(?:mfa\.)?[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{10,}/);
  if (m) t = m[0];
  t = t.replace(/[\r\n\t\s]+/g, "");
  return t;
}

async function verifyUserToken(token) {
  const tok = normalizeUserToken(token);
  if (!tok || tok.length < 20) throw new Error("token too short / empty");
  const res = await fetch("https://discord.com/api/v10/users/@me", {
    headers: {
      Authorization: tok,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "X-Super-Properties": "eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6ImVuLVVTIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEyMC4wLjAuMCBTYWZhcmkvNTM3LjM2IiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTIwLjAuMC4wIiwib3NfdmVyc2lvbiI6IjEwIiwicmVmZXJyZXIiOiIiLCJyZWZlcnJpbmdfZG9tYWluIjoiIiwicmVmZXJyZXJfY3VycmVudCI6IiIsInJlbGVhc2VfY2hhbm5lbCI6InN0YWJsZSIsImNsaWVudF9idWlsZF9udW1iZXIiOjI1NjIzMSwiY2xpZW50X2V2ZW50X3NvdXJjZSI6bnVsbH0="
    }
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(json?.message || ("HTTP " + res.status));
  return json;
}

async function userFetchChannelMessages(channelId, limit = 50, before = null) {
  let path = `/channels/${channelId}/messages?limit=${Math.min(100, Math.max(1, limit))}`;
  if (before) path += `&before=${before}`;
  const data = await userDiscordApi(path);
  return Array.isArray(data) ? data : [];
}

async function userFetchAllChannelMessages(channelId, maxMessages = 5000) {
  const all = [];
  let before = null;
  while (all.length < maxMessages) {
    const batch = await userFetchChannelMessages(channelId, 100, before);
    if (!batch.length) break;
    all.push(...batch);
    before = batch[batch.length - 1]?.id;
    if (batch.length < 100) break;
  }
  return all;
}

function attachmentsFromUserMessage(raw) {
  const out = [];
  if (!raw) return out;
  const push = (a) => {
    if (!a) return;
    const name = a.filename || a.name || "file";
    const url = a.url || a.proxy_url || a.proxyURL;
    if (!url || !name) return;
    if (out.some(x => x.name === name && x.url === url)) return;
    out.push({ name, filename: name, url, proxyURL: a.proxy_url || a.url, size: a.size || 0 });
  };
  for (const a of raw.attachments || []) push(a);
  try {
    const snaps = raw.message_snapshots || raw.messageSnapshots || [];
    for (const snap of snaps) {
      const m = snap?.message || snap;
      for (const a of m?.attachments || []) push(a);
    }
  } catch {}
  return out;
}

function parseChannelIdArg(raw) {
  const s = String(raw || "").trim();
  const link = s.match(/channels\/\d+\/(\d{17,20})/i);
  if (link) return link[1];
  const id = s.match(/(\d{17,20})/);
  return id ? id[1] : null;
}

function startForwardJob({ sourceId, destId, sourceCh, destCh, useUserToken, statusEdit }) {
  setImmediate(() => {
    (async () => {
      const counts = { txt: 0, lua: 0, zip: 0 };
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const yieldTick = () => new Promise(r => setImmediate(r));
      const isForwardable = (name) => {
        const e = (String(name || "").match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
        return e === "txt" || e === "lua" || e === "luau" || e === "zip";
      };
      const bumpExt = (name) => {
        const e = (String(name || "").match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
        if (e === "txt") counts.txt++;
        else if (e === "lua" || e === "luau") counts.lua++;
        else if (e === "zip") counts.zip++;
      };

      let destChannel = destCh;
      try {
        if (!destChannel) destChannel = await client.channels.fetch(destId);
      } catch {}

      const existingNames = new Set();
      try {
        let destBefore = null;
        let scanned = 0;
        while (scanned < 300 && destChannel) {
          const opts = { limit: 100 };
          if (destBefore) opts.before = destBefore;
          const batch = await destChannel.messages.fetch(opts);
          if (!batch.size) break;
          for (const m of batch.values()) {
            scanned++;
            for (const a of m.attachments?.values?.() || []) {
              if (a.name) existingNames.add(String(a.name).toLowerCase());
            }
          }
          const oldest = batch.last();
          if (!oldest || batch.size < 100) break;
          destBefore = oldest.id;
          await yieldTick();
        }
      } catch (e) {
        console.warn("⚠️ Forward dest scan:", e.message);
      }

      const processAtt = async (name, url) => {
        if (!isForwardable(name) || !url) return;
        if (existingNames.has(String(name).toLowerCase())) return;
        try {
          const buf = await downloadURL(url);
          if (!buf || !buf.length) return;
          await destChannel.send({ files: [new AttachmentBuilder(buf, { name: name || "file" })] });
          existingNames.add(String(name).toLowerCase());
          bumpExt(name);
          await sleep(450);
        } catch (e) {
          console.warn("⚠️ Forward file:", name, e?.message || e);
          await sleep(800);
        }
      };

      try {
        if (useUserToken) {
          let before = null;
          for (let pages = 0; pages < 80; pages++) {
            let batch = [];
            try {
              batch = await userFetchChannelMessages(sourceId, 100, before);
            } catch (e) {
              console.warn("⚠️ Forward user page:", e?.message || e);
              break;
            }
            if (!batch.length) break;
            for (const raw of batch) {
              const atts = attachmentsFromUserMessage(raw);
              for (const a of atts) {
                await processAtt(a.name || a.filename, a.url || a.proxyURL);
              }
              await yieldTick();
            }
            before = batch[batch.length - 1]?.id;
            if (batch.length < 100) break;
            await sleep(350);
          }
        } else if (sourceCh) {
          let before = null;
          for (let pages = 0; pages < 80; pages++) {
            let batch;
            try {
              const opts = { limit: 100 };
              if (before) opts.before = before;
              batch = await sourceCh.messages.fetch(opts);
            } catch (e) {
              console.warn("⚠️ Forward bot page:", e?.message || e);
              break;
            }
            if (!batch || !batch.size) break;
            for (const m of batch.values()) {
              try {
                for (const a of m.attachments?.values?.() || []) {
                  await processAtt(a.name, a.url || a.proxyURL);
                }
              } catch {}
              try {
                for (const s of m.messageSnapshots?.values?.() || []) {
                  for (const a of s.attachments?.values?.() || []) {
                    await processAtt(a.name, a.url || a.proxyURL);
                  }
                }
              } catch {}
              try {
                const collected = collectMessageAttachments(m);
                for (const a of collected) {
                  await processAtt(a.name || a.filename, a.url || a.proxyURL);
                }
              } catch {}
              await yieldTick();
            }
            const oldest = batch.last();
            if (!oldest || batch.size < 100) break;
            before = oldest.id;
            await sleep(350);
          }
        }

        const doneBody =
          "### Forward Done!\n" +
          `.txt: ${counts.txt}\n` +
          `.lua: ${counts.lua}\n` +
          `.zip: ${counts.zip}\n` +
          `from <#${sourceId}> to <#${destId}>`;
        try {
          if (typeof statusEdit === "function") await statusEdit(doneBody);
        } catch {}
      } catch (e) {
        console.error("❌ forward job:", e?.message || e);
        try {
          if (typeof statusEdit === "function") {
            await statusEdit("❌ forward failed: " + String(e.message || e).slice(0, 150));
          }
        } catch {}
      }
    })().catch(e => console.error("❌ forward unhandled:", e?.message || e));
  });
}

let library = readJSON(LIBRARY_FILE, { files: [] });
if (Array.isArray(library)) library = { files: library };
if (!Array.isArray(library.files)) library.files = [];

const KEYS_FILE = path.join(DATA_DIR, "keys.json");
let keyStore = readJSON(KEYS_FILE, { keys: [] });
if (!Array.isArray(keyStore.keys)) keyStore.keys = [];

const BLACKLIST_FILE = path.join(DATA_DIR, "blacklist.json");
let blacklistStore = readJSON(BLACKLIST_FILE, { users: [] });
if (!blacklistStore || typeof blacklistStore !== "object") blacklistStore = { users: [] };
if (!Array.isArray(blacklistStore.users)) blacklistStore.users = [];
const saveBlacklist = () => writeJSON(BLACKLIST_FILE, blacklistStore);
const SCRIPANEL_FILE = path.join(DATA_DIR, "scripanel.json");
let scripanelStore = readJSON(SCRIPANEL_FILE, { url: "", script: "", updatedAt: 0, updatedBy: null });
if (!scripanelStore || typeof scripanelStore !== "object") scripanelStore = { url: "", script: "", updatedAt: 0, updatedBy: null };
const saveScripanel = () => writeJSON(SCRIPANEL_FILE, scripanelStore);

function isBlacklisted(userId) {
  return blacklistStore.users.includes(String(userId));
}
function blacklistAdd(userId) {
  const id = String(userId);
  if (!blacklistStore.users.includes(id)) {
    blacklistStore.users.push(id);
    saveBlacklist();
    return true;
  }
  return false;
}
function blacklistRemove(userId) {
  const id = String(userId);
  const before = blacklistStore.users.length;
  blacklistStore.users = blacklistStore.users.filter(u => u !== id);
  if (blacklistStore.users.length !== before) {
    saveBlacklist();
    return true;
  }
  return false;
}
function blacklistList() {
  return [...blacklistStore.users];
}

const WHITELIST_FILE = path.join(DATA_DIR, "whitelist.json");
let whitelistStore = readJSON(WHITELIST_FILE, { users: [] });
if (!whitelistStore || typeof whitelistStore !== "object") whitelistStore = { users: [] };
if (!Array.isArray(whitelistStore.users)) whitelistStore.users = [];
const saveWhitelist = () => writeJSON(WHITELIST_FILE, whitelistStore);

function isWhitelisted(userId) {
  return whitelistStore.users.includes(String(userId));
}
function canUseForward(userId) {
  return isOwner(userId) || isWhitelisted(userId);
}
function whitelistAdd(userId) {
  const id = String(userId);
  if (!whitelistStore.users.includes(id)) {
    whitelistStore.users.push(id);
    saveWhitelist();
    return true;
  }
  return false;
}
function whitelistRemove(userId) {
  const id = String(userId);
  const before = whitelistStore.users.length;
  whitelistStore.users = whitelistStore.users.filter(u => u !== id);
  if (whitelistStore.users.length !== before) {
    saveWhitelist();
    return true;
  }
  return false;
}
function whitelistList() {
  return [...whitelistStore.users];
}

const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");
const MAX_REGULAR_TOKENS = 10;
const PH_OFFSET_MS = 8 * 60 * 60 * 1000; 
let tokenStore = readJSON(TOKENS_FILE, { users: {} });
if (!tokenStore || typeof tokenStore !== "object") tokenStore = { users: {} };
if (!tokenStore.users || typeof tokenStore.users !== "object") tokenStore.users = {};
const saveTokens = () => writeJSON(TOKENS_FILE, tokenStore);

function getPHDateKey(ms = Date.now()) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

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
  const left = Math.max(0, (waitUntil || getNextMidnightPHMs()) - Date.now());
  return new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle("Input Error")
    .setDescription(`You need to wait ${formatTokenWait(left)}\n-# Token reset at 12:00 AM PH time`);
}

function tokenLeftLine(tokensLeft, unlimited) {
  if (unlimited) return "-# You have Unlimited Tokens left.";
  return `-# You have ${tokensLeft} Tokens left.`;
}

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

function addToken(userId, amount) {
  const data = ensureDailyTokenReset(userId);
  
  data.tokens = Math.min(MAX_REGULAR_TOKENS, Math.max(0, data.tokens + amount));
  if (data.tokens > 0) data.nextRefillAt = null;
  else data.nextRefillAt = getNextMidnightPHMs();
  saveTokens();
  return data.tokens;
}

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

const commandCooldowns = new Map(); 
const COOLDOWNS = {}; 

const TOKEN_FREE_CMDS = new Set(["redeem", "help", "find", "leaderboard"]);
function formatCooldown(remainingSec) {
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

const pendingTokenLine = new Map(); 
const pendingTagRetry = new Map(); 
const detectSessions = new Map();
const cleanSessions = new Map(); 

function tokensResultSuffix(isBuyerUser, tokensLeft) {
  if (isBuyerUser || tokensLeft === null || tokensLeft === undefined) return "";
  return `\n-# You have ${tokensLeft} Tokens left.`;
}
function checkCommandCooldown(userId, cmd, isBuyerUser) {
  const free = TOKEN_FREE_CMDS.has(cmd);
  
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

function replyNoTokens(msg, waitUntil) {
  pendingTokenLine.delete(String(msg.author.id));
  const leftMs = Math.max(0, (waitUntil || getNextMidnightPHMs()) - Date.now());
  return sendInputErrorV2(msg, "You need to wait **" + formatTokenWait(leftMs) + "**");
}

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
const obfTemp = new Map(); 
const altListMenus = new Map();
const extractCarouselMenus = new Map();
const renamePanels = new Map(); 
const finderPanelCooldowns = new Map(); 
const FINDER_PANEL_CD_MS = 60 * 1000; 
const EXPIRY_MS = 5 * 60 * 1000;
let isReady = false;
let lastReady = Date.now();
let registering = false;
let reconnecting = false;

const saveLibrary = () => writeJSON(LIBRARY_FILE, library);

const USAGE_FILE = path.join(DATA_DIR, "command-usage.json");
let usageStore = readJSON(USAGE_FILE, { users: {} });
if (!usageStore || typeof usageStore !== "object") usageStore = { users: {} };
if (!usageStore.users || typeof usageStore.users !== "object") usageStore.users = {};
const saveUsage = () => writeJSON(USAGE_FILE, usageStore);
function trackCommandUse(user) {
  try {
    if (!user?.id) return;
    const id = String(user.id);
    const prev = usageStore.users[id] || { username: user.username || "unknown", count: 0 };
    prev.username = user.username || prev.username || "unknown";
    prev.count = (Number(prev.count) || 0) + 1;
    usageStore.users[id] = prev;
    saveUsage();
  } catch {}
}

function isOwner(userId) {
  return userId === OWNER_ID;
}

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
  
  if (member?.roles?.cache?.has(BUYER_ROLE_ID)) {
    console.log(`👑 isBuyer: ${uid} → YES (local member)`);
    return true;
  }
  
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
    
    let mainMember = mainGuild.members.cache.get(uid);
    if (!mainMember) {
      console.log(`👑 isBuyer: fetching member ${uid} from main guild...`);
      mainMember = await mainGuild.members.fetch({ user: uid, force: true });
    }
    if (!mainMember) {
      console.log(`👑 isBuyer: ${uid} → NO (not in main guild)`);
      return false;
    }
    
    if (mainMember.roles.cache.has(BUYER_ROLE_ID)) {
      console.log(`👑 isBuyer: ${uid} → YES (role in cache)`);
      return true;
    }
    
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
    
    if (member?.roles?.cache?.has(BUYER_ROLE_ID)) {
      console.log(`👑 isBuyer: ${uid} → YES (fallback local)`);
      return true;
    }
    return false;
  }
}
function channelAllowed(msg) {
  try {
    
    try {
      const fresh = readJSON(CONFIG_FILE, { allowedChannelId: null });
      if (fresh && typeof fresh === "object") {
        config.allowedChannelId = fresh.allowedChannelId ? String(fresh.allowedChannelId) : null;
      }
    } catch {}
    const chId = String(msg.channel?.id || msg.channelId || msg.channel_id || "");
    
    const allowed = config.allowedChannelId ? String(config.allowedChannelId) : "";
    if (!chId || !allowed) return false;
    return chId === allowed;
  } catch (e) {
    return false;
  }
}

function memberHasServerTag(member) {
  if (!member?.user) return false;
  try {
    const pg = member.user.primaryGuild;
    if (!pg) return false;
    
    return pg.identityEnabled === true && String(pg.identityGuildId) === String(GUILD_ID);
  } catch {
    return false;
  }
}
function hasServerTag(member) {
  return memberHasServerTag(member);
}

async function hasPrinceStatus(userId) {
  try {
    const mainGuild = await client.guilds.fetch(GUILD_ID);
    const member = await mainGuild.members.fetch(userId, { force: true });
    return memberHasServerTag(member);
  } catch {
    return false;
  }
}

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

async function syncPrinceRole(member) {
  try {
    if (!member || member.guild.id !== GUILD_ID) return;
    if (member.user.bot) return;
    
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

async function checkRegularPermission(msg, needsFileReply = false) {
  try {
    if (isBlacklisted(msg.author?.id) && !isOwner(msg.author?.id)) {
      return { allowed: false, reason: null, silent: true, isBuyer: false, blacklisted: true };
    }
  } catch {}
  try {
  
  if (isOwner(msg.author.id)) {
    return { allowed: true, isBuyer: true, isOwner: true };
  }

  
  if (await isBuyer(msg.author.id, msg.member)) {
    return { allowed: true, isBuyer: true };
  }

  const isDM = !msg.guild;

  
  if (isDM) {
    sendInputErrorV2(msg, "Buy a Premium on https://discord.com/channels/1509484518766018711/1561710834344923247 — to use this command or use command in DMs.").catch(() => {});
    return { allowed: false, reason: null, silent: true, isBuyer: false };
  }

  
  if (msg.guild.id !== GUILD_ID) {
    const inMain = await isInMainGuild(msg.author.id);
    if (!inMain) {
      return { allowed: false, reason: "❌ join in main server first bro `.gg/TBBAUZu8cW`.", isBuyer: false };
    }
  }

  
  const hasTag = await hasPrinceStatus(msg.author.id);
  if (!hasTag) {
    try {
      pendingTagRetry.set(String(msg.author.id), {
        content: String(msg.content || ""),
        channelId: String(msg.channelId || msg.channel?.id || ""),
        guildId: String(msg.guildId || msg.guild?.id || ""),
        messageId: String(msg.id || ""),
        at: Date.now()
      });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("tagcheck_" + msg.author.id)
          .setLabel("Check again")
          .setStyle(ButtonStyle.Success)
      );
      await replyComponentsV2(msg, {
        flags: IS_COMPONENTS_V2,
        components: [{
          type: 17,
          accent_color: 0xED4245,
          components: [
            { type: 10, content: "## Server tag required\nWear the `FS` server tag, then click check again." },
            { type: 14, divider: true, spacing: SEPARATOR_SPACING_SMALL },
            row.toJSON()
          ]
        }]
      }, { mention: false }).catch(() => {});
    } catch (e) {
      console.warn("⚠️ tag gate send:", e.message);
    }
    return { allowed: false, reason: null, silent: true, isBuyer: false };
  }
  
  if (!channelAllowed(msg)) {
    const allowedMention = config.allowedChannelId ? ("<#" + config.allowedChannelId + ">") : "the allowed channel";
    sendInputErrorV2(msg, "**Tips:**\n- Go to " + allowedMention + ", make sure you're using our server tag.").catch(() => {});
    return { allowed: false, reason: null, silent: true, isBuyer: false };
  }
  
  try {
    if (msg.member && msg.guild?.id === GUILD_ID) {
      await syncPrinceRole(msg.member);
    }
  } catch {}
  if (needsFileReply) {
    const hasFile = await isReplyingToFileAsync(msg).catch(() => isReplyingToFile(msg));
    if (!hasFile && !(msg.attachments?.size > 0)) {
      return { allowed: false, reason: "❌ reply to a file or forwarded file, dumbass.", isBuyer: false };
    }
  }

  
  return { allowed: true, isBuyer: false };
  } catch (e) {
    console.error("❌ checkRegularPermission error:", e.message);
    
    return { allowed: true, isBuyer: false, error: e.message };
  }
}

function collectMessageAttachments(message) {
  const out = [];
  if (!message) return out;
  try {
    for (const a of message.attachments?.values?.() || []) out.push(a);
  } catch {}
  try {
    
    if (!out.length && message.attachments?.forEach) {
      message.attachments.forEach(a => out.push(a));
    }
  } catch {}
  try {
    for (const s of message.messageSnapshots?.values?.() || []) {
      for (const a of s.attachments?.values?.() || []) out.push(a);
    }
  } catch {}
  
  try {
    const walk = (comps) => {
      if (!Array.isArray(comps)) return;
      for (const c of comps) {
        if (!c) continue;
        if (c.type === 13 && c.file) {
          const name = String(c.file.name || c.file.filename || (c.file.url || "").replace(/^attachment:\/\//, "") || "file");
          
          const match = out.find(a => (a.name || a.filename) === name);
          if (!match && (c.file.url || "").startsWith("http")) {
            out.push({ name, url: c.file.url, proxyURL: c.file.url, size: c.file.size || 0 });
          }
        }
        if (Array.isArray(c.components)) walk(c.components);
      }
    };
    walk(message.components);
  } catch {}
  return out;
}

async function fetchMessageRaw(channelId, messageId) {
  const tryFetch = async (authHeader) => {
    try {
      const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
        headers: {
          Authorization: authHeader,
          "User-Agent": "Mozilla/5.0 (compatible; PrinceBot/1.0)"
        }
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };
  
  let data = await tryFetch(`Bot ${TOKEN}`);
  if (data) return data;
  
  const ut = normalizeUserToken(config.userToken || "");
  if (ut) {
    data = await tryFetch(ut);
    if (data) return data;
  }
  return null;
}

function attachmentsFromRawMessage(raw) {
  const out = [];
  if (!raw) return out;
  const push = (a) => {
    if (!a) return;
    const name = a.filename || a.name || "file";
    const url = a.url || a.proxy_url || a.proxyURL;
    if (!url || !name) return;
    if (out.some(x => x.name === name && x.url === url)) return;
    out.push({
      id: a.id,
      name,
      filename: name,
      url,
      proxyURL: a.proxy_url || a.proxyURL || a.url,
      proxy_url: a.proxy_url || a.url,
      size: a.size || 0,
      contentType: a.content_type || a.contentType || null
    });
  };
  for (const a of raw.attachments || []) push(a);
  
  const walk = (comps) => {
    if (!Array.isArray(comps)) return;
    for (const c of comps) {
      if (!c) continue;
      if (c.type === 13 && c.file) {
        const name = String(c.file.name || c.file.filename || String(c.file.url || "").replace(/^attachment:\/\//, "") || "file");
        if (c.file.url && String(c.file.url).startsWith("http")) {
          push({ name, filename: name, url: c.file.url, proxy_url: c.file.url, size: c.file.size || 0, content_type: c.file.content_type || null });
        }
      }
      if (Array.isArray(c.components)) walk(c.components);
    }
  };
  try { walk(raw.components); } catch {}
  
  try {
    const snaps = raw.message_snapshots || raw.messageSnapshots || [];
    for (const snap of snaps) {
      const m = snap?.message || snap;
      if (!m) continue;
      for (const a of m.attachments || []) push(a);
      try { walk(m.components); } catch {}
    }
  } catch {}
  return out;
}

async function fetchRepliedMessage(msg) {
  const refId = msg?.reference?.messageId;
  if (!refId) return null;
  try {
    return await msg.channel.messages.fetch({ message: refId, force: true });
  } catch {}
  try {
    return await msg.channel.messages.fetch(refId);
  } catch {}
  try {
    return msg.channel?.messages?.cache?.get(refId) || null;
  } catch {
    return null;
  }
}

function isReplyingToFile(msg) {
  const ref = msg.reference?.messageId;
  if (!ref) return false;
  const repliedMsg = msg.channel?.messages?.cache?.get(ref);
  if (!repliedMsg) return true; 
  if (collectMessageAttachments(repliedMsg).length > 0) return true;
  try {
    const flags = Number(repliedMsg.flags?.bitfield ?? repliedMsg.flags ?? 0);
    if (flags & 32768) return true; 
  } catch {}
  return false;
}

async function isReplyingToFileAsync(msg) {
  if (!msg?.reference?.messageId) return false;
  
  const list = await attachmentsFromMsgOrReply(msg, null);
  if (list.length > 0) return true;
  try {
    const repliedMsg = await fetchRepliedMessage(msg);
    if (!repliedMsg) return true;
    const flags = Number(repliedMsg.flags?.bitfield ?? repliedMsg.flags ?? 0);
    if (flags & 32768) return true;
  } catch {}
  return false;
}

async function attachmentsFromMsgOrReply(msg, filterFn = null) {
  const onlyFiles = (arr) => (arr || []).filter(a => {
    if (!a) return false;
    const url = a.url || a.proxyURL || a.proxy_url;
    const name = a.name || a.filename;
    return !!url && !!name;
  }).map(a => {
    const url = a.url || a.proxyURL || a.proxy_url;
    const name = a.name || a.filename;
    return {
      id: a.id,
      name,
      filename: name,
      url,
      proxyURL: a.proxyURL || a.proxy_url || url,
      size: a.size || 0,
      contentType: a.contentType || a.content_type || null
    };
  });

  let list = onlyFiles(collectMessageAttachments(msg));

  if (!list.length && msg.reference?.messageId) {
    const refId = msg.reference.messageId;
    const refChannelId = msg.reference.channelId || msg.channel?.id;
    
    try {
      const refMsg = await fetchRepliedMessage(msg);
      if (refMsg) {
        list = onlyFiles(collectMessageAttachments(refMsg));
        
        if (!list.length) {
          try {
            list = onlyFiles(attachmentsOf(refMsg).map(x => x.attachment));
          } catch {}
        }
      }
    } catch {}
    
    if (!list.length && refChannelId) {
      try {
        const raw = await fetchMessageRaw(refChannelId, refId);
        list = onlyFiles(attachmentsFromRawMessage(raw));
      } catch {}
    }
    
    if (!list.length && msg.channel?.id && msg.channel.id !== refChannelId) {
      try {
        const raw = await fetchMessageRaw(msg.channel.id, refId);
        list = onlyFiles(attachmentsFromRawMessage(raw));
      } catch {}
    }
  }

  
  if (!list.length && msg.id) {
    try {
      const raw = await fetchMessageRaw(msg.channel.id, msg.id);
      list = onlyFiles(attachmentsFromRawMessage(raw));
    } catch {}
  }

  if (typeof filterFn === "function") list = list.filter(filterFn);
  return list;
}

const SIGNATURES = {
    Prometheus: [
        [20, /return\s*\(function\s*\(\.\.\.\)\s*local\s+\w\s*=\s*\{/],
        [45, /=\{\s*(?:'[A-Za-z0-9]+'\s*,\s*){4,}'[A-Za-z0-9]+'\s*\}/],
        [20, /\b\d{4,7}-\(-?\d{4,7}\)/],
        [15, /math\.floor/],
        [10, /string\.char.*table\.concat.*string\.sub/s],
        [15, /for\s+\w+,\w+\s+in\s+ipairs\s*\(/],
        [10, /getfenv\s+and\s+getfenv\(\)\s+or\s+_ENV/],
        [20, /local\s+function\s+\w\s*\(\w\)\s*return\s+\w\[\w\+/],
        [12, /bit32\.rrotate/],
        [8,  /bit32\.rshift/],
        [30, /local\s+\w\s*=\s*\{\s*(?:'(?:\\[0-9]{2,3}){6,}'[;,]?\s*){5,}/],
        [25, /local\s+function\s+\w+\s*\(\s*\w+\s*\)[\s\S]{0,300}string\.char\s*\([\s\S]{0,200}string\.byte/s],
        [20, /\bg\s*\[\s*\d+\s*\]/],
        [18, /string\.byte\s*\(\s*\w+\s*,\s*\w+\s*\)\s*[-+^]\s*\w+/],
        [35, /^return\s*\(\s*function\s*\(\s*\.\.\.\s*\)\s*local\s+\w\s*=\s*\{\s*'/m],
    ],
    "MoonSec V2": [
        [25, /Protected_by_MoonSecV2/],
        [50, /[\u3480-\u34c0]{5,}/],
        [25, /_msec\s*=/],
        [20, /#\[\[[^\]]{3,}\]\]/],
        [15, /\(0x[0-9a-f]+\/\d+\)/],
        [10, /discord\.gg\/gQEH/],
    ],
    "MoonSec V3": [
        [30, /\(\[\[This file was protected with MoonSec V3\]\]\)/],
        [30, /\:gsub\s*\(\s*'\.+'\s*,\s*\(function\s*\(a\)/],
        [20, /_[A-Z][a-zA-Z]{6,}\s*=\s*a\s*;/],
        [25, /return\s*\(function\s*\(\w,\.\.\.\)local\s+\w;local\s+\w;/],
        [15, /while\s+n<\s+0x[0-9a-f]+\s+and\s+e%0x[0-9a-f]+<0x[0-9a-f]+/],
        [20, /\bk\s*\(\s*\d{2,3}\s*,\s*"[A-Za-z0-9_()\^>?#_~!|]{20,}"/],
        [15, /l\.[a-zA-Z_]{6,}\s*\(/],
        [15, /d\s*=\s*"(?:\\[0-9]{1,3}){10,}"/],
        [12, /local\s+e\s*=\s*0x01\s+local\s+function\s+k/],
    ],
    "Luraph 14": [
        [55, /--\s*This file was protected using Luraph Obfuscator v14(?:\.\d+)*/i],
        [50, /Luraph Obfuscator v14(?:\.\d+)*/i],
        [35, /return\s*\(\s*\{[A-Z]{1,3}=bit32\.\w+/],
        [30, /0[Xx][0-9a-fA-F]+_+[0-9a-fA-F]*/],
        [25, /0[Bb][01_]{3,}/],
        [20, /for\s+\w\s*=\s*0[Xx][0-9a-fA-F_]+\s*,\s*0[Xx][0-9a-fA-F_]+/],
        [20, /\w\[0[Xx][0-9a-fA-F]+__[0-9a-fA-F]*\]/],
        [20, /0[Xx][0-9a-fA-F]{1,4}_+[0-9a-fA-F]{1,4}/],
        [15, /\bbuffer\b/],
        [12, /coroutine\.wrap/],
        [20, /"[A-Za-z0-9$#@!%^&*()\[\]{}|<>?_=+\-.,;:'"\\/]{200,}"/],
    ],
    "Luraph 10": [
        [60, /--\s*This file was generated using Luraph Obfuscator v10(?:\.\d+)*/i],
        [55, /Luraph Obfuscator v10(?:\.\d+)*/i],
        [55, /"LPH\|[0-9A-Fa-f]{20,}"/],
        [40, /string\.char\s*\(\s*\w+\s*,\s*0\s*\)/],
        [35, /:gsub\s*\(\s*"\.\."/],
        [30, /return\s+loadstring\s*\(/],
        [20, /\b[lI]{4,}\b/],
        [25, /l11i1lIil1lIIiiIill:sub\(5\)/],
        [20, /tonumber\s*\(\s*\w+\s*,\s*16\s*\)/],
    ],
    IronBrew: [
        [10, /local\s+\w+=string\.byte;local\s+\w+=string\.char;local\s+\w+=string\.sub;local\s+\w+=table\.concat;local\s+\w+=table\.insert;local\s+\w+=math\.ldexp/],
        [10, /local\s+function\s+\w+\(\w+\)\s*local\s+\w+,\s*\w+,\s*\w+\s*=\s*"",\s*"",\s*\{\}/],
        [45, /\b\w\('[0-9A-Z]{15,}'\)/],
        [10, /getfenv\s+or\s+function\s*\(\s*\)\s*return\s+_ENV\s+end/],
        [10, /unpack\s+or\s+table\.unpack/],
    ],
    "25ms Obfuscator": [
        [30, /(?:\\\d{2,3}){15,}/],
        [35, /"[A-Za-z0-9+/=]{120,}"/],
        [25, /string\.gsub\s*\(\s*".-",\s*function/],
        [30, /\{(?:\d+,){40,}\d+\}/],
        [20, /math\.ldexp|bit32\.(?:bxor|lshift|rshift)/],
        [15, /(?:\(\s*\d+\s*[+\-*/]\s*\d+\s*\)){5,}/],
        [25, /return\s*\(\s*function\s*\(/],
        [20, /^.{400,}$/m],
        [15, /(?:[+\-*/%^&|]{1}){20,}/],
        [40, /(?:\\\d{2,3}){25,}/],
        [25, /string\.char\s*\(\s*(?:\d+,){10,}\d+\s*\)/]
    ],
    IronBrew3: [
        [30, /^--ironbrew3:tm/],
        [30, /return\(function\(\w+,\w+,\w+,\w+,\w+,\w+,\w+,\w+,\w+,\w+,\w+,\w+,\w+,\w+,\w+,\w+,\w+,\w+,\w+,\w+/],
        [40, /bit32\s+or\s+bit/],
        [35, /(?:[0-9A-Fa-f]{2}){15,}/],
        [30, /\{(?:\d+,){50,}\d+\},\s*0,\s*255,\s*1\)/],
        [20, /math\.max,math\.atan2,string\.sub,math\.ceil,string\.len/],
    ],
    "LuaObfuscator VM": [
        [50, /local\s+v0\s*=\s*tonumber\s*;\s*local\s+v1\s*=\s*string\.byte/],
        [35, /local\s+function\s+v15\s*\(v16,v17/],
        [50, /return\s+v15\s*\(\s*"LOL!/],
        [30, /[0-9A-F]{2}3Q00[0-9A-F]/],
        [30, /[0-9A-F]{2}2Q00[0-9A-F]/],
        [20, /local\s+function\s+v29\s*\(v57/],
        [15, /v\d+\s*=\s*unpack\s+or\s+table\.unpack/],
        [15, /local\s+v8\s*=\s*math\.ldexp/],
        [15, /getfenv\s+or\s+function\s*\(\s*\)\s*return\s+_ENV\s+end/],
    ],
    WynFuscator: [
        [10, /--\s*Protected by wYnFuscate/],
        [10, /wynfuscate\.com/],
        [30, /local\s+cd\s*=\s*"[A-Za-z0-9^*.?()\[\]!@#$%&_~|<>{}`'\-]{80,}"/],
        [30, /local\s+cG\s*=\s*65536/],
        [30, /local\s+cj\s*=\s*function\s*\(c8,c9,c4\)/],
        [25, /cg\[cj\(\d+,cT,5\)\]/],
        [20, /local\s+cl\s*=\s*"(?:\\[0-9]{1,3}){20,}"/],
        [15, /c0\s*=\s*4294967296/],
        [20, /\bcA\s*\(\s*\d+\s*\)/],
    ],
    Hercules: [
        [10, /--\[Protected By Hercules/],
        [15, /'Protected By Hercules V1\.6 \| github\.com\/zeusssz\/hercules-obfuscator'/],
        [10, /hercules-obfuscator\.xyz/],
        [25, /local\s+[A-Z][a-z][A-Za-z]{6,}\s*,\s*[A-Z][a-z][A-Za-z]{6,}/],
        [30, /[A-Z][a-zA-Z]{6,}\s*=\s*ipairs\s*;/],
        [25, /[A-Z][a-zA-Z]{6,}\s*=\s*pairs\s*;/],
        [20, /if\s+false\s+then\s+local\s+\w+\s*=\s*\d+/],
        [20, /while\s+false\s+do\s+local\s+\w+\s*=\s*\d+\s+break\s+end/],
        [12, /math\.ldexp/],
        [50, /\('.*?\\\d+\\\d+'\)/],
        [15, /return\s+\(function\s*\(\.\.\.\)\s+local\s+[A-Z][a-z][A-Za-z]{5,}/],
    ],
    MoonVeil: [
        [50, /--\s*This script was generated using the MoonVeil Obfuscator/],
        [40, /moonveil\.cc/],
        [35, /local\s+\w+,\w+,\w+,\w+=getmetatable,bit32\.bxor,pairs,type/],
        [30, /\(function\(\.\.\.\)return\{\[1\]=\{\.\.\.\},\[2\]=\w+\(\'#\',\.\.\.\)\}end\)/],
        [25, /return\s*\{[^}]*\[1\]\s*=\s*\{[^}]*\},\s*\[2\]\s*=\s*\w+\s*\(\s*'#'/],
        [30, /Ki=Ig\(Ki,'\[\[\^A-Z\]/],
        [25, /local\s+function\s+\w+\s*\(\w+,\w+,\w+\)\s*if\s+\w+>\w+\s+then\s+return\s+end\s+return\s+\w+\[\w+\]/],
        [25, /bit32\s*\.\s*lshift\s*,\s*bit32\s*\.\s*rshift\s*,\s*bit32\s*\.\s*band/],
        [20, /'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789\+\/'.*gsub/],
        [20, /repeat\s+while\s+true\s+do\s+if\s+\w+<=[0-9]+\s+then\s+if\s+\w+<=[0-9]+/],
        [15, /Ng\[[\w-]+\]\s*or\s+\w+\([\w-]+,/],
    ],
    "77fuscator": [
        [60, /\[\[77fuscator\s+[\d.]+/],
        [30, /discord\.gg\/[A-Za-z0-9]{8,}/],
        [35, /do\s+local\s+\w\s*=\s*\[\[77fuscator/],
        [30, /o,g,s,l,n,b,j,v,bb,m,r,bf=string\.byte,string\.char,string\.sub,table\.concat,math\.ldexp/],
        [25, /be=function\s*\(\w,\w+\)\s*local\s+\w+\s+local\s+\w+=3/],
        [25, /bd=function\s*\(\w\)\s*local\s+\w+,\w+,\w+,\w+,\w+,\w+,\w+\s+local\s+\w+=0/],
        [20, /bj=function\s*\(\s*\)\s*local\s+\w+,\w+\s+local\s+\w+=0/],
        [20, /getfenv\s+or\s+function\s*\(\s*\)\s*return\s+_ENV\s+end/],
        [20, /bg,bh=nil/],
        [15, /q=2\^32-1/],
        [15, /bh=function\s*\(\w,\w+\)\s*if\s+\w<0\s+then\s+return\s+bg\(/],
    ],
    Lunr: [
        [30, /--\s*This file was protected using Lunr/],
        [15, /discord\.gg\/BGQkGUW2Qs/],
        [15, /\{`[A-Za-z0-9+/=]{6,}`\s*[;,]/],
        [10, /\blocal\s+(?:[lI1i]{4,})\s*=/],
        [20, /"(?:All warfare is based on deception|The supreme art of war|If you know the enemy)[^"]*Sun Tzu"/],
        [30, /error\s*\(\s*`Tamper Detected!`\s*\)/],
        [10, /setmetatable\s*\(\s*\{\s*\}\s*,\s*\{$/],
        [15, /\(-\d{5,}\+\d{5,}\)/],
        [10, /getfenv\s+and\s+getfenv\(\)\s+or\s+_ENV/],
        [50, /lliilI1i\s*=/],
        [10, /`[A-Za-z0-9+/]{10,}={0,2}`/],
        [15, /pcall\s*\(\s*function\s*\(\s*\)[^)]{0,80}end\s*\)/],
    ],
    LightRay: [
        [60, /"LPS\?[0-9A-Z]{30,}"/],
        [40, /return\s*\(\s*function\s*\(\w,\w,\w,\w,\w,\w,\w,\w,\w,\w,\w,\w,\w,\w,\w,\w,\w,\w,\w,\w/],
        [30, /function\s*\(\s*vk\s*,\s*vB\s*,\s*DH\s*,\s*ZX/],
        [35, /0[Bb][01_]{8,}/],
        [25, /\bZV\b.*\bwhile\s*\(ZV\)\s*do\b/s],
        [30, /vB\[0[BbXx][0-9a-fA-F_]{4,}\]/],
        [25, /0_[bBxX][0-9a-fA-F_]{4,}/],
        [20, /\bts\s*\(\s*0[xXbB][0-9a-fA-F_]+\s*,\s*vB\[/],
        [20, /\brY\s*\(\s*ts\s*\(/],
        [15, /\}\s*,\s*false\s*,\s*string\.sub\s*,\s*select\s*,\s*error/],
        [20, /string\.byte\s*,\s*tonumber\s*,\s*math\.ldexp\s*,\s*\.\.\.\s*\)\s*\(\.\.\.\s*\)\s*;/],
    ],

    Luarmor: [
        [70, /luarmor\.net/i],
        [65, /luarmor\.gg/i],
        [60, /_G\s*\[\s*["']LPH_NO_VIRTUALIZE["']\s*\]/i],
        [55, /LPH_NO_VIRTUALIZE|LPH_JIT|LPH_ENCFUNC|LPH_ENCSTR/i],
        [50, /\bLuarmor\b/i],
        [45, /script_key\s*=\s*script_key\s*or\s*getgenv/i],
        [40, /getfenv\(\)\.script_key|getgenv\(\)\.script_key/i],
        [35, /loadstring\s*\(\s*game\s*:\s*HttpGet\s*\(\s*["']https?:\/\/[^"']*luarmor/i],
        [30, /api\.luarmor\.net|cdn\.luarmor/i],
        [25, /LRM_[A-Z0-9_]{6,}/],
    ],
    WeAreDevs: [
        [70, /wearedevs\.net\/obfuscator/i],
        [55, /\[\[\s*v\d+\.\d+\.\d+\s+https?:\/\//],
        [45, /local\s+o\s*=\s*\{\s*"(?:\\[0-9]{2,3}){6,}"/],
        [35, /WeAreDevs|wearedevs/i],
        [30, /return\s*\(\s*function\s*\(\s*\.\.\.\s*\)\s*local\s+\w\s*=\s*\{\s*"(?:\\[0-9]{2,3}){8,}"/],
    ],
    PolSec: [
        [60, /\bPolSec\b|polsec/i],
        [50, /Protected\s+by\s+PolSec/i],
        [40, /polsec\.(gg|net|xyz)/i],
        [30, /PS_[A-Z0-9_]{8,}/],
    ],
    "PSU Obfuscator": [
        [65, /PSU\s*Obfuscator|PSU\s*Protector/i],
        [55, /--\s*\[\[.*PSU/i],
        [45, /"LPS\?[0-9A-Z]{20,}"/],
        [40, /PSU_[A-Za-z0-9_]{6,}/],
        [30, /getfenv\(\)\.PSU|getgenv\(\)\.PSU/i],
    ],
    "Synapse Xen": [
        [55, /Synapse\s*Xen|synxen/i],
        [45, /--\s*Protected\s+by\s+Synapse/i],
        [35, /syn\s*\.\s*crypt|syn\s*\.\s*protect/i],
        [30, /getgenv\(\)\.syn|getrenv\(\)\.syn/i],
    ],
    Hysteria: [
        [55, /\bHysteria\b|hysteria\s*obf/i],
        [45, /Protected\s+by\s+Hysteria/i],
        [35, /HYSTERIA_[A-Z0-9_]+/i],
    ],
    AztupBrew: [
        [55, /AztupBrew|Aztup\s*Brew/i],
        [45, /--\s*AztupBrew/i],
        [35, /AZTUP_[A-Z0-9_]+/i],
    ],
    DarkEccentric: [
        [55, /DarkEccentric|darkeccentric/i],
        [45, /DE_[A-Z][a-zA-Z0-9_]{5,}/],
        [35, /Protected\s+by\s+DarkEccentric/i],
    ],
    Axon: [
        [50, /\bAxon\b|axon\.exe|axon\s*obfuscator/i],
        [40, /AXON_[A-Z0-9_]+/],
        [30, /--\s*Axon/i],
    ],
    "Luraph": [
        [50, /Luraph\s*Obfuscator/i],
        [45, /--\s*This file was protected using Luraph/i],
        [40, /--\s*This file was generated using Luraph/i],
        [35, /"LPH\|[0-9A-Fa-f]{16,}"/],
        [30, /\bLPH_[A-Z0-9_]+\b/],
        [25, /luraph\.com|lura\.ph/i],
    ],
    "MoonSec": [
        [45, /MoonSec|moonsec/i],
        [40, /Protected_by_MoonSec/i],
        [35, /This file was protected with MoonSec/i],
        [25, /_msec\s*=/],
    ],
    "Bytecode": [
        [40, /string\.dump\s*\(/],
        [35, /loadstring\s*\(\s*["']\\x[0-9a-fA-F]{2}/],
        [30, /(?:\\x[0-9a-fA-F]{2}){20,}/],
        [25, /load\s*\(\s*["'][\x00-\x1f]/],
    ],
    "VM-Obfuscated": [
        [30, /while\s+true\s+do\s+local\s+\w+\s*=\s*\w+\[\w+\]/],
        [25, /local\s+\w+\s*=\s*\{\s*\[0\]\s*=\s*function/],
        [20, /getfenv\s*\(\s*0\s*\)|getfenv\s*\(\s*1\s*\)/],
        [20, /setfenv\s*\(/],
        [15, /debug\.getinfo|debug\.traceback/],
        [15, /newproxy\s*\(\s*true\s*\)/],
    ],
    "SimpleObfuscator": [
        [40, /luaobfuscator\.com|obfuscator\.io\/lua/i],
        [35, /Simple\s*Obfuscator|Online\s*Lua\s*Obfuscator/i],
        [30, /--\s*Obfuscated\s+with\s+/i],
        [25, /local\s+\w+\s*=\s*string\.char\s*\(\s*\d+\s*(?:,\s*\d+){8,}\s*\)/],
    ],
    "Xeon": [
        [50, /\bXeon\b.*[Oo]bfuscator|XeonObfuscator/i],
        [40, /--\s*Protected\s+by\s+Xeon/i],
        [30, /XEON_[A-Z0-9_]+/],
    ],
    "Script-Ware": [
        [45, /Script[\s-]?Ware|scriptware/i],
        [35, /secure_load|sw_crypt/i],
        [30, /getgenv\(\)\.SW|getgenv\(\)\.ScriptWare/i],
    ],
    "Fluxus": [
        [40, /\bFluxus\b.*protect|fluxus\s*obf/i],
        [30, /fluxus\.(me|net)/i],
        [25, /getgenv\(\)\.Fluxus/i],
    ],
    "KRNL": [
        [35, /\bKRNL\b.*protect|krnl\s*obf/i],
        [25, /getgenv\(\)\.KRNL|getgenv\(\)\.krnl/i],
    ],
    "Celery": [
        [40, /\bCelery\b.*[Oo]bfuscator|celery\s*protect/i],
        [30, /CELERY_[A-Z0-9_]+/],
    ],
    "Panda": [
        [40, /Panda\s*Obfuscator|pandadevkit/i],
        [30, /PANDA_[A-Z0-9_]+/],
    ],
    "Nihon": [
        [40, /\bNihon\b.*[Oo]bfuscator|nihon\s*protect/i],
        [30, /NIHON_[A-Z0-9_]+/],
    ],
    "Horion": [
        [40, /\bHorion\b.*[Oo]bfuscator/i],
        [30, /HORION_[A-Z0-9_]+/],
    ],
    "SkidFuscator": [
        [45, /SkidFuscator|skidfuscator/i],
        [35, /--\s*SkidFuscator/i],
    ],
    "Remotely": [
        [40, /Remotely\s*Obfuscator|remotely\.dev/i],
        [30, /REMOTELY_[A-Z0-9_]+/],
    ],

    Faulmor: [
        [80, /faulmor\.site/i],
        [70, /--FAULMORV[134]\b/],
        [65, /\bFAULMORV[134]\b/],
        [60, /LOADER_HASH\s*=/],
        [55, /TRIPWIRE_URL|EXEC_URL/i],
        [50, /__FMOR_HB|FMOR_LOADER_OK/i],
        [45, /tripwire\s*\(/i],
        [40, /faulmor:v2:/i],
        [35, /api\/public\/(exec|tripwire|loaders)/i],
        [30, /LOADER_TOKEN|EXEC_SIG|EXEC_NONCE|EXEC_TS/],
        [25, /hwid_mismatch|canary_mismatch|bad_signature/i],
    ],
    "Prince Obfuscator": [
        [80, /--\s*This file was protected using Prince Obfuscator/i],
        [50, /This file was protected using Prince Obfuscator/i],
        [30, /Prince Obfuscator/i],
    ],
    Unobfuscated: [
        [15, /--\s*[A-Za-z ]{5,}/],
        [20, /function\s+[a-zA-Z_][a-zA-Z0-9_]{3,}\s*\(/],
        [17, /\bprint\s*\(/],
        [15, /\bwarn\s*\(/],
        [15, /\brequire\s*\(/],
        [15, /\bfor\s+[a-zA-Z_]\w*\s*,\s*[a-zA-Z_]\w*\s+in\s+pairs\s*\(/],
        [15, /\bif\s+[a-zA-Z_]\w*\s*[=~<>]+\s*[a-zA-Z_\d"']+\s+then\b/],
        [20, /\blocal\s+[a-zA-Z_][a-zA-Z0-9_]{3,}\s*=/],
        [15, /local\s+function\s+[a-zA-Z_]\w+\s*\(/],
        [10, /game\s*:\s*GetService\s*\(/],
        [10, /game\s*:\s*HttpGet\s*\(/],
        [12, /workspace\./],
        [12, /script\./],
    ],
};

const _DEFINITELY_OBF = [
    /faulmor\.site|FAULMORV[134]|__FMOR_HB|faulmor:v2:/i,
    /This file was protected using Prince Obfuscator/i,
    /--\s*This file was protected using Prince Obfuscator/i,
    /luarmor\.net|luarmor\.gg|LPH_NO_VIRTUALIZE/i,
    /wearedevs\.net\/obfuscator/i,
    /Protected_by_MoonSec|This file was protected with MoonSec/i,
    /This file was protected using Luraph|This file was generated using Luraph/i,
    /"LPH\|[0-9A-Fa-f]{20,}"/,
    /"LPS\?[0-9A-Z]{20,}"/,
    /PolSec|polsec\.(gg|net)/i,
    /PSU\s*Obfuscator|PSU\s*Protector/i,
    /Protected By Hercules/i,
    /This file was protected using Lunr/i,
    /This script was generated using the MoonVeil/i,
    /\[\[77fuscator/,
    /--ironbrew3:tm/,
    /return\s+v15\s*\(\s*"LOL!/,
    /[\u3480-\u34c0]{5,}/,
    /\b[lI1i]{5,}\b/,
    /All warfare is based on deception.*Sun Tzu/,
    /0_[bBxX][0-9a-fA-F_]{6,}/,
    /`[A-Za-z0-9+/]{10,}={0,2}`/,
    /error\s*\(\s*`Tamper Detected/,
    /lliilI1i/,
    /return\s*\(\s*function\s*\(\s*\.\.\.\s*\)\s*local\s+\w\s*=\s*\{\s*"(?:\\[0-9]{2,3}){6,}"/,
    /script_key\s*=\s*script_key\s*or\s*getgenv/i,
    /api\.luarmor\.net/i,
];

const _WEAREDEVS_SIGNALS = [
    /wearedevs\.net\/obfuscator/,
    /\[\[\s*v\d+\.\d+\.\d+\s+https?:\/\//,
    /local\s+o\s*=\s*\{\s*"(?:\\[0-9]{2,3}){6,}"/,
];

function calcEntropy(data) {
    if (!data) return 0.0;
    const freq = {};
    for (const c of data) freq[c] = (freq[c] || 0) + 1;
    const len = data.length;
    return -Object.values(freq).reduce((sum, c) => {
        const p = c / len;
        return sum + p * Math.log2(p);
    }, 0);
}

function statFeatures(code) {
    const lines = code.split('\n');
    const totalChars = code.length;
    if (totalChars === 0) return {};
    
    const avgLine = lines.reduce((s, l) => s + l.length, 0) / lines.length;
    const longLines = lines.filter(l => l.length > 500).length / lines.length;
    const hexCount = (code.match(/0x[0-9a-fA-F]+/g) || []).length;
    const numEsc = (code.match(/\\[0-9]{2,3}/g) || []).length;
    const ops = (code.match(/[+\-*/%^&|]/g) || []).length;
    const unicodeCnt = (code.match(/[\u3480-\u34c0]{3,}/g) || []).length;
    const backtickStrings = (code.match(/`[^`]{6,}`/g) || []).length;
    const ilNames = (code.match(/\b[lI1i]{4,}\b/g) || []).length;
    const binLiterals = (code.match(/0[Bb][01_]{4,}/g) || []).length;
    const underscoreHex = (code.match(/0_[bBxX][0-9a-fA-F_]{4,}/g) || []).length;
    const dqNumescStrings = (code.match(/"(?:\\[0-9]{2,3}){6,}"/g) || []).length;

    return {
        entropy: calcEntropy(code),
        avgLineLength: avgLine,
        longLineRatio: longLines,
        hexLiteralDensity: hexCount / Math.max(totalChars / 1000, 1),
        numericEscapeDensity: numEsc / Math.max(totalChars / 1000, 1),
        operatorDensity: ops / Math.max(totalChars / 1000, 1),
        unicodeIdentCount: unicodeCnt,
        backtickStringCount: backtickStrings,
        ilNameCount: ilNames,
        binLiteralCount: binLiterals,
        underscoreHexCount: underscoreHex,
        dqNumescStrings: dqNumescStrings,
    };
}

function isWeAreDevs(code) {
    for (const pat of _WEAREDEVS_SIGNALS) {
        if (pat.test(code)) return true;
    }
    return false;
}

function statBonus(obfName, stats, isWad = false) {
    let bonus = 0.0;
    const ent = stats.entropy || 0;
    const nesc = stats.numericEscapeDensity || 0;
    const avgLine = stats.avgLineLength || 0;
    const longLine = stats.longLineRatio || 0;
    const unicodeCnt = stats.unicodeIdentCount || 0;
    const backtickCnt = stats.backtickStringCount || 0;
    const ilCnt = stats.ilNameCount || 0;
    const binCnt = stats.binLiteralCount || 0;
    const usHex = stats.underscoreHexCount || 0;
    const dqNesc = stats.dqNumescStrings || 0;

    switch (obfName) {
        case 'Prometheus':
            if (nesc > 5) bonus += 10;
            if (ent > 4.5 && ent < 6.0) bonus += 5;
            if (nesc > 15) bonus += 15;
            if (isWad) bonus -= 80;
            if (dqNesc > 10) bonus -= 40;
            break;
        case 'WeAreDevs':
            if (nesc > 10) bonus += 15;
            if (dqNesc > 20) bonus += 25;
            if (ent > 4.0 && ent < 5.5) bonus += 8;
            if (avgLine > 200) bonus += 10;
            break;
        case 'MoonSec V2':
            if (unicodeCnt > 5) bonus += 20;
            break;
        case 'MoonSec V3':
            if (avgLine > 300) bonus += 8;
            if (ent > 5.5) bonus += 5;
            break;
        case 'Luraph 14':
            if (longLine > 0.1) bonus += 8;
            if ((stats.hexLiteralDensity || 0) > 10) bonus += 6;
            break;
        case 'Luraph 10':
            if (ilCnt > 10) bonus += 10;
            if (ent > 4.5) bonus += 5;
            break;
        case 'LightRay':
            if (binCnt > 20) bonus += 15;
            if (usHex > 10) bonus += 12;
            if (avgLine > 1000) bonus += 10;
            if (ent > 4.8) bonus += 5;
            break;
        case 'LuaObfuscator VM':
            if (longLine > 0.5) bonus += 8;
            break;
        case 'WynFuscator':
            if (avgLine > 500) bonus += 10;
            if (ent > 5.0) bonus += 5;
            break;
        case 'Hercules':
            if (avgLine > 100) bonus += 5;
            break;
        case 'IronBrew':
            if ((stats.operatorDensity || 0) > 20) bonus += 5;
            break;
        case 'MoonVeil':
            if (avgLine > 200) bonus += 8;
            if (ent > 5.0) bonus += 5;
            break;
        case '77fuscator':
            if (avgLine > 300) bonus += 8;
            break;
        case 'Lunr':
            if (backtickCnt > 10) bonus += 15;
            if (ilCnt > 20) bonus += 10;
            if (ent > 4.5) bonus += 5;
            break;
        case '25ms Obfuscator':
            if ((stats.numericEscapeDensity || 0) > 8) bonus += 12;
            if ((stats.avgLineLength || 0) > 250) bonus += 10;
            if ((stats.entropy || 0) > 5.2) bonus += 6;
            if (isWad) bonus -= 60;
            if (dqNesc > 10) bonus -= 30;
            break;
        case 'Luarmor':
            if (ent > 4.5) bonus += 8;
            if (avgLine > 150) bonus += 5;
            break;
        case 'WeAreDevs':
            if (nesc > 10) bonus += 15;
            if (dqNesc > 20) bonus += 25;
            if (ent > 4.0 && ent < 5.5) bonus += 8;
            if (avgLine > 200) bonus += 10;
            break;
        case 'PolSec':
            if (ent > 5.0) bonus += 6;
            break;
        case 'PSU Obfuscator':
            if (avgLine > 200) bonus += 8;
            if (ent > 5.0) bonus += 5;
            break;
        case 'Synapse Xen':
        case 'Hysteria':
        case 'AztupBrew':
        case 'DarkEccentric':
        case 'Axon':
        case 'Xeon':
        case 'Script-Ware':
        case 'Fluxus':
        case 'KRNL':
        case 'Celery':
        case 'Panda':
        case 'Nihon':
        case 'Horion':
        case 'SkidFuscator':
        case 'Remotely':
            if (ent > 4.8) bonus += 5;
            if (avgLine > 180) bonus += 4;
            break;
        case 'Luraph':
            if (longLine > 0.1) bonus += 6;
            if (ent > 4.5) bonus += 5;
            break;
        case 'MoonSec':
            if (unicodeCnt > 3) bonus += 10;
            if (avgLine > 250) bonus += 5;
            break;
        case 'Bytecode':
            if (ent > 5.5) bonus += 10;
            break;
        case 'VM-Obfuscated':
            if (ent > 5.0) bonus += 6;
            if (avgLine > 200) bonus += 4;
            break;
        case 'SimpleObfuscator':
            if (nesc > 8) bonus += 8;
            break;
        case 'Faulmor':
            if (avgLine > 100) bonus += 6;
            if (ent > 4.5) bonus += 4;
            break;
        case 'Prince Obfuscator':
            if (ent > 4.5) bonus += 5;
            break;
        case 'Unobfuscated':
            if (avgLine < 120) bonus += 10;
            if (ent < 4.5) bonus += 8;
            if (backtickCnt > 5) bonus -= 30;
            if (ilCnt > 10) bonus -= 25;
            if (ent > 5.5) bonus -= 20;
            if (avgLine > 400) bonus -= 15;
            if (binCnt > 10) bonus -= 20;
            if (usHex > 5) bonus -= 20;
            break;
    }
    return bonus;
}

function isDefinitelyObfuscated(code) {
    for (const pat of _DEFINITELY_OBF) {
        if (pat.test(code)) return true;
    }
    return false;
}

function formatLuraphName(code, fallback) {
    const s = String(code || "");
    let m = s.match(/Luraph\s+Obfuscator\s+v?(\d+(?:\.\d+){0,3})/i);
    if (!m) m = s.match(/protected\s+using\s+Luraph(?:\s+Obfuscator)?\s+v?(\d+(?:\.\d+){0,3})/i);
    if (!m) m = s.match(/generated\s+using\s+Luraph(?:\s+Obfuscator)?\s+v?(\d+(?:\.\d+){0,3})/i);
    if (!m) m = s.match(/Luraph\s+v(?:ersion\s*)?(\d+(?:\.\d+){0,3})/i);
    if (!m) m = s.match(/\bLPH[_\s-]*v?(\d+(?:\.\d+){0,2})\b/i);
    if (m) return "Luraph V" + m[1];
    
    if (/14/.test(fallback)) return "Luraph V14";
    if (/10/.test(fallback)) return "Luraph V10";
    if (/Luraph/i.test(fallback)) return "Luraph";
    return fallback;
}

function detectObfuscatorType(code) {
    const stats = statFeatures(code);
    const definitelyObf = isDefinitelyObfuscated(code);
    const wad = isWeAreDevs(code);
    const rawScores = {};

    for (const [name, patterns] of Object.entries(SIGNATURES)) {
        let score = 0.0;
        for (const [weight, pattern] of patterns) {
            if (pattern.test(code)) score += weight;
        }
        score += statBonus(name, stats, wad);
        if (name === 'Unobfuscated' && definitelyObf) score = 0.0;
        rawScores[name] = Math.max(score, 0.0);
    }

    const sorted = Object.entries(rawScores).sort((a, b) => b[1] - a[1]);
    const [topName, topScore] = sorted[0];
    const secondScore = sorted[1]?.[1] || 0.0;
    const total = Object.values(rawScores).reduce((a, b) => a + b, 0);

    if (topScore <= 0) return [['Custom / Unknown', 0.0]];
    if (topScore < 20) return [['Custom / Unknown', 0.0]];

    const gapRatio = topScore / Math.max(secondScore, 1);
    const results = [];

    for (const [name, score] of Object.entries(rawScores)) {
        let confidence;
        if (score <= 0) {
            confidence = 0.0;
        } else if (name === topName) {
            const dominance = score / Math.max(total, 1);
            const gapBonus = Math.min(gapRatio / 3, 1.0);
            const strength = Math.min(score / 120, 1.0);
            confidence = dominance * 55 + gapBonus * 25 + strength * 20;
        } else {
            const relative = score / Math.max(topScore, 1);
            const suppress = Math.min(gapRatio / 2, 1.0);
            confidence = relative * 45 * (1 - suppress);
        }
        confidence = Math.round(Math.max(0, Math.min(99.9, confidence)) * 10) / 10;
        let displayName = name;
        if (/Luraph/i.test(name)) displayName = formatLuraphName(code, name);
        results.push([displayName, confidence]);
    }
    return results.sort((a, b) => b[1] - a[1]);
}

function printReport(results) {
    if (!results?.length) return 'Detected: Custom / Unknown (score 1)';
    const [topName, topPct] = results[0];
    const score = Math.max(1, Math.min(10, Math.round(topPct / 10)));
    if (topName === 'Custom / Unknown') return 'Detected: Custom / Unknown (score 1)';
    return `Detected: ${topName} (score ${score})`;
}

async function fetchTextFromUrl(url) {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return null;
  const res = await fetch(u, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/plain,*/*" },
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text || !text.trim()) throw new Error("empty response");
  return text;
}


function detectThreatAnalysis(code) {
  const raw = String(code || "");
  const lines = raw.split(/\r?\n/);
  const lowerAll = raw.toLowerCase();

  const IP_DOMAINS = [
    "iplogger", "grabify", "blasze", "ipgrabber", "ip-logger", "ipify.org",
    "ipinfo.io", "ip-api.com", "icanhazip", "ifconfig.me", "checkip.amazonaws",
    "wtfismyip", "ipgeolocation", "freegeoip", "myip.com", "whatismyip",
    "grabify.link", "2no.co", "yip.su", "ps3cfw.com"
  ];

  const findLine = (testFn) => {
    for (let i = 0; i < lines.length; i++) {
      try {
        if (testFn(lines[i], i)) return i + 1;
      } catch {}
    }
    return null;
  };

  const lineIp = findLine((line) => {
    const l = line.toLowerCase();
    return IP_DOMAINS.some(d => l.includes(d)) || /https?:\/\/[^\s"'`]*?(?:ip\s*log|grabify|blasze|iplog)/i.test(line);
  });

  const webhookRe = /https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i;
  const lineWh = findLine((line) => webhookRe.test(line));
  const stealHints = /cookie|token|password|pass\b|account|session|robloxsecurity|\.roblosecurity|authorization|steal|exfil|webhook.*send/i;
  const webhookMalicious = lineWh != null && stealHints.test(raw);
  const webhookBenign = lineWh != null && !stealHints.test(raw);

  const loaderPatterns = [
    /loadstring\s*\(\s*(?:game:GetService\s*\(\s*["']HttpService["']\s*\)\s*:)?HttpGet/i,
    /loadstring\s*\(\s*(?:syn|http|fluxus|request)?[\s\S]{0,40}HttpGet/i,
    /(?:loadstring|load)\s*\(\s*(?:game:HttpGet|http(?:s)?\.get|request\s*\()/i,
    /HttpGet\s*\(\s*["']https?:\/\//i,
    /syn\.request\s*\(\s*\{[\s\S]*?Url\s*=\s*["']https?:\/\//i,
    /(?:getgenv|getrenv|getfenv).*loadstring/i,
  ];
  const lineLoader = findLine((line) => loaderPatterns.some(re => re.test(line)));
  const loaderCritical = lineLoader != null && (lineWh != null || lineIp != null || /malware|backdoor|steal|keylog/i.test(raw));

  if (lineIp != null) {
    return {
      title: "IP Logger",
      color: 0xED4245,
      line: lineIp,
      description: "What it does:\n\nA link/URL that steals the target’s IP address, location, device info, and ISP when clicked. Used for doxxing, DDoS attacks, or harassment. Common in Discord DMs, fake \"free nitro\" links, or Roblox game \"asset links\"."
    };
  }
  if (webhookMalicious) {
    return {
      title: "Discord Webhook",
      color: 0xF26522,
      line: lineWh,
      description: "What it does:\n\nA URL hidden in scripts that sends your private data to a scammer’s Discord channel. Used to steal Roblox cookies, account tokens, IPs, Robux, or inventory details. Common in fake exploits, free \"OP\" scripts, or backdoored Roblox modules."
    };
  }
  if (loaderCritical) {
    return {
      title: "Script Loader",
      color: 0xED4245,
      line: lineLoader,
      description: "What it does:\n\nA tiny piece of code that fetches and runs hidden malicious code from the internet (never stores the payload in the file itself). Common in Roblox exploits, Discord bots, and phishing files — it can steal tokens, log keystrokes, or backdoor your device."
    };
  }
  if (lineLoader != null) {
    return {
      title: "Script Loader",
      color: 0xF26522,
      line: lineLoader,
      description: "What it does:\n\nA tiny piece of code that fetches and runs hidden malicious code from the internet (never stores the payload in the file itself). Common in Roblox exploits, Discord bots, and phishing files — it can steal tokens, log keystrokes, or backdoor your device."
    };
  }
  if (webhookBenign) {
    return {
      title: "Discord Webhook",
      color: 0x5865F2,
      line: lineWh,
      description: "What it does:\n\nA URL hidden in scripts that sends your private data to a scammer’s Discord channel. Used to steal Roblox cookies, account tokens, IPs, Robux, or inventory details. Common in fake exploits, free \"OP\" scripts, or backdoored Roblox modules."
    };
  }
  return {
    title: "Safe",
    color: 0x57F287,
    line: null,
    description: "A clean file with no Script Loader, no IP Logger, no stealing Webhook. It will not download hidden malware, log your IP/location, or steal your Roblox cookie, account, or private data."
  };
}

async function downloadAttachmentText(file) {
  if (!file) return null;
  const tryUrls = [file.url, file.proxyURL, file.proxy_url].filter(Boolean);
  for (const u of [...new Set(tryUrls)]) {
    try {
      const dlRes = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" }, redirect: "follow" });
      if (dlRes.ok) {
        const body = await dlRes.text();
        if (body && body.trim().length >= 5) return body;
      }
    } catch {}
  }
  return null;
}

function buildNumberButtonRows(prefix, userId, count) {
  const n = Math.max(0, Math.min(10, Number(count) || 0));
  const rows = [];
  let row = new ActionRowBuilder();
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % 5 === 0) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(prefix + "_" + (i + 1) + "_" + userId)
        .setLabel(String(i + 1))
        .setStyle(ButtonStyle.Success)
    );
  }
  if (row.components.length) rows.push(row);
  return rows;
}

async function sendFilePickPanel(msg, { prefix, userId, files, listLabel }) {
  const n = Math.min(10, files.length);
  const rows = buildNumberButtonRows(prefix, userId, n);
  const nameLines = files.slice(0, n).map((f, i) =>
    `\`${i + 1}.\` ${(f.name || f.filename || "file").slice(0, 60)}`
  ).join("\n");
  const content =
    "### Choose a Button below\nPick one button below of what file you want to " + listLabel + ".\n\n" + nameLines;
  const children = [
    { type: 10, content: content.slice(0, 3900) },
    { type: 14, divider: true, spacing: SEPARATOR_SPACING_SMALL }
  ];
  for (const r of rows) children.push(r.toJSON());
  return replyComponentsV2(msg, {
    flags: IS_COMPONENTS_V2,
    components: [{
      type: 17,
      accent_color: RENAME_V2_ACCENT,
      components: children
    }]
  }, { mention: false });
}

async function resolveScriptInput(msg, txt) {
  
  let attachments = await getScriptAttachmentsFromMsgOrReply(msg);
  if (attachments.length) {
    const file = attachments[0];
    const tryUrls = [file.url, file.proxyURL, file.proxy_url].filter(Boolean);
    for (const u of [...new Set(tryUrls)]) {
      try {
        const dlRes = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" }, redirect: "follow" });
        if (dlRes.ok) {
          const body = await dlRes.text();
          if (body && body.trim().length >= 5) {
            return { content: body, name: file.name || file.filename || "script.lua", from: "file" };
          }
        }
      } catch {}
    }
  }
  
  const urlMatch = String(txt || "").match(/https?:\/\/[^\s<>]+/i);
  if (urlMatch) {
    const content = await fetchTextFromUrl(urlMatch[0].replace(/[)>,.]+$/, ""));
    if (content) return { content, name: "from_url.lua", from: "url" };
  }
  
  const block = String(msg.content || "").match(/```(?:lua|luau|txt)?\s*([\s\S]*?)```/i);
  if (block && block[1] && block[1].trim().length >= 5) {
    return { content: block[1].trim(), name: "codeblock.lua", from: "codeblock" };
  }
  return null;
}

async function getScriptAttachmentsFromMsgOrReply(msg) {
  const isScriptLike = (a) => {
    if (!a) return false;
    const e = ext(a.name || a.filename);
    const ct = String(a.contentType || a.content_type || "").toLowerCase();
    return e === "txt" || e === "lua" || e === "luau" || e === "text" || !e
      || ct.includes("text") || ct.includes("lua") || ct.includes("octet") || ct.includes("plain");
  };
  let attachments = await attachmentsFromMsgOrReply(msg, a => {
    const e = ext(a.name || a.filename);
    return e === "txt" || e === "lua" || e === "luau";
  });
  if (!attachments.length) {
    const any = await attachmentsFromMsgOrReply(msg, null);
    attachments = any.filter(isScriptLike);
    if (!attachments.length && any.length) attachments = any; 
  }
  
  if (!attachments.length && msg.reference?.messageId) {
    const refId = msg.reference.messageId;
    const refChannelId = msg.reference.channelId || msg.channel?.id;
    for (const chId of [...new Set([refChannelId, msg.channel?.id].filter(Boolean))]) {
      try {
        const raw = await fetchMessageRaw(chId, refId);
        const list = (attachmentsFromRawMessage(raw) || []).map(a => ({
          ...a,
          name: a.name || a.filename,
          url: a.url || a.proxyURL || a.proxy_url
        })).filter(a => a.url && a.name);
        attachments = list.filter(isScriptLike);
        if (!attachments.length && list.length) attachments = list;
        if (attachments.length) break;
      } catch {}
    }
  }
  return attachments;
}

function isErrorPayload(body) {
  const contentStr = typeof body.content === "string" ? body.content : "";
  
  if (/⏳|uploading|processing|renaming|cleaning|fetching|dumping/i.test(contentStr)) return true;
  const errRe = /❌|no found|not found|failed:|upload failed|scan failed|forward failed|invalid key|owner only|usage:|put (?:file|id|a file)|you're on|need to wait|buy access|buy premium|join in main server|reply to a file|already got a key|already redeem|can't send|not yours|adopt the Server Tag|max \d+ id|wrong, try|empty response|rate limited|input error|dumbass/i;
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

const IS_COMPONENTS_V2 = (MessageFlags && MessageFlags.IsComponentsV2 != null)
  ? MessageFlags.IsComponentsV2
  : 32768;

const RENAME_V2_ACCENT = 0x2B2D31; 
const FINDER_V2_ACCENT = 0x2B2D31; 

const SEPARATOR_SPACING_SMALL = 1;

async function replyComponentsV2(message, payload, opts = {}) {
  const mention = opts.mention === true; 
  const base = {
    ...payload,
    allowedMentions: {
      repliedUser: mention,
      parse: [],
      users: mention && message?.author?.id ? [message.author.id] : []
    },
    reply: {
      messageReference: message.id,
      failIfNotExists: false
    }
  };
  
  try {
    if (base.flags == null && payload.flags != null) base.flags = payload.flags;
    return await message.channel.send(base);
  } catch (e1) {
    try {
      const { reply, ...rest } = base;
      return await message.channel.send({
        ...rest,
        reply: { messageReference: message.id, failIfNotExists: false }
      });
    } catch (e2) {
      try {
        const { reply, ...rest } = base;
        return await message.reply(rest);
      } catch (e3) {
        console.warn("⚠️ Components V2 reply failed:", e3.message?.slice(0, 140));
        throw e3;
      }
    }
  }
}

async function sendRenameLoading(message) {
  const payload = {
    flags: IS_COMPONENTS_V2,
    components: [{
      type: 17,
      accent_color: RENAME_V2_ACCENT,
      components: [
        { type: 10, content: "### Cleaning...\n⏳ Processing..." }
      ]
    }]
  };
  try {
    return await replyComponentsV2(message, payload);
  } catch (e) {
    console.warn("⚠️ Components V2 loading fallback:", e.message?.slice(0, 120));
    return message.reply({ content: "### Cleaning...\n⏳ Processing..." }).catch(() => null);
  }
}

async function sendObfLoading(message) {
  const payload = {
    flags: IS_COMPONENTS_V2,
    components: [{
      type: 17,
      accent_color: RENAME_V2_ACCENT,
      components: [
        { type: 10, content: "### Obfuscating...\n⏳ Processing..." }
      ]
    }]
  };
  try {
    return await replyComponentsV2(message, payload);
  } catch (e) {
    return message.reply({ content: "### Obfuscating...\n⏳ Processing..." }).catch(() => null);
  }
}

async function sendObfResult(message, { loadstring, fileBuffer, fileName }) {
  const safeName = String(fileName || "obfuscated.lua").replace(/[^\w.\-]+/g, "_");
  const file = new AttachmentBuilder(fileBuffer, { name: safeName });
  const ls = String(loadstring || "").slice(0, 1800);
  const body = ("**PC COPY:**\n```lua\n" + ls + "\n```\n\n**MOBILE COPY:**\n`" + ls + "`").slice(0, 3900);

  const v2Payload = {
    flags: IS_COMPONENTS_V2,
    files: [file],
    components: [{
      type: 17,
      accent_color: RENAME_V2_ACCENT,
      components: [
        { type: 10, content: body },
        { type: 14, spacing: SEPARATOR_SPACING_SMALL },
        { type: 13, file: { url: "attachment://" + safeName } }
      ]
    }]
  };
  try {
    return await replyComponentsV2(message, v2Payload);
  } catch (e) {
    console.warn("⚠️ Components V2 obf fallback:", e.message?.slice(0, 120));
    return message.reply({
      content: body,
      files: [file],
      allowedMentions: { repliedUser: true, users: [message.author.id] }
    }).catch(() => null);
  }
}

async function sendUploadLoading(message) {
  const payload = {
    flags: IS_COMPONENTS_V2,
    components: [{
      type: 17,
      accent_color: RENAME_V2_ACCENT,
      components: [
        { type: 10, content: "### Uploading...\n⏳ Processing..." }
      ]
    }]
  };
  try {
    return await replyComponentsV2(message, payload, { mention: false });
  } catch (e) {
    return message.reply({ content: "### Uploading...\n⏳ Processing...", allowedMentions: { repliedUser: false, parse: [] } }).catch(() => null);
  }
}

async function sendUploadResult(message, { loadstring, tokLine }) {
  const ls = String(loadstring || "").slice(0, 1800);
  let body = ("**PC COPY:**\n```lua\n" + ls + "\n```\n\n**MOBILE COPY:**\n`" + ls + "`");
  if (tokLine) body += "\n" + String(tokLine);
  body = body.slice(0, 3900);
  const payload = {
    flags: IS_COMPONENTS_V2,
    components: [{
      type: 17,
      accent_color: RENAME_V2_ACCENT,
      components: [
        { type: 10, content: body }
      ]
    }]
  };
  try {
    return await replyComponentsV2(message, payload, { mention: false });
  } catch (e) {
    return message.reply({ content: body, allowedMentions: { repliedUser: false, parse: [] } }).catch(() => null);
  }
}

async function sendInputErrorV2(message, description) {
  const body = "### Input Error\n" + String(description || "").slice(0, 3800);
  const payload = {
    flags: IS_COMPONENTS_V2,
    components: [{
      type: 17,
      accent_color: 0xED4245,
      components: [{ type: 10, content: body }]
    }]
  };
  try {
    return await replyComponentsV2(message, payload, { mention: false });
  } catch (e) {
    return message.reply({ content: body, allowedMentions: { repliedUser: false, parse: [] } }).catch(() => null);
  }
}

const RENAME_V2_ERROR_ACCENT = 0xED4245;
async function sendRenameInputError(message, description) {
  const body = `### Input Error
${String(description || "").slice(0, 3800)}`;
  const payload = {
    flags: IS_COMPONENTS_V2,
    components: [{
      type: 17,
      accent_color: RENAME_V2_ERROR_ACCENT,
      components: [
        { type: 10, content: body }
      ]
    }]
  };
  try {
    return await replyComponentsV2(message, payload);
  } catch (e) {
    console.warn("⚠️ Components V2 error fallback:", e.message?.slice(0, 120));
    return message.reply({ content: body }).catch(() => null);
  }
}

async function sendRenameResult(message, { previewMarkdown, fileBuffer, fileName, footerLine }) {
  const safeName = String(fileName || "file.lua").replace(/[^\w.\-]+/g, "_");
  const file = new AttachmentBuilder(fileBuffer, { name: safeName });

  const parts = [];
  if (previewMarkdown) parts.push(String(previewMarkdown).trim());
  if (footerLine) parts.push(String(footerLine).trim());
  const body = parts.join("\n\n").slice(0, 4000) || "### File Preview";

  
  const v2Payload = {
    flags: IS_COMPONENTS_V2,
    files: [file],
    components: [
      {
        type: 17,
        accent_color: RENAME_V2_ACCENT,
        components: [
          { type: 10, content: body },
          { type: 14, divider: true, spacing: SEPARATOR_SPACING_SMALL },
          { type: 13, file: { url: `attachment://${safeName}` } }
        ]
      }
    ]
  };
  try {
    return await replyComponentsV2(message, v2Payload);
  } catch (e) {
    console.warn("⚠️ Components V2 rename fallback:", e.message?.slice(0, 120));
    return message.reply({
      content: body,
      files: [file],
      allowedMentions: { repliedUser: true, users: [message.author.id] }
    });
  }
}

function finderDisplayName(name) {
  return String(name || "file").replace(/\.(txt|lua|luau|zip|html|htm)$/i, "");
}
function buildFinderV2Payload({ listLines, pageLabel, actionRow, ephemeral = false }) {
  const listText = Array.isArray(listLines) ? listLines.join("\n") : String(listLines || "");
  let content = `## Finder Source Results\n${listText}`;
  if (pageLabel) content += `\n\n-# ${pageLabel}`;
  content = content.slice(0, 4000);
  
  const containerChildren = [
    { type: 10, content },
    { type: 14, spacing: SEPARATOR_SPACING_SMALL }
  ];
  if (actionRow) {
    const rowJson = typeof actionRow.toJSON === "function" ? actionRow.toJSON() : actionRow;
    containerChildren.push(rowJson);
  }
  const components = [
    {
      type: 17,
      accent_color: FINDER_V2_ACCENT,
      components: containerChildren
    }
  ];
  let flags = IS_COMPONENTS_V2;
  if (ephemeral) {
    const eph = (MessageFlags && MessageFlags.Ephemeral != null) ? MessageFlags.Ephemeral : 64;
    flags = flags | eph;
  }
  return { flags, components, embeds: [] };
}

function replyUser(message, payload) {
  const body = typeof payload === "string" ? { content: payload } : { ...payload };
  body.allowedMentions = { ...(body.allowedMentions || {}), repliedUser: true };
  
  try {
    const line = pendingTokenLine.get(String(message.author?.id));
    if (line) {
      const contentStr = typeof body.content === "string" ? body.content : "";
      const isLoading = /⏳|uploading|processing|renaming|cleaning|fetching|dumping/i.test(contentStr)
        || (body.embeds && body.embeds.some(emb => {
          const d = emb?.data || emb;
          return /processing|fetching|deleting|loading|renaming/i.test(String(d?.title || ""))
            || /⏳/.test(String(d?.description || "")) || /⏳/.test(String(d?.title || ""));
        }));
      if (isLoading) {
        
      } else if (isErrorPayload(body)) {
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
  
  
  if (/Luraph|luraph/i.test(s)) sc.Luraph += 50;
  if (/\[=\[[\s\S]{200,}\]\]/.test(s)) sc.Luraph += 20;
  if (/loadstring\s*\(\s*[A-Za-z0-9+/=]{200,}\s*\)/.test(s)) sc.Luraph += 15;
  if (/setmetatable\s*\(\s*\{\s*\}\s*,\s*\{\s*__index/.test(s)) sc.Luraph += 10;
  
  
  if (/WeAreDevs|WAD_|wad_|wearedevs/i.test(s)) sc.WeAreDevs += 50;
  if (/--\s*\/\/?\s*WeAreDevs/i.test(s)) sc.WeAreDevs += 30;
  if (/M\s*\(\s*-?\d+\s*[+\-*]\s*-?\d+\s*\)/.test(s)) sc.WeAreDevs += 25;
  if (/local\s+[A-Za-z_]+\s*=\s*\{(?:"\{(?:\\.|[^"\\])*"\s*[,;]\s*){5,}/.test(s)) sc.WeAreDevs += 20;
  if (/\bz\s*\[\s*[A-Za-z_][A-Za-z0-9_]*\s*\]/.test(s)) sc.WeAreDevs += 15;
  if (/return\s*\(\s*function\s*\(/.test(s)) sc.WeAreDevs += 10;
  
  
  if (/Prometheus|prometheus/i.test(s)) sc.Prometheus += 50;
  if (/--\s*This file was generated using/i.test(s)) sc.Prometheus += 30;
  if (/loadstring\s*\(\s*function\s*\(\s*\)\s*return\s*["']/.test(s)) sc.Prometheus += 20;
  if (/string\.char\s*\(\s*\d+\s*(?:,\s*\d+\s*){5,}\)/.test(s)) sc.Prometheus += 15;
  if (/pcall\s*\(\s*loadstring/.test(s)) sc.Prometheus += 10;
  
  
  if (/Luarmor|luarmor/i.test(s)) sc.Luarmor += 50;
  if (/_G\s*\[\s*["']luarmor/i.test(s)) sc.Luarmor += 30;
  if (/string\.dump\s*\(/.test(s)) sc.Luarmor += 20;
  if (/luarmor\.net|luarmor\.gg/i.test(s)) sc.Luarmor += 20;
  
  
  if (/PolSec|polsec/i.test(s)) sc.PolSec += 50;
  if (/polsec\.gg/i.test(s)) sc.PolSec += 30;
  if (/PolSecure|polsecure/i.test(s)) sc.PolSec += 20;
  
  
  if (/\b25ms\b|25MS/.test(s)) sc["25ms"] += 50;
  if (/25ms\.to|25ms\.gg/i.test(s)) sc["25ms"] += 25;
  
  
  if (/Moonveil|moonveil/i.test(s)) sc.Moonveil += 50;
  if (/moonveil\.gg/i.test(s)) sc.Moonveil += 25;
  
  
  if (/MoonSec|moonsec|MoonSec V3/i.test(s)) sc["MoonSec V3"] += 50;
  if (/moonsec\.net|moonsec\.gg/i.test(s)) sc["MoonSec V3"] += 25;
  
  
  if (/Solara|solara/i.test(s)) sc.Solara += 50;
  if (/solara\.gg|solara\.app/i.test(s)) sc.Solara += 25;
  
  
  if (/Hydrogen|hydrogen/i.test(s)) sc.Hydrogen += 50;
  if (/hydrogen\.gg|hydrogen\.exe/i.test(s)) sc.Hydrogen += 25;
  
  
  if (/\bWave\b|wave\.exe/i.test(s)) sc.Wave += 45;
  
  
  if (/Evon|evon/i.test(s)) sc.Evon += 45;
  if (/evon\.gg/i.test(s)) sc.Evon += 25;
  
  
  if (/Synapse|synapse|Synapse X/i.test(s)) sc["Synapse X"] += 45;
  if (/syn\.|synapse\.cc/i.test(s)) sc["Synapse X"] += 25;
  
  
  if (/Script-Ware|ScriptWare|script-ware/i.test(s)) sc["Script-Ware"] += 45;
  if (/sw\.|scriptware/i.test(s)) sc["Script-Ware"] += 20;
  
  
  if (/Krnl|krnl/i.test(s)) sc.Krnl += 45;
  if (/krnl\.gg|krnl\.ca/i.test(s)) sc.Krnl += 25;
  
  
  if (/Fluxus|fluxus/i.test(s)) sc.Fluxus += 45;
  if (/fluxteam|fluxus\.gg/i.test(s)) sc.Fluxus += 25;
  
  
  if (/Delta|delta/i.test(s)) sc.Delta += 40;
  if (/delta\.gg|deltaexec/i.test(s)) sc.Delta += 25;
  
  
  if (/Celery|celery/i.test(s)) sc.Celery += 40;
  if (/celery\.gg|celeryexec/i.test(s)) sc.Celery += 25;
  
  
  if (/Electron|electron/i.test(s)) sc.Electron += 40;
  if (/electron\.gg/i.test(s)) sc.Electron += 25;
  
  
  if (/Comet|comet/i.test(s)) sc.Comet += 40;
  if (/comet\.gg/i.test(s)) sc.Comet += 25;
  
  
  if (/Vega X|VegaX|vegax/i.test(s)) sc["Vega X"] += 40;
  if (/vegax\.gg/i.test(s)) sc["Vega X"] += 25;
  
  
  
  if (/IronBrew|ironbrew|IB2|IB_/i.test(s)) sc.IronBrew += 50;
  if (/ironbrew\.io/i.test(s)) sc.IronBrew += 25;
  
  
  if (/DarkEccentric|darkeccentric|DE_/i.test(s)) sc.DarkEccentric += 50;
  
  
  if (/\bAxon\b|axon\.exe/i.test(s)) sc.Axon += 45;
  
  
  if (/ProtoSmasher|protosmasher/i.test(s)) sc.ProtoSmasher += 45;
  
  
  if (/Elysian|elysian/i.test(s)) sc.Elysian += 45;
  
  
  if (/SirHurt|sirhurt/i.test(s)) sc.SirHurt += 45;
  
  
  if (/CocoZ|cocoz/i.test(s)) sc.CocoZ += 45;
  
  
  if (/Zaptosis|zaptosis/i.test(s)) sc.Zaptosis += 45;
  
  
  if (/Obfuscator\.Lua|obfuscator\.lua/i.test(s)) sc["Obfuscator.Lua"] += 45;
  
  
  if (/luamin|lua_min|minified\slua/i.test(s)) sc.LuaMinify += 35;
  
  
  if (/loadstring\s*\(\s*game:HttpGet.*base64|base64decode|base64_decode/i.test(s)) sc["Base64-Encoded"] += 35;
  
  
  if (/xor\s*\(|bit\.bxor|string\.char\s*\(\s*\d+\s*%/i.test(s)) sc["XOR-Encrypted"] += 30;
  
  
  if (/string\.dump|loadstring\s*\(\s*\\x/i.test(s)) sc.Bytecode += 40;
  if (/\\x[0-9a-fA-F]{2}.*\\x[0-9a-fA-F]{2}.*\\x[0-9a-fA-F]{2}/.test(s)) sc.Bytecode += 20;
  
  
  let vmScore = 0;
  if (/loadstring\s*\(/.test(s)) vmScore += 10;
  if (/\\x[0-9a-fA-F]{2}/.test(s)) vmScore += 10;
  if (/string\.char\s*\(/.test(s)) vmScore += 10;
  if (/setmetatable|getmetatable/.test(s)) vmScore += 5;
  if (/pcall\s*\(|xpcall\s*\(/.test(s)) vmScore += 5;
  if (/\bassert\s*\(/.test(s)) vmScore += 5;
  sc["VM-Obfuscated"] = vmScore;
  
  
  const allObfScores = Object.values(sc).reduce((a, b) => a + b, 0) - (sc.Unobfuscate || 0);
  if (allObfScores < 15) {
    if (/function\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(s)) sc.Unobfuscate += 25;
    if (/--\s*\[/.test(s)) sc.Unobfuscate += 10;
    if (/local\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=/.test(s) && !/local\s+[A-Za-z_]+\s*=\s*\{/.test(s)) sc.Unobfuscate += 10;
    if (/print\s*\(|warn\s*\(|error\s*\(/.test(s)) sc.Unobfuscate += 5;
  }
  
  
  for (const k of Object.keys(sc)) sc[k] = Math.min(sc[k], 100);
  
  
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

function canGetLibraryFile(file, userId) {
  if (!file) return false;
  if (isOwner(userId)) return true;
  const name = file.filename || file.name || "";
  const ct = file.contentType || null;
  if (isZipFile(name, ct)) return false;
  return true;
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

function purgeUnavailableFromLibrary() {
  const before = library.files.length;
  library.files = library.files.filter(file => Number(file.size || 0) !== 36);
  if (library.files.length !== before) {
    saveLibrary();
    console.log(`🗑️ Purged ${before - library.files.length} unavailable 36-byte file(s) from library`);
    return before - library.files.length;
  }
  return 0;
}

async function rescanLibraryNameInLiveChannels(filename) {
  const wantBase = normalizeBase(filename);
  const wantFull = normalize(filename);
  if (!wantBase && !wantFull) return null;
  const liveIds = (config.liveScanChannelIds || []).map(String);
  if (!liveIds.length) return null;
  for (const chId of liveIds) {
    try {
      const ch = await client.channels.fetch(chId).catch(() => null);
      if (!ch?.isTextBased?.() || !ch.messages) continue;
      let before = null;
      for (let page = 0; page < 15; page++) {
        const batch = await fetchMessages(ch, before);
        if (!batch?.size) break;
        for (const msg of batch.values()) {
          for (const item of attachmentsOf(msg)) {
            const a = item.attachment;
            const fname = a.name || "unknown_file";
            const baseName = normalizeBase(fname);
            const fullName = normalize(fname);
            const fileSize = Number(a.size || 0);
            const url = a.url || a.proxyURL || a.proxy_url;
            if (!url || fileSize === 36) continue;
            if (baseName !== wantBase && fullName !== wantFull) continue;
            
            library.files = library.files.filter(f => normalizeBase(f.filename) !== wantBase && normalize(f.filename) !== wantFull);
            const entry = {
              id: idForFile(), filename: fname, url, size: fileSize,
              contentType: a.contentType || null, channelId: msg.channelId,
              messageId: msg.id, attachmentId: String(a.id), forwarded: item.forwarded,
              createdTimestamp: msg.createdTimestamp || Date.now(), scannedAt: Date.now()
            };
            library.files.push(entry);
            library.files.sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
            saveLibrary();
            console.log(`📡 Re-scanned available "${fname}" from live #${ch.name || chId}`);
            return entry;
          }
        }
        const oldest = batch.last();
        if (!oldest || batch.size < 100) break;
        before = oldest.id;
      }
    } catch (e) {
      console.warn("⚠️ rescanLibraryNameInLiveChannels:", e.message?.slice?.(0, 100) || e);
    }
  }
  return null;
}

function getFile(id) {
  purgeUnavailableFromLibrary();
  const f = library.files.find(file => file.id === String(id || "").trim()) || null;
  if (f && Number(f.size || 0) === 36) {
    const name = f.filename;
    library.files = library.files.filter(file => file.id !== f.id);
    saveLibrary();
    console.log(`🗑️ Deleted unavailable 36-byte file: ${name} (${f.id})`);
    
    rescanLibraryNameInLiveChannels(name).catch(() => {});
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
      const sz = Number(fresh.size || file.size || 0);
      
      if (sz === 36) {
        const name = file.filename;
        library.files = library.files.filter(f => f.id !== file.id);
        saveLibrary();
        console.log(`🗑️ Deleted 36-byte unavailable: ${name} (${file.id})`);
        const rescued = await rescanLibraryNameInLiveChannels(name).catch(() => null);
        return rescued?.url || null;
      }
      file.url = fresh.url;
      file.size = sz || file.size;
      saveLibrary();
      return fresh.url;
    }
    
    const name = file.filename;
    library.files = library.files.filter(f => f.id !== file.id);
    saveLibrary();
    console.log(`🗑️ Deleted expired/unavailable file (attachment gone): ${name} (${file.id})`);
    const rescued = await rescanLibraryNameInLiveChannels(name).catch(() => null);
    return rescued?.url || null;
  } catch (e) {
    console.warn(`⚠️ Could not refresh URL for ${file.filename}:`, e.message);
    
    try {
      const name = file.filename;
      library.files = library.files.filter(f => f.id !== file.id);
      saveLibrary();
      const rescued = await rescanLibraryNameInLiveChannels(name).catch(() => null);
      return rescued?.url || null;
    } catch {}
  }
  return null;
}
function findFiles(query) {
  query = normalize(query);
  if (!query) return [];
  const tokens = query.split(" ").filter(Boolean);
  const seenNames = new Set();
  purgeUnavailableFromLibrary();
  return library.files
    .filter(file => {
      const name = normalize(file.filename);
      // token must appear as a whole word (space-bounded): "jet" → "jet hub", not "projectile"
      const hasTok = (tok) => {
        const padded = " " + name + " ";
        return padded.includes(" " + tok + " ");
      };
      if (tokens.length) return tokens.every(hasTok);
      return hasTok(query);
    })
    .map(file => {
      const name = normalize(file.filename);
      let score = 0;
      if (name === query) score += 5000;
      else if (name.startsWith(query)) score += 2000;
      else if (name.includes(query)) score += 1000;
      for (const token of tokens) {
        if (name === token) score += 500;
        else if (name.startsWith(token)) score += 200;
        else if (name.includes(token)) score += 100;
      }
      return { file, score };
    })
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
  const pushAtt = (a, forwarded) => {
    if (!a) return;
    const name = a.name || a.filename;
    const ct = a.contentType || a.content_type;
    if (!isAllowedFileType(name, ct)) return;
    if (!a.name && name) try { a.name = name; } catch {}
    if (!a.url && (a.proxyURL || a.proxy_url)) try { a.url = a.proxyURL || a.proxy_url; } catch {}
    result.push({ attachment: a, forwarded: !!forwarded });
  };
  for (const a of message.attachments?.values?.() || []) pushAtt(a, false);
  
  try {
    const walk = (comps, attSrc, forwarded) => {
      if (!Array.isArray(comps)) return;
      for (const c of comps) {
        if (!c) continue;
        if (c.type === 13 && c.file) {
          const name = String(c.file.name || c.file.filename || String(c.file.url || "").replace(/^attachment:\/\//, "") || "file");
          const match = [...(attSrc?.values?.() || [])].find(x => (x.name || x.filename) === name);
          if (match) pushAtt(match, forwarded);
          else if (c.file.url && String(c.file.url).startsWith("http")) {
            pushAtt({ name, filename: name, url: c.file.url, proxyURL: c.file.url, size: c.file.size || 0, contentType: c.file.content_type || null }, forwarded);
          }
        }
        if (Array.isArray(c.components)) walk(c.components, attSrc, forwarded);
      }
    };
    walk(message.components, message.attachments, false);
  } catch {}
  
  for (const s of message.messageSnapshots?.values?.() || []) {
    for (const a of s.attachments?.values?.() || []) pushAtt(a, true);
    try {
      const walk = (comps) => {
        if (!Array.isArray(comps)) return;
        for (const c of comps) {
          if (!c) continue;
          if (c.type === 13 && c.file) {
            const name = String(c.file.name || c.file.filename || String(c.file.url || "").replace(/^attachment:\/\//, "") || "file");
            const match = [...(s.attachments?.values?.() || [])].find(x => (x.name || x.filename) === name);
            if (match) pushAtt(match, true);
            else if (c.file.url && String(c.file.url).startsWith("http")) {
              pushAtt({ name, filename: name, url: c.file.url, proxyURL: c.file.url, size: c.file.size || 0, contentType: c.file.content_type || null }, true);
            }
          }
          if (Array.isArray(c.components)) walk(c.components);
        }
      };
      walk(s.components);
    } catch {}
  }
  return result;
}
function allAttachmentsOf(message) {
  return attachmentsOf(message).map(x => x.attachment);
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
          
          if (fileSize === 36) continue;
          const isDupBase = existingBases.has(baseName);
          const isDupFull = existingFullNames.has(fullName);
          if (isDupBase || isDupFull) {
            
            const dead = library.files.filter(f =>
              (normalizeBase(f.filename) === baseName || normalize(f.filename) === fullName) &&
              Number(f.size || 0) === 36
            );
            if (dead.length) {
              library.files = library.files.filter(f => !dead.includes(f));
              replacedDup++;
              
            } else {
              skippedDup++;
              continue;
            }
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
    if (existingBases.has(baseName) || existingFullNames.has(fullName)) {
      
      const before = library.files.length;
      library.files = library.files.filter(f => {
        const same = normalizeBase(f.filename) === baseName || normalize(f.filename) === fullName;
        if (same && Number(f.size || 0) === 36) return false;
        return true;
      });
      if (library.files.length === before) continue; 
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
  if (!found.length) return 0;
  library.files.push(...found);
  library.files.sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
  saveLibrary();
  return found.length;
}

async function resolveCobaltMedia(pageUrl) {
  const endpoints = [
    "https://api.cobalt.tools/",
    "https://cobalt.api.timelessnesses.me/",
    "https://co.wuk.sh/",
    "https://cobalt-api.kwetiaumala.my.id/"
  ];
  const bodies = [
    { url: pageUrl },
    { url: pageUrl, downloadMode: "auto" },
    { url: pageUrl, downloadMode: "auto", videoQuality: "1080" },
    { url: pageUrl, downloadMode: "auto", videoQuality: "max", tiktokFullAudio: false }
  ];
  for (const endpoint of endpoints) {
    for (const body of bodies) {
      try {
        const apiRes = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
          },
          body: JSON.stringify(body)
        });
        const data = await apiRes.json().catch(() => null);
        if (!data) continue;
        if (data.url && /^https?:\/\//i.test(data.url)) {
          return { url: data.url, type: /audio/i.test(String(data.filename || data.audio || "")) ? "Audio" : "Video" };
        }
        if (data.audio && /^https?:\/\//i.test(data.audio)) return { url: data.audio, type: "Audio" };
        if (Array.isArray(data.picker) && data.picker[0]?.url) {
          return { url: data.picker[0].url, type: "Photo" };
        }
      } catch {}
    }
  }
  return null;
}

async function expandShortUrl(pageUrl) {
  let url = String(pageUrl || "").trim();
  try {
    if (!/vm\.tiktok\.com|vt\.tiktok\.com|tiktok\.com\/t\//i.test(url)) return url;
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ]) {
      try {
        const res = await fetch(url, { method: "GET", redirect: "manual", headers: { "User-Agent": ua } });
        let loc = res.headers.get("location") || res.headers.get("Location");
        if (loc) {
          if (loc.startsWith("/")) loc = "https://www.tiktok.com" + loc;
          if (/^https?:\/\//i.test(loc)) return loc;
        }
      } catch {}
    }
    try {
      const res2 = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" }
      });
      if (res2.url && /tiktok\.com/i.test(res2.url)) return res2.url;
    } catch {}
  } catch {}
  return url;
}

function extractTikTokVideoId(pageUrl) {
  const s = String(pageUrl || "");
  let m = s.match(/\/video\/(\d{5,})/);
  if (m) return m[1];
  m = s.match(/[?&]video_id=(\d{5,})/);
  if (m) return m[1];
  m = s.match(/(\d{15,})/);
  return m ? m[1] : null;
}

async function resolveTikTokMedia(pageUrl) {
  let url = String(pageUrl || "").trim();
  url = await expandShortUrl(url);
  const videoId = extractTikTokVideoId(url);
  const candidates = [];
  if (url) candidates.push(url);
  if (videoId) {
    candidates.push(`https://www.tiktok.com/@tiktok/video/${videoId}`);
    candidates.push(`https://www.tiktok.com/video/${videoId}`);
  }
  if (pageUrl && pageUrl !== url) candidates.push(pageUrl);
  const uniq = [...new Set(candidates.filter(Boolean))];

  const tryJsonUrl = (data) => {
    if (!data || typeof data !== "object") return null;
    const stack = [data, data.data, data.result, data.aweme_detail, data.aweme_list?.[0]];
    for (const d of stack) {
      if (!d || typeof d !== "object") continue;
      for (const key of [
        "url", "audio", "hdplay", "play", "wmplay", "nwm_video_url_HQ", "nwm_video_url",
        "video", "video_url", "download_url", "playAddr", "downloadAddr", "noWatermark", "no_watermark"
      ]) {
        const v = d[key];
        if (typeof v === "string" && /^https?:\/\//i.test(v) && !/tiktok\.com\/@/i.test(v)) {
          return { url: v, type: /audio|music|mp3/i.test(key) ? "Audio" : "Video" };
        }
        if (v && typeof v === "object") {
          if (typeof v.url === "string" && /^https?:\/\//i.test(v.url)) return { url: v.url, type: "Video" };
          if (Array.isArray(v.url_list) && v.url_list[0]) return { url: v.url_list[0], type: "Video" };
        }
      }
      if (d.video?.play_addr?.url_list?.[0]) return { url: d.video.play_addr.url_list[0], type: "Video" };
      if (d.video?.download_addr?.url_list?.[0]) return { url: d.video.download_addr.url_list[0], type: "Video" };
      if (d.video?.noWatermark) return { url: d.video.noWatermark, type: "Video" };
      if (d.video?.playAddr) return { url: d.video.playAddr, type: "Video" };
    }
    if (Array.isArray(data.picker) && data.picker[0]?.url) return { url: data.picker[0].url, type: "Photo" };
    return null;
  };

  
  for (const u of uniq) {
    const cobalt = await resolveCobaltMedia(u);
    if (cobalt?.url) return cobalt;
  }

  
  for (const u of uniq) {
    for (const apiUrl of [
      `https://www.tikwm.com/api/?url=${encodeURIComponent(u)}&hd=1`,
      `https://tikwm.com/api/?url=${encodeURIComponent(u)}&hd=1`
    ]) {
      try {
        const api2 = await fetch(apiUrl, {
          headers: {
            "Accept": "application/json,text/plain,*/*",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.tikwm.com/"
          }
        });
        const d2 = await api2.json().catch(() => null);
        const hit = tryJsonUrl(d2);
        if (hit) return hit;
      } catch {}
    }
    try {
      const api3 = await fetch("https://www.tikwm.com/api/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0",
          "Referer": "https://www.tikwm.com/"
        },
        body: `url=${encodeURIComponent(u)}&hd=1`
      });
      const d3 = await api3.json().catch(() => null);
      const hit = tryJsonUrl(d3);
      if (hit) return hit;
    } catch {}
  }

  
  for (const u of uniq) {
    const extras = [
      `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(u)}`,
      `https://api.tiklydown.eu.org/api/download/v3?url=${encodeURIComponent(u)}`,
      `https://tikdownloader.io/api/ajaxSearch`
    ];
    for (const m of extras) {
      try {
        if (m.includes("ajaxSearch")) {
          const r = await fetch(m, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" },
            body: `q=${encodeURIComponent(u)}&lang=en`
          });
          const j = await r.json().catch(() => null);
          const html = j?.data || j?.html || "";
          const match = String(html).match(/https?:\/\/[^"'\s<>]+(?:\.mp4|\.mov)[^"'\s<>]*/i);
          if (match) return { url: match[0].replace(/&amp;/g, "&"), type: "Video" };
        } else {
          const r = await fetch(m, { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } });
          const j = await r.json().catch(() => null);
          const hit = tryJsonUrl(j);
          if (hit) return hit;
        }
      } catch {}
    }
  }

  return null;
}

async function bypassAdLink(pageUrl) {
  const url = String(pageUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return null;

  const isPlato = /auth\.platorelay\.com|auth\.platoboost\.(app|me)|platoboost/i.test(url);

  const endpoints = [
    { u: "https://api.bypass.vip/bypass?url=" + encodeURIComponent(url), pick: (j) => j?.result || j?.destination || j?.url || j?.key || j?.data?.key || j?.data?.url },
    { u: "https://bypass.bot.nu/bypass?url=" + encodeURIComponent(url), pick: (j) => j?.destination || j?.result || j?.url || j?.key },
    { u: "https://api.bypass.gov/v1?url=" + encodeURIComponent(url), pick: (j) => j?.result || j?.destination || j?.url || j?.key },
    { u: "https://byp-api.vercel.app/api?url=" + encodeURIComponent(url), pick: (j) => j?.result || j?.url || j?.destination || j?.key },
    { u: "https://bypass.pm/bypass?url=" + encodeURIComponent(url), pick: (j) => j?.result || j?.destination || j?.url || j?.key },
    { u: "https://api.sryden.com/bypass?url=" + encodeURIComponent(url), pick: (j) => j?.result || j?.key || j?.url || j?.destination },
  ];

  const pickResult = (out) => {
    if (!out) return null;
    const s = String(out).trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s) && s !== url) return { url: s };
    
    if (isPlato && s.length >= 6 && !/\s/.test(s) && !/^https?:/i.test(s)) {
      return { url: s, key: s };
    }
    return null;
  };

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.u, {
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) continue;
      const j = await res.json().catch(() => null);
      const hit = pickResult(ep.pick(j));
      if (hit) return hit;
    } catch {}
  }

  
  
  if (isPlato) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20000)
      });
      const html = await res.text();
      const finalUrl = res.url || url;
      
      const candidates = new Set();
      const linkRe = /https?:\/\/[^\s"'<>\\]+/gi;
      let m;
      while ((m = linkRe.exec(html)) !== null) {
        const u = m[0].replace(/[),.;]+$/, "");
        if (/linkvertise|lootlabs|work\.ink|mboost|social-unlock|rekonise|cuty\.io|ouo\.io|adbypass|boost\.ink/i.test(u)) {
          candidates.add(u);
        }
      }
      
      for (const c of candidates) {
        const nested = await bypassAdLink(c).catch(() => null);
        if (nested?.url) return nested;
        const hit = pickResult(c);
        if (hit) return hit;
      }
      
      if (finalUrl && !/platorelay|platoboost/i.test(finalUrl) && finalUrl !== url) {
        return { url: finalUrl };
      }
    } catch {}
  }

  
  try {
    let cur = url;
    for (let i = 0; i < 8; i++) {
      const res = await fetch(cur, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html,*/*" },
        signal: AbortSignal.timeout(15000)
      });
      const loc = res.headers.get("location") || res.headers.get("Location");
      if (!loc) break;
      const next = loc.startsWith("http") ? loc : new URL(loc, cur).href;
      if (!/linkvertise|lootlabs|work\.ink|adbypass|mboost|social-unlock|rekonise|sub2get|boost\.ink|cuty\.io|ouo\.io|adf\.ly|platorelay|platoboost/i.test(next)) {
        if (next !== url) return { url: next };
      }
      cur = next;
    }
  } catch {}
  return null;
}

async function downloadAsAttachment(mediaUrl, fallbackName) {
  try {
    const res = await fetch(mediaUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.tiktok.com/",
        "Origin": "https://www.tiktok.com"
      },
      redirect: "follow"
    });
    if (!res.ok) {
      
      const res2 = await fetch(mediaUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "*/*",
          "Referer": "https://www.tiktok.com/"
        },
        redirect: "follow"
      });
      if (!res2.ok) return null;
      const buf2 = Buffer.from(await res2.arrayBuffer());
      if (!buf2.length || buf2.length > 24 * 1024 * 1024) return null;
      let name2 = fallbackName || "download.mp4";
      if (!/\.[a-z0-9]{2,5}$/i.test(name2)) name2 += ".mp4";
      return new AttachmentBuilder(buf2, { name: name2.replace(/[^\w.\-]+/g, "_").slice(0, 80) });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 24 * 1024 * 1024) return null; 
    let name = fallbackName || "download.mp4";
    const cd = res.headers.get("content-disposition") || "";
    const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    if (m) name = decodeURIComponent(m[1].replace(/"/g, "")).trim() || name;
    else {
      try {
        const u = new URL(mediaUrl);
        const base = u.pathname.split("/").pop();
        if (base && /\.[a-z0-9]{2,5}$/i.test(base)) name = decodeURIComponent(base);
      } catch {}
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
      if (ct.includes("png")) name += ".png";
      else if (ct.includes("jpeg") || ct.includes("jpg")) name += ".jpg";
      else if (ct.includes("webp")) name += ".webp";
      else if (ct.includes("audio")) name += ".mp3";
      else name += ".mp4";
    }
    return new AttachmentBuilder(buf, { name: name.replace(/[^\w.\-]+/g, "_").slice(0, 80) });
  } catch {
    return null;
  }
}

async function downloadURL(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" }
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return Buffer.from(await res.arrayBuffer());
}

function cleanLuaV2(text) {
  let out = cleanLuaForRename(String(text || ""));
  try {
    out = out.replace(/^\uFEFF/, "").replace(/\0/g, "");

    // Remove remote loadstring / HttpGet loader blocks (like Jet Hub style)
    // local ok, src = pcall(function() return game:HttpGet(...) end)
    // if ok ... loadstring(src) ... end
    out = out.replace(
      /local\s+[\w,\s]+\s*=\s*pcall\s*\(\s*function\s*\(\s*\)\s*[\s\S]*?game\s*:\s*HttpGet[\s\S]*?end\s*\)\s*(?:if\s+[\s\S]*?loadstring[\s\S]*?end\s*)?/gi,
      ""
    );
    out = out.replace(
      /pcall\s*\(\s*function\s*\(\s*\)\s*[\s\S]{0,400}?game\s*:\s*HttpGet[\s\S]{0,200}?end\s*\)\s*/gi,
      ""
    );
    out = out.replace(
      /if\s+[\w\s]+and\s+type\s*\(\s*\w+\s*\)\s*==\s*["']string["'][\s\S]{0,120}?loadstring\s*\(\s*\w+\s*\)[\s\S]{0,200}?end\s*(?:end)?/gi,
      ""
    );
    out = out.replace(/\blocal\s+fn\s*=\s*loadstring\s*\(\s*\w+\s*\)\s*/gi, "");
    out = out.replace(/\bif\s+type\s*\(\s*fn\s*\)\s*==\s*["']function["']\s+then\s*pcall\s*\(\s*fn\s*\)\s*end/gi, "");
    out = out.replace(/\bloadstring\s*\(\s*(?:game\s*:\s*HttpGet|HttpGet)[\s\S]*?\)\s*(?:\(\s*\))?/gi, "");
    out = out.replace(/\bgame\s*:\s*HttpGet\s*\(\s*[^)]+\)/gi, "");
    out = out.replace(/\b(?:loadstring|load)\s*\(\s*[^)]{0,200}\)\s*(?:\(\s*\))?/gi, (m) => {
      const s = m[0];
      // keep harmless local string loads of short literals only
      if (/loadstring\s*\(\s*["'][^"']{0,40}["']\s*\)/.test(s)) return s;
      return "";
    });

    out = out.split("\n").filter(line => {
      const tr = line.trim();
      if (!tr) return true;
      if (/^::\w+::$/.test(tr)) return false;
      if (/^\d+\s*$/.test(tr)) return false;
      if (/\bloadstring\s*\(/.test(tr) && /HttpGet|HttpService|request|syn\.request/i.test(tr)) return false;
      return true;
    }).join("\n");

    out = out.replace(/[^\S\n]+$/gm, "");
    out = out.replace(/\n{3,}/g, "\n\n").trim() + "\n";
  } catch {}
  return out;
}

function cleanLuaForRename(text) {
  if (!text || typeof text !== "string") return "";
  const ipGrabberDomains = ["iplogger.org","iplogger.com","grabify.link","grabify.xyz","nipiscan.com","spiderip.com","blasze.tk","blasze.com","ip-api.com","ipify.org","icanhazip.com","ifconfig.co","ifconfig.me","whatismyip.com","ipinfo.io","ipgeolocation.io","ps3cfw.com","2no.co","yip.su","ip-tracker.org","whatismyipaddress.com"];
  const loaderPatterns = [
    /loadstring\s*\(\s*game\s*:\s*HttpGet/i,
    /loadstring\s*\(\s*[^)]*HttpGet/i,
    /game\s*:\s*HttpGet\s*\(\s*["']https?:\/\//i,
    /HttpService\s*:\s*GetAsync\s*\(\s*["']https?:\/\//i,
    /syn\s*\.\s*request\s*\(/i,
    /http\s*\.\s*get\s*\(\s*["']https?:\/\//i,
    /require\s*\(\s*["']https?:\/\//i,
  ];
  function isGrabber(line) {
    const lower = String(line || "").toLowerCase();
    for (const d of ipGrabberDomains) if (lower.includes(d)) return true;
    return false;
  }
  function hasLoader(line) {
    for (const re of loaderPatterns) {
      try { if (re.test(line)) return true; } catch {}
    }
    return false;
  }
  
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out = [];
  let inBlockComment = false;
  for (let originalLine of lines) {
    let line = originalLine;
    const trimmed = line.trim();

    
    if (!trimmed) {
      out.push(originalLine);
      continue;
    }

    
    if (/^={5,}$/.test(trimmed)) continue;
    if (/^-{0,2}\s*={10,}\s*-{0,2}$/.test(trimmed)) continue;
    if (trimmed.includes("==================================================")) continue;

    
    if (inBlockComment) {
      if (trimmed.includes("]]")) inBlockComment = false;
      continue;
    }
    if (/^--\[\[/.test(trimmed) || /^--\[=+\[/.test(trimmed)) {
      if (!trimmed.includes("]]")) inBlockComment = true;
      continue;
    }
    
    if (trimmed.startsWith("--")) continue;

    
    if (isGrabber(trimmed)) continue;

    
    if (hasLoader(trimmed)) continue;

    
    let inS = false, inD = false;
    let cutAt = -1;
    for (let i = 0; i < line.length - 1; i++) {
      const c = line[i], n = line[i + 1];
      if (c === "\\" && (inS || inD)) { i++; continue; }
      if (c === '"' && !inS) inD = !inD;
      if (c === "'" && !inD) inS = !inS;
      if (!inS && !inD && c === "-" && n === "-") { cutAt = i; break; }
    }
    if (cutAt >= 0) line = line.slice(0, cutAt);
    
    if (!line.trim()) continue;

    
    
    
    out.push(line);
  }
  return out.join("\n");
}

function cleanLuaScript(text) {
  if (!text) return "";
  if (typeof text !== "string") { try { text = String(text); } catch { return ""; } }
  var trimmed = text.trim();
  if (!trimmed) return text;

  var linesArr;
  try { linesArr = trimmed.split(/\r?\n/); } catch { linesArr = [trimmed]; }
  if (!linesArr || !linesArr.length) return text;

  var cleaned = [];

  
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
    
    /^\s*local\s+[a-z]\d*\s*=\s*[a-z]+\.?[a-z]*\d*\s*$/,  
    /^\s*local\s+[a-z]\d*\s*=\s*(true|false|0|nil|{})\s*$/,  
    /^\s*local\s+[a-z]\d*\s*=\s*[a-z]+\d*\s*or\s+[a-z]+\.?[a-z]*\d*/,  
    /local\s+[a-z]\d*\s*=\s*tonumber\(.*tostring/,  
    /tostring\(result\)/,  
    /local\s+[a-z]\d*\s*=\s*\{\s*pcall\(function/,  
    /if\s+not\s+pcall\(function\(\)\s*$/,  
    /if\s+[a-z]\d*\s+then\s*$/,  
    /[a-z]\d*\s*=\s*[a-z]\d*\s*and\s+[a-z]\d*/,  
    /[a-z]\d*\s*=\s*\([a-z]\d*\s*\+\s*[a-z]\d*\)\s*%\s*256/,  
    /repeat\s+task\.wait\(\)\s+until\s+game:IsLoaded\(\)/,  
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

    
    
    if (t.indexOf("--") === 0 || t.indexOf("--[[") === 0 || t.indexOf("--[=") === 0) {
      
      continue;
    }
    if (/^\[?\s*(LEAKED\s+BY|GOATED|GRABBED\s+BY|COPIED\s+BY|MADE\s+BY|CREDITS?\s*:)/i.test(t)) continue;
    if (/^\s*\/\//.test(t)) continue;
    if (/^\s*\/\*/.test(t) || /^\s*\*\//.test(t)) continue;
    if (/LEAKED\s+BY|\[\s*GOATED\s*\]|GUI\s*Copier/i.test(t)) continue;
    
    if (/\bMogged\b/i.test(t) && !/\b(local|function|game|workspace)\b/i.test(t)) continue;
    if (/^By\s+/i.test(t) && !/\b(local|function|game|workspace)\b/i.test(t)) continue;
    if (/\|/.test(t) && /discord\.(gg|com\/invite)\//i.test(t) && !/\b(local|function|if|for|while|return)\b/i.test(t)) continue;
    if (/discord\.(gg|com\/invite)\//i.test(t) && !/[=(){}]/.test(t) && !/\b(local|function|HttpGet|loadstring|game)\b/i.test(t)) continue;
    
    if (/^[-•*]\s*(PC|Mobile|Background\s*ID|Titre|Title|Image|Note|Info|Config|Setting)\b/i.test(t)) continue;
    if (/^[-•*]\s*.{0,80}\b(Background\s*ID|rbxassetid|remplace|VISION\s*HUB|100k|72k)\b/i.test(t)) continue;
    if (/^[-•*]\s*[A-Za-z][^:=]{0,40}\s*[:=]/.test(t) && !/\b(local|function|if|for|while|return|game|workspace)\b/.test(t)) continue;
    if (/^(PC|Mobile)\s*=\s*\d+k/i.test(t)) continue;
    if (/^Background\s*ID\s*:/i.test(t)) continue;
    if (/^Titre\s*:/i.test(t)) continue;

    
    if (isGrabber(t)) continue;

    
    if (hasLoader(t)) continue;

    
    if (isJunkLine(t)) continue;

    
    
    if (!isLuaLine(t) && t.length > 5 && !/^https?:\/\//.test(t) && !isSafeUrl(t)) {
      
      if (!/[=(){}\[\];]/.test(t) && !/\b(local|function|end|then|else|elseif|return|for|while|do|repeat|until|and|or|not|true|false|nil|game|workspace|script|Instance|Vector3|CFrame|Color3|UDim2|Enum|task|pcall|require|loadstring)\b/i.test(t)) {
        continue;
      }
      
      if (!/\s/.test(t) && t.length > 20 && !/^["'].*["']$/.test(t)) continue;
      
      if (/\b(BYPASS|EDITION|HUB|SPEED\s*BYPASS|ORANGE\s*EDITION|VISION\s*HUB)\b/i.test(t)) continue;
    }

    
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

    
    for (var pi = 0; pi < loaderPatterns.length; pi++) {
      try { lineToKeep = lineToKeep.replace(loaderPatterns[pi], ""); } catch {}
    }
    if (!lineToKeep.trim() || lineToKeep.trim().length < 3) continue;
    if (/^[\s();,{}]+$/.test(lineToKeep.trim())) continue;

    
    try {
      if (/^\s*print\s*\(/.test(lineToKeep) && /LEAKED|GOATED|discord\.gg|Mogged|OR's/i.test(lineToKeep)) {
        lineToKeep = 'print("prince")';
      }
    } catch {}

    
    try {
      lineToKeep = lineToKeep.replace(/(https?:\/\/)?discord\.(gg|com\/invite)\/[a-zA-Z0-9-]+/gi, "https://discord.gg/TBBAUZu8cW");
    } catch {}

    if (!lineToKeep.trim()) continue;
    cleaned.push(lineToKeep);
  }

  var result = cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return result || "";
}

function balanceLuaBlocks(code) {
  if (!code || typeof code !== "string") return code;
  const lines = code.split("\n");
  const stack = []; 
  let pendingIf = false, pendingForWhile = false;
  for (let line of lines) {
    
    let s = line.replace(/\[\[[\s\S]*?\]\]/g, "");
    
    s = s.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
    
    const ci = s.indexOf("--");
    if (ci >= 0) s = s.slice(0, ci);
    
    const tokens = s.match(/\b(function|if|then|for|while|do|repeat|end|until|elseif|else)\b/g) || [];
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (t === "function") {
        stack.push("end");
      } else if (t === "repeat") {
        stack.push("until");
      } else if (t === "if") {
        
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
        else { stack.push("end"); } 
      } else if (t === "end") {
        if (stack.length) stack.pop();
      } else if (t === "until") {
        if (stack.length) stack.pop();
      }
      
      i++;
    }
  }
  if (!stack.length) return code;
  
  let appended = "";
  while (stack.length) {
    const closer = stack.pop();
    appended += closer === "until" ? "\nuntil true" : "\nend";
  }
  return code + appended;
}

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
  
  return "```lua\n" + previewText + "\n```";
}

function looksLikeBytecodeOrBroken(src) {
  if (!src || typeof src !== "string") return true;
  const s = src.trim();
  if (s.length < 8) return true;
  
  const hexEscapes = (s.match(/\\x[0-9a-fA-F]{2}/g) || []).length;
  if (hexEscapes >= 15) return true;
  if (hexEscapes >= 5 && s.length < 500) return true;
  
  if (/string\.dump\s*\(/.test(s)) return true;
  
  const nonPrintable = (s.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
  if (nonPrintable > 8) return true;
  
  try {
    const det = detectObfuscator(s);
    if (det && det.name === "Bytecode" && det.confidence >= 25) return true;
    if (det && det.name === "VM-Obfuscated" && det.confidence >= 40 && hexEscapes >= 3) return true;
  } catch {}
  
  const luaKeywords = (s.match(/\b(local|function|if|then|else|end|for|while|do|return|and|or|not)\b/g) || []).length;
  if (s.length > 150 && luaKeywords < 3 && /\\x[0-9a-fA-F]{2}|\\[0-9]{1,3}/.test(s)) return true;
  
  if (/^[\d\s\\x]+$/i.test(s) && s.length < 200) return true;
  return false;
}

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
  
  if (/return\s*\(\s*function\s*\(/.test(s.slice(0, 800)) && /\\x[0-9a-fA-F]{2}/.test(s) && luaSignals < 4) return true;
  if (/loadstring\s*\(\s*["'][\s\S]{80,}["']\s*\)/.test(s) && luaSignals < 3) return true;
  const nonAscii = (s.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []).length;
  if (s.length > 100 && nonAscii / s.length > 0.25) return true;
  return false;
}

function removeDangerousLines(code) {
  if (!code) return code;
  const lines = code.split("\n");
  const cleaned = lines.filter(line => {
    
    if (/discord(?:app)?\.com\/api\/webhooks/i.test(line)) return true;
    
    if (/loadstring\s*\(\s*(?:game|_G|env|HttpService)\s*[:.]\s*HttpGet/i.test(line)) return false;
    if (/loadstring\s*\(\s*HttpGet/i.test(line)) return false;
    if (/\bHttpGet\s*\(\s*["']http/i.test(line)) return false;
    if (/getcustomasset|getsynasset/i.test(line)) return false;
    if (/synapse|script-?ware|krnl|fluxus|delta|celery|electron|comet|vega\s*x|ironbrew/i.test(line)) return false;
    if (/loadlib|loadfile|dofile.*http/i.test(line)) return false;
    if (/syn\s*\.\s*request\s*\(/i.test(line)) return false;
    
    if (/iplogger|ipgrablog|ipify|whatismyip|grabify|logmyip|ipgrabber|stealip|ip-api\.com|icanhazip|ifconfig\.(co|me)|ipinfo\.io|freegeoip/i.test(line)) return false;
    if (/webhook\.site|hook\.billy|iplog\.xyz|blasze|nipiscan|spiderip/i.test(line)) return false;
    if (/^\s*--/.test(line) && !/discord\.(gg|com\/invite)/i.test(line)) return false;
    if (/LEAKED\s+BY|\[\s*GOATED\s*\]|Grabbed by|Copied by|GUI\s*Copier/i.test(line)) return false;
    if (/^[-•*]\s*(PC|Mobile|Background\s*ID|Titre|Title|Image)\b/i.test(line)) return false;
    if (/^[-•*]\s*.{0,80}\b(Background\s*ID|rbxassetid|VISION\s*HUB|100k|72k)\b/i.test(line)) return false;
    if (/^(PC|Mobile)\s*=\s*\d+k/i.test(line)) return false;
    if (/^Background\s*ID\s*:/i.test(line) || /^Titre\s*:/i.test(line)) return false;
    
    if (/\b(BYPASS|EDITION|VISION\s*HUB|SPEED\s*BYPASS)\b/i.test(line) && !/\b(local|function|if|for|while|return|game)\b/i.test(line)) return false;
    
    if (/\bMogged\b/i.test(line) && !/\b(local|function|game)\b/i.test(line)) return false;
    if (/^By\s+/i.test(line) && !/\b(local|function|game)\b/i.test(line)) return false;
    if (/discord\.(gg|com\/invite)\//i.test(line) && !/[=(){}]/.test(line) && !/\b(local|function|HttpGet|loadstring|game)\b/i.test(line)) return false;
    if (/\/api\/v[0-9]+\/track|\/log\?|\/grab\?/i.test(line)) return false;
    if (/ip\s*[=:]\s*["']?\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i.test(line)) return false;
    if (/(?:new\s+)?WebSocket\s*\(/i.test(line)) return false;
    return true;
  });
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

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
  
  for (const u of urls) {
    const lower = u.toLowerCase();
    
    if (/discord(?:app)?\.com\/api\/webhooks/i.test(lower)) continue;
    if (/discord\.(gg|com\/invite)\//i.test(lower)) continue;
    if (/files\.catbox\.moe\//i.test(lower)) continue;
    for (const dom of ipLoggerDomains) {
      if (lower.includes(dom)) return true;
    }
    
    if (/^(?:https?:\/\/)?(?:bit\.ly|tinyurl\.com|is\.gd|t\.co|ow\.ly|rb\.gy|cutt\.ly|bc\.vc|adf\.ly|linkvertise\.com|shorte\.st|bcvc\.one)\/?/i.test(lower)) return true;
  }
  
  for (const line of text.split("\n")) {
    if (/discord(?:app)?\.com\/api\/webhooks/i.test(line)) continue;
    
    if (/loadstring\s*\(\s*(?:game|_G|env|HttpService)\s*[:.]\s*HttpGet\s*\(\s*["']https?:\/\//i.test(line)) return true;
    if (/loadstring\s*\(\s*HttpGet\s*\(\s*["']https?:\/\//i.test(line)) return true;
    if (/\bHttpGet\s*\(\s*["']https?:\/\//i.test(line)) return true;
    
    if (/HttpService\s*[:.]\s*GetAsync\s*\(\s*["']https?:\/\//i.test(line)) return true;
    
    if (/syn\s*\.\s*request\s*\([^)]*https?:\/\//i.test(line)) return true;
    if (/http\s*\.\s*(?:get|request)\s*\(\s*["']https?:\/\//i.test(line)) return true;
    
    if (/require\s*\(\s*["']https?:\/\//i.test(line)) return true;
    if (/(?:loadlib|loadfile|dofile)\s*\([^)]*https?:\/\//i.test(line)) return true;
    
    if (/(?:pcall|xpcall)\s*\(\s*loadstring[^)]*https?:\/\//i.test(line)) return true;
  }
  return false;
}

function stripGuiCopierHeader(source) {
  if (!source || typeof source !== "string") return source;
  
  source = source.replace(/--\s*\[\[([\s\S]*?)\]\]/g, (block, inner) => {
    const t = String(inner || "");
    
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
    
    if (!matched && /^\s*--/.test(lines[i]) && (/reconstructed|ScreenGui\s*:|Root\s*:|Layout\s*:|execution\s+log|={3,}|-{3,}/i.test(lines[i]))) {
      matched = true;
    }
    if (matched) { i++; continue; }
    break;
  }
  return lines.slice(i).join("\n").replace(/^\s*\n+/, "");
}

function stripNonLuaJunk(code) {
  if (!code || typeof code !== "string") return code;
  const lines = code.split(/\r?\n/);
  
  const looksLikeLua = (line) => {
    const t = line.trim();
    if (!t) return true; 
    
    if (/^\s*--/.test(line)) return true;
    
    if (/\[\[|\]\]/.test(line)) return true;
    
    if (/^\s*(local|function|if|then|else|elseif|end|for|while|do|repeat|until|return|break|and|or|not|in|nil|true|false)\b/.test(line)) return true;
    if (/^\s*(game|workspace|script|Instance|getgenv|gethui|getrenv|getrawmetatable|setreadonly|hookfunction|hookmetamethod|getnamecallmethod|getconnections|firesignal|fireclickdetector|writefile|readfile|makefolder|delfolder|loadfile|dofile|loadstring|require|pcall|xpcall|task|spawn|delay|wait|print|warn|assert|error|tonumber|tostring|type|typeof|pairs|ipairs|next|select|unpack|rawget|rawset|setmetatable|getmetatable|string|table|math|os|io|debug|coroutine|bit|bit32|utf8|buffer)\b/.test(line)) return true;
    if (/^\s*(TweenService|UserInputService|RunService|ReplicatedStorage|StarterGui|CoreGui|Lighting|TeleportService|MarketplaceService|HttpService|InsertService|Players|Debris|CollectionService|PathfindingService|SoundService|Chat|TextService|ProximityPromptService)\b/.test(line)) return true;
    
    if (/[=():{}\[\].]/.test(line) && /[a-zA-Z_]/.test(line)) return true;
    
    if (/^["'`].*["'`]$/.test(t)) return true;
    
    if (/discord(?:app)?\.com\/api\/webhooks/i.test(line)) return true;
    
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
    
    if (!isJunk && !looksLikeLua(line)) isJunk = true;
    if (!isJunk) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function aiCleanScript(source, mode) {
  
  source = stripGuiCopierHeader(source);
  
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
5. Remove meta/header note lines such as:
   - PC = 100k / Mobile = 72k
   - Background ID: 110054661335618
   - Titre : Image 83083712996345 (remplace le texte VISION HUB)
   and any similar dash-bullet config notes that are not Lua code
6. Remove title/banner lines that are NOT Lua even without -- or -, e.g.:
   FA4E7XX SPEED BYPASS - UI (Orange Edition)
   any all-caps product name / UI edition labels with no Lua statements
7. Remove empty leftover blank lines (collapse 3+ newlines to 2)

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
    
    output = output.replace(/^```(?:lua)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    if (!output) throw new Error("Empty AI response");
    
    output = output
      .replace(/\[?\s*LEAKED\s+BY\s+[^\]]*\]?/gi, "")
      .replace(/\[?\s*GOATED\s*\]?/gi, "")
      .replace(/^\s*--\s*\[?\s*LEAKED\s+BY.*$/gim, "")
      .replace(/^\s*--\s*\[?\s*GOATED.*$/gim, "");
    
    output = stripNonLuaJunk(output);
    
    if (mode === "readable") output = balanceLuaBlocks(output);
    return output;
  } catch (e) {
    console.warn("⚠️ OpenAI clean failed, falling back to regex:", e.message?.slice(0, 120));
    let out = mode === "var" ? renameVariables(source) : balanceLuaBlocks(cleanLuaScript(source));
    return stripNonLuaJunk(out);
  }
}

function goofyscator(source, settings) {
  const s = settings || {};
  let out = source;
  
  
  const randStr = (len) => {
    const c = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let r = "_";
    for (let i = 0; i < len; i++) r += c[Math.floor(Math.random() * c.length)];
    return r;
  };
  
  
  const xorStr = (str, key) => {
    let result = [];
    for (let i = 0; i < str.length; i++) {
      result.push(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result.join(",");
  };
  
  
  if (s.encryptStrings !== false) {
    const key = randStr(8);
    out = out.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g, (match) => {
      const inner = match.slice(1, -1);
      if (inner.length < 2) return match;
      const encrypted = xorStr(inner, key);
      return `(function() local k="${key}" local e={${encrypted}} local r="" for i=1,#e do r=r..string.char(bit.bxor(e[i],k:byte((i-1)%#k+1))) end return r end)()`;
    });
  }
  
  
  if (s.proxifyLocals !== false) {
    const proxyName = randStr(6);
    out = `local ${proxyName} = setmetatable({}, {__index = function(_,k) return rawget(_G,k) end, __newindex = function(_,k,v) rawset(_G,k,v) end})\n` + out;
    out = out.replace(/\blocal\s+(\w+)/g, (m, name) => {
      if (name === proxyName) return m;
      return m;
    });
  }
  
  
  if (s.proxifyFunctions !== false) {
    const funcProxy = randStr(6);
    out = `local ${funcProxy} = function(f,...) return f(...) end\n` + out;
  }
  
  
  if (s.antiTamper !== false) {
    const tamperCheck = `-- Anti-Tamper\nlocal _orig = checkcaller or function() return true end\nif not _orig() then error("Tampered") end\n`;
    out = tamperCheck + out;
  }
  
  
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
  
  
  const depth = s.loaderVMDepth || 1;
  for (let i = 0; i < depth; i++) {
    const vmKey = randStr(10);
    const encoded = Buffer.from(out, "utf8").toString("base64");
    out = `-- Goofyscator Layer ${i + 1}\nlocal ${vmKey} = loadstring(game:HttpGet and game:HttpGet("") or "${encoded}") or loadstring(require(game:GetService("HttpService")).Base64Decode("${encoded}"))()\n`;
  }
  
  return out;
}

function isPastefyUrl(url) {
  try {
    const u = new URL(String(url || "").trim());
    return /(^|\.)pastefy\.app$/i.test(u.hostname);
  } catch {
    return false;
  }
}

function buildScripanelV2() {
  try {
    const hasScript = !!(scripanelStore && scripanelStore.script && String(scripanelStore.script).trim());
    const hasUrl = !!(scripanelStore && scripanelStore.url && String(scripanelStore.url).trim());
    let status = "No script loaded yet. Owner: click **Update** to set a Pastefy URL or paste a script.";
    if (hasUrl || hasScript) {
      const parts = [];
      if (hasUrl) parts.push("**URL:** " + String(scripanelStore.url).slice(0, 200));
      if (hasScript) parts.push("**Script:** protected with Prince Obfuscator (`" + String(scripanelStore.script).length + "` chars)");
      if (scripanelStore.updatedAt) parts.push("**Updated:** <t:" + Math.floor(Number(scripanelStore.updatedAt) / 1000) + ":R>");
      status = parts.join("\n");
    }
    const panelRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("scripanel_how").setLabel("How").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("scripanel_update").setLabel("Update").setStyle(ButtonStyle.Primary)
    );
    return {
      flags: IS_COMPONENTS_V2,
      embeds: [],
      components: [{
        type: 17,
        accent_color: FINDER_V2_ACCENT,
        components: [
          { type: 10, content: ("### Script Panel\n" + status).slice(0, 3900) },
          { type: 14, divider: true, spacing: SEPARATOR_SPACING_SMALL },
          panelRow.toJSON()
        ]
      }]
    };
  } catch (e) {
    console.error("buildScripanelV2:", e?.message || e);
    return {
      flags: IS_COMPONENTS_V2,
      embeds: [],
      components: [{
        type: 17,
        accent_color: FINDER_V2_ACCENT,
        components: [
          { type: 10, content: "### Script Panel\nNo script loaded yet." },
          { type: 14, divider: true, spacing: SEPARATOR_SPACING_SMALL },
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("scripanel_how").setLabel("How").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("scripanel_update").setLabel("Update").setStyle(ButtonStyle.Primary)
          ).toJSON()
        ]
      }]
    };
  }
}

function obfuscateLua(source) {
  if (!source || typeof source !== "string") return source;
  let code = String(source).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!code.trim()) return source;

  
  
  const key = crypto.randomBytes(16);
  const plain = Buffer.from(code, "utf8");
  const xored = Buffer.alloc(plain.length);
  for (let i = 0; i < plain.length; i++) {
    xored[i] = plain[i] ^ key[i % key.length] ^ ((i * 31 + 17) & 0xff);
  }
  for (let i = 0; i + 1 < xored.length; i += 2) {
    const tmp = xored[i];
    xored[i] = xored[i + 1];
    xored[i + 1] = tmp;
  }

  const std = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const alphabetArr = std.split("");
  for (let i = alphabetArr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = alphabetArr[i];
    alphabetArr[i] = alphabetArr[j];
    alphabetArr[j] = tmp;
  }
  const alphabet = alphabetArr.join("");

  function encodeCustom(buf, alpha) {
    let out = "";
    for (let i = 0; i < buf.length; i += 3) {
      const a = buf[i];
      const b = i + 1 < buf.length ? buf[i + 1] : 0;
      const c = i + 2 < buf.length ? buf[i + 2] : 0;
      const n = (a << 16) | (b << 8) | c;
      out += alpha[(n >> 18) & 63];
      out += alpha[(n >> 12) & 63];
      out += (i + 1 < buf.length) ? alpha[(n >> 6) & 63] : "=";
      out += (i + 2 < buf.length) ? alpha[n & 63] : "=";
    }
    return out;
  }
  const encoded = encodeCustom(xored, alphabet);

  const CHUNK = 97;
  const chunks = [];
  for (let i = 0; i < encoded.length; i += CHUNK) chunks.push(encoded.slice(i, i + CHUNK));
  const order = chunks.map((_, idx) => idx);
  for (let i = order.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  const permChunks = order.map((oi) => chunks[oi]);
  const inv = new Array(order.length);
  for (let i = 0; i < order.length; i++) inv[order[i]] = i;

  const keyExpr = Array.from(key).map((b) => {
    const a = crypto.randomInt(1, 40);
    const x = crypto.randomInt(1, 12);
    const adj = a * x - b;
    return "(" + a + "*" + x + "-" + adj + ")";
  }).join(",");

  const rnd = () => {
    const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
    const chars = letters + "IlO017";
    let s = letters[crypto.randomInt(0, letters.length)];
    for (let i = 0; i < 7; i++) s += chars[crypto.randomInt(0, chars.length)];
    return s;
  };
  const N = { a: rnd(), k: rnd(), p: rnd(), q: rnd(), d: rnd(), v: rnd(), w: rnd(), b: rnd(), x: rnd(), o: rnd(), r: rnd(), f: rnd(), s: rnd(), t: rnd(), z: rnd(), u: rnd() };

  const invLua = inv.join(",");
  const chunksLua = permChunks.map((s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",");
  const alphaEsc = alphabet.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const L = [];
  L.push("-- This file was protected using Prince Obfuscator");
  L.push("local " + N.a + '="' + alphaEsc + '"');
  L.push("local " + N.k + "={" + keyExpr + "}");
  L.push("local " + N.p + "={" + chunksLua + "}");
  L.push("local " + N.q + "={" + invLua + "}");
  L.push("local function " + N.d + "(s)");
  L.push("  local map={}");
  L.push("  for i=1,#" + N.a + " do map[string.sub(" + N.a + ",i,i)]=i-1 end");
  L.push('  s=string.gsub(s,"[^"..' + N.a + '.."=]","")');
  L.push("  local out={} local u=1");
  L.push("  for i=1,#s,4 do");
  L.push("    local b1=map[string.sub(s,i,i)]or 0");
  L.push("    local b2=map[string.sub(s,i+1,i+1)]or 0");
  L.push("    local b3=map[string.sub(s,i+2,i+2)]or 0");
  L.push("    local b4=map[string.sub(s,i+3,i+3)]or 0");
  L.push("    local n=bit32.bor(bit32.lshift(b1,18),bit32.lshift(b2,12),bit32.lshift(b3,6),b4)");
  L.push("    out[u]=string.char(bit32.band(bit32.rshift(n,16),255)) u=u+1");
  L.push('    if string.sub(s,i+2,i+2)~="=" then out[u]=string.char(bit32.band(bit32.rshift(n,8),255)) u=u+1 end');
  L.push('    if string.sub(s,i+3,i+3)~="=" then out[u]=string.char(bit32.band(n,255)) u=u+1 end');
  L.push("  end");
  L.push("  return table.concat(out)");
  L.push("end");
  
  L.push("local function " + N.w + "() local z=0 for _=1,2 do z=bit32.bxor(z,#" + N.a + ") end return z<0 end");
  L.push("local function " + N.v + "()");
  L.push("  if " + N.w + "() then return \"\" end");
  L.push("  local o={}");
  L.push("  for i=1,#" + N.q + " do o[i]=" + N.p + "[" + N.q + "[i]+1] end");
  L.push("  return table.concat(o)");
  L.push("end");
  L.push("local " + N.b + "=" + N.v + "()");
  L.push("local " + N.x + "=" + N.d + "(" + N.b + ")");
  
  L.push("local " + N.o + "={} local len=#" + N.x);
  L.push("for i=1,len,2 do");
  L.push("  if i+1<=len then " + N.o + "[i]=string.sub(" + N.x + ",i+1,i+1) " + N.o + "[i+1]=string.sub(" + N.x + ",i,i) else " + N.o + "[i]=string.sub(" + N.x + ",i,i) end");
  L.push("end");
  L.push("local " + N.r + "=table.concat(" + N.o + ")");
  L.push("local " + N.f + "={}");
  L.push("for i=1,#" + N.r + " do");
  L.push("  local c=string.byte(" + N.r + ",i)");
  L.push("  local kb=" + N.k + "[((i-1)%#" + N.k + ")+1]");
  L.push("  " + N.f + "[i]=string.char(bit32.bxor(c,bit32.band(kb,255),bit32.band(i*31+17,255)))");
  L.push("end");
  L.push("local " + N.s + "=table.concat(" + N.f + ")");
  L.push("local " + N.t + "=(loadstring or load)(" + N.s + ")");
  L.push('if not ' + N.t + ' then error("Prince Obfuscator: load failed",0) end');
  L.push("return " + N.t + "()");
  L.push("");
  return L.join("\n");
}

const commands = [
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send a message here.")
    .addStringOption(o => o
      .setName("text")
      .setDescription("Message content.")
      .setRequired(true))
    .addStringOption(o => o
      .setName("type")
      .setDescription("Choose what message you want to sent.")
      .setRequired(true)
      .addChoices(
        { name: "With Embed", value: "good" },
        { name: "Embed V2", value: "v2" },
        { name: "No Embed", value: "none" }
      ))
    .addStringOption(o => o
      .setName("title")
      .setDescription("Embed title.")
      .setRequired(false))
    .addStringOption(o => o
      .setName("footer")
      .setDescription("Embed footer.")
      .setRequired(false))
    .addStringOption(o => o
      .setName("color")
      .setDescription("Embed color.")
      .setRequired(false))
    .addAttachmentOption(o => o
      .setName("image")
      .setDescription("Attach a image if you want.")
      .setRequired(false))
    .addAttachmentOption(o => o
      .setName("file")
      .setDescription("Attach a file if you want.")
      .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("finderpanel")
    .setDescription("Post the Finder Panel here.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("login")
    .setDescription("Login Discord Token")
    .addStringOption(o => o
      .setName("token")
      .setDescription("The Discord Token")
      .setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("forward")
    .setDescription("Forward files from one channel to another.")
    .addStringOption(o => o
      .setName("source")
      .setDescription("Source channel ID or link")
      .setRequired(true))
    .addStringOption(o => o
      .setName("destination")
      .setDescription("Destination channel ID or link")
      .setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Open the blacklist config.")
    .addStringOption(o => o
      .setName("mode")
      .setDescription("Choose what you want.")
      .setRequired(true)
      .addChoices(
        { name: "Add", value: "add" },
        { name: "Remove", value: "remove" },
        { name: "List", value: "list" }
      ))
    .addUserOption(o => o
      .setName("user")
      .setDescription("The user you want to blacklist or remove.")
      .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Whitelist a user.")
    .addStringOption(o => o
      .setName("mode")
      .setDescription("Choose what you want.")
      .setRequired(true)
      .addChoices(
        { name: "Add", value: "add" },
        { name: "Remove", value: "remove" },
        { name: "List", value: "list" }
      ))
    .addUserOption(o => o
      .setName("user")
      .setDescription("The user you want to whitelist or remove.")
      .setRequired(false))
    .addStringOption(o => o
      .setName("id")
      .setDescription("User ID or Username.")
      .setRequired(false))
    .toJSON()
].map(c => c);
async function registerCommands() {
  if (registering) return;
  registering = true;
  const rest = new REST({ version: "10", timeout: 15000 }).setToken(TOKEN);
  try {
    
    console.log("🧹 Clearing old guild commands...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] }).catch(() => {});
    console.log("🧹 Clearing old global commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] }).catch(() => {});

    
    try {
      for (const g of client.guilds.cache.values()) {
        if (String(g.id) === String(GUILD_ID)) continue;
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, g.id), { body: [] }).catch(() => {});
      }
    } catch {}

    
    try {
      const globalCmds = await rest.get(Routes.applicationCommands(CLIENT_ID));
      for (const cmd of globalCmds || []) {
        if (String(cmd.name).toLowerCase() === "upload" || String(cmd.name).toLowerCase() === "update") {
          await rest.delete(Routes.applicationCommand(CLIENT_ID, cmd.id)).catch(() => {});
          console.log("🗑️ Removed stale global /${cmd.name}");
        }
      }
    } catch {}
    try {
      const guildCmds = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID));
      for (const cmd of guildCmds || []) {
        if (String(cmd.name).toLowerCase() === "upload" || String(cmd.name).toLowerCase() === "update") {
          await rest.delete(Routes.applicationGuildCommand(CLIENT_ID, GUILD_ID, cmd.id)).catch(() => {});
          console.log("🗑️ Removed stale guild /" + cmd.name);
        }
      }
    } catch {}

    console.log("🧩 Registering global slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    const names = (commands || []).map(c => c.name).join(", ");
    console.log("✅ Commands registered (global):", names || "(none)");
    registering = false;
  } catch (e) {
    registering = false;
    console.error("❌ Register fail:", e.message);
  }
}

client.once("ready", async () => {
  isReady = true; lastReady = Date.now();
  console.log("==========================================");
  console.log(`✅ ONLINE: ${client.user.tag}`);
  console.log(`🏠 Guilds: ${client.guilds.cache.size}`);
  console.log(`📚 Files: ${library.files.length}`);
  const liveN = Array.isArray(config.liveScanChannelIds) ? config.liveScanChannelIds.length : 0;
  try { purgeUnavailableFromLibrary(); } catch {}
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

const YELLOW_COLOR = 0xF1C40F;
const helpPages = [
  new EmbedBuilder()
    .setTitle("🤖 Bot Commands")
    .setColor(BLURPLE)
    .setDescription(
`**\`.detect\`** Detect a risk in the file.

**\`.upload\`** Turn your file into Script Loader.

**\`.get\`** Get file using ID.`
    ),
  new EmbedBuilder()
    .setTitle("🤖 Bot Commands")
    .setColor(BLURPLE)
    .setDescription(
`**\`.find\`** Search files by name.

**\`.leaderboard\`** Top command users.`
    ),
  new EmbedBuilder()
    .setTitle("🤖 Bot Commands")
    .setColor(YELLOW_COLOR)
    .setDescription(
`**\`.clean\`** [\`.cl\`] Clean a script.

> Premium users can use all commands in DMs.
> Premium users have unlimited tokens.`
    )
];
const helpSessions = new Map();

const helpPageBodies = [
  { color: 0x5865F2, text: `**\`.detect\`** Detect a risk in the file.

**\`.upload\`** Turn your file into Script Loader.

**\`.get\`** Get file using ID.` },
  { color: 0x5865F2, text: `**\`.find\`** Search files by name.

**\`.leaderboard\`** Top command users.` },
  { color: 0xFEE75C, text: `**\`.clean\`** [\`.cl\`] Clean a script.

> Premium users can use all commands in DMs.
> Premium users have unlimited tokens.` }
];

function buildHelpV2(page, userId) {
  const pageData = helpPageBodies[page] || helpPageBodies[0];
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`help_${userId}_prev`).setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`help_${userId}_next`).setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(page >= helpPageBodies.length - 1)
  );
  return {
    flags: IS_COMPONENTS_V2,
    components: [{
      type: 17,
      accent_color: pageData.color,
      components: [
        { type: 10, content: ("### 🤖 Bot Commands\n" + pageData.text).slice(0, 4000) },
        { type: 14, spacing: SEPARATOR_SPACING_SMALL },
        row.toJSON()
      ]
    }],
    allowedMentions: { repliedUser: false, parse: [] }
  };
}

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  const uid = interaction.user.id;
  
  if (interaction.customId.startsWith("cleanfile_")) {
    const parts = interaction.customId.split("_");
    
    const idx = parseInt(parts[1], 10);
    const ownerId = parts.slice(2).join("_");
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: "❌ not yours, dumbass.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const session = cleanSessions.get(interaction.message.id);
    if (!session || String(session.authorId) !== String(ownerId) || !Array.isArray(session.files)) {
      return interaction.reply({ content: "❌ panel expired — run `.clean` again.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const fileMeta = session.files[idx - 1];
    if (!fileMeta) {
      return interaction.reply({ content: "❌ invalid file number.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    cleanSessions.delete(interaction.message.id);
    try {
      await interaction.update({
        flags: IS_COMPONENTS_V2,
        components: [{
          type: 17,
          accent_color: RENAME_V2_ACCENT,
          components: [{ type: 10, content: "### Loading file...\n⏳ Please wait..." }]
        }]
      });
    } catch { try { await interaction.deferUpdate(); } catch {} }

    try {
      const body = await downloadAttachmentText(fileMeta);
      if (!body) {
        await interaction.followUp({ content: "❌ couldn't read that file.", flags: MessageFlags.Ephemeral }).catch(() => {});
        try { await interaction.message.delete().catch(() => {}); } catch {}
        return;
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("clean_v1_" + ownerId).setLabel("Clean V1").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("clean_v2_" + ownerId).setLabel("Clean V2").setStyle(ButtonStyle.Success)
      );
      const ch = interaction.channel;
      const panelMsg = await ch.send({
        flags: IS_COMPONENTS_V2,
        components: [{
          type: 17,
          accent_color: RENAME_V2_ACCENT,
          components: [
            { type: 10, content: "### Choose Clean Version\nSelect a clean version below." },
            { type: 14, divider: true, spacing: SEPARATOR_SPACING_SMALL },
            row.toJSON()
          ]
        }],
        allowedMentions: { repliedUser: false, parse: [] }
      });
      if (panelMsg?.id) {
        cleanSessions.set(panelMsg.id, { authorId: ownerId, content: body, at: Date.now() });
      }
      try { await interaction.message.delete().catch(() => {}); } catch {}
    } catch (e) {
      await interaction.followUp({ content: "❌ " + String(e.message || e).slice(0, 100), flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }

  
    if (interaction.customId.startsWith("detectfile_")) {
    const parts = interaction.customId.split("_");
    const idx = parseInt(parts[1], 10);
    const ownerId = parts.slice(2).join("_");
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: "❌ not yours.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const session = detectSessions.get(interaction.message.id);
    if (!session || String(session.authorId) !== String(ownerId) || !Array.isArray(session.files)) {
      return interaction.reply({ content: "❌ panel expired — run `.detect` again.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const fileMeta = session.files[idx - 1];
    if (!fileMeta) {
      return interaction.reply({ content: "❌ invalid file number.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    detectSessions.delete(interaction.message.id);
    try {
      await interaction.update({
        flags: IS_COMPONENTS_V2,
        components: [{
          type: 17,
          accent_color: RENAME_V2_ACCENT,
          components: [{ type: 10, content: "### Detecting...\n⏳ Processing..." }]
        }]
      });
    } catch { try { await interaction.deferUpdate(); } catch {} }

    try {
      const body = await downloadAttachmentText(fileMeta);
      if (!body) {
        await interaction.followUp({ content: "❌ couldn't read that file.", flags: MessageFlags.Ephemeral }).catch(() => {});
        try { await interaction.message.delete().catch(() => {}); } catch {}
        return;
      }
      const result = detectThreatAnalysis(body);
      const textBody =
        `## Detected: ${result.title}\n` +
        (result.line != null ? `**Line: ${result.line}**\n` : "") +
        `-# What it does:\n\n` +
        "```" + result.description + "```";
      await interaction.channel.send({
        flags: IS_COMPONENTS_V2,
        components: [{
          type: 17,
          accent_color: result.color,
          components: [{ type: 10, content: textBody.slice(0, 3900) }]
        }],
        allowedMentions: { repliedUser: false, parse: [] }
      });
      try { await interaction.message.delete().catch(() => {}); } catch {}
    } catch (e) {
      await interaction.followUp({ content: "❌ " + String(e.message || e).slice(0, 100), flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }

  if (interaction.customId.startsWith("clean_v1_") || interaction.customId.startsWith("clean_v2_")) {
    const isV2 = interaction.customId.startsWith("clean_v2_");
    const ownerId = interaction.customId.replace(/^clean_v[12]_/, "");
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: "❌ not yours, dumbass.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const session = cleanSessions.get(interaction.message.id);
    if (!session || String(session.authorId) !== String(ownerId)) {
      return interaction.reply({ content: "❌ panel expired — run `.clean` again.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    cleanSessions.delete(interaction.message.id);
    try {
      await interaction.update({
        flags: IS_COMPONENTS_V2,
        components: [{
          type: 17,
          accent_color: RENAME_V2_ACCENT,
          components: [{ type: 10, content: "### Cleaning...\n⏳ Processing..." }]
        }]
      });
    } catch {
      try { await interaction.deferUpdate(); } catch {}
    }
    (async () => {
      try {
        let text = String(session.content || "");
        try { text = stripGuiCopierHeader(text); } catch {}
        const urlRegex = /https?:\/\/[^\s"'()\]]+/g;
        const foundUrls = text.match(urlRegex) || [];
        let finalOutput;
        if (isV2) {
          finalOutput = cleanLuaV2(text);
          
          if (openaiClient && text && text.length < 120000) {
            try {
              const V2_CLEAN_PROMPT = `You are an expert Lua code cleaner and deobfuscator.

TASK: Clean and refactor the provided Lua code.

RULES:
- Remove all obfuscation, junk code, fake control flows, and useless variables.
- Keep the EXACT original logic and functionality - do not add or remove features.
- Format the code with proper indentation and newlines.
- Do NOT rename variables. Keep original variable and function names exactly as they are.
- Remove any loadstring / game:HttpGet remote loader blocks that fetch and execute external code.
- Convert to clean, readable, vanilla Lua (Luau compatible if it's Roblox).
- Remove all comments or text/word that are not valid Lua or that cause of syntax errors.
- Do not explain. Output ONLY the cleaned Lua code in a lua code block.`;
              const completion = await openaiClient.chat.completions.create({
                model: process.env.OPENAI_MODEL || "gpt-4o-mini",
                temperature: 0.1,
                max_tokens: 8000,
                messages: [
                  { role: "system", content: V2_CLEAN_PROMPT },
                  { role: "user", content: String(text).slice(0, 100000) }
                ]
              });
              const aiOut = (completion.choices?.[0]?.message?.content || "").trim();
              if (aiOut && aiOut.length > 20) {
                finalOutput = aiOut
                  .replace(/^```(?:lua|luau)?\s*\n?/i, "")
                  .replace(/\n?```\s*$/i, "")
                  .trim() + "\n";
              }
            } catch (e) {
              console.warn("⚠️ clean V2 AI pass:", e.message?.slice?.(0, 100));
            }
          }
        } else {
          finalOutput = cleanLuaForRename(text);
        }
        if (!finalOutput || !finalOutput.trim()) throw new Error("empty output after clean");
        const uniqueUrls = [...new Set(foundUrls)];
        const previewText = buildPreviewText(finalOutput);
        let previewBody = "### File Preview\n```lua\n" + previewText + "\n```";
        if (uniqueUrls.length > 0) {
          const urlList = uniqueUrls.slice(0, 10).map(u => "- " + u).join("\n");
          previewBody += "\n\n**URL Found:**\n" + urlList + (uniqueUrls.length > 10 ? "\n- ...and " + (uniqueUrls.length - 10) + " more" : "");
        }
        const outputName = "clean.lua";
        const fileBuf = Buffer.from(finalOutput, "utf-8");
        
        try {
          const ch = interaction.channel;
          const safeName = String(outputName).replace(/[^\w.\-]+/g, "_");
          const file = new AttachmentBuilder(fileBuf, { name: safeName });
          await ch.send({
            flags: IS_COMPONENTS_V2,
            files: [file],
            components: [{
              type: 17,
              accent_color: RENAME_V2_ACCENT,
              components: [
                { type: 10, content: previewBody.slice(0, 3900) },
                { type: 14, divider: true, spacing: SEPARATOR_SPACING_SMALL },
                { type: 13, file: { url: "attachment://" + safeName } }
              ]
            }],
            allowedMentions: { repliedUser: false, parse: [] }
          });
        } catch (e) {
          await interaction.followUp({
            content: "❌ clean failed: " + String(e.message || e).slice(0, 120),
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        }
        
        try { await interaction.message.delete().catch(() => {}); } catch {}
      } catch (e) {
        console.warn("⚠️ clean button:", e.message);
        await interaction.followUp({
          content: "❌ clean failed: " + String(e.message || e).slice(0, 120),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
      }
    })();
    return;
  }

  
  if (interaction.customId.startsWith("tagcheck_")) {
    const uid = interaction.customId.slice("tagcheck_".length);
    if (interaction.user.id !== uid) {
      return interaction.reply({ content: "❌ not yours, dumbass.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const pending = pendingTagRetry.get(uid);
    if (!pending || (Date.now() - (pending.at || 0)) > 15 * 60 * 1000) {
      pendingTagRetry.delete(uid);
      return interaction.reply({ content: "❌ expired — run the command again.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const hasTag = await hasPrinceStatus(uid);
    if (!hasTag) {
      
      try { await interaction.deferUpdate(); } catch {}
      return;
    }
    pendingTagRetry.delete(uid);
    try {
      await interaction.update({
        flags: IS_COMPONENTS_V2,
        components: [{
          type: 17,
          accent_color: 0x57F287,
          components: [{ type: 10, content: "## Access granted\nYour `FS` server tag is verified." }]
        }]
      });
    } catch {
      try { await interaction.deferUpdate(); } catch {}
    }
    try {
      const ch = await client.channels.fetch(pending.channelId).catch(() => null);
      if (!ch) {
        await interaction.followUp({ content: "❌ channel gone — run the command again.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      let origMsg = null;
      if (pending.messageId) {
        try { origMsg = await ch.messages.fetch(pending.messageId); } catch {}
      }
      if (pending.fromPanel) {
        
        return;
      }
      if (origMsg) {
        client.emit("messageCreate", origMsg);
      } else {
        
        return;
      }
    } catch (e) {
      console.warn("⚠️ tagcheck retry:", e.message);
      await interaction.followUp({
        content: "❌ retry failed — run the command again.",
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
    return;
  }

  
  if (interaction.customId?.startsWith("rename_")) {
    const parts = interaction.customId.split("_");
    const mode = parts[1]; 
    const ownerId = parts.slice(2).join("_");
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: "❌ not yours, bro.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const ctx = renamePanels.get(interaction.message.id);
    if (!ctx) {
      return interaction.reply({ content: "loading, please wait...", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    renamePanels.delete(interaction.message.id);
    
    
    const loadingEmbed = new EmbedBuilder()
      .setColor(GRAY_COLOR)
      .setTitle("Renaming...")
      .setDescription("⏳ Processing...");
    await interaction.update({ embeds: [loadingEmbed], components: [] }).catch(() => {});
    
    
    (async () => {
      try {
        
        let text = ctx.fileContent;
        if (!text) {
          const res = await fetch(ctx.fileUrl);
          if (!res.ok) throw new Error(`File link expired (HTTP ${res.status}) — run .rename again`);
          text = await res.text();
        }
        if (!text || text.trim().length < 5) throw new Error("File is empty or unreadable, bro");
        
        if (isObfuscatedOrProtectionNotLua(text)) {
          await interaction.message.delete().catch(() => {});
          await interaction.channel.send({ content: `<@${interaction.user.id}> ❌ this is obufscated or protection code, try another.` }).catch(() => {});
          return;
        }
        
        text = stripGuiCopierHeader(text);
        const urlRegex = /https?:\/\/[^\s"'()\]]+/g;
        const foundUrls = text.match(urlRegex) || [];
        
        
        let effectiveMode = mode;
        if (looksLikeBytecodeOrBroken(text)) {
          effectiveMode = "readable";
          console.log("⚡ Bytecode/broken script detected → forcing Reconstruction mode");
        }
        
        const startTime = Date.now();
        let finalOutput = await aiCleanScript(text, effectiveMode);
        if (!finalOutput || !finalOutput.trim()) throw new Error("Processing returned empty output — try the other rename mode, bro");
        const finishSec = ((Date.now() - startTime) / 1000).toFixed(1);
        
        const outputName = "clean.lua";
        
        
        const uniqueUrls = [...new Set(foundUrls)];
        finalOutput = removeDangerousLines(finalOutput);

        
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

  
  if (interaction.customId?.startsWith("help_")) {
    const parts = interaction.customId.split("_");
    const uid = parts[1];
    const dir = parts[2];
    if (interaction.user.id !== uid) {
      return interaction.reply({ content: "❌ not yours, do `.help` so you can have yours.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    let page = helpSessions.get(uid) || 0;
    if (dir === "prev") page = Math.max(0, page - 1);
    if (dir === "next") page = Math.min(helpPageBodies.length - 1, page + 1);
    helpSessions.set(uid, page);
    const v2 = buildHelpV2(page, uid);
    try {
      await interaction.update({ components: v2.components, embeds: [], flags: IS_COMPONENTS_V2 });
    } catch (e) {
      try {
        await interaction.message.edit({ components: v2.components, embeds: [], flags: IS_COMPONENTS_V2 });
        if (!interaction.replied && !interaction.deferred) await interaction.deferUpdate().catch(() => {});
      } catch {}
    }
    return;
  }
  
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
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(menu.page <= 1),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(menu.page >= menu.totalPages)
    );
    const listLines = pageItems.map(f => `> \`${finderDisplayName(f.filename)}\` — ID: \`${f.id}\``);
    const v2 = buildFinderV2Payload({
      listLines,
      pageLabel: `Pages ${menu.page}/${menu.totalPages}`,
      actionRow: row,
      ephemeral: false
    });
    
    try {
      await interaction.update({
        components: v2.components,
        embeds: [],
        flags: IS_COMPONENTS_V2
      });
    } catch (e) {
      try {
        await interaction.message.edit({
          components: v2.components,
          embeds: [],
          flags: IS_COMPONENTS_V2
        });
        if (!interaction.replied && !interaction.deferred) {
          await interaction.deferUpdate().catch(() => {});
        }
      } catch (e2) {
        console.warn("⚠️ finder page update:", e2.message?.slice(0, 120));
        try { await interaction.deferUpdate(); } catch {}
      }
    }
    paginationMenus.set(uid, menu);
    return;
  }
  
  if (interaction.customId === "finderpanel_redeem") {
    if (isBlacklisted(interaction.user.id) && !isOwner(interaction.user.id)) {
      try { await interaction.deferUpdate(); } catch {}
      return;
    }
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
    
    if (isBlacklisted(uid) && !isOwner(uid)) {
      try { await interaction.deferUpdate(); } catch {}
      return;
    }
    
    const buyer = isOwner(uid) || await isBuyer(uid, interaction.member);
    if (!buyer) {
      const hasTag = await hasPrinceStatus(uid);
      if (!hasTag) {
        pendingTagRetry.set(String(uid), {
          content: "",
          channelId: String(interaction.channelId || ""),
          guildId: String(interaction.guildId || ""),
          messageId: String(interaction.message?.id || ""),
          at: Date.now(),
          fromPanel: true
        });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("tagcheck_" + uid)
            .setLabel("Check again")
            .setStyle(ButtonStyle.Success)
        );
        return interaction.reply({
          flags: IS_COMPONENTS_V2 | ((MessageFlags && MessageFlags.Ephemeral != null) ? MessageFlags.Ephemeral : 64),
          components: [{
            type: 17,
            accent_color: 0xED4245,
            components: [
              { type: 10, content: "## Server tag required\nWear the `FS` server tag, then click check again." },
              { type: 14, divider: true, spacing: SEPARATOR_SPACING_SMALL },
              row.toJSON()
            ]
          }]
        }).catch(() => {});
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

  
  if (interaction.customId === "scripanel_how") {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ content: "❌ owner only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const how = [
      "### How to use Script Panel",
      "**1.** Owner runs `/scripanel` in a channel to post this panel.",
      "**2.** Click **Update** → paste a **Pastefy URL** (from `.upload` / `.obf`) and/or upload **FILE** (script text).",
      "**3.** Every save is protected with **Prince Obfuscator** automatically.",
      "**4.** To remove the Pastefy URL only, set **Delete URL** to `yes` in the modal.",
      "**5.** Only the **owner** can use **How** / **Update** on this panel."
    ].join("\n");
    return interaction.reply({
      flags: IS_COMPONENTS_V2 | ((MessageFlags && MessageFlags.Ephemeral != null) ? MessageFlags.Ephemeral : 64),
      components: [{ type: 17, accent_color: RENAME_V2_ACCENT, components: [{ type: 10, content: how }] }]
    }).catch(() => {});
  }
if (interaction.customId === "scripanel_update") {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ content: "❌ owner only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const modal = new ModalBuilder()
      .setCustomId("scripanel_update_modal")
      .setTitle("Upload Lua file");
    const urlInput = new TextInputBuilder()
      .setCustomId("scripanel_url")
      .setLabel("Pastefy URL (optional)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("https://pastefy.app/XXXX/raw")
      .setRequired(false)
      .setMaxLength(400);
    const fileInput = new TextInputBuilder()
      .setCustomId("scripanel_file")
      .setLabel("Upload File — paste script source")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Paste one source file to obfuscate / update URL code...")
      .setRequired(false)
      .setMaxLength(4000);
    const delUrlInput = new TextInputBuilder()
      .setCustomId("scripanel_delete_url")
      .setLabel("Delete URL (type yes to remove Pastefy URL)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("yes / no")
      .setRequired(false)
      .setMaxLength(10);
    modal.addComponents(
      new ActionRowBuilder().addComponents(urlInput),
      new ActionRowBuilder().addComponents(fileInput),
      new ActionRowBuilder().addComponents(delUrlInput)
    );
    return interaction.showModal(modal).catch(() => {});
  }

  return;
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  try {
    if (interaction.customId === "finderpanel_redeem_modal") {
      const key = (interaction.fields.getTextInputValue("finderpanel_key") || "").trim();
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      const rec = keyStore.keys.find(k => k.key === key);
      if (!rec) { await interaction.editReply({ content: "❌ invalid key." }); return; }
      if (rec.redeemedBy) { await interaction.editReply({ content: "❌ already redeemed." }); return; }
      if (findActiveKeyForUser(interaction.user.id)) { await interaction.editReply({ content: "❌ you already got a key active." }); return; }
      if (rec.expiresAt && Date.now() > rec.expiresAt) { await interaction.editReply({ content: "❌ key expired." }); return; }
      rec.redeemedBy = interaction.user.id;
      rec.redeemedAt = Date.now();
      try { fs.writeFileSync(KEYS_FILE, JSON.stringify(keyStore, null, 2)); } catch {}
      try {
        const g = await client.guilds.fetch(GUILD_ID);
        const m = await g.members.fetch(interaction.user.id);
        await m.roles.add(BUYER_ROLE_ID);
      } catch {}
      await interaction.editReply({ content: "✅ key redeemed successfully." });
      return;
    }
    if (interaction.customId === "finderpanel_find_modal") {
      const query = (interaction.fields.getTextInputValue("finderpanel_query") || "").trim();
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      const isBuyerUser = isOwner(interaction.user.id) || await isBuyer(interaction.user.id, interaction.member);
      const tok = tryConsumeToken(interaction.user.id, isBuyerUser);
      if (!tok.ok && !isBuyerUser) {
        const leftMs = Math.max(0, (tok.waitUntil || getNextMidnightPHMs()) - Date.now());
        await interaction.editReply({ content: `❌ You need to wait **${formatTokenWait(leftMs)}**` });
        return;
      }
      const results = findFiles(query);
      if (!results.length) { await interaction.editReply({ content: "❌ no found." }); return; }
      const perPage = 8;
      const totalPages = Math.ceil(results.length / perPage);
      const pageItems = results.slice(0, perPage);
      const listLines = pageItems.map(f => `> \`${finderDisplayName(f.filename)}\` — ID: \`${f.id}\``);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(totalPages <= 1)
      );
      const v2 = buildFinderV2Payload({ listLines, pageLabel: `Pages 1/${totalPages}`, actionRow: row, ephemeral: true });
      const sent = await interaction.editReply({ ...v2, content: null });
      if (sent) paginationMenus.set(interaction.user.id, {
        results, page: 1, totalPages, messageId: sent.id,
        authorId: interaction.user.id, createdAt: Date.now(), isBuyer: isBuyerUser
      });
      return;
    }
    if (interaction.customId === "finderpanel_get_modal") {
      const raw = (interaction.fields.getTextInputValue("finderpanel_ids") || "").trim();
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      const isBuyerUser = isOwner(interaction.user.id) || await isBuyer(interaction.user.id, interaction.member);
      const tok = tryConsumeToken(interaction.user.id, isBuyerUser);
      if (!tok.ok && !isBuyerUser) {
        const leftMs = Math.max(0, (tok.waitUntil || getNextMidnightPHMs()) - Date.now());
        await interaction.editReply({ content: `❌ You need to wait **${formatTokenWait(leftMs)}**` });
        return;
      }
      const ids = raw.split(/[\s,]+/).filter(Boolean);
      const maxGet = isBuyerUser ? 10 : 1;
      if (!ids.length) { await interaction.editReply({ content: "❌ put an id." }); return; }
      if (ids.length > maxGet) { await interaction.editReply({ content: isBuyerUser ? "❌ max 10 id." : "❌ buy premium for multiple id." }); return; }
      const files = [];
      for (const id of ids) {
        const file = getFile(id);
        if (!file || !canGetLibraryFile(file, interaction.user.id)) continue;
        const freshUrl = await getFreshUrl(file);
        files.push({ attachment: freshUrl || file.url, name: file.filename || "file" });
      }
      if (!files.length) { await interaction.editReply({ content: "❌ wrong id." }); return; }
      await interaction.editReply({ content: "**Here you go!**", files });
      return;
    }

    if (interaction.customId === "scripanel_update_modal") {
      if (!isOwner(interaction.user.id)) {
        await interaction.reply({ content: "❌ owner only.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      try {
        const delUrlRaw = (interaction.fields.getTextInputValue("scripanel_delete_url") || "").trim().toLowerCase();
        const urlRaw = (interaction.fields.getTextInputValue("scripanel_url") || "").trim();
        const fileRaw = (interaction.fields.getTextInputValue("scripanel_file") || "").trim();

        
        if (delUrlRaw === "yes" || delUrlRaw === "y" || delUrlRaw === "delete") {
          scripanelStore.url = "";
          scripanelStore.updatedAt = Date.now();
          scripanelStore.updatedBy = interaction.user.id;
          saveScripanel();
          try {
            if (interaction.message) await interaction.message.edit(buildScripanelV2());
          } catch {}
          await interaction.editReply({ content: "✅ Pastefy URL removed from Script Panel." });
          return;
        }

        
        if (urlRaw && !isPastefyUrl(urlRaw)) {
          await interaction.editReply({ content: "❌ URL must be a **Pastefy** link from `.upload` or `.obf` (pastefy.app)." });
          return;
        }

        
        let source = fileRaw;
        if (!source && urlRaw) {
          source = await fetchTextFromUrl(urlRaw);
        }
        if (!source || !source.trim()) {
          await interaction.editReply({ content: "❌ put a Pastefy URL and/or Upload File (script text)." });
          return;
        }

        
        const protectedScript = obfuscateLua(source);
        if (urlRaw) scripanelStore.url = urlRaw;
        scripanelStore.script = protectedScript;
        scripanelStore.updatedAt = Date.now();
        scripanelStore.updatedBy = interaction.user.id;
        saveScripanel();
        try {
          if (interaction.message) await interaction.message.edit(buildScripanelV2());
        } catch {}
        const att = new AttachmentBuilder(Buffer.from(protectedScript, "utf8"), { name: "scripanel_protected.lua" });
        await interaction.editReply({
          content: "✅ Updated & protected with **Prince Obfuscator**." + (urlRaw ? "\nURL: " + urlRaw.slice(0, 150) : ""),
          files: [att]
        });
      } catch (e) {
        await interaction.editReply({ content: "❌ update failed: " + String(e.message || e).slice(0, 120) });
      }
      return;
    }

  } catch (e) {
    console.error("❌ modal:", e.message);
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: "❌ failed." });
      else await interaction.reply({ content: "❌ failed.", flags: MessageFlags.Ephemeral });
    } catch {}
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    
    if (interaction.commandName === "forward") {
      if (!canUseForward(interaction.user.id)) {
        await interaction.editReply({ content: "❌ owner / whitelist only." });
        return;
      }
      const sourceRaw = interaction.options.getString("source") || "";
      const destRaw = interaction.options.getString("destination") || "";
      const sourceId = parseChannelIdArg(sourceRaw);
      const destId = parseChannelIdArg(destRaw);
      if (!sourceId || !destId) {
        await interaction.editReply({ content: "❌ put valid source and destination channel IDs or links." });
        return;
      }
      let destCh = null;
      try { destCh = await client.channels.fetch(destId); } catch {}
      if (!destCh || !destCh.isTextBased?.()) {
        await interaction.editReply({ content: "❌ invalid destination channel (bot must be in that server)." });
        return;
      }
      let sourceCh = null;
      try { sourceCh = await client.channels.fetch(sourceId); } catch {}
      const useUserToken = !sourceCh || !sourceCh.isTextBased?.();
      if (useUserToken) {
        const ut = normalizeUserToken(config.userToken || "");
        if (!ut) {
          await interaction.editReply({ content: "❌ source channel not visible to bot. Owner must run `/login` first." });
          return;
        }
        try {
          await userDiscordApi("/channels/" + sourceId);
        } catch (e1) {
          try {
            await userFetchChannelMessages(sourceId, 1);
          } catch (e2) {
            await interaction.editReply({
              content: "❌ invalid source channel id (user token cannot access it): " + String(e2.message || e1.message || e2).slice(0, 120)
            });
            return;
          }
        }
      }
      await interaction.editReply({
        content: `⚡ Forwarding from \`${sourceId}\` → <#${destCh.id}>${useUserToken ? " (via user token)" : ""}...`
      });
      startForwardJob({
        sourceId,
        destId,
        sourceCh,
        destCh,
        useUserToken,
        statusEdit: async (content) => {
          try {
            await interaction.editReply({ content: String(content).slice(0, 1900) });
          } catch {
            try { await interaction.channel?.send({ content: String(content).slice(0, 1900) }); } catch {}
          }
        }
      });
      return;
    }

    if (!isOwner(interaction.user.id)) {
      await interaction.editReply({ content: "❌ owner only." });
      return;
    }
    if (interaction.commandName === "say") {
      const text = interaction.options.getString("text");
      const type = interaction.options.getString("type") || "good";
      const title = interaction.options.getString("title");
      const footer = interaction.options.getString("footer");
      const colorRaw = (interaction.options.getString("color") || "").trim();
      const imageAtt = interaction.options.getAttachment("image");
      const fileAtt = interaction.options.getAttachment("file");
      await interaction.deleteReply().catch(() => {});
      const targetChannel = interaction.channel || interaction.user.dmChannel || await interaction.user.createDM().catch(() => null);
      if (!targetChannel) {
        await interaction.followUp({ content: "❌ can't send message here.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (type === "none") {
        const noneFiles = [];
        if (imageAtt?.url) noneFiles.push({ attachment: imageAtt.url, name: imageAtt.name || "image.png" });
        if (fileAtt?.url) noneFiles.push({ attachment: fileAtt.url, name: fileAtt.name || "file" });
        if (noneFiles.length) await targetChannel.send({ content: text, files: noneFiles });
        else await targetChannel.send({ content: text });
      } else if (type === "v2") {
        let color = RENAME_V2_ACCENT;
        if (colorRaw) {
          const named = { blurple: BLURPLE, gray: GRAY_COLOR, grey: GRAY_COLOR, red: 0xED4245, green: 0x57F287, yellow: 0xF1C40F, black: REGULAR_COLOR };
          const key = colorRaw.toLowerCase().replace(/^#/, "");
          if (named[colorRaw.toLowerCase()]) color = named[colorRaw.toLowerCase()];
          else if (/^[0-9a-fA-F]{6}$/.test(key)) color = parseInt(key, 16);
        }
        let body = String(text || "");
        if (title) body = "### " + String(title).slice(0, 200) + "\n" + body;
        if (footer) body = body + "\n\n-# " + String(footer).slice(0, 200);
        const v2Children = [{ type: 10, content: body.slice(0, 4000) }];
        const files = [];
        if (imageAtt?.url) {
          v2Children.push({ type: 14, divider: true, spacing: SEPARATOR_SPACING_SMALL });
          const imgName = (imageAtt.name || "image.png").replace(/[^\w.\-]+/g, "_");
          files.push({ attachment: imageAtt.url, name: imgName });
          v2Children.push({ type: 12, items: [{ media: { url: "attachment://" + imgName } }] });
        }
        if (fileAtt?.url) {
          
          const fName = (fileAtt.name || "file").replace(/[^\w.\-]+/g, "_");
          files.push({ attachment: fileAtt.url, name: fName });
          v2Children.push({ type: 13, file: { url: "attachment://" + fName } });
        }
        await targetChannel.send({
          flags: IS_COMPONENTS_V2,
          files: files.length ? files : undefined,
          components: [{ type: 17, accent_color: color, components: v2Children }]
        });
      } else {
        let color = BLURPLE;
        if (colorRaw) {
          const named = { blurple: BLURPLE, gray: GRAY_COLOR, grey: GRAY_COLOR, red: 0xED4245, green: 0x57F287, yellow: 0xF1C40F, black: REGULAR_COLOR };
          const key = colorRaw.toLowerCase().replace(/^#/, "");
          if (named[colorRaw.toLowerCase()]) color = named[colorRaw.toLowerCase()];
          else if (/^[0-9a-fA-F]{6}$/.test(key)) color = parseInt(key, 16);
        }
        const embed = new EmbedBuilder().setColor(color).setDescription(text);
        if (title) embed.setTitle(title);
        if (footer) embed.setFooter({ text: footer });
        if (imageAtt?.url) embed.setImage(imageAtt.url);
        const embFiles = [];
        if (fileAtt?.url) embFiles.push({ attachment: fileAtt.url, name: fileAtt.name || "file" });
        await targetChannel.send({ embeds: [embed], files: embFiles.length ? embFiles : undefined });
      }
      return;
    }
    if (interaction.commandName === "finderpanel") {
      const targetChannel = interaction.channel;
      if (!targetChannel || !targetChannel.isTextBased?.()) {
        await interaction.editReply({ content: "❌ use this in a text channel." });
        return;
      }
      const panelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("finderpanel_find").setLabel("Find").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("finderpanel_get").setLabel("Get").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("finderpanel_redeem").setLabel("Redeem").setStyle(ButtonStyle.Secondary)
      );
      await targetChannel.send({
        flags: IS_COMPONENTS_V2,
        components: [{
          type: 17,
          accent_color: FINDER_V2_ACCENT,
          components: [
            { type: 10, content: "## Finder Panel\nThis control panel is for **Finder Panel**.\nIf you’re using server tag click the button below or if you got a key click the redeem." },
            { type: 14, spacing: SEPARATOR_SPACING_SMALL },
            panelRow.toJSON()
          ]
        }]
      });
      await interaction.editReply({ content: "Posted..." });
      return;
    }
    
    if (interaction.commandName === "login") {
      if (!isOwner(interaction.user.id)) {
        await interaction.editReply({ content: "❌ owner only." });
        return;
      }
      const raw = (interaction.options.getString("token") || "").trim();
      if (!raw) {
        await interaction.editReply({ content: "❌ put a token." });
        return;
      }
      try {
        const normalized = normalizeUserToken(raw);
        const me = await verifyUserToken(normalized);
        config.userToken = normalized;
        saveConfig();
        const tag = me.username
          ? (me.discriminator && me.discriminator !== "0" ? `${me.username}#${me.discriminator}` : me.username)
          : "unknown";
        await interaction.editReply({
          content: "✅ Logged in as **" + tag + "** (`" + me.id + "`).\nUser token saved — bot can forward/fetch where this account is present."
        });
      } catch (e) {
        await interaction.editReply({ content: "❌ login failed: " + String(e.message || e).slice(0, 150) });
      }
      return;
    }
    if (interaction.commandName === "blacklist") {
      const mode = (interaction.options.getString("mode") || "").toLowerCase();
      const targetUser = interaction.options.getUser("user");
      if (mode === "list") {
        const list = blacklistList();
        if (!list.length) { await interaction.editReply({ content: "📋 Blacklist is empty." }); return; }
        const lines = list.slice(0, 50).map((id, i) => `${i + 1}. <@${id}> (\`${id}\`)`);
        await interaction.editReply({ content: `📋 **Blacklist (${list.length}):**\n${lines.join("\n")}` });
        return;
      }
      if (!targetUser) { await interaction.editReply({ content: "❌ pick a user for Add/Remove." }); return; }
      if (isOwner(targetUser.id)) { await interaction.editReply({ content: "❌ can't blacklist the owner." }); return; }
      if (mode === "add") {
        const ok = blacklistAdd(targetUser.id);
        await interaction.editReply({ content: ok ? `✅ blacklisted <@${targetUser.id}>.` : `⚠️ already blacklisted.` });
        return;
      }
      if (mode === "remove") {
        const ok = blacklistRemove(targetUser.id);
        await interaction.editReply({ content: ok ? `✅ removed <@${targetUser.id}>.` : `⚠️ was not blacklisted.` });
        return;
      }
      await interaction.editReply({ content: "❌ mode must be Add, Remove, or List." });
      return;
    }
    if (interaction.commandName === "whitelist") {
      const mode = (interaction.options.getString("mode") || "").toLowerCase();
      const targetUser = interaction.options.getUser("user");
      const idOrName = (interaction.options.getString("id") || "").trim();
      if (mode === "list") {
        const list = whitelistList();
        if (!list.length) { await interaction.editReply({ content: "📋 Whitelist is empty." }); return; }
        const lines = list.slice(0, 50).map((id, i) => `${i + 1}. <@${id}> (\`${id}\`)`);
        await interaction.editReply({ content: `📋 **Whitelist (${list.length}):**\n${lines.join("\n")}` });
        return;
      }
      let targetId = targetUser?.id || null;
      let label = targetUser ? `<@${targetUser.id}>` : null;
      if (!targetId && idOrName) {
        if (/^\d{17,20}$/.test(idOrName)) {
          targetId = idOrName;
          label = `<@${targetId}> (\`${targetId}\`)`;
        } else {
          const name = idOrName.replace(/^@/, "").toLowerCase();
          let found = client.users.cache.find(u =>
            u.username?.toLowerCase() === name ||
            u.globalName?.toLowerCase() === name ||
            `${u.username}`.toLowerCase() === name
          );
          if (!found && interaction.guild) {
            try {
              const members = await interaction.guild.members.fetch({ query: idOrName, limit: 5 }).catch(() => null);
              if (members?.size) {
                const m = members.find(mm =>
                  mm.user.username?.toLowerCase() === name ||
                  mm.user.globalName?.toLowerCase() === name ||
                  mm.displayName?.toLowerCase() === name
                ) || members.first();
                if (m) found = m.user;
              }
            } catch {}
          }
          if (found) {
            targetId = found.id;
            label = `<@${found.id}> (\`${found.username}\`)`;
          }
        }
      }
      if (!targetId) {
        await interaction.editReply({ content: "❌ pick a user or put an ID / username." });
        return;
      }
      if (isOwner(targetId)) {
        await interaction.editReply({ content: "❌ owner is always allowed — no need to whitelist." });
        return;
      }
      if (mode === "add") {
        const ok = whitelistAdd(targetId);
        await interaction.editReply({ content: ok ? `✅ whitelisted ${label} — can use \`.forward\`.` : `⚠️ already whitelisted.` });
        return;
      }
      if (mode === "remove") {
        const ok = whitelistRemove(targetId);
        await interaction.editReply({ content: ok ? `✅ removed ${label} from whitelist.` : `⚠️ was not on whitelist.` });
        return;
      }
      await interaction.editReply({ content: "❌ mode must be Add, Remove, or List." });
      return;
    }
  } catch (e) {
    console.error("❌ slash:", e.message);
    try {
      const msg = { content: "❌ An error occurred: " + String(e?.message || e).slice(0, 150), flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    } catch {}
  }
});

client.on("messageCreate", async msg => {
  try {
    if (!msg || msg.author?.bot) return;

    
    try {
      const liveIds = (config.liveScanChannelIds || []).map(String);
      if (liveIds.includes(String(msg.channelId))) {
        const n = indexMessageFiles(msg);
        if (n > 0) console.log(`📡 LiveScan +${n} file(s) in #${msg.channel?.name || msg.channelId}`);
      }
    } catch {}

    const raw = String(msg.content || "");
    const txt = raw.trim();
    if (!txt.startsWith(".")) return;
    
    try {
      const cmdName = (txt.slice(1).split(/\s+/)[0] || "").toLowerCase();
      if (cmdName && cmdName !== "leaderboard") trackCommandUse(msg.author);
    } catch {}

    const isDM = !msg.guild;

  
  if (/^\.help(?:\s|$)/i.test(txt)) {
    const page = 0;
    helpSessions.set(msg.author.id, page);
    const v2 = buildHelpV2(page, msg.author.id);
    replyComponentsV2(msg, v2, { mention: false }).catch(() => {});
    return;
  }

  
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

  
  if (/^\.removekey(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const key = txt.replace(/^\.removekey\s+/i, "").trim();
    if (!key) { replyUser(msg, "❌ usage: \`.removekey <key>\`").catch(() => {}); return; }
    const rec = keyStore.keys.find(k => k.key === key);
    if (!rec) { replyUser(msg, "❌ key not found.").catch(() => {}); return; }
    const redeemedBy = rec.redeemedBy;
    keyStore.keys = keyStore.keys.filter(k => k.key !== key);
    const tmp = `${KEYS_FILE}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(keyStore, null, 2)); fs.renameSync(tmp, KEYS_FILE); } catch {}
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
  
  
  
  if (/^\.altlist(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    
    
    const targetArg = txt.split(/\s+/)[1]?.trim();
    let targetUserId = null;
    if (targetArg) {
      const mentionMatch = targetArg.match(/<@!?(\d+)>/);
      if (mentionMatch) targetUserId = mentionMatch[1];
      else if (/^\d+$/.test(targetArg)) targetUserId = targetArg;
    }
    
    
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
    
    const loadingMsg = await replyUser(msg, "🔍 Scanning server for suspicious accounts...").catch(() => {});
    
    try {
      try {
        await msg.guild.members.fetch().catch(async (e) => {
          const retryMatch = e?.message?.match(/Retry after ([\d.]+) seconds?/);
          const waitSec = retryMatch ? parseFloat(retryMatch[1]) + 1 : 12;
          console.log(`⚠️ Altlist rate limited, waiting ${waitSec}s...`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
          try { await msg.guild.members.fetch(); } catch {}
        });
      } catch {}
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
        
        const created = member.user.createdTimestamp;
        const ageDays = (now - created) / (24 * 60 * 60 * 1000);
        if (ageDays < 7) { score += 40; flags.push(`🕐 **${ageDays.toFixed(0)} days old**`); }
        else if (ageDays < 30) { score += 20; flags.push(`🕐 ${ageDays.toFixed(0)} days old`); }
        
        const joined = member.joinedTimestamp;
        if (joined) {
          const joinDays = (now - joined) / (24 * 60 * 60 * 1000);
          if (joinDays < 3) { score += 15; flags.push(`🆕 Joined ${joinDays.toFixed(0)}d ago`); }
        }
        
        if (!member.user.avatar) { score += 20; flags.push("👤 No avatar"); }
        
        const nonEveryoneRoles = member.roles.cache.filter(r => r.id !== msg.guild.id);
        if (nonEveryoneRoles.size === 0) { score += 15; flags.push("🎭 No roles"); }
        
        const uname = member.user.username;
        const numMatch = uname.match(/(\d{3,})$/);
        if (numMatch && numMatch[1].length >= 4) { score += 10; flags.push(`🔢 Numbers in name`); }
        
        if (member.displayName === uname && !member.user.avatar) { score += 5; }
        
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
      
      suspicious.sort((a, b) => b.score - a.score);
      
      if (loadingMsg) await loadingMsg.delete().catch(() => {});
      
      if (suspicious.length === 0) {
        replyUser(msg, "✅ No suspicious accounts found bro, server looks clean.").catch(() => {});
        return;
      }
      
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
  if (/^\.set(?:\s|$)/i.test(txt)) {
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
  
  
  
  
  if (/^\.livescan(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (!Array.isArray(config.liveScanChannelIds)) config.liveScanChannelIds = [];
    const args = txt.split(/\s+/).slice(1);
    const sub = (args[0] || "").toLowerCase();

    
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

    
    const idSet = new Set();
    for (const m of txt.matchAll(/<#(\d{17,20})>/g)) idSet.add(m[1]);
    for (const a of args) {
      const pure = String(a || "").replace(/[<#>]/g, "").trim();
      if (/^\d{17,20}$/.test(pure)) idSet.add(pure);
    }
    if (!idSet.size) {
      replyUser(msg, "❌ usage: `.livescan <channel id|#channel> [more...]`\nAlso: `.livescan list` · `.livescan off [id]`").catch(() => {});
      return;
    }

    const added = [];
    const skipped = [];
    const failed = [];
    for (const chId of idSet) {
      let ch = null;
      try { ch = await client.channels.fetch(chId); } catch {}
      if (!ch || !ch.isTextBased?.()) {
        failed.push(chId);
        continue;
      }
      const idStr = String(ch.id);
      if (config.liveScanChannelIds.map(String).includes(idStr)) {
        skipped.push(`<#${idStr}>`);
        continue;
      }
      config.liveScanChannelIds.push(idStr);
      added.push(`<#${idStr}>`);
    }
    saveConfig();
    const parts = [];
    if (added.length) parts.push(`📡 **LiveScan ON** (${added.length}): ${added.join(", ")}`);
    if (skipped.length) parts.push(`ℹ️ already watching: ${skipped.join(", ")}`);
    if (failed.length) parts.push(`❌ invalid: ${failed.map(id => `\`${id}\``).join(", ")}`);
    if (!parts.length) parts.push("❌ nothing changed.");
    parts.push(`Total live channels: **${config.liveScanChannelIds.length}**`);
    replyUser(msg, parts.join("\n")).catch(() => {});
    return;
  }
  
  
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
  
  
  
  
  
  if (/^\.extract(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    let attachments = await attachmentsFromMsgOrReply(msg, a => isZipFile(a.name, a.contentType) || isHtmlFile(a.name, a.contentType));
    if (!attachments.length) { replyUser(msg, "❌ upload a .zip or .html file or reply to one, dumbass.").catch(() => {}); return; }
    const sourceFile = attachments[0];
    const maxInfo = getMaxFileSize(msg.guild);
    if (sourceFile.size > maxInfo.size) { replyUser(msg, `❌ max file is ${maxInfo.label}, lol.`).catch(() => {}); return; }
    const sentMsg = await replyUser(msg, "⏳ Processing...").catch(() => {});
    try {
      const buf = await downloadURL(sourceFile.url);
      let files;
      if (isHtmlFile(sourceFile.name, sourceFile.contentType)) {
        
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
    let attachments = await getScriptAttachmentsFromMsgOrReply(msg);
    if (!attachments.length) { replyUser(msg, "❌ upload a txt or lua file, dumbass.").catch(() => {}); return; }
    const file = attachments[0];
    const maxUploadSize = isBuyerUser ? 25 * 1024 * 1024 : 200 * 1024;
    const maxUploadLabel = isBuyerUser ? "25MB" : "200KB";
    if (file.size > maxUploadSize) { replyUser(msg, `❌ max is ${maxUploadLabel} lol.`).catch(() => {}); return; }
    const savedTokLine = pendingTokenLine.get(String(msg.author.id)) || "";
    pendingTokenLine.delete(String(msg.author.id));
    const sentMsg = await sendUploadLoading(msg).catch(() => null);
    try {
      let content = null;
      for (const u of [...new Set([file.url, file.proxyURL, file.proxy_url].filter(Boolean))]) {
        try {
          const res = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" });
          if (res.ok) {
            content = await res.text();
            if (content && content.trim()) break;
          }
        } catch {}
      }
      if (!content) throw new Error("could not read file from reply/attachment");
      const apiKey = process.env.PASTEFY_API_KEY;
      if (!apiKey) throw new Error("PASTEFY_API_KEY not set in env vars");
      const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };
      const body = { title: file.name || "script.lua", content };
      let pastefyRes = await fetch("https://pastefy.app/api/v2/paste", { method: "POST", headers, body: JSON.stringify(body) });
      let rawUrl = null;
      if (pastefyRes.ok) {
        try {
          const data = await pastefyRes.json();
          const pid = data?.id || data?._id || data?.paste?.id;
          if (pid) rawUrl = `https://pastefy.app/${pid}/raw`;
        } catch {}
      }
      if (!rawUrl) {
        const v1Res = await fetch("https://pastefy.app/api/v1/paste", { method: "POST", headers, body: JSON.stringify(body) });
        if (v1Res.ok) {
          try {
            const data = await v1Res.json();
            const pid = data?.id || data?._id || data?.paste?.id;
            if (pid) rawUrl = `https://pastefy.app/${pid}/raw`;
          } catch {}
        }
      }
      if (!rawUrl) throw new Error("Could not get paste URL from Pastefy");
      const loadstring = `loadstring(game:HttpGet("${rawUrl}"))()`;
      if (sentMsg) await sentMsg.delete().catch(() => {});
      if (savedTokLine) pendingTokenLine.set(String(msg.author.id), savedTokLine);
      await sendUploadResult(msg, { loadstring, tokLine: isBuyerUser ? "" : savedTokLine }).catch(() => {});
      pendingTokenLine.delete(String(msg.author.id));
    } catch (e) {
      if (sentMsg) await sentMsg.delete().catch(() => {});
      replyUser(msg, `❌ upload failed: ${String(e.message || e).slice(0, 120)}`).catch(() => {});
    }
    return;
  }

  if (/^\.(?:clean|cl)$/i.test(txt)) {
    const perm = await checkRegularPermission(msg, false);
    if (!perm.allowed) {
      if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return;
    }
    if (!perm.isBuyer && !isOwner(msg.author.id)) {
      await sendInputErrorV2(msg, "Buy a Premium on https://discord.com/channels/1509484518766018711/1561710834344923247 — to use this command or use command in DMs.").catch(() => {});
      return;
    }
    const cd = checkCommandCooldown(msg.author.id, "clean", perm.isBuyer);
    if (cd.onCooldown) {
      if (cd.noTokens) { replyNoTokens(msg, cd.waitUntil).catch(() => {}); return; }
      replyUser(msg, `❌ you're on ${cd.remaining} cooldown.`).catch(() => {}); return;
    }

    let files = await getScriptAttachmentsFromMsgOrReply(msg);
    if (files.length > 10) files = files.slice(0, 10);

    if (!files.length) {
      let resolved = null;
      try { resolved = await resolveScriptInput(msg, txt); } catch (e) {
        await sendRenameInputError(msg, `Couldn't read source: ${String(e.message || e).slice(0, 100)}`);
        return;
      }
      if (!resolved?.content || resolved.content.trim().length < 5) {
        await sendRenameInputError(msg, "**Tips:**\n- Attach a `.lua`, `.luau`, or `.txt` file, or provide a URL, or a code block, or reply / forward a sample.");
        return;
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("clean_v1_" + msg.author.id).setLabel("Clean V1").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("clean_v2_" + msg.author.id).setLabel("Clean V2").setStyle(ButtonStyle.Success)
      );
      try {
        const panelMsg = await replyComponentsV2(msg, {
          flags: IS_COMPONENTS_V2,
          components: [{
            type: 17,
            accent_color: RENAME_V2_ACCENT,
            components: [
              { type: 10, content: "### Choose Clean Version\nSelect a clean version below." },
              { type: 14, divider: true, spacing: SEPARATOR_SPACING_SMALL },
              row.toJSON()
            ]
          }]
        }, { mention: false });
        if (panelMsg?.id) {
          cleanSessions.set(panelMsg.id, { authorId: msg.author.id, content: String(resolved.content), at: Date.now() });
        }
      } catch (e) {
        await sendRenameInputError(msg, `Failed: ${String(e.message || e).slice(0, 120)}`);
      }
      return;
    }

    if (files.length === 1) {
      const body = await downloadAttachmentText(files[0]);
      if (!body) {
        await sendRenameInputError(msg, "Couldn't read that file (link expired or invalid). Re-upload it and try again.");
        return;
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("clean_v1_" + msg.author.id).setLabel("Clean V1").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("clean_v2_" + msg.author.id).setLabel("Clean V2").setStyle(ButtonStyle.Success)
      );
      try {
        const panelMsg = await replyComponentsV2(msg, {
          flags: IS_COMPONENTS_V2,
          components: [{
            type: 17,
            accent_color: RENAME_V2_ACCENT,
            components: [
              { type: 10, content: "### Choose Clean Version\nSelect a clean version below." },
              { type: 14, divider: true, spacing: SEPARATOR_SPACING_SMALL },
              row.toJSON()
            ]
          }]
        }, { mention: false });
        if (panelMsg?.id) {
          cleanSessions.set(panelMsg.id, { authorId: msg.author.id, content: body, at: Date.now() });
        }
      } catch (e) {
        await sendRenameInputError(msg, `Failed: ${String(e.message || e).slice(0, 120)}`);
      }
      return;
    }

    try {
      const panelMsg = await sendFilePickPanel(msg, {
        prefix: "cleanfile",
        userId: msg.author.id,
        files,
        listLabel: "clean"
      });
      if (panelMsg?.id) {
        cleanSessions.set(panelMsg.id, {
          authorId: msg.author.id,
          files: files.map(f => ({
            name: f.name || f.filename || "file",
            url: f.url,
            proxyURL: f.proxyURL || f.proxy_url,
            proxy_url: f.proxy_url || f.proxyURL
          })),
          at: Date.now()
        });
        if (cleanSessions.size > 80) {
          const cutoff = Date.now() - 30 * 60 * 1000;
          for (const [k, v] of cleanSessions) {
            if (!v?.at || v.at < cutoff) cleanSessions.delete(k);
          }
        }
      }
    } catch (e) {
      await sendRenameInputError(msg, `Failed: ${String(e.message || e).slice(0, 120)}`);
    }
    return;
  }

  if (/^\.detect(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg, false);
    if (!perm.allowed) {
      if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return;
    }
    const cd = checkCommandCooldown(msg.author.id, "detect", perm.isBuyer);
    if (cd.onCooldown) {
      if (cd.noTokens) { replyNoTokens(msg, cd.waitUntil).catch(() => {}); return; }
      replyUser(msg, `❌ you're on ${cd.remaining} cooldown.`).catch(() => {}); return;
    }

    let files = await getScriptAttachmentsFromMsgOrReply(msg);
    if (files.length > 10) files = files.slice(0, 10);

    const runDetect = async (code) => {
      const loadingPayload = {
        flags: IS_COMPONENTS_V2,
        components: [{
          type: 17,
          accent_color: RENAME_V2_ACCENT,
          components: [{ type: 10, content: "### Detecting...\n⏳ Processing..." }]
        }]
      };
      const loadingMsg = await replyComponentsV2(msg, loadingPayload, { mention: false }).catch(() => null);
      try {
        if (!code || !String(code).trim()) throw new Error("could not read file");
        const result = detectThreatAnalysis(code);
        let body =
          `## Detected: ${result.title}\n` +
          (result.line != null ? `**Line: ${result.line}**\n` : "") +
          `-# What it does:\n\n` +
          "```" + result.description + "```";
        if (loadingMsg) await loadingMsg.delete().catch(() => {});
        pendingTokenLine.delete(String(msg.author.id));
        await replyComponentsV2(msg, {
          flags: IS_COMPONENTS_V2,
          components: [{
            type: 17,
            accent_color: result.color,
            components: [{ type: 10, content: body.slice(0, 3900) }]
          }]
        }, { mention: false }).catch(() => {});
      } catch (e) {
        if (loadingMsg) await loadingMsg.delete().catch(() => {});
        await sendInputErrorV2(msg, `Failed: ${String(e.message || e).slice(0, 120)}`).catch(() => {});
      }
    };

    if (!files.length) {
      let resolved = null;
      try { resolved = await resolveScriptInput(msg, txt); } catch (e) {
        await sendInputErrorV2(msg, `Couldn't read source: ${String(e.message || e).slice(0, 100)}`).catch(() => {});
        return;
      }
      if (!resolved?.content) {
        await sendInputErrorV2(msg, "**Tips:**\n- Attach a `.lua`, `.luau`, or `.txt` file, or provide a URL, or a code block, or reply / forward a sample.").catch(() => {});
        return;
      }
      await runDetect(resolved.content);
      return;
    }

    if (files.length === 1) {
      const body = await downloadAttachmentText(files[0]);
      if (!body) {
        await sendInputErrorV2(msg, "Couldn't read that file (link expired or invalid).").catch(() => {});
        return;
      }
      await runDetect(body);
      return;
    }

    // multi-file: pick first for simplicity (or run on all sequentially)
    try {
      const panelMsg = await sendFilePickPanel(msg, {
        prefix: "detectfile",
        userId: msg.author.id,
        files,
        listLabel: "detect"
      });
      if (panelMsg?.id) {
        detectSessions.set(panelMsg.id, {
          authorId: msg.author.id,
          files: files.map(f => ({
            name: f.name || f.filename || "file",
            url: f.url,
            proxyURL: f.proxyURL || f.proxy_url,
            proxy_url: f.proxy_url || f.proxyURL
          })),
          at: Date.now()
        });
      }
    } catch (e) {
      await sendInputErrorV2(msg, `Failed: ${String(e.message || e).slice(0, 120)}`).catch(() => {});
    }
    return;
  }

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
    if (!args.length) { await sendInputErrorV2(msg, "**Tips:**\n- Try to find available ID or maybe the ID you put is no longer available.\n- Put the ID that working.\n- Buy a premium in https://discord.com/channels/1509484518766018711/1561710834344923247 — so you can use mutiple ID.").catch(() => {}); return; }
    const maxGetIds = isBuyerUser ? 10 : 1;
    if (args.length > maxGetIds) {
      if (isBuyerUser) {
        replyUser(msg, "❌ max 10 id only, dumbass.").catch(() => {});
      } else {
        await sendInputErrorV2(msg, "**Tips:**\n- Try to find available ID or maybe the ID you put is no longer available.\n- Put the ID that working.\n- Buy a premium in https://discord.com/channels/1509484518766018711/1561710834344923247 — so you can use mutiple ID.").catch(() => {});
      }
      return;
    }
    const filesToSend = [];
    const notFound = [];
    for (const id of args) {
      const file = getFile(id);
      if (!file) { notFound.push(id); continue; }
      if (!canGetLibraryFile(file, msg.author.id)) {
        notFound.push(id);
        continue;
      }
      const freshUrl = await getFreshUrl(file);
      filesToSend.push({ attachment: freshUrl || file.url, name: file.filename || "file" });
    }
    if (!filesToSend.length) {
      await sendInputErrorV2(msg, "**Tips:**\n- Try to find available ID or maybe the ID you put is no longer available.\n- Put the ID that working.\n- Buy a premium in https://discord.com/channels/1509484518766018711/1561710834344923247 — so you can use mutiple ID.").catch(() => {});
      return;
    }
    
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
  
  
  if (/^\.copy(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const ids = txt.match(/\d{17,20}/g) || [];
    if (ids.length < 2) {
      replyUser(msg, "❌ usage: `.copy <source_server_id> <dest_server_id>`").catch(() => {});
      return;
    }
    const [srcId, dstId] = ids;
    if (srcId === dstId) {
      replyUser(msg, "❌ source and dest must be different servers.").catch(() => {});
      return;
    }
    let srcGuild, dstGuild;
    try { srcGuild = await client.guilds.fetch(srcId); } catch {}
    try { dstGuild = await client.guilds.fetch(dstId); } catch {}
    if (!srcGuild) { replyUser(msg, "❌ invalid source server id (bot must be in that server).").catch(() => {}); return; }
    if (!dstGuild) { replyUser(msg, "❌ invalid dest server id (bot must be in that server).").catch(() => {}); return; }

    const statusMsg = await replyUser(msg, `⏳ Copying **${srcGuild.name}** → **${dstGuild.name}**...`).catch(() => {});
    try {
      const me = await dstGuild.members.fetchMe().catch(() => dstGuild.members.me);
      if (!me?.permissions?.has?.(PermissionFlagsBits.Administrator) && !me?.permissions?.has?.(PermissionFlagsBits.ManageChannels)) {
        throw new Error("bot needs Manage Channels / Admin on dest server");
      }

      
      const roleMap = new Map(); 
      roleMap.set(srcGuild.id, dstGuild.roles.everyone);
      const srcRoles = [...srcGuild.roles.cache.values()]
        .filter(r => r.id !== srcGuild.id && !r.managed)
        .sort((a, b) => a.position - b.position);
      let rolesOk = 0;
      for (const r of srcRoles) {
        try {
          const created = await dstGuild.roles.create({
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            mentionable: r.mentionable,
            permissions: r.permissions,
            reason: `copy from ${srcGuild.id} by ${msg.author.id}`
          });
          roleMap.set(r.id, created);
          rolesOk++;
        } catch (e) {
          console.warn("⚠️ copy role", r.name, e.message);
        }
      }

      
      const chMap = new Map(); 
      const allCh = [...srcGuild.channels.cache.values()].sort((a, b) => {
        const ap = a.parentId ? 1 : 0;
        const bp = b.parentId ? 1 : 0;
        if (ap !== bp) return ap - bp; 
        return (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0);
      });

      const mapOverwrites = (overwrites) => {
        const out = [];
        for (const ow of overwrites?.cache?.values?.() || overwrites || []) {
          try {
            const target = ow.id === srcGuild.id
              ? dstGuild.id
              : (roleMap.get(ow.id)?.id || null);
            
            if (!target) continue;
            out.push({
              id: target,
              allow: ow.allow?.bitfield ?? ow.allow,
              deny: ow.deny?.bitfield ?? ow.deny,
              type: 0 
            });
          } catch {}
        }
        return out;
      };

      let catsOk = 0, chOk = 0;
      
      for (const ch of allCh) {
        if (ch.type !== ChannelType.GuildCategory) continue;
        try {
          const created = await dstGuild.channels.create({
            name: ch.name,
            type: ChannelType.GuildCategory,
            position: ch.rawPosition ?? ch.position,
            permissionOverwrites: mapOverwrites(ch.permissionOverwrites),
            reason: `copy from ${srcGuild.id}`
          });
          chMap.set(ch.id, created);
          catsOk++;
        } catch (e) {
          console.warn("⚠️ copy category", ch.name, e.message);
        }
      }
      
      for (const ch of allCh) {
        if (ch.type === ChannelType.GuildCategory) continue;
        try {
          const parent = ch.parentId ? chMap.get(ch.parentId) : null;
          const opts = {
            name: ch.name,
            type: ch.type,
            topic: ch.topic || undefined,
            nsfw: !!ch.nsfw,
            rateLimitPerUser: ch.rateLimitPerUser || undefined,
            bitrate: ch.bitrate || undefined,
            userLimit: ch.userLimit || undefined,
            parent: parent?.id,
            position: ch.rawPosition ?? ch.position,
            permissionOverwrites: mapOverwrites(ch.permissionOverwrites),
            reason: `copy from ${srcGuild.id}`
          };
          
          if (![
            ChannelType.GuildText,
            ChannelType.GuildVoice,
            ChannelType.GuildAnnouncement,
            ChannelType.GuildStageVoice,
            ChannelType.GuildForum
          ].includes(ch.type) && ch.type !== 0 && ch.type !== 2 && ch.type !== 5) {
            
          }
          const created = await dstGuild.channels.create(opts);
          chMap.set(ch.id, created);
          chOk++;
        } catch (e) {
          console.warn("⚠️ copy channel", ch.name, e.message);
        }
      }

      if (statusMsg) {
        await statusMsg.edit(
          `✅ **Copy done**\n` +
          `**From:** ${srcGuild.name} (\`${srcId}\`)\n` +
          `**To:** ${dstGuild.name} (\`${dstId}\`)\n` +
          `Roles: **${rolesOk}** · Categories: **${catsOk}** · Channels: **${chOk}**`
        ).catch(() => {});
      } else {
        replyUser(msg, `✅ copy done — roles ${rolesOk}, cats ${catsOk}, channels ${chOk}`).catch(() => {});
      }
    } catch (e) {
      if (statusMsg) await statusMsg.edit(`❌ copy failed: ${e.message.slice(0, 150)}`).catch(() => {});
      else replyUser(msg, `❌ copy failed: ${e.message.slice(0, 150)}`).catch(() => {});
    }
    return;
  }

  
  if (/^\.renew(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) return;
    if (!msg.guild || !msg.channel || msg.channel.isDMBased?.()) return;
    const ch = msg.channel;
    if (!ch.isTextBased?.() || ch.isThread?.()) return;
    try {
      const parentId = ch.parentId || null;
      
      const siblings = [...msg.guild.channels.cache.values()]
        .filter(c => !c.isThread?.() && (c.parentId || null) === parentId)
        .sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0));
      const siblingIndex = Math.max(0, siblings.findIndex(c => c.id === ch.id));
      const savedPosition = ch.position ?? ch.rawPosition ?? siblingIndex;
      const savedRaw = ch.rawPosition ?? ch.position ?? siblingIndex;

      const overwrites = [...(ch.permissionOverwrites?.cache?.values?.() || [])].map(po => ({
        id: po.id,
        type: po.type,
        allow: po.allow?.bitfield ?? po.allow,
        deny: po.deny?.bitfield ?? po.deny
      }));

      const cloned = await ch.clone({
        name: ch.name,
        reason: `renew:${msg.author.id}`
      });

      
      try {
        const edit = {};
        if (parentId) edit.parent = parentId;
        if (ch.topic != null) edit.topic = ch.topic;
        if (typeof ch.nsfw === "boolean") edit.nsfw = ch.nsfw;
        if (typeof ch.rateLimitPerUser === "number") edit.rateLimitPerUser = ch.rateLimitPerUser;
        if (overwrites.length) edit.permissionOverwrites = overwrites;
        if (Object.keys(edit).length) await cloned.edit(edit).catch(() => {});
      } catch {}

      
      await ch.delete(`renew:${msg.author.id}`).catch(() => {});

      
      try {
        await cloned.setPosition(savedPosition, { reason: `renew-pos:${msg.author.id}` });
      } catch {
        try {
          await cloned.setPosition(savedRaw, { reason: `renew-pos:${msg.author.id}` });
        } catch {
          try {
            await cloned.setPosition(siblingIndex, { reason: `renew-pos:${msg.author.id}` });
          } catch {}
        }
      }
    } catch (e) {
      console.warn("⚠️ renew:", e.message);
    }
    return;
  }
  
  if (/^\.leaderboard(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg, false);
    if (!perm.allowed) {
      if (!perm.silent && perm.reason) replyUser(msg, perm.reason).catch(() => {}); return;
    }
    const entries = Object.entries(usageStore.users || {})
      .map(([id, v]) => ({ id, username: v.username || "unknown", count: Number(v.count) || 0 }))
      .filter(e => e.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    if (!entries.length) {
      await replyComponentsV2(msg, {
        flags: IS_COMPONENTS_V2,
        components: [{
          type: 17,
          accent_color: RENAME_V2_ACCENT,
          components: [{ type: 10, content: "### The Leaderboard\nNo command uses recorded yet." }]
        }]
      }, { mention: false }).catch(() => {});
      return;
    }
    const lines = entries.map((e, i) =>
      `> **${i + 1}.** \`${String(e.username).replace(/[`]/g, "")}\` -> **${e.count}** use.`
    ).join("\n");
    await replyComponentsV2(msg, {
      flags: IS_COMPONENTS_V2,
      components: [{
        type: 17,
        accent_color: RENAME_V2_ACCENT,
        components: [{ type: 10, content: ("### The Leaderboard\n" + lines).slice(0, 3900) }]
      }]
    }, { mention: false }).catch(() => {});
    return;
  }

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
    if (!query) { replyUser(msg, "❌ usage: `.find <file name>`.").catch(() => {}); return; }
    const results = findFiles(query);
    if (!results.length) { replyUser(msg, "❌ no found.").catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const perPage = 8; const totalPages = Math.ceil(results.length / perPage);
    const pageItems = results.slice(0, perPage);
    const listLines = pageItems.map(f => `> \`${finderDisplayName(f.filename)}\` — ID: \`${f.id}\``);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(totalPages <= 1)
    );
    pendingTokenLine.delete(String(msg.author.id));
    const v2 = buildFinderV2Payload({
      listLines,
      pageLabel: `Pages 1/${totalPages}`,
      actionRow: row,
      ephemeral: false
    });
    const sent = await replyComponentsV2(msg, v2).catch(() => null);
    if (sent) paginationMenus.set(msg.author.id, {
      results, page: 1, totalPages, messageId: sent.id,
      authorId: msg.author.id, createdAt: Date.now(), isBuyer: isBuyerUser
    });
    return;
  }
  } catch (e) {
    console.error("❌ messageCreate:", e?.message || e);
  }
});
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
