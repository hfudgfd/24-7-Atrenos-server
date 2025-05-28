const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder'); // Make sure this is installed
const { GoalNear, GoalFollow } = require('mineflayer-pathfinder').goals;

// --- Bot Configuration ---
const BOT_USERNAME = 'GuardianBot';
const MASTER_USERNAME = 'ProME444';
const PROTECT_RADIUS = 6; // Blocks around the master
const ATTACK_INTERVAL = 1000; // Milliseconds
const BOT_ATTACK_RANGE = 3.5; // How close the bot needs to be to attack

// Combat Constants
const LOW_HEALTH_THRESHOLD = 8; // (4 hearts) - Retreat if health is this or lower
const CRITICAL_HEALTH_THRESHOLD = 4; // (2 hearts) - More desperate retreat/disengage
const KITING_DISTANCE_CREEPER = 5; // How far to try and stay from creepers
const KITING_DISTANCE_DEFAULT = 2.5;

const HOSTILE_MOB_TYPES = new Set([
    'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch',
    'slime', 'magma_cube', 'phantom', 'blaze', 'ghast', 'guardian',
    'elder_guardian', 'shulker', 'vindicator', 'evoker', 'ravager',
    'piglin_brute', 'hoglin', 'zoglin', 'warden',
    'breeze', // New in 1.21
    'bogged', // New in 1.21
]);

// Store options separately due to the observed issue with bot.options
const botConnectionOptions = {
    host: 'mainserver211.aternos.me',
    port: 30638,
    username: BOT_USERNAME,
    version: '1.21.4',
    auth: 'offline',
};

console.log("Starting GuardianBot with options:", botConnectionOptions);
const bot = mineflayer.createBot(botConnectionOptions);

// --- Global State ---
let masterEntity = null;
let currentTarget = null;
let lastMasterPosition = null;
let isProtecting = false; // To control the main loop
let mainProtectInterval = null;

// --- Load Plugins ---
try {
    bot.loadPlugin(pathfinder);
    console.log("Pathfinder plugin loaded.");
} catch (e) {
    console.error("CRITICAL: Error loading pathfinder plugin:", e);
    console.log("Pathfinder is essential for this bot. Please ensure 'mineflayer-pathfinder' is installed correctly.");
}

// --- Event Handlers ---
bot.on('login', () => {
    console.log("--- GUARDIAN BOT LOGIN EVENT ---");
    if (bot.options && bot.options.host) {
        console.log(`Bot ${bot.username} logged in to ${bot.options.host}:${bot.options.port} (version ${bot.version}).`);
    } else {
        console.warn(`Bot ${bot.username} logged in (version ${bot.version}). Host/port from bot.options is unavailable (using predefined: ${botConnectionOptions.host}:${botConnectionOptions.port}).`);
    }
    setTimeout(() => {
        findMaster();
        if (masterEntity) {
            isProtecting = true;
            startProtectionLoop();
            bot.chat("Reconnected and resuming protection for " + MASTER_USERNAME);
        } else {
            bot.chat("GuardianBot online. Waiting for " + MASTER_USERNAME + ". Say 'guard me' when ready.");
        }
    }, 3000);
});

bot.on('spawn', () => {
    console.log("GuardianBot spawned.");
    try {
        const mcData = require('minecraft-data')(bot.version);
        if (!mcData) {
            console.error(`FATAL: Could not load minecraft-data for version ${bot.version}. Bot will not function correctly.`);
            return;
        }
        if (bot.pathfinder) {
            const defaultMove = new Movements(bot, mcData);
            bot.pathfinder.setMovements(defaultMove);
            console.log("Pathfinder movements initialized.");
        } else {
            console.warn("Pathfinder plugin not available on bot object at spawn time. Navigation will fail.");
        }
    } catch (err) {
        console.error(`Error initializing pathfinder movements: ${err.message}`);
    }
    findMaster();
    if (isProtecting && masterEntity && !mainProtectInterval) {
        startProtectionLoop();
    }
});

bot.on('playerJoined', (player) => {
    console.log(`Player joined: ${player.username}`);
    if (player.username === MASTER_USERNAME) {
        console.log(`${MASTER_USERNAME} joined the game.`);
        findMaster();
        if (isProtecting && masterEntity && !mainProtectInterval) {
            bot.chat(`Welcome back, ${MASTER_USERNAME}! Resuming protection.`);
            startProtectionLoop();
        }
    }
});

bot.on('playerLeft', (player) => {
    console.log(`Player left: ${player.username}`);
    if (player.username === MASTER_USERNAME) {
        console.log(`${MASTER_USERNAME} left the game.`);
        masterEntity = null;
        currentTarget = null;
        isProtecting = false;
        stopProtectionLoop("Master left");
        if (bot.pathfinder) {
            bot.pathfinder.stop();
        }
    }
});

bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    console.log(`Chat: <${username}> ${message}`);

    if (username === MASTER_USERNAME) {
        const command = message.toLowerCase();
        if (command === 'guard me') {
            bot.chat(`Yes, ${MASTER_USERNAME}! I will find you and protect you.`);
            findMaster();
            if (masterEntity) {
                isProtecting = true;
                startProtectionLoop();
            } else {
                bot.chat(`I can't see you yet, ${MASTER_USERNAME}. Please come closer or wait a moment.`);
            }
        } else if (command === 'stop guarding') {
            bot.chat(`Okay, ${MASTER_USERNAME}. Standing down protection.`);
            isProtecting = false;
            stopProtectionLoop("Commanded to stop");
            currentTarget = null;
            if (bot.pathfinder) {
                bot.pathfinder.stop();
            }
        } else if (command === 'bot come') {
            if (masterEntity) {
                bot.chat(`Coming to you, ${MASTER_USERNAME}!`);
                if (bot.pathfinder) {
                    bot.pathfinder.setGoal(new GoalFollow(masterEntity, 1), true);
                } else {
                    bot.chat("Pathfinder not available to come to you.");
                }
            } else {
                bot.chat(`I can't find you to come, ${MASTER_USERNAME}. Try 'guard me' first.`);
            }
        } else if (command === 'bot status') {
            let status = `GuardianBot Status: Protecting ${MASTER_USERNAME}: ${isProtecting}. `;
            status += `Master found: ${!!masterEntity}. `;
            if (masterEntity) status += `Master pos: ${masterEntity.position.toString()}. `;
            status += `Bot Health: ${bot.health}. `;
            status += `Current target: ${currentTarget ? (currentTarget.displayName || currentTarget.name || 'Unknown Mob Type') : 'None'}.`;
            bot.chat(status);
        }
    }
});

bot.on('kicked', (reason, loggedIn) => {
    console.error('Bot kicked:', reason, loggedIn);
    stopProtectionLoop("Kicked from server");
});

bot.on('error', (err) => {
    console.error('GuardianBot Error:', err);
});

bot.on('end', (reason) => {
    console.log('GuardianBot disconnected. Reason:', reason);
    stopProtectionLoop("Disconnected: " + reason);
});

// --- Core Logic Functions ---
function findMaster() {
    console.log("Attempting to find master:", MASTER_USERNAME);
    if (!bot || !bot.players) {
        console.warn("findMaster: bot object or bot.players is not available.");
        masterEntity = null;
        return;
    }
    const player = bot.players[MASTER_USERNAME];
    if (player && player.entity) {
        masterEntity = player.entity;
        console.log(`Master ${MASTER_USERNAME} found! Position: X:${masterEntity.position.x.toFixed(1)}, Y:${masterEntity.position.y.toFixed(1)}, Z:${masterEntity.position.z.toFixed(1)}`);
        lastMasterPosition = masterEntity.position.clone();
    } else {
        console.log(`Master ${MASTER_USERNAME} not found among current players: [${Object.keys(bot.players).join(', ')}]`);
        masterEntity = null;
    }
}

function getHostileMobsNearMaster() {
    if (!masterEntity || !bot.entities[masterEntity.id]) {
        return [];
    }
    if (lastMasterPosition && masterEntity.position.distanceTo(lastMasterPosition) > 1.0) {
        lastMasterPosition = masterEntity.position.clone();
    } else if (!lastMasterPosition) {
        lastMasterPosition = masterEntity.position.clone();
    }

    const hostileMobs = [];
    for (const id in bot.entities) {
        const entity = bot.entities[id];
        if (!entity || entity === bot.entity || entity === masterEntity || entity.type === 'player' || entity.type === 'object' || entity.type === 'orb') continue;

        let entityIdentifier = null;
        if (entity.name) {
            entityIdentifier = entity.name.toLowerCase();
        }
        
        if ((entityIdentifier && HOSTILE_MOB_TYPES.has(entityIdentifier)) || entity.kind === 'Hostile mobs') {
            if (masterEntity.position.distanceTo(entity.position) <= PROTECT_RADIUS) {
                hostileMobs.push(entity);
            }
        }
    }
    hostileMobs.sort((a, b) => masterEntity.position.distanceTo(a.position) - masterEntity.position.distanceTo(b.position));
    return hostileMobs;
}

// This is the experimental combat maneuver function, call it if you want to test basic strafing.
// Its call is currently commented out in protectMasterLogic.
async function performCombatManeuver(target) {
    if (!bot.pathfinder || !target) return;
    const distanceToTarget = bot.entity.position.distanceTo(target.position);

    if (distanceToTarget < BOT_ATTACK_RANGE - 0.5 && !bot.pathfinder.isMoving()) {
        const randomAction = Math.random();
        let strafeGoal = null;

        if (target.name && target.name.toLowerCase().includes('creeper') && distanceToTarget < KITING_DISTANCE_CREEPER -1 ) {
             const backDir = bot.entity.position.minus(target.position).normalize();
             const retreatPos = bot.entity.position.plus(backDir.scaled(2));
             strafeGoal = new GoalNear(retreatPos.x, retreatPos.y, retreatPos.z, 1);
             console.log("Creeper too close! Backing up (performCombatManeuver).");
        } else if (randomAction < 0.3) { // Strafe left
            const leftDir = bot.entity.yaw + Math.PI / 2;
            const strafePos = bot.entity.position.offset(Math.sin(leftDir) * 0.5, 0, Math.cos(leftDir) * 0.5);
            strafeGoal = new GoalNear(strafePos.x, strafePos.y, strafePos.z, 0.2);
        } else if (randomAction < 0.6) { // Strafe right
            const rightDir = bot.entity.yaw - Math.PI / 2;
            const strafePos = bot.entity.position.offset(Math.sin(rightDir) * 0.5, 0, Math.cos(rightDir) * 0.5);
            strafeGoal = new GoalNear(strafePos.x, strafePos.y, strafePos.z, 0.2);
        } else if (randomAction < 0.8 && distanceToTarget < BOT_ATTACK_RANGE -1) { // Small step back
            const backDir = bot.entity.position.minus(target.position).normalize();
            const strafePos = bot.entity.position.plus(backDir.scaled(0.5));
            strafeGoal = new GoalNear(strafePos.x, strafePos.y, strafePos.z, 0.2);
        }

        if (strafeGoal) {
            try {
                // This is a very basic attempt and might not be effective.
                // bot.pathfinder.setGoal(strafeGoal, false); 
            } catch (e) {
                // console.warn("Minor error setting strafe goal:", e.message);
            }
        }
    }
}

// THIS IS THE CORRECT, ENHANCED protectMasterLogic
async function protectMasterLogic() {
    if (!isProtecting) {
        stopProtectionLoop("isProtecting became false");
        return;
    }

    if (!masterEntity) {
        findMaster();
        if (!masterEntity) return;
    }

    if (!bot.entities[masterEntity.id]) {
        console.warn("Master entity disappeared. Re-evaluating.");
        masterEntity = null;
        currentTarget = null;
        if (bot.pathfinder) bot.pathfinder.stop();
        return;
    }

    // --- Health Check and Retreat ---
    if (bot.health <= CRITICAL_HEALTH_THRESHOLD && currentTarget) {
        console.log(`CRITICAL HEALTH (${bot.health})! Attempting to disengage from ${currentTarget.displayName || currentTarget.name}.`);
        if (bot.pathfinder && masterEntity) {
            bot.chat("Health critical! Trying to retreat to master!");
            bot.pathfinder.setGoal(new GoalFollow(masterEntity, 2), true); // Sprint to master
        }
        currentTarget = null; // Drop target to focus on retreat
        return; // Skip rest of combat logic for this tick
    }
    if (bot.health <= LOW_HEALTH_THRESHOLD && currentTarget && bot.pathfinder) {
         console.log(`Low health (${bot.health})! Kiting ${currentTarget.displayName || currentTarget.name}.`);
         const directionAwayFromTarget = bot.entity.position.minus(currentTarget.position).normalize();
         const retreatPos = bot.entity.position.plus(directionAwayFromTarget.scaled(KITING_DISTANCE_DEFAULT + 1));
         bot.pathfinder.setGoal(new GoalNear(retreatPos.x, retreatPos.y, retreatPos.z, 1), true); // Sprint away
         if (bot.entity.position.distanceTo(currentTarget.position) <= BOT_ATTACK_RANGE + 1) {
             await bot.lookAt(currentTarget.position.offset(0, currentTarget.height * 0.85, 0), true); // Look while kiting
             bot.attack(currentTarget);
         }
         return; // Prioritize kiting
    }

    const threats = getHostileMobsNearMaster();

    if (currentTarget) {
        const currentTargetEntity = bot.entities[currentTarget.id];
        if (!currentTargetEntity || currentTargetEntity.health === 0 || masterEntity.position.distanceTo(currentTargetEntity.position) > PROTECT_RADIUS + 3) {
            console.log(`Target ${currentTarget.displayName || currentTarget.name} no longer valid.`);
            currentTarget = null;
            if (bot.pathfinder) bot.pathfinder.stop();
        }
    }

    if (!currentTarget && threats.length > 0) {
        currentTarget = threats[0];
        const creeperNearMaster = threats.find(t => (t.name === 'creeper') && masterEntity.position.distanceTo(t.position) < 4);
        if (creeperNearMaster) currentTarget = creeperNearMaster;

        console.log(`New target: ${currentTarget.displayName || currentTarget.name} (Health: ${currentTarget.health}, DistToBot: ${bot.entity.position.distanceTo(currentTarget.position).toFixed(1)})`);
        if (bot.pathfinder && bot.pathfinder.isMoving()){
            bot.pathfinder.stop();
        }
    }

    if (currentTarget) {
        try {
            const targetHeadPos = currentTarget.position.offset(0, currentTarget.height * 0.85, 0);
            await bot.lookAt(targetHeadPos, true);

            const distanceToTarget = bot.entity.position.distanceTo(currentTarget.position);

            if ((currentTarget.name === 'creeper') && distanceToTarget < KITING_DISTANCE_CREEPER) {
                if (bot.pathfinder) {
                    const directionAwayFromCreeper = bot.entity.position.minus(currentTarget.position).normalize();
                    const kitePos = bot.entity.position.plus(directionAwayFromCreeper.scaled(KITING_DISTANCE_CREEPER - distanceToTarget + 1.5)); // Kite a bit further
                    console.log("Creeper detected! Kiting away.");
                    bot.pathfinder.setGoal(new GoalNear(kitePos.x, kitePos.y, kitePos.z, 1), false); // Don't sprint kiting unless necessary
                     if (distanceToTarget <= BOT_ATTACK_RANGE + 0.5) {
                        bot.attack(currentTarget);
                    }
                    return; 
                }
            }

            if (distanceToTarget <= BOT_ATTACK_RANGE) {
                if (bot.pathfinder && bot.pathfinder.isMoving() && bot.pathfinder.goal?.entity?.id !== currentTarget.id) {
                     bot.pathfinder.stop();
                }

                let bestWeapon = bot.inventory.items().find(item => item.name.includes('sword'));
                if (!bestWeapon) bestWeapon = bot.inventory.items().find(item => item.name.includes('axe'));

                if (bestWeapon && (!bot.heldItem || bot.heldItem.type !== bestWeapon.type)) {
                    console.log(`Equipping ${bestWeapon.name} to attack.`);
                    await bot.equip(bestWeapon, 'hand');
                    await bot.waitForTicks(3);
                }
                
                bot.attack(currentTarget);
                await performCombatManeuver(currentTarget); // Basic attempt to move, call if you want to test it

            } else { 
                if (bot.pathfinder) {
                    if (!bot.pathfinder.isMoving() ||
                        (bot.pathfinder.goal && bot.pathfinder.goal.entity?.id !== currentTarget.id) ||
                        (bot.pathfinder.goal && typeof bot.pathfinder.goal.isEnd === 'function' && bot.pathfinder.goal.isEnd(bot.entity.position.floored()))) {
                        
                        const p = currentTarget.position;
                        bot.pathfinder.setGoal(new GoalNear(p.x, p.y, p.z, Math.max(1, BOT_ATTACK_RANGE - 1.0)), false);
                    }
                } else {
                    console.warn("Pathfinder not available to move towards target.");
                }
            }
        } catch (err) {
            console.error(`Error during engagement with ${currentTarget.displayName || currentTarget.name}: ${err.message}`);
            currentTarget = null;
            if (bot.pathfinder) bot.pathfinder.stop();
        }
    } else if (isProtecting && masterEntity) {
        const distToMaster = bot.entity.position.distanceTo(masterEntity.position);
        if (distToMaster > PROTECT_RADIUS -1) { 
            if (bot.pathfinder && !bot.pathfinder.isMoving()) {
                // console.log("No threats, moving closer to master.");
                // bot.pathfinder.setGoal(new GoalFollow(masterEntity, Math.max(1, PROTECT_RADIUS / 2)), true);
            }
        }
    }
}


function startProtectionLoop() {
    if (mainProtectInterval) {
        console.log("Protection loop already running.");
        return;
    }
    if (!isProtecting) {
        console.log("Attempted to start protection loop, but isProtecting is false.");
        return;
    }
    console.log("Starting protection loop. Interval:", ATTACK_INTERVAL, "ms");
    mainProtectInterval = setInterval(async () => {
        try {
            await protectMasterLogic();
        } catch (e) {
            console.error("Unhandled error in mainProtectInterval's async call:", e);
        }
    }, ATTACK_INTERVAL);
}

function stopProtectionLoop(reason = "Unknown") {
    console.log("Stopping protection loop. Reason:", reason);
    if (mainProtectInterval) {
        clearInterval(mainProtectInterval);
        mainProtectInterval = null;
    }
}

// --- Graceful Shutdown ---
process.on('SIGINT', () => {
    console.log("Caught SIGINT (Ctrl+C). Disconnecting bot...");
    stopProtectionLoop("Process interrupted (SIGINT)");
    isProtecting = false;
    if (bot && typeof bot.quit === 'function') {
        bot.quit('Script termination');
    }
    setTimeout(() => {
        console.log("Exiting process.");
        process.exit(0);
    }, 1500);
});

process.on('uncaughtException', (err, origin) => {
    console.error('UNCAUGHT EXCEPTION DETECTED:');
    console.error(err);
    console.error('Origin:', origin);
    stopProtectionLoop("Uncaught exception");
    isProtecting = false;
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED PROMISE REJECTION DETECTED:');
    console.error('Reason:', reason);
    console.error('Promise:', promise);
});

console.log("GuardianBot script initialized. Waiting for login...");
