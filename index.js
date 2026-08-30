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
const crypto = require("crypto");

let yauzl = null;
try { yauzl = require("yauzl"); } catch (e) { console.log("⚠️ yauzl not installed, zip extraction disabled"); }

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
// DATA DIRS
// =========================
const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;
const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const TEMP_DIR = path.join(DATA_DIR, "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// =========================
// ✅ USER TOKEN CLIENT — for external servers
// =========================
let userClient = null;
let userToken = null;

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
  return { allowedChannelId: null, userToken: null };
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

// Restore saved user token on startup
if (config.userToken) {
  userToken = config.userToken;
  userClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
  userClient.login(userToken).catch(() => { userClient = null; userToken = null; delete config.userToken; saveConfig(); });
}

// =========================
// MORE HELPERS
// =========================
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"];
function isImageFile(name) {
  const ext = path.extname((name || "").toLowerCase());
  return IMAGE_EXTENSIONS.includes(ext);
}

function isTxtFile(name) {
  return path.extname((name || "").toLowerCase()) === ".txt";
}

function getTimePH() {
  const now = new Date();
  const ph = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return ph.toISOString().slice(11, 16);
}

function hasBypass(member, userId) {
  if (userId === OWNER_ID) return true;
  if (member?.roles?.cache?.has(SCAN_ROLE_ID)) return true;
  return false;
}

function fileExistsByName(name) {
  const n = normalizeFilename(name);
  return libraryFiles.some(f => normalizeFilename(f.name) === n);
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
    if (name === q || nameNoSpecial === qNoSpecial || name.startsWith(q + ".") || nameNoSpecial.startsWith(qNoSpecial + ".")) {
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

async function extractZipToLibrary(zipPath) {
  if (!yauzl) throw new Error("yauzl not installed. Run: npm install yauzl");
  return new Promise((resolve, reject) => {
    let added = 0, skipped = 0;
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.readEntry();
      zipfile.on("entry", entry => {
        if (/\/$/.test(entry.fileName)) { zipfile.readEntry(); return; }
        const fileName = path.basename(entry.fileName);
        const n = normalizeFilename(fileName);
        if (!n || isImageFile(fileName)) { skipped++; zipfile.readEntry(); return; }
        if (fileExistsByName(fileName)) { skipped++; zipfile.readEntry(); return; }
        const tempPath = path.join(TEMP_DIR, `${crypto.randomBytes(8).toString("hex")}_${fileName}`);
        zipfile.openReadStream(entry, (err, readStream) => {
          if (err) { zipfile.readEntry(); return; }
          const writeStream = fs.createWriteStream(tempPath);
          readStream.pipe(writeStream);
          writeStream.on("finish", () => {
            const stats = fs.statSync(tempPath);
            libraryFiles.push({ id: generateId(), name: fileName, url: tempPath, isLocal: true, size: stats.size, timestamp: Date.now() });
            added++;
            saveLibrary();
            zipfile.readEntry();
          });
        });
      });
      zipfile.on("end", () => { fs.unlink(zipPath, () => {}); resolve({ added, skipped, total: libraryFiles.length }); });
      zipfile.on("error", err => reject(err));
    });
  });
}

// =========================
// ✅ GET CHANNEL — use userClient if bot not in server
// =========================
async function getChannelAny(channelId) {
  let channel = client.channels.cache.get(channelId);
  if (!channel && userClient) {
    channel = userClient.channels.cache.get(channelId) || await userClient.channels.fetch(channelId).catch(() => null);
  }
  if (!channel) channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel && userClient) channel = await userClient.channels.fetch(channelId).catch(() => null);
  return channel;
}

// =========================
// ✅ SCAN .txt FILES ONLY
// =========================
async function scanTxtFiles(channel) {
  if (!channel.isTextBased()) return { files: [], scanned: 0 };
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
        if (!isTxtFile(a.name)) continue;
        foundFiles.push({ name: a.name, url: a.url, size: a.size, message: msg });
      }
      if (msg.messageSnapshots) {
        const snapshots = Array.isArray(msg.messageSnapshots) ? msg.messageSnapshots : [...(msg.messageSnapshots.values?.() || [])];
        for (const snap of snapshots) {
          if (!snap?.attachments) continue;
          const atts = typeof snap.attachments.values === "function" ? snap.attachments.values() : Array.isArray(snap.attachments) ? snap.attachments : [];
          for (const a of atts) {
            if (!isTxtFile(a.name)) continue;
            foundFiles.push({ name: a.name, url: a.url, size: a.size, message: msg });
          }
        }
      }
    }
    before = batch.last()?.id;
    if (!before || batch.size < 100) break;
    await new Promise(r => setTimeout(r, 150));
  }
  return { files: foundFiles, scanned };
}

// =========================
// PAGINATION
// =========================
const searchSessions = new Map();

// =========================
// CLIENT
// =========================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// =========================
// ✅ SLASH COMMANDS — /login + /forwardall EXACT LIKE SCREENSHOT
// =========================
const commands = [
  // ✅ /login — set user token for external server access
  new SlashCommandBuilder()
    .setName("login")
    .setDescription("Set Discord User Token for accessing external servers — Owner Only")
    .addStringOption(o =>
      o.setName("token")
       .setDescription("Discord account token (user account)")
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set allowed channel for .find and .get — Owner Only"),

  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription("Scan channel for files, skips duplicates — Owner Only")
    .addChannelOption(o =>
      o.setName("channel")
       .setDescription("Channel to scan")
       .setRequired(true)
    ),

  // ✅ /forwardall — EXACT LIKE SCREENSHOT
  new SlashCommandBuilder()
    .setName("forwardall")
    .setDescription("Copy all .txt files from source to destination channel — Owner Only")
    .addChannelOption(o =>
      o.setName("source")
       .setDescription("Source channel where files are copied from")
       .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("destination")
       .setDescription("Destination channel where files will be sent")
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("uploadzip")
    .setDescription("Upload zip file, auto extract to library — Owner Only")
    .addAttachmentOption(o =>
      o.setName("file")
       .setDescription("Zip file to extract")
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a gray embed message")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o =>
      o.setName("description")
       .setDescription("Embed text content")
       .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("title")
       .setDescription("Optional title — leave blank for none")
       .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("List all servers the bot is in — Owner Only"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Make the bot leave a server — Owner Only")
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
// SCAN CHANNEL — duplicates skip
// =========================
async function scanChannel(channel) {
  if (!channel.isTextBased()) return { added: 0, skipped: 0, total: libraryFiles.length, scanned: 0 };
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
  let newCount = 0, skipped = 0;
  for (const f of foundFiles) {
    const key = normalizeFilename(f.name);
    if (!unique.has(key)) {
      unique.set(key, { id: generateId(), name: f.name, url: f.url, size: f.size, timestamp: f.ts });
      newCount++;
    } else { skipped++; }
  }
  libraryFiles.length = 0;
  libraryFiles.push(...[...unique.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)));
  saveLibrary();
  return { added: newCount, skipped, total: libraryFiles.length, scanned };
}

// =========================
// BUILD SEARCH PAGE — 8 LINES
// =========================
function buildSearchPage(ownerUserId, results, page = 1) {
  const perPage = 8;
  const totalPages = Math.ceil(results.length / perPage);
  const start = (page - 1) * perPage;
  const display = results.slice(start, start + perPage);
  const desc = display.map(f => `\`${f.name}\` │ ID: \`${f.id}\``).join("\n");
  const embed = new EmbedBuilder().setTitle("Finder Source Results").setColor(0x808080).setDescription(desc).setFooter({ text: `Page ${page}/${totalPages} │ Today at ${getTimePH()}` });
  const components = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`search_back_${ownerUserId}_${page}`).setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`search_next_${ownerUserId}_${page}`).setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(page >= totalPages)
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
      const customId = interaction.customId;
      if (customId.startsWith("search_back_") || customId.startsWith("search_next_")) {
        const parts = customId.split("_");
        const direction = parts[1], ownerUserId = parts[2], currentPage = parseInt(parts[3]);
        if (ownerUserId !== userId) return interaction.reply({ content: "❌ stfu, this is not your search", ephemeral: true });
        const session = searchSessions.get(interaction.message.id);
        if (!session) return interaction.reply({ content: "❌ Search expired, idiot. Use .find again.", ephemeral: true });
        const newPage = direction === "next" ? currentPage + 1 : currentPage - 1;
        searchSessions.set(interaction.message.id, { ...session, page: newPage });
        await interaction.update(buildSearchPage(ownerUserId, session.results, newPage));
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const ownerOnlyCmds = ["leave", "serverlist", "setchannel", "scanchannel", "forwardall", "uploadzip", "login"];
    if (ownerOnlyCmds.includes(interaction.commandName) && interaction.user.id !== OWNER_ID)
      return interaction.reply({ content: "❌ Owner only, idiot.", ephemeral: true });

    // =========================
    // ✅ /login — SET USER TOKEN
    // =========================
    if (interaction.commandName === "login") {
      const token = interaction.options.getString("token").trim();
      await interaction.deferReply({ ephemeral: true });

      try {
        if (userClient) { userClient.destroy(); userClient = null; }
        userClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
        
        await new Promise((resolve, reject) => {
          userClient.once("ready", () => resolve());
          userClient.once("error", (e) => reject(e));
          userClient.login(token).catch(e => reject(e));
          setTimeout(() => reject(new Error("Login timeout")), 15000);
        });

        userToken = token;
        config.userToken = token;
        saveConfig();
        
        return interaction.editReply({ content: `✅ **Logged in as User:** ${userClient.user.tag}\n🔑 Token saved — can now access external servers!` });
      } catch (err) {
        userClient = null;
        userToken = null;
        delete config.userToken;
        saveConfig();
        return interaction.editReply({ content: `❌ **Login Failed:** Invalid token or error.\nError: ${err.message}` });
      }
    }

    // =========================
    // /scanchannel
    // =========================
    if (interaction.commandName === "scanchannel") {
      const channel = interaction.options.getChannel("channel");
      await interaction.deferReply();
      const r = await scanChannel(channel);
      return interaction.editReply({ content: `📁 **SCAN COMPLETE**\n**Channel:** <#${channel.id}>\n**Scanned:** ${r.scanned}\n**✅ Added:** ${r.added}\n**⏭️ Skipped:** ${r.skipped}\n**📚 Total:** ${r.total}` });
    }

    // =========================
    // ✅ /forwardall — EXACT LIKE SCREENSHOT
    // =========================
    if (interaction.commandName === "forwardall") {
      const sourceChannel = interaction.options.getChannel("source");
      const destChannel = interaction.options.getChannel("destination");

      if (!sourceChannel.isTextBased() || !destChannel.isTextBased())
        return interaction.reply({ content: "❌ Both channels must be text channels.", ephemeral: true });

      await interaction.deferReply();

      // ✅ EXACT SCREENSHOT MESSAGE
      await interaction.editReply({
        content: `🔄 **Starting FULL COPY of .txt files** from ${sourceChannel} to ${destChannel}`
      });

      // Scan source for .txt files
      const { files: txtFiles, scanned } = await scanTxtFiles(sourceChannel);

      if (txtFiles.length === 0) {
        return interaction.editReply({
          content: `❌ No .txt files found in ${sourceChannel}\nScanned ${scanned} messages.`
        });
      }

      // Send to destination — show each file like screenshot
      let sent = 0, failed = 0;
      for (const file of txtFiles) {
        try {
          await destChannel.send({
            files: [{ attachment: file.url, name: file.name }]
          });
          sent++;
          await new Promise(r => setTimeout(r, 300)); // Avoid rate limit
        } catch (e) {
          failed++;
          console.error(`Failed to send ${file.name}:`, e.message);
        }
      }

      // ✅ Final result
      return interaction.editReply({
        content: `✅ **FORWARD COMPLETE**\n**From:** ${sourceChannel}\n**To:** ${destChannel}\n**📄 Files Found:** ${txtFiles.length}\n**✅ Sent:** ${sent}\n**❌ Failed:** ${failed}`
      });
    }

    // =========================
    // /uploadzip
    // =========================
    if (interaction.commandName === "uploadzip") {
      const attachment = interaction.options.getAttachment("file");
      if (!attachment.name.toLowerCase().endsWith(".zip")) return interaction.reply({ content: "❌ Must be a .zip file, idiot.", ephemeral: true });
      await interaction.deferReply();
      const zipPath = path.join(TEMP_DIR, `${crypto.randomBytes(8).toString("hex")}.zip`);
      try {
        await downloadFile(attachment.url, zipPath);
        const result = await extractZipToLibrary(zipPath);
        return interaction.editReply({ content: `📦 **ZIP EXTRACTED**\n**File:** \`${attachment.name}\`\n**✅ Added:** ${result.added}\n**⏭️ Skipped:** ${result.skipped}\n**📚 Total:** ${result.total}` });
      } catch (err) {
        console.error("Zip error:", err);
        fs.unlink(zipPath, () => {});
        return interaction.editReply({ content: `❌ Failed to extract zip: ${err.message}` });
      }
    }

    // =========================
    // /serverlist
    // =========================
    if (interaction.commandName === "serverlist") {
      const list = [...client.guilds.cache.values()].map((g, i) => `${i+1}. **${g.name}** \`${g.id}\``).join("\n");
      return interaction.reply({ content: `**Servers (${client.guilds.cache.size}):**\n${list.slice(0, 4000)}`, ephemeral: true });
    }

    // =========================
    // /leave
    // =========================
    if (interaction.commandName === "leave") {
      const g = client.guilds.cache.get(interaction.options.getString("server-id"));
      if (!g) return interaction.reply({ content: "❌ Server not found.", ephemeral: true });
      try { await g.leave(); return interaction.reply({ content: `✅ Left **${g.name}**`, ephemeral: true }); }
      catch { return interaction.reply({ content: "❌ Failed to leave.", ephemeral: true }); }
    }

    // =========================
    // /setchannel
    // =========================
    if (interaction.commandName === "setchannel") {
      config.allowedChannelId = interaction.channelId;
      saveConfig();
      return interaction.reply({ content: `✅ **Channel Set!**\n🔗 Allowed: <#${interaction.channelId}>`, ephemeral: false });
    }

    // =========================
    // /embed
    // =========================
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
  const bypass = hasBypass(message.member, message.author.id);
  const allowed = bypass || !config.allowedChannelId || message.channel.id === config.allowedChannelId;

  if (message.content.startsWith(".find ")) {
    if (!allowed) return message.reply("❌ not here, idiot.");
    const query = message.content.slice(6).trim();
    if (!query) return message.reply("❌ No match file for that, idiot.");
    const results = searchFiles(query);
    if (results.length === 0) return message.reply("❌ No match file for that, idiot.");
    const replyData = buildSearchPage(message.author.id, results, 1);
    const replyMsg = await message.reply(replyData);
    searchSessions.set(replyMsg.id, { userId: message.author.id, results, page: 1 });
    return;
  }

  if (message.content.startsWith(".get")) {
    if (!allowed) return message.reply("❌ not here, idiot.");
    const id = message.content.slice(4).trim();
    if (!id) return message.reply("❌ Put ID of File, idiot.");
    const file = getFileById(id);
    if (!file) return message.reply("❌ make sure that correct, idiot.");
    if (file.isLocal && fs.existsSync(file.url)) {
      await message.channel.send({ content: `<@${message.author.id}> Here is the file twin!`, files: [{ attachment: file.url, name: file.name }] });
    } else {
      await message.channel.send({ content: `<@${message.author.id}> Here is the file twin!`, files: [{ attachment: file.url, name: file.name }] });
    }
  }
});

// =========================
// LOGIN
// =========================
client.on("error", e => console.error("❌ Client error:", e));
process.on("unhandledRejection", e => console.error("❌ Rejection:", e));
console.log("🔑 Logging in...");
client.login(TOKEN).catch(e => { console.error("❌ Login failed:", e); process.exit(1); });
