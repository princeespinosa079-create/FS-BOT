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

// ====================
// ENVIRONMENT
// ====================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 3000;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID."
  );
  process.exit(1);
}

// ====================
// RENDER WEB SERVER
// ====================

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("Discord Bot is online!");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "online"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Web server running on port ${PORT}`);
});

// ====================
// FILE STORAGE
// ====================

const FILE_DIR = path.join(__dirname, "files");

if (!fs.existsSync(FILE_DIR)) {
  fs.mkdirSync(FILE_DIR, {
    recursive: true
  });
}

// ====================
// DISCORD CLIENT
// ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ====================
// DATA
// ====================

const games = new Map();

const whitelistedUsers = new Set();
const whitelistedRoles = new Set();

const fsChannels = new Set();

const storedFiles = new Map();

const fsSessions = new Map();

// ====================
// SLASH COMMANDS
// ====================

const commands = [

  // /guessnumber
  new SlashCommandBuilder()
    .setName("guessnumber")
    .setDescription("Start a Guess Number Game")
    .addIntegerOption(option =>
      option
        .setName("answer")
        .setDescription("Secret answer from 1 to 10000")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
    ),

  // /whitelist
  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Add or remove a user or role from the whitelist")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to whitelist")
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("Role to whitelist")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("Add or Remove")
        .setRequired(true)
        .addChoices(
          {
            name: "Add",
            value: "add"
          },
          {
            name: "Remove",
            value: "remove"
          }
        )
    ),

  // /setchannel
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set the channel where !fs can be used")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel for FS Finder")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageChannels.toString()
    ),

  // /scanchannel
  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription("Scan a channel and save attached files")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel to scan")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageChannels.toString()
    )

].map(command => command.toJSON());

// ====================
// INSTANT GUILD COMMAND REGISTRATION
// ====================

const rest = new REST({
  version: "10"
}).setToken(TOKEN);

async function registerCommands() {
  try {

    console.log(
      "Registering guild slash commands..."
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
      "✅ Slash commands registered instantly!"
    );

  } catch (error) {

    console.error(
      "❌ Command registration error:",
      error
    );
  }
}

// ====================
// SAVE FILE
// ====================

async function saveAttachment(
  attachment,
  message
) {

  try {

    const originalName =
      path.basename(
        attachment.name || "unknown_file"
      );

    const safeName =
      originalName.replace(
        /[^a-zA-Z0-9._ -]/g,
        "_"
      );

    const uniqueName =
      `${Date.now()}_${message.id}_${safeName}`;

    const filePath =
      path.join(
        FILE_DIR,
        uniqueName
      );

    // 25 MB limit
    if (
      attachment.size >
      25 * 1024 * 1024
    ) {

      console.log(
        `Skipped large file: ${originalName}`
      );

      return null;
    }

    const response =
      await fetch(
        attachment.url
      );

    if (!response.ok) {
      return null;
    }

    const buffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    fs.writeFileSync(
      filePath,
      buffer
    );

    const fileData = {

      id:
        `${message.id}_${attachment.id}`,

      originalName,

      storedName:
        uniqueName,

      path:
        filePath,

      size:
        buffer.length,

      messageId:
        message.id,

      channelId:
        message.channel.id,

      guildId:
        message.guild.id,

      uploadedBy:
        message.author.id,

      createdAt:
        new Date().toISOString(),

      url:
        attachment.url
    };

    storedFiles.set(
      fileData.id,
      fileData
    );

    return fileData;

  } catch (error) {

    console.error(
      "File save error:",
      error
    );

    return null;
  }
}

// ====================
// SCAN CHANNEL
// ====================

async function scanChannel(channel) {

  let before = undefined;

  let totalMessages = 0;
  let totalFiles = 0;

  while (true) {

    const options = {
      limit: 100
    };

    if (before) {
      options.before = before;
    }

    const messages =
      await channel.messages.fetch(
        options
      );

    if (messages.size === 0) {
      break;
    }

    totalMessages +=
      messages.size;

    for (
      const message
      of messages.values()
    ) {

      if (
        message.attachments.size === 0
      ) {
        continue;
      }

      for (
        const attachment
        of message.attachments.values()
      ) {

        const result =
          await saveAttachment(
            attachment,
            message
          );

        if (result) {
          totalFiles++;
        }
      }
    }

    before =
      messages.last().id;

    if (messages.size < 100) {
      break;
    }
  }

  return {
    messages:
      totalMessages,

    files:
      totalFiles
  };
}

// ====================
// SEARCH FILES
// ====================

function searchFiles(query) {

  const words =
    query
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  if (!words.length) {
    return [];
  }

  const results = [];

  for (
    const file
    of storedFiles.values()
  ) {

    const filename =
      file.originalName.toLowerCase();

    const matches =
      words.every(word =>
        filename.includes(word)
      );

    if (matches) {
      results.push(file);
    }
  }

  return results;
}

// ====================
// FS RESULT
// ====================

async function sendFSResult(
  interaction,
  results,
  index,
  sessionId,
  update = false
) {

  if (!results.length) {

    const embed =
      new EmbedBuilder()
        .setColor(0x808080)
        .setTitle(
          "FS Bot Finder"
        )
        .setDescription(
          "> ❌ **No matching files found.**"
        );

    if (update) {

      return interaction.update({
        embeds: [embed],
        components: []
      });

    } else {

      return interaction.reply({
        embeds: [embed]
      });
    }
  }

  if (index < 0) {
    index =
      results.length - 1;
  }

  if (
    index >=
    results.length
  ) {
    index = 0;
  }

  const file =
    results[index];

  const now =
    new Date();

  const time =
    now.toLocaleTimeString(
      "en-US",
      {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }
    );

  // ====================
  // GRAY FS EMBED
  // ====================

  const embed =
    new EmbedBuilder()
      .setColor(0x808080)
      .setTitle(
        "FS Bot Finder"
      )
      .setDescription(
        `> Here is the file twin!\n\n` +
        `📁 **${file.originalName}**\n` +
        `Today at ${time}`
      );

  // ====================
  // GRAY BUTTONS
  // ====================

  const row =
    new ActionRowBuilder()
      .addComponents(

        // BACK
        new ButtonBuilder()
          .setCustomId(
            `fs_prev:${sessionId}`
          )
          .setEmoji("⬅️")
          .setStyle(
            ButtonStyle.Secondary
          ),

        // PAGE
        new ButtonBuilder()
          .setCustomId(
            `fs_page:${sessionId}`
          )
          .setLabel(
            `${index + 1}/${results.length}`
          )
          .setStyle(
            ButtonStyle.Secondary
          )
          .setDisabled(true),

        // NEXT
        new ButtonBuilder()
          .setCustomId(
            `fs_next:${sessionId}`
          )
          .setEmoji("➡️")
          .setStyle(
            ButtonStyle.Secondary
          )
      );

  const fileAttachment = {
    attachment:
      file.path,

    name:
      file.originalName
  };

  if (update) {

    await interaction.update({
      embeds: [embed],
      components: [row],
      files: [fileAttachment]
    });

  } else {

    await interaction.reply({
      embeds: [embed],
      components: [row],
      files: [fileAttachment]
    });
  }
}

// ====================
// BOT READY
// ====================

client.once(
  "ready",
  async () => {

    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    await registerCommands();
  }
);

// ====================
// INTERACTIONS
// ====================

client.on(
  "interactionCreate",
  async interaction => {

    // ====================
    // GUESS NUMBER
    // ====================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName ===
        "guessnumber"
    ) {

      const answer =
        interaction.options.getInteger(
          "answer"
        );

      // FIX NULL
      if (
        answer === null ||
        answer === undefined
      ) {

        return interaction.reply({
          content:
            "❌ Please provide an answer from 1 to 10000.",
          ephemeral: true
        });
      }

      const host =
        interaction.user;

      const gameId =
        `${interaction.guildId}-${interaction.channelId}`;

      if (games.has(gameId)) {

        return interaction.reply({
          content:
            "❌ There is already a Guess Number game in this channel.",
          ephemeral: true
        });
      }

      games.set(
        gameId,
        {
          hostId:
            host.id,

          answer:
            Number(answer),

          started:
            false
        }
      );

      // ====================
      // DM ANSWER TO HOST
      // ====================

      try {

        await host.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x808080)
              .setTitle(
                "🔐 GUESS NUMBER ANSWER"
              )
              .setDescription(
                `> 🔢 **Answer:** \`${answer}\`\n` +
                `> 📌 **Range:** \`1 - 10000\``
              )
          ]
        });

      } catch (error) {

        console.log(
          "⚠️ Could not DM host."
        );
      }

      // ====================
      // PUBLIC EVENT
      // ====================

      const embed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setTitle(
            "GAME EVENT 🧧"
          )
          .setDescription(
            `> **Host by <@${host.id}>**\n` +
            `> **Click \`Start Button\` below to start the Guess Number Game.**`
          );

      const row =
        new ActionRowBuilder()
          .addComponents(

            new ButtonBuilder()
              .setCustomId(
                `guess_start:${gameId}`
              )
              .setLabel(
                "Start"
              )
              .setStyle(
                ButtonStyle.Primary
              )

          );

      await interaction.reply({
        content: "",
        ephemeral: true
      });

      await interaction.deleteReply();

      await interaction.channel.send({
        embeds: [embed],
        components: [row]
      });

      return;
    }

    // ====================
    // WHITELIST
    // ====================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName ===
        "whitelist"
    ) {

      const user =
        interaction.options.getUser(
          "user"
        );

      const role =
        interaction.options.getRole(
          "role"
        );

      const mode =
        interaction.options.getString(
          "mode"
        );

      if (!user && !role) {

        return interaction.reply({
          content:
            "❌ You must provide a **user** or **role**.",
          ephemeral: true
        });
      }

      if (user) {

        if (mode === "add") {
          whitelistedUsers.add(
            user.id
          );
        } else {
          whitelistedUsers.delete(
            user.id
          );
        }
      }

      if (role) {

        if (mode === "add") {
          whitelistedRoles.add(
            role.id
          );
        } else {
          whitelistedRoles.delete(
            role.id
          );
        }
      }

      const targets = [];

      if (user) {
        targets.push(
          `<@${user.id}>`
        );
      }

      if (role) {
        targets.push(
          `<@&${role.id}>`
        );
      }

      const action =
        mode === "add"
          ? "added to"
          : "removed from";

      const embed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setTitle(
            "WHITELIST"
          )
          .setDescription(
            `> ✅ ${targets.join(
              " and "
            )} **${action} the whitelist.**`
          );

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }

    // ====================
    // SET CHANNEL
    // ====================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName ===
        "setchannel"
    ) {

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
            "❌ Please select a text channel.",
          ephemeral: true
        });
      }

      fsChannels.add(
        `${interaction.guildId}:${channel.id}`
      );

      const embed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setTitle(
            "FS CHANNEL"
          )
          .setDescription(
            `> ✅ **FS Finder enabled!**\n` +
            `> 📁 Channel: ${channel}\n` +
            `> 🔎 Use \`!fs <filename>\` here.`
          );

      return interaction.reply({
        embeds: [embed]
      });
    }

    // ====================
    // SCAN CHANNEL
    // ====================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName ===
        "scanchannel"
    ) {

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
            "❌ Please select a text channel.",
          ephemeral: true
        });
      }

      await interaction.reply({
        content:
          "🔍 **Scanning channel...**",
        ephemeral: true
      });

      try {

        const result =
          await scanChannel(
            channel
          );

        await interaction.editReply({
          content:
            `✅ **Scan complete!**\n\n` +
            `📨 Messages scanned: **${result.messages}**\n` +
            `📁 Files saved: **${result.files}**\n` +
            `💾 Total files: **${storedFiles.size}**`
        });

      } catch (error) {

        console.error(
          "Scan error:",
          error
        );

        await interaction.editReply({
          content:
            "❌ Scan failed. Make sure the bot can **View Channel** and **Read Message History**."
        });
      }

      return;
    }

    // ====================
    // START GAME
    // ====================

    if (
      interaction.isButton() &&
      interaction.customId.startsWith(
        "guess_start:"
      )
    ) {

      const gameId =
        interaction.customId.substring(
          "guess_start:".length
        );

      const game =
        games.get(gameId);

      if (!game) {

        return interaction.reply({
          content:
            "❌ This game no longer exists.",
          ephemeral: true
        });
      }

      const isHost =
        interaction.user.id ===
        game.hostId;

      const canManageMessages =
        interaction.memberPermissions?.has(
          PermissionFlagsBits.ManageMessages
        );

      if (
        !isHost &&
        !canManageMessages
      ) {

        return interaction.reply({
          content:
            "❌ Only the **host** or members with **Manage Messages** can start this game.",
          ephemeral: true
        });
      }

      if (game.started) {

        return interaction.reply({
          content:
            "❌ The game has already started!",
          ephemeral: true
        });
      }

      game.started = true;

      const embed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            `> 🔓 **UNLOCK!**\n` +
            `> 🔢 **1 - 10000**\n` +
            `> 💀 **TRY TO WIN**`
          );

      await interaction.update({
        embeds: [embed],
        components: []
      });

      return;
    }

    // ====================
    // FS BACK / NEXT
    // ====================

    if (
      interaction.isButton() &&
      (
        interaction.customId.startsWith(
          "fs_prev:"
        ) ||
        interaction.customId.startsWith(
          "fs_next:"
        )
      )
    ) {

      const [
        action,
        sessionId
      ] =
        interaction.customId.split(
          ":"
        );

      const session =
        fsSessions.get(
          sessionId
        );

      if (!session) {

        return interaction.reply({
          content:
            "❌ This FS search has expired.",
          ephemeral: true
        });
      }

      let index =
        session.index;

      if (
        action === "fs_next"
      ) {
        index++;
      }

      if (
        action === "fs_prev"
      ) {
        index--;
      }

      if (
        index < 0
      ) {
        index =
          session.results.length - 1;
      }

      if (
        index >=
        session.results.length
      ) {
        index = 0;
      }

      session.index =
        index;

      await sendFSResult(
        interaction,
        session.results,
        index,
        sessionId,
        true
      );

      return;
    }
  }
);

// ====================
// MESSAGE CREATE
// ====================

client.on(
  "messageCreate",
  async message => {

    if (message.author.bot) {
      return;
    }

    if (!message.guild) {
      return;
    }

    // ====================
    // !FS
    // ====================

    if (
      message.content
        .toLowerCase()
        .startsWith("!fs")
    ) {

      const key =
        `${message.guild.id}:${message.channel.id}`;

      if (!fsChannels.has(key)) {
        return;
      }

      const query =
        message.content
          .slice(3)
          .trim();

      if (!query) {

        return message.reply(
          "❌ Usage: `!fs <filename>`"
        );
      }

      const results =
        searchFiles(query);

      if (!results.length) {

        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x808080)
              .setTitle(
                "FS Bot Finder"
              )
              .setDescription(
                `> ❌ **No file found for:** \`${query}\``
              )
          ]
        });
      }

      const sessionId =
        `${message.id}_${Date.now()}`;

      fsSessions.set(
        sessionId,
        {
          results,
          index: 0
        }
      );

      setTimeout(
        () => {
          fsSessions.delete(
            sessionId
          );
        },
        30 * 60 * 1000
      );

      await sendFSResult(
        message,
        results,
        0,
        sessionId,
        false
      );

      return;
    }

    // ====================
    // GUESS NUMBER
    // ====================

    const gameId =
      `${message.guild.id}-${message.channel.id}`;

    const game =
      games.get(gameId);

    if (
      !game ||
      !game.started
    ) {
      return;
    }

    const content =
      message.content.trim();

    if (!/^\d+$/.test(content)) {
      return;
    }

    const guess =
      Number(content);

    if (
      guess < 1 ||
      guess > 10000
    ) {
      return;
    }

    // ====================
    // WINNER
    // ====================

    if (
      guess === game.answer
    ) {

      const embed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            `> 🔒 **LOCK!**\n` +
            `> 🎊 <@${message.author.id}> **WON!**\n` +
            `> ✅ **${guess}**`
          );

      await message.channel.send({
        embeds: [embed]
      });

      games.delete(
        gameId
      );

      return;
    }

    // ====================
    // CLOSE MESSAGE
    // ====================

    const difference =
      Math.abs(
        game.answer - guess
      );

    /*
     * 10% of the answer.
     *
     * Example:
     * Answer 900
     * 10% = 90
     *
     * Answer 10000
     * 10% = 1000
     */

    const closeRange =
      Math.max(
        1,
        Math.floor(
          game.answer * 0.10
        )
      );

    if (
      difference <= closeRange
    ) {

      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x808080)
            .setDescription(
              "> 😱 **YOU’RE SO CLOSE BRO!**"
            )
        ]
      });
    }
  }
);

// ====================
// ERROR HANDLING
// ====================

client.on(
  "error",
  error => {
    console.error(
      "Discord client error:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "Unhandled rejection:",
      error
    );
  }
);

// ====================
// LOGIN
// ====================

client.login(TOKEN);
