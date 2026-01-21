#!/usr/bin/env ts-node
/**
 * Ethereum USDC → Vault → Katana Shares (Direct via Composer)
 * 
 * This script deposits USDC into the vault on Ethereum and sends
 * shares to Katana in a more streamlined way using the composer.
 * 
 * This is more efficient than script 9b as it minimizes steps.
 * 
 * Flow: Ethereum (USDC) → Vault → Katana (Shares) - Using Composer
 * 
 * Run: ts-node scripts/10-eth-deposit-to-katana.ts
 */

import { ethers } from 'ethers'
import { parseUnits } from 'ethers/lib/utils'
import { Options, addressToBytes32 } from '@layerzerolabs/lz-v2-utilities'

const CONFIG = {
    privateKey: '<YOUR_PRIVATE_KEY_HERE>',

    chains: {
        ethereum: {
            eid: 30101,
            rpcUrl: 'https://ethereum-rpc.publicnode.com',
            name: 'Ethereum',
        },
        katana: {
            eid: 30375,
            rpcUrl: 'https://rpc.katana.network',
            name: 'Katana',
        },
    },

    contracts: {
        ethereum: {
            usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            vault: '0x53E82ABbb12638F09d9e624578ccB666217a765e',
            composer: '0x8A35897fda9E024d2aC20a937193e099679eC477',
            vaultOFTAdaptor: '0xb5bADA33542a05395d504a25885e02503A957Bb3',
        },
    },

    transaction: {
        amount: '0.005',  // Amount of USDC to deposit
        recipientAddress: '<YOUR_RECIPIENT_ADDRESS_HERE>',
        slippageBps: 50,  // 0.5%
    },
}

async function main() {
    console.log('='.repeat(80))
    console.log('Ethereum USDC → Vault → Katana Shares (via Composer)')
    console.log('='.repeat(80))

    const ethProvider = new ethers.providers.JsonRpcProvider(CONFIG.chains.ethereum.rpcUrl)
    const wallet = new ethers.Wallet(CONFIG.privateKey, ethProvider)

    console.log(`Wallet: ${wallet.address}`)
    console.log(`Amount: ${CONFIG.transaction.amount} USDC`)
    console.log(`Recipient on Katana: ${CONFIG.transaction.recipientAddress}`)
    console.log('='.repeat(80))

    // ERC20 ABI
    const erc20Abi = [
        'function decimals() view returns (uint8)',
        'function balanceOf(address) view returns (uint256)',
        'function allowance(address,address) view returns (uint256)',
        'function approve(address,uint256) returns (bool)',
    ]

    // USDC on Ethereum
    const usdc = new ethers.Contract(CONFIG.contracts.ethereum.usdc, erc20Abi, wallet)
    const usdcDecimals = await usdc.decimals()
    const amount = parseUnits(CONFIG.transaction.amount, usdcDecimals)

    // Check balance
    const balance = await usdc.balanceOf(wallet.address)
    console.log(`💰 Your USDC balance: ${ethers.utils.formatUnits(balance, usdcDecimals)} USDC`)

    if (balance.lt(amount)) {
        throw new Error(`Insufficient balance. Need ${CONFIG.transaction.amount}, have ${ethers.utils.formatUnits(balance, usdcDecimals)}`)
    }

    // Vault
    const vaultAbi = [
        'function decimals() view returns (uint8)',
        'function deposit(uint256,address) returns (uint256)',
        'function previewDeposit(uint256) view returns (uint256)',
    ]
    const vault = new ethers.Contract(CONFIG.contracts.ethereum.vault, vaultAbi, wallet)
    const vaultDecimals = await vault.decimals()

    // Preview deposit
    const expectedShares = await vault.previewDeposit(amount)
    const minShares = expectedShares.mul(10000 - CONFIG.transaction.slippageBps).div(10000)
    console.log(`📊 Expected shares: ${ethers.utils.formatUnits(expectedShares, vaultDecimals)}`)

    // Build sendParam for Katana
    const sendParam = {
        dstEid: CONFIG.chains.katana.eid,
        to: addressToBytes32(CONFIG.transaction.recipientAddress),
        amountLD: expectedShares,
        minAmountLD: minShares,
        extraOptions: Options.newOptions().addExecutorLzReceiveOption(100000, 0).toHex(),
        composeMsg: '0x',
        oftCmd: '0x',
    }

    // Quote the LayerZero fee for bridging shares
    const oftAbi = [
        'function quoteSend((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),bool) view returns ((uint256,uint256))',
    ]
    const shareOFT = new ethers.Contract(CONFIG.contracts.ethereum.vaultOFTAdaptor, oftAbi, wallet)

    console.log('\n💭 Quoting LayerZero fee for share bridge...')
    const quote = await shareOFT.quoteSend(
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
    const bridgeFee = quote[0]
    console.log(`💰 Bridge fee: ${ethers.utils.formatEther(bridgeFee)} ETH`)

    // Check composer interface for the function we need
    // Actual signature from ABI: depositAndSend(uint256 _assetAmount, SendParam _sendParam, address _refundAddress)
    const composerAbi = [
        'function depositAndSend(uint256,(uint32,bytes32,uint256,uint256,bytes,bytes,bytes),address) payable',
    ]
    const composer = new ethers.Contract(CONFIG.contracts.ethereum.composer, composerAbi, wallet)

    // Standard approach: Approve USDC to Composer, then call depositAndSend
    console.log('\n📝 Step 1: Approve USDC to Composer')
    const allowance = await usdc.allowance(wallet.address, CONFIG.contracts.ethereum.composer)
    if (allowance.lt(amount)) {
        console.log('   Approving...')
        const approveTx = await usdc.approve(CONFIG.contracts.ethereum.composer, amount)
        await approveTx.wait()
        console.log('   ✅ Approved')
    } else {
        console.log('   ✅ Already approved')
    }

    console.log('\n📝 Step 2: Deposit & Bridge to Katana (Single Transaction)')
    console.log('   This will:')
    console.log('   • Take your USDC')
    console.log('   • Deposit into vault')
    console.log('   • Send shares to Katana')
    console.log('   All in one transaction via composer\n')

    // Try depositAndSend (correct signature: amount, sendParam, refundAddress)
    console.log('   Calling depositAndSend on composer...')
    const tx = await composer.depositAndSend(
        amount,
        [
            sendParam.dstEid,
            sendParam.to,
            sendParam.amountLD,
            sendParam.minAmountLD,
            sendParam.extraOptions,
            sendParam.composeMsg,
            sendParam.oftCmd,
        ],
        wallet.address,  // refundAddress for any excess ETH
        { value: bridgeFee }
    )
    console.log(`   ⏳ Transaction: ${tx.hash}`)
    const receipt = await tx.wait()
    console.log(`   ✅ Complete! Block: ${receipt.blockNumber}`)

    console.log('\n' + '='.repeat(80))
    console.log('✅ Success!')
    console.log('='.repeat(80))
    console.log(`Transaction: ${receipt.transactionHash}`)
    console.log(`LayerZero Scan: https://layerzeroscan.com/tx/${receipt.transactionHash}`)
    console.log('='.repeat(80))
    console.log(`Summary:`)
    console.log(`  • ${CONFIG.transaction.amount} USDC deposited into vault`)
    console.log(`  • ~${ethers.utils.formatUnits(expectedShares, vaultDecimals)} shares sent to Katana`)
    console.log(`  • Recipient: ${CONFIG.transaction.recipientAddress}`)
    console.log(`  • Total transactions: 2 (1 approval + 1 deposit&send)`)
    console.log('='.repeat(80))
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Error:', error.message)
        if (error.error) {
            console.error('Details:', error.error.message)
        }
        process.exit(1)
    })
