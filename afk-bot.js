const mineflayer = require('mineflayer');

function startBot() {
  const bot = mineflayer.createBot({
    host: process.env.HOST || 'mainserver211.aternos.me',  // replace with your Aternos host
    port: parseInt(process.env.PORT) || 30638,             // replace with your Aternos port
    username: process.env.USERNAME || 'AFK_Bot_' + Math.floor(Math.random() * 1000)
  });

  bot.on('spawn', () => {
    console.log('✅ Bot joined the server');

    // Prevent AFK timeout: jump every 30 seconds
    setInterval(() => {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 500);
    }, 30000);
  });

  bot.on('end', () => {
    console.log('🔁 Disconnected from server. Reconnecting in 10s...');
    setTimeout(startBot, 10000); // Reconnect after 10 seconds
  });

  bot.on('error', (err) => {
    console.log('⚠️ Bot encountered error:', err.message);
  });
}

startBot();
