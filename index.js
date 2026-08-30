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
const crypto = require("crypto");

// =========================
// CONFIG
// =========================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = "1302080645987569694";

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID");
  process.exit(1);
}

// =========================
// DATA & FILE LIBRARY
// =========================
const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;
const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

function normalizeFilename(name) {
  return String(name || "").trim().toLowerCase();
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {}
  return { pingWarn: {} };
}

function loadLibrary() {
  try {
    if (fs.existsSync(LIBRARY_FILE)) return JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf8"));
  } catch (e) {}
  return { files: [] };
}

function saveLibrary() {
  try { fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library, null, 2)); } catch (e) { console.error("Save error:", e); }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      pingWarn: Object.fromEntries([...pingWarnRoles].map(([k, v]) => [k, { ...v }]))
    }, null, 2));
  } catch (e) {}
}

const library = loadLibrary();
if (!library.files) library.files = [];
const libraryFiles = library.files;
const saved = loadData();

// =========================
// FILE FILTER — SKIP IMAGES & .lua ✅
// =========================
const IMAGE_MIME_REGEX = /^image\//i;
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"];

function isImageFile(name, contentType) {
  if (contentType && IMAGE_MIME_REGEX.test(contentType)) return true;
  const ext = path.extname((name || "").toLowerCase());
  return IMAGE_EXTENSIONS.includes(ext);
}

function generateFileId() {
  return Math.random().toString(36).slice(2, 8);
}
function fileExistsByName(name) { 
  const key = normalizeFilename(name);
  return libraryFiles.some(f => normalizeFilename(f.name) === key); 
}

// =========================
// ✅ SMART SEARCH — PRIORITY SYSTEM
// =========================
function searchFiles(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const exactMatches = [], startsWithMatches = [], includesMatches = [], relatedMatches = [];
  const qWords = q.split(/\s+/);
  const qNoSpecial = q.replace(/[^a-z0-9]/g, "");

  for (const file of libraryFiles) {
    const name = file.name.toLowerCase();
    const nameNoSpecial = name.replace(/[^a-z0-9]/g, "");

    if (name === q || nameNoSpecial === qNoSpecial || name === q + ".txt") {
      exactMatches.push(file);
      continue;
    }
    if (name.startsWith(q) || nameNoSpecial.startsWith(qNoSpecial)) {
      startsWithMatches.push(file);
      continue;
    }
    if (name.includes(q) || nameNoSpecial.includes(qNoSpecial)) {
      includesMatches.push(file);
      continue;
    }
    let score = 0;
    for (const word of qWords) if (name.includes(word)) score++;
    if (score > 0) relatedMatches.push({ file, score });
  }

  relatedMatches.sort((a, b) => b.score - a.score);
  return [...exactMatches, ...startsWithMatches, ...includesMatches, ...relatedMatches.map(r => r.file)];
}

// =========================
// WEB SERVER
// =========================
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("FS Bot Online"));
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 Port ${PORT}`));

// =========================
// CLIENT — INTENTS ✅
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
// STATE
// =========================
const pingWarnRoles = new Map(Object.entries(saved.pingWarn || {}));
const roleJobs = new Map();
const searchSessions = new Map();

// =========================
// HELPERS
// =========================
function parseDuration(str) {
  if (!str) return null;
  let total = 0;
  str.toLowerCase().match(/(\d+)\s*(s|m|h|d)/g)?.forEach(p => {
    const [, n, u] = p.match(/(\d+)\s*(s|m|h|d)/);
    total += parseInt(n) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[u];
  });
  return total || null;
}

// =========================
// SLASH COMMANDS — /scanchannel ✅
// =========================
const commands = [
  new SlashCommandBuilder().setName("leave").setDescription("Make bot leave a server (Owner only)")
    .addStringOption(o => o.setName("server-id").setDescription("Server ID to leave").setRequired(true)),
  new SlashCommandBuilder().setName("serverlist").setDescription("List all servers (Owner only)"),
  new SlashCommandBuilder().setName("spylist").setDescription("List spies/alts & new accounts")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("role").setDescription("Manage roles")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub => sub.setName("add").setDescription("Add role to user")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
      .addRoleOption(o => o.setName("role").setDescription("Role to add").setRequired(true))
      .addStringOption(o => o.setName("duration").setDescription("Auto-remove time (e.g. 1h)")))
    .addSubcommand(sub => sub.setName("all").setDescription("Add role to everyone")
      .addRoleOption(o => o.setName("role").setDescription("Role to add").setRequired(true))),
  new SlashCommandBuilder().setName("embed").setDescription("Send gray embed")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName("description").setDescription("Embed text").setRequired(true))
    .addStringOption(o => o.setName("title").setDescription("Embed title")),
  new SlashCommandBuilder().setName("ghostping").setDescription("Ghost ping everyone/here")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName("mention").setDescription("Who to ping").setRequired(true)
      .addChoices({ name: "@everyone", value: "everyone" }, { name: "@here", value: "here" })),
  new SlashCommandBuilder().setName("pingwarn").setDescription("Ping warn config")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption(o => o.setName("mode").setDescription("ON/OFF").setRequired(true)
      .addChoices({ name: "ON", value: "on" }, { name: "OFF", value: "off" }))
    .addRoleOption(o => o.setName("role").setDescription("Role to watch").setRequired(true))
    .addStringOption(o => o.setName("duration").setDescription("Penalty duration")),
  new SlashCommandBuilder().setName("scanchannel").setDescription("Scan ALL messages including forwarded")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName("channel").setDescription("Channel to scan").setRequired(true))
].map(c => c.toJSON());

// =========================
// REGISTER COMMANDS
// =========================
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ Commands registered");
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

// =========================
// ✅ SCAN CHANNEL — YOUR LOGIC WITH messageSnapshots ✅
// =========================
async function scanChannel(channel, interaction = null) {
  if (!channel.isTextBased()) return { added: 0, total: libraryFiles.length, scanned: 0 };
  
  if (interaction) await interaction.editReply({ 
    content: `🔍 **Scanning started** — this may take a while...\n> Channel: <#${channel.id}>\n> Scanning: forwarded, attachments, all files` 
  });

  const files = [];
  let before = null;
  let totalMessages = 0;

  console.log(`🚀 STARTING SCAN — Channel: ${channel.name} (${channel.id})`);

  while (true) {
    const options = { limit: 100 };
    if (before) options.before = before;

    let batch;
    try {
      batch = await channel.messages.fetch(options);
    } catch (e) {
      console.error("Fetch error:", e.message);
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    if (!batch.size) break;
    totalMessages += batch.size;

    for (const message of batch.values()) {
      const attachments = [];

      // ==============================================
      // ✅ NORMAL ATTACHMENTS
      // ==============================================
      if (message.attachments) {
        for (const attachment of message.attachments.values()) {
          attachments.push({
            id: attachment.id,
            name: attachment.name || attachment.filename || "file",
            url: attachment.url,
            size: attachment.size || 0,
            messageId: message.id,
            channelId: message.channelId,
            createdTimestamp: message.createdTimestamp,
            source: "message"
          });
        }
      }

      // ==============================================
      // ✅ FORWARDED MESSAGE ATTACHMENTS — messageSnapshots
      // ==============================================
      if (message.messageSnapshots && typeof message.messageSnapshots.values === "function") {
        for (const snapshot of message.messageSnapshots.values()) {
          if (!snapshot) continue;

          const snapshotAttachments = snapshot.attachments;

          if (snapshotAttachments && typeof snapshotAttachments.values === "function") {
            for (const attachment of snapshotAttachments.values()) {
              attachments.push({
                id: `forwarded-${attachment.id}`,
                name: attachment.name || attachment.filename || "file",
                url: attachment.url,
                size: attachment.size || 0,
                messageId: message.id,
                channelId: message.channelId,
                createdTimestamp: message.createdTimestamp,
                source: "forwarded"
              });
            }
          } else if (Array.isArray(snapshotAttachments)) {
            for (const attachment of snapshotAttachments) {
              attachments.push({
                id: `forwarded-${attachment.id}`,
                name: attachment.name || attachment.filename || "file",
                url: attachment.url,
                size: attachment.size || 0,
                messageId: message.id,
                channelId: message.channelId,
                createdTimestamp: message.createdTimestamp,
                source: "forwarded"
              });
            }
          }
        }
      }

      // ==============================================
      // ✅ PROCESS ATTACHMENTS — Skip .lua & images
      // ==============================================
      for (const file of attachments) {
        const filename = String(file.name || "").trim();
        
        // Skip .lua files
        if (filename.toLowerCase().endsWith(".lua")) continue;
        // Skip images
        if (isImageFile(filename)) continue;
        if (!filename) continue;

        files.push(file);
      }
    }

    const oldestMessage = batch.last();
    if (!oldestMessage) break;
    before = oldestMessage.id;
    if (batch.size < 100) break;

    await new Promise(r => setTimeout(r, 200));
  }

  // ==============================================
  // ✅ DEDUPLICATE by filename (case-insensitive)
  // ==============================================
  const uniqueByName = new Map();
  let newFiles = 0;
  let duplicateFiles = 0;

  // Keep existing files first
  for (const file of libraryFiles) {
    const key = normalizeFilename(file.name);
    if (!key) continue;
    if (!uniqueByName.has(key)) uniqueByName.set(key, file);
  }

  // Add new files, skip duplicates
  for (const file of files) {
    const key = normalizeFilename(file.name);
    if (!key) continue;
    if (key.endsWith(".lua")) continue;
    if (isImageFile(file.name)) continue;

    if (uniqueByName.has(key)) {
      duplicateFiles++;
      continue;
    }

    uniqueByName.set(key, {
      id: generateFileId(),
      name: file.name,
      url: file.url,
      size: file.size,
      channelId: file.channelId,
      messageId: file.messageId,
      timestamp: file.createdTimestamp,
      source: file.source
    });
    newFiles++;
    console.log(`✅ [${file.source}] Added: ${file.name}`);
  }

  // Replace library with sorted unique files
  const sortedFiles = [...uniqueByName.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  libraryFiles.length = 0;
  libraryFiles.push(...sortedFiles);
  saveLibrary();

  console.log(`✅ SCAN FINISHED — Messages: ${totalMessages} | New: ${newFiles} | Duplicates: ${duplicateFiles} | Total Files: ${libraryFiles.length}`);
  
  return { added: newFiles, total: libraryFiles.length, scanned: totalMessages };
}

// =========================
// PAGINATION — NO ID IN OUTPUT ✅
// =========================
function buildSearchPage(userId, results, page = 1) {
  const pageSize = 10;
  const totalPages = Math.ceil(results.length / pageSize);
  const start = (page - 1) * pageSize;
  const pageResults = results.slice(start, start + pageSize);

  const embed = new EmbedBuilder()
    .setDescription(pageResults.map((f, i) => `**${start + i + 1}. ${f.name}**`).join("\n"))
    .setColor(0x808080);

  const components = totalPages > 1 ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`search_prev_${userId}_${page}`)
      .setEmoji("⬅️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`search_next_${userId}_${page}`)
      .setEmoji("➡️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages)
  )] : [];

  return { embed, components, totalPages, currentPage: page };
}

// =========================
// INTERACTIONS
// =========================
client.on("interactionCreate", async interaction => {
  try {
    // === BUTTONS ===
    if (interaction.isButton()) {
      const userId = interaction.user.id;

      if (interaction.customId.startsWith("search_prev_") || interaction.customId.startsWith("search_next_")) {
        const parts = interaction.customId.split("_");
        const targetUserId = parts[2];
        let page = parseInt(parts[3]);
        
        if (targetUserId !== userId) return interaction.reply({ content: "❌ Not your search.", ephemeral: true });
        const session = searchSessions.get(userId);
        if (!session) return interaction.reply({ content: "❌ Session expired. Try again.", ephemeral: true });

        if (interaction.customId.includes("next")) page++;
        else page--;

        const { embed, components } = buildSearchPage(userId, session.results, page);
        session.page = page;
        searchSessions.set(userId, session);
        await interaction.update({ embeds: [embed], components });
        return;
      }

      if (interaction.customId.startsWith("roleall_start_")) {
        const roleId = interaction.customId.split("_")[2];
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role || roleJobs.get(interaction.guildId)) return;
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
        return;
      }

      if (interaction.customId === "roleall_stop") {
        if (roleJobs.get(interaction.guildId)) roleJobs.get(interaction.guildId).stopped = true;
        await interaction.message.delete().catch(() => {});
        return interaction.reply({ content: "🛑 Stopped.", ephemeral: true });
      }
      return;
    }

    // === SLASH COMMANDS ===
    if (!interaction.isChatInputCommand()) return;

    if ((interaction.commandName === "leave" || interaction.commandName === "serverlist") && interaction.user.id !== OWNER_ID)
      return interaction.reply({ content: "❌ Owner only.", ephemeral: true });

    if (interaction.commandName === "serverlist") {
      await interaction.deferReply({ ephemeral: true });
      const guilds = [...client.guilds.cache.values()];
      const desc = `**Total:** ${guilds.length}\n\n` + guilds.map((g, i) => `${i + 1}. **${g.name}** — \`${g.id}\``).join("\n").slice(0, 4000);
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("SERVER LIST").setDescription(desc).setColor(0x808080)] });
    }

    if (interaction.commandName === "leave") {
      const g = client.guilds.cache.get(interaction.options.getString("server-id"));
      if (!g) return interaction.reply({ content: "❌ Not found.", ephemeral: true });
      try { await g.leave(); return interaction.reply({ content: `✅ Left **${g.name}**`, ephemeral: true }); }
      catch { return interaction.reply({ content: "❌ Failed.", ephemeral: true }); }
    }

    if (interaction.commandName === "scanchannel") {
      const channel = interaction.options.getChannel("channel");
      await interaction.deferReply();
      const result = await scanChannel(channel, interaction);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle("📁 SCAN COMPLETE")
          .setDescription(`**Channel:** <#${channel.id}>\n**Messages scanned:** ${result.scanned}\n**Files added:** ${result.added}\n**Total in Library:** ${result.total}`)
          .setColor(0x808080)]
      });
    }

    if (interaction.commandName === "spylist") {
      await interaction.deferReply();
      await interaction.guild.members.fetch();
      const day20 = Date.now() - 20 * 86400000;
      const spies = [], newAccs = [];
      for (const m of interaction.guild.members.cache.values()) {
        if (m.user.bot) continue;
        const n = (m.user.username + " " + (m.nickname || "")).toLowerCase();
        if (n.includes("alt") || n.includes("spy")) spies.push(`<@${m.id}> \`${m.user.tag}\``);
        if (m.user.createdTimestamp >= day20) newAccs.push(`<@${m.id}> \`${m.user.tag}\``);
      }
      return interaction.editReply({
        embeds: [
          new EmbedBuilder().setTitle(`SPY/ALT LIST (${spies.length})`).setDescription(spies.join("\n") || "None").setColor(0x808080),
          new EmbedBuilder().setTitle(`NEW ACCOUNTS (${newAccs.length})`).setDescription(newAccs.join("\n") || "None").setColor(0x808080)
        ]
      });
    }

    if (interaction.commandName === "role") {
      const sub = interaction.options.getSubcommand();
      const role = interaction.options.getRole("role");
      if (sub === "add") {
        const user = interaction.options.getUser("user");
        const member = await interaction.guild.members.fetch(user.id);
        const dur = parseDuration(interaction.options.getString("duration"));
        await member.roles.add(role);
        if (dur) setTimeout(() => member.roles.remove(role).catch(() => {}), dur);
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

    if (interaction.commandName === "embed") {
      const embed = new EmbedBuilder().setDescription(interaction.options.getString("description")).setColor(0x808080);
      if (interaction.options.getString("title")) embed.setTitle(interaction.options.getString("title"));
      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply();
      return interaction.channel.send({ embeds: [embed] });
    }

    if (interaction.commandName === "ghostping") {
      const content = interaction.options.getString("mention") === "everyone" ? "@everyone" : "@here";
      await interaction.reply({ content: "✅ Sent.", ephemeral: true });
      const msg = await interaction.channel.send({ content, allowedMentions: { parse: ["everyone"] } });
      setTimeout(() => msg.delete().catch(() => {}), 500);
    }

    if (interaction.commandName === "pingwarn") {
      const mode = interaction.options.getString("mode");
      const role = interaction.options.getRole("role");
      if (mode === "on") {
        pingWarnRoles.set(role.id, { enabled: true, guildId: interaction.guildId, durationMs: parseDuration(interaction.options.getString("duration")) });
        saveData();
        return interaction.reply({ content: `✅ Ping Warn ON for **${role.name}**`, ephemeral: true });
      } else {
        pingWarnRoles.delete(role.id);
        saveData();
        return interaction.reply({ content: `✅ Ping Warn OFF for **${role.name}**`, ephemeral: true });
      }
    }
  } catch (e) { console.error("❌ Error:", e); }
});

// =========================
// PREFIX COMMANDS — .fs / .prince / !fs / ?fs ✅ | NO IDs ✅
// =========================
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  // ✅ ALL ALIASES work
  const prefixes = [".fs ", ".prince ", "!fs ", "?fs "];
  let query = null;
  
  for (const pfx of prefixes) {
    if (message.content.startsWith(pfx)) {
      query = message.content.slice(pfx.length).trim();
      break;
    }
  }
  
  if (query !== null) {
    if (!query) return message.reply("⚠️ Usage: `.fs <name>`");
    
    const results = searchFiles(query);
    if (results.length === 0) return message.reply("❌ No matches found.");

    searchSessions.set(message.author.id, { results, page: 1 });
    const { embed, components } = buildSearchPage(message.author.id, results, 1);
    return message.channel.send({ embeds: [embed], components });
  }

  // ===== PING WARN =====
  if (message.mentions.everyone && message.guild) {
    for (const [roleId, config] of pingWarnRoles) {
      if (!config.enabled || config.guildId !== message.guildId) continue;
      if (!message.member?.roles.cache.has(roleId)) continue;
      const role = message.guild.roles.cache.get(roleId);
      if (!role || !role.permissions.has(PermissionFlagsBits.MentionEveryone)) continue;
      try {
        await role.setPermissions(role.permissions.remove(PermissionFlagsBits.MentionEveryone));
        if (config.durationMs) setTimeout(async () => {
          const r = message.guild.roles.cache.get(roleId);
          if (r) r.setPermissions(r.permissions.add(PermissionFlagsBits.MentionEveryone)).catch(() => {});
        }, config.durationMs);
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
