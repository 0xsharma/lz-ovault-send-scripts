#!/usr/bin/env ts-node
/**
 * Send Shares from Hub to Spoke Chain
 * 
 * This script sends shares from the hub chain to a spoke chain using LayerZero OFT.
 * No vault interaction - just a direct cross-chain transfer.
 * 
 * Flow: Hub (Shares) → Spoke Chain (Shares)
 * 
 * Run: ts-node send-scripts/6-hub-to-spoke-shares.ts
 * Or: node send-scripts/6-hub-to-spoke-shares.js (if compiled)
 */

import { ethers } from 'ethers'
import { parseUnits } from 'ethers/lib/utils'
import { Options, addressToBytes32 } from '@layerzerolabs/lz-v2-utilities'

// ============================================
// CONFIGURATION - EDIT THESE VALUES
// ============================================
const CONFIG = {
    // ⚠️ SECURITY: Never commit private keys to git!
    privateKey: 'YOUR_PRIVATE_KEY_HERE',
    
    // Chain configuration
    chains: {
        arbitrumSepolia: {
            eid: 40231,
            rpcUrl: 'https://arbitrum-sepolia.gateway.tenderly.co',
            name: 'Arbitrum Sepolia',
        },
        optimismSepolia: {
            eid: 40232,
            rpcUrl: 'https://optimism-sepolia.gateway.tenderly.co',
            name: 'Optimism Sepolia',
        },
        baseSepolia: {
            eid: 40245,
            rpcUrl: 'https://base-sepolia.gateway.tenderly.co',
            name: 'Base Sepolia',
        },
    },
    
    // Contract addresses
    contracts: {
        // Hub chain share OFT (Arbitrum Sepolia in this example)
        hubShareOFT: '0xYourShareOFTOnHubAddress', // This is the ShareOFTAdapter
    },
    
    // Transaction parameters
    transaction: {
        srcChain: 'arbitrumSepolia',   // Hub chain (source)
        dstChain: 'optimismSepolia',   // Destination spoke chain
        amount: '1.0',                 // Amount to send (human readable)
        recipientAddress: '0xYourRecipientAddressHere', // Will receive shares on destination
        minAmount: undefined as string | undefined, // Optional: custom minimum amount
        lzReceiveGas: 100000,          // Gas for lzReceive on destination
    },
}

// ============================================
// SCRIPT EXECUTION
// ============================================
async function main() {
    console.log('='.repeat(80))
    console.log('Send Shares (Hub → Spoke)')
    console.log('='.repeat(80))
    
    // Validate configuration
    if (CONFIG.privateKey === 'YOUR_PRIVATE_KEY_HERE') {
        throw new Error('❌ Please set CONFIG.privateKey in the script')
    }
    if (CONFIG.transaction.recipientAddress === '0xYourRecipientAddressHere') {
        throw new Error('❌ Please set CONFIG.transaction.recipientAddress in the script')
    }
    if (CONFIG.contracts.hubShareOFT === '0xYourShareOFTOnHubAddress') {
        throw new Error('❌ Please set CONFIG.contracts.hubShareOFT')
    }
    
    const srcChainConfig = CONFIG.chains[CONFIG.transaction.srcChain]
    const dstChainConfig = CONFIG.chains[CONFIG.transaction.dstChain]
    
    console.log(`Source (Hub): ${srcChainConfig.name} (EID: ${srcChainConfig.eid})`)
    console.log(`Destination: ${dstChainConfig.name} (EID: ${dstChainConfig.eid})`)
    console.log(`Amount: ${CONFIG.transaction.amount} shares`)
    console.log(`Recipient: ${CONFIG.transaction.recipientAddress}`)
    console.log('='.repeat(80))
    
    // Setup provider and wallet
    const provider = new ethers.providers.JsonRpcProvider(srcChainConfig.rpcUrl)
    const wallet = new ethers.Wallet(CONFIG.privateKey, provider)
    
    console.log(`Your wallet: ${wallet.address}`)
    
    // Get share OFT contract (this is actually the vault/adapter on hub)
    const oftAbi = [
        'function quoteSend((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),bool) view returns ((uint256,uint256))',
        'function send((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),(uint256,uint256),address) payable returns ((bytes32,uint64))',
    ]
    const oft = new ethers.Contract(CONFIG.contracts.hubShareOFT, oftAbi, wallet)
    
    // Get decimals (shares use vault decimals)
    const erc20Abi = ['function decimals() view returns (uint8)']
    const shareToken = new ethers.Contract(CONFIG.contracts.hubShareOFT, erc20Abi, provider)
    const decimals = await shareToken.decimals()
    
    const amountUnits = parseUnits(CONFIG.transaction.amount, decimals)
    
    // Calculate min amount with slippage
    const slippageBps = 50 // 0.5%
    const minAmount = CONFIG.transaction.minAmount
        ? parseUnits(CONFIG.transaction.minAmount, decimals)
        : amountUnits.mul(10000 - slippageBps).div(10000)
    
    // Build options
    const options = Options.newOptions().addExecutorLzReceiveOption(CONFIG.transaction.lzReceiveGas, 0)
    
    // Build SendParam
    const sendParam = {
        dstEid: dstChainConfig.eid,
        to: addressToBytes32(CONFIG.transaction.recipientAddress),
        amountLD: amountUnits,
        minAmountLD: minAmount,
        extraOptions: options.toHex(),
        composeMsg: '0x',
        oftCmd: '0x',
    }
    
    // Quote the transaction
    console.log(`💭 Quoting transaction...`)
    const msgFee = await oft.quoteSend(sendParam, false)
    console.log(`💰 LayerZero fee: ${(parseInt(msgFee.nativeFee.toString()) / 1e18).toFixed(6)} ETH`)
    
    // Send the transaction (shares are always ERC20, never native)
    console.log(`📤 Sending transaction...`)
    const tx = await oft.send(sendParam, msgFee, wallet.address, { value: msgFee.nativeFee })
    console.log(`⏳ Transaction hash: ${tx.hash}`)
    
    const receipt = await tx.wait()
    console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`)
    
    console.log('='.repeat(80))
    console.log('✅ Share Transfer Transaction Sent!')
    console.log('='.repeat(80))
    console.log(`Transaction Hash: ${receipt.transactionHash}`)
    console.log(`LayerZero Scan: https://testnet.layerzeroscan.com/tx/${receipt.transactionHash}`)
    console.log('='.repeat(80))
    console.log(`Flow: ${CONFIG.transaction.amount} shares (${srcChainConfig.name}) → (${dstChainConfig.name})`)
    console.log('='.repeat(80))
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Error:', error.message)
        process.exit(1)
    })
