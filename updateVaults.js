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
   // console.log("trying for contribution of",vaultAddress,"last awarded draw",lastAwardedDrawId)
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




async function updateContributedBetween(vaults, prizePoolContract, lastAwardedDrawId, chainName, chainId, prizePoolAddress) {
  // Fetch 7d prize data
const prizeData = await fetch7dPrizeData(chainId,prizePoolAddress);
 // console.log("prize data",prizeData)
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
ownerInfo = await OwnerInfo(vault.vault,PROVIDERS[chainName])
vault.gnosis = ownerInfo
}catch(e){console.log("error getting vault owner info",e)}


      await setLastUpdateTime(vault.vault);
    }

    updatedVaults.push(vault);
  }

  return updatedVaults;
}






async function fetch7dPrizeData(chainId,prizePoolAddress) {
  try {
    const url = `https://poolexplorer.xyz/vault-totals-${chainId}-${prizePoolAddress}`;
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



async function UpdateV5Vaults(vaults, prizePool, chainName, chainId) {

//console.log("updating vault info")
//console.log(vaults, prizePool, chainName, chainId)
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
// todo multichain coingecko id
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
gnosis = await OwnerInfo(newVault.vault,PROVIDERS[chainName])

}catch(e){console.log("error getting vault owner info",e)}



const contract = new ethers.Contract(newVault.vault, ABI.VAULT, PROVIDERS[chainName]);
try {
  const asset = await contract.asset();
  const name = await contract.name();
  const symbol = await contract.symbol();
  const decimals = await contract.decimals();
  const owner = await contract.owner(); 
  const liquidationPair = await contract.liquidationPair(); 
  const assetContract = new ethers.Contract(asset, ABI.ERC20, PROVIDERS[chainName]);
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

 // console.log('contract add', contractAddresses);

// Step 3: Fetch token prices from CoinGecko
if (contractAddresses.length > 0) {
let geckoPath
  try {
    geckoPath = `https://api.coingecko.com/api/v3/simple/token_price/${chain}`
    const response = await axios.get(geckoPath, {
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
    console.error('Error fetching token prices from CoinGecko:', geckoPath,' for ',contractAddresses.join(','));
  }
}

// Fetch the last awarded draw id once
  let lastAwardedDrawId;
  const prizePoolContract = new ethers.Contract(prizePool, ABI.PRIZEPOOL, PROVIDERS[chainName]);
  try {
    lastAwardedDrawId = await prizePoolContract.getLastAwardedDrawId();
  } catch (error) {
    console.error('Error fetching last awarded draw id:', error);
    return;
  }

  // Update contributedBetween for each vault if more than 24 hours have passed
  const updatedVaults = await updateContributedBetween(existingData, prizePoolContract, lastAwardedDrawId, chainName, chainId, prizePool);


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

  | [
31|go  |   {
31|go  |     vault: '0x8f8484f30f7a72c8059e6bd709f898606e38deda',
31|go  |     poolers: 1205
31|go  |   },
31|go  |   {
31|go  |     vault: '0x383e8d88de4e3999b43c51ca1819516617260e99',
31|go  |     poolers: 1333
31|go  |   },
31|go  |   { vault: '0x1b751a1f3b558173df9832d4564e6b38db7552c6', poolers: 1 }
31|go  | ] 0x5e1b40e4249644a7d7589d1197ad0f1628e79fb1 OPSEPOLIA 11155420
*/
(async () => {
  try {
    const vaults = [
      { vault: '0x383e8d88de4e3999b43c51ca1819516617260e99', poolers: 1333 },
      { vault: '0x8f8484f30f7a72c8059e6bd709f898606e38deda', poolers: 1205 },
      { vault: '0x1b751a1f3b558173df9832d4564e6b38db7552c6', poolers: 1 },
    ];
    const updatedVaults = await UpdateV5Vaults(vaults, '0x31547D3c38F2F8dC92421C54B173F3B27Ab26EbB'.toLowerCase(),"OPSEPOLIA",11155420);
    console.log(updatedVaults);
  } catch (error) {
    console.error('An error occurred:', error);
  }
})();

module.exports = {UpdateV5Vaults}
