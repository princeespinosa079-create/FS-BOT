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
const crypto = require("crypto");

// =========================
// CONFIG
// =========================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = "1302080645987569694";
const PREFIX = ".";

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID");
  process.exit(1);
}

// =========================
// DATA & FILE LIBRARY (NO DUPLICATES)
// =========================
const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");
const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) { console.error("⚠️ Load error:", e.message); }
  return { pingWarn: {} };
}

function loadLibrary() {
  try {
    if (fs.existsSync(LIBRARY_FILE)) return JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf8"));
  } catch (e) { console.error("⚠️ Library load:", e.message); }
  return { files: [], scannedChannels: {} };
}

function saveLibrary() {
  try { fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library, null, 2)); }
  catch (e) { console.error("⚠️ Library save:", e); }
}

function saveData() {
  try {
    const data = {
      pingWarn: Object.fromEntries([...pingWarnRoles.entries()].map(([k, v]) =>
        [k, { enabled: v.enabled, guildId: v.guildId, durationMs: v.durationMs }]
      ))
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error("⚠️ Save error:", e.message); }
}

const library = loadLibrary();
const libraryFiles = library.files; // { id, name, url, size, channelId, messageId, hash }
const scannedChannels = library.scannedChannels; // { channelId: lastScannedTimestamp }
const saved = loadData();

// IMAGE MIME TYPES — IGNORE THESE
const IMAGE_MIME_REGEX = /^image\//i;
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"];

function isImageFile(name, contentType) {
  if (contentType && IMAGE_MIME_REGEX.test(contentType)) return true;
  const ext = path.extname(name || "").toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

function generateFileId() {
  return Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6);
}

function fileExistsByHash(hash) { return libraryFiles.some(f => f.hash === hash); }
function fileExistsByUrl(url) { return libraryFiles.some(f => f.url === url); }
function getFileById(id) { return libraryFiles.find(f => f.id === id); }
function searchFiles(query) {
  const q = query.toLowerCase();
  return libraryFiles.filter(f => f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q));
}

function getFileHash(buffer) { return crypto.createHash("md5").update(buffer).digest("hex"); }

// =========================
// WEB SERVER
// =========================
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("FS Bot Online"));
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 Port ${PORT}`));

// =========================
// CLIENT
// =========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ]
});

// =========================
// STATE
// =========================
const pingWarnRoles = new Map(Object.entries(saved.pingWarn || {}).map(([k, v]) =>
  [k, { enabled: v.enabled, timeout: null, guildId: v.guildId, durationMs: v.durationMs ?? null }]
));
const roleJobs = new Map();

// =========================
// HELPERS
// =========================
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

// =========================
// SLASH COMMANDS — ONLY THE ONES YOU WANT ✅
// =========================
const commands = [
  new SlashCommandBuilder().setName("leave").setDescription("Bot leaves a server (Owner only)")
    .addStringOption(o => o.setName("server-id").setDescription("Server ID to leave").setRequired(true)),

  new SlashCommandBuilder().setName("serverlist").setDescription("List all servers (Owner only)"),

  new SlashCommandBuilder().setName("spylist").setDescription("List spies/alts and new accounts")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString()),

  new SlashCommandBuilder().setName("role").setDescription("Manage roles")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles.toString())
    .addSubcommand(sub => sub.setName("add").setDescription("Add role to a user")
      .addUserOption(o => o.setName("user").setRequired(true))
      .addRoleOption(o => o.setName("role").setRequired(true))
      .addStringOption(o => o.setName("duration")))
    .addSubcommand(sub => sub.setName("all").setDescription("Add role to everyone")
      .addRoleOption(o => o.setName("role").setRequired(true))),

  new SlashCommandBuilder().setName("embed").setDescription("Send gray embed")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
    .addStringOption(o => o.setName("description").setRequired(true))
    .addStringOption(o => o.setName("title")),

  new SlashCommandBuilder().setName("ghostping").setDescription("Ghost ping everyone/here")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
    .addStringOption(o => o.setName("mention").setRequired(true)
      .addChoices({ name: "@everyone", value: "everyone" }, { name: "@here", value: "here" })),

  new SlashCommandBuilder().setName("pingwarn").setDescription("Ping warn config")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles.toString())
    .addStringOption(o => o.setName("mode").setRequired(true)
      .addChoices({ name: "ON", value: "on" }, { name: "OFF", value: "off" }))
    .addRoleOption(o => o.setName("role").setRequired(true))
    .addStringOption(o => o.setName("duration")),

  new SlashCommandBuilder().setName("scanfile").setDescription("Scan channel for files and add to library")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
    .addChannelOption(o => o.setName("channel").setDescription("Channel to scan").setRequired(true))
].map(c => c.toJSON());

// =========================
// REGISTER COMMANDS
// =========================
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Commands registered");
  } catch (e) { console.error("❌ Register error:", e); }
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

// =========================
// SCAN CHANNEL FOR FILES — NO DUPLICATES ✅
// =========================
async function scanChannel(channel, interaction = null) {
  if (!channel.isTextBased()) return { scanned: 0, added: 0 };
  const lastScan = scannedChannels[channel.id] || 0;
  let latestTimestamp = lastScan;
  let added = 0;
  let total = 0;
  let before = null;

  if (interaction) await interaction.editReply({ content: `🔍 Scanning <#${channel.id}>... This may take a while.` });

  while (true) {
    const options = { limit: 100 };
    if (before) options.before = before;
    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;

    for (const msg of messages.values()) {
      if (msg.timestamp < lastScan) continue; // Skip already scanned
      if (msg.timestamp > latestTimestamp) latestTimestamp = msg.timestamp;

      // Scan attachments
      for (const att of msg.attachments.values()) {
        if (isImageFile(att.name, att.contentType)) continue; // Skip images
        if (fileExistsByUrl(att.url)) continue; // Skip duplicates

        try {
          const res = await fetch(att.url);
          const buf = Buffer.from(await res.arrayBuffer());
          const hash = getFileHash(buf);
          if (fileExistsByHash(hash)) continue;

          const fileData = {
            id: generateFileId(),
            name: att.name,
            url: att.url,
            size: att.size,
            channelId: channel.id,
            messageId: msg.id,
            timestamp: msg.timestamp,
            hash
          };
          libraryFiles.push(fileData);
          added++;
        } catch (e) { console.error("File scan error:", e.message); }
        total++;
      }
    }

    before = messages.lastKey();
    if (messages.size < 100) break;
  }

  scannedChannels[channel.id] = latestTimestamp || Date.now();
  saveLibrary();
  return { total: total + added, added };
}

// =========================
// INTERACTIONS
// =========================
client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      // === OWNER ONLY ===
      if ((interaction.commandName === "leave" || interaction.commandName === "serverlist") && interaction.user.id !== OWNER_ID)
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
          desc += `**${i + 1}. ${g.name}**\n> ID: \`${g.id}\`\n> Invite: ${invite}\n\n`;
        }
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("SERVER LIST").setDescription(desc.slice(0, 4000)).setColor(0x808080)] });
      }

      if (interaction.commandName === "leave") {
        const guild = client.guilds.cache.get(interaction.options.getString("server-id"));
        if (!guild) return interaction.reply({ content: "❌ Not found.", ephemeral: true });
        try { await guild.leave(); return interaction.reply({ content: `✅ Left **${guild.name}**`, ephemeral: true }); }
        catch { return interaction.reply({ content: "❌ Failed.", ephemeral: true }); }
      }

      // === SCAN FILES ===
      if (interaction.commandName === "scanfile") {
        const channel = interaction.options.getChannel("channel");
        await interaction.deferReply();
        const result = await scanChannel(channel, interaction);
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle("📁 CHANNEL SCAN COMPLETE")
            .setDescription(`**Channel:** <#${channel.id}>\n**New files added:** \`${result.added}\`\n**Total files in library:** \`${libraryFiles.length}\`\n\n✅ Next scan will only check NEW files — no duplicates!`)
            .setColor(0x808080)]
        });
      }

      // === SPYLIST ===
      if (interaction.commandName === "spylist") {
        await interaction.deferReply();
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
        return interaction.editReply({ embeds: [e1, e2] });
      }

      // === ROLE ADD & ALL ===
      if (interaction.commandName === "role") {
        const sub = interaction.options.getSubcommand();
        const role = interaction.options.getRole("role");
        if (sub === "add") {
          const user = interaction.options.getUser("user");
          const member = await interaction.guild.members.fetch(user.id);
          const durationMs = parseDuration(interaction.options.getString("duration"));
          await member.roles.add(role);
          if (durationMs) setTimeout(() => member.roles.remove(role).catch(() => {}), durationMs);
          return interaction.reply({ content: `✅ Added **${role.name}** to <@${user.id}>`, ephemeral: true });
        }
        if (sub === "all") {
          const total = interaction.guild.members.cache.filter(m => !m.user.bot && !m.roles.cache.has(role.id)).size;
          return interaction.reply({
            embeds: [new EmbedBuilder().setTitle("ROLE ALL").setDescription(`Role: ${role}\nMembers: ${total}`).setColor(0x808080)],
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`roleall_start_${role.id}`).setLabel("Start").setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId("roleall_stop").setLabel("Stop").setStyle(ButtonStyle.Danger)
            )],
            ephemeral: true
          });
        }
      }

      // === EMBED ===
      if (interaction.commandName === "embed") {
        const embed = new EmbedBuilder().setDescription(interaction.options.getString("description")).setColor(0x808080);
        const title = interaction.options.getString("title");
        if (title) embed.setTitle(title);
        await interaction.deferReply({ ephemeral: true });
        await interaction.deleteReply();
        return interaction.channel.send({ embeds: [embed] });
      }

      // === GHOSTPING ===
      if (interaction.commandName === "ghostping") {
        const content = interaction.options.getString("mention") === "everyone" ? "@everyone" : "@here";
        await interaction.reply({ content: "✅ Sent.", ephemeral: true });
        const msg = await interaction.channel.send({ content, allowedMentions: { parse: ["everyone"] } });
        setTimeout(() => msg.delete().catch(() => {}), 500);
        return;
      }

      // === PINGWARN ===
      if (interaction.commandName === "pingwarn") {
        const mode = interaction.options.getString("mode");
        const role = interaction.options.getRole("role");
        const durationMs = parseDuration(interaction.options.getString("duration"));
        if (mode === "on") {
          pingWarnRoles.set(role.id, { enabled: true, timeout: null, guildId: interaction.guildId, durationMs });
          saveData();
          return interaction.reply({ content: `✅ Ping Warn ON for **${role.name}** — ${formatDuration(durationMs)}`, ephemeral: true });
        } else {
          pingWarnRoles.delete(role.id);
          saveData();
          return interaction.reply({ content: `✅ Ping Warn OFF for **${role.name}**`, ephemeral: true });
        }
      }
    }

    // === BUTTONS ===
    if (interaction.isButton()) {
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
          if (job.added % 10 === 0) interaction.message.edit({ content: `Progress: ${job.added}/${job.total}` }).catch(() => {});
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
// PREFIX COMMANDS — .find & .get ✅
// =========================
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  // ===== .find <query> — SEARCH LIBRARY =====
  if (message.content.startsWith(PREFIX + "find ")) {
    const query = message.content.slice(PREFIX.length + 5).trim();
    if (!query) return message.reply("⚠️ Usage: `.find <name>`");
    const results = searchFiles(query);
    if (results.length === 0) return message.reply("❌ No matching files found.");
    
    const embed = new EmbedBuilder()
      .setTitle(`🔍 Search results — "${query}"`)
      .setDescription(`Found **${results.length}** matching file${results.length > 1 ? "s" : ""}:\n\n` +
        results.slice(0, 15).map(f => `**${f.name}** | ID: \`${f.id}\``).join("\n") +
        (results.length > 15 ? `\n...and ${results.length - 15} more.` : ""))
      .setColor(0x808080)
      .setFooter({ text: `Total files: ${libraryFiles.length}` });
    
    return message.channel.send({ embeds: [embed] });
  }

  // ===== .get <id> — DOWNLOAD FILE BY ID =====
  if (message.content.startsWith(PREFIX + "get ")) {
    const id = message.content.slice(PREFIX.length + 4).trim();
    if (!id) return message.reply("⚠️ Usage: `.get <file_id>`");
    const file = getFileById(id);
    if (!file) return message.reply("❌ File ID not found in library.");
    
    // Send ONLY the file — NO extra text ✅
    return message.channel.send({
      content: `Here is the file with ID **${file.id}**:`,
      files: [{ attachment: file.url, name: file.name }]
    });
  }

  // ===== PING WARN =====
  if (message.mentions.everyone && message.guild) {
    for (const [roleId, config] of pingWarnRoles) {
      if (!config.enabled || config.guildId !== message.guildId) continue;
      if (!message.member?.roles.cache.has(roleId)) continue;
      const role = message.guild.roles.cache.get(roleId);
      if (!role || !role.permissions.has(PermissionFlagsBits.MentionEveryone)) continue;
      try {
        await role.setPermissions(role.permissions.remove(PermissionFlagsBits.MentionEveryone), "PingWarn");
        if (config.durationMs) {
          if (config.timeout) clearTimeout(config.timeout);
          config.timeout = setTimeout(async () => {
            const r = message.guild.roles.cache.get(roleId);
            if (r) await r.setPermissions(r.permissions.add(PermissionFlagsBits.MentionEveryone)).catch(() => {});
          }, config.durationMs);
        }
      } catch {}
      break;
    }
  }
});

// =========================
// ERROR & LOGIN
// =========================
client.on("error", e => console.error("❌ Client error:", e));
process.on("unhandledRejection", e => console.error("❌ Rejection:", e));

console.log("🔑 Logging in...");
client.login(TOKEN).catch(e => { console.error("❌ Login failed:", e); process.exit(1); });
