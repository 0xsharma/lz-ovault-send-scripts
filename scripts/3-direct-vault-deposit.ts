#!/usr/bin/env ts-node
/**
 * Direct Vault Deposit (Hub → Hub)
 * 
 * This script deposits assets directly into the vault on the hub chain
 * and receives shares on the same chain. No LayerZero cross-chain messaging involved.
 * 
 * Flow: Hub (Assets) → Hub (Vault Deposit) → Hub (Shares)
 * 
 * Run: ts-node send-scripts/3-direct-vault-deposit.ts
 * Or: node send-scripts/3-direct-vault-deposit.js (if compiled)
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
        assetToken: '0xYourAssetTokenAddress', // The underlying ERC20 asset
    },
    
    // Transaction parameters
    transaction: {
        amount: '1.0',                 // Amount to deposit (human readable)
        recipientAddress: '0xYourRecipientAddressHere', // Will receive shares on hub
        minAmount: undefined as string | undefined, // Optional: custom minimum shares
    },
}

// ============================================
// SCRIPT EXECUTION
// ============================================
async function main() {
    console.log('='.repeat(80))
    console.log('Direct Vault Deposit (Hub → Hub)')
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
    console.log(`Amount: ${CONFIG.transaction.amount} assets`)
    console.log(`Recipient: ${CONFIG.transaction.recipientAddress}`)
    console.log('='.repeat(80))
    
    // Setup provider and wallet
    const provider = new ethers.providers.JsonRpcProvider(CONFIG.hubChain.rpcUrl)
    const wallet = new ethers.Wallet(CONFIG.privateKey, provider)
    
    console.log(`Your wallet: ${wallet.address}`)
    
    // Get vault contract
    const vaultAbi = [
        'function asset() view returns (address)',
        'function previewDeposit(uint256) view returns (uint256)',
        'function deposit(uint256,address) returns (uint256)',
    ]
    const vault = new ethers.Contract(CONFIG.contracts.vault, vaultAbi, wallet)
    
    // Get decimals
    const erc20Abi = [
        'function decimals() view returns (uint8)',
        'function allowance(address,address) view returns (uint256)',
        'function approve(address,uint256) returns (bool)',
        'function balanceOf(address) view returns (uint256)',
    ]
    const assetAddress = await vault.asset()
    const assetToken = new ethers.Contract(assetAddress, erc20Abi, wallet)
    const assetDecimals = await assetToken.decimals()
    const shareToken = new ethers.Contract(CONFIG.contracts.vault, erc20Abi, provider)
    const shareDecimals = await shareToken.decimals()
    
    const inputAmountUnits = parseUnits(CONFIG.transaction.amount, assetDecimals)
    
    // Check balance
    const balance = await assetToken.balanceOf(wallet.address)
    if (balance.lt(inputAmountUnits)) {
        throw new Error(`❌ Insufficient balance. Required: ${CONFIG.transaction.amount}, Available: ${ethers.utils.formatUnits(balance, assetDecimals)}`)
    }
    
    // Preview deposit
    let expectedShares: string
    try {
        const previewedShares = await vault.previewDeposit(inputAmountUnits)
        expectedShares = previewedShares.toString()
        console.log(`📊 Vault preview: ${CONFIG.transaction.amount} assets → ${(parseInt(expectedShares) / 10 ** shareDecimals).toFixed(6)} shares`)
    } catch (error) {
        console.warn(`⚠️  Vault preview failed, proceeding with transaction...`)
        expectedShares = inputAmountUnits.toString()
    }
    
    // Calculate minAmount with slippage
    let minAmountOut = inputAmountUnits
    if (CONFIG.transaction.minAmount) {
        minAmountOut = parseUnits(CONFIG.transaction.minAmount, shareDecimals)
    } else {
        // Apply 0.5% slippage
        const slippageBps = 50
        minAmountOut = ethers.BigNumber.from(expectedShares)
            .mul(10000 - slippageBps)
            .div(10000)
    }
    
    // Check and handle approval
    const currentAllowance = await assetToken.allowance(wallet.address, CONFIG.contracts.vault)
    if (currentAllowance.lt(inputAmountUnits)) {
        console.log(`🔓 Approving vault to spend ${CONFIG.transaction.amount} assets...`)
        const approveTx = await assetToken.approve(CONFIG.contracts.vault, inputAmountUnits)
        await approveTx.wait()
        console.log(`✅ Approval confirmed`)
    } else {
        console.log(`✅ Sufficient allowance already exists`)
    }
    
    // Check slippage
    if (ethers.BigNumber.from(expectedShares).lt(minAmountOut)) {
        throw new Error(`❌ Expected output ${expectedShares} is less than minimum ${minAmountOut.toString()}`)
    }
    
    // Execute deposit
    console.log(`📤 Depositing ${CONFIG.transaction.amount} assets to vault...`)
    const tx = await vault.deposit(inputAmountUnits, CONFIG.transaction.recipientAddress)
    console.log(`⏳ Transaction hash: ${tx.hash}`)
    
    const receipt = await tx.wait()
    console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`)
    
    console.log('='.repeat(80))
    console.log('✅ Direct Vault Deposit Successful!')
    console.log('='.repeat(80))
    console.log(`Transaction Hash: ${receipt.transactionHash}`)
    console.log(`Deposited: ${CONFIG.transaction.amount} assets`)
    console.log(`Expected Shares: ~${(parseInt(expectedShares) / 10 ** shareDecimals).toFixed(6)} shares`)
    console.log(`Recipient: ${CONFIG.transaction.recipientAddress}`)
    console.log('='.repeat(80))
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Error:', error.message)
        process.exit(1)
    })
