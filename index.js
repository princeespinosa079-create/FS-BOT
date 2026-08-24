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

// ==================================================
// ENVIRONMENT
// ==================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = process.env.PORT || 10000;

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID is missing.");
  process.exit(1);
}

console.log("✅ Environment variables found.");

// ==================================================
// WEB SERVER FOR RENDER
// ==================================================

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("FS Bot is online!");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "online"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ==================================================
// DISCORD CLIENT
// ==================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ==================================================
// GAME STORAGE
// ==================================================

const games = new Map();

// ==================================================
// COMMANDS
// ==================================================

const guessNumberCommand = new SlashCommandBuilder()
  .setName("guessnumber")
  .setDescription("Start a Guess Number Game")
  .addIntegerOption(option =>
    option
      .setName("answer")
      .setDescription("Correct answer from 1 to 10000")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(10000)
  );

const embedCommand = new SlashCommandBuilder()
  .setName("embed")
  .setDescription("Create a custom embed")
  .addStringOption(option =>
    option
      .setName("title")
      .setDescription("Embed title")
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName("description")
      .setDescription("Embed description")
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName("color")
      .setDescription("Embed color")
      .setRequired(false)
      .addChoices(
        { name: "Blue", value: "blue" },
        { name: "Red", value: "red" },
        { name: "Green", value: "green" },
        { name: "Yellow", value: "yellow" },
        { name: "Orange", value: "orange" },
        { name: "Purple", value: "purple" },
        { name: "Pink", value: "pink" },
        { name: "Cyan", value: "cyan" },
        { name: "Gold", value: "gold" },
        { name: "White", value: "white" },
        { name: "Black", value: "black" },
        { name: "Gray", value: "gray" },
        { name: "Dark Blue", value: "darkblue" },
        { name: "Dark Red", value: "darkred" },
        { name: "Dark Green", value: "darkgreen" },
        { name: "Dark Purple", value: "darkpurple" },
        { name: "Dark Cyan", value: "darkcyan" }
      )
  );

const commandData = [
  guessNumberCommand.toJSON(),
  embedCommand.toJSON()
];

// ==================================================
// COLORS
// ==================================================

const COLORS = {
  blue: 0x3498DB,
  red: 0xE74C3C,
  green: 0x2ECC71,
  yellow: 0xF1C40F,
  orange: 0xE67E22,
  purple: 0x9B59B6,
  pink: 0xFF69B4,
  cyan: 0x1ABC9C,
  gold: 0xFFD700,
  white: 0xFFFFFF,
  black: 0x000000,
  gray: 0x808080,
  darkblue: 0x206694,
  darkred: 0x992D22,
  darkgreen: 0x1F8B4C,
  darkpurple: 0x71368A,
  darkcyan: 0x11806A
};

// ==================================================
// REGISTER COMMANDS
// ==================================================

const rest = new REST({
  version: "10"
}).setToken(TOKEN);

async function registerGuildCommands(guild) {
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        CLIENT_ID,
        guild.id
      ),
      {
        body: commandData
      }
    );

    console.log(
      `✅ Commands registered in: ${guild.name}`
    );
  } catch (error) {
    console.error(
      `❌ Could not register commands in ${guild.name}:`,
      error.message
    );
  }
}

async function registerAllCommands() {
  console.log("🔄 Registering guild commands...");

  for (const guild of client.guilds.cache.values()) {
    await registerGuildCommands(guild);
  }

  console.log("✅ Guild command registration finished.");
}

// ==================================================
// READY
// ==================================================

client.once("ready", async () => {
  console.log("----------------------------------");
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(
    `🏠 Connected to ${client.guilds.cache.size} server(s)`
  );
  console.log("🚫 Watching status disabled.");
  console.log("----------------------------------");

  await registerAllCommands();
});

// ==================================================
// NEW SERVER
// ==================================================

client.on("guildCreate", async guild => {
  console.log(
    `➕ Joined server: ${guild.name}`
  );

  await registerGuildCommands(guild);
});

// ==================================================
// INTERACTIONS
// ==================================================

client.on("interactionCreate", async interaction => {

  // ==================================================
  // GUESS NUMBER
  // ==================================================

  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "guessnumber"
  ) {

    // ACKNOWLEDGE IMMEDIATELY
    try {
      await interaction.deferReply({
        ephemeral: true
      });
    } catch (error) {
      console.error(
        "❌ Could not acknowledge guessnumber:",
        error.message
      );
      return;
    }

    try {

      if (!interaction.guild) {
        return await interaction.editReply({
          content:
            "❌ This command can only be used in a server."
        });
      }

      const answer =
        interaction.options.getInteger("answer");

      const host = interaction.user;

      if (
        !Number.isInteger(answer) ||
        answer < 1 ||
        answer > 10000
      ) {
        return await interaction.editReply({
          content:
            "❌ Please provide an answer from **1 to 10000**."
        });
      }

      const gameId =
        `${interaction.guild.id}-${interaction.channel.id}`;

      if (games.has(gameId)) {
        return await interaction.editReply({
          content:
            "❌ There is already a Guess Number game in this channel."
        });
      }

      // SAVE GAME
      games.set(gameId, {
        guildId: interaction.guild.id,
        channelId: interaction.channel.id,
        hostId: host.id,
        answer: answer,
        started: false
      });

      console.log(
        `🎯 Game created | Host: ${host.tag} | Answer: ${answer}`
      );

      // ==================================================
      // DM ANSWER TO HOST
      // ==================================================

      try {

        const dmEmbed = new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            `> 🔢 **Answer:** \`${answer}\`\n` +
            `> 📌 **Range:** \`1 - 10000\``
          )
          .setTimestamp();

        await host.send({
          embeds: [dmEmbed]
        });

        console.log(
          "📩 Answer successfully sent to host."
        );

      } catch (dmError) {

        console.error(
          "⚠️ Could not DM host:",
          dmError.message
        );
      }

      // ==================================================
      // PUBLIC GAME EMBED
      // ==================================================

      const gameEmbed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle("GAME EVENT 🧧")
        .setDescription(
          `> **Host by <@${host.id}>**\n` +
          `> **Click \`Start\` below to start the Guess Number Game.**\n\n` +
          `> 📌 **Range:** \`1 - 10000\``
        )
        .setTimestamp();

      const startButton =
        new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(
                `guess_start:${gameId}`
              )
              .setLabel("Start")
              .setEmoji("▶️")
              .setStyle(ButtonStyle.Secondary)
          );

      await interaction.channel.send({
        embeds: [gameEmbed],
        components: [startButton]
      });

      await interaction.editReply({
        content:
          "✅ Guess Number game created!"
      });

      console.log(
        "🎮 Public game event sent."
      );

      return;

    } catch (error) {

      console.error(
        "❌ Guessnumber error:",
        error
      );

      try {
        await interaction.editReply({
          content:
            "❌ Something went wrong while creating the game."
        });
      } catch (_) {}
    }

    return;
  }

  // ==================================================
  // EMBED COMMAND
  // ==================================================

  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "embed"
  ) {

    // ACKNOWLEDGE IMMEDIATELY
    try {
      await interaction.deferReply({
        ephemeral: true
      });
    } catch (error) {
      console.error(
        "❌ Could not acknowledge embed:",
        error.message
      );
      return;
    }

    try {

      const title =
        interaction.options.getString("title");

      const description =
        interaction.options.getString("description");

      const colorName =
        interaction.options.getString("color") ||
        "gray";

      const color =
        COLORS[colorName] ?? COLORS.gray;

      const embed =
        new EmbedBuilder()
          .setColor(color)
          .setTimestamp();

      if (title && title.trim()) {
        embed.setTitle(title);
      }

      if (description && description.trim()) {
        embed.setDescription(description);
      }

      await interaction.channel.send({
        embeds: [embed]
      });

      await interaction.editReply({
        content: "✅ Embed sent!"
      });

      console.log(
        `📦 Embed sent by ${interaction.user.tag}`
      );

    } catch (error) {

      console.error(
        "❌ Embed command error:",
        error
      );

      try {
        await interaction.editReply({
          content:
            "❌ Could not create the embed."
        });
      } catch (_) {}
    }

    return;
  }

  // ==================================================
  // START BUTTON
  // ==================================================

  if (
    interaction.isButton() &&
    interaction.customId.startsWith("guess_start:")
  ) {

    const gameId =
      interaction.customId.substring(
        "guess_start:".length
      );

    const game = games.get(gameId);

    if (!game) {

      try {
        await interaction.reply({
          content:
            "❌ This game no longer exists.",
          ephemeral: true
        });
      } catch (_) {}

      return;
    }

    // ACK BUTTON IMMEDIATELY
    try {
      await interaction.deferUpdate();
    } catch (error) {
      console.error(
        "❌ Could not acknowledge start button:",
        error.message
      );
      return;
    }

    try {

      const isHost =
        interaction.user.id === game.hostId;

      const canManageMessages =
        interaction.memberPermissions &&
        interaction.memberPermissions.has(
          PermissionFlagsBits.ManageMessages
        );

      if (!isHost && !canManageMessages) {

        try {
          await interaction.followUp({
            content:
              "❌ Only the **host** or members with **Manage Messages** can start this game.",
            ephemeral: true
          });
        } catch (_) {}

        return;
      }

      if (game.started) {

        try {
          await interaction.followUp({
            content:
              "❌ This game has already started.",
            ephemeral: true
          });
        } catch (_) {}

        return;
      }

      game.started = true;

      const startedEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            `> 🔓 **UNLOCK!**\n` +
            `> 🔢 **1 - 10000**\n` +
            `> 🎯 **GUESS THE NUMBER!**`
          )
          .setTimestamp();

      await interaction.editReply({
        embeds: [startedEmbed],
        components: []
      });

      console.log(
        `🎮 Game started by ${interaction.user.tag}`
      );

    } catch (error) {

      console.error(
        "❌ Start button error:",
        error
      );
    }

    return;
  }
});

// ==================================================
// NUMBER GUESSING
// ==================================================

client.on("messageCreate", async message => {

  try {

    if (message.author.bot) return;
    if (!message.guild) return;

    const gameId =
      `${message.guild.id}-${message.channel.id}`;

    const game = games.get(gameId);

    if (!game) return;
    if (!game.started) return;

    const content =
      message.content.trim();

    if (!/^\d+$/.test(content)) {
      return;
    }

    const guess = Number(content);

    if (
      guess < 1 ||
      guess > 10000
    ) {
      return;
    }

    // ==================================================
    // WINNER
    // ==================================================

    if (guess === game.answer) {

      const winnerEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            `> 🔒 **LOCK!**\n` +
            `> 🎊 <@${message.author.id}> **WON!**\n` +
            `> ✅ **${guess}**`
          )
          .setTimestamp();

      await message.channel.send({
        embeds: [winnerEmbed]
      });

      console.log(
        `🏆 ${message.author.tag} won with ${guess}`
      );

      games.delete(gameId);

      return;
    }

    // ==================================================
    // CLOSE HINT
    // ==================================================

    const difference =
      Math.abs(guess - game.answer);

    if (difference <= 100) {

      const closeEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            "> 😱 **YOU’RE SO CLOSE BRO!**"
          );

      await message.reply({
        embeds: [closeEmbed]
      });

      return;
    }

  } catch (error) {

    console.error(
      "❌ Guess message error:",
      error.message
    );
  }
});

// ==================================================
// DISCORD ERRORS
// ==================================================

client.on("error", error => {
  console.error(
    "❌ Discord client error:",
    error
  );
});

client.on("warn", warning => {
  console.warn(
    "⚠️ Discord warning:",
    warning
  );
});

process.on("unhandledRejection", error => {
  console.error(
    "❌ Unhandled rejection:",
    error
  );
});

process.on("uncaughtException", error => {
  console.error(
    "❌ Uncaught exception:",
    error
  );
});

// ==================================================
// LOGIN
// ==================================================

console.log("🔑 Logging into Discord...");

client.login(TOKEN)
  .then(() => {
    console.log(
      "🔐 Discord login request completed."
    );
  })
  .catch(error => {
    console.error(
      "❌ Discord login failed:",
      error
    );
    process.exit(1);
  });
