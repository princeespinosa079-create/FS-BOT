const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const express = require("express");
const fs = require("fs");
const path = require("path");
// ============================================================
// ENV
// ============================================================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = "1302080645987569694";
const ACCESS_ROLE_ID = "1539883004950876160";
const PORT = Number(process.env.PORT) || 10000;
if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID.");
  process.exit(1);
}
// ============================================================
// STORAGE
// ============================================================
const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;
const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
function readJSON(file, fallback) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
  } catch (e) {
    console.error(`❌ ${path.basename(file)}:`, e.message);
    return fallback;
  }
}
function writeJSON(file, data) {
  const tmp = `${file}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file); }
  catch (e) { console.error(`❌ Saving ${path.basename(file)}:`, e.message); }
}
let config = readJSON(CONFIG_FILE, { allowedChannelId: null });
if (!config || typeof config !== "object") config = { allowedChannelId: null };
let library = readJSON(LIBRARY_FILE, { files: [] });
if (Array.isArray(library)) library = { files: library };
if (!Array.isArray(library.files)) library.files = [];
// ============================================================
// DISCORD CLIENT
// ============================================================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});
const runningScans = new Set();
const paginationMenus = new Map();
const EXPIRY_MS = 5 * 60 * 1000; // 5 MINUTES
let isReady = false;
let lastReady = Date.now();
let registering = false;
let reconnecting = false;
// ============================================================
// BASIC HELPERS
// ============================================================
const saveLibrary = () => writeJSON(LIBRARY_FILE, library);
const saveConfig = () => writeJSON(CONFIG_FILE, config);
function isAllowed(member) {
  if (!member) return false;
  return member.id === OWNER_ID || member.roles?.cache?.has(ACCESS_ROLE_ID);
}
function channelAllowed(target) {
  if (!config.allowedChannelId) return true;
  return target.channelId === config.allowedChannelId;
}
function replyUser(message, payload) {
  const body = typeof payload === "string" ? { content: payload } : { ...payload };
  body.allowedMentions = { ...(body.allowedMentions || {}), repliedUser: true };
  return message.reply(body);
}
// ============================================================
// FILE SEARCH HELPERS
// ============================================================
function normalize(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[^/.]+$/, "").replace(/[_\-.()[\]{}]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function ext(name) {
  const match = String(name || "").match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}
function isImage(name, contentType) {
  return String(contentType || "").toLowerCase().startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|ico|avif|heic|heif)$/i.test(String(name || ""));
}
function idForFile() {
  let id;
  do { id = Math.random().toString(36).slice(2, 10); }
  while (library.files.some(file => file.id === id));
  return id;
}
function getFile(id) {
  return library.files.find(file => file.id === String(id || "").trim()) || null;
}
function findFiles(query) {
  query = normalize(query);
  if (!query) return [];
  const tokens = query.split(" ").filter(Boolean);
  return library.files.map(file => {
    const name = normalize(file.filename);
    let score = 0;
    if (name === query) score += 1000;
    if (name.includes(query)) score += 500;
    for (const token of tokens) {
      if (name.includes(token)) score += 100;
      else if (name.split(" ").some(word => word.startsWith(token))) score += 60;
    }
    return { file, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).map(item => item.file);
}
// ============================================================
// FETCH & ATTACHMENT HELPERS
// ============================================================
async function fetchMessages(channel, before) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const options = { limit: 100 };
      if (before) options.before = before;
      return await channel.messages.fetch(options);
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ Fetch ${attempt}/3:`, error.message);
      if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  throw lastError || new Error("Could not fetch messages.");
}
function attachmentsOf(message) {
  const result = [];
  for (const a of message.attachments?.values?.() || []) {
    if (!isImage(a.name, a.contentType)) result.push({ attachment: a, forwarded: false });
  }
  for (const s of message.messageSnapshots?.values?.() || []) {
    for (const a of s.attachments?.values?.() || []) {
      if (!isImage(a.name, a.contentType)) result.push({ attachment: a, forwarded: true });
    }
  }
  return result;
}
// ============================================================
// SCAN CHANNEL
// ============================================================
async function scanChannel(channel) {
  if (!channel?.isTextBased?.() || !channel.messages) throw new Error("Not a readable text channel.");
  if (runningScans.has(channel.id)) throw new Error("Already scanning.");
  runningScans.add(channel.id);
  try {
    const existingNames = new Set(library.files.map(f => normalize(f.filename)));
    const found = [];
    let before = null, messages = 0, pages = 0;
    while (true) {
      const batch = await fetchMessages(channel, before);
      pages++; if (!batch.size) break;
      for (const msg of batch.values()) {
        messages++;
        for (const item of attachmentsOf(msg)) {
          const a = item.attachment;
          const filename = a.name || "unknown_file";
          const normalized = normalize(filename);
          const url = a.url || a.proxyURL || a.proxy_url;
          if (!normalized || !url) continue;
          if (existingNames.has(normalized)) continue;
          existingNames.add(normalized);
          found.push({
            id: idForFile(), filename, url, size: Number(a.size || 0),
            contentType: a.contentType || null, channelId: msg.channelId,
            messageId: msg.id, attachmentId: String(a.id), forwarded: item.forwarded,
            createdTimestamp: msg.createdTimestamp || Date.now(), scannedAt: Date.now()
          });
        }
      }
      const oldest = batch.last();
      if (!oldest || batch.size < 100) break;
      before = oldest.id;
      await new Promise(r => setImmediate(r));
    }
    library.files.push(...found);
    library.files.sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
    saveLibrary();
    console.log(`📂 Scan done | #${channel.name} | ${messages} msgs | ${found.length} new | ${pages} pages`);
    return { messages, found: found.length, total: library.files.length };
  } finally { runningScans.delete(channel.id); }
}
// ============================================================
// FORWARD TXT
// ============================================================
async function downloadURL(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function forwardTxt(source, destination) {
  if (!source?.isTextBased?.()) throw new Error("Source not readable.");
  if (!destination?.isTextBased?.()) throw new Error("Dest not writable.");
  let before = null, messages = 0, sent = 0;
  while (true) {
    const batch = await fetchMessages(source, before);
    if (!batch.size) break;
    for (const msg of batch.values()) {
      messages++;
      for (const a of msg.attachments.values()) {
        if (ext(a.name) !== "txt" || isImage(a.name, a.contentType)) continue;
        try {
          const buf = await downloadURL(a.url);
          await destination.send({ files: [new AttachmentBuilder(buf, { name: a.name || "file.txt" })] });
          sent++;
        } catch (e) { console.error(`⚠️ Forward: ${e.message}`); }
      }
    }
    const oldest = batch.last();
    if (!oldest || batch.size < 100) break;
    before = oldest.id;
    await new Promise(r => setImmediate(r));
  }
  return { messages, sent };
}
// ============================================================
// SLASH COMMANDS
// ============================================================
const commands = [
  new SlashCommandBuilder().setName("scanchannel").setDescription("Scan channel for files.")
    .addChannelOption(o => o.setName("channel").setDescription("Channel to scan.")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),
  new SlashCommandBuilder().setName("embed").setDescription("Send gray embed.")
    .addStringOption(o => o.setName("description").setRequired(true))
    .addStringOption(o => o.setName("title").setRequired(false)),
  new SlashCommandBuilder().setName("forwardall").setDescription("Forward all TXT files.")
    .addChannelOption(o => o.setName("source").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    .addChannelOption(o => o.setName("destination").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),
  new SlashCommandBuilder().setName("setchannel").setDescription("Set channel for .get/.find.")
].map(c => c.toJSON());
// ============================================================
// REGISTER COMMANDS
// ============================================================
async function registerCommands() {
  if (registering) return;
  registering = true;
  const rest = new REST({ version: "10", timeout: 15000 }).setToken(TOKEN);
  try {
    console.log("🧹 Clearing old commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    console.log("🧩 Registering guild commands...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Commands registered.");
  } catch (e) { registering = false; console.error("❌ Register fail:", e.message); }
}
// ============================================================
// READY / GATEWAY
// ============================================================
client.once("ready", () => {
  isReady = true; lastReady = Date.now();
  console.log("==========================================");
  console.log(`✅ ONLINE: ${client.user.tag}`);
  console.log(`🏠 Guilds: ${client.guilds.cache.size}`);
  console.log(`📚 Files: ${library.files.length}`);
  console.log("⚡ Bot ready!");
  console.log("==========================================");
  registerCommands().catch(e => console.error("❌ Register:", e.message));
});
client.on("shardReady", id => { isReady = true; lastReady = Date.now(); console.log(`🟢 Shard ${id} ready`); });
client.on("shardResume", id => { isReady = true; lastReady = Date.now(); console.log(`🟢 Shard ${id} resumed`); });
client.on("shardReconnecting", id => { isReady = false; console.warn(`🟡 Shard ${id} reconnecting...`); });
client.on("shardDisconnect", (e, id) => { isReady = false; console.warn(`🔴 Shard ${id} down: ${e?.code}`); });
client.on("error", e => console.error("❌ Discord error:", e));
client.on("warn", w => console.warn("⚠️ Discord warn:", w));
// ============================================================
// BUTTON HANDLER + EXPIRY
// ============================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  const uid = interaction.user.id;
  if (!paginationMenus.has(uid)) {
    return interaction.reply({ content: "❌ this is expired, dumbass.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const menu = paginationMenus.get(uid);
  if (Date.now() - menu.createdAt > EXPIRY_MS) {
    paginationMenus.delete(uid);
    return interaction.reply({ content: "❌ this is expired, dumbass.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (interaction.message.id !== menu.messageId) return;
  if (interaction.user.id !== menu.authorId) {
    return interaction.reply({ content: "❌ Not your menu.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (interaction.customId === "prev_page") menu.page--;
  if (interaction.customId === "next_page") menu.page++;
  if (menu.page < 1) menu.page = 1;
  if (menu.page > menu.totalPages) menu.page = menu.totalPages;
  const start = (menu.page - 1) * 8;
  const pageItems = menu.results.slice(start, start + 8);
  const timeNow = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" });
  const embed = new EmbedBuilder()
    .setColor(0x808080)
    .setTitle("Finder Search Results")
    .setDescription(pageItems.map(f => `\`${f.filename}\` — ID: \`${f.id}\``).join("\n"))
    .setFooter({ text: `Pages ${menu.page}/${menu.totalPages} │ Today at ${timeNow}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(menu.page <= 1),
    new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(menu.page >= menu.totalPages)
  );
  await interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
  paginationMenus.set(uid, menu);
});
// ============================================================
// WATCHDOG
// ============================================================
setInterval(async () => {
  if (isReady || reconnecting || Date.now() - lastReady < 60000) return;
  reconnecting = true;
  console.warn("🟡 Reconnecting...");
  try { client.destroy(); await new Promise(r => setTimeout(r, 1500)); await client.login(TOKEN); console.log("🟢 Reconnected."); }
  catch (e) { console.error("❌ Reconnect fail:", e.message); }
  finally { reconnecting = false; }
}, 30000).unref?.();
// ============================================================
// SLASH COMMAND HANDLER
// ============================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  console.log(`📨 /${interaction.commandName}`);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (interaction.guildId !== GUILD_ID) {
      await interaction.editReply({ content: "❌ Not for this server." }); return;
    }
    if (!isAllowed(interaction.member)) {
      await interaction.editReply({ content: "❌ No permission." }); return;
    }
    if (interaction.commandName === "setchannel") {
      config.allowedChannelId = interaction.channelId; saveConfig();
      await interaction.editReply({ content: `✅ Channel set to <#${interaction.channelId}>` }); return;
    }
    if (interaction.commandName === "embed") {
      const desc = interaction.options.getString("description");
      const title = interaction.options.getString("title");
      const embed = new EmbedBuilder().setColor(0x808080).setDescription(desc)
        .setFooter({ text: `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}` });
      if (title) embed.setTitle(title);
      await interaction.deleteReply().catch(() => {});
      await interaction.channel.send({ embeds: [embed] }); return;
    }
    if (interaction.commandName === "scanchannel") {
      const ch = interaction.options.getChannel("channel");
      if (!ch?.isTextBased?.()) { await interaction.editReply({ content: "❌ Invalid channel." }); return; }
      if (runningScans.has(ch.id)) { await interaction.editReply({ content: "⚠️ Already scanning." }); return; }
      await interaction.editReply({ content: `⚡ Scanning <#${ch.id}>...` });
      scanChannel(ch).then(r => interaction.editReply({
        content: `✅ Done!\n📂 <#${r.messages}>\n💬 Msgs: \`${r.messages}\`\n📄 New: \`${r.found}\`\n📚 Total: \`${r.total}\``
      }).catch(() => {})).catch(e => interaction.editReply({ content: `❌ Fail: ${e.message.slice(0,1500)}` }).catch(() => {}));
      return;
    }
    if (interaction.commandName === "forwardall") {
      const src = interaction.options.getChannel("source");
      const dst = interaction.options.getChannel("destination");
      await interaction.editReply({ content: `⚡ Forwarding...` });
      forwardTxt(src, dst).then(r => interaction.editReply({
        content: `✅ Done!\n💬 Msgs: \`${r.messages}\`\n📄 Sent: \`${r.sent}\``
      }).catch(() => {})).catch(e => interaction.editReply({ content: `❌ Fail: ${e.message.slice(0,1500)}` }).catch(() => {}));
      return;
    }
  } catch (e) {
    console.error("❌ Interaction:", e);
    const msg = { content: "❌ Error.", flags: MessageFlags.Ephemeral };
    interaction.deferred || interaction.replied ? await interaction.editReply(msg).catch(() => {}) : await interaction.reply(msg).catch(() => {});
  }
});
// ============================================================
// PREFIX COMMANDS
// ============================================================
client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guild) return;
  const txt = (msg.content || "").trim();
  // .get
  if (/^\.get(?:\s|$)/i.test(txt)) {
    const id = txt.split(/\s+/)[1];
    if (!isAllowed(msg.member) && !channelAllowed(msg)) { replyUser(msg, "❌ not here, dumbass.").catch(() => {}); return; }
    if (!id) { replyUser(msg, "❌ put id of file, idiot.").catch(() => {}); return; }
    const file = getFile(id);
    if (!file) { replyUser(msg, "❌ your id is wrong, try find working id, dumbass.").catch(() => {}); return; }
    replyUser(msg, { content: "**Here is the file twin!**", files: [{ attachment: file.url, name: file.filename || "file" }] }).catch(async () => {
      try {
        const ch = await client.channels.fetch(file.channelId);
        const orig = await ch.messages.fetch(file.messageId);
        let fresh = orig.attachments.get(file.attachmentId);
        if (!fresh) for (const s of orig.messageSnapshots?.values?.() || []) { fresh = s.attachments?.get(file.attachmentId); if (fresh) break; }
        if (!fresh?.url) throw new Error("Unavailable.");
        file.url = fresh.url; saveLibrary();
        await replyUser(msg, { content: "**Here is the file twin!**", files: [{ attachment: fresh.url, name: file.filename || "file" }] });
      } catch { replyUser(msg, "❌ File unavailable.").catch(() => {}); }
    });
    return;
  }
  // .find
  if (/^\.find(?:\s|$)/i.test(txt)) {
    if (!isAllowed(msg.member) && !channelAllowed(msg)) { replyUser(msg, "❌ not here, dumbass.").catch(() => {}); return; }
    const query = txt.slice(5).trim();
    if (!query) { replyUser(msg, "❌ not here, dumbass.").catch(() => {}); return; }
    const results = findFiles(query);
    if (!results.length) { replyUser(msg, "❌ no matching name for that, dumbass.").catch(() => {}); return; }
    const perPage = 8;
    const totalPages = Math.ceil(results.length / perPage);
    const pageItems = results.slice(0, perPage);
    const timeNow = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" });
    const embed = new EmbedBuilder().setColor(0x808080).setTitle("Finder Search Results")
      .setDescription(pageItems.map(f => `\`${f.filename}\` — ID: \`${f.id}\``).join("\n"))
      .setFooter({ text: `Pages 1/${totalPages} │ Today at ${timeNow}` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(totalPages <= 1)
    );
    const sent = await replyUser(msg, { embeds: [embed], components: [row] }).catch(() => {});
    if (sent) paginationMenus.set(msg.author.id, { results, page: 1, totalPages, messageId: sent.id, authorId: msg.author.id, createdAt: Date.now() });
    return;
  }
});
// ============================================================
// EXPRESS SERVER
// ============================================================
const app = express();
app.get("/", (req, res) => res.status(200).send(isReady ? "✅ ONLINE" : "⏳ Starting..."));
app.get("/health", (req, res) => res.status(200).json({
  process: "online", discord: isReady ? "ready" : "offline", bot: client.user?.tag, guild: GUILD_ID, files: library.files.length
}));
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 Port ${PORT}`));

// ============================================================
// ✅ KEEP-ALIVE — PREVENTS RENDER SLEEP
// ============================================================
setInterval(() => {
  try { require("http").get(`http://localhost:${PORT}/health`, r => console.log(`❤️ Keep-alive OK | ${r.statusCode}`)); }
  catch(e) { console.log(`❤️ Keep-alive: ${e.message}`); }
}, 4 * 60 * 1000); // Pings every 4 minutes

// ============================================================
// ERROR HANDLERS
// ============================================================
process.on("unhandledRejection", e => console.error("❌ Rejection:", e));
process.on("uncaughtException", e => console.error("❌ Exception:", e));

// ============================================================
// LOGIN
// ============================================================
console.log("🔑 Connecting...");
client.login(TOKEN).catch(e => { console.error("❌ Login fail:", e); process.exit(1); });
