const express = require('express');
const path = require('path');
const {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('discord.js');
const { getConfig, saveConfig, sendTicketLog } = require('../handlers/ticketHandler');

function createDashboardApp(client) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // 1. حالة البوت والإحصائيات
  app.get('/api/status', (req, res) => {
    const config = getConfig();
    let openTickets = 0;

    client.guilds.cache.forEach((g) => {
      g.channels.cache.forEach((ch) => {
        if (ch.topic && ch.topic.includes('status:open')) {
          openTickets++;
        }
      });
    });

    const primaryGuild = client.guilds.cache.first();

    res.json({
      online: client.isReady(),
      botTag: client.user ? client.user.tag : 'Nazem Ticket',
      botAvatar: client.user ? client.user.displayAvatarURL() : '',
      guildsCount: client.guilds.cache.size,
      membersCount: client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0),
      ping: Math.round(client.ws?.ping || 0),
      uptime: client.uptime || 0,
      totalTicketsCount: config.ticketCounter || 0,
      openTicketsCount: openTickets,
      guildName: primaryGuild ? primaryGuild.name : 'لا يوجد سيرفر',
      guildIcon: primaryGuild ? primaryGuild.iconURL() : ''
    });
  });

  // 2. جلب بيانات السيرفر (الرتب والقنوات لاختيارها بالقوائم)
  app.get('/api/guild-data', (req, res) => {
    const guild = client.guilds.cache.first();
    if (!guild) {
      return res.json({ roles: [], textChannels: [], categories: [] });
    }

    const roles = guild.roles.cache
      .filter((r) => r.name !== '@everyone')
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.hexColor,
        position: r.position
      }))
      .sort((a, b) => b.position - a.position);

    const textChannels = guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText)
      .map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parentId
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const categories = guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildCategory)
      .map((c) => ({
        id: c.id,
        name: c.name
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      guildId: guild.id,
      guildName: guild.name,
      guildIcon: guild.iconURL(),
      roles,
      textChannels,
      categories
    });
  });

  // 3. جلب الإعدادات الحالية
  app.get('/api/config', (req, res) => {
    res.json(getConfig());
  });

  // 4. حفظ الإعدادات
  app.post('/api/config', (req, res) => {
    const current = getConfig();
    const updated = {
      ...current,
      ...req.body
    };

    const ok = saveConfig(updated);
    if (ok) {
      res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح!' });
    } else {
      res.status(500).json({ success: false, message: 'فشل حفظ الإعدادات في ملف config.json' });
    }
  });

  // 5. إرسال لوحة التذاكر إلى روم محدد مباشرة من الداشبورد
  app.post('/api/send-panel', async (req, res) => {
    const { channelId } = req.body;
    if (!channelId) {
      return res.status(400).json({ success: false, message: 'يرجى تحديد القناة!' });
    }

    const channel = client.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) {
      return res.status(404).json({ success: false, message: 'لم يتم العثور على القناة المحددة!' });
    }

    const config = getConfig();
    const selectOptions = (config.ticketTypes || []).map((type) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(type.label)
        .setDescription(type.description || 'اضغط لفتح تذكرة')
        .setValue(`ticket_type_${type.id}`)
        .setEmoji(type.emoji || '🎫')
    );

    if (selectOptions.length === 0) {
      return res.status(400).json({ success: false, message: 'لا توجد أقسام تذاكر مضافة!' });
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_select_menu')
      .setPlaceholder('اختر القسم المناسب لفتح تذكرة...')
      .addOptions(selectOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
      .setColor(config.colors?.primary || '#5865F2')
      .setTitle('📩 مركز المساعدة والتواصل - تذاكر السيرفر')
      .setDescription(
        'مرحباً بك في مركز تذاكر السيرفر!\n\n' +
        'يرجى اختيار القسم المناسب لطلبك من القائمة المنسدلة بالأسفل:\n' +
        (config.ticketTypes || [])
          .map((t, idx) => `${idx + 1}️⃣ ${t.emoji || '🎫'} **${t.label}:** ${t.description || ''}`)
          .join('\n') +
        '\n\n🔒 **ملاحظة:** سيتم إنشاء روم خاص بينك وبين الإدارة فقط، مع حفظ سجلات التذكرة للرقابة.'
      )
      .setFooter({
        text: `${channel.guild.name} • انقر بالأسفل لفتح تذكرة`,
        iconURL: channel.guild.iconURL()
      })
      .setTimestamp();

    try {
      await channel.send({
        embeds: [embed],
        components: [row]
      });

      res.json({ success: true, message: `تم إرسال اللوحة بنجاح في #${channel.name}` });
    } catch (err) {
      console.error('Error sending panel from dashboard:', err);
      res.status(500).json({ success: false, message: 'فشل إرسال اللوحة، تأكد من صلاحيات البوت في القناة.' });
    }
  });

  // 6. تجربة إرسال لوق للإدارة
  app.post('/api/test-log', async (req, res) => {
    const guild = client.guilds.cache.first();
    if (!guild) {
      return res.status(400).json({ success: false, message: 'البوت غير متصل بأي سيرفر حالياً.' });
    }

    const config = getConfig();
    const result = await sendTicketLog(guild, {
      title: '🔔 [تجربة] فحص نظام اللوقات من الداشبورد',
      description: 'نظام اللوقات والسجلات يعمل بكفاءة تامة! جميع الأحداث ونسخ التذاكر ستصل إلى هذا الروم للإدارة فقط.',
      color: config.colors?.primary || '#5865F2',
      fields: [
        { name: 'الوقت', value: new Date().toLocaleString('ar-SA'), inline: true },
        { name: 'الحالة', value: '🟢 متصل ومفعل', inline: true }
      ]
    });

    if (result) {
      res.json({ success: true, message: 'تم إرسال رسالة الفحص إلى روم اللوقات بنجاح!' });
    } else {
      res.status(400).json({
        success: false,
        message: 'تعذر العثور على روم اللوقات. تأكد من تحديد روم اللوقات في الإعدادات.'
      });
    }
  });

  // Fallback to index.html for SPA
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

function startDashboard(client) {
  const config = getConfig();
  const port = process.env.PORT || config.dashboardPort || 3000;
  const app = createDashboardApp(client);

  const server = app.listen(port, '0.0.0.0', () => {
    console.log('------------------------------------');
    console.log(`🌐 موقع لوحة التحكم (Dashboard) يعمل الآن على:`);
    console.log(`👉 http://0.0.0.0:${port}`);
    console.log('------------------------------------');
  });

  return server;
}

module.exports = {
  createDashboardApp,
  startDashboard
};
