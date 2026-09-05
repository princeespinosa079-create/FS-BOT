const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const http = require('http');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = process.env.PORT || 3000;

// HTTP server for Render health check
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK - Bot alive\n');
});

server.listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT} - Render health check OK`);
});

// Validate env vars
if (!TOKEN) {
  console.error('❌ ERROR: DISCORD_TOKEN is missing! Set it in Render Environment Variables.');
}
if (!CLIENT_ID) {
  console.error('❌ ERROR: CLIENT_ID is missing! Set it in Render Environment Variables.');
}
if (!TOKEN || !CLIENT_ID) {
  console.error('Bot cannot start without these variables.');
}

const commandState = { sayEnabled: true };

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

async function registerCommands() {
  const { REST, Routes } = require('discord.js');
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName('say')
      .setDescription('Send a message as an embed')
      .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Embed content').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('Hex color (e.g., #3498db)').setRequired(false))
      .addStringOption(o => o.setName('footer-text').setDescription('Footer text').setRequired(false))
      .addStringOption(o => o.setName('footer-image').setDescription('Footer icon URL').setRequired(false))
      .addStringOption(o => o.setName('thumbnail').setDescription('Thumbnail URL').setRequired(false))
      .addStringOption(o => o.setName('image').setDescription('Main image URL').setRequired(false))
      .toJSON(),

    new SlashCommandBuilder()
      .setName('toggle-say')
      .setDescription('Enable/disable /say (Admin only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON()
  ];

  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error('❌ Failed to register commands:', error.message);
  }
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}!`);
  console.log(`Bot online in ${client.guilds.cache.size} server(s)`);
  registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'toggle-say') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Admin only!', ephemeral: true });
    }
    commandState.sayEnabled = !commandState.sayEnabled;
    const embed = new EmbedBuilder()
      .setTitle('Command Status')
      .setDescription(`/say is now **${commandState.sayEnabled ? 'ENABLED ✅' : 'DISABLED ❌'}**`)
      .setColor(commandState.sayEnabled ? '#2ecc71' : '#e74c3c')
      .setFooter({ text: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === 'say') {
    if (!commandState.sayEnabled) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setTitle('❌ Disabled').setDescription('/say is disabled. Use /toggle-say to enable.').setColor('#e74c3c')],
        ephemeral: true
      });
    }
    try {
      const title = interaction.options.getString('title');
      const desc = interaction.options.getString('description');
      const color = interaction.options.getString('color') || '#3498db';
      const footerText = interaction.options.getString('footer-text') || interaction.user.tag;
      const footerImg = interaction.options.getString('footer-image') || interaction.user.displayAvatarURL();
      const thumb = interaction.options.getString('thumbnail');
      const img = interaction.options.getString('image');

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(desc)
        .setColor(/^#([0-9A-F]{3}){1,2}$/i.test(color) ? color : '#3498db')
        .setFooter({ text: footerText, iconURL: footerImg })
        .setTimestamp();
      if (thumb) try { embed.setThumbnail(thumb); } catch(e) {}
      if (img) try { embed.setImage(img); } catch(e) {}

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Error:', err);
      await interaction.reply({ content: 'Error creating embed!', ephemeral: true });
    }
  }
});

client.on('error', (e) => console.error('Discord error:', e.message));
client.on('shardError', (e) => console.error('Connection error:', e.message));
process.on('unhandledRejection', (e) => console.error('Unhandled:', e));

// Login with detailed error
console.log('Attempting to log in to Discord...');
client.login(TOKEN).catch(err => {
  console.error('❌ LOGIN FAILED:', err.message);
  console.error('Check your token and make sure Message Content Intent is enabled in the Developer Portal.');
});
