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

// =====================================================
// CONFIG
// =====================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const OWNER_ID = "1302080645987569694";

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

// =====================================================
// EXPRESS / RENDER
// =====================================================

const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.status(200).send("FS Bot Online");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    online: true,
    discordReady: client?.isReady?.() || false,
    guildId: GUILD_ID
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server listening on port ${PORT}`);
});

// =====================================================
// DATA
// =====================================================

const DATA_DIR = fs.existsSync("/data")
  ? "/data"
  : __dirname;

const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

// =====================================================
// SAFE FILE HELPERS
// =====================================================

function safeReadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;

    const raw = fs.readFileSync(file, "utf8");

    if (!raw.trim()) return fallback;

    return JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Failed reading ${file}:`, err.message);
    return fallback;
  }
}

function safeWriteJSON(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(data, null, 2),
      "utf8"
    );
    return true;
  } catch (err) {
    console.error(`❌ Failed writing ${file}:`, err.message);
    return false;
  }
}

// =====================================================
// CONFIG
// =====================================================

const config = safeReadJSON(CONFIG_FILE, {
  allowedChannelId: null
});

function saveConfig() {
  safeWriteJSON(CONFIG_FILE, config);
}

// =====================================================
// LIBRARY
// =====================================================

const library = safeReadJSON(LIBRARY_FILE, {
  files: []
});

if (!Array.isArray(library.files)) {
  library.files = [];
}

const libraryFiles = library.files;

function saveLibrary() {
  safeWriteJSON(LIBRARY_FILE, library);
}

// =====================================================
// HELPERS
// =====================================================

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

function getTimePH() {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
}

function isImageFile(name) {
  const ext = path.extname(
    String(name || "").toLowerCase()
  );

  return [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
    ".ico"
  ].includes(ext);
}

function isTxtFile(name) {
  return path.extname(
    String(name || "").toLowerCase()
  ) === ".txt";
}

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

// =====================================================
// PERMISSION
// =====================================================

function isOwner(userId) {
  return userId === OWNER_ID;
}

// =====================================================
// SMART SEARCH
// =====================================================

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

  const exact = [];
  const allWords = [];
  const anyWord = [];

  for (const file of libraryFiles) {
    const name = normalizeFilename(file.name);

    const nameNoSpecial = name.replace(
      /[^a-z0-9]/g,
      ""
    );

    // Exact filename
    if (
      name === q ||
      nameNoSpecial === qNoSpecial ||
      name.startsWith(q + ".") ||
      nameNoSpecial.startsWith(qNoSpecial + ".")
    ) {
      exact.push(file);
      continue;
    }

    // All words
    let matchesAll = true;

    for (const word of qWords) {
      if (!name.includes(word)) {
        matchesAll = false;
        break;
      }
    }

    if (matchesAll) {
      allWords.push(file);
      continue;
    }

    // Any word
    for (const word of qWords) {
      if (name.includes(word)) {
        anyWord.push(file);
        break;
      }
    }
  }

  return [
    ...exact,
    ...allWords,
    ...anyWord
  ];
}

// =====================================================
// SEARCH PAGINATION
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

  page = Math.max(
    1,
    Math.min(page, totalPages)
  );

  const start =
    (page - 1) * perPage;

  const display = results.slice(
    start,
    start + perPage
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
      description || "No files found."
    )
    .setFooter({
      text:
        `Page ${page}/${totalPages} │ Today at ${getTimePH()}`
    });

  const row = new ActionRowBuilder()
    .addComponents(
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
// SLASH COMMANDS
// =====================================================

const commands = [

  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set allowed channel for .find and .get (Owner Only)"),

  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription("Scan channel for files (Owner Only)")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel to scan")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("forwardall")
    .setDescription("Copy all .txt files (Owner Only)")
    .addStringOption(option =>
      option
        .setName("source_channel_id")
        .setDescription("Source Channel ID")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("destination_channel_id")
        .setDescription("Destination Channel ID")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a gray embed message")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    )
    .addStringOption(option =>
      option
        .setName("description")
        .setDescription("Embed text")
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
    .setDescription("List bot servers (Owner Only)"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Make bot leave a server (Owner Only)")
    .addStringOption(option =>
      option
        .setName("server-id")
        .setDescription("Server ID")
        .setRequired(true)
    )

].map(command => command.toJSON());

// =====================================================
// REGISTER GUILD COMMANDS
// =====================================================

async function registerCommands() {
  try {
    console.log("🔧 Registering guild commands...");

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
      `✅ Guild commands registered in ${GUILD_ID}`
    );

  } catch (err) {
    console.error(
      "❌ Command registration failed:",
      err.message
    );
  }
}

// =====================================================
// CHANNEL FETCH
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

  } catch (err) {
    console.error(
      `❌ Failed fetching channel ${channelId}:`,
      err.message
    );

    return null;
  }
}

// =====================================================
// SCAN CHANNEL
// =====================================================

async function scanChannel(channel) {

  if (!channel?.isTextBased()) {
    return {
      added: 0,
      skipped: 0,
      total: libraryFiles.length,
      scanned: 0
    };
  }

  let before = null;
  let scanned = 0;
  let added = 0;
  let skipped = 0;

  const seenInScan = new Set();

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
        "⚠️ Message fetch failed:",
        err.message
      );

      break;
    }

    if (!batch.size) {
      break;
    }

    scanned += batch.size;

    for (const message of batch.values()) {

      for (const attachment of message.attachments.values()) {

        const name =
          attachment.name;

        if (!name) continue;

        if (isImageFile(name)) {
          continue;
        }

        const key =
          normalizeFilename(name);

        if (!key) continue;

        if (seenInScan.has(key)) {
          skipped++;
          continue;
        }

        seenInScan.add(key);

        if (fileExistsByName(name)) {
          skipped++;
          continue;
        }

        libraryFiles.push({
          id: generateId(),
          name,
          url: attachment.url,
          size: attachment.size || 0,
          timestamp:
            message.createdTimestamp || Date.now()
        });

        added++;
      }
    }

    before =
      batch.last()?.id;

    if (
      !before ||
      batch.size < 100
    ) {
      break;
    }
  }

  saveLibrary();

  return {
    added,
    skipped,
    total: libraryFiles.length,
    scanned
  };
}

// =====================================================
// TXT SCAN
// =====================================================

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
        "⚠️ TXT scan fetch error:",
        err.message
      );

      break;
    }

    if (!batch.size) {
      break;
    }

    scanned += batch.size;

    for (const message of batch.values()) {

      for (const attachment of message.attachments.values()) {

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

    before =
      batch.last()?.id;

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

// =====================================================
// READY
// =====================================================

client.once("ready", async () => {

  console.log("========================================");
  console.log("🚀 FS BOT ONLINE");
  console.log("========================================");
  console.log(`🤖 Bot: ${client.user.tag}`);
  console.log(`🆔 Client ID: ${CLIENT_ID}`);
  console.log(`🏠 Guild ID: ${GUILD_ID}`);
  console.log(`👑 Owner ID: ${OWNER_ID}`);
  console.log(`📚 Library: ${libraryFiles.length} files`);
  console.log("========================================");

  await registerCommands();

  console.log("✅ Discord gateway is READY.");
});

// =====================================================
// DISCORD DEBUG EVENTS
// =====================================================

client.on("shardReady", shardId => {
  console.log(`🟢 Discord shard ${shardId} ready.`);
});

client.on("shardDisconnect", (event, shardId) => {
  console.error(
    `🔴 Discord shard ${shardId} disconnected.`,
    event?.code || ""
  );
});

client.on("shardReconnecting", shardId => {
  console.log(
    `🔄 Discord shard ${shardId} reconnecting...`
  );
});

client.on("shardResume", (shardId, replayedEvents) => {
  console.log(
    `♻️ Discord shard ${shardId} resumed. Events: ${replayedEvents}`
  );
});

client.on("warn", message => {
  console.warn("⚠️ Discord warning:", message);
});

client.on("error", error => {
  console.error(
    "❌ Discord client error:",
    error
  );
});

// =====================================================
// BUTTONS
// =====================================================

client.on("interactionCreate", async interaction => {

  try {

    // =================================================
    // BUTTON
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

        const newPage =
          direction === "next"
            ? currentPage + 1
            : currentPage - 1;

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
    // SLASH COMMAND
    // =================================================

    if (!interaction.isChatInputCommand()) {
      return;
    }

    // =================================================
    // OWNER COMMANDS
    // =================================================

    const ownerCommands = [
      "setchannel",
      "scanchannel",
      "forwardall",
      "serverlist",
      "leave"
    ];

    if (
      ownerCommands.includes(
        interaction.commandName
      )
    ) {

      if (
        interaction.user.id !== OWNER_ID
      ) {
        return interaction.reply({
          content:
            "❌ Owner only.",
          ephemeral: true
        });
      }
    }

    // =================================================
    // SERVERLIST
    // =================================================

    if (
      interaction.commandName ===
      "serverlist"
    ) {

      await interaction.deferReply({
        ephemeral: true
      });

      const guilds =
        [...client.guilds.cache.values()];

      const list =
        guilds.map(
          (guild, index) =>
            `${index + 1}. **${guild.name}**\n` +
            `ID: \`${guild.id}\``
        ).join("\n\n");

      return interaction.editReply({
        content:
          `**📋 Servers (${guilds.length})**\n\n${list || "No servers."}`
      });
    }

    // =================================================
    // LEAVE
    // =================================================

    if (
      interaction.commandName ===
      "leave"
    ) {

      const serverId =
        interaction.options
          .getString("server-id")
          .trim();

      const guild =
        client.guilds.cache.get(serverId);

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
            `✅ Left **${guildName}**.`,
          ephemeral: true
        });

      } catch (err) {

        console.error(
          "❌ Leave error:",
          err
        );

        return interaction.reply({
          content:
            "❌ Failed to leave the server.",
          ephemeral: true
        });
      }
    }

    // =================================================
    // SCAN CHANNEL
    // =================================================

    if (
      interaction.commandName ===
      "scanchannel"
    ) {

      const channel =
        interaction.options
          .getChannel("channel");

      await interaction.deferReply();

      if (!channel?.isTextBased()) {
        return interaction.editReply({
          content:
            "❌ That is not a text channel."
        });
      }

      const result =
        await scanChannel(channel);

      return interaction.editReply({
        content:
          `📁 **SCAN COMPLETE**\n\n` +
          `**Channel:** <#${channel.id}>\n` +
          `**Scanned:** ${result.scanned}\n` +
          `✅ **Added:** ${result.added}\n` +
          `⏭️ **Skipped:** ${result.skipped}\n` +
          `📚 **Total:** ${result.total}`
      });
    }

    // =================================================
    // FORWARD ALL
    // =================================================

    if (
      interaction.commandName ===
      "forwardall"
    ) {

      const sourceId =
        interaction.options
          .getString("source_channel_id")
          .trim();

      const destinationId =
        interaction.options
          .getString("destination_channel_id")
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
            "❌ Invalid source channel."
        });
      }

      const destination =
        await fetchChannelById(
          destinationId
        );

      if (
        !destination ||
        !destination.isTextBased()
      ) {
        return interaction.editReply({
          content:
            "❌ Invalid destination channel."
        });
      }

      await interaction.editReply({
        content:
          `🔄 **Scanning .txt files...**\n` +
          `From: <#${sourceId}>\n` +
          `To: <#${destinationId}>`
      });

      const scan =
        await scanTxtFiles(source);

      if (!scan.files.length) {

        return interaction.editReply({
          content:
            `❌ No .txt files found.\n` +
            `Scanned: ${scan.scanned} messages.`
        });
      }

      let sent = 0;
      let failed = 0;

      const files =
        scan.files;

      for (const file of files) {

        try {

          await destination.send({
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
            `⚠️ Failed forwarding ${file.name}:`,
            err.message
          );
        }
      }

      return interaction.editReply({
        content:
          `✅ **FORWARD COMPLETE**\n\n` +
          `**From:** <#${sourceId}>\n` +
          `**To:** <#${destinationId}>\n` +
          `**Scanned:** ${scan.scanned}\n` +
          `📄 **Found:** ${files.length}\n` +
          `✅ **Sent:** ${sent}\n` +
          `❌ **Failed:** ${failed}`
      });
    }

    // =================================================
    // SET CHANNEL
    // =================================================

    if (
      interaction.commandName ===
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

    // =================================================
    // EMBED
    // =================================================

    if (
      interaction.commandName ===
      "embed"
    ) {

      const hasManageMessages =
        interaction.member?.permissions?.has(
          PermissionFlagsBits.ManageMessages
        );

      if (
        interaction.user.id !== OWNER_ID &&
        !hasManageMessages
      ) {
        return interaction.reply({
          content:
            "❌ Requires Manage Messages permission.",
          ephemeral: true
        });
      }

      const description =
        interaction.options
          .getString("description");

      const title =
        interaction.options
          .getString("title");

      const embed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(description)
          .setFooter({
            text:
              `Today at ${getTimePH()}`
          });

      if (title) {
        embed.setTitle(title);
      }

      await interaction.reply({
        content: "✅",
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

    try {

      if (interaction.replied) {

        await interaction.followUp({
          content:
            "❌ Something went wrong.",
          ephemeral: true
        });

      } else if (interaction.deferred) {

        await interaction.editReply({
          content:
            "❌ Something went wrong."
        });

      } else {

        await interaction.reply({
          content:
            "❌ Something went wrong.",
          ephemeral: true
        });

      }

    } catch {}
  }
});

// =====================================================
// PREFIX COMMANDS
// =====================================================

client.on("messageCreate", async message => {

  try {

    if (message.author.bot) {
      return;
    }

    // Only configured guild
    if (
      message.guild &&
      message.guild.id !== GUILD_ID
    ) {
      return;
    }

    const userId =
      message.author.id;

    const bypass =
      userId === OWNER_ID;

    const allowed =
      bypass ||
      !config.allowedChannelId ||
      message.channel.id ===
        config.allowedChannelId;

    // =================================================
    // .find
    // =================================================

    if (
      message.content.startsWith(".find")
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
          "❌ Enter a filename to search."
        );
      }

      const results =
        searchFiles(query);

      if (!results.length) {
        return message.reply(
          "❌ No matching files found."
        );
      }

      const reply =
        await message.reply(
          buildSearchPage(
            userId,
            results,
            1
          )
        );

      searchSessions.set(
        reply.id,
        {
          userId,
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
          "❌ Put the file ID."
        );
      }

      const file =
        getFileById(id);

      if (!file) {
        return message.reply(
          "❌ File not found. Check the ID."
        );
      }

      try {

        await message.channel.send({
          content:
            `<@${userId}> Here is the file!`,
          files: [
            {
              attachment: file.url,
              name: file.name
            }
          ]
        });

      } catch (err) {

        console.error(
          `❌ Failed sending ${file.name}:`,
          err
        );

        return message.reply(
          "❌ I couldn't send that file."
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
});

// =====================================================
// PROCESS ERRORS
// =====================================================

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
// START
// =====================================================

console.log("========================================");
console.log("🚀 FS BOT STARTING");
console.log("========================================");
console.log(`📌 Client ID: ${CLIENT_ID}`);
console.log(`📌 Guild ID: ${GUILD_ID}`);
console.log(`👑 Owner ID: ${OWNER_ID}`);
console.log(`📚 Library: ${libraryFiles.length}`);
console.log("========================================");

console.log("🔑 Connecting to Discord gateway...");

// IMPORTANT:
// Never print the Discord token.

client.login(TOKEN)
  .then(() => {
    console.log("🔄 Discord login request accepted.");
  })
  .catch(error => {
    console.error(
      "❌ Discord login failed:",
      error.message
    );
    process.exit(1);
  });
