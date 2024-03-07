const pgp = require("pg-promise")();
const { dbFinal } = require('./dbConnection.js'); // Ensure this path is correct for your project setup

async function PrizeLeaderboard() {
    try {
        const query = `
            SELECT 
                winner as p, 
                COUNT(DISTINCT draw) AS draws, 
                COUNT(DISTINCT draw || '-' || vault || '-' || CAST(tier AS TEXT)) AS prizes,
                SUM(payout::NUMERIC) AS won
            FROM 
                claims
            GROUP BY 
                p
            ORDER BY 
                won DESC
            LIMIT 
                1000;
        `;

        // Using 'dbFinal' as the database connection object
        const result = await dbFinal.any(query);
        console.log("PrizeLeaderboard query executed successfully, returning ", result.length);
        return result;
    } catch (error) {
        console.error("Error executing PrizeLeaderboard query:", error);
        throw error; // Rethrow or handle error as needed
    }
}

module.exports = PrizeLeaderboard

//PrizeLeaderboard()
