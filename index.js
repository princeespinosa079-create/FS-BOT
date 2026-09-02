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
  MessageFlags,
  ChannelType
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// ============================================================
// CONFIG
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const OWNER_ID = "1302080645987569694";
const ACCESS_ROLE_ID = "1539883004950876160";

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
  process.exit(1);
}

// ============================================================
// EXPRESS / RENDER KEEP-ALIVE SERVER
// ============================================================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.status(200).send("FS Bot Online");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    online: true,
    discordReady: client?.isReady?.() || false,
    guild: GUILD_ID
  });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server listening on port ${PORT}`);
});

// ============================================================
// DATA
// ============================================================

const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;

const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

function ensureFile(file, defaultValue) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
    }
  } catch (err) {
    console.error(`❌ Failed creating ${file}:`, err.message);
  }
}

ensureFile(LIBRARY_FILE, { files: [] });
ensureFile(CONFIG_FILE, { allowedChannelId: null });

// ============================================================
// LIBRARY
// ============================================================

function generateId() {
  return Math.random().toString(36).substring(2, 8);
}

function normalizeFilename(name) {
  return String(name || "").trim().toLowerCase();
}

function loadLibrary() {
  try {
    const data = JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf8"));

    if (!data || !Array.isArray(data.files)) {
      return { files: [] };
    }

    for (const file of data.files) {
      if (!file.id) {
        file.id = generateId();
      }
    }

    return data;
  } catch (err) {
    console.error("❌ Failed loading library:", err.message);
    return { files: [] };
  }
}

function saveLibrary() {
  try {
    fs.writeFileSync(
      LIBRARY_FILE,
      JSON.stringify(library, null, 2)
    );
  } catch (err) {
    console.error("❌ Failed saving library:", err.message);
  }
}

function loadConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));

    return {
      allowedChannelId: data?.allowedChannelId || null
    };
  } catch {
    return {
      allowedChannelId: null
    };
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(config, null, 2)
    );
  } catch (err) {
    console.error("❌ Failed saving config:", err.message);
  }
}

const library = loadLibrary();
const libraryFiles = library.files;
const config = loadConfig();

saveLibrary();

// ============================================================
// FILE HELPERS
// ============================================================

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".ico",
  ".tif",
  ".tiff",
  ".avif"
]);

function isImageFile(name) {
  const ext = path.extname(
    String(name || "").toLowerCase()
  );

  return IMAGE_EXTENSIONS.has(ext);
}

function fileExistsByName(name) {
  const normalized = normalizeFilename(name);

  return libraryFiles.some(
    file => normalizeFilename(file.name) === normalized
  );
}

function getFileById(id) {
  return libraryFiles.find(
    file => String(file.id).toLowerCase() === String(id).toLowerCase()
  );
}

// ============================================================
// PERMISSION
// ============================================================

function hasAccess(member, userId) {
  if (userId === OWNER_ID) {
    return true;
  }

  return Boolean(
    member?.roles?.cache?.has(ACCESS_ROLE_ID)
  );
}

// ============================================================
// SEARCH
// ============================================================

function searchFiles(query) {
  const q = String(query || "").trim().toLowerCase();

  if (!q) return [];

  const words = q.split(/\s+/);

  const exact = [];
  const allWords = [];
  const partial = [];

  for (const file of libraryFiles) {
    const name = normalizeFilename(file.name);

    // Exact filename
    if (name === q) {
      exact.push(file);
      continue;
    }

    // Name without extension
    const nameWithoutExt = path
      .basename(name, path.extname(name));

    if (nameWithoutExt === q) {
      exact.push(file);
      continue;
    }

    // All words must exist
    if (
      words.length > 1 &&
      words.every(word => name.includes(word))
    ) {
      allWords.push(file);
      continue;
    }

    // Any word exists
    if (
      words.some(word => name.includes(word))
    ) {
      partial.push(file);
    }
  }

  return [
    ...exact,
    ...allWords,
    ...partial
  ];
}

// ============================================================
// SEARCH PAGINATION
// ============================================================

const searchSessions = new Map();

function buildSearchPage(userId, results, page = 1) {
  const PER_PAGE = 8;

  const totalPages = Math.max(
    1,
    Math.ceil(results.length / PER_PAGE)
  );

  page = Math.max(
    1,
    Math.min(page, totalPages)
  );

  const start = (page - 1) * PER_PAGE;

  const display = results.slice(
    start,
    start + PER_PAGE
  );

  const description = display
    .map(file =>
      `\`${file.name}\` │ ID: \`${file.id}\``
    )
    .join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Finder Source Results")
    .setColor(0x808080)
    .setDescription(
      description || "No results."
    )
    .setFooter({
      text: `Page ${page}/${totalPages}`
    });

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(
          `fs_back_${userId}_${page}`
        )
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),

      new ButtonBuilder()
        .setCustomId(
          `fs_next_${userId}_${page}`
        )
        .setLabel("Next")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page >= totalPages)
    );

  return {
    embeds: [embed],
    components: [row]
  };
}

// ============================================================
// CHANNEL CHECK
// ============================================================

function isAllowedChannel(channelId) {
  if (!config.allowedChannelId) {
    return false;
  }

  return channelId === config.allowedChannelId;
}

// ============================================================
// SAFE MESSAGE FETCH
// ============================================================

async function fetchMessagesBatch(channel, before = null) {
  const options = {
    limit: 100
  };

  if (before) {
    options.before = before;
  }

  try {
    return await channel.messages.fetch(options);
  } catch (err) {
    console.error(
      `⚠️ Message fetch failed in ${channel.id}:`,
      err.message
    );

    return null;
  }
}

// ============================================================
// SCAN CHANNEL
// ============================================================

const activeScans = new Set();

async function scanChannel(channel) {
  if (!channel) {
    throw new Error("Channel not found.");
  }

  if (!channel.isTextBased()) {
    throw new Error("❌ this channel is not a text channel.");
  }

  if (activeScans.has(channel.id)) {
    throw new Error(
      "❌ this channel is already being scanned."
    );
  }

  activeScans.add(channel.id);

  try {
    const foundFiles = [];

    let before = null;
    let scanned = 0;

    while (true) {
      const batch = await fetchMessagesBatch(
        channel,
        before
      );

      // IMPORTANT:
      // Never retry forever.
      if (!batch) {
        break;
      }

      if (batch.size === 0) {
        break;
      }

      scanned += batch.size;

      for (const message of batch.values()) {
        // ----------------------------
        // Normal attachments
        // ----------------------------

        for (const attachment of message.attachments.values()) {
          if (!attachment.name) continue;

          // Ignore images
          if (isImageFile(attachment.name)) {
            continue;
          }

          foundFiles.push({
            name: attachment.name,
            url: attachment.url,
            size: attachment.size || 0,
            timestamp: message.createdTimestamp
          });
        }

        // ----------------------------
        // Message snapshots
        // ----------------------------

        if (message.messageSnapshots) {
          let snapshots = [];

          if (
            typeof message.messageSnapshots.values ===
            "function"
          ) {
            snapshots = [
              ...message.messageSnapshots.values()
            ];
          } else if (
            Array.isArray(message.messageSnapshots)
          ) {
            snapshots = message.messageSnapshots;
          }

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
              if (!attachment?.name) continue;

              if (isImageFile(attachment.name)) {
                continue;
              }

              foundFiles.push({
                name: attachment.name,
                url: attachment.url,
                size: attachment.size || 0,
                timestamp: message.createdTimestamp
              });
            }
          }
        }
      }

      const lastMessage = batch.last();

      if (!lastMessage) {
        break;
      }

      before = lastMessage.id;

      // Less than 100 means we're finished.
      if (batch.size < 100) {
        break;
      }

      // Small delay so Discord isn't hammered.
      await new Promise(resolve =>
        setTimeout(resolve, 100)
      );
    }

    // ========================================================
    // DEDUPLICATE BY FILENAME
    // ========================================================

    const existing = new Map();

    for (const file of libraryFiles) {
      const key = normalizeFilename(file.name);

      if (!existing.has(key)) {
        existing.set(key, file);
      }
    }

    let added = 0;
    let skipped = 0;

    for (const file of foundFiles) {
      const key = normalizeFilename(file.name);

      if (!key) {
        continue;
      }

      if (existing.has(key)) {
        skipped++;
        continue;
      }

      const newFile = {
        id: generateId(),
        name: file.name,
        url: file.url,
        size: file.size,
        timestamp: file.timestamp
      };

      existing.set(key, newFile);
      added++;
    }

    libraryFiles.length = 0;

    libraryFiles.push(
      ...Array.from(existing.values()).sort(
        (a, b) =>
          (a.timestamp || 0) -
          (b.timestamp || 0)
      )
    );

    saveLibrary();

    return {
      scanned,
      found: foundFiles.length,
      added,
      skipped,
      total: libraryFiles.length
    };

  } finally {
    activeScans.delete(channel.id);
  }
}

// ============================================================
// SCAN .TXT FILES FOR FORWARDALL
// ============================================================

async function scanTxtFiles(channel) {
  if (!channel?.isTextBased()) {
    return {
      files: [],
      scanned: 0
    };
  }

  const files = [];

  let before = null;
  let scanned = 0;

  while (true) {
    const batch = await fetchMessagesBatch(
      channel,
      before
    );

    if (!batch || batch.size === 0) {
      break;
    }

    scanned += batch.size;

    for (const message of batch.values()) {
      for (const attachment of message.attachments.values()) {
        if (
          attachment.name &&
          path.extname(
            attachment.name.toLowerCase()
          ) === ".txt"
        ) {
          files.push({
            name: attachment.name,
            url: attachment.url,
            size: attachment.size || 0
          });
        }
      }
    }

    const lastMessage = batch.last();

    if (!lastMessage) {
      break;
    }

    before = lastMessage.id;

    if (batch.size < 100) {
      break;
    }

    await new Promise(resolve =>
      setTimeout(resolve, 100)
    );
  }

  return {
    files,
    scanned
  };
}

// ============================================================
// FETCH CHANNEL
// ============================================================

async function fetchChannelById(channelId) {
  if (!/^\d+$/.test(channelId)) {
    return null;
  }

  try {
    return (
      client.channels.cache.get(channelId) ||
      await client.channels.fetch(channelId)
    );
  } catch (err) {
    console.error(
      `❌ could not fetch channel ${channelId}:`,
      err.message
    );

    return null;
  }
}

// ============================================================
// DISCORD CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ============================================================
// COMMANDS
// ============================================================

const commands = [
  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription(
      "Scan a channel for files (Owner/Access Role)"
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel to scan")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription(
      "Send a embed (Owner/Access Role)"
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
        .setDescription("Optional embed title")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("forwardall")
    .setDescription(
      "Forward all TXT files from channel (Owner/Access Role)"
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
    .setName("setchannel")
    .setDescription(
      "Set the channel for .find and .get (Owner/Access Role)"
    )
].map(command => command.toJSON());

// ============================================================
// REGISTER ONLY IN ONE GUILD
// ============================================================

async function registerCommands() {
  const rest = new REST({
    version: "10"
  }).setToken(TOKEN);

  console.log("🧹 Removing old GLOBAL slash commands...");

  try {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: []
      }
    );

    console.log("✅ Old global commands removed.");
  } catch (err) {
    console.error(
      "⚠️ Could not remove global commands:",
      err.message
    );
  }

  console.log(
    `📌 Registering commands in guild ${GUILD_ID}...`
  );

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
    `✅ ${commands.length} slash commands registered in ONE guild.`
  );
}

// ============================================================
// READY
// ============================================================

client.once("ready", async () => {
  console.log("");
  console.log("========================================");
  console.log("✅ FS BOT ONLINE");
  console.log("========================================");
  console.log(`🤖 Bot: ${client.user.tag}`);
  console.log(`📌 Guild: ${GUILD_ID}`);
  console.log(`👑 Owner: ${OWNER_ID}`);
  console.log(`🎭 Access Role: ${ACCESS_ROLE_ID}`);
  console.log(`📚 Library: ${libraryFiles.length}`);
  console.log("========================================");

  // NO WATCHING STATUS.
  // We intentionally do not call client.user.setPresence().

  try {
    await registerCommands();
  } catch (err) {
    console.error(
      "❌ Command registration failed:",
      err
    );
  }
});

// ============================================================
// INTERACTIONS
// ============================================================

client.on(
  "interactionCreate",
  async interaction => {
    try {
      // ======================================================
      // BUTTONS
      // ======================================================

      if (interaction.isButton()) {
        const id = interaction.customId;

        if (
          id.startsWith("fs_back_") ||
          id.startsWith("fs_next_")
        ) {
          const parts = id.split("_");

          const direction = parts[1];
          const ownerId = parts[2];
          const currentPage = Number(parts[3]);

          if (interaction.user.id !== ownerId) {
            return interaction.reply({
              content:
                "❌ this search isn’t yours, dumbass.",
              flags: MessageFlags.Ephemeral
            });
          }

          const session =
            searchSessions.get(
              interaction.message.id
            );

          if (!session) {
            return interaction.reply({
              content:
                "❌ search expired, idiot, use `.find` again.",
              flags: MessageFlags.Ephemeral
            });
          }

          let newPage =
            direction === "next"
              ? currentPage + 1
              : currentPage - 1;

          newPage = Math.max(
            1,
            Math.min(
              newPage,
              Math.ceil(
                session.results.length / 8
              )
            )
          );

          await interaction.update(
            buildSearchPage(
              ownerId,
              session.results,
              newPage
            )
          );

          return;
        }

        return;
      }

      // ======================================================
      // SLASH COMMANDS
      // ======================================================

      if (!interaction.isChatInputCommand()) {
        return;
      }

      const userId = interaction.user.id;

      if (
        !hasAccess(
          interaction.member,
          userId
        )
      ) {
        return interaction.reply({
          content:
            "❌ owner or access role only can use this, dumbass.",
          flags: MessageFlags.Ephemeral
        });
      }

      // ======================================================
      // /SETCHANNEL
      // ======================================================

      if (
        interaction.commandName ===
        "setchannel"
      ) {
        config.allowedChannelId =
          interaction.channelId;

        saveConfig();

        return interaction.reply({
          content:
            `✅ **channel set!**\n` +
            `🔥 .find and .get are now allowed in <#${interaction.channelId}>`
        });
      }

      // ======================================================
      // /EMBED
      // ======================================================

      if (
        interaction.commandName ===
        "embed"
      ) {
        const description =
          interaction.options.getString(
            "description"
          );

        const title =
          interaction.options.getString(
            "title"
          );

        const embed = new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(description);

        if (title) {
          embed.setTitle(title);
        }

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        await interaction.deleteReply();

        await interaction.channel.send({
          embeds: [embed]
        });

        return;
      }

      // ======================================================
      // /SCANCHANNEL
      // ======================================================

      if (
        interaction.commandName ===
        "scanchannel"
      ) {
        // DEFER IMMEDIATELY.
        // This prevents "The application did not respond."
        await interaction.deferReply();

        const channel =
          interaction.options.getChannel(
            "channel"
          );

        if (!channel) {
          return interaction.editReply({
            content:
              "❌ channel not found."
          });
        }

        if (!channel.isTextBased()) {
          return interaction.editReply({
            content:
              "❌ that isn’t a text channel."
          });
        }

        try {
          const result =
            await scanChannel(channel);

          return interaction.editReply({
            content:
              `📁 **SCAN COMPLETE!**\n\n` +
              `**Channel:** <#${channel.id}>\n` +
              `**Messages Scanned:** ${result.scanned}\n` +
              `📦 **File’s Found:** ${result.found}\n` +
              `✅ **Added:** ${result.added}\n` +
              `⏭️ **Skipped:** ${result.skipped}\n` +
              `📚 **Library Total:** ${result.total}`
          });
        } catch (err) {
          console.error(
            "❌ scan error:",
            err
          );

          return interaction.editReply({
            content:
              `❌ **scan failed:** ${err.message}`
          });
        }
      }

      // ======================================================
      // /FORWARDALL
      // ======================================================

      if (
        interaction.commandName ===
        "forwardall"
      ) {
        // Defer immediately.
        await interaction.deferReply();

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
              "❌ invalid source channel."
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
              "❌ invalid destination channel."
          });
        }

        await interaction.editReply({
          content:
            `🔄 **scanning .txt files...**\n` +
            `from: <#${sourceId}>\n` +
            `to: <#${destinationId}>`
        });

        const {
          files,
          scanned
        } = await scanTxtFiles(
          sourceChannel
        );

        if (files.length === 0) {
          return interaction.editReply({
            content:
              `❌ no .txt files found.\n` +
              `📖 messages scanned: ${scanned}`
          });
        }

        let sent = 0;
        let failed = 0;

        for (
          let i = 0;
          i < files.length;
          i++
        ) {
          const file = files[i];

          try {
            await destinationChannel.send({
              files: [
                {
                  attachment: file.url,
                  name: file.name
                }
              ]
            });

            sent++;
          } catch (err) {
            failed++;

            console.error(
              `⚠️ failed forwarding ${file.name}:`,
              err.message
            );
          }

          // Update every 10 files instead of
          // editing Discord for every file.
          if (
            sent + failed === files.length ||
            (sent + failed) % 10 === 0
          ) {
            await interaction.editReply({
              content:
                `🔄 **forwarding...**\n` +
                `⚡ ${sent + failed}/${files.length}\n` +
                `from: <#${sourceId}> → <#${destinationId}>`
            }).catch(() => {});
          }
        }

        return interaction.editReply({
          content:
            `✅ **FORWARD COMPLETE!**\n\n` +
            `📖 **Scanned:** ${scanned}\n` +
            `📦 **File’s Found:** ${files.length}\n` +
            `✅ **Sent:** ${sent}\n` +
            `❌ **Failed:** ${failed}\n` +
            `📤 **Destination:** <#${destinationId}>`
        });
      }

    } catch (err) {
      console.error(
        "❌ interaction handler error:",
        err
      );

      // Only try to respond if Discord hasn't
      // already received a response.
      try {
        if (
          interaction.isRepliable() &&
          !interaction.replied &&
          !interaction.deferred
        ) {
          await interaction.reply({
            content:
              "❌ something went wrong, idiot.",
            flags: MessageFlags.Ephemeral
          });
        }
      } catch {}
    }
  }
);

// ============================================================
// PREFIX COMMANDS
// ============================================================

client.on(
  "messageCreate",
  async message => {
    try {
      if (message.author.bot) {
        return;
      }

      const userId =
        message.author.id;

      // Owner or Access Role only.
      if (
        !hasAccess(
          message.member,
          userId
        )
      ) {
        return;
      }

      const content =
        message.content.trim();

      // ======================================================
      // .FIND
      // ======================================================

      if (
        content === ".find" ||
        content.startsWith(".find ")
      ) {
        // Must be in allowed channel.
        if (
          !isAllowedChannel(
            message.channel.id
          )
        ) {
          return message.reply(
            "❌ not here, dumbass."
          );
        }

        const query =
          content
            .slice(5)
            .trim();

        // .find with nothing
        if (!query) {
          return message.reply(
            "❌ not here, dumbass."
          );
        }

        const results =
          searchFiles(query);

        if (results.length === 0) {
          return message.reply(
            "❌ no matching name for that, dumbass."
          );
        }

        const replyData =
          buildSearchPage(
            userId,
            results,
            1
          );

        const reply =
          await message.reply(
            replyData
          );

        searchSessions.set(
          reply.id,
          {
            userId,
            results
          }
        );

        // Automatically clean expired
        // search sessions after 10 minutes.
        setTimeout(() => {
          searchSessions.delete(
            reply.id
          );
        }, 10 * 60 * 1000);

        return;
      }

      // ======================================================
      // .GET
      // ======================================================

      if (
        content === ".get" ||
        content.startsWith(".get ")
      ) {
        // Must be in allowed channel.
        if (
          !isAllowedChannel(
            message.channel.id
          )
        ) {
          return message.reply(
            "❌ not here, dumbass."
          );
        }

        const id =
          content
            .slice(4)
            .trim();

        // No ID
        if (!id) {
          return message.reply(
            "❌ put id of file, idiot."
          );
        }

        const file =
          getFileById(id);

        // Wrong ID
        if (!file) {
          return message.reply(
            "❌ your id is wrong, try find working id, dumbass."
          );
        }

        try {
          // File from local storage
          if (
            file.isLocal &&
            fs.existsSync(file.url)
          ) {
            await message.channel.send({
              content:
                "**Here is the file twin!**",
              files: [
                {
                  attachment: file.url,
                  name: file.name
                }
              ]
            });

            return;
          }

          // Discord CDN file
          await message.channel.send({
            content:
              "**Here is the file twin!**",
            files: [
              {
                attachment: file.url,
                name: file.name
              }
            ]
          });

        } catch (err) {
          console.error(
            `❌ failed sending ${file.name}:`,
            err.message
          );

          await message.reply(
            "❌ i couldn't send that file, dumbass."
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

// ============================================================
// DISCORD CONNECTION EVENTS
// ============================================================

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
  "shardDisconnect",
  (event, shardId) => {
    console.error(
      `🔴 Discord disconnected. Shard ${shardId}`,
      event
    );
  }
);

client.on(
  "shardReconnecting",
  shardId => {
    console.log(
      `🔄 Discord reconnecting... Shard ${shardId}`
    );
  }
);

client.on(
  "shardResume",
  (shardId, replayedEvents) => {
    console.log(
      `🟢 Discord connection resumed. Shard ${shardId}, replayed ${replayedEvents} events.`
    );
  }
);

// ============================================================
// PROCESS ERROR HANDLING
// ============================================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled promise rejection:",
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

// ============================================================
// LOGIN
// ============================================================

console.log("");
console.log("========================================");
console.log("🔑 CONNECTING TO DISCORD");
console.log("========================================");
console.log(`📌 Client ID: ${CLIENT_ID}`);
console.log(`📌 Guild ID: ${GUILD_ID}`);
console.log("========================================");

// NEVER PRINT THE TOKEN.
client.login(TOKEN).catch(error => {
  console.error(
    "❌ Discord login failed:",
    error
  );

  process.exit(1);
});

// ============================================================
// CLEAN SHUTDOWN
// ============================================================

async function shutdown(signal) {
  console.log(
    `🛑 Received ${signal}. Shutting down...`
  );

  try {
    client.destroy();
  } catch {}

  try {
    server.close();
  } catch {}

  process.exit(0);
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
