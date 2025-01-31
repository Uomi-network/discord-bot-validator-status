const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { checkAddress } = require('@polkadot/util-crypto');
require('dotenv').config();
const fs = require('fs').promises;

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const SUBSTRATE_WS_URL = process.env.SUBSTRATE_WS_URL || 'ws://localhost:9944';
const CHAIN_SS58_PREFIX = parseInt(process.env.CHAIN_SS58_PREFIX) || 87;
const COOLDOWN_DAYS = process.env.COOLDOWN_DAYS || 14;

// Constants
const VALIDATORS_DB_FILE = 'validators.json';
const FOLLOWERS_DB_FILE = 'followers.json';
const INACTIVITY_THRESHOLDS = new Set([10, 25, 50]);
const COOLDOWN_DURATION = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Application state
let api = null;
const validators = new Map();
const followers = new Map();

// Utility functions
function formatAddress(address) {
  return address ? `${address.slice(0, 8)}...${address.slice(-4)}` : 'Unknown Address';
}

async function validateChainAddress(address) {
  try {
    checkAddress(address, CHAIN_SS58_PREFIX);
    return true;
  } catch {
    return false;
  }
}

// Data persistence
async function saveData(file, data) {
  try {
    await fs.writeFile(file, JSON.stringify(data, null, 2));
    console.log(`Data saved to ${file}`);
  } catch (error) {
    console.error(`Error saving ${file}:`, error.message);
  }
}

async function loadData(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    console.error(`Error loading ${file}:`, error.message);
    return null;
  }
}

// Validator management
async function saveValidators() {
  const data = {};
  for (const [address, info] of validators.entries()) {
    data[address] = {
      ...info,
      inactivityNotified: Array.from(info.inactivityNotified),
      lastNotification: info.lastNotification?.getTime() || null
    };
  }
  await saveData(VALIDATORS_DB_FILE, data);
}

async function loadValidators() {
  const data = await loadData(VALIDATORS_DB_FILE);
  if (!data) return;

  for (const [address, info] of Object.entries(data)) {
    validators.set(address, {
      ...info,
      inactivityNotified: new Set(info.inactivityNotified),
      lastNotification: info.lastNotification ? new Date(info.lastNotification) : null
    });
  }
}

// Follower management
async function saveFollowers() {
  const data = {};
  for (const [validator, users] of followers.entries()) {
    data[validator] = Array.from(users);
  }
  await saveData(FOLLOWERS_DB_FILE, data);
}

async function loadFollowers() {
  const data = await loadData(FOLLOWERS_DB_FILE);
  if (!data) return;

  for (const [validator, users] of Object.entries(data)) {
    followers.set(validator, new Set(users));
  }
}

// Chain connection
async function connectToChain() {
  const provider = new WsProvider(SUBSTRATE_WS_URL);
  return ApiPromise.create({
    provider,
    throwOnConnect: true,
    throwOnUnknown: true,
    noInitWarn: true
  });
}

// Notification system
async function sendNotification(embed, validatorAddress = null) {
  try {
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) throw new Error('Discord channel not found');

    if (validatorAddress && followers.has(validatorAddress)) {
      const mentions = Array.from(followers.get(validatorAddress))
        .map(id => `<@${id}>`)
        .join(' ');
      if (mentions) await channel.send(`🔔 **UOMI Alert** for ${formatAddress(validatorAddress)}:\n${mentions}`);
    }
    
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Notification error:', error);
  }
}

// Validator monitoring
async function checkValidatorStatus(address) {
  try {
    const [identity, slashes, commission, currentEra] = await Promise.all([
      api.query.identity.identityOf(address),
      api.query.staking.slashingSpans(address),
      api.query.staking.validators(address),
      api.query.staking.currentEra()
    ]);


    const era = currentEra.unwrapOr(null)?.toNumber();
    if (!era) return null;

    const eraPoints = await api.query.staking.erasRewardPoints(era - 1);
    const totalPoints = eraPoints.total.toNumber();
    const individualJSON = eraPoints.individual.toJSON();
    const validatorPoints = individualJSON[address] || 0;

    let slashingInfo = null;
    if (slashes.isSome) {
      const spans = slashes.unwrap();
      slashingInfo = {
        spanIndex: spans.spanIndex.toNumber(),
        lastStart: spans.lastStart.toNumber(),
        lastNonzeroSlash: spans.lastNonzeroSlash.toNumber(),
        prior: spans.prior.map(p => p.toNumber())
      };
    }

    return {
      identity: identity.toJSON() != null ? identity.toJSON()[0]?.info : null,  
      slashed: slashes.isSome,
      slashingInfo,
      commission: commission.commission.toNumber() / 10000000,
      eraPoints: {
        total: totalPoints,
        validator: validatorPoints,
        performance: totalPoints > 0 ? 
          ((validatorPoints / totalPoints) * 100).toFixed(2) : 'N/A'
      },
      isActive: false
    };
  } catch (error) {
    console.error(`Status check error for ${formatAddress(address)}:`, error);
    return null;
  }
}

async function monitorValidators() {
  try {
    const [currentValidators, currentEra] = await Promise.all([
      api.query.session.validators(),
      api.query.staking.currentEra()
    ]);

    const activeAddresses = new Set(currentValidators.map(v => v.toString()));
    const era = currentEra.unwrapOr(null)?.toNumber() || 0;
    let changesDetected = false;

    // Detect new validators
    for (const address of activeAddresses) {
      if (!validators.has(address)) {
        const status = await checkValidatorStatus(address);
        if (!status) continue;

        const validatorInfo = {
          address,
          inactivityNotified: new Set(),
          slashed: status.slashed,
          commission: status.commission,
          eraPoints: status.eraPoints,
          lastNotification: null,
          active: true
        };

        await sendNotification(
          new EmbedBuilder()
            .setTitle('🆕 New Validator')
            .setDescription(`**${formatAddress(address)}** joined the active set`)
            .setColor('#00FF00')
            .addFields(
              { name: 'Era', value: era.toString(), inline: true },
              { name: 'Initial Commission', value: `${status.commission}%`, inline: true },
              { name: 'Performance', value: `${status.eraPoints.performance}%`, inline: true }
            ),
          address
        );

        validators.set(address, validatorInfo);
        changesDetected = true;
      }
    }

    // Update existing validators
    for (const address of activeAddresses) {
      const validatorInfo = validators.get(address);
      if (!validatorInfo) continue;

      const status = await checkValidatorStatus(address);
      if (!status) continue;

      // Update performance metrics
      validatorInfo.eraPoints = status.eraPoints;
      validatorInfo.commission = status.commission;
      validatorInfo.active = true;

      // Handle slashing
      if (status.slashed && !validatorInfo.slashed) {
        const canNotify = !validatorInfo.lastNotification || 
          (Date.now() - validatorInfo.lastNotification) > COOLDOWN_DURATION;

        if (canNotify) {
          const slashEmbed = new EmbedBuilder()
            .setTitle('⚡ Validator Slashed')
            .setDescription(`**${formatAddress(address)}** has been slashed`)
            .setColor('#FF0000')
            .addFields(
              { name: 'Span Index', value: status.slashingInfo.spanIndex.toString(), inline: true },
              { name: 'Last Non-zero Slash', value: status.slashingInfo.lastNonzeroSlash.toString(), inline: true },
              { name: 'Prior Spans', value: status.slashingInfo.prior.join(', '), inline: false }
            );

          await sendNotification(slashEmbed, address);
          validatorInfo.lastNotification = new Date();
        }
        validatorInfo.slashed = true;
        changesDetected = true;
      }

      // Handle inactivity
      for (const threshold of INACTIVITY_THRESHOLDS) {
        if (status.performance < threshold && 
            !validatorInfo.inactivityNotified.has(threshold) &&
            (!validatorInfo.lastNotification || 
             (Date.now() - validatorInfo.lastNotification) > COOLDOWN_DURATION)) {
          
          await sendNotification(
            new EmbedBuilder()
              .setTitle(`🚨 Inactivity Threshold (${threshold}%)`)
              .setDescription(`**${formatAddress(address)}** exceeded inactivity threshold`)
              .setColor('#FFA500')
              .addFields(
                { name: 'Current Performance', value: `${status.performance}%`, inline: true },
                { name: 'Era', value: era.toString(), inline: true }
              ),
            address
          );
          
          validatorInfo.inactivityNotified.add(threshold);
          validatorInfo.lastNotification = new Date();
          changesDetected = true;
        }
      }

      // Update metrics
      validatorInfo.commission = status.commission;
      validatorInfo.performance = status.performance;
      validatorInfo.active = true;
    }

    // Handle removed validators
    for (const [address, info] of validators.entries()) {
      if (!activeAddresses.has(address) && info.active) {
        await sendNotification(
          new EmbedBuilder()
            .setTitle('🚫 Validator Removed')
            .setDescription(`**${formatAddress(address)}** left the active set`)
            .setColor('#808080')
            .addFields(
              { name: 'Final Performance', value: `${info.performance}%`, inline: true },
              { name: 'Last Era', value: era.toString(), inline: true }
            ),
          address
        );
        info.active = false;
        changesDetected = true;
      }
    }

    if (changesDetected) await saveValidators();
} catch (error) {
  console.error('Monitoring error:', error.message);
}
}

function hexToUint8Array(hex) {
    if (hex.startsWith('0x')) hex = hex.slice(2); // Rimuove il prefisso '0x' se presente
    return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

// Command handling
client.on('messageCreate', async message => {
    try {
      if (message.author.bot || !message.content.startsWith('!')) return;
  
      const [command, ...args] = message.content.slice(1).split(' ');
  
      switch (command.toLowerCase()) {
        case 'follow':
          if (args.length < 1) return;
          const addressToFollow = args[0];
          
          if (!await validateChainAddress(addressToFollow)) {
            return message.reply('❌ **Invalid UOMI address**');
          }
  
          if (!followers.has(addressToFollow)) {
            followers.set(addressToFollow, new Set());
          }
          followers.get(addressToFollow).add(message.author.id);
          await saveFollowers();
          message.reply(`✅ Now following validator: \`${formatAddress(addressToFollow)}\``);
          break;
  
        case 'unfollow':
          if (args.length < 1) return;
          const addressToUnfollow = args[0];
          
          if (followers.has(addressToUnfollow)) {
            followers.get(addressToUnfollow).delete(message.author.id);
            await saveFollowers();
            message.reply(`❌ Stopped following validator: \`${formatAddress(addressToUnfollow)}\``);
          }
          break;
  
        case 'following':
          const userFollowing = [];
          for (const [validator, users] of followers.entries()) {
            if (users.has(message.author.id)) {
              userFollowing.push(formatAddress(validator));
            }
          }
          
          if (userFollowing.length === 0) {
            message.reply("You're not following any validators.");
          } else {
            message.reply(`**You're following:**\n${userFollowing.join('\n')}`);
          }
          break;
  
        case 'status':
          if (args.length < 1) return;
          const validatorAddress = args[0];
          
          if (!await validateChainAddress(validatorAddress)) {
            return message.reply('❌ **Invalid UOMI address**');
          }
  
          const status = await checkValidatorStatus(validatorAddress);
          if (!status) {
            return message.reply('🔍 Validator not found or error retrieving data');
          }
  
          const activeValidators = await api.query.session.validators();
          const isActive = activeValidators.some(v => v.toString() === validatorAddress);
  
          const identity = status.identity ?
            (new TextDecoder().decode(hexToUint8Array(status.identity.display?.raw)) ||
             status.identity.parent?.toHuman() || 
             'Unknown Identity') : 
            'No Identity Set';
  
          const statusEmbed = new EmbedBuilder()
            .setTitle(`📊 Validator Status - ${formatAddress(validatorAddress)}`)
            .setColor(isActive ? '#00FF00' : '#FF0000')
            .addFields(
              { name: 'Status', value: isActive ? '🟢 Active' : '🔴 Inactive', inline: true },
              { name: 'Commission', value: `${status.commission}%`, inline: true },
              { name: 'Last Era Performance', value: `${status.eraPoints.performance}%`, inline: true },
              { name: 'Total Last Era Points', value: status.eraPoints.total.toString(), inline: true },
              { name: 'Validator Points Last Era', value: status.eraPoints.validator.toString(), inline: true },
              { name: 'Identity', value: identity, inline: false }
            );
  
          if (status.slashed) {
            statusEmbed.addFields(
              { name: 'Last Slash Era', value: status.slashingInfo.lastNonzeroSlash.toString(), inline: true },
              { name: 'Slash Spans', value: status.slashingInfo.prior.join(', '), inline: true }
            );
          }
  
          message.channel.send({ embeds: [statusEmbed] });
          break;
  
        case 'help':
          const helpEmbed = new EmbedBuilder()
            .setTitle('📚 UOMI Validator Bot Commands')
            .setDescription([
              '`!follow <address>` - Start following a validator',
              '`!unfollow <address>` - Stop following a validator',
              '`!following` - List followed validators',
              '`!status <address>` - Show detailed validator status',
              '`!help` - Show this help message'
            ].join('\n'))
            .setColor('#7289DA')
            .setFooter({ text: 'Official UOMI Network Bot' });
  
          message.channel.send({ embeds: [helpEmbed] });
          break;
      }
    } catch (error) {
      console.error('Command error:', error.message);
    }
  });
  
  // Initialization
  client.once('ready', async () => {
    console.log(`✅ UOMI Bot started as ${client.user.tag}`);
    
    try {
      await Promise.all([loadValidators(), loadFollowers()]);
      api = await connectToChain();
      console.log(`⛓️ Connected to UOMI chain: ${SUBSTRATE_WS_URL}`);
  
      setInterval(async () => {
        await monitorValidators();
      }, 300000);
  
      await monitorValidators();
    } catch (error) {
      console.error('❌ Initialization error:', error.message);
      process.exit(1);
    }
  });
  
  client.login(DISCORD_TOKEN);