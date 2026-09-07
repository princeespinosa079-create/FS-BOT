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
  DMChannel
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

// ============================================================
// DISCORD CLIENT
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages
  ],
  partials: ['CHANNEL']
});

const runningScans = new Set();
const paginationMenus = new Map();
const EXPIRY_MS = 5 * 60 * 1000;
let isReady = false;
let lastReady = Date.now();
let registering = false;
let reconnecting = false;

// ============================================================
// ✅ PERMISSION CHECK — ONLY OWNER + ACCESS ROLE
// ============================================================
const saveLibrary = () => writeJSON(LIBRARY_FILE, library);
const saveConfig = () => writeJSON(CONFIG_FILE, config);
const isOwner = (userId) => userId === OWNER_ID;

async function hasAccess(member, userId) {
  const uid = userId || member?.id;
  if (uid === OWNER_ID) return true; // Owner always allowed
  try {
    const mainGuild = await client.guilds.fetch(GUILD_ID);
    const guildMember = await mainGuild.members.fetch(uid);
    return guildMember?.roles?.cache?.has(ACCESS_ROLE_ID) || false;
  } catch { return false; }
}

function channelAllowed(target) {
  if (!config.allowedChannelId || target instanceof DMChannel) return true;
  return target.channelId === config.allowedChannelId;
}

async function hasPrinceStatus(userId) {
  try {
    const mainGuild = await client.guilds.fetch(GUILD_ID);
    const member = await mainGuild.members.fetch(userId, { force: true });
    if (!member?.presence?.activities) return false;
    for (const act of member.presence.activities) {
      if (act.type === 4 && act.state && act.state.toLowerCase().includes("prince is the best")) return true;
    }
    return false;
  } catch { return false; }
}

function isReplyingToFile(msg) {
  const ref = msg.reference?.messageId;
  if (!ref) return false;
  const repliedMsg = msg.channel.messages.cache.get(ref);
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
  n = n.replace(/\s*(copy|ver|version|v|rev|update|fixed|new)\s*\d*$/i, "").trim();
  return n.replace(/\s+/g, " ").trim();
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
    for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  } while (library.files.some(f => f.id === id));
  return id;
}
function getFile(id) {
  return library.files.find(f => f.id === String(id || "").trim()) || null;
}
async function getFreshUrl(file) {
  try {
    const ch = await client.channels.fetch(file.channelId);
    const orig = await ch.messages.fetch(file.messageId);
    let fresh = orig.attachments.get(file.attachmentId);
    if (!fresh) for (const s of orig.messageSnapshots?.values?.() || []) {
      fresh = s.attachments?.get(file.attachmentId);
      if (fresh) break;
    }
    if (fresh?.url) { file.url = fresh.url; saveLibrary(); return fresh.url; }
  } catch (e) { console.warn(`⚠️ Refresh URL fail: ${e.message}`); }
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
    for (const t of tokens) {
      if (name === t) score += 500;
      else if (name.startsWith(t)) score += 200;
      else if (name.includes(t)) score += 100;
    }
    return { file, score };
  }).filter(i => i.score > 0).sort((a, b) => b.score - a.score).map(i => i.file);
}

// ============================================================
// SCAN & ATTACHMENT HELPERS
// ============================================================
async function fetchMessages(channel, before) {
  const opt = { limit: 100 }; if (before) opt.before = before;
  return await channel.messages.fetch(opt, { cache: false });
}
function attachmentsOf(msg) {
  const res = [];
  for (const a of msg.attachments?.values?.() || [])
    if (isAllowedFileType(a.name, a.contentType)) res.push({ attachment: a, forwarded: false });
  for (const s of msg.messageSnapshots?.values?.() || [])
    for (const a of s.attachments?.values?.() || [])
      if (isAllowedFileType(a.name, a.contentType)) res.push({ attachment: a, forwarded: true });
  return res;
}
function allAttachmentsOf(msg) {
  const res = [];
  for (const a of msg.attachments?.values?.() || [])
    if (isAllowedFileType(a.name, a.contentType)) res.push(a);
  for (const s of msg.messageSnapshots?.values?.() || [])
    for (const a of s.attachments?.values?.() || [])
      if (isAllowedFileType(a.name, a.contentType)) res.push(a);
  return res;
}
async function scanChannel(channel) {
  if (!channel?.isTextBased?.()) throw new Error("Not readable.");
  if (runningScans.has(channel.id)) throw new Error("Scanning already.");
  runningScans.add(channel.id);
  try {
    const keys = new Set(), urls = new Set();
    for (const f of library.files) { keys.add(`${normalizeBase(f.filename)}||${f.size}`); urls.add(f.url || ""); }
    const found = []; let before = null, msgCount = 0, dupes = 0;
    while (true) {
      const batch = await fetchMessages(channel, before);
      if (!batch.size) break;
      for (const m of batch.values()) {
        msgCount++;
        for (const item of attachmentsOf(m)) {
          const a = item.attachment;
          const fn = a.name || "unknown";
          const url = a.url || a.proxyURL;
          const sz = Number(a.size || 0);
          const key = `${normalizeBase(fn)}||${sz}`;
          if (keys.has(key) || urls.has(url)) { dupes++; continue; }
          keys.add(key); urls.add(url);
          found.push({ id: idForFile(), filename: fn, url, size: sz, contentType: a.contentType, channelId: m.channelId, messageId: m.id, attachmentId: String(a.id), forwarded: item.forwarded, createdTimestamp: m.createdTimestamp || Date.now(), scannedAt: Date.now() });
        }
      }
      const oldest = batch.last(); if (!oldest || batch.size < 100) break;
      before = oldest.id;
    }
    if (found.length) { library.files.push(...found); library.files.sort((a,b)=>Number(a.createdTimestamp)-Number(b.createdTimestamp)); saveLibrary(); }
    console.log(`✅ SCAN ${channel.name} | Msgs:${msgCount} New:${found.length} Dupes:${dupes} Total:${library.files.length}`);
    return { messages:msgCount, found:found.length, skipped:dupes, total:library.files.length };
  } finally { runningScans.delete(channel.id); }
}
async function downloadURL(url) {
  const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function forwardTxt(src, dst) {
  if (!src?.isTextBased?.() || !dst?.isTextBased?.()) throw new Error("Invalid channel.");
  let before=null, msgCount=0, sent=0, batch=[];
  while(true) {
    const m = await fetchMessages(src, before); if (!m.size) break;
    for (const x of m.values()) { msgCount++; for (const a of allAttachmentsOf(x)) batch.push(downloadURL(a.url).then(b=>dst.send({files:[new AttachmentBuilder(b,{name:a.name})]}).then(()=>sent++).catch(e=>console.warn(e)))); }
    const oldest=m.last(); if (!oldest||m.size<100) break; before=oldest.id;
  }
  await Promise.allSettled(batch); return {messages:msgCount,sent};
}

// ============================================================
// SLASH COMMANDS
// ============================================================
const commands = [
  new SlashCommandBuilder().setName("scanchannel").setDescription("Scan channel — Owner + Access Role Only.").addChannelOption(o=>o.setName("channel").setDescription("Channel").addChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement)).addStringOption(o=>o.setName("channel_id").setDescription("Raw ID")),
  new SlashCommandBuilder().setName("say").setDescription("Send message — Owner + Access Role Only.").addStringOption(o=>o.setName("text").setDescription("Content").setRequired(true)).addStringOption(o=>o.setName("type").setDescription("Style").setRequired(true).addChoices({name:"With Embed",value:"good"},{name:"No Embed",value:"none"})).addStringOption(o=>o.setName("title").setDescription("Optional title")),
  new SlashCommandBuilder().setName("forwardall").setDescription("Forward files — Owner Only.").addChannelOption(o=>o.setName("source").setDescription("Source")).addStringOption(o=>o.setName("source_id")).addChannelOption(o=>o.setName("destination")).addStringOption(o=>o.setName("destination_id")),
  new SlashCommandBuilder().setName("setchannel").setDescription("Set allowed channel — Owner Only.")
].map(c=>c.toJSON());

async function registerCommands() {
  if (registering) return; registering=true;
  const rest=new REST({version:"10",timeout:15000}).setToken(TOKEN);
  try {
    console.log("🧹 Clearing old commands..."); await rest.put(Routes.applicationCommands(CLIENT_ID),{body:[]});
    console.log("🧩 Registering..."); await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands});
    console.log("✅ Commands registered.");
  } catch(e){registering=false;console.error("❌ Register fail:",e.message);}
}

// ============================================================
// READY
// ============================================================
client.once("ready",()=>{
  isReady=true; lastReady=Date.now();
  console.log("==========================================");
  console.log(`✅ ONLINE: ${client.user.tag}`);
  console.log(`📚 Files: ${library.files.length}`);
  console.log("==========================================");
  registerCommands();
});
client.on("shardReady",id=>{isReady=true;lastReady=Date.now();console.log(`🟢 Shard ${id} ready`);});
client.on("shardResume",id=>{isReady=true;lastReady=Date.now();console.log(`🟢 Shard ${id} resumed`);});
client.on("shardReconnecting",()=>{isReady=false;console.warn("🟡 Reconnecting...");});
client.on("shardDisconnect",e=>{isReady=false;console.warn(`🔴 Shard down: ${e?.code}`);});
client.on("presenceUpdate",()=>{});
client.on("error",e=>console.error("❌ Discord error:",e));
client.on("warn",w=>console.warn("⚠️ Discord warn:",w));

// ============================================================
// BUTTON HANDLER — PERMISSION + EXPIRY
// ============================================================
client.on("interactionCreate",async interaction=>{
  if (!interaction.isButton()) return;
  const uid=interaction.user.id;
  if (!paginationMenus.has(uid))
    return interaction.reply({content:"❌ this is expired, dumbass.",flags:MessageFlags.Ephemeral}).catch(()=>{});
  const menu=paginationMenus.get(uid);
  if (uid!==menu.authorId)
    return interaction.reply({content:"❌ this is not yours, idiot.",flags:MessageFlags.Ephemeral}).catch(()=>{});
  if (Date.now()-menu.createdAt>EXPIRY_MS) {
    paginationMenus.delete(uid);
    return interaction.reply({content:"❌ this is expired, dumbass.",flags:MessageFlags.Ephemeral}).catch(()=>{});
  }
  if (interaction.message.id!==menu.messageId)
    return interaction.reply({content:"❌ this is not yours, idiot.",flags:MessageFlags.Ephemeral}).catch(()=>{});
  if (interaction.customId==="prev_page") menu.page--;
  if (interaction.customId==="next_page") menu.page++;
  if (menu.page<1) menu.page=1;
  if (menu.page>menu.totalPages) menu.page=menu.totalPages;
  const start=(menu.page-1)*8, items=menu.results.slice(start,start+8);
  const time=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Manila"});
  const embed=new EmbedBuilder().setColor(0x808080).setTitle("Finder Search Results").setDescription(items.map(f=>`\`${f.filename}\` — ID: \`${f.id}\``).join("\n")).setFooter({text:`Pages ${menu.page}/${menu.totalPages} │ Today at ${time}`});
  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(menu.page<=1),
    new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(menu.page>=menu.totalPages)
  );
  await interaction.update({embeds:[embed],components:[row]}).catch(()=>{});
  paginationMenus.set(uid,menu);
});

// ============================================================
// WATCHDOG
// ============================================================
setInterval(async()=>{
  if (isReady||reconnecting||Date.now()-lastReady<60000) return;
  reconnecting=true; console.warn("🟡 Reconnecting...");
  try { client.destroy(); await new Promise(r=>setTimeout(r,1500)); await client.login(TOKEN); console.log("🟢 Reconnected."); }
  catch(e){console.error("❌ Reconnect fail:",e.message);}
  finally{reconnecting=false;}
},30000).unref?.();

// ============================================================
// SLASH COMMAND HANDLER
// ============================================================
client.on("interactionCreate",async interaction=>{
  if (!interaction.isChatInputCommand()) return;
  console.log(`📨 /${interaction.commandName}`);
  try {
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    const owner=isOwner(interaction.user.id);
    const access=await hasAccess(interaction.member,interaction.user.id);
    if (interaction.commandName==="forwardall"&&!owner) return await interaction.editReply({content:"❌ owner only, dumbass."});
    if (interaction.commandName==="setchannel"&&!owner) return await interaction.editReply({content:"❌ owner only, dumbass."});
    if (!owner&&!access) return await interaction.editReply({content:"❌ No permission — need access role."});
    if (interaction.commandName==="setchannel"){config.allowedChannelId=interaction.channelId;saveConfig();return await interaction.editReply({content:`✅ Allowed channel set to <#${interaction.channelId}>.`});}
    if (interaction.commandName==="say"){
      const text=interaction.options.getString("text"), type=interaction.options.getString("type")||"good", title=interaction.options.getString("title");
      const time=`Today at ${new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Manila"})}`;
      await interaction.deleteReply().catch(()=>{});
      if (type==="none") await interaction.channel.send({content:text});
      else { const emb=new EmbedBuilder().setColor(0x808080).setDescription(text).setFooter({text}); if(title)emb.setTitle(title); await interaction.channel.send({embeds:[emb]}); }
      return;
    }
    if (interaction.commandName==="scanchannel"){
      let ch=interaction.options.getChannel("channel"), chId=interaction.options.getString("channel_id");
      if (!ch&&chId) try{ch=await client.channels.fetch(chId.trim())}catch{return await interaction.editReply({content:"❌ Invalid channel ID."})}
      if (!ch) return await interaction.editReply({content:"❌ Provide channel."});
      if (!ch?.isTextBased?.()) return await interaction.editReply({content:"❌ Not readable."});
      if (runningScans.has(ch.id)) return await interaction.editReply({content:"⚠️ Already scanning."});
      await interaction.editReply({content:`⚡ Scanning <#${ch.id}>...`});
      scanChannel(ch).then(r=>interaction.editReply({content:`✅ Scan done!\n📂 <#${ch.id}>\n💬 Msgs: \`${r.messages}\`\n📄 New: \`${r.found}\`\n🚫 Dupes: \`${r.skipped}\`\n📚 Total: \`${r.total}\``}).catch(()=>{})).catch(e=>interaction.editReply({content:`❌ Fail: \`${e.message.slice(0,1500)}\``}).catch(()=>{}));
      return;
    }
    if (interaction.commandName==="forwardall"){
      let src=interaction.options.getChannel("source"), dst=interaction.options.getChannel("destination");
      const srcId=interaction.options.getString("source_id"), dstId=interaction.options.getString("destination_id");
      if (!src&&srcId) try{src=await client.channels.fetch(srcId.trim())}catch{return await interaction.editReply({content:"❌ Invalid source ID."})}
      if (!dst&&dstId) try{dst=await client.channels.fetch(dstId.trim())}catch{return await interaction.editReply({content:"❌ Invalid dest ID."})}
      if (!src||!dst) return await interaction.editReply({content:"❌ Need source + dest."});
      if (!src?.isTextBased?.()||!dst?.isTextBased?.()) return await interaction.editReply({content:"❌ Invalid channel type."});
      await interaction.editReply({content:`⚡ Forwarding <#${src.id}> → <#${dst.id}>...`});
      forwardTxt(src,dst).then(r=>interaction.editReply({content:`✅ Started!\n📂 <#${src.id}> → <#${dst.id}>\n📄 Sending: \`${r.sent}\``}).catch(()=>{})).catch(e=>interaction.editReply({content:`❌ Fail: \`${e.message.slice(0,1500)}\``}).catch(()=>{}));
      return;
    }
  } catch(e){console.error("❌ Interaction:",e); const m={content:"❌ Error.",flags:MessageFlags.Ephemeral}; interaction.deferred||interaction.replied?await interaction.editReply(m).catch(()=>{}):await interaction.reply(m).catch(()=>{});}
});

// ============================================================
// ✅ DOT COMMANDS — DM + SERVER, OWNER + ACCESS ROLE ONLY
// ============================================================
client.on("messageCreate",async msg=>{
  if (msg.author.bot) return;
  const txt=(msg.content||"").trim();
  if (!txt.startsWith(".")) return;

  // ✅ CHECK PERMISSION FIRST — ALL DOT COMMANDS LOCKED
  const isOwnerUser = isOwner(msg.author.id);
  const hasAccessRole = await hasAccess(msg.member, msg.author.id);
  if (!isOwnerUser && !hasAccessRole) {
    return replyUser(msg, "❌ No permission — need access role, dumbass.").catch(()=>{});
  }

  // .serverlist
  if (/^\.serverlist$/i.test(txt)) {
    if (!isOwnerUser) return replyUser(msg, "❌ owner only, dumbass.").catch(()=>{});
    const glds=client.guilds.cache.sort((a,b)=>b.memberCount-a.memberCount);
    let lines=[],n=1;for(const g of glds.values())lines.push(`**${n++}.** \`${g.name}\`\n   🆔 \`${g.id}\`\n   👥 Members: \`${g.memberCount}\``);
    replyUser(msg,{embeds:[new EmbedBuilder().setColor(0x808080).setTitle(`🌐 Server List — ${glds.size}`).setDescription(lines.join("\n\n")).setFooter({text:`Today at ${new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Manila"})}`})]}).catch(()=>{});
    return;
  }
  // .getinv
  if (/^\.getinv(?:\s|$)/i.test(txt)) {
    if (!isOwnerUser) return replyUser(msg, "❌ owner only, dumbass.").catch(()=>{});
    const id=txt.split(/\s+/)[1];if(!id)return replyUser(msg,"❌ usage: `.getinv <server id>`, dumbass.").catch(()=>{});
    try{const g=await client.guilds.fetch(id.trim()),chs=await g.channels.fetch(),c=chs.find(x=>x.type===ChannelType.GuildText&&x.permissionsFor(g.members.me)?.has("CreateInstantInvite"))||chs.find(x=>x.isTextBased?.()&&x.permissionsFor(g.members.me)?.has("CreateInstantInvite"));if(!c)return replyUser(msg,"❌ no channel found, bro.").catch(()=>{});const inv=await c.createInvite({maxAge:1800,maxUses:1,unique:true});replyUser(msg,`✅ **Invite for \`${g.name}\`**\n🔗 https://discord.gg/${inv.code}\n⏱️ Expires: **30 min**\n👤 Uses: **1**`).catch(()=>{});}catch(e){replyUser(msg,`❌ failed: \`${e.message}\``).catch(()=>{});}
    return;
  }
  // .leave
  if (/^\.leave(?:\s|$)/i.test(txt)) {
    if (!isOwnerUser) return replyUser(msg, "❌ owner only, dumbass.").catch(()=>{});
    const args=txt.split(/\s+/).slice(1),target=args[0];
    if(!target){if(msg.guild?.id===GUILD_ID)return replyUser(msg,"❌ can't leave main server, dumbass.").catch(()=>{});try{await msg.guild.leave();replyUser(msg,`✅ left **${msg.guild.name}**, bro.`).catch(()=>{});}catch(e){replyUser(msg,`❌ failed: \`${e.message}\``).catch(()=>{});}return;}
    if(target.toLowerCase()==="all"){let l=0,f=0;for(const g of client.guilds.cache.values()){if(g.id===GUILD_ID)continue;try{await g.leave();l++}catch{f++}}replyUser(msg,`✅ left **${l}** servers${f?` (${f} failed)`:""}. Main server safe.`).catch(()=>{});return;}
    try{const g=await client.guilds.fetch(target.trim());if(g.id===GUILD_ID)return replyUser(msg,"❌ can't leave main server, dumbass.").catch(()=>{});await g.leave();replyUser(msg,`✅ left **${g.name}**, bro.`).catch(()=>{});}catch{replyUser(msg,"❌ invalid server id, dumbass.").catch(()=>{});}
    return;
  }
  // .removeline + .rl SHORTCUT
  if (/^\.(removeline|rl)$/i.test(txt)) {
    if (!channelAllowed(msg)) return replyUser(msg, "❌ not allowed here, dumbass.").catch(()=>{});
    if (!isOwnerUser && !await hasPrinceStatus(msg.author.id)) return replyUser(msg, "❌ put `prince is the best` in your status.").catch(()=>{});
    let atts=[...(msg.attachments?.values()||[])];
    if(!atts.length&&msg.reference?.messageId)try{const r=await msg.channel.messages.fetch(msg.reference.messageId);atts=[...allAttachmentsOf(r)];}catch{}
    if(!atts.length)return replyUser(msg,"❌ upload or reply to file, dumbass.").catch(()=>{});
    const file=atts[0],e=ext(file.name);
    if(e!=="lua"&&e!=="txt")return replyUser(msg,"❌ only .lua and .txt, idiot.").catch(()=>{});
    const time=`Today at ${new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Manila"})}`;
    const emb=new EmbedBuilder().setColor(0x808080).setTitle("Working in File").setDescription("⏳ Processing...").setFooter({text:time});
    const sent=await replyUser(msg,{embeds:[emb]}).catch(()=>{});
    setTimeout(async()=>{try{const res=await fetch(file.url);const t=await res.text();const clean=t.replace(/--.*$/gm,"").split("\n").filter(l=>l.trim()!=="").join("\n");const out=new AttachmentBuilder(Buffer.from(clean),{name:"prince is the best.lua"});if(sent)await sent.delete().catch(()=>{});await msg.channel.send({content:`<@${msg.author.id}> **Here is the file bro!**`,files:[out]}).catch(()=>{});}catch(e){if(sent)await sent.delete().catch(()=>{});replyUser(msg,`❌ error: ${e.message}`).catch(()=>{});}},isOwnerUser?0:3000);
    return;
  }
  // .get
  if (/^\.get(?:\s|$)/i.test(txt)) {
    if (!channelAllowed(msg)) return replyUser(msg, "❌ not here, dumbass.").catch(()=>{});
    const id=txt.split(/\s+/)[1];if(!id)return replyUser(msg,"❌ put id, idiot.").catch(()=>{});
    const f=getFile(id);if(!f)return replyUser(msg,"❌ wrong id, dumbass.").catch(()=>{});
    const url=await getFreshUrl(f);
    replyUser(msg,{content:"**Here is the file twin!**",files:[{attachment:url||f.url,name:f.filename||"file"}]}).catch(()=>{});
    return;
  }
  // .find
  if (/^\.find(?:\s|$)/i.test(txt)) {
    if (!channelAllowed(msg)) return replyUser(msg, "❌ not here, dumbass.").catch(()=>{});
    const q=txt.slice(5).trim();if(!q)return replyUser(msg,"❌ usage: `.find <name>`, dumbass.").catch(()=>{});
    const res=findFiles(q);if(!res.length)return replyUser(msg,"❌ no files found, dumbass.").catch(()=>{});
    const perPage=8,pages=Math.ceil(res.length/perPage),items=res.slice(0,perPage);
    const time=`Today at ${new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Manila"})}`;
    const emb=new EmbedBuilder().setColor(0x808080).setTitle("Finder Search Results").setDescription(items.map(f=>`\`${f.filename}\` — ID: \`${f.id}\``).join("\n")).setFooter({text:`Pages 1/${pages} │ Today at ${time}`});
    const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(pages<=1));
    const sent=await replyUser(msg,{embeds:[emb],components:[row]}).catch(()=>{});
    if(sent)paginationMenus.set(msg.author.id,{results:res,page:1,totalPages:pages,messageId:sent.id,authorId:msg.author.id,createdAt:Date.now()});
    return;
  }
});

// ============================================================
// EXPRESS SERVER
// ============================================================
const app=express();
app.get("/",(req,res)=>res.status(200).send(isReady?"✅ ONLINE":"⏳ Starting..."));
app.get("/health",(req,res)=>res.status(200).json({process:"online",discord:isReady?"ready":"offline",bot:client.user?.tag,guild:GUILD_ID,files:library.files.length}));
app.listen(PORT,"0.0.0.0",()=>console.log(`🌐 Port ${PORT}`));

// Keep-alive
const keepAliveUrl=process.env.RENDER_EXTERNAL_URL||"";
if(keepAliveUrl)setInterval(()=>{try{require("https").get(`${keepAliveUrl}/health`).on("error",()=>{})}catch{}},180000);

// Error handlers
process.on("unhandledRejection",e=>console.error("❌ Rejection:",e));
process.on("uncaughtException",e=>console.error("❌ Exception:",e));

// Login
console.log("🔑 Connecting...");
client.login(TOKEN).catch(e=>{console.error("❌ Login fail:",e);process.exit(1);});
