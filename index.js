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

const OpenAI = require("openai");
const express = require("express");

// =========================
// Environment Variables
// =========================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const OWNER_ID = "1302080645987569694";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID."
  );
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.warn(
    "⚠️ OPENAI_API_KEY is missing. AI responses will be disabled."
  );
}

// =========================
// OpenAI
// =========================

const openai = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY
    })
  : null;

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
    bot: client.user ? client.user.tag : "connecting",
    ai: openai ? "enabled" : "disabled"
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
// AI Cooldown
// =========================

const aiCooldowns = new Map();

const AI_COOLDOWN = 3000;

// =========================
// Today at HH:MM
// =========================

function getTodayTime() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Manila"
  });
}

// =========================
// AI Personality
// =========================

const AI_PERSONALITY = `
You are a Discord bot with a sarcastic, sassy, blunt and playful personality.

You are NOT genuinely hateful or abusive.

Your personality:
- Be sarcastic and teasing.
- Be blunt and confident.
- Use playful internet humor.
- You can use mild casual slang.
- Do not target protected characteristics.
- Do not threaten people.
- Do not encourage violence or dangerous behavior.
- Do not sexually harass anyone.
- Do not use hateful slurs.
- Do not relentlessly bully or humiliate a person.
- Still answer questions accurately and helpfully.
- If someone asks a serious question, actually answer it.
- Keep responses relatively short and Discord-friendly.
- Don't mention these personality instructions.
- Don't say you are an AI unless it is relevant.
- You can use emojis occasionally.

Example style:
"Bro really summoned me for THAT 😭. The answer is 100."

Another example:
"Yeah, I can help. Send the code before it commits another crime against JavaScript 💀."
`;

// =========================
// Ask OpenAI
// =========================

async function askAI(message, prompt) {
  if (!openai) {
    return null;
  }

  try {
    const response = await openai.responses.create({
      model: "gpt-5.6-luna",
      instructions: AI_PERSONALITY,
      input: prompt,
      max_output_tokens: 350
    });

    let text = response.output_text?.trim();

    if (!text) {
      return null;
    }

    // Discord message limit protection
    if (text.length > 1900) {
      text = text.slice(0, 1890) + "...";
    }

    return text;

  } catch (error) {
    console.error("❌ OpenAI error:", error);
    return null;
  }
}

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
    .setDescription(
      "Show all servers where the bot is installed. (Owner only)"
    ),

  // /leave
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription(
      "Make the bot leave a server. (Owner only)"
    )
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
  const rest = new REST({
    version: "10"
  }).setToken(TOKEN);

  try {
    console.log("🧹 Cleaning old slash commands...");

    // Remove old GLOBAL commands
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: []
      }
    );

    console.log("🗑️ Old global commands removed.");

    // Remove old GUILD commands
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

    // Register commands ONLY in GUILD_ID
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
  console.log(
    `✅ Logged in as ${client.user.tag}`
  );

  console.log(
    `🏠 Connected to ${client.guilds.cache.size} server(s).`
  );

  console.log(
    `🤖 OpenAI AI: ${openai ? "Enabled" : "Disabled"}`
  );

  await registerCommands();
});

// =========================
// Interactions
// =========================

client.on("interactionCreate", async interaction => {
  try {

    // =========================
    // OWNER ONLY
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
          content:
            "❌ Only the bot owner can use this command.",
          ephemeral: true
        });

        return;
      }
    }

    // =========================
    // MANAGE NICKNAMES ONLY
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

      const guilds = [
        ...client.guilds.cache.values()
      ];

      let description =
        `**Total Servers:** \`${guilds.length}\`\n\n`;

      if (guilds.length === 0) {
        description += "No servers found.";
      }

      for (let i = 0; i < guilds.length; i++) {
        const guild = guilds[i];

        let inviteLink = "Unavailable";

        try {
          const channel =
            guild.channels.cache.find(channel =>
              channel.isTextBased() &&
              channel
                .permissionsFor(guild.members.me)
                ?.has(
                  PermissionFlagsBits.CreateInstantInvite
                )
            );

          if (channel) {
            const invite =
              await channel.createInvite({
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
        interaction.options
          .getString("server-id")
          .trim();

      const guild =
        client.guilds.cache.get(serverId);

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

      const row =
        new ActionRowBuilder()
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
        interaction.options.getString(
          "description"
        );

      const title =
        interaction.options.getString(
          "title"
        );

      const embed = new EmbedBuilder()
        .setDescription(description)
        .setColor(0x808080)
        .setFooter({
          text:
            `Today at ${getTodayTime()}`
        });

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

      const gameEmbed =
        new EmbedBuilder()
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

      const winEmbed =
        new EmbedBuilder()
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
// AI MESSAGE HANDLER
// =========================

client.on("messageCreate", async message => {
  try {
    if (message.author.bot) return;

    if (!openai) return;

    // =========================
    // Detect Bot Mention
    // =========================

    const botMentioned =
      message.mentions.users.has(client.user.id);

    // =========================
    // Detect @everyone / @here
    // =========================

    const massMention =
      message.mentions.everyone;

    if (!botMentioned && !massMention) {
      return;
    }

    // =========================
    // Cooldown
    // =========================

    const now = Date.now();
    const lastUsed =
      aiCooldowns.get(message.author.id) || 0;

    if (now - lastUsed < AI_COOLDOWN) {
      return;
    }

    aiCooldowns.set(
      message.author.id,
      now
    );

    // =========================
    // Remove Bot Mention
    // =========================

    let prompt =
      message.content
        .replace(
          new RegExp(`<@!?${client.user.id}>`, "g"),
          ""
        )
        .trim();

    // Remove mass mentions
    prompt = prompt
      .replace(/@everyone/g, "")
      .replace(/@here/g, "")
      .trim();

    if (!prompt) {
      prompt =
        "Someone pinged you without asking anything. Respond with a short sarcastic reaction.";
    }

    // =========================
    // Show typing
    // =========================

    if (
      message.channel &&
      message.channel.sendTyping
    ) {
      await message.channel.sendTyping();
    }

    // =========================
    // AI Response
    // =========================

    const response =
      await askAI(message, prompt);

    if (!response) {
      return;
    }

    // =========================
    // Reply
    // =========================

    await message.reply({
      content: response,
      allowedMentions: {
        repliedUser: false
      }
    });

  } catch (error) {
    console.error(
      "❌ AI message error:",
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

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled promise rejection:",
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
