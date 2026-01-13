#!/usr/bin/env ts-node
/**
 * Send Assets to Hub for Vault Deposit
 * 
 * This script sends assets from a spoke chain to the hub chain,
 * deposits them into the vault, and keeps the resulting shares on the hub.
 * 
 * Flow: Spoke Chain (Assets) → Hub (Vault Deposit) → Hub (Shares)
 * 
 * Run: ts-node send-scripts/7-spoke-to-hub-deposit.ts
 * Or: node send-scripts/7-spoke-to-hub-deposit.js (if compiled)
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
        katanaMainnet: {
            eid: 30375,
            rpcUrl: 'https://rpc.katana.network',
            name: 'Katana Mainnet',
        },
        bscMainnet: {
            eid: 30102,
            rpcUrl: 'https://bsc-rpc.publicnode.com',
            name: 'BSC Mainnet',
        },
    },

    // Contract addresses
    contracts: {
        // Hub chain addresses (Arbitrum Sepolia in this example)
        hub: {
            vault: '0xbc772b1E1b6Ce1213673e6F49254511a521be911',
            composer: '0x66Ba38939Cc561e3ab7a484BA60e1E8C4482d6aa',
        },
        // Source chain address (Base Sepolia in this example)
        source: {
            assetOFT: '0xDc25E63adF5Ed966B0939A31EB9fCeD727869215',
        },
    },

    // Transaction parameters
    transaction: {
        srcChain: 'bscMainnet',       // Source spoke chain where you have assets
        hubChain: 'katanaMainnet',   // Hub chain (destination, where vault is)
        amount: '1.0',                 // Amount to send (human readable)
        recipientAddress: 'RECIPIENT_ADDRESS_HERE', // Will receive shares on hub
        minAmount: undefined as string | undefined, // Optional: custom minimum amount
        lzComposeGas: 175000,          // Gas for vault deposit (no second cross-chain hop)
    },
}

// ============================================
// SCRIPT EXECUTION
// ============================================
async function main() {
    console.log('='.repeat(80))
    console.log('Send Assets to Hub for Vault Deposit')
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

    const srcChainConfig = CONFIG.chains[CONFIG.transaction.srcChain as keyof typeof CONFIG.chains]
    const hubChainConfig = CONFIG.chains[CONFIG.transaction.hubChain as keyof typeof CONFIG.chains]

    console.log(`Source: ${srcChainConfig.name} (EID: ${srcChainConfig.eid})`)
    console.log(`Hub (Destination): ${hubChainConfig.name} (EID: ${hubChainConfig.eid})`)
    console.log(`Amount: ${CONFIG.transaction.amount} assets`)
    console.log(`Recipient (shares on hub): ${CONFIG.transaction.recipientAddress}`)
    console.log('='.repeat(80))

    // Setup providers and wallets
    const srcProvider = new ethers.providers.JsonRpcProvider(srcChainConfig.rpcUrl)
    const hubProvider = new ethers.providers.JsonRpcProvider(hubChainConfig.rpcUrl)
    const srcWallet = new ethers.Wallet(CONFIG.privateKey, srcProvider)

    console.log(`Your wallet: ${srcWallet.address}`)

    // Get vault contract on hub to preview operations
    const vaultAbi = ['function asset() view returns (address)', 'function previewDeposit(uint256) view returns (uint256)']
    const vault = new ethers.Contract(CONFIG.contracts.hub.vault, vaultAbi, hubProvider)

    // Get decimals
    const erc20Abi = [
        'function decimals() view returns (uint8)',
        'function allowance(address,address) view returns (uint256)',
        'function approve(address,uint256) returns (bool)',
    ]
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

    // Build SendParam for destination (hub - no second cross-chain hop)
    const secondHopSendParam = {
        dstEid: hubChainConfig.eid,
        to: addressToBytes32(CONFIG.transaction.recipientAddress),
        amountLD: ethers.BigNumber.from(expectedOutputAmount),
        minAmountLD: ethers.BigNumber.from(minAmountOut),
        extraOptions: Options.newOptions().addExecutorLzReceiveOption(100000, 0).toHex(),
        composeMsg: '0x',
        oftCmd: '0x',
    }

    // No second cross-chain hop since destination is hub
    const lzComposeValue = 0
    console.log(`ℹ️  Destination is hub - no second hop needed`)

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
    options = options.addExecutorComposeOption(0, CONFIG.transaction.lzComposeGas, lzComposeValue)
    const extraOptions = options.toHex()

    // Calculate first hop min amount with slippage
    const slippageBps = 50 // 0.5%
    const firstHopMinAmount = ethers.BigNumber.from(
        parseUnits(
            CONFIG.transaction.minAmount || (parseFloat(CONFIG.transaction.amount) * (1 - slippageBps / 10000)).toString(),
            assetDecimals
        )
    )

    // Build SendParam for first hop
    const sendParam = {
        dstEid: hubChainConfig.eid,
        to: addressToBytes32(CONFIG.contracts.hub.composer),
        amountLD: ethers.BigNumber.from(inputAmountUnits),
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
    try {
        // Call quoteSend with the sendParam tuple explicitly structured
        const msgFeeResult = await srcOFT.quoteSend(
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
        // msgFeeResult is a tuple: [nativeFee, lzTokenFee]
        const msgFee = { nativeFee: msgFeeResult[0], lzTokenFee: msgFeeResult[1] }
        console.log(`💰 LayerZero fee: ${(parseInt(msgFee.nativeFee.toString()) / 1e18).toFixed(6)} ETH`)

        // Send the transaction
        const txValue = isNativeToken ? msgFee.nativeFee.add(inputAmountUnits) : msgFee.nativeFee

        console.log(`📤 Sending transaction...`)
        const tx = await srcOFT.send(
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
            srcWallet.address,
            { value: txValue }
        )
        console.log(`⏳ Transaction hash: ${tx.hash}`)

        const receipt = await tx.wait()
        console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`)

        console.log('='.repeat(80))
        console.log('✅ Asset Deposit to Hub Transaction Sent!')
        console.log('='.repeat(80))
        console.log(`Transaction Hash: ${receipt.transactionHash}`)
        console.log(`LayerZero Scan: https://layerzeroscan.com/tx/${receipt.transactionHash}`)
        console.log('='.repeat(80))
        console.log(`Flow: ${CONFIG.transaction.amount} assets (${srcChainConfig.name}) → Vault Deposit → Shares (${hubChainConfig.name})`)
        console.log(`Recipient will receive shares on hub: ${CONFIG.transaction.recipientAddress}`)
        console.log('='.repeat(80))
    } catch (error: any) {
        console.error('Full error:', error)
        throw error
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Error:', error.message)
        process.exit(1)
    })
