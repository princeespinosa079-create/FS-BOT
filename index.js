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
function isImage(name, contentType) {
  return String(contentType || "").toLowerCase().startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|ico|avif|heic|heif)$/i.test(String(name || ""));
}
function isAllowedFileType(name, contentType) {
  const e = ext(name);
  return (e === "txt" || e === "lua") && !isImage(name, contentType);
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
// ✅ SEARCH — BEST MATCH ON TOP
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
// SCAN CHANNEL — NO DUPES
// ============================================================
async function scanChannel(channel) {
  if (!channel?.isTextBased?.() || !channel.messages) throw new Error("Not a readable text channel.");
  if (runningScans.has(channel.id)) throw new Error("Already scanning.");
  runningScans.add(channel.id);
  try {
    const existingBases = new Set(library.files.map(f => normalizeBase(f.filename)));
    const found = [];
    let before = null, messages = 0, pages = 0, skippedDup = 0;
    while (true) {
      const batch = await fetchMessages(channel, before);
      pages++; if (!batch.size) break;
      for (const msg of batch.values()) {
        messages++;
        for (const item of attachmentsOf(msg)) {
          const a = item.attachment;
          const filename = a.name || "unknown_file";
          const baseName = normalizeBase(filename);
          const url = a.url || a.proxyURL || a.proxy_url;
          if (!baseName || !url) continue;
          if (existingBases.has(baseName)) { skippedDup++; continue; }
          existingBases.add(baseName);
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
    }
    library.files.push(...found);
    library.files.sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
    saveLibrary();
    console.log(`📂 Scan done | #${channel.name} | ${messages} msgs | ${found.length} new | ${skippedDup} dup skipped | ${pages} pages`);
    return { messages, found: found.length, skipped: skippedDup, total: library.files.length };
  } finally { runningScans.delete(channel.id); }
}
// ============================================================
// FORWARDALL — SUPER FAST
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
// SLASH COMMAND HANDLER — PERMISSIONS
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
        content: `✅ **Scan complete!**\n📂 <#${ch.id}>\n💬 Messages: \`${r.messages}\`\n📄 New: \`${r.found}\`\n🚫 Dupes skipped: \`${r.skipped}\`\n📚 Total: \`${r.total}\``
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
  // ✅ .removeline — WORKS IN /setchannel CHANNEL ONLY FOR REGULAR USERS
  if (/^\.removeline$/i.test(txt)) {
    const isOwnerOrAccess = isOwner(msg.author.id) || await hasAccess(msg.member, msg.author.id);
    // Regular users → ONLY ALLOWED IN /setchannel CHANNEL
    if (!isOwnerOrAccess && !channelAllowed(msg)) { 
      replyUser(msg, "❌ use this command in the allowed channel only, dumbass.").catch(() => {}); 
      return; 
    }
    const attachments = [...(msg.attachments?.values() || [])];
    if (!attachments.length) { replyUser(msg, "❌ bruh, upload file so i can fix it.").catch(() => {}); return; }
    const file = attachments[0];
    const fileExt = ext(file.name);
    if (fileExt !== "lua" && fileExt !== "txt") { replyUser(msg, "❌ only .lua and .txt is working, idiot.").catch(() => {}); return; }

    const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}`;
    // GRAY EMBED — NOT BLUE
    const workingEmbed = new EmbedBuilder()
      .setColor(0x808080)
      .setTitle("Working in File")
      .setDescription("⏳ Processing...")
      .setFooter({ text: timeFooter });
    const sentMsg = await replyUser(msg, { embeds: [workingEmbed] }).catch(() => {});

    const delay = isOwnerOrAccess ? 0 : 3000;
    setTimeout(async () => {
      try {
        const res = await fetch(file.url);
        const text = await res.text();
        // Remove ALL -- comments, CODE STAYS 100%
        const cleaned = text.replace(/--.*$/gm, "").split("\n").filter(l => l.trim() !== "").join("\n");
        const fixedFile = new AttachmentBuilder(Buffer.from(cleaned), { name: "prince is the best.lua" });
        
        // DELETE EMBED → SEND MENTION + MESSAGE + FILE
        if (sentMsg) await sentMsg.delete().catch(() => {});
        await msg.channel.send({
          content: `<@${msg.author.id}> **Here is the file bro!**`,
          files: [fixedFile]
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
    if (!file) { replyUser(msg, "❌ your id is wrong, try find working id, dumbass.").catch(() => {}); return; }
    const freshUrl = await getFreshUrl(file);
    replyUser(msg, { content: "**Here is the file twin!**", files: [{ attachment: freshUrl || file.url, name: file.filename || "file" }] }).catch(() => {});
    return;
  }
  // .find — SEARCH ORDER FIXED
  if (/^\.find(?:\s|$)/i.test(txt)) {
    const allowed = await hasAccess(msg.member, msg.author.id);
    if (!allowed && !channelAllowed(msg)) { replyUser(msg, "❌ not here, dumbass.").catch(() => {}); return; }
    const query = txt.slice(5).trim();
    if (!query) { replyUser(msg, "❌ usage: `.find <file name>`, dumbass.").catch(() => {}); return; }
    const results = findFiles(query);
    if (!results.length) { replyUser(msg, "❌ no matching file name for that, dumbass.").catch(() => {}); return; }
    const perPage = 8; const totalPages = Math.ceil(results.length / perPage);
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
// KEEP-ALIVE
// ============================================================
const keepAliveUrl = process.env.RENDER_EXTERNAL_URL || "";
if (keepAliveUrl) {
  setInterval(() => {
    try { require("https").get(`${keepAliveUrl}/health`).on("error", () => {}); } catch(e) {}
  }, 180000);
}
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
