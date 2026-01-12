#!/usr/bin/env ts-node
/**
 * Direct Vault Redemption (Hub → Hub)
 * 
 * This script redeems shares directly from the vault on the hub chain
 * and receives assets on the same chain. No LayerZero cross-chain messaging involved.
 * 
 * Flow: Hub (Shares) → Hub (Vault Redeem) → Hub (Assets)
 * 
 * Run: ts-node send-scripts/4-direct-vault-redemption.ts
 * Or: node send-scripts/4-direct-vault-redemption.js (if compiled)
 */

import { ethers } from 'ethers'
import { parseUnits } from 'ethers/lib/utils'

// ============================================
// CONFIGURATION - EDIT THESE VALUES
// ============================================
const CONFIG = {
    // ⚠️ SECURITY: Never commit private keys to git!
    privateKey: 'YOUR_PRIVATE_KEY_HERE',
    
    // Chain configuration
    hubChain: {
        eid: 40231,
        rpcUrl: 'https://arbitrum-sepolia.gateway.tenderly.co',
        name: 'Arbitrum Sepolia',
    },
    
    // Contract addresses on hub
    contracts: {
        vault: '0xYourVaultAddress',
    },
    
    // Transaction parameters
    transaction: {
        amount: '1.0',                 // Amount to redeem (human readable)
        recipientAddress: '0xYourRecipientAddressHere', // Will receive assets on hub
        minAmount: undefined as string | undefined, // Optional: custom minimum assets
    },
}

// ============================================
// SCRIPT EXECUTION
// ============================================
async function main() {
    console.log('='.repeat(80))
    console.log('Direct Vault Redemption (Hub → Hub)')
    console.log('='.repeat(80))
    
    // Validate configuration
    if (CONFIG.privateKey === 'YOUR_PRIVATE_KEY_HERE') {
        throw new Error('❌ Please set CONFIG.privateKey in the script')
    }
    if (CONFIG.transaction.recipientAddress === '0xYourRecipientAddressHere') {
        throw new Error('❌ Please set CONFIG.transaction.recipientAddress in the script')
    }
    if (CONFIG.contracts.vault === '0xYourVaultAddress') {
        throw new Error('❌ Please set contract addresses in CONFIG.contracts')
    }
    
    console.log(`Hub: ${CONFIG.hubChain.name} (EID: ${CONFIG.hubChain.eid})`)
    console.log(`Amount: ${CONFIG.transaction.amount} shares`)
    console.log(`Recipient: ${CONFIG.transaction.recipientAddress}`)
    console.log('='.repeat(80))
    
    // Setup provider and wallet
    const provider = new ethers.providers.JsonRpcProvider(CONFIG.hubChain.rpcUrl)
    const wallet = new ethers.Wallet(CONFIG.privateKey, provider)
    
    console.log(`Your wallet: ${wallet.address}`)
    
    // Get vault contract
    const vaultAbi = [
        'function asset() view returns (address)',
        'function previewRedeem(uint256) view returns (uint256)',
        'function redeem(uint256,address,address) returns (uint256)',
    ]
    const vault = new ethers.Contract(CONFIG.contracts.vault, vaultAbi, wallet)
    
    // Get decimals
    const erc20Abi = [
        'function decimals() view returns (uint8)',
        'function balanceOf(address) view returns (uint256)',
    ]
    const assetAddress = await vault.asset()
    const assetToken = new ethers.Contract(assetAddress, erc20Abi, provider)
    const assetDecimals = await assetToken.decimals()
    const shareToken = new ethers.Contract(CONFIG.contracts.vault, erc20Abi, provider)
    const shareDecimals = await shareToken.decimals()
    
    const inputAmountUnits = parseUnits(CONFIG.transaction.amount, shareDecimals)
    
    // Check balance
    const balance = await shareToken.balanceOf(wallet.address)
    if (balance.lt(inputAmountUnits)) {
        throw new Error(`❌ Insufficient share balance. Required: ${CONFIG.transaction.amount}, Available: ${ethers.utils.formatUnits(balance, shareDecimals)}`)
    }
    
    // Preview redemption
    let expectedAssets: string
    try {
        const previewedAssets = await vault.previewRedeem(inputAmountUnits)
        expectedAssets = previewedAssets.toString()
        console.log(`📊 Vault preview: ${CONFIG.transaction.amount} shares → ${(parseInt(expectedAssets) / 10 ** assetDecimals).toFixed(6)} assets`)
    } catch (error) {
        console.warn(`⚠️  Vault preview failed, proceeding with transaction...`)
        expectedAssets = inputAmountUnits.toString()
    }
    
    // Calculate minAmount with slippage
    let minAmountOut = inputAmountUnits
    if (CONFIG.transaction.minAmount) {
        minAmountOut = parseUnits(CONFIG.transaction.minAmount, assetDecimals)
    } else {
        // Apply 0.5% slippage
        const slippageBps = 50
        minAmountOut = ethers.BigNumber.from(expectedAssets)
            .mul(10000 - slippageBps)
            .div(10000)
    }
    
    // Check slippage
    if (ethers.BigNumber.from(expectedAssets).lt(minAmountOut)) {
        throw new Error(`❌ Expected output ${expectedAssets} is less than minimum ${minAmountOut.toString()}`)
    }
    
    // Execute redeem
    console.log(`📤 Redeeming ${CONFIG.transaction.amount} shares from vault...`)
    const tx = await vault.redeem(inputAmountUnits, CONFIG.transaction.recipientAddress, wallet.address)
    console.log(`⏳ Transaction hash: ${tx.hash}`)
    
    const receipt = await tx.wait()
    console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`)
    
    console.log('='.repeat(80))
    console.log('✅ Direct Vault Redemption Successful!')
    console.log('='.repeat(80))
    console.log(`Transaction Hash: ${receipt.transactionHash}`)
    console.log(`Redeemed: ${CONFIG.transaction.amount} shares`)
    console.log(`Expected Assets: ~${(parseInt(expectedAssets) / 10 ** assetDecimals).toFixed(6)} assets`)
    console.log(`Recipient: ${CONFIG.transaction.recipientAddress}`)
    console.log('='.repeat(80))
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Error:', error.message)
        process.exit(1)
    })
