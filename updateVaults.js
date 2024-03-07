const ethers = require('ethers');
const fs = require('fs');
const axios = require('axios');
const { ABI } = require('./constants/abi.js');
const { PROVIDERS } = require('./constants/providers.js');
const { OwnerInfo } = require("./functions/getVaultOwner.js")
const updateTimeFile = './data/lastUpdateV5Vaults.json';

const BLACKLIST = ['0x019ff7c88119bffce03cfa163148bc2e051f5905'].map(address => address.toLowerCase());


async function getLastUpdateTime(vault) {
  try {
    const data = JSON.parse(fs.readFileSync(updateTimeFile, 'utf8'));
    return data[vault] || 0;
  } catch (error) {
    return 0;
  }
}

async function setLastUpdateTime(vault) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(updateTimeFile, 'utf8'));
  } catch (error) {
    // File not found or invalid JSON, continue with empty object
  }
  data[vault] = Date.now();
  fs.writeFileSync(updateTimeFile, JSON.stringify(data, null, 2), 'utf8');
}

async function getPrizePoolData(prizePoolContract, vaultAddress, lastAwardedDrawId) {
  try {
    const contributedBetween = await prizePoolContract.getContributedBetween(vaultAddress, lastAwardedDrawId - 6, lastAwardedDrawId);
    return ethers.utils.formatUnits(contributedBetween, 18);
  } catch (error) {
    console.error('Error fetching prize pool data:', error);
    return 0;
  }
}

async function getContributed24h(prizePoolContract, vaultAddress, lastAwardedDrawId) {
  try {
    const contributed24h = await prizePoolContract.getContributedBetween(vaultAddress, lastAwardedDrawId - 1, lastAwardedDrawId);
    return ethers.utils.formatUnits(contributed24h, 18);
  } catch (error) {
    console.error('Error fetching contributed24h data:', error);
    return 0;
  }
}




async function updateContributedBetween(vaults, prizePoolContract, lastAwardedDrawId, prizePoolAddress) {
  // Fetch 7d prize data
const prizeData = await fetch7dPrizeData(prizePoolAddress);
  
  if (!prizeData) {
    console.error('Failed to fetch 7d prize data, returning existing vault data.');
    return vaults; // Return original vaults if fetching prize data fails
  }
  const updatedVaults = [];

  for (const vault of vaults) {
    const lastUpdateTime = await getLastUpdateTime(vault.vault);
    const currentTime = Date.now();

    // Update some stats 4x per day
if (currentTime - lastUpdateTime >= 6 * 60 * 60 * 1000) {
    // update all
  // if(true){
      const contributedBetween = await getPrizePoolData(prizePoolContract, vault.vault, lastAwardedDrawId);
      const contributed24h = await getContributed24h(prizePoolContract, vault.vault, lastAwardedDrawId);
      
      // Only consider prizes from the last 7 draws
      const won7d = getVault7dPrize(prizeData, vault.vault, lastAwardedDrawId);

      vault.contributed7d = contributedBetween;
      vault.contributed24h = contributed24h;
      vault.won7d = won7d; // Add this line to update the won7d value for each vault

      
try {
ownerInfo = await OwnerInfo(vault.vault,PROVIDERS["OPTIMISM"])
vault.gnosis = ownerInfo
}catch(e){console.log("error getting vault owner info",e)}


      await setLastUpdateTime(vault.vault);
    }

    updatedVaults.push(vault);
  }

  return updatedVaults;
}






async function fetch7dPrizeData(prizePoolAddress) {
  try {
    const url = `https://poolexplorer.xyz/vault-totals-10-${prizePoolAddress}`;
console.log("fetching url",url)
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error('Error fetching 7d prize data:', error);
    return null;
  }
}

function getVault7dPrize(prizeData, vaultAddress, lastAwardedDrawId) {
  const vaultPrizes = prizeData[vaultAddress.toLowerCase()];
  if (!vaultPrizes) return '0';

  let totalWon = 0;
  for (let i = lastAwardedDrawId; i > lastAwardedDrawId - 7; i--) {
    const prize = parseFloat(vaultPrizes[i.toString()] || '0');
    totalWon += prize;
  }

  return totalWon.toString();
}



async function UpdateV5Vaults(vaults, prizePool) {
 // Filter out blacklisted vaults
  vaults = vaults.filter(vault => !BLACKLIST.includes(vault.vault.toLowerCase()));


  // Step 1: Read existing data
  let existingData;
  try {
    existingData = JSON.parse(fs.readFileSync('./data/vaults-' + prizePool + '.json', 'utf8'));
  
	// Filter out blacklisted vaults from existingData before processing
    existingData = existingData.filter(vault => !BLACKLIST.includes(vault.vault.toLowerCase()));

  } catch (error) {
    console.error('Error reading from vaults.json:', error);
    existingData = [];
  }
try{
  const chain = 'optimistic-ethereum';
  const contractAddresses = existingData.map(vault => vault.asset); // Initialize with existing asset addresses

  // Step 2: Loop through vaults
  for (const newVault of vaults) {
    const existingVault = existingData.find(v => v.vault.toLowerCase() === newVault.vault.toLowerCase());

    if (existingVault) {
      // Vault exists, update poolers
      existingVault.poolers = newVault.poolers;
    } else {
      // Vault does not exist, fetch name, symbol, and asset address
// vault owner safety
let gnosis 
try {
gnosis = await OwnerInfo(newVault.vault,PROVIDERS["OPTIMISM"])

}catch(e){console.log("error getting vault owner info",e)}



const contract = new ethers.Contract(newVault.vault, ABI.VAULT, PROVIDERS["OPTIMISM"]);
try {
  const asset = await contract.asset();
  const name = await contract.name();
  const symbol = await contract.symbol();
  const decimals = await contract.decimals();
  const owner = await contract.owner(); 
  const liquidationPair = await contract.liquidationPair(); 
  const assetContract = new ethers.Contract(asset, ABI.ERC20, PROVIDERS["OPTIMISM"]);
  const assetSymbol = await assetContract.symbol();
  
  existingData.push({ 
    ...newVault, 
    name, 
    symbol, 
    decimals, 
    asset, 
    owner, 
    liquidationPair,
    assetSymbol,
    gnosis 
  });  contractAddresses.push(asset);
} catch (error) {
  console.error(`Error fetching data for vault ${newVault.vault}:`, error);
}

    }
  }

  console.log('contract add', contractAddresses);

// Step 3: Fetch token prices from CoinGecko
if (contractAddresses.length > 0) {
  try {
    const response = await axios.get(`https://api.coingecko.com/api/v3/simple/token_price/${chain}`, {
      params: {
        contract_addresses: contractAddresses.join(','),
        vs_currencies: 'usd',
      },
    });

    // Update prices in existingData for all vaults with matching asset token
    existingData.forEach((vault) => {
      const address = vault.asset.toLowerCase();
      if (response.data[address]) {
        vault.price = response.data[address].usd || 'Price not available';
      }
    });
  } catch (error) {
    console.error('Error fetching token prices from CoinGecko:', error);
  }
}

// Fetch the last awarded draw id once
  let lastAwardedDrawId;
  const prizePoolContract = new ethers.Contract(prizePool, ABI.PRIZEPOOL, PROVIDERS["OPTIMISM"]);
  try {
    lastAwardedDrawId = await prizePoolContract.getLastAwardedDrawId();
  } catch (error) {
    console.error('Error fetching last awarded draw id:', error);
    return;
  }

  // Update contributedBetween for each vault if more than 24 hours have passed
  const updatedVaults = await updateContributedBetween(existingData, prizePoolContract, lastAwardedDrawId, prizePool);


  // Step 4: Write updated data back to file
  fs.writeFileSync(`./data/vaults-${prizePool}.json`, JSON.stringify(updatedVaults, null, 2), 'utf8');

  // Step 5: Return updated data
  return updatedVaults;

} catch (error) {
    console.error('An error occurred during UpdateV5Vaults:', error);
    return existingData;  // Return existing data as a fallback
  }
}

// Example usage:/
/*
(async () => {
  try {
    const vaults = [
      { vault: '0xe3b3a464ee575e8e25d2508918383b89c832f275', poolers: 160 },
      { vault: '0xce8293f586091d48a0ce761bbf85d5bcaa1b8d2b', poolers: 10 },
      { vault: '0x29cb69d4780b53c1e5cd4d2b817142d2e9890715', poolers: 44 },
    ];
    const updatedVaults = await UpdateV5Vaults(vaults, '0xe32e5E1c5f0c80bD26Def2d0EA5008C107000d6A');
    console.log(updatedVaults);
  } catch (error) {
    console.error('An error occurred:', error);
  }
})();
*/
module.exports = {UpdateV5Vaults}
