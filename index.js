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
// EXPRESS
// =========================
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("FS Bot Online"));
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 Port ${PORT} open`));

// =========================
// DATA DIRS & FILES
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
// SCAN FILES
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
        if (!a.name.toLowerCase().endsWith(".txt")) continue;
        foundFiles.push({ name: a.name, url: a.url, size: a.size });
      }
      if (msg.messageSnapshots) {
        const snapshots = Array.isArray(msg.messageSnapshots) ? msg.messageSnapshots : [...(msg.messageSnapshots.values?.() || [])];
        for (const snap of snapshots) {
          if (!snap?.attachments) continue;
          const atts = typeof snap.attachments.values === "function" ? snap.attachments.values() : Array.isArray(snap.attachments) ? snap.attachments : [];
          for (const a of atts) {
            if (!a.name.toLowerCase().endsWith(".txt")) continue;
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
// INVITE LINK
// =========================
async function getGuildInvite(guild) {
  try {
    const invites = await guild.invites.fetch().catch(() => []);
    if (invites.size > 0) return `https://discord.gg/${invites.first().code}`;
    const channel = guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite));
    if (channel) {
      const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, reason: "Server list invite" }).catch(() => null);
      if (invite) return `https://discord.gg/${invite.code}`;
    }
    return "No permission";
  } catch { return "No permission"; }
}

// =========================
// CLIENT
// =========================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages]
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
    .setName("forwardall")
    .setDescription("(Owner Only) Copy all .txt files to another channel")
    .addStringOption(o => o.setName("source_channel_id").setDescription("Source Channel ID").setRequired(true))
    .addStringOption(o => o.setName("destination_channel_id").setDescription("Destination Channel ID").setRequired(true)),

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
    .addStringOption(o => o.setName("id").setDescription("Role ID or User ID (paste ID)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("(Manage Messages) Send a gray embed")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName("description").setDescription("Embed text content").setRequired(true))
    .addStringOption(o => o.setName("title").setDescription("Optional title").setRequired(false)),

  new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("(Owner Only) List all servers with invite links"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("(Owner Only) Make the bot leave a server")
    .addStringOption(o => o.setName("server-id").setDescription("Server ID to leave").setRequired(true))
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
        if (ownerUserId !== userId) return interaction.reply({ content: "❌ stfu, this is not your search idiot.", ephemeral: true });
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
    // /whitelist — (Owner Only)
    // =========================
    if (interaction.commandName === "whitelist") {
      if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "❌ (Owner Only) You don't have permission.", ephemeral: true });
      const mode = interaction.options.getString("mode");
      const type = interaction.options.getString("type");
      const id = interaction.options.getString("id").trim();
      
      if (!/^\d+$/.test(id)) return interaction.reply({ content: "❌ Invalid ID format. Must be numbers only.", ephemeral: true });
      
      if (type === "role") {
        if (mode === "add") {
          if (!whitelist.roles.includes(id)) whitelist.roles.push(id);
          saveWhitelist();
          return interaction.reply({ content: `✅ Role ID \`${id}\` added to whitelist.`, ephemeral: true });
        } else {
          whitelist.roles = whitelist.roles.filter(r => r !== id);
          saveWhitelist();
          return interaction.reply({ content: `✅ Role ID \`${id}\` removed from whitelist.`, ephemeral: true });
        }
      } else {
        if (mode === "add") {
          if (!whitelist.users.includes(id)) whitelist.users.push(id);
          saveWhitelist();
          return interaction.reply({ content: `✅ User ID \`${id}\` added to whitelist.`, ephemeral: true });
        } else {
          whitelist.users = whitelist.users.filter(u => u !== id);
          saveWhitelist();
          return interaction.reply({ content: `✅ User ID \`${id}\` removed from whitelist.`, ephemeral: true });
        }
      }
    }

    // =========================
    // /serverlist — (Owner Only)
    // =========================
    if (interaction.commandName === "serverlist") {
      if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "❌ (Owner Only) Permission required.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const guilds = [...client.guilds.cache.values()];
      let list = `**📋 Servers (${guilds.length}):**\n\n`;
      for (let i = 0; i < guilds.length; i++) {
        const g = guilds[i];
        const invite = await getGuildInvite(g);
        list += `${i+1}. **${g.name}**\n   ID: \`${g.id}\`\n   Invite: ${invite}\n\n`;
        if (list.length > 3500) { list += "\n... (truncated)"; break; }
      }
      return interaction.editReply({ content: list });
    }

    // =========================
    // /leave — (Owner Only)
    // =========================
    if (interaction.commandName === "leave") {
      if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "❌ (Owner Only) Permission required.", ephemeral: true });
      const g = client.guilds.cache.get(interaction.options.getString("server-id"));
      if (!g) return interaction.reply({ content: "❌ Server not found.", ephemeral: true });
      try { await g.leave(); return interaction.reply({ content: `✅ Left **${g.name}**`, ephemeral: true }); }
      catch { return interaction.reply({ content: "❌ Failed to leave.", ephemeral: true }); }
    }

    // =========================
    // /scanchannel — (Owner Only)
    // =========================
    if (interaction.commandName === "scanchannel") {
      if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "❌ (Owner Only) Permission required.", ephemeral: true });
      const channel = interaction.options.getChannel("channel");
      await interaction.deferReply();
      const r = await scanChannel(channel);
      return interaction.editReply({ content: `📁 **SCAN COMPLETE**\n**Channel:** <#${channel.id}>\n**Scanned:** ${r.scanned}\n✅ **Added:** ${r.added}\n⏭️ **Skipped:** ${r.skipped}\n📚 **Total:** ${r.total}` });
    }

    // =========================
    // /forwardall — (Owner Only)
    // =========================
    if (interaction.commandName === "forwardall") {
      if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "❌ (Owner Only) Permission required.", ephemeral: true });
      const sourceId = interaction.options.getString("source_channel_id").trim();
      const destId = interaction.options.getString("destination_channel_id").trim();
      await interaction.deferReply();
      const sourceChannel = await fetchChannelById(sourceId);
      if (!sourceChannel || !sourceChannel.isTextBased()) return interaction.editReply({ content: `❌ **Invalid Source Channel:** ${sourceId}` });
      const destChannel = await fetchChannelById(destId);
      if (!destChannel || !destChannel.isTextBased()) return interaction.editReply({ content: `❌ **Invalid Destination Channel:** ${destId}` });
      await interaction.editReply({ content: `🔄 **Starting FULL COPY of .txt files** from <#${sourceId}> to <#${destId}>\n⚡ **Speed Mode: MAX**` });
      const { files: txtFiles, scanned } = await scanTxtFiles(sourceChannel);
      if (txtFiles.length === 0) return interaction.editReply({ content: `❌ No .txt files found in <#${sourceId}>\nScanned ${scanned} messages.` });
      let sent = 0, failed = 0;
      const total = txtFiles.length;
      const BATCH_SIZE = 10;
      for (let i = 0; i < txtFiles.length; i += BATCH_SIZE) {
        const batch = txtFiles.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (file) => {
          try { await destChannel.send({ files: [{ attachment: file.url, name: file.name }] }); return { success: true }; }
          catch (e) { return { success: false }; }
        });
        const results = await Promise.allSettled(promises);
        results.forEach(r => { if (r.status === "fulfilled" && r.value.success) sent++; else failed++; });
        await interaction.editReply({ content: `🔄 **Forwarding...** ⚡ ${sent}/${total}\nFrom: <#${sourceId}> → To: <#${destId}>` });
        if (i + BATCH_SIZE < txtFiles.length) await new Promise(r => setTimeout(r, 50));
      }
      return interaction.editReply({ content: `✅ **FORWARD COMPLETE — MAX SPEED** ⚡\n**Channel:** <#${sourceId}>\n**Scanned:** ${scanned}\n**Files Found:** ${total}\n✅ **Sent:** ${sent}\n❌ **Failed:** ${failed}\n📤 **Destination:** <#${destId}>` });
    }

    // =========================
    // /setchannel — (Administrator)
    // =========================
    if (interaction.commandName === "setchannel") {
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ (Administrator) Permission required.", ephemeral: true });
      config.allowedChannelId = interaction.channelId;
      saveConfig();
      return interaction.reply({ content: `✅ **Channel Set!**\n🔗 Allowed channel for .find, .get, .upload: <#${interaction.channelId}>`, ephemeral: false });
    }

    // =========================
    // /embed — (Manage Messages)
    // =========================
    if (interaction.commandName === "embed") {
      if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: "❌ (Manage Messages) Permission required.", ephemeral: true });
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
// ✅ PREFIX COMMANDS — WHITELIST + DM SUPPORT
// =========================
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  
  const userId = message.author.id;
  const member = message.guild ? message.member : null;
  const whitelisted = isWhitelisted(userId, member);
  const isDM = !message.guild;
  const inAllowedChannel = isDM || !config.allowedChannelId || message.channel.id === config.allowedChannelId;

  // .help — everyone can use
  if (message.content.toLowerCase() === ".help") {
    const helpEmbed = new EmbedBuilder()
      .setTitle("How this works?")
      .setColor(0x808080)
      .setDescription("> - **use** `.find` **<file name> to find source.**\n> - **use** `.get` **<the file id> to give the source to you.**\n> - **use** `.upload` **and attach file to give it in the bot.**")
      .setFooter({ text: `Today at ${getTimePH()}` });
    return message.channel.send({ embeds: [helpEmbed] });
  }

  // .upload — whitelist + allowed channel / DM
  if (message.content.toLowerCase().startsWith(".upload")) {
    if (!whitelisted) return;
    if (!isDM && !inAllowedChannel) return message.reply("❌ not here, dumbass.");
    
    if (!message.attachments.size) return message.reply("❌ put file here nga.");
    
    const attachment = message.attachments.first();
    if (isImageFile(attachment.name)) return message.reply("❌ Images are not allowed.");
    
    if (fileExistsByName(attachment.name)) return message.reply("❌ this shit is already in the bot.");
    
    const tempPath = path.join(TEMP_DIR, `${generateId()}_${attachment.name}`);
    try {
      await downloadFile(attachment.url, tempPath);
      const stats = fs.statSync(tempPath);
      libraryFiles.push({
        id: generateId(),
        name: attachment.name,
        url: tempPath,
        isLocal: true,
        size: stats.size,
        timestamp: Date.now()
      });
      saveLibrary();
      return message.reply("✅ your file just upload in bot, you're cool now.");
    } catch (err) {
      console.error("Upload error:", err);
      return message.reply("❌ Failed to upload file.");
    }
  }

  // .find — whitelist + allowed channel / DM
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
    return;
  }

  // .get — whitelist + allowed channel / DM
  if (message.content.toLowerCase().startsWith(".get ")) {
    if (!whitelisted) return;
    if (!isDM && !inAllowedChannel) return message.reply("❌ not here, dumbass.");
    
    const id = message.content.slice(5).trim();
    if (!id) return message.reply("❌ Put ID of File, idiot.");
    const file = getFileById(id);
    if (!file) return message.reply("❌ make sure that correct, idiot.");
    
    if (file.isLocal && fs.existsSync(file.url)) {
      await message.channel.send({
        content: `<@${message.author.id}> **Here is the file twin!**`,
        files: [{ attachment: file.url, name: file.name }]
      });
    } else {
      await message.channel.send({
        content: `<@${message.author.id}> **Here is the file twin!**`,
        files: [{ attachment: file.url, name: file.name }]
      });
    }
    return;
  }
});

// =========================
// LOGIN
// =========================
client.on("error", e => console.error("❌ Client error:", e));
process.on("unhandledRejection", e => console.error("❌ Rejection:", e));
console.log("🔑 Logging in...");
client.login(TOKEN).catch(e => { console.error("❌ Login failed:", e); process.exit(1); });
