const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const http = require('http');

// Configuration
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = process.env.PORT || 3000;

if (!TOKEN || !CLIENT_ID) {
  console.error('ERROR: DISCORD_TOKEN and CLIENT_ID environment variables are required!');
  console.error('Create a .env file or set them in your hosting provider (e.g., Render).');
  process.exit(1);
}

// Simple HTTP server for Render health check
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord Bot is running!\n');
});

server.listen(PORT, () => {
  console.log(`Health check server listening on port ${PORT}`);
});

// Command state: enable/disable toggle
const commandState = {
  sayEnabled: true
};

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Register slash commands
async function registerCommands() {
  const { REST, Routes } = require('discord.js');
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName('say')
      .setDescription('Send a message as an embed')
      .addStringOption(option =>
        option.setName('title')
          .setDescription('Embed title')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('description')
          .setDescription('Embed description/content')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('color')
          .setDescription('Embed color (hex code, e.g., #3498db)')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('footer-text')
          .setDescription('Footer text')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('footer-image')
          .setDescription('Footer icon image URL')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('thumbnail')
          .setDescription('Thumbnail image URL')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('image')
          .setDescription('Main image URL')
          .setRequired(false))
      .toJSON(),

    new SlashCommandBuilder()
      .setName('toggle-say')
      .setDescription('Enable or disable the /say command (Admin only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON()
  ];

  try {
    console.log('Registering slash commands globally...');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log('Slash commands registered successfully!');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// Client ready event
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Bot is online in ${client.guilds.cache.size} server(s)`);
  console.log(`/say command status: ${commandState.sayEnabled ? 'ENABLED' : 'DISABLED'}`);
  registerCommands();
});

// Handle interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'toggle-say') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: 'You need Administrator permission to use this command.',
        ephemeral: true
      });
    }

    commandState.sayEnabled = !commandState.sayEnabled;
    const status = commandState.sayEnabled ? 'ENABLED' : 'DISABLED';
    const statusEmoji = commandState.sayEnabled ? '✅' : '❌';

    const toggleEmbed = new EmbedBuilder()
      .setTitle('Command Status Updated')
      .setDescription(`The \`/say\` command is now **${status}** ${statusEmoji}`)
      .setColor(commandState.sayEnabled ? '#2ecc71' : '#e74c3c')
      .setFooter({
        text: `Updated by ${interaction.user.tag}`,
        iconURL: interaction.user.displayAvatarURL()
      })
      .setTimestamp();

    return interaction.reply({ embeds: [toggleEmbed] });
  }

  if (commandName === 'say') {
    if (!commandState.sayEnabled) {
      const disabledEmbed = new EmbedBuilder()
        .setTitle('Command Disabled')
        .setDescription('The `/say` command is currently disabled. An administrator can enable it with `/toggle-say`.')
        .setColor('#e74c3c')
        .setFooter({ text: 'Command disabled by admin' });

      return interaction.reply({ embeds: [disabledEmbed], ephemeral: true });
    }

    try {
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const color = interaction.options.getString('color') || '#3498db';
      const footerText = interaction.options.getString('footer-text') || `Sent by ${interaction.user.tag}`;
      const footerImage = interaction.options.getString('footer-image') || interaction.user.displayAvatarURL();
      const thumbnail = interaction.options.getString('thumbnail');
      const image = interaction.options.getString('image');

      const hexColor = /^#([0-9A-F]{3}){1,2}$/i.test(color) ? color : '#3498db';

      const sayEmbed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(hexColor)
        .setFooter({
          text: footerText,
          iconURL: footerImage
        })
        .setTimestamp();

      if (thumbnail) { try { sayEmbed.setThumbnail(thumbnail); } catch (e) {} }
      if (image) { try { sayEmbed.setImage(image); } catch (e) {} }

      await interaction.reply({ embeds: [sayEmbed] });

    } catch (error) {
      console.error('Error in /say command:', error);
      await interaction.reply({
        content: 'An error occurred while creating the embed. Please check your inputs and try again.',
        ephemeral: true
      });
    }
  }
});

client.on('error', (error) => console.error('Discord client error:', error));
process.on('unhandledRejection', (error) => console.error('Unhandled promise rejection:', error));

client.login(TOKEN);
