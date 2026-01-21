# OVault Send Scripts

10 standalone scripts for all OVault cross-chain operations. Each script is self-contained with inline configuration.

## Setup

```bash
npm install
```

## Scripts Overview

| # | Script | Flow |
|---|--------|------|
| 1 | `scripts/1-asset-deposit-cross-chain.ts` | Spoke (Assets) → Hub (Vault) → Spoke (Shares) |
| 2 | `scripts/2-share-redemption-cross-chain.ts` | Spoke (Shares) → Hub (Vault) → Spoke (Assets) |
| 3 | `scripts/3-direct-vault-deposit.ts` | Hub (Assets) → Hub (Vault) → Hub (Shares) |
| 4 | `scripts/4-direct-vault-redemption.ts` | Hub (Shares) → Hub (Vault) → Hub (Assets) |
| 5 | `scripts/5-hub-to-spoke-assets.ts` | Hub (Assets) → Spoke (Assets) |
| 6 | `scripts/6-hub-to-spoke-shares.ts` | Hub (Shares) → Spoke (Shares) |
| 7 | `scripts/7-spoke-to-hub-deposit.ts` | Spoke (Assets) → Hub (Vault) → Hub (Shares) |
| 8 | `scripts/8-spoke-to-hub-redemption.ts` | Spoke (Shares) → Hub (Vault) → Hub (Assets) |
| 9 | `scripts/9-simple-base-to-eth.ts` | Base (USDC) → Ethereum (USDC via Stargate) |
| 10 | `scripts/10-eth-deposit-to-katana.ts` | Ethereum (USDC) → Vault → Katana (Shares via Composer) |

## Quick Start

### 1. Configure

Open any script and edit the `CONFIG` object:

```typescript
const CONFIG = {
    // ⚠️ SECURITY: Never commit private keys to git!
    privateKey: 'YOUR_PRIVATE_KEY_HERE',

    // Chain configuration with RPC URLs
    chains: {
        arbitrumSepolia: {
            eid: 40231,
            rpcUrl: 'https://arbitrum-sepolia.gateway.tenderly.co',
            name: 'Arbitrum Sepolia',
        },
        // ... more chains
    },

    // Contract addresses (from your deployment)
    contracts: {
        hub: {
            vault: '0xYourVaultAddress',
            composer: '0xYourOVaultComposerAddress',
            assetOFT: '0xYourAssetOFTAddress',
            shareOFT: '0xYourShareOFTAddress',
        },
        source: {
            assetOFT: '0xSourceAssetOFTAddress',
        },
        destination: {
            shareOFT: '0xDestShareOFTAddress',
        },
    },

    // Transaction parameters
    transaction: {
        srcChain: 'baseSepolia',
        dstChain: 'optimismSepolia',
        hubChain: 'arbitrumSepolia',
        amount: '1.0',
        recipientAddress: '0xYourAddress',
        lzComposeGas: 395000,
    },
}
```

### 2. Run

```bash
# Using npm scripts
npm run 1                    # Asset deposit cross-chain
npm run 2                    # Share redemption cross-chain
npm run 3                    # Direct vault deposit
npm run 4                    # Direct vault redemption
npm run 5                    # Hub to spoke assets
npm run 6                    # Hub to spoke shares
npm run 7                    # Spoke to hub deposit
npm run 8                    # Spoke to hub redemption
npm run 9                    # Base to Ethereum USDC (Stargate)
npm run 10                   # Ethereum to Katana shares (Composer)

# Or directly with ts-node
npx ts-node scripts/1-asset-deposit-cross-chain.ts
```

## Configuration Reference

### Required Fields

Must be updated from defaults:
- `privateKey` - Your wallet's private key
- `recipientAddress` - Where to receive tokens
- All contract addresses (`vault`, `composer`, `assetOFT`, `shareOFT`)

### Chain Configuration

Default testnet chains:
- **Arbitrum Sepolia** - EID 40231 (typical hub)
- **Optimism Sepolia** - EID 40232
- **Base Sepolia** - EID 40245

### Optional Parameters

- `minAmount` - Custom minimum amount (default: 0.5% slippage)
- `lzReceiveGas` - Gas for lzReceive (default: 100000)
- `lzComposeGas` - Gas for compose operations (175000-395000)
- `lzComposeValue` - Value for second hop (auto-quoted if undefined)

## Common Workflows

### Cross-Chain Deposit
Deposit assets from Base, receive shares on Optimism:
```bash
# Edit scripts/1-asset-deposit-cross-chain.ts
npm run 1
```

### Cross-Chain Redemption
Redeem shares from Optimism, receive assets on Base:
```bash
# Edit scripts/2-share-redemption-cross-chain.ts
npm run 2
```

### Hub-Only Operations
Direct vault interaction on hub (no cross-chain):
```bash
npm run 3  # Deposit
npm run 4  # Redeem
```

### Token Bridging
Bridge tokens between chains without vault:
```bash
npm run 5  # Assets hub→spoke
npm run 6  # Shares hub→spoke
```

### Centralized Liquidity
Collect assets to hub or distribute from hub:
```bash
npm run 7  # Deposit from spoke, keep shares on hub
npm run 8  # Redeem from spoke, keep assets on hub
```

## Getting Contract Addresses

After deploying OVault, get addresses from:

```bash
# From deployments directory
cat ../deployments/arbitrum-sepolia/MyERC4626.json | jq -r '.address'
cat ../deployments/arbitrum-sepolia/MyOVaultComposer.json | jq -r '.address'
```

Or check your deployment logs.

## Troubleshooting

| Error | Solution |
|-------|----------|
| "Please set CONFIG.privateKey" | Replace `'YOUR_PRIVATE_KEY_HERE'` with your key |
| "Please set contract addresses" | Update all `'0xYour...Address'` placeholders |
| "Insufficient balance" | Ensure wallet has tokens + gas on source chain |
| Out of gas | Increase `lzComposeGas` (try 500000) |
| Quote failed | Script uses safe default, or set `lzComposeValue` manually |

## Script Selection Guide

**Need vault interaction?**
- No → Scripts 5, 6 (simple bridging)
- Yes, on hub only → Scripts 3, 4 (direct vault)
- Yes, source is spoke, destination is hub → Scripts 7, 8
- Yes, source is spoke, destination is spoke → Scripts 1, 2

**Examples:**
- Deposit Base → Optimism: Script 1
- Redeem Optimism → Base: Script 2
- Deposit on hub: Script 3
- Redeem on hub: Script 4
- Bridge assets hub → Base: Script 5
- Bridge shares hub → Optimism: Script 6
- Deposit Base → hub (keep shares): Script 7
- Redeem Optimism → hub (keep assets): Script 8
- Send USDC Base → Ethereum: Script 9
- Deposit USDC on Ethereum, send shares to Katana: Script 10

## Gas Settings

- **Direct operations** (hub only): `lzComposeGas: 175000`
- **Cross-chain operations**: `lzComposeGas: 395000`
- **Complex vaults**: Increase to 500000+

## Base to Katana Flow

For sending USDC from Base to Katana through Ethereum vault, use a two-step approach:

### Step 1: Base → Ethereum (Script 9)
Transfer USDC from Base to Ethereum using Stargate:
```bash
npm run 9
```

**Configuration:**
- Set `amount` (USDC amount to send)
- Set `recipientAddress` (your wallet on Ethereum)
- Requires: USDC on Base, ETH on Base for gas

### Step 2: Ethereum → Katana (Script 10)
Deposit USDC into vault and send shares to Katana atomically:
```bash
npm run 10
```

**Configuration:**
- Set `amount` (USDC amount to deposit)
- Set `recipientAddress` (recipient on Katana)
- Requires: USDC on Ethereum (from step 1), ETH on Ethereum for gas

**Total:** 4 transactions (2 approvals + 2 operations) across 2 chains

## Support

- LayerZero Docs: https://docs.layerzero.network/
- Ethers.js Docs: https://docs.ethers.org/

---
