require('dotenv').config();
const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  ActivityType,
  Events
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const {
  handleTicketCreate,
  handleTicketCloseRequest,
  handleTicketCloseCancel,
  handleTicketCloseConfirm,
  handleTicketClaim,
  handleTicketTranscript
} = require('./handlers/ticketHandler');
const { startDashboard } = require('./dashboard/server');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

client.commands = new Collection();

// تحميل الأوامر من مجلد commands
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`[تحذير] الملف ${filePath} يفتقر إلى data أو execute.`);
    }
  }
}

// حدث تسجيل الدخول
client.once(Events.ClientReady, () => {
  console.log('====================================');
  console.log(`🤖 البوت يعمل بنجاح باسم: ${client.user.tag}`);
  console.log(`📊 متصل في ${client.guilds.cache.size} سيرفر(ات).`);
  console.log('====================================');

  client.user.setPresence({
    activities: [{ name: '🎫 نظام التذاكر | /ticket-setup', type: ActivityType.Watching }],
    status: 'online'
  });
});

// عند انضمام البوت لسيرفر جديد
client.on(Events.GuildCreate, (guild) => {
  console.log(`🎉 انضم البوت إلى سيرفر جديد: ${guild.name} (ID: ${guild.id})`);
});

// معالجة التفاعلات (Interactions)
client.on('interactionCreate', async (interaction) => {
  try {
    // 1. أوامر السلاش (Slash Commands)
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`خطأ في تنفيذ الأمر /${interaction.commandName}:`, error);
        const replyPayload = {
          content: '❌ حدث خطأ داخلي أثناء تنفيذ هذا الأمر!',
          ephemeral: true
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(replyPayload).catch(() => {});
        } else {
          await interaction.reply(replyPayload).catch(() => {});
        }
      }
      return;
    }

    // 2. القوائم المنسدلة (String Select Menus)
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket_select_menu') {
        const selectedValue = interaction.values[0];
        const typeId = selectedValue.replace('ticket_type_', '');
        await handleTicketCreate(interaction, typeId);
      }
      return;
    }

    // 3. أزرار التحكم (Buttons)
    if (interaction.isButton()) {
      switch (interaction.customId) {
        case 'ticket_close_request':
          await handleTicketCloseRequest(interaction);
          break;
        case 'ticket_close_cancel':
          await handleTicketCloseCancel(interaction);
          break;
        case 'ticket_close_confirm':
          await handleTicketCloseConfirm(interaction);
          break;
        case 'ticket_claim':
          await handleTicketClaim(interaction);
          break;
        case 'ticket_transcript':
          await handleTicketTranscript(interaction);
          break;
      }
    }
  } catch (err) {
    console.error('Unhandled interaction error:', err);
  }
});

// التعامل مع الأخطاء غير المتوقعة لمنع توقف البوت
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});

// تشغيل موقع لوحة التحكم فوراً لضمان جاهزية الاستضافة السحابية
startDashboard(client);

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.warn('⚠️ تنبيه: لم يتم تعيين DISCORD_TOKEN في ملف .env!');
  console.warn('👉 يرجى فتح ملف .env وإضافة التوكن ومعرف التطبيق ثم تشغيل البوت مجدداً.');
} else {
  client.login(token);
}
