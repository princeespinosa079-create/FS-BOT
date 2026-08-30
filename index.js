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
// CONFIG
// =========================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = "1302080645987569694";
const SCAN_ROLE_ID = "1509953862226935948";

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID");
  process.exit(1);
}

// =========================
// EXPRESS — PORT FIX
// =========================
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("FS Bot Online"));
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 Port ${PORT} open`));

// =========================
// DATA
// =========================
const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;
const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

function normalizeFilename(name) {
  return String(name || "").trim().toLowerCase();
}

function generateId() {
  return Math.random().toString(36).substring(2, 8);
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (e) {}
  return { allowedChannelId: null };
}

function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) {}
}

function loadLibrary() {
  try {
    if (fs.existsSync(LIBRARY_FILE)) {
      const data = JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf8"));
      if (!data.files) data.files = [];
      for (const f of data.files) if (!f.id) f.id = generateId();
      return data;
    }
  } catch (e) {}
  return { files: [] };
}

function saveLibrary() {
  try { fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library, null, 2)); } catch (e) {}
}

const config = loadConfig();
const library = loadLibrary();
const libraryFiles = library.files;
saveLibrary();

// =========================
// HELPERS
// =========================
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"];
function isImageFile(name) {
  const ext = path.extname((name || "").toLowerCase());
  return IMAGE_EXTENSIONS.includes(ext);
}

// PH Time
function getTimePH() {
  const now = new Date();
  const ph = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return ph.toISOString().slice(11, 16);
}

// =========================
// SMART SEARCH
// =========================
function searchFiles(query) {
  const q = query.toLowerCase().trim();
  if (!q || libraryFiles.length === 0) return [];

  const qWords = q.split(/\s+/);
  const qNoSpecial = q.replace(/[^a-z0-9]/g, "");
  const exactMatches = [], allWordsMatches = [], anyWordMatches = [];

  for (const file of libraryFiles) {
    const name = normalizeFilename(file.name);
    const nameNoSpecial = name.replace(/[^a-z0-9]/g, "");

    if (name === q || nameNoSpecial === qNoSpecial || 
        name.startsWith(q + ".") || nameNoSpecial.startsWith(qNoSpecial + ".")) {
      exactMatches.push(file);
      continue;
    }

    let allWords = true;
    for (const word of qWords) {
      if (!name.includes(word)) { allWords = false; break; }
    }
    if (allWords && qWords.length > 1) { allWordsMatches.push(file); continue; }

    for (const word of qWords) {
      if (name.includes(word)) { anyWordMatches.push(file); break; }
    }
  }
  return [...exactMatches, ...allWordsMatches, ...anyWordMatches];
}

function getFileById(id) {
  return libraryFiles.find(file => file.id === id);
}

// =========================
// PAGINATION
// =========================
const searchSessions = new Map();

// =========================
// CLIENT
// =========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// =========================
// SLASH COMMANDS
// =========================
const commands = [
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Owner only: Set allowed channel for .find and .get"),
  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription("Scan channel for files")
    .addChannelOption(o => o.setName("channel").setDescription("Channel to scan").setRequired(true)),
  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a gray embed")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName("description").setDescription("Embed text").setRequired(true))
    .addStringOption(o => o.setName("title").setDescription("Optional title").setRequired(false)),
  new SlashCommandBuilder().setName("serverlist").setDescription("Owner only: list all servers"),
  new SlashCommandBuilder().setName("leave").setDescription("Owner only: leave a server")
    .addStringOption(o => o.setName("server-id").setDescription("Server ID").setRequired(true))
].map(c => c.toJSON());

// =========================
// REGISTER
// =========================
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ Commands registered");
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📚 Library: ${libraryFiles.length} files`);
  await registerCommands();
});

// =========================
// SCAN CHANNEL
// =========================
async function scanChannel(channel, interaction = null) {
  if (!channel.isTextBased()) return { added: 0, total: libraryFiles.length, scanned: 0 };
  if (interaction) await interaction.editReply({ content: `🔍 Scanning <#${channel.id}> — please wait...` });

  const foundFiles = [];
  let before = null, scanned = 0;

  while (true) {
    const options = { limit: 100 };
    if (before) options.before = before;
    let batch;
    try { batch = await channel.messages.fetch(options); }
    catch (e) { await new Promise(r => setTimeout(r, 500)); continue; }
    if (!batch.size) break;
    scanned += batch.size;

    for (const msg of batch.values()) {
      for (const a of msg.attachments.values()) {
        const n = normalizeFilename(a.name);
        if (!n || isImageFile(a.name)) continue;
        foundFiles.push({ name: a.name, url: a.url, size: a.size, ts: msg.createdTimestamp });
      }
      if (msg.messageSnapshots) {
        const snapshots = Array.isArray(msg.messageSnapshots) ? msg.messageSnapshots : [...(msg.messageSnapshots.values?.() || [])];
        for (const snap of snapshots) {
          if (!snap?.attachments) continue;
          const atts = typeof snap.attachments.values === "function" ? snap.attachments.values() : Array.isArray(snap.attachments) ? snap.attachments : [];
          for (const a of atts) {
            const n = normalizeFilename(a.name);
            if (!n || isImageFile(a.name)) continue;
            foundFiles.push({ name: a.name, url: a.url, size: a.size, ts: msg.createdTimestamp });
          }
        }
      }
    }
    before = batch.last()?.id;
    if (!before || batch.size < 100) break;
    await new Promise(r => setTimeout(r, 150));
  }

  const unique = new Map();
  for (const f of libraryFiles) unique.set(normalizeFilename(f.name), f);
  let newCount = 0;
  for (const f of foundFiles) {
    const key = normalizeFilename(f.name);
    if (!unique.has(key)) {
      unique.set(key, { id: generateId(), name: f.name, url: f.url, size: f.size, timestamp: f.ts });
      newCount++;
    }
  }
  libraryFiles.length = 0;
  libraryFiles.push(...[...unique.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)));
  saveLibrary();
  return { added: newCount, total: libraryFiles.length, scanned };
}

// =========================
// ✅ 15 LINES PER PAGE — filename │ ID lines ONLY
// =========================
function buildSearchPage(userId, results, page = 1) {
  const perPage = 15; // ✅ EXACTLY 15 lines per page
  const totalPages = Math.ceil(results.length / perPage);
  const start = (page - 1) * perPage;
  const display = results.slice(start, start + perPage);

  // ✅ Each line = `filename │ ID: abc123` — MAX 15 LINES
  const desc = display.map(f => `\`${f.name}\` │ ID: \`${f.id}\``).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Finder Source Results")
    .setColor(0x808080)
    .setDescription(desc)
    .setFooter({ text: `Page ${page}/${totalPages} │ Today at ${getTimePH()}` });

  const components = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`search_back_${userId}_${page}`)
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary) // GRAY
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`search_next_${userId}_${page}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Success) // GREEN
      .setDisabled(page >= totalPages)
  );
  return { embeds: [embed], components: [components] };
}

// =========================
// INTERACTIONS
// =========================
client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton()) {
      const userId = interaction.user.id;
      if (interaction.customId.startsWith("search_")) {
        const parts = interaction.customId.split("_");
        const direction = parts[1], targetUserId = parts[2], page = parseInt(parts[3]);
        if (targetUserId !== userId) return interaction.reply({ content: "❌ Not your search, idiot.", ephemeral: true });
        const session = searchSessions.get(userId);
        if (!session) return interaction.reply({ content: "❌ Search expired. Use .find again.", ephemeral: true });
        const newPage = direction === "next" ? page + 1 : page - 1;
        searchSessions.set(userId, { ...session, page: newPage });
        await interaction.update(buildSearchPage(userId, session.results, newPage));
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const ownerOnly = ["leave", "serverlist", "setchannel"];
    if (ownerOnly.includes(interaction.commandName) && interaction.user.id !== OWNER_ID)
      return interaction.reply({ content: "❌ Owner only, idiot.", ephemeral: true });

    if (interaction.commandName === "scanchannel") {
      const isOwner = interaction.user.id === OWNER_ID;
      const hasRole = interaction.member?.roles?.cache?.has(SCAN_ROLE_ID);
      if (!isOwner && !hasRole) return interaction.reply({ content: "❌ You need the scan role, idiot.", ephemeral: true });
      const channel = interaction.options.getChannel("channel");
      await interaction.deferReply();
      const r = await scanChannel(channel);
      return interaction.editReply({ content: `📁 **SCAN COMPLETE**\n**Channel:** <#${channel.id}>\n**Scanned:** ${r.scanned}\n**Added:** ${r.added}\n**Total:** ${r.total}` });
    }

    if (interaction.commandName === "serverlist") {
      const list = [...client.guilds.cache.values()].map((g, i) => `${i+1}. **${g.name}** \`${g.id}\``).join("\n");
      return interaction.reply({ content: `**Servers (${client.guilds.cache.size}):**\n${list.slice(0, 4000)}`, ephemeral: true });
    }

    if (interaction.commandName === "leave") {
      const g = client.guilds.cache.get(interaction.options.getString("server-id"));
      if (!g) return interaction.reply({ content: "❌ Server not found.", ephemeral: true });
      try { await g.leave(); return interaction.reply({ content: `✅ Left **${g.name}**`, ephemeral: true }); }
      catch { return interaction.reply({ content: "❌ Failed to leave.", ephemeral: true }); }
    }

    if (interaction.commandName === "setchannel") {
      config.allowedChannelId = interaction.channelId;
      saveConfig();
      return interaction.reply({ content: `✅ **Channel Set!**\n🔗 Allowed: <#${interaction.channelId}>`, ephemeral: false });
    }

    if (interaction.commandName === "embed") {
      const desc = interaction.options.getString("description");
      const title = interaction.options.getString("title");
      const embed = new EmbedBuilder().setColor(0x808080).setDescription(desc);
      if (title) embed.setTitle(title);
      embed.setFooter({ text: `Today at ${getTimePH()}` });
      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply();
      return interaction.channel.send({ embeds: [embed] });
    }
  } catch (e) { console.error("❌ Interaction error:", e); }
});

// =========================
// PREFIX COMMANDS
// =========================
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  const isOwner = message.author.id === OWNER_ID;
  const allowed = isOwner || !config.allowedChannelId || message.channel.id === config.allowedChannelId;

  if (message.content.startsWith(".find ")) {
    if (!allowed) return message.reply("❌ Not here, idiot.");
    const query = message.content.slice(6).trim();
    if (!query) return message.reply("❌ No match file for that, idiot.");
    const results = searchFiles(query);
    if (results.length === 0) return message.reply("❌ No match file for that, idiot.");
    searchSessions.set(message.author.id, { results, page: 1 });
    return message.reply(buildSearchPage(message.author.id, results, 1));
  }

  if (message.content.startsWith(".get")) {
    if (!allowed) return message.reply("❌ Not here, idiot.");
    const id = message.content.slice(4).trim();
    if (!id) return message.reply("❌ Put ID of File, idiot.");
    const file = getFileById(id);
    if (!file) return message.reply("❌ No match file for that, idiot.");
    await message.channel.send({
      content: `<@${message.author.id}> Here is the file twin!`,
      files: [{ attachment: file.url, name: file.name }]
    });
  }
});

// =========================
// LOGIN
// =========================
client.on("error", e => console.error("❌ Client error:", e));
process.on("unhandledRejection", e => console.error("❌ Rejection:", e));
console.log("🔑 Logging in...");
client.login(TOKEN).catch(e => { console.error("❌ Login failed:", e); process.exit(1); });
