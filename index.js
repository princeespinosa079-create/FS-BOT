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
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { WebhookClient } = require("discord.js");
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
const MAX_SPAM_DURATION = 60000;
const WEBHOOK_AUTO_DELETE_DELAY = 60000;

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
const WEBHOOK_LOGS_FILE = path.join(DATA_DIR, "webhook-logs.json");

function readJSON(file, fallback) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback; }
  catch (e) { console.error(`❌ ${path.basename(file)}:`, e.message); return fallback; }
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
let webhookLogs = readJSON(WEBHOOK_LOGS_FILE, []);
if (!Array.isArray(webhookLogs)) webhookLogs = [];

const saveLibrary = () => writeJSON(LIBRARY_FILE, library);
const saveConfig = () => writeJSON(CONFIG_FILE, config);
const saveLogs = () => writeJSON(WEBHOOK_LOGS_FILE, webhookLogs);

// ============================================================
// COOLDOWN TRACKER
// ============================================================
const rnCooldown = new Map();
const RN_COOLDOWN_SEC = 10;

// ============================================================
// HELPERS
// ============================================================
function isOwner(userId) { return userId === OWNER_ID; }
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
      if (act.type === 4 && act.state && act.state.toLowerCase().includes(".gg/tbbauzu8cw")) {
        return true;
      }
    }
    return false;
  } catch { return false; }
}
function getPHTime() {
  return new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour:"2-digit", minute:"2-digit", hour12:false });
}
function randomLuaName() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return Array.from({length:20}, ()=>chars[Math.floor(Math.random()*chars.length)]).join("") + ".lua";
}
function normalize(name) {
  return String(name||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\.[^.]+$/,"").replace(/[_\-.()[\]{}]+/g," ").replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
}
function normalizeBase(name) {
  return normalize(name).replace(/\s*\d+$/,"").replace(/\s*(copy|ver|version|v)\s*\d*$/i,"").trim();
}
function ext(name) {
  const match = String(name||"").match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}
function isImage(name, contentType) {
  return String(contentType||"").toLowerCase().startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|ico|avif|heic|heif)$/i.test(String(name||""));
}
function isAllowedFileType(name, contentType) {
  const e = ext(name);
  return (e === "txt" || e === "lua") && !isImage(name, contentType);
}
function idForFile() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id;
  do { id = Array.from({length:4}, ()=>chars[Math.floor(Math.random()*chars.length)]).join(""); }
  while(library.files.some(f=>f.id===id));
  return id;
}
function getFile(id) {
  return library.files.find(f=>f.id===String(id||"").trim())||null;
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
    if (fresh?.url) { file.url = fresh.url; saveLibrary(); return fresh.url; }
  } catch(e) { console.warn(`⚠️ Refresh URL: ${e.message}`); }
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
function isReplyingToFile(msg) {
  const ref = msg.reference?.messageId;
  if (!ref) return false;
  const repliedMsg = msg.channel.messages.cache.get(ref);
  if (!repliedMsg) return false;
  if (repliedMsg.attachments.size > 0) return true;
  for (const snap of repliedMsg.messageSnapshots?.values?.() || []) {
    if (snap.attachments.size > 0) return true;
  }
  return false;
}
function replyUser(message, payload) {
  const body = typeof payload === "string" ? { content: payload } : { ...payload };
  body.allowedMentions = { ...(body.allowedMentions||{}), repliedUser: true };
  return message.reply(body);
}
function allAttachmentsOf(message) {
  const result = [];
  for (const a of message.attachments?.values?.() || [])
    if (isAllowedFileType(a.name, a.contentType)) result.push(a);
  for (const s of message.messageSnapshots?.values?.() || [])
    for (const a of s.attachments?.values?.() || [])
      if (isAllowedFileType(a.name, a.contentType)) result.push(a);
  return result;
}

// ============================================================
// WEBHOOK SPAM TRACKER
// ============================================================
const activeSpam = new Map();

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
let isReady = false, lastReady = Date.now(), registering = false, reconnecting = false;

// ============================================================
// SCAN & FORWARD HELPERS
// ============================================================
async function fetchMessages(channel, before) {
  const options = { limit: 100 }; if(before) options.before = before;
  return await channel.messages.fetch(options);
}
function attachmentsOf(message) {
  const result = [];
  for (const a of message.attachments?.values?.() || [])
    if (isAllowedFileType(a.name, a.contentType)) result.push({ attachment:a, forwarded:false });
  for (const s of message.messageSnapshots?.values?.() || [])
    for (const a of s.attachments?.values?.() || [])
      if (isAllowedFileType(a.name, a.contentType)) result.push({ attachment:a, forwarded:true });
  return result;
}
async function scanChannel(channel) {
  if (!channel?.isTextBased?.() || !channel.messages) throw new Error("Not a readable text channel.");
  if (runningScans.has(channel.id)) throw new Error("Already scanning.");
  runningScans.add(channel.id);
  try {
    const existingBases = new Set(library.files.map(f => normalizeBase(f.filename)));
    const existingFullNames = new Set(library.files.map(f => normalize(f.filename)));
    const existingSizes = new Set(library.files.map(f => Number(f.size || 0)));
    const found = [];
    let before = null, messages = 0, pages = 0, replacedDup = 0;
    while (true) {
      const batch = await fetchMessages(channel, before);
      pages++; if (!batch.size) break;
      for (const msg of batch.values()) { messages++;
        for (const item of attachmentsOf(msg)) {
          const a = item.attachment;
          const filename = a.name || "unknown_file", baseName = normalizeBase(filename);
          const fullName = normalize(filename), fileSize = Number(a.size || 0);
          const url = a.url || a.proxyURL || a.url;
          if (!baseName || !url) continue;
          const isDupBase = existingBases.has(baseName);
          const isDupFull = existingFullNames.has(fullName);
          const isDupSize = fileSize > 0 && existingSizes.has(fileSize);
          if (isDupBase || isDupFull || isDupSize) {
            const beforeCount = library.files.length;
            library.files = library.files.filter(f => {
              const fBase = normalizeBase(f.filename), fFull = normalize(f.filename), fSize = Number(f.size || 0));
              if (isDupBase && fBase === baseName) return false;
              if (isDupFull && fFull === fullName) return false;
              if (isDupSize && fSize === fileSize) return false;
              return true;
            });
            replacedDup += beforeCount - library.files.length;
            existingBases.clear(); existingFullNames.clear(); existingSizes.clear();
            library.files.forEach(lf => {
              existingBases.add(normalizeBase(lf.filename));
              existingFullNames.add(normalize(lf.filename));
              existingSizes.add(Number(lf.size || 0));
            });
          }
          existingBases.add(baseName); existingFullNames.add(fullName); existingSizes.add(fileSize);
          found.push({
            id: idForFile(), filename, url, size: fileSize,
            contentType: a.contentType || null, channelId: msg.channelId,
            messageId: msg.id, attachmentId: String(a.id), forwarded: item.forwarded,
            createdTimestamp: msg.createdTimestamp || Date.now(), scannedAt: Date.now()
          });
        }
      }
      const oldest = batch.last(); if (!oldest || batch.size < 100) break;
      before = oldest.id;
    }
    library.files.push(...found);
    library.files.sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
    saveLibrary();
    return { messages, found: found.length, replaced: replacedDup, skipped: 0, total: library.files.length };
  } finally { runningScans.delete(channel.id); }
}
async function downloadURL(url) {
  const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function forwardTxt(source, destination) {
  if (!source?.isTextBased?.()) throw new Error("Source not readable.");
  if (!destination?.isTextBased?.()) throw new Error("Dest not writable.");
  let before = null, sent = 0; const sendBatch = [];
  while (true) {
    const batch = await fetchMessages(source, before); if (!batch.size) break;
    for (const msg of batch.values()) {
      for (const a of allAttachmentsOf(msg))) {
        sendBatch.push(downloadURL(a.url).then(buf =>
          destination.send({ files: [new AttachmentBuilder(buf, { name: a.name || "file" })] })
        ).then(() => sent++).catch(e => console.error(`⚠️ Forward: ${e.message}`)));
      }
    }
    const oldest = batch.last(); if (!oldest || batch.size < 100) break;
    before = oldest.id;
  }
  await Promise.allSettled(sendBatch);
  return { sent };
}

// ============================================================
// ✅ ALL SLASH COMMANDS — NOTHING MISSING
// ============================================================
const commands = [
  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription("Scan channel — Owner + Access Role Only.")
    .addChannelOption(o => o.setName("channel").setDescription("Channel to scan.").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption(o => o.setName("channel_id").setDescription("Or paste raw channel ID.")),
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send message — Owner + Access Role Only.")
    .addStringOption(o => o.setName("text").setDescription("Message content.").setRequired(true))
    .addStringOption(o => o.setName("type").setDescription("Message style.").setRequired(true)
      .addChoices({ name: "With Embed", value: "good" }, { name: "No Embed", value: "none" }))
    .addStringOption(o => o.setName("title").setDescription("Optional embed title.")),
  new SlashCommandBuilder()
    .setName("forwardall")
    .setDescription("Forward files — Owner Only.")
    .addChannelOption(o => o.setName("source").setDescription("Source channel.").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption(o => o.setName("source_id").setDescription("Or raw source ID."))
    .addChannelOption(o => o.setName("destination").setDescription("Destination channel.").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption(o => o.setName("destination_id").setDescription("Or raw destination ID.")),
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set allowed channel — Owner Only."),
  new SlashCommandBuilder()
    .setName("webhookpanel")
    .setDescription("Open webhook spam panel"),
  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("View webhook usage logs — Owner Only")
].map(c => c.toJSON());

// ============================================================
// REGISTER COMMANDS
// ============================================================
async function registerCommands() {
  if (registering) return; registering = true;
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
// BUTTON HANDLER — PAGINATION + WEBHOOK
// ============================================================
client.on("interactionCreate", async interaction => {
  // Pagination buttons
  if (interaction.isButton() && ["prev_page", "next_page"].includes(interaction.customId)) {
    const uid = interaction.user.id;
    if (!paginationMenus.has(uid))
      return interaction.reply({ content: "❌ this is expired, dumbass.", flags: MessageFlags.Ephemeral }).catch(() => {});
    const menu = paginationMenus.get(uid);
    if (Date.now() - menu.createdAt > EXPIRY_MS) {
      paginationMenus.delete(uid);
      return interaction.reply({ content: "❌ this is expired, dumbass.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (interaction.message.id !== menu.messageId || interaction.user.id !== menu.authorId)
      return interaction.reply({ content: "❌ this is not yours, idiot.", flags: MessageFlags.Ephemeral }).catch(() => {});
    menu.page += interaction.customId === "prev_page" ? -1 : 1;
    if (menu.page < 1) menu.page = 1;
    if (menu.page > menu.totalPages) menu.page = menu.totalPages;
    const start = (menu.page - 1) * 8;
    const pageItems = menu.results.slice(start, start + 8);
    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setTitle("Finder Search Results")
      .setDescription(pageItems.map(f => `\`${f.filename}\` — ID: \`${f.id}\``).join("\n"))
      .setFooter({ text: `Pages ${menu.page}/${menu.totalPages} │ Today at ${getPHTime()}` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(menu.page <= 1),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(menu.page >= menu.totalPages)
    );
    await interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
    paginationMenus.set(uid, menu); return;
  }

  // Webhook: Open Modal
  if (interaction.isButton() && interaction.customId === "open_spam_modal") {
    const modal = new ModalBuilder().setCustomId("spam_modal").setTitle("Webhook Spam");
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("webhook_url").setLabel("Webhook URL").setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message_content").setLabel("Message").setStyle(TextInputStyle.Paragraph).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("delay").setLabel("Delay (seconds)").setStyle(TextInputStyle.Short))
    );
    await interaction.showModal(modal); return;
  }

  // Webhook: Stop Button
  if (interaction.isButton() && interaction.customId.startsWith("stop_spam:")) {
    const webhookUrl = interaction.customId.slice(10);
    const spam = activeSpam.get(webhookUrl);
    if (!spam) return interaction.reply({ content: "⚠️ No active spam found.", flags: MessageFlags.Ephemeral });
    if (spam.ownerUserId !== interaction.user.id && !isOwner(interaction.user.id))
      return interaction.reply({ content: "❌ Only starter or owner can stop.", flags: MessageFlags.Ephemeral });
    spam.stop = true;
    if (spam.deleteTimer) clearTimeout(spam.deleteTimer);
    try { await new WebhookClient({ url: webhookUrl }).delete(); } catch {}
    activeSpam.delete(webhookUrl);
    const disabledRow = ActionRowBuilder.from(interaction.message.components[0])
      .setComponents(ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true).setLabel("Stopped"));
    await interaction.update({ components: [disabledRow] }).catch(() => {});
    await interaction.followUp({ content: "🛑 Stopped! Webhook deleted.", flags: MessageFlags.Ephemeral }); return;
  }

  // Webhook: Modal Submit
  if (interaction.isModalSubmit() && interaction.customId === "spam_modal") {
    const webhookUrl = interaction.fields.getTextInputValue("webhook_url");
    const message = interaction.fields.getTextInputValue("message_content");
    const delaySec = Math.max(0.5, Number(interaction.fields.getTextInputValue("delay")) || 1);
    const user = interaction.user;
    const startTime = Date.now();
    let messagesSent = 0;
    if (activeSpam.has(webhookUrl))
      return interaction.reply({ content: "⚠️ Already running.", flags: MessageFlags.Ephemeral });
    const deleteTimer = setTimeout(async () => {
      const spam = activeSpam.get(webhookUrl); if (!spam) return; spam.stop = true;
      try { await new WebhookClient({ url: webhookUrl }).delete(); } catch {}
      activeSpam.delete(webhookUrl);
    }, WEBHOOK_AUTO_DELETE_DELAY);
    activeSpam.set(webhookUrl, { stop: false, deleteTimer, ownerUserId: user.id });
    webhookLogs.push({ userId: user.id, username: user.username, messagesSent: 0, time: new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }) });
    saveLogs();
    const stopEmbed = new EmbedBuilder().setColor("#2c2c34").setTitle("🔄 Spam Running")
      .setDescription(`⏱️ Auto-stop: 60s\n🗑️ Auto-delete: 60s\n📤 Message: \`${message.slice(0,80)}${message.length>80?"...":""}\``)
      .setFooter({ text: `Started by @${user.username} │ Today at ${getPHTime()}` });
    const stopRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`stop_spam:${webhookUrl}`).setLabel("🛑 Stop & Delete").setStyle(ButtonStyle.Danger));
    await interaction.reply({ embeds: [stopEmbed], components: [stopRow], flags: MessageFlags.Ephemeral });
    (async () => {
      const wh = new WebhookClient({ url: webhookUrl });
      try {
        while (Date.now() - startTime < MAX_SPAM_DURATION && activeSpam.get(webhookUrl)?.stop !== true) {
          try {
            await wh.send({ content: message });
            messagesSent++;
            const lastLog = webhookLogs[webhookLogs.length - 1];
            if (lastLog && lastLog.userId === user.id) { lastLog.messagesSent = messagesSent; saveLogs(); }
          } catch { break; }
          await new Promise(r => setTimeout(r, delaySec * 1000));
        }
      } finally {
        const spam = activeSpam.get(webhookUrl);
        if (spam && !spam.stop) {
          spam.stop = true; if (spam.deleteTimer) clearTimeout(spam.deleteTimer);
          try { await wh.delete(); } catch {}
          activeSpam.delete(webhookUrl);
        }
      }
    })(); return;
  }

  // Slash Commands Handler
  if (interaction.isChatInputCommand()) {
    const { commandName, user } = interaction;

    if (commandName === "webhookpanel") {
      const embed = new EmbedBuilder().setColor("#2c2c34").setTitle("Webhook Spammer")
        .setDescription("> Click `Spam` button below to send messages via webhook.\n⏱️ Max duration: **60s** • Webhook auto-deletes after use")
        .setFooter({ text: `Sent by @${user.username} │ Today at ${getPHTime()}` });
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("open_spam_modal").setLabel("Spam").setStyle(ButtonStyle.Success));
      await interaction.reply({ embeds: [embed], components: [row] }); return;
    }

    if (commandName === "logs") {
      if (!isOwner(user.id))
        return interaction.reply({ content: "❌ Only bot owner can view logs.", flags: MessageFlags.Ephemeral });
      if (!webhookLogs.length)
        return interaction.reply({ content: "📋 No webhook usage logs yet.", flags: MessageFlags.Ephemeral });
      const logText = webhookLogs.slice(-20).reverse().map((log, i) =>
        `${i + 1}. @${log.username} (${log.userId}) — ${log.messagesSent} msg(s) — ${log.time}`
      ).join("\n");
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle("📋 Webhook Usage Logs").setDescription(logText)], flags: MessageFlags.Ephemeral }); return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const isOwnerUser = isOwner(user.id);
    const isAccessUser = await hasAccess(null, user.id);
    if (commandName === "forwardall" && !isOwnerUser)
      return interaction.editReply({ content: "❌ owner only, dumbass." });
    if (commandName === "setchannel" && !isOwnerUser)
      return interaction.editReply({ content: "❌ owner only, dumbass." });
    if (!isOwnerUser && !isAccessUser)
      return interaction.editReply({ content: "❌ No permission." });
    if (commandName === "setchannel") {
      config.allowedChannelId = interaction.channelId; saveConfig();
      await interaction.editReply({ content: `✅ Allowed channel set to <#${interaction.channelId}>.\n\n👑 Owner + Access Role can use commands everywhere.` }); return;
    }
    if (commandName === "say") {
      const text = interaction.options.getString("text");
      const type = interaction.options.getString("type") || "good";
      const title = interaction.options.getString("title");
      const timeFooter = `Today at ${getPHTime()}`;
      await interaction.deleteReply().catch(() => {});
      if (type === "none") {
        await interaction.channel.send({ content: text });
      } else {
        const embed = new EmbedBuilder().setColor(0x808080).setDescription(text).setFooter({ text: timeFooter });
        if (title) embed.setTitle(title);
        await interaction.channel.send({ embeds: [embed] });
      }
      return;
    }
    if (commandName === "scanchannel") {
      let ch = interaction.options.getChannel("channel");
      const chId = interaction.options.getString("channel_id");
      if (!ch && chId) try { ch = await client.channels.fetch(chId.trim()); } catch { return interaction.editReply({ content: "❌ Invalid channel ID." }); }
      if (!ch) return interaction.editReply({ content: "❌ Provide a channel mention or channel_id." });
      if (!ch?.isTextBased?.()) return interaction.editReply({ content: "❌ Not a readable text channel." });
      if (runningScans.has(ch.id)) return interaction.editReply({ content: "⚠️ Already scanning." });
      await interaction.editReply({ content: `⚡ **Scan started** for <#${ch.id}>.` });
      scanChannel(ch).then(r => interaction.editReply({
        content: `✅ **Scan complete!**\n📂 <#${ch.id}>\n💬 Messages: \`${r.messages}\`\n📄 New: \`${r.found}\`\n🔄 Replaced: \`${r.replaced || 0}\`\n🚫 Skipped: \`${r.skipped}\`\n📚 Total: \`${r.total}\``
      })).catch(e => interaction.editReply({ content: `❌ **Scan failed:**\n\`${e.message.slice(0,1500)}\`` })); return;
    }
    if (commandName === "forwardall") {
      let src = interaction.options.getChannel("source");
      let dst = interaction.options.getChannel("destination");
      const srcId = interaction.options.getString("source_id");
      const dstId = interaction.options.getString("destination_id");
      if (!src && srcId) try { src = await client.channels.fetch(srcId.trim()); } catch { return interaction.editReply({ content: "❌ Invalid source ID." }); }
      if (!dst && dstId) try { dst = await client.channels.fetch(dstId.trim()); } catch { return interaction.editReply({ content: "❌ Invalid destination ID." }); }
      if (!src || !dst) return interaction.editReply({ content: "❌ Provide source + destination." });
      if (!src?.isTextBased?.() || !dst?.isTextBased?.()) return interaction.editReply({ content: "❌ Invalid channel type." });
      await interaction.editReply({ content: `⚡ Forwarding from <#${src.id}> → <#${dst.id}>...` });
      forwardTxt(src, dst).then(r => interaction.editReply({
        content: `✅ **Forward started!**\n📂 <#${src.id}> → <#${dst.id}>\n📄 Found: \`${r.sent}\` files sending...`
      })); return;
    }
  }
}).catch(e => console.error("❌ Interaction:", e));

// ============================================================
// PREFIX COMMANDS — ALL ORIGINAL + FIXED CHECKS
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
      .setFooter({ text: `Today at ${getPHTime()}` })] }).catch(() => {});
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

  // .scan — PREFIX SHORTCUT
  if (/^\.scan(?:\s|$)/i.test(txt)) {
    const isOwnerOrAccess = isOwner(msg.author.id) || await hasAccess(msg.member, msg.author.id);
    if (!isOwnerOrAccess) { replyUser(msg, "❌ owner + access role only, dumbass.").catch(() => {}); return; }
    const args = txt.split(/\s+/).slice(1);
    let ch = null;
    const mentionMatch = txt.match(/<#(\d+)>/);
    if (mentionMatch) try { ch = await client.channels.fetch(mentionMatch[1]); } catch {}
    if (!ch && args[0]) try { ch = await client.channels.fetch(args[0].trim()); } catch {}
    if (!ch && !args[0]) ch = msg.channel;
    if (!ch) { replyUser(msg, "❌ provide a channel: `.scan #channel` or `.scan channel_id`, dumbass.").catch(() => {}); return; }
    if (!ch?.isTextBased?.()) { replyUser(msg, "❌ not a readable text channel, idiot.").catch(() => {}); return; }
    if (runningScans.has(ch.id)) { replyUser(msg, "⚠️ already scanning that channel, bro.").catch(() => {}); return; }
    const startMsg = await replyUser(msg, `⚡ **Scan started** for <#${ch.id}>...`).catch(() => {});
    scanChannel(ch).then(r => {
      const content = `✅ **Scan complete!**\n📂 <#${ch.id}>\n💬 Messages: \`${r.messages}\`\n📄 New: \`${r.found}\`\n🔄 Replaced: \`${r.replaced || 0}\`\n🚫 Skipped: \`${r.skipped}\`\n📚 Total: \`${r.total}\``;
      if (startMsg) startMsg.edit(content).catch(() => {});
      else replyUser(msg, content).catch(() => {});
    }).catch(e => {
      const content = `❌ **Scan failed:**\n\`${e.message.slice(0,1500)}\``;
      if (startMsg) startMsg.edit(content).catch(() => {});
      else replyUser(msg, content).catch(() => {});
    });
    return;
  }

  // ✅ .rn / .rename — RANDOM NAME + CHANNEL + STATUS CHECK
  if (/^\.(?:rename|rn)$/i.test(txt)) {
    const isOwnerOrAccess = isOwner(msg.author.id) || await hasAccess(msg.member, msg.author.id);

    // ⏱️ Cooldown for regulars
    if (!isOwnerOrAccess) {
      const now = Date.now();
      if (rnCooldown.has(msg.author.id)) {
        const remaining = Math.ceil((rnCooldown.get(msg.author.id) + RN_COOLDOWN_SEC * 1000 - now) / 1000);
        if (remaining > 0) return replyUser(msg, `❌ wait ${remaining}s before using .rn again, bro.`).catch(() => {});
      }
      rnCooldown.set(msg.author.id, now);
    }

    // 🔒 Regular user checks
    if (!isOwnerOrAccess) {
      if (!isReplyingToFile(msg)) return replyUser(msg, "❌ reply to a file or forwarded file, dumbass.").catch(() => {});
      if (!channelAllowed(msg)) return replyUser(msg, "❌ use this command in the allowed channel only, dumbass.").catch(() => {});
      if (!await hasPrinceStatus(msg.author.id)) return replyUser(msg, "❌ put `.gg/TBBAUZu8cw` in your status first bro.").catch(() => {});
    }

    // Get file
    let attachments = [...(msg.attachments?.values() || [])];
    if (!attachments.length && msg.reference?.messageId) {
      try { const refMsg = await msg.channel.messages.fetch(msg.reference.messageId); attachments = [...allAttachmentsOf(refMsg)]; } catch {}
    }
    if (!attachments.length) return replyUser(msg, "❌ bruh, upload file or reply to a file so i can fix it.").catch(() => {});
    const file = attachments[0];
    const fileExt = ext(file.name);
    if (fileExt !== "lua" && fileExt !== "txt") return replyUser(msg, "❌ only .lua and .txt is working, idiot.").catch(() => {});

    // ✅ ALWAYS 20 RANDOM LETTERS + .lua
    const outputName = randomLuaName();
    const timeFooter = `Today at ${getPHTime()}`;
    const workingEmbed = new EmbedBuilder().setColor(0x808080).setTitle("Working in File").setDescription("⏳ Processing...").setFooter({ text: timeFooter });
    const sentMsg = await replyUser(msg, { embeds: [workingEmbed] }).catch(() => {});
    const delay = isOwnerOrAccess ? 0 : 3000;

    setTimeout(async () => {
      try {
        const res = await fetch(file.url);
        const text = await res.text();
        const cleaned = text.replace(/--.*$/gm, "").split("\n").filter(l => l.trim() !== "").join("\n");
        const fixedFile = new AttachmentBuilder(Buffer.from(cleaned), { name: outputName });
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

  // ✅ .get — CHANNEL CHECK FOR REGULARS
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

  // ✅ .find — CHANNEL CHECK FOR REGULARS
  if (/^\.find(?:\s|$)/i.test(txt)) {
    const allowed = await hasAccess(msg.member, msg.author.id);
    if (!allowed && !channelAllowed(msg)) { replyUser(msg, "❌ not here, dumbass.").catch(() => {}); return; }
    const query = txt.slice(5).trim();
    if (!query) { replyUser(msg, "❌ usage: `.find <file name>`, dumbass.").catch(() => {}); return; }
    const results = findFiles(query);
    if (!results.length) { replyUser(msg, "❌ no matching file name for that, dumbass.").catch(() => {}); return; }
    const perPage = 8; const totalPages = Math.ceil(results.length / perPage);
    const pageItems = results.slice(0, perPage);
    const timeNow = getPHTime();
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
