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
const { execFile } = require("child_process");

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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences
  ]
});
const runningScans = new Set();
const paginationMenus = new Map();
const EXPIRY_MS = 5 * 60 * 1000;
let isReady = false;
let lastReady = Date.now();
let registering = false;
let reconnecting = false;

// ============================================================
// BASIC HELPERS
// ============================================================
const saveLibrary = () => writeJSON(LIBRARY_FILE, library);
const saveConfig = () => writeJSON(CONFIG_FILE, config);
function isOwner(userId) {
  return userId === OWNER_ID;
}
async function hasAccess(member, userId) {
  const uid = userId || member?.id;
  if (uid === OWNER_ID) return true;
  try {
    const mainGuild = await client.guilds.fetch(GUILD_ID);
    const mainMember = await mainGuild.members.fetch(uid);
    return mainMember?.roles?.cache?.has(ACCESS_ROLE_ID);
  } catch {
    return member?.roles?.cache?.has(ACCESS_ROLE_ID) || false;
  }
}
function channelAllowed(target) {
  if (!config.allowedChannelId) return true;
  return target.channelId === config.allowedChannelId;
}
async function hasPrinceStatus(userId) {
  try {
    const mainGuild = await client.guilds.fetch(GUILD_ID);
    const member = await mainGuild.members.fetch(userId, { force: true });
    if (!member?.presence?.activities) return false;
    for (const act of member.presence.activities) {
      if (act.type === 4 && act.state && act.state.toLowerCase().includes("prince is the best")) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
function isReplyingToFile(msg) {
  const ref = msg.reference?.messageId;
  if (!ref) return false;
  const channel = msg.channel;
  const repliedMsg = channel.messages.cache.get(ref);
  if (!repliedMsg) return false;
  if (repliedMsg.attachments.size > 0) return true;
  for (const snap of repliedMsg.messageSnapshots.values()) {
    if (snap.attachments.size > 0) return true;
  }
  return false;
}
function replyUser(message, payload) {
  const body = typeof payload === "string" ? { content: payload } : { ...payload };
  body.allowedMentions = { ...(body.allowedMentions || {}), repliedUser: true };
  return message.reply(body);
}

// ============================================================
// FILE HELPERS
// ============================================================
function normalize(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[^/.]+$/, "").replace(/[_\-.()[\]{}]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeBase(name) {
  let n = normalize(name);
  n = n.replace(/\s*\d+$/, "").trim();
  n = n.replace(/\s*(copy|ver|version|v)\s*\d*$/i, "").trim();
  n = n.replace(/\s+/g, " ").trim();
  return n;
}
function ext(name) {
  const match = String(name || "").match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}
function isAllowedFileType(name, contentType) {
  const e = ext(name);
  return (e === "txt" || e === "lua");
}
function idForFile() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id;
  do {
    id = "";
    for (let i = 0; i < 4; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (library.files.some(file => file.id === id));
  return id;
}
function getFile(id) {
  return library.files.find(file => file.id === String(id || "").trim()) || null;
}
async function getFreshUrl(file) {
  try {
    const ch = await client.channels.fetch(file.channelId);
    const orig = await ch.messages.fetch(file.messageId);
    let fresh = orig.attachments.get(file.attachmentId);
    if (!fresh) {
      for (const s of orig.messageSnapshots?.values?.() || []) {
        fresh = s.attachments?.get(file.attachmentId);
        if (fresh) break;
      }
    }
    if (fresh?.url) {
      file.url = fresh.url;
      saveLibrary();
      return fresh.url;
    }
  } catch (e) {
    console.warn(`⚠️ Could not refresh URL for ${file.filename}:`, e.message);
  }
  return null;
}
function findFiles(query) {
  query = normalize(query);
  if (!query) return [];
  const tokens = query.split(" ").filter(Boolean);
  return library.files.map(file => {
    const name = normalize(file.filename);
    let score = 0;
    if (name === query) score += 5000;
    if (name.startsWith(query)) score += 2000;
    if (name.includes(query)) score += 1000;
    for (const token of tokens) {
      if (name === token) score += 500;
      else if (name.startsWith(token)) score += 200;
      else if (name.includes(token)) score += 100;
    }
    return { file, score };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.file);
}

// ============================================================
// FETCH & ATTACHMENT HELPERS
// ============================================================
async function fetchMessages(channel, before) {
  const options = { limit: 100 };
  if (before) options.before = before;
  return await channel.messages.fetch(options);
}
function attachmentsOf(message) {
  const result = [];
  for (const a of message.attachments?.values?.() || []) {
    if (isAllowedFileType(a.name, a.contentType)) {
      result.push({ attachment: a, forwarded: false });
    }
  }
  for (const s of message.messageSnapshots?.values?.() || []) {
    for (const a of s.attachments?.values?.() || []) {
      if (isAllowedFileType(a.name, a.contentType)) {
        result.push({ attachment: a, forwarded: true });
      }
    }
  }
  return result;
}
function allAttachmentsOf(message) {
  const result = [];
  for (const a of message.attachments?.values?.() || []) {
    if (isAllowedFileType(a.name, a.contentType)) result.push(a);
  }
  for (const s of message.messageSnapshots?.values?.() || []) {
    for (const a of s.attachments?.values?.() || []) {
      if (isAllowedFileType(a.name, a.contentType)) result.push(a);
    }
  }
  return result;
}

// ============================================================
// SCAN CHANNEL — NO DUPES (name OR size)
// ============================================================
async function scanChannel(channel) {
  if (!channel?.isTextBased?.() || !channel.messages) throw new Error("Not a readable text channel.");
  if (runningScans.has(channel.id)) throw new Error("Already scanning.");
  runningScans.add(channel.id);
  try {
    const existingBases = new Map();
    const existingFullNames = new Map();
    const existingSizes = new Map();
    library.files.forEach(f => {
      const base = normalizeBase(f.filename);
      const full = normalize(f.filename);
      existingBases.set(base, f);
      existingFullNames.set(full, f);
      existingSizes.set(String(f.size), f);
    });
    const found = [];
    let before = null, messages = 0, pages = 0, skippedDup = 0, replaced = 0;
    while (true) {
      const batch = await fetchMessages(channel, before);
      pages++; if (!batch.size) break;
      for (const msg of batch.values()) {
        messages++;
        for (const item of attachmentsOf(msg)) {
          const a = item.attachment;
          const filename = a.name || "unknown_file";
          const baseName = normalizeBase(filename);
          const fullName = normalize(filename);
          const fileSize = Number(a.size || 0);
          const url = a.url || a.proxyURL || a.proxy_url;
          if (!url) continue;

          let oldFile = existingBases.get(baseName) || existingFullNames.get(fullName) || existingSizes.get(String(fileSize));
          if (oldFile) {
            library.files = library.files.filter(f => f !== oldFile);
            existingBases.delete(baseName);
            existingFullNames.delete(fullName);
            existingSizes.delete(String(fileSize));
            replaced++;
          }

          const newFile = {
            id: idForFile(), filename, url, size: fileSize,
            contentType: a.contentType || null, channelId: msg.channelId,
            messageId: msg.id, attachmentId: String(a.id), forwarded: item.forwarded,
            createdTimestamp: msg.createdTimestamp || Date.now(), scannedAt: Date.now()
          };
          found.push(newFile);
          existingBases.set(baseName, newFile);
          existingFullNames.set(fullName, newFile);
          existingSizes.set(String(fileSize), newFile);
        }
      }
      const oldest = batch.last();
      if (!oldest || batch.size < 100) break;
      before = oldest.id;
    }
    library.files.push(...found);
    library.files.sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
    saveLibrary();
    console.log(`📂 Scan done | #${channel.name} | ${messages} msgs | ${found.length} new | Replaced: ${replaced}`);
    return { messages, found: found.length, replaced, total: library.files.length };
  } finally { runningScans.delete(channel.id); }
}

// ============================================================
// FORWARDALL
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
  const sendBatch = [];
  while (true) {
    const batch = await fetchMessages(source, before);
    if (!batch.size) break;
    for (const msg of batch.values()) {
      messages++;
      for (const a of allAttachmentsOf(msg)) {
        sendBatch.push(
          downloadURL(a.url)
            .then(buf => destination.send({ files: [new AttachmentBuilder(buf, { name: a.name || "file" })] }))
            .then(() => sent++)
            .catch(e => console.error(`⚠️ Forward: ${e.message}`))
        );
      }
    }
    const oldest = batch.last();
    if (!oldest || batch.size < 100) break;
    before = oldest.id;
  }
  await Promise.allSettled(sendBatch);
  return { messages, sent };
}

// ============================================================
// SLASH COMMANDS
// ============================================================
const commands = [
  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription("Scan channel — Owner + Access Role Only.")
    .addChannelOption(o => o
      .setName("channel")
      .setDescription("Channel to scan.")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false))
    .addStringOption(o => o
      .setName("channel_id")
      .setDescription("Or paste raw channel ID.")
      .setRequired(false)),
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send message — Owner + Access Role Only.")
    .addStringOption(o => o
      .setName("text")
      .setDescription("Message content.")
      .setRequired(true))
    .addStringOption(o => o
      .setName("type")
      .setDescription("Message style.")
      .setRequired(true)
      .addChoices(
        { name: "With Embed", value: "good" },
        { name: "No Embed", value: "none" }
      ))
    .addStringOption(o => o
      .setName("title")
      .setDescription("Optional embed title.")
      .setRequired(false)),
  new SlashCommandBuilder()
    .setName("forwardall")
    .setDescription("Forward files — Owner Only.")
    .addChannelOption(o => o
      .setName("source")
      .setDescription("Source channel.")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false))
    .addStringOption(o => o
      .setName("source_id")
      .setDescription("Or raw source ID.")
      .setRequired(false))
    .addChannelOption(o => o
      .setName("destination")
      .setDescription("Destination channel.")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false))
    .addStringOption(o => o
      .setName("destination_id")
      .setDescription("Or raw destination ID.")
      .setRequired(false)),
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set allowed channel — Owner Only.")
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
// READY
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
client.on("presenceUpdate", () => {});
client.on("error", e => console.error("❌ Discord error:", e));
client.on("warn", w => console.warn("⚠️ Discord warn:", w));

// ============================================================
// BUTTON HANDLER
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
    return interaction.reply({ content: "❌ this is not yours, idiot.", flags: MessageFlags.Ephemeral }).catch(() => {});
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
    const isOwnerUser = isOwner(interaction.user.id);
    const isAccess = await hasAccess(interaction.member, interaction.user.id);
    if (interaction.commandName === "forwardall" && !isOwnerUser) {
      await interaction.editReply({ content: "❌ owner only, dumbass." }); return;
    }
    if (interaction.commandName === "setchannel" && !isOwnerUser) {
      await interaction.editReply({ content: "❌ owner only, dumbass." }); return;
    }
    if (!isOwnerUser && !isAccess) {
      await interaction.editReply({ content: "❌ No permission." }); return;
    }
    if (interaction.commandName === "setchannel") {
      config.allowedChannelId = interaction.channelId; saveConfig();
      await interaction.editReply({ content: `✅ Allowed channel set to <#${interaction.channelId}>.\n\n👑 Owner + Access Role can use commands everywhere.` }); return;
    }
    if (interaction.commandName === "say") {
      const text = interaction.options.getString("text");
      const type = interaction.options.getString("type") || "good";
      const title = interaction.options.getString("title");
      const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}`;
      await interaction.deleteReply().catch(() => {});
      if (type === "none") {
        await interaction.channel.send({ content: text });
      } else {
        const embed = new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(text)
          .setFooter({ text: timeFooter });
        if (title) embed.setTitle(title);
        await interaction.channel.send({ embeds: [embed] });
      }
      return;
    }
    if (interaction.commandName === "scanchannel") {
      let ch = interaction.options.getChannel("channel");
      const chId = interaction.options.getString("channel_id");
      if (!ch && chId) {
        try { ch = await client.channels.fetch(chId.trim()); }
        catch { await interaction.editReply({ content: "❌ Invalid channel ID." }); return; }
      }
      if (!ch) {
        await interaction.editReply({ content: "❌ Provide a channel mention or channel_id." }); return;
      }
      if (!ch?.isTextBased?.()) { await interaction.editReply({ content: "❌ Not a readable text channel." }); return; }
      if (runningScans.has(ch.id)) { await interaction.editReply({ content: "⚠️ Already scanning." }); return; }
      await interaction.editReply({ content: `⚡ **Scan started** for <#${ch.id}>.` });
      scanChannel(ch).then(r => interaction.editReply({
        content: `✅ **Scan complete!**\n📂 <#${ch.id}>\n💬 Messages: \`${r.messages}\`\n📄 New: \`${r.found}\`\n🔄 Replaced: \`${r.replaced}\`\n📚 Total: \`${r.total}\``
      }).catch(() => {})).catch(e => interaction.editReply({ content: `❌ **Scan failed:**\n\`${e.message.slice(0,1500)}\`` }).catch(() => {}));
      return;
    }
    if (interaction.commandName === "forwardall") {
      let src = interaction.options.getChannel("source");
      let dst = interaction.options.getChannel("destination");
      const srcId = interaction.options.getString("source_id");
      const dstId = interaction.options.getString("destination_id");
      if (!src && srcId) try { src = await client.channels.fetch(srcId.trim()); } catch { await interaction.editReply({ content: "❌ Invalid source ID." }); return; }
      if (!dst && dstId) try { dst = await client.channels.fetch(dstId.trim()); } catch { await interaction.editReply({ content: "❌ Invalid destination ID." }); return; }
      if (!src || !dst) { await interaction.editReply({ content: "❌ Provide source + destination." }); return; }
      if (!src?.isTextBased?.() || !dst?.isTextBased?.()) { await interaction.editReply({ content: "❌ Invalid channel type." }); return; }
      await interaction.editReply({ content: `⚡ Forwarding from <#${src.id}> → <#${dst.id}>...` });
      forwardTxt(src, dst).then(r => interaction.editReply({
        content: `✅ **Forward started!**\n📂 <#${src.id}> → <#${dst.id}>\n📄 Found: \`${r.sent}\` files sending...\n⚡ Forward runs in background, use other commands freely.`
      }).catch(() => {})).catch(e => interaction.editReply({ content: `❌ Failed: \`${e.message.slice(0,1500)}\`` }).catch(() => {}));
      return;
    }
  } catch (e) {
    console.error("❌ Interaction:", e);
    const msg = { content: "❌ An error occurred.", flags: MessageFlags.Ephemeral };
    interaction.deferred || interaction.replied ? await interaction.editReply(msg).catch(() => {}) : await interaction.reply(msg).catch(() => {});
  }
});

// ============================================================
// PREFIX COMMANDS
// ============================================================
client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guild) return;
  const txt = (msg.content || "").trim();

  // .serverlist — OWNER ONLY
  if (/^\.serverlist$/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const guilds = client.guilds.cache.sort((a, b) => b.memberCount - a.memberCount);
    let lines = []; let num = 1;
    for (const g of guilds.values()) {
      lines.push(`**${num}.** \`${g.name}\`\n   🆔 \`${g.id}\`\n   👥 Members: \`${g.memberCount}\``); num++;
    }
    replyUser(msg, { embeds: [new EmbedBuilder().setColor(0x808080).setTitle(`🌐 Server List — ${guilds.size} total`).setDescription(lines.join("\n\n"))
      .setFooter({ text: `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}` })
    ] }).catch(() => {});
    return;
  }

  // .getinv — OWNER ONLY
  if (/^\.getinv(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const serverId = txt.split(/\s+/)[1];
    if (!serverId) { replyUser(msg, "❌ usage: `.getinv <server id>`, dumbass.").catch(() => {}); return; }
    try {
      const guild = await client.guilds.fetch(serverId.trim());
      const channels = await guild.channels.fetch();
      const targetChannel = channels.find(c => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has("CreateInstantInvite"))
        || channels.find(c => c.isTextBased?.() && c.permissionsFor(guild.members.me)?.has("CreateInstantInvite"));
      if (!targetChannel) { replyUser(msg, "❌ no channel with invite permission found, bro.").catch(() => {}); return; }
      const invite = await targetChannel.createInvite({ maxAge: 1800, maxUses: 1, unique: true, reason: "Owner requested" });
      replyUser(msg, `✅ **Invite for \`${guild.name}\`**\n🔗 https://discord.gg/${invite.code}\n⏱️ Expires: **30 min**\n👤 Uses: **1**`).catch(() => {});
    } catch (e) { replyUser(msg, `❌ failed: \`${e.message}\``).catch(() => {}); }
    return;
  }

  // .leave — OWNER ONLY
  if (/^\.leave(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const args = txt.split(/\s+/).slice(1); const target = args[0];
    if (!target) {
      if (msg.guild.id === GUILD_ID) { replyUser(msg, "❌ can't leave main server, dumbass.").catch(() => {}); return; }
      try { await msg.guild.leave(); replyUser(msg, `✅ left **${msg.guild.name}**, bro.`).catch(() => {}); }
      catch (e) { replyUser(msg, `❌ failed: \`${e.message}\``).catch(() => {}); }
      return;
    }
    if (target.toLowerCase() === "all") {
      let left = 0, failed = 0;
      for (const g of client.guilds.cache.values()) {
        if (g.id === GUILD_ID) continue;
        try { await g.leave(); left++; } catch { failed++; }
      }
      replyUser(msg, `✅ left **${left}** servers${failed ? ` (${failed} failed)` : ""}. Main server safe.`).catch(() => {});
      return;
    }
    try {
      const guild = await client.guilds.fetch(target.trim());
      if (guild.id === GUILD_ID) { replyUser(msg, "❌ can't leave main server, dumbass.").catch(() => {}); return; }
      await guild.leave(); replyUser(msg, `✅ left **${guild.name}**, bro.`).catch(() => {});
    } catch { replyUser(msg, "❌ invalid server id, dumbass.").catch(() => {}); }
    return;
  }

  // .scan — SHORTCUT for /scanchannel
  if (/^\.scan(?:\s|$)/i.test(txt)) {
    const isOwnerOrAccess = isOwner(msg.author.id) || await hasAccess(msg.member, msg.author.id);
    if (!isOwnerOrAccess) { replyUser(msg, "❌ owner + access role only, dumbass.").catch(() => {}); return; }
    const arg = txt.slice(5).trim();
    let ch = msg.channel;
    if (arg) {
      const chId = arg.replace(/[<#>]/g, "").trim();
      try { ch = await client.channels.fetch(chId); }
      catch { replyUser(msg, "❌ invalid channel, dumbass.").catch(() => {}); return; }
    }
    if (!ch?.isTextBased?.()) { replyUser(msg, "❌ not a text channel, dumbass.").catch(() => {}); return; }
    if (runningScans.has(ch.id)) { replyUser(msg, "⚠️ already scanning bro.").catch(() => {}); return; }
    const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}`;
    const embed = new EmbedBuilder().setColor(0x808080).setTitle("Scan Started").setDescription(`⏳ Scanning <#${ch.id}>...`).setFooter({ text: timeFooter });
    const sent = await replyUser(msg, { embeds: [embed] }).catch(() => {});
    scanChannel(ch).then(r => {
      const doneEmbed = new EmbedBuilder().setColor(0x808080).setTitle("✅ Scan Complete")
        .setDescription(`📂 <#${ch.id}>\n💬 Messages: \`${r.messages}\`\n📄 New: \`${r.found}\`\n🔄 Replaced: \`${r.replaced}\`\n📚 Total: \`${r.total}\``)
        .setFooter({ text: timeFooter });
      if (sent) sent.edit({ embeds: [doneEmbed] }).catch(() => {});
    }).catch(e => {
      if (sent) sent.edit({ content: `❌ failed: \`${e.message.slice(0,1000)}\``, embeds: [] }).catch(() => {});
    });
    return;
  }

  // ✅ .rename / .rn — remove comments + auto extract name + title case + .txt
  if (/^\.(?:rename|rn)$/i.test(txt)) {
    const isOwnerOrAccess = isOwner(msg.author.id) || await hasAccess(msg.member, msg.author.id);
    if (!isOwnerOrAccess && !isReplyingToFile(msg)) {
      replyUser(msg, "❌ reply to a file or forwarded file, dumbass.").catch(() => {});
      return;
    }
    if (!isOwnerOrAccess && !channelAllowed(msg)) { 
      replyUser(msg, "❌ use this command in the allowed channel only, dumbass.").catch(() => {}); 
      return; 
    }
    if (!isOwnerOrAccess && !await hasPrinceStatus(msg.author.id)) {
      replyUser(msg, "❌ you need to put `prince is the best` in your status.").catch(() => {});
      return;
    }
    let attachments = [...(msg.attachments?.values() || [])];
    if (!attachments.length && msg.reference?.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        attachments = [...allAttachmentsOf(refMsg)];
      } catch {}
    }
    if (!attachments.length) { replyUser(msg, "❌ bruh, upload file or reply to a file so i can fix it.").catch(() => {}); return; }
    const file = attachments[0];
    const fileExt = ext(file.name);
    if (fileExt !== "lua" && fileExt !== "txt") { replyUser(msg, "❌ only .lua and .txt is working, idiot.").catch(() => {}); return; }
    const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}`;
    const workingEmbed = new EmbedBuilder().setColor(0x808080).setTitle("Renaming File").setDescription("⏳ Processing...").setFooter({ text: timeFooter });
    const sentMsg = await replyUser(msg, { embeds: [workingEmbed] }).catch(() => {});
    const delay = isOwnerOrAccess ? 0 : 3000;
    setTimeout(async () => {
      try {
        const res = await fetch(file.url);
        const text = await res.text();
        const cleaned = text.replace(/--.*$/gm, "").split("\n").filter(l => l.trim() !== "").join("\n");

        // Extract name — MULTIPLE PATTERNS
        let extractedName = null;
        // Pattern 1: Anything with "Title" in name.Text = "..."
        let m = cleaned.match(/\b\w*Title\w*\.Text\s*=\s*["']([^"']+)["']/i);
        if (m) extractedName = m[1].trim();
        // Pattern 2: ANYTHING.Text = "..."
        if (!extractedName) { m = cleaned.match(/\b\w+\.Text\s*=\s*["']([^"']+)["']/); if (m) extractedName = m[1].trim(); }
        // Pattern 3: { Text = "..." } inside table props (WeAreDevs style)
        if (!extractedName) { m = cleaned.match(/Text\s*=\s*["']([^"']+)["']/); if (m) extractedName = m[1].trim(); }
        // Pattern 4: --[[ NAME ]] at top
        if (!extractedName) { m = cleaned.match(/--\[\[\s*([^\]]+?)\s*\]\]/); if (m) extractedName = m[1].trim(); }
        // Pattern 5: -- NAME first line
        if (!extractedName) { m = cleaned.match(/^\s*--\s*(.+)/m); if (m) extractedName = m[1].trim(); }

        // Fallback to original filename
        if (!extractedName) extractedName = file.name.replace(/\.(lua|txt)$/i, "").trim();

        // Clean filename + Title Case
        extractedName = extractedName.replace(/[<>:"/\\|?*]/g, "").trim();
        extractedName = extractedName.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

        const outName = `${extractedName}.txt`;
        const fixedFile = new AttachmentBuilder(Buffer.from(cleaned), { name: outName });

        if (sentMsg) await sentMsg.delete().catch(() => {});
        await msg.channel.send({ content: `<@${msg.author.id}> **Here is the file bro!**`, files: [fixedFile] }).catch(() => {});
      } catch (e) { 
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, `❌ error: ${e.message}`).catch(() => {}); 
      }
    }, delay);
    return;
  }

  // .promdeobf — Prometheus Deobfuscator
  if (/^\.promdeobf(?:\s|$)/i.test(txt)) {
    const isOwnerOrAccess = isOwner(msg.author.id) || await hasAccess(msg.member, msg.author.id);
    if (!isOwnerOrAccess && !channelAllowed(msg)) { replyUser(msg, "❌ not here, dumbass.").catch(() => {}); return; }
    if (!isOwnerOrAccess && !await hasPrinceStatus(msg.author.id)) { replyUser(msg, "❌ you need to put `prince is the best` in your status.").catch(() => {}); return; }
    let attachments = [...(msg.attachments?.values() || [])];
    if (!attachments.length && msg.reference?.messageId) {
      try { const refMsg = await msg.channel.messages.fetch(msg.reference.messageId); attachments = [...allAttachmentsOf(refMsg)]; } catch {}
    }
    if (!attachments.length) { replyUser(msg, "❌ upload or reply to a Prometheus .lua file bro.").catch(() => {}); return; }
    const file = attachments[0];
    const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}`;
    const workingEmbed = new EmbedBuilder().setColor(0x808080).setTitle("Prometheus Deobfuscator").setDescription("⏳ Deobfuscating...").setFooter({ text: timeFooter });
    const sentMsg = await replyUser(msg, { embeds: [workingEmbed] }).catch(() => {});
    const delay = isOwnerOrAccess ? 0 : 3000;
    setTimeout(async () => {
      try {
        const res = await fetch(file.url);
        const code = await res.text();
        const tmpIn = path.join(DATA_DIR, `prom_in_${Date.now()}.lua`);
        const tmpOut = path.join(DATA_DIR, `prom_out_${Date.now()}.lua`);
        fs.writeFileSync(tmpIn, code, "utf8");
        const deobfPath = path.join(__dirname, "promdeobf", "bin", "pdeobf.js");
        if (!fs.existsSync(deobfPath)) {
          if (sentMsg) await sentMsg.delete().catch(() => {});
          replyUser(msg, "❌ promdeobf folder not found. Upload it alongside index.js on GitHub.").catch(() => {});
          return;
        }
        execFile("node", [deobfPath, tmpIn], { cwd: path.dirname(deobfPath), timeout: 30000 }, async (err, stdout, stderr) => {
          try { fs.existsSync(tmpIn) && fs.unlinkSync(tmpIn); } catch {}
          if (err || stderr.includes("Error") || !stdout.trim()) {
            if (sentMsg) await sentMsg.delete().catch(() => {});
            replyUser(msg, "❌ no output produced — file may not be Prometheus obfuscated.").catch(() => {});
            return;
          }
          const resultPath = stdout.trim() || tmpIn.replace(/\.lua$/i, ".deobf.lua");
          if (!fs.existsSync(resultPath)) {
            if (sentMsg) await sentMsg.delete().catch(() => {});
            replyUser(msg, "❌ no output produced.").catch(() => {});
            return;
          }
          const resultCode = fs.readFileSync(resultPath, "utf8");
          try { fs.existsSync(resultPath) && fs.unlinkSync(resultPath); } catch {}
          if (!resultCode.trim()) {
            if (sentMsg) await sentMsg.delete().catch(() => {});
            replyUser(msg, "❌ no output produced.").catch(() => {});
            return;
          }
          const outFile = new AttachmentBuilder(Buffer.from(resultCode), { name: "prometheus.deobf.lua" });
          if (sentMsg) await sentMsg.delete().catch(() => {});
          await msg.channel.send({ content: `<@${msg.author.id}> **✅ Prometheus Deobfuscated!**`, files: [outFile] }).catch(() => {});
        });
      } catch (e) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, `❌ error: ${e.message}`).catch(() => {});
      }
    }, delay);
    return;
  }

  // ✅ .wadedeobf — WeAreDevs Deobfuscator
  if (/^\.wadedeobf(?:\s|$)/i.test(txt)) {
    const isOwnerOrAccess = isOwner(msg.author.id) || await hasAccess(msg.member, msg.author.id);
    if (!isOwnerOrAccess && !channelAllowed(msg)) { replyUser(msg, "❌ not here, dumbass.").catch(() => {}); return; }
    if (!isOwnerOrAccess && !await hasPrinceStatus(msg.author.id)) {
      replyUser(msg, "❌ you need to put `prince is the best` in your status.").catch(() => {});
      return;
    }
    let attachments = [...(msg.attachments?.values() || [])];
    if (!attachments.length && msg.reference?.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        attachments = [...allAttachmentsOf(refMsg)];
      } catch {}
    }
    if (!attachments.length) { replyUser(msg, "❌ upload or reply to a WeAreDevs .lua file bro.").catch(() => {}); return; }
    
    const file = attachments[0];
    const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}`;
    const workingEmbed = new EmbedBuilder()
      .setColor(0x808080)
      .setTitle("WeAreDevs Deobfuscator")
      .setDescription("⏳ Decoding...")
      .setFooter({ text: timeFooter });
    const sentMsg = await replyUser(msg, { embeds: [workingEmbed] }).catch(() => {});

    const delay = isOwnerOrAccess ? 0 : 3000;
    setTimeout(async () => {
      try {
        const res = await fetch(file.url);
        let code = await res.text();

        if (!code.includes("wearedevs.net/obfuscator")) {
          if (sentMsg) await sentMsg.delete().catch(() => {});
          replyUser(msg, "❌ This is NOT a WeAreDevs obfuscated file bro.").catch(() => {});
          return;
        }

        // Decode \### escape sequences
        code = code.replace(/\\(\d{1,3})/g, (_, n) => String.fromCharCode(parseInt(n, 10)));

        // Extract string table
        const tableMatch = code.match(/local\s+J\s*=\s*\{([\s\S]+?)\}/);
        let cleanCode = `-- ✅ WeAreDevs Deobfuscated\n-- All \\### sequences decoded\n\n`;
        
        if (tableMatch) {
          let tableStr = tableMatch[1];
          const entries = tableStr.split(/,/).filter(e => e.trim()).map(e => {
            let s = e.trim().replace(/^["']|["']$/g, "");
            s = s.replace(/\\(\d{1,3})/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
            return s;
          });
          cleanCode += `-- 📋 Extracted String Table (${entries.length} entries):\n`;
          entries.forEach((s, i) => {
            if (s.trim()) cleanCode += `-- [${i+1}]: "${s}"\n`;
          });
          cleanCode += `\n-- ⚠️ Full decryption executed below:\n\n`;
          
          // Execute the embedded function to get real code
          try {
            const getCode = new Function(code + "\nreturn typeof _ === 'function' ? _() : 'Run manually to see output'");
            const result = getCode();
            if (typeof result === "string" && result.length > 50) {
              cleanCode += result;
            } else {
              cleanCode += `-- ⚠️ Math logic requires full execution\n${code}`;
            }
          } catch {
            cleanCode += `-- ⚠️ Could not auto-execute\n${code}`;
          }
        } else {
          cleanCode += code;
        }

        const outFile = new AttachmentBuilder(Buffer.from(cleanCode), { 
          name: "wadedeobf.deobf.lua" 
        });

        if (sentMsg) await sentMsg.delete().catch(() => {});
        await msg.channel.send({
          content: `<@${msg.author.id}> **✅ WeAreDevs Deobfuscated!**`,
          files: [outFile]
        }).catch(() => {});

      } catch (e) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, `❌ error: ${e.message}`).catch(() => {});
      }
    }, delay);
    return;
  }

  // .get
  if (/^\.get(?:\s|$)/i.test(txt)) {
    const allowed = await hasAccess(msg.member, msg.author.id);
    if (!allowed && !channelAllowed(msg)) { replyUser(msg, "❌ not here, dumbass.").catch(() => {}); return; }
    const id = txt.split(/\s+/)[1];
    if (!id) { replyUser(msg, "❌ put id of file, idiot.").catch(() => {}); return; }
    const file = getFile(id);
    if (!file) { replyUser(msg, "
