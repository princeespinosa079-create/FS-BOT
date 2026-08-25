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

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const OWNER_ID = "1302080645987569694";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID.");
  process.exit(1);
}

// =========================
// Web Server
// =========================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.status(200).send("FS Bot is online.");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "online",
    bot: client.user ? client.user.tag : "connecting"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// =========================
// Discord Client
// =========================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// =========================
// Games
// =========================

const games = new Map();

// =========================
// Slash Commands
// =========================

const commands = [
  // /guessnumber
  new SlashCommandBuilder()
    .setName("guessnumber")
    .setDescription("Create a number guessing game.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageNicknames.toString()
    )
    .addIntegerOption(option =>
      option
        .setName("answer")
        .setDescription("Secret answer from 1 to 10000.")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
    ),

  // /embed
  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a gray embed.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageNicknames.toString()
    )
    .addStringOption(option =>
      option
        .setName("description")
        .setDescription("Embed description.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("title")
        .setDescription("Embed title.")
        .setRequired(false)
    ),

  // /serverlist
  new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("Show all servers where the bot is installed."),

  // /leave
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Make the bot leave a server.")
    .addStringOption(option =>
      option
        .setName("server-id")
        .setDescription("The ID of the server to leave.")
        .setRequired(true)
    )
].map(command => command.toJSON());

// =========================
// Register Commands
// =========================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    console.log("🧹 Cleaning old slash commands...");

    // Remove all global commands
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: []
      }
    );

    console.log("🗑️ Old global commands removed.");

    // Remove all guild commands
    await rest.put(
      Routes.applicationGuildCommands(
        CLIENT_ID,
        GUILD_ID
      ),
      {
        body: []
      }
    );

    console.log("🗑️ Old guild commands removed.");

    // Register only the 4 commands
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
      "✅ Registered /guessnumber, /embed, /serverlist and /leave."
    );

  } catch (error) {
    console.error(
      "❌ Failed to register commands:",
      error
    );
  }
}

// =========================
// Ready
// =========================

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(
    `🏠 Connected to ${client.guilds.cache.size} server(s).`
  );

  await registerCommands();
});

// =========================
// Interactions
// =========================

client.on("interactionCreate", async interaction => {
  try {

    // =========================
    // OWNER-ONLY COMMANDS
    // =========================

    if (
      interaction.isChatInputCommand() &&
      (
        interaction.commandName === "serverlist" ||
        interaction.commandName === "leave"
      )
    ) {
      if (interaction.user.id !== OWNER_ID) {
        await interaction.reply({
          content: "❌ Only the bot owner can use this command.",
          ephemeral: true
        });

        return;
      }
    }

    // =========================
    // MANAGE NICKNAMES COMMANDS
    // =========================

    if (
      interaction.isChatInputCommand() &&
      (
        interaction.commandName === "guessnumber" ||
        interaction.commandName === "embed"
      )
    ) {
      if (
        !interaction.memberPermissions ||
        !interaction.memberPermissions.has(
          PermissionFlagsBits.ManageNicknames
        )
      ) {
        await interaction.reply({
          content:
            "❌ You need the **Manage Nicknames** permission to use this command.",
          ephemeral: true
        });

        setTimeout(() => {
          interaction.deleteReply().catch(() => {});
        }, 2000);

        return;
      }
    }

    // =========================
    // /serverlist
    // =========================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "serverlist"
    ) {
      await interaction.deferReply({
        ephemeral: true
      });

      const guilds = [...client.guilds.cache.values()];

      let description =
        `**Total Servers:** \`${guilds.length}\`\n\n`;

      if (guilds.length === 0) {
        description += "No servers found.";
      }

      for (let i = 0; i < guilds.length; i++) {
        const guild = guilds[i];

        let inviteLink = "Unavailable";

        try {
          const channel = guild.channels.cache.find(channel =>
            channel.isTextBased() &&
            channel.permissionsFor(guild.members.me)?.has(
              PermissionFlagsBits.CreateInstantInvite
            )
          );

          if (channel) {
            const invite = await channel.createInvite({
              maxAge: 0,
              maxUses: 0,
              unique: false,
              reason: "Server list invite"
            });

            inviteLink = invite.url;
          }
        } catch (error) {
          inviteLink = "Unavailable";
        }

        description +=
          `**${i + 1}. ${guild.name}**\n` +
          `> **ID:** \`${guild.id}\`\n` +
          `> **Invite:** ${inviteLink}\n\n`;
      }

      const embed = new EmbedBuilder()
        .setTitle("SERVER LIST 📋")
        .setDescription(description)
        .setColor(0x808080);

      await interaction.editReply({
        embeds: [embed]
      });

      return;
    }

    // =========================
    // /leave
    // =========================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "leave"
    ) {
      const serverId =
        interaction.options.getString("server-id").trim();

      const guild = client.guilds.cache.get(serverId);

      if (!guild) {
        await interaction.reply({
          content:
            `❌ I am not in a server with ID \`${serverId}\`.`,
          ephemeral: true
        });

        return;
      }

      const serverName = guild.name;

      try {
        await guild.leave();

        await interaction.reply({
          content:
            `✅ Successfully left **${serverName}** (\`${serverId}\`).`,
          ephemeral: true
        });

      } catch (error) {
        console.error(
          "❌ Failed to leave server:",
          error
        );

        await interaction.reply({
          content:
            `❌ Failed to leave **${serverName}**.`,
          ephemeral: true
        });
      }

      return;
    }

    // =========================
    // /guessnumber
    // =========================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "guessnumber"
    ) {
      const answer =
        interaction.options.getInteger("answer");

      if (games.has(interaction.channelId)) {
        await interaction.reply({
          content:
            "⚠️ There is already a Guess Game in this channel.",
          ephemeral: true
        });

        setTimeout(() => {
          interaction.deleteReply().catch(() => {});
        }, 1500);

        return;
      }

      games.set(interaction.channelId, {
        answer,
        hostId: interaction.user.id,
        active: false
      });

      // =========================
      // DM ANSWER
      // =========================

      const answerEmbed = new EmbedBuilder()
        .setDescription(
          `🔢 **Answer:** \`${answer}\``
        )
        .setColor(0x808080);

      try {
        await interaction.user.send({
          embeds: [answerEmbed]
        });
      } catch (error) {
        games.delete(interaction.channelId);

        await interaction.reply({
          content:
            "❌ I couldn't DM you. Please enable your Discord DMs and try again.",
          ephemeral: true
        });

        setTimeout(() => {
          interaction.deleteReply().catch(() => {});
        }, 2000);

        return;
      }

      // =========================
      // SILENT COMMAND
      // =========================

      await interaction.deferReply({
        ephemeral: true
      });

      await interaction.deleteReply();

      // =========================
      // GAME EVENT
      // =========================

      const panelEmbed = new EmbedBuilder()
        .setTitle("GAME EVENT 🧧")
        .setDescription(
          `> **Host by:** <@${interaction.user.id}>\n` +
          `> **Click the** \`Start Button\` **to start** \`Guess Game\`.`
        )
        .setColor(0x808080);

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId("guess_start")
            .setLabel("Start")
            .setStyle(ButtonStyle.Success)
        );

      await interaction.channel.send({
        embeds: [panelEmbed],
        components: [row]
      });

      return;
    }

    // =========================
    // /embed
    // =========================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "embed"
    ) {
      const description =
        interaction.options.getString("description");

      const title =
        interaction.options.getString("title");

      const embed = new EmbedBuilder()
        .setDescription(description)
        .setColor(0x808080);

      if (title) {
        embed.setTitle(title);
      }

      // Silent command
      await interaction.deferReply({
        ephemeral: true
      });

      await interaction.deleteReply();

      await interaction.channel.send({
        embeds: [embed]
      });

      return;
    }

    // =========================
    // START BUTTON
    // =========================

    if (
      interaction.isButton() &&
      interaction.customId === "guess_start"
    ) {
      const game =
        games.get(interaction.channelId);

      if (!game) {
        await interaction.reply({
          content:
            "❌ There is no active guessing game.",
          ephemeral: true
        });

        return;
      }

      // =========================
      // HOST / MANAGE NICKNAMES
      // =========================

      const isHost =
        interaction.user.id === game.hostId;

      const canManageNicknames =
        interaction.memberPermissions &&
        interaction.memberPermissions.has(
          PermissionFlagsBits.ManageNicknames
        );

      if (!isHost && !canManageNicknames) {
        await interaction.reply({
          content:
            "❌ Only Host or Manage Nicknames can start this Guess Game.",
          ephemeral: true
        });

        return;
      }

      if (game.active) {
        await interaction.reply({
          content:
            "⚠️ The Guess Game has already started.",
          ephemeral: true
        });

        return;
      }

      game.active = true;

      // =========================
      // UNLOCK CHANNEL
      // =========================

      if (
        interaction.guild &&
        interaction.channel &&
        interaction.channel.permissionOverwrites
      ) {
        try {
          await interaction.channel.permissionOverwrites.edit(
            interaction.guild.roles.everyone,
            {
              SendMessages: true
            }
          );
        } catch (error) {
          console.error(
            "⚠️ Could not unlock channel:",
            error
          );
        }
      }

      // =========================
      // GAME EMBED
      // =========================

      const gameEmbed = new EmbedBuilder()
        .setDescription(
          "> 🔓 **UNLOCK!**\n" +
          "> 🔢 **1 - 10000**\n" +
          "> 💀 **TRY TO WIN**"
        )
        .setColor(0x808080);

      await interaction.update({
        embeds: [gameEmbed],
        components: []
      });

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
      await interaction.reply({
        content: "❌ An error occurred.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// =========================
// Guess Number Messages
// =========================

client.on("messageCreate", async message => {
  try {
    if (message.author.bot) return;

    const game =
      games.get(message.channelId);

    if (!game || !game.active) return;

    const guess =
      Number(message.content.trim());

    if (!Number.isInteger(guess)) return;

    if (guess < 1 || guess > 10000) return;

    // =========================
    // CORRECT ANSWER
    // =========================

    if (guess === game.answer) {

      const winEmbed = new EmbedBuilder()
        .setDescription(
          `> 🔒 **LOCK!**\n` +
          `> 🎊 <@${message.author.id}> **WON!**\n` +
          `> ✅ **${guess}**`
        )
        .setColor(0x808080);

      await message.channel.send({
        embeds: [winEmbed]
      });

      // =========================
      // LOCK CHANNEL
      // =========================

      if (
        message.guild &&
        message.channel.permissionOverwrites
      ) {
        try {
          await message.channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
              SendMessages: false
            }
          );
        } catch (error) {
          console.error(
            "⚠️ Could not lock channel:",
            error
          );
        }
      }

      games.delete(message.channelId);

      return;
    }

    // Wrong guesses = NO RESPONSE

  } catch (error) {
    console.error(
      "❌ Message handling error:",
      error
    );
  }
});

// =========================
// Errors
// =========================

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
    "❌ Unhandled promise rejection:",
    error
  );
});

process.on("uncaughtException", error => {
  console.error(
    "❌ Uncaught exception:",
    error
  );
});

// =========================
// Login
// =========================

console.log("🔑 Logging into Discord...");

client.login(TOKEN).catch(error => {
  console.error(
    "❌ Discord login failed:",
    error
  );

  process.exit(1);
});
