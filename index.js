const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
  AttachmentBuilder
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");

// ============================================================
// ENV
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const OWNER_ID = "1302080645987569694";
const ACCESS_ROLE_ID = "1539883004950876160";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID.");
  process.exit(1);
}

// ============================================================
// STORAGE
// ============================================================

const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;

const LIBRARY_FILE = path.join(
  DATA_DIR,
  "file-library.json"
);

const CONFIG_FILE = path.join(
  DATA_DIR,
  "config.json"
);

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch (error) {
    console.error(
      `❌ Failed to read ${path.basename(file)}:`,
      error.message
    );

    return fallback;
  }
}

function writeJSON(file, data) {
  const temp = `${file}.tmp`;

  try {
    fs.writeFileSync(
      temp,
      JSON.stringify(data, null, 2),
      "utf8"
    );

    fs.renameSync(temp, file);
  } catch (error) {
    console.error(
      `❌ Failed to save ${path.basename(file)}:`,
      error.message
    );
  }
}

let config = readJSON(
  CONFIG_FILE,
  {
    allowedChannelId: null
  }
);

if (
  !config ||
  typeof config !== "object"
) {
  config = {
    allowedChannelId: null
  };
}

let libraryData = readJSON(
  LIBRARY_FILE,
  {
    files: []
  }
);

if (Array.isArray(libraryData)) {
  libraryData = {
    files: libraryData
  };
}

if (!Array.isArray(libraryData.files)) {
  libraryData.files = [];
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

let isReady = false;
let registrationStarted = false;

const runningScans = new Set();

// ============================================================
// HELPERS
// ============================================================

function isAllowedUser(member) {
  if (!member) {
    return false;
  }

  return (
    member.id === OWNER_ID ||
    member.roles?.cache?.has(
      ACCESS_ROLE_ID
    )
  );
}

function getTodayTime() {
  return new Date().toLocaleTimeString(
    "en-US",
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Manila"
    }
  );
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /\.[^/.]+$/,
      ""
    )
    .replace(
      /[_\-.()[\]{}]+/g,
      " "
    )
    .replace(
      /[^a-z0-9\s]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function fileExtension(name) {
  const match = String(name || "")
    .match(/\.([a-z0-9]+)$/i);

  return match
    ? match[1].toLowerCase()
    : "";
}

function isImage(name, contentType) {
  const filename =
    String(name || "").toLowerCase();

  const type =
    String(contentType || "").toLowerCase();

  return (
    type.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|ico|avif|heic|heif)$/i.test(
      filename
    )
  );
}

function isTextFile(name) {
  return fileExtension(name) === "txt";
}

function makeId() {
  let id;

  do {
    id = Math.random()
      .toString(36)
      .slice(2, 10);
  } while (
    libraryData.files.some(
      file => file.id === id
    )
  );

  return id;
}

function saveLibrary() {
  writeJSON(
    LIBRARY_FILE,
    libraryData
  );
}

function saveConfig() {
  writeJSON(
    CONFIG_FILE,
    config
  );
}

function getFileById(id) {
  const clean =
    String(id || "").trim();

  return (
    libraryData.files.find(
      file => file.id === clean
    ) || null
  );
}

function searchFiles(query) {
  const q = normalizeName(query);

  if (!q) {
    return [];
  }

  const tokens =
    q.split(" ").filter(Boolean);

  return libraryData.files
    .map(file => {
      const name =
        normalizeName(file.filename);

      let score = 0;

      if (name === q) {
        score += 1000;
      }

      if (name.includes(q)) {
        score += 500;
      }

      for (const token of tokens) {
        if (name.includes(token)) {
          score += 100;
        } else {
          const words =
            name.split(" ");

          if (
            words.some(
              word =>
                word.startsWith(token)
            )
          ) {
            score += 60;
          }
        }
      }

      return {
        file,
        score
      };
    })
    .filter(
      result => result.score > 0
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .map(
      result => result.file
    );
}

function allowedChannel(message) {
  if (!config.allowedChannelId) {
    return true;
  }

  return (
    message.channelId ===
    config.allowedChannelId
  );
}

// ============================================================
// SAFE MESSAGE FETCH
// ============================================================

async function fetchMessagesSafely(
  channel,
  before
) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    try {
      const options = {
        limit: 100
      };

      if (before) {
        options.before = before;
      }

      return await channel.messages.fetch(
        options
      );
    } catch (error) {
      lastError = error;

      console.warn(
        `⚠️ Message fetch failed (${attempt}/3):`,
        error?.message || error
      );

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            700 * attempt
          )
      );
    }
  }

  throw (
    lastError ||
    new Error(
      "Could not fetch messages."
    )
  );
}

// ============================================================
// ATTACHMENT COLLECTION
// ============================================================

function collectAttachments(message) {
  const result = [];

  if (message.attachments?.size) {
    for (
      const attachment of
      message.attachments.values()
    ) {
      if (
        isImage(
          attachment.name,
          attachment.contentType
        )
      ) {
        continue;
      }

      result.push({
        attachment,
        forwarded: false
      });
    }
  }

  if (message.messageSnapshots?.size) {
    for (
      const snapshot of
      message.messageSnapshots.values()
    ) {
      if (
        !snapshot?.attachments?.size
      ) {
        continue;
      }

      for (
        const attachment of
        snapshot.attachments.values()
      ) {
        if (
          isImage(
            attachment.name,
            attachment.contentType
          )
        ) {
          continue;
        }

        result.push({
          attachment,
          forwarded: true
        });
      }
    }
  }

  return result;
}

// ============================================================
// SCAN CHANNEL
// ============================================================

async function scanChannel(channel) {
  if (
    !channel ||
    !channel.isTextBased() ||
    !channel.messages
  ) {
    throw new Error(
      "That isn't a readable text channel."
    );
  }

  if (
    runningScans.has(channel.id)
  ) {
    throw new Error(
      "That channel is already being scanned."
    );
  }

  runningScans.add(channel.id);

  try {
    const existingNames =
      new Set(
        libraryData.files.map(
          file =>
            normalizeName(
              file.filename
            )
        )
      );

    const found = [];

    let before = null;
    let messageCount = 0;
    let pages = 0;

    while (true) {
      const batch =
        await fetchMessagesSafely(
          channel,
          before
        );

      pages++;

      if (!batch.size) {
        break;
      }

      for (
        const message of
        batch.values()
      ) {
        messageCount++;

        const attachments =
          collectAttachments(
            message
          );

        for (
          const item of attachments
        ) {
          const attachment =
            item.attachment;

          const filename =
            attachment.name ||
            "unknown_file";

          const normalized =
            normalizeName(filename);

          if (!normalized) {
            continue;
          }

          // Prevent duplicate filenames.
          if (
            existingNames.has(
              normalized
            )
          ) {
            continue;
          }

          const url =
            attachment.url ||
            attachment.proxyURL ||
            attachment.proxy_url;

          if (!url) {
            continue;
          }

          const entry = {
            id: makeId(),
            filename,
            url,
            size: Number(
              attachment.size || 0
            ),
            contentType:
              attachment.contentType ||
              null,
            channelId:
              message.channelId,
            messageId: message.id,
            attachmentId:
              String(attachment.id),
            forwarded:
              item.forwarded,
            createdTimestamp:
              message.createdTimestamp ||
              Date.now(),
            scannedAt:
              Date.now()
          };

          existingNames.add(
            normalized
          );

          found.push(entry);
        }
      }

      const oldest =
        batch.last();

      if (
        !oldest ||
        batch.size < 100
      ) {
        break;
      }

      before = oldest.id;

      // Let Node handle other events.
      await new Promise(
        resolve =>
          setImmediate(resolve)
      );
    }

    // IMPORTANT:
    // Existing library files are NOT deleted.
    libraryData.files.push(
      ...found
    );

    libraryData.files.sort(
      (a, b) =>
        Number(
          a.createdTimestamp || 0
        ) -
        Number(
          b.createdTimestamp || 0
        )
    );

    saveLibrary();

    console.log(
      `📂 Scan complete | #${channel.name} | ${messageCount} messages | ${found.length} new files | ${pages} pages`
    );

    return {
      messageCount,
      fileCount: found.length,
      totalFiles:
        libraryData.files.length
    };
  } finally {
    runningScans.delete(
      channel.id
    );
  }
}

// ============================================================
// DOWNLOAD
// ============================================================

async function downloadURL(url) {
  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  return Buffer.from(
    await response.arrayBuffer()
  );
}

// ============================================================
// FORWARD TXT FILES
// ============================================================

async function forwardTxtFiles(
  source,
  destination
) {
  if (
    !source?.isTextBased() ||
    !source.messages
  ) {
    throw new Error(
      "Source channel is not readable."
    );
  }

  if (
    !destination?.isTextBased()
  ) {
    throw new Error(
      "Destination channel is not writable."
    );
  }

  let before = null;
  let messageCount = 0;
  let sent = 0;

  while (true) {
    const batch =
      await fetchMessagesSafely(
        source,
        before
      );

    if (!batch.size) {
      break;
    }

    for (
      const message of
      batch.values()
    ) {
      messageCount++;

      for (
        const attachment of
        message.attachments.values()
      ) {
        const filename =
          attachment.name ||
          "file.txt";

        if (
          !isTextFile(filename)
        ) {
          continue;
        }

        if (
          isImage(
            filename,
            attachment.contentType
          )
        ) {
          continue;
        }

        try {
          const buffer =
            await downloadURL(
              attachment.url
            );

          await destination.send({
            files: [
              new AttachmentBuilder(
                buffer,
                {
                  name: filename
                }
              )
            ]
          });

          sent++;
        } catch (error) {
          console.error(
            `⚠️ Failed to forward ${filename}:`,
            error?.message || error
          );
        }
      }
    }

    const oldest =
      batch.last();

    if (
      !oldest ||
      batch.size < 100
    ) {
      break;
    }

    before = oldest.id;

    await new Promise(
      resolve =>
        setImmediate(resolve)
    );
  }

  return {
    messageCount,
    sent
  };
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [
  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription(
      "Scan a channel for files."
    )
    .addChannelOption(
      option =>
        option
          .setName("channel")
          .setDescription(
            "Channel to scan."
          )
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
          )
          .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription(
      "Send a gray embed."
    )
    .addStringOption(
      option =>
        option
          .setName("description")
          .setDescription(
            "Embed description."
          )
          .setRequired(true)
    )
    .addStringOption(
      option =>
        option
          .setName("title")
          .setDescription(
            "Embed title."
          )
          .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("forwardall")
    .setDescription(
      "Forward all TXT files from one channel to another."
    )
    .addChannelOption(
      option =>
        option
          .setName("source")
          .setDescription(
            "Source channel."
          )
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
          )
          .setRequired(true)
    )
    .addChannelOption(
      option =>
        option
          .setName("destination")
          .setDescription(
            "Destination channel."
          )
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
          )
          .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription(
      "Set this channel for .get and .find."
    )
].map(
  command => command.toJSON()
);

// ============================================================
// REGISTER SLASH COMMANDS
// ============================================================

async function registerCommands() {
  if (registrationStarted) {
    return;
  }

  registrationStarted = true;

  const rest =
    new REST({
      version: "10"
    }).setToken(TOKEN);

  try {
    console.log(
      "🧹 Removing old global slash commands..."
    );

    await rest.put(
      Routes.applicationCommands(
        CLIENT_ID
      ),
      {
        body: []
      }
    );

    console.log(
      "🧹 Replacing guild slash commands..."
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
      "✅ Slash commands registered."
    );
  } catch (error) {
    registrationStarted = false;

    console.error(
      "❌ Slash command registration failed:",
      error?.message || error
    );
  }
}

registerCommands().catch(
  error => {
    registrationStarted = false;

    console.error(
      "❌ Registration error:",
      error
    );
  }
);

// ============================================================
// READY
// ============================================================

client.once(
  "ready",
  () => {
    isReady = true;

    console.log(
      "=========================================="
    );

    console.log(
      `✅ DISCORD READY: ${client.user.tag}`
    );

    console.log(
      `🏠 Guilds: ${client.guilds.cache.size}`
    );

    console.log(
      `📂 Library: ${libraryData.files.length} files`
    );

    console.log(
      "⚡ Commands are ready."
    );

    console.log(
      "=========================================="
    );
  }
);

client.on(
  "shardReady",
  shardId => {
    isReady = true;

    console.log(
      `🟢 Gateway shard ${shardId} ready.`
    );
  }
);

client.on(
  "shardReconnecting",
  shardId => {
    isReady = false;

    console.warn(
      `🟡 Gateway shard ${shardId} reconnecting...`
    );
  }
);

client.on(
  "shardDisconnect",
  (event, shardId) => {
    isReady = false;

    console.warn(
      `🔴 Gateway shard ${shardId} disconnected:`,
      event?.code ||
        "unknown"
    );
  }
);

client.on(
  "shardResume",
  (
    shardId,
    replayedEvents
  ) => {
    isReady = true;

    console.log(
      `🟢 Gateway shard ${shardId} resumed (${replayedEvents} events replayed).`
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

client.on(
  "warn",
  warning => {
    console.warn(
      "⚠️ Discord warning:",
      warning
    );
  }
);

// ============================================================
// INTERACTIONS
// ============================================================

client.on(
  "interactionCreate",
  async interaction => {
    try {
      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      if (
        interaction.guildId !==
        GUILD_ID
      ) {
        await interaction.reply({
          content:
            "❌ This bot is not configured for this server.",
          flags:
            MessageFlags.Ephemeral
        }).catch(() => {});

        return;
      }

      const member =
        interaction.member;

      if (
        !isAllowedUser(member)
      ) {
        await interaction.reply({
          content:
            "❌ You don't have permission to use this command.",
          flags:
            MessageFlags.Ephemeral
        }).catch(() => {});

        return;
      }

      // ========================================================
      // /setchannel
      // ========================================================

      if (
        interaction.commandName ===
        "setchannel"
      ) {
        // Immediate response.
        await interaction.reply({
          content:
            `⚡ Setting channel to <#${interaction.channelId}>...`,
          flags:
            MessageFlags.Ephemeral
        });

        config.allowedChannelId =
          interaction.channelId;

        saveConfig();

        await interaction.editReply({
          content:
            `✅ .get and .find are now active in <#${interaction.channelId}>.`
        });

        return;
      }

      // ========================================================
      // /embed
      // ========================================================

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

        const embed =
          new EmbedBuilder()
            .setColor(0x808080)
            .setDescription(
              description
            )
            .setFooter({
              text:
                `Today at ${getTodayTime()}`
            });

        if (title) {
          embed.setTitle(title);
        }

        await interaction.reply({
          content: "",
          flags:
            MessageFlags.Ephemeral
        });

        await interaction.deleteReply()
          .catch(() => {});

        await interaction.channel.send({
          embeds: [embed]
        });

        return;
      }

      // ========================================================
      // /scanchannel
      // ========================================================

      if (
        interaction.commandName ===
        "scanchannel"
      ) {
        const channel =
          interaction.options.getChannel(
            "channel"
          );

        if (
          !channel ||
          !channel.isTextBased() ||
          !channel.messages
        ) {
          await interaction.reply({
            content:
              "❌ That isn't a readable text channel.",
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        if (
          runningScans.has(
            channel.id
          )
        ) {
          await interaction.reply({
            content:
              "⚠️ That channel is already being scanned.",
            flags:
              MessageFlags.Ephemeral
          });

          return;
        }

        // CRITICAL:
        // Reply BEFORE scanning.
        await interaction.reply({
          content:
            `⚡ Scan started for <#${channel.id}>.\n` +
            `The bot will scan in the background so the command doesn't time out.`,
          flags:
            MessageFlags.Ephemeral
        });

        // Background scan.
        scanChannel(channel)
          .then(
            async result => {
              await interaction
                .editReply({
                  content:
                    `✅ **Scan complete.**\n\n` +
                    `📂 Channel: <#${channel.id}>\n` +
                    `💬 Messages scanned: \`${result.messageCount}\`\n` +
                    `📄 New files: \`${result.fileCount}\`\n` +
                    `📚 Total library files: \`${result.totalFiles}\`\n` +
                    `🖼️ Images: ignored\n` +
                    `♻️ Existing library files were kept.`
                })
                .catch(
                  error => {
                    console.error(
                      "❌ Could not edit scan reply:",
                      error.message
                    );
                  }
                );
            }
          )
          .catch(
            async error => {
              console.error(
                "❌ Scan error:",
                error
              );

              await interaction
                .editReply({
                  content:
                    `❌ **Scan failed.**\n\`${String(
                      error?.message ||
                        error
                    ).slice(
                      0,
                      1500
                    )}\``
                })
                .catch(
                  () => {}
                );
            }
          );

        return;
      }

      // ========================================================
      // /forwardall
      // ========================================================

      if (
        interaction.commandName ===
        "forwardall"
      ) {
        const source =
          interaction.options.getChannel(
            "source"
          );

        const destination =
          interaction.options.getChannel(
            "destination"
          );

        // Immediate acknowledgement.
        await interaction.reply({
          content:
            `⚡ Forwarding TXT files from <#${source.id}> to <#${destination.id}>...`,
          flags:
            MessageFlags.Ephemeral
        });

        forwardTxtFiles(
          source,
          destination
        )
          .then(
            async result => {
              await interaction
                .editReply({
                  content:
                    `✅ **Forward complete.**\n\n` +
                    `📂 Source: <#${source.id}>\n` +
                    `📂 Destination: <#${destination.id}>\n` +
                    `💬 Messages checked: \`${result.messageCount}\`\n` +
                    `📄 TXT files forwarded: \`${result.sent}\``
                })
                .catch(
                  () => {}
                );
            }
          )
          .catch(
            async error => {
              console.error(
                "❌ Forward error:",
                error
              );

              await interaction
                .editReply({
                  content:
                    `❌ **Forward failed.**\n\`${String(
                      error?.message ||
                        error
                    ).slice(
                      0,
                      1500
                    )}\``
                })
                .catch(
                  () => {}
                );
            }
          );

        return;
      }
    } catch (error) {
      console.error(
        "❌ Interaction error:",
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction
          .reply({
            content:
              "❌ An error occurred.",
            flags:
              MessageFlags.Ephemeral
          })
          .catch(() => {});
      } else {
        await interaction
          .editReply({
            content:
              "❌ An error occurred while processing the command."
          })
          .catch(() => {});
      }
    }
  }
);

// ============================================================
// PREFIX COMMANDS
// ============================================================

client.on(
  "messageCreate",
  message => {
    // IMPORTANT:
    // Keep this handler fast.
    // Do not put scanning before command parsing.

    if (message.author.bot) {
      return;
    }

    if (!message.guild) {
      return;
    }

    const content =
      String(
        message.content || ""
      ).trim();

    // ========================================================
    // .get
    // ========================================================

    if (
      /^\.get(?:\s|$)/i.test(
        content
      )
    ) {
      const parts =
        content.split(/\s+/);

      const id = parts[1];

      if (
        !allowedChannel(message)
      ) {
        message.channel.send(
          "❌ not here, dumbass."
        ).catch(() => {});

        return;
      }

      if (!id) {
        message.channel.send(
          "❌ put id of file, idiot."
        ).catch(() => {});

        return;
      }

      const file =
        getFileById(id);

      if (!file) {
        message.channel.send(
          "❌ your id is wrong, try find working id, dumbass."
        ).catch(() => {});

        return;
      }

      // FAST PATH:
      // Send the Discord CDN URL directly.
      message.channel.send({
        content:
          "**Here is the file twin!**",

        files: [
          {
            attachment: file.url,
            name:
              file.filename ||
              "file"
          }
        ]
      }).catch(
        async () => {
          // Try refreshing the URL.
          try {
            const channel =
              await client.channels.fetch(
                file.channelId
              );

            const original =
              await channel.messages.fetch(
                file.messageId
              );

            let fresh =
              original.attachments.get(
                file.attachmentId
              );

            if (
              !fresh &&
              original.messageSnapshots?.size
            ) {
              for (
                const snapshot of
                original.messageSnapshots.values()
              ) {
                fresh =
                  snapshot.attachments?.get(
                    file.attachmentId
                  );

                if (fresh) {
                  break;
                }
              }
            }

            if (
              !fresh?.url
            ) {
              throw new Error(
                "Attachment no longer exists."
              );
            }

            file.url =
              fresh.url;

            saveLibrary();

            await message.channel.send({
              content:
                "**Here is the file twin!**",

              files: [
                {
                  attachment:
                    fresh.url,
                  name:
                    file.filename ||
                    "file"
                }
              ]
            });
          } catch {
            await message.channel.send(
              "❌ I found the file, but its Discord attachment is no longer available."
            ).catch(() => {});
          }
        }
      );

      return;
    }

    // ========================================================
    // .find
    // ========================================================

    if (
      /^\.find(?:\s|$)/i.test(
        content
      )
    ) {
      if (
        !allowedChannel(message)
      ) {
        message.channel.send(
          "❌ not here, dumbass."
        ).catch(() => {});

        return;
      }

      const query =
        content
          .slice(5)
          .trim();

      if (!query) {
        message.channel.send(
          "❌ not here, dumbass."
        ).catch(() => {});

        return;
      }

      const results =
        searchFiles(query);

      if (!results.length) {
        message.channel.send(
          "❌ no matching name for that, dumbass."
        ).catch(() => {});

        return;
      }

      const shown =
        results.slice(0, 20);

      const lines =
        shown.map(
          (file, index) =>
            `**${index + 1}.** \`${file.filename}\` — ID: \`${file.id}\``
        );

      const embed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setTitle(
            "File Search"
          )
          .setDescription(
            lines.join("\n")
          )
          .setFooter({
            text:
              `${results.length} result(s)`
          });

      message.channel.send({
        embeds: [embed]
      }).catch(() => {});

      return;
    }
  }
);

// ============================================================
// EXPRESS SERVER
// ============================================================

const app = express();

const PORT =
  Number(process.env.PORT) ||
  10000;

app.get(
  "/",
  (req, res) => {
    res.status(200).send(
      isReady
        ? "FS Bot is online and connected to Discord."
        : "FS Bot process is online, Discord is connecting."
    );
  }
);

app.get(
  "/health",
  (req, res) => {
    res.status(200).json({
      process: "online",

      discord:
        isReady
          ? "ready"
          : "not-ready",

      bot:
        client.user?.tag ||
        null,

      guild:
        GUILD_ID,

      libraryFiles:
        libraryData.files.length,

      allowedChannelId:
        config.allowedChannelId
    });
  }
);

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `🌐 HTTP server listening on 0.0.0.0:${PORT}`
    );
  }
);

// ============================================================
// ERROR HANDLERS
// ============================================================

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

console.log(
  "🔑 Connecting to Discord..."
);

client.login(TOKEN)
  .catch(error => {
    console.error(
      "❌ Discord login failed:",
      error
    );

    process.exit(1);
  });
