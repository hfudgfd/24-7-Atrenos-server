const mineflayer = require('mineflayer');

function createBot() {
  const bot = mineflayer.createBot({
    host: 'mainserver211.aternos.me',
    port: 30638,
    username: 'AFK_Bot_' + Math.floor(Math.random() * 1000)
  });

  bot.on('spawn', () => {
    console.log('✅ Bot joined the server!');
    setInterval(() => {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 500);
    }, 60000);
  });

  bot.on('error', err => {
    console.error('❌ Bot error:', err);
  });

  bot.on('end', () => {
    console.log('🔄 Bot disconnected. Reconnecting in 10s...');
    setTimeout(createBot, 10000);
  });
}

createBot();
