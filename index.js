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

// =========================
// CONFIG
// =========================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const OWNER_ID = "1302080645987569694";

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID");
  process.exit(1);
}

// =========================
// EXPRESS
// =========================
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.status(200).send("FS Bot Online");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    online: client?.isReady?.() || false,
    uptime: process.uptime()
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server listening on port ${PORT}`);
});

// =========================
// DATA
// =========================
const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;

const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

function ensureFile(file, defaultData) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
    }
  } catch (err) {
    console.error(`❌ Failed creating ${file}:`, err.message);
  }
}

ensureFile(LIBRARY_FILE, { files: [] });
ensureFile(CONFIG_FILE, { allowedChannelId: null });

// =========================
// HELPERS
// =========================
function normalizeFilename(name) {
  return String(name || "").trim().toLowerCase();
}

function generateId() {
  return Math.random().toString(36).substring(2, 8);
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      return {
        allowedChannelId: data.allowedChannelId || null
      };
    }
  } catch (err) {
    console.error("❌ Config load error:", err.message);
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
    console.error("❌ Library load error:", err.message);
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
  } catch (err) {
    console.error("❌ Library save error:", err.message);
  }
}

const config = loadConfig();
const library = loadLibrary();
const libraryFiles = library.files;

saveLibrary();

// =========================
// FILE HELPERS
// =========================
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

// =========================
// OWNER CHECK
// =========================
function isOwner(userId) {
  return userId === OWNER_ID;
}

function hasManageMessages(interaction) {
  return interaction.member?.permissions?.has(
    PermissionFlagsBits.ManageMessages
  );
}

function isAllowedPrefixUser(message) {
  const userId = message.author.id;

  if (isOwner(userId)) {
    return true;
  }

  if (
    config.allowedChannelId &&
    message.channel.id !== config.allowedChannelId
  ) {
    return false;
  }

  return true;
}

// =========================
// LIBRARY HELPERS
// =========================
function fileExistsByName(name) {
  const normalized = normalizeFilename(name);

  return libraryFiles.some(
    file => normalizeFilename(file.name) === normalized
  );
}

function getFileById(id) {
  return libraryFiles.find(
    file => file.id === id
  );
}

// =========================
// SMART SEARCH
// =========================
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

    // Every word
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

// =========================
// CHANNEL FETCH
// =========================
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

// =========================
// SCAN TXT FILES
// =========================
async function scanTxtFiles(channel) {
  if (!channel?.isTextBased?.()) {
    return {
      files: [],
      scanned: 0
    };
  }

  const foundFiles = [];

  let before = undefined;
  let scanned = 0;

  while (true) {
    let batch;

    try {
      const options = {
        limit: 100
      };

      if (before) {
        options.before = before;
      }

      batch = await channel.messages.fetch(options);
    } catch (err) {
      console.error(
        `❌ Failed scanning messages:`,
        err.message
      );

      break;
    }

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
          size: attachment.size
        });
      }

      // Message snapshots
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
  }

  return {
    files: foundFiles,
    scanned
  };
}

// =========================
// SCAN CHANNEL
// =========================
async function scanChannel(channel) {
  if (!channel?.isTextBased?.()) {
    return {
      added: 0,
      skipped: 0,
      total: libraryFiles.length,
      scanned: 0
    };
  }

  const foundFiles = [];

  let before = undefined;
  let scanned = 0;

  while (true) {
    let batch;

    try {
      const options = {
        limit: 100
      };

      if (before) {
        options.before = before;
      }

      batch = await channel.messages.fetch(options);
    } catch (err) {
      console.error(
        `❌ Scan error in #${channel.id}:`,
        err.message
      );

      break;
    }

    if (!batch || batch.size === 0) {
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

      // Message snapshots
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
      }
    }

    before = batch.last()?.id;

    if (!before || batch.size < 100) {
      break;
    }
  }

  // Existing library stays.
  // New files with the same filename are skipped.
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
        timestamp: file.timestamp
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

// =========================
// SEARCH PAGINATION
// =========================
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
    "No results.";

  const embed = new EmbedBuilder()
    .setTitle("Finder Source Results")
    .setColor(0x808080)
    .setDescription(description)
    .setFooter({
      text:
        `Page ${safePage}/${totalPages} │ ` +
        `Today at ${getTimePH()}`
    });

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(
          `search_back_${ownerUserId}_${safePage}`
        )
        .setLabel("Back")
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

// =========================
// CLIENT
// =========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// =========================
// SLASH COMMANDS
// =========================
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
        .setDescription(
          "Channel to scan"
        )
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
          "Source Channel ID"
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("destination_channel_id")
        .setDescription(
          "Destination Channel ID"
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription(
      "Send a gray embed (Manage Messages)"
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
      "List all servers (Owner Only)"
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
          "Server ID to leave"
        )
        .setRequired(true)
    )
].map(command => command.toJSON());

// =========================
// REGISTER COMMANDS
// =========================
async function registerCommands() {
  try {
    const rest = new REST({
      version: "10"
    }).setToken(TOKEN);

    console.log("🔄 Registering slash commands...");

    // Global commands
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: commands
      }
    );

    console.log(
      `✅ Registered ${commands.length} slash commands`
    );
  } catch (err) {
    console.error(
      "❌ Command registration failed:",
      err.message
    );
  }
}

// =========================
// READY
// =========================
client.once("ready", async () => {
  console.log(
    `✅ Logged in as ${client.user.tag}`
  );

  console.log(
    `🆔 Bot ID: ${client.user.id}`
  );

  console.log(
    `📚 Library: ${libraryFiles.length} files`
  );

  console.log(
    `👑 Owner ID: ${OWNER_ID}`
  );

  // NO WATCHING STATUS
  client.user.setPresence({
    activities: [],
    status: "online"
  });

  await registerCommands();
});

// =========================
// INTERACTIONS
// =========================
client.on(
  "interactionCreate",
  async interaction => {
    try {
      // =========================
      // BUTTONS
      // =========================
      if (interaction.isButton()) {
        const customId =
          interaction.customId;

        if (
          customId.startsWith(
            "search_back_"
          ) ||
          customId.startsWith(
            "search_next_"
          )
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

          // IMPORTANT:
          // Update immediately.
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

          return;
        }

        return;
      }

      // =========================
      // SLASH COMMANDS
      // =========================
      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      const command =
        interaction.commandName;

      console.log(
        `📥 /${command} by ${interaction.user.tag} (${interaction.user.id})`
      );

      // =========================
      // OWNER COMMANDS
      // =========================
      const ownerCommands = [
        "setchannel",
        "scanchannel",
        "forwardall",
        "serverlist",
        "leave"
      ];

      if (
        ownerCommands.includes(command) &&
        interaction.user.id !== OWNER_ID
      ) {
        return interaction.reply({
          content:
            "❌ **Owner Only.**",
          ephemeral: true
        });
      }

      // =========================
      // /serverlist
      // =========================
      if (command === "serverlist") {
        await interaction.deferReply({
          ephemeral: true
        });

        const guilds = [
          ...client.guilds.cache.values()
        ];

        let list =
          `**📋 Servers (${guilds.length})**\n\n`;

        for (
          let i = 0;
          i < guilds.length;
          i++
        ) {
          const guild = guilds[i];

          list +=
            `${i + 1}. **${guild.name}**\n` +
            `ID: \`${guild.id}\`\n\n`;

          if (list.length > 3800) {
            list += "... (truncated)";
            break;
          }
        }

        return interaction.editReply({
          content: list
        });
      }

      // =========================
      // /leave
      // =========================
      if (command === "leave") {
        const serverId =
          interaction.options.getString(
            "server-id"
          )?.trim();

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

        await interaction.deferReply({
          ephemeral: true
        });

        const guildName =
          guild.name;

        try {
          await guild.leave();

          return interaction.editReply({
            content:
              `✅ Left **${guildName}**`
          });
        } catch (err) {
          console.error(
            "Leave error:",
            err.message
          );

          return interaction.editReply({
            content:
              "❌ Failed to leave the server."
          });
        }
      }

      // =========================
      // /setchannel
      // =========================
      if (command === "setchannel") {
        config.allowedChannelId =
          interaction.channelId;

        saveConfig();

        return interaction.reply({
          content:
            `✅ **Channel Set!**\n` +
            `🔗 Allowed: <#${interaction.channelId}>`
        });
      }

      // =========================
      // /scanchannel
      // =========================
      if (command === "scanchannel") {
        const channel =
          interaction.options.getChannel(
            "channel"
          );

        if (
          !channel ||
          !channel.isTextBased?.()
        ) {
          return interaction.reply({
            content:
              "❌ That is not a text channel.",
            ephemeral: true
          });
        }

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

      // =========================
      // /forwardall
      // =========================
      if (command === "forwardall") {
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
          !sourceChannel.isTextBased?.()
        ) {
          return interaction.editReply({
            content:
              `❌ **Invalid Source Channel:** ${sourceId}`
          });
        }

        const destinationChannel =
          await fetchChannelById(
            destinationId
          );

        if (
          !destinationChannel ||
          !destinationChannel.isTextBased?.()
        ) {
          return interaction.editReply({
            content:
              `❌ **Invalid Destination Channel:** ${destinationId}`
          });
        }

        await interaction.editReply({
          content:
            `🔄 **Starting FULL COPY of .txt files**\n` +
            `From: <#${sourceId}>\n` +
            `To: <#${destinationId}>\n` +
            `⚡ **Speed Mode: MAX**`
        });

        const scan =
          await scanTxtFiles(
            sourceChannel
          );

        const txtFiles =
          scan.files;

        if (txtFiles.length === 0) {
          return interaction.editReply({
            content:
              `❌ No .txt files found in <#${sourceId}>\n` +
              `Scanned ${scan.scanned} messages.`
          });
        }

        let sent = 0;
        let failed = 0;

        const total =
          txtFiles.length;

        // Discord can rate-limit if this is
        // pushed too aggressively.
        // 5 concurrent sends is fast but safer.
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
                await destinationChannel.send({
                  files: [
                    {
                      attachment:
                        file.url,
                      name:
                        file.name
                    }
                  ]
                });

                return true;
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

          // Update only every batch.
          // Prevents excessive interaction edits.
          if (
            i + BATCH_SIZE >= total ||
            sent % 25 === 0
          ) {
            try {
              await interaction.editReply({
                content:
                  `🔄 **Forwarding...** ⚡ ${sent}/${total}\n` +
                  `From: <#${sourceId}> → <#${destinationId}>`
              });
            } catch {}
          }
        }

        return interaction.editReply({
          content:
            `✅ **FORWARD COMPLETE — MAX SPEED** ⚡\n` +
            `**Channel:** <#${sourceId}>\n` +
            `**Scanned:** ${scan.scanned}\n` +
            `**Files Found:** ${total}\n` +
            `✅ **Sent:** ${sent}\n` +
            `❌ **Failed:** ${failed}\n` +
            `📤 **Destination:** <#${destinationId}>`
        });
      }

      // =========================
      // /embed
      // =========================
      if (command === "embed") {
        if (!hasManageMessages(interaction)) {
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

        // Don't defer first.
        // This avoids unnecessary interaction
        // acknowledgement problems.
        await interaction.reply({
          content:
            "✅ Embed sent.",
          ephemeral: true
        });

        try {
          await interaction.channel.send({
            embeds: [embed]
          });
        } catch (err) {
          console.error(
            "❌ Embed send error:",
            err.message
          );
        }

        return;
      }

    } catch (err) {
      console.error(
        "❌ Interaction error:",
        err
      );

      // Prevent "Unknown interaction"
      // / double-reply crashes.
      try {
        if (
          interaction.isRepliable() &&
          !interaction.replied &&
          !interaction.deferred
        ) {
          await interaction.reply({
            content:
              "❌ Something went wrong. Try again.",
            ephemeral: true
          });
        } else if (
          interaction.deferred
        ) {
          await interaction.editReply({
            content:
              "❌ Something went wrong. Try again."
          });
        }
      } catch (replyError) {
        console.error(
          "❌ Error sending error response:",
          replyError.message
        );
      }
    }
  }
);

// =========================
// PREFIX COMMANDS
// =========================
client.on(
  "messageCreate",
  async message => {
    try {
      if (message.author.bot) {
        return;
      }

      const content =
        message.content.trim();

      // =========================
      // .find
      // =========================
      if (
        content === ".find" ||
        content.startsWith(".find ")
      ) {
        if (
          !isAllowedPrefixUser(message)
        ) {
          return;
        }

        const query =
          content
            .slice(5)
            .trim();

        if (!query) {
          return message.reply(
            "❌ no match file for that, idiot."
          );
        }

        const results =
          searchFiles(query);

        if (results.length === 0) {
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

        const replyMsg =
          await message.reply(
            replyData
          );

        searchSessions.set(
          replyMsg.id,
          {
            userId:
              message.author.id,
            results,
            page: 1
          }
        );

        return;
      }

      // =========================
      // .get
      // =========================
      if (
        content === ".get" ||
        content.startsWith(".get ")
      ) {
        if (
          !isAllowedPrefixUser(message)
        ) {
          return;
        }

        const id =
          content
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

        try {
          await message.channel.send({
            content:
              `<@${message.author.id}> Here is the file twin!`,
            files: [
              {
                attachment:
                  file.url,
                name:
                  file.name
              }
            ]
          });
        } catch (err) {
          console.error(
            "❌ .get send error:",
            err.message
          );

          await message.reply(
            "❌ Failed to send that file."
          );
        }

        return;
      }

    } catch (err) {
      console.error(
        "❌ messageCreate error:",
        err
      );
    }
  }
);

// =========================
// CLIENT ERRORS
// =========================
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
  "shardError",
  error => {
    console.error(
      "❌ Discord shard error:",
      error
    );
  }
);

client.on(
  "shardDisconnect",
  (event, shardId) => {
    console.log(
      `⚠️ Shard ${shardId} disconnected.`,
      event?.code || ""
    );
  }
);

client.on(
  "shardReconnecting",
  shardId => {
    console.log(
      `🔄 Shard ${shardId} reconnecting...`
    );
  }
);

// =========================
// PROCESS ERRORS
// =========================
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

// =========================
// LOGIN
// =========================
console.log("🔑 Logging into Discord...");

client
  .login(TOKEN)
  .then(() => {
    console.log(
      "🔐 Discord login successful."
    );
  })
  .catch(error => {
    console.error(
      "❌ Discord login failed:",
      error
    );

    process.exit(1);
  });
