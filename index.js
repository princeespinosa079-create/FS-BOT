const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");

const express = require("express");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID.");
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
  intents: [GatewayIntentBits.Guilds]
});

// =========================
// Commands
// =========================

const commands = [
  new SlashCommandBuilder()
    .setName("guessnumber")
    .setDescription("Guess a number between 1 and 100.")
    .addIntegerOption(option =>
      option
        .setName("number")
        .setDescription("Your guess")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a custom embed.")
    .addStringOption(option =>
      option
        .setName("title")
        .setDescription("Embed title")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("description")
        .setDescription("Embed description")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("color")
        .setDescription("Hex color, for example #00FF00")
        .setRequired(false)
    )
].map(command => command.toJSON());

// =========================
// Register GLOBAL Commands
// =========================

async function registerCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    console.log("🔄 Updating global slash commands...");

    // PUT replaces the complete global command list.
    // This removes old/duplicate versions.
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: commands
      }
    );

    console.log("✅ Global commands updated.");
  } catch (error) {
    console.error("❌ Failed to register commands:", error);
  }
}

// =========================
// Ready
// =========================

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🏠 Connected to ${client.guilds.cache.size} server(s).`);

  await registerCommands();
});

// =========================
// Interaction Handler
// =========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  console.log(`📥 /${interaction.commandName}`);

  // =========================
  // /guessnumber
  // =========================

  if (interaction.commandName === "guessnumber") {
    try {
      const guess = interaction.options.getInteger("number");
      const answer = Math.floor(Math.random() * 100) + 1;

      let result;

      if (guess === answer) {
        result = `🎉 **Correct!** You guessed the number!`;
      } else if (guess < answer) {
        result = `📈 **Too low!** Try a higher number.`;
      } else {
        result = `📉 **Too high!** Try a lower number.`;
      }

      await interaction.reply({
        content:
          `🎯 **Number Guessing Game**\n\n` +
          `Your guess: **${guess}**\n` +
          `${result}`,
        ephemeral: false
      });

      console.log(
        `🎯 Guess: ${guess} | Answer: ${answer}`
      );
    } catch (error) {
      console.error("❌ /guessnumber error:", error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ Something went wrong.",
          ephemeral: true
        });
      }
    }

    return;
  }

  // =========================
  // /embed
  // =========================

  if (interaction.commandName === "embed") {
    try {
      const title = interaction.options.getString("title");
      const description =
        interaction.options.getString("description");

      let color =
        interaction.options.getString("color") || "#00FFFF";

      // Remove # if provided
      color = color.replace("#", "");

      // Validate hex color
      if (!/^[0-9A-Fa-f]{6}$/.test(color)) {
        color = "00FFFF";
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(`#${color}`)
        .setTimestamp();

      await interaction.reply({
        embeds: [embed]
      });
    } catch (error) {
      console.error("❌ /embed error:", error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ Something went wrong.",
          ephemeral: true
        });
      }
    }

    return;
  }
});

// =========================
// Errors
// =========================

client.on("error", error => {
  console.error("❌ Discord client error:", error);
});

client.on("warn", warning => {
  console.warn("⚠️ Discord warning:", warning);
});

process.on("unhandledRejection", error => {
  console.error("❌ Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("❌ Uncaught exception:", error);
});

// =========================
// Login
// =========================

console.log("🔑 Logging into Discord...");

client.login(TOKEN).catch(error => {
  console.error("❌ Discord login failed:", error);
  process.exit(1);
});
