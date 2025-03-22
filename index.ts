import dotenv from "dotenv";
dotenv.config();

import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AccountInfo, Context, KeyedAccountInfo } from "@solana/web3.js";
import * as fs from "fs";
import { exec } from "child_process";

import idl from "./idl.json";

// Constants
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const PUMPSWAP_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const KNOWN_TOKENS: Record<string, string> = {
    [WSOL_MINT]: "SOL",
    // Add any known tokens here
};

// Configuration
const CONFIG = {
    updateIntervalMinutes: 5,
    minLiquiditySol: 0.1, // Minimum SOL liquidity to consider a pool significant
    significantPriceChangePercent: 5,  // 5% price change is significant
    significantLiquidityChangePercent: 10, // 10% liquidity change is significant
    newPoolNotificationThresholdSol: 1, // SOL threshold for new pool notifications
    maxPoolsToShow: 15,
    alertSoundEnabled: true,
    colorOutput: true,
    saveHistoricalData: true,
    historyRetentionDays: 7,
    monitorActivePoolsForVolume: true,
    significantVolumeChangePct: 20,
    poolMonitoringIntervalMinutes: 3,
};

// Add delay function to help with rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Use connectionConfig with higher timeouts and commitment
const connectionConfig = {
  commitment: 'confirmed' as import('@solana/web3.js').Commitment,
  confirmTransactionInitialTimeout: 60000,
  disableRetryOnRateLimit: false,
  timeout: 120000,
  wsEndpoint: process.env.WS_RPC_URL || process.env.RPC_URL?.replace('https://', 'wss://'),
};

const connection = new Connection(process.env.RPC_URL!, connectionConfig);

const program = new Program(idl, {
  connection,
});

// File paths
const DATA_DIR = "./data";
const POOLS_FILE = `${DATA_DIR}/pools.json`;
const TOKENS_FILE = `${DATA_DIR}/tokens.json`;
const HISTORY_DIR = `${DATA_DIR}/history`;

// ANSI colors for terminal output
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    underscore: "\x1b[4m",
    blink: "\x1b[5m",
    reverse: "\x1b[7m",
    hidden: "\x1b[8m",
    
    fg: {
        black: "\x1b[30m",
        red: "\x1b[31m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
        magenta: "\x1b[35m",
        cyan: "\x1b[36m",
        white: "\x1b[37m",
        crimson: "\x1b[38m"
    },
    
    bg: {
        black: "\x1b[40m",
        red: "\x1b[41m",
        green: "\x1b[42m",
        yellow: "\x1b[43m",
        blue: "\x1b[44m",
        magenta: "\x1b[45m",
        cyan: "\x1b[46m",
        white: "\x1b[47m",
        crimson: "\x1b[48m"
    }
};

// Create necessary directories
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}
if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR);
}

// Initialize data files if they don't exist
if (!fs.existsSync(POOLS_FILE)) {
    fs.writeFileSync(POOLS_FILE, JSON.stringify({}, null, 2));
}
if (!fs.existsSync(TOKENS_FILE)) {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify([], null, 2));
}

// Keep track of pools we've seen
const knownPools = new Map<string, PoolWithPrice>();
const knownTokens = new Set<string>();
const tokenVolume = new Map<string, { volume24h: number, trades24h: number, lastUpdated: number }>();

// Market statistics
let marketStats = {
    totalPools: 0,
    totalLiquiditySol: 0,
    avgPoolSizeSol: 0,
    medianPoolSizeSol: 0,
    largestPoolSizeSol: 0,
    smallestPoolSizeSol: 0,
    avgPriceChangePct: 0,
    avgLiquidityChangePct: 0,
    totalNewPools24h: 0,
    lastUpdated: 0
};

// Trading signals
const tradingSignals = new Map<string, {
    token: string,
    signal: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell',
    confidence: number, // 0-100
    reasons: string[],
    timestamp: number
}>();

// Pool monitoring for volume changes
const poolMonitoring = new Map<string, {
    lastTxCount: number,
    lastLiquidity: number,
    buyVolume: number,
    sellVolume: number,
    lastChecked: number,
    isActive: boolean
}>();

interface Pool {
    address: PublicKey;
    is_native_base: boolean;
    poolData: any;
}

interface PoolWithPrice extends Pool {
    price: number;
    reserves: {
        native: number;
        token: number;
    };
    baseMint: string;
    quoteMint: string;
    timestamp: number;
    priceHistory?: { price: number, timestamp: number }[];
    liquidityHistory?: { liquidity: number, timestamp: number }[];
    volumeHistory?: { volume: number, timestamp: number }[];
}

// Functions to manage data
const loadSavedData = () => {
    try {
        const poolsData = JSON.parse(fs.readFileSync(POOLS_FILE, 'utf-8'));
        const tokensData = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
        
        // Restore known pools
        Object.keys(poolsData).forEach(address => {
            const poolData = poolsData[address];
            knownPools.set(address, {
                ...poolData,
                address: new PublicKey(poolData.address),
                poolData: {
                    ...poolData.poolData,
                    creator: new PublicKey(poolData.poolData.creator),
                    baseMint: new PublicKey(poolData.poolData.baseMint),
                    quoteMint: new PublicKey(poolData.poolData.quoteMint),
                    lpMint: new PublicKey(poolData.poolData.lpMint),
                    poolBaseTokenAccount: new PublicKey(poolData.poolData.poolBaseTokenAccount),
                    poolQuoteTokenAccount: new PublicKey(poolData.poolData.poolQuoteTokenAccount),
                }
            });
            
            // Add tokens to known tokens set
            knownTokens.add(poolData.baseMint);
            knownTokens.add(poolData.quoteMint);
        });
        
        // Generate initial trading signals for all pools
        knownPools.forEach((pool, address) => {
            const tokenAddr = pool.is_native_base ? pool.quoteMint : pool.baseMint;
            if (pool.reserves.native >= CONFIG.minLiquiditySol) {
                const signal = calculateTradingSignal(pool);
                tradingSignals.set(tokenAddr, {
                    token: tokenAddr,
                    ...signal,
                    timestamp: Date.now()
                });
            }
        });
        
        // Restore known tokens (additional data beyond what's in pools)
        tokensData.forEach((token: string) => knownTokens.add(token));
        
        // Calculate market stats
        updateMarketStats();
        
        console.log(`Loaded ${c(knownPools.size.toString(), colors.fg.green)} known pools and ${c(knownTokens.size.toString(), colors.fg.yellow)} known tokens`);
    } catch (err) {
        console.error("Error loading saved data:", err);
    }
};

const saveData = () => {
    try {
        // Convert pools to a serializable format
        const poolsToSave: { [address: string]: any } = {};
        knownPools.forEach((pool, address) => {
            poolsToSave[address] = {
                ...pool,
                address: pool.address.toBase58(),
                poolData: {
                    ...pool.poolData,
                    creator: pool.poolData.creator.toBase58(),
                    baseMint: pool.poolData.baseMint.toBase58(),
                    quoteMint: pool.poolData.quoteMint.toBase58(),
                    lpMint: pool.poolData.lpMint.toBase58(),
                    poolBaseTokenAccount: pool.poolData.poolBaseTokenAccount.toBase58(),
                    poolQuoteTokenAccount: pool.poolData.poolQuoteTokenAccount.toBase58(),
                }
            };
        });
        
        fs.writeFileSync(POOLS_FILE, JSON.stringify(poolsToSave, null, 2));
        fs.writeFileSync(TOKENS_FILE, JSON.stringify(Array.from(knownTokens), null, 2));
        
        // Save historical data snapshot if enabled
        if (CONFIG.saveHistoricalData) {
            const currentDate = new Date().toISOString().split('T')[0];
            const historyFile = `${HISTORY_DIR}/pools_${currentDate}.json`;
            if (!fs.existsSync(historyFile)) {
                fs.writeFileSync(historyFile, JSON.stringify(poolsToSave, null, 2));
            }
            
            // Cleanup old history files
            if (CONFIG.historyRetentionDays > 0) {
                try {
                    const historyFiles = fs.readdirSync(HISTORY_DIR);
                    const now = Date.now();
                    historyFiles.forEach(file => {
                        const filePath = `${HISTORY_DIR}/${file}`;
                        const fileStat = fs.statSync(filePath);
                        const fileAgeDays = (now - fileStat.mtimeMs) / (1000 * 60 * 60 * 24);
                        if (fileAgeDays > CONFIG.historyRetentionDays) {
                            fs.unlinkSync(filePath);
                        }
                    });
                } catch (err) {
                    console.error("Error cleaning up history files:", err);
                }
            }
        }
    } catch (err) {
        console.error("Error saving data:", err);
    }
};

const updateMarketStats = () => {
    const pools = Array.from(knownPools.values())
        .filter(pool => pool.reserves.native >= CONFIG.minLiquiditySol);
    
    if (pools.length === 0) {
        return;
    }
    
    // Calculate total liquidity
    const totalLiquiditySol = pools.reduce((sum, pool) => sum + pool.reserves.native, 0);
    
    // Calculate median pool size
    const sortedLiquidity = [...pools].sort((a, b) => a.reserves.native - b.reserves.native);
    
    // Safely access array elements to fix TypeScript errors
    let medianPoolSizeSol = 0;
    if (sortedLiquidity.length > 0) {
        const medianIdx = Math.floor(sortedLiquidity.length / 2);
        if (medianIdx < sortedLiquidity.length) {
            const medianPool = sortedLiquidity[medianIdx];
            if (medianPool && medianPool.reserves) {
                medianPoolSizeSol = medianPool.reserves.native;
            }
        }
    }
    
    // Find min/max pool sizes (safely)
    let largestPoolSizeSol = 0;
    let smallestPoolSizeSol = 0;
    
    if (sortedLiquidity.length > 0) {
        const lastPool = sortedLiquidity[sortedLiquidity.length - 1];
        const firstPool = sortedLiquidity[0];
        
        if (lastPool && lastPool.reserves) {
            largestPoolSizeSol = lastPool.reserves.native;
        }
        
        if (firstPool && firstPool.reserves) {
            smallestPoolSizeSol = firstPool.reserves.native;
        }
    }
    
    // Count new pools in last 24h
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const newPools24h = pools.filter(pool => pool.timestamp > oneDayAgo).length;
    
    marketStats = {
        totalPools: pools.length,
        totalLiquiditySol,
        avgPoolSizeSol: pools.length > 0 ? totalLiquiditySol / pools.length : 0,
        medianPoolSizeSol,
        largestPoolSizeSol,
        smallestPoolSizeSol,
        avgPriceChangePct: 0, // This needs historical data to calculate
        avgLiquidityChangePct: 0, // This needs historical data to calculate
        totalNewPools24h: newPools24h,
        lastUpdated: Date.now()
    };
};

// Pool data collection functions
const getAllPools = async () => {
    console.log(`${c("SCAN", colors.bg.blue + colors.fg.white)} Fetching all PumpSwap pools...`);
    await delay(2000); // Delay before request
    
    try {
        const response = await connection.getProgramAccounts(PUMPSWAP_PROGRAM_ID, {
            filters: [{ "dataSize": 211 }]
        });
        
        console.log(`${c("INFO", colors.bg.cyan + colors.fg.black)} Found ${c(response.length.toString(), colors.fg.green)} total pools`);

    const mappedPools = response.map((pool) => {
        const data = Buffer.from(pool.account.data);
        const poolData = program.coder.accounts.decode('pool', data);
            const baseMint = poolData.baseMint.toBase58();
            const quoteMint = poolData.quoteMint.toBase58();
            
            // Add tokens to known tokens set
            knownTokens.add(baseMint);
            knownTokens.add(quoteMint);
            
            return {
                address: pool.pubkey,
                is_native_base: false, // Will update this later when getting price and liquidity
                poolData,
                baseMint,
                quoteMint
            };
        });
        
        return mappedPools;
    } catch (error) {
        console.error(`${c("ERROR", colors.bg.red + colors.fg.white)} Failed to fetch pools:`, error);
        return [];
    }
};

const getPriceAndLiquidity = async (pool: Pool, index: number, total: number) => {
    // Check if this is a SOL pool by looking at base or quote mint
    const baseMintStr = pool.poolData.baseMint.toBase58();
    const quoteMintStr = pool.poolData.quoteMint.toBase58();
    const is_native_base = baseMintStr === WSOL_MINT;
    const is_sol_pool = is_native_base || quoteMintStr === WSOL_MINT;
    
    const baseSymbol = getTokenSymbol(baseMintStr);
    const quoteSymbol = getTokenSymbol(quoteMintStr);
    
    // Only show processing message for every 10th pool to reduce console spam
    if (index % 10 === 0 || index === total - 1) {
        console.log(`${c("SCAN", colors.bg.blue + colors.fg.white)} Processing pool ${index + 1}/${total}: ${c(baseSymbol + "/" + quoteSymbol, colors.fg.cyan)}`);
    }
    
    await delay(2000); // Increased delay before requests
    try {
        const baseAddress = pool.poolData.poolBaseTokenAccount;
        const quoteAddress = pool.poolData.poolQuoteTokenAccount;
       
        const baseBalance = await connection.getTokenAccountBalance(baseAddress);
        await delay(2000); // Increased delay between requests
        const quoteBalance = await connection.getTokenAccountBalance(quoteAddress);

        // Calculate price depending on which token is SOL (if any)
        let price: number;
        let nativeReserves: number;
        let tokenReserves: number;
        
        if (is_native_base) {
            price = baseBalance.value.uiAmount! / quoteBalance.value.uiAmount!;
            nativeReserves = baseBalance.value.uiAmount!;
            tokenReserves = quoteBalance.value.uiAmount!;
        } else if (quoteMintStr === WSOL_MINT) {
            price = quoteBalance.value.uiAmount! / baseBalance.value.uiAmount!;
            nativeReserves = quoteBalance.value.uiAmount!;
            tokenReserves = baseBalance.value.uiAmount!;
        } else {
            // If neither is SOL, we'll just use base as the reference
            price = baseBalance.value.uiAmount! / quoteBalance.value.uiAmount!;
            nativeReserves = baseBalance.value.uiAmount!;
            tokenReserves = quoteBalance.value.uiAmount!;
        }
        
        // Get existing pool data if this is an update
        const existingPool = knownPools.get(pool.address.toBase58());
        const priceHistory = existingPool?.priceHistory || [];
        const liquidityHistory = existingPool?.liquidityHistory || [];
        
        // Add current values to history if this is an update
        if (existingPool) {
            priceHistory.push({ price: existingPool.price, timestamp: existingPool.timestamp });
            liquidityHistory.push({ liquidity: existingPool.reserves.native, timestamp: existingPool.timestamp });
            
            // Keep history limited to most recent 100 entries
            if (priceHistory.length > 100) priceHistory.shift();
            if (liquidityHistory.length > 100) liquidityHistory.shift();
        }

        return {
            ...pool,
            is_native_base,
            price,
            reserves: {
                native: nativeReserves,
                token: tokenReserves
            },
            baseMint: baseMintStr,
            quoteMint: quoteMintStr,
            timestamp: Date.now(),
            priceHistory,
            liquidityHistory
        } as PoolWithPrice;
    } catch (error) {
        console.error(`${c("ERROR", colors.bg.red + colors.fg.white)} Failed to get data for pool ${pool.address.toBase58()}:`, error);
        return {
            ...pool,
            is_native_base: false,
            price: 0,
            reserves: {
                native: 0,
                token: 0
            },
            baseMint: pool.poolData.baseMint.toBase58(),
            quoteMint: pool.poolData.quoteMint.toBase58(),
            timestamp: Date.now(),
            priceHistory: [],
            liquidityHistory: []
        } as PoolWithPrice;
    }
};

const getAllPoolsWithDetails = async () => {
    console.log(`\n${c("UPDATE", colors.bg.green + colors.fg.black)} Starting comprehensive pool scan at ${new Date().toLocaleString()}`);
    
    // Store previous data for comparison
    const previousPoolData = new Map<string, { price: number, liquidity: number }>();
    knownPools.forEach((pool, address) => {
        previousPoolData.set(address, { 
            price: pool.price, 
            liquidity: pool.reserves.native 
        });
    });
    
    const allPools = await getAllPools();
    
    if (allPools.length === 0) {
        console.log(`${c("WARN", colors.bg.yellow + colors.fg.black)} No pools found in this scan`);
        return [];
    }

    // Process pools one by one with delay instead of all at once
    const results: PoolWithPrice[] = [];
    for (let i = 0; i < allPools.length; i++) {
        const pool = allPools[i];
        if (pool) {  // Make sure pool is defined
            const result = await getPriceAndLiquidity(pool, i, allPools.length);
            results.push(result);
            
            // Generate trading signal
            if (result.reserves.native >= CONFIG.minLiquiditySol) {
                const tokenAddr = result.is_native_base ? result.quoteMint : result.baseMint;
                
                // Get previous data for this pool
                const prevData = previousPoolData.get(result.address.toBase58());
                
                const signal = calculateTradingSignal(result, prevData);
                tradingSignals.set(tokenAddr, {
                    token: tokenAddr,
                    ...signal,
                    timestamp: Date.now()
                });
            }
            
            // Store in known pools map
            knownPools.set(result.address.toBase58(), result);
        }
    }
    
    // Update market stats
    updateMarketStats();

    // Save updated data
    saveData();
    
    console.log(`${c("SUCCESS", colors.bg.green + colors.fg.black)} Processed ${c(results.length.toString(), colors.fg.green)} pools`);
    return results;
};

// Formatting helper functions
const c = (text: string, color: string) => {
    return CONFIG.colorOutput ? color + text + colors.reset : text;
};

const formatNumber = (num: number): string => {
    if (num === 0) return "0";
    if (num < 0.000001) return num.toExponential(6);
    if (num < 0.01) return num.toFixed(8);
    if (num < 1) return num.toFixed(6);
    if (num < 10000) return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

const formatPrice = (price: number): string => {
    if (price < 0.00000001) return price.toExponential(8) + " SOL";
    if (price < 0.000001) return price.toExponential(6) + " SOL";
    if (price < 0.01) return price.toFixed(8) + " SOL";
    return price.toFixed(6) + " SOL";
};

const formatPercentChange = (oldValue: number, newValue: number): string => {
    if (oldValue === 0) return "+∞%";
    const percentChange = ((newValue - oldValue) / oldValue) * 100;
    const sign = percentChange >= 0 ? "+" : "";
    const formatted = `${sign}${percentChange.toFixed(2)}%`;
    
    if (percentChange > 30) {
        return c(formatted, colors.fg.green + colors.bright);
    } else if (percentChange > 10) {
        return c(formatted, colors.fg.green);
    } else if (percentChange < -30) {
        return c(formatted, colors.fg.red + colors.bright);
    } else if (percentChange < -10) {
        return c(formatted, colors.fg.red);
    }
    return c(formatted, colors.fg.yellow);
};

const formatTimeSince = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
};

const playAlertSound = () => {
    if (CONFIG.alertSoundEnabled) {
        // Play a beep sound using console bell
        process.stdout.write('\x07');
        // Also try to play via system command for better sound on some systems
        try {
            if (process.platform === 'linux') {
                exec('play -q -n synth 0.3 sine 880 || echo -e "\a"');
            } else if (process.platform === 'darwin') {
                exec('afplay /System/Library/Sounds/Ping.aiff || echo -e "\a"');
            } else if (process.platform === 'win32') {
                exec('powershell -c (New-Object Media.SoundPlayer).PlaySystemSound([System.Media.SystemSounds]::Asterisk) || echo \a');
            }
        } catch (e) {
            // Fallback is the console bell which already played
        }
    }
};

const getTokenSymbol = (address: string): string => {
    // First check known tokens
    if (KNOWN_TOKENS[address]) {
        return KNOWN_TOKENS[address];
    }
    
    // Then check if it's a Pump token (ends with 'pump')
    if (address.endsWith('pump')) {
        const parts = address.split('');
        const symbolParts = [];
        for (let i = parts.length - 5; i >= 0; i--) {
            const char = parts[i];
            if (char && char >= 'A' && char <= 'Z') {
                symbolParts.unshift(char);
            } else {
                break;
            }
        }
        if (symbolParts.length > 0) {
            return symbolParts.join('');
        }
    }
    
    // If not recognized, return shortened address
    return address.slice(0, 4) + "..." + address.slice(-4);
};

// Generate marketplace links for tokens
const generateMarketplaceLinks = (tokenAddress: string, poolAddress: string): string => {
    const dexUrl = `https://dexscreener.com/solana/${poolAddress}`;
    const jupiterUrl = `https://jup.ag/swap/SOL-${tokenAddress}`;
    const birdeye = `https://birdeye.so/token/${tokenAddress}?chain=solana`;
    const gmuswap = `https://app.gmu.cash/#/tokens/${tokenAddress}`;
    const bullx = `https://bullx.io/token/${tokenAddress}`;
    const pumpfun = `https://pump.fun/token/${tokenAddress}`;
    
    // Create an even more visually appealing format with better spacing and colors
    return `\n${c("┌─────────────── TRADING LINKS ───────────────┐", colors.fg.magenta + colors.bright)}
${c("│", colors.fg.magenta)} ${c("DEX SCREENER", colors.fg.cyan + colors.bright)}:  ${dexUrl}
${c("│", colors.fg.magenta)} ${c("JUPITER", colors.fg.green + colors.bright)}:      ${jupiterUrl}
${c("│", colors.fg.magenta)} ${c("BIRDEYE", colors.fg.yellow + colors.bright)}:      ${birdeye}
${c("│", colors.fg.magenta)} ${c("GMU.CASH", colors.fg.blue + colors.bright)}:      ${gmuswap}
${c("│", colors.fg.magenta)} ${c("BULLX", colors.fg.red + colors.bright)}:        ${bullx}
${c("│", colors.fg.magenta)} ${c("PUMP.FUN", colors.fg.cyan + colors.bright)}:     ${pumpfun}
${c("└───────────────────────────────────────────┘", colors.fg.magenta + colors.bright)}`;
};

// Analysis functions
const calculateTradingSignal = (pool: PoolWithPrice, prevData?: { price: number, liquidity: number }): {
    signal: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell',
    confidence: number,
    reasons: string[]
} => {
    let points = 0;
    const maxPoints = 100;
    const reasons: string[] = [];
    
    // Default to hold if we don't have enough data
    if (!prevData || prevData.price === 0 || pool.price === 0) {
        return { signal: 'hold', confidence: 0, reasons: ['Insufficient historical data'] };
    }
    
    // 1. Price momentum
    const priceChange = ((pool.price - prevData.price) / prevData.price) * 100;
    if (priceChange > 20) {
        points += 20;
        reasons.push(`Strong positive price momentum (${priceChange.toFixed(2)}%)`);
    } else if (priceChange > 10) {
        points += 10;
        reasons.push(`Positive price momentum (${priceChange.toFixed(2)}%)`);
    } else if (priceChange < -20) {
        points -= 20;
        reasons.push(`Strong negative price momentum (${priceChange.toFixed(2)}%)`);
    } else if (priceChange < -10) {
        points -= 10;
        reasons.push(`Negative price momentum (${priceChange.toFixed(2)}%)`);
    }
    
    // 2. Liquidity change
    const liquidityChange = ((pool.reserves.native - prevData.liquidity) / prevData.liquidity) * 100;
    if (liquidityChange > 50) {
        points += 25;
        reasons.push(`Strong liquidity increase (${liquidityChange.toFixed(2)}%)`);
    } else if (liquidityChange > 20) {
        points += 15;
        reasons.push(`Good liquidity increase (${liquidityChange.toFixed(2)}%)`);
    } else if (liquidityChange < -30) {
        points -= 25;
        reasons.push(`Significant liquidity decrease (${liquidityChange.toFixed(2)}%)`);
    } else if (liquidityChange < -15) {
        points -= 15;
        reasons.push(`Moderate liquidity decrease (${liquidityChange.toFixed(2)}%)`);
    }
    
    // 3. Absolute liquidity size
    if (pool.reserves.native > 100) {
        points += 15;
        reasons.push(`Strong liquidity pool (${pool.reserves.native.toFixed(2)} SOL)`);
    } else if (pool.reserves.native > 50) {
        points += 10;
        reasons.push(`Good liquidity pool (${pool.reserves.native.toFixed(2)} SOL)`);
    } else if (pool.reserves.native < 5) {
        points -= 10;
        reasons.push(`Low liquidity pool (${pool.reserves.native.toFixed(2)} SOL)`);
    }
    
    // 4. Volume (if available)
    const tokenAddr = pool.is_native_base ? pool.quoteMint : pool.baseMint;
    const volumeData = tokenVolume.get(tokenAddr);
    if (volumeData && volumeData.volume24h > 0) {
        const volumeToLiquidityRatio = volumeData.volume24h / pool.reserves.native;
        if (volumeToLiquidityRatio > 0.5) {
            points += 15;
            reasons.push(`High trading volume relative to liquidity (${volumeToLiquidityRatio.toFixed(2)}x)`);
        } else if (volumeToLiquidityRatio > 0.2) {
            points += 8;
            reasons.push(`Good trading volume (${volumeToLiquidityRatio.toFixed(2)}x liquidity)`);
        }
    }
    
    // Determine the signal based on points
    let signal: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
    if (points >= 35) {
        signal = 'strong_buy';
    } else if (points >= 15) {
        signal = 'buy';
    } else if (points <= -35) {
        signal = 'strong_sell';
    } else if (points <= -15) {
        signal = 'sell';
    } else {
        signal = 'hold';
    }
    
    // Normalize confidence to 0-100 range
    const confidence = Math.min(100, Math.max(0, Math.abs(points) / maxPoints * 100));
    
    return { signal, confidence, reasons };
};

const formatPoolInfo = (pool: PoolWithPrice, includeSignal = true): string => {
    const baseSymbol = getTokenSymbol(pool.baseMint);
    const quoteSymbol = getTokenSymbol(pool.quoteMint);
    const pairName = pool.is_native_base ? `${quoteSymbol}/SOL` : `${baseSymbol}/${quoteSymbol}`;
    const tokenAddr = pool.is_native_base ? pool.quoteMint : pool.baseMint;
    
    let output = c(`\n${pairName}`, colors.bright + colors.fg.cyan) + "\n";
    output += `Address: ${pool.address.toBase58()}\n`;
    output += `Price: ${c(formatPrice(pool.price), colors.fg.yellow)}\n`;
    output += `Liquidity: ${c(formatNumber(pool.reserves.native) + " SOL", colors.fg.green)} / ${formatNumber(pool.reserves.token)} ${pool.is_native_base ? quoteSymbol : baseSymbol}\n`;
    
    // Add links to marketplaces
    output += `${generateMarketplaceLinks(tokenAddr, pool.address.toBase58())}\n`;
    
    if (includeSignal) {
        const signal = tradingSignals.get(tokenAddr);
        if (signal) {
            let signalColor = colors.fg.yellow;
            switch (signal.signal) {
                case 'strong_buy': signalColor = colors.bright + colors.fg.green; break;
                case 'buy': signalColor = colors.fg.green; break;
                case 'sell': signalColor = colors.fg.red; break;
                case 'strong_sell': signalColor = colors.bright + colors.fg.red; break;
            }
            
            output += `Signal: ${c(signal.signal.toUpperCase().replace('_', ' '), signalColor)} (${signal.confidence.toFixed(0)}% confidence)\n`;
            output += `Reasons: ${signal.reasons.join(', ')}\n`;
        }
    }
    
    // Add volume monitoring status if active
    const monitoring = poolMonitoring.get(pool.address.toBase58());
    if (monitoring && monitoring.isActive) {
        output += `Monitoring: ${c("ACTIVE", colors.fg.green)}\n`;
        if (monitoring.buyVolume > 0 || monitoring.sellVolume > 0) {
            output += `Recent Activity: ${c("+" + formatNumber(monitoring.buyVolume) + " SOL buys", colors.fg.green)} / ${c("-" + formatNumber(monitoring.sellVolume) + " SOL sells", colors.fg.red)}\n`;
        }
    }
    
    output += `Last Updated: ${formatTimeSince(pool.timestamp)}`;
    return output;
};

// Real-time monitoring functions
const processNewPool = async (pubkey: PublicKey, account: AccountInfo<Buffer>) => {
    try {
        // Make sure we haven't seen this pool before
        const poolAddressStr = pubkey.toBase58();
        if (knownPools.has(poolAddressStr)) {
            return;
        }
        
        // Decode pool data
        const poolData = program.coder.accounts.decode('pool', account.data);
        const newPool = {
            address: pubkey,
            is_native_base: false,
            poolData,
            baseMint: poolData.baseMint.toBase58(),
            quoteMint: poolData.quoteMint.toBase58()
        };
        
        // Add tokens to known tokens set
        knownTokens.add(newPool.baseMint);
        knownTokens.add(newPool.quoteMint);

        // Get price and liquidity details
        const poolWithDetails = await getPriceAndLiquidity(newPool, 0, 1);
        
        // Add to known pools
        knownPools.set(poolAddressStr, poolWithDetails);
        
        // Only notify for pools with meaningful liquidity
        if (poolWithDetails.reserves.native >= CONFIG.newPoolNotificationThresholdSol) {
            // Generate trading signal
            const tokenAddr = poolWithDetails.is_native_base ? poolWithDetails.quoteMint : poolWithDetails.baseMint;
            const signal = calculateTradingSignal(poolWithDetails);
            tradingSignals.set(tokenAddr, {
                token: tokenAddr,
                ...signal,
                timestamp: Date.now()
            });
            
            // Play alert sound
            playAlertSound();
            
            // Format the notification
            const baseSymbol = getTokenSymbol(poolWithDetails.baseMint);
            const quoteSymbol = getTokenSymbol(poolWithDetails.quoteMint);
            const pairName = poolWithDetails.is_native_base ? `${quoteSymbol}/SOL` : `${baseSymbol}/${quoteSymbol}`;
            
            console.log('\n' + c("▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓", colors.bg.cyan));
            console.log(c("                 NEW POOL DETECTED                  ", colors.bg.cyan + colors.fg.black + colors.bright));
            console.log(c("▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓", colors.bg.cyan));
            console.log(formatPoolInfo(poolWithDetails));
            
            // Add trading opportunity assessment
            if (signal.signal === 'strong_buy' || signal.signal === 'buy') {
                console.log('\n' + c("TRADING OPPORTUNITY", colors.fg.green + colors.bright));
                signal.reasons.forEach(reason => console.log("✓ " + reason));
            }
            
            console.log(c("▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓", colors.bg.cyan));
        } else {
            // Just log a simple message for low-liquidity pools
            console.log(`${c("NEW", colors.bg.blue + colors.fg.white)} Low liquidity pool created: ${getTokenSymbol(poolWithDetails.baseMint)}/${getTokenSymbol(poolWithDetails.quoteMint)} (${formatNumber(poolWithDetails.reserves.native)} SOL)`);
        }
        
        // Save updated data
        saveData();
        
        // Update market stats
        updateMarketStats();
        
    } catch (error) {
        console.error(`${c("ERROR", colors.bg.red + colors.fg.white)} Failed to process new pool:`, error);
    }
};

const setupProgramAccountSubscription = async () => {
    try {
        console.log(`${c("SETUP", colors.bg.magenta + colors.fg.white)} Setting up real-time pool monitoring...`);
        
        // Subscribe to program accounts
        const subscriptionId = connection.onProgramAccountChange(
            PUMPSWAP_PROGRAM_ID,
            async (keyedAccountInfo: KeyedAccountInfo, context: Context) => {
                const pubkey = keyedAccountInfo.accountId;
                const account = keyedAccountInfo.accountInfo;
                
                // Only process accounts that look like pools (211 bytes size)
                if (account.data.length === 211) {
                    await processNewPool(pubkey, account);
                }
            },
            'confirmed',
            [{ dataSize: 211 }]
        );
        
        console.log(`${c("SUCCESS", colors.bg.green + colors.fg.black)} Real-time monitoring active with subscription ID: ${subscriptionId}`);
        return subscriptionId;
    } catch (error) {
        console.error(`${c("ERROR", colors.bg.red + colors.fg.white)} Failed to set up real-time monitoring:`, error);
        return null;
    }
};

const startPeriodicUpdates = async (intervalMinutes = CONFIG.updateIntervalMinutes) => {
    const updateInterval = intervalMinutes * 60 * 1000;
    
    const updatePools = async () => {
        try {
            // Get all pools with their details
            await getAllPoolsWithDetails();
            
            // Display trading signals and market summary
            displayTradingSummary();
        } catch (error) {
            console.error(`${c("ERROR", colors.bg.red + colors.fg.white)} Periodic update failed:`, error);
        }
    };
    
    // Run initial update
    await updatePools();
    
    // Set up interval
    setInterval(updatePools, updateInterval);
    console.log(`${c("INFO", colors.bg.cyan + colors.fg.black)} Automatic updates scheduled every ${intervalMinutes} minutes`);
};

// Display functions
const displayTradingSummary = () => {
    // Sort signals by confidence level and recency
    const sortedSignals = Array.from(tradingSignals.values())
        .filter(signal => {
            // Only include fairly recent signals (last 2 hours)
            const signalAge = (Date.now() - signal.timestamp) / (1000 * 60 * 60);
            return signalAge < 2;
        })
        .sort((a, b) => {
            // First prioritize signal type (buy signals first)
            const signalValueA = a.signal === 'strong_buy' ? 4 : 
                               a.signal === 'buy' ? 3 : 
                               a.signal === 'hold' ? 2 : 
                               a.signal === 'sell' ? 1 : 0;
            
            const signalValueB = b.signal === 'strong_buy' ? 4 : 
                               b.signal === 'buy' ? 3 : 
                               b.signal === 'hold' ? 2 : 
                               b.signal === 'sell' ? 1 : 0;
            
            const diff = signalValueB - signalValueA;
            if (diff !== 0) return diff;
            
            // Then prioritize by confidence
            return b.confidence - a.confidence;
        });
    
    // Find the corresponding pools for these signals
    const signalPools: PoolWithPrice[] = [];
    for (const signal of sortedSignals) {
        const tokenAddr = signal.token;
        // Look for pools with this token
        for (const pool of knownPools.values()) {
            const poolTokenAddr = pool.is_native_base ? pool.quoteMint : pool.baseMint;
            if (poolTokenAddr === tokenAddr && pool.reserves.native >= CONFIG.minLiquiditySol) {
                signalPools.push(pool);
                break;
            }
        }
        
        // Limit to top signals
        if (signalPools.length >= CONFIG.maxPoolsToShow) break;
    }
    
    // Display market overview
    console.log('\n' + c("════════════════════════════════════════════════════", colors.fg.cyan));
    console.log(c("               PUMPSWAP MARKET SUMMARY               ", colors.fg.cyan + colors.bright));
    console.log(c("════════════════════════════════════════════════════", colors.fg.cyan));
    
    console.log(`Last Update: ${new Date().toLocaleString()}`);
    console.log(`Tracking ${c(marketStats.totalPools.toString(), colors.fg.green)} pools with ${c(formatNumber(marketStats.totalLiquiditySol), colors.fg.green)} SOL total liquidity`);
    console.log(`New pools in last 24h: ${c(marketStats.totalNewPools24h.toString(), colors.fg.yellow)}`);
    console.log(`Average pool size: ${formatNumber(marketStats.avgPoolSizeSol)} SOL`);
    
    // Display trading signals
    if (signalPools.length > 0) {
        console.log('\n' + c("▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬", colors.fg.yellow));
        console.log(c("                  TRADING SIGNALS                   ", colors.fg.yellow + colors.bright));
        console.log(c("▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬", colors.fg.yellow));
        
        // Display strong buy and buy signals first
        const buySignals = signalPools.filter(pool => {
            const tokenAddr = pool.is_native_base ? pool.quoteMint : pool.baseMint;
            const signal = tradingSignals.get(tokenAddr);
            return signal && (signal.signal === 'strong_buy' || signal.signal === 'buy');
        });
        
        if (buySignals.length > 0) {
            console.log('\n' + c("BUY OPPORTUNITIES:", colors.fg.green + colors.bright));
            buySignals.forEach(pool => {
                console.log(formatPoolInfo(pool));
            });
        }
        
        // Then display strong sell and sell signals
        const sellSignals = signalPools.filter(pool => {
            const tokenAddr = pool.is_native_base ? pool.quoteMint : pool.baseMint;
            const signal = tradingSignals.get(tokenAddr);
            return signal && (signal.signal === 'strong_sell' || signal.signal === 'sell');
        });
        
        if (sellSignals.length > 0) {
            console.log('\n' + c("SELL SIGNALS:", colors.fg.red + colors.bright));
            sellSignals.forEach(pool => {
                console.log(formatPoolInfo(pool));
            });
        }
    } else {
        console.log('\nNo significant trading signals at this time.');
    }
    
    // Display top pools by liquidity
    const topPools = Array.from(knownPools.values())
        .filter(pool => pool.reserves.native >= CONFIG.minLiquiditySol)
        .sort((a, b) => b.reserves.native - a.reserves.native)
        .slice(0, 10);
    
    if (topPools.length > 0) {
        console.log('\n' + c("▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬", colors.fg.cyan));
        console.log(c("               TOP POOLS BY LIQUIDITY                ", colors.fg.cyan + colors.bright));
        console.log(c("▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬", colors.fg.cyan));
        
        topPools.forEach((pool, i) => {
            const baseSymbol = getTokenSymbol(pool.baseMint);
            const quoteSymbol = getTokenSymbol(pool.quoteMint);
            const pairName = pool.is_native_base ? `${quoteSymbol}/SOL` : `${baseSymbol}/${quoteSymbol}`;
            
            console.log(`${i+1}. ${c(pairName, colors.fg.cyan)}: ${c(formatNumber(pool.reserves.native) + " SOL", colors.fg.green)} - Price: ${c(formatPrice(pool.price), colors.fg.yellow)}`);
        });
    }
    
    console.log(c("\n════════════════════════════════════════════════════", colors.fg.cyan));
};

const displayWelcomeMessage = () => {
    console.log('\n' + c("╔═══════════════════════════════════════════════════════╗", colors.bright + colors.fg.cyan));
    console.log(c("║                                                       ║", colors.bright + colors.fg.cyan));
    console.log(c("║  🚀 PUMPSWAP PROFESSIONAL TRADING SCANNER 🚀  ║", colors.bright + colors.fg.cyan));
    console.log(c("║                                                       ║", colors.bright + colors.fg.cyan));
    console.log(c("╚═══════════════════════════════════════════════════════╝", colors.bright + colors.fg.cyan));
    console.log(`\nVersion: 1.0.0   |   ${new Date().toLocaleDateString()}`);
    console.log(`Using Helius RPC: ${process.env.RPC_URL!.includes('helius') ? c('✓', colors.fg.green) : c('✗', colors.fg.red)}`);
    
    console.log('\n' + c("FEATURES:", colors.bright));
    console.log(`✓ Real-time monitoring of new pool listings`);
    console.log(`✓ Automatic trading signals based on price and liquidity`);
    console.log(`✓ Market overview with top pools by liquidity`);
    console.log(`✓ Price change tracking and trend analysis`);
    console.log(`✓ Buy/sell volume monitoring with alerts`);
    console.log(`✓ Quick links to DEX, Jupiter, GMGN, BullX and Birdeye`);
    console.log(`✓ Data saved to ${DATA_DIR} folder for historical analysis`);
    
    console.log('\n' + c("COMMANDS:", colors.bright));
    console.log(`Press Ctrl+C to exit scanner`);
    console.log(`Type 'monitor <pool_address>' to monitor specific pool`);
    console.log(`Type 'stop <pool_address>' to stop monitoring a pool`);
};

const main = async () => {
    // Display welcome screen
    displayWelcomeMessage();
    
    // Load saved data from previous runs
    loadSavedData();
    
    // Start listening for new pools
    const subscriptionId = await setupProgramAccountSubscription();
    
    if (!subscriptionId) {
        console.log(`${c("WARN", colors.bg.yellow + colors.fg.black)} Real-time monitoring unavailable - will rely on periodic scans only`);
    }
    
    // Start periodic updates
    await startPeriodicUpdates();
    
    // Start pool monitoring if enabled
    await startPoolMonitoring();
    
    // Command line interface for interactive commands
    process.stdin.on('data', (data) => {
        const input = data.toString().trim();
        
        if (input.startsWith('monitor ')) {
            const poolAddress = input.substring(8).trim();
            togglePoolMonitoring(poolAddress, true);
        } else if (input.startsWith('stop ')) {
            const poolAddress = input.substring(5).trim();
            togglePoolMonitoring(poolAddress, false);
        } else if (input === 'help') {
            console.log('\n' + c("AVAILABLE COMMANDS:", colors.bright));
            console.log(`monitor <pool_address> - Start monitoring a specific pool`);
            console.log(`stop <pool_address> - Stop monitoring a specific pool`);
            console.log(`help - Show this help menu`);
        }
    });
    
    console.log('\n' + c("SCANNER STATUS: ACTIVE ✓", colors.bg.green + colors.fg.black + colors.bright));
    console.log(`Scanning for trading opportunities every ${CONFIG.updateIntervalMinutes} minutes`);
    console.log(`Alerts enabled for new pools with >${CONFIG.newPoolNotificationThresholdSol} SOL liquidity`);
    console.log(`Volume monitoring active for top pools (updates every ${CONFIG.poolMonitoringIntervalMinutes} minutes)`);
    console.log(`Type 'help' for available commands`);
};

// Start the scanner
main().catch(error => {
    console.error(`${c("FATAL ERROR", colors.bg.red + colors.fg.white)}`, error);
    process.exit(1);
});

// Monitor pools for transaction and volume changes
const monitorPoolActivity = async (poolAddress: string) => {
    try {
        const pool = knownPools.get(poolAddress);
        if (!pool) return;
        
        // Get current stats
        const monitoring = poolMonitoring.get(poolAddress) || {
            lastTxCount: 0,
            lastLiquidity: pool.reserves.native,
            buyVolume: 0,
            sellVolume: 0,
            lastChecked: Date.now(),
            isActive: true
        };
        
        // Check transaction signatures for this pool in the last period
        const signatures = await connection.getSignaturesForAddress(
            pool.address, 
            { limit: 20 }
        );
        
        // If we have new transactions since last check
        const newSignatureCount = signatures.length - monitoring.lastTxCount;
        
        if (newSignatureCount > 0) {
            // Get transaction details for new signatures
            const newSignatures = signatures.slice(0, newSignatureCount);
            
            // Check each transaction to determine if it's a buy or sell
            let buyVolume = 0;
            let sellVolume = 0;
            
            const txDetails = await Promise.all(
                newSignatures.map(sig => connection.getTransaction(sig.signature, { maxSupportedTransactionVersion: 0 }))
            );
            
            // Analyze transactions (simplified - actual swap detection would need more complex logic)
            for (const tx of txDetails) {
                if (!tx || !tx.meta) continue;
                
                // Check pre/post token balances to determine swap direction
                const preBalance = pool.reserves.native;
                const postBalanceObj = tx.meta.postTokenBalances?.find(
                    b => b.owner === pool.address.toString()
                );
                
                const postBalance = postBalanceObj?.uiTokenAmount?.uiAmount || 0;
                
                if (postBalance && preBalance) {
                    const difference = Math.abs(postBalance - preBalance);
                    
                    if (postBalance > preBalance) {
                        // This is likely a buy (token -> SOL)
                        buyVolume += difference;
                    } else if (postBalance < preBalance) {
                        // This is likely a sell (SOL -> token)
                        sellVolume += difference;
                    }
                }
            }
            
            // Check if volume change is significant
            const significantVolumeChange = 
                (buyVolume > pool.reserves.native * (CONFIG.significantVolumeChangePct / 100)) ||
                (sellVolume > pool.reserves.native * (CONFIG.significantVolumeChangePct / 100));
            
            // Update monitoring data
            monitoring.lastTxCount = signatures.length;
            monitoring.buyVolume += buyVolume;
            monitoring.sellVolume += sellVolume;
            monitoring.lastLiquidity = pool.reserves.native;
            monitoring.lastChecked = Date.now();
            
            // If significant change, notify
            if (significantVolumeChange) {
                // Play alert sound
                playAlertSound();
                
                // Show notification
                console.log('\n' + c("▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓", colors.bg.yellow));
                console.log(c("              SIGNIFICANT ACTIVITY DETECTED              ", colors.bg.yellow + colors.fg.black + colors.bright));
                console.log(c("▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓", colors.bg.yellow));
                
                // Format notification details
                const baseSymbol = getTokenSymbol(pool.baseMint);
                const quoteSymbol = getTokenSymbol(pool.quoteMint);
                const pairName = pool.is_native_base ? `${quoteSymbol}/SOL` : `${baseSymbol}/${quoteSymbol}`;
                
                console.log(c(`Pool: ${pairName}`, colors.bright + colors.fg.cyan));
                console.log(`Address: ${pool.address.toBase58()}`);
                
                if (buyVolume > 0) {
                    console.log(c(`BUY VOLUME: +${formatNumber(buyVolume)} SOL`, colors.fg.green + colors.bright));
                }
                if (sellVolume > 0) {
                    console.log(c(`SELL VOLUME: -${formatNumber(sellVolume)} SOL`, colors.fg.red + colors.bright));
                }
                
                // Include links for quick access
                const tokenAddr = pool.is_native_base ? pool.quoteMint : pool.baseMint;
                console.log(generateMarketplaceLinks(tokenAddr, pool.address.toBase58()));
                
                console.log(c("▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓", colors.bg.yellow));
            }
        }
        
        // Update pool monitoring data
        poolMonitoring.set(poolAddress, monitoring);
        
    } catch (error) {
        console.error(`${c("ERROR", colors.bg.red + colors.fg.white)} Failed to monitor pool activity:`, error);
    }
};

// Start volume monitoring for selected pools
const startPoolMonitoring = async () => {
    if (!CONFIG.monitorActivePoolsForVolume) return;
    
    console.log(`${c("SETUP", colors.bg.magenta + colors.fg.white)} Setting up pool volume monitoring...`);
    
    const monitoringInterval = CONFIG.poolMonitoringIntervalMinutes * 60 * 1000;
    
    const monitorPools = async () => {
        try {
            // Get top pools by liquidity to monitor
            const poolsToMonitor = Array.from(knownPools.values())
                .filter(pool => pool.reserves.native >= CONFIG.minLiquiditySol)
                .sort((a, b) => b.reserves.native - a.reserves.native)
                .slice(0, 20); // Monitor top 20 pools
            
            for (const pool of poolsToMonitor) {
                const poolAddress = pool.address.toBase58();
                
                // Activate monitoring if not already active
                if (!poolMonitoring.has(poolAddress)) {
                    poolMonitoring.set(poolAddress, {
                        lastTxCount: 0,
                        lastLiquidity: pool.reserves.native,
                        buyVolume: 0,
                        sellVolume: 0,
                        lastChecked: Date.now(),
                        isActive: true
                    });
                }
                
                // Monitor activity for this pool
                await monitorPoolActivity(poolAddress);
                await delay(2000); // Add delay between monitoring pools to avoid rate limits
            }
        } catch (error) {
            console.error(`${c("ERROR", colors.bg.red + colors.fg.white)} Pool monitoring failed:`, error);
        }
    };
    
    // Run initial monitoring
    await monitorPools();
    
    // Set up interval
    setInterval(monitorPools, monitoringInterval);
    console.log(`${c("INFO", colors.bg.cyan + colors.fg.black)} Pool volume monitoring active - checking every ${CONFIG.poolMonitoringIntervalMinutes} minutes`);
};

// Add pool monitoring command
const togglePoolMonitoring = (poolAddress: string, activate: boolean = true) => {
    if (knownPools.has(poolAddress)) {
        const pool = knownPools.get(poolAddress)!;
        
        if (activate) {
            poolMonitoring.set(poolAddress, {
                lastTxCount: 0,
                lastLiquidity: pool.reserves.native,
                buyVolume: 0,
                sellVolume: 0,
                lastChecked: Date.now(),
                isActive: true
            });
            console.log(`${c("INFO", colors.bg.cyan + colors.fg.black)} Started monitoring for pool: ${poolAddress}`);
        } else {
            const monitoring = poolMonitoring.get(poolAddress);
            if (monitoring) {
                monitoring.isActive = false;
                poolMonitoring.set(poolAddress, monitoring);
                console.log(`${c("INFO", colors.bg.cyan + colors.fg.black)} Stopped monitoring for pool: ${poolAddress}`);
            }
        }
    } else {
        console.log(`${c("ERROR", colors.bg.red + colors.fg.white)} Pool not found: ${poolAddress}`);
    }
};
