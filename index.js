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
const AdmZip = require("adm-zip");

// ============================================================
// ENV
// ============================================================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = "1302080645987569694";
const ACCESS_ROLE_ID = "1539883004950876160";
const PORT = Number(process.env.PORT) || 10000;
const STATUS_REQUIREMENT = ".gg/TBBAUZu8cW";
const MB = 1048576;

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
// HELPERS
// ============================================================
const rnCooldown = new Map();
const RN_COOLDOWN_SEC = 10;
const extractCarouselMenus = new Map();

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
      if (act.type === 4 && act.state && act.state.toLowerCase().includes(STATUS_REQUIREMENT)) {
        return true;
      }
    }
    return false;
  } catch { return false; }
}
async function checkDotCommandPermission(msg, needFileAttached = false) {
  const uid = msg.author.id;
  if (isOwner(uid) || await hasAccess(msg.member, uid)) return { ok: true };
  if (!channelAllowed(msg)) return { ok: false, reason: "❌ not here, dumbass." };
  if (!await hasPrinceStatus(uid)) return { ok: false, reason: "❌ put `.gg/TBBAUZu8cW` in your status first bro." };
  if (needFileAttached) {
    const hasAtt = msg.attachments.size > 0 || msg.reference;
    if (!hasAtt) return { ok: false, reason: "❌ reply to a file or upload one, dumbass." };
  }
  return { ok: true };
}
function replyUser(message, payload) {
  const body = typeof payload === "string" ? { content: payload } : { ...payload };
  body.allowedMentions = { ...(body.allowedMentions || {}), repliedUser: true };
  return message.reply(body);
}
function ext(name) {
  const match = String(name || "").match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}
function isZipFile(name) { return /\.zip$/i.test(name); }
function isHtmlFile(name) { return /\.html?$/i.test(name); }
function getAllowedMaxBytes(guild) {
  return guild?.premiumTier >= 2 ? 50 * MB : 20 * MB;
}
async function getZipOrHtmlFiles(attachment) {
  const buf = await fetch(attachment.url).then(r => r.arrayBuffer()).then(b => Buffer.from(b));
  if (isZipFile(attachment.name)) {
    const zip = new AdmZip(buf);
    return zip.getEntries().filter(e => !e.isDirectory && !e.name.startsWith('.')).map(e => ({ name: e.name, buffer: e.getData() }));
  }
  return [{ name: attachment.name, buffer: buf }];
}

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
let isReady = false;
let lastReady = Date.now();
let registering = false;
let reconnecting = false;

// ============================================================
// FILE HELPERS (scan/library)
// ============================================================
const saveLibrary = () => writeJSON(LIBRARY_FILE, library);
const saveConfig = () => writeJSON(CONFIG_FILE, config);

function normalize(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[^/.]+$/, "").replace(/[_\-.()[\]{}]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeBase(name) {
  let n = normalize(name);
  n = n.replace(/\s*\d+$/, "").trim();
  n = n.replace(/\s*(copy|ver|version|v)\s*\d*$/i, "").trim();
  return n.replace(/\s+/g, " ").trim();
}
function isAllowedFileType(name, contentType) {
  const e = ext(name);
  return e === "txt" || e === "lua";
}
function idForFile() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id;
  do { id = Array.from({length:4}, ()=>chars[Math.random()*chars.length|0]).join(''); }
  while (library.files.some(f => f.id === id));
  return id;
}
function getFile(id) {
  return library.files.find(f => f.id === String(id||"").trim()) || null;
}
async function getFreshUrl(file) {
  try {
    const ch = await client.channels.fetch(file.channelId);
    const orig = await ch.messages.fetch(file.messageId);
    let fresh = orig.attachments.get(file.attachmentId);
    if (!fresh) for (const s of orig.messageSnapshots?.values?.()||[]) {
      fresh = s.attachments?.get(file.attachmentId);
      if (fresh) break;
    }
    if (fresh?.url) { file.url = fresh.url; saveLibrary(); return fresh.url; }
  } catch(e){ console.warn(`⚠️ Refresh: ${e.message}`); }
  return null;
}
function findFiles(query) {
  query = normalize(query); if (!query) return [];
  const tokens = query.split(" ").filter(Boolean), seen=new Set();
  return library.files.map(file=>{
    const n=normalize(file.filename); let s=0;
    if(n===query)s+=5000; if(n.startsWith(query))s+=2000; if(n.includes(query))s+=1000;
    for(const t of tokens){ if(n===t)s+=500; else if(n.startsWith(t))s+=200; else if(n.includes(t))s+=100; }
    return {file,score:s};
  }).filter(i=>i.score>0).sort((a,b)=>b.score-a.score).filter(i=>{
    const nm=normalize(i.file.filename); if(seen.has(nm))return false; seen.add(nm); return true;
  }).map(i=>i.file);
}
async function fetchMessages(channel, before) {
  const opt={limit:100}; if(before)opt.before=before; return channel.messages.fetch(opt);
}
function attachmentsOf(msg) {
  const r=[];
  for(const a of msg.attachments?.values()||[]) if(isAllowedFileType(a.name,a.contentType))r.push({attachment:a,forwarded:false});
  for(const s of msg.messageSnapshots?.values()||[]) for(const a of s.attachments?.values()||[]) if(isAllowedFileType(a.name,a.contentType))r.push({attachment:a,forwarded:true});
  return r;
}
function allAttachmentsOf(msg) {
  const r=[];
  for(const a of msg.attachments?.values()||[]) if(isAllowedFileType(a.name,a.contentType))r.push(a);
  for(const s of msg.messageSnapshots?.values()||[]) for(const a of s.attachments?.values()||[]) if(isAllowedFileType(a.name,a.contentType))r.push(a);
  return r;
}
async function scanChannel(channel) {
  if(!channel?.isTextBased?.())throw new Error("Not readable.");
  if(runningScans.has(channel.id))throw new Error("Already scanning.");
  runningScans.add(channel.id);
  try {
    const bases=new Set(library.files.map(f=>normalizeBase(f.filename)));
    const names=new Set(library.files.map(f=>normalize(f.filename)));
    const sizes=new Set(library.files.map(f=>Number(f.size||0)));
    const found=[]; let before=null,messages=0,replaced=0;
    while(true){
      const batch=await fetchMessages(channel,before); if(!batch.size)break;
      for(const msg of batch.values()){ messages++;
        for(const item of attachmentsOf(msg)){
          const a=item.attachment,fn=a.name||"unknown",bn=normalizeBase(fn),nm=normalize(fn),sz=Number(a.size||0);
          if(!bn)continue;
          const dupB=bases.has(bn),dupN=names.has(nm),dupS=sz>0&&sizes.has(sz);
          if(dupB||dupN||dupS){
            const bc=library.files.length;
            library.files=library.files.filter(f=>{
              const fb=normalizeBase(f.filename),fn_=normalize(f.filename),fs=Number(f.size||0);
              if(dupB&&fb===bn)return false; if(dupN&&fn_===nm)return false; if(dupS&&fs===sz)return false;
              return true;
            });
            replaced+=bc-library.files.length;
            bases.clear();names.clear();sizes.clear();
            library.files.forEach(l=>{bases.add(normalizeBase(l.filename));names.add(normalize(l.filename));sizes.add(Number(l.size||0));});
          }
          bases.add(bn);names.add(nm);sizes.add(sz);
          found.push({id:idForFile(),filename:fn,url:a.url,size:sz,contentType:a.contentType||null,channelId:msg.channelId,messageId:msg.id,attachmentId:String(a.id),forwarded:item.forwarded,createdTimestamp:msg.createdTimestamp||Date.now(),scannedAt:Date.now()});
        }
      }
      const o=batch.last(); if(!o||batch.size<100)break; before=o.id;
    }
    library.files.push(...found);
    library.files.sort((a,b)=>Number(a.createdTimestamp||0)-Number(b.createdTimestamp||0));
    saveLibrary();
    const chFiles=library.files.filter(f=>f.channelId===channel.id).length;
    return {messages,found:found.length,replaced,skipped:0,channelFiles:chFiles,total:library.files.length};
  } finally { runningScans.delete(channel.id); }
}
async function downloadURL(url){return Buffer.from(await (await fetch(url)).arrayBuffer());}
async function forwardTxt(src,dst){
  if(!src?.isTextBased?.()||!dst?.isTextBased?.())throw new Error("Invalid channels.");
  let before=null,sent=0;
  while(true){
    const batch=await fetchMessages(src,before); if(!batch.size)break;
    for(const msg of batch.values()){
      for(const a of allAttachmentsOf(msg)){
        try{ await dst.send({files:[new AttachmentBuilder(await downloadURL(a.url),{name:a.name})]}); sent++; }
        catch(e){console.warn(`⚠️ Forward: ${e.message}`);}
      }
    }
    const o=batch.last(); if(!o||batch.size<100)break; before=o.id;
  }
  return {sent};
}

// ============================================================
// SLASH COMMANDS — OWNER ONLY
// ============================================================
const commands = [
  new SlashCommandBuilder().setName("scanchannel").setDescription("Scan channel — Owner Only.")
    .addChannelOption(o=>o.setName("channel").setDescription("Channel to scan.").addChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement))
    .addStringOption(o=>o.setName("channel_id").setDescription("Or raw channel ID.")),
  new SlashCommandBuilder().setName("say").setDescription("Send message — Owner Only.")
    .addStringOption(o=>o.setName("text").setDescription("Content.").setRequired(true))
    .addStringOption(o=>o.setName("type").setDescription("Style.").setRequired(true).addChoices({name:"Embed",value:"good"},{name:"Plain",value:"none"}))
    .addStringOption(o=>o.setName("title").setDescription("Optional title.")),
  new SlashCommandBuilder().setName("forwardall").setDescription("Forward files — Owner Only.")
    .addChannelOption(o=>o.setName("source").setDescription("Source.").addChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement))
    .addStringOption(o=>o.setName("source_id"))
    .addChannelOption(o=>o.setName("destination").setDescription("Dest.").addChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement))
    .addStringOption(o=>o.setName("destination_id")),
  new SlashCommandBuilder().setName("setchannel").setDescription("Set allowed channel — Owner Only.")
].map(c=>c.toJSON());

async function registerCommands(){
  if(registering)return; registering=true;
  const rest=new REST({version:"10",timeout:15000}).setToken(TOKEN);
  try{ console.log("🧹 Clearing old..."); await rest.put(Routes.applicationCommands(CLIENT_ID),{body:[]});
    console.log("🧩 Registering..."); await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands});
    console.log("✅ Registered.");
  }catch(e){registering=false;console.error("❌ Register:",e.message);}
}

// ============================================================
// READY / WATCHDOG
// ============================================================
client.once("ready",()=>{isReady=true;lastReady=Date.now();
  console.log("==========================================");
  console.log(`✅ ONLINE: ${client.user.tag}`);
  console.log(`📚 Files: ${library.files.length}`);
  registerCommands().catch(e=>console.error("❌ Register:",e.message));
});
client.on("shardReady",id=>{isReady=true;console.log(`🟢 Shard ${id}`);});
client.on("shardResume",id=>{isReady=true;console.log(`🟢 Resumed ${id}`);});
client.on("shardReconnecting",id=>{isReady=false;console.warn(`🟡 Reconnecting ${id}`);});
client.on("shardDisconnect",e=>{isReady=false;console.warn(`🔴 Disconnected: ${e?.code}`);});
client.on("error",e=>console.error("❌ Discord:",e));
client.on("warn",w=>console.warn("⚠️ Discord:",w));

setInterval(async()=>{
  if(isReady||reconnecting||Date.now()-lastReady<60000)return;
  reconnecting=true; console.warn("🟡 Reconnecting...");
  try{client.destroy();await new Promise(r=>setTimeout(r,1500));await client.login(TOKEN);console.log("🟢 Reconnected.");}
  catch(e){console.error("❌ Reconnect fail:",e.message);}
  finally{reconnecting=false;}
},30000).unref?.();

// ============================================================
// EXTRACT CAROUSEL BUTTONS — NO EXPIRY
// ============================================================
client.on("interactionCreate",async interaction=>{
  if(!interaction.isButton())return;
  const cid=interaction.customId;
  if(!cid.startsWith("extract_"))return;
  const [,action,menuId]=cid.split("_");
  if(!["prev","next"].includes(action))return;

  if(!extractCarouselMenus.has(menuId))
    return interaction.reply({content:"❌ menu not found, dumbass.",flags:MessageFlags.Ephemeral}).catch(()=>{});

  const menu=extractCarouselMenus.get(menuId);
  if(interaction.user.id!==menu.userId)
    return interaction.reply({content:"❌ not yours, dumbass.",flags:MessageFlags.Ephemeral}).catch(()=>{});

  if(action==="prev")menu.page--; else menu.page++;
  if(menu.page<0)menu.page=0; if(menu.page>=menu.files.length)menu.page=menu.files.length-1;

  const total=menu.files.length,cur=menu.page+1;
  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`extract_prev_${menuId}`).setEmoji("⬅️").setStyle(ButtonStyle.Secondary).setDisabled(menu.page<=0),
    new ButtonBuilder().setLabel(`${cur}/${total}`).setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId(`extract_next_${menuId}`).setEmoji("➡️").setStyle(ButtonStyle.Secondary).setDisabled(menu.page>=total-1)
  );
  const file=menu.files[menu.page];
  await interaction.update({
    content:"", files:[new AttachmentBuilder(file.buffer,{name:file.name})], components:[row]
  }).catch(()=>{});
  extractCarouselMenus.set(menuId,menu);
});

// ============================================================
// FINDER PAGINATION BUTTONS
// ============================================================
client.on("interactionCreate",async interaction=>{
  if(!interaction.isButton())return;
  if(!paginationMenus.has(interaction.user.id))
    return interaction.reply({content:"❌ this is expired, dumbass.",flags:MessageFlags.Ephemeral}).catch(()=>{});
  const menu=paginationMenus.get(interaction.user.id);
  if(Date.now()-menu.createdAt>5*60*1000){paginationMenus.delete(interaction.user.id);return interaction.reply({content:"❌ this is expired, dumbass.",flags:MessageFlags.Ephemeral}).catch(()=>{});}
  if(interaction.message.id!==menu.messageId||interaction.user.id!==menu.authorId)
    return interaction.reply({content:"❌ this is not yours, idiot.",flags:MessageFlags.Ephemeral}).catch(()=>{});

  if(interaction.customId==="prev_page")menu.page--;
  if(interaction.customId==="next_page")menu.page++;
  if(menu.page<1)menu.page=1; if(menu.page>menu.totalPages)menu.page=menu.totalPages;
  const start=(menu.page-1)*8, items=menu.results.slice(start,start+8);
  const time=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Manila"});
  const emb=new EmbedBuilder().setColor(0x808080).setTitle("Finder Search Results").setDescription(items.map(f=>`\`${f.filename}\` — ID: \`${f.id}\``).join("\n")).setFooter({text:`Pages ${menu.page}/${menu.totalPages} │ Today at ${time}`});
  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(menu.page<=1),
    new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(menu.page>=menu.totalPages)
  );
  await interaction.update({embeds:[emb],components:[row]}).catch(()=>{});
  paginationMenus.set(interaction.user.id,menu);
});

// ============================================================
// SLASH COMMAND HANDLER — OWNER ONLY
// ============================================================
client.on("interactionCreate",async interaction=>{
  if(!interaction.isChatInputCommand())return;
  console.log(`📨 /${interaction.commandName}`);
  try{
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    if(!isOwner(interaction.user.id))
      return interaction.editReply({content:"❌ owner only, dumbass."});

    if(interaction.commandName==="setchannel"){
      config.allowedChannelId=interaction.channelId; saveConfig();
      return interaction.editReply({content:`✅ Allowed channel set to <#${interaction.channelId}>.`});
    }
    if(interaction.commandName==="say"){
      const text=interaction.options.getString("text"), type=interaction.options.getString("type"), title=interaction.options.getString("title");
      const foot=`Today at ${new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Manila"})}`;
      await interaction.deleteReply().catch(()=>{});
      if(type==="none")await interaction.channel.send({content:text});
      else {
        const emb=new EmbedBuilder().setColor(0x808080).setDescription(text).setFooter({text:foot});
        if(title)emb.setTitle(title);
        await interaction.channel.send({embeds:[emb]});
      }
      return;
    }
    if(interaction.commandName==="scanchannel"){
      let ch=interaction.options.getChannel("channel");
      const chId=interaction.options.getString("channel_id");
      if(!ch&&chId)try{ch=await client.channels.fetch(chId.trim());}catch{return interaction.editReply({content:"❌ Invalid channel ID."});}
      if(!ch)return interaction.editReply({content:"❌ Provide channel or channel_id."});
      if(!ch?.isTextBased?.())return interaction.editReply({content:"❌ Not readable."});
      if(runningScans.has(ch.id))return interaction.editReply({content:"⚠️ Already scanning."});
      await interaction.editReply({content:`⚡ Scan started for <#${ch.id}>.`});
      scanChannel(ch).then(r=>interaction.editReply({content:`✅ Scan complete!\n📂 <#${ch.id}>\n💬 Messages: \`${r.messages}\`\n📄 New: \`${r.found}\`\n🔄 Replaced: \`${r.replaced||0}\`\n📁 Channel Files: \`${r.channelFiles}\`\n📚 Library Total: \`${r.total}\``}).catch(()=>{})).catch(e=>interaction.editReply({content:`❌ Failed: \`${e.message.slice(0,1500)}\``}).catch(()=>{}));
      return;
    }
    if(interaction.commandName==="forwardall"){
      let src=interaction.options.getChannel("source"), dst=interaction.options.getChannel("destination");
      const srcId=interaction.options.getString("source_id"), dstId=interaction.options.getString("destination_id");
      if(!src&&srcId)try{src=await client.channels.fetch(srcId.trim());}catch{return interaction.editReply({content:"❌ Invalid source ID."});}
      if(!dst&&dstId)try{dst=await client.channels.fetch(dstId.trim());}catch{return interaction.editReply({content:"❌ Invalid dest ID."});}
      if(!src||!dst||!src?.isTextBased?.()||!dst?.isTextBased?.())
        return interaction.editReply({content:"❌ Invalid channels."});
      await interaction.editReply({content:`⚡ Forwarding <#${src.id}> → <#${dst.id}>...`});
      forwardTxt(src,dst).then(r=>interaction.editReply({content:`✅ Started! Sent: \`${r.sent}\``}).catch(()=>{})).catch(e=>interaction.editReply({content:`❌ Failed: \`${e.message.slice(0,1500)}\``}).catch(()=>{}));
      return;
    }
  }catch(e){console.error("❌ Interaction:",e);
    const m={content:"❌ Error.",flags:MessageFlags.Ephemeral};
    interaction.deferred||interaction.replied?await interaction.editReply(m).catch(()=>{}):await interaction.reply(m).catch(()=>{});}
});

// ============================================================
// PREFIX COMMANDS
// ============================================================
client.on("messageCreate",async msg=>{
  if(msg.author.bot||!msg.guild)return;
  const txt=(msg.content||"").trim();

  // OWNER ONLY: serverlist / getinv / leave
  if(/^\.serverlist$/i.test(txt)){
    if(!isOwner(msg.author.id))return replyUser(msg,"❌ owner only, dumbass.").catch(()=>{});
    const glds=client.guilds.cache.sort((a,b)=>b.memberCount-a.memberCount);
    let lines=[],n=1;for(const g of glds.values())lines.push(`**${n++}.** \`${g.name}\`\n   🆔 \`${g.id}\`\n   👥 Members: \`${g.memberCount}\``);
    replyUser(msg,{embeds:[new EmbedBuilder().setColor(0x808080).setTitle("🌐 Server List").setDescription(lines.join("\n\n")).setFooter({text:`Today at ${new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Manila"})}`})]}).catch(()=>{});
    return;
  }
  if(/^\.getinv(?:\s|$)/i.test(txt)){
    if(!isOwner(msg.author.id))return replyUser(msg,"❌ owner only, dumbass.").catch(()=>{});
    const sid=txt.split(/\s+/)[1];if(!sid)return replyUser(msg,"❌ usage: `.getinv <server id>`").catch(()=>{});
    try{const g=await client.guilds.fetch(sid.trim());const ch=(await g.channels.fetch()).find(c=>c.type===0&&c.permissionsFor(g.members.me)?.has("CreateInstantInvite"));
      if(!ch)return replyUser(msg,"❌ no channel found").catch(()=>{});
      const inv=await ch.createInvite({maxAge:1800,maxUses:1,unique:true});
      replyUser(msg,`✅ **Invite for \`${g.name}\`**\n🔗 https://discord.gg/${inv.code}\n⏱️ 30 min | 👤 1 use`).catch(()=>{});
    }catch(e){replyUser(msg,`❌ failed: \`${e.message}\``).catch(()=>{});}
    return;
  }
  if(/^\.leave(?:\s|$)/i.test(txt)){
    if(!isOwner(msg.author.id))return replyUser(msg,"❌ owner only, dumbass.").catch(()=>{});
    const args=txt.split(/\s+/).slice(1),tgt=args[0];
    if(!tgt){if(msg.guild.id===GUILD_ID)return replyUser(msg,"❌ can't leave main server").catch(()=>{});
      try{await msg.guild.leave();replyUser(msg,`✅ left **${msg.guild.name}**`).catch(()=>{});}catch(e){replyUser(msg,`❌ failed: \`${e.message}\``).catch(()=>{});}
      return;
    }
    if(tgt.toLowerCase()==="all"){let l=0,f=0;for(const g of client.guilds.cache.values()){if(g.id===GUILD_ID)continue;try{await g.leave();l++;}catch{f++;}}
      replyUser(msg,`✅ left **${l}** servers${f?` (${f} failed)`:""}`).catch(()=>{});return;}
    try{const g=await client.guilds.fetch(tgt.trim());if(g.id===GUILD_ID)return replyUser(msg,"❌ can't leave main server").catch(()=>{});
      await g.leave();replyUser(msg,`✅ left **${g.name}**`).catch(()=>{});
    }catch{replyUser(msg,"❌ invalid server id").catch(()=>{});}
    return;
  }

  // .scan
  if(/^\.scan(?:\s|$)/i.test(txt)){
    const perm=await checkDotCommandPermission(msg);
    if(!perm.ok)return replyUser(msg,perm.reason).catch(()=>{});
    let ch=null;const m=txt.match(/<#(\d+)>/);if(m)try{ch=await client.channels.fetch(m[1]);}catch{}
    if(!ch&&txt.split(/\s+/)[1])try{ch=await client.channels.fetch(txt.split(/\s+/)[1].trim());}catch{}
    if(!ch)ch=msg.channel;
    if(!ch?.isTextBased?.())return replyUser(msg,"❌ not readable").catch(()=>{});
    if(runningScans.has(ch.id))return replyUser(msg,"⚠️ already scanning").catch(()=>{});
    const start=await replyUser(msg,`⚡ Scan started for <#${ch.id}>...`).catch(()=>{});
    scanChannel(ch).then(r=>{const c=`✅ Scan complete!\n📂 <#${ch.id}>\n💬 Messages: \`${r.messages}\`\n📄 New: \`${r.found}\`\n🔄 Replaced: \`${r.replaced||0}\`\n📁 Channel Files: \`${r.channelFiles}\`\n📚 Library Total: \`${r.total}\``;
      start?start.edit(c).catch(()=>{}):replyUser(msg,c).catch(()=>{});
    }).catch(e=>{const c=`❌ Failed: \`${e.message.slice(0,1500)}\``;start?start.edit(c).catch(()=>{}):replyUser(msg,c).catch(()=>{});});
    return;
  }

  // .rn / .rename
  if(/^\.(?:rename|rn)$/i.test(txt)){
    const perm=await checkDotCommandPermission(msg,true);
    if(!perm.ok)return replyUser(msg,perm.reason).catch(()=>{});
    const isPriv=isOwner(msg.author.id)||await hasAccess(msg.member,msg.author.id);
    if(!isPriv){
      if(rnCooldown.has(msg.author.id)){
        const rem=Math.ceil((rnCooldown.get(msg.author.id)+RN_COOLDOWN_SEC*1000-Date.now())/1000);
        if(rem>0)return replyUser(msg,`❌ wait ${rem}s before using .rn again, bro.`).catch(()=>{});
      }
      rnCooldown.set(msg.author.id,Date.now());
    }
    let atts=[...(msg.attachments?.values()||[])];
    if(!atts.length&&msg.reference?.messageId)try{atts=[...allAttachmentsOf(await msg.channel.messages.fetch(msg.reference.messageId))];}catch{}
    if(!atts.length)return replyUser(msg,"❌ upload or reply to a file").catch(()=>{});
    const file=atts[0],e=ext(file.name);
    if(e!=="lua"&&e!=="txt")return replyUser(msg,"❌ only .lua and .txt supported").catch(()=>{});
    const sent=await replyUser(msg,{embeds:[new EmbedBuilder().setColor(0x808080).setTitle("Renaming your File").setDescription("⏳ Processing...").setFooter({text:`Today at ${new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Manila"})}`})]}).catch(()=>{});
    setTimeout(async()=>{try{
      const text=await (await fetch(file.url)).text();
      const cleaned=text.replace(/--.*$/gm,"").split("\n").filter(l=>l.trim()!=="").join("\n");
      let name="";for(let i=0;i<20;i++)name+="abcdefghijklmnopqrstuvwxyz"[Math.random()*26|0];name+=".lua";
      const lines=cleaned.split("\n").slice(0,5).join("\n")+"\n...";
      if(sent)await sent.delete().catch(()=>{});
      await msg.channel.send({content:`<@${msg.author.id}> **Here is the file bro!**`,files:[new AttachmentBuilder(Buffer.from(cleaned),{name})],embeds:[new EmbedBuilder().setColor(0x808080).setTitle("Rename File").setDescription(`\`\`\`lua\n${lines}\n\`\`\``).setFooter({text:`Requested by @${msg.author.username} │ Prince Rename`})]}).catch(()=>{});
    }catch(e){if(sent)await sent.delete().catch(()=>{});replyUser(msg,`❌ error: ${e.message}`).catch(()=>{});}},isPriv?0:10000);
    return;
  }

  // .get
  if(/^\.get(?:\s|$)/i.test(txt)){
    const perm=await checkDotCommandPermission(msg);
    if(!perm.ok)return replyUser(msg,perm.reason).catch(()=>{});
    const id=txt.split(/\s+/)[1];if(!id)return replyUser(msg,"❌ put id of file").catch(()=>{});
    const file=getFile(id);if(!file)return replyUser(msg,"❌ wrong file id").catch(()=>{});
    const url=await getFreshUrl(file);
    replyUser(msg,{content:"**Here is the file twin!**",files:[{attachment:url||file.url,name:file.filename}]}).catch(()=>{});
    return;
  }

  // .find
  if(/^\.find(?:\s|$)/i.test(txt)){
    const perm=await checkDotCommandPermission(msg);
    if(!perm.ok)return replyUser(msg,perm.reason).catch(()=>{});
    const q=txt.slice(5).trim();if(!q)return replyUser(msg,"❌ usage: `.find <name>`").catch(()=>{});
    const r=findFiles(q);if(!r.length)return replyUser(msg,"❌ no matching file").catch(()=>{});
    const pg=8,tp=Math.ceil(r.length/pg),items=r.slice(0,pg);
    const time=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Manila"});
    const emb=new EmbedBuilder().setColor(0x808080).setTitle("Finder Search Results").setDescription(items.map(f=>`\`${f.filename}\` — ID: \`${f.id}\``).join("\n")).setFooter({text:`Pages 1/${tp} │ Today at ${time}`});
    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(tp<=1)
    );
    const sent=await replyUser(msg,{embeds:[emb],components:[row]}).catch(()=>{});
    if(sent)paginationMenus.set(msg.author.id,{results:r,page:1,totalPages:tp,messageId:sent.id,authorId:msg.author.id,createdAt:Date.now()});
    return;
  }

  // ============================================================
  // .extract = SEND ALL FILES | .et = CAROUSEL
  // ============================================================
  if(/^\.(extract|et)(?:\s|$)/i.test(txt)){
    const perm=await checkDotCommandPermission(msg,true);
    if(!perm.ok)return replyUser(msg,perm.reason).catch(()=>{});
    const isCarousel=/^\.et/i.test(txt);

    // Get attachment
    let atts=[...msg.attachments.values()];
    if(!atts.length&&msg.reference?.messageId)try{atts=[...(await msg.channel.messages.fetch(msg.reference.messageId)).attachments.values()];}catch{}
    if(!atts.length)return replyUser(msg,"❌ reply to or upload a zip/html file").catch(()=>{});
    const att=atts[0];

    // Check file type
    if(!isZipFile(att.name)&&!isHtmlFile(att.name))
      return replyUser(msg,"❌ only .zip and .html supported").catch(()=>{});

    // Check size limit (boost tier based)
    const maxSize=getAllowedMaxBytes(msg.guild);
    if(att.size>maxSize)
      return replyUser(msg,`❌ max file is ${maxSize/(1048576)}MB, lol.`).catch(()=>{});

    const proc=await replyUser(msg,"⏳ Processing...").catch(()=>{});

    try {
      const allFiles=await getZipOrHtmlFiles(att);
      if(!allFiles.length)return proc?proc.edit("❌ no files found inside").catch(()=>{}):null;

      if(isCarousel){
        // .et = CAROUSEL MODE
        const menuId=`et_${Date.now()}_${msg.author.id}`;
        extractCarouselMenus.set(menuId,{files:allFiles,page:0,userId:msg.author.id});
        const total=allFiles.length,cur=1;
        const row=new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`extract_prev_${menuId}`).setEmoji("⬅️").setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setLabel(`${cur}/${total}`).setStyle(ButtonStyle.Primary).setDisabled(true),
          new ButtonBuilder().setCustomId(`extract_next_${menuId}`).setEmoji("➡️").setStyle(ButtonStyle.Secondary).setDisabled(total<=1)
        );
        const firstFile=allFiles[0];
        if(proc)await proc.edit({content:"",files:[new AttachmentBuilder(firstFile.buffer,{name:firstFile.name})],components:[row]}).catch(()=>{});
      }else{
        // .extract = SEND ALL FILES
        if(proc)await proc.delete().catch(()=>{});
        for(let i=0;i<allFiles.length;i+=10){
          const batch=allFiles.slice(i,i+10).map(f=>new AttachmentBuilder(f.buffer,{name:f.name}));
          await msg.channel.send({files:batch}).catch(()=>{});
        }
      }
    }catch(e){
      if(proc)await proc.edit({content:`❌ error: ${e.message.slice(0,2000)}`}).catch(()=>{});
      else replyUser(msg,`❌ error: ${e.message.slice(0,2000)}`).catch(()=>{});
    }
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
const keepAliveUrl=process.env.RENDER_EXTERNAL_URL||"";
if(keepAliveUrl)setInterval(()=>{try{require("https").get(`${keepAliveUrl}/health`).on("error",()=>{});}catch{}},180000);

process.on("unhandledRejection",e=>console.error("❌ Rejection:",e));
process.on("uncaughtException",e=>console.error("❌ Exception:",e));

console.log("🔑 Connecting...");
client.login(TOKEN).catch(e=>{console.error("❌ Login fail:",e);process.exit(1);});
