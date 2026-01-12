#!/usr/bin/env ts-node
/**
 * Asset Deposit (Any Chain → Any Other Chain)
 * 
 * This script sends assets from any spoke chain to any other chain (including hub),
 * deposits them into the vault on the hub, and sends the resulting shares to the destination chain.
 * 
 * Flow: Source Chain (Assets) → Hub (Vault Deposit) → Destination Chain (Shares)
 * 
 * Run: ts-node send-scripts/1-asset-deposit-cross-chain.ts
 * Or: node send-scripts/1-asset-deposit-cross-chain.js (if compiled)
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
        // Hub chain addresses (Arbitrum Sepolia in this example)
        hub: {
            vault: '0xYourVaultAddress',
            composer: '0xYourOVaultComposerAddress',
            assetOFT: '0xYourAssetOFTOnHubAddress',
            shareOFT: '0xYourShareOFTOnHubAddress', // This is the ShareOFTAdapter
        },
        // Source chain addresses (Base Sepolia in this example)
        source: {
            assetOFT: '0xYourAssetOFTOnSourceAddress',
        },
        // Destination chain addresses (Optimism Sepolia in this example)
        destination: {
            shareOFT: '0xYourShareOFTOnDestinationAddress',
        },
    },

    // Transaction parameters
    transaction: {
        srcChain: 'baseSepolia',       // Source chain where you have assets
        dstChain: 'optimismSepolia',   // Destination chain where you want shares
        hubChain: 'arbitrumSepolia',   // Hub chain where vault is deployed
        amount: '1.0',                 // Amount to send (human readable)
        recipientAddress: '0xYourRecipientAddressHere', // Will receive shares on destination
        minAmount: undefined as string | undefined, // Optional: custom minimum amount
        lzComposeGas: 395000,          // Gas for vault + cross-chain operations
        lzComposeValue: undefined as string | undefined, // Auto-quoted if undefined
    },
}

// ============================================
// SCRIPT EXECUTION
// ============================================
async function main() {
    console.log('='.repeat(80))
    console.log('Asset Deposit (Cross-Chain)')
    console.log('='.repeat(80))

    // Validate configuration
    if (CONFIG.privateKey === 'YOUR_PRIVATE_KEY_HERE') {
        throw new Error('❌ Please set CONFIG.privateKey in the script')
    }
    if (CONFIG.transaction.recipientAddress === '0xYourRecipientAddressHere') {
        throw new Error('❌ Please set CONFIG.transaction.recipientAddress in the script')
    }
    if (CONFIG.contracts.hub.composer === '0xYourOVaultComposerAddress') {
        throw new Error('❌ Please set contract addresses in CONFIG.contracts')
    }

    const srcChainConfig = CONFIG.chains[CONFIG.transaction.srcChain]
    const dstChainConfig = CONFIG.chains[CONFIG.transaction.dstChain]
    const hubChainConfig = CONFIG.chains[CONFIG.transaction.hubChain]

    if (CONFIG.transaction.srcChain === CONFIG.transaction.hubChain) {
        throw new Error('❌ Source chain cannot be hub chain. Use "3-direct-vault-deposit.ts" for hub→hub operations')
    }

    console.log(`Source: ${srcChainConfig.name} (EID: ${srcChainConfig.eid})`)
    console.log(`Hub: ${hubChainConfig.name} (EID: ${hubChainConfig.eid})`)
    console.log(`Destination: ${dstChainConfig.name} (EID: ${dstChainConfig.eid})`)
    console.log(`Amount: ${CONFIG.transaction.amount} assets`)
    console.log(`Recipient: ${CONFIG.transaction.recipientAddress}`)
    console.log('='.repeat(80))

    // Setup providers and wallets
    const srcProvider = new ethers.providers.JsonRpcProvider(srcChainConfig.rpcUrl)
    const hubProvider = new ethers.providers.JsonRpcProvider(hubChainConfig.rpcUrl)
    const srcWallet = new ethers.Wallet(CONFIG.privateKey, srcProvider)
    const hubWallet = new ethers.Wallet(CONFIG.privateKey, hubProvider)

    console.log(`Your wallet: ${srcWallet.address}`)

    // Get vault contract on hub to preview operations
    const vaultAbi = ['function asset() view returns (address)', 'function previewDeposit(uint256) view returns (uint256)']
    const vault = new ethers.Contract(CONFIG.contracts.hub.vault, vaultAbi, hubProvider)

    // Get decimals
    const erc20Abi = ['function decimals() view returns (uint8)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']
    const assetAddress = await vault.asset()
    const assetToken = new ethers.Contract(assetAddress, erc20Abi, hubProvider)
    const assetDecimals = await assetToken.decimals()
    const shareToken = new ethers.Contract(CONFIG.contracts.hub.vault, erc20Abi, hubProvider)
    const shareDecimals = await shareToken.decimals()

    const inputAmountUnits = parseUnits(CONFIG.transaction.amount, assetDecimals)

    // Preview vault deposit
    let expectedOutputAmount: string
    try {
        const previewedShares = await vault.previewDeposit(inputAmountUnits)
        expectedOutputAmount = previewedShares.toString()
        console.log(`📊 Vault preview: ${CONFIG.transaction.amount} assets → ${(parseInt(expectedOutputAmount) / 10 ** shareDecimals).toFixed(6)} shares`)
    } catch (error) {
        console.warn(`⚠️  Vault preview failed, using 1:1 estimate`)
        expectedOutputAmount = inputAmountUnits.toString()
    }

    // Calculate minAmount with slippage
    let minAmountOut: string
    if (CONFIG.transaction.minAmount) {
        minAmountOut = parseUnits(CONFIG.transaction.minAmount, shareDecimals).toString()
    } else {
        const slippageBps = 50 // 0.5%
        minAmountOut = ethers.BigNumber.from(expectedOutputAmount)
            .mul(10000 - slippageBps)
            .div(10000)
            .toString()
    }

    // Build second hop SendParam (hub → destination)
    const secondHopSendParam = {
        dstEid: dstChainConfig.eid,
        to: addressToBytes32(CONFIG.transaction.recipientAddress),
        amountLD: expectedOutputAmount,
        minAmountLD: minAmountOut,
        extraOptions: Options.newOptions().addExecutorLzReceiveOption(100000, 0).toHex(),
        composeMsg: '0x',
        oftCmd: '0x',
    }

    // Quote second hop
    let lzComposeValue = CONFIG.transaction.lzComposeValue || '0'

    if (!CONFIG.transaction.lzComposeValue && dstChainConfig.eid !== hubChainConfig.eid) {
        const oftAbi = ['function quoteSend((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),bool) view returns ((uint256,uint256))']
        const shareOFT = new ethers.Contract(CONFIG.contracts.hub.shareOFT, oftAbi, hubProvider)

        try {
            const quoteFee = await shareOFT.quoteSend(secondHopSendParam, false)
            lzComposeValue = quoteFee.nativeFee.toString()
            console.log(`💰 Quoted second hop fee: ${(parseInt(lzComposeValue) / 1e18).toFixed(6)} ETH`)
        } catch (error) {
            console.warn(`⚠️  Quote failed, using default: 0.025 ETH`)
            lzComposeValue = '25000000000000000'
        }
    }

    if (dstChainConfig.eid === hubChainConfig.eid) {
        lzComposeValue = '0'
        console.log(`ℹ️  Destination is hub - no second hop needed`)
    }

    // Encode composeMsg
    const composeMsg = ethers.utils.defaultAbiCoder.encode(
        ['tuple(uint32,bytes32,uint256,uint256,bytes,bytes,bytes)', 'uint256'],
        [
            [
                secondHopSendParam.dstEid,
                secondHopSendParam.to,
                secondHopSendParam.amountLD,
                secondHopSendParam.minAmountLD,
                secondHopSendParam.extraOptions,
                secondHopSendParam.composeMsg,
                secondHopSendParam.oftCmd,
            ],
            lzComposeValue,
        ]
    )

    // Build options for first hop
    let options = Options.newOptions()
    options = options.addExecutorLzComposeOption(0, CONFIG.transaction.lzComposeGas, lzComposeValue)
    const extraOptions = options.toHex()

    // Calculate first hop min amount with slippage
    const slippageBps = 50 // 0.5%
    const firstHopMinAmount = parseUnits(
        CONFIG.transaction.minAmount || (parseFloat(CONFIG.transaction.amount) * (1 - slippageBps / 10000)).toString(),
        assetDecimals
    )

    // Build SendParam for first hop
    const sendParam = {
        dstEid: hubChainConfig.eid,
        to: addressToBytes32(CONFIG.contracts.hub.composer),
        amountLD: inputAmountUnits,
        minAmountLD: firstHopMinAmount,
        extraOptions: extraOptions,
        composeMsg: composeMsg,
        oftCmd: '0x',
    }

    // Get source asset OFT contract
    const srcOFTAbi = [
        'function token() view returns (address)',
        'function quoteSend((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),bool) view returns ((uint256,uint256))',
        'function send((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),(uint256,uint256),address) payable returns ((bytes32,uint64))',
        'function approvalRequired() view returns (bool)',
    ]
    const srcOFT = new ethers.Contract(CONFIG.contracts.source.assetOFT, srcOFTAbi, srcWallet)

    // Check if asset is native or ERC20
    const underlyingToken = await srcOFT.token()
    const isNativeToken = underlyingToken === ethers.constants.AddressZero

    // Handle approval for ERC20 tokens
    if (!isNativeToken) {
        try {
            const approvalRequired = await srcOFT.approvalRequired()
            if (approvalRequired) {
                console.log(`🔒 Checking ERC20 allowance...`)
                const erc20 = new ethers.Contract(underlyingToken, erc20Abi, srcWallet)
                const currentAllowance = await erc20.allowance(srcWallet.address, CONFIG.contracts.source.assetOFT)

                if (currentAllowance.lt(inputAmountUnits)) {
                    console.log(`🔓 Approving ERC20 tokens...`)
                    const approveTx = await erc20.approve(CONFIG.contracts.source.assetOFT, inputAmountUnits)
                    await approveTx.wait()
                    console.log(`✅ Approval confirmed`)
                }
            }
        } catch {
            console.log(`ℹ️  No approval required`)
        }
    }

    // Quote the transaction
    console.log(`💭 Quoting transaction...`)
    const msgFee = await srcOFT.quoteSend(sendParam, false)
    console.log(`💰 LayerZero fee: ${(parseInt(msgFee.nativeFee.toString()) / 1e18).toFixed(6)} ETH`)

    // Send the transaction
    const txValue = isNativeToken ? msgFee.nativeFee.add(inputAmountUnits) : msgFee.nativeFee

    console.log(`📤 Sending transaction...`)
    const tx = await srcOFT.send(sendParam, msgFee, srcWallet.address, { value: txValue })
    console.log(`⏳ Transaction hash: ${tx.hash}`)

    const receipt = await tx.wait()
    console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`)

    console.log('='.repeat(80))
    console.log('✅ Asset Deposit Transaction Sent!')
    console.log('='.repeat(80))
    console.log(`Transaction Hash: ${receipt.transactionHash}`)
    console.log(`LayerZero Scan: https://testnet.layerzeroscan.com/tx/${receipt.transactionHash}`)
    console.log('='.repeat(80))
    console.log(`Flow: ${CONFIG.transaction.amount} assets (${srcChainConfig.name}) → Vault Deposit (${hubChainConfig.name}) → Shares (${dstChainConfig.name})`)
    console.log('='.repeat(80))
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Error:', error.message)
        process.exit(1)
    })
