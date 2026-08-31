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

// ======================================================
// CONFIG
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const OWNER_ID = "1302080645987569694";
const SCAN_ROLE_ID = "1509953862226935948";

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID is missing.");
  process.exit(1);
}

if (!GUILD_ID) {
  console.error("❌ GUILD_ID is missing.");
  console.error("👉 Add your Discord server ID to Render Environment Variables.");
  process.exit(1);
}

console.log("========================================");
console.log("🚀 FS BOT STARTING");
console.log("========================================");
console.log(`📌 Client ID: ${CLIENT_ID}`);
console.log(`📌 Guild ID: ${GUILD_ID}`);
console.log(`👑 Owner ID: ${OWNER_ID}`);
console.log("========================================");

// ======================================================
// EXPRESS SERVER
// ======================================================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.status(200).send("FS Bot Online");
});

app.get("/health", (req, res) => {
  const online = client.isReady();

  res.status(online ? 200 : 503).json({
    discord: online ? "online" : "offline",
    bot: online ? client.user.tag : null,
    guild: GUILD_ID
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server listening on port ${PORT}`);
});

// ======================================================
// DATA
// ======================================================

const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;

const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

function ensureFile(file, defaultValue) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        file,
        JSON.stringify(defaultValue, null, 2),
        "utf8"
      );
    }
  } catch (err) {
    console.error(`❌ Failed creating ${file}:`, err.message);
  }
}

ensureFile(LIBRARY_FILE, { files: [] });
ensureFile(CONFIG_FILE, { allowedChannelId: null });

// ======================================================
// HELPERS
// ======================================================

function normalizeFilename(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function generateId() {
  return Math.random()
    .toString(36)
    .substring(2, 10);
}

function loadConfig() {
  try {
    const data = JSON.parse(
      fs.readFileSync(CONFIG_FILE, "utf8")
    );

    return {
      allowedChannelId: data.allowedChannelId || null
    };
  } catch (err) {
    console.error("⚠️ Config load failed:", err.message);
    return {
      allowedChannelId: null
    };
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(config, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("❌ Config save failed:", err.message);
  }
}

function loadLibrary() {
  try {
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
  } catch (err) {
    console.error("⚠️ Library load failed:", err.message);

    return {
      files: []
    };
  }
}

function saveLibrary() {
  try {
    fs.writeFileSync(
      LIBRARY_FILE,
      JSON.stringify(library, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("❌ Library save failed:", err.message);
  }
}

const config = loadConfig();
const library = loadLibrary();
const libraryFiles = library.files;

saveLibrary();

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
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
}

// ======================================================
// PERMISSIONS
// ======================================================

function isOwner(userId) {
  return userId === OWNER_ID;
}

function hasScanRole(member) {
  return !!member?.roles?.cache?.has(SCAN_ROLE_ID);
}

function hasPermission(interaction, type) {
  const userId = interaction.user.id;
  const member = interaction.member;

  if (userId === OWNER_ID) {
    return true;
  }

  switch (type) {
    case "owner_only":
      return userId === OWNER_ID;

    case "scan_role_or_owner":
      return (
        userId === OWNER_ID ||
        hasScanRole(member)
      );

    case "administrator":
      return !!member?.permissions?.has(
        PermissionFlagsBits.Administrator
      );

    case "manage_messages":
      return !!member?.permissions?.has(
        PermissionFlagsBits.ManageMessages
      );

    default:
      return false;
  }
}

// ======================================================
// FILE SEARCH
// ======================================================

function fileExistsByName(name) {
  const target = normalizeFilename(name);

  return libraryFiles.some(
    file => normalizeFilename(file.name) === target
  );
}

function getFileById(id) {
  return libraryFiles.find(
    file => file.id === id
  );
}

function searchFiles(query) {
  const q = String(query || "")
    .toLowerCase()
    .trim();

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

// ======================================================
// CHANNEL FETCH
// ======================================================

async function fetchChannelById(channelId) {
  if (!/^\d+$/.test(channelId)) {
    return null;
  }

  try {
    let channel = client.channels.cache.get(channelId);

    if (!channel) {
      channel = await client.channels.fetch(channelId);
    }

    return channel;
  } catch (err) {
    console.error(
      `❌ Failed fetching channel ${channelId}:`,
      err.message
    );

    return null;
  }
}

// ======================================================
// SCAN TXT FILES
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
      batch = await channel.messages.fetch(options);
    } catch (err) {
      console.error(
        "⚠️ Message fetch failed:",
        err.message
      );

      await new Promise(resolve =>
        setTimeout(resolve, 1000)
      );

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

          const attachments =
            typeof snapshot.attachments.values === "function"
              ? snapshot.attachments.values()
              : Array.isArray(snapshot.attachments)
                ? snapshot.attachments
                : [];

          for (const attachment of attachments) {
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
      }
    }

    before = batch.last()?.id;

    if (!before || batch.size < 100) {
      break;
    }

    await new Promise(resolve =>
      setTimeout(resolve, 50)
    );
  }

  return {
    files: foundFiles,
    scanned
  };
}

// ======================================================
// SCAN CHANNEL
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
      batch = await channel.messages.fetch(options);
    } catch (err) {
      console.error(
        "⚠️ Scan fetch failed:",
        err.message
      );

      await new Promise(resolve =>
        setTimeout(resolve, 1000)
      );

      continue;
    }

    if (!batch.size) {
      break;
    }

    scanned += batch.size;

    for (const msg of batch.values()) {
      for (const attachment of msg.attachments.values()) {
        if (
          !attachment.name ||
          isImageFile(attachment.name)
        ) {
          continue;
        }

        foundFiles.push({
          name: attachment.name,
          url: attachment.url,
          size: attachment.size,
          ts: msg.createdTimestamp
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

          const attachments =
            typeof snapshot.attachments.values === "function"
              ? snapshot.attachments.values()
              : Array.isArray(snapshot.attachments)
                ? snapshot.attachments
                : [];

          for (const attachment of attachments) {
            if (
              !attachment.name ||
              isImageFile(attachment.name)
            ) {
              continue;
            }

            foundFiles.push({
              name: attachment.name,
              url: attachment.url,
              size: attachment.size,
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

    await new Promise(resolve =>
      setTimeout(resolve, 50)
    );
  }

  // Keep existing library.
  // Same filename = already scanned.
  const unique = new Map();

  for (const file of libraryFiles) {
    unique.set(
      normalizeFilename(file.name),
      file
    );
  }

  let added = 0;
  let skipped = 0;

  for (const file of foundFiles) {
    const key = normalizeFilename(file.name);

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

  libraryFiles.length = 0;

  libraryFiles.push(
    ...[...unique.values()].sort(
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

  const desc = display
    .map(
      file =>
        `\`${file.name}\` │ ID: \`${file.id}\``
    )
    .join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Finder Source Results")
    .setColor(0x808080)
    .setDescription(
      desc || "No results."
    )
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

// ======================================================
// DISCORD CLIENT
// ======================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ======================================================
// SLASH COMMANDS
// ONE GUILD ONLY
// ======================================================

const commands = [
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription(
      "Set allowed channel (Owner Only)"
    ),

  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription(
      "Scan channel for files (Owner Only)"
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
      "Copy all .txt files (Owner Only)"
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
      "Send a gray embed (Manage Messages)"
    )
    .addStringOption(option =>
      option
        .setName("description")
        .setDescription(
          "Embed description"
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
      "List servers (Owner Only)"
    ),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription(
      "Leave a server (Owner Only)"
    )
    .addStringOption(option =>
      option
        .setName("server-id")
        .setDescription(
          "Server ID"
        )
        .setRequired(true)
    )
].map(command =>
  command.toJSON()
);

// ======================================================
// REGISTER GUILD COMMANDS
// ======================================================

async function registerCommands() {
  try {
    console.log("🔄 Registering guild commands...");

    const rest = new REST({
      version: "10"
    }).setToken(TOKEN);

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
      `✅ Commands registered to guild ${GUILD_ID}`
    );
  } catch (err) {
    console.error(
      "❌ Command registration failed:"
    );

    console.error(err);
  }
}

// ======================================================
// READY
// ======================================================

client.once("ready", async () => {
  console.log("");
  console.log("========================================");
  console.log(
    `✅ DISCORD ONLINE: ${client.user.tag}`
  );
  console.log(
    `🆔 Bot ID: ${client.user.id}`
  );
  console.log(
    `🏠 Guild count: ${client.guilds.cache.size}`
  );
  console.log(
    `📚 Library files: ${libraryFiles.length}`
  );
  console.log("========================================");
  console.log("");

  // NO WATCHING STATUS
  // No client.user.setPresence()

  const guild =
    client.guilds.cache.get(GUILD_ID);

  if (!guild) {
    console.error(
      "❌ BOT IS NOT IN THE GUILD_ID SERVER!"
    );
    console.error(
      `👉 Make sure the bot is invited to: ${GUILD_ID}`
    );
  } else {
    console.log(
      `✅ Connected to guild: ${guild.name}`
    );
  }

  await registerCommands();
});

// ======================================================
// DEBUG EVENTS
// ======================================================

client.on("debug", info => {
  if (
    info.includes("Heartbeat") ||
    info.includes("heartbeat")
  ) {
    return;
  }

  console.log(`🔧 Discord: ${info}`);
});

client.on("warn", warning => {
  console.warn(
    `⚠️ Discord warning: ${warning}`
  );
});

client.on("error", error => {
  console.error(
    "❌ Discord client error:",
    error
  );
});

client.on("shardError", error => {
  console.error(
    "❌ Discord shard error:",
    error
  );
});

client.on("shardDisconnect", (event, shardId) => {
  console.error(
    `🔴 Discord disconnected. Shard: ${shardId}`,
    event
  );
});

client.on("shardReconnecting", shardId => {
  console.log(
    `🔄 Discord reconnecting. Shard: ${shardId}`
  );
});

client.on("shardReady", shardId => {
  console.log(
    `🟢 Discord shard ready: ${shardId}`
  );
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
                "❌ This is not your search.",
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

          newPage = Math.min(
            Math.max(newPage, 1),
            totalPages
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

      // ==================================================
      // SLASH COMMANDS
      // ==================================================

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      // Only configured guild
      if (
        interaction.guildId !==
        GUILD_ID
      ) {
        return interaction.reply({
          content:
            "❌ This bot is configured for another server.",
          ephemeral: true
        }).catch(() => {});
      }

      // ==================================================
      // /SERVERLIST
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
          `**📋 Servers (${guilds.length})**\n\n`;

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
            text += "... truncated";
            break;
          }
        }

        return interaction.editReply({
          content: text
        });
      }

      // ==================================================
      // /LEAVE
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

        try {
          const name =
            guild.name;

          await guild.leave();

          return interaction.reply({
            content:
              `✅ Left **${name}**`,
            ephemeral: true
          });
        } catch (err) {
          console.error(
            "Leave error:",
            err
          );

          return interaction.reply({
            content:
              "❌ Failed to leave server.",
            ephemeral: true
          });
        }
      }

      // ==================================================
      // /SCANCHANNEL
      // ==================================================

      if (
        interaction.commandName ===
        "scanchannel"
      ) {
        if (
          !hasPermission(
            interaction,
            "owner_only"
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
      // /FORWARDALL
      // ==================================================

      if (
        interaction.commandName ===
        "forwardall"
      ) {
        if (
          !hasPermission(
            interaction,
            "owner_only"
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
            `🔄 **Starting FULL COPY**\n` +
            `From: <#${sourceId}>\n` +
            `To: <#${destinationId}>\n` +
            `⚡ Speed Mode: MAX`
        });

        const scan =
          await scanTxtFiles(
            sourceChannel
          );

        const txtFiles =
          scan.files;

        if (
          txtFiles.length === 0
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
          txtFiles.length;

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
                } catch (err) {
                  console.error(
                    `❌ Failed ${file.name}:`,
                    err.message
                  );

                  return false;
                }
              })
            );

          for (
            const result of results
          ) {
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

          // Update every batch.
          // Avoid hammering Discord with edits.
          if (
            i % (BATCH_SIZE * 2) === 0 ||
            i + BATCH_SIZE >= total
          ) {
            await interaction.editReply({
              content:
                `🔄 **Forwarding...** ⚡\n` +
                `**Progress:** ${sent}/${total}\n` +
                `From: <#${sourceId}>\n` +
                `To: <#${destinationId}>`
            }).catch(() => {});
          }
        }

        return interaction.editReply({
          content:
            `✅ **FORWARD COMPLETE** ⚡\n` +
            `**Scanned:** ${scan.scanned}\n` +
            `**Files Found:** ${total}\n` +
            `✅ **Sent:** ${sent}\n` +
            `❌ **Failed:** ${failed}\n` +
            `📤 **Destination:** <#${destinationId}>`
        });
      }

      // ==================================================
      // /SETCHANNEL
      // ==================================================

      if (
        interaction.commandName ===
        "setchannel"
      ) {
        if (
          !hasPermission(
            interaction,
            "owner_only"
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

      // ==================================================
      // /EMBED
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
            );

        if (title) {
          embed.setTitle(title);
        }

        embed.setFooter({
          text:
            `Today at ${getTimePH()}`
        });

        await interaction.deferReply({
          ephemeral: true
        });

        await interaction.deleteReply()
          .catch(() => {});

        return interaction.channel.send({
          embeds: [embed]
        });
      }

    } catch (error) {
      console.error(
        "❌ Interaction error:",
        error
      );

      // Prevent one broken interaction
      // from causing another failure.
      try {
        if (interaction.deferred) {
          await interaction.editReply({
            content:
              "❌ Something went wrong. Try again."
          });
        } else if (
          !interaction.replied
        ) {
          await interaction.reply({
            content:
              "❌ Something went wrong. Try again.",
            ephemeral: true
          });
        }
      } catch {}
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
      if (message.author.bot) {
        return;
      }

      const userId =
        message.author.id;

      const bypass =
        isOwner(userId) ||
        hasScanRole(message.member);

      const allowed =
        bypass ||
        !config.allowedChannelId ||
        message.channel.id ===
          config.allowedChannelId;

      // ================================================
      // .find
      // ================================================

      if (
        message.content === ".find" ||
        message.content.startsWith(".find ")
      ) {
        if (!allowed) {
          return message.reply(
            "❌ not here."
          );
        }

        const query =
          message.content
            .slice(5)
            .trim();

        if (!query) {
          return message.reply(
            "❌ enter a file name."
          );
        }

        const results =
          searchFiles(query);

        if (
          results.length === 0
        ) {
          return message.reply(
            "❌ no matching file."
          );
        }

        const replyData =
          buildSearchPage(
            userId,
            results,
            1
          );

        const replyMsg =
          await message.reply(
            replyData
          );

        searchSessions.set(
          replyMsg.id,
          {
            userId,
            results,
            page: 1
          }
        );

        return;
      }

      // ================================================
      // .get
      // ================================================

      if (
        message.content === ".get" ||
        message.content.startsWith(".get ")
      ) {
        if (!allowed) {
          return message.reply(
            "❌ not here."
          );
        }

        const id =
          message.content
            .slice(4)
            .trim();

        if (!id) {
          return message.reply(
            "❌ enter the file ID."
          );
        }

        const file =
          getFileById(id);

        if (!file) {
          return message.reply(
            "❌ file not found."
          );
        }

        // Local library file
        if (
          file.isLocal &&
          fs.existsSync(file.url)
        ) {
          await message.channel.send({
            content:
              `<@${userId}> Here is the file:`,
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

        // Discord attachment URL
        await message.channel.send({
          content:
            `<@${userId}> Here is the file:`,
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

    } catch (error) {
      console.error(
        "❌ messageCreate error:",
        error
      );

      try {
        await message.reply(
          "❌ Something went wrong. Try again."
        );
      } catch {}
    }
  }
);

// ======================================================
// CLEAN OLD SEARCH SESSIONS
// ======================================================

setInterval(() => {
  if (searchSessions.size <= 500) {
    return;
  }

  const entries =
    [...searchSessions.entries()];

  for (
    let i = 0;
    i < entries.length - 250;
    i++
  ) {
    searchSessions.delete(
      entries[i][0]
    );
  }
}, 60_000);

// ======================================================
// PROCESS ERROR HANDLING
// ======================================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ UNHANDLED REJECTION:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ UNCAUGHT EXCEPTION:",
      error
    );
  }
);

// ======================================================
// LOGIN
// ======================================================

console.log("🔑 Connecting to Discord gateway...");

client.login(TOKEN)
  .then(() => {
    console.log(
      "🔌 Discord login request completed."
    );
  })
  .catch(error => {
    console.error(
      "❌ DISCORD LOGIN FAILED:"
    );

    console.error(error);

    process.exit(1);
  });
