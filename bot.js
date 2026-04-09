require('dotenv').config();
const {
    Client, GatewayIntentBits, Partials, PermissionsBitField,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, AttachmentBuilder
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

const PREFIX = '.';

// ─── DATA STORES (in-memory, resets on restart) ───────────────────────────────
const xpData = {};
const economy = {};
const warnings = {};
const tickets = {};        // { channelId: { userId, username, openedAt } }

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
    welcomeChannelName: 'welcome',
    logsChannelName: 'logs',
    autoRoleName: 'Member',
    ticketCategoryName: 'Tickets',
    staffRoleName: 'Staff',
    xpPerMessage: 10,
    coinsPerMessage: 2,
    shopItems: [
        { id: 'vip', name: 'VIP Role', price: 500 },
        { id: 'color', name: 'Custom Color', price: 300 },
        { id: 'trophy', name: '🏆 Trophy Badge', price: 1000 },
    ]
};
const commandDetails = {
    ban: "Bans a member.\nUsage: .ban @user [reason]",
    unban: "Unbans user by ID.\nUsage: .unban userID",
    kick: "Kicks a member.\nUsage: .kick @user [reason]",
    warn: "Warns a member.\nUsage: .warn @user [reason]",
    mute: "Timeout user.\nUsage: .mute @user [minutes]",
    purge: "Deletes messages.\nUsage: .purge [1-100]",
    announce: "Send announcement embed.",

    rank: "Shows XP level.",
    leaderboard: "Top XP users.",
    balance: "Check coins.",
    daily: "Daily reward.",
    give: "Give coins.\nUsage: .give @user amount",

    shop: "View shop items.",
    buy: "Buy item.\nUsage: .buy itemID",

    joke: "Fetch random joke (API).",
    meme: "Fetch meme.",
    rps: "Rock paper scissors.",
    trivia: "Answer trivia.",
    coinflip: "Flip coin.",
    roll: "Roll dice.",

    ping: "Check latency.",
    userinfo: "User info.",
    serverinfo: "Server info.",
    avatar: "Get avatar.",
    calc: "Calculator.",

    ticketpanel: "Create ticket panel.",
    closeticket: "Close ticket",

    levelgive: "Give XP.\nUsage: .levelgive @user amount"
};
// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getXP(userId) {
    if (!xpData[userId]) xpData[userId] = { xp: 0, level: 1 };
    return xpData[userId];
}
function getEconomy(userId) {
    if (!economy[userId]) economy[userId] = { coins: 0 };
    return economy[userId];
}
function getWarnings(guildId, userId) {
    if (!warnings[guildId]) warnings[guildId] = {};
    if (!warnings[guildId][userId]) warnings[guildId][userId] = [];
    return warnings[guildId][userId];
}
function xpForNextLevel(level) { return level * 100; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ─── LOG HELPER ───────────────────────────────────────────────────────────────
async function sendLog(guild, embedData) {
    const logChannel = guild.channels.cache.find(c => c.name === CONFIG.logsChannelName);
    if (logChannel) {
        logChannel.send({ embeds: [{ ...embedData, timestamp: new Date().toISOString() }] }).catch(() => {});
    }
}

// ─── TICKET TRANSCRIPT HELPER ─────────────────────────────────────────────────
async function closeTicket(channel, guild, ticketData, closedBy) {
    const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    let transcript = `Ticket Transcript — ${channel.name}\nOpened by: ${ticketData.username}\nOpened at: ${ticketData.openedAt}\nClosed by: ${closedBy}\nClosed at: ${new Date().toLocaleString()}\n${'─'.repeat(50)}\n\n`;
    if (fetched) {
        [...fetched.values()].reverse().forEach(m => {
            transcript += `[${new Date(m.createdTimestamp).toLocaleTimeString()}] ${m.author.tag}: ${m.content}\n`;
        });
    }

    const logChannel = guild.channels.cache.find(c => c.name === CONFIG.logsChannelName);
    if (logChannel) {
        const buffer = Buffer.from(transcript, 'utf-8');
        const attachment = new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.txt` });
        logChannel.send({
            embeds: [{
                title: '🎫 Ticket Closed',
                color: 0xFF7F00,
                fields: [
                    { name: 'Channel', value: channel.name, inline: true },
                    { name: 'Opened by', value: ticketData.username, inline: true },
                    { name: 'Closed by', value: closedBy, inline: true },
                ],
                timestamp: new Date().toISOString()
            }],
            files: [attachment]
        }).catch(() => {});
    }

    setTimeout(() => {
        delete tickets[channel.id];
        channel.delete().catch(() => {});
    }, 5000);
}

// ─── XP & COINS ON MESSAGE ────────────────────────────────────────────────────
const xpCooldown = new Set();

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (!xpCooldown.has(message.author.id)) {
        const user = getXP(message.author.id);
        const eco = getEconomy(message.author.id);
        user.xp += CONFIG.xpPerMessage;
        eco.coins += CONFIG.coinsPerMessage;
        const needed = xpForNextLevel(user.level);
        if (user.xp >= needed) {
            user.xp -= needed;
            user.level++;
            message.channel.send(`🎉 <@${message.author.id}> leveled up to **Level ${user.level}**!`);
        }
        xpCooldown.add(message.author.id);
        setTimeout(() => xpCooldown.delete(message.author.id), 60000);
    }

    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    if (command === '?' && args[0]) {
    const cmd = args[0].replace('.', '').toLowerCase();
    const info = commandDetails[cmd];

    if (!info) return message.reply('❌ Command not found.');

    return message.channel.send({
        embeds: [{
            title: `📘 Command: .${cmd}`,
            description: info,
            color: 0x5865F2
        }]
    });
}


    // ── HELPing stuff ig idk  ──────────────────────────────────────────────────────────────────
    if (command === '?') {
        return message.channel.send({ embeds: [{
            title: '📋 Bot Commands',
            color: 0x5865F2,
            fields: [
                {
                    name: '🔨 Moderation (Staff only)',
                    value: [
                        '`.ban @user [reason]` — Ban a member',
                        '`.unban userID` — Unban a user',
                        '`.kick @user [reason]` — Kick a member',
                        '`.warn @user [reason]` — Warn a member',
                        '`.warnings @user` — View warnings',
                        '`.clearwarns @user` — Clear warnings',
                        '`.mute @user [minutes]` — Timeout a member',
                        '`.unmute @user` — Remove timeout',
                        '`.purge [amount]` — Delete messages (max 100)',
                        '`.announce [text]` — Send an announcement embed',
                    ].join('\n')
                },
                {
                    name: '⭐ Community',
                    value: [
                        '`.starboard [messageID]` — Highlight a message',
                        '`.suggestion [text]` — Post a suggestion',
                        '`.poll [question]` — Create a yes/no poll',
                        '`.ticketpanel` — Post ticket button panel (staff)',
                        '`.closeticket` — Close your ticket',
                    ].join('\n')
                },
                {
                    name: '📈 Leveling & Economy',
                    value: [
                        '`.rank [@user]` — Check XP and level',
                        '`.leaderboard` — Top 10 XP leaderboard',
                        '`.balance [@user]` — Check coin balance',
                        '`.daily` — Claim daily coins',
                        '`.give @user [amount]` — Give coins to someone',
                        '`.shop` — View the shop',
                        '`.buy [itemID]` — Buy an item',
                    ].join('\n')
                },
                {
                    name: '🎮 Fun',
                    value: [
                        '`.8ball [question]` — Ask the magic 8ball',
                        '`.rps [rock/paper/scissors]` — Play RPS',
                        '`.trivia` — Answer a trivia question',
                        '`.coinflip` — Flip a coin',
                        '`.roll [sides]` — Roll a dice',
                        '`.meme` — Get a random meme',
                        '`.joke` — Get a random joke',
                        '`.roast @user` — Roast someone',
                        '`.ship @user1 @user2` — Ship two users',
                    ].join('\n')
                },
                {
                    name: '🔧 Utility',
                    value: [
                        '`.ping` — Bot latency',
                        '`.userinfo [@user]` — User info',
                        '`.serverinfo` — Server info',
                        '`.avatar [@user]` — Get avatar',
                        '`.calc [expression]` — Calculator',
                    ].join('\n')
                },
            ],
           footer: { text: 'Prefix: . | Use .? .command to get detailed info' }
        }]});
    }

    // ── MODERATION ────────────────────────────────────────────────────────────

    else if (command === 'ban') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
            return message.reply('❌ You need **Ban Members** permission.');
        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Mention a member to ban.');
        const reason = args.slice(1).join(' ') || 'No reason provided';
        try {
            await member.ban({ reason });
            message.reply(`✅ Banned **${member.user.tag}**`);
            sendLog(message.guild, {
                title: '🔨 Member Banned',
                color: 0xFF0000,
                fields: [
                    { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
                    { name: 'Moderator', value: message.author.tag, inline: true },
                    { name: 'Reason', value: reason }
                ]
            });
        } catch { message.reply('❌ Failed to ban. Check my role position.'); }
    }

    else if (command === 'unban') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
            return message.reply('❌ You need **Ban Members** permission.');
        const userId = args[0];
        if (!userId) return message.reply('❌ Provide a user ID.');
        try {
            await message.guild.bans.remove(userId);
            message.reply(`✅ Unbanned **${userId}**`);
            sendLog(message.guild, {
                title: '✅ Member Unbanned',
                color: 0x57F287,
                fields: [
                    { name: 'User ID', value: userId, inline: true },
                    { name: 'Moderator', value: message.author.tag, inline: true },
                ]
            });
        } catch { message.reply('❌ Failed to unban. Check the ID.'); }
    }

    else if (command === 'kick') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers))
            return message.reply('❌ You need **Kick Members** permission.');
        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Mention a member to kick.');
        const reason = args.slice(1).join(' ') || 'No reason provided';
        try {
            await member.kick(reason);
            message.reply(`✅ Kicked **${member.user.tag}**`);
            sendLog(message.guild, {
                title: '👟 Member Kicked',
                color: 0xFF7F00,
                fields: [
                    { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
                    { name: 'Moderator', value: message.author.tag, inline: true },
                    { name: 'Reason', value: reason }
                ]
            });
        } catch { message.reply('❌ Failed to kick. Check my role position.'); }
    }

    else if (command === 'warn') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
            return message.reply('❌ You need **Moderate Members** permission.');
        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Mention a member to warn.');
        const reason = args.slice(1).join(' ') || 'No reason provided';
        const userWarnings = getWarnings(message.guild.id, member.id);
        userWarnings.push(reason);
        message.reply(`⚠️ **${member.user.tag}** warned. Total warnings: **${userWarnings.length}**`);
        member.send(`⚠️ You were warned in **${message.guild.name}** | Reason: ${reason}`).catch(() => {});
        sendLog(message.guild, {
            title: '⚠️ Member Warned',
            color: 0xFFFF00,
            fields: [
                { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
                { name: 'Moderator', value: message.author.tag, inline: true },
                { name: 'Reason', value: reason },
                { name: 'Total Warnings', value: `${userWarnings.length}`, inline: true }
            ]
        });
    }

    else if (command === 'warnings') {
        const member = message.mentions.members.first() || message.member;
        const userWarnings = getWarnings(message.guild.id, member.id);
        if (userWarnings.length === 0) return message.reply(`✅ **${member.user.tag}** has no warnings.`);
        const list = userWarnings.map((w, i) => `${i + 1}. ${w}`).join('\n');
        message.reply(`⚠️ **${member.user.tag}** has **${userWarnings.length}** warning(s):\n${list}`);
    }

    else if (command === 'clearwarns') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
            return message.reply('❌ You need **Moderate Members** permission.');
        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Mention a member.');
        if (warnings[message.guild.id]) warnings[message.guild.id][member.id] = [];
        message.reply(`✅ Cleared all warnings for **${member.user.tag}**`);
        sendLog(message.guild, {
            title: '🧹 Warnings Cleared',
            color: 0x57F287,
            fields: [
                { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
                { name: 'Moderator', value: message.author.tag, inline: true },
            ]
        });
    }

    else if (command === 'mute') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
            return message.reply('❌ You need **Moderate Members** permission.');
        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Mention a member.');
        const minutes = parseInt(args[1]) || 10;
        try {
            await member.timeout(minutes * 60 * 1000);
            message.reply(`🔇 Muted **${member.user.tag}** for **${minutes}** minute(s).`);
            sendLog(message.guild, {
                title: '🔇 Member Muted',
                color: 0xFF7F00,
                fields: [
                    { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
                    { name: 'Moderator', value: message.author.tag, inline: true },
                    { name: 'Duration', value: `${minutes} minute(s)`, inline: true }
                ]
            });
        } catch { message.reply('❌ Failed to mute.'); }
    }

    else if (command === 'unmute') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
            return message.reply('❌ You need **Moderate Members** permission.');
        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Mention a member.');
        try {
            await member.timeout(null);
            message.reply(`🔊 Unmuted **${member.user.tag}**`);
            sendLog(message.guild, {
                title: '🔊 Member Unmuted',
                color: 0x57F287,
                fields: [
                    { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
                    { name: 'Moderator', value: message.author.tag, inline: true },
                ]
            });
        } catch { message.reply('❌ Failed to unmute.'); }
    }

    else if (command === 'purge') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
            return message.reply('❌ You need **Manage Messages** permission.');
        const amount = parseInt(args[0]);
        if (isNaN(amount) || amount < 1 || amount > 100)
            return message.reply('❌ Provide a number between 1-100.');
        try {
            await message.channel.bulkDelete(amount + 1, true);
            const m = await message.channel.send(`✅ Deleted **${amount}** messages.`);
            setTimeout(() => m.delete().catch(() => {}), 3000);
            sendLog(message.guild, {
                title: '🗑️ Messages Purged',
                color: 0xFF7F00,
                fields: [
                    { name: 'Channel', value: message.channel.name, inline: true },
                    { name: 'Amount', value: `${amount}`, inline: true },
                    { name: 'Moderator', value: message.author.tag, inline: true },
                ]
            });
        } catch { message.reply('❌ Failed. Messages older than 14 days can\'t be bulk deleted.'); }
    }

    else if (command === 'announce') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
            return message.reply('❌ You need **Manage Messages** permission.');
        const text = args.join(' ');
        if (!text) return message.reply('❌ Write your announcement.');
        message.channel.send({ embeds: [{
            description: text,
            color: 0xFFA500,
            author: { name: `📢 Announcement by ${message.author.tag}` },
            timestamp: new Date().toISOString()
        }]});
        message.delete().catch(() => {});
    }

    // ── COMMUNITY ─────────────────────────────────────────────────────────────

    else if (command === 'starboard') {
        const messageId = args[0];
        if (!messageId) return message.reply('❌ Provide a message ID.');
        try {
            const fetched = await message.channel.messages.fetch(messageId);
            message.channel.send({ embeds: [{
                author: { name: fetched.author.tag, icon_url: fetched.author.displayAvatarURL() },
                description: fetched.content || '*No text content*',
                color: 0xFFD700,
                footer: { text: '⭐ Starboard' },
                timestamp: fetched.createdAt.toISOString()
            }]});
            message.reply('✅ Message highlighted!');
        } catch { message.reply('❌ Could not find that message.'); }
    }

    else if (command === 'suggestion') {
        const text = args.join(' ');
        if (!text) return message.reply('❌ Write your suggestion.');
        const sent = await message.channel.send({ embeds: [{
            author: { name: `💡 Suggestion by ${message.author.tag}`, icon_url: message.author.displayAvatarURL() },
            description: text,
            color: 0x00BFFF,
            footer: { text: 'React with ✅ or ❌ to vote' }
        }]});
        await sent.react('✅');
        await sent.react('❌');
        message.delete().catch(() => {});
    }

    else if (command === 'poll') {
        const question = args.join(' ');
        if (!question) return message.reply('❌ Write your poll question.');
        const sent = await message.channel.send({ embeds: [{
            title: '📊 Poll',
            description: question,
            color: 0x9B59B6,
            footer: { text: `Poll by ${message.author.tag}` }
        }]});
        await sent.react('👍');
        await sent.react('👎');
        message.delete().catch(() => {});
    }

    // Staff posts this once in a #tickets channel
    else if (command === 'ticketpanel') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
            return message.reply('❌ You need **Manage Channels** permission.');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_ticket')
                .setLabel('🎫 Open a Ticket')
                .setStyle(ButtonStyle.Primary)
        );
        message.channel.send({
            embeds: [{
                title: '🎫 Support Tickets',
                description: 'Need help or have an issue?\nClick the button below to open a private support ticket.\nOur staff will assist you shortly.',
                color: 0x5865F2,
                footer: { text: 'One ticket per user at a time.' }
            }],
            components: [row]
        });
        message.delete().catch(() => {});
    }

    else if (command === 'closeticket') {
        const ticketData = tickets[message.channel.id];
        if (!ticketData) return message.reply('❌ This is not a ticket channel.');
        message.channel.send('🔒 Closing ticket in 5 seconds...');
        await closeTicket(message.channel, message.guild, ticketData, message.author.tag);
    }

    // ── LEVELING & ECONOMY shit ────────────────────────────────────────────────────

    else if (command === 'rank') {
        const target = message.mentions.users.first() || message.author;
        const user = getXP(target.id);
        const needed = xpForNextLevel(user.level);
        const bar = Math.floor((user.xp / needed) * 10);
        const progress = '█'.repeat(bar) + '░'.repeat(10 - bar);
        message.channel.send({ embeds: [{
            title: `📈 ${target.username}'s Rank`,
            color: 0x5865F2,
            fields: [
                { name: 'Level', value: `${user.level}`, inline: true },
                { name: 'XP', value: `${user.xp} / ${needed}`, inline: true },
                { name: 'Progress', value: `\`${progress}\`` }
            ],
            thumbnail: { url: target.displayAvatarURL() }
        }]});
    }

    else if (command === 'leaderboard') {
        const sorted = Object.entries(xpData)
            .sort((a, b) => b[1].level - a[1].level || b[1].xp - a[1].xp)
            .slice(0, 10);
        if (sorted.length === 0) return message.reply('No XP data yet.');
        const list = sorted.map(([id, data], i) => `**${i + 1}.** <@${id}> — Level ${data.level} (${data.xp} XP)`).join('\n');
        message.channel.send({ embeds: [{
            title: '🏆 XP Leaderboard',
            description: list,
            color: 0xFFD700
        }]});
    }

    else if (command === 'balance' || command === 'bal') {
        const target = message.mentions.users.first() || message.author;
        const eco = getEconomy(target.id);
        message.reply(`💰 **${target.username}** has **${eco.coins}** coins.`);
    }

    else if (command === 'daily') {
        const eco = getEconomy(message.author.id);
        const dailyCooldowns = client.dailyCooldowns || (client.dailyCooldowns = {});
        const last = dailyCooldowns[message.author.id];
        const now = Date.now();
        const cooldown = 24 * 60 * 60 * 1000;
        if (last && now - last < cooldown) {
            const remaining = cooldown - (now - last);
            const hours = Math.floor(remaining / 3600000);
            const mins = Math.floor((remaining % 3600000) / 60000);
            return message.reply(`⏳ Daily already claimed. Come back in **${hours}h ${mins}m**.`);
        }
        const amount = randomInt(100, 300);
        eco.coins += amount;
        dailyCooldowns[message.author.id] = now;
        message.reply(`✅ You claimed your daily **${amount}** coins! Balance: **${eco.coins}**`);
    }

    else if (command === 'give') {
        const target = message.mentions.users.first();
        if (!target) return message.reply('❌ Mention a user to give coins to.');
        const amount = parseInt(args[1]);
        if (isNaN(amount) || amount <= 0) return message.reply('❌ Enter a valid amount.');
        const from = getEconomy(message.author.id);
        const to = getEconomy(target.id);
        if (from.coins < amount) return message.reply(`❌ You only have **${from.coins}** coins.`);
        from.coins -= amount;
        to.coins += amount;
        message.reply(`✅ Gave **${amount}** coins to **${target.username}**. Your balance: **${from.coins}**`);
    }

    else if (command === 'shop') {
        const items = CONFIG.shopItems.map(i => `\`${i.id}\` — **${i.name}** — ${i.price} coins`).join('\n');
        message.channel.send({ embeds: [{
            title: '🛒 Shop',
            description: items,
            color: 0x2ECC71,
            footer: { text: 'Use .buy [itemID] to purchase' }
        }]});
    }

    else if (command === 'buy') {
        const itemId = args[0];
        const item = CONFIG.shopItems.find(i => i.id === itemId);
        if (!item) return message.reply(`❌ Item not found. Check \`.shop\` for available items.`);
        const eco = getEconomy(message.author.id);
        if (eco.coins < item.price) return message.reply(`❌ Not enough coins. You have **${eco.coins}**, need **${item.price}**.`);
        eco.coins -= item.price;
        message.reply(`✅ Purchased **${item.name}**! Remaining balance: **${eco.coins}** coins.`);
    }
else if (command === 'levelgive') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
        return message.reply('❌ You need **Manage Server** permission.');

    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);

    if (!target) return message.reply('❌ Mention a user.');
    if (isNaN(amount) || amount <= 0) return message.reply('❌ Enter valid XP amount.');

    const user = getXP(target.id);
    user.xp += amount;

    let leveledUp = false;
    while (user.xp >= xpForNextLevel(user.level)) {
        user.xp -= xpForNextLevel(user.level);
        user.level++;
        leveledUp = true;
    }

    message.reply(`✅ Gave **${amount} XP** to **${target.username}**${leveledUp ? ' (Level Up!) 🎉' : ''}`);
}
    // ── FUN shit ───────────────────────────────────────────────────────────────────

    else if (command === '8ball') {
        const question = args.join(' ');
        if (!question) return message.reply('❌ Ask a question.');
        const responses = [
            '✅ It is certain.', '✅ Without a doubt.', '✅ Yes, definitely.',
            '✅ You may rely on it.', '✅ Most likely.', '🤔 Ask again later.',
            '🤔 Cannot predict now.', '🤔 Concentrate and ask again.',
            '❌ Don\'t count on it.', '❌ Very doubtful.', '❌ My sources say no.'
        ];
        message.reply(`🎱 ${responses[randomInt(0, responses.length - 1)]}`);
    }

    else if (command === 'rps') {
        const choices = ['rock', 'paper', 'scissors'];
        const userChoice = args[0]?.toLowerCase();
        if (!choices.includes(userChoice)) return message.reply('❌ Choose rock, paper, or scissors.');
        const botChoice = choices[randomInt(0, 2)];
        const emoji = { rock: '🪨', paper: '📄', scissors: '✂️' };
        let result;
        if (userChoice === botChoice) result = "It's a **tie**!";
        else if (
            (userChoice === 'rock' && botChoice === 'scissors') ||
            (userChoice === 'paper' && botChoice === 'rock') ||
            (userChoice === 'scissors' && botChoice === 'paper')
        ) result = 'You **win**! 🎉';
        else result = 'You **lose**! 😔';
        message.reply(`${emoji[userChoice]} vs ${emoji[botChoice]} — ${result}`);
    }

    else if (command === 'trivia') {
        const questions = [
            { q: 'What is the capital of France?', a: 'paris' },
            { q: 'How many sides does a hexagon have?', a: '6' },
            { q: 'What planet is known as the Red Planet?', a: 'mars' },
            { q: 'What is the fastest land animal?', a: 'cheetah' },
            { q: 'What gas do plants absorb?', a: 'carbon dioxide' },
            { q: 'How many bones are in the human body?', a: '206' },
            { q: 'What is the chemical symbol for gold?', a: 'au' },
            { q: 'Who wrote Romeo and Juliet?', a: 'shakespeare' },
            { q: 'What is the largest ocean?', a: 'pacific' },
            { q: 'In Minecraft, what do you need to make a Nether portal?', a: 'obsidian' },
        ];
        const picked = questions[randomInt(0, questions.length - 1)];
        message.channel.send(`❓ **Trivia:** ${picked.q}\nYou have **15 seconds** to answer!`);
        const filter = m => m.author.id === message.author.id;
        const collector = message.channel.createMessageCollector({ filter, time: 15000, max: 1 });
        collector.on('collect', m => {
            if (m.content.toLowerCase().includes(picked.a)) {
                const eco = getEconomy(message.author.id);
                eco.coins += 50;
                m.reply(`✅ Correct! You earned **50 coins**. Balance: **${eco.coins}**`);
            } else {
                m.reply(`❌ Wrong! The answer was **${picked.a}**.`);
            }
        });
        collector.on('end', collected => {
            if (collected.size === 0) message.channel.send(`⏰ Time's up! The answer was **${picked.a}**.`);
        });
    }

    else if (command === 'coinflip') {
        message.reply(`🪙 ${Math.random() < 0.5 ? '**Heads!**' : '**Tails!**'}`);
    }

    else if (command === 'roll') {
        const sides = parseInt(args[0]) || 6;
        if (sides < 2) return message.reply('❌ Dice must have at least 2 sides.');
        message.reply(`🎲 You rolled a **${randomInt(1, sides)}** (d${sides})`);
    }

    else if (command === 'meme') {
        try {
            const res = await fetch('https://meme-api.com/gimme');
            const data = await res.json();
            message.channel.send({ embeds: [{
                title: data.title,
                image: { url: data.url },
                color: 0xFF4500,
                footer: { text: `👍 ${data.ups} | r/${data.subreddit}` }
            }]});
        } catch { message.reply('❌ Could not fetch a meme right now.'); }
    }

    else if (command === 'joke') {
    try {
        const res = await fetch('https://official-joke-api.appspot.com/random_joke');
        const data = await res.json();

        message.reply(`${data.setup}\n${data.punchline}`);
    } catch {
        message.reply('❌ Could not fetch a joke right now.');
    }
}

    else if (command === 'roast') {
        const target = message.mentions.users.first();
        if (!target) return message.reply('❌ Mention someone to roast.');
        const roasts = [
            `<@${target.id}> I'd roast you, but my mom said I'm not allowed to burn trash.`,
            `<@${target.id}> You're the reason the gene pool needs a lifeguard.`,
            `<@${target.id}> I'd call you a tool, but that would imply you're useful.`,
            `<@${target.id}> You have your entire life to be an idiot. Why waste today?`,
            `<@${target.id}> I'd explain it to you, but I left my crayons at home.`,
        ];
        message.channel.send(roasts[randomInt(0, roasts.length - 1)]);
    }

    else if (command === 'ship') {
        const user1 = message.mentions.users.first();
        const user2 = message.mentions.users.at(1);
        if (!user1 || !user2) return message.reply('❌ Mention two users to ship.');
        const percent = randomInt(1, 100);
        const bar = Math.floor(percent / 10);
        const progress = '❤️'.repeat(bar) + '🖤'.repeat(10 - bar);
        message.channel.send({ embeds: [{
            title: `💘 ${user1.username} + ${user2.username}`,
            description: `${progress}\n**${percent}% compatible!**`,
            color: percent > 60 ? 0xFF69B4 : 0x808080
        }]});
    }

    // ── UTILITY ───────────────────────────────────────────────────────────────

    else if (command === 'ping') {
        message.reply(`🏓 Pong! Latency: **${client.ws.ping}ms**`);
    }

    else if (command === 'userinfo') {
        const member = message.mentions.members.first() || message.member;
        message.channel.send({ embeds: [{
            title: `👤 ${member.user.tag}`,
            color: 0x5865F2,
            fields: [
                { name: 'ID', value: member.id, inline: true },
                { name: 'Nickname', value: member.nickname || 'None', inline: true },
                { name: 'Joined Server', value: member.joinedAt.toDateString(), inline: true },
                { name: 'Account Created', value: member.user.createdAt.toDateString(), inline: true },
                { name: 'Roles', value: member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join(', ') || 'None' }
            ],
            thumbnail: { url: member.user.displayAvatarURL() }
        }]});
    }

    else if (command === 'serverinfo') {
        const guild = message.guild;
        message.channel.send({ embeds: [{
            title: `🌐 ${guild.name}`,
            color: 0x5865F2,
            fields: [
                { name: 'Members', value: `${guild.memberCount}`, inline: true },
                { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
                { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
                { name: 'Created', value: guild.createdAt.toDateString(), inline: true },
                { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
                { name: 'Boost Level', value: `${guild.premiumTier}`, inline: true },
            ],
            thumbnail: { url: guild.iconURL() || '' }
        }]});
    }

    else if (command === 'avatar') {
        const target = message.mentions.users.first() || message.author;
        message.channel.send({ embeds: [{
            title: `🖼️ ${target.username}'s Avatar`,
            image: { url: target.displayAvatarURL({ size: 512 }) },
            color: 0x5865F2
        }]});
    }

    else if (command === 'calc') {
        const expr = args.join(' ');
        if (!expr) return message.reply('❌ Provide an expression. Example: `.calc 5 * 10`');
        try {
            if (!/^[0-9+\-*/().\s%]+$/.test(expr)) return message.reply('❌ Invalid expression.');
            const result = eval(expr);
            message.reply(`🧮 \`${expr}\` = **${result}**`);
        } catch { message.reply('❌ Invalid expression.'); }
    }
});

// ─── BUTTON INTERACTIONS ──────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    // Open ticket button
    if (interaction.customId === 'open_ticket') {
        await interaction.deferReply({ ephemeral: true });

        const existing = Object.values(tickets).find(t => t.userId === interaction.user.id);
        if (existing) return interaction.editReply({ content: '❌ You already have an open ticket!' });

        try {
            const category = interaction.guild.channels.cache.find(
                c => c.name === CONFIG.ticketCategoryName && c.type === ChannelType.GuildCategory
            );
            const staffRole = interaction.guild.roles.cache.find(r => r.name === CONFIG.staffRoleName);

            const channel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: category?.id,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                    ...(staffRole ? [{ id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }] : [])
                ]
            });

            tickets[channel.id] = {
                userId: interaction.user.id,
                username: interaction.user.tag,
                openedAt: new Date().toLocaleString()
            };

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket_btn')
                    .setLabel('🔒 Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            await channel.send({
                content: staffRole ? `<@&${staffRole.id}>` : '',
                embeds: [{
                    title: '🎫 New Support Ticket',
                    description: `Hello <@${interaction.user.id}>! Describe your issue and a staff member will help you shortly.\n\nClick **Close Ticket** when your issue is resolved.`,
                    color: 0x5865F2,
                    footer: { text: `Opened by ${interaction.user.tag}` },
                    timestamp: new Date().toISOString()
                }],
                components: [closeRow]
            });

            sendLog(interaction.guild, {
                title: '🎫 Ticket Opened',
                color: 0x57F287,
                fields: [
                    { name: 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                    { name: 'Channel', value: channel.name, inline: true },
                ]
            });

            await interaction.editReply({ content: `✅ Ticket created: ${channel}` });
        } catch (e) {
            console.error(e);
            await interaction.editReply({ content: '❌ Failed to create ticket. Check my permissions.' });
        }
    }

    // Close ticket button (inside the ticket channel)
    if (interaction.customId === 'close_ticket_btn') {
        const ticketData = tickets[interaction.channel.id];
        if (!ticketData) return interaction.reply({ content: '❌ This is not a ticket channel.', ephemeral: true });
        await interaction.reply({ content: '🔒 Closing ticket in 5 seconds. Transcript will be saved to logs.' });
        await closeTicket(interaction.channel, interaction.guild, ticketData, interaction.user.tag);
    }
});

// ─── WELCOME, AUTO ROLE & JOIN LOG ────────────────────────────────────────────
client.on('guildMemberAdd', async member => {
    const welcomeChannel = member.guild.channels.cache.find(c => c.name === CONFIG.welcomeChannelName);
    if (welcomeChannel) {
        const accountAge = Math.floor((Date.now() - member.user.createdAt) / (1000 * 60 * 60 * 24));
        welcomeChannel.send({ embeds: [{
            title: `👋 Welcome to ${member.guild.name}!`,
            description: `Hey <@${member.id}>, glad you're here!\nYou are member **#${member.guild.memberCount}**.\n\nRead the rules, have fun, and enjoy your stay!`,
            color: 0x57F287,
            fields: [
                { name: '📅 Account Age', value: `${accountAge} days`, inline: true },
                { name: '🆔 User ID', value: member.id, inline: true },
            ],
            thumbnail: { url: member.user.displayAvatarURL({ size: 256 }) },
            timestamp: new Date().toISOString()
        }]});
    }

    const role = member.guild.roles.cache.find(r => r.name === CONFIG.autoRoleName);
    if (role) member.roles.add(role).catch(() => {});

    sendLog(member.guild, {
        title: '📥 Member Joined',
        color: 0x57F287,
        fields: [
            { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
            { name: 'Account Created', value: member.user.createdAt.toDateString(), inline: true },
            { name: 'Member Count', value: `${member.guild.memberCount}`, inline: true }
        ],
        thumbnail: { url: member.user.displayAvatarURL() }
    });
});

// ─── LEAVE MESSAGE & LOG ──────────────────────────────────────────────────────
client.on('guildMemberRemove', async member => {
    const welcomeChannel = member.guild.channels.cache.find(c => c.name === CONFIG.welcomeChannelName);
    if (welcomeChannel) {
        welcomeChannel.send({ embeds: [{
            description: `👋 **${member.user.tag}** has left the server.`,
            color: 0xFF7F00,
            thumbnail: { url: member.user.displayAvatarURL() },
            timestamp: new Date().toISOString()
        }]});
    }
    sendLog(member.guild, {
        title: '📤 Member Left',
        color: 0xFF7F00,
        fields: [
            { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
        ]
    });
});

// ─── ERROR HANDLING ───────────────────────────────────────────────────────────
client.on('error', error => console.error(`Client error: ${error.message}`));
process.on('unhandledRejection', reason => console.error('Unhandled rejection:', reason));
client.on('ready', () => console.log(`✅ Bot online as ${client.user.tag}`));

client.login(process.env.DISCORD_TOKEN);
