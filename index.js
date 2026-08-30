const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
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
// EXPRESS — PORT FIX
// =========================
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("FS Bot Online"));
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 Port ${PORT} open — Render happy!`));

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
// ✅ FILTER — IGNORE IMAGES ONLY, SCAN .lua NOW
// =========================
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"];
function isImageFile(name) {
  const ext = path.extname((name || "").toLowerCase());
  return IMAGE_EXTENSIONS.includes(ext);
}

function getTimePH() {
  const now = new Date();
  const ph = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return ph.toISOString().slice(11, 16);
}

// =========================
// SEARCH & GET
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
    .setDescription("Set allowed channel for .find and .get commands")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o => 
      o.setName("channel")
       .setDescription("Channel where .find and .get work")
       .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription("Scan channel — all messages + forwarded files")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => 
      o.setName("channel")
       .setDescription("Channel to scan")
       .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("Owner only: list all servers"),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Owner only: leave a server")
    .addStringOption(o => 
      o.setName("server-id")
       .setDescription("Server ID to leave")
       .setRequired(true)
    )
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
// ✅ SCAN CHANNEL — IGNORE IMAGES ONLY, SCAN .lua, ALL MESSAGES
// =========================
async function scanChannel(channel, interaction = null) {
  if (!channel.isTextBased()) return { added: 0, total: libraryFiles.length, scanned: 0 };
  if (interaction) await interaction.editReply({ content: `🔍 Scanning <#${channel.id}> — please wait...` });

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
      // ✅ Normal attachments — IGNORE IMAGES ONLY, SCAN .lua
      for (const a of msg.attachments.values()) {
        const n = normalizeFilename(a.name);
        if (!n || isImageFile(a.name)) continue; // ✅ NO MORE .lua SKIP!
        foundFiles.push({ name: a.name, url: a.url, size: a.size, ts: msg.createdTimestamp });
      }
      // ✅ Forwarded files — messageSnapshots
      if (msg.messageSnapshots) {
        const snapshots = Array.isArray(msg.messageSnapshots) 
          ? msg.messageSnapshots 
          : [...(msg.messageSnapshots.values?.() || [])];
        for (const snap of snapshots) {
          if (!snap?.attachments) continue;
          const atts = typeof snap.attachments.values === "function" 
            ? snap.attachments.values() 
            : Array.isArray(snap.attachments) ? snap.attachments : [];
          for (const a of atts) {
            const n = normalizeFilename(a.name);
            if (!n || isImageFile(a.name)) continue; // ✅ NO MORE .lua SKIP!
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

  console.log(`✅ Scan: +${newCount} new, total ${libraryFiles.length} (images ignored, .lua scanned)`);
  return { added: newCount, total: libraryFiles.length, scanned };
}

// =========================
// SLASH COMMANDS HANDLER
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
      if (!g) return interaction.reply({ content: "❌ Server not found.", ephemeral: true });
      try { await g.leave(); return interaction.reply({ content: `✅ Left **${g.name}**`, ephemeral: true }); }
      catch { return interaction.reply({ content: "❌ Failed to leave.", ephemeral: true }); }
    }

    // /setchannel
    if (interaction.commandName === "setchannel") {
      const channel = interaction.options.getChannel("channel");
      config.allowedChannelId = channel.id;
      saveConfig();
      return interaction.reply({ 
        content: `✅ **Channel Set!**\n🔗 Allowed channel: <#${channel.id}>\n👥 All users can use:\n• \`.find <name>\` — search files\n• \`.get <id>\` — get file`,
        ephemeral: false 
      });
    }

    // /scanchannel
    if (interaction.commandName === "scanchannel") {
      const channel = interaction.options.getChannel("channel");
      await interaction.deferReply();
      const result = await scanChannel(channel, interaction);
      return interaction.editReply({
        content: `📁 **SCAN COMPLETE**\n**Channel:** <#${channel.id}>\n**Messages scanned:** ${result.scanned}\n**New files added:** ${result.added}\n**Total in Library:** ${result.total}\nℹ️ Images ignored, .lua files scanned`
      });
    }
  } catch (e) { console.error("❌ Interaction error:", e); }
});

// =========================
// PREFIX COMMANDS — .find + .get
// =========================
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const isOwner = message.author.id === OWNER_ID;
  const allowed = isOwner || !config.allowedChannelId || message.channel.id === config.allowedChannelId;

  // ========== .find <query> — GRAY EMBED ==========
  if (message.content.startsWith(".find ")) {
    if (!allowed) return message.reply(`❌ Use .find in <#${config.allowedChannelId}>`);
    
    const query = message.content.slice(6).trim();
    
    if (!query) {
      return message.reply("❌ No match found for that, idiot.");
    }

    const results = searchFiles(query);
    
    if (results.length === 0) {
      return message.reply("❌ No match found for that, idiot.");
    }

    const display = results.slice(0, 25);
    const totalPages = Math.ceil(results.length / 25);
    const currentPage = 1;

    const desc = display.map(f => `\`${f.name}\` │ ID: \`${f.id}\``).join("\n");

    const embed = new EmbedBuilder()
      .setTitle("Finder Source Results")
      .setColor(0x808080) // GRAY
      .setDescription(desc)
      .setFooter({ 
        text: `Page ${currentPage}/${totalPages} • Today at ${getTimePH()}`
      });

    return message.reply({ embeds: [embed] });
  }

  // ========== .get <id> — SEND FILE + @ON ==========
  if (message.content.startsWith(".get ")) {
    if (!allowed) return message.reply(`❌ Use .get in <#${config.allowedChannelId}>`);
    
    const id = message.content.slice(5).trim();
    if (!id) return message.reply("❌ No match found for that, idiot.");

    const file = getFileById(id);
    if (!file) return message.reply("❌ No match found for that, idiot.");

    await message.channel.send({
      content: `@ON`,
      files: [{
        attachment: file.url,
        name: file.name
      }]
    });
  }
});

// =========================
// LOGIN & ERROR
// =========================
client.on("error", e => console.error("❌ Client error:", e));
process.on("unhandledRejection", e => console.error("❌ Rejection:", e));

console.log("🔑 Logging in...");
client.login(TOKEN).catch(e => { console.error("❌ Login failed:", e); process.exit(1); });
