#!/usr/bin/env ts-node
/**
 * Simple Base USDC to Ethereum (via Stargate)
 * 
 * This script sends USDC from Base to Ethereum using Stargate.
 * NO vault deposit, NO compose message - just a simple transfer.
 * Use this if the compose message approach isn't working.
 * 
 * Flow: Base (USDC) → Ethereum (USDC to your wallet)
 * 
 * Run: ts-node scripts/9-simple-base-to-eth.ts
 */

import { ethers } from 'ethers'
import { parseUnits } from 'ethers/lib/utils'
import { Options, addressToBytes32 } from '@layerzerolabs/lz-v2-utilities'

const CONFIG = {
    privateKey: '<YOUR_PRIVATE_KEY_HERE>',

    chains: {
        base: {
            eid: 30184,
            rpcUrl: 'https://mainnet.base.org',
        },
        ethereum: {
            eid: 30101,
        },
    },

    contracts: {
        base: {
            usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
            stargatePoolUSDC: '0x27a16dc786820B16E5c9028b75B99F6f604b5d26',
        },
    },

    transaction: {
        amount: '0.2',
        recipientAddress: '<YOUR_RECIPIENT_ADDRESS_HERE>',
    },
}

async function main() {
    console.log('='.repeat(80))
    console.log('Simple USDC Transfer: Base → Ethereum')
    console.log('='.repeat(80))

    const baseProvider = new ethers.providers.JsonRpcProvider(CONFIG.chains.base.rpcUrl)
    const wallet = new ethers.Wallet(CONFIG.privateKey, baseProvider)

    console.log(`Wallet: ${wallet.address}`)
    console.log(`Amount: ${CONFIG.transaction.amount} USDC`)
    console.log(`Recipient on Ethereum: ${CONFIG.transaction.recipientAddress}`)
    console.log('='.repeat(80))

    // USDC contract
    const erc20Abi = [
        'function decimals() view returns (uint8)',
        'function balanceOf(address) view returns (uint256)',
        'function allowance(address,address) view returns (uint256)',
        'function approve(address,uint256) returns (bool)',
    ]
    const usdc = new ethers.Contract(CONFIG.contracts.base.usdc, erc20Abi, wallet)
    const decimals = await usdc.decimals()
    const amount = parseUnits(CONFIG.transaction.amount, decimals)

    // Check balance
    const balance = await usdc.balanceOf(wallet.address)
    console.log(`Your balance: ${ethers.utils.formatUnits(balance, decimals)} USDC`)

    if (balance.lt(amount)) {
        throw new Error('Insufficient balance')
    }

    // Check allowance
    const allowance = await usdc.allowance(wallet.address, CONFIG.contracts.base.stargatePoolUSDC)
    if (allowance.lt(amount)) {
        console.log('Approving USDC...')
        const tx = await usdc.approve(CONFIG.contracts.base.stargatePoolUSDC, amount)
        await tx.wait()
        console.log('✅ Approved')
    }

    // Stargate Pool
    const poolAbi = [
        'function send((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),(uint256,uint256),address) payable returns ((bytes32,uint64))',
        'function quoteSend((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),bool) view returns ((uint256,uint256))',
    ]
    const pool = new ethers.Contract(CONFIG.contracts.base.stargatePoolUSDC, poolAbi, wallet)

    // Simple send param - NO compose message
    const sendParam = {
        dstEid: CONFIG.chains.ethereum.eid,
        to: addressToBytes32(CONFIG.transaction.recipientAddress),
        amountLD: amount,
        minAmountLD: amount.mul(9950).div(10000), // 0.5% slippage
        extraOptions: Options.newOptions().addExecutorLzReceiveOption(50000, 0).toHex(),
        composeMsg: '0x',
        oftCmd: '0x',
    }

    // Quote
    console.log('Quoting...')
    const quote = await pool.quoteSend(
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
    console.log(`Fee: ${ethers.utils.formatEther(quote[0])} ETH`)

    // Send
    console.log('Sending...')
    const tx = await pool.send(
        [
            sendParam.dstEid,
            sendParam.to,
            sendParam.amountLD,
            sendParam.minAmountLD,
            sendParam.extraOptions,
            sendParam.composeMsg,
            sendParam.oftCmd,
        ],
        [quote[0], quote[1]],
        wallet.address,
        { value: quote[0] }
    )

    console.log(`Transaction: ${tx.hash}`)
    const receipt = await tx.wait()
    console.log(`✅ Confirmed in block ${receipt.blockNumber}`)
    console.log(`LayerZero Scan: https://layerzeroscan.com/tx/${tx.hash}`)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Error:', error.message)
        process.exit(1)
    })
