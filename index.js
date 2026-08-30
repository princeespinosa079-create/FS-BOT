const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");

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
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

function normalizeFilename(name) {
  return String(name || "").trim().toLowerCase();
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (e) {}
  return { allowedChannelId: null };
}

function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) { console.error("Save config error:", e); }
}

function loadLibrary() {
  try {
    if (fs.existsSync(LIBRARY_FILE)) return JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf8"));
  } catch (e) {}
  return { files: [] };
}

function saveLibrary() {
  try { fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library, null, 2)); } catch (e) { console.error("Save library error:", e); }
}

const config = loadConfig();
const library = loadLibrary();
if (!library.files) library.files = [];
const libraryFiles = library.files;

// =========================
// FILE FILTER — SKIP IMAGES & .lua
// =========================
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"];

function isImageFile(name) {
  const ext = path.extname((name || "").toLowerCase());
  return IMAGE_EXTENSIONS.includes(ext);
}

function formatSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// =========================
// ✅ SEARCH — FIXED & IMPROVED
// =========================
function searchFiles(query) {
  const q = query.toLowerCase().trim();
  if (!q || libraryFiles.length === 0) return [];

  const results = [];
  for (const file of libraryFiles) {
    const name = normalizeFilename(file.name);
    if (name.includes(q)) results.push(file);
  }
  return results;
}

// =========================
// WEB SERVER
// =========================
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("FS Bot Online"));
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 Port ${PORT}`));

// =========================
// CLIENT — INTENTS
// =========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const searchSessions = new Map();

// =========================
// SLASH COMMANDS
// =========================
const commands = [
  new SlashCommandBuilder().setName("leave").setDescription("Make bot leave a server (Owner only)")
    .addStringOption(o => o.setName("server-id").setDescription("Server ID to leave").setRequired(true)),
  new SlashCommandBuilder().setName("serverlist").setDescription("List all servers (Owner only)"),
  new SlashCommandBuilder().setName("scanchannel").setDescription("Scan channel for files")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName("channel").setDescription("Channel to scan").setRequired(true)),
  // ✅ NEW: /selectchannel — set allowed search channel
  new SlashCommandBuilder().setName("selectchannel").setDescription("Set allowed search channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o => o.setName("channel").setDescription("Channel for .fs commands").setRequired(true))
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
// ✅ SCAN CHANNEL — messageSnapshots for forwarded
// =========================
async function scanChannel(channel, interaction = null) {
  if (!channel.isTextBased()) return { added: 0, total: libraryFiles.length, scanned: 0 };
  
  if (interaction) await interaction.editReply({ content: `🔍 Scanning <#${channel.id}>...` });

  const files = [];
  let before = null;
  let totalMessages = 0;

  while (true) {
    const options = { limit: 100 };
    if (before) options.before = before;

    let batch;
    try { batch = await channel.messages.fetch(options); }
    catch (e) { await new Promise(r => setTimeout(r, 1000)); continue; }

    if (!batch.size) break;
    totalMessages += batch.size;

    for (const message of batch.values()) {
      const attachments = [];

      // Normal attachments
      if (message.attachments) {
        for (const a of message.attachments.values()) {
          attachments.push({
            name: a.name || a.filename || "file",
            url: a.url,
            size: a.size || 0,
            createdTimestamp: message.createdTimestamp,
            source: "message"
          });
        }
      }

      // ✅ Forwarded attachments — messageSnapshots
      if (message.messageSnapshots && typeof message.messageSnapshots.values === "function") {
        for (const snapshot of message.messageSnapshots.values()) {
          if (!snapshot?.attachments) continue;
          const atts = typeof snapshot.attachments.values === "function" 
            ? snapshot.attachments.values() 
            : snapshot.attachments;
          for (const a of atts) {
            attachments.push({
              name: a.name || a.filename || "file",
              url: a.url,
              size: a.size || 0,
              createdTimestamp: message.createdTimestamp,
              source: "forwarded"
            });
          }
        }
      }

      // Filter files
      for (const f of attachments) {
        const name = normalizeFilename(f.name);
        if (!name || name.endsWith(".lua") || isImageFile(f.name)) continue;
        files.push(f);
      }
    }

    before = batch.last()?.id;
    if (!before || batch.size < 100) break;
    await new Promise(r => setTimeout(r, 200));
  }

  // Deduplicate
  const unique = new Map();
  let newFiles = 0;
  for (const f of libraryFiles) unique.set(normalizeFilename(f.name), f);
  for (const f of files) {
    const key = normalizeFilename(f.name);
    if (!unique.has(key)) {
      unique.set(key, { name: f.name, url: f.url, size: f.size, timestamp: f.createdTimestamp });
      newFiles++;
    }
  }

  libraryFiles.length = 0;
  libraryFiles.push(...[...unique.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)));
  saveLibrary();

  return { added: newFiles, total: libraryFiles.length, scanned: totalMessages };
}

// =========================
// ✅ BUILD SEARCH — 1 PER PAGE, BLUE BUTTONS
// =========================
function buildSearchPage(userId, results, page = 1) {
  const totalPages = results.length;
  const file = results[page - 1];

  const content = `📄 **${file.name}**\n${formatSize(file.size)}`;

  const components = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`search_prev_${userId}_${page}`)
      .setEmoji("⬅️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setLabel(`${page}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`search_next_${userId}_${page}`)
      .setEmoji("➡️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages)
  );

  return { content, components };
}

// =========================
// INTERACTIONS
// =========================
client.on("interactionCreate", async interaction => {
  try {
    // Buttons
    if (interaction.isButton()) {
      const userId = interaction.user.id;
      if (interaction.customId.startsWith("search_prev_") || interaction.customId.startsWith("search_next_")) {
        const parts = interaction.customId.split("_");
        const targetUserId = parts[2];
        let page = parseInt(parts[3]);
        if (targetUserId !== userId) return interaction.reply({ content: "❌ Not your search.", ephemeral: true });
        const session = searchSessions.get(userId);
        if (!session) return interaction.reply({ content: "❌ Expired.", ephemeral: true });
        page = interaction.customId.includes("next") ? page + 1 : page - 1;
        const { content, components } = buildSearchPage(userId, session.results, page);
        session.page = page;
        await interaction.update({ content, components });
        return;
      }
      return;
    }

    // Slash Commands
    if (!interaction.isChatInputCommand()) return;

    // Owner only
    if ((interaction.commandName === "leave" || interaction.commandName === "serverlist") && interaction.user.id !== OWNER_ID)
      return interaction.reply({ content: "❌ Owner only.", ephemeral: true });

    if (interaction.commandName === "serverlist") {
      const list = [...client.guilds.cache.values()].map((g, i) => `${i+1}. **${g.name}** \`${g.id}\``).join("\n");
      return interaction.reply({ content: `**Servers (${client.guilds.cache.size}):**\n${list.slice(0, 4000)}`, ephemeral: true });
    }

    if (interaction.commandName === "leave") {
      const g = client.guilds.cache.get(interaction.options.getString("server-id"));
      if (!g) return interaction.reply({ content: "❌ Not found.", ephemeral: true });
      try { await g.leave(); return interaction.reply({ content: `✅ Left **${g.name}**`, ephemeral: true }); }
      catch { return interaction.reply({ content: "❌ Failed.", ephemeral: true }); }
    }

    // ✅ /selectchannel — set allowed search channel
    if (interaction.commandName === "selectchannel") {
      const channel = interaction.options.getChannel("channel");
      config.allowedChannelId = channel.id;
      saveConfig();
      return interaction.reply({ content: `✅ Search channel set to <#${channel.id}>\nAll users can use .fs / .prince / !fs / ?fs here\nOwner can use anywhere.`, ephemeral: false });
    }

    // ✅ /scanchannel
    if (interaction.commandName === "scanchannel") {
      const channel = interaction.options.getChannel("channel");
      await interaction.deferReply();
      const result = await scanChannel(channel, interaction);
      return interaction.editReply({
        content: `📁 **SCAN COMPLETE**\n**Channel:** <#${channel.id}>\n**Messages scanned:** ${result.scanned}\n**Files added:** ${result.added}\n**Total in Library:** ${result.total}`
      });
    }
  } catch (e) { console.error("❌ Interaction error:", e); }
});

// =========================
// ✅ PREFIX COMMANDS — CHANNEL LOCK + OWNER BYPASS
// =========================
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const prefixes = [".fs ", ".prince ", "!fs ", "?fs "];
  let query = null;
  for (const pfx of prefixes) {
    if (message.content.startsWith(pfx)) {
      query = message.content.slice(pfx.length).trim();
      break;
    }
  }
  if (query === null) return;

  // ✅ CHANNEL CHECK — Owner can use anywhere, others only in allowed channel
  const isOwner = message.author.id === OWNER_ID;
  if (!isOwner && config.allowedChannelId && message.channel.id !== config.allowedChannelId) {
    return message.reply({ 
      content: `❌ Search commands only work in <#${config.allowedChannelId}>`,
      allowedMentions: { repliedUser: false }
    });
  }

  if (!query) return message.reply({ content: "⚠️ Usage: `.fs <name>`", allowedMentions: { repliedUser: false } });

  // ✅ FIXED SEARCH — no more "No matches found" when files exist
  const results = searchFiles(query);
  if (results.length === 0) {
    return message.reply({ 
      content: `❌ No matches found for \"${query}\"\nTotal files in library: ${libraryFiles.length}`,
      allowedMentions: { repliedUser: false }
    });
  }

  searchSessions.set(message.author.id, { results, page: 1 });
  const { content, components } = buildSearchPage(message.author.id, results, 1);
  return message.channel.send({ content, components, allowedMentions: { repliedUser: false } });
});

// =========================
// ERROR & LOGIN
// =========================
client.on("error", e => console.error("❌ Client error:", e));
process.on("unhandledRejection", e => console.error("❌ Rejection:", e));

console.log("🔑 Logging in...");
client.login(TOKEN).catch(e => { console.error("❌ Login failed:", e); process.exit(1); });
