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
  MessageFlags,
  ActivityType
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

console.log("✅ Environment variables found.");

// ==================================================
// RENDER WEB SERVER
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
// SLASH COMMANDS
// ==================================================

const commandData = [
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
];

const commands = commandData.map(command =>
  command.toJSON()
);

// ==================================================
// REGISTER GUILD COMMANDS
// ==================================================

async function registerCommands() {
  try {
    console.log("🔄 Registering slash commands...");

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
      "✅ Slash commands registered successfully."
    );
  } catch (error) {
    console.error(
      "❌ Slash command registration failed:"
    );
    console.error(error);
  }
}

// ==================================================
// DISCORD DEBUG
// ==================================================

client.on("debug", info => {
  console.log(`[Discord Debug] ${info}`);
});

client.on("warn", warning => {
  console.warn(`[Discord Warning] ${warning}`);
});

client.on("error", error => {
  console.error("❌ Discord Client Error:");
  console.error(error);
});

client.on("shardError", error => {
  console.error("❌ Discord Shard Error:");
  console.error(error);
});

client.on("shardDisconnect", (event, shardId) => {
  console.log(
    `⚠️ Discord shard ${shardId} disconnected.`
  );
});

client.on("shardReconnecting", shardId => {
  console.log(
    `🔄 Discord shard ${shardId} reconnecting...`
  );
});

client.on("shardReady", shardId => {
  console.log(
    `✅ Discord shard ${shardId} ready.`
  );
});

// ==================================================
// READY
// ==================================================

client.once("ready", async () => {
  console.log(
    `✅ Logged in as ${client.user.tag}`
  );

  console.log(
    `🏠 Connected to ${client.guilds.cache.size} server(s).`
  );

  client.user.setActivity(
    "Free Source (FS)",
    {
      type: ActivityType.Watching
    }
  );

  await registerCommands();
});

// ==================================================
// INTERACTIONS
// ==================================================

client.on("interactionCreate", async interaction => {

  console.log(
    `📥 Interaction received: ${
      interaction.isChatInputCommand()
        ? interaction.commandName
        : interaction.isButton()
          ? interaction.customId
          : "other"
    }`
  );

  try {

    // ==================================================
    // /GUESSNUMBER
    // ==================================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "guessnumber"
    ) {

      const answer =
        interaction.options.getInteger("answer");

      console.log(
        `🎯 Answer received: ${answer}`
      );

      // Respond immediately
      await interaction.reply({
        content: " ",
        flags: MessageFlags.Ephemeral
      });

      console.log(
        "✅ /guessnumber interaction acknowledged."
      );

      const gameId =
        `${interaction.guildId}-${interaction.channelId}`;

      if (games.has(gameId)) {

        await interaction.editReply({
          content:
            "❌ There is already a Guess Number game in this channel."
        });

        return;
      }

      if (
        answer === null ||
        answer < 1 ||
        answer > 10000
      ) {

        await interaction.editReply({
          content:
            "❌ Please provide an answer from 1 to 10000."
        });

        return;
      }

      // ==================================================
      // SAVE GAME
      // ==================================================

      games.set(gameId, {
        hostId: interaction.user.id,
        answer: answer,
        started: false
      });

      console.log(
        `💾 Game saved. Answer: ${answer}`
      );

      // ==================================================
      // DM HOST
      // ==================================================

      try {

        const dmEmbed =
          new EmbedBuilder()
            .setColor(0x808080)
            .setDescription(
              `> 🔢 **Answer:** \`${answer}\`\n` +
              `> 📌 **Range:** \`1 - 10000\``
            );

        await interaction.user.send({
          embeds: [dmEmbed]
        });

        console.log(
          "📩 Answer sent to host DM."
        );

      } catch (error) {

        console.error(
          "⚠️ Could not send DM to host."
        );
      }

      // ==================================================
      // PUBLIC GAME EVENT
      // ==================================================

      const gameEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setTitle("GAME EVENT 🧧")
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
              .setStyle(ButtonStyle.Primary)
          );

      try {

        await interaction.channel.send({
          embeds: [gameEmbed],
          components: [row]
        });

        console.log(
          "🎮 Public game event sent."
        );

      } catch (error) {

        console.error(
          "❌ Could not send public game event:"
        );

        console.error(error);

        games.delete(gameId);

        await interaction.editReply({
          content:
            "❌ I couldn't send the game message in this channel. Check my channel permissions."
        });

        return;
      }

      await interaction.editReply({
        content: " "
      });

      return;
    }

    // ==================================================
    // /EMBED
    // ==================================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "embed"
    ) {

      await interaction.deferReply();

      const title =
        interaction.options.getString("title");

      const description =
        interaction.options.getString("description");

      const color =
        interaction.options.getString("color") ||
        "gray";

      const now =
        new Date().toLocaleTimeString(
          "en-PH",
          {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          }
        );

      const embed =
        new EmbedBuilder()
          .setColor(getColor(color))
          .setFooter({
            text: `Today at ${now}`
          });

      if (
        title &&
        title.trim().length > 0
      ) {
        embed.setTitle(title);
      }

      if (
        description &&
        description.trim().length > 0
      ) {
        embed.setDescription(
          description
        );
      }

      await interaction.editReply({
        embeds: [embed]
      });

      console.log(
        "✅ /embed responded."
      );

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

        await interaction.reply({
          content:
            "❌ This game no longer exists.",
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      const isHost =
        interaction.user.id ===
        game.hostId;

      const canManageMessages =
        interaction.memberPermissions?.has(
          PermissionFlagsBits.ManageMessages
        ) === true;

      if (
        !isHost &&
        !canManageMessages
      ) {

        await interaction.reply({
          content:
            "❌ Only the **host** or members with **Manage Messages** can start this game.",
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      if (game.started) {

        await interaction.reply({
          content:
            "❌ The game has already started!",
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // Acknowledge button immediately
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
        embeds: [startEmbed],
        components: []
      });

      console.log(
        `🎮 Game started by ${interaction.user.tag}`
      );

      return;
    }

  } catch (error) {

    console.error(
      "❌ Interaction handler error:"
    );

    console.error(error);

    try {

      if (
        interaction.isRepliable() &&
        !interaction.replied &&
        !interaction.deferred
      ) {

        await interaction.reply({
          content:
            "❌ An error occurred while processing this interaction.",
          flags: MessageFlags.Ephemeral
        });

      } else if (
        interaction.isRepliable() &&
        interaction.deferred &&
        !interaction.replied
      ) {

        await interaction.editReply({
          content:
            "❌ An error occurred while processing this interaction."
        });
      }

    } catch (replyError) {

      console.error(
        "❌ Could not send interaction error:"
      );

      console.error(replyError);
    }
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

    // ==================================================
    // WINNER
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
        embeds: [winEmbed]
      });

      console.log(
        `🏆 ${message.author.tag} won with ${guess}.`
      );

      games.delete(gameId);

      return;
    }

    // ==================================================
    // CLOSE ANSWER
    // ==================================================

    const closeRange =
      Math.max(
        1,
        Math.floor(game.answer * 0.10)
      );

    const difference =
      Math.abs(
        game.answer - guess
      );

    if (
      difference <= closeRange
    ) {

      const closeEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            "> 😱 **YOU’RE SO CLOSE BRO!**"
          );

      await message.reply({
        embeds: [closeEmbed]
      });

      console.log(
        `😱 Close guess: ${guess}; difference: ${difference}`
      );
    }

  } catch (error) {

    console.error(
      "❌ Guessing error:"
    );

    console.error(error);
  }
});

// ==================================================
// PROCESS ERRORS
// ==================================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled Rejection:"
    );
    console.error(error);
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ Uncaught Exception:"
    );
    console.error(error);
  }
);

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
      "❌ DISCORD LOGIN FAILED:"
    );

    console.error(error);
  });
