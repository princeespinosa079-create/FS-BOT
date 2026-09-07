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
// CONFIG
// ============================================================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = "1302080645987569694";
const ACCESS_ROLE_ID = "1539883004950876160";
const PORT = process.env.PORT || 10000;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing env vars!");
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
  catch (e) { return fallback; }
}
function writeJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) {}
}

let config = readJSON(CONFIG_FILE, { allowedChannelId: null });
let library = readJSON(LIBRARY_FILE, { files: [] });
if (Array.isArray(library)) library = { files: library };
if (!Array.isArray(library.files)) library.files = [];

// ============================================================
// CLIENT
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages
  ],
  partials: ["CHANNEL"]
});

const paginationMenus = new Map();
const EXPIRY_MS = 5 * 60 * 1000;

// ============================================================
// PERMISSIONS
// ============================================================
const isOwner = (userId) => userId === OWNER_ID;

async function hasAccess(member, userId) {
  const uid = userId || member?.id;
  if (uid === true) return true;
  try {
    const g = await client.guilds.fetch(GUILD_ID);
    const m = await g.members.fetch(uid);
    return m?.roles?.cache?.has(ACCESS_ROLE_ID) || false;
  } catch { return false; }
}

async function hasPrinceStatus(userId) {
  try {
    const g = await client.guilds.fetch(GUILD_ID);
    const m = await g.members.fetch(userId);
    if (!m?.presence?.activities) return false;
    for (const a of m.presence.activities) {
      if (a.type === 4 && a?.state?.toLowerCase().includes("prince is the best")) return true;
    }
    return false;
  } catch { return false; }
}

function replyUser(msg, content) {
  return msg.reply(typeof content === "string" ? { content, allowedMentions: { repliedUser: true } } : { ...content, allowedMentions: { repliedUser: true } });
}

// ============================================================
// HELPERS
// ============================================================
function normalize(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[^/.]+$/, "").replace(/[_\-.()[\]{}]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeBase(name) {
  let n = normalize(name).replace(/\s*\d+$/, "").trim();
  n = n.replace(/\s*(copy|ver|version|v|rev|update|fixed|new)\s*\d*$/i, "").trim();
  return n.replace(/\s+/g, " ").trim();
}
function ext(name) {
  const m = String(name || "").match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}
function isAllowedFileType(name, contentType) {
  const e = ext(name);
  return (e === "txt" || e === "lua");
}
function idForFile() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id;
  do { id = ""; for(let i=0;i<4;i++) id += chars[Math.random()*chars.length|0]; }
  while (library.files.some(f => f.id === id));
  return id;
}
function getFile(id) {
  return library.files.find(f => f.id === String(id||"").trim()) || null;
}
async function getFreshUrl(file) {
  try {
    const ch = await client.channels.fetch(file.channelId);
    const m = await ch.messages.fetch(file.messageId);
    let a = m.attachments.get(file.attachmentId);
    if (!a) for(const s of m.messageSnapshots?.values?.()||[]) {
      a = s.attachments?.get(file.attachmentId); if(a) break;
    }
    if(a?.url) { file.url = a.url; writeJSON(LIBRARY_FILE, library); return a.url; }
  } catch {}
  return file.url;
}
function findFiles(query) {
  query = normalize(query);
  if (!query) return [];
  return library.files.map(file => {
    const name = normalize(file.filename);
    let score = 0;
    if(name === query) score += 5000;
    if(name.startsWith(query)) score += 2000;
    if(name.includes(query)) score += 1000;
    return {file,score};
  }).filter(i=>i.score>0).sort((a,b)=>b.score-a.score).map(i=>i.file);
}
function allAttachmentsOf(msg) {
  const res = [];
  for(const a of msg.attachments?.values()||[])
    if(isAllowedFileType(a.name,a.contentType)) res.push(a);
  for(const s of msg.messageSnapshots?.values?.()||[])
    for(const a of s.attachments?.values?.()||[])
      if(isAllowedFileType(a.name,a.contentType)) res.push(a);
  return res;
}

// ============================================================
// DOT COMMANDS — ✅ WORK EVERYWHERE (DMs + ALL CHANNELS)
// ============================================================
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  const txt = (msg.content || "").trim();
  if (!txt.startsWith(".")) return;

  const owner = isOwner(msg.author.id);
  const access = owner ? true : await hasAccess(msg.member, msg.author.id);

  // ========== OWNER ONLY COMMANDS ==========
  if (/^\.serverlist$/i.test(txt)) {
    if (!owner) return replyUser(msg, "❌ owner only, dumbass.");
    const list = client.guilds.cache.sort((a,b)=>b.memberCount-a.memberCount);
    let lines=[],n=1;
    for(const g of list.values()) lines.push(`**${n++}.** \`${g.name}\`\n   🆔 \`${g.id}\`\n   👥 \`${g.memberCount}\``);
    replyUser(msg, {embeds:[new EmbedBuilder().setColor(0x808080).setTitle(`🌐 Servers (${list.size})`).setDescription(lines.join("\n\n"))]});
    return;
  }
  if (/^\.getinv(?:\s|$)/i.test(txt)) {
    if (!owner) return replyUser(msg, "❌ owner only, dumbass.");
    const id = txt.split(/\s+/)[1];
    if(!id) return replyUser(msg, "❌ usage: `.getinv <server id>`, dumbass.");
    try {
      const g = await client.guilds.fetch(id.trim());
      const ch = (await g.channels.fetch()).find(x=>x.isTextBased() && x.permissionsFor(g.members.me)?.has("CreateInstantInvite"));
      if(!ch) return replyUser(msg, "❌ no channel found.");
      const inv = await ch.createInvite({maxAge:1800,maxUses:1,unique:true});
      replyUser(msg, `✅ **Invite:** https://discord.gg/${inv.code}`);
    } catch { replyUser(msg, "❌ invalid server id."); }
    return;
  }
  if (/^\.leave(?:\s|$)/i.test(txt)) {
    if (!owner) return replyUser(msg, "❌ owner only, dumbass.");
    const arg = txt.split(/\s+/)[1];
    if(!arg) {
      if(msg.guild?.id === GUILD_ID) return replyUser(msg, "❌ can't leave main server.");
      try { await msg.guild.leave(); replyUser(msg, "✅ left server."); }
      catch { replyUser(msg, "❌ failed."); }
      return;
    }
    if(arg.toLowerCase()==="all"){
      let ok=0,fail=0;
      for(const g of client.guilds.cache.values()){
        if(g.id===GUILD_ID)continue;
        try{await g.leave();ok++}catch{fail++}
      }
      return replyUser(msg, `✅ left ${ok} servers${fail?` (${fail} failed)`:""}`);
    }
    try{const g=await client.guilds.fetch(arg.trim());if(g.id===GUILD_ID)return replyUser(msg,"❌ can't leave main server.");await g.leave();replyUser(msg,`✅ left ${g.name}`);}
    catch{replyUser(msg,"❌ invalid id.")}
    return;
  }

  // ========== OWNER + ACCESS ROLE COMMANDS ==========
  if (!access) return replyUser(msg, "❌ no permission.");

  if (/^\.(removeline|rl)$/i.test(txt)) {
    if(!owner && !await hasPrinceStatus(msg.author.id)) return replyUser(msg, "❌ put `prince is the best` in your status.");
    let atts = [...(msg.attachments?.values()||[])];
    if(!atts.length && msg.reference?.messageId) try{const r=await msg.channel.messages.fetch(msg.reference.messageId);atts=[...allAttachmentsOf(r)]}catch{}
    if(!atts.length) return replyUser(msg, "❌ reply or upload file.");
    const f = atts[0], e = ext(f.name);
    if(e!="lua"&&e!="txt") return replyUser(msg, "❌ only .lua / .txt");
    replyUser(msg, "⏳ processing...").then(async m=>{
      try{const txt=await (await fetch(f.url)).text();const clean=txt.replace(/--.*$/gm,"").split("\n").filter(l=>l.trim()!=="").join("\n");
      await msg.channel.send({content:`<@${msg.author.id}> ✅ cleaned:`,files:[new AttachmentBuilder(Buffer.from(clean),{name:"clean.lua"})]});
      await m.delete().catch(()=>{})}catch{await m.edit({content:"❌ failed",allowedMentions:{repliedUser:true}}).catch(()=>{})}
    });
    return;
  }
  if (/^\.get(?:\s|$)/i.test(txt)) {
    const id = txt.split(/\s+/)[1];
    if(!id) return replyUser(msg, "❌ put id, idiot.");
    const f = getFile(id);
    if(!f) return replyUser(msg, "❌ wrong id, dumbass.");
    const url = await getFreshUrl(f);
    replyUser(msg, {content:"✅ Here:",files:[{attachment:url||f.url,name:f.filename||"file"}]});
    return;
  }
  if (/^\.find(?:\s|$)/i.test(txt)) {
    const q = txt.slice(5).trim();
    if(!q) return replyUser(msg, "❌ usage: `.find <name>`, dumbass.");
    const res = findFiles(q);
    if(!res.length) return replyUser(msg, "❌ no files found.");
    const perPage=8, pages=Math.ceil(res.length/perPage), items=res.slice(0,perPage);
    const time = new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Manila"});
    const emb = new EmbedBuilder().setColor(0x808080).setTitle("Finder Search Results").setDescription(items.map(f=>`\`${f.filename}\` — ID: \`${f.id}\``).join("\n")).setFooter({text:`Pages 1/${pages} │ Today at ${time}`});
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(pages<=1)
    );
    replyUser(msg, {embeds:[emb], components:[row]}).then(sent=>{
      paginationMenus.set(msg.author.id, {results:res,page:1,totalPages:pages,messageId:sent.id,authorId:msg.author.id,createdAt:Date.now()});
    });
    return;
  }
});

// ============================================================
// BUTTON PAGINATION
// ============================================================
client.on("interactionCreate", async int=>{
  if(!int.isButton())return;
  const uid=int.user.id;
  if(!paginationMenus.has(uid)) return int.reply({content:"❌ this is expired, dumbass.",flags:MessageFlags.Ephemeral}).catch(()=>{});
  const menu = paginationMenus.get(uid);
  if(uid!==menu.authorId) return int.reply({content:"❌ not yours, idiot.",flags:MessageFlags.Ephemeral}).catch(()=>{});
  if(Date.now()-menu.createdAt>EXPIRY_MS){ paginationMenus.delete(uid); return int.reply({content:"❌ this is expired, dumbass.",flags:MessageFlags.Ephemeral}).catch(()=>{}) }
  if(int.customId==="prev_page")menu.page--;
  if(int.customId==="next_page")menu.page++;
  menu.page=Math.max(1,Math.min(menu.page,menu.totalPages));
  const items=menu.results.slice((menu.page-1)*8,menu.page*8);
  const time=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Manila"});
  const emb=new EmbedBuilder().setColor(0x808080).setTitle("Finder Search Results").setDescription(items.map(f=>`\`${f.filename}\` — ID: \`${f.id}\``).join("\n")).setFooter({text:`Pages ${menu.page}/${menu.totalPages} │ Today at ${time}`});
  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(menu.page<=1),
    new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(menu.page>=menu.totalPages)
  );
  await int.update({embeds:[emb],components:[row]}).catch(()=>{});
  paginationMenus.set(uid,menu);
});

// ============================================================
// EXPRESS
// ============================================================
const app=express();
app.get("/",(req,res)=>res.send("✅ ONLINE"));
app.listen(PORT,"0.0.0.0",()=>console.log(`🌐 Port ${PORT}`));

// ============================================================
// START
// ============================================================
client.once("ready",()=>console.log(`✅ ONLINE: ${client.user.tag}`));
client.login(TOKEN).catch(e=>console.error("❌ Login fail:",e.message));
