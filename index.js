const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");

// =========================
// Environment
// =========================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = "1302080645987569694";
const PREFIX = ".";

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID");
  process.exit(1);
}

// =========================
// Persist settings
// =========================
const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) { console.error("⚠️ Load error:", e.message); }
  return { antiNuke: {}, antiNukeIgnore: {}, antiRaid: {}, pingWarn: {} };
}

function saveData(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error("⚠️ Save error:", e.message); }
}

let saved = loadData();

// =========================
// Web Server
// =========================
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("FS Bot Online"));
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 Port ${PORT}`));

// =========================
// Discord Client
// =========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// =========================
// State
// =========================
const games = new Map();
const pingWarnRoles = new Map(Object.entries(saved.pingWarn || {}).map(([k, v]) => [k, { ...v, timeout: null }]));
const antiNukeEnabled = new Map(Object.entries(saved.antiNuke || {}).map(([k, v]) => [k, !!v]));
const antiNukeIgnoreRole = new Map(Object.entries(saved.antiNukeIgnore || {}));
const antiRaidEnabled = new Map(Object.entries(saved.antiRaid || {}).map(([k, v]) => [k, !!v]));
const recentNukeCreates = new Map();
const roleJobs = new Map();

// =========================
// Helpers
// =========================
function getTodayTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" });
}

function parseDuration(str) {
  if (!str) return null;
  let total = 0;
  str.toLowerCase().match(/(\d+)\s*(s|m|h|d)/g)?.forEach(p => {
    const [, n, u] = p.match(/(\d+)\s*(s|m|h|d)/);
    total += parseInt(n) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[u];
  });
  return total || null;
}

function formatDuration(ms) {
  if (!ms) return "permanent";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

function randomFilename(ext = "lua") {
  return Array.from({ length: 10 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("") + `.${ext}`;
}

function isValidUrl(string) {
  try { new URL(string); return true; } catch { return false; }
}

function extractLoadstringUrl(content) {
  const patterns = [
    /loadstring\s*\(\s*game\s*:\s*HttpGet\s*\(\s*["']([^"']+)["']\s*\)\s*\)/i,
    /loadstring\s*\(\s*game\s*:\s*HttpGet\s*\(\s*([https?:][^\s,)]+)\s*\)/i,
  ];
  for (const p of patterns) {
    const m = content.match(p);
    if (m && isValidUrl(m[1])) return m[1];
  }
  return null;
}

// =========================
// FETCH FILE (for .get)
// =========================
async function fetchWithLoadstringFollow(url, maxDepth = 5) {
  let currentUrl = url, depth = 0, content = "";
  const history = [];
  while (depth < maxDepth) {
    if (history.includes(currentUrl)) break;
    history.push(currentUrl);
    const res = await fetch(currentUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    content = await res.text();
    if (content.trim().startsWith("<!doctype") || content.trim().startsWith("<html")) {
      const luaMatch = content.match(/const\s+luaSource\s*=\s*`([^`]+)`/);
      if (luaMatch) content = luaMatch[1].trim();
    }
    const inner = extractLoadstringUrl(content);
    if (inner && !history.includes(inner)) { currentUrl = inner; depth++; continue; }
    break;
  }
  return { content, history };
}

// =========================
// OBFUSCATOR DETECTION
// =========================
function detectObfuscator(content) {
  const detections = [];
  const lower = content.toLowerCase();

  if (lower.includes("25ms") || lower.includes("__25ms") || (content.match(/\\\d{3}/g)?.length > 50 && lower.includes("getfenv")))
    detections.push({ name: "25ms Obfuscator", confidence: 85 });
  if (lower.includes("luarmor") || lower.includes("_bsdata") || lower.includes("cdn.luarmor.net"))
    detections.push({ name: "Luarmor", confidence: 95 });
  if (lower.includes("moonsec"))
    detections.push({ name: "MoonSec", confidence: 90 });
  if (lower.includes("ironbrew") || lower.includes("xenobfuscate"))
    detections.push({ name: "IronBrew / Synapse Xen", confidence: 80 });
  if (lower.includes("darklua"))
    detections.push({ name: "DarkLua", confidence: 85 });
  if (lower.includes("luraph"))
    detections.push({ name: "Luraph", confidence: 75 });

  if (detections.length === 0) {
    const hasComments = content.includes("--");
    const hasReadable = content.match(/\b(local|function|if|then|else|end)\s+[a-zA-Z_]\w{2,}/g)?.length > 5;
    const hasLowEncoding = (content.match(/\\\d{3}/g)?.length || 0) < 10;
    detections.push({ name: hasComments && hasReadable && hasLowEncoding ? "Unobfuscated" : "Unknown / Custom Obfuscator", confidence: 90 });
  }
  detections.sort((a, b) => b.confidence - a.confidence);
  return detections;
}

// =========================
// MESSAGE COMMANDS — .get & .detect
// =========================
client.on("messageCreate", async message => {
  if (!message.content.startsWith(PREFIX) || message.author.bot) return;
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  // ===== .get <url> — SEND ONLY THE FILE, NO TEXT =====
  if (cmd === "get") {
    const url = args[0];
    if (!url || !isValidUrl(url)) return;
    try {
      await message.channel.sendTyping();
      const { content } = await fetchWithLoadstringFollow(url);
      const filename = randomFilename();
      const filepath = path.join(DATA_DIR, filename);
      fs.writeFileSync(filepath, content, "utf8");
      // ↓ SENDS ONLY THE FILE — NO EXTRA TEXT ↓
      await message.channel.send({ files: [filepath] });
      fs.unlinkSync(filepath); // delete after send
    } catch (e) {
      console.error(".get error:", e);
    }
    return;
  }

  // ===== .detect — GRAY EMBED, TITLE "Obfuscator Detection", NO Source/Size/Hex =====
  if (cmd === "detect") {
    let url = args[0];
    let content = "";
    if (url && isValidUrl(url)) {
      try {
        await message.channel.sendTyping();
        const res = await fetchWithLoadstringFollow(url);
        content = res.content;
      } catch (e) { return; }
    } else {
      content = message.content;
      if (message.attachments.size > 0) {
        const att = message.attachments.first();
        try {
          const r = await fetch(att.url);
          content = await r.text();
        } catch (e) { return; }
      }
    }
    if (!content) return;
    const detections = detectObfuscator(content);
    const primary = detections[0];
    const others = detections.slice(1).map(d => `${d.name} (${d.confidence}%)`).join(", ");

    const embed = new EmbedBuilder()
      .setColor(0x808080) // ← GRAY EMBED
      .setTitle("Obfuscator Detection") // ← TITLE
      .setDescription(`**${primary.name} (${primary.confidence}%)**\n**Other:** ${others || "None"}`)
      .setFooter({ text: `Today at ${getTodayTime()}` });
    // ← NO Source, NO Size, NO Hex — CLEAN ↓
    await message.channel.send({ embeds: [embed] });
    return;
  }
});

// =========================
// SLASH COMMANDS
// =========================
const commands = [
  new SlashCommandBuilder().setName("status").setDescription("Show Anti-Nuke, Anti-Raid, Ping Warn status"),
  new SlashCommandBuilder().setName("antinuke").setDescription("Toggle Anti-Nuke")
    .addStringOption(o => o.setName("mode").setRequired(true).addChoices({ name: "ON", value: "on" }, { name: "OFF", value: "off" }))
    .addRoleOption(o => o.setName("role").setDescription("Role to ignore")),
  new SlashCommandBuilder().setName("antiraid").setDescription("Toggle Anti-Raid")
    .addStringOption(o => o.setName("mode").setRequired(true).addChoices({ name: "ON", value: "on" }, { name: "OFF", value: "off" })),
].map(c => c.toJSON());

// =========================
// READY & REGISTER
// =========================
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ Commands registered");
});

// =========================
// INTERACTIONS
// =========================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { guildId, commandName, options } = interaction;

  if (commandName === "status") {
    const nukeOn = !!antiNukeEnabled.get(guildId);
    const raidOn = !!antiRaidEnabled.get(guildId);
    const pingOn = [...pingWarnRoles.values()].some(v => v.enabled && v.guildId === guildId);
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle("STATUS")
        .setDescription(`**Anti Nuke**\n${nukeOn ? "✅ ON" : "❌ OFF"}\n\n**Anti Raid**\n${raidOn ? "✅ ON" : "❌ OFF"}\n\n**Ping Warn**\n${pingOn ? "✅ ON" : "❌ OFF"}`)
        .setColor(0x808080)]
    });
  }

  if (commandName === "antinuke") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: "❌ Admin only", ephemeral: true });
    const mode = options.getString("mode");
    const role = options.getRole("role");
    antiNukeEnabled.set(guildId, mode === "on");
    if (role) antiNukeIgnoreRole.set(guildId, role.id);
    else antiNukeIgnoreRole.delete(guildId);
    saveData({ antiNuke: Object.fromEntries(antiNukeEnabled), antiNukeIgnore: Object.fromEntries(antiNukeIgnoreRole), antiRaid: Object.fromEntries(antiRaidEnabled), pingWarn: Object.fromEntries(pingWarnRoles) });
    return interaction.reply({ content: `✅ Anti-Nuke ${mode === "on" ? "ON" : "OFF"}`, ephemeral: true });
  }

  if (commandName === "antiraid") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: "❌ Admin only", ephemeral: true });
    const mode = options.getString("mode");
    antiRaidEnabled.set(guildId, mode === "on");
    saveData({ antiNuke: Object.fromEntries(antiNukeEnabled), antiNukeIgnore: Object.fromEntries(antiNukeIgnoreRole), antiRaid: Object.fromEntries(antiRaidEnabled), pingWarn: Object.fromEntries(pingWarnRoles) });
    return interaction.reply({ content: `✅ Anti-Raid ${mode === "on" ? "ON" : "OFF"}`, ephemeral: true });
  }
});

client.login(TOKEN);
