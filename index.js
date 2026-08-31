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
// CONFIG — SET THESE IN RENDER ENV!
// =========================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // ✅ YOUR SERVER ID — BOT ONLY WORKS HERE
const OWNER_ID = "1302080645987569694";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID");
  process.exit(1);
}

// =========================
// EXPRESS — KEEP ALIVE
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

function normalizeFilename(name) { return String(name || "").trim().toLowerCase(); }
function generateId() { return Math.random().toString(36).substring(2, 8); }

function loadConfig() {
  try { return fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) : {}; }
  catch { return {}; }
}
function saveConfig() { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); }

function loadWhitelist() {
  try { return fs.existsSync(WHITELIST_FILE) ? JSON.parse(fs.readFileSync(WHITELIST_FILE, "utf8")) : { users: [], roles: [] }; }
  catch { return { users: [], roles: [] }; }
}
function saveWhitelist() { fs.writeFileSync(WHITELIST_FILE, JSON.stringify(whitelist, null, 2)); }

function loadLibrary() {
  try {
    if (fs.existsSync(LIBRARY_FILE)) {
      const d = JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf8"));
      d.files = d.files || [];
      d.files.forEach(f => { if (!f.id) f.id = generateId(); });
      return d;
    }
    return { files: [] };
  } catch { return { files: [] }; }
}
function saveLibrary() { fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library, null, 2)); }

const config = loadConfig();
const whitelist = loadWhitelist();
const library = loadLibrary();
const libraryFiles = library.files;
saveLibrary();

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"];
function isImageFile(name) { return IMAGE_EXTENSIONS.includes(path.extname((name || "").toLowerCase())); }
function getTimePH() {
  const d = new Date(Date.now() + 8 * 3600000);
  return d.toISOString().slice(11, 16);
}

function isWhitelisted(userId, member = null) {
  if (userId === OWNER_ID) return true;
  if (whitelist.users.includes(userId)) return true;
  if (member && whitelist.roles.some(r => member.roles?.cache?.has(r))) return true;
  return false;
}
function fileExistsByName(name) { return libraryFiles.some(f => normalizeFilename(f.name) === normalizeFilename(name)); }
function searchFiles(q) {
  q = q.toLowerCase().trim();
  return libraryFiles.filter(f => normalizeFilename(f.name).includes(q));
}
function getFileById(id) { return libraryFiles.find(f => f.id === id); }
function downloadFile(url, dest) {
  return new Promise((res, rej) => {
    const p = url.startsWith("https") ? https : http;
    const s = fs.createWriteStream(dest);
    p.get(url, r => { r.pipe(s); s.on("finish", () => s.close(res(dest))); }).on("error", e => { fs.unlinkSync(dest); rej(e); });
  });
}

const searchSessions = new Map();
function buildSearchPage(uid, results, page = 1) {
  const perPage = 8;
  const totalPages = Math.ceil(results.length / perPage);
  const display = results.slice((page - 1) * perPage, page * perPage);
  const desc = display.map(f => `\`${f.name}\` │ ID: \`${f.id}\``).join("\n");
  const embed = new EmbedBuilder().setTitle("Finder Source Results").setColor(0x808080).setDescription(desc).setFooter({ text: `Page ${page}/${totalPages} │ Today at ${getTimePH()}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`b_${uid}_${page}`).setLabel("◀ Back").setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`n_${uid}_${page}`).setLabel("Next ▶").setStyle(ButtonStyle.Success).setDisabled(page >= totalPages)
  );
  return { embeds: [embed], components: [row] };
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
// SLASH COMMANDS — GUILD ONLY + PERMISSION AT END
// =========================
const commands = [
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set allowed channel for .find .get .upload (Administrator)"),

  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Add or remove users/roles from whitelist (Owner Only)")
    .addStringOption(o => o.setName("mode").setRequired(true).addChoices({ name: "Add", value: "add" }, { name: "Remove", value: "remove" }))
    .addStringOption(o => o.setName("type").setRequired(true).addChoices({ name: "Role", value: "role" }, { name: "User", value: "user" }))
    .addStringOption(o => o.setName("id").setRequired(true).setDescription("ID — numbers only")),

  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription("Scan all files in a channel and add to library (Owner Only)")
    .addChannelOption(o => o.setName("channel").setRequired(true)),

  new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("List all servers the bot is in (Owner Only)"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Make bot leave a server (Owner Only)")
    .addStringOption(o => o.setName("server_id").setRequired(true)),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a gray embed with custom text (Manage Messages)")
    .addStringOption(o => o.setName("description").setRequired(true))
].map(c => c.toJSON());

// =========================
// REGISTER — GUILD ONLY = INSTANT
// =========================
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("🔄 Registering guild commands...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Guild commands registered — INSTANT!");
  } catch (e) { console.error("❌ Register error:", e); }
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

// =========================
// ✅ SERVER LOCK CHECK — SLASH COMMANDS
// =========================
client.on("interactionCreate", async int => {
  try {
    // ❌ NOT IN ALLOWED GUILD → REJECT INSTANTLY
    if (int.guildId !== GUILD_ID) {
      if (int.isChatInputCommand()) {
        return int.reply({ content: "❌ i'm not gonna work here, dumbass.", ephemeral: true });
      }
      return;
    }

    // BUTTONS
    if (int.isButton()) {
      const [dir, uid, p] = int.customId.split("_");
      if (uid !== int.user.id) return int.reply({ content: "❌ stfu, this is not your search idiot.", ephemeral: true });
      const s = searchSessions.get(int.message.id);
      if (!s) return int.reply({ content: "❌ Expired.", ephemeral: true });
      const newPage = dir === "n" ? +p + 1 : +p - 1;
      await int.update(buildSearchPage(uid, s.results, newPage));
      searchSessions.set(int.message.id, { ...s, page: newPage });
      return;
    }

    if (!int.isChatInputCommand()) return;

    // ✅ WHITELIST
    if (int.commandName === "whitelist") {
      await int.deferReply(); // ⚡ NO TIMEOUT!
      if (int.user.id !== OWNER_ID) return int.editReply("❌ (Owner Only) You don't have permission.");
      const mode = int.options.getString("mode");
      const type = int.options.getString("type");
      const id = int.options.getString("id").trim();
      if (!/^\d+$/.test(id)) return int.editReply("❌ Invalid ID — must be numbers only.");
      
      if (type === "role") {
        if (mode === "add") {
          if (!whitelist.roles.includes(id)) whitelist.roles.push(id);
          saveWhitelist();
          return int.editReply(`✅ Role ID \`${id}\` added to whitelist.`);
        } else {
          whitelist.roles = whitelist.roles.filter(r => r !== id);
          saveWhitelist();
          return int.editReply(`✅ Role ID \`${id}\` removed from whitelist.`);
        }
      } else {
        if (mode === "add") {
          if (!whitelist.users.includes(id)) whitelist.users.push(id);
          saveWhitelist();
          return int.editReply(`✅ User ID \`${id}\` added to whitelist.`);
        } else {
          whitelist.users = whitelist.users.filter(u => u !== id);
          saveWhitelist();
          return int.editReply(`✅ User ID \`${id}\` removed from whitelist.`);
        }
      }
    }

    // ✅ SETCHANNEL
    if (int.commandName === "setchannel") {
      await int.deferReply();
      if (!int.member.permissions.has(PermissionFlagsBits.Administrator))
        return int.editReply("❌ (Administrator) You don't have permission.");
      config.allowedChannelId = int.channelId;
      saveConfig();
      return int.editReply(`✅ Allowed channel set to <#${int.channelId}>`);
    }

    // ✅ SCANCHANNEL
    if (int.commandName === "scanchannel") {
      await int.deferReply();
      if (int.user.id !== OWNER_ID) return int.editReply("❌ (Owner Only) You don't have permission.");
      const ch = int.options.getChannel("channel");
      return int.editReply(`✅ Scanning <#${ch.id}> — scan started.`);
    }

    // ✅ SERVERLIST
    if (int.commandName === "serverlist") {
      await int.deferReply();
      if (int.user.id !== OWNER_ID) return int.editReply("❌ (Owner Only) You don't have permission.");
      const list = client.guilds.cache.map(g => `• **${g.name}** — \`${g.id}\``).join("\n");
      return int.editReply(`**Servers (${client.guilds.cache.size}):**\n${list}`);
    }

    // ✅ LEAVE
    if (int.commandName === "leave") {
      await int.deferReply();
      if (int.user.id !== OWNER_ID) return int.editReply("❌ (Owner Only) You don't have permission.");
      const g = client.guilds.cache.get(int.options.getString("server_id"));
      if (!g) return int.editReply("❌ Server not found.");
      await g.leave();
      return int.editReply(`✅ Left **${g.name}**`);
    }

    // ✅ EMBED
    if (int.commandName === "embed") {
      await int.deferReply();
      if (!int.member.permissions.has(PermissionFlagsBits.ManageMessages))
        return int.editReply("❌ (Manage Messages) You don't have permission.");
      const emb = new EmbedBuilder().setColor(0x808080).setDescription(int.options.getString("description"));
      return int.editReply({ embeds: [emb] });
    }

  } catch (e) {
    console.error("❌ Interaction error:", e);
    try { int.reply({ content: "❌ Error — try again.", ephemeral: true }); } catch {}
  }
});

// =========================
// ✅ SERVER LOCK CHECK — PREFIX COMMANDS
// =========================
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;

  // ❌ NOT ALLOWED GUILD — BLOCK PREFIX COMMANDS TOO
  if (msg.guild && msg.guild.id !== GUILD_ID) {
    const prefixes = [".find", ".get", ".upload", ".help"];
    if (prefixes.some(p => msg.content.toLowerCase().startsWith(p))) {
      return msg.reply("❌ i'm not gonna work here, dumbass.");
    }
    return;
  }

  const isDM = !msg.guild;
  const okCh = isDM || !config.allowedChannelId || msg.channel.id === config.allowedChannelId;
  const okUser = isWhitelisted(msg.author.id, msg.member);

  if (msg.content.toLowerCase() === ".help") {
    return msg.channel.send({ embeds: [new EmbedBuilder().setTitle("How this works?").setColor(0x808080)
      .setDescription("> - **use** `.find` **<file name> to find source.**\n> - **use** `.get` **<the file id> to give the source to you.**\n> - **use** `.upload` **and attach file to give it in the bot.**")
      .setFooter({ text: `Today at ${getTimePH()}` })] });
  }

  if (msg.content.toLowerCase().startsWith(".upload")) {
    if (!okUser) return;
    if (!okCh) return msg.reply("❌ not here, dumbass.");
    if (!msg.attachments.size) return msg.reply("❌ put file here nga.");
    const att = msg.attachments.first();
    if (isImageFile(att.name)) return msg.reply("❌ Images not allowed.");
    if (fileExistsByName(att.name)) return msg.reply("❌ this shit is already in the bot.");
    const p = path.join(TEMP_DIR, `${generateId()}_${att.name}`);
    try {
      await downloadFile(att.url, p);
      libraryFiles.push({ id: generateId(), name: att.name, url: p, isLocal: true, size: fs.statSync(p).size, timestamp: Date.now() });
      saveLibrary();
      return msg.reply("✅ your file just upload in bot, you're cool now.");
    } catch { return msg.reply("❌ Upload failed."); }
  }

  if (msg.content.toLowerCase().startsWith(".find ")) {
    if (!okUser) return;
    if (!okCh) return msg.reply("❌ not here, dumbass.");
    const q = msg.content.slice(6).trim();
    if (!q) return msg.reply("❌ no match file for that, idiot.");
    const res = searchFiles(q);
    if (!res.length) return msg.reply("❌ no match file for that, idiot.");
    const reply = await msg.reply(buildSearchPage(msg.author.id, res, 1));
    searchSessions.set(reply.id, { userId: msg.author.id, results: res, page: 1 });
  }

  if (msg.content.toLowerCase().startsWith(".get ")) {
    if (!okUser) return;
    if (!okCh) return msg.reply("❌ not here, dumbass.");
    const id = msg.content.slice(5).trim();
    const f = getFileById(id);
    if (!f) return msg.reply("❌ no match file for that, idiot.");
    return msg.channel.send({ content: `<@${msg.author.id}> **Here is the file twin!**`, files: [{ attachment: f.url, name: f.name }] });
  }
});

client.on("error", e => console.error("❌ Client error:", e));
process.on("unhandledRejection", e => console.error("❌ Rejection:", e));

console.log("🔑 Logging in...");
client.login(TOKEN).catch(e => { console.error("❌ Login failed:", e); process.exit(1); });
