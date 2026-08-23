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
  console.log(
    `Web server running on port ${PORT}`
  );
});

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
// GAME STORAGE
// ====================

const games = new Map();

// ====================
// SLASH COMMANDS
// ====================

const commands = [

  // ====================
  // /guessnumber
  // ====================

  new SlashCommandBuilder()
    .setName("guessnumber")
    .setDescription(
      "Start a Guess Number Game"
    )
    .addIntegerOption(option =>
      option
        .setName("answer")
        .setDescription(
          "Secret answer from 1 to 10000"
        )
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
    ),

  // ====================
  // /embed
  // ====================

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription(
      "Create a custom embed"
    )

    .addStringOption(option =>
      option
        .setName("title")
        .setDescription(
          "Embed title"
        )
        .setRequired(false)
    )

    .addStringOption(option =>
      option
        .setName("description")
        .setDescription(
          "Embed description"
        )
        .setRequired(false)
    )

    .addStringOption(option =>
      option
        .setName("color")
        .setDescription(
          "Choose embed color"
        )
        .setRequired(false)
        .addChoices(

          {
            name: "Blue",
            value: "blue"
          },

          {
            name: "Red",
            value: "red"
          },

          {
            name: "Green",
            value: "green"
          },

          {
            name: "Yellow",
            value: "yellow"
          },

          {
            name: "Orange",
            value: "orange"
          },

          {
            name: "Purple",
            value: "purple"
          },

          {
            name: "Pink",
            value: "pink"
          },

          {
            name: "Cyan",
            value: "cyan"
          },

          {
            name: "White",
            value: "white"
          },

          {
            name: "Black",
            value: "black"
          },

          {
            name: "Gray",
            value: "gray"
          },

          {
            name: "Gold",
            value: "gold"
          },

          {
            name: "Aqua",
            value: "aqua"
          }
        )
    )

].map(command =>
  command.toJSON()
);

// ====================
// REGISTER COMMANDS
// ====================

const rest =
  new REST({
    version: "10"
  }).setToken(TOKEN);

async function registerCommands() {

  try {

    console.log(
      "Registering guild commands..."
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
      "✅ Slash commands registered!"
    );

  } catch (error) {

    console.error(
      "❌ Command registration error:",
      error
    );
  }
}

// ====================
// COLOR SYSTEM
// ====================

function getColor(color) {

  switch (color) {

    case "blue":
      return 0x3498db;

    case "red":
      return 0xe74c3c;

    case "green":
      return 0x2ecc71;

    case "yellow":
      return 0xf1c40f;

    case "orange":
      return 0xe67e22;

    case "purple":
      return 0x9b59b6;

    case "pink":
      return 0xff69b4;

    case "cyan":
      return 0x00ffff;

    case "white":
      return 0xffffff;

    case "black":
      return 0x000000;

    case "gray":
      return 0x808080;

    case "gold":
      return 0xffd700;

    case "aqua":
      return 0x1abc9c;

    default:
      return 0x808080;
  }
}

// ====================
// TIME
// ====================

function getCurrentTime() {

  const now =
    new Date();

  return now.toLocaleTimeString(
    "en-US",
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Manila"
    }
  );
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
    // /guessnumber
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

      // IMPORTANT:
      // Do not use "number" here.
      // The option is called "answer".

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

      if (
        answer < 1 ||
        answer > 10000
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

      // Prevent two games in one channel
      if (games.has(gameId)) {

        return interaction.reply({
          content:
            "❌ There is already a Guess Number game in this channel.",
          ephemeral: true
        });
      }

      // ====================
      // SAVE GAME
      // ====================

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

        const dmEmbed =
          new EmbedBuilder()
            .setColor(0x808080)
            .setTitle(
              "🔐 GUESS NUMBER ANSWER"
            )
            .setDescription(
              `> 🔢 **Answer:** \`${answer}\`\n` +
              `> 📌 **Range:** \`1 - 10000\``
            );

        await host.send({
          embeds: [
            dmEmbed
          ]
        });

      } catch (error) {

        console.log(
          `⚠️ Could not DM ${host.tag}`
        );
      }

      // ====================
      // GAME EVENT EMBED
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

      // ====================
      // HIDE SLASH RESPONSE
      // ====================

      await interaction.reply({
        content: " ",
        ephemeral: true
      });

      await interaction.deleteReply();

      // ====================
      // SEND PUBLIC EVENT
      // ====================

      await interaction.channel.send({
        embeds: [
          embed
        ],
        components: [
          row
        ]
      });

      return;
    }

    // ====================
    // /embed
    // ====================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName ===
        "embed"
    ) {

      const title =
        interaction.options.getString(
          "title"
        );

      const description =
        interaction.options.getString(
          "description"
        );

      const color =
        interaction.options.getString(
          "color"
        ) || "gray";

      const embed =
        new EmbedBuilder()
          .setColor(
            getColor(color)
          )
          .setTimestamp();

      // ====================
      // TITLE
      // ====================

      if (
        title &&
        title.trim().length > 0
      ) {

        embed.setTitle(
          title
        );
      }

      // ====================
      // DESCRIPTION
      // ====================

      if (
        description &&
        description.trim().length > 0
      ) {

        embed.setDescription(
          description
        );
      }

      // ====================
      // TODAY AT TIME
      // ====================

      embed.setFooter({
        text:
          `Today at ${getCurrentTime()}`
      });

      // ====================
      // HIDE COMMAND RESPONSE
      // ====================

      await interaction.reply({
        content: " ",
        ephemeral: true
      });

      await interaction.deleteReply();

      // ====================
      // SEND EMBED
      // ====================

      await interaction.channel.send({
        embeds: [
          embed
        ]
      });

      return;
    }

    // ====================
    // START BUTTON
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

      // ====================
      // HOST CHECK
      // ====================

      const isHost =
        interaction.user.id ===
        game.hostId;

      // ====================
      // MANAGE MESSAGES CHECK
      // ====================

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

      // ====================
      // ALREADY STARTED
      // ====================

      if (game.started) {

        return interaction.reply({
          content:
            "❌ The game has already started!",
          ephemeral: true
        });
      }

      game.started = true;

      // ====================
      // STARTED EMBED
      // ====================

      const embed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            `> 🔓 **UNLOCK!**\n` +
            `> 🔢 **1 - 10000**\n` +
            `> 💀 **TRY TO WIN**`
          );

      await interaction.update({
        embeds: [
          embed
        ],
        components: []
      });

      return;
    }
  }
);

// ====================
// NUMBER GUESSING
// ====================

client.on(
  "messageCreate",
  async message => {

    if (
      message.author.bot
    ) {
      return;
    }

    if (
      !message.guild
    ) {
      return;
    }

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

    // Only numbers
    if (
      !/^\d+$/.test(content)
    ) {
      return;
    }

    const guess =
      Number(content);

    // ====================
    // VALID RANGE
    // ====================

    if (
      guess < 1 ||
      guess > 10000
    ) {
      return;
    }

    // ====================
    // CORRECT ANSWER
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
        embeds: [
          embed
        ]
      });

      games.delete(
        gameId
      );

      return;
    }

    // ====================
    // CLOSE CHECK
    // ====================

    /*
      10% close range.

      Example:
      Answer = 900
      Close range = 90

      Answer = 1000
      Close range = 100

      Answer = 10000
      Close range = 1000
    */

    const closeRange =
      Math.max(
        1,
        Math.floor(
          game.answer * 0.10
        )
      );

    const difference =
      Math.abs(
        game.answer - guess
      );

    if (
      difference <=
      closeRange
    ) {

      const closeEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            "> 😱 **YOU’RE SO CLOSE BRO!**"
          );

      await message.reply({
        embeds: [
          closeEmbed
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
