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
// CONFIG
// ==================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 3000;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing environment variables.");
  process.exit(1);
}

// ==================================================
// RENDER SERVER
// ==================================================

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
// GAMES
// ==================================================

const games = new Map();

// ==================================================
// COMMANDS
// ==================================================

const commands = [
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

  new SlashCommandBuilder()
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
          { name: "Aqua", value: "aqua" },
          { name: "Gold", value: "gold" },
          { name: "White", value: "white" },
          { name: "Gray", value: "gray" },
          { name: "Black", value: "black" }
        )
    )
].map(command => command.toJSON());

// ==================================================
// COMMAND REGISTRATION
// ==================================================

const rest = new REST({
  version: "10"
}).setToken(TOKEN);

async function registerCommands() {
  try {
    // Remove old global commands
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: []
      }
    );

    console.log("🧹 Old global commands removed.");

    // Register only in your server
    await rest.put(
      Routes.applicationGuildCommands(
        CLIENT_ID,
        GUILD_ID
      ),
      {
        body: commands
      }
    );

    console.log("✅ Guild commands registered.");
  } catch (error) {
    console.error(
      "❌ Command registration failed:",
      error
    );
  }
}

// ==================================================
// COLORS
// ==================================================

function getColor(color) {
  const colors = {
    blue: 0x3498db,
    red: 0xe74c3c,
    green: 0x2ecc71,
    yellow: 0xf1c40f,
    orange: 0xe67e22,
    purple: 0x9b59b6,
    pink: 0xff69b4,
    cyan: 0x00ffff,
    aqua: 0x1abc9c,
    gold: 0xffd700,
    white: 0xffffff,
    gray: 0x808080,
    black: 0x000000
  };

  return colors[color] ?? colors.gray;
}

// ==================================================
// TIME
// ==================================================

function getCurrentTime() {
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

// ==================================================
// READY
// ==================================================

client.once("ready", async () => {
  console.log(
    `✅ Logged in as ${client.user.tag}`
  );

  await registerCommands();
});

// ==================================================
// INTERACTIONS
// ==================================================

client.on(
  "interactionCreate",
  async interaction => {

    try {

      // ==================================================
      // /guessnumber
      // ==================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "guessnumber"
      ) {

        // Get answer immediately
        const answer =
          interaction.options.getInteger(
            "answer"
          );

        console.log(
          `🎯 Guess game requested by ${interaction.user.tag}, answer: ${answer}`
        );

        // Validate
        if (
          answer === null ||
          answer < 1 ||
          answer > 10000
        ) {

          return interaction.reply({
            content:
              "❌ Please provide an answer from 1 to 10000.",
            ephemeral: true
          });
        }

        const gameId =
          `${interaction.guildId}-${interaction.channelId}`;

        // Check existing game
        if (games.has(gameId)) {

          return interaction.reply({
            content:
              "❌ There is already a Guess Number game in this channel.",
            ephemeral: true
          });
        }

        // Save game
        games.set(
          gameId,
          {
            hostId: interaction.user.id,
            answer: Number(answer),
            started: false
          }
        );

        // ==================================================
        // SEND DM TO HOST
        // ==================================================

        try {

          const dmEmbed =
            new EmbedBuilder()
              .setColor(0x808080)
              .setDescription(
                `> 🔢 **Answer:** \`${answer}\``
              );

          await interaction.user.send({
            embeds: [
              dmEmbed
            ]
          });

        } catch (error) {

          console.log(
            "⚠️ Could not DM host. Their DMs may be disabled."
          );
        }

        // ==================================================
        // PUBLIC GAME
        // ==================================================

        const embed =
          new EmbedBuilder()
            .setColor(0x808080)
            .setTitle(
              "GAME EVENT 🧧"
            )
            .setDescription(
              `> **Host by <@${interaction.user.id}>**\n` +
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

        // ==================================================
        // RESPOND TO DISCORD IMMEDIATELY
        // ==================================================

        await interaction.reply({
          content: "\u200b",
          ephemeral: true
        });

        // Delete the hidden response
        await interaction.deleteReply();

        // Send public event
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

      // ==================================================
      // /embed
      // ==================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "embed"
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
            .setFooter({
              text:
                `Today at ${getCurrentTime()}`
            });

        if (
          title &&
          title.trim()
        ) {
          embed.setTitle(title);
        }

        if (
          description &&
          description.trim()
        ) {
          embed.setDescription(
            description
          );
        }

        // Respond immediately
        await interaction.reply({
          embeds: [
            embed
          ]
        });

        return;
      }

      // ==================================================
      // START BUTTON
      // ==================================================

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

        // Host
        const isHost =
          interaction.user.id ===
          game.hostId;

        // Manage Messages
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

        // ==================================================
        // ACKNOWLEDGE BUTTON IMMEDIATELY
        // ==================================================

        await interaction.deferUpdate();

        game.started = true;

        const startEmbed =
          new EmbedBuilder()
            .setColor(0x808080)
            .setDescription(
              `> 🔓 **UNLOCK!**\n` +
              `> 🔢 **1 - 10000**\n` +
              `> 💀 **TRY TO WIN**`
            );

        await interaction.message.edit({
          embeds: [
            startEmbed
          ],
          components: []
        });

        return;
      }

    } catch (error) {

      console.error(
        "❌ Interaction error:",
        error
      );

      // Try to respond if Discord hasn't
      // received anything yet.
      try {

        if (
          interaction.isRepliable() &&
          !interaction.replied &&
          !interaction.deferred
        ) {

          await interaction.reply({
            content:
              "❌ An error occurred while processing the interaction.",
            ephemeral: true
          });
        }

      } catch (replyError) {

        console.error(
          "❌ Could not send error response:",
          replyError
        );
      }
    }
  }
);

// ==================================================
// NUMBER GUESSING
// ==================================================

client.on(
  "messageCreate",
  async message => {

    try {

      if (message.author.bot) return;
      if (!message.guild) return;

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

      if (
        guess < 1 ||
        guess > 10000
      ) {
        return;
      }

      // ==================================================
      // WIN
      // ==================================================

      if (
        guess === game.answer
      ) {

        const winEmbed =
          new EmbedBuilder()
            .setColor(0x808080)
            .setDescription(
              `> 🔒 **LOCK!**\n` +
              `> 🎊 <@${message.author.id}> **WON!**\n` +
              `> ✅ **${guess}**`
            );

        await message.channel.send({
          embeds: [
            winEmbed
          ]
        });

        games.delete(
          gameId
        );

        return;
      }

      // ==================================================
      // CLOSE
      // ==================================================

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

    } catch (error) {

      console.error(
        "❌ Guessing error:",
        error
      );
    }
  }
);

// ==================================================
// ERROR HANDLING
// ==================================================

client.on(
  "error",
  error => {
    console.error(
      "❌ Discord client error:",
      error
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

// ==================================================
// LOGIN
// ==================================================

client.login(TOKEN);
