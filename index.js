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
// DATA FILES
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
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (e) {}
}

function loadLibrary() {
  try {
    if (fs.existsSync(LIBRARY_FILE)) return JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf8"));
  } catch (e) {}
  return { files: [] };
}

function saveLibrary() {
  try { fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library, null, 2)); } catch (e) {}
}

const config = loadConfig();
const library = loadLibrary();
if (!library.files) library.files = [];
const libraryFiles = library.files;

// =========================
// HELPERS
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
// ✅ SEARCH — FIXED & SIMPLE
// =========================
function searchFiles(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  if (libraryFiles.length === 0) {
    console.log("📚 Library is empty! Total files: 0");
    return [];
  }
  console.log(`🔍 Searching for: "${q}" in ${libraryFiles.length} files`);
  const results = libraryFiles.filter(file => 
    normalizeFilename(file.name).includes(q)
  );
  console.log(`✅ Found ${results.length} matches`);
  return results;
}

// =========================
// CLIENT SETUP
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
  new SlashCommandBuilder().setName("selectchannel").setDescription("Set allowed search channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o => o.setName("channel").setDescription("Channel for .fs commands").setRequired(true)),
  new SlashCommandBuilder().setName("scanchannel").setDescription("Scan channel for files")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName("channel").setDescription("Channel to scan").setRequired(true)),
  new SlashCommandBuilder().setName("leave").setDescription("Leave server (Owner only)")
    .addStringOption(o => o.setName("server-id").setRequired(true)),
  new SlashCommandBuilder().setName("serverlist").setDescription("List servers (Owner only)")
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
  console.log(`📚 Library loaded: ${libraryFiles.length} files`);
  console.log(`🔗 Allowed channel: ${config.allowedChannelId || "Not set"}`);
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

    for (const msg of batch.values()) {
      const atts = [];
      // Normal attachments
      for (const a of msg.attachments.values()) {
        atts.push({ name: a.name, url: a.url, size: a.size, ts: msg.createdTimestamp });
      }
      // Forwarded attachments
      if (msg.messageSnapshots) {
        for (const snap of msg.messageSnapshots.values?.() || []) {
          for (const a of snap.attachments?.values?.() || snap.attachments || []) {
            atts.push({ name: a.name, url: a.url, size: a.size, ts: msg.createdTimestamp });
          }
        }
      }
      // Filter
      for (const f of atts) {
        const n = normalizeFilename(f.name);
        if (!n || n.endsWith(".lua") || isImageFile(f.name)) continue;
        files.push(f);
      }
    }
    before = batch.last()?.id;
    if (!before || batch.size < 100) break;
    await new Promise(r => setTimeout(r, 200));
  }

  // Deduplicate
  const unique = new Map();
  for (const f of libraryFiles) unique.set(normalizeFilename(f.name), f);
  let newCount = 0;
  for (const f of files) {
    const key = normalizeFilename(f.name);
    if (!unique.has(key)) {
      unique.set(key, { name: f.name, url: f.url, size: f.size, timestamp: f.ts });
      newCount++;
    }
  }
  libraryFiles.length = 0;
  libraryFiles.push(...[...unique.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)));
  saveLibrary();
  console.log(`✅ Scan done: +${newCount} new, total ${libraryFiles.length}`);
  return { added: newCount, total: libraryFiles.length, scanned: totalMessages };
}

// =========================
// ✅ BUILD SEARCH — 1 PER PAGE
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
// ✅ INTERACTIONS
// =========================
client.on("interactionCreate", async interaction => {
  try {
    // Buttons
    if (interaction.isButton()) {
      const userId = interaction.user.id;
      if (interaction.customId.startsWith("search_")) {
        const [, dir, targetId, pageStr] = interaction.customId.split("_");
        if (targetId !== userId) return interaction.reply({ content: "❌ Not yours.", ephemeral: true });
        const session = searchSessions.get(userId);
        if (!session) return interaction.reply({ content: "❌ Expired.", ephemeral: true });
        let page = parseInt(pageStr);
        page = dir === "next" ? page + 1 : page - 1;
        const { content, components } = buildSearchPage(userId, session.results, page);
        session.page = page;
        await interaction.update({ content, components });
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

    // ✅ /selectchannel
    if (interaction.commandName === "selectchannel") {
      const channel = interaction.options.getChannel("channel");
      config.allowedChannelId = channel.id;
      saveConfig();
      return interaction.reply({ 
        content: `✅ **Search channel set!**\n🔗 Channel: <#${channel.id}>\n👥 All users: .fs / .prince / !fs / ?fs here\n👑 Owner: works everywhere`,
        ephemeral: false 
      });
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
// ✅ PREFIX COMMANDS — FIXED & SIMPLE
// =========================
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  console.log(`📩 Message: ${message.content} from ${message.author.username}`);

  const prefixes = [".fs ", ".prince ", "!fs ", "?fs "];
  let query = null;
  for (const pfx of prefixes) {
    if (message.content.startsWith(pfx)) {
      query = message.content.slice(pfx.length).trim();
      break;
    }
  }
  if (query === null) return;

  console.log(`🔍 Command triggered: query="${query}"`);

  // Channel check
  const isOwner = message.author.id === OWNER_ID;
  if (!isOwner && config.allowedChannelId && message.channel.id !== config.allowedChannelId) {
    return message.reply(`❌ Use search commands in <#${config.allowedChannelId}>`);
  }

  if (!query) return message.reply("⚠️ Usage: `.fs <name>`");

  // Search
  const results = searchFiles(query);
  if (results.length === 0) {
    return message.reply(`❌ No matches for \"${query}\"\n📚 Total files: ${libraryFiles.length}`);
  }

  // Send result
  searchSessions.set(message.author.id, { results, page: 1 });
  const { content, components } = buildSearchPage(message.author.id, results, 1);
  await message.channel.send({ content, components });
  console.log(`✅ Sent result to ${message.author.username}`);
});

// =========================
// ERROR & LOGIN
// =========================
client.on("error", e => console.error("❌ Client error:", e));
process.on("unhandledRejection", e => console.error("❌ Rejection:", e));

console.log("🔑 Logging in...");
client.login(TOKEN).catch(e => { console.error("❌ Login failed:", e); process.exit(1); });
