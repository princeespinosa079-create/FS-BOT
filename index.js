const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
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
// DATA FILES — FRESH START
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
      // Assign IDs to files missing them
      for (const f of data.files) if (!f.id) f.id = generateId();
      return data;
    }
  } catch (e) { console.log("⚠️ Library empty or corrupted, starting fresh..."); }
  return { files: [] };
}

function saveLibrary() {
  try { fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library, null, 2)); } catch (e) {}
}

// ✅ START FRESH — NO FAKE 394 COUNT
const config = loadConfig();
const library = loadLibrary();
const libraryFiles = library.files;
saveLibrary(); // Save any new IDs

// =========================
// HELPERS
// =========================
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"];
function isImageFile(name) {
  const ext = path.extname((name || "").toLowerCase());
  return IMAGE_EXTENSIONS.includes(ext);
}

// =========================
// SEARCH & GET — FAST
// =========================
function searchFiles(query) {
  const q = query.toLowerCase().trim();
  if (!q || libraryFiles.length === 0) return [];
  return libraryFiles.filter(file => normalizeFilename(file.name).includes(q));
}

function getFileById(id) {
  return libraryFiles.find(file => file.id === id);
}

// =========================
// CLIENT — FAST RESPONSE
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
    .setName("selectchannel")
    .setDescription("Set allowed channel for .find and .get")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o => o.setName("channel").setDescription("Allowed channel").setRequired(true)),
  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription("Scan channel and build file library")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName("channel").setDescription("Channel to scan").setRequired(true)),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Owner only: leave server")
    .addStringOption(o => o.setName("server-id").setDescription("Server ID").setRequired(true)),
  new SlashCommandBuilder().setName("serverlist").setDescription("Owner only: list all servers")
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
  console.log(`📚 Library: ${libraryFiles.length} files (loaded from disk)`);
  await registerCommands();
});

// =========================
// SCAN — FAST & ACCURATE
// =========================
async function scanChannel(channel, interaction = null) {
  if (!channel.isTextBased()) return { added: 0, total: libraryFiles.length, scanned: 0 };
  if (interaction) await interaction.editReply({ content: `🔍 Scanning <#${channel.id}>...` });

  const foundFiles = [];
  let before = null;
  let scanned = 0;

  while (true) {
    const options = { limit: 100 };
    if (before) options.before = before;
    let batch;
    try { batch = await channel.messages.fetch(options); }
    catch (e) { await new Promise(r => setTimeout(r, 500)); continue; }
    if (!batch.size) break;
    scanned += batch.size;

    for (const msg of batch.values()) {
      // Normal attachments
      for (const a of msg.attachments.values()) {
        const n = normalizeFilename(a.name);
        if (!n || n.endsWith(".lua") || isImageFile(a.name)) continue;
        foundFiles.push({ name: a.name, url: a.url, size: a.size, ts: msg.createdTimestamp });
      }
      // Forwarded attachments
      if (msg.messageSnapshots) {
        for (const snap of msg.messageSnapshots.values?.() || []) {
          if (!snap?.attachments) continue;
          for (const a of snap.attachments.values?.() || snap.attachments || []) {
            const n = normalizeFilename(a.name);
            if (!n || n.endsWith(".lua") || isImageFile(a.name)) continue;
            foundFiles.push({ name: a.name, url: a.url, size: a.size, ts: msg.createdTimestamp });
          }
        }
      }
    }
    before = batch.last()?.id;
    if (!before || batch.size < 100) break;
    await new Promise(r => setTimeout(r, 150));
  }

  // Deduplicate + assign IDs
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

  console.log(`✅ Scan: +${newCount} new, total ${libraryFiles.length}`);
  return { added: newCount, total: libraryFiles.length, scanned };
}

// =========================
// INTERACTIONS
// =========================
client.on("interactionCreate", async interaction => {
  try {
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

    // Select Channel
    if (interaction.commandName === "selectchannel") {
      const channel = interaction.options.getChannel("channel");
      config.allowedChannelId = channel.id;
      saveConfig();
      return interaction.reply({ 
        content: `✅ **Channel set!**\n🔗 <#${channel.id}>\n• \`.find <name>\` — search\n• \`.get <id>\` — get file\n👑 Owner can use anywhere`,
        ephemeral: false 
      });
    }

    // Scan Channel
    if (interaction.commandName === "scanchannel") {
      const channel = interaction.options.getChannel("channel");
      await interaction.deferReply();
      const result = await scanChannel(channel, interaction);
      return interaction.editReply({
        content: `📁 **SCAN COMPLETE**\n**Channel:** <#${channel.id}>\n**Scanned:** ${result.scanned} messages\n**Files added:** ${result.added}\n**Total Library:** ${result.total}`
      });
    }
  } catch (e) { console.error("❌ Interaction error:", e); }
});

// =========================
// ✅ PREFIX COMMANDS — FAST
// =========================
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const isOwner = message.author.id === OWNER_ID;
  const allowed = isOwner || !config.allowedChannelId || message.channel.id === config.allowedChannelId;

  // ========== .find — GRAY EMBED ==========
  if (message.content.startsWith(".find ")) {
    if (!allowed) return message.reply(`❌ Use in <#${config.allowedChannelId}>`);
    
    const query = message.content.slice(6).trim();
    if (!query) return message.reply("⚠️ Usage: `.find <name>`");

    const results = searchFiles(query);
    if (results.length === 0) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle("Finder Source Results")
          .setColor(0x808080)
          .setDescription(`❌ No matches for \"${query}\"\n📚 Total files: **${libraryFiles.length}**`)
        ]
      });
    }

    let desc = `Found **${results.length}** match(es) for \"${query}\":\n\n`;
    desc += results.slice(0, 25).map(f => `**${f.name}** | ID: \`${f.id}\``).join("\n");
    if (results.length > 25) desc += `\n\n...and **${results.length - 25}** more. Be more specific.`;
    desc += `\n\n💡 Use \`.get <id>\` to get the file`;

    return message.reply({
      embeds: [new EmbedBuilder()
        .setTitle("Finder Source Results")
        .setColor(0x808080)
        .setDescription(desc)
      ]
    });
  }

  // ========== .get — SEND THE FILE ==========
  if (message.content.startsWith(".get ")) {
    if (!allowed) return message.reply(`❌ Use in <#${config.allowedChannelId}>`);
    
    const id = message.content.slice(5).trim();
    if (!id) return message.reply("⚠️ Usage: `.get <id>`");

    const file = getFileById(id);
    if (!file) return message.reply(`❌ No file with ID: \`${id}\`\n📚 Total files: **${libraryFiles.length}**`);

    // ✅ SEND THE FILE — NO EXTRA TEXT, JUST THE ATTACHMENT
    await message.channel.send({
      files: [{
        attachment: file.url,
        name: file.name
      }]
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
