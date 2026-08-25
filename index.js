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
  res.send("FS Bot is online.");
});

app.get("/health", (req, res) => {
  res.json({
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
        .setDescription("Enter your guess")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Create a custom embed.")
    .addStringOption(option =>
      option
        .setName("title")
        .setDescription("Enter the embed title")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("description")
        .setDescription("Enter the embed description")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("color")
        .setDescription("Hex color, e.g. #00FFFF")
        .setRequired(false)
    )
].map(command => command.toJSON());

// =========================
// Register Global Commands
// =========================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    console.log("🗑️ Removing old global commands...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: [] }
    );

    console.log("✅ Old global commands removed.");

    console.log("🔄 Registering new global commands...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log("✅ New global commands registered.");
  } catch (error) {
    console.error("❌ Command registration failed:");
    console.error(error);
  }
}

// =========================
// Ready
// =========================

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🏠 Servers: ${client.guilds.cache.size}`);

  await registerCommands();
});

// =========================
// Interaction Handler
// =========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  console.log(`📥 Received /${interaction.commandName}`);

  try {
    // =========================
    // GUESS NUMBER
    // =========================

    if (interaction.commandName === "guessnumber") {
      const guess = interaction.options.getInteger("number");

      const answer = Math.floor(Math.random() * 100) + 1;

      let message;

      if (guess === answer) {
        message = "🎉 **Correct! You guessed the number!**";
      } else if (guess < answer) {
        message = "📈 **Too low!** Try a higher number.";
      } else {
        message = "📉 **Too high!** Try a lower number.";
      }

      await interaction.reply({
        content:
          `🎯 **Number Guessing Game**\n\n` +
          `Your guess: **${guess}**\n` +
          `${message}`
      });

      console.log(`🎯 Guess: ${guess} | Answer: ${answer}`);

      return;
    }

    // =========================
    // EMBED
    // =========================

    if (interaction.commandName === "embed") {
      const title = interaction.options.getString("title");
      const description =
        interaction.options.getString("description");

      let color =
        interaction.options.getString("color") || "#00FFFF";

      color = color.replace("#", "");

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

      return;
    }

  } catch (error) {
    console.error("❌ Interaction error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ An error occurred.",
        ephemeral: true
      });
    }
  }
});

// =========================
// Error Handling
// =========================

client.on("error", error => {
  console.error("❌ Discord error:", error);
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
  console.error("❌ Login failed:", error);
  process.exit(1);
});
