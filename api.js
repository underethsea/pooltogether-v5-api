const pgp = require("pg-promise")(/* initialization options */);
const ethers = require("ethers");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
var compression = require("compression");
const http = require("http");
const https = require("https");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");
const { FetchHolders } = require("./holders");
const { GetLidoApy } = require("./functions/getLidoApy");
const { GetZapperInfo } = require("./zapper");
const { GeckoPrice } = require("./functions/geckoFetch");
const { GetWinners } = require("./functions/getWinners");
const { GetPrizeResults } = require("./functions/getPrizeResults");
const { GetPlayers } = require("./functions/getPlayers");
const { GetPrizes } = require("./functions/getPrizes");
const { GetClaims } = require("./functions/getClaims");
const { GetTwabPromotions } = require("./functions/getTwabRewards");
const { UpdateV5Vaults } = require("./updateVaults");
const { PublishV5PrizeHistory } = require("./publishPrizeHistory");
const PrizeLeaderboard = require("./functions/getPrizeLeaderBoard");
dotenv.config();
// var sanitizer = require('sanitize');

const pricesToFetch = [
  "pooltogether",
  "dai",
  "usd-coin",
  "weth",
  "optimism",
  "liquity-usd",
];

const poolToken = "0x395Ae52bB17aef68C2888d941736A71dC6d4e125";

const v5Chains = [
  // { id: 10, name: "OPTIMISM", prizePool: "" },
  {
    id: 10,
    name: "OPTIMISM",
    prizePool: "0xe32e5E1c5f0c80bD26Def2d0EA5008C107000d6A",
  },
];

const app = express();

// source control - use previous calculations (json files) to rebuild API or choose db source
const useStaticFiles = true; // toggle using prize api flat file as source
const dbName = "pooltogether"; // toggle db source
const compareApiSources = false;

const allowList = ["::ffff:51.81.32.49"];
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minutes
  max: 50, // Limit each IP to 60  requests per `window` (here, per 1 minutes)

  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: function (req, res /*next*/) {
    console.log("rate limit: ", req.ip);
    return res.status(429).json({
      error: "You sent too many requests. Please wait a while then try again",
    });
  },
  skip: function (request, response) {
    return allowList.includes(request.ip);
  },
});

// add for whitelisting
//  skip: function (request, response) { return allowList.includes(request.ip)}
// skip: (request, response) => allowlist.includes(request.ip),

const privateKey = fs.readFileSync(
  "/etc/letsencrypt/live/poolexplorer.xyz/privkey.pem",
  "utf8"
);
const certificate = fs.readFileSync(
  "/etc/letsencrypt/live/poolexplorer.xyz/cert.pem",
  "utf8"
);
const ca = fs.readFileSync(
  "/etc/letsencrypt/live/poolexplorer.xyz/chain.pem",
  "utf8"
);

const credentials = {
  key: privateKey,
  cert: certificate,
  ca: ca,
};

// Starting both http & https servers
const httpServer = http.createServer(app);
const httpsServer = https.createServer(credentials, app);

httpServer.listen(80, () => {
  console.log("HTTP Server running on port 80");
});

httpsServer.listen(443, () => {
  console.log("HTTPS Server running on port 443");
});

const cn = {
  host: "localhost", // server name or IP address;
  port: 5432,
  database: dbName,
  user: "pooltogether",
  password: process.env.PASSWORD,
};

const db = pgp(cn);

const v5cnFinal = {
  host: "localhost",
  port: 5432,
  database: "v5final",
  user: "pooltogether",
  password: process.env.PASSWORD,
};
const v5dbFinal = pgp(v5cnFinal);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function go() {
  app.use(limiter);
  /*
  let newestDrawId = await getCurrentDraw();
  console.log("current draw ", newestDrawId);
*/
  try {
    await openApi();
  } catch (e) {
    console.log("express error:", e);
  }

  await updateV5();
  await fetchAndUpdateStats(1);
  try {
    await openV5Pooler();
    await openPlayerEndpoints();
  } catch (e) {
    console.log(e);
  }


  // v4 version, todo update for v5
  if (compareApiSources) {
    try {
      let check = await CheckApi();
      publish(check, "/calculations");
    } catch (error) {
      console.log("calculation check failed -> \n", error);
    }
  }

  // set to 40 to run on first go and then wait 40 loops before running again
  let lessFrequentCount = 40;
  while (true) {
    // looping 
    await updateV5();
    await fetchAndUpdateStats(60000);

    if (lessFrequentCount % 40 === 0) {
      try {
        const rewardsV5 = await GetTwabPromotions();
        publish(
          JSON.stringify(rewardsV5),
          "/10-0xe32e5E1c5f0c80bD26Def2d0EA5008C107000d6A-twabrewards"
        );
        console.log("published twab rewards");
      } catch (e) {
        console.log("update twab rewards failed", e);
      }

      try {
        await updateZapper();
      } catch (e) {
        console.log("zapper update failed", e);
      }
    }
    lessFrequentCount += 1;
  }
}


async function updateV5() {
  console.log("updating v5");
  let chainDraws;
  for (let chain of v5Chains) {
    let allDrawsOverview = [];
    let allDrawsOverviewClaims = [];

    chainDraws = await updateV5Chain(chain.id, chain.prizePool);
    allDrawsOverview.push({ chain: chain.id, draws: chainDraws.wins });
    allDrawsOverviewClaims.push({
      chain: chain.id,
      draws: chainDraws.claims.flat(),
    });

    // Determine the path suffix based on whether prizePool is provided
    const pathSuffix = chain.prizePool ? `-${chain.prizePool}` : "";

    await publish(
      JSON.stringify(allDrawsOverview),
      `/draws-${chain.id}${pathSuffix}`
    );
    await publish(
      JSON.stringify(allDrawsOverviewClaims),
      `/claimeddraws-${chain.id}${pathSuffix}`
    );
    console.log(
      `published ${v5Chains.length} chains draws- and claimeddraws- for`,
      pathSuffix
    );
  }

}

async function fetchAndUpdateStats(waitTime) {
  let opPrice = 0;
  let poolPrice = 0;
  let priceResults = {};
  try {

    priceResults = await GeckoPrice(pricesToFetch);

    if (Object.keys(priceResults).length > 0) {
      opPrice = priceResults["optimism"];
      poolPrice = priceResults["pooltogether"];

      await publish(JSON.stringify(priceResults), "/prices");

      console.log(opPrice, " op");
      console.log(poolPrice, " pool");
    } else {
      console.log("No prices fetched from coingecko unfortunately");
    }
  } catch (e) {
    console.log("price fetch bombed", e);
  }

  
  try {
    for (let chain of v5Chains) {
      try {
        // Fetch prizes for each chain and prize pool
        let v5Prizes = await GetPrizes(chain.prizePool, poolToken);
    
        // Update players for each chain and prize pool
        let [v5Players, totalPlayers] = await updateV5Players(chain.id, chain.prizePool);
    
        // Update vaults for each set of players and prize pool
        let v5Vaults = await UpdateV5Vaults(v5Players, chain.prizePool);
    
        // Publish the vaults information
        await publish(v5Vaults, `/${chain.id}-${chain.prizePool}-vaults`);
    
        // Prepare and publish the summary for each chain and prize pool
        const summary = {
          poolers: totalPlayers,
          poolPrice: poolPrice, // Assuming poolPrice is defined earlier in your script
          prizeData: v5Prizes,
        };
    
        await publish(summary, `/${chain.id}-${chain.prizePool}-overview`);
    
      } catch (error) {
        console.error(`Error processing chain ${chain.name} with prize pool ${chain.prizePool}:`, error);
      }
    }
    
    try {
      const leaders = await PrizeLeaderboard();
      await publish(JSON.stringify(leaders), "/prize-leaderboard");
    } catch (e) {
      console.log(e);
    }
    await delay(waitTime);
  } catch (e) {
    console.log("player fetch bombed", e);
  }

  try {
    // POOL holders
    await delay(waitTime);
    await updateHolders(1);
    await delay(waitTime);
    await updateHolders(10);
    await delay(waitTime);
    await updateHolders(137);
    return;
  } catch (error) {
    console.log("error fetch and update stats", error);
  }
}

async function updateZapper() {
  try {
    let lidoResult = await GetLidoApy();
    publish(JSON.stringify(lidoResult), "/lidoApy");
  } catch (e) {
    console.log("failed to get lido apy from llama", e);
  }
  //let zapResult = await GetZapperInfo()
  let zapResult = await GetZapperInfo(
    "0x42cd8312D2BCe04277dD5161832460e95b24262E",
    "ethereum"
  );
  let zapResult137 = await GetZapperInfo(
    "0x3feE50d2888F2F7106fcdC0120295EBA3ae59245",
    "polygon"
  );
  publish(JSON.stringify(zapResult), "/zapper1");
  publish(JSON.stringify(zapResult137), "/zapper137");
}

async function updateHolders(chainNumber) {
  let holdersList = await FetchHolders(chainNumber);
  // todo don't need both
  await publish(holdersList, "/holders" + chainNumber);
  await publish(holdersList, "/holders-" + chainNumber);
  console.log(chainNumber + " updated holdersList");
}

async function updateV5Chain(chainNumber, prizePool) {
  let claims;
  try {
    claims = await PublishV5Claims(chainNumber, prizePool);
    console.log("publishing v5 claims");
  } catch (e) {
    console.log(e);
  }

  const prizeHistory = await PublishV5PrizeHistory(
    chainNumber,
    prizePool,
    v5dbFinal
  );
  await publish(prizeHistory, "/" + chainNumber + "-drawHistory");
  console.log("published draw history for ", prizeHistory.length, " draws");

  const pathSuffix = prizePool === "" ? "" : `-${prizePool}`;
  let v5Winners = await GetWinners(chainNumber, prizePool);
  const v5PrizeResults = await GetPrizeResults(chainNumber);
  await publish(
    v5PrizeResults,
    "/" + chainNumber + pathSuffix + "-prizeresults"
  );
  console.log(
    "published prize results " + chainNumber + pathSuffix + "-prizeresults"
  );
  let draws = [];
  let history = [];
  const bigWinners = [];
  let drawCount = 0;

  for (const drawNumber in v5Winners) {
    draws.push(drawNumber);
    const winnerResults = v5Winners[drawNumber];

    const winnersArray = JSON.stringify(winnerResults);
    await publish(
      winnersArray,
      "/" + chainNumber + pathSuffix + "-draw" + drawNumber
    );
    drawCount++;

    // tally big winners
    const tierValues = winnerResults.tiers[chainNumber];

    winnerResults.wins.forEach((win) => {
      // won prize
      // const vValue = tierValues[win.t] * win.i.length;

      // prize was actually claimed
      const vValue = tierValues[win.t] * win.c.filter(Boolean).length; // Adjusted for claimed indices

      const pPooler = win.p;
      if (vValue) {
        bigWinners.push({ p: pPooler, v: vValue, d: drawNumber });
      }
    });

    // this version is wins only and doesnt include claims
    //    const {indicesWonPerTier,totalValue} =  tallyPrizeResults(chainNumber,winnerResults)
    //
    //history.push({draw:drawNumber,prizeWins:winnerResults.wins.length,indicesWonPerTier:indicesWonPerTier,totalValue:totalValue})

    //account for claims
    const {
      indicesWonPerTier,
      indicesClaimedPerTier,
      totalValue,
      totalValueClaimed,
    } = tallyPrizeResults(chainNumber, winnerResults);
    history.push({
      draw: drawNumber,
      prizeWins: winnerResults.wins.length,
      indicesWonPerTier: indicesWonPerTier,
      indicesClaimedPerTier: indicesClaimedPerTier, // Added this line
      totalValue: totalValue,
      totalValueClaimed: totalValueClaimed, // Added this line
    });
  }
  console.log("chain ", chainNumber, "draws", drawCount, "published");

  // Sorting bigWinners in descending order by 'v' value
  bigWinners.sort((a, b) => b.v - a.v);

  // Keeping only the top 100 winners
  const top100Winners = bigWinners.slice(0, 100);
  await publish(top100Winners, "/bigwinnersv1-" + chainNumber);

  //await publish(history,"/history-"+chainNumber)
  const returnData = { wins: draws, claims: claims };
  // console.log("----------------------------draws", draws);
  // console.log("claims", claims);
  return returnData;
  //  await publish(JSON.stringify(draws),'/testnetdraws')
}

/* this version only does wins, no accounting for claimed
   function tallyPrizeResults(chain,wins) {
    const indicesWonPerTier = {};
    wins.wins.forEach((win) => {
      const tier = win.t;
      const indicesWon = win.i.length;
      if (indicesWonPerTier[tier]) {
        indicesWonPerTier[tier] += indicesWon;
      } else {
        indicesWonPerTier[tier] = indicesWon;
      }
    });

    // Calculate total value summed across all tiers
    let totalValue = 0;
    Object.entries(indicesWonPerTier).forEach(([tier, indicesWon]) => {
      const tierValue = wins.tiers[chain][tier];
      totalValue += tierValue * indicesWon;
    });

    // Log the results
    return {indicesWonPerTier,totalValue}
    console.log("Indices won per tier:", indicesWonPerTier);
    console.log("Total value:", totalValue);
  };*/ /*
function tallyPrizeResults(chain, wins) {
  const indicesWonPerTier = {};
  const indicesClaimedPerTier = {};  // New object for claimed indices

  wins.wins.forEach((win) => {
    const tier = win.t;
    const indicesWon = win.i.length;
    const indicesClaimed = win.c.filter(Boolean).length;  // Count the claimed indices

    if (indicesWonPerTier[tier]) {
      indicesWonPerTier[tier] += indicesWon;
    } else {
      indicesWonPerTier[tier] = indicesWon;
    }

    if (indicesClaimedPerTier[tier]) {
      indicesClaimedPerTier[tier] += indicesClaimed;
    } else {
      indicesClaimedPerTier[tier] = indicesClaimed;
    }
  });

  let totalValue = 0;
  let totalValueClaimed = 0;  // New variable for total claimed value

  Object.entries(indicesWonPerTier).forEach(([tier, indicesWon]) => {
    const tierValue = wins.tiers[chain][tier];
    totalValue += tierValue * indicesWon;
  });

  // totalValueClaimed += win.c.map(Number).reduce((a, b) => a + b, 0);


  return {
    indicesWonPerTier,
    indicesClaimedPerTier,  // Added this line
    totalValue,
    totalValueClaimed      // Added this line
  }
}*/

async function updateV5Players(chainNumber, prizePool = "") {
  const allVaults = await GetPlayers(chainNumber, prizePool);

  const uniqueAddresses = new Set();

  allVaults.forEach((vault) => {
    vault.poolers.forEach((pooler) => {
      uniqueAddresses.add(pooler.address);
    });
  });

  const countUniquePoolers = uniqueAddresses.size;

  let summaryPoolers = [];
  for (let vaultData of allVaults) {
    summaryPoolers.push({
      vault: vaultData.vault,
      poolers: vaultData.poolers.length,
    });

    // Conditionally construct the topic based on prizePool presence
    /*
if (prizePool) {
      topic += "-" + prizePool;
    }*/
    let topic = "/vault-" + vaultData.vault + "-poolers";

    await publish(vaultData.poolers, topic);
  }
  console.log("published /vault -poolers for", allVaults.length, "vaults");

  let summaryTopic = "/" + chainNumber;
  if (prizePool) {
    summaryTopic += "-" + prizePool;
  }
  summaryTopic += "-poolers";

  await publish(summaryPoolers, summaryTopic);
  console.log(
    "published",
    summaryPoolers.length,
    "vaults of poolers for",
    chainNumber
  );
  return [summaryPoolers, countUniquePoolers];
}

function tallyPrizeResults(chain, wins) {
  const indicesWonPerTier = {};

  wins.wins.forEach((win) => {
    const tier = win.t;
    const indicesWon = win.i.length;

    if (indicesWonPerTier[tier]) {
      indicesWonPerTier[tier] += indicesWon;
    } else {
      indicesWonPerTier[tier] = indicesWon;
    }
  });

  let totalValue = 0;
  Object.entries(indicesWonPerTier).forEach(([tier, indicesWon]) => {
    const tierValue = wins.tiers[chain][tier];
    totalValue += tierValue * indicesWon;
  });

  return {
    indicesWonPerTier,
    totalValue,
  };
}

async function openApi() {
  app.use(
    cors({
      origin: "*",
    })
  );
  app.use(compression());
  // lets encrypt
  app.use(express.static(__dirname, { dotfiles: "allow" }));
}

async function publish(json, name) {
  // Check if the route already exists
  if (app._router && app._router.stack) {
    const existingRoute = app._router.stack.find((layer) => {
      return (
        layer.route && layer.route.path === name && layer.route.methods.get
      );
    });
    if (existingRoute) {
      // If the route exists, update its route handler function
      existingRoute.route.stack[0].handle = async (req, res) => {
        try {
          res.send(json);
        } catch (err) {
          throw err;
        }
      };
      return;
    }
  }

  // If the route doesn't exist, create a new route with the specified path
  app.get(name, async (req, res) => {
    try {
      res.send(json);
    } catch (err) {
      throw err;
    }
  });
}

async function openPlayerEndpoints() {
  app.get("/player-wins", async (req, res, next) => {
    if (req.query.address && ethers.utils.isAddress(req.query.address)) {
      let address = req.query.address.toLowerCase();
      let winsQuery = `SELECT network, draw, vault, tier, prizeindices FROM wins WHERE pooler='${address}'`;

      try {
        let wins = await v5dbFinal.any(winsQuery);
        res.send(wins);
      } catch (err) {
        console.error(err);
        next(err);
      }
    } else {
      res.status(400).send("ERROR - Invalid or missing address");
    }
  });

  app.get("/player-claims", async (req, res, next) => {
    if (req.query.address && ethers.utils.isAddress(req.query.address)) {
      let address = req.query.address.toLowerCase();
      let claimsQuery = `SELECT network, hash, draw, vault, tier, index, payout FROM claims WHERE winner='${address}'`;

      try {
        let claims = await v5dbFinal.any(claimsQuery);
        res.send(claims);
      } catch (err) {
        console.error(err);
        next(err);
      }
    } else {
      res.status(400).send("ERROR - Invalid or missing address");
    }
  });
}

async function openV5Pooler() {
  app.get("/poolerVaults", async (req, res, next) => {
    if (
      req.query.address.length < 50 &&
      ethers.utils.isAddress(req.query.address)
    ) {
      let address = req.query.address.toLowerCase();

      // SQL query to get unique vault addresses for a pooler
      let poolerVaultQuery =
        "SELECT DISTINCT vault FROM poolers WHERE pooler='" + address + "'";

      try {
        let vaults = await v5dbFinal.any(poolerVaultQuery);
        res.send(vaults);
      } catch (error) {
        console.error("Database query error: ", error);
        next("ERROR - Unable to fetch data");
      }
    } else {
      next("ERROR - Invalid address");
    }
  });

  app.get("/v5pooler", async (req, res, next) => {
    // var addressInput = sanitizer.value(req.query.address, 'string');

    if (
      req.query.address.length < 50 &&
      ethers.utils.isAddress(req.query.address)
    ) {
      let address = req.query.address;
      address = address.toLowerCase();
      let wins = req.query.wins;
      let claims = req.query.claims;
      // console.log('query for address' + address)
      let addressQuery;
      if (claims === "true") {
        addressQuery =
          "select network,draw,vault,tier,index,payout from " +
          "claims" +
          " where winner='" +
          address +
          "'";
      } else if (wins === "true") {
        addressQuery =
          "select network,draw,vault,tier,index,payout from " +
          "claims" +
          " where winner='" +
          address +
          "'";
      }

      let addressPrizes = await v5dbFinal.any(addressQuery);
      res.send(addressPrizes);
    } else {
      next("ERROR - Invalid address");
    }
  });
}

async function PublishV5Claims(chainNumber, prizePool) {
  const claimsData = await GetClaims(chainNumber, prizePool, v5dbFinal);
  console.log("publishing v5 claims");
  // 1. Publishing claims per draw
  let draws = [];
  const pathSuffix = prizePool === "" ? "" : `-${prizePool}`;
  for (let drawNumber in claimsData) {
    draws.push([drawNumber]);
    const claimUrl = `/claims-${chainNumber}${pathSuffix}-draw${drawNumber}`;
    await publish(claimsData[drawNumber].claimsList, claimUrl);
  }
  console.log(
    "published claims for ",
    claimsData.length,
    " draws on ",
    pathSuffix
  );

  // 2. Finding the biggest winners
  let winnersPayouts = {};
  for (let drawNumber in claimsData) {
    for (let claim of claimsData[drawNumber].claimsList) {
      const winner = claim.w;
      if (!winnersPayouts[winner]) {
        winnersPayouts[winner] = { totalPayout: BigInt(0), draw: drawNumber };
      }
      winnersPayouts[winner].totalPayout += BigInt(claim.p);
    }
  }

  const sortedWinners = Object.entries(winnersPayouts)
    .sort((a, b) => {
      if (b[1].totalPayout > a[1].totalPayout) return 1;
      if (b[1].totalPayout < a[1].totalPayout) return -1;
      return 0;
    })
    .slice(0, 50)
    .map((entry) => ({
      p: entry[0], // address
      v: entry[1].totalPayout.toString(), // payout amount, converted to string
      d: entry[1].draw, // drawnumber
    }));

  await publish(sortedWinners, `/${chainNumber}${pathSuffix}-bigwinners`);

  // 2.5 Finding the biggest win in a single draw across all draws
  let bigWins = [];
  for (let drawNumber in claimsData) {
    let drawWinnersPayouts = {};
    for (let claim of claimsData[drawNumber].claimsList) {
      const winner = claim.w;
      if (!drawWinnersPayouts[winner]) {
        drawWinnersPayouts[winner] = BigInt(0);
      }
      drawWinnersPayouts[winner] += BigInt(claim.p);
    }

    // Find the biggest win in this draw
    let maxPayout = BigInt(0);
    let maxWinner = null;
    for (let winner in drawWinnersPayouts) {
      if (drawWinnersPayouts[winner] > maxPayout) {
        maxPayout = drawWinnersPayouts[winner];
        maxWinner = winner;
      }
    }

    if (maxWinner) {
      bigWins.push({ winner: maxWinner, payout: maxPayout, draw: drawNumber });
    }
  }

  // Sort the big wins and take top 50
  const sortedBigWins = bigWins
    .sort((a, b) => {
      if (b.payout > a.payout) return 1;
      if (b.payout < a.payout) return -1;
      return 0;
    })
    .slice(0, 50)
    .map((entry) => ({
      p: entry.winner, // address
      v: entry.payout.toString(), // payout amount, converted to string
      d: entry.draw, // draw number
    }));

  await publish(sortedBigWins, `/${chainNumber}${pathSuffix}-bigwins`);

  // 3. History of all draws
  let history = [];
  for (let drawNumber in claimsData) {
    const claimsList = claimsData[drawNumber].claimsList;
    const totalClaims = claimsList.length;
    let totalPayout = BigInt(0);
    let totalFees = BigInt(0);
    let uniqueTiers = new Set();
    let uniqueWinners = new Set(); // Create a set to collect unique winners

    for (let claim of claimsList) {
      totalPayout += BigInt(claim.p);
      totalFees += BigInt(claim.f);
      uniqueTiers.add(claim.t);
      uniqueWinners.add(claim.w); // Add the winner address to the set
    }

    history.push({
      draw: drawNumber,
      wins: totalClaims,
      totalPayout: totalPayout.toString(),
      totalFee: totalFees.toString(),
      tiersWon: [...uniqueTiers].sort((a, b) => a - b), // Convert the Set to an array and sort it numerically from low to high
      uniqueWinners: uniqueWinners.size, // Get the size of the set and add to the history
    });
  }

  await publish(history, `/${chainNumber}${pathSuffix}-history`);

  // 4. Aggregating total payouts per draw for each vault
  let vaultTotals = {};
  for (let drawNumber in claimsData) {
    const claimsList = claimsData[drawNumber].claimsList;
    for (let claim of claimsList) {
      const vaultAddress = claim.v;
      if (!vaultTotals[vaultAddress]) {
        vaultTotals[vaultAddress] = {};
      }
      if (!vaultTotals[vaultAddress][drawNumber]) {
        vaultTotals[vaultAddress][drawNumber] = BigInt(0);
      }
      vaultTotals[vaultAddress][drawNumber] += BigInt(claim.p);
    }
  }

  // Convert BigInt to string for JSON serialization
  for (let vaultAddress in vaultTotals) {
    for (let drawNumber in vaultTotals[vaultAddress]) {
      vaultTotals[vaultAddress][drawNumber] = parseFloat(
        ethers.utils.formatUnits(vaultTotals[vaultAddress][drawNumber], 18)
      ).toFixed(4); // POOL formatted
    }
  }

  // Publish the aggregated data
  const vaultTotalsUrl = `/vault-totals-${chainNumber}${
    prizePool ? `-${prizePool}` : ""
  }`;
  await publish(vaultTotals, vaultTotalsUrl);
  console.log("published vault totals for chain", chainNumber, vaultTotalsUrl);

  return draws;
}

go();

// module.exports = {publish}
