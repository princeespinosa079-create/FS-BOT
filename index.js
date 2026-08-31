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
const https = require("https");
const http = require("http");

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
// EXPRESS — KEEP BOT ALIVE
// =========================
const app = express();
const PORT = process.env.PORT || 10000;
app.get("/", (req, res) => res.send("FS Bot Online"));
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 Port ${PORT} open`));

// =========================
// DATA FILES
// =========================
const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;
const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const WHITELIST_FILE = path.join(DATA_DIR, "whitelist.json");
const TEMP_DIR = path.join(DATA_DIR, "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// =========================
// HELPERS
// =========================
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

function loadWhitelist() {
  try {
    if (fs.existsSync(WHITELIST_FILE)) return JSON.parse(fs.readFileSync(WHITELIST_FILE, "utf8"));
  } catch (e) {}
  return { users: [], roles: [] };
}

function saveWhitelist() {
  try { fs.writeFileSync(WHITELIST_FILE, JSON.stringify(whitelist, null, 2)); } catch (e) {}
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
const whitelist = loadWhitelist();
const library = loadLibrary();
const libraryFiles = library.files;
saveLibrary();

// =========================
// IMAGE CHECK
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
// ✅ WHITELIST CHECK
// =========================
function isWhitelisted(userId, member = null) {
  if (userId === OWNER_ID) return true;
  if (whitelist.users.includes(userId)) return true;
  if (member && whitelist.roles.some(roleId => member.roles?.cache?.has(roleId))) return true;
  return false;
}

function fileExistsByName(name) {
  const n = normalizeFilename(name);
  return libraryFiles.some(f => normalizeFilename(f.name) === n);
}

// =========================
// SEARCH
// =========================
function searchFiles(query) {
  const q = query.toLowerCase().trim();
  if (!q || libraryFiles.length === 0) return [];
  const results = [];
  for (const file of libraryFiles) {
    if (normalizeFilename(file.name).includes(q)) results.push(file);
  }
  return results;
}

function getFileById(id) {
  return libraryFiles.find(file => file.id === id);
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);
    protocol.get(url, response => {
      response.pipe(file);
      file.on("finish", () => { file.close(); resolve(destPath); });
    }).on("error", err => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

// =========================
// PAGINATION
// =========================
const searchSessions = new Map();

function buildSearchPage(ownerUserId, results, page = 1) {
  const perPage = 8;
  const totalPages = Math.ceil(results.length / perPage);
  const start = (page - 1) * perPage;
  const display = results.slice(start, start + perPage);
  const desc = display.map(f => `\`${f.name}\` │ ID: \`${f.id}\``).join("\n");
  const embed = new EmbedBuilder().setTitle("Finder Source Results").setColor(0x808080).setDescription(desc).setFooter({ text: `Page ${page}/${totalPages} │ Today at ${getTimePH()}` });
  const components = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`search_back_${ownerUserId}_${page}`).setLabel("◀ Back").setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`search_next_${ownerUserId}_${page}`).setLabel("Next ▶").setStyle(ButtonStyle.Success).setDisabled(page >= totalPages)
  );
  return { embeds: [embed], components: [components] };
}

// =========================
// CLIENT
// =========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

// =========================
// SLASH COMMANDS
// =========================
const commands = [
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("(Administrator) Set allowed channel for .find, .get, .upload"),

  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription("(Owner Only) Scan channel for files")
    .addChannelOption(o => o.setName("channel").setDescription("Channel to scan").setRequired(true)),

  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("(Owner Only) Add or remove whitelist entries")
    .addStringOption(o => o.setName("mode").setDescription("Add or Remove").setRequired(true).addChoices(
      { name: "Add", value: "add" },
      { name: "Remove", value: "remove" }
    ))
    .addStringOption(o => o.setName("type").setDescription("Role or User").setRequired(true).addChoices(
      { name: "Role", value: "role" },
      { name: "User", value: "user" }
    ))
    .addStringOption(o => o.setName("id").setDescription("Role ID or User ID — numbers only").setRequired(true)),

  new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("(Owner Only) List all servers"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("(Owner Only) Leave a server")
    .addStringOption(o => o.setName("server_id").setDescription("Server ID").setRequired(true))
].map(c => c.toJSON());

// =========================
// REGISTER COMMANDS
// =========================
async function registerCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Commands registered successfully");
  } catch (e) {
    console.error("❌ Command register error:", e);
  }
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📚 Library: ${libraryFiles.length} files`);
  await registerCommands();
});

// =========================
// INTERACTIONS — SLASH COMMANDS
// =========================
client.on("interactionCreate", async interaction => {
  try {
    // BUTTONS
    if (interaction.isButton()) {
      const customId = interaction.customId;
      if (customId.startsWith("search_back_") || customId.startsWith("search_next_")) {
        const [_, direction, ownerUserId, pageStr] = customId.split("_");
        const currentPage = parseInt(pageStr);
        if (ownerUserId !== interaction.user.id) {
          return interaction.reply({ content: "❌ stfu, this is not your search idiot.", ephemeral: true });
        }
        const session = searchSessions.get(interaction.message.id);
        if (!session) return interaction.reply({ content: "❌ Search expired.", ephemeral: true });
        const newPage = direction === "next" ? currentPage + 1 : currentPage - 1;
        await interaction.update(buildSearchPage(ownerUserId, session.results, newPage));
        searchSessions.set(interaction.message.id, { ...session, page: newPage });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    // ✅ /whitelist — FIXED & SIMPLIFIED
    if (interaction.commandName === "whitelist") {
      await interaction.deferReply({ ephemeral: false }); // REPLY FAST = NO TIMEOUT
      
      if (interaction.user.id !== OWNER_ID) {
        return interaction.editReply("❌ (Owner Only) You don't have permission.");
      }
      
      const mode = interaction.options.getString("mode");
      const type = interaction.options.getString("type");
      const id = interaction.options.getString("id").trim();
      
      if (!/^\d+$/.test(id)) {
        return interaction.editReply("❌ Invalid ID — must be numbers only.");
      }
      
      if (type === "role") {
        if (mode === "add") {
          if (!whitelist.roles.includes(id)) whitelist.roles.push(id);
          saveWhitelist();
          return interaction.editReply(`✅ Role ID \`${id}\` added to whitelist.`);
        } else {
          whitelist.roles = whitelist.roles.filter(r => r !== id);
          saveWhitelist();
          return interaction.editReply(`✅ Role ID \`${id}\` removed from whitelist.`);
        }
      } else {
        if (mode === "add") {
          if (!whitelist.users.includes(id)) whitelist.users.push(id);
          saveWhitelist();
          return interaction.editReply(`✅ User ID \`${id}\` added to whitelist.`);
        } else {
          whitelist.users = whitelist.users.filter(u => u !== id);
          saveWhitelist();
          return interaction.editReply(`✅ User ID \`${id}\` removed from whitelist.`);
        }
      }
    }

    // /setchannel
    if (interaction.commandName === "setchannel") {
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "❌ (Administrator) Permission required.", ephemeral: true });
      }
      config.allowedChannelId = interaction.channelId;
      saveConfig();
      return interaction.reply({ content: `✅ **Channel Set!**\nAllowed: <#${interaction.channelId}>`, ephemeral: false });
    }

    // /scanchannel
    if (interaction.commandName === "scanchannel") {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: "❌ (Owner Only) Permission required.", ephemeral: true });
      }
      await interaction.deferReply();
      const channel = interaction.options.getChannel("channel");
      return interaction.editReply(`✅ Scan started for <#${channel.id}> — add scan function here`);
    }

    // /serverlist
    if (interaction.commandName === "serverlist") {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: "❌ (Owner Only) Permission required.", ephemeral: true });
      }
      const list = client.guilds.cache.map(g => `**${g.name}** — \`${g.id}\``).join("\n");
      return interaction.reply({ content: `**Servers (${client.guilds.cache.size}):**\n${list}`, ephemeral: true });
    }

    // /leave
    if (interaction.commandName === "leave") {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: "❌ (Owner Only) Permission required.", ephemeral: true });
      }
      const gid = interaction.options.getString("server_id");
      const g = client.guilds.cache.get(gid);
      if (!g) return interaction.reply({ content: "❌ Server not found.", ephemeral: true });
      await g.leave();
      return interaction.reply({ content: `✅ Left **${g.name}**`, ephemeral: true });
    }

  } catch (e) {
    console.error("❌ Interaction error:", e);
    try {
      if (interaction.deferred) interaction.editReply("❌ Error occurred.");
      else interaction.reply({ content: "❌ Error occurred.", ephemeral: true });
    } catch {}
  }
});

// =========================
// ✅ PREFIX COMMANDS — WORKING
// =========================
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  
  const userId = message.author.id;
  const member = message.guild ? message.member : null;
  const whitelisted = isWhitelisted(userId, member);
  const isDM = !message.guild;
  const inAllowedChannel = isDM || !config.allowedChannelId || message.channel.id === config.allowedChannelId;

  // .help
  if (message.content.toLowerCase() === ".help") {
    return message.channel.send({
      embeds: [new EmbedBuilder()
        .setTitle("How this works?")
        .setColor(0x808080)
        .setDescription("> - **use** `.find` **<file name> to find source.**\n> - **use** `.get` **<the file id> to give the source to you.**\n> - **use** `.upload` **and attach file to give it in the bot.**")
        .setFooter({ text: `Today at ${getTimePH()}` })]
    });
  }

  // .upload
  if (message.content.toLowerCase().startsWith(".upload")) {
    if (!whitelisted) return;
    if (!isDM && !inAllowedChannel) return message.reply("❌ not here, dumbass.");
    if (!message.attachments.size) return message.reply("❌ put file here nga.");
    
    const att = message.attachments.first();
    if (isImageFile(att.name)) return message.reply("❌ Images not allowed.");
    if (fileExistsByName(att.name)) return message.reply("❌ this shit is already in the bot.");
    
    const tempPath = path.join(TEMP_DIR, `${generateId()}_${att.name}`);
    try {
      await downloadFile(att.url, tempPath);
      libraryFiles.push({ id: generateId(), name: att.name, url: tempPath, isLocal: true, size: fs.statSync(tempPath).size, timestamp: Date.now() });
      saveLibrary();
      return message.reply("✅ your file just upload in bot, you're cool now.");
    } catch {
      return message.reply("❌ Upload failed.");
    }
  }

  // .find
  if (message.content.toLowerCase().startsWith(".find ")) {
    if (!whitelisted) return;
    if (!isDM && !inAllowedChannel) return message.reply("❌ not here, dumbass.");
    
    const query = message.content.slice(6).trim();
    if (!query) return message.reply("❌ no match file for that, idiot.");
    const results = searchFiles(query);
    if (results.length === 0) return message.reply("❌ no match file for that, idiot.");
    
    const replyData = buildSearchPage(message.author.id, results, 1);
    const replyMsg = await message.reply(replyData);
    searchSessions.set(replyMsg.id, { userId: message.author.id, results, page: 1 });
  }

  // .get
  if (message.content.toLowerCase().startsWith(".get ")) {
    if (!whitelisted) return;
    if (!isDM && !inAllowedChannel) return message.reply("❌ not here, dumbass.");
    
    const id = message.content.slice(5).trim();
    const file = getFileById(id);
    if (!file) return message.reply("❌ no match file for that, idiot.");
    
    return message.channel.send({
      content: `<@${message.author.id}> **Here is the file twin!**`,
      files: [{ attachment: file.url, name: file.name }]
    });
  }
});

// =========================
// ERROR HANDLING
// =========================
client.on("error", e => console.error("❌ Client error:", e));
process.on("unhandledRejection", e => console.error("❌ Rejection:", e));

console.log("🔑 Logging in...");
client.login(TOKEN).catch(e => { console.error("❌ Login failed:", e); process.exit(1); });
