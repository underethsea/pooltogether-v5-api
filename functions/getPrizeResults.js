const { dbFinal } = require('./dbConnection');
const fs = require('fs');
const path = require('path');

// Adjust the path to point to the 'data' directory at the root
const cacheFilePath = path.join(__dirname, '..', 'data', 'prizeResultsCache.json');

async function fetchData(chainId, lastDraw) {
    console.log(`Fetching data for chainId: ${chainId}, starting from draw: ${lastDraw}`);
    try {
        const query = `
SELECT
    d.draw,
    w.tier,
    d.tiervalues,
    COALESCE(SUM(CARDINALITY(w.prizeindices)), 0) AS total_wins,
    COALESCE(SUM(c.claim_count), 0) AS total_claims
FROM
    draws d
LEFT JOIN
    wins w ON d.draw = w.draw AND d.network = w.network AND d.network = $1
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) as claim_count
    FROM
        claims
    WHERE
        claims.draw = w.draw AND claims.network = w.network AND claims.tier = w.tier AND claims.vault = w.vault AND claims.winner = w.pooler
) c ON true
WHERE
    d.draw >= $2
GROUP BY
    d.draw, w.tier, d.tiervalues
ORDER BY
    d.draw, w.tier;
        `;
        const result = await dbFinal.any(query, [chainId, lastDraw]);
        return result;
    } catch (err) {
        console.error('Error fetching data:', err);
        return [];
    }
}

async function GetPrizeResults(chainId) {
    const startTime = Date.now();
    console.log("Getting V5 prize results -----------------", startTime);
    let draws = []; // Initialize draws as an array

    try {
        // Attempt to load existing cache
        if (fs.existsSync(cacheFilePath)) {
            console.log("Cache file found. Loading...");
            const cacheContent = fs.readFileSync(cacheFilePath, 'utf8');
            draws = JSON.parse(cacheContent); // Assuming the cache structure is an array
        } else {
            console.log("No cache file found. Starting fresh.");
        }
    } catch (err) {
        console.error("Error reading from cache:", err);
    }

    const lastDraw = draws.length > 0 ? Math.max(...draws.map(d => d.draw)) : 0;

    try {
        const rows = await fetchData(chainId, lastDraw + 1); // Fetch new data starting after the last cached draw

        rows.forEach(row => {
            let drawObj = draws.find(d => d.draw === row.draw);
            if (!drawObj) {
                drawObj = { draw: row.draw, tiers: {} };
                draws.push(drawObj);
            }

            drawObj.tiers[row.tier] = {
                value: row.tiervalues[row.tier].toString(), // Adjust as necessary
                totalWins: row.total_wins.toString(),
                totalClaims: row.total_claims.toString()
            };
        });

        // Sort draws by draw number if necessary
        // draws.sort((a, b) => a.draw - b.draw); // Uncomment if order is important

        fs.writeFileSync(cacheFilePath, JSON.stringify(draws, null, 2));
        console.log("Cache updated. Total draws processed:", draws.length);
    } catch (err) {
        console.error("Error updating draws:", err);
    }

    const endTime = Date.now();
    console.log(`Operation completed. Total time: ${endTime - startTime}ms`);
    return draws; // Ensure all data is returned
}

module.exports = { GetPrizeResults };

// Example usage
//GetPrizeResults(10);
