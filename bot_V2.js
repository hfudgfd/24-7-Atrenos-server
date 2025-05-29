// --- GLOBAL MINECRAFT-DATA TEST (COMMENTED OUT FOR NOW) ---
/*
const mcDataGlobalTest = require('minecraft-data')('1.21.3'); // Or '1.21.4'
console.log("GLOBAL TEST: mcData for version loaded:", !!mcDataGlobalTest);
if (mcDataGlobalTest && mcDataGlobalTest.mobsByName) {
    console.log("GLOBAL TEST: mcData.mobsByName['zombie'] for version:", mcDataGlobalTest.mobsByName['zombie']);
    if (mcDataGlobalTest.mobsByName['zombie']) {
        console.log("GLOBAL TEST: mcData.mobsByName['zombie'].health for version:", mcDataGlobalTest.mobsByName['zombie'].health);
    } else {
        console.error("GLOBAL TEST: 'zombie' key is MISSING in mcData.mobsByName for version!");
        console.log("GLOBAL TEST: Available mob keys (first 20):", Object.keys(mcDataGlobalTest.mobsByName).slice(0, 20));
    }
} else {
    console.error("GLOBAL TEST: mcData.mobsByName is undefined for version!");
}
console.log("--- END OF GLOBAL MINECRAFT-DATA TEST ---");
*/
// --- END OF GLOBAL MINECRAFT-DATA TEST ---


const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { GoalNear, GoalFollow } = require('mineflayer-pathfinder').goals;

// --- Bot Configuration ---
const BOT_USERNAME = 'GuardianBot';
const MASTER_USERNAME = 'ProME444';
const PROTECT_RADIUS = 6;
const ATTACK_INTERVAL = 1000;
const BOT_ATTACK_RANGE = 3.5;

// Combat Constants
const LOW_HEALTH_THRESHOLD = 10;
const CRITICAL_HEALTH_THRESHOLD = 5;
const KITING_DISTANCE_CREEPER = 5.5;
const KITING_DISTANCE_DEFAULT = 3.0;
const TARGET_WEAK_HEALTH_PERCENTAGE = 0.30;

const HOSTILE_MOB_TYPES = new Set([
    'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch',
    'slime', 'magma_cube', 'phantom', 'blaze', 'ghast', 'guardian',
    'elder_guardian', 'shulker', 'vindicator', 'evoker', 'ravager',
    'piglin_brute', 'hoglin', 'zoglin', 'warden',
    'breeze', 'bogged',
]);

const botConnectionOptions = {
    host: 'mainserver211.aternos.me',
    port: 30638,
    username: BOT_USERNAME,
    version: '1.21.3', // Sticking with 1.21.3 as per last server change
    auth: 'offline',
};

console.log("Starting GuardianBot with options:", botConnectionOptions);
const bot = mineflayer.createBot(botConnectionOptions);

// --- Global State ---
let masterEntity = null;
let currentTarget = null;
let lastMasterPosition = null;
let isProtecting = false;
let mainProtectInterval = null;

// --- Load Plugins ---
try {
    bot.loadPlugin(pathfinder);
    console.log("Pathfinder plugin loaded.");
} catch (e) {
    console.error("CRITICAL: Error loading pathfinder plugin:", e);
}

// --- Event Handlers ---
bot.on('login', () => {
    console.log("--- GUARDIAN BOT LOGIN EVENT ---");
    if (bot.options && bot.options.host) {
        console.log(`Bot ${bot.username} logged in to ${bot.options.host}:${bot.options.port} (v${bot.version}).`);
    } else {
        console.warn(`Bot ${bot.username} logged in (v${bot.version}). Host/port from bot.options unavailable (using predefined: ${botConnectionOptions.host}:${botConnectionOptions.port}).`);
    }
    setTimeout(() => {
        findMaster();
        if (masterEntity) {
            isProtecting = true;
            startProtectionLoop();
            bot.chat("Reconnected & resuming protection for " + MASTER_USERNAME);
        } else {
            bot.chat("GuardianBot online. Waiting for " + MASTER_USERNAME + ". Say 'guard me'.");
        }
    }, 3000);
});

bot.on('spawn', () => {
    console.log("GuardianBot spawned.");
    try {
        const mcData = require('minecraft-data')(bot.version);
        if (!mcData) {
            console.error(`FATAL: mcData for v${bot.version} failed in spawn. Bot unstable.`);
            return;
        }
        if (bot.pathfinder) {
            const defaultMove = new Movements(bot, mcData);
            bot.pathfinder.setMovements(defaultMove);
            console.log("Pathfinder movements initialized.");
        } else {
            console.warn("Pathfinder not available at spawn. Navigation will fail.");
        }
    } catch (err) {
        console.error(`Error initializing pathfinder: ${err.message}`);
    }
    findMaster();
    if (isProtecting && masterEntity && !mainProtectInterval) {
        startProtectionLoop();
    }
});

bot.on('playerJoined', (player) => {
    console.log(`Player joined: ${player.username}`);
    if (player.username === MASTER_USERNAME) {
        console.log(`${MASTER_USERNAME} joined.`);
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
        console.log(`${MASTER_USERNAME} left.`);
        masterEntity = null;
        currentTarget = null;
        isProtecting = false;
        stopProtectionLoop("Master left");
        if (bot.pathfinder) bot.pathfinder.stop();
    }
});

bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    console.log(`Chat: <${username}> ${message}`);
    if (username === MASTER_USERNAME) {
        const command = message.toLowerCase();
        if (command === 'guard me') {
            bot.chat(`Yes, ${MASTER_USERNAME}! Protecting you.`);
            findMaster();
            if (masterEntity) {
                isProtecting = true;
                startProtectionLoop();
            } else {
                bot.chat(`Can't see you yet, ${MASTER_USERNAME}. Come closer.`);
            }
        } else if (command === 'stop guarding') {
            bot.chat(`Okay, ${MASTER_USERNAME}. Standing down.`);
            isProtecting = false;
            stopProtectionLoop("Commanded to stop");
            currentTarget = null;
            if (bot.pathfinder) bot.pathfinder.stop();
        } else if (command === 'bot come') {
            if (masterEntity) {
                bot.chat(`Coming, ${MASTER_USERNAME}!`);
                if (bot.pathfinder) bot.pathfinder.setGoal(new GoalFollow(masterEntity, 1), true);
                else bot.chat("Pathfinder unavailable.");
            } else {
                bot.chat(`Can't find you, ${MASTER_USERNAME}.`);
            }
        } else if (command === 'bot status') {
            let status = `Protecting ${MASTER_USERNAME}: ${isProtecting}. `;
            status += `Master: ${!!masterEntity}. Health: ${bot.health}/${bot.maxHealth}. Food: ${bot.food}/20. `;
            status += `Target: ${currentTarget ? (currentTarget.displayName || currentTarget.name || 'Unknown') : 'None'}.`;
            bot.chat(status);
        }
    }
});

bot.on('kicked', (reason) => { console.error('Kicked:', reason); stopProtectionLoop("Kicked"); });
bot.on('error', (err) => { console.error('GuardianBot Error:', err); });
bot.on('end', (reason) => { console.log('Disconnected:', reason); stopProtectionLoop("Disconnected"); });


function findMaster() {
    console.log("Finding master:", MASTER_USERNAME);
    if (!bot || !bot.players) {
        console.warn("findMaster: bot/bot.players unavailable.");
        masterEntity = null; return;
    }
    const player = bot.players[MASTER_USERNAME];
    if (player && player.entity) {
        masterEntity = player.entity;
        console.log(`Master ${MASTER_USERNAME} found at ${masterEntity.position.toString()}`);
        lastMasterPosition = masterEntity.position.clone();
    } else {
        console.log(`Master ${MASTER_USERNAME} not found. Players: [${Object.keys(bot.players).join(', ')}]`);
        masterEntity = null;
    }
}

function getHostileMobsNearMaster() {
    if (!masterEntity || !bot.entities[masterEntity.id]) return [];
    if (!lastMasterPosition && masterEntity) lastMasterPosition = masterEntity.position.clone();
    else if (masterEntity && lastMasterPosition && masterEntity.position.distanceTo(lastMasterPosition) > 1.0) {
        lastMasterPosition = masterEntity.position.clone();
    }

    const hostileMobs = [];
    for (const id in bot.entities) {
        const entity = bot.entities[id];
        if (!entity || entity === bot.entity || entity === masterEntity || entity.type === 'player' || entity.type === 'object' || entity.type === 'orb') continue;
        let entityIdentifier = entity.name ? entity.name.toLowerCase() : null;
        if ((entityIdentifier && HOSTILE_MOB_TYPES.has(entityIdentifier)) || entity.kind === 'Hostile mobs') {
            if (masterEntity.position.distanceTo(entity.position) <= PROTECT_RADIUS) {
                hostileMobs.push(entity);
            }
        }
    }
    hostileMobs.sort((a, b) => masterEntity.position.distanceTo(a.position) - masterEntity.position.distanceTo(b.position));
    return hostileMobs;
}

async function manageFood() {
    if (bot.food < 10) {
        const edibleFood = bot.inventory.items().find(item =>
            item.name.includes('cooked_porkchop') || item.name.includes('cooked_beef') ||
            item.name.includes('cooked_chicken') || item.name.includes('cooked_mutton') ||
            item.name.includes('bread') || item.name.includes('apple') || item.name.includes('baked_potato') ||
            item.name.includes('carrot') || item.name.includes('cooked_salmon') || item.name.includes('cooked_cod')
        );
        if (edibleFood) {
            try {
                if (!currentTarget || bot.entity.position.distanceTo(currentTarget.position) > BOT_ATTACK_RANGE + 2) {
                    console.log("Hunger low, eating " + edibleFood.displayName);
                    bot.chat("Hungry! Eating some " + edibleFood.displayName + ".");
                    await bot.equip(edibleFood, 'hand');
                    await bot.consume();
                    console.log("Consumed " + edibleFood.displayName);
                    return true;
                } else {
                    console.log("Hungry, but combat is priority.");
                }
            } catch (err) {
                console.log("Error consuming food:", err.message);
            }
        } else {
             if (!currentTarget) bot.chat("I'm hungry and have no food!");
        }
    }
    return false;
}

// --- CRUDE HARDCODED HEALTH WORKAROUND ---
function getMobMaxHealth(entity, mcDataInstance) { // mcDataInstance might be problematic or incomplete
    if (!entity) return 20;
    const entityNameLookup = entity.name ? entity.name.toLowerCase() : null;

    // Hardcoded values for common mobs
    if (entityNameLookup === 'zombie') return 20;
    if (entityNameLookup === 'skeleton') return 20;
    if (entityNameLookup === 'creeper') return 20;
    if (entityNameLookup === 'spider') return 16;
    if (entityNameLookup === 'enderman') return 40;
    if (entityNameLookup === 'witch') return 26;
    if (entityNameLookup === 'slime') return 16; // Large slime, smaller ones vary
    if (entityNameLookup === 'magma_cube') return 16; // Large
    if (entityNameLookup === 'phantom') return 20;
    if (entityNameLookup === 'blaze') return 20;
    if (entityNameLookup === 'ghast') return 10;
    if (entityNameLookup === 'guardian') return 30;
    if (entityNameLookup === 'shulker') return 30;
    if (entityNameLookup === 'vindicator') return 24;
    if (entityNameLookup === 'evoker') return 24;
    if (entityNameLookup === 'ravager') return 100;
    if (entityNameLookup === 'piglin_brute') return 50;
    if (entityNameLookup === 'hoglin') return 40;
    if (entityNameLookup === 'zoglin') return 40;
    if (entityNameLookup === 'warden') return 500;
    if (entityNameLookup === 'breeze') return 30; // Assuming based on typical mob health
    if (entityNameLookup === 'bogged') return 20; // Assuming similar to skeleton

    // Fallback attempt to use mcData if it somehow becomes available and valid
    if (mcDataInstance && mcDataInstance.mobsByName) {
        if (entityNameLookup && mcDataInstance.mobsByName[entityNameLookup] && typeof mcDataInstance.mobsByName[entityNameLookup].health === 'number') {
            console.log(`getMobMaxHealth: Used mcData for '${entityNameLookup}'! Health: ${mcDataInstance.mobsByName[entityNameLookup].health}`);
            return mcDataInstance.mobsByName[entityNameLookup].health;
        }
    }
    
    if (entityNameLookup) {
        console.warn(`getMobMaxHealth: No hardcoded or mcData health for '${entityNameLookup}'. Defaulting to 20. Entity: ${entity.displayName || entity.name}`);
    }
    return 20; // Default if not in hardcoded list or mcData
}


async function protectMasterLogic() {
    if (!isProtecting) {
        stopProtectionLoop("isProtecting flag false");
        return;
    }

    if (!masterEntity) {
        findMaster();
        if (!masterEntity) return;
    }

    if (!bot.entities[masterEntity.id]) {
        console.warn("Master entity disappeared. Re-evaluating.");
        masterEntity = null; currentTarget = null;
        if (bot.pathfinder) bot.pathfinder.stop();
        return;
    }

    await manageFood();

    let shouldPrioritizeRetreatOrKite = false;
    const threats = getHostileMobsNearMaster();
    let mcData = null; // Initialize to null
    try {
        // We still try to load it, in case it works or for other non-health properties
        mcData = require('minecraft-data')(bot.version);
        if (!mcData || !mcData.mobsByName) { // This check will likely be true based on GLOBAL TEST
            // console.warn(`mcData or mcData.mobsByName is undefined for v${bot.version}. Relying on hardcoded healths.`);
            // No need to return here, getMobMaxHealth will use hardcoded values.
        }
    } catch (e) {
        console.error(`Error loading mcData in protectMasterLogic (v${bot.version}):`, e);
        // mcData remains null, getMobMaxHealth will use hardcoded values.
    }

    if (bot.health <= CRITICAL_HEALTH_THRESHOLD && currentTarget) {
        console.log(`CRITICAL HEALTH (${bot.health})! Disengaging from ${currentTarget.displayName || currentTarget.name}.`);
        if (bot.pathfinder && masterEntity) {
            bot.chat("Health critical! Retreating to master!");
            bot.pathfinder.setGoal(new GoalFollow(masterEntity, 3), true);
        }
        currentTarget = null;
        shouldPrioritizeRetreatOrKite = true;
    } else if (bot.health <= LOW_HEALTH_THRESHOLD && currentTarget) {
        const maxHealthTargetLowH = getMobMaxHealth(currentTarget, mcData); // Pass mcData, even if it's problematic
        const targetIsWeakLowH = currentTarget.health !== undefined && currentTarget.health <= maxHealthTargetLowH * TARGET_WEAK_HEALTH_PERCENTAGE;
        const outnumberedLowH = threats.filter(t => t.id !== currentTarget.id && bot.entity.position.distanceTo(t.position) < PROTECT_RADIUS + 2).length > 0;
        const isCreeperLowH = currentTarget.name === 'creeper';

        if (isCreeperLowH || (!targetIsWeakLowH || outnumberedLowH)) {
            console.log(`Health: ${bot.health}. Kiting: Target=${currentTarget.displayName || currentTarget.name}, Weak=${targetIsWeakLowH}, Outnumbered=${outnumberedLowH}, Creeper=${isCreeperLowH}`);
            if (bot.pathfinder) {
                const directionAwayFromTarget = bot.entity.position.minus(currentTarget.position).normalize();
                const kiteDistance = isCreeperLowH ? KITING_DISTANCE_CREEPER : KITING_DISTANCE_DEFAULT;
                const retreatPos = bot.entity.position.plus(directionAwayFromTarget.scaled(kiteDistance + (isCreeperLowH ? 0.5 : 1.0) ));
                bot.pathfinder.setGoal(new GoalNear(retreatPos.x, retreatPos.y, retreatPos.z, 1), !isCreeperLowH);
                shouldPrioritizeRetreatOrKite = true;
            }
        } else {
            console.log(`Health: ${bot.health}. Target ${currentTarget.displayName || currentTarget.name} is weak/alone. Engaging.`);
        }
    }

    if (shouldPrioritizeRetreatOrKite) {
        if (currentTarget && bot.entity.position.distanceTo(currentTarget.position) <= BOT_ATTACK_RANGE + 1.5) {
            await bot.lookAt(currentTarget.position.offset(0, currentTarget.height * 0.85, 0), true);
            bot.attack(currentTarget);
        }
        return;
    }

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
        const healthLog = currentTarget.health !== undefined ? `H:${currentTarget.health}` : "H:undefined";
        console.log(`New target: ${currentTarget.displayName || currentTarget.name} (${healthLog}, D:${bot.entity.position.distanceTo(currentTarget.position).toFixed(1)})`);
        if (bot.pathfinder && bot.pathfinder.isMoving()) bot.pathfinder.stop();
    }

    if (currentTarget) {
        try {
            const targetHeadPos = currentTarget.position.offset(0, currentTarget.height * 0.85, 0);
            await bot.lookAt(targetHeadPos, true);
            const distanceToTarget = bot.entity.position.distanceTo(currentTarget.position);

            const maxHealthTargetCombat = getMobMaxHealth(currentTarget, mcData); // Pass mcData
            const currentHealthTargetCombat = currentTarget.health;

            const finishHim = currentHealthTargetCombat !== undefined && currentHealthTargetCombat <= maxHealthTargetCombat * TARGET_WEAK_HEALTH_PERCENTAGE && bot.health > CRITICAL_HEALTH_THRESHOLD;
            const isActualCreeper = currentTarget.name === 'creeper';

            if (isActualCreeper && distanceToTarget < KITING_DISTANCE_CREEPER && bot.health > LOW_HEALTH_THRESHOLD) {
                if (bot.pathfinder) {
                    const directionAway = bot.entity.position.minus(currentTarget.position).normalize();
                    const kitePos = bot.entity.position.plus(directionAway.scaled(KITING_DISTANCE_CREEPER - distanceToTarget + 1.0));
                    console.log("Creeper too close! Kiting (specific logic).");
                    bot.pathfinder.setGoal(new GoalNear(kitePos.x, kitePos.y, kitePos.z, 1), false);
                    if (distanceToTarget <= BOT_ATTACK_RANGE + 0.5) bot.attack(currentTarget);
                    return;
                }
            }

            if (distanceToTarget <= BOT_ATTACK_RANGE || (finishHim && distanceToTarget <= BOT_ATTACK_RANGE + 0.5)) {
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
                if (finishHim) console.log("Target is weak! Finishing it!");
            } else {
                if (bot.pathfinder) {
                    if (!bot.pathfinder.isMoving() ||
                        (bot.pathfinder.goal && bot.pathfinder.goal.entity?.id !== currentTarget.id) ||
                        (bot.pathfinder.goal && typeof bot.pathfinder.goal.isEnd === 'function' && bot.pathfinder.goal.isEnd(bot.entity.position.floored()))) {
                        const p = currentTarget.position;
                        bot.pathfinder.setGoal(new GoalNear(p.x, p.y, p.z, Math.max(0.5, BOT_ATTACK_RANGE - 1.0)), false);
                    }
                } else {
                    console.warn("Pathfinder unavailable for approach.");
                }
            }
        } catch (err) {
            console.error(`Engagement error with ${currentTarget.displayName || currentTarget.name || 'UnknownEntity'}: ${err.message}`);
            // No need to check for "Cannot read properties of undefined" specifically for mcData here,
            // as getMobMaxHealth handles the mcData failure more gracefully.
            console.error(`Problematic target details: Name='${currentTarget.name}', Type='${currentTarget.type}', DisplayName='${currentTarget.displayName}'`);
            currentTarget = null;
            if (bot.pathfinder) bot.pathfinder.stop();
        }
    } else if (isProtecting && masterEntity) {
        const distToMaster = bot.entity.position.distanceTo(masterEntity.position);
        if (distToMaster > PROTECT_RADIUS * 0.75) {
            if (bot.pathfinder && !bot.pathfinder.isMoving()) {
                // console.log("No threats, moving closer to master.");
                // bot.pathfinder.setGoal(new GoalFollow(masterEntity, Math.max(1, PROTECT_RADIUS / 2.5)), true);
            }
        }
    }
}


function startProtectionLoop() {
    if (mainProtectInterval) { /* console.log("Loop already running."); */ return; }
    if (!isProtecting) { console.log("Cannot start loop: isProtecting=false."); return; }
    console.log("Starting protection loop (interval:", ATTACK_INTERVAL, "ms)");
    mainProtectInterval = setInterval(async () => {
        try { await protectMasterLogic(); }
        catch (e) { console.error("Unhandled error in protection interval:", e); }
    }, ATTACK_INTERVAL);
}

function stopProtectionLoop(reason = "Unknown") {
    console.log("Stopping protection loop. Reason:", reason);
    if (mainProtectInterval) {
        clearInterval(mainProtectInterval);
        mainProtectInterval = null;
    }
}

process.on('SIGINT', () => {
    console.log("SIGINT: Disconnecting...");
    stopProtectionLoop("SIGINT");
    isProtecting = false;
    if (bot && typeof bot.quit === 'function') bot.quit('Script termination');
    setTimeout(() => { console.log("Exiting."); process.exit(0); }, 1500);
});
process.on('uncaughtException', (err, origin) => {
    console.error('UNCAUGHT EXCEPTION:', err, 'Origin:', origin);
    stopProtectionLoop("Uncaught exception");
    isProtecting = false; process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason, 'Promise:', promise);
});

console.log("GuardianBot script initialized. Waiting for login...");
