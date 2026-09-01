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
  PermissionFlagsBits,
  ChannelType
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("crypto");

// =====================================================
// CONFIG
// =====================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const OWNER_ID = "1302080645987569694";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("========================================");
  console.error("❌ MISSING ENVIRONMENT VARIABLES");
  console.error("========================================");
  console.error(`DISCORD_TOKEN: ${TOKEN ? "OK" : "MISSING"}`);
  console.error(`CLIENT_ID:     ${CLIENT_ID ? "OK" : "MISSING"}`);
  console.error(`GUILD_ID:      ${GUILD_ID ? "OK" : "MISSING"}`);
  console.error("========================================");
  process.exit(1);
}

// =====================================================
// EXPRESS SERVER FOR RENDER
// =====================================================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.status(200).send("FS Bot Online");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    online: client?.isReady?.() || false,
    bot: client?.user?.tag || null
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server listening on port ${PORT}`);
});

// =====================================================
// DATA
// =====================================================

const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;

const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const TEMP_DIR = path.join(DATA_DIR, "temp");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// =====================================================
// HELPERS
// =====================================================

function normalizeFilename(name) {
  return String(name || "").trim().toLowerCase();
}

function generateId() {
  return crypto.randomBytes(4).toString("hex");
}

function getTimePH() {
  const now = new Date();

  const ph = new Date(
    now.toLocaleString("en-US", {
      timeZone: "Asia/Manila"
    })
  );

  return ph.toTimeString().slice(0, 5);
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
  } catch (error) {
    console.error("⚠️ Config load error:", error.message);
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
  } catch (error) {
    console.error("❌ Config save error:", error.message);
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
  } catch (error) {
    console.error("⚠️ Library load error:", error.message);
  }

  return {
    files: []
  };
}

function saveLibrary() {
  try {
    fs.writeFileSync(
      LIBRARY_FILE,
      JSON.stringify(library, null, 2)
    );
  } catch (error) {
    console.error("❌ Library save error:", error.message);
  }
}

const config = loadConfig();
const library = loadLibrary();
const libraryFiles = library.files;

saveLibrary();

// =====================================================
// FILE HELPERS
// =====================================================

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
  return (
    path.extname(
      String(name || "").toLowerCase()
    ) === ".txt"
  );
}

function fileExistsByName(name) {
  const target = normalizeFilename(name);

  return libraryFiles.some(
    file => normalizeFilename(file.name) === target
  );
}

function getFileById(id) {
  return libraryFiles.find(
    file => String(file.id) === String(id)
  );
}

// =====================================================
// PERMISSIONS
// =====================================================

function isOwner(userId) {
  return String(userId) === OWNER_ID;
}

function hasManageMessages(interaction) {
  return (
    interaction.member?.permissions?.has(
      PermissionFlagsBits.ManageMessages
    ) || false
  );
}

function isAllowedPrefixUser(message) {
  if (message.author.id === OWNER_ID) {
    return true;
  }

  if (!config.allowedChannelId) {
    return true;
  }

  return message.channel.id === config.allowedChannelId;
}

// =====================================================
// SMART SEARCH
// =====================================================

function searchFiles(query) {
  const q = String(query || "").toLowerCase().trim();

  if (!q || libraryFiles.length === 0) {
    return [];
  }

  const qWords = q.split(/\s+/);

  const qNoSpecial = q.replace(
    /[^a-z0-9]/g,
    ""
  );

  const exactMatches = [];
  const allWordsMatches = [];
  const anyWordMatches = [];

  for (const file of libraryFiles) {
    const name = normalizeFilename(file.name);

    const nameNoSpecial = name.replace(
      /[^a-z0-9]/g,
      ""
    );

    // Exact
    if (
      name === q ||
      nameNoSpecial === qNoSpecial ||
      name.startsWith(q + ".") ||
      nameNoSpecial.startsWith(qNoSpecial + ".")
    ) {
      exactMatches.push(file);
      continue;
    }

    // All words
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

    // Any word
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

// =====================================================
// DOWNLOAD HELPER
// =====================================================

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https")
      ? https
      : http;

    const file = fs.createWriteStream(destPath);

    const request = protocol.get(
      url,
      response => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          file.close();
          fs.unlink(destPath, () => {});

          return downloadFile(
            response.headers.location,
            destPath
          )
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});

          return reject(
            new Error(
              `HTTP ${response.statusCode}`
            )
          );
        }

        response.pipe(file);

        file.on("finish", () => {
          file.close(() => {
            resolve(destPath);
          });
        });
      }
    );

    request.setTimeout(30000, () => {
      request.destroy(
        new Error("Download timeout")
      );
    });

    request.on("error", error => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(error);
    });
  });
}

// =====================================================
// FETCH CHANNEL
// =====================================================

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
  } catch (error) {
    console.error(
      `❌ Failed to fetch channel ${channelId}:`,
      error.message
    );

    return null;
  }
}

// =====================================================
// SAFE MESSAGE FETCH
// =====================================================

async function fetchMessageBatch(channel, options) {
  const MAX_RETRIES = 4;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await channel.messages.fetch(options);
    } catch (error) {
      console.error(
        `⚠️ Message fetch failed (${attempt}/${MAX_RETRIES}):`,
        error.message
      );

      if (attempt === MAX_RETRIES) {
        throw error;
      }

      await new Promise(resolve =>
        setTimeout(
          resolve,
          1000 * attempt
        )
      );
    }
  }

  return null;
}

// =====================================================
// SCAN CHANNEL
// =====================================================

async function scanChannel(channel, progressCallback) {
  if (!channel || !channel.isTextBased()) {
    throw new Error(
      "That channel is not a text channel."
    );
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
      batch = await fetchMessageBatch(
        channel,
        options
      );
    } catch (error) {
      throw new Error(
        `Could not read channel messages: ${error.message}`
      );
    }

    if (!batch || batch.size === 0) {
      break;
    }

    scanned += batch.size;

    for (const msg of batch.values()) {
      // Normal attachments
      for (const attachment of msg.attachments.values()) {
        const name = attachment.name;

        if (!name) continue;

        if (isImageFile(name)) {
          continue;
        }

        foundFiles.push({
          name,
          url: attachment.url,
          size: attachment.size || 0,
          ts: msg.createdTimestamp
        });
      }

      // Forwarded message snapshots
      if (msg.messageSnapshots) {
        const snapshots =
          Array.isArray(msg.messageSnapshots)
            ? msg.messageSnapshots
            : [
                ...(msg.messageSnapshots.values?.() || [])
              ];

        for (const snapshot of snapshots) {
          if (!snapshot?.attachments) {
            continue;
          }

          let attachments = [];

          if (
            typeof snapshot.attachments.values ===
            "function"
          ) {
            attachments = [
              ...snapshot.attachments.values()
            ];
          } else if (
            Array.isArray(snapshot.attachments)
          ) {
            attachments = snapshot.attachments;
          }

          for (const attachment of attachments) {
            const name = attachment.name;

            if (!name) continue;

            if (isImageFile(name)) {
              continue;
            }

            foundFiles.push({
              name,
              url: attachment.url,
              size: attachment.size || 0,
              ts: msg.createdTimestamp
            });
          }
        }
      }
    }

    before = batch.last()?.id;

    if (!before || batch.size < 100) {
      break;
    }

    if (
      progressCallback &&
      scanned % 1000 < 100
    ) {
      await progressCallback(scanned);
    }
  }

  // ===================================================
  // DEDUPLICATE BY FILE NAME
  // ===================================================

  const unique = new Map();

  // Keep existing library
  for (const file of libraryFiles) {
    const key = normalizeFilename(file.name);

    if (!key) continue;

    if (!unique.has(key)) {
      unique.set(key, file);
    }
  }

  let added = 0;
  let skipped = 0;

  // Add newly found files
  for (const file of foundFiles) {
    const key = normalizeFilename(file.name);

    if (!key) {
      continue;
    }

    if (!unique.has(key)) {
      unique.set(key, {
        id: generateId(),
        name: file.name,
        url: file.url,
        size: file.size,
        timestamp: file.ts
      });

      added++;
    } else {
      skipped++;
    }
  }

  // Update library without deleting existing files
  libraryFiles.length = 0;

  libraryFiles.push(
    ...Array.from(unique.values()).sort(
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

// =====================================================
// SCAN TXT FILES
// =====================================================

async function scanTxtFiles(channel) {
  if (!channel || !channel.isTextBased()) {
    throw new Error(
      "That channel is not a text channel."
    );
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

    const batch =
      await fetchMessageBatch(
        channel,
        options
      );

    if (!batch || batch.size === 0) {
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
          size: attachment.size || 0
        });
      }

      if (msg.messageSnapshots) {
        const snapshots =
          Array.isArray(msg.messageSnapshots)
            ? msg.messageSnapshots
            : [
                ...(msg.messageSnapshots.values?.() || [])
              ];

        for (const snapshot of snapshots) {
          if (!snapshot?.attachments) {
            continue;
          }

          let attachments = [];

          if (
            typeof snapshot.attachments.values ===
            "function"
          ) {
            attachments = [
              ...snapshot.attachments.values()
            ];
          } else if (
            Array.isArray(snapshot.attachments)
          ) {
            attachments = snapshot.attachments;
          }

          for (const attachment of attachments) {
            if (!isTxtFile(attachment.name)) {
              continue;
            }

            foundFiles.push({
              name: attachment.name,
              url: attachment.url,
              size: attachment.size || 0
            });
          }
        }
      }
    }

    before = batch.last()?.id;

    if (!before || batch.size < 100) {
      break;
    }
  }

  return {
    files: foundFiles,
    scanned
  };
}

// =====================================================
// PAGINATION
// =====================================================

const searchSessions = new Map();

function buildSearchPage(
  ownerUserId,
  results,
  page = 1
) {
  const perPage = 8;

  const totalPages = Math.max(
    1,
    Math.ceil(results.length / perPage)
  );

  const safePage = Math.min(
    Math.max(page, 1),
    totalPages
  );

  const start =
    (safePage - 1) * perPage;

  const display = results.slice(
    start,
    start + perPage
  );

  const desc =
    display.length > 0
      ? display
          .map(
            file =>
              `\`${file.name}\` │ ID: \`${file.id}\``
          )
          .join("\n")
      : "No files found.";

  const embed = new EmbedBuilder()
    .setTitle("Finder Source Results")
    .setColor(0x808080)
    .setDescription(desc)
    .setFooter({
      text:
        `Page ${safePage}/${totalPages} │ ` +
        `Today at ${getTimePH()}`
    });

  const row =
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `search_back_${ownerUserId}_${safePage}`
        )
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 1),

      new ButtonBuilder()
        .setCustomId(
          `search_next_${ownerUserId}_${safePage}`
        )
        .setLabel("Next")
        .setStyle(ButtonStyle.Success)
        .setDisabled(
          safePage >= totalPages
        )
    );

  return {
    embeds: [embed],
    components: [row]
  };
}

// =====================================================
// DISCORD CLIENT
// =====================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// =====================================================
// COMMANDS
// =====================================================

const commands = [
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription(
      "Set allowed channel for .find and .get (Owner Only)"
    ),

  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription(
      "Scan a channel for files (Owner Only)"
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription(
          "Channel to scan"
        )
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("forwardall")
    .setDescription(
      "Copy all .txt files between channels (Owner Only)"
    )
    .addStringOption(option =>
      option
        .setName("source_channel_id")
        .setDescription(
          "Source channel ID"
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("destination_channel_id")
        .setDescription(
          "Destination channel ID"
        )
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
        .setDescription(
          "Embed text content"
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("title")
        .setDescription(
          "Optional title"
        )
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription(
      "List the bot's server (Owner Only)"
    ),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription(
      "Make the bot leave a server (Owner Only)"
    )
    .addStringOption(option =>
      option
        .setName("server-id")
        .setDescription(
          "Server ID to leave"
        )
        .setRequired(true)
    )
].map(command => command.toJSON());

// =====================================================
// REGISTER COMMANDS
// =====================================================

async function registerCommands() {
  const rest = new REST({
    version: "10"
  }).setToken(TOKEN);

  console.log("========================================");
  console.log("🔧 REGISTERING SLASH COMMANDS");
  console.log(`📌 Guild: ${GUILD_ID}`);
  console.log("========================================");

  try {
    // -------------------------------------------------
    // DELETE OLD GLOBAL COMMANDS
    // -------------------------------------------------

    console.log(
      "🧹 Removing old global slash commands..."
    );

    try {
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        {
          body: []
        }
      );

      console.log(
        "✅ Old global commands removed."
      );
    } catch (error) {
      console.error(
        "⚠️ Could not remove global commands:",
        error.message
      );
    }

    // -------------------------------------------------
    // REGISTER ONLY IN ONE GUILD
    // -------------------------------------------------

    await rest.put(
      Routes.applicationGuildCommands(
        CLIENT_ID,
        GUILD_ID
      ),
      {
        body: commands
      }
    );

    console.log(
      `✅ ${commands.length} commands registered to GUILD_ID.`
    );

    console.log(
      "🚫 No global slash commands are being used."
    );

    console.log("========================================");
  } catch (error) {
    console.error(
      "❌ Command registration failed:"
    );

    console.error(
      error?.rawError || error
    );

    throw error;
  }
}

// =====================================================
// READY
// =====================================================

client.once("ready", async () => {
  console.log("========================================");
  console.log("🚀 FS BOT ONLINE");
  console.log("========================================");
  console.log(
    `🤖 Bot: ${client.user.tag}`
  );
  console.log(
    `🆔 Client ID: ${CLIENT_ID}`
  );
  console.log(
    `🏠 Guild ID: ${GUILD_ID}`
  );
  console.log(
    `👑 Owner ID: ${OWNER_ID}`
  );
  console.log(
    `📚 Library: ${libraryFiles.length} files`
  );
  console.log("========================================");

  // No Watching status
  client.user.setPresence({
    activities: [],
    status: "online"
  });

  try {
    const guild =
      await client.guilds.fetch(GUILD_ID);

    console.log(
      `✅ Connected to guild: ${guild.name}`
    );

    await registerCommands();

    console.log(
      "✅ FS Bot is fully ready."
    );
  } catch (error) {
    console.error(
      "❌ Ready setup failed:",
      error.message
    );
  }
});

// =====================================================
// DISCORD DEBUG EVENTS
// =====================================================

client.on("shardReady", shardId => {
  console.log(
    `🟢 Discord gateway ready | Shard ${shardId}`
  );
});

client.on("shardReconnecting", shardId => {
  console.log(
    `🔄 Discord reconnecting | Shard ${shardId}`
  );
});

client.on("shardDisconnect", (event, shardId) => {
  console.error(
    `🔴 Discord disconnected | Shard ${shardId}`,
    event?.code || ""
  );
});

client.on("shardError", (error, shardId) => {
  console.error(
    `❌ Discord shard error | Shard ${shardId}:`,
    error.message
  );
});

client.on("error", error => {
  console.error(
    "❌ Discord client error:",
    error.message
  );
});

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

// =====================================================
// INTERACTIONS
// =====================================================

client.on(
  "interactionCreate",
  async interaction => {
    try {
      // =================================================
      // BUTTONS
      // =================================================

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
            interaction.user.id !==
            ownerUserId
          ) {
            return interaction.reply({
              content:
                "❌ This search isn't yours.",
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
                "❌ Search expired. Use `.find` again.",
              ephemeral: true
            });
          }

          let newPage =
            direction === "next"
              ? currentPage + 1
              : currentPage - 1;

          const totalPages =
            Math.max(
              1,
              Math.ceil(
                session.results.length / 8
              )
            );

          newPage = Math.max(
            1,
            Math.min(
              newPage,
              totalPages
            )
          );

          searchSessions.set(
            interaction.message.id,
            {
              ...session,
              page: newPage
            }
          );

          return interaction.update(
            buildSearchPage(
              ownerUserId,
              session.results,
              newPage
            )
          );
        }

        return;
      }

      // =================================================
      // SLASH COMMANDS
      // =================================================

      if (!interaction.isChatInputCommand()) {
        return;
      }

      // =================================================
      // MAKE SURE COMMAND IS IN THE CORRECT GUILD
      // =================================================

      if (
        interaction.guildId &&
        interaction.guildId !== GUILD_ID
      ) {
        return interaction.reply({
          content:
            "❌ This bot is configured for its main server only.",
          ephemeral: true
        });
      }

      // =================================================
      // /serverlist
      // =================================================

      if (
        interaction.commandName ===
        "serverlist"
      ) {
        if (
          !isOwner(
            interaction.user.id
          )
        ) {
          return interaction.reply({
            content:
              "❌ Owner Only.",
            ephemeral: true
          });
        }

        await interaction.deferReply({
          ephemeral: true
        });

        const guilds = [
          ...client.guilds.cache.values()
        ];

        let text =
          `**📋 Bot Servers (${guilds.length})**\n\n`;

        for (
          let i = 0;
          i < guilds.length;
          i++
        ) {
          const guild = guilds[i];

          text +=
            `${i + 1}. **${guild.name}**\n` +
            `ID: \`${guild.id}\`\n\n`;

          if (text.length > 3800) {
            text +=
              "... *(list truncated)*";
            break;
          }
        }

        return interaction.editReply({
          content: text
        });
      }

      // =================================================
      // /leave
      // =================================================

      if (
        interaction.commandName ===
        "leave"
      ) {
        if (
          !isOwner(
            interaction.user.id
          )
        ) {
          return interaction.reply({
            content:
              "❌ Owner Only.",
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

        const guildName =
          guild.name;

        try {
          await guild.leave();

          return interaction.reply({
            content:
              `✅ Left **${guildName}**`,
            ephemeral: true
          });
        } catch (error) {
          console.error(
            "Leave error:",
            error.message
          );

          return interaction.reply({
            content:
              "❌ Failed to leave the server.",
            ephemeral: true
          });
        }
      }

      // =================================================
      // /scanchannel
      // =================================================

      if (
        interaction.commandName ===
        "scanchannel"
      ) {
        if (
          !isOwner(
            interaction.user.id
          )
        ) {
          return interaction.reply({
            content:
              "❌ Owner Only.",
            ephemeral: true
          });
        }

        const channel =
          interaction.options.getChannel(
            "channel"
          );

        if (
          !channel ||
          !channel.isTextBased()
        ) {
          return interaction.reply({
            content:
              "❌ Invalid text channel.",
            ephemeral: true
          });
        }

        // ACKNOWLEDGE IMMEDIATELY
        await interaction.deferReply();

        try {
          await interaction.editReply({
            content:
              `🔎 **SCANNING CHANNEL...**\n` +
              `📁 Channel: <#${channel.id}>\n` +
              `⏳ Reading messages...`
          });

          const result =
            await scanChannel(
              channel,
              async scanned => {
                try {
                  await interaction.editReply({
                    content:
                      `🔎 **SCANNING CHANNEL...**\n` +
                      `📁 Channel: <#${channel.id}>\n` +
                      `📨 Messages scanned: **${scanned}**`
                  });
                } catch {}
              }
            );

          return interaction.editReply({
            content:
              `✅ **SCAN COMPLETE**\n\n` +
              `📁 **Channel:** <#${channel.id}>\n` +
              `📨 **Scanned:** ${result.scanned}\n` +
              `✅ **Added:** ${result.added}\n` +
              `⏭️ **Skipped:** ${result.skipped}\n` +
              `📚 **Total:** ${result.total}`
          });
        } catch (error) {
          console.error(
            "❌ Scan error:",
            error
          );

          return interaction.editReply({
            content:
              `❌ **SCAN FAILED**\n` +
              `Reason: \`${String(
                error.message ||
                error
              ).slice(0, 500)}\``
          });
        }
      }

      // =================================================
      // /forwardall
      // =================================================

      if (
        interaction.commandName ===
        "forwardall"
      ) {
        if (
          !isOwner(
            interaction.user.id
          )
        ) {
          return interaction.reply({
            content:
              "❌ Owner Only.",
            ephemeral: true
          });
        }

        const sourceId =
          interaction.options
            .getString(
              "source_channel_id"
            )
            .trim();

        const destinationId =
          interaction.options
            .getString(
              "destination_channel_id"
            )
            .trim();

        await interaction.deferReply();

        try {
          const sourceChannel =
            await fetchChannelById(
              sourceId
            );

          if (
            !sourceChannel ||
            !sourceChannel.isTextBased()
          ) {
            return interaction.editReply({
              content:
                `❌ Invalid source channel: \`${sourceId}\``
            });
          }

          const destinationChannel =
            await fetchChannelById(
              destinationId
            );

          if (
            !destinationChannel ||
            !destinationChannel.isTextBased()
          ) {
            return interaction.editReply({
              content:
                `❌ Invalid destination channel: \`${destinationId}\``
            });
          }

          await interaction.editReply({
            content:
              `🔄 **STARTING FORWARD**\n` +
              `From: <#${sourceId}>\n` +
              `To: <#${destinationId}>\n\n` +
              `🔎 Scanning for .txt files...`
          });

          const {
            files: txtFiles,
            scanned
          } = await scanTxtFiles(
            sourceChannel
          );

          if (txtFiles.length === 0) {
            return interaction.editReply({
              content:
                `❌ No .txt files found.\n` +
                `📨 Scanned: **${scanned}** messages.`
            });
          }

          let sent = 0;
          let failed = 0;

          const total =
            txtFiles.length;

          // Discord itself handles rate limits.
          // Small batches avoid overwhelming the API.
          const BATCH_SIZE = 5;

          for (
            let i = 0;
            i < total;
            i += BATCH_SIZE
          ) {
            const batch =
              txtFiles.slice(
                i,
                i + BATCH_SIZE
              );

            const results =
              await Promise.allSettled(
                batch.map(async file => {
                  try {
                    await destinationChannel.send(
                      {
                        files: [
                          {
                            attachment:
                              file.url,
                            name:
                              file.name
                          }
                        ]
                      }
                    );

                    return true;
                  } catch {
                    return false;
                  }
                })
              );

            for (const result of results) {
              if (
                result.status ===
                  "fulfilled" &&
                result.value === true
              ) {
                sent++;
              } else {
                failed++;
              }
            }

            await interaction.editReply({
              content:
                `🔄 **FORWARDING...**\n` +
                `⚡ Progress: **${sent}/${total}**\n` +
                `From: <#${sourceId}>\n` +
                `To: <#${destinationId}>`
            });
          }

          return interaction.editReply({
            content:
              `✅ **FORWARD COMPLETE**\n\n` +
              `📁 **Source:** <#${sourceId}>\n` +
              `📤 **Destination:** <#${destinationId}>\n` +
              `📨 **Scanned:** ${scanned}\n` +
              `📄 **Files Found:** ${total}\n` +
              `✅ **Sent:** ${sent}\n` +
              `❌ **Failed:** ${failed}`
          });
        } catch (error) {
          console.error(
            "❌ Forward error:",
            error
          );

          return interaction.editReply({
            content:
              `❌ **FORWARD FAILED**\n` +
              `Reason: \`${String(
                error.message ||
                error
              ).slice(0, 500)}\``
          });
        }
      }

      // =================================================
      // /setchannel
      // =================================================

      if (
        interaction.commandName ===
        "setchannel"
      ) {
        if (
          !isOwner(
            interaction.user.id
          )
        ) {
          return interaction.reply({
            content:
              "❌ Owner Only.",
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

      // =================================================
      // /embed
      // =================================================

      if (
        interaction.commandName ===
        "embed"
      ) {
        if (
          !hasManageMessages(
            interaction
          ) &&
          !isOwner(
            interaction.user.id
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

        await interaction.deferReply({
          ephemeral: true
        });

        await interaction.deleteReply();

        return interaction.channel.send({
          embeds: [embed]
        });
      }
    } catch (error) {
      console.error(
        "❌ Interaction error:",
        error
      );

      // Try to answer if Discord still allows it
      try {
        if (interaction.deferred) {
          await interaction.editReply({
            content:
              "❌ Something went wrong while processing that command."
          });
        } else if (!interaction.replied) {
          await interaction.reply({
            content:
              "❌ Something went wrong while processing that command.",
            ephemeral: true
          });
        }
      } catch {}
    }
  }
);

// =====================================================
// PREFIX COMMANDS
// =====================================================

client.on(
  "messageCreate",
  async message => {
    try {
      if (message.author.bot) {
        return;
      }

      if (!isAllowedPrefixUser(message)) {
        return;
      }

      const content =
        message.content.trim();

      // =================================================
      // .find
      // =================================================

      if (
        content === ".find" ||
        content.startsWith(".find ")
      ) {
        const query =
          content
            .slice(5)
            .trim();

        if (!query) {
          return message.reply(
            "❌ enter a filename to search."
          );
        }

        const results =
          searchFiles(query);

        if (results.length === 0) {
          return message.reply(
            "❌ no matching file found."
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

      // =================================================
      // .get
      // =================================================

      if (
        content === ".get" ||
        content.startsWith(".get ")
      ) {
        const id =
          content
            .slice(4)
            .trim();

        if (!id) {
          return message.reply(
            "❌ put the file id."
          );
        }

        const file =
          getFileById(id);

        if (!file) {
          return message.reply(
            "❌ file id not found."
          );
        }

        if (
          file.isLocal &&
          fs.existsSync(file.url)
        ) {
          await message.channel.send({
            content:
              `<@${message.author.id}> Here is the file!`,
            files: [
              {
                attachment:
                  file.url,
                name:
                  file.name
              }
            ]
          });

          return;
        }

        await message.channel.send({
          content:
            `<@${message.author.id}> Here is the file!`,
          files: [
            {
              attachment:
                file.url,
              name:
                file.name
            }
          ]
        });
      }
    } catch (error) {
      console.error(
        "❌ Prefix command error:",
        error
      );

      try {
        await message.reply(
          "❌ Something went wrong while processing that command."
        );
      } catch {}
    }
  }
);

// =====================================================
// LOGIN
// =====================================================

console.log("========================================");
console.log("🚀 FS BOT STARTING");
console.log("========================================");
console.log(
  `📌 Client ID: ${CLIENT_ID}`
);
console.log(
  `📌 Guild ID: ${GUILD_ID}`
);
console.log(
  `👑 Owner ID: ${OWNER_ID}`
);
console.log(
  `📚 Library: ${libraryFiles.length}`
);
console.log("========================================");
console.log(
  "🔑 Connecting to Discord gateway..."
);
console.log("========================================");

client
  .login(TOKEN)
  .then(() => {
    console.log(
      "🟢 Discord login request completed."
    );
  })
  .catch(error => {
    console.error(
      "========================================"
    );
    console.error(
      "❌ DISCORD LOGIN FAILED"
    );
    console.error(
      "========================================"
    );
    console.error(
      error?.message || error
    );
    console.error(
      "========================================"
    );
    process.exit(1);
  });
