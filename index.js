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

// =========================
// ✅ PERMISSION CHECK — EXACTLY AS REQUESTED
// =========================
function hasPermission(interaction, requiredPerm) {
  const userId = interaction.user.id;
  const member = interaction.member;

  // OWNER ALWAYS HAS ACCESS
  if (userId === OWNER_ID) return true;

  // CHECK SCAN ROLE
  const hasScanRole = member?.roles?.cache?.has(SCAN_ROLE_ID);

  switch (requiredPerm) {
    case "owner_only":
      return userId === OWNER_ID;
    case "scan_role_or_owner":
      return userId === OWNER_ID || hasScanRole;
    case "administrator":
      return member?.permissions?.has(PermissionFlagsBits.Administrator);
    case "manage_messages":
      return member?.permissions?.has(PermissionFlagsBits.ManageMessages);
    default:
      return false;
  }
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
// FETCH CHANNEL BY ID
// =========================
async function fetchChannelById(channelId) {
  if (!/^\d+$/.test(channelId)) return null;
  try {
    let channel = client.channels.cache.get(channelId);
    if (!channel) channel = await client.channels.fetch(channelId, { force: true });
    return channel;
  } catch (e) {
    console.error(`Failed to fetch channel ${channelId}:`, e.message);
    return null;
  }
}

// =========================
// SCAN .txt FILES — FAST
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
    catch (e) { await new Promise(r => setTimeout(r, 100)); continue; }
    if (!batch.size) break;
    scanned += batch.size;
    for (const msg of batch.values()) {
      for (const a of msg.attachments.values()) {
        if (!isTxtFile(a.name)) continue;
        foundFiles.push({ name: a.name, url: a.url, size: a.size });
      }
      if (msg.messageSnapshots) {
        const snapshots = Array.isArray(msg.messageSnapshots) ? msg.messageSnapshots : [...(msg.messageSnapshots.values?.() || [])];
        for (const snap of snapshots) {
          if (!snap?.attachments) continue;
          const atts = typeof snap.attachments.values === "function" ? snap.attachments.values() : Array.isArray(snap.attachments) ? snap.attachments : [];
          for (const a of atts) {
            if (!isTxtFile(a.name)) continue;
            foundFiles.push({ name: a.name, url: a.url, size: a.size });
          }
        }
      }
    }
    before = batch.last()?.id;
    if (!before || batch.size < 100) break;
    await new Promise(r => setTimeout(r, 50));
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
// SLASH COMMANDS
// =========================
const commands = [
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set allowed channel for .find and .get — Requires Administrator"),

  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription("Scan channel for files — Owner or Scan Role Only")
    .addChannelOption(o =>
      o.setName("channel")
       .setDescription("Channel to scan")
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("forwardall")
    .setDescription("Copy all .txt files FAST — Owner or Scan Role Only")
    .addStringOption(o =>
      o.setName("source_channel_id")
       .setDescription("Source Channel ID")
       .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("destination_channel_id")
       .setDescription("Destination Channel ID")
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("uploadzip")
    .setDescription("Upload zip file, auto extract — Owner or Scan Role Only")
    .addAttachmentOption(o =>
      o.setName("file")
       .setDescription("Zip file to extract")
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a gray embed message — Requires Manage Messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o =>
      o.setName("description")
       .setDescription("Embed text content")
       .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("title")
       .setDescription("Optional title")
       .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("List all servers with invite — Owner Only"),

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
// SCAN CHANNEL
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
    catch (e) { await new Promise(r => setTimeout(r, 100)); continue; }
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
    await new Promise(r => setTimeout(r, 50));
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
// BUILD SEARCH PAGE
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
// ✅ CREATE INVITE LINK FOR SERVER
// =========================
async function getGuildInvite(guild) {
  try {
    // Try to get existing invite first
    const invites = await guild.invites.fetch().catch(() => []);
    if (invites.size > 0) {
      const invite = invites.first();
      return `https://discord.gg/${invite.code}`;
    }
    // Create new invite in first available channel
    const channel = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite));
    if (channel) {
      const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, reason: "Server list invite" }).catch(() => null);
      if (invite) return `https://discord.gg/${invite.code}`;
    }
    return "No permission";
  } catch {
    return "No permission";
  }
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

    // =========================
    // /serverlist — OWNER ONLY + INVITE LINKS
    // =========================
    if (interaction.commandName === "serverlist") {
      if (!hasPermission(interaction, "owner_only")) {
        return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      
      const guilds = [...client.guilds.cache.values()];
      let list = `**📋 Servers (${guilds.length}):**\n\n`;
      
      for (let i = 0; i < guilds.length; i++) {
        const g = guilds[i];
        const invite = await getGuildInvite(g);
        list += `${i+1}. **${g.name}**\n   ID: \`${g.id}\`\n   Invite: ${invite}\n\n`;
        if (list.length > 3500) {
          list += "\n... (truncated)";
          break;
        }
      }
      
      return interaction.editReply({ content: list });
    }

    // =========================
    // /leave — OWNER ONLY
    // =========================
    if (interaction.commandName === "leave") {
      if (!hasPermission(interaction, "owner_only")) {
        return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
      }
      const g = client.guilds.cache.get(interaction.options.getString("server-id"));
      if (!g) return interaction.reply({ content: "❌ Server not found.", ephemeral: true });
      try { await g.leave(); return interaction.reply({ content: `✅ Left **${g.name}**`, ephemeral: true }); }
      catch { return interaction.reply({ content: "❌ Failed to leave.", ephemeral: true }); }
    }

    // =========================
    // /scanchannel — OWNER OR SCAN ROLE
    // =========================
    if (interaction.commandName === "scanchannel") {
      if (!hasPermission(interaction, "scan_role_or_owner")) {
        return interaction.reply({ content: "❌ Owner or Scan Role only.", ephemeral: true });
      }
      const channel = interaction.options.getChannel("channel");
      await interaction.deferReply();
      const r = await scanChannel(channel);
      return interaction.editReply({ content: `📁 **SCAN COMPLETE**\n**Channel:** <#${channel.id}>\n**Scanned:** ${r.scanned}\n✅ **Added:** ${r.added}\n⏭️ **Skipped:** ${r.skipped}\n📚 **Total:** ${r.total}` });
    }

    // =========================
    // /forwardall — OWNER OR SCAN ROLE + MAX SPEED
    // =========================
    if (interaction.commandName === "forwardall") {
      if (!hasPermission(interaction, "scan_role_or_owner")) {
        return interaction.reply({ content: "❌ Owner or Scan Role only.", ephemeral: true });
      }
      
      const sourceId = interaction.options.getString("source_channel_id").trim();
      const destId = interaction.options.getString("destination_channel_id").trim();

      await interaction.deferReply();

      const sourceChannel = await fetchChannelById(sourceId);
      if (!sourceChannel || !sourceChannel.isTextBased()) {
        return interaction.editReply({ content: `❌ **Invalid Source Channel:** ${sourceId}` });
      }

      const destChannel = await fetchChannelById(destId);
      if (!destChannel || !destChannel.isTextBased()) {
        return interaction.editReply({ content: `❌ **Invalid Destination Channel:** ${destId}` });
      }

      await interaction.editReply({
        content: `🔄 **Starting FULL COPY of .txt files** from <#${sourceId}> to <#${destId}>\n⚡ **Speed Mode: MAX**`
      });

      const { files: txtFiles, scanned } = await scanTxtFiles(sourceChannel);

      if (txtFiles.length === 0) {
        return interaction.editReply({
          content: `❌ No .txt files found in <#${sourceId}>\nScanned ${scanned} messages.`
        });
      }

      // ⚡ MAX SPEED — BATCH SEND
      let sent = 0, failed = 0;
      const total = txtFiles.length;
      const BATCH_SIZE = 10;

      for (let i = 0; i < txtFiles.length; i += BATCH_SIZE) {
        const batch = txtFiles.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (file) => {
          try {
            await destChannel.send({ files: [{ attachment: file.url, name: file.name }] });
            return { success: true };
          } catch (e) {
            return { success: false };
          }
        });

        const results = await Promise.allSettled(promises);
        results.forEach(r => {
          if (r.status === "fulfilled" && r.value.success) sent++;
          else failed++;
        });

        await interaction.editReply({
          content: `🔄 **Forwarding...** ⚡ ${sent}/${total}\nFrom: <#${sourceId}> → To: <#${destId}>`
        });

        if (i + BATCH_SIZE < txtFiles.length) {
          await new Promise(r => setTimeout(r, 50));
        }
      }

      return interaction.editReply({
        content: `✅ **FORWARD COMPLETE — MAX SPEED** ⚡\n**Channel:** <#${sourceId}>\n**Scanned:** ${scanned}\n**Files Found:** ${total}\n✅ **Sent:** ${sent}\n❌ **Failed:** ${failed}\n📤 **Destination:** <#${destId}>`
      });
    }

    // =========================
    // /uploadzip — OWNER OR SCAN ROLE
    // =========================
    if (interaction.commandName === "uploadzip") {
      if (!hasPermission(interaction, "scan_role_or_owner")) {
        return interaction.reply({ content: "❌ Owner or Scan Role only.", ephemeral: true });
      }
      const attachment = interaction.options.getAttachment("file");
      if (!attachment.name.toLowerCase().endsWith(".zip")) return interaction.reply({ content: "❌ Must be a .zip file.", ephemeral: true });
      await interaction.deferReply();
      const zipPath = path.join(TEMP_DIR, `${crypto.randomBytes(8).toString("hex")}.zip`);
      try {
        await downloadFile(attachment.url, zipPath);
        const result = await extractZipToLibrary(zipPath);
        return interaction.editReply({ content: `📦 **ZIP EXTRACTED**\n**File:** \`${attachment.name}\`\n✅ **Added:** ${result.added}\n⏭️ **Skipped:** ${result.skipped}\n📚 **Total:** ${result.total}` });
      } catch (err) {
        console.error("Zip error:", err);
        fs.unlink(zipPath, () => {});
        return interaction.editReply({ content: `❌ Failed to extract zip: ${err.message}` });
      }
    }

    // =========================
    // /setchannel — ADMINISTRATOR
    // =========================
    if (interaction.commandName === "setchannel") {
      if (!hasPermission(interaction, "administrator")) {
        return interaction.reply({ content: "❌ Requires Administrator permission.", ephemeral: true });
      }
      config.allowedChannelId = interaction.channelId;
      saveConfig();
      return interaction.reply({ content: `✅ **Channel Set!**\n🔗 Allowed: <#${interaction.channelId}>`, ephemeral: false });
    }

    // =========================
    // /embed — MANAGE MESSAGES
    // =========================
    if (interaction.commandName === "embed") {
      if (!hasPermission(interaction, "manage_messages")) {
        return interaction.reply({ content: "❌ Requires Manage Messages permission.", ephemeral: true });
      }
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
  const userId = message.author.id;
  const hasScanRole = message.member?.roles?.cache?.has(SCAN_ROLE_ID);
  const bypass = userId === OWNER_ID || hasScanRole;
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
