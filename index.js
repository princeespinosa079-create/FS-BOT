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

// ======================================================
// CONFIG
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const OWNER_ID = "1302080645987569694";

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing from Render Environment Variables.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID is missing from Render Environment Variables.");
  process.exit(1);
}

// ======================================================
// EXPRESS / RENDER KEEP-ALIVE
// ======================================================

const app = express();

const PORT = Number(process.env.PORT) || 3000;

app.get("/", (req, res) => {
  res.status(200).send("FS Bot Online");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    discordReady: client.isReady(),
    uptime: process.uptime(),
    guilds: client.isReady() ? client.guilds.cache.size : 0
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server listening on port ${PORT}`);
});

// ======================================================
// DATA
// ======================================================

const DATA_DIR = fs.existsSync("/data")
  ? "/data"
  : __dirname;

const LIBRARY_FILE = path.join(
  DATA_DIR,
  "file-library.json"
);

const CONFIG_FILE = path.join(
  DATA_DIR,
  "config.json"
);

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(
        fs.readFileSync(CONFIG_FILE, "utf8")
      );

      return {
        allowedChannelId:
          data.allowedChannelId || null
      };
    }
  } catch (error) {
    console.error(
      "❌ Config load error:",
      error.message
    );
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
    console.error(
      "❌ Config save error:",
      error.message
    );
  }
}

function generateId() {
  return Math.random()
    .toString(36)
    .substring(2, 8);
}

function loadLibrary() {
  try {
    if (fs.existsSync(LIBRARY_FILE)) {
      const data = JSON.parse(
        fs.readFileSync(
          LIBRARY_FILE,
          "utf8"
        )
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
    console.error(
      "❌ Library load error:",
      error.message
    );
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
    console.error(
      "❌ Library save error:",
      error.message
    );
  }
}

const config = loadConfig();
const library = loadLibrary();
const libraryFiles = library.files;

// Make sure files exist.
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

function normalizeFilename(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

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

function getTimePH() {
  return new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "Asia/Manila",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }
  ).format(new Date());
}

// ======================================================
// OWNER
// ======================================================

function isOwner(userId) {
  return userId === OWNER_ID;
}

const OWNER_COMMANDS = [
  "forwardall",
  "scanchannel",
  "setchannel",
  "serverlist",
  "leave"
];

// ======================================================
// LIBRARY
// ======================================================

function fileExistsByName(name) {
  const normalized =
    normalizeFilename(name);

  return libraryFiles.some(
    file =>
      normalizeFilename(file.name) ===
      normalized
  );
}

function getFileById(id) {
  return libraryFiles.find(
    file => file.id === id
  );
}

// ======================================================
// SMART SEARCH
// ======================================================

function searchFiles(query) {
  const q = String(query || "")
    .toLowerCase()
    .trim();

  if (!q || libraryFiles.length === 0) {
    return [];
  }

  const qWords = q.split(/\s+/);

  const qNoSpecial =
    q.replace(/[^a-z0-9]/g, "");

  const exactMatches = [];
  const allWordsMatches = [];
  const anyWordMatches = [];

  for (const file of libraryFiles) {
    const name =
      normalizeFilename(file.name);

    const nameNoSpecial =
      name.replace(
        /[^a-z0-9]/g,
        ""
      );

    // Exact match
    if (
      name === q ||
      nameNoSpecial === qNoSpecial ||
      name.startsWith(q + ".") ||
      nameNoSpecial.startsWith(
        qNoSpecial + "."
      )
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

    if (
      allWords &&
      qWords.length > 1
    ) {
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
    let channel =
      client.channels.cache.get(
        channelId
      );

    if (!channel) {
      channel =
        await client.channels.fetch(
          channelId
        );
    }

    return channel;
  } catch (error) {
    console.error(
      `❌ Channel fetch failed ${channelId}:`,
      error.message
    );

    return null;
  }
}

// ======================================================
// SCAN TXT FILES
// ======================================================

async function scanTxtFiles(channel) {
  if (!channel?.isTextBased?.()) {
    return {
      files: [],
      scanned: 0
    };
  }

  const foundFiles = [];

  let before = null;
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

      batch =
        await channel.messages.fetch(
          options
        );
    } catch (error) {
      console.error(
        "❌ TXT scan error:",
        error.message
      );

      break;
    }

    if (!batch || batch.size === 0) {
      break;
    }

    scanned += batch.size;

    for (const message of batch.values()) {
      for (
        const attachment
        of message.attachments.values()
      ) {
        if (
          !isTxtFile(
            attachment.name
          )
        ) {
          continue;
        }

        foundFiles.push({
          name: attachment.name,
          url: attachment.url,
          size: attachment.size
        });
      }

      // Message snapshots
      if (message.messageSnapshots) {
        const snapshots =
          Array.isArray(
            message.messageSnapshots
          )
            ? message.messageSnapshots
            : [
                ...(
                  message
                    .messageSnapshots
                    .values?.() || []
                )
              ];

        for (
          const snapshot of snapshots
        ) {
          if (!snapshot?.attachments) {
            continue;
          }

          const attachments =
            typeof snapshot.attachments.values ===
            "function"
              ? snapshot.attachments.values()
              : Array.isArray(
                    snapshot.attachments
                )
                ? snapshot.attachments
                : [];

          for (
            const attachment
            of attachments
          ) {
            if (
              !isTxtFile(
                attachment.name
              )
            ) {
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

    before =
      batch.last()?.id || null;

    if (
      !before ||
      batch.size < 100
    ) {
      break;
    }
  }

  return {
    files: foundFiles,
    scanned
  };
}

// ======================================================
// FULL CHANNEL SCAN
// ======================================================

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

  let before = null;
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

      batch =
        await channel.messages.fetch(
          options
        );
    } catch (error) {
      console.error(
        "❌ Channel scan error:",
        error.message
      );

      break;
    }

    if (!batch || batch.size === 0) {
      break;
    }

    scanned += batch.size;

    for (const message of batch.values()) {
      for (
        const attachment
        of message.attachments.values()
      ) {
        if (
          !attachment.name ||
          isImageFile(
            attachment.name
          )
        ) {
          continue;
        }

        foundFiles.push({
          name: attachment.name,
          url: attachment.url,
          size: attachment.size,
          timestamp:
            message.createdTimestamp
        });
      }

      if (message.messageSnapshots) {
        const snapshots =
          Array.isArray(
            message.messageSnapshots
          )
            ? message.messageSnapshots
            : [
                ...(
                  message
                    .messageSnapshots
                    .values?.() || []
                )
              ];

        for (
          const snapshot of snapshots
        ) {
          if (!snapshot?.attachments) {
            continue;
          }

          const attachments =
            typeof snapshot.attachments.values ===
            "function"
              ? snapshot.attachments.values()
              : Array.isArray(
                    snapshot.attachments
                )
                ? snapshot.attachments
                : [];

          for (
            const attachment
            of attachments
          ) {
            if (
              !attachment.name ||
              isImageFile(
                attachment.name
              )
            ) {
              continue;
            }

            foundFiles.push({
              name: attachment.name,
              url: attachment.url,
              size: attachment.size,
              timestamp:
                message.createdTimestamp
            });
          }
        }
      }
    }

    before =
      batch.last()?.id || null;

    if (
      !before ||
      batch.size < 100
    ) {
      break;
    }
  }

  // IMPORTANT:
  // Existing library is preserved.
  // Duplicate names are NOT added.
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
    const key =
      normalizeFilename(file.name);

    if (!unique.has(key)) {
      unique.set(key, {
        id: generateId(),
        name: file.name,
        url: file.url,
        size: file.size,
        timestamp:
          file.timestamp
      });

      added++;
    } else {
      skipped++;
    }
  }

  libraryFiles.length = 0;

  libraryFiles.push(
    ...Array.from(
      unique.values()
    ).sort(
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
// SEARCH SESSIONS
// ======================================================

const searchSessions =
  new Map();

function buildSearchPage(
  ownerUserId,
  results,
  page = 1
) {
  const perPage = 8;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        results.length /
          perPage
      )
    );

  page = Math.max(
    1,
    Math.min(
      page,
      totalPages
    )
  );

  const start =
    (page - 1) *
    perPage;

  const display =
    results.slice(
      start,
      start + perPage
    );

  const description =
    display.length > 0
      ? display
          .map(
            file =>
              `\`${file.name}\` │ ID: \`${file.id}\``
          )
          .join("\n")
      : "No results.";

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Finder Source Results"
      )
      .setColor(0x808080)
      .setDescription(
        description
      )
      .setFooter({
        text:
          `Page ${page}/${totalPages} │ ` +
          `Today at ${getTimePH()}`
      });

  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `search_back_${ownerUserId}_${page}`
          )
          .setLabel("Back")
          .setStyle(
            ButtonStyle.Secondary
          )
          .setDisabled(
            page <= 1
          ),

        new ButtonBuilder()
          .setCustomId(
            `search_next_${ownerUserId}_${page}`
          )
          .setLabel("Next")
          .setStyle(
            ButtonStyle.Success
          )
          .setDisabled(
            page >= totalPages
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

const client =
  new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

// ======================================================
// SLASH COMMANDS
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
    .addChannelOption(
      option =>
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
    .addStringOption(
      option =>
        option
          .setName(
            "source_channel_id"
          )
          .setDescription(
            "Source Channel ID"
          )
          .setRequired(true)
    )
    .addStringOption(
      option =>
        option
          .setName(
            "destination_channel_id"
          )
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
    .addStringOption(
      option =>
        option
          .setName(
            "description"
          )
          .setDescription(
            "Embed text content"
          )
          .setRequired(true)
    )
    .addStringOption(
      option =>
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
      "Make the bot leave a server (Owner Only)"
    )
    .addStringOption(
      option =>
        option
          .setName("server-id")
          .setDescription(
            "Server ID to leave"
          )
          .setRequired(true)
    )
].map(command =>
  command.toJSON()
);

// ======================================================
// REGISTER COMMANDS
// ======================================================

async function registerCommands() {
  try {
    const rest =
      new REST({
        version: "10"
      }).setToken(TOKEN);

    console.log(
      "🔄 Registering slash commands..."
    );

    await rest.put(
      Routes.applicationCommands(
        CLIENT_ID
      ),
      {
        body: commands
      }
    );

    console.log(
      `✅ Registered ${commands.length} slash commands`
    );
  } catch (error) {
    console.error(
      "❌ Slash command registration failed:"
    );

    console.error(
      error?.message || error
    );
  }
}

// ======================================================
// READY
// ======================================================

client.once(
  "ready",
  async () => {
    console.log(
      "================================"
    );

    console.log(
      `✅ DISCORD ONLINE: ${client.user.tag}`
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

    console.log(
      `🏠 Servers: ${client.guilds.cache.size}`
    );

    console.log(
      "================================"
    );

    // NO WATCHING STATUS
    client.user.setPresence({
      activities: [],
      status: "online"
    });

    await registerCommands();
  }
);

// ======================================================
// DISCORD CONNECTION EVENTS
// ======================================================

client.on(
  "shardReady",
  shardId => {
    console.log(
      `🟢 Discord shard ${shardId} ready`
    );
  }
);

client.on(
  "shardReconnecting",
  shardId => {
    console.log(
      `🔄 Discord shard ${shardId} reconnecting...`
    );
  }
);

client.on(
  "shardDisconnect",
  (event, shardId) => {
    console.error(
      `🔴 Discord shard ${shardId} disconnected.`
    );

    console.error(
      `Code: ${event?.code || "unknown"}`
    );
  }
);

client.on(
  "shardResume",
  (shardId, replayedEvents) => {
    console.log(
      `🟢 Discord shard ${shardId} resumed. Replayed events: ${replayedEvents}`
    );
  }
);

client.on(
  "error",
  error => {
    console.error(
      "❌ Discord client error:",
      error
    );
  }
);

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
          !customId.startsWith(
            "search_back_"
          ) &&
          !customId.startsWith(
            "search_next_"
          )
        ) {
          return;
        }

        const parts =
          customId.split("_");

        const direction =
          parts[1];

        const ownerUserId =
          parts[2];

        const currentPage =
          Number(parts[3]);

        if (
          interaction.user.id !==
          ownerUserId
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
              session.results.length /
                8
            )
          );

        newPage =
          Math.max(
            1,
            Math.min(
              newPage,
              totalPages
            )
          );

        // Respond immediately.
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

      // ==================================================
      // ONLY CHAT INPUT COMMANDS BELOW
      // ==================================================

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      const command =
        interaction.commandName;

      console.log(
        `📥 /${command} from ${interaction.user.tag} (${interaction.user.id})`
      );

      // ==================================================
      // OWNER ONLY CHECK
      // ==================================================

      if (
        OWNER_COMMANDS.includes(
          command
        ) &&
        !isOwner(
          interaction.user.id
        )
      ) {
        return interaction.reply({
          content:
            "❌ **Owner Only.**",
          ephemeral: true
        });
      }

      // ==================================================
      // /SERVERLIST
      // ==================================================

      if (
        command ===
        "serverlist"
      ) {
        await interaction.deferReply({
          ephemeral: true
        });

        const guilds =
          Array.from(
            client.guilds.cache.values()
          );

        let output =
          `**📋 Servers (${guilds.length})**\n\n`;

        for (
          let i = 0;
          i < guilds.length;
          i++
        ) {
          const guild =
            guilds[i];

          output +=
            `${i + 1}. **${guild.name}**\n` +
            `ID: \`${guild.id}\`\n\n`;

          if (
            output.length >= 3800
          ) {
            output +=
              "... (truncated)";
            break;
          }
        }

        return interaction.editReply({
          content: output
        });
      }

      // ==================================================
      // /LEAVE
      // ==================================================

      if (
        command === "leave"
      ) {
        const serverId =
          interaction.options
            .getString(
              "server-id"
            )
            ?.trim();

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
        } catch (error) {
          console.error(
            "❌ Leave error:",
            error.message
          );

          return interaction.editReply({
            content:
              "❌ Failed to leave the server."
          });
        }
      }

      // ==================================================
      // /SETCHANNEL
      // ==================================================

      if (
        command ===
        "setchannel"
      ) {
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
      // /SCANCHANNEL
      // ==================================================

      if (
        command ===
        "scanchannel"
      ) {
        const channel =
          interaction.options
            .getChannel(
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
          await scanChannel(
            channel
          );

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
        command ===
        "forwardall"
      ) {
        const sourceId =
          interaction.options
            .getString(
              "source_channel_id"
            )
            ?.trim();

        const destinationId =
          interaction.options
            .getString(
              "destination_channel_id"
            )
            ?.trim();

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

        const files =
          scan.files;

        if (files.length === 0) {
          return interaction.editReply({
            content:
              `❌ No .txt files found in <#${sourceId}>\n` +
              `Scanned ${scan.scanned} messages.`
          });
        }

        let sent = 0;
        let failed = 0;

        const total =
          files.length;

        // Fast, but avoids hammering
        // Discord too hard.
        const BATCH_SIZE = 5;

        for (
          let i = 0;
          i < total;
          i += BATCH_SIZE
        ) {
          const batch =
            files.slice(
              i,
              i + BATCH_SIZE
            );

          const results =
            await Promise.allSettled(
              batch.map(
                async file => {
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
                }
              )
            );

          for (
            const result of results
          ) {
            if (
              result.status ===
              "fulfilled"
            ) {
              sent++;
            } else {
              failed++;
            }
          }

          // Update progress without
          // spamming interaction edits.
          if (
            i + BATCH_SIZE >=
              total ||
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

      // ==================================================
      // /EMBED
      // ==================================================

      if (
        command === "embed"
      ) {
        if (
          !interaction.member
            ?.permissions
            ?.has(
              PermissionFlagsBits.ManageMessages
            )
        ) {
          return interaction.reply({
            content:
              "❌ Requires Manage Messages permission.",
            ephemeral: true
          });
        }

        const description =
          interaction.options
            .getString(
              "description"
            );

        const title =
          interaction.options
            .getString(
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

        // Acknowledge once.
        await interaction.reply({
          content:
            "✅ Embed sent.",
          ephemeral: true
        });

        try {
          await interaction.channel.send(
            {
              embeds: [embed]
            }
          );
        } catch (error) {
          console.error(
            "❌ Embed send error:",
            error.message
          );
        }

        return;
      }

    } catch (error) {
      console.error(
        "❌ Interaction error:",
        error
      );

      // Prevent double-reply /
      // Unknown Interaction errors.
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
          interaction.deferred &&
          !interaction.replied
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

      const content =
        message.content.trim();

      // ==================================================
      // CHANNEL ACCESS
      // ==================================================

      const allowed =
        isOwner(
          message.author.id
        ) ||
        !config.allowedChannelId ||
        message.channel.id ===
          config.allowedChannelId;

      // ==================================================
      // .find
      // ==================================================

      if (
        content === ".find" ||
        content.startsWith(
          ".find "
        )
      ) {
        if (!allowed) {
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

        if (
          results.length === 0
        ) {
          return message.reply(
            "❌ no match file for that, idiot."
          );
        }

        const data =
          buildSearchPage(
            message.author.id,
            results,
            1
          );

        const reply =
          await message.reply(
            data
          );

        searchSessions.set(
          reply.id,
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
        content === ".get" ||
        content.startsWith(
          ".get "
        )
      ) {
        if (!allowed) {
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
        } catch (error) {
          console.error(
            "❌ .get error:",
            error.message
          );

          await message.reply(
            "❌ Failed to send that file."
          );
        }

        return;
      }

    } catch (error) {
      console.error(
        "❌ messageCreate error:",
        error
      );
    }
  }
);

// ======================================================
// LOGIN / DISCORD GATEWAY
// ======================================================

let loginTimeout;

console.log(
  "🔑 Logging into Discord..."
);

loginTimeout = setTimeout(
  () => {
    if (!client.isReady()) {
      console.error(
        "❌ Discord login has not completed after 30 seconds."
      );

      console.error(
        "❌ Check DISCORD_TOKEN in Render Environment Variables."
      );

      console.error(
        "❌ Also make sure the Discord bot token is current."
      );
    }
  },
  30000
);

client
  .login(TOKEN)
  .then(() => {
    clearTimeout(loginTimeout);

    console.log(
      "🔐 Discord login successful."
    );
  })
  .catch(error => {
    clearTimeout(loginTimeout);

    console.error(
      "❌ Discord login failed:"
    );

    console.error(
      error?.message ||
      error
    );

    process.exit(1);
  });

// ======================================================
// PROCESS ERRORS
// ======================================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled Promise Rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ Uncaught Exception:",
      error
    );
  }
);

process.on(
  "SIGTERM",
  () => {
    console.log(
      "🛑 SIGTERM received. Shutting down..."
    );

    client.destroy();

    process.exit(0);
  }
);

process.on(
  "SIGINT",
  () => {
    console.log(
      "🛑 SIGINT received. Shutting down..."
    );

    client.destroy();

    process.exit(0);
  }
);
