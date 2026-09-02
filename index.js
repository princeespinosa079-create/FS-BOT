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

// ============================================================
// CONFIG
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const OWNER_ID = "1302080645987569694";
const SCAN_ROLE_ID = "1509953862226935948";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing required environment variables.");
  console.error("Required: DISCORD_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}

// ============================================================
// WEB SERVER FOR RENDER
// ============================================================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.status(200).send("FS Bot Online");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    online: client?.isReady?.() || false,
    guild: GUILD_ID,
    library: libraryFiles.length
  });
});

app.listen(PORT, "0.0.0.0", () => {
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

// ============================================================
// HELPERS
// ============================================================

function normalizeFilename(name) {
  return String(name || "").trim().toLowerCase();
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
      JSON.stringify(config, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("❌ Failed saving config:", err.message);
  }
}

function loadLibrary() {
  try {
    const data = JSON.parse(
      fs.readFileSync(LIBRARY_FILE, "utf8")
    );

    if (!data.files || !Array.isArray(data.files)) {
      data.files = [];
    }

    for (const file of data.files) {
      if (!file.id) {
        file.id = generateId();
      }
    }

    return data;
  } catch (err) {
    console.error("⚠️ Could not load library:", err.message);
    return { files: [] };
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
    console.error("❌ Failed saving library:", err.message);
  }
}

const config = loadConfig();
const library = loadLibrary();
const libraryFiles = library.files;

// ============================================================
// FILE HELPERS
// ============================================================

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

// ============================================================
// PERMISSIONS
// OWNER ONLY
// ============================================================

function isOwner(userId) {
  return userId === OWNER_ID;
}

function isOwnerInteraction(interaction) {
  return isOwner(interaction.user.id);
}

// ============================================================
// SEARCH
// ============================================================

function searchFiles(query) {
  const q = String(query || "")
    .toLowerCase()
    .trim();

  if (!q) return [];

  const words = q.split(/\s+/);

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

    // Every search word exists
    let allWords = true;

    for (const word of words) {
      if (!name.includes(word)) {
        allWords = false;
        break;
      }
    }

    if (allWords && words.length > 1) {
      allWordsMatches.push(file);
      continue;
    }

    // At least one search word exists
    for (const word of words) {
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

// ============================================================
// PAGINATION
// ============================================================

const searchSessions = new Map();

function getTimePH() {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
}

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
      desc || "No files found."
    )
    .setFooter({
      text:
        `Page ${page}/${totalPages} │ ` +
        `Today at ${getTimePH()}`
    });

  const row =
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `search_back_${ownerUserId}_${page}`
        )
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),

      new ButtonBuilder()
        .setCustomId(
          `search_next_${ownerUserId}_${page}`
        )
        .setLabel("Next")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(
          page >= totalPages
        )
    );

  return {
    embeds: [embed],
    components: [row]
  };
}

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ============================================================
// SLASH COMMANDS
// ONLY REGISTERED TO ONE GUILD
// ============================================================

const commands = [

  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription(
      "Set allowed channel for .find and .get (Owner Only)"
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
      "List bot servers (Owner Only)"
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

// ============================================================
// REGISTER COMMANDS
// ============================================================

async function registerCommands() {
  const rest = new REST({
    version: "10"
  }).setToken(TOKEN);

  console.log("🔧 Removing old GLOBAL commands...");

  try {
    // IMPORTANT:
    // Delete old global commands so they don't appear twice.
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: [] }
    );

    console.log(
      "✅ Old global commands removed."
    );
  } catch (err) {
    console.error(
      "⚠️ Could not clear global commands:",
      err.message
    );
  }

  console.log(
    `🔧 Registering commands to guild ${GUILD_ID}...`
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
    "✅ Guild slash commands registered."
  );
}

// ============================================================
// READY
// ============================================================

client.once("ready", async () => {
  console.log("");
  console.log("========================================");
  console.log("🚀 FS BOT ONLINE");
  console.log("========================================");
  console.log(`🤖 Bot: ${client.user.tag}`);
  console.log(`📌 Client ID: ${CLIENT_ID}`);
  console.log(`📌 Guild ID: ${GUILD_ID}`);
  console.log(`👑 Owner ID: ${OWNER_ID}`);
  console.log(`📚 Library: ${libraryFiles.length}`);
  console.log("========================================");

  // NO WATCHING STATUS

  try {
    const guild =
      await client.guilds.fetch(GUILD_ID);

    console.log(
      `🏠 Connected to: ${guild.name}`
    );

    await registerCommands();

    console.log(
      "✅ FS Bot is completely ready."
    );

  } catch (err) {
    console.error(
      "❌ Ready setup failed:",
      err
    );
  }
});

// ============================================================
// FETCH CHANNEL
// ============================================================

async function fetchChannelById(channelId) {
  if (!/^\d+$/.test(channelId)) {
    return null;
  }

  try {
    let channel =
      client.channels.cache.get(channelId);

    if (!channel) {
      channel =
        await client.channels.fetch(
          channelId
        );
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

// ============================================================
// SCAN LOCK
// PREVENT TWO SCANS OF SAME CHANNEL
// ============================================================

const activeScans = new Set();

// ============================================================
// SCAN CHANNEL
// SAFE VERSION
// ============================================================

async function scanChannel(channel) {

  if (!channel || !channel.isTextBased()) {
    throw new Error(
      "That channel cannot be scanned."
    );
  }

  if (activeScans.has(channel.id)) {
    return {
      alreadyRunning: true
    };
  }

  activeScans.add(channel.id);

  try {

    const foundFiles = [];

    let before = null;
    let scanned = 0;
    let batches = 0;

    // Existing library index.
    // IMPORTANT:
    // We do NOT delete the library.
    const unique = new Map();

    for (const file of libraryFiles) {
      const key =
        normalizeFilename(file.name);

      if (!key) continue;

      if (!unique.has(key)) {
        unique.set(key, file);
      }
    }

    while (true) {

      const options = {
        limit: 100
      };

      if (before) {
        options.before = before;
      }

      let batch = null;

      // Do NOT retry forever.
      for (let attempt = 1; attempt <= 3; attempt++) {

        try {

          batch =
            await channel.messages.fetch(
              options
            );

          break;

        } catch (err) {

          console.error(
            `⚠️ Scan fetch error ` +
            `(attempt ${attempt}/3):`,
            err.message
          );

          if (attempt < 3) {
            await new Promise(resolve =>
              setTimeout(
                resolve,
                1000 * attempt
              )
            );
          }
        }
      }

      // If Discord keeps rejecting us,
      // stop instead of hanging forever.
      if (!batch) {
        throw new Error(
          "Discord refused a message fetch after 3 attempts."
        );
      }

      if (batch.size === 0) {
        break;
      }

      batches++;
      scanned += batch.size;

      for (const message of batch.values()) {

        // Normal attachments
        for (
          const attachment
          of message.attachments.values()
        ) {

          const name =
            attachment.name;

          if (!name) continue;

          if (isImageFile(name)) {
            continue;
          }

          foundFiles.push({
            name,
            url: attachment.url,
            size: attachment.size,
            timestamp:
              message.createdTimestamp
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

          for (const snapshot of snapshots) {

            if (!snapshot?.attachments) {
              continue;
            }

            const attachments =
              typeof snapshot
                .attachments
                .values === "function"
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

              const name =
                attachment.name;

              if (!name) continue;

              if (isImageFile(name)) {
                continue;
              }

              foundFiles.push({
                name,
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
        batch.last()?.id;

      if (!before) {
        break;
      }

      if (batch.size < 100) {
        break;
      }

      // Small delay prevents hammering Discord.
      await new Promise(resolve =>
        setTimeout(resolve, 100)
      );
    }

    // ========================================================
    // ADD NEW FILES
    // SAME NAME = SKIP
    // ========================================================

    let added = 0;
    let skipped = 0;

    for (const file of foundFiles) {

      const key =
        normalizeFilename(file.name);

      if (!key) {
        skipped++;
        continue;
      }

      if (!unique.has(key)) {

        unique.set(
          key,
          {
            id: generateId(),
            name: file.name,
            url: file.url,
            size: file.size,
            timestamp:
              file.timestamp ||
              Date.now()
          }
        );

        added++;

      } else {

        skipped++;
      }
    }

    // Replace array contents WITHOUT
    // deleting the actual library file.
    libraryFiles.length = 0;

    libraryFiles.push(
      ...[...unique.values()]
        .sort(
          (a, b) =>
            (a.timestamp || 0) -
            (b.timestamp || 0)
        )
    );

    saveLibrary();

    return {
      alreadyRunning: false,
      added,
      skipped,
      total: libraryFiles.length,
      scanned,
      found: foundFiles.length,
      batches
    };

  } finally {

    activeScans.delete(
      channel.id
    );
  }
}

// ============================================================
// SCAN TXT FILES
// ============================================================

async function scanTxtFiles(channel) {

  if (!channel || !channel.isTextBased()) {
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

    let batch = null;

    for (
      let attempt = 1;
      attempt <= 3;
      attempt++
    ) {

      try {

        batch =
          await channel.messages.fetch(
            options
          );

        break;

      } catch (err) {

        console.error(
          `⚠️ Forward scan error ` +
          `(attempt ${attempt}/3):`,
          err.message
        );

        if (attempt < 3) {
          await new Promise(resolve =>
            setTimeout(
              resolve,
              1000 * attempt
            )
          );
        }
      }
    }

    if (!batch) {
      break;
    }

    if (batch.size === 0) {
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
    }

    before =
      batch.last()?.id;

    if (!before || batch.size < 100) {
      break;
    }

    await new Promise(resolve =>
      setTimeout(resolve, 100)
    );
  }

  return {
    files: foundFiles,
    scanned
  };
}

// ============================================================
// BUTTONS
// ============================================================

client.on(
  "interactionCreate",
  async interaction => {

    try {

      // ======================================================
      // SEARCH BUTTONS
      // ======================================================

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

      // ======================================================
      // SLASH COMMANDS
      // ======================================================

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      // ======================================================
      // /SERVERLIST
      // ======================================================

      if (
        interaction.commandName ===
        "serverlist"
      ) {

        if (
          !isOwnerInteraction(
            interaction
          )
        ) {

          return interaction.reply({
            content:
              "❌ Owner Only.",
            ephemeral: true
          });
        }

        await interaction.reply({
          content:
            `📋 **Bot is only registered for Guild:**\n` +
            `\`${GUILD_ID}\``,
          ephemeral: true
        });

        return;
      }

      // ======================================================
      // /LEAVE
      // ======================================================

      if (
        interaction.commandName ===
        "leave"
      ) {

        if (
          !isOwnerInteraction(
            interaction
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
          ).trim();

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

        const name =
          guild.name;

        try {

          await interaction.reply({
            content:
              `🚪 Leaving **${name}**...`,
            ephemeral: true
          });

          await guild.leave();

        } catch (err) {

          console.error(
            "Leave error:",
            err.message
          );

          if (
            interaction.replied
          ) {
            await interaction.editReply({
              content:
                "❌ Failed to leave the server."
            }).catch(() => {});
          }
        }

        return;
      }

      // ======================================================
      // /SCANCHANNEL
      // ======================================================

      if (
        interaction.commandName ===
        "scanchannel"
      ) {

        if (
          !isOwnerInteraction(
            interaction
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
              "❌ That channel cannot be scanned.",
            ephemeral: true
          });
        }

        // IMPORTANT:
        // Reply immediately.
        // Do NOT wait for the scan.
        await interaction.reply({
          content:
            `🔍 **Scan started!**\n` +
            `📁 Channel: <#${channel.id}>\n` +
            `⚡ The scan is running in the background.`
        });

        // Prevent interaction timeout.
        // Scan continues after the command returns.
        setImmediate(async () => {

          try {

            const result =
              await scanChannel(
                channel
              );

            if (
              result.alreadyRunning
            ) {

              await interaction.editReply({
                content:
                  `⚠️ A scan is already running for <#${channel.id}>.`
              }).catch(() => {});

              return;
            }

            const text =
              `✅ **SCAN COMPLETE**\n\n` +
              `📁 **Channel:** <#${channel.id}>\n` +
              `📨 **Messages scanned:** ${result.scanned}\n` +
              `📦 **Files found:** ${result.found}\n` +
              `✅ **Added:** ${result.added}\n` +
              `⏭️ **Skipped:** ${result.skipped}\n` +
              `📚 **Library total:** ${result.total}`;

            // Edit original reply if still possible.
            const edited =
              await interaction
                .editReply({
                  content: text
                })
                .then(
                  () => true,
                  () => false
                );

            // If webhook expired,
            // send a normal channel message instead.
            if (!edited) {

              await channel.send({
                content: text
              }).catch(() => {});

            }

          } catch (err) {

            console.error(
              "❌ Background scan error:",
              err
            );

            const errorText =
              `❌ **SCAN FAILED**\n` +
              `Reason: ${err.message}`;

            const edited =
              await interaction
                .editReply({
                  content: errorText
                })
                .then(
                  () => true,
                  () => false
                );

            if (!edited) {

              await channel.send({
                content: errorText
              }).catch(() => {});

            }
          }

        });

        return;
      }

      // ======================================================
      // /FORWARDALL
      // ======================================================

      if (
        interaction.commandName ===
        "forwardall"
      ) {

        if (
          !isOwnerInteraction(
            interaction
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

        // Acknowledge immediately.
        await interaction.reply({
          content:
            `🔄 **Starting forward...**\n` +
            `From: <#${sourceId}>\n` +
            `To: <#${destinationId}>`
        });

        setImmediate(async () => {

          try {

            const source =
              await fetchChannelById(
                sourceId
              );

            if (
              !source ||
              !source.isTextBased()
            ) {

              await interaction.editReply({
                content:
                  `❌ Invalid source channel: \`${sourceId}\``
              }).catch(() => {});

              return;
            }

            const destination =
              await fetchChannelById(
                destinationId
              );

            if (
              !destination ||
              !destination.isTextBased()
            ) {

              await interaction.editReply({
                content:
                  `❌ Invalid destination channel: \`${destinationId}\``
              }).catch(() => {});

              return;
            }

            const {
              files,
              scanned
            } = await scanTxtFiles(
              source
            );

            if (files.length === 0) {

              await interaction.editReply({
                content:
                  `❌ No .txt files found.\n` +
                  `📨 Scanned: ${scanned} messages.`
              }).catch(() => {});

              return;
            }

            let sent = 0;
            let failed = 0;

            const total =
              files.length;

            // Discord rate limits sending.
            // Keep this controlled instead of firing
            // hundreds of requests simultaneously.
            const BATCH_SIZE = 3;

            for (
              let i = 0;
              i < files.length;
              i += BATCH_SIZE
            ) {

              const batch =
                files.slice(
                  i,
                  i + BATCH_SIZE
                );

              const results =
                await Promise.allSettled(
                  batch.map(file =>
                    destination.send({
                      files: [{
                        attachment:
                          file.url,
                        name:
                          file.name
                      }]
                    })
                  )
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

              // Update every batch.
              await interaction
                .editReply({
                  content:
                    `🔄 **Forwarding...**\n` +
                    `⚡ ${sent}/${total}\n` +
                    `From: <#${sourceId}> → <#${destinationId}>`
                })
                .catch(() => {});

              await new Promise(
                resolve =>
                  setTimeout(
                    resolve,
                    150
                  )
              );
            }

            await interaction
              .editReply({
                content:
                  `✅ **FORWARD COMPLETE**\n\n` +
                  `📁 From: <#${sourceId}>\n` +
                  `📤 To: <#${destinationId}>\n` +
                  `📨 Scanned: ${scanned}\n` +
                  `📦 Files found: ${total}\n` +
                  `✅ Sent: ${sent}\n` +
                  `❌ Failed: ${failed}`
              })
              .catch(() => {});

          } catch (err) {

            console.error(
              "❌ Forward error:",
              err
            );

            await interaction
              .editReply({
                content:
                  `❌ Forward failed: ${err.message}`
              })
              .catch(() => {});
          }

        });

        return;
      }

      // ======================================================
      // /SETCHANNEL
      // ======================================================

      if (
        interaction.commandName ===
        "setchannel"
      ) {

        if (
          !isOwnerInteraction(
            interaction
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
            `🔗 .find and .get are allowed in <#${interaction.channelId}>`
        });
      }

      // ======================================================
      // /EMBED
      // ======================================================

      if (
        interaction.commandName ===
        "embed"
      ) {

        if (
          !interaction.memberPermissions?.has(
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

        // Immediately acknowledge then delete.
        await interaction.reply({
          content: "✅",
          ephemeral: true
        });

        await interaction.deleteReply()
          .catch(() => {});

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

      // Don't try to reply twice.
      try {

        if (
          interaction.replied ||
          interaction.deferred
        ) {

          await interaction.editReply({
            content:
              "❌ Something went wrong."
          }).catch(() => {});

        } else {

          await interaction.reply({
            content:
              "❌ Something went wrong.",
            ephemeral: true
          }).catch(() => {});

        }

      } catch {}
    }
  }
);

// ============================================================
// PREFIX COMMANDS
// .find
// .get
// ============================================================

client.on(
  "messageCreate",
  async message => {

    try {

      if (message.author.bot) {
        return;
      }

      const content =
        message.content.trim();

      // ======================================================
      // CHANNEL PERMISSION
      // ======================================================

      const allowed =
        !config.allowedChannelId ||
        message.channel.id ===
          config.allowedChannelId ||
        message.author.id ===
          OWNER_ID;

      // ======================================================
      // .find
      // ======================================================

      if (
        content === ".find" ||
        content.startsWith(".find ")
      ) {

        if (!allowed) {

          return message.reply(
            "❌ not allowed here, dumbass."
          );
        }

        const query =
          content
            .slice(5)
            .trim();

        if (!query) {

          return message.reply(
            "❌ enter a file name to search."
          );
        }

        // Search is local and extremely fast.
        const results =
          searchFiles(query);

        if (
          results.length === 0
        ) {

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

      // ======================================================
      // .get
      // ======================================================

      if (
        content === ".get" ||
        content.startsWith(".get ")
      ) {

        if (!allowed) {

          return message.reply(
            "❌ not allowed here, dumbass."
          );
        }

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

        // Send immediately.
        if (
          file.isLocal &&
          fs.existsSync(file.url)
        ) {

          await message.channel.send({
            content:
              `<@${message.author.id}> Here is your file.`,
            files: [{
              attachment:
                file.url,
              name:
                file.name
            }]
          });

        } else {

          await message.channel.send({
            content:
              `<@${message.author.id}> Here is your file.`,
            files: [{
              attachment:
                file.url,
              name:
                file.name
            }]
          });
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
// ERROR HANDLING
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

// ============================================================
// LOGIN
// ============================================================

console.log("");
console.log("========================================");
console.log("🔑 CONNECTING TO DISCORD");
console.log("========================================");

client.login(TOKEN)
  .then(() => {
    console.log(
      "🔐 Discord login request sent."
    );
  })
  .catch(error => {
    console.error(
      "❌ Discord login failed:",
      error
    );

    process.exit(1);
  });
