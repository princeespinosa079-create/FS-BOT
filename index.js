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
  PermissionFlagsBits,
  AuditLogEvent
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

function saveData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const data = {
      antiNuke: Object.fromEntries(antiNukeEnabled),
      antiNukeIgnore: Object.fromEntries(antiNukeIgnoreRole),
      antiRaid: Object.fromEntries(antiRaidEnabled),
      pingWarn: Object.fromEntries([...pingWarnRoles.entries()].map(([k, v]) => [k, { enabled: v.enabled, guildId: v.guildId, durationMs: v.durationMs }]))
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error("⚠️ Save error:", e.message); }
}

const saved = loadData();

// =========================
// Web Server
// =========================
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("FS Bot Online"));
app.get("/health", (req, res) => res.json({ status: "online" }));
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 Port ${PORT}`));

// =========================
// Discord Client
// =========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration
  ]
});

// =========================
// State
// =========================
const games = new Map();
const pingWarnRoles = new Map(Object.entries(saved.pingWarn || {}).map(([k, v]) => [k, { enabled: v.enabled, timeout: null, guildId: v.guildId, durationMs: v.durationMs ?? null }]));
const antiNukeEnabled = new Map(Object.entries(saved.antiNuke || {}).map(([k, v]) => [k, !!v]));
const antiNukeIgnoreRole = new Map(Object.entries(saved.antiNukeIgnore || {}));
const antiRaidEnabled = new Map(Object.entries(saved.antiRaid || {}).map(([k, v]) => [k, !!v]));
const recentNukeCreates = new Map();
const webhookSpamTracker = new Map();
const roleJobs = new Map();

// =========================
// Helpers
// =========================
function getTodayTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" });
}

function parseDuration(str) {
  if (!str || !str.trim()) return null;
  let total = 0;
  str.trim().toLowerCase().match(/(\d+)\s*(s|m|h|d)/g)?.forEach(p => {
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

async function extractAllUrls(message) {
  const urls = new Set();
  const currentMatches = message.content.match(/https?:\/\/[^\s<>"')]+/g);
  if (currentMatches) currentMatches.forEach(u => { if (isValidUrl(u)) urls.add(u); });
  if (message.reference) {
    try {
      const replied = await message.channel.messages.fetch(message.reference.messageId);
      const replyMatches = replied.content.match(/https?:\/\/[^\s<>"')]+/g);
      if (replyMatches) replyMatches.forEach(u => { if (isValidUrl(u)) urls.add(u); });
    } catch {}
  }
  return [...urls];
}

function extractLoadstringUrl(content) {
  const patterns = [
    /loadstring\s*\(\s*game\s*:\s*HttpGet\s*\(\s*["']([^"']+)["']\s*\)\s*\)/i,
    /loadstring\s*\(\s*game\s*:\s*HttpGet\s*\(\s*([https?:][^\s,)]+)\s*\)/i,
    /loadstring\s*\(\s*HttpGet\s*\(\s*["']([^"']+)["']\s*\)\s*\)/i,
  ];
  for (const p of patterns) {
    const m = content.match(p);
    if (m && isValidUrl(m[1])) return m[1];
  }
  return null;
}

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

function detectObfuscator(content) {
  const detections = [];
  const lower = content.toLowerCase();
  if (lower.includes("luarmor") || lower.includes("_bsdata")) detections.push({ name: "Luarmor", confidence: 95 });
  if (lower.includes("25ms")) detections.push({ name: "25ms Obfuscator", confidence: 85 });
  if (lower.includes("ironbrew") || lower.includes("synapse xen")) detections.push({ name: "IronBrew / Synapse Xen", confidence: 80 });
  if (lower.includes("moonsec")) detections.push({ name: "MoonSec", confidence: 90 });
  if (lower.includes("darklua")) detections.push({ name: "DarkLua", confidence: 85 });
  if (lower.includes("luraph")) detections.push({ name: "Luraph", confidence: 75 });
  if (detections.length === 0) detections.push({ name: "Unobfuscated / Unknown", confidence: 90 });
  detections.sort((a, b) => b.confidence - a.confidence);
  return detections;
}

// =========================
// Media Platforms
// =========================
const MEDIA_PLATFORMS = {
  tiktok: { name: "TikTok", emoji: "🎵", url: u => `https://www.tiktok.com/@${u}` },
  instagram: { name: "Instagram", emoji: "📸", url: u => `https://www.instagram.com/${u}` },
  roblox: { name: "Roblox", emoji: "🎮", url: u => `https://www.roblox.com/search/users?keyword=${encodeURIComponent(u)}` },
  x: { name: "X (Twitter)", emoji: "🐦", url: u => `https://x.com/${u}` },
  youtube: { name: "YouTube", emoji: "▶️", url: u => `https://www.youtube.com/@${u}` },
  twitch: { name: "Twitch", emoji: "🟣", url: u => `https://www.twitch.tv/${u}` },
  reddit: { name: "Reddit", emoji: "🟠", url: u => `https://www.reddit.com/user/${u}` },
  github: { name: "GitHub", emoji: "💻", url: u => `https://github.com/${u}` },
  steam: { name: "Steam", emoji: "🎯", url: u => `https://steamcommunity.com/id/${u}` },
  facebook: { name: "Facebook", emoji: "📘", url: u => `https://www.facebook.com/${u}` },
  snapchat: { name: "Snapchat", emoji: "👻", url: u => `https://www.snapchat.com/add/${u}` },
  pinterest: { name: "Pinterest", emoji: "📌", url: u => `https://www.pinterest.com/${u}` },
  spotify: { name: "Spotify", emoji: "🎧", url: u => `https://open.spotify.com/search/${encodeURIComponent(u)}` },
  linkedin: { name: "LinkedIn", emoji: "💼", url: u => `https://www.linkedin.com/in/${u}` }
};

function formatCount(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

async function fetchPlatformStats(key, username) {
  const platform = MEDIA_PLATFORMS[key];
  const profileUrl = platform.url(username);
  let followers = null, posts = null, active = null;
  try {
    if (key === "github") {
      const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers: { "User-Agent": "FSBot" }, signal: AbortSignal.timeout(6000) });
      if (res.ok) { const j = await res.json(); followers = j.followers ?? null; posts = j.public_repos ?? null; active = true; }
      else if (res.status === 404) active = false;
    } else {
      const res = await fetch(profileUrl, { method: "GET", signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (res) active = res.ok;
    }
  } catch {}
  return { followers, posts, active, profileUrl, platform };
}

function activeEmoji(active) { return active === true ? "🟢" : active === false ? "🔴" : "⚪"; }
function activeText(active) { return active === true ? "Found" : active === false ? "Not found" : "Unknown"; }

// =========================
// Slash Commands
// =========================
const commands = [
  new SlashCommandBuilder().setName("guessnumber").setDescription("Number guessing game")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
    .addIntegerOption(o => o.setName("answer").setDescription("Answer 1-10000").setRequired(true).setMinValue(1).setMaxValue(10000)),
  new SlashCommandBuilder().setName("embed").setDescription("Send gray embed")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
    .addStringOption(o => o.setName("description").setRequired(true))
    .addStringOption(o => o.setName("title")),
  new SlashCommandBuilder().setName("status").setDescription("Show bot status"),
  new SlashCommandBuilder().setName("ghostping").setDescription("Ghost ping")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
    .addStringOption(o => o.setName("mention").setRequired(true).addChoices({ name: "@everyone", value: "everyone" }, { name: "@here", value: "here" })),
  new SlashCommandBuilder().setName("searchmedia").setDescription("Search username across platforms")
    .addStringOption(o => o.setName("username").setRequired(true))
    .addStringOption(o => o.setName("apps").setRequired(true).addChoices({ name: "All", value: "all" }, ...Object.keys(MEDIA_PLATFORMS).map(k => ({ name: MEDIA_PLATFORMS[k].name, value: k })))),
  new SlashCommandBuilder().setName("pingwarn").setDescription("Ping warn config")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles.toString())
    .addStringOption(o => o.setName("mode").setRequired(true).addChoices({ name: "ON", value: "on" }, { name: "OFF", value: "off" }))
    .addRoleOption(o => o.setName("role").setRequired(true))
    .addStringOption(o => o.setName("duration")),
  new SlashCommandBuilder().setName("spylist").setDescription("List spies/alts")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString()),
  new SlashCommandBuilder().setName("antinuke").setDescription("Anti-Nuke toggle")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString())
    .addStringOption(o => o.setName("mode").setRequired(true).addChoices({ name: "ON", value: "on" }, { name: "OFF", value: "off" }))
    .addRoleOption(o => o.setName("role")),
  new SlashCommandBuilder().setName("antiraid").setDescription("Anti-Raid toggle")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString())
    .addStringOption(o => o.setName("mode").setRequired(true).addChoices({ name: "ON", value: "on" }, { name: "OFF", value: "off" })),
  new SlashCommandBuilder().setName("role").setDescription("Manage roles")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles.toString())
    .addSubcommand(sub => sub.setName("add").addUserOption(o => o.setName("user").setRequired(true)).addRoleOption(o => o.setName("role").setRequired(true)).addStringOption(o => o.setName("duration")))
    .addSubcommand(sub => sub.setName("all").addRoleOption(o => o.setName("role").setRequired(true))),
  new SlashCommandBuilder().setName("serverlist").setDescription("List all servers (Owner only)"),
  new SlashCommandBuilder().setName("leave").setDescription("Leave server (Owner only)")
    .addStringOption(o => o.setName("server-id").setRequired(true))
].map(c => c.toJSON());

// =========================
// Register Commands
// =========================
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Commands registered");
  } catch (e) { console.error("❌ Command register error:", e); }
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

// =========================
// Interaction Handlers
// =========================
client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if ((interaction.commandName === "serverlist" || interaction.commandName === "leave") && interaction.user.id !== OWNER_ID)
        return interaction.reply({ content: "❌ Owner only.", ephemeral: true });

      if (interaction.commandName === "serverlist") {
        await interaction.deferReply({ ephemeral: true });
        const guilds = [...client.guilds.cache.values()];
        let desc = `**Total Servers:** \`${guilds.length}\`\n\n`;
        for (let i = 0; i < guilds.length; i++) {
          const g = guilds[i];
          let invite = "Unavailable";
          try {
            const ch = g.channels.cache.find(c => c.isTextBased() && c.permissionsFor(g.members.me)?.has(PermissionFlagsBits.CreateInstantInvite));
            if (ch) invite = (await ch.createInvite({ maxAge: 0 })).url;
          } catch {}
          desc += `**${i + 1}. ${g.name}**\n> **ID:** \`${g.id}\`\n> **Invite:** ${invite}\n\n`;
        }
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("SERVER LIST 📋").setDescription(desc.slice(0, 4000)).setColor(0x808080)] });
      }

      if (interaction.commandName === "leave") {
        const guild = client.guilds.cache.get(interaction.options.getString("server-id"));
        if (!guild) return interaction.reply({ content: "❌ Not found.", ephemeral: true });
        try { await guild.leave(); return interaction.reply({ content: `✅ Left **${guild.name}**.`, ephemeral: true }); }
        catch { return interaction.reply({ content: "❌ Failed.", ephemeral: true }); }
      }

      if (interaction.commandName === "status") {
        const gid = interaction.guildId;
        const nukeOn = !!antiNukeEnabled.get(gid);
        const raidOn = !!antiRaidEnabled.get(gid);
        const pingOn = [...pingWarnRoles.values()].some(v => v.enabled && v.guildId === gid);
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("COMMAND STATUS").setDescription(`**Anti Nuke**\n${nukeOn ? "✅ ON" : "❌ OFF"}\n\n**Anti Raid**\n${raidOn ? "✅ ON" : "❌ OFF"}\n\n**Ping Warn**\n${pingOn ? "✅ ON" : "❌ OFF"}`).setColor(0x808080)] });
      }

      if (interaction.commandName === "ghostping") {
        const content = interaction.options.getString("mention") === "everyone" ? "@everyone" : "@here";
        await interaction.reply({ content: "✅ Sent.", ephemeral: true });
        const msg = await interaction.channel.send({ content, allowedMentions: { parse: ["everyone"] } });
        setTimeout(() => msg.delete().catch(() => {}), 500);
        return;
      }

      if (interaction.commandName === "searchmedia") {
        let username = interaction.options.getString("username").trim().replace(/^@/, "");
        const app = interaction.options.getString("apps");
        const keys = app === "all" ? Object.keys(MEDIA_PLATFORMS) : [app];
        await interaction.deferReply();
        const results = await Promise.all(keys.map(k => fetchPlatformStats(k, username)));
        const embeds = [];
        for (let i = 0; i < results.length; i += 6) {
          const chunk = results.slice(i, i + 6);
          const embed = new EmbedBuilder().setTitle(`🔍 MEDIA SEARCH — @${username}`).setColor(0x808080);
          for (const r of chunk) {
            embed.addFields({ name: `${r.platform.emoji} ${r.platform.name}`, value: `**Active:** ${activeEmoji(r.active)} ${activeText(r.active)}\n[Profile](${r.profileUrl})`, inline: true });
          }
          embeds.push(embed);
        }
        return interaction.editReply({ embeds });
      }

      if (interaction.commandName === "guessnumber") {
        const answer = interaction.options.getInteger("answer");
        if (games.has(interaction.channelId)) return interaction.reply({ content: "⚠️ Game exists.", ephemeral: true });
        games.set(interaction.channelId, { answer, hostId: interaction.user.id, active: false });
        try { await interaction.user.send({ embeds: [new EmbedBuilder().setDescription(`🔢 Answer: \`${answer}\``).setColor(0x808080)] }); }
        catch { games.delete(interaction.channelId); return interaction.reply({ content: "❌ Enable DMs.", ephemeral: true }); }
        await interaction.deferReply({ ephemeral: true });
        await interaction.deleteReply();
        return interaction.channel.send({
          embeds: [new EmbedBuilder().setTitle("GAME EVENT 🧧").setDescription(`Host: <@${interaction.user.id}>\nClick Start to begin.`).setColor(0x808080)],
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("guess_start").setLabel("Start").setStyle(ButtonStyle.Success))]
        });
      }

      if (interaction.commandName === "embed") {
        const embed = new EmbedBuilder().setDescription(interaction.options.getString("description")).setColor(0x808080);
        const title = interaction.options.getString("title");
        if (title) embed.setTitle(title);
        await interaction.deferReply({ ephemeral: true });
        await interaction.deleteReply();
        return interaction.channel.send({ embeds: [embed] });
      }

      if (interaction.commandName === "pingwarn") {
        const mode = interaction.options.getString("mode");
        const role = interaction.options.getRole("role");
        const durationMs = parseDuration(interaction.options.getString("duration"));
        if (mode === "on") {
          pingWarnRoles.set(role.id, { enabled: true, timeout: null, guildId: interaction.guildId, durationMs });
          saveData();
          return interaction.reply({ content: `✅ Ping Warn ON for **${role.name}**. Duration: **${formatDuration(durationMs)}**.`, ephemeral: true });
        } else {
          pingWarnRoles.delete(role.id);
          saveData();
          return interaction.reply({ content: `✅ Ping Warn OFF for **${role.name}**.`, ephemeral: true });
        }
      }

      if (interaction.commandName === "spylist") {
        await interaction.deferReply({ ephemeral: true });
        await interaction.guild.members.fetch();
        const twentyDaysAgo = Date.now() - 20 * 86400000;
        const spies = [], newAccs = [];
        for (const m of interaction.guild.members.cache.values()) {
          if (m.user.bot) continue;
          const name = (m.user.username + " " + (m.nickname || "")).toLowerCase();
          if (name.includes("alt") || name.includes("spy")) spies.push(m);
          if (m.user.createdTimestamp >= twentyDaysAgo) newAccs.push(m);
        }
        newAccs.sort((a, b) => b.user.createdTimestamp - a.user.createdTimestamp);
        const e1 = new EmbedBuilder().setTitle(`SPY/ALT LIST — ${spies.length}`).setColor(0x808080);
        e1.setDescription(spies.length ? spies.map((m, i) => `${i + 1}. <@${m.id}> \`${m.user.tag}\``).join("\n") : "None found.");
        const e2 = new EmbedBuilder().setTitle(`NEW ACCOUNT LIST — ${newAccs.length}`).setColor(0x808080);
        e2.setDescription(newAccs.length ? newAccs.map((m, i) => `${i + 1}. <@${m.id}> \`${m.user.tag}\``).join("\n") : "None found.");
        await interaction.channel.send({ embeds: [e1, e2] });
        return interaction.editReply({ content: "✅ Sent.", ephemeral: true });
      }

      if (interaction.commandName === "antinuke") {
        const mode = interaction.options.getString("mode");
        const role = interaction.options.getRole("role");
        antiNukeEnabled.set(interaction.guildId, mode === "on");
        if (role) antiNukeIgnoreRole.set(interaction.guildId, role.id);
        saveData();
        return interaction.reply({ content: `✅ Anti-Nuke ${mode === "on" ? "ON" : "OFF"}`, ephemeral: true });
      }

      if (interaction.commandName === "antiraid") {
        const mode = interaction.options.getString("mode");
        antiRaidEnabled.set(interaction.guildId, mode === "on");
        saveData();
        return interaction.reply({ content: `✅ Anti-Raid ${mode === "on" ? "ON" : "OFF"}`, ephemeral: true });
      }

      if (interaction.commandName === "role") {
        const sub = interaction.options.getSubcommand();
        const role = interaction.options.getRole("role");
        if (sub === "add") {
          const user = interaction.options.getUser("user");
          const member = await interaction.guild.members.fetch(user.id);
          const durationMs = parseDuration(interaction.options.getString("duration"));
          await member.roles.add(role);
          if (durationMs) setTimeout(() => member.roles.remove(role).catch(() => {}), durationMs);
          return interaction.reply({ content: `✅ Added **${role.name}** to <@${user.id}>.`, ephemeral: true });
        }
        if (sub === "all") {
          const total = interaction.guild.members.cache.filter(m => !m.user.bot && !m.roles.cache.has(role.id)).size;
          return interaction.reply({
            embeds: [new EmbedBuilder().setTitle("ROLE ALL PANEL").setDescription(`Role: ${role}\nMembers: ${total}`).setColor(0x808080)],
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`roleall_start_${role.id}`).setLabel("Start").setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`roleall_stop`).setLabel("Stop").setStyle(ButtonStyle.Danger)
            )]
          });
        }
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "guess_start") {
        const game = games.get(interaction.channelId);
        if (!game || game.active) return;
        game.active = true;
        try { await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: true }); } catch {}
        return interaction.update({ embeds: [new EmbedBuilder().setDescription("> 🔓 UNLOCKED! Guess 1-10000").setColor(0x808080)], components: [] });
      }
      if (interaction.customId.startsWith("roleall_start_")) {
        const roleId = interaction.customId.split("_")[2];
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role || roleJobs.get(interaction.guildId)?.running) return;
        await interaction.deferUpdate();
        const targets = [...interaction.guild.members.cache.filter(m => !m.user.bot && !m.roles.cache.has(role.id)).values()];
        roleJobs.set(interaction.guildId, { running: true, stopped: false, added: 0, total: targets.length });
        for (const m of targets) {
          const job = roleJobs.get(interaction.guildId);
          if (!job || job.stopped) break;
          try { await m.roles.add(role); job.added++; } catch {}
          if (job.added % 10 === 0) await interaction.message.edit({ content: `Progress: ${job.added}/${job.total}` }).catch(() => {});
          await new Promise(r => setTimeout(r, 1000));
        }
        roleJobs.delete(interaction.guildId);
        await interaction.message.edit({ content: "✅ Done!", components: [] }).catch(() => {});
      }
      if (interaction.customId === "roleall_stop") {
        const job = roleJobs.get(interaction.guildId);
        if (job) job.stopped = true;
        await interaction.message.delete().catch(() => {});
        return interaction.reply({ content: "🛑 Stopped.", ephemeral: true });
      }
    }
  } catch (e) { console.error("❌ Interaction error:", e); }
});

// =========================
// Anti-Nuke
// =========================
async function handleNukeCreate(guild, auditType) {
  if (!antiNukeEnabled.get(guild.id)) return;
  try {
    const logs = await guild.fetchAuditLogs({ limit: 1, type: auditType });
    const entry = logs.entries.first();
    if (!entry || !entry.executor || entry.executor.id === OWNER_ID) return;
    const ignoreId = antiNukeIgnoreRole.get(guild.id);
    if (ignoreId) {
      const member = await guild.members.fetch(entry.executor.id).catch(() => null);
      if (member?.roles.cache.has(ignoreId)) return;
    }
    if (!recentNukeCreates.has(guild.id)) recentNukeCreates.set(guild.id, new Map());
    const map = recentNukeCreates.get(guild.id);
    const now = Date.now();
    const data = map.get(entry.executor.id) || { count: 0, first: now };
    data.count = now - data.first > 1000 ? 1 : data.count + 1;
    data.first = now;
    map.set(entry.executor.id, data);
    if (data.count >= 2) {
      const member = await guild.members.fetch(entry.executor.id).catch(() => null);
      if (member?.bannable) await member.ban({ reason: "Anti-Nuke triggered" });
      recentNukeCreates.delete(guild.id);
    }
  } catch (e) { console.error("❌ Anti-Nuke error:", e); }
}

client.on("channelCreate", c => c.guild && handleNukeCreate(c.guild, AuditLogEvent.ChannelCreate));
client.on("roleCreate", r => handleNukeCreate(r.guild, AuditLogEvent.RoleCreate));

// =========================
// Message Commands — .get & .detect
// =========================
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  // ===== .get <url> — send ONLY the file =====
  if (message.content.startsWith(PREFIX + "get ")) {
    const urls = await extractAllUrls(message);
    if (!urls.length) return;
    for (const url of urls) {
      try {
        const { content } = await fetchWithLoadstringFollow(url);
        const filename = randomFilename();
        const filepath = path.join(DATA_DIR, filename);
        fs.writeFileSync(filepath, content, "utf8");
        await message.channel.send({ files: [filepath] });
        fs.unlinkSync(filepath);
      } catch (e) { console.error(".get error:", e); }
    }
    return;
  }

  // ===== .detect — gray embed, clean output =====
  if (message.content.startsWith(PREFIX + "detect")) {
    let content = "";
    if (message.attachments.size > 0) {
      const res = await fetch(message.attachments.first().url);
      content = await res.text();
    } else {
      const urls = await extractAllUrls(message);
      if (urls.length > 0) content = (await fetchWithLoadstringFollow(urls[0])).content;
    }
    if (!content) return;
    const detections = detectObfuscator(content);
    const primary = detections[0];
    const others = detections.slice(1).map(d => `${d.name} (${d.confidence}%)`).join(", ");
    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setTitle("Obfuscator Detection")
      .setDescription(`**${primary.name} (${primary.confidence}%)**\n**Other:** ${others || "None"}`)
      .setFooter({ text: `Today at ${getTodayTime()}` });
    await message.channel.send({ embeds: [embed] });
    return;
  }

  // ===== Ping Warn =====
  if (message.mentions.everyone && message.guild) {
    for (const [roleId, config] of pingWarnRoles) {
      if (!config.enabled || config.guildId !== message.guildId) continue;
      const member = message.member;
      if (!member?.roles.cache.has(roleId)) continue;
      const role = message.guild.roles.cache.get(roleId);
      if (!role || !role.permissions.has(PermissionFlagsBits.MentionEveryone)) continue;
      try {
        await role.setPermissions(role.permissions.remove(PermissionFlagsBits.MentionEveryone), "PingWarn triggered");
        if (config.durationMs) {
          if (config.timeout) clearTimeout(config.timeout);
          config.timeout = setTimeout(async () => {
            const r = message.guild.roles.cache.get(roleId);
            if (r) await r.setPermissions(r.permissions.add(PermissionFlagsBits.MentionEveryone), "PingWarn duration ended").catch(() => {});
          }, config.durationMs);
        }
        await message.channel.send({
          content: `⚠️ **Ping Warn** — **${role.name}** lost @everyone permission${config.durationMs ? ` for ${formatDuration(config.durationMs)}` : " permanently"}.\nTriggered by <@${message.author.id}>.`,
          allowedMentions: { users: [message.author.id] }
        }).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
      } catch {}
      break;
    }
  }

  // ===== Guess Game =====
  const game = games.get(message.channelId);
  if (game?.active) {
    const guess = parseInt(message.content.trim());
    if (Number.isInteger(guess) && guess >= 1 && guess <= 10000 && guess === game.answer) {
      await message.channel.send({ embeds: [new EmbedBuilder().setDescription(`> 🎊 <@${message.author.id}> WON! Answer: **${guess}**`).setColor(0x808080)] });
      try { await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }); } catch {}
      games.delete(message.channelId);
    }
  }

  // ===== Anti-Raid Webhook Spam =====
  if (message.webhookId && message.guild && antiRaidEnabled.get(message.guildId)) {
    const now = Date.now();
    if (!webhookSpamTracker.has(message.guildId)) webhookSpamTracker.set(message.guildId, new Map());
    const map = webhookSpamTracker.get(message.guildId);
    const data = map.get(message.webhookId) || { count: 0, first: now };
    data.count = now - data.first > 3000 ? 1 : data.count + 1;
    data.first = now;
    map.set(message.webhookId, data);
    if (data.count >= 3) {
      try {
        const webhooks = await message.channel.fetchWebhooks();
        const hook = webhooks.get(message.webhookId);
        if (hook) await hook.delete("Anti-Raid: webhook spam");
      } catch {}
      map.delete(message.webhookId);
    }
  }
});

// =========================
// Error Handling & Login
// =========================
client.on("error", e => console.error("❌ Client error:", e));
process.on("unhandledRejection", e => console.error("❌ Unhandled rejection:", e));

console.log("🔑 Logging in...");
client.login(TOKEN).catch(e => { console.error("❌ Login failed:", e); process.exit(1); });
