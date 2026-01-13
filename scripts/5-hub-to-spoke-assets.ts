#!/usr/bin/env ts-node
/**
 * Send Assets from Hub to Spoke Chain
 * 
 * This script sends assets from the hub chain to a spoke chain using LayerZero OFT.
 * No vault interaction - just a direct cross-chain transfer.
 * 
 * Flow: Hub (Assets) → Spoke Chain (Assets)
 * 
 * Run: ts-node send-scripts/5-hub-to-spoke-assets.ts
 * Or: node send-scripts/5-hub-to-spoke-assets.js (if compiled)
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
        // Hub chain asset OFT (Arbitrum Sepolia in this example)
        hubAssetOFT: '0xYourAssetOFTOnHubAddress',
    },
    
    // Transaction parameters
    transaction: {
        srcChain: 'arbitrumSepolia',   // Hub chain (source)
        dstChain: 'baseSepolia',       // Destination spoke chain
        amount: '1.0',                 // Amount to send (human readable)
        recipientAddress: '0xYourRecipientAddressHere', // Will receive assets on destination
        minAmount: undefined as string | undefined, // Optional: custom minimum amount
        lzReceiveGas: 100000,          // Gas for lzReceive on destination
    },
}

// ============================================
// SCRIPT EXECUTION
// ============================================
async function main() {
    console.log('='.repeat(80))
    console.log('Send Assets (Hub → Spoke)')
    console.log('='.repeat(80))
    
    // Validate configuration
    if (CONFIG.privateKey === 'YOUR_PRIVATE_KEY_HERE') {
        throw new Error('❌ Please set CONFIG.privateKey in the script')
    }
    if (CONFIG.transaction.recipientAddress === '0xYourRecipientAddressHere') {
        throw new Error('❌ Please set CONFIG.transaction.recipientAddress in the script')
    }
    if (CONFIG.contracts.hubAssetOFT === '0xYourAssetOFTOnHubAddress') {
        throw new Error('❌ Please set CONFIG.contracts.hubAssetOFT')
    }
    
    const srcChainConfig = CONFIG.chains[CONFIG.transaction.srcChain as keyof typeof CONFIG.chains]
    const dstChainConfig = CONFIG.chains[CONFIG.transaction.dstChain as keyof typeof CONFIG.chains]
    
    console.log(`Source (Hub): ${srcChainConfig.name} (EID: ${srcChainConfig.eid})`)
    console.log(`Destination: ${dstChainConfig.name} (EID: ${dstChainConfig.eid})`)
    console.log(`Amount: ${CONFIG.transaction.amount} assets`)
    console.log(`Recipient: ${CONFIG.transaction.recipientAddress}`)
    console.log('='.repeat(80))
    
    // Setup provider and wallet
    const provider = new ethers.providers.JsonRpcProvider(srcChainConfig.rpcUrl)
    const wallet = new ethers.Wallet(CONFIG.privateKey, provider)
    
    console.log(`Your wallet: ${wallet.address}`)
    
    // Get OFT contract
    const oftAbi = [
        'function token() view returns (address)',
        'function quoteSend((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),bool) view returns ((uint256,uint256))',
        'function send((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),(uint256,uint256),address) payable returns ((bytes32,uint64))',
        'function approvalRequired() view returns (bool)',
    ]
    const oft = new ethers.Contract(CONFIG.contracts.hubAssetOFT, oftAbi, wallet)
    
    // Check if asset is native or ERC20
    const underlyingToken = await oft.token()
    const isNativeToken = underlyingToken === ethers.constants.AddressZero
    
    // Get decimals
    const erc20Abi = [
        'function decimals() view returns (uint8)',
        'function allowance(address,address) view returns (uint256)',
        'function approve(address,uint256) returns (bool)',
    ]
    let decimals: number
    if (isNativeToken) {
        decimals = 18
        console.log(`ℹ️  Native token detected, using 18 decimals`)
    } else {
        const token = new ethers.Contract(underlyingToken, erc20Abi, provider)
        decimals = await token.decimals()
    }
    
    const amountUnits = parseUnits(CONFIG.transaction.amount, decimals)
    
    // Handle approval for ERC20 tokens
    if (!isNativeToken) {
        try {
            const approvalRequired = await oft.approvalRequired()
            if (approvalRequired) {
                console.log(`🔒 Checking ERC20 allowance...`)
                const token = new ethers.Contract(underlyingToken, erc20Abi, wallet)
                const currentAllowance = await token.allowance(wallet.address, CONFIG.contracts.hubAssetOFT)
                
                if (currentAllowance.lt(amountUnits)) {
                    console.log(`🔓 Approving ERC20 tokens...`)
                    const approveTx = await token.approve(CONFIG.contracts.hubAssetOFT, amountUnits)
                    await approveTx.wait()
                    console.log(`✅ Approval confirmed`)
                }
            }
        } catch {
            console.log(`ℹ️  No approval required`)
        }
    }
    
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
        amountLD: ethers.BigNumber.from(amountUnits),
        minAmountLD: ethers.BigNumber.from(minAmount),
        extraOptions: options.toHex(),
        composeMsg: '0x',
        oftCmd: '0x',
    }
    
    // Quote the transaction
    console.log(`💭 Quoting transaction...`)
    const msgFeeResult = await oft.quoteSend(
        [
            sendParam.dstEid,
            sendParam.to,
            sendParam.amountLD,
            sendParam.minAmountLD,
            sendParam.extraOptions,
            sendParam.composeMsg,
            sendParam.oftCmd,
        ],
        false
    )
    const msgFee = { nativeFee: msgFeeResult[0], lzTokenFee: msgFeeResult[1] }
    console.log(`💰 LayerZero fee: ${(parseInt(msgFee.nativeFee.toString()) / 1e18).toFixed(6)} ETH`)
    
    // Send the transaction
    const txValue = isNativeToken ? msgFee.nativeFee.add(amountUnits) : msgFee.nativeFee
    
    console.log(`📤 Sending transaction...`)
    const tx = await oft.send(
        [
            sendParam.dstEid,
            sendParam.to,
            sendParam.amountLD,
            sendParam.minAmountLD,
            sendParam.extraOptions,
            sendParam.composeMsg,
            sendParam.oftCmd,
        ],
        [msgFee.nativeFee, msgFee.lzTokenFee],
        wallet.address,
        { value: txValue }
    )
    console.log(`⏳ Transaction hash: ${tx.hash}`)
    
    const receipt = await tx.wait()
    console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`)
    
    console.log('='.repeat(80))
    console.log('✅ Asset Transfer Transaction Sent!')
    console.log('='.repeat(80))
    console.log(`Transaction Hash: ${receipt.transactionHash}`)
    console.log(`LayerZero Scan: https://layerzeroscan.com/tx/${receipt.transactionHash}`)
    console.log('='.repeat(80))
    console.log(`Flow: ${CONFIG.transaction.amount} assets (${srcChainConfig.name}) → (${dstChainConfig.name})`)
    console.log('='.repeat(80))
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Error:', error.message)
        process.exit(1)
    })
