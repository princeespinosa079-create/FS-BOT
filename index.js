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
  AttachmentBuilder
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");

// ====================
// Environment
// ====================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = process.env.PORT || 3000;

// ====================
// Render Web Server
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
// File Storage
// ====================

const FILE_DIR = path.join(__dirname, "files");

if (!fs.existsSync(FILE_DIR)) {
  fs.mkdirSync(FILE_DIR, {
    recursive: true
  });
}

// ====================
// Discord Client
// ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ====================
// Data
// ====================

const games = new Map();

const whitelistedUsers = new Set();
const whitelistedRoles = new Set();

const fsChannels = new Set();

const storedFiles = new Map();

// ====================
// Slash Commands
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
        .setDescription("Channel for the FS Finder")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageChannels.toString()
    ),

  // /scanchannel
  new SlashCommandBuilder()
    .setName("scanchannel")
    .setDescription("Scan a channel and save its attached files")
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
// Register Commands
// ====================

const rest = new REST({
  version: "10"
}).setToken(TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: commands
      }
    );

    console.log("Slash commands registered!");
  } catch (error) {
    console.error(
      "Command registration error:",
      error
    );
  }
})();

// ====================
// Helper: Save File
// ====================

async function saveAttachment(attachment, message) {

  try {

    const fileName = path.basename(
      attachment.name || "unknown_file"
    );

    const safeName = fileName.replace(
      /[^a-zA-Z0-9._ -]/g,
      "_"
    );

    const uniqueName =
      `${Date.now()}_${message.id}_${safeName}`;

    const filePath =
      path.join(FILE_DIR, uniqueName);

    // 20 MB limit
    if (attachment.size > 20 * 1024 * 1024) {
      console.log(
        `Skipped large file: ${fileName}`
      );
      return null;
    }

    const response = await fetch(
      attachment.url
    );

    if (!response.ok) {
      console.log(
        `Failed downloading: ${fileName}`
      );
      return null;
    }

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    fs.writeFileSync(
      filePath,
      buffer
    );

    const fileData = {
      id: `${message.id}_${attachment.id}`,
      originalName: fileName,
      storedName: uniqueName,
      path: filePath,
      size: buffer.length,
      messageId: message.id,
      channelId: message.channel.id,
      guildId: message.guild.id,
      uploadedBy: message.author.id,
      createdAt: new Date().toISOString(),
      url: attachment.url
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
// Helper: Scan Channel
// ====================

async function scanChannel(channel) {

  let lastId = null;
  let totalMessages = 0;
  let totalFiles = 0;

  while (true) {

    const options = {
      limit: 100
    };

    if (lastId) {
      options.before = lastId;
    }

    const messages =
      await channel.messages.fetch(options);

    if (messages.size === 0) {
      break;
    }

    totalMessages += messages.size;

    for (const message of messages.values()) {

      if (!message.attachments.size) {
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

    lastId =
      messages.last().id;

    if (messages.size < 100) {
      break;
    }
  }

  return {
    messages: totalMessages,
    files: totalFiles
  };
}

// ====================
// Helper: Search Files
// ====================

function searchFiles(searchText) {

  const words =
    searchText
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

  if (!words.length) {
    return [];
  }

  const results = [];

  for (const file of storedFiles.values()) {

    const name =
      file.originalName.toLowerCase();

    // Every search word must appear
    // somewhere in the filename.
    const matches =
      words.every(word =>
        name.includes(word)
      );

    if (matches) {
      results.push(file);
    }
  }

  return results;
}

// ====================
// Bot Ready
// ====================

client.once("ready", () => {

  console.log(
    `Logged in as ${client.user.tag}`
  );

  console.log(
    `Stored files: ${storedFiles.size}`
  );
});

// ====================
// Interactions
// ====================

client.on(
  "interactionCreate",
  async interaction => {

    // ====================
    // /guessnumber
    // ====================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "guessnumber"
    ) {

      const answer =
        interaction.options.getInteger(
          "answer"
        );

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

      // Save answer FIRST
      games.set(gameId, {
        hostId: host.id,
        answer: answer,
        started: false
      });

      // ====================
      // DM Answer
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
          `Could not DM ${host.tag}.`
        );
      }

      // ====================
      // Public Event
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
                `guess_start_${gameId}`
              )
              .setLabel("Start")
              .setStyle(
                ButtonStyle.Primary
              )

          );

      await interaction.deferReply({
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
    // /whitelist
    // ====================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "whitelist"
    ) {

      const user =
        interaction.options.getUser("user");

      const role =
        interaction.options.getRole("role");

      const mode =
        interaction.options.getString("mode");

      if (!user && !role) {

        return interaction.reply({
          content:
            "❌ You must provide a **user** or **role**.",
          ephemeral: true
        });
      }

      const action =
        mode === "add"
          ? "added to"
          : "removed from";

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

      const embed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setTitle(
            "WHITELIST"
          )
          .setDescription(
            `> ✅ ${targets.join(" and ")} **${action} the whitelist.**`
          );

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }

    // ====================
    // /setchannel
    // ====================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "setchannel"
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
            `> 🔎 Members can now use \`!fs <filename>\` here.`
          );

      return interaction.reply({
        embeds: [embed]
      });
    }

    // ====================
    // /scanchannel
    // ====================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "scanchannel"
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
          "🔍 Scanning channel messages and downloading files...",
        ephemeral: true
      });

      try {

        const result =
          await scanChannel(channel);

        await interaction.editReply({
          content:
            `✅ Scan complete!\n` +
            `📨 Messages scanned: **${result.messages}**\n` +
            `📁 Files saved: **${result.files}**`
        });

      } catch (error) {

        console.error(
          "Scan error:",
          error
        );

        await interaction.editReply({
          content:
            "❌ I couldn't scan that channel. Make sure the bot has **View Channel**, **Read Message History**, and **View Messages** permissions."
        });
      }

      return;
    }

    // ====================
    // Start Button
    // ====================

    if (
      interaction.isButton() &&
      interaction.customId.startsWith(
        "guess_start_"
      )
    ) {

      const gameId =
        interaction.customId.replace(
          "guess_start_",
          ""
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
            "❌ Only the **host** or members with **Manage Messages** permission can start this game.",
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
    // FS Pagination
    // ====================

    if (
      interaction.isButton() &&
      interaction.customId.startsWith(
        "fs_"
      )
    ) {

      const parts =
        interaction.customId.split(":");

      const direction =
        parts[1];

      const page =
        Number(parts[2]);

      const search =
        parts.slice(3).join(":");

      const results =
        searchFiles(search);

      if (!results.length) {

        return interaction.reply({
          content:
            "❌ No files found.",
          ephemeral: true
        });
      }

      let newPage = page;

      if (direction === "next") {
        newPage++;
      }

      if (direction === "back") {
        newPage--;
      }

      if (newPage < 0) {
        newPage = results.length - 1;
      }

      if (newPage >= results.length) {
        newPage = 0;
      }

      await sendFSResult(
        interaction,
        results,
        newPage,
        search,
        true
      );

      return;
    }
  }
);

// ====================
// FS Finder
// ====================

async function sendFSResult(
  interaction,
  results,
  index,
  search,
  update = false
) {

  const file =
    results[index];

  const total =
    results.length;

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

  const row =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            `fs:back:${index}:${search}`
          )
          .setEmoji("⬅️")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `fs:page:${index}:${search}`
          )
          .setLabel(
            `${index + 1}/${total}`
          )
          .setStyle(
            ButtonStyle.Secondary
          )
          .setDisabled(true),

        new ButtonBuilder()
          .setCustomId(
            `fs:next:${index}:${search}`
          )
          .setEmoji("➡️")
          .setStyle(
            ButtonStyle.Secondary
          )

      );

  const attachment =
    new AttachmentBuilder(
      file.path,
      {
        name: file.originalName
      }
    );

  if (update) {

    await interaction.update({
      embeds: [embed],
      components: [row],
      files: [attachment]
    });

  } else {

    await interaction.reply({
      embeds: [embed],
      components: [row],
      files: [attachment]
    });
  }
}

// ====================
// Message Create
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
    // !fs
    // ====================

    if (
      message.content
        .toLowerCase()
        .startsWith("!fs")
    ) {

      const channelKey =
        `${message.guild.id}:${message.channel.id}`;

      if (!fsChannels.has(channelKey)) {
        return;
      }

      const search =
        message.content
          .slice(3)
          .trim();

      if (!search) {

        return message.reply(
          "❌ Usage: `!fs <filename>`"
        );
      }

      const results =
        searchFiles(search);

      if (!results.length) {

        return message.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x808080)
              .setTitle(
                "FS Bot Finder"
              )
              .setDescription(
                `> ❌ No file found for **${search}**`
              )
          ]
        });
      }

      await sendFSResult(
        message,
        results,
        0,
        search,
        false
      );

      return;
    }

    // ====================
    // Guess Number
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
    // Correct Answer
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

      games.delete(gameId);

      return;
    }

    // ====================
    // 10% Close Range
    // ====================

    const difference =
      Math.abs(
        game.answer - guess
      );

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
              `> 😱 **YOU’RE SO CLOSE BRO!**`
            )
        ]
      });
    }
  }
);

// ====================
// Error Handling
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
// Login
// ====================

client.login(TOKEN);
