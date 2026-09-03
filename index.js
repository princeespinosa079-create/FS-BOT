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
  console.error(
    "❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID."
  );
  process.exit(1);
}

// ============================================================
// STORAGE
// ============================================================

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

function readJSON(file, fallback) {
  try {
    return fs.existsSync(file)
      ? JSON.parse(
          fs.readFileSync(file, "utf8")
        )
      : fallback;
  } catch (e) {
    console.error(
      `❌ ${path.basename(file)}:`,
      e.message
    );

    return fallback;
  }
}

function writeJSON(file, data) {
  const tmp = `${file}.tmp`;

  try {
    fs.writeFileSync(
      tmp,
      JSON.stringify(data, null, 2)
    );

    fs.renameSync(tmp, file);
  } catch (e) {
    console.error(
      `❌ Saving ${path.basename(file)}:`,
      e.message
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

let library = readJSON(
  LIBRARY_FILE,
  {
    files: []
  }
);

if (Array.isArray(library)) {
  library = {
    files: library
  };
}

if (!Array.isArray(library.files)) {
  library.files = [];
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

const runningScans = new Set();

let isReady = false;
let lastReady = Date.now();
let registering = false;
let reconnecting = false;

// ============================================================
// BASIC HELPERS
// ============================================================

const saveLibrary = () =>
  writeJSON(
    LIBRARY_FILE,
    library
  );

const saveConfig = () =>
  writeJSON(
    CONFIG_FILE,
    config
);

function isAllowed(member) {
  if (!member) return false;

  return (
    member.id === OWNER_ID ||
    member.roles?.cache?.has(
      ACCESS_ROLE_ID
    )
  );
}

function channelAllowed(target) {
  if (!config.allowedChannelId) {
    return true;
  }

  return (
    target.channelId ===
    config.allowedChannelId
  );
}

// Real Discord reply.
// Mention User = ON.
function replyUser(message, payload) {
  const body =
    typeof payload === "string"
      ? {
          content: payload
        }
      : {
          ...payload
        };

  body.allowedMentions = {
    ...(body.allowedMentions || {}),
    repliedUser: true
  };

  return message.reply(body);
}

// ============================================================
// FILE SEARCH HELPERS
// ============================================================

function normalize(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[^/.]+$/, "")
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

function ext(name) {
  const match =
    String(name || "")
      .match(
        /\.([a-z0-9]+)$/i
      );

  return match
    ? match[1].toLowerCase()
    : "";
}

function isImage(
  name,
  contentType
) {
  return (
    String(
      contentType || ""
    )
      .toLowerCase()
      .startsWith("image/") ||

    /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|ico|avif|heic|heif)$/i
      .test(
        String(name || "")
      )
  );
}

function idForFile() {
  let id;

  do {
    id =
      Math.random()
        .toString(36)
        .slice(2, 10);
  } while (
    library.files.some(
      file => file.id === id
    )
  );

  return id;
}

function getFile(id) {
  return library.files.find(
    file =>
      file.id ===
      String(id || "").trim()
  ) || null;
}

function findFiles(query) {
  query = normalize(query);

  if (!query) {
    return [];
  }

  const tokens =
    query
      .split(" ")
      .filter(Boolean);

  return library.files
    .map(file => {
      const name =
        normalize(
          file.filename
        );

      let score = 0;

      if (name === query) {
        score += 1000;
      }

      if (
        name.includes(query)
      ) {
        score += 500;
      }

      for (
        const token of tokens
      ) {
        if (
          name.includes(token)
        ) {
          score += 100;
        } else if (
          name
            .split(" ")
            .some(
              word =>
                word.startsWith(
                  token
                )
            )
        ) {
          score += 60;
        }
      }

      return {
        file,
        score
      };
    })
    .filter(
      item =>
        item.score > 0
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .map(
      item => item.file
    );
}

// ============================================================
// DISCORD MESSAGE FETCH
// ============================================================

async function fetchMessages(
  channel,
  before
) {
  let lastError;

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
        `⚠️ Fetch messages ${attempt}/3:`,
        error.message
      );

      if (attempt < 3) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              500 * attempt
            )
        );
      }
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

function attachmentsOf(message) {
  const result = [];

  for (
    const attachment of
    message.attachments
      ?.values?.() || []
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

  for (
    const snapshot of
    message.messageSnapshots
      ?.values?.() || []
  ) {
    for (
      const attachment of
      snapshot.attachments
        ?.values?.() || []
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

  return result;
}

// ============================================================
// SCAN CHANNEL
// ============================================================

async function scanChannel(
  channel
) {
  if (
    !channel?.isTextBased?.() ||
    !channel.messages
  ) {
    throw new Error(
      "That isn't a readable text channel."
    );
  }

  if (
    runningScans.has(
      channel.id
    )
  ) {
    throw new Error(
      "That channel is already being scanned."
    );
  }

  runningScans.add(
    channel.id
  );

  try {
    // NEVER delete the existing library.
    const existingNames =
      new Set(
        library.files.map(
          file =>
            normalize(
              file.filename
            )
        )
      );

    const found = [];

    let before = null;
    let messages = 0;
    let pages = 0;

    while (true) {
      const batch =
        await fetchMessages(
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
        messages++;

        for (
          const item of
          attachmentsOf(
            message
          )
        ) {
          const attachment =
            item.attachment;

          const filename =
            attachment.name ||
            "unknown_file";

          const normalized =
            normalize(
              filename
            );

          const url =
            attachment.url ||
            attachment.proxyURL ||
            attachment.proxy_url;

          if (
            !normalized ||
            !url
          ) {
            continue;
          }

          // Same filename = already scanned.
          if (
            existingNames.has(
              normalized
            )
          ) {
            continue;
          }

          existingNames.add(
            normalized
          );

          found.push({
            id: idForFile(),
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
            messageId:
              message.id,
            attachmentId:
              String(
                attachment.id
              ),
            forwarded:
              item.forwarded,
            createdTimestamp:
              message.createdTimestamp ||
              Date.now(),
            scannedAt:
              Date.now()
          });
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

      before =
        oldest.id;

      // Give Discord events a chance to run.
      await new Promise(
        resolve =>
          setImmediate(
            resolve
          )
      );
    }

    library.files.push(
      ...found
    );

    library.files.sort(
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
      `📂 Scan complete | #${channel.name} | ` +
      `${messages} messages | ` +
      `${found.length} new files | ` +
      `${pages} pages`
    );

    return {
      messages,
      found:
        found.length,
      total:
        library.files.length
    };
  } finally {
    runningScans.delete(
      channel.id
    );
  }
}

// ============================================================
// FORWARD TXT FILES
// ============================================================

async function downloadURL(
  url
) {
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

async function forwardTxt(
  source,
  destination
) {
  if (
    !source?.isTextBased?.() ||
    !source.messages
  ) {
    throw new Error(
      "Source channel is not readable."
    );
  }

  if (
    !destination?.isTextBased?.()
  ) {
    throw new Error(
      "Destination channel is not writable."
    );
  }

  let before = null;
  let messages = 0;
  let sent = 0;

  while (true) {
    const batch =
      await fetchMessages(
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
      messages++;

      for (
        const attachment of
        message.attachments.values()
      ) {
        if (
          ext(
            attachment.name
          ) !== "txt"
        ) {
          continue;
        }

        if (
          isImage(
            attachment.name,
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
                  name:
                    attachment.name ||
                    "file.txt"
                }
              )
            ]
          });

          sent++;
        } catch (error) {
          console.error(
            `⚠️ Forward ${attachment.name}:`,
            error.message
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

    before =
      oldest.id;

    await new Promise(
      resolve =>
        setImmediate(
          resolve
        )
    );
  }

  return {
    messages,
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
      "Forward all TXT files."
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
      "Set the normal channel for .get/.find."
    )
].map(
  command =>
    command.toJSON()
);

// ============================================================
// REGISTER SLASH COMMANDS
// ============================================================

async function registerCommands() {
  if (registering) {
    return;
  }

  registering = true;

  const rest =
    new REST({
      version: "10",
      timeout: 15000
    }).setToken(
      TOKEN
    );

  try {
    console.log(
      "🧹 Removing old global commands..."
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
      "🧩 Registering guild commands..."
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
    registering = false;

    console.error(
      "❌ Slash registration failed:",
      error.message
    );
  }
}

// ============================================================
// READY / GATEWAY
// ============================================================

client.once(
  "ready",
  () => {
    isReady = true;
    lastReady = Date.now();

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
      `📚 Library: ${library.files.length} files`
    );

    console.log(
      "⚡ Bot is ready for commands."
    );

    console.log(
      "=========================================="
    );

    registerCommands()
      .catch(error =>
        console.error(
          "❌ Registration:",
          error.message
        )
      );
  }
);

client.on(
  "shardReady",
  shardId => {
    isReady = true;
    lastReady = Date.now();

    console.log(
      `🟢 Gateway shard ${shardId} ready.`
    );
  }
);

client.on(
  "shardResume",
  shardId => {
    isReady = true;
    lastReady = Date.now();

    console.log(
      `🟢 Gateway shard ${shardId} resumed.`
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
  "error",
  error => {
    console.error(
      "❌ Discord error:",
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
// GATEWAY WATCHDOG
// ============================================================

setInterval(
  async () => {
    if (isReady) {
      return;
    }

    if (reconnecting) {
      return;
    }

    if (
      Date.now() -
        lastReady <
      60000
    ) {
      return;
    }

    reconnecting = true;

    console.warn(
      "🟡 Gateway has been unavailable for 60 seconds."
    );

    try {
      console.warn(
        "🔄 Reconnecting to Discord..."
      );

      client.destroy();

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1500
          )
      );

      await client.login(
        TOKEN
      );

      console.log(
        "🟢 Discord reconnect attempted."
      );
    } catch (error) {
      console.error(
        "❌ Reconnect failed:",
        error.message
      );
    } finally {
      reconnecting = false;
    }
  },
  30000
).unref?.();

// ============================================================
// SLASH INTERACTIONS
// ============================================================

client.on(
  "interactionCreate",
  async interaction => {
    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    console.log(
      `📨 /${interaction.commandName} received | ${interaction.id}`
    );

    try {
      // ======================================================
      // CRITICAL:
      // ACK THE INTERACTION FIRST.
      // ======================================================

      await interaction.deferReply({
        flags:
          MessageFlags.Ephemeral
      });

      // ======================================================
      // GUILD CHECK
      // ======================================================

      if (
        interaction.guildId !==
        GUILD_ID
      ) {
        await interaction.editReply({
          content:
            "❌ This bot is not configured for this server."
        });

        return;
      }

      // ======================================================
      // PERMISSION CHECK
      // ======================================================

      if (
        !isAllowed(
          interaction.member
        )
      ) {
        await interaction.editReply({
          content:
            "❌ You don't have permission to use this command."
        });

        return;
      }

      // ======================================================
      // /setchannel
      // ======================================================

      if (
        interaction.commandName ===
        "setchannel"
      ) {
        config.allowedChannelId =
          interaction.channelId;

        saveConfig();

        await interaction.editReply({
          content:
            `✅ Normal .get/.find channel set to <#${interaction.channelId}>.\n` +
            `👑 **Owner + Access Role can still use .get/.find everywhere.**`
        });

        return;
      }

      // ======================================================
      // /embed
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

        const embed =
          new EmbedBuilder()
            .setColor(0x808080)
            .setDescription(
              description
            )
            .setFooter({
              text:
                `Today at ${new Date().toLocaleTimeString(
                  "en-US",
                  {
                    hour: "2-digit",
                    minute:
                      "2-digit",
                    hour12:
                      false,
                    timeZone:
                      "Asia/Manila"
                  }
                )}`
            });

        if (title) {
          embed.setTitle(
            title
          );
        }

        // Delete the private acknowledgement.
        await interaction
          .deleteReply()
          .catch(() => {});

        // Send the real public embed.
        await interaction.channel.send({
          embeds: [
            embed
          ]
        });

        return;
      }

      // ======================================================
      // /scanchannel
      // ======================================================

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
          !channel.isTextBased?.() ||
          !channel.messages
        ) {
          await interaction.editReply({
            content:
              "❌ That isn't a readable text channel."
          });

          return;
        }

        if (
          runningScans.has(
            channel.id
          )
        ) {
          await interaction.editReply({
            content:
              "⚠️ That channel is already being scanned."
          });

          return;
        }

        // The command has already been acknowledged.
        await interaction.editReply({
          content:
            `⚡ **Scan started** for <#${channel.id}>.\n` +
            `Running in the background.`
        });

        // IMPORTANT:
        // Do NOT await this.
        scanChannel(channel)
          .then(result =>
            interaction
              .editReply({
                content:
                  `✅ **Scan complete.**\n\n` +
                  `📂 Channel: <#${channel.id}>\n` +
                  `💬 Messages: \`${result.messages}\`\n` +
                  `📄 New files: \`${result.found}\`\n` +
                  `📚 Total library: \`${result.total}\`\n` +
                  `🖼️ Images ignored\n` +
                  `♻️ Existing files kept.`
              })
              .catch(
                () => {}
              )
          )
          .catch(error =>
            interaction
              .editReply({
                content:
                  `❌ **Scan failed.**\n` +
                  `\`${String(
                    error.message ||
                      error
                  ).slice(
                    0,
                    1500
                  )}\``
              })
              .catch(
                () => {}
              )
          );

        return;
      }

      // ======================================================
      // /forwardall
      // ======================================================

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

        await interaction.editReply({
          content:
            `⚡ Forwarding TXT files from <#${source.id}> → <#${destination.id}>...`
        });

        forwardTxt(
          source,
          destination
        )
          .then(result =>
            interaction
              .editReply({
                content:
                  `✅ **Forward complete.**\n\n` +
                  `📂 Source: <#${source.id}>\n` +
                  `📂 Destination: <#${destination.id}>\n` +
                  `💬 Messages: \`${result.messages}\`\n` +
                  `📄 TXT files: \`${result.sent}\``
              })
              .catch(
                () => {}
              )
          )
          .catch(error =>
            interaction
              .editReply({
                content:
                  `❌ **Forward failed.**\n` +
                  `\`${String(
                    error.message ||
                      error
                  ).slice(
                    0,
                    1500
                  )}\``
              })
              .catch(
                () => {}
              )
          );

        return;
      }
    } catch (error) {
      console.error(
        "❌ Interaction error:",
        error
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {
        await interaction
          .editReply({
            content:
              "❌ An error occurred while processing the command."
          })
          .catch(
            () => {}
          );
      } else {
        await interaction
          .reply({
            content:
              "❌ An error occurred.",
            flags:
              MessageFlags.Ephemeral
          })
          .catch(
            () => {}
          );
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
    if (
      message.author.bot ||
      !message.guild
    ) {
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
      const id =
        content.split(
          /\s+/
        )[1];

      // OWNER + ACCESS ROLE:
      // .get works EVERYWHERE.
      //
      // Everyone else:
      // .get only works in /setchannel channel.
      if (
        !isAllowed(
          message.member
        ) &&
        !channelAllowed(
          message
        )
      ) {
        replyUser(
          message,
          "❌ not here, dumbass."
        ).catch(
          () => {}
        );

        return;
      }

      if (!id) {
        replyUser(
          message,
          "❌ put id of file, idiot."
        ).catch(
          () => {}
        );

        return;
      }

      const file =
        getFile(id);

      if (!file) {
        replyUser(
          message,
          "❌ your id is wrong, try find working id, dumbass."
        ).catch(
          () => {}
        );

        return;
      }

      // FAST PATH.
      replyUser(
        message,
        {
          content:
            "**Here is the file twin!**",

          files: [
            {
              attachment:
                file.url,

              name:
                file.filename ||
                "file"
            }
          ]
        }
      ).catch(
        async () => {
          // Refresh the Discord attachment only
          // if the old URL no longer works.

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

            if (!fresh) {
              for (
                const snapshot of
                original.messageSnapshots
                  ?.values?.() ||
                []
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
                "Attachment unavailable."
              );
            }

            file.url =
              fresh.url;

            saveLibrary();

            await replyUser(
              message,
              {
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
              }
            );
          } catch {
            await replyUser(
              message,
              "❌ I found the file, but its Discord attachment is no longer available."
            ).catch(
              () => {}
            );
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
      // OWNER + ACCESS ROLE:
      // .find works EVERYWHERE.
      //
      // Everyone else:
      // .find only works in /setchannel channel.
      if (
        !isAllowed(
          message.member
        ) &&
        !channelAllowed(
          message
        )
      ) {
        replyUser(
          message,
          "❌ not here, dumbass."
        ).catch(
          () => {}
        );

        return;
      }

      const query =
        content
          .slice(5)
          .trim();

      if (!query) {
        replyUser(
          message,
          "❌ not here, dumbass."
        ).catch(
          () => {}
        );

        return;
      }

      const results =
        findFiles(query);

      if (!results.length) {
        replyUser(
          message,
          "❌ no matching name for that, dumbass."
        ).catch(
          () => {}
        );

        return;
      }

      const shown =
        results.slice(
          0,
          20
        );

      const embed =
        new EmbedBuilder()
          .setColor(
            0x808080
          )
          .setTitle(
            "File Search"
          )
          .setDescription(
            shown
              .map(
                (file, index) =>
                  `**${index + 1}.** ` +
                  `\`${file.filename}\` — ` +
                  `ID: \`${file.id}\``
              )
              .join("\n")
          )
          .setFooter({
            text:
              `${results.length} result(s)`
          });

      // Real reply + Mention User ON.
      replyUser(
        message,
        {
          embeds: [
            embed
          ]
        }
      ).catch(
        () => {}
      );

      return;
    }
  }
);

// ============================================================
// RENDER WEB SERVER
// ============================================================

const app =
  express();

const PORT =
  Number(
    process.env.PORT
  ) || 10000;

app.get(
  "/",
  (req, res) => {
    res
      .status(200)
      .send(
        isReady
          ? "FS Bot is online and connected to Discord."
          : "FS Bot process is online, Discord is connecting."
      );
  }
);

app.get(
  "/health",
  (req, res) => {
    res
      .status(200)
      .json({
        process:
          "online",

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
          library.files
            .length,

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

client
  .login(TOKEN)
  .catch(error => {
    console.error(
      "❌ Discord login failed:",
      error
    );

    process.exit(1);
  });
