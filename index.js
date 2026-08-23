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
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 3000;

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

// ==================================================
// RENDER WEB SERVER
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
// GAME STORAGE
// ==================================================

const games = new Map();

// ==================================================
// SLASH COMMANDS
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
// REGISTER GUILD COMMANDS
// ==================================================

async function registerCommands() {
  try {
    console.log("🔄 Registering guild commands...");

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

    console.log("✅ Guild commands registered successfully.");
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
    blue: 0x3498DB,
    red: 0xE74C3C,
    green: 0x2ECC71,
    yellow: 0xF1C40F,
    orange: 0xE67E22,
    purple: 0x9B59B6,
    pink: 0xFF69B4,
    cyan: 0x00FFFF,
    aqua: 0x1ABC9C,
    gold: 0xFFD700,
    white: 0xFFFFFF,
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
// BOT READY
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

client.on("interactionCreate", async interaction => {

  // ==================================================
  // SLASH COMMANDS
  // ==================================================

  if (interaction.isChatInputCommand()) {

    // ==================================================
    // /guessnumber
    // ==================================================

    if (interaction.commandName === "guessnumber") {

      const answer =
        interaction.options.getInteger("answer");

      // ALWAYS ACKNOWLEDGE FIRST
      if (!answer || answer < 1 || answer > 10000) {
        try {
          await interaction.reply({
            content:
              "❌ Please provide an answer from 1 to 10000.",
            ephemeral: true
          });
        } catch (error) {
          console.error(
            "❌ Answer validation error:",
            error
          );
        }

        return;
      }

      const gameId =
        `${interaction.guildId}-${interaction.channelId}`;

      if (games.has(gameId)) {

        try {
          await interaction.reply({
            content:
              "❌ There is already a Guess Number game in this channel.",
            ephemeral: true
          });
        } catch (error) {
          console.error(
            "❌ Existing game reply error:",
            error
          );
        }

        return;
      }

      const host = interaction.user;

      // Save answer as a NUMBER
      games.set(gameId, {
        hostId: host.id,
        answer: Number(answer),
        started: false
      });

      // ==================================================
      // ACKNOWLEDGE DISCORD IMMEDIATELY
      // ==================================================

      try {
        await interaction.reply({
          content: "\u200b",
          ephemeral: true
        });
      } catch (error) {
        console.error(
          "❌ Could not acknowledge /guessnumber:",
          error
        );

        games.delete(gameId);
        return;
      }

      // ==================================================
      // DM ANSWER TO HOST
      // ==================================================

      try {
        const dmEmbed =
          new EmbedBuilder()
            .setColor(0x808080)
            .setDescription(
              `> 🔢 **Answer:** \`${answer}\`\n` +
              `> 📌 **Range:** \`1 - 10000\``
            );

        await host.send({
          embeds: [dmEmbed]
        });

        console.log(
          `📩 Answer ${answer} sent to ${host.tag}`
        );

      } catch (error) {
        console.log(
          `⚠️ Could not DM ${host.tag}. Their DMs may be disabled.`
        );
      }

      // ==================================================
      // PUBLIC GAME EMBED
      // ==================================================

      const gameEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setTitle("GAME EVENT 🧧")
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
              .setStyle(ButtonStyle.Primary)
          );

      // Send public message
      try {
        await interaction.channel.send({
          embeds: [gameEmbed],
          components: [row]
        });

        console.log(
          `🎮 Guess game created in ${interaction.channel.name}`
        );

      } catch (error) {

        console.error(
          "❌ Could not send game message:",
          error
        );

        games.delete(gameId);

        try {
          await interaction.editReply({
            content:
              "❌ I couldn't send the game message in this channel."
          });
        } catch {}
      }

      return;
    }

    // ==================================================
    // /embed
    // ==================================================

    if (interaction.commandName === "embed") {

      const title =
        interaction.options.getString("title");

      const description =
        interaction.options.getString("description");

      const color =
        interaction.options.getString("color") || "gray";

      const embed =
        new EmbedBuilder()
          .setColor(getColor(color))
          .setFooter({
            text: `Today at ${getCurrentTime()}`
          });

      if (title && title.trim() !== "") {
        embed.setTitle(title);
      }

      if (
        description &&
        description.trim() !== ""
      ) {
        embed.setDescription(description);
      }

      // Immediate response
      try {

        await interaction.reply({
          embeds: [embed]
        });

      } catch (error) {

        console.error(
          "❌ /embed response error:",
          error
        );
      }

      return;
    }
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

      try {
        await interaction.reply({
          content:
            "❌ This game no longer exists.",
          ephemeral: true
        });
      } catch {}

      return;
    }

    // ==================================================
    // CHECK PERMISSION
    // ==================================================

    const isHost =
      interaction.user.id === game.hostId;

    const canManageMessages =
      interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageMessages
      ) === true;

    if (
      !isHost &&
      !canManageMessages
    ) {

      try {
        await interaction.reply({
          content:
            "❌ Only the **host** or members with **Manage Messages** can start this game.",
          ephemeral: true
        });
      } catch {}

      return;
    }

    if (game.started) {

      try {
        await interaction.reply({
          content:
            "❌ The game has already started!",
          ephemeral: true
        });
      } catch {}

      return;
    }

    // ==================================================
    // ACKNOWLEDGE BUTTON IMMEDIATELY
    // ==================================================

    try {
      await interaction.deferUpdate();
    } catch (error) {
      console.error(
        "❌ Button acknowledgement failed:",
        error
      );

      return;
    }

    game.started = true;

    // ==================================================
    // START GAME EMBED
    // ==================================================

    const startEmbed =
      new EmbedBuilder()
        .setColor(0x808080)
        .setDescription(
          `> 🔓 **UNLOCK!**\n` +
          `> 🔢 **1 - 10000**\n` +
          `> 💀 **TRY TO WIN**`
        );

    try {

      await interaction.message.edit({
        embeds: [startEmbed],
        components: []
      });

    } catch (error) {

      console.error(
        "❌ Could not update Start button:",
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

    const game =
      games.get(gameId);

    if (!game || !game.started) {
      return;
    }

    const content =
      message.content.trim();

    // Only accept numbers
    if (!/^\d+$/.test(content)) {
      return;
    }

    const guess =
      Number(content);

    // Must be 1 - 10000
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

      const winEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            `> 🔒 **LOCK!**\n` +
            `> 🎊 <@${message.author.id}> **WON!**\n` +
            `> ✅ **${guess}**`
          );

      await message.channel.send({
        embeds: [winEmbed]
      });

      games.delete(gameId);

      return;
    }

    // ==================================================
    // CLOSE MESSAGE
    // ==================================================

    const difference =
      Math.abs(
        game.answer - guess
      );

    // 10% of answer
    const closeRange =
      Math.max(
        1,
        Math.floor(
          game.answer * 0.10
        )
      );

    if (difference <= closeRange) {

      const closeEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            "> 😱 **YOU’RE SO CLOSE BRO!**"
          );

      await message.reply({
        embeds: [closeEmbed]
      });
    }

  } catch (error) {

    console.error(
      "❌ Message handling error:",
      error
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

client.login(TOKEN);
