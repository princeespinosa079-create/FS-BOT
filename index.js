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

try {
  yauzl = require("yauzl");
} catch {
  console.log("⚠️ yauzl not installed — ZIP extraction disabled");
}

// ======================================================
// CONFIG
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const OWNER_ID = "1302080645987569694";
const SCAN_ROLE_ID = "1509953862226935948";

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID");
  process.exit(1);
}

// ======================================================
// EXPRESS / RENDER HEALTH CHECK
// ======================================================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.status(200).send("FS Bot Online");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    online: client?.isReady?.() || false,
    discord: client?.user?.tag || null,
    guilds: client?.guilds?.cache?.size || 0,
    library: libraryFiles.length,
    uptime: process.uptime()
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});

// ======================================================
// DATA
// ======================================================

const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;

const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const TEMP_DIR = path.join(DATA_DIR, "temp");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ======================================================
// HELPERS
// ======================================================

function normalizeFilename(name) {
  return String(name || "").trim().toLowerCase();
}

function generateId() {
  return crypto.randomBytes(5).toString("hex");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(
        fs.readFileSync(CONFIG_FILE, "utf8")
      );

      return {
        allowedChannelId: data.allowedChannelId || null
      };
    }
  } catch (err) {
    console.error("⚠️ Config load error:", err.message);
  }

  return {
    allowedChannelId: null
  };
}

function saveConfig() {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(config, null, 2)
    );
  } catch (err) {
    console.error("❌ Config save error:", err.message);
  }
}

function loadLibrary() {
  try {
    if (fs.existsSync(LIBRARY_FILE)) {
      const data = JSON.parse(
        fs.readFileSync(LIBRARY_FILE, "utf8")
      );

      if (!Array.isArray(data.files)) {
        data.files = [];
      }

      for (const file of data.files) {
        if (!file.id) {
          file.id = generateId();
        }
      }

      return data;
    }
  } catch (err) {
    console.error("⚠️ Library load error:", err.message);
  }

  return {
    files: []
  };
}

function saveLibrary() {
  try {
    const tempFile = `${LIBRARY_FILE}.tmp`;

    fs.writeFileSync(
      tempFile,
      JSON.stringify(library, null, 2)
    );

    fs.renameSync(tempFile, LIBRARY_FILE);
  } catch (err) {
    console.error("❌ Library save error:", err.message);
  }
}

const config = loadConfig();
const library = loadLibrary();
const libraryFiles = library.files;

saveLibrary();

console.log(`📚 Loaded ${libraryFiles.length} library files`);

// ======================================================
// FILE HELPERS
// ======================================================

const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".ico"
];

function isImageFile(name) {
  const ext = path.extname(
    String(name || "").toLowerCase()
  );

  return IMAGE_EXTENSIONS.includes(ext);
}

function isTxtFile(name) {
  return path.extname(
    String(name || "").toLowerCase()
  ) === ".txt";
}

function getTimePH() {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
}

function fileExistsByName(name) {
  const normalized = normalizeFilename(name);

  return libraryFiles.some(
    file => normalizeFilename(file.name) === normalized
  );
}

// ======================================================
// PERMISSIONS
// ======================================================

function hasPermission(interaction, requiredPerm) {
  const userId = interaction.user.id;
  const member = interaction.member;

  if (userId === OWNER_ID) {
    return true;
  }

  const hasScanRole =
    member?.roles?.cache?.has(SCAN_ROLE_ID) || false;

  switch (requiredPerm) {
    case "owner_only":
      return userId === OWNER_ID;

    case "scan_role_or_owner":
      return userId === OWNER_ID || hasScanRole;

    case "administrator":
      return (
        member?.permissions?.has(
          PermissionFlagsBits.Administrator
        ) || false
      );

    case "manage_messages":
      return (
        member?.permissions?.has(
          PermissionFlagsBits.ManageMessages
        ) || false
      );

    default:
      return false;
  }
}

// ======================================================
// SEARCH
// ======================================================

function searchFiles(query) {
  const q = String(query || "").toLowerCase().trim();

  if (!q || libraryFiles.length === 0) {
    return [];
  }

  const qWords = q.split(/\s+/);
  const qNoSpecial = q.replace(/[^a-z0-9]/g, "");

  const exactMatches = [];
  const allWordsMatches = [];
  const anyWordMatches = [];

  for (const file of libraryFiles) {
    const name = normalizeFilename(file.name);
    const nameNoSpecial = name.replace(/[^a-z0-9]/g, "");

    if (
      name === q ||
      nameNoSpecial === qNoSpecial ||
      name.startsWith(q + ".") ||
      nameNoSpecial.startsWith(qNoSpecial + ".")
    ) {
      exactMatches.push(file);
      continue;
    }

    let allWords = true;

    for (const word of qWords) {
      if (!name.includes(word)) {
        allWords = false;
        break;
      }
    }

    if (allWords && qWords.length > 1) {
      allWordsMatches.push(file);
      continue;
    }

    for (const word of qWords) {
      if (name.includes(word)) {
        anyWordMatches.push(file);
        break;
      }
    }
  }

  return [
    ...exactMatches,
    ...allWordsMatches,
    ...anyWordMatches
  ];
}

function getFileById(id) {
  return libraryFiles.find(
    file => file.id === id
  );
}

// ======================================================
// DOWNLOAD
// ======================================================

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https://")
      ? https
      : http;

    const request = protocol.get(
      url,
      {
        headers: {
          "User-Agent": "FS-Bot"
        }
      },
      response => {
        // Discord/CDN may redirect.
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();

          return downloadFile(
            response.headers.location,
            destination
          )
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          response.resume();

          return reject(
            new Error(
              `HTTP ${response.statusCode}`
            )
          );
        }

        const file = fs.createWriteStream(destination);

        response.pipe(file);

        file.on("finish", () => {
          file.close();
          resolve(destination);
        });

        file.on("error", err => {
          fs.unlink(destination, () => {});
          reject(err);
        });
      }
    );

    request.setTimeout(30000, () => {
      request.destroy(
        new Error("Download timeout")
      );
    });

    request.on("error", err => {
      fs.unlink(destination, () => {});
      reject(err);
    });
  });
}

// ======================================================
// ZIP
// ======================================================

async function extractZipToLibrary(zipPath) {
  if (!yauzl) {
    throw new Error(
      "yauzl is not installed"
    );
  }

  return new Promise((resolve, reject) => {
    let added = 0;
    let skipped = 0;

    yauzl.open(
      zipPath,
      { lazyEntries: true },
      (err, zipfile) => {
        if (err) {
          return reject(err);
        }

        zipfile.readEntry();

        zipfile.on("entry", entry => {
          if (/\/$/.test(entry.fileName)) {
            zipfile.readEntry();
            return;
          }

          const fileName = path.basename(
            entry.fileName
          );

          if (
            !fileName ||
            isImageFile(fileName)
          ) {
            skipped++;
            zipfile.readEntry();
            return;
          }

          if (fileExistsByName(fileName)) {
            skipped++;
            zipfile.readEntry();
            return;
          }

          const safeName =
            crypto.randomBytes(8).toString("hex") +
            "_" +
            fileName;

          const tempPath = path.join(
            TEMP_DIR,
            safeName
          );

          zipfile.openReadStream(
            entry,
            (streamErr, readStream) => {
              if (streamErr) {
                skipped++;
                zipfile.readEntry();
                return;
              }

              const writeStream =
                fs.createWriteStream(tempPath);

              readStream.pipe(writeStream);

              writeStream.on(
                "finish",
                () => {
                  try {
                    const stats =
                      fs.statSync(tempPath);

                    libraryFiles.push({
                      id: generateId(),
                      name: fileName,
                      url: tempPath,
                      isLocal: true,
                      size: stats.size,
                      timestamp: Date.now()
                    });

                    added++;
                    saveLibrary();
                  } catch {
                    skipped++;
                  }

                  zipfile.readEntry();
                }
              );

              writeStream.on(
                "error",
                () => {
                  skipped++;
                  fs.unlink(tempPath, () => {});
                  zipfile.readEntry();
                }
              );
            }
          );
        });

        zipfile.on("end", () => {
          fs.unlink(zipPath, () => {});

          resolve({
            added,
            skipped,
            total: libraryFiles.length
          });
        });

        zipfile.on("error", reject);
      }
    );
  });
}

// ======================================================
// CHANNEL FETCH
// ======================================================

async function fetchChannelById(channelId) {
  if (!/^\d+$/.test(channelId)) {
    return null;
  }

  try {
    let channel =
      client.channels.cache.get(channelId);

    if (!channel) {
      channel =
        await client.channels.fetch(channelId);
    }

    return channel;
  } catch (err) {
    console.error(
      `❌ Channel fetch failed ${channelId}:`,
      err.message
    );

    return null;
  }
}

// ======================================================
// SCAN TXT
// ======================================================

async function scanTxtFiles(channel) {
  if (!channel?.isTextBased()) {
    return {
      files: [],
      scanned: 0
    };
  }

  const foundFiles = [];

  let before = null;
  let scanned = 0;

  while (true) {
    const options = {
      limit: 100
    };

    if (before) {
      options.before = before;
    }

    let batch;

    try {
      batch =
        await channel.messages.fetch(options);
    } catch (err) {
      console.error(
        "⚠️ Message fetch error:",
        err.message
      );

      // Prevent infinite loop.
      await sleep(1500);
      continue;
    }

    if (!batch.size) {
      break;
    }

    scanned += batch.size;

    for (const msg of batch.values()) {
      for (const attachment of msg.attachments.values()) {
        if (!isTxtFile(attachment.name)) {
          continue;
        }

        foundFiles.push({
          name: attachment.name,
          url: attachment.url,
          size: attachment.size
        });
      }
    }

    const last = batch.last();

    if (!last?.id) {
      break;
    }

    before = last.id;

    if (batch.size < 100) {
      break;
    }

    await sleep(100);
  }

  return {
    files: foundFiles,
    scanned
  };
}

// ======================================================
// FULL SCAN
// ======================================================

async function scanChannel(channel) {
  if (!channel?.isTextBased()) {
    return {
      added: 0,
      skipped: 0,
      total: libraryFiles.length,
      scanned: 0
    };
  }

  const foundFiles = [];

  let before = null;
  let scanned = 0;

  while (true) {
    const options = {
      limit: 100
    };

    if (before) {
      options.before = before;
    }

    let batch;

    try {
      batch =
        await channel.messages.fetch(options);
    } catch (err) {
      console.error(
        "⚠️ Scan fetch error:",
        err.message
      );

      await sleep(1500);
      continue;
    }

    if (!batch.size) {
      break;
    }

    scanned += batch.size;

    for (const msg of batch.values()) {
      for (const attachment of msg.attachments.values()) {
        const name = attachment.name;

        if (!name || isImageFile(name)) {
          continue;
        }

        foundFiles.push({
          name,
          url: attachment.url,
          size: attachment.size,
          timestamp: msg.createdTimestamp
        });
      }
    }

    const last = batch.last();

    if (!last?.id) {
      break;
    }

    before = last.id;

    if (batch.size < 100) {
      break;
    }

    await sleep(100);
  }

  // IMPORTANT:
  // Existing library files are preserved.
  // Same filename is skipped.
  const unique = new Map();

  for (const file of libraryFiles) {
    const key = normalizeFilename(file.name);

    if (!unique.has(key)) {
      unique.set(key, file);
    }
  }

  let added = 0;
  let skipped = 0;

  for (const file of foundFiles) {
    const key = normalizeFilename(file.name);

    if (unique.has(key)) {
      skipped++;
      continue;
    }

    unique.set(key, {
      id: generateId(),
      name: file.name,
      url: file.url,
      size: file.size,
      timestamp: file.timestamp
    });

    added++;
  }

  libraryFiles.length = 0;

  libraryFiles.push(
    ...Array.from(unique.values())
      .sort(
        (a, b) =>
          (a.timestamp || 0) -
          (b.timestamp || 0)
      )
  );

  saveLibrary();

  return {
    added,
    skipped,
    total: libraryFiles.length,
    scanned
  };
}

// ======================================================
// SEARCH PAGINATION
// ======================================================

const searchSessions = new Map();

function buildSearchPage(
  ownerUserId,
  results,
  page = 1
) {
  const perPage = 8;

  const totalPages =
    Math.max(
      1,
      Math.ceil(results.length / perPage)
    );

  page = Math.max(
    1,
    Math.min(page, totalPages)
  );

  const start =
    (page - 1) * perPage;

  const display =
    results.slice(
      start,
      start + perPage
    );

  const description =
    display
      .map(
        file =>
          `\`${file.name}\` │ ID: \`${file.id}\``
      )
      .join("\n") ||
    "No files found.";

  const embed =
    new EmbedBuilder()
      .setTitle("Finder Source Results")
      .setColor(0x808080)
      .setDescription(description)
      .setFooter({
        text:
          `Page ${page}/${totalPages} │ Today at ${getTimePH()}`
      });

  const row =
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `search_back_${ownerUserId}_${page}`
        )
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),

      new ButtonBuilder()
        .setCustomId(
          `search_next_${ownerUserId}_${page}`
        )
        .setLabel("Next")
        .setStyle(ButtonStyle.Success)
        .setDisabled(page >= totalPages)
    );

  return {
    embeds: [embed],
    components: [row]
  };
}

// ======================================================
// INVITE
// ======================================================

async function getGuildInvite(guild) {
  try {
    const invites =
      await guild.invites.fetch();

    if (invites.size > 0) {
      return `https://discord.gg/${invites.first().code}`;
    }

    const channel =
      guild.channels.cache.find(channel =>
        channel.isTextBased() &&
        channel
          .permissionsFor(guild.members.me)
          ?.has(
            PermissionFlagsBits.CreateInstantInvite
          )
      );

    if (!channel) {
      return "No permission";
    }

    const invite =
      await channel.createInvite({
        maxAge: 0,
        maxUses: 0,
        reason: "Server list invite"
      });

    return `https://discord.gg/${invite.code}`;
  } catch {
    return "No permission";
  }
}

// ======================================================
// DISCORD CLIENT
// ======================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  rest: {
    timeout: 30000
  }
});

// ======================================================
// COMMANDS
// ======================================================

const commands = [
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription(
      "Set allowed channel for .find and .get"
    ),

  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription(
      "Scan channel for files"
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel to scan")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("forwardall")
    .setDescription(
      "Copy all .txt files"
    )
    .addStringOption(option =>
      option
        .setName("source_channel_id")
        .setDescription("Source channel ID")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("destination_channel_id")
        .setDescription("Destination channel ID")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("uploadzip")
    .setDescription(
      "Upload ZIP and extract files"
    )
    .addAttachmentOption(option =>
      option
        .setName("file")
        .setDescription("ZIP file")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription(
      "Send a gray embed message"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    )
    .addStringOption(option =>
      option
        .setName("description")
        .setDescription("Embed description")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("title")
        .setDescription("Optional title")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription(
      "List all servers with invite"
    ),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription(
      "Leave a server"
    )
    .addStringOption(option =>
      option
        .setName("server-id")
        .setDescription("Server ID")
        .setRequired(true)
    )
].map(command => command.toJSON());

// ======================================================
// REGISTER COMMANDS
// ======================================================

let registeringCommands = false;

async function registerCommands() {
  if (registeringCommands) {
    return;
  }

  registeringCommands = true;

  try {
    const rest =
      new REST({
        version: "10"
      }).setToken(TOKEN);

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: commands
      }
    );

    console.log(
      "✅ Global slash commands registered"
    );
  } catch (err) {
    console.error(
      "❌ Command registration failed:",
      err.message
    );
  } finally {
    registeringCommands = false;
  }
}

// ======================================================
// READY
// ======================================================

client.once("ready", async () => {
  console.log(
    `🟢 DISCORD ONLINE: ${client.user.tag}`
  );

  console.log(
    `📚 Library: ${libraryFiles.length} files`
  );

  console.log(
    `🏠 Guilds: ${client.guilds.cache.size}`
  );

  client.user.setPresence({
    activities: [
      {
        name: `${libraryFiles.length} files`,
        type: 3
      }
    ],
    status: "online"
  });

  await registerCommands();
});

// ======================================================
// INTERACTIONS
// ======================================================

client.on(
  "interactionCreate",
  async interaction => {
    try {
      // ==================================================
      // BUTTONS
      // ==================================================

      if (interaction.isButton()) {
        const customId =
          interaction.customId;

        if (
          customId.startsWith("search_back_") ||
          customId.startsWith("search_next_")
        ) {
          const parts =
            customId.split("_");

          const direction = parts[1];
          const ownerUserId = parts[2];
          const currentPage =
            Number(parts[3]);

          if (
            ownerUserId !==
            interaction.user.id
          ) {
            return interaction.reply({
              content:
                "❌ stfu, this is not your search.",
              ephemeral: true
            });
          }

          const session =
            searchSessions.get(
              interaction.message.id
            );

          if (!session) {
            return interaction.reply({
              content:
                "❌ Search expired, use `.find` again.",
              ephemeral: true
            });
          }

          const newPage =
            direction === "next"
              ? currentPage + 1
              : currentPage - 1;

          await interaction.update(
            buildSearchPage(
              ownerUserId,
              session.results,
              newPage
            )
          );

          searchSessions.set(
            interaction.message.id,
            {
              ...session,
              page: newPage
            }
          );
        }

        return;
      }

      if (!interaction.isChatInputCommand()) {
        return;
      }

      // ==================================================
      // SERVERLIST
      // ==================================================

      if (
        interaction.commandName ===
        "serverlist"
      ) {
        if (
          !hasPermission(
            interaction,
            "owner_only"
          )
        ) {
          return interaction.reply({
            content: "❌ Owner only.",
            ephemeral: true
          });
        }

        await interaction.deferReply({
          ephemeral: true
        });

        const guilds =
          [...client.guilds.cache.values()];

        let list =
          `**📋 Servers (${guilds.length})**\n\n`;

        for (
          let i = 0;
          i < guilds.length;
          i++
        ) {
          const guild = guilds[i];

          const invite =
            await getGuildInvite(guild);

          list +=
            `${i + 1}. **${guild.name}**\n` +
            `ID: \`${guild.id}\`\n` +
            `Invite: ${invite}\n\n`;

          if (list.length > 3500) {
            list += "... (truncated)";
            break;
          }
        }

        return interaction.editReply({
          content: list
        });
      }

      // ==================================================
      // LEAVE
      // ==================================================

      if (
        interaction.commandName ===
        "leave"
      ) {
        if (
          !hasPermission(
            interaction,
            "owner_only"
          )
        ) {
          return interaction.reply({
            content: "❌ Owner only.",
            ephemeral: true
          });
        }

        const serverId =
          interaction.options.getString(
            "server-id"
          );

        const guild =
          client.guilds.cache.get(
            serverId
          );

        if (!guild) {
          return interaction.reply({
            content:
              "❌ Server not found.",
            ephemeral: true
          });
        }

        const name = guild.name;

        try {
          await guild.leave();

          return interaction.reply({
            content:
              `✅ Left **${name}**`,
            ephemeral: true
          });
        } catch {
          return interaction.reply({
            content:
              "❌ Failed to leave server.",
            ephemeral: true
          });
        }
      }

      // ==================================================
      // SCAN
      // ==================================================

      if (
        interaction.commandName ===
        "scanchannel"
      ) {
        if (
          !hasPermission(
            interaction,
            "scan_role_or_owner"
          )
        ) {
          return interaction.reply({
            content:
              "❌ Owner or Scan Role only.",
            ephemeral: true
          });
        }

        const channel =
          interaction.options.getChannel(
            "channel"
          );

        await interaction.deferReply();

        const result =
          await scanChannel(channel);

        return interaction.editReply({
          content:
            `📁 **SCAN COMPLETE**\n` +
            `**Channel:** <#${channel.id}>\n` +
            `**Scanned:** ${result.scanned}\n` +
            `✅ **Added:** ${result.added}\n` +
            `⏭️ **Skipped:** ${result.skipped}\n` +
            `📚 **Total:** ${result.total}`
        });
      }

      // ==================================================
      // FORWARD ALL
      // ==================================================

      if (
        interaction.commandName ===
        "forwardall"
      ) {
        if (
          !hasPermission(
            interaction,
            "scan_role_or_owner"
          )
        ) {
          return interaction.reply({
            content:
              "❌ Owner or Scan Role only.",
            ephemeral: true
          });
        }

        const sourceId =
          interaction.options
            .getString(
              "source_channel_id"
            )
            .trim();

        const destId =
          interaction.options
            .getString(
              "destination_channel_id"
            )
            .trim();

        await interaction.deferReply();

        const source =
          await fetchChannelById(
            sourceId
          );

        if (
          !source ||
          !source.isTextBased()
        ) {
          return interaction.editReply({
            content:
              `❌ Invalid source channel: ${sourceId}`
          });
        }

        const destination =
          await fetchChannelById(
            destId
          );

        if (
          !destination ||
          !destination.isTextBased()
        ) {
          return interaction.editReply({
            content:
              `❌ Invalid destination channel: ${destId}`
          });
        }

        await interaction.editReply({
          content:
            `🔄 **Scanning .txt files...**\n` +
            `<#${sourceId}> → <#${destId}>`
        });

        const scan =
          await scanTxtFiles(
            source
          );

        if (
          scan.files.length === 0
        ) {
          return interaction.editReply({
            content:
              `❌ No .txt files found.\n` +
              `Scanned ${scan.scanned} messages.`
          });
        }

        let sent = 0;
        let failed = 0;

        const total =
          scan.files.length;

        // Small batches prevent Discord API
        // rate-limit problems.
        const BATCH_SIZE = 5;

        for (
          let i = 0;
          i < total;
          i += BATCH_SIZE
        ) {
          const batch =
            scan.files.slice(
              i,
              i + BATCH_SIZE
            );

          const results =
            await Promise.allSettled(
              batch.map(async file => {
                await destination.send({
                  files: [
                    {
                      attachment: file.url,
                      name: file.name
                    }
                  ]
                });
              })
            );

          for (const result of results) {
            if (
              result.status ===
              "fulfilled"
            ) {
              sent++;
            } else {
              failed++;
            }
          }

          if (
            i + BATCH_SIZE < total
          ) {
            await sleep(250);
          }

          // Don't edit Discord every single
          // file. This reduces rate limits.
          if (
            i % 25 === 0 ||
            i + BATCH_SIZE >= total
          ) {
            await interaction.editReply({
              content:
                `🔄 **Forwarding...**\n` +
                `⚡ ${sent}/${total}\n` +
                `From: <#${sourceId}>\n` +
                `To: <#${destId}>`
            }).catch(() => {});
          }
        }

        return interaction.editReply({
          content:
            `✅ **FORWARD COMPLETE**\n` +
            `**Scanned:** ${scan.scanned}\n` +
            `**Files Found:** ${total}\n` +
            `✅ **Sent:** ${sent}\n` +
            `❌ **Failed:** ${failed}\n` +
            `📤 **Destination:** <#${destId}>`
        });
      }

      // ==================================================
      // UPLOAD ZIP
      // ==================================================

      if (
        interaction.commandName ===
        "uploadzip"
      ) {
        if (
          !hasPermission(
            interaction,
            "scan_role_or_owner"
          )
        ) {
          return interaction.reply({
            content:
              "❌ Owner or Scan Role only.",
            ephemeral: true
          });
        }

        const attachment =
          interaction.options.getAttachment(
            "file"
          );

        if (
          !attachment.name
            .toLowerCase()
            .endsWith(".zip")
        ) {
          return interaction.reply({
            content:
              "❌ Must be a `.zip` file.",
            ephemeral: true
          });
        }

        await interaction.deferReply();

        const zipPath =
          path.join(
            TEMP_DIR,
            `${crypto.randomBytes(10).toString("hex")}.zip`
          );

        try {
          await downloadFile(
            attachment.url,
            zipPath
          );

          const result =
            await extractZipToLibrary(
              zipPath
            );

          client.user.setPresence({
            activities: [
              {
                name: `${libraryFiles.length} files`,
                type: 3
              }
            ],
            status: "online"
          });

          return interaction.editReply({
            content:
              `📦 **ZIP EXTRACTED**\n` +
              `**File:** \`${attachment.name}\`\n` +
              `✅ **Added:** ${result.added}\n` +
              `⏭️ **Skipped:** ${result.skipped}\n` +
              `📚 **Total:** ${result.total}`
          });
        } catch (err) {
          console.error(
            "❌ ZIP error:",
            err
          );

          fs.unlink(
            zipPath,
            () => {}
          );

          return interaction.editReply({
            content:
              `❌ Failed to extract ZIP:\n\`${err.message}\``
          });
        }
      }

      // ==================================================
      // SET CHANNEL
      // ==================================================

      if (
        interaction.commandName ===
        "setchannel"
      ) {
        if (
          !hasPermission(
            interaction,
            "administrator"
          )
        ) {
          return interaction.reply({
            content:
              "❌ Requires Administrator permission.",
            ephemeral: true
          });
        }

        config.allowedChannelId =
          interaction.channelId;

        saveConfig();

        return interaction.reply({
          content:
            `✅ **Channel Set!**\n` +
            `🔗 Allowed: <#${interaction.channelId}>`
        });
      }

      // ==================================================
      // EMBED
      // ==================================================

      if (
        interaction.commandName ===
        "embed"
      ) {
        if (
          !hasPermission(
            interaction,
            "manage_messages"
          )
        ) {
          return interaction.reply({
            content:
              "❌ Requires Manage Messages permission.",
            ephemeral: true
          });
        }

        const description =
          interaction.options.getString(
            "description"
          );

        const title =
          interaction.options.getString(
            "title"
          );

        const embed =
          new EmbedBuilder()
            .setColor(0x808080)
            .setDescription(
              description
            )
            .setFooter({
              text:
                `Today at ${getTimePH()}`
            });

        if (title) {
          embed.setTitle(title);
        }

        await interaction.reply({
          content: "✅ Sent.",
          ephemeral: true
        });

        await interaction.channel.send({
          embeds: [embed]
        });

        return;
      }

    } catch (err) {
      console.error(
        "❌ Interaction error:",
        err
      );

      // Try to respond if Discord still
      // considers the interaction valid.
      try {
        if (
          interaction.deferred ||
          interaction.replied
        ) {
          await interaction.editReply({
            content:
              "❌ Something went wrong while processing that command."
          });
        } else {
          await interaction.reply({
            content:
              "❌ Something went wrong while processing that command.",
            ephemeral: true
          });
        }
      } catch {
        // Interaction already expired.
      }
    }
  }
);

// ======================================================
// PREFIX COMMANDS
// ======================================================

client.on(
  "messageCreate",
  async message => {
    try {
      if (
        message.author.bot
      ) {
        return;
      }

      const userId =
        message.author.id;

      const hasScanRole =
        message.member
          ?.roles
          ?.cache
          ?.has(SCAN_ROLE_ID) ||
        false;

      const bypass =
        userId === OWNER_ID ||
        hasScanRole;

      const allowed =
        bypass ||
        !config.allowedChannelId ||
        message.channel.id ===
          config.allowedChannelId;

      // ==================================================
      // .find
      // ==================================================

      if (
        message.content
          .toLowerCase()
          .startsWith(".find")
      ) {
        if (!allowed) {
          return message.reply(
            "❌ not here, idiot."
          );
        }

        const query =
          message.content
            .slice(5)
            .trim();

        if (!query) {
          return message.reply(
            "❌ no match file for that, idiot."
          );
        }

        const results =
          searchFiles(query);

        if (
          results.length === 0
        ) {
          return message.reply(
            "❌ no match file for that, idiot."
          );
        }

        const replyData =
          buildSearchPage(
            message.author.id,
            results,
            1
          );

        const replyMessage =
          await message.reply(
            replyData
          );

        searchSessions.set(
          replyMessage.id,
          {
            userId:
              message.author.id,
            results,
            page: 1
          }
        );

        return;
      }

      // ==================================================
      // .get
      // ==================================================

      if (
        message.content
          .toLowerCase()
          .startsWith(".get")
      ) {
        if (!allowed) {
          return message.reply(
            "❌ not here, idiot."
          );
        }

        const id =
          message.content
            .slice(4)
            .trim();

        if (!id) {
          return message.reply(
            "❌ put id of file, idiot."
          );
        }

        const file =
          getFileById(id);

        if (!file) {
          return message.reply(
            "❌ make sure that correct, idiot."
          );
        }

        // LOCAL FILE
        if (
          file.isLocal &&
          file.url &&
          fs.existsSync(file.url)
        ) {
          return message.channel.send({
            content:
              `<@${message.author.id}> Here is the file twin!`,
            files: [
              {
                attachment: file.url,
                name: file.name
              }
            ]
          });
        }

        // DISCORD CDN FILE
        if (
          file.url &&
          /^https?:\/\//i.test(
            file.url
          )
        ) {
          return message.channel.send({
            content:
              `<@${message.author.id}> Here is the file twin!`,
            files: [
              {
                attachment: file.url,
                name: file.name
              }
            ]
          });
        }

        return message.reply(
          "❌ file source is no longer available."
        );
      }

    } catch (err) {
      console.error(
        "❌ messageCreate error:",
        err
      );
    }
  }
);

// ======================================================
// DISCORD CONNECTION EVENTS
// ======================================================

client.on(
  "error",
  error => {
    console.error(
      "❌ Discord client error:",
      error
    );
  }
);

client.on(
  "warn",
  warning => {
    console.warn(
      "⚠️ Discord warning:",
      warning
    );
  }
);

client.on(
  "debug",
  message => {
    if (
      message.includes("Heartbeat") ||
      message.includes("Session")
    ) {
      console.log(
        `🔧 Discord: ${message}`
      );
    }
  }
);

client.on(
  "shardDisconnect",
  (event, shardId) => {
    console.warn(
      `🔴 Discord disconnected — shard ${shardId}`,
      event?.code || ""
    );
  }
);

client.on(
  "shardReconnecting",
  shardId => {
    console.log(
      `🟡 Discord reconnecting — shard ${shardId}`
    );
  }
);

client.on(
  "shardResume",
  (shardId, replayedEvents) => {
    console.log(
      `🟢 Discord connection resumed — shard ${shardId}, replayed ${replayedEvents} events`
    );
  }
);

// ======================================================
// PERIODIC HEALTH LOG
// ======================================================

setInterval(() => {
  console.log(
    `💓 Health | Discord: ${
      client.isReady() ? "CONNECTED" : "DISCONNECTED"
    } | Guilds: ${
      client.guilds.cache.size
    } | Library: ${
      libraryFiles.length
    } | Uptime: ${
      Math.floor(process.uptime())
    }s`
  );
}, 60000);

// ======================================================
// LOGIN
// ======================================================

async function startBot() {
  console.log("🔑 Connecting to Discord...");

  try {
    await client.login(TOKEN);

    console.log(
      "🟢 Discord login successful"
    );
  } catch (err) {
    console.error(
      "❌ Discord login failed:",
      err
    );

    // Do NOT immediately kill the Render process.
    // Render should keep the web service alive.
    setTimeout(
      startBot,
      10000
    );
  }
}

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ Uncaught exception:",
      error
    );
  }
);

console.log(
  "🚀 Starting FS Bot..."
);

startBot();
